import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, QueryCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'crypto';
import { getAuthContext, assertCanAccessHost } from '../lib/auth';
import * as response from '../lib/response';
import { generateUploadUrl } from '../lib/s3-presigned';
import { checkAndIncrementWriteOperationRateLimit, extractUserId } from '../lib/write-operation-rate-limiter';
import {
  SubmitListingIntentRequest,
  SubmitListingIntentResponse,
  BilingualEnum,
  AmenityCategory,
} from '../../types/listing.types';

const client = new DynamoDBClient({ region: process.env.AWS_REGION });
const docClient = DynamoDBDocumentClient.from(client);
const TABLE_NAME = process.env.TABLE_NAME!;
// BUCKET_NAME is used in generateUploadUrl from lib/s3-presigned
// const BUCKET_NAME = process.env.BUCKET_NAME!;

// Constants
const SUBMISSION_TOKEN_EXPIRY_MINUTES = 30;
const MAX_IMAGES = 15;
const MIN_IMAGES = 1;
const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10MB per image
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
const MAX_DOCUMENT_SIZE = 50 * 1024 * 1024; // 50MB per document
const ALLOWED_DOCUMENT_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'application/pdf'];

/**
 * POST /api/v1/hosts/{hostId}/listings/submit-intent
 * 
 * Step 1 of listing submission: Create listing metadata and get pre-signed URLs
 * 
 * This endpoint:
 * 1. Validates all required fields
 * 2. Checks subscription limits (current listings < maxListings)
 * 3. Fetches bilingual translations for enums
 * 4. Creates listing metadata record (status: DRAFT)
 * 5. Creates amenities record
 * 6. Creates placeholder image records (status: PENDING_UPLOAD)
 * 7. Creates placeholder document records (status: PENDING_UPLOAD)
 * 8. Generates pre-signed S3 URLs for uploads
 * 9. Returns submission token + URLs
 */
export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  console.log('Submit listing intent request:', {
    requestId: event.requestContext.requestId,
    hostId: event.pathParameters?.hostId,
  });

  try {
    // 1. Authentication & Authorization
    const auth = getAuthContext(event);
    const hostId = event.pathParameters?.hostId;

    if (!hostId) {
      return response.badRequest('hostId is required in path');
    }

    assertCanAccessHost(auth, hostId);

    // 2. Check rate limit
    const userId = extractUserId(event);
    if (!userId) {
      return response.unauthorized('User ID not found');
    }

    const rateLimitCheck = await checkAndIncrementWriteOperationRateLimit(userId, 'listing-submit-intent');
    if (!rateLimitCheck.allowed) {
      console.warn('Rate limit exceeded for listing submit-intent:', { userId, hostId });
      return response.tooManyRequests(rateLimitCheck.message || 'Rate limit exceeded');
    }

    console.log('Rate limit check passed:', {
      userId,
      hostId,
      hourlyRemaining: rateLimitCheck.hourlyRemaining,
      dailyRemaining: rateLimitCheck.dailyRemaining,
    });

    // 3. Parse and validate request body
    const body: SubmitListingIntentRequest = JSON.parse(event.body || '{}');
    const validationError = validateSubmitIntentRequest(body);
    if (validationError) {
      return response.badRequest(validationError);
    }

    // 4. Check subscription limits
    const canCreateListing = await checkSubscriptionLimit(hostId);
    if (!canCreateListing) {
      return response.forbidden('Listing limit reached for your subscription plan. Please upgrade to add more listings.');
    }

    // 5. Fetch bilingual translations for enums
    const [
      propertyTypeEnum,
      checkInTypeEnum,
      parkingTypeEnum,
      paymentTypeEnum,
      advanceBookingEnum,
      maxBookingDurationEnum,
      cancellationPolicyEnum,
      amenityEnums,
    ] = await Promise.all([
      fetchEnumTranslation('PROPERTY_TYPE', body.propertyType),
      fetchEnumTranslation('CHECKIN_TYPE', body.checkIn.type),
      fetchEnumTranslation('PARKING_TYPE', body.parking.type),
      fetchEnumTranslation('PAYMENT_TYPE', body.paymentType),
      fetchEnumTranslation('ADVANCE_BOOKING', body.advanceBooking),
      fetchEnumTranslation('MAX_BOOKING_DURATION', body.maxBookingDuration),
      fetchEnumTranslation('CANCELLATION_POLICY', body.cancellationPolicy.type),
      fetchAmenityTranslations(body.amenities),
    ]);

    if (!propertyTypeEnum || !checkInTypeEnum || !parkingTypeEnum || !paymentTypeEnum || !advanceBookingEnum || !maxBookingDurationEnum || !cancellationPolicyEnum) {
      return response.badRequest('Invalid enum values provided');
    }

    // 6. Generate IDs and timestamps
    const listingId = `listing_${randomUUID()}`;
    const now = new Date().toISOString();
    const s3Prefix = `${hostId}/listings/${listingId}/`;

    // 7. Generate submission token (simple UUID-based token, like profile submission)
    const tokenExpiresAt = new Date(Date.now() + SUBMISSION_TOKEN_EXPIRY_MINUTES * 60 * 1000);
    const submissionToken = `lst_sub_${randomUUID()}`;

    // 8. Normalize address data
    const normalizedAddress = normalizeAddress(body.address);

    // 9. Create listing metadata record
    await docClient.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: {
          pk: `HOST#${hostId}`,
          sk: `LISTING_META#${listingId}`,
          
          listingId,
          hostId,
          
          listingName: body.listingName,
          propertyType: propertyTypeEnum,
          status: 'DRAFT',
          description: body.description,
          
          address: normalizedAddress,
          ...(body.mapboxMetadata && { mapboxMetadata: body.mapboxMetadata }),
          capacity: body.capacity,
          ...(body.pricing && { pricing: body.pricing }),
          hasPricing: false,           // Will be set to true when detailed pricing is configured
          pets: body.pets,
          checkIn: {
            type: checkInTypeEnum,
            ...(body.checkIn.description && { description: body.checkIn.description }),
            checkInFrom: body.checkIn.checkInFrom,
            checkOutBy: body.checkIn.checkOutBy,
          },
          parking: {
            type: parkingTypeEnum,
            ...(body.parking.description && { description: body.parking.description }),
          },
          paymentType: paymentTypeEnum,
          smokingAllowed: body.smokingAllowed,
          advanceBooking: advanceBookingEnum,
          maxBookingDuration: maxBookingDurationEnum,
          minBookingNights: body.minBookingNights ?? 1, // Default to 1 if not provided
          cancellationPolicy: {
            type: cancellationPolicyEnum,
            ...(body.cancellationPolicy.customText && { customText: body.cancellationPolicy.customText }),
          },
          
          s3Prefix,
          
          // Optional document reference number and star rating (only include if provided)
          ...(body.rightToListDocumentNumber?.trim() && { rightToListDocumentNumber: body.rightToListDocumentNumber.trim() }),
          ...(body.officialStarRating && { officialStarRating: body.officialStarRating }),
          
          submissionToken,
          submissionTokenExpiresAt: tokenExpiresAt.toISOString(),
          
          isDeleted: false,
          createdAt: now,
          updatedAt: now,
          
          // GSI2: Query by status
          gsi2pk: 'LISTING_STATUS#DRAFT',
          gsi2sk: now,
          
          // GSI3: Direct lookup by listingId
          gsi3pk: `LISTING#${listingId}`,
          gsi3sk: `LISTING_META#${listingId}`,
        },
      })
    );

    console.log(`✅ Created listing metadata: ${listingId}`);

    // 10. Create amenities record
    if (body.amenities && body.amenities.length > 0) {
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

      console.log(`✅ Created amenities record: ${body.amenities.length} amenities`);
    }

    // 11. Create placeholder image records and generate pre-signed URLs
    // Images are uploaded to BUCKET ROOT with lstimg_ prefix for GuardDuty scanning
    // After passing scan, they are processed and moved to final destination by the image-processor Lambda
    const imageUploadUrls: SubmitListingIntentResponse['imageUploadUrls'] = [];
    
    for (const img of body.images) {
      const s3Key = `lstimg_${img.imageId}.${getFileExtension(img.contentType)}`;
      
      // Create placeholder image record (status: PENDING_UPLOAD)
        await docClient.send(
          new PutCommand({
            TableName: TABLE_NAME,
            Item: {
              pk: `LISTING#${listingId}`,
              sk: `IMAGE#${img.imageId}`,
              
              listingId,
              imageId: img.imageId,
            hostId,
            
            s3Key, // Root location with prefix: lstimg_{imageId}.jpg
            finalS3Prefix: `${s3Prefix}images/`, // Final destination after processing
            
            displayOrder: img.displayOrder,
            isPrimary: img.isPrimary,
            caption: img.caption,
            
            contentType: img.contentType,
            fileSize: 0, // Will be updated after upload
            
            status: 'PENDING_UPLOAD',
            
            uploadedAt: now,
            updatedAt: now, // For CloudFront cache versioning
            isDeleted: false,
          },
        })
      );

      // Generate pre-signed URL with metadata for Lambda processing
      // S3 will enforce the exact file size - upload will fail if size doesn't match
      const uploadUrl = await generateUploadUrl(
        s3Key, 
        img.contentType, 
        600, 
        {
          hostId,
          listingId,
          imageId: img.imageId,
        },
        img.fileSize,      // Exact size required by S3
        MAX_IMAGE_SIZE     // Maximum allowed size
      );
      
      imageUploadUrls.push({
        imageId: img.imageId,
        uploadUrl,
        expiresAt: tokenExpiresAt.toISOString(),
      });
    }

    console.log(`✅ Created ${body.images.length} image placeholder records`);

    // 12. Create placeholder document records and generate pre-signed URLs (if provided)
    const documentUploadUrls: SubmitListingIntentResponse['documentUploadUrls'] = [];
    
    if (body.verificationDocuments && body.verificationDocuments.length > 0) {
      for (const doc of body.verificationDocuments) {
        const s3Key = `veri_listing-doc_${listingId}_${doc.documentType}.${getFileExtension(doc.contentType)}`;
        
        // Create placeholder document record
        await docClient.send(
          new PutCommand({
            TableName: TABLE_NAME,
            Item: {
              pk: `HOST#${hostId}`,
              sk: `LISTING_DOC#${listingId}#${doc.documentType}`,
              
              listingId,
              hostId,
              documentType: doc.documentType,
              
              s3Key, // Root location with prefix: veri_listing-doc_{listingId}_{docType}.ext
              finalS3Key: `${s3Prefix}verification/${doc.documentType}.${getFileExtension(doc.contentType)}`, // Final destination
              
              contentType: doc.contentType,
              fileSize: 0, // Will be updated after upload
              
              status: 'PENDING_UPLOAD',
              
              uploadedAt: now,
              isDeleted: false,
            },
          })
        );

        // Generate pre-signed URL with metadata for Lambda processing
        // S3 will enforce the exact file size - upload will fail if size doesn't match
        const uploadUrl = await generateUploadUrl(
          s3Key, 
          doc.contentType, 
          600, 
          {
            hostId,
            listingId,
            documentType: doc.documentType,
          },
          doc.fileSize,      // Exact size required by S3
          MAX_DOCUMENT_SIZE  // Maximum allowed size
        );
        
        documentUploadUrls.push({
          documentType: doc.documentType,
          uploadUrl,
          expiresAt: tokenExpiresAt.toISOString(),
        });
      }

      console.log(`✅ Created ${body.verificationDocuments.length} document placeholder records`);
    }

    // 13. Create submission tracking record
    await docClient.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: {
          pk: `LISTING_SUBMISSION#${submissionToken}`,
          sk: 'META',
          submissionToken,
          listingId,
          hostId,
          expiresAt: tokenExpiresAt.toISOString(),
          createdAt: now,
          ttl: Math.floor(tokenExpiresAt.getTime() / 1000), // DynamoDB TTL (Unix timestamp)
        },
      })
    );

    console.log(`✅ Created submission tracking record: ${submissionToken}`);

    // 14. Build response
    const intentResponse: SubmitListingIntentResponse = {
      listingId,
      submissionToken,
      expiresAt: tokenExpiresAt.toISOString(),
      imageUploadUrls,
      documentUploadUrls: documentUploadUrls.length > 0 ? documentUploadUrls : undefined,
    };

    console.log('Submit intent successful:', {
      listingId,
      imagesCount: imageUploadUrls.length,
      documentsCount: documentUploadUrls.length,
    });

    return response.success(intentResponse);

  } catch (error: any) {
    console.error('Submit intent error:', error);
    return response.handleError(error);
  }
}

/**
 * Validate submit intent request
 */
function validateSubmitIntentRequest(body: SubmitListingIntentRequest): string | null {
  // Required fields
  if (!body.listingName || body.listingName.trim().length < 5) {
    return 'listingName is required (min 5 characters)';
  }
  if (!body.propertyType) {
    return 'propertyType is required';
  }
  if (!body.description || body.description.trim().length < 50) {
    return 'description is required (min 50 characters)';
  }
  if (!body.address) {
    return 'address is required';
  }
  if (!body.address.street || !body.address.city || !body.address.country || !body.address.countryCode) {
    return 'address must include street, city, country, and countryCode';
  }
  // Validate coordinates if provided
  if (body.address.coordinates) {
    if (typeof body.address.coordinates.latitude !== 'number' || 
        typeof body.address.coordinates.longitude !== 'number') {
      return 'coordinates must include valid latitude and longitude numbers';
    }
    if (body.address.coordinates.latitude < -90 || body.address.coordinates.latitude > 90) {
      return 'latitude must be between -90 and 90';
    }
    if (body.address.coordinates.longitude < -180 || body.address.coordinates.longitude > 180) {
      return 'longitude must be between -180 and 180';
    }
  }
  if (!body.capacity || body.capacity.beds < 1 || body.capacity.bedrooms < 0 || body.capacity.bathrooms < 1 || body.capacity.sleeps < 1) {
    return 'capacity (beds, bedrooms, bathrooms, and sleeps) is required. beds, bathrooms, and sleeps must be > 0, bedrooms must be >= 0';
  }
  if (!body.checkIn || !body.checkIn.type || !body.checkIn.checkInFrom || !body.checkIn.checkOutBy) {
    return 'checkIn details (type, checkInFrom, checkOutBy) are required';
  }
  if (!body.parking || !body.parking.type) {
    return 'parking.type is required';
  }
  if (!body.paymentType) {
    return 'paymentType is required';
  }
  if (!body.advanceBooking) {
    return 'advanceBooking is required';
  }
  if (!body.maxBookingDuration) {
    return 'maxBookingDuration is required';
  }
  
  // Validate minBookingNights if provided
  if (body.minBookingNights !== undefined) {
    if (!Number.isInteger(body.minBookingNights) || body.minBookingNights < 1 || body.minBookingNights > 6) {
      return 'minBookingNights must be an integer between 1 and 6';
    }
  }

  // Optional: rightToListDocumentNumber validation
  if (body.rightToListDocumentNumber) {
    const trimmed = body.rightToListDocumentNumber.trim();
    if (trimmed.length === 0 || trimmed.length > 30) {
      return 'rightToListDocumentNumber must be between 1 and 30 characters';
    }
  }

  // Optional: officialStarRating validation (only allowed with registration document)
  if (body.officialStarRating !== undefined) {
    if (!body.rightToListDocumentNumber || body.rightToListDocumentNumber.trim().length === 0) {
      return 'officialStarRating requires rightToListDocumentNumber to be provided';
    }
    if (!Number.isInteger(body.officialStarRating) || body.officialStarRating < 1 || body.officialStarRating > 5) {
      return 'officialStarRating must be an integer between 1 and 5';
    }
  }

  // Images validation
  if (!body.images || body.images.length < MIN_IMAGES) {
    return `At least ${MIN_IMAGES} image is required`;
  }
  if (body.images.length > MAX_IMAGES) {
    return `Maximum ${MAX_IMAGES} images allowed`;
  }

  // Check for exactly one primary image
  const primaryImages = body.images.filter((img) => img.isPrimary);
  if (primaryImages.length !== 1) {
    return 'Exactly one image must be marked as primary';
  }

  // Check for unique image IDs
  const imageIds = body.images.map((img) => img.imageId);
  if (new Set(imageIds).size !== imageIds.length) {
    return 'Image IDs must be unique';
  }

  // Validate each image
  for (const img of body.images) {
    // Validate content type
    if (!ALLOWED_IMAGE_TYPES.includes(img.contentType.toLowerCase())) {
      return `Invalid image content type: ${img.contentType}. Allowed types: ${ALLOWED_IMAGE_TYPES.join(', ')}`;
    }

    // Validate file size
    if (!img.fileSize || img.fileSize <= 0) {
      return `Image ${img.imageId}: fileSize is required and must be greater than 0`;
    }

    if (img.fileSize > MAX_IMAGE_SIZE) {
      return `Image ${img.imageId}: file size ${(img.fileSize / 1024 / 1024).toFixed(2)}MB exceeds maximum allowed size of ${MAX_IMAGE_SIZE / 1024 / 1024}MB`;
    }
  }

  // Validate verification documents (optional)
  if (body.verificationDocuments && body.verificationDocuments.length > 0) {
    for (const doc of body.verificationDocuments) {
      // Validate content type
      if (!ALLOWED_DOCUMENT_TYPES.includes(doc.contentType.toLowerCase())) {
        return `Invalid document content type: ${doc.contentType}. Allowed types: ${ALLOWED_DOCUMENT_TYPES.join(', ')}`;
      }

      // Validate file size
      if (!doc.fileSize || doc.fileSize <= 0) {
        return `Document ${doc.documentType}: fileSize is required and must be greater than 0`;
      }

      if (doc.fileSize > MAX_DOCUMENT_SIZE) {
        return `Document ${doc.documentType}: file size ${(doc.fileSize / 1024 / 1024).toFixed(2)}MB exceeds maximum allowed size of ${MAX_DOCUMENT_SIZE / 1024 / 1024}MB`;
      }
    }
  }

  // Optional: mapboxMetadata validation
  if (body.mapboxMetadata) {
    if (body.mapboxMetadata.country) {
      if (!body.mapboxMetadata.country.mapbox_id || !body.mapboxMetadata.country.name) {
        return 'mapboxMetadata.country must include both mapbox_id and name';
      }
      if (typeof body.mapboxMetadata.country.mapbox_id !== 'string' || 
          typeof body.mapboxMetadata.country.name !== 'string') {
        return 'mapboxMetadata.country.mapbox_id and name must be strings';
      }
    }
    if (body.mapboxMetadata.region) {
      if (!body.mapboxMetadata.region.mapbox_id || !body.mapboxMetadata.region.name) {
        return 'mapboxMetadata.region must include both mapbox_id and name';
      }
      if (typeof body.mapboxMetadata.region.mapbox_id !== 'string' || 
          typeof body.mapboxMetadata.region.name !== 'string') {
        return 'mapboxMetadata.region.mapbox_id and name must be strings';
      }
    }
    if (body.mapboxMetadata.place) {
      if (!body.mapboxMetadata.place.mapbox_id || !body.mapboxMetadata.place.name) {
        return 'mapboxMetadata.place must include both mapbox_id and name';
      }
      if (typeof body.mapboxMetadata.place.mapbox_id !== 'string' || 
          typeof body.mapboxMetadata.place.name !== 'string') {
        return 'mapboxMetadata.place.mapbox_id and name must be strings';
      }
    }
  }

  return null;
}

/**
 * Check if host can create more listings based on subscription
 */
async function checkSubscriptionLimit(hostId: string): Promise<boolean> {
  // Fetch host subscription
  const subResult = await docClient.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: {
        pk: `HOST#${hostId}`,
        sk: 'SUBSCRIPTION',
      },
    })
  );

  if (!subResult.Item) {
    console.error('No subscription found for host:', hostId);
    return false;
  }

  const maxListings = subResult.Item.maxListings || 0;

  // Count current active listings (not deleted, not archived)
  const listingsResult = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :sk)',
      FilterExpression: 'isDeleted = :notDeleted AND #status <> :archived',
      ExpressionAttributeNames: {
        '#status': 'status',
      },
      ExpressionAttributeValues: {
        ':pk': `HOST#${hostId}`,
        ':sk': 'LISTING_META#',
        ':notDeleted': false,
        ':archived': 'ARCHIVED',
      },
    })
  );

  const currentListings = listingsResult.Items?.length || 0;

  console.log('Subscription check:', {
    hostId,
    maxListings,
    currentListings,
    canCreate: currentListings < maxListings,
  });

  return currentListings < maxListings;
}

/**
 * Fetch enum translation from database
 */
async function fetchEnumTranslation(
  enumType: string,
  enumValue: string
): Promise<BilingualEnum & { isEntirePlace?: boolean; days?: number; nights?: number } | null> {
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
}

/**
 * Fetch amenity translations with categories
 */
async function fetchAmenityTranslations(
  amenityKeys: string[] | undefined
): Promise<Array<BilingualEnum & { category: AmenityCategory; isFilter: boolean }>> {
  const amenities: Array<BilingualEnum & { category: AmenityCategory; isFilter: boolean }> = [];

  // Handle case where amenities are not provided
  if (!amenityKeys || amenityKeys.length === 0) {
    return amenities;
  }

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
 * Get file extension from content type
 */
function getFileExtension(contentType: string): string {
  const map: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'application/pdf': 'pdf',
    'video/mp4': 'mp4',
  };

  return map[contentType.toLowerCase()] || 'bin';
}

/**
 * Normalize address data from frontend to match our schema
 * Constructs fullAddress from provided fields if not already present
 * Removes undefined values to avoid DynamoDB errors
 */
function normalizeAddress(address: any): any {
  // Construct full address string if not provided
  const addressParts = [
    address.streetNumber,
    address.street,
    address.apartmentNumber,
    address.city,
    address.state,
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

  // Only include optional fields if they have values
  if (address.apartmentNumber) {
    normalized.apartmentNumber = address.apartmentNumber;
  }
  if (address.municipality) {
    normalized.municipality = address.municipality;
  }
  if (address.state) {
    normalized.state = address.state;
  }
  if (address.mapboxPlaceId) {
    normalized.mapboxPlaceId = address.mapboxPlaceId;
  }

  return normalized;
}

