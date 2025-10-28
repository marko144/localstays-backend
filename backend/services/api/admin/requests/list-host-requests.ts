/**
 * Admin API: Get Requests for Specific Host
 * 
 * GET /api/v1/admin/hosts/{hostId}/requests?page=<page>
 * 
 * Returns paginated list of all requests for a specific host.
 * Permission required: ADMIN_REQUEST_VIEW_ALL
 */

import { APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { requirePermission } from '../../lib/auth-middleware';
import { parsePaginationParams, paginateArray } from '../../lib/pagination';
import { RequestSummary } from '../../../types/admin.types';
import { Request } from '../../../types/request.types';
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
 * Get listing name by ID
 */
async function getListingName(listingId: string): Promise<string> {
  try {
    const result = await docClient.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: {
          pk: `LISTING#${listingId}`,
          sk: 'META',
        },
      })
    );

    if (!result.Item) {
      return 'Unnamed Listing';
    }

    return result.Item.listingName || 'Unnamed Listing';
  } catch (error) {
    console.error(`Failed to fetch listing ${listingId}:`, error);
    return 'Unnamed Listing';
  }
}

/**
 * Get all listings for a host
 */
async function getHostListings(hostId: string): Promise<string[]> {
  try {
    const result = await docClient.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :sk)',
        ExpressionAttributeValues: {
          ':pk': `HOST#${hostId}`,
          ':sk': 'LISTING_META#',
        },
      })
    );

    if (!result.Items || result.Items.length === 0) {
      return [];
    }

    return result.Items.map(item => item.listingId as string).filter(Boolean);
  } catch (error) {
    console.error(`Failed to fetch listings for host ${hostId}:`, error);
    return [];
  }
}

/**
 * Convert Request to RequestSummary
 */
async function toRequestSummary(request: Request, hostName: string): Promise<RequestSummary> {
  const summary: RequestSummary = {
    requestId: request.requestId,
    requestType: request.requestType,
    status: request.status,
    hostId: request.hostId,
    hostName,
    createdAt: request.createdAt,
    uploadedAt: request.uploadedAt,
  };

  // Add listing info for listing-level requests
  if (request.listingId) {
    summary.listingId = request.listingId;
    summary.listingName = await getListingName(request.listingId);
  }

  return summary;
}

/**
 * Main handler
 */
export const handler: APIGatewayProxyHandler = async (event) => {
  console.log('Get host requests request:', { 
    pathParameters: event.pathParameters,
    queryParams: event.queryStringParameters,
  });

  try {
    // 1. Require admin permission
    const authResult = requirePermission(event, 'ADMIN_REQUEST_VIEW_ALL');
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

    console.log(`Admin ${user.email} viewing requests for host: ${hostId}`);

    // 3. Parse pagination params
    const { page, limit } = parsePaginationParams(event.queryStringParameters || {});

    // 4. Get host name once
    const hostName = await getHostName(hostId);

    // 5. Query host-level requests (LIVE_ID_CHECK)
    const hostRequestsResult = await docClient.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :sk)',
        ExpressionAttributeValues: {
          ':pk': `HOST#${hostId}`,
          ':sk': 'REQUEST#',
        },
      })
    );

    const hostRequests = (hostRequestsResult.Items || []) as Request[];
    console.log(`Found ${hostRequests.length} host-level requests for host ${hostId}`);

    // 6. Get all listings for this host
    const listingIds = await getHostListings(hostId);
    console.log(`Found ${listingIds.length} listings for host ${hostId}`);

    // 7. Query listing-level requests (ADDRESS_VERIFICATION, PROPERTY_VIDEO_VERIFICATION)
    const listingRequestsPromises = listingIds.map(listingId =>
      docClient.send(
        new QueryCommand({
          TableName: TABLE_NAME,
          KeyConditionExpression: 'pk = :pk AND begins_with(sk, :sk)',
          ExpressionAttributeValues: {
            ':pk': `LISTING#${listingId}`,
            ':sk': 'REQUEST#',
          },
        })
      )
    );

    const listingRequestsResults = await Promise.all(listingRequestsPromises);
    const listingRequests = listingRequestsResults.flatMap(result => (result.Items || [])) as Request[];
    console.log(`Found ${listingRequests.length} listing-level requests for host ${hostId}`);

    // 8. Combine all requests
    const allRequests = [...hostRequests, ...listingRequests];
    console.log(`Total ${allRequests.length} requests for host ${hostId}`);

    // 9. Convert to summary format
    const requestSummaries = await Promise.all(
      allRequests.map(request => toRequestSummary(request, hostName))
    );

    // 10. Sort by createdAt (newest first)
    requestSummaries.sort((a, b) => 
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    // 11. Paginate
    const resultData = paginateArray(requestSummaries, page, limit);

    console.log(`✅ Returning ${resultData.items.length} requests (page ${page}, total ${resultData.pagination.total})`);

    // 12. Return response
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
    console.error('❌ Get host requests error:', error);

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
          message: 'Failed to fetch host requests',
        },
      }),
    };
  }
};















