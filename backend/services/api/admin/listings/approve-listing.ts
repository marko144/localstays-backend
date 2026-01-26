/**
 * Admin API: Approve Listing
 * 
 * PUT /api/v1/admin/listings/{listingId}/approve
 * Body: { 
 *   listingVerified: boolean,
 *   markReadyOnly?: boolean  // If true, marks as "ready to approve" without changing status
 * }
 * 
 * Approves a listing (IN_REVIEW → APPROVED).
 * Admin explicitly sets whether the listing is verified.
 * 
 * MODES:
 * 1. markReadyOnly=true: Sets readyToApprove=true but keeps current status (for bulk launch later)
 * 2. markReadyOnly=false (default): Actually approves the listing
 * 
 * AUTO-PUBLISH BEHAVIOR (controlled by SSM parameter /localstays/{stage}/config/auto-publish-on-approval):
 * - If auto-publish-on-approval=true AND host has available tokens → auto-publish to ONLINE
 * - If auto-publish-on-approval=false OR no tokens available → set to APPROVED
 * - Setting is cached for 5 minutes; change via AWS Console/CLI without redeploying
 * - Sends appropriate email notification (approved vs published)
 * 
 * Permission required: ADMIN_LISTING_APPROVE
 */

import { APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand, QueryCommand, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import { requirePermission, logAdminAction } from '../../lib/auth-middleware';
import { ListingMetadata } from '../../../types/listing.types';
import { Host, isIndividualHost } from '../../../types/host.types';
import { sendListingApprovedEmail, sendListingPublishedEmail } from '../../lib/email-service';
import { sendTemplatedNotification } from '../../lib/notification-template-service';
import {
  canHostPublishListing,
  createAdvertisingSlot,
  createCommissionBasedSlot,
} from '../../../lib/subscription-service';
import { buildPublicListingMediaPK, buildPublicListingMediaSK } from '../../../types/public-listing-media.types';
import { buildCloudFrontUrl } from '../../lib/cloudfront-urls';

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);
const ssmClient = new SSMClient({});

const TABLE_NAME = process.env.TABLE_NAME!;
const LOCATIONS_TABLE_NAME = process.env.LOCATIONS_TABLE_NAME!;
const PUBLIC_LISTINGS_TABLE_NAME = process.env.PUBLIC_LISTINGS_TABLE_NAME!;
const PUBLIC_LISTING_MEDIA_TABLE_NAME = process.env.PUBLIC_LISTING_MEDIA_TABLE_NAME!;
const STAGE = process.env.STAGE || 'staging';

// Cache for auto-publish setting (refreshed every 5 minutes)
let autoPublishCache: { value: boolean; expiresAt: number } | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Get auto-publish setting from SSM Parameter Store
 * Cached for 5 minutes to avoid excessive SSM calls
 */
async function getAutoPublishOnApproval(): Promise<boolean> {
  const now = Date.now();
  
  // Return cached value if still valid
  if (autoPublishCache && autoPublishCache.expiresAt > now) {
    return autoPublishCache.value;
  }

  const parameterName = `/localstays/${STAGE}/config/auto-publish-on-approval`;
  
  try {
    const response = await ssmClient.send(
      new GetParameterCommand({
        Name: parameterName,
      })
    );

    const value = response.Parameter?.Value?.toLowerCase() === 'true';
    
    // Cache the result
    autoPublishCache = {
      value,
      expiresAt: now + CACHE_TTL_MS,
    };
    
    console.log(`Auto-publish setting loaded from SSM: ${value}`);
    return value;
  } catch (error: any) {
    // If parameter doesn't exist, default to false
    if (error.name === 'ParameterNotFound') {
      console.log(`Auto-publish parameter not found, defaulting to false`);
      autoPublishCache = {
        value: false,
        expiresAt: now + CACHE_TTL_MS,
      };
      return false;
    }
    
    console.error(`Error reading auto-publish setting from SSM:`, error);
    // On error, use cached value if available, otherwise default to false
    return autoPublishCache?.value ?? false;
  }
}

/**
 * Validate request body
 */
function validateRequest(body: any): { 
  valid: boolean; 
  error?: string; 
  listingVerified?: boolean;
  markReadyOnly?: boolean;
} {
  if (!body) {
    return { valid: false, error: 'Request body is required' };
  }

  if (typeof body.listingVerified !== 'boolean') {
    return { valid: false, error: 'listingVerified is required and must be a boolean' };
  }

  return { 
    valid: true, 
    listingVerified: body.listingVerified,
    markReadyOnly: body.markReadyOnly === true,
  };
}

/**
 * Find listing by listingId using GSI3 (DocumentStatusIndex)
 */
async function findListing(listingId: string): Promise<ListingMetadata | null> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: 'DocumentStatusIndex',
      KeyConditionExpression: 'gsi3pk = :gsi3pk AND begins_with(gsi3sk, :gsi3sk)',
      ExpressionAttributeValues: {
        ':gsi3pk': `LISTING#${listingId}`,
        ':gsi3sk': 'LISTING_META#',
      },
      Limit: 1,
    })
  );

  if (!result.Items || result.Items.length === 0) {
    return null;
  }

  return result.Items[0] as ListingMetadata;
}

/**
 * Main handler
 */
export const handler: APIGatewayProxyHandler = async (event) => {
  console.log('Approve listing request:', { pathParameters: event.pathParameters });

  try {
    // 1. Require admin permission
    const authResult = requirePermission(event, 'ADMIN_LISTING_APPROVE');
    if ('error' in authResult) {
      return authResult.error;
    }

    const { user } = authResult;

    // 2. Extract listingId from path
    const listingId = event.pathParameters?.listingId;

    if (!listingId) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'listingId is required',
          },
        }),
      };
    }

    console.log(`Admin ${user.email} approving listing: ${listingId}`);

    // 3. Validate request body
    const bodyValidation = validateRequest(event.body ? JSON.parse(event.body) : null);
    if (!bodyValidation.valid) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: bodyValidation.error,
          },
        }),
      };
    }

    const listingVerified = bodyValidation.listingVerified!;
    const markReadyOnly = bodyValidation.markReadyOnly || false;
    console.log(`Setting listingVerified to: ${listingVerified}, markReadyOnly: ${markReadyOnly}`);

    // 4. Find listing
    const listing = await findListing(listingId);

    if (!listing) {
      return {
        statusCode: 404,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: 'Listing not found',
          },
        }),
      };
    }

    // 5. Check for location data (mapbox metadata OR manual location IDs)
    const hasMapboxData = !!(listing.mapboxMetadata?.place?.mapbox_id);
    const hasManualLocationIds = !!(listing.manualLocationIds && listing.manualLocationIds.length > 0);
    
    if (!hasMapboxData && !hasManualLocationIds) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({
          success: false,
          error: {
            code: 'MISSING_LOCATION_DATA',
            message: 'Location data is missing. Please set manual location before approving.',
            message_sr: 'Podaci o lokaciji nedostaju. Molimo postavite lokaciju ručno pre odobravanja.',
          },
        }),
      };
    }

    // 6. Validate current status (allow IN_REVIEW, REVIEWING, or LOCKED/SUSPENDED)
    const allowedStatuses = ['IN_REVIEW', 'REVIEWING', 'LOCKED'];
    if (!allowedStatuses.includes(listing.status)) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({
          success: false,
          error: {
            code: 'INVALID_STATUS_TRANSITION',
            message: `Cannot approve listing with status ${listing.status}. Expected one of: ${allowedStatuses.join(', ')}.`,
          },
        }),
      };
    }

    const now = new Date().toISOString();

    // 7. Handle "mark ready only" mode (for staged bulk launch)
    if (markReadyOnly) {
      await markListingReadyToApprove(listing, listingVerified, user.email, now);
      
      logAdminAction(user, 'MARK_LISTING_READY_TO_APPROVE', 'LISTING', listingId, {
        hostId: listing.hostId,
        listingVerified,
      });

      console.log(`✅ Listing ${listingId} marked as ready to approve`);

      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({
          success: true,
          message: 'Listing marked as ready to approve (pending bulk launch)',
          status: listing.status,
          readyToApprove: true,
        }),
      };
    }

    // 9. Check if we can auto-publish (only if AUTO_PUBLISH_ON_APPROVAL is enabled)
    // With commission-based fallback, canPublish will be true unless commission limit is reached
    const autoPublishEnabled = await getAutoPublishOnApproval();
    const publishCheck = await canHostPublishListing(listing.hostId);
    const canAutoPublish = autoPublishEnabled && publishCheck.canPublish;
    
    console.log(`Auto-publish check: autoPublishEnabled=${autoPublishEnabled}, canPublish=${publishCheck.canPublish}, useCommissionBased=${publishCheck.useCommissionBased}, result=${canAutoPublish}`);
    
    let finalStatus: 'APPROVED' | 'ONLINE' = 'APPROVED';
    let slotId: string | undefined;
    let slotExpiresAt: string | undefined;
    let isCommissionBased: boolean | undefined;

    if (canAutoPublish) {
      const slotType = publishCheck.useCommissionBased ? 'commission-based' : 'subscription-based';
      console.log(`Attempting auto-publish for listing ${listingId} as ${slotType}`);
      
      try {
        // Auto-publish the listing (subscription-based or commission-based)
        const publishResult = await autoPublishListing(
          listing,
          listingVerified,
          now,
          publishCheck.useCommissionBased,
          publishCheck.subscription
        );
        
        if (publishResult.success) {
          finalStatus = 'ONLINE';
          slotId = publishResult.slotId;
          slotExpiresAt = publishResult.slotExpiresAt;
          isCommissionBased = publishResult.isCommissionBased;
          console.log(`✅ Listing ${listingId} auto-published successfully (slotId=${slotId}, isCommissionBased=${isCommissionBased})`);
        } else {
          console.warn(`Auto-publish failed for listing ${listingId}: ${publishResult.error}`);
          // Fall back to just approving
          await updateListingToApproved(listing, listingVerified, now);
          console.log(`✅ Listing ${listingId} approved (auto-publish failed: ${publishResult.error})`);
        }
      } catch (publishError) {
        console.error(`Auto-publish error for listing ${listingId}:`, publishError);
        // Fall back to just approving
        await updateListingToApproved(listing, listingVerified, now);
        console.log(`✅ Listing ${listingId} approved (auto-publish error)`);
      }
    } else {
      // Just approve - commission-based limit reached
      console.log(`Cannot auto-publish listing ${listingId}: ${publishCheck.reason}`);
      await updateListingToApproved(listing, listingVerified, now);
      console.log(`✅ Listing ${listingId} approved successfully (listingVerified=${listingVerified})`);
    }

    // 7. Fetch host details for notifications
    let host: Host | undefined;
    try {
      const hostResult = await docClient.send(
        new QueryCommand({
          TableName: TABLE_NAME,
          KeyConditionExpression: 'pk = :pk AND sk = :sk',
          ExpressionAttributeValues: {
            ':pk': `HOST#${listing.hostId}`,
            ':sk': 'META',
          },
        })
      );
      host = hostResult.Items?.[0] as Host;
    } catch (hostError) {
      console.error('Failed to fetch host for notifications:', hostError);
    }

    // 8. Send email notification (independent of push notification)
    if (host) {
      const hostName = isIndividualHost(host)
        ? `${host.forename} ${host.surname}`
        : host.legalName || host.displayName || host.businessName || 'Host';

      // Send email
      try {
        if (finalStatus === 'ONLINE') {
          await sendListingPublishedEmail(
            host.email,
            host.preferredLanguage || 'sr',
            hostName,
            listing.listingName,
            slotExpiresAt
          );
          console.log(`📧 Published email sent to ${host.email}`);
        } else {
          await sendListingApprovedEmail(
            host.email,
            host.preferredLanguage || 'sr',
            hostName,
            listing.listingName
          );
          console.log(`📧 Approval email sent to ${host.email}`);
        }
      } catch (emailError) {
        console.error('Failed to send email:', emailError);
        // Don't fail the request if email fails
      }

      // 9. Send push notification (independent of email)
      if (host.ownerUserSub) {
        try {
          const templateName = finalStatus === 'ONLINE' ? 'LISTING_PUBLISHED' : 'LISTING_APPROVED';
          const pushResult = await sendTemplatedNotification(
            host.ownerUserSub,
            templateName,
            host.preferredLanguage || 'sr',
            {
              listingName: listing.listingName,
              listingId: listingId,
            }
          );
          console.log(`📱 Push notification sent: ${pushResult.sent} sent, ${pushResult.failed} failed`);
        } catch (pushError) {
          console.error('Failed to send push notification:', pushError);
          // Don't fail the request if push notification fails
        }
      }
    }

    // 10. Log admin action
    logAdminAction(user, finalStatus === 'ONLINE' ? 'APPROVE_AND_PUBLISH_LISTING' : 'APPROVE_LISTING', 'LISTING', listingId, {
      hostId: listing.hostId,
      autoPublished: finalStatus === 'ONLINE',
      slotId,
    });

    // 11. Return success response
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        success: true,
        message: finalStatus === 'ONLINE' 
          ? 'Listing approved and published automatically'
          : 'Listing approved successfully',
        status: finalStatus,
        autoPublished: finalStatus === 'ONLINE',
        ...(slotId && { slotId }),
        ...(slotExpiresAt && { slotExpiresAt }),
      }),
    };
  } catch (error) {
    console.error('❌ Approve listing error:', error);

    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to approve listing',
        },
      }),
    };
  }
};

/**
 * Mark listing as ready to approve (without changing status)
 * Used for staged bulk launch during early onboarding
 */
async function markListingReadyToApprove(
  listing: ListingMetadata,
  listingVerified: boolean,
  adminEmail: string,
  now: string
): Promise<void> {
  // Update GSI8 sort key to reflect readyToApprove=true for efficient querying
  const gsi8sk = listing.locationId 
    ? `READY#true#LISTING#${listing.listingId}` 
    : undefined;
  
  await docClient.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: {
        pk: `HOST#${listing.hostId}`,
        sk: `LISTING_META#${listing.listingId}`,
      },
      UpdateExpression: `
        SET readyToApprove = :ready,
            readyToApproveAt = :readyAt,
            readyToApproveBy = :readyBy,
            #listingVerified = :listingVerified,
            #updatedAt = :updatedAt
            ${gsi8sk ? ', gsi8sk = :gsi8sk' : ''}
      `,
      ExpressionAttributeNames: {
        '#listingVerified': 'listingVerified',
        '#updatedAt': 'updatedAt',
      },
      ExpressionAttributeValues: {
        ':ready': true,
        ':readyAt': now,
        ':readyBy': adminEmail,
        ':listingVerified': listingVerified,
        ':updatedAt': now,
        ...(gsi8sk && { ':gsi8sk': gsi8sk }),
      },
    })
  );
}

/**
 * Update listing to APPROVED status (without auto-publishing)
 */
async function updateListingToApproved(
  listing: ListingMetadata,
  listingVerified: boolean,
  now: string
): Promise<void> {
  // Build update expression - only set firstReviewCompletedAt if not already set
  const isFirstReview = !listing.firstReviewCompletedAt;
  
  let updateExpression = `
    SET #status = :status,
        #listingVerified = :listingVerified,
        #approvedAt = :approvedAt,
        #updatedAt = :updatedAt,
        #gsi2pk = :gsi2pk,
        #gsi2sk = :gsi2sk
  `;
  
  const expressionAttributeNames: Record<string, string> = {
    '#status': 'status',
    '#listingVerified': 'listingVerified',
    '#approvedAt': 'approvedAt',
    '#updatedAt': 'updatedAt',
    '#gsi2pk': 'gsi2pk',
    '#gsi2sk': 'gsi2sk',
  };
  
  const expressionAttributeValues: Record<string, any> = {
    ':status': 'APPROVED',
    ':listingVerified': listingVerified,
    ':approvedAt': now,
    ':updatedAt': now,
    ':gsi2pk': 'LISTING_STATUS#APPROVED',
    ':gsi2sk': now,
  };
  
  // Set firstReviewCompletedAt only on first review completion
  if (isFirstReview) {
    updateExpression = updateExpression.replace(
      '#gsi2sk = :gsi2sk',
      '#gsi2sk = :gsi2sk, #firstReviewCompletedAt = :firstReviewCompletedAt'
    );
    expressionAttributeNames['#firstReviewCompletedAt'] = 'firstReviewCompletedAt';
    expressionAttributeValues[':firstReviewCompletedAt'] = now;
    console.log(`📅 Setting firstReviewCompletedAt for listing ${listing.listingId}`);
  }
  
  updateExpression += ' REMOVE readyToApprove, readyToApproveAt, readyToApproveBy';
  
  // Update GSI8 sort key to reflect readyToApprove=false
  if (listing.locationId) {
    updateExpression = updateExpression.replace(
      '#gsi2sk = :gsi2sk',
      '#gsi2sk = :gsi2sk, gsi8sk = :gsi8sk'
    );
    expressionAttributeValues[':gsi8sk'] = `READY#false#LISTING#${listing.listingId}`;
  }
  
  await docClient.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: {
        pk: `HOST#${listing.hostId}`,
        sk: `LISTING_META#${listing.listingId}`,
      },
      UpdateExpression: updateExpression,
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: expressionAttributeValues,
    })
  );
}

/**
 * Auto-publish a listing (creates public records and advertising slot)
 * Supports both subscription-based and commission-based slots
 */
async function autoPublishListing(
  listing: ListingMetadata,
  listingVerified: boolean,
  now: string,
  useCommissionBased: boolean,
  subscription?: any
): Promise<{ success: boolean; slotId?: string; slotExpiresAt?: string; isCommissionBased?: boolean; error?: string }> {
  const listingId = listing.listingId;
  const hostId = listing.hostId;
  
  // Fetch listing images
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
  if (images.length === 0) {
    return { success: false, error: 'No images found' };
  }
  
  const primaryImage = images.find((img: any) => img.isPrimary);
  if (!primaryImage || !primaryImage.webpUrls?.thumbnail) {
    return { success: false, error: 'No primary image with thumbnail found' };
  }

  // Fetch amenities record
  const amenitiesResult = await docClient.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: {
        pk: `LISTING#${listingId}`,
        sk: 'AMENITIES',
      },
    })
  );
  const amenitiesRecord = amenitiesResult.Item;
  const amenityKeys = amenitiesRecord?.amenities?.map((a: any) => a.key) || [];

  // Fetch host profile for verification status
  const hostResult = await docClient.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: {
        pk: `HOST#${hostId}`,
        sk: 'META',
      },
    })
  );
  
  const hostProfile = hostResult.Item;
  const hostVerified = hostProfile?.status === 'VERIFIED';

  // Determine location source
  const hasMapboxMetadata = listing.mapboxMetadata?.place?.mapbox_id && listing.mapboxMetadata?.place?.name;
  const hasManualLocations = listing.manualLocationIds && listing.manualLocationIds.length > 0;

  let placeId: string;
  let placeName: string;
  let regionName: string;
  let localityId: string | null = null;
  let localityName: string | null = null;
  let hasLocality = false;

  if (hasMapboxMetadata) {
    placeId = listing.mapboxMetadata!.place!.mapbox_id;
    placeName = listing.mapboxMetadata!.place!.name;
    regionName = listing.mapboxMetadata!.region!.name;
    // Note: countryId extraction removed - location count increment now happens at submission time
    
    hasLocality = !!(listing.mapboxMetadata?.locality?.mapbox_id && listing.mapboxMetadata?.locality?.name);
    if (hasLocality) {
      localityId = listing.mapboxMetadata!.locality!.mapbox_id;
      localityName = listing.mapboxMetadata!.locality!.name;
    }
  } else if (hasManualLocations) {
    // Fetch location data from Locations table
    const locationData = await fetchLocationDataForManualIds(listing.manualLocationIds!);
    if (!locationData) {
      return { success: false, error: 'Manual location data not found' };
    }
    
    placeId = locationData.placeId;
    placeName = locationData.placeName;
    regionName = locationData.regionName;
    hasLocality = locationData.hasLocality;
    localityId = locationData.localityId;
    localityName = locationData.localityName;
  } else {
    return { success: false, error: 'No location data available' };
  }

  // Build public listing data
  const filters = {
    petsAllowed: listing.pets?.allowed || false,
    hasWIFI: amenityKeys.includes('WIFI'),
    hasAirConditioning: amenityKeys.includes('AIR_CONDITIONING'),
    hasParking: amenityKeys.includes('PARKING'),
    hasGym: amenityKeys.includes('GYM'),
    hasPool: amenityKeys.includes('POOL'),
    hasWorkspace: amenityKeys.includes('WORKSPACE'),
  };

  // Generate short description (from translatable field)
  const descriptionField = listing.description;
  const enText = descriptionField.versions?.en?.text || '';
  const srText = descriptionField.versions?.sr?.text || '';
  const shortDescription = {
    en: enText.length > 100 ? enText.substring(0, 100).trim() + '...' : enText,
    sr: srText.length > 100 ? srText.substring(0, 100).trim() + '...' : srText,
  };

  const basePublicListing = {
    listingId,
    hostId,
    name: listing.listingName,
    shortDescription,
    placeName,
    regionName,
    maxGuests: listing.capacity.sleeps,
    bedrooms: listing.capacity.bedrooms,
    singleBeds: listing.capacity.singleBeds,
    doubleBeds: listing.capacity.doubleBeds,
    bathrooms: listing.capacity.bathrooms,
    thumbnailUrl: buildCloudFrontUrl(primaryImage.webpUrls.thumbnail, primaryImage.updatedAt),
    latitude: listing.address.coordinates?.latitude || 0,
    longitude: listing.address.coordinates?.longitude || 0,
    petsAllowed: filters.petsAllowed,
    hasWIFI: filters.hasWIFI,
    hasAirConditioning: filters.hasAirConditioning,
    hasParking: filters.hasParking,
    hasGym: filters.hasGym,
    hasPool: filters.hasPool,
    hasWorkspace: filters.hasWorkspace,
    parkingType: listing.parking.type.key,
    checkInType: listing.checkIn.type.key,
    propertyType: listing.propertyType.key,
    advanceBookingDays: listing.advanceBooking.days,
    maxBookingNights: listing.maxBookingDuration.nights,
    minBookingNights: listing.minBookingNights || 1,
    instantBook: false,
    hostVerified,
    listingVerified,
    ...(listing.officialStarRating && { officialStarRating: listing.officialStarRating }),
    createdAt: now,
    updatedAt: now,
  };

  // Create PLACE public listing
  const placePublicListing = {
    ...basePublicListing,
    pk: `LOCATION#${placeId}`,
    sk: `LISTING#${listingId}`,
    locationId: placeId,
    locationType: 'PLACE' as const,
  };

  await docClient.send(
    new PutCommand({
      TableName: PUBLIC_LISTINGS_TABLE_NAME,
      Item: placePublicListing,
    })
  );

  // Create LOCALITY public listing if exists
  if (hasLocality && localityId && localityName) {
    const localityPublicListing = {
      ...basePublicListing,
      pk: `LOCATION#${localityId}`,
      sk: `LISTING#${listingId}`,
      locationId: localityId,
      locationType: 'LOCALITY' as const,
      localityName,
    };

    await docClient.send(
      new PutCommand({
        TableName: PUBLIC_LISTINGS_TABLE_NAME,
        Item: localityPublicListing,
      })
    );
  }

  // Create media records
  const sortedImages = images.sort((a: any, b: any) => a.displayOrder - b.displayOrder);
  for (let index = 0; index < sortedImages.length; index++) {
    const image = sortedImages[index];
    const mediaRecord = {
      pk: buildPublicListingMediaPK(listingId),
      sk: buildPublicListingMediaSK(index),
      listingId,
      imageIndex: index,
      url: buildCloudFrontUrl(image.webpUrls.full, image.updatedAt),
      thumbnailUrl: buildCloudFrontUrl(image.webpUrls.thumbnail, image.updatedAt),
      ...(image.caption && { caption: image.caption }),
      isCoverImage: index === 0,
      createdAt: now,
      updatedAt: now,
    };

    await docClient.send(
      new PutCommand({
        TableName: PUBLIC_LISTING_MEDIA_TABLE_NAME,
        Item: mediaRecord,
      })
    );
  }

  // Create advertising slot (subscription-based or commission-based)
  let slot;
  
  if (useCommissionBased) {
    // Create commission-based (free) slot - no expiry
    slot = await createCommissionBasedSlot({
      hostId,
      listingId,
    });
    console.log(`Created commission-based slot for listing ${listingId} (auto-publish)`);
  } else {
    // Create subscription-based slot with expiry
    // Note: For auto-publish, firstReviewCompletedAt is set to 'now' since this IS the first review
    slot = await createAdvertisingSlot({
      hostId,
      listingId,
      planId: subscription!.planId,
      subscription: subscription!,
      listingCreatedAt: listing.createdAt,
      firstReviewCompletedAt: listing.firstReviewCompletedAt || now, // Use existing or current time
    });
    console.log(`Created subscription-based slot for listing ${listingId}, expires: ${slot.expiresAt} (auto-publish)`);
  }

  // Update listing status to ONLINE with slot info
  // Build update expression - only set firstReviewCompletedAt if not already set
  const isFirstReview = !listing.firstReviewCompletedAt;
  
  // For commission-based slots, we don't set slotExpiresAt
  let updateExpression = slot.isCommissionBased
    ? `
      SET #status = :status,
          #listingVerified = :listingVerified,
          #approvedAt = :approvedAt,
          activeSlotId = :slotId,
          isCommissionBased = :isCommissionBased,
          #updatedAt = :updatedAt,
          #gsi2pk = :gsi2pk,
          #gsi2sk = :gsi2sk
      REMOVE slotExpiresAt
    `
    : `
      SET #status = :status,
          #listingVerified = :listingVerified,
          #approvedAt = :approvedAt,
          activeSlotId = :slotId,
          slotExpiresAt = :slotExpiresAt,
          isCommissionBased = :isCommissionBased,
          #updatedAt = :updatedAt,
          #gsi2pk = :gsi2pk,
          #gsi2sk = :gsi2sk
    `;
  
  const expressionAttributeNames: Record<string, string> = {
    '#status': 'status',
    '#listingVerified': 'listingVerified',
    '#approvedAt': 'approvedAt',
    '#updatedAt': 'updatedAt',
    '#gsi2pk': 'gsi2pk',
    '#gsi2sk': 'gsi2sk',
  };
  
  const expressionAttributeValues: Record<string, any> = {
    ':status': 'ONLINE',
    ':listingVerified': listingVerified,
    ':approvedAt': now,
    ':slotId': slot.slotId,
    ':isCommissionBased': slot.isCommissionBased,
    ':updatedAt': now,
    ':gsi2pk': 'LISTING_STATUS#ONLINE',
    ':gsi2sk': now,
  };
  
  // Only add slotExpiresAt for subscription-based slots
  if (!slot.isCommissionBased && slot.expiresAt) {
    expressionAttributeValues[':slotExpiresAt'] = slot.expiresAt;
  }
  
  // Set firstReviewCompletedAt only on first review completion
  if (isFirstReview) {
    updateExpression = updateExpression.replace(
      '#gsi2sk = :gsi2sk',
      '#gsi2sk = :gsi2sk, #firstReviewCompletedAt = :firstReviewCompletedAt'
    );
    expressionAttributeNames['#firstReviewCompletedAt'] = 'firstReviewCompletedAt';
    expressionAttributeValues[':firstReviewCompletedAt'] = now;
    console.log(`📅 Setting firstReviewCompletedAt for listing ${listingId} (auto-publish)`);
  }
  
  await docClient.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: {
        pk: `HOST#${hostId}`,
        sk: `LISTING_META#${listingId}`,
      },
      UpdateExpression: updateExpression,
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: expressionAttributeValues,
    })
  );

  // Note: listingsCount increment now happens in confirm-submission.ts when listing is first submitted.
  // We no longer increment here to avoid double-counting.

  return {
    success: true,
    slotId: slot.slotId,
    slotExpiresAt: slot.expiresAt,
    isCommissionBased: slot.isCommissionBased,
  };
}

/**
 * Fetch location data from Locations table for manual location IDs
 */
interface ManualLocationData {
  placeId: string;
  placeName: string;
  regionName: string;
  hasLocality: boolean;
  localityId: string | null;
  localityName: string | null;
}

async function fetchLocationDataForManualIds(manualLocationIds: string[]): Promise<ManualLocationData | null> {
  if (!manualLocationIds || manualLocationIds.length === 0) {
    return null;
  }

  const locationPromises = manualLocationIds.map(async (locationId) => {
    const result = await docClient.send(
      new QueryCommand({
        TableName: LOCATIONS_TABLE_NAME,
        KeyConditionExpression: 'pk = :pk',
        ExpressionAttributeValues: {
          ':pk': `LOCATION#${locationId}`,
        },
        Limit: 1,
      })
    );
    return result.Items?.[0] || null;
  });

  const locations = await Promise.all(locationPromises);
  const validLocations = locations.filter(Boolean);

  if (validLocations.length === 0) {
    return null;
  }

  const placeLocation = validLocations.find((loc: any) => loc.locationType === 'PLACE');
  const localityLocation = validLocations.find((loc: any) => loc.locationType === 'LOCALITY');

  if (!placeLocation) {
    if (localityLocation && localityLocation.mapboxPlaceId) {
      const parentResult = await docClient.send(
        new QueryCommand({
          TableName: LOCATIONS_TABLE_NAME,
          KeyConditionExpression: 'pk = :pk',
          ExpressionAttributeValues: {
            ':pk': `LOCATION#${localityLocation.mapboxPlaceId}`,
          },
          Limit: 1,
        })
      );

      const parentPlace = parentResult.Items?.[0];
      if (parentPlace) {
        return {
          placeId: parentPlace.locationId,
          placeName: parentPlace.name,
          regionName: parentPlace.regionName,
          hasLocality: true,
          localityId: localityLocation.locationId,
          localityName: localityLocation.name,
        };
      }
    }
    return null;
  }

  return {
    placeId: placeLocation.locationId,
    placeName: placeLocation.name,
    regionName: placeLocation.regionName,
    hasLocality: !!localityLocation,
    localityId: localityLocation?.locationId || null,
    localityName: localityLocation?.name || null,
  };
}

// Note: incrementLocationListingsCount has been moved to confirm-submission.ts
// Location count management now happens at submission time, not approval time.

