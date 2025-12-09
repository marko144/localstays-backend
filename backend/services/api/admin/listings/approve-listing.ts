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
    const autoPublishEnabled = await getAutoPublishOnApproval();
    const publishCheck = await canHostPublishListing(listing.hostId);
    const canAutoPublish = autoPublishEnabled && publishCheck.canPublish;
    
    console.log(`Auto-publish check: autoPublishEnabled=${autoPublishEnabled}, canPublish=${publishCheck.canPublish}, result=${canAutoPublish}`);
    
    let finalStatus: 'APPROVED' | 'ONLINE' = 'APPROVED';
    let slotId: string | undefined;
    let slotExpiresAt: string | undefined;

    if (canAutoPublish) {
      console.log(`Host has available tokens - attempting auto-publish for listing ${listingId}`);
      
      try {
        // Auto-publish the listing
        const publishResult = await autoPublishListing(
          listing,
          listingVerified,
          now,
          publishCheck.subscription!
        );
        
        if (publishResult.success) {
          finalStatus = 'ONLINE';
          slotId = publishResult.slotId;
          slotExpiresAt = publishResult.slotExpiresAt;
          console.log(`✅ Listing ${listingId} auto-published successfully (slotId=${slotId})`);
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
      // Just approve - no tokens available or subscription issue
      console.log(`Cannot auto-publish listing ${listingId}: ${publishCheck.reason}`);
      await updateListingToApproved(listing, listingVerified, now);
      console.log(`✅ Listing ${listingId} approved successfully (listingVerified=${listingVerified})`);
    }

    // 7. Send appropriate email and push notification
    try {
      // Fetch host details for email and notification
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
      
      const host = hostResult.Items?.[0] as Host;
      if (host) {
        const hostName = isIndividualHost(host)
          ? `${host.forename} ${host.surname}`
          : host.legalName || host.displayName || host.businessName || 'Host';
        
        if (finalStatus === 'ONLINE') {
          // Send published email notification
          await sendListingPublishedEmail(
            host.email,
            host.preferredLanguage || 'sr',
            hostName,
            listing.listingName,
            slotExpiresAt
          );
          console.log(`📧 Published email sent to ${host.email}`);
          
          // Send push notification for auto-publish
          if (host.ownerUserSub) {
            try {
              const pushResult = await sendTemplatedNotification(
                host.ownerUserSub,
                'LISTING_PUBLISHED',
                host.preferredLanguage || 'sr',
                {
                  listingName: listing.listingName,
                  listingId: listingId,
                }
              );
              console.log(`📱 Push notification sent: ${pushResult.sent} sent, ${pushResult.failed} failed`);
            } catch (pushError) {
              console.error('Failed to send push notification:', pushError);
            }
          }
        } else {
          // Send approval email notification
          await sendListingApprovedEmail(
            host.email,
            host.preferredLanguage || 'sr',
            hostName,
            listing.listingName
          );
          console.log(`📧 Approval email sent to ${host.email}`);

          // Send push notification using template
          if (host.ownerUserSub) {
            try {
              const pushResult = await sendTemplatedNotification(
                host.ownerUserSub,
                'LISTING_APPROVED',
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
      }
    } catch (emailError) {
      console.error('Failed to send email:', emailError);
      // Don't fail the request if email fails
    }

    // 8. Log admin action
    logAdminAction(user, finalStatus === 'ONLINE' ? 'APPROVE_AND_PUBLISH_LISTING' : 'APPROVE_LISTING', 'LISTING', listingId, {
      hostId: listing.hostId,
      autoPublished: finalStatus === 'ONLINE',
      slotId,
    });

    // 9. Return success response
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
 */
async function autoPublishListing(
  listing: ListingMetadata,
  listingVerified: boolean,
  now: string,
  subscription: any
): Promise<{ success: boolean; slotId?: string; slotExpiresAt?: string; error?: string }> {
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
  let countryId: string | null = null;

  if (hasMapboxMetadata) {
    placeId = listing.mapboxMetadata!.place!.mapbox_id;
    placeName = listing.mapboxMetadata!.place!.name;
    regionName = listing.mapboxMetadata!.region!.name;
    countryId = listing.mapboxMetadata?.country?.mapbox_id || null;
    
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

  const shortDescription =
    listing.description.length > 100
      ? listing.description.substring(0, 100).trim() + '...'
      : listing.description;

  const basePublicListing = {
    listingId,
    hostId,
    name: listing.listingName,
    shortDescription,
    placeName,
    regionName,
    maxGuests: listing.capacity.sleeps,
    bedrooms: listing.capacity.bedrooms,
    beds: listing.capacity.beds,
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

  // Create advertising slot
  // Note: For auto-publish, firstReviewCompletedAt is set to 'now' since this IS the first review
  const slot = await createAdvertisingSlot({
    hostId,
    listingId,
    planId: subscription.planId,
    subscription,
    listingCreatedAt: listing.createdAt,
    firstReviewCompletedAt: listing.firstReviewCompletedAt || now, // Use existing or current time
  });

  // Update listing status to ONLINE with slot info
  // Build update expression - only set firstReviewCompletedAt if not already set
  const isFirstReview = !listing.firstReviewCompletedAt;
  
  let updateExpression = `
    SET #status = :status,
        #listingVerified = :listingVerified,
        #approvedAt = :approvedAt,
        activeSlotId = :slotId,
        slotExpiresAt = :slotExpiresAt,
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
    ':slotExpiresAt': slot.expiresAt,
    ':updatedAt': now,
    ':gsi2pk': 'LISTING_STATUS#ONLINE',
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

  // Increment location listings count
  if (countryId) {
    await incrementLocationListingsCount(countryId, now);
  }
  await incrementLocationListingsCount(placeId, now);
  if (hasLocality && localityId) {
    await incrementLocationListingsCount(localityId, now);
  }

  return {
    success: true,
    slotId: slot.slotId,
    slotExpiresAt: slot.expiresAt,
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

/**
 * Increment listingsCount for all name variants of a location
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
      return;
    }

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
  } catch (error) {
    console.error(`Failed to increment location listings count for ${locationId}:`, error);
  }
}

