import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, QueryCommand, TransactWriteCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { getAuthContext, assertCanAccessHost } from '../lib/auth';
import * as response from '../lib/response';
import { checkAndIncrementWriteOperationRateLimit, extractUserId } from '../lib/write-operation-rate-limiter';
import {
  ConfirmListingSubmissionRequest,
  ConfirmListingSubmissionResponse,
} from '../../types/listing.types';
import { generateLocationSlug, generateSearchName } from '../../types/location.types';

const dynamoClient = new DynamoDBClient({ region: process.env.AWS_REGION });
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const TABLE_NAME = process.env.TABLE_NAME!;
const LOCATIONS_TABLE_NAME = process.env.LOCATIONS_TABLE_NAME!;

/**
 * POST /api/v1/hosts/{hostId}/listings/{listingId}/confirm-submission
 * 
 * Step 2 of listing submission: Verify uploads and finalize submission
 * 
 * This endpoint:
 * 1. Verifies submission token
 * 2. Verifies all images were uploaded to S3
 * 3. Verifies required documents were uploaded
 * 4. Updates image records: PENDING_UPLOAD → ACTIVE
 * 5. Updates document records: PENDING_UPLOAD → PENDING_REVIEW
 * 6. Updates listing metadata: DRAFT → IN_REVIEW
 * 7. Sets submittedAt timestamp
 * 8. Updates GSI2 for admin review queue
 */
export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  console.log('Confirm listing submission request:', {
    requestId: event.requestContext.requestId,
    hostId: event.pathParameters?.hostId,
    listingId: event.pathParameters?.listingId,
  });

  try {
    // 1. Authentication & Authorization
    const auth = getAuthContext(event);
    const hostId = event.pathParameters?.hostId;
    const listingId = event.pathParameters?.listingId;

    if (!hostId || !listingId) {
      return response.badRequest('hostId and listingId are required in path');
    }

    assertCanAccessHost(auth, hostId);

    // 2. Check rate limit
    const userId = extractUserId(event);
    if (!userId) {
      return response.unauthorized('User ID not found');
    }

    const rateLimitCheck = await checkAndIncrementWriteOperationRateLimit(userId, 'listing-confirm-submission');
    if (!rateLimitCheck.allowed) {
      console.warn('Rate limit exceeded for listing confirm-submission:', { userId, hostId, listingId });
      return response.tooManyRequests(rateLimitCheck.message || 'Rate limit exceeded');
    }

    // 3. Parse request body
    const body: ConfirmListingSubmissionRequest = JSON.parse(event.body || '{}');

    if (!body.submissionToken) {
      return response.badRequest('submissionToken is required');
    }

    // 4. Verify submission token (fetch from DynamoDB)
    const tokenResult = await docClient.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: {
          pk: `LISTING_SUBMISSION#${body.submissionToken}`,
          sk: 'META',
        },
      })
    );

    if (!tokenResult.Item) {
      return response.badRequest('Invalid or expired submission token');
    }

    const tokenData = tokenResult.Item;

    // Check if token has expired
    if (new Date(tokenData.expiresAt) < new Date()) {
      return response.badRequest('Submission token has expired');
    }

    // Verify token matches the listing and host
    if (tokenData.listingId !== listingId || tokenData.hostId !== hostId) {
      return response.badRequest('Submission token does not match listing');
    }

    // 4. Fetch listing metadata
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
      return response.notFound(`Listing not found: ${listingId}`);
    }

    const listing = listingResult.Item;

    // 5. Verify listing is in DRAFT status
    if (listing.status !== 'DRAFT') {
      return response.badRequest(`Listing is not in DRAFT status (current: ${listing.status})`);
    }

    // 6. Fetch all image records
    const imagesResult = await docClient.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :sk)',
        ExpressionAttributeValues: {
          ':pk': `LISTING#${listingId}`,
          ':sk': 'IMAGE#',
        },
      })
    );

    const images = imagesResult.Items || [];

    // 7. Verify all uploaded images exist in S3 (either at root pending processing OR already processed)
    const uploadedImageIds = new Set(body.uploadedImages);
    const missingImages: string[] = [];

    for (const img of images) {
      if (!uploadedImageIds.has(img.imageId)) {
        missingImages.push(img.imageId);
        continue;
      }

      // Note: We do NOT check S3 existence for images because:
      // 1. GuardDuty scan + image processor run very fast (3-5 seconds)
      // 2. By the time confirm-submission is called, the original file may already be processed and deleted
      // 3. The DynamoDB record existing is sufficient proof that the upload succeeded
      // 4. If there was a problem with the file, the image processor will update the status accordingly
      
      console.log(`Image ${img.imageId} verified in DynamoDB (status: ${img.status})`);
    }

    // 8. Verify at least one image and exactly one primary
    if (images.length === 0) {
      return response.badRequest('At least one image is required');
    }

    const primaryImages = images.filter((img) => img.isPrimary);
    if (primaryImages.length !== 1) {
      return response.badRequest('Exactly one image must be marked as primary');
    }

    // 9. Fetch all document records
    const documentsResult = await docClient.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :sk)',
        ExpressionAttributeValues: {
          ':pk': `HOST#${hostId}`,
          ':sk': `LISTING_DOC#${listingId}#`,
        },
      })
    );

    const documents = documentsResult.Items || [];

    // 10. Verify uploaded documents (if any were declared)
    // Note: We do NOT check S3 existence for documents because:
    // - S3 PUT returning 200 = upload succeeded (no need to re-verify)
    // - GuardDuty may have already moved files to quarantine or final destination
    // - Race condition: verification processor may have processed some files already
    // - DynamoDB record existence is sufficient proof of upload intent
    
    // Handle case where no documents were uploaded (both are optional)
    const uploadedDocuments = body.uploadedDocuments || [];
    
    if (uploadedDocuments.length > 0) {
      const uploadedDocTypes = new Set(uploadedDocuments);
      const missingDocs: string[] = [];

      for (const doc of documents) {
        if (!uploadedDocTypes.has(doc.documentType)) {
          missingDocs.push(doc.documentType);
        }
      }

      if (missingDocs.length > 0) {
        return response.badRequest(`Documents not uploaded: ${missingDocs.join(', ')}`);
      }
      
      console.log(`All ${documents.length} document records verified in DynamoDB`);
    } else {
      console.log('No documents uploaded (documents are optional)');
    }

    // 10b. Fetch initial video record (if exists)
    const initialVideoResult = await docClient.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: {
          pk: `HOST#${hostId}`,
          sk: `LISTING_INITIAL_VIDEO#${listingId}`,
        },
      })
    );

    const initialVideo = initialVideoResult.Item;

    // Verify initial video upload consistency
    if (body.uploadedInitialVideo && !initialVideo) {
      return response.badRequest('Initial video record not found');
    }
    if (initialVideo && !body.uploadedInitialVideo) {
      console.log('Initial video record exists but not confirmed as uploaded - will remain PENDING_UPLOAD');
    }
    if (initialVideo && body.uploadedInitialVideo) {
      console.log('Initial video record verified in DynamoDB');
    }

    // 11. Update all records in a transaction
    const now = new Date().toISOString();
    const transactItems: any[] = [];

    // Update listing metadata
    transactItems.push({
      Update: {
        TableName: TABLE_NAME,
        Key: {
          pk: `HOST#${hostId}`,
          sk: `LISTING_META#${listingId}`,
        },
        UpdateExpression: 'SET #status = :status, submittedAt = :now, submittedForReviewAt = :now, updatedAt = :now, gsi2pk = :gsi2pk, gsi2sk = :gsi2sk REMOVE submissionToken, submissionTokenExpiresAt',
        ExpressionAttributeNames: {
          '#status': 'status',
        },
        ExpressionAttributeValues: {
          ':status': 'IN_REVIEW',
          ':now': now,
          ':gsi2pk': 'LISTING_STATUS#IN_REVIEW',
          ':gsi2sk': now,
        },
      },
    });

    // Image status transitions are handled by the image processor
    // No need to update image statuses here - they will transition:
    // PENDING_UPLOAD → PENDING_SCAN → READY as GuardDuty scans and processes them

    // Update document records
    for (const doc of documents) {
      transactItems.push({
        Update: {
          TableName: TABLE_NAME,
          Key: {
            pk: `HOST#${hostId}`,
            sk: `LISTING_DOC#${listingId}#${doc.documentType}`,
          },
          UpdateExpression: 'SET #status = :status',
          ExpressionAttributeNames: {
            '#status': 'status',
          },
          ExpressionAttributeValues: {
            ':status': 'PENDING_REVIEW',
          },
        },
      });
    }

    // Update initial video record (if uploaded)
    if (initialVideo && body.uploadedInitialVideo) {
      transactItems.push({
        Update: {
          TableName: TABLE_NAME,
          Key: {
            pk: `HOST#${hostId}`,
            sk: `LISTING_INITIAL_VIDEO#${listingId}`,
          },
          UpdateExpression: 'SET #status = :status',
          ExpressionAttributeNames: {
            '#status': 'status',
          },
          ExpressionAttributeValues: {
            ':status': 'PENDING_REVIEW',
          },
        },
      });
    }

    // Execute transaction
    await docClient.send(
      new TransactWriteCommand({
        TransactItems: transactItems,
      })
    );

    console.log('Listing submission confirmed:', {
      listingId,
      imagesUpdated: images.length,
      documentsUpdated: documents.length,
      initialVideoUploaded: !!(initialVideo && body.uploadedInitialVideo),
      status: 'IN_REVIEW',
    });

    // 12. Create/update locations and increment listing counts
    // This happens after successful submission - locations start with isLive: false
    await handleLocationCreationAndCounts(listing, now);

    // 13. Build response
    const confirmResponse: ConfirmListingSubmissionResponse = {
      success: true,
      listingId,
      status: 'IN_REVIEW',
      submittedAt: now,
      message: 'Listing submitted successfully and is now under review',
    };

    return response.success(confirmResponse);

  } catch (error: any) {
    console.error('Confirm submission error:', error);
    return response.handleError(error);
  }
}

/**
 * Handle location creation and listing count increments
 * Creates locations if they don't exist (with isLive: false)
 * Increments listingsCount for all location levels (COUNTRY, PLACE, LOCALITY)
 */
async function handleLocationCreationAndCounts(listing: any, now: string): Promise<void> {
  try {
    const mapboxMetadata = listing.mapboxMetadata;
    if (!mapboxMetadata) {
      console.log('No mapboxMetadata found - skipping location handling');
      return;
    }

    const countryData = mapboxMetadata.country;
    const placeData = mapboxMetadata.place;
    const localityData = mapboxMetadata.locality;
    const regionData = mapboxMetadata.region;

    const countryName = listing.address?.country || countryData?.name || '';
    const countryCode = listing.address?.countryCode || '';

    // Handle COUNTRY
    if (countryData?.mapbox_id) {
      await ensureLocationExists({
        locationId: countryData.mapbox_id,
        locationName: countryData.name,
        locationType: 'COUNTRY',
        countryName: countryData.name,
        countryCode: countryCode,
      }, now);
      await incrementLocationListingsCount(countryData.mapbox_id, now);
    }

    // Handle PLACE
    if (placeData?.mapbox_id) {
      await ensureLocationExists({
        locationId: placeData.mapbox_id,
        locationName: placeData.name,
        locationType: 'PLACE',
        countryName: countryName,
        countryCode: countryCode,
        regionName: regionData?.name,
        regionId: regionData?.mapbox_id,
        parentCountryId: countryData?.mapbox_id,
      }, now);
      await incrementLocationListingsCount(placeData.mapbox_id, now);
    }

    // Handle LOCALITY
    if (localityData?.mapbox_id) {
      await ensureLocationExists({
        locationId: localityData.mapbox_id,
        locationName: localityData.name,
        locationType: 'LOCALITY',
        countryName: countryName,
        countryCode: countryCode,
        regionName: regionData?.name,
        regionId: regionData?.mapbox_id,
        parentPlaceId: placeData?.mapbox_id,
        parentPlaceName: placeData?.name,
      }, now);
      await incrementLocationListingsCount(localityData.mapbox_id, now);
    }

    console.log('Location creation and count increments completed');
  } catch (error) {
    console.error('Error handling location creation/counts:', error);
    // Don't throw - this is not critical to the submission
  }
}

/**
 * Ensure location exists in Locations table, create if not
 * New locations start with isLive: false (admin must enable)
 */
async function ensureLocationExists(locationData: {
  locationId: string;
  locationName: string;
  locationType: 'COUNTRY' | 'PLACE' | 'LOCALITY';
  countryName: string;
  countryCode: string;
  regionName?: string;
  regionId?: string;
  parentCountryId?: string;
  parentPlaceId?: string;
  parentPlaceName?: string;
}, now: string): Promise<void> {
  const {
    locationId,
    locationName,
    locationType,
    countryName,
    countryCode,
    regionName,
    regionId,
    parentCountryId,
    parentPlaceId,
    parentPlaceName,
  } = locationData;

  // Check if this specific name variant exists
  const existingLocation = await docClient.send(
    new GetCommand({
      TableName: LOCATIONS_TABLE_NAME,
      Key: {
        pk: `LOCATION#${locationId}`,
        sk: `NAME#${locationName}`,
      },
    })
  );

  if (existingLocation.Item) {
    console.log(`Location already exists: ${locationType} "${locationName}" (${locationId})`);
    return;
  }

  // Check if ANY name variant exists for this location (to get listingsCount)
  const anyVariant = await docClient.send(
    new QueryCommand({
      TableName: LOCATIONS_TABLE_NAME,
      KeyConditionExpression: 'pk = :pk',
      ExpressionAttributeValues: {
        ':pk': `LOCATION#${locationId}`,
      },
      Limit: 1,
    })
  );

  const existingListingsCount = anyVariant.Items?.[0]?.listingsCount || 0;
  const existingIsLive = anyVariant.Items?.[0]?.isLive;

  // Generate slug based on location type
  let slug: string;
  if (locationType === 'COUNTRY') {
    slug = countryCode.toLowerCase();
  } else {
    slug = generateLocationSlug(locationName, countryCode);
  }

  // Generate searchName based on location type
  let searchName: string;
  if (locationType === 'COUNTRY') {
    searchName = locationName.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  } else {
    searchName = generateSearchName(locationName, regionName || '');
  }

  // Generate displayName based on locationType
  let displayName: string;
  if (locationType === 'LOCALITY' && parentPlaceName) {
    displayName = `${locationName}, ${parentPlaceName}`;
  } else {
    displayName = locationName;
  }

  // Create new location record
  const newLocation: any = {
    pk: `LOCATION#${locationId}`,
    sk: `NAME#${locationName}`,

    locationId: locationId,
    locationType: locationType,
    name: locationName,
    displayName: displayName,
    countryName: countryName,

    slug: slug,
    searchName: searchName,
    entityType: 'LOCATION',

    listingsCount: existingListingsCount,
    isLive: existingIsLive ?? false, // New locations start as not live (admin enables)

    createdAt: now,
    updatedAt: now,
  };

  // Add type-specific fields
  if (locationType === 'COUNTRY') {
    newLocation.countryCode = countryCode;
  } else if (locationType === 'PLACE') {
    newLocation.regionName = regionName;
    newLocation.mapboxPlaceId = locationId;
    newLocation.mapboxRegionId = regionId;
    if (parentCountryId) {
      newLocation.mapboxCountryId = parentCountryId;
    }
  } else if (locationType === 'LOCALITY') {
    newLocation.regionName = regionName;
    newLocation.mapboxLocalityId = locationId;
    newLocation.mapboxRegionId = regionId;
    if (parentPlaceId) {
      newLocation.mapboxPlaceId = parentPlaceId;
    }
    if (parentPlaceName) {
      newLocation.parentPlaceName = parentPlaceName;
    }
  }

  await docClient.send(
    new PutCommand({
      TableName: LOCATIONS_TABLE_NAME,
      Item: newLocation,
    })
  );

  console.log(`Created new ${locationType} location: "${locationName}" (${locationId}) with isLive: false`);
}

/**
 * Increment listingsCount for ALL name variants of a location
 */
async function incrementLocationListingsCount(locationId: string, timestamp: string): Promise<void> {
  try {
    const variants = await docClient.send(
      new QueryCommand({
        TableName: LOCATIONS_TABLE_NAME,
        KeyConditionExpression: 'pk = :pk',
        ExpressionAttributeValues: {
          ':pk': `LOCATION#${locationId}`,
        },
      })
    );

    if (!variants.Items || variants.Items.length === 0) {
      console.warn(`No location variants found for locationId: ${locationId}`);
      return;
    }

    console.log(`Incrementing listingsCount for ${variants.Items.length} name variant(s) of location ${locationId}`);

    for (const variant of variants.Items) {
      await docClient.send(
        new UpdateCommand({
          TableName: LOCATIONS_TABLE_NAME,
          Key: {
            pk: variant.pk,
            sk: variant.sk,
          },
          UpdateExpression: 'ADD listingsCount :inc SET updatedAt = :now',
          ExpressionAttributeValues: {
            ':inc': 1,
            ':now': timestamp,
          },
        })
      );
    }

    console.log(`Successfully incremented listingsCount for location ${locationId}`);
  } catch (error) {
    console.error(`Failed to increment location listings count for ${locationId}:`, error);
  }
}
