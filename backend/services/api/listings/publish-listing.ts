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
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, TransactWriteCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import * as response from '../lib/response';
import { checkAndIncrementWriteOperationRateLimit, extractUserId } from '../lib/write-operation-rate-limiter';
import { buildPublicListingMediaPK, buildPublicListingMediaSK } from '../../types/public-listing-media.types';
import { buildCloudFrontUrl } from '../lib/cloudfront-urls';
import {
  canHostPublishListing,
  createAdvertisingSlot,
  getSlotByListingId,
} from '../../lib/subscription-service';

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
    const existingSlot = await getSlotByListingId(listingId);
    if (existingSlot) {
      return response.badRequest('Listing already has an active advertising slot');
    }

    // Step 5c: Check subscription and token availability
    const publishCheck = await canHostPublishListing(hostId);
    if (!publishCheck.canPublish) {
      let errorMessage: string;
      let errorMessage_sr: string;
      
      switch (publishCheck.reason) {
        case 'NO_SUBSCRIPTION':
          errorMessage = 'No active subscription found. Please subscribe to publish listings.';
          errorMessage_sr = 'Nije pronađena aktivna pretplata. Pretplatite se da biste objavili oglase.';
          break;
        case 'SUBSCRIPTION_PAST_DUE':
          errorMessage = 'Your subscription payment is past due. Please update your payment method.';
          errorMessage_sr = 'Vaše plaćanje pretplate je zaostalo. Molimo ažurirajte način plaćanja.';
          break;
        case 'SUBSCRIPTION_CANCELLED':
          errorMessage = 'Your subscription has been cancelled. Please resubscribe to publish listings.';
          errorMessage_sr = 'Vaša pretplata je otkazana. Ponovo se pretplatite da biste objavili oglase.';
          break;
        case 'SUBSCRIPTION_EXPIRED':
          errorMessage = 'Your subscription has expired. Please renew to publish listings.';
          errorMessage_sr = 'Vaša pretplata je istekla. Obnovite pretplatu da biste objavili oglase.';
          break;
        case 'NO_TOKENS_AVAILABLE':
          errorMessage = 'No advertising slots available. All your tokens are in use.';
          errorMessage_sr = 'Nema dostupnih oglasnih slotova. Svi vaši tokeni su u upotrebi.';
          break;
        default:
          errorMessage = 'Unable to publish listing. Please check your subscription status.';
          errorMessage_sr = 'Nije moguće objaviti oglas. Proverite status pretplate.';
      }
      
      return response.badRequest(errorMessage, { message_sr: errorMessage_sr, reason: publishCheck.reason });
    }

    const subscription = publishCheck.subscription!;

    // Step 6: Determine location source and extract location data
    // Priority: mapboxMetadata > manualLocationIds
    const hasMapboxMetadata = listing.mapboxMetadata?.place?.mapbox_id && listing.mapboxMetadata?.place?.name;
    const hasManualLocations = listing.manualLocationIds && listing.manualLocationIds.length > 0;

    if (!hasMapboxMetadata && !hasManualLocations) {
      return response.badRequest('Property location information missing - please contact support');
    }

    let countryId: string | null = null;
    let placeId: string;
    let placeName: string;
    let regionName: string;
    let regionId: string;
    let localityId: string | null = null;
    let localityName: string | null = null;
    let hasLocality = false;
    const countryName = listing.address.country;
    const countryCode = listing.address.countryCode;

    if (hasMapboxMetadata) {
      // Use mapboxMetadata (primary path)
      placeId = listing.mapboxMetadata!.place!.mapbox_id;
      placeName = listing.mapboxMetadata!.place!.name;
      regionName = listing.mapboxMetadata!.region!.name;
      regionId = listing.mapboxMetadata!.region!.mapbox_id;

      // Extract country ID if available
      countryId = listing.mapboxMetadata?.country?.mapbox_id || null;

      // Check if locality exists in mapbox metadata
      hasLocality = !!(listing.mapboxMetadata?.locality?.mapbox_id && listing.mapboxMetadata?.locality?.name);
      if (hasLocality) {
        localityId = listing.mapboxMetadata.locality.mapbox_id;
        localityName = listing.mapboxMetadata.locality.name;
      }

      console.log(`Using mapboxMetadata for location: COUNTRY (${countryName}) > PLACE (${placeName})${hasLocality ? ` > LOCALITY (${localityName})` : ''}`);

      // Step 7: Check/create location hierarchy from mapbox metadata
      // Order: COUNTRY first, then PLACE (linked to country), then LOCALITY (linked to place)

      // 7a. Create COUNTRY location if we have the ID
      if (countryId) {
        await ensureLocationExists({
          locationId: countryId,
          locationName: countryName,
          locationType: 'COUNTRY',
          countryName: countryName,
          countryCode: countryCode,
        });
      }

      // 7b. Create PLACE location (linked to country)
      await ensureLocationExists({
        locationId: placeId,
        locationName: placeName,
        locationType: 'PLACE',
        countryName: countryName,
        countryCode: countryCode,
        regionName: regionName,
        regionId: regionId,
        parentCountryId: countryId || undefined,
      });

      // 7c. Create LOCALITY location if exists (linked to place)
      if (hasLocality && localityId && localityName) {
        await ensureLocationExists({
          locationId: localityId,
          locationName: localityName,
          locationType: 'LOCALITY',
          countryName: countryName,
          countryCode: countryCode,
          regionName: regionName,
          regionId: regionId,
          parentPlaceId: placeId,
          parentPlaceName: placeName,
        });
      }
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
      regionId = locationData.regionId;
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

    // Step 10: Generate short description
    const shortDescription =
      listing.description.length > 100
        ? listing.description.substring(0, 100).trim() + '...'
        : listing.description;

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
      beds: listing.capacity.beds,
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

    // Step 12b: Create advertising slot
    // This is done outside the main transaction because it writes to a different table
    const slot = await createAdvertisingSlot({
      hostId,
      listingId,
      planId: subscription.planId,
      subscription,
      listingCreatedAt: listing.createdAt,
      firstReviewCompletedAt: listing.firstReviewCompletedAt,
    });

    // Step 12c: Update listing status to ONLINE with slot info
    await docClient.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: {
          pk: `HOST#${hostId}`,
          sk: `LISTING_META#${listingId}`,
        },
        UpdateExpression: 'SET #status = :online, activeSlotId = :slotId, slotExpiresAt = :expiresAt, #updatedAt = :now',
        ExpressionAttributeNames: {
          '#status': 'status',
          '#updatedAt': 'updatedAt',
        },
        ExpressionAttributeValues: {
          ':online': 'ONLINE',
          ':slotId': slot.slotId,
          ':expiresAt': slot.expiresAt,
          ':now': now,
        },
      })
    );

    console.log('Listing status updated to ONLINE with slot info');

    // Step 12d: Increment location listings count for ALL name variants
    // This is done outside the transaction to avoid transaction size limits
    // and because it's not critical if it fails (can be fixed with a script)
    // Order: COUNTRY, PLACE, LOCALITY (if exists)
    
    // Increment country count if we have country ID
    if (countryId) {
      await incrementLocationListingsCount(countryId, now);
    }
    
    // Increment place count
    await incrementLocationListingsCount(placeId, now);
    
    // If locality exists, also increment its listings count
    if (hasLocality && localityId) {
      await incrementLocationListingsCount(localityId, now);
    }

    // Step 13: Return success
    const responseData: PublishListingResponse = {
      message: 'Listing published successfully',
      listingId: listingId,
      locationId: placeId,
      status: 'ONLINE',
      slotId: slot.slotId,
      slotExpiresAt: slot.expiresAt,
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
    !listing.capacity?.beds ||
    listing.capacity?.bedrooms === undefined ||
    !listing.capacity?.bathrooms ||
    !listing.capacity?.sleeps
  ) {
    return 'Missing capacity information (beds, bedrooms, bathrooms, sleeps required)';
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

/**
 * Ensure location exists in Locations table, create if not
 * 
 * Supports three location types in hierarchy: COUNTRY > PLACE > LOCALITY
 * 
 * Note: Multiple name variants can exist for the same location (e.g., "Belgrade" and "Beograd")
 * This function checks if ANY name variant exists for this locationId, and creates one if not.
 */
async function ensureLocationExists(locationData: {
  locationId: string;           // The mapbox ID for this location
  locationName: string;         // The name of this location
  locationType: 'COUNTRY' | 'PLACE' | 'LOCALITY';
  countryName: string;
  countryCode: string;
  // For PLACE and LOCALITY
  regionName?: string;
  regionId?: string;
  // For PLACE - parent country reference
  parentCountryId?: string;
  // For LOCALITY - parent place reference
  parentPlaceId?: string;
  parentPlaceName?: string;
}): Promise<void> {
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
    // This name variant already exists, no need to create
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

  // Generate slug based on location type
  let slug: string;
  if (locationType === 'COUNTRY') {
    // Country slug is just the country code (e.g., "rs" for Serbia)
    slug = countryCode.toLowerCase();
  } else {
    // Place and Locality use name-countrycode format
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
  const now = new Date().toISOString();
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
    entityType: 'LOCATION', // Constant for GSI partition key

    listingsCount: existingListingsCount, // Inherit from existing variants

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

  console.log(`Created new ${locationType} location: "${locationName}" (${locationId})`);
}

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

/**
 * Generate location slug: "place-name-countrycode" (e.g., "zlatibor-rs")
 */
function generateLocationSlug(name: string, countryCode: string): string {
  const normalize = (str: string) =>
    str
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '') // Remove diacritics
      .replace(/[^a-z0-9\s-]/g, '') // Remove special chars
      .replace(/\s+/g, '-') // Replace spaces with hyphens
      .replace(/-+/g, '-') // Replace multiple hyphens with single
      .replace(/^-|-$/g, ''); // Remove leading/trailing hyphens

  return `${normalize(name)}-${countryCode.toLowerCase()}`;
}

/**
 * Generate search name: "placename regionname" (lowercase, space-separated)
 */
function generateSearchName(name: string, regionName: string): string {
  return `${name.toLowerCase()} ${regionName.toLowerCase()}`;
}

/**
 * Increment listingsCount for ALL name variants of a location
 * This ensures all variants (e.g., "Belgrade" and "Beograd") have the same count
 */
async function incrementLocationListingsCount(placeId: string, timestamp: string): Promise<void> {
  try {
    // Query all name variants for this location
    const variants = await docClient.send(
      new QueryCommand({
        TableName: LOCATIONS_TABLE_NAME,
        KeyConditionExpression: 'pk = :pk',
        ExpressionAttributeValues: {
          ':pk': `LOCATION#${placeId}`,
        },
      })
    );

    if (!variants.Items || variants.Items.length === 0) {
      console.warn(`No location variants found for placeId: ${placeId}`);
      return;
    }

    console.log(`Incrementing listingsCount for ${variants.Items.length} name variant(s) of location ${placeId}`);

    // Update each variant
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

    console.log(`Successfully incremented listingsCount for all variants`);
  } catch (error) {
    console.error(`Failed to increment location listings count for ${placeId}:`, error);
    // Don't throw - this is not critical
  }
}


