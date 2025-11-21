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

    // Step 3: Validate listing eligibility
    const validationError = validateListingForPublish(listing, images);
    if (validationError) {
      return response.badRequest(validationError);
    }

    // Step 4: Check if already online
    if (listing.status === 'ONLINE') {
      return response.badRequest('Listing is already online');
    }

    // Step 5: Extract location data
    const placeId = listing.mapboxMetadata!.place!.mapbox_id;
    const placeName = listing.mapboxMetadata!.place!.name;
    const regionName = listing.mapboxMetadata!.region!.name;
    const regionId = listing.mapboxMetadata!.region!.mapbox_id;
    const countryName = listing.address.country;
    const countryCode = listing.address.countryCode;

    // Step 6: Check/create location
    await ensureLocationExists({
      placeId,
      placeName,
      regionName,
      regionId,
      countryName,
      countryCode,
    });

    // Step 7: Derive boolean filters from amenities
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

    // Step 8: Get primary image thumbnail
    const primaryImage = images.find((img: any) => img.isPrimary);
    if (!primaryImage || !primaryImage.webpUrls?.thumbnail) {
      return response.badRequest('No primary image with thumbnail found');
    }

    // Step 9: Generate short description
    const shortDescription =
      listing.description.length > 100
        ? listing.description.substring(0, 100).trim() + '...'
        : listing.description;

    // Step 10: Sort images by displayOrder and prepare media records
    const sortedImages = images.sort((a, b) => a.displayOrder - b.displayOrder);
    
    // Step 11: Build transaction items
    const now = new Date().toISOString();
    const transactItems: any[] = [];

    // 11a. Create PublicListing record
    const publicListing = {
      pk: `LOCATION#${placeId}`,
      sk: `LISTING#${listingId}`,

      listingId: listingId,
      locationId: placeId,

      name: listing.listingName,
      shortDescription: shortDescription,
      placeName: placeName,
      regionName: regionName,

      maxGuests: listing.capacity.sleeps,
      bedrooms: listing.capacity.bedrooms,
      beds: listing.capacity.beds,
      bathrooms: listing.capacity.bathrooms,

      thumbnailUrl: primaryImage.webpUrls.thumbnail,

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

      createdAt: now,
      updatedAt: now,
    };

    transactItems.push({
      Put: {
        TableName: PUBLIC_LISTINGS_TABLE_NAME,
        Item: publicListing,
      },
    });

    // 11b. Create PublicListingMedia records for all images
    sortedImages.forEach((image, index) => {
      const mediaRecord = {
        pk: buildPublicListingMediaPK(listingId),
        sk: buildPublicListingMediaSK(index),

        listingId: listingId,
        imageIndex: index,

        url: image.webpUrls.full,
        thumbnailUrl: image.webpUrls.thumbnail,

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

    // 11d. Increment location listings count
    transactItems.push({
      Update: {
        TableName: LOCATIONS_TABLE_NAME,
        Key: {
          pk: `LOCATION#${placeId}`,
          sk: 'META',
        },
        UpdateExpression: 'ADD listingsCount :inc SET updatedAt = :now',
        ExpressionAttributeValues: {
          ':inc': 1,
          ':now': now,
        },
      },
    });

    // Step 12: Execute transaction (all succeed or all fail)
    console.log(`Publishing listing with ${transactItems.length} transaction items (1 listing + ${sortedImages.length} images + 2 updates)`);
    
    await docClient.send(
      new TransactWriteCommand({
        TransactItems: transactItems,
      })
    );

    console.log('Listing published successfully via transaction');

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
 */
async function ensureLocationExists(locationData: {
  placeId: string;
  placeName: string;
  regionName: string;
  regionId: string;
  countryName: string;
  countryCode: string;
}): Promise<void> {
  const { placeId, placeName, regionName, regionId, countryName, countryCode } = locationData;

  // Check if location exists
  const existingLocation = await docClient.send(
    new GetCommand({
      TableName: LOCATIONS_TABLE_NAME,
      Key: {
        pk: `LOCATION#${placeId}`,
        sk: 'META',
      },
    })
  );

  if (existingLocation.Item) {
    // Location already exists, no need to create
    return;
  }

  // Generate slug and searchName
  const slug = generateLocationSlug(placeName, countryCode);
  const searchName = generateSearchName(placeName, regionName);

  // Create new location
  const now = new Date().toISOString();
  const newLocation = {
    pk: `LOCATION#${placeId}`,
    sk: 'META',

    locationId: placeId,
    locationType: 'PLACE',
    name: placeName,
    regionName: regionName,
    countryName: countryName,

    mapboxPlaceId: placeId,
    mapboxRegionId: regionId,

    slug: slug,
    searchName: searchName,
    isSearchable: true,

    listingsCount: 0, // Will be incremented after publishing

    createdAt: now,
    updatedAt: now,
  };

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


