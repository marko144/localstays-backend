/**
 * Admin API: Get Listings for Specific Host
 * 
 * GET /api/v1/admin/hosts/{hostId}/listings?page=<page>
 * 
 * Returns paginated list of all listings for a specific host.
 * Sorted by oldest submitted first.
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
 * Get host name
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
function toListingSummary(listing: ListingMetadata, hostName: string): ListingSummary {
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
  console.log('Get host listings request:', { 
    pathParameters: event.pathParameters,
    queryParams: event.queryStringParameters,
  });

  try {
    // 1. Require admin permission
    const authResult = requirePermission(event, 'ADMIN_LISTING_VIEW_ALL');
    if ('error' in authResult) {
      return authResult.error;
    }

    const { user } = authResult;

    // 2. Extract hostId from path
    const hostId = event.pathParameters?.hostId;

    if (!hostId) {
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
            message: 'hostId is required',
          },
        }),
      };
    }

    console.log(`Admin ${user.email} viewing listings for host: ${hostId}`);

    // 3. Parse pagination params
    const { page, limit } = parsePaginationParams(event.queryStringParameters || {});

    // 4. Query all listings for this host
    const result = await docClient.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :sk)',
        FilterExpression: 'isDeleted = :isDeleted',
        ExpressionAttributeValues: {
          ':pk': `HOST#${hostId}`,
          ':sk': 'LISTING_META#',
          ':isDeleted': false,
        },
      })
    );

    const listings = (result.Items || []) as ListingMetadata[];

    console.log(`Found ${listings.length} listings for host ${hostId}`);

    // 5. Get host name once
    const hostName = await getHostName(hostId);

    // 6. Convert to summary format
    const listingSummaries = listings.map(listing => toListingSummary(listing, hostName));

    // 7. Sort by submittedAt (oldest first)
    listingSummaries.sort((a, b) => {
      const aDate = a.submittedAt ? new Date(a.submittedAt).getTime() : new Date(a.createdAt).getTime();
      const bDate = b.submittedAt ? new Date(b.submittedAt).getTime() : new Date(b.createdAt).getTime();
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
    console.error('❌ Get host listings error:', error);

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
          message: 'Failed to fetch host listings',
        },
      }),
    };
  }
};















