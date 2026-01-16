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
import { DynamoDBDocumentClient, GetCommand, QueryCommand, TransactWriteCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import * as response from '../lib/response';
import { checkAndIncrementWriteOperationRateLimit, extractUserId } from '../lib/write-operation-rate-limiter';
import { buildPublicListingMediaPK } from '../../types/public-listing-media.types';

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

const TABLE_NAME = process.env.TABLE_NAME!;
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

    // Check rate limit
    const userId = extractUserId(event);
    if (!userId) {
      return response.unauthorized('User ID not found');
    }

    const rateLimitCheck = await checkAndIncrementWriteOperationRateLimit(userId, 'listing-unpublish');
    if (!rateLimitCheck.allowed) {
      console.warn('Rate limit exceeded for listing unpublish:', { userId, hostId, listingId });
      return response.tooManyRequests(rateLimitCheck.message || 'Rate limit exceeded');
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

    // Step 6: Execute transaction (all succeed or all fail)
    console.log(`Unpublishing listing with ${transactItems.length} transaction items (listing records + ${mediaRecords.length} images)`);
    
    await docClient.send(
      new TransactWriteCommand({
        TransactItems: transactItems,
      })
    );

    console.log('Public listing records deleted successfully via transaction');

    // Step 6b: Update listing status to OFFLINE
    // Note: The advertising slot remains active and continues to count against tokens.
    // The host can bring the listing back online while the slot is still active.
    // The slot will be extended at subscription renewal unless explicitly marked as doNotRenew.
    await docClient.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: {
          pk: `HOST#${hostId}`,
          sk: `LISTING_META#${listingId}`,
        },
        UpdateExpression: 'SET #status = :offline, gsi2pk = :gsi2pk, gsi2sk = :gsi2sk, #updatedAt = :now',
        ExpressionAttributeNames: {
          '#status': 'status',
          '#updatedAt': 'updatedAt',
        },
        ExpressionAttributeValues: {
          ':offline': 'OFFLINE',
          ':gsi2pk': 'LISTING_STATUS#OFFLINE',
          ':gsi2sk': now,
          ':now': now,
        },
      })
    );

    console.log('Listing status updated to OFFLINE');

    // Note: listingsCount is NOT decremented here - unpublishing doesn't remove the listing,
    // it just takes it offline. The count represents total listings in a location, not just published ones.
    // Count is only decremented when a listing is deleted.

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

// Note: decrementLocationListingsCount has been removed from this file.
// Location count is only decremented when a listing is deleted, not when unpublished.
