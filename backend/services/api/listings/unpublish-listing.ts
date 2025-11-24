/**
 * Unpublish Listing Handler
 * 
 * POST /api/v1/hosts/{hostId}/listings/{listingId}/unpublish
 * 
 * Unpublishes an ONLINE listing from the PublicListings table.
 * Sets listing status to OFFLINE and decrements location listings count.
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, QueryCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import * as response from '../lib/response';
import { buildPublicListingMediaPK } from '../../types/public-listing-media.types';

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

const TABLE_NAME = process.env.TABLE_NAME!;
const LOCATIONS_TABLE_NAME = process.env.LOCATIONS_TABLE_NAME!;
const PUBLIC_LISTINGS_TABLE_NAME = process.env.PUBLIC_LISTINGS_TABLE_NAME!;
const PUBLIC_LISTING_MEDIA_TABLE_NAME = process.env.PUBLIC_LISTING_MEDIA_TABLE_NAME!;

interface UnpublishListingResponse {
  message: string;
  listingId: string;
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
      return response.forbidden('Only hosts can unpublish listings');
    }

    // Step 1: Fetch listing metadata
    const listing = await fetchListing(hostId, listingId);
    if (!listing) {
      return response.notFound('Listing not found');
    }

    // Step 2: Validate listing is ONLINE
    if (listing.status !== 'ONLINE') {
      return response.badRequest(
        `Listing must be ONLINE to unpublish. Current status: ${listing.status}`
      );
    }

    // Step 3: Get location IDs from listing
    const placeId = listing.mapboxMetadata?.place?.mapbox_id;
    if (!placeId) {
      return response.badRequest('Missing location information on listing');
    }

    // Check if locality exists
    const hasLocality = listing.mapboxMetadata?.locality?.mapbox_id;
    const localityId = hasLocality ? listing.mapboxMetadata.locality.mapbox_id : null;
    const localityName = hasLocality ? listing.mapboxMetadata.locality.name : null;

    // Step 4: Fetch all media records for this listing
    const mediaRecords = await fetchPublicListingMedia(listingId);

    // Step 5: Build transaction items
    const now = new Date().toISOString();
    const transactItems: any[] = [];

    // 5a. Delete PublicListing record(s)
    // Always delete PLACE listing record
    transactItems.push({
      Delete: {
        TableName: PUBLIC_LISTINGS_TABLE_NAME,
        Key: {
          pk: `LOCATION#${placeId}`,
          sk: `LISTING#${listingId}`,
        },
      },
    });

    // If locality exists, also delete LOCALITY listing record
    if (hasLocality && localityId) {
      transactItems.push({
        Delete: {
          TableName: PUBLIC_LISTINGS_TABLE_NAME,
          Key: {
            pk: `LOCATION#${localityId}`,
            sk: `LISTING#${listingId}`,
          },
        },
      });
      console.log(`Deleting dual listing records: PLACE and LOCALITY (${localityName})`);
    } else {
      console.log(`Deleting single listing record: PLACE only`);
    }

    // 5b. Delete all PublicListingMedia records
    mediaRecords.forEach((media) => {
      transactItems.push({
        Delete: {
          TableName: PUBLIC_LISTING_MEDIA_TABLE_NAME,
          Key: {
            pk: media.pk,
            sk: media.sk,
          },
        },
      });
    });

    // 5c. Update listing status to OFFLINE
    transactItems.push({
      Update: {
        TableName: TABLE_NAME,
        Key: {
          pk: `HOST#${hostId}`,
          sk: `LISTING_META#${listingId}`,
        },
        UpdateExpression: 'SET #status = :offline, #updatedAt = :now',
        ExpressionAttributeNames: {
          '#status': 'status',
          '#updatedAt': 'updatedAt',
        },
        ExpressionAttributeValues: {
          ':offline': 'OFFLINE',
          ':now': now,
        },
      },
    });

    // Step 6: Execute transaction (all succeed or all fail)
    console.log(`Unpublishing listing with ${transactItems.length} transaction items (1 listing + ${mediaRecords.length} images + 1 status update)`);
    
    await docClient.send(
      new TransactWriteCommand({
        TransactItems: transactItems,
      })
    );

    console.log('Listing unpublished successfully via transaction');

    // Step 6b: Decrement location listings count for ALL name variants
    // This is done outside the transaction to avoid transaction size limits
    await decrementLocationListingsCount(placeId, now);
    
    // If locality exists, also decrement its listings count
    if (hasLocality && localityId) {
      await decrementLocationListingsCount(localityId, now);
    }

    // Step 7: Return success
    const responseData: UnpublishListingResponse = {
      message: 'Listing unpublished successfully',
      listingId: listingId,
      status: 'OFFLINE',
    };

    return response.success(responseData);
  } catch (error) {
    console.error('Error unpublishing listing:', error);
    return response.internalError('Failed to unpublish listing', error as Error);
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
 * Fetch all media records for a published listing
 */
async function fetchPublicListingMedia(listingId: string): Promise<any[]> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: PUBLIC_LISTING_MEDIA_TABLE_NAME,
      KeyConditionExpression: 'pk = :pk',
      ExpressionAttributeValues: {
        ':pk': buildPublicListingMediaPK(listingId),
      },
    })
  );

  return result.Items || [];
}

/**
 * Decrement listingsCount for ALL name variants of a location
 * This ensures all variants (e.g., "Belgrade" and "Beograd") have the same count
 */
async function decrementLocationListingsCount(placeId: string, timestamp: string): Promise<void> {
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

    console.log(`Decrementing listingsCount for ${variants.Items.length} name variant(s) of location ${placeId}`);

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
          UpdateExpression: 'ADD listingsCount :dec SET updatedAt = :now',
          ExpressionAttributeValues: {
            ':dec': -1,
            ':now': timestamp,
          },
        })
      );
    }

    console.log(`Successfully decremented listingsCount for all variants`);
  } catch (error) {
    console.error(`Failed to decrement location listings count for ${placeId}:`, error);
    // Don't throw - this is not critical
  }
}


