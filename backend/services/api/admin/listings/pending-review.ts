/**
 * Admin API: Get Listings Pending Review
 * 
 * GET /api/v1/admin/listings/pending-review?page=<page>
 * 
 * Returns paginated list of listings awaiting approval (status = IN_REVIEW or REVIEWING).
 * Sorted by oldest submitted first (FIFO queue).
 * Permission required: ADMIN_LISTING_VIEW_ALL
 */

import { APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { requirePermission } from '../../lib/auth-middleware';
import { parsePaginationParams, paginateArray } from '../../lib/pagination';
import { ListingSummary } from '../../../types/admin.types';
import { ListingMetadata } from '../../../types/listing.types';
import { Host, isIndividualHost } from '../../../types/host.types';

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

const TABLE_NAME = process.env.TABLE_NAME!;

/**
 * Get host name for a listing
 */
async function getHostName(hostId: string): Promise<string> {
  try {
    const result = await docClient.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: {
          pk: `HOST#${hostId}`,
          sk: 'META',
        },
      })
    );

    if (!result.Item) {
      return 'Unknown Host';
    }

    const host = result.Item as Host;
    
    if (isIndividualHost(host)) {
      return `${host.forename} ${host.surname}`;
    } else {
      return host.legalName || host.displayName || host.businessName || 'Unknown Business';
    }
  } catch (error) {
    console.error(`Failed to fetch host ${hostId}:`, error);
    return 'Unknown Host';
  }
}

/**
 * Convert ListingMetadata to ListingSummary
 */
async function toListingSummary(listing: ListingMetadata): Promise<ListingSummary> {
  const hostName = await getHostName(listing.hostId);

  return {
    listingId: listing.listingId,
    listingName: listing.listingName,
    propertyType: listing.propertyType,
    status: listing.status,
    hostId: listing.hostId,
    hostName,
    createdAt: listing.createdAt,
    submittedAt: listing.submittedAt,
    primaryImageUrl: undefined,
  };
}

/**
 * Main handler
 */
export const handler: APIGatewayProxyHandler = async (event) => {
  console.log('Get pending review listings request:', { queryParams: event.queryStringParameters });

  try {
    // 1. Require admin permission
    const authResult = requirePermission(event, 'ADMIN_LISTING_VIEW_ALL');
    if ('error' in authResult) {
      return authResult.error;
    }

    const { user } = authResult;
    console.log(`Admin ${user.email} viewing pending review listings`);

    // 2. Parse pagination params
    const { page, limit } = parsePaginationParams(event.queryStringParameters || {});

    // 3. Query GSI2 for listings with status = IN_REVIEW
    const inReviewResult = await docClient.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        IndexName: 'StatusIndex',
        KeyConditionExpression: 'gsi2pk = :gsi2pk',
        FilterExpression: 'isDeleted = :isDeleted',
        ExpressionAttributeValues: {
          ':gsi2pk': 'LISTING_STATUS#IN_REVIEW',
          ':isDeleted': false,
        },
      })
    );

    // 4. Query GSI2 for listings with status = REVIEWING
    const reviewingResult = await docClient.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        IndexName: 'StatusIndex',
        KeyConditionExpression: 'gsi2pk = :gsi2pk',
        FilterExpression: 'isDeleted = :isDeleted',
        ExpressionAttributeValues: {
          ':gsi2pk': 'LISTING_STATUS#REVIEWING',
          ':isDeleted': false,
        },
      })
    );

    // 5. Merge results
    const listings = [
      ...(inReviewResult.Items || []),
      ...(reviewingResult.Items || []),
    ] as ListingMetadata[];

    console.log(`Found ${listings.length} listings pending review (${inReviewResult.Items?.length || 0} IN_REVIEW, ${reviewingResult.Items?.length || 0} REVIEWING)`);

    // 6. Convert to summary format (includes fetching host names)
    const listingSummaries = await Promise.all(
      listings.map(listing => toListingSummary(listing))
    );

    // 7. Sort by submittedAt (oldest first - FIFO queue)
    listingSummaries.sort((a, b) => {
      const aDate = a.submittedAt ? new Date(a.submittedAt).getTime() : 0;
      const bDate = b.submittedAt ? new Date(b.submittedAt).getTime() : 0;
      return aDate - bDate; // Oldest first
    });

    // 8. Paginate
    const resultData = paginateArray(listingSummaries, page, limit);

    console.log(`✅ Returning ${resultData.items.length} listings (page ${page}, total ${resultData.pagination.total})`);

    // 9. Return response
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        success: true,
        data: resultData,
      }),
    };
  } catch (error) {
    console.error('❌ Get pending review listings error:', error);

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
          message: 'Failed to fetch pending review listings',
        },
      }),
    };
  }
};




