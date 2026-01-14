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
import { DynamoDBDocumentClient, GetCommand, UpdateCommand, PutCommand, QueryCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { requireAuth } from '../lib/auth-middleware';
import * as response from '../lib/response';
import { validateGoogleMapsLink } from '../lib/url-validation';
import {
  UpdateListingMetadataRequest,
  UpdateListingMetadataResponse,
  PropertyType,
  CheckInType,
  ParkingType,
  PaymentType,
  AdvanceBookingType,
  MaxBookingDurationType,
  CancellationPolicyType,
  ListingMetadata,
  BilingualEnum,
  AmenityCategory,
} from '../../types/listing.types';
import { buildCloudFrontUrl } from '../lib/cloudfront-urls';

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

const TABLE_NAME = process.env.TABLE_NAME!;
const PUBLIC_LISTINGS_TABLE_NAME = process.env.PUBLIC_LISTINGS_TABLE_NAME!;

// Statuses that allow metadata updates
const EDITABLE_STATUSES = ['IN_REVIEW', 'REJECTED', 'APPROVED', 'ONLINE', 'OFFLINE'];

// Valid enum values
const VALID_PROPERTY_TYPES: PropertyType[] = ['APARTMENT', 'HOUSE', 'VILLA', 'STUDIO', 'ROOM'];
const VALID_CHECKIN_TYPES: CheckInType[] = ['SELF_CHECKIN', 'HOST_GREETING', 'LOCKBOX', 'DOORMAN'];
const VALID_PARKING_TYPES: ParkingType[] = ['NO_PARKING', 'FREE', 'PAID'];
const VALID_PAYMENT_TYPES: PaymentType[] = ['PAY_LATER', 'PAY_LATER_CASH_ONLY'];
const VALID_ADVANCE_BOOKING: AdvanceBookingType[] = [
  'DAYS_30', 'DAYS_60', 'DAYS_90', 'DAYS_180', 'DAYS_240', 'DAYS_300', 'DAYS_365'
];
const VALID_MAX_BOOKING_DURATION: MaxBookingDurationType[] = [
  'NIGHTS_7', 'NIGHTS_14', 'NIGHTS_30', 'NIGHTS_60', 'NIGHTS_90'
];
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
      
      // Update denormalized locationId and GSI8 when mapboxMetadata changes
      const newLocationId = updates.mapboxMetadata?.place?.mapbox_id || null;
      if (newLocationId) {
        updateExpressionParts.push('#locationId = :locationId');
        expressionAttributeNames['#locationId'] = 'locationId';
        expressionAttributeValues[':locationId'] = newLocationId;
        
        updateExpressionParts.push('#gsi8pk = :gsi8pk');
        expressionAttributeNames['#gsi8pk'] = 'gsi8pk';
        expressionAttributeValues[':gsi8pk'] = `LOCATION#${newLocationId}`;
        
        // Note: When location changes, readyToApprove is always false (only admins set it)
        updateExpressionParts.push('#gsi8sk = :gsi8sk');
        expressionAttributeNames['#gsi8sk'] = 'gsi8sk';
        expressionAttributeValues[':gsi8sk'] = `READY#false#LISTING#${listingId}`;
        
        updatedFields.push('locationId');
      }
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

    // advanceBooking
    if (updates.advanceBooking !== undefined) {
      const advanceBookingEnum = await fetchEnumTranslation('ADVANCE_BOOKING', updates.advanceBooking);
      if (!advanceBookingEnum) {
        return response.badRequest(`Invalid advance booking option: ${updates.advanceBooking}`, 'VALIDATION_ERROR');
      }
      updateExpressionParts.push('#advanceBooking = :advanceBooking');
      expressionAttributeNames['#advanceBooking'] = 'advanceBooking';
      expressionAttributeValues[':advanceBooking'] = advanceBookingEnum;
      updatedFields.push('advanceBooking');
    }

    // maxBookingDuration
    if (updates.maxBookingDuration !== undefined) {
      const maxBookingDurationEnum = await fetchEnumTranslation('MAX_BOOKING_DURATION', updates.maxBookingDuration);
      if (!maxBookingDurationEnum) {
        return response.badRequest(`Invalid max booking duration option: ${updates.maxBookingDuration}`, 'VALIDATION_ERROR');
      }
      updateExpressionParts.push('#maxBookingDuration = :maxBookingDuration');
      expressionAttributeNames['#maxBookingDuration'] = 'maxBookingDuration';
      expressionAttributeValues[':maxBookingDuration'] = maxBookingDurationEnum;
      updatedFields.push('maxBookingDuration');
    }

    // minBookingNights
    if (updates.minBookingNights !== undefined) {
      if (!Number.isInteger(updates.minBookingNights) || updates.minBookingNights < 1 || updates.minBookingNights > 6) {
        return response.badRequest('minBookingNights must be an integer between 1 and 6', 'VALIDATION_ERROR');
      }
      updateExpressionParts.push('#minBookingNights = :minBookingNights');
      expressionAttributeNames['#minBookingNights'] = 'minBookingNights';
      expressionAttributeValues[':minBookingNights'] = updates.minBookingNights;
      updatedFields.push('minBookingNights');
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

    // 9. Check if listing is ONLINE to determine if we need transactional update
    const isOnline = listing.status === 'ONLINE';

    if (isOnline) {
      // ONLINE listing: Use transaction to update both main table and PublicListings atomically
      console.log('🔄 Listing is ONLINE, using transactional update for both tables...');
      
      await updateListingWithTransaction(
        hostId,
        listingId,
        updateExpressionParts,
        expressionAttributeNames,
        expressionAttributeValues,
        updates.amenities,
        now
      );

      console.log(`✅ Updated listing metadata (transactional): ${updatedFields.join(', ')}`);
      if (updates.amenities !== undefined) {
        updatedFields.push('amenities');
        console.log(`✅ Updated amenities (transactional): ${updates.amenities.length} amenities`);
      }
    } else {
      // NOT ONLINE: Regular update to main table only
      console.log('📝 Listing is not ONLINE, updating main table only...');

      // 9a. Update listing metadata (if any metadata fields were provided)
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

      // 9b. Update amenities (if provided) - full replacement
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
    }

    // 12. Return success response
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
    // Validate coordinates if provided
    if (updates.address.coordinates) {
      if (typeof updates.address.coordinates.latitude !== 'number' || 
          typeof updates.address.coordinates.longitude !== 'number') {
        return 'coordinates must include valid latitude and longitude numbers';
      }
      if (updates.address.coordinates.latitude < -90 || updates.address.coordinates.latitude > 90) {
        return 'latitude must be between -90 and 90';
      }
      if (updates.address.coordinates.longitude < -180 || updates.address.coordinates.longitude > 180) {
        return 'longitude must be between -180 and 180';
      }
    }
    // Validate Google Maps link if provided
    if (updates.address.googleMapsLink !== undefined) {
      if (updates.address.googleMapsLink && !validateGoogleMapsLink(updates.address.googleMapsLink)) {
        return 'Google Maps link must be a valid HTTPS URL from maps.google.com or google.com/maps';
      }
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
    if (typeof updates.capacity.singleBeds !== 'number' || 
        typeof updates.capacity.doubleBeds !== 'number' || 
        updates.capacity.bedrooms === undefined || 
        !updates.capacity.bathrooms || 
        !updates.capacity.sleeps) {
      return 'When updating capacity, singleBeds, doubleBeds, bedrooms, bathrooms, and sleeps are required';
    }
    if (updates.capacity.singleBeds < 0 || updates.capacity.singleBeds > 50) {
      return 'Single beds must be between 0 and 50';
    }
    if (updates.capacity.doubleBeds < 0 || updates.capacity.doubleBeds > 50) {
      return 'Double beds must be between 0 and 50';
    }
    if ((updates.capacity.singleBeds + updates.capacity.doubleBeds) < 1) {
      return 'Total beds (singleBeds + doubleBeds) must be at least 1';
    }
    if (updates.capacity.bedrooms < 0 || updates.capacity.bedrooms > 20) {
      return 'Bedrooms must be between 0 and 20';
    }
    if (updates.capacity.bathrooms < 1 || updates.capacity.bathrooms > 20) {
      return 'Bathrooms must be between 1 and 20';
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

  // advanceBooking
  if (updates.advanceBooking !== undefined) {
    if (!VALID_ADVANCE_BOOKING.includes(updates.advanceBooking)) {
      return `Invalid advance booking option: ${updates.advanceBooking}`;
    }
  }

  // maxBookingDuration
  if (updates.maxBookingDuration !== undefined) {
    if (!VALID_MAX_BOOKING_DURATION.includes(updates.maxBookingDuration)) {
      return `Invalid max booking duration option: ${updates.maxBookingDuration}`;
    }
  }

  // minBookingNights
  if (updates.minBookingNights !== undefined) {
    if (!Number.isInteger(updates.minBookingNights) || updates.minBookingNights < 1 || updates.minBookingNights > 6) {
      return 'minBookingNights must be an integer between 1 and 6';
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
): Promise<BilingualEnum & { isEntirePlace?: boolean; days?: number; nights?: number } | null> {
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
      ...(result.Item.metadata?.days !== undefined && {
        days: result.Item.metadata.days,
      }),
      ...(result.Item.metadata?.nights !== undefined && {
        nights: result.Item.metadata.nights,
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
): Promise<Array<BilingualEnum & { category: AmenityCategory; isFilter: boolean }>> {
  const amenities: Array<BilingualEnum & { category: AmenityCategory; isFilter: boolean }> = [];

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
        isFilter: result.Item.isFilter ?? false,
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
  };

  // Only include coordinates if provided
  if (address.coordinates && 
      typeof address.coordinates.latitude === 'number' && 
      typeof address.coordinates.longitude === 'number') {
    normalized.coordinates = {
      latitude: address.coordinates.latitude,
      longitude: address.coordinates.longitude,
    };
  }

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
  if (address.googleMapsLink !== undefined) {
    normalized.googleMapsLink = address.googleMapsLink ? address.googleMapsLink.trim() : address.googleMapsLink;
  }

  return normalized;
}

/**
 * Update listing with transaction (for ONLINE listings)
 * Updates both main table and PublicListings table atomically
 */
async function updateListingWithTransaction(
  hostId: string,
  listingId: string,
  updateExpressionParts: string[],
  expressionAttributeNames: Record<string, string>,
  expressionAttributeValues: Record<string, any>,
  amenityKeys: string[] | undefined,
  now: string
): Promise<void> {
  // Step 1: Fetch current listing data (before update) to get location info
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
    throw new Error('Listing not found');
  }

  const currentListing = listingResult.Item;

  // Step 2: Fetch host profile to get verification status
  const hostProfileResult = await docClient.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: {
        pk: `HOST#${hostId}`,
        sk: 'META',
      },
    })
  );

  if (!hostProfileResult.Item) {
    throw new Error('Host profile not found');
  }

  const hostVerified = hostProfileResult.Item.status === 'VERIFIED';

  // Step 3: Fetch current amenities (will be replaced if amenityKeys is provided)
  const amenitiesResult = await docClient.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: {
        pk: `HOST#${hostId}`,
        sk: `LISTING_AMENITIES#${listingId}`,
      },
    })
  );

  let amenities = amenitiesResult.Item?.amenities || [];
  
  // If amenities are being updated, fetch translations
  if (amenityKeys !== undefined) {
    amenities = await fetchAmenityTranslations(amenityKeys);
  }

  // Step 4: Fetch images to get primary thumbnail
  const imagesResult = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :sk)',
      FilterExpression: '#status = :ready AND isDeleted = :notDeleted',
      ExpressionAttributeNames: {
        '#status': 'status',
      },
      ExpressionAttributeValues: {
        ':pk': `LISTING#${listingId}`,
        ':sk': 'IMAGE#',
        ':ready': 'READY',
        ':notDeleted': false,
      },
    })
  );

  const images = imagesResult.Items || [];
  const primaryImage = images.find((img: any) => img.isPrimary);

  if (!primaryImage || !primaryImage.webpUrls?.thumbnail) {
    throw new Error('No primary image with thumbnail found');
  }

  // Step 5: Build the updated listing object by merging current data with updates
  // We need to simulate what the listing will look like after the update
  const updatedListing = { ...currentListing };
  
  // Apply updates from expressionAttributeValues
  for (const [placeholder, value] of Object.entries(expressionAttributeValues)) {
    const fieldName = Object.entries(expressionAttributeNames).find(
      ([, attrValue]) => placeholder === `:${attrValue.replace('#', '')}`
    )?.[1]?.replace('#', '');
    
    if (fieldName && fieldName !== 'updatedAt') {
      updatedListing[fieldName] = value;
    }
  }

  // Step 6: Extract location data
  const placeId = updatedListing.mapboxMetadata?.place?.mapbox_id;
  const placeName = updatedListing.mapboxMetadata?.place?.name;
  const regionName = updatedListing.mapboxMetadata?.region?.name;

  if (!placeId || !placeName || !regionName) {
    throw new Error('Missing required location metadata');
  }

  // Check if locality exists
  const hasLocality = updatedListing.mapboxMetadata?.locality?.mapbox_id && updatedListing.mapboxMetadata?.locality?.name;
  const localityId = hasLocality ? updatedListing.mapboxMetadata.locality.mapbox_id : null;
  const localityName = hasLocality ? updatedListing.mapboxMetadata.locality.name : null;

  // Step 7: Derive boolean filters from amenities
  const amenityKeyList = amenities.map((a: any) => a.key);
  const filters = {
    petsAllowed: updatedListing.pets?.allowed || false,
    hasWIFI: amenityKeyList.includes('WIFI'),
    hasAirConditioning: amenityKeyList.includes('AIR_CONDITIONING'),
    hasParking: amenityKeyList.includes('PARKING'),
    hasGym: amenityKeyList.includes('GYM'),
    hasPool: amenityKeyList.includes('POOL'),
    hasWorkspace: amenityKeyList.includes('WORKSPACE'),
  };

  // Step 8: Generate short description
  const shortDescription =
    updatedListing.description.length > 100
      ? updatedListing.description.substring(0, 100).trim() + '...'
      : updatedListing.description;

  // Step 9: Build base PublicListing data (shared by PLACE and LOCALITY)
  const basePublicListing = {
    listingId: listingId,
    hostId: hostId,

    name: updatedListing.listingName,
    shortDescription: shortDescription,
    placeName: placeName,
    regionName: regionName,

    maxGuests: updatedListing.capacity.sleeps,
    bedrooms: updatedListing.capacity.bedrooms,
    singleBeds: updatedListing.capacity.singleBeds,
    doubleBeds: updatedListing.capacity.doubleBeds,
    bathrooms: updatedListing.capacity.bathrooms,

    thumbnailUrl: buildCloudFrontUrl(primaryImage.webpUrls.thumbnail, primaryImage.updatedAt),

    latitude: updatedListing.address.coordinates!.latitude,
    longitude: updatedListing.address.coordinates!.longitude,

    petsAllowed: filters.petsAllowed,
    hasWIFI: filters.hasWIFI,
    hasAirConditioning: filters.hasAirConditioning,
    hasParking: filters.hasParking,
    hasGym: filters.hasGym,
    hasPool: filters.hasPool,
    hasWorkspace: filters.hasWorkspace,

    parkingType: updatedListing.parking.type.key,
    checkInType: updatedListing.checkIn.type.key,
    propertyType: updatedListing.propertyType.key,

    advanceBookingDays: updatedListing.advanceBooking.days, // Store numerical value for filtering
    maxBookingNights: updatedListing.maxBookingDuration.nights, // Store numerical value for filtering
    minBookingNights: updatedListing.minBookingNights || 1, // Store numerical value for filtering (default 1)

    instantBook: false, // Default to false
    hostVerified: hostVerified, // Sync from host profile
    listingVerified: updatedListing.listingVerified || false, // Sync from listing metadata

    // Preserve original createdAt, update updatedAt
    createdAt: currentListing.createdAt,
    updatedAt: now,
  };

  // Create PLACE listing record (always)
  const placePublicListing = {
    ...basePublicListing,
    pk: `LOCATION#${placeId}`,
    sk: `LISTING#${listingId}`,
    locationId: placeId,
    locationType: 'PLACE' as const,
  };

  // Step 10: Build transaction items
  const transactItems: any[] = [];

  // 10a. Update listing metadata (if any fields besides updatedAt)
  if (updateExpressionParts.length > 1) {
    transactItems.push({
      Update: {
        TableName: TABLE_NAME,
        Key: {
          pk: `HOST#${hostId}`,
          sk: `LISTING_META#${listingId}`,
        },
        UpdateExpression: `SET ${updateExpressionParts.join(', ')}`,
        ExpressionAttributeNames: expressionAttributeNames,
        ExpressionAttributeValues: expressionAttributeValues,
      },
    });
  }

  // 10b. Update amenities (if provided)
  if (amenityKeys !== undefined) {
    transactItems.push({
      Put: {
        TableName: TABLE_NAME,
        Item: {
          pk: `HOST#${hostId}`,
          sk: `LISTING_AMENITIES#${listingId}`,
          listingId,
          amenities: amenities,
          updatedAt: now,
          isDeleted: false,
        },
      },
    });
  }

  // 10c. Update PublicListing record(s)
  // Always update PLACE record
  transactItems.push({
    Put: {
      TableName: PUBLIC_LISTINGS_TABLE_NAME,
      Item: placePublicListing,
    },
  });

  // Update LOCALITY record (if exists)
  if (hasLocality && localityId && localityName) {
    const localityPublicListing = {
      ...basePublicListing,
      pk: `LOCATION#${localityId}`,
      sk: `LISTING#${listingId}`,
      locationId: localityId,
      locationType: 'LOCALITY' as const,
      localityName: localityName,
    };

    transactItems.push({
      Put: {
        TableName: PUBLIC_LISTINGS_TABLE_NAME,
        Item: localityPublicListing,
      },
    });
  }

  // Step 10: Execute transaction (all succeed or all fail)
  console.log(`Executing transaction with ${transactItems.length} items (main table + PublicListings)`);
  
  await docClient.send(
    new TransactWriteCommand({
      TransactItems: transactItems,
    })
  );

  console.log('✅ Transaction complete: Both tables updated atomically');
}


