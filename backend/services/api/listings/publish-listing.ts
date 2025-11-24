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
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import * as response from '../lib/response';
import { buildPublicListingMediaPK, buildPublicListingMediaSK } from '../../types/public-listing-media.types';
import { buildCloudFrontUrl } from '../lib/cloudfront-urls';

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

    // Step 4: Validate listing eligibility
    const validationError = validateListingForPublish(listing, images);
    if (validationError) {
      return response.badRequest(validationError);
    }

    // Step 5: Check if already online
    if (listing.status === 'ONLINE') {
      return response.badRequest('Listing is already online');
    }

    // Step 6: Extract location data
    const placeId = listing.mapboxMetadata!.place!.mapbox_id;
    const placeName = listing.mapboxMetadata!.place!.name;
    const regionName = listing.mapboxMetadata!.region!.name;
    const regionId = listing.mapboxMetadata!.region!.mapbox_id;
    const countryName = listing.address.country;
    const countryCode = listing.address.countryCode;

    // Check if locality exists
    const hasLocality = listing.mapboxMetadata?.locality?.mapbox_id && listing.mapboxMetadata?.locality?.name;
    const localityId = hasLocality ? listing.mapboxMetadata.locality.mapbox_id : null;
    const localityName = hasLocality ? listing.mapboxMetadata.locality.name : null;

    // Step 7: Check/create location(s)
    // Always create/check PLACE location
    await ensureLocationExists({
      placeId,
      placeName,
      regionName,
      regionId,
      countryName,
      countryCode,
      locationType: 'PLACE',
    });

    // If locality exists, also create/check LOCALITY location
    if (hasLocality && localityId && localityName) {
      await ensureLocationExists({
        placeId: localityId,
        placeName: localityName,
        regionName: regionName,
        regionId: regionId,
        countryName: countryName,
        countryCode: countryCode,
        locationType: 'LOCALITY',
        parentPlaceName: placeName, // Store parent place name for display
        parentPlaceId: placeId, // Store parent place ID
      });
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

      instantBook: false, // Default to false
      hostVerified: hostVerified, // Sync from host profile

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

        caption: image.caption || undefined,
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

    // 11c. Update listing status to ONLINE
    transactItems.push({
      Update: {
        TableName: TABLE_NAME,
        Key: {
          pk: `HOST#${hostId}`,
          sk: `LISTING_META#${listingId}`,
        },
        UpdateExpression: 'SET #status = :online, #updatedAt = :now',
        ExpressionAttributeNames: {
          '#status': 'status',
          '#updatedAt': 'updatedAt',
        },
        ExpressionAttributeValues: {
          ':online': 'ONLINE',
          ':now': now,
        },
      },
    });

    // Step 12: Execute transaction (all succeed or all fail)
    console.log(`Publishing listing with ${transactItems.length} transaction items (1 listing + ${sortedImages.length} images + 1 status update)`);
    
    await docClient.send(
      new TransactWriteCommand({
        TransactItems: transactItems,
      })
    );

    console.log('Listing published successfully via transaction');

    // Step 12b: Increment location listings count for ALL name variants
    // This is done outside the transaction to avoid transaction size limits
    // and because it's not critical if it fails (can be fixed with a script)
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

  // Mapbox metadata check
  if (!listing.mapboxMetadata?.place?.mapbox_id || !listing.mapboxMetadata?.place?.name) {
    return 'Missing place information (mapbox place ID and name required)';
  }

  if (!listing.mapboxMetadata?.region?.mapbox_id || !listing.mapboxMetadata?.region?.name) {
    return 'Missing region information (mapbox region ID and name required)';
  }

  // Address check
  if (!listing.address?.country || !listing.address?.countryCode) {
    return 'Missing country information';
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
 * Note: Multiple name variants can exist for the same location (e.g., "Belgrade" and "Beograd")
 * This function checks if ANY name variant exists for this placeId, and creates one if not.
 */
async function ensureLocationExists(locationData: {
  placeId: string;
  placeName: string;
  regionName: string;
  regionId: string;
  countryName: string;
  countryCode: string;
  locationType: 'PLACE' | 'LOCALITY';
  parentPlaceName?: string;
  parentPlaceId?: string;
}): Promise<void> {
  const { 
    placeId, 
    placeName, 
    regionName, 
    regionId, 
    countryName, 
    countryCode, 
    locationType,
    parentPlaceName,
    parentPlaceId,
  } = locationData;

  // Check if this specific name variant exists
  const existingLocation = await docClient.send(
    new GetCommand({
      TableName: LOCATIONS_TABLE_NAME,
      Key: {
        pk: `LOCATION#${placeId}`,
        sk: `NAME#${placeName}`,
      },
    })
  );

  if (existingLocation.Item) {
    // This name variant already exists, no need to create
    return;
  }

  // Check if ANY name variant exists for this location (to get listingsCount)
  const anyVariant = await docClient.send(
    new QueryCommand({
      TableName: LOCATIONS_TABLE_NAME,
      KeyConditionExpression: 'pk = :pk',
      ExpressionAttributeValues: {
        ':pk': `LOCATION#${placeId}`,
      },
      Limit: 1,
    })
  );

  const existingListingsCount = anyVariant.Items?.[0]?.listingsCount || 0;

  // Generate slug and searchName
  const slug = generateLocationSlug(placeName, countryCode);
  const searchName = generateSearchName(placeName, regionName);

  // Generate displayName based on locationType
  let displayName: string;
  if (locationType === 'LOCALITY' && parentPlaceName) {
    displayName = `${placeName}, ${parentPlaceName}`;
  } else {
    displayName = placeName;
  }

  // Create new location name variant
  const now = new Date().toISOString();
  const newLocation: any = {
    pk: `LOCATION#${placeId}`,
    sk: `NAME#${placeName}`,

    locationId: placeId,
    locationType: locationType,
    name: placeName,
    displayName: displayName,
    regionName: regionName,
    countryName: countryName,

    mapboxPlaceId: locationType === 'PLACE' ? placeId : (parentPlaceId || placeId),
    mapboxRegionId: regionId,

    slug: slug,
    searchName: searchName,
    entityType: 'LOCATION', // Constant for GSI partition key

    listingsCount: existingListingsCount, // Inherit from existing variants

    createdAt: now,
    updatedAt: now,
  };

  // Add optional fields for LOCALITY
  if (locationType === 'LOCALITY') {
    newLocation.mapboxLocalityId = placeId;
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
    const { UpdateCommand } = await import('@aws-sdk/lib-dynamodb');
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


