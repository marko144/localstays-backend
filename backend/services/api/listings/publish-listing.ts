/**
 * Publish Listing Handler
 * 
 * POST /api/v1/hosts/{hostId}/listings/{listingId}/publish
 * 
 * Publishes an APPROVED or OFFLINE listing to the PublicListings table.
 * Creates/updates location in Locations table if needed.
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, QueryCommand, TransactWriteCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import * as response from '../lib/response';
import { checkAndIncrementWriteOperationRateLimit, extractUserId } from '../lib/write-operation-rate-limiter';
import { buildPublicListingMediaPK, buildPublicListingMediaSK } from '../../types/public-listing-media.types';
import { buildCloudFrontUrl } from '../lib/cloudfront-urls';
import {
  getPublishingOptions,
  createAdvertisingSlot,
  createCommissionBasedSlot,
  getSlotByHostAndListingId,
  getSlot,
  attachListingToSlot,
} from '../../lib/subscription-service';
import { AdvertisingSlot } from '../../types/advertising-slot.types';

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

const TABLE_NAME = process.env.TABLE_NAME!;
const LOCATIONS_TABLE_NAME = process.env.LOCATIONS_TABLE_NAME!;
const PUBLIC_LISTINGS_TABLE_NAME = process.env.PUBLIC_LISTINGS_TABLE_NAME!;
const PUBLIC_LISTING_MEDIA_TABLE_NAME = process.env.PUBLIC_LISTING_MEDIA_TABLE_NAME!;

interface PublishListingResponse {
  message: string;
  listingId: string;
  locationId: string;
  status: string;
  slotId?: string;
  slotExpiresAt?: string;
  isCommissionBased?: boolean;
  reusedExistingSlot?: boolean; // true if an existing empty slot was reused
}

/**
 * Main handler
 */
export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  try {
    // Extract path parameters
    const hostId = event.pathParameters?.hostId;
    const listingId = event.pathParameters?.listingId;

    if (!hostId || !listingId) {
      return response.badRequest('Missing hostId or listingId');
    }

    // Extract user from JWT
    const sub = event.requestContext.authorizer?.claims?.sub;
    const cognitoGroups = event.requestContext.authorizer?.claims?.['cognito:groups'] || '';
    const groups = typeof cognitoGroups === 'string' ? cognitoGroups.split(',') : cognitoGroups;

    if (!sub) {
      return response.unauthorized('Unauthorized');
    }

    // Verify user is a HOST
    if (!groups.includes('HOST')) {
      return response.forbidden('Only hosts can publish listings');
    }

    // Check rate limit
    const userId = extractUserId(event);
    if (!userId) {
      return response.unauthorized('User ID not found');
    }

    const rateLimitCheck = await checkAndIncrementWriteOperationRateLimit(userId, 'listing-publish');
    if (!rateLimitCheck.allowed) {
      console.warn('Rate limit exceeded for listing publish:', { userId, hostId, listingId });
      return response.tooManyRequests(rateLimitCheck.message || 'Rate limit exceeded');
    }

    // Step 1: Fetch listing metadata
    const listing = await fetchListing(hostId, listingId);
    if (!listing) {
      return response.notFound('Listing not found');
    }

    // Step 2: Fetch listing images
    const images = await fetchListingImages(listingId);

    // Step 3: Fetch host profile to get verification status
    const hostProfile = await fetchHostProfile(hostId);
    if (!hostProfile) {
      return response.internalError('Host profile not found', new Error('Missing host profile'));
    }

    const hostVerified = hostProfile.status === 'VERIFIED';
    console.log(`Host verification status: ${hostProfile.status}, hostVerified: ${hostVerified}`);

    // Step 4: Validate listing eligibility (basic checks)
    const validationError = validateListingForPublish(listing, images);
    if (validationError) {
      return response.badRequest(validationError);
    }

    // Step 4b: Check if pricing is configured
    if (!listing.hasPricing) {
      return response.badRequest(
        'Pricing not configured',
        { message_sr: 'Cene nisu konfigurisane' }
      );
    }

    // Step 5: Check if already online
    if (listing.status === 'ONLINE') {
      return response.badRequest('Listing is already online');
    }

    // Step 5b: Check if listing already has an active slot (prevent duplicate slots)
    const existingSlot = await getSlotByHostAndListingId(hostId, listingId);
    if (existingSlot) {
      return response.badRequest('Listing already has an active advertising slot');
    }

    // Step 5c: Parse request body to get the chosen ad type
    // Frontend decides: isCommissionBased = true for free ad, false for subscription-based
    // Optionally, frontend can pass useSlotId to reuse an existing empty slot
    let body: { isCommissionBased?: boolean; useSlotId?: string } = {};
    if (event.body) {
      try {
        body = JSON.parse(event.body);
      } catch {
        // Body is optional for backward compatibility
      }
    }
    
    // Default to commission-based if not specified (backward compatibility / no subscription)
    const requestedCommissionBased = body.isCommissionBased !== false;
    
    // Validate useSlotId - can only be used with token-based (not commission-based)
    if (body.useSlotId && requestedCommissionBased) {
      return response.badRequest('Cannot use useSlotId with commission-based listings. Empty slots are only for token-based ads.');
    }
    
    // Step 5d: Check if reusing an existing empty slot
    let useExistingSlot = false;
    let existingEmptySlot: AdvertisingSlot | null = null;
    
    if (!requestedCommissionBased && body.useSlotId) {
      console.log(`Checking if slot ${body.useSlotId} can be reused...`);
      
      existingEmptySlot = await getSlot(hostId, body.useSlotId);
      
      if (!existingEmptySlot) {
        return response.badRequest('Specified slot not found');
      }
      
      if (existingEmptySlot.hostId !== hostId) {
        return response.forbidden('Slot does not belong to this host');
      }
      
      if (existingEmptySlot.listingId) {
        return response.badRequest('Slot is already in use by another listing');
      }
      
      if (existingEmptySlot.isCommissionBased) {
        return response.badRequest('Cannot reuse a commission-based slot');
      }
      
      useExistingSlot = true;
      console.log(`Will reuse existing empty slot: ${body.useSlotId}, expires: ${existingEmptySlot.expiresAt}`);
    }
    
    // Step 5e: Check publishing options and validate the user's choice
    const publishOptions = await getPublishingOptions(hostId);
    
    let useCommissionBased: boolean;
    let subscription = publishOptions.subscription;
    
    if (requestedCommissionBased) {
      // User wants commission-based
      if (!publishOptions.canPublishCommissionBased) {
        const errorMessage = 'Unable to publish free listing. You have reached the maximum number of free listings (100).';
        const errorMessage_sr = 'Nije moguće objaviti besplatan oglas. Dostigli ste maksimalan broj besplatnih oglasa (100).';
        return response.badRequest(errorMessage, { 
          message_sr: errorMessage_sr, 
          reason: publishOptions.commissionReason,
          commissionSlotsUsed: publishOptions.commissionSlotsUsed,
          commissionSlotsLimit: publishOptions.commissionSlotsLimit,
        });
      }
      useCommissionBased = true;
    } else {
      // User wants subscription-based
      // If using existing slot, we don't need available tokens - just check subscription is active
      if (useExistingSlot) {
        // Just validate subscription is not past due
        if (publishOptions.subscriptionReason === 'SUBSCRIPTION_PAST_DUE') {
          const errorMessage = 'Your subscription payment is past due. Please update your payment method.';
          const errorMessage_sr = 'Vaše plaćanje pretplate je zaostalo. Molimo ažurirajte način plaćanja.';
          return response.badRequest(errorMessage, { 
            message_sr: errorMessage_sr, 
            reason: 'SUBSCRIPTION_PAST_DUE',
          });
        }
        console.log('Using existing slot - skipping token availability check');
      } else {
        // Standard flow - need available tokens
        if (!publishOptions.canPublishSubscriptionBased) {
          let errorMessage: string;
          let errorMessage_sr: string;
          
          switch (publishOptions.subscriptionReason) {
            case 'NO_SUBSCRIPTION':
              errorMessage = 'No active subscription found. Please subscribe to publish subscription-based listings.';
              errorMessage_sr = 'Nije pronađena aktivna pretplata. Pretplatite se da biste objavili pretplatne oglase.';
              break;
            case 'SUBSCRIPTION_PAST_DUE':
              errorMessage = 'Your subscription payment is past due. Please update your payment method.';
              errorMessage_sr = 'Vaše plaćanje pretplate je zaostalo. Molimo ažurirajte način plaćanja.';
              break;
            case 'NO_TOKENS_AVAILABLE':
              errorMessage = 'No advertising slots available. All your tokens are in use.';
              errorMessage_sr = 'Nema dostupnih oglasnih slotova. Svi vaši tokeni su u upotrebi.';
              break;
            default:
              errorMessage = 'Unable to publish subscription-based listing. Please check your subscription status.';
              errorMessage_sr = 'Nije moguće objaviti pretplatni oglas. Proverite status pretplate.';
          }
          
          return response.badRequest(errorMessage, { 
            message_sr: errorMessage_sr, 
            reason: publishOptions.subscriptionReason,
            availableTokens: publishOptions.availableTokens,
          });
        }
      }
      useCommissionBased = false;
    }

    // Step 6: Determine location source and extract location data
    // Priority: mapboxMetadata > manualLocationIds
    const hasMapboxMetadata = listing.mapboxMetadata?.place?.mapbox_id && listing.mapboxMetadata?.place?.name;
    const hasManualLocations = listing.manualLocationIds && listing.manualLocationIds.length > 0;

    if (!hasMapboxMetadata && !hasManualLocations) {
      return response.badRequest('Property location information missing - please contact support');
    }

    let placeId: string;
    let placeName: string;
    let regionName: string;
    let localityId: string | null = null;
    let localityName: string | null = null;
    let hasLocality = false;
    const countryName = listing.address.country;

    if (hasMapboxMetadata) {
      // Use mapboxMetadata (primary path)
      placeId = listing.mapboxMetadata!.place!.mapbox_id;
      placeName = listing.mapboxMetadata!.place!.name;
      regionName = listing.mapboxMetadata!.region!.name;
      // Note: regionId and countryId extraction removed - location creation now happens at submission time

      // Check if locality exists in mapbox metadata
      hasLocality = !!(listing.mapboxMetadata?.locality?.mapbox_id && listing.mapboxMetadata?.locality?.name);
      if (hasLocality) {
        localityId = listing.mapboxMetadata.locality.mapbox_id;
        localityName = listing.mapboxMetadata.locality.name;
      }

      console.log(`Using mapboxMetadata for location: COUNTRY (${countryName}) > PLACE (${placeName})${hasLocality ? ` > LOCALITY (${localityName})` : ''}`);

      // Note: Location creation and listingsCount increment now happens in confirm-submission.ts
      // when the listing is first submitted for review. This ensures locations are tracked
      // from submission, not just when published.
    } else {
      // Use manualLocationIds (fallback path)
      console.log(`Using manualLocationIds for location: ${listing.manualLocationIds.join(', ')}`);

      // Fetch location data from Locations table
      const locationData = await fetchLocationDataForManualIds(listing.manualLocationIds);
      if (!locationData) {
        return response.badRequest('Manual location data not found in locations table - please contact support');
      }

      placeId = locationData.placeId;
      placeName = locationData.placeName;
      regionName = locationData.regionName;
      // Note: regionId extraction removed - location creation now happens at submission time
      hasLocality = locationData.hasLocality;
      localityId = locationData.localityId;
      localityName = locationData.localityName;

      console.log(`Resolved manual locations: PLACE (${placeName})${hasLocality ? ` + LOCALITY (${localityName})` : ''}`);
      // Note: For manual locations, we don't create new location records - they must already exist
    }

    // Step 8: Derive boolean filters from amenities
    const amenityKeys = listing.amenities?.map((a: any) => a.key) || [];
    const filters = {
      petsAllowed: listing.pets?.allowed || false,
      hasWIFI: amenityKeys.includes('WIFI'),
      hasAirConditioning: amenityKeys.includes('AIR_CONDITIONING'),
      hasParking: amenityKeys.includes('PARKING'),
      hasGym: amenityKeys.includes('GYM'),
      hasPool: amenityKeys.includes('POOL'),
      hasWorkspace: amenityKeys.includes('WORKSPACE'),
    };

    // Step 9: Get primary image thumbnail
    const primaryImage = images.find((img: any) => img.isPrimary);
    if (!primaryImage || !primaryImage.webpUrls?.thumbnail) {
      return response.badRequest('No primary image with thumbnail found');
    }

    // Step 10: Generate short description (from translatable field)
    const descriptionField = listing.description;
    const enText = descriptionField.versions?.en?.text || '';
    const srText = descriptionField.versions?.sr?.text || '';
    const shortDescription = {
      en: enText.length > 100 ? enText.substring(0, 100).trim() + '...' : enText,
      sr: srText.length > 100 ? srText.substring(0, 100).trim() + '...' : srText,
    };

    // Step 11: Sort images by displayOrder and prepare media records
    const sortedImages = images.sort((a, b) => a.displayOrder - b.displayOrder);
    
    // Step 12: Build transaction items
    const now = new Date().toISOString();
    const transactItems: any[] = [];

    // 11a. Create PublicListing record(s)
    // Base listing data shared by both PLACE and LOCALITY records
    const basePublicListing = {
      listingId: listingId,
      hostId: hostId,

      name: listing.listingName,
      shortDescription: shortDescription,
      placeName: placeName,
      regionName: regionName,

      maxGuests: listing.capacity.sleeps,
      bedrooms: listing.capacity.bedrooms,
      singleBeds: listing.capacity.singleBeds,
      doubleBeds: listing.capacity.doubleBeds,
      bathrooms: listing.capacity.bathrooms,

      thumbnailUrl: buildCloudFrontUrl(primaryImage.webpUrls.thumbnail, primaryImage.updatedAt),

      latitude: listing.address.coordinates.latitude,
      longitude: listing.address.coordinates.longitude,

      petsAllowed: filters.petsAllowed,
      hasWIFI: filters.hasWIFI,
      hasAirConditioning: filters.hasAirConditioning,
      hasParking: filters.hasParking,
      hasGym: filters.hasGym,
      hasPool: filters.hasPool,
      hasWorkspace: filters.hasWorkspace,

      parkingType: listing.parking.type.key, // Store enum key only
      checkInType: listing.checkIn.type.key, // Store enum key only
      propertyType: listing.propertyType.key, // Store enum key only (APARTMENT, HOUSE, VILLA, STUDIO, ROOM)

      advanceBookingDays: listing.advanceBooking.days, // Store numerical value for filtering
      maxBookingNights: listing.maxBookingDuration.nights, // Store numerical value for filtering
      minBookingNights: listing.minBookingNights || 1, // Store numerical value for filtering (default 1)

      instantBook: false, // Default to false
      hostVerified: hostVerified, // Sync from host profile
      listingVerified: listing.listingVerified || false, // Sync from listing metadata
      ...(listing.officialStarRating && { officialStarRating: listing.officialStarRating }),

      createdAt: now,
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

    transactItems.push({
      Put: {
        TableName: PUBLIC_LISTINGS_TABLE_NAME,
        Item: placePublicListing,
      },
    });

    // Create LOCALITY listing record (if locality exists)
    if (hasLocality && localityId && localityName) {
      const localityPublicListing = {
        ...basePublicListing,
        pk: `LOCATION#${localityId}`,
        sk: `LISTING#${listingId}`,
        locationId: localityId,
        locationType: 'LOCALITY' as const,
        localityName: localityName, // Add locality name for display
      };

      transactItems.push({
        Put: {
          TableName: PUBLIC_LISTINGS_TABLE_NAME,
          Item: localityPublicListing,
        },
      });

      console.log(`Creating dual listing records: PLACE (${placeName}) and LOCALITY (${localityName})`);
    } else {
      console.log(`Creating single listing record: PLACE (${placeName}) only`);
    }

    // 11b. Create PublicListingMedia records for all images
    sortedImages.forEach((image, index) => {
      const mediaRecord = {
        pk: buildPublicListingMediaPK(listingId),
        sk: buildPublicListingMediaSK(index),

        listingId: listingId,
        imageIndex: index,

        url: buildCloudFrontUrl(image.webpUrls.full, image.updatedAt),
        thumbnailUrl: buildCloudFrontUrl(image.webpUrls.thumbnail, image.updatedAt),

        ...(image.caption && { caption: image.caption }),
        isCoverImage: index === 0, // First image is cover

        createdAt: now,
        updatedAt: now,
      };

      transactItems.push({
        Put: {
          TableName: PUBLIC_LISTING_MEDIA_TABLE_NAME,
          Item: mediaRecord,
        },
      });
    });

    // Note: We update listing status AFTER creating the slot so we can include slot info
    // Step 12: Execute transaction (all succeed or all fail)
    console.log(`Publishing listing with ${transactItems.length} transaction items (listing records + ${sortedImages.length} images)`);
    
    await docClient.send(
      new TransactWriteCommand({
        TransactItems: transactItems,
      })
    );

    console.log('Public listing records created successfully via transaction');

    // Step 12b: Create or attach advertising slot
    // This is done outside the main transaction because it writes to a different table
    let slot: AdvertisingSlot;
    
    if (useCommissionBased) {
      // Create commission-based (free) slot - no expiry
      slot = await createCommissionBasedSlot({
        hostId,
        listingId,
      });
      console.log(`Created commission-based slot for listing ${listingId}`);
    } else if (useExistingSlot && existingEmptySlot) {
      // Attach listing to existing empty slot (reuse slot)
      // Uses conditional write to prevent race conditions
      try {
        await attachListingToSlot(hostId, existingEmptySlot.slotId, listingId);
        slot = {
          ...existingEmptySlot,
          listingId, // Now attached
        };
        console.log(`Attached listing ${listingId} to existing slot ${slot.slotId}, expires: ${slot.expiresAt}`);
      } catch (err: any) {
        // Conditional check failed - slot was claimed by another request
        if (err.name === 'ConditionalCheckFailedException') {
          return response.badRequest('Slot is no longer available - it may have been used by another listing');
        }
        throw err;
      }
    } else {
      // Create new subscription-based slot with expiry
      slot = await createAdvertisingSlot({
        hostId,
        listingId,
        planId: subscription!.planId,
        subscription: subscription!,
        listingCreatedAt: listing.createdAt,
        firstReviewCompletedAt: listing.firstReviewCompletedAt,
      });
      console.log(`Created subscription-based slot for listing ${listingId}, expires: ${slot.expiresAt}`);
    }

    // Step 12c: Update listing status to ONLINE with slot info
    // For commission-based slots, we don't set slotExpiresAt (no expiry)
    const updateExpression = slot.isCommissionBased
      ? 'SET #status = :online, activeSlotId = :slotId, isCommissionBased = :isCommissionBased, #updatedAt = :now REMOVE slotExpiresAt'
      : 'SET #status = :online, activeSlotId = :slotId, slotExpiresAt = :expiresAt, isCommissionBased = :isCommissionBased, #updatedAt = :now';
    
    const updateExpressionValues: Record<string, any> = {
      ':online': 'ONLINE',
      ':slotId': slot.slotId,
      ':isCommissionBased': slot.isCommissionBased,
      ':now': now,
    };
    
    if (!slot.isCommissionBased) {
      updateExpressionValues[':expiresAt'] = slot.expiresAt;
    }
    
    await docClient.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: {
          pk: `HOST#${hostId}`,
          sk: `LISTING_META#${listingId}`,
        },
        UpdateExpression: updateExpression,
        ExpressionAttributeNames: {
          '#status': 'status',
          '#updatedAt': 'updatedAt',
        },
        ExpressionAttributeValues: updateExpressionValues,
      })
    );

    console.log('Listing status updated to ONLINE with slot info');

    // Note: listingsCount increment now happens in confirm-submission.ts when listing is first submitted.
    // We no longer increment here to avoid double-counting.

    // Step 13: Return success
    const responseData: PublishListingResponse = {
      message: 'Listing published successfully',
      listingId: listingId,
      locationId: placeId,
      status: 'ONLINE',
      slotId: slot.slotId,
      isCommissionBased: slot.isCommissionBased,
      ...(slot.expiresAt && { slotExpiresAt: slot.expiresAt }),
      ...(useExistingSlot && { reusedExistingSlot: true }),
    };

    return response.success(responseData);
  } catch (error) {
    console.error('Error publishing listing:', error);
    return response.internalError('Failed to publish listing', error as Error);
  }
}

/**
 * Fetch listing metadata from main table
 */
async function fetchListing(hostId: string, listingId: string): Promise<any | null> {
  const result = await docClient.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: {
        pk: `HOST#${hostId}`,
        sk: `LISTING_META#${listingId}`,
      },
    })
  );

  return result.Item || null;
}

/**
 * Fetch host profile to get verification status
 */
async function fetchHostProfile(hostId: string): Promise<any | null> {
  const result = await docClient.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: {
        pk: `HOST#${hostId}`,
        sk: 'META',
      },
    })
  );

  return result.Item || null;
}

/**
 * Fetch listing images
 */
async function fetchListingImages(listingId: string): Promise<any[]> {
  const result = await docClient.send(
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

  return result.Items || [];
}

/**
 * Validate listing can be published
 */
function validateListingForPublish(listing: any, images: any[]): string | null {
  // Status check
  if (listing.status !== 'APPROVED' && listing.status !== 'OFFLINE') {
    return `Listing must be APPROVED or OFFLINE to publish. Current status: ${listing.status}`;
  }

  // Location check: Either mapboxMetadata OR manualLocationIds must be present
  // (The detailed check happens in the main handler after this validation)
  const hasMapboxMetadata = listing.mapboxMetadata?.place?.mapbox_id && listing.mapboxMetadata?.place?.name;

  // If using mapboxMetadata, also need region info
  if (hasMapboxMetadata) {
    if (!listing.mapboxMetadata?.region?.mapbox_id || !listing.mapboxMetadata?.region?.name) {
      return 'Missing region information (mapbox region ID and name required)';
    }
  }

  // Address check
  if (!listing.address?.country || !listing.address?.countryCode) {
    return 'Missing country information';
  }

  // Coordinates check
  if (!listing.address?.coordinates?.latitude || !listing.address?.coordinates?.longitude) {
    return 'Missing coordinates (latitude and longitude required for publishing)';
  }

  // Capacity check
  if (
    typeof listing.capacity?.singleBeds !== 'number' ||
    typeof listing.capacity?.doubleBeds !== 'number' ||
    (listing.capacity.singleBeds + listing.capacity.doubleBeds) < 1 ||
    listing.capacity?.bedrooms === undefined ||
    !listing.capacity?.bathrooms ||
    !listing.capacity?.sleeps
  ) {
    return 'Missing capacity information (singleBeds, doubleBeds, bedrooms, bathrooms, sleeps required)';
  }

  // Check-in check
  if (!listing.checkIn?.type) {
    return 'Missing check-in type';
  }

  // Parking check
  if (!listing.parking?.type) {
    return 'Missing parking type';
  }

  // Images check
  if (!images || images.length === 0) {
    return 'Listing must have at least one image';
  }

  const hasPrimaryImage = images.some((img: any) => img.isPrimary);
  if (!hasPrimaryImage) {
    return 'Listing must have a primary image';
  }

  return null; // All validations passed
}

// Note: ensureLocationExists has been moved to confirm-submission.ts
// Location creation now happens when a listing is submitted for review, not when published.

/**
 * Fetch location data from Locations table for manual location IDs
 * Returns the PLACE and optional LOCALITY data needed for publishing
 */
interface ManualLocationData {
  placeId: string;
  placeName: string;
  regionName: string;
  regionId: string;
  hasLocality: boolean;
  localityId: string | null;
  localityName: string | null;
}

async function fetchLocationDataForManualIds(manualLocationIds: string[]): Promise<ManualLocationData | null> {
  if (!manualLocationIds || manualLocationIds.length === 0) {
    return null;
  }

  // Fetch all location records for the manual IDs
  const locationPromises = manualLocationIds.map(async (locationId) => {
    const result = await docClient.send(
      new QueryCommand({
        TableName: LOCATIONS_TABLE_NAME,
        KeyConditionExpression: 'pk = :pk',
        ExpressionAttributeValues: {
          ':pk': `LOCATION#${locationId}`,
        },
        Limit: 1, // Just need one name variant
      })
    );
    return result.Items?.[0] || null;
  });

  const locations = await Promise.all(locationPromises);
  const validLocations = locations.filter(Boolean);

  if (validLocations.length === 0) {
    console.error('No valid locations found for manualLocationIds:', manualLocationIds);
    return null;
  }

  // Find PLACE and LOCALITY records
  const placeLocation = validLocations.find((loc: any) => loc.locationType === 'PLACE');
  const localityLocation = validLocations.find((loc: any) => loc.locationType === 'LOCALITY');

  if (!placeLocation) {
    // If no explicit PLACE, check if LOCALITY has a parent PLACE reference
    if (localityLocation && localityLocation.mapboxPlaceId) {
      // Try to fetch the parent PLACE
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
          regionId: parentPlace.mapboxRegionId,
          hasLocality: true,
          localityId: localityLocation.locationId,
          localityName: localityLocation.name,
        };
      }
    }

    console.error('No PLACE location found in manualLocationIds and could not derive from LOCALITY');
    return null;
  }

  // We have a PLACE, check if we also have a LOCALITY
  return {
    placeId: placeLocation.locationId,
    placeName: placeLocation.name,
    regionName: placeLocation.regionName,
    regionId: placeLocation.mapboxRegionId,
    hasLocality: !!localityLocation,
    localityId: localityLocation?.locationId || null,
    localityName: localityLocation?.name || null,
  };
}

// Note: generateLocationSlug, generateSearchName, and incrementLocationListingsCount
// have been moved to confirm-submission.ts. Location count management now happens at submission time.


