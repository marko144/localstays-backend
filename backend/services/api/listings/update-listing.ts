/**
 * Update Listing Metadata
 * 
 * PUT /api/v1/hosts/{hostId}/listings/{listingId}/update
 * 
 * Allows hosts to update listing metadata for listings in specific statuses.
 * Supports partial updates - only fields provided in the request will be updated.
 * 
 * Allowed statuses: IN_REVIEW, REJECTED, APPROVED, ONLINE, OFFLINE
 * 
 * Features:
 * - Partial updates (only send fields you want to change)
 * - Validates all input data
 * - Updates listing metadata in DynamoDB
 * - Updates amenities separately (full replacement)
 * - No status changes
 * - No email notifications
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { requireAuth } from '../lib/auth-middleware';
import * as response from '../lib/response';
import {
  UpdateListingMetadataRequest,
  UpdateListingMetadataResponse,
  PropertyType,
  CheckInType,
  ParkingType,
  PaymentType,
  CancellationPolicyType,
  ListingMetadata,
  BilingualEnum,
  AmenityCategory,
} from '../../types/listing.types';

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

const TABLE_NAME = process.env.TABLE_NAME!;

// Statuses that allow metadata updates
const EDITABLE_STATUSES = ['IN_REVIEW', 'REJECTED', 'APPROVED', 'ONLINE', 'OFFLINE'];

// Valid enum values
const VALID_PROPERTY_TYPES: PropertyType[] = ['APARTMENT', 'HOUSE', 'VILLA', 'STUDIO', 'ROOM'];
const VALID_CHECKIN_TYPES: CheckInType[] = ['SELF_CHECKIN', 'HOST_GREETING', 'LOCKBOX', 'DOORMAN'];
const VALID_PARKING_TYPES: ParkingType[] = ['NO_PARKING', 'FREE', 'PAID'];
const VALID_PAYMENT_TYPES: PaymentType[] = ['PAY_ONLINE', 'PAY_DEPOSIT_ONLINE', 'PAY_LATER_CASH', 'PAY_LATER_CARD'];
const VALID_CANCELLATION_TYPES: CancellationPolicyType[] = [
  'NO_CANCELLATION',
  '24_HOURS',
  '2_DAYS',
  '3_DAYS',
  '4_DAYS',
  'ONE_WEEK',
  'OTHER',
];

/**
 * Main handler
 */
export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  console.log('Update listing metadata request:', {
    pathParameters: event.pathParameters,
    body: event.body,
  });

  try {
    // 1. Authenticate user
    const authResult = requireAuth(event);
    if ('error' in authResult) {
      return authResult.error;
    }

    const { user } = authResult;
    const hostId = event.pathParameters?.hostId;
    const listingId = event.pathParameters?.listingId;

    // 2. Validate path parameters
    if (!hostId || !listingId) {
      return response.badRequest('Missing hostId or listingId');
    }

    // 3. Verify ownership
    // Admins can edit any listing
    if (user.role === 'ADMIN') {
      console.log(`Admin ${user.email} updating listing ${listingId}`);
    }
    // Hosts can only edit their own listings
    else if (user.role === 'HOST') {
      if (user.hostId !== hostId) {
        console.warn(`Host ${user.hostId} attempted to edit listing owned by ${hostId}`);
        return response.forbidden('You do not have permission to edit this listing');
      }
    } else {
      return response.forbidden('Invalid user role');
    }

    // 4. Parse and validate request body
    if (!event.body) {
      return response.badRequest('Request body is required');
    }

    const body = JSON.parse(event.body) as UpdateListingMetadataRequest;

    if (!body.updates || typeof body.updates !== 'object') {
      return response.badRequest('updates object is required');
    }

    const { updates } = body;

    // Check if at least one field is provided
    if (Object.keys(updates).length === 0) {
      return response.badRequest('At least one field must be provided for update');
    }

    // 5. Fetch existing listing
    const listingResult = await docClient.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: {
          pk: `HOST#${hostId}`,
          sk: `LISTING_META#${listingId}`,
        },
      })
    );

    if (!listingResult.Item) {
      return response.notFound('Listing not found');
    }

    const listing = listingResult.Item as ListingMetadata;

    // 6. Validate listing status
    if (!EDITABLE_STATUSES.includes(listing.status)) {
      return response.badRequest(
        `Listing cannot be edited in current status: ${listing.status}`,
        'INVALID_STATUS'
      );
    }

    // 6a. Special validation for address updates - only allowed for REJECTED listings
    if (updates.address !== undefined && listing.status !== 'REJECTED') {
      return response.badRequest(
        'Address can only be updated for listings in REJECTED status',
        'ADDRESS_UPDATE_NOT_ALLOWED'
      );
    }

    // 7. Validate all provided fields
    const validationError = await validateUpdates(updates);
    if (validationError) {
      return response.badRequest(validationError, 'VALIDATION_ERROR');
    }

    // 8. Build update expression for listing metadata
    const now = new Date().toISOString();
    const updatedFields: string[] = [];
    const updateExpressionParts: string[] = [];
    const expressionAttributeNames: Record<string, string> = {};
    const expressionAttributeValues: Record<string, any> = {};

    // Always update the updatedAt timestamp
    updateExpressionParts.push('#updatedAt = :updatedAt');
    expressionAttributeNames['#updatedAt'] = 'updatedAt';
    expressionAttributeValues[':updatedAt'] = now;

    // listingName
    if (updates.listingName !== undefined) {
      updateExpressionParts.push('#listingName = :listingName');
      expressionAttributeNames['#listingName'] = 'listingName';
      expressionAttributeValues[':listingName'] = updates.listingName;
      updatedFields.push('listingName');
    }

    // propertyType
    if (updates.propertyType !== undefined) {
      const propertyTypeEnum = await fetchEnumTranslation('PROPERTY_TYPE', updates.propertyType);
      if (!propertyTypeEnum) {
        return response.badRequest(`Invalid property type: ${updates.propertyType}`, 'VALIDATION_ERROR');
      }
      updateExpressionParts.push('#propertyType = :propertyType');
      expressionAttributeNames['#propertyType'] = 'propertyType';
      expressionAttributeValues[':propertyType'] = propertyTypeEnum;
      updatedFields.push('propertyType');
    }

    // description
    if (updates.description !== undefined) {
      updateExpressionParts.push('#description = :description');
      expressionAttributeNames['#description'] = 'description';
      expressionAttributeValues[':description'] = updates.description;
      updatedFields.push('description');
    }

    // address (only for REJECTED listings - already validated above)
    if (updates.address !== undefined) {
      const normalizedAddress = normalizeAddress(updates.address);
      updateExpressionParts.push('#address = :address');
      expressionAttributeNames['#address'] = 'address';
      expressionAttributeValues[':address'] = normalizedAddress;
      updatedFields.push('address');
    }

    // mapboxMetadata
    if (updates.mapboxMetadata !== undefined) {
      updateExpressionParts.push('#mapboxMetadata = :mapboxMetadata');
      expressionAttributeNames['#mapboxMetadata'] = 'mapboxMetadata';
      expressionAttributeValues[':mapboxMetadata'] = updates.mapboxMetadata;
      updatedFields.push('mapboxMetadata');
    }

    // capacity
    if (updates.capacity !== undefined) {
      updateExpressionParts.push('#capacity = :capacity');
      expressionAttributeNames['#capacity'] = 'capacity';
      expressionAttributeValues[':capacity'] = updates.capacity;
      updatedFields.push('capacity');
    }

    // pricing
    if (updates.pricing !== undefined) {
      updateExpressionParts.push('#pricing = :pricing');
      expressionAttributeNames['#pricing'] = 'pricing';
      expressionAttributeValues[':pricing'] = updates.pricing;
      updatedFields.push('pricing');
    }

    // pets
    if (updates.pets !== undefined) {
      updateExpressionParts.push('#pets = :pets');
      expressionAttributeNames['#pets'] = 'pets';
      
      const petsValue: any = {
        allowed: updates.pets.allowed,
      };
      
      // Only include policy if it's provided
      if (updates.pets.policy !== undefined) {
        petsValue.policy = updates.pets.policy;
      }
      
      expressionAttributeValues[':pets'] = petsValue;
      updatedFields.push('pets');
    }

    // checkIn
    if (updates.checkIn !== undefined) {
      const checkInTypeEnum = await fetchEnumTranslation('CHECKIN_TYPE', updates.checkIn.type);
      if (!checkInTypeEnum) {
        return response.badRequest(`Invalid check-in type: ${updates.checkIn.type}`, 'VALIDATION_ERROR');
      }
      updateExpressionParts.push('#checkIn = :checkIn');
      expressionAttributeNames['#checkIn'] = 'checkIn';
      
      const checkInValue: any = {
        type: checkInTypeEnum,
        checkInFrom: updates.checkIn.checkInFrom,
        checkOutBy: updates.checkIn.checkOutBy,
      };
      
      // Only include description if it's provided
      if (updates.checkIn.description !== undefined) {
        checkInValue.description = updates.checkIn.description;
      }
      
      expressionAttributeValues[':checkIn'] = checkInValue;
      updatedFields.push('checkIn');
    }

    // parking
    if (updates.parking !== undefined) {
      const parkingTypeEnum = await fetchEnumTranslation('PARKING_TYPE', updates.parking.type);
      if (!parkingTypeEnum) {
        return response.badRequest(`Invalid parking type: ${updates.parking.type}`, 'VALIDATION_ERROR');
      }
      updateExpressionParts.push('#parking = :parking');
      expressionAttributeNames['#parking'] = 'parking';
      
      const parkingValue: any = {
        type: parkingTypeEnum,
      };
      
      // Only include description if it's provided
      if (updates.parking.description !== undefined) {
        parkingValue.description = updates.parking.description;
      }
      
      expressionAttributeValues[':parking'] = parkingValue;
      updatedFields.push('parking');
    }

    // paymentType
    if (updates.paymentType !== undefined) {
      const paymentTypeEnum = await fetchEnumTranslation('PAYMENT_TYPE', updates.paymentType);
      if (!paymentTypeEnum) {
        return response.badRequest(`Invalid payment type: ${updates.paymentType}`, 'VALIDATION_ERROR');
      }
      updateExpressionParts.push('#paymentType = :paymentType');
      expressionAttributeNames['#paymentType'] = 'paymentType';
      expressionAttributeValues[':paymentType'] = paymentTypeEnum;
      updatedFields.push('paymentType');
    }

    // smokingAllowed
    if (updates.smokingAllowed !== undefined) {
      updateExpressionParts.push('#smokingAllowed = :smokingAllowed');
      expressionAttributeNames['#smokingAllowed'] = 'smokingAllowed';
      expressionAttributeValues[':smokingAllowed'] = updates.smokingAllowed;
      updatedFields.push('smokingAllowed');
    }

    // cancellationPolicy
    if (updates.cancellationPolicy !== undefined) {
      const cancellationTypeEnum = await fetchEnumTranslation(
        'CANCELLATION_POLICY',
        updates.cancellationPolicy.type
      );
      if (!cancellationTypeEnum) {
        return response.badRequest(
          `Invalid cancellation policy type: ${updates.cancellationPolicy.type}`,
          'VALIDATION_ERROR'
        );
      }
      updateExpressionParts.push('#cancellationPolicy = :cancellationPolicy');
      expressionAttributeNames['#cancellationPolicy'] = 'cancellationPolicy';
      
      const cancellationPolicyValue: any = {
        type: cancellationTypeEnum,
      };
      
      // Only include customText if it's provided
      if (updates.cancellationPolicy.customText !== undefined) {
        cancellationPolicyValue.customText = updates.cancellationPolicy.customText;
      }
      
      expressionAttributeValues[':cancellationPolicy'] = cancellationPolicyValue;
      updatedFields.push('cancellationPolicy');
    }

    // rightToListDocumentNumber
    if (updates.rightToListDocumentNumber !== undefined) {
      updateExpressionParts.push('#rightToListDocumentNumber = :rightToListDocumentNumber');
      expressionAttributeNames['#rightToListDocumentNumber'] = 'rightToListDocumentNumber';
      expressionAttributeValues[':rightToListDocumentNumber'] = updates.rightToListDocumentNumber;
      updatedFields.push('rightToListDocumentNumber');
    }

    // 9. Update listing metadata (if any metadata fields were provided)
    if (updateExpressionParts.length > 1) {
      // More than just updatedAt
      await docClient.send(
        new UpdateCommand({
          TableName: TABLE_NAME,
          Key: {
            pk: `HOST#${hostId}`,
            sk: `LISTING_META#${listingId}`,
          },
          UpdateExpression: `SET ${updateExpressionParts.join(', ')}`,
          ExpressionAttributeNames: expressionAttributeNames,
          ExpressionAttributeValues: expressionAttributeValues,
        })
      );

      console.log(`✅ Updated listing metadata: ${updatedFields.join(', ')}`);
    }

    // 10. Update amenities (if provided) - full replacement
    if (updates.amenities !== undefined) {
      const amenityEnums = await fetchAmenityTranslations(updates.amenities);

      await docClient.send(
        new PutCommand({
          TableName: TABLE_NAME,
          Item: {
            pk: `HOST#${hostId}`,
            sk: `LISTING_AMENITIES#${listingId}`,
            listingId,
            amenities: amenityEnums,
            updatedAt: now,
            isDeleted: false,
          },
        })
      );

      updatedFields.push('amenities');
      console.log(`✅ Updated amenities: ${updates.amenities.length} amenities`);
    }

    // 11. Return success response
    const responseData: UpdateListingMetadataResponse = {
      listingId,
      updatedFields,
      message: 'Listing updated successfully',
    };

    console.log('✅ Listing metadata updated successfully:', responseData);

    return response.success(responseData);
  } catch (error: any) {
    console.error('❌ Update listing metadata error:', error);
    return response.handleError(error);
  }
}

/**
 * Validate all provided update fields
 */
async function validateUpdates(updates: UpdateListingMetadataRequest['updates']): Promise<string | null> {
  // listingName
  if (updates.listingName !== undefined) {
    if (typeof updates.listingName !== 'string' || updates.listingName.trim().length === 0) {
      return 'Listing name must be a non-empty string';
    }
    if (updates.listingName.length > 100) {
      return 'Listing name must not exceed 100 characters';
    }
  }

  // propertyType
  if (updates.propertyType !== undefined) {
    if (!VALID_PROPERTY_TYPES.includes(updates.propertyType)) {
      return `Invalid property type: ${updates.propertyType}`;
    }
  }

  // description
  if (updates.description !== undefined) {
    if (typeof updates.description !== 'string' || updates.description.trim().length === 0) {
      return 'Description must be a non-empty string';
    }
    if (updates.description.length > 2000) {
      return 'Description must not exceed 2000 characters';
    }
  }

  // address
  if (updates.address !== undefined) {
    if (!updates.address.coordinates || 
        typeof updates.address.coordinates.latitude !== 'number' || 
        typeof updates.address.coordinates.longitude !== 'number') {
      return 'Address must include valid coordinates (latitude and longitude)';
    }
    if (!updates.address.street || typeof updates.address.street !== 'string') {
      return 'Address must include street';
    }
    if (!updates.address.city || typeof updates.address.city !== 'string') {
      return 'Address must include city';
    }
    if (!updates.address.country || typeof updates.address.country !== 'string') {
      return 'Address must include country';
    }
    if (!updates.address.countryCode || typeof updates.address.countryCode !== 'string') {
      return 'Address must include countryCode';
    }
    if (updates.address.coordinates.latitude < -90 || updates.address.coordinates.latitude > 90) {
      return 'Latitude must be between -90 and 90';
    }
    if (updates.address.coordinates.longitude < -180 || updates.address.coordinates.longitude > 180) {
      return 'Longitude must be between -180 and 180';
    }
  }

  // mapboxMetadata
  if (updates.mapboxMetadata !== undefined) {
    if (updates.mapboxMetadata.country) {
      if (!updates.mapboxMetadata.country.mapbox_id || !updates.mapboxMetadata.country.name) {
        return 'mapboxMetadata.country must include both mapbox_id and name';
      }
      if (typeof updates.mapboxMetadata.country.mapbox_id !== 'string' || 
          typeof updates.mapboxMetadata.country.name !== 'string') {
        return 'mapboxMetadata.country.mapbox_id and name must be strings';
      }
    }
    if (updates.mapboxMetadata.region) {
      if (!updates.mapboxMetadata.region.mapbox_id || !updates.mapboxMetadata.region.name) {
        return 'mapboxMetadata.region must include both mapbox_id and name';
      }
      if (typeof updates.mapboxMetadata.region.mapbox_id !== 'string' || 
          typeof updates.mapboxMetadata.region.name !== 'string') {
        return 'mapboxMetadata.region.mapbox_id and name must be strings';
      }
    }
    if (updates.mapboxMetadata.place) {
      if (!updates.mapboxMetadata.place.mapbox_id || !updates.mapboxMetadata.place.name) {
        return 'mapboxMetadata.place must include both mapbox_id and name';
      }
      if (typeof updates.mapboxMetadata.place.mapbox_id !== 'string' || 
          typeof updates.mapboxMetadata.place.name !== 'string') {
        return 'mapboxMetadata.place.mapbox_id and name must be strings';
      }
    }
  }

  // capacity
  if (updates.capacity !== undefined) {
    if (!updates.capacity.beds || !updates.capacity.sleeps) {
      return 'When updating capacity, both beds and sleeps are required';
    }
    if (updates.capacity.beds < 1 || updates.capacity.beds > 50) {
      return 'Beds must be between 1 and 50';
    }
    if (updates.capacity.sleeps < 1 || updates.capacity.sleeps > 100) {
      return 'Sleeps must be between 1 and 100';
    }
  }

  // pricing
  if (updates.pricing !== undefined) {
    if (!updates.pricing.pricePerNight || !updates.pricing.currency) {
      return 'When updating pricing, both pricePerNight and currency are required';
    }
    if (updates.pricing.pricePerNight < 1 || updates.pricing.pricePerNight > 100000) {
      return 'Price per night must be between 1 and 100000';
    }
    if (!/^[A-Z]{3}$/.test(updates.pricing.currency)) {
      return 'Currency must be a valid 3-letter ISO code (e.g., EUR, USD)';
    }
  }

  // pets
  if (updates.pets !== undefined) {
    if (typeof updates.pets.allowed !== 'boolean') {
      return 'Pets allowed must be a boolean';
    }
    if (updates.pets.policy && updates.pets.policy.length > 500) {
      return 'Pet policy must not exceed 500 characters';
    }
  }

  // checkIn
  if (updates.checkIn !== undefined) {
    if (!updates.checkIn.type || !updates.checkIn.checkInFrom || !updates.checkIn.checkOutBy) {
      return 'When updating check-in, type, checkInFrom, and checkOutBy are required';
    }
    if (!VALID_CHECKIN_TYPES.includes(updates.checkIn.type)) {
      return `Invalid check-in type: ${updates.checkIn.type}`;
    }
    if (!/^\d{2}:\d{2}$/.test(updates.checkIn.checkInFrom)) {
      return 'checkInFrom must be in HH:MM format';
    }
    if (!/^\d{2}:\d{2}$/.test(updates.checkIn.checkOutBy)) {
      return 'checkOutBy must be in HH:MM format';
    }
    if (updates.checkIn.description && updates.checkIn.description.length > 500) {
      return 'Check-in description must not exceed 500 characters';
    }
  }

  // parking
  if (updates.parking !== undefined) {
    if (!updates.parking.type) {
      return 'When updating parking, type is required';
    }
    if (!VALID_PARKING_TYPES.includes(updates.parking.type)) {
      return `Invalid parking type: ${updates.parking.type}`;
    }
    if (updates.parking.description && updates.parking.description.length > 500) {
      return 'Parking description must not exceed 500 characters';
    }
  }

  // paymentType
  if (updates.paymentType !== undefined) {
    if (!VALID_PAYMENT_TYPES.includes(updates.paymentType)) {
      return `Invalid payment type: ${updates.paymentType}`;
    }
  }

  // smokingAllowed
  if (updates.smokingAllowed !== undefined) {
    if (typeof updates.smokingAllowed !== 'boolean') {
      return 'Smoking allowed must be a boolean';
    }
  }

  // cancellationPolicy
  if (updates.cancellationPolicy !== undefined) {
    if (!updates.cancellationPolicy.type) {
      return 'When updating cancellation policy, type is required';
    }
    if (!VALID_CANCELLATION_TYPES.includes(updates.cancellationPolicy.type)) {
      return `Invalid cancellation policy type: ${updates.cancellationPolicy.type}`;
    }
    if (updates.cancellationPolicy.type === 'OTHER' && !updates.cancellationPolicy.customText) {
      return 'Custom text is required when cancellation policy type is OTHER';
    }
    if (updates.cancellationPolicy.customText && updates.cancellationPolicy.customText.length > 1000) {
      return 'Cancellation policy custom text must not exceed 1000 characters';
    }
  }

  // amenities
  if (updates.amenities !== undefined) {
    if (!Array.isArray(updates.amenities)) {
      return 'Amenities must be an array';
    }
    if (updates.amenities.length > 50) {
      return 'Maximum 50 amenities allowed';
    }
  }

  // rightToListDocumentNumber
  if (updates.rightToListDocumentNumber !== undefined) {
    if (typeof updates.rightToListDocumentNumber !== 'string') {
      return 'Document number must be a string';
    }
    if (updates.rightToListDocumentNumber.length > 30) {
      return 'Document number must not exceed 30 characters';
    }
  }

  return null;
}

/**
 * Fetch enum translation from DynamoDB
 */
async function fetchEnumTranslation(
  enumType: string,
  enumValue: string
): Promise<BilingualEnum & { isEntirePlace?: boolean } | null> {
  try {
    const result = await docClient.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: {
          pk: `ENUM#${enumType}`,
          sk: `VALUE#${enumValue}`,
        },
      })
    );

    if (!result.Item) {
      return null;
    }

    return {
      key: result.Item.enumValue,
      en: result.Item.translations.en,
      sr: result.Item.translations.sr,
      ...(result.Item.metadata?.isEntirePlace !== undefined && {
        isEntirePlace: result.Item.metadata.isEntirePlace,
      }),
    };
  } catch (error) {
    console.error(`Failed to fetch enum translation for ${enumType}:${enumValue}:`, error);
    return null;
  }
}

/**
 * Fetch amenity translations with categories
 */
async function fetchAmenityTranslations(
  amenityKeys: string[]
): Promise<Array<BilingualEnum & { category: AmenityCategory }>> {
  const amenities: Array<BilingualEnum & { category: AmenityCategory }> = [];

  for (const key of amenityKeys) {
    const result = await docClient.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: {
          pk: 'ENUM#AMENITY',
          sk: `VALUE#${key}`,
        },
      })
    );

    if (result.Item) {
      amenities.push({
        key: result.Item.enumValue,
        en: result.Item.translations.en,
        sr: result.Item.translations.sr,
        category: result.Item.metadata?.category || 'BASICS',
      });
    }
  }

  return amenities;
}

/**
 * Normalize address data from frontend to match our schema
 * Constructs fullAddress from provided fields if not already present
 * Removes undefined values to avoid DynamoDB errors
 */
function normalizeAddress(address: UpdateListingMetadataRequest['updates']['address']): any {
  if (!address) {
    return null;
  }

  // Construct full address string if not provided
  const addressParts = [
    address.streetNumber,
    address.street,
    address.apartmentNumber,
    address.city,
    address.municipality,
    address.postalCode,
    address.country,
  ].filter(Boolean);

  const fullAddress = address.fullAddress || addressParts.join(', ');

  const normalized: any = {
    fullAddress,
    street: address.street || '',
    streetNumber: address.streetNumber || '',
    city: address.city || '',
    postalCode: address.postalCode || '',
    country: address.country || '',
    countryCode: address.countryCode,
    coordinates: {
      latitude: address.coordinates.latitude,
      longitude: address.coordinates.longitude,
    },
  };

  // Only include optional fields if they have values (not undefined)
  if (address.apartmentNumber !== undefined) {
    normalized.apartmentNumber = address.apartmentNumber;
  }
  if (address.municipality !== undefined) {
    normalized.municipality = address.municipality;
  }
  if (address.mapboxPlaceId !== undefined) {
    normalized.mapboxPlaceId = address.mapboxPlaceId;
  }

  return normalized;
}


