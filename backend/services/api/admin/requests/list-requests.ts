/**
 * Admin API: List All Requests
 * 
 * GET /api/v1/admin/requests?page=<page>&status=<status>&type=<type>
 * 
 * Returns paginated list of all requests with headline data.
 * Optional status and type filters.
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
 * Get host name for a request
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
      new QueryCommand({
        TableName: TABLE_NAME,
        IndexName: 'DocumentStatusIndex',
        KeyConditionExpression: 'gsi3pk = :gsi3pk',
        ExpressionAttributeValues: {
          ':gsi3pk': `LISTING#${listingId}`,
        },
        Limit: 1,
      })
    );

    if (result.Items && result.Items[0]) {
      return result.Items[0].listingName || 'Unnamed Listing';
    }
    return 'Unknown Listing';
  } catch (error) {
    console.error(`Failed to fetch listing ${listingId}:`, error);
    return 'Unknown Listing';
  }
}

/**
 * Convert Request to RequestSummary
 */
async function toRequestSummary(request: Request): Promise<RequestSummary> {
  const hostName = await getHostName(request.hostId);
  
  // Fetch listing name for listing-level requests
  let listingName: string | undefined;
  if (request.listingId) {
    listingName = await getListingName(request.listingId);
  }

  return {
    requestId: request.requestId,
    requestType: request.requestType,
    status: request.status,
    hostId: request.hostId,
    hostName,
    createdAt: request.createdAt,
    uploadedAt: request.uploadedAt,
    listingId: request.listingId,
    listingName,
  };
}

/**
 * Main handler
 */
export const handler: APIGatewayProxyHandler = async (event) => {
  console.log('List requests request:', { queryParams: event.queryStringParameters });

  try {
    // 1. Require admin permission
    const authResult = requirePermission(event, 'ADMIN_REQUEST_VIEW_ALL');
    if ('error' in authResult) {
      return authResult.error;
    }

    const { user } = authResult;
    console.log(`Admin ${user.email} listing all requests`);

    // 2. Parse pagination params and optional filters
    const { page, limit } = parsePaginationParams(event.queryStringParameters || {});
    const statusFilter = event.queryStringParameters?.status;
    const typeFilter = event.queryStringParameters?.type;

    // 3. Query GSI2 for all request types (NO SCAN!)
    // GSI2 pattern: gsi2pk = "REQUEST#<type>", gsi2sk = "STATUS#<status>#<createdAt>"
    // Determine which types to query
    const requestTypes = typeFilter 
      ? [typeFilter] 
      : ['LIVE_ID_CHECK', 'PROPERTY_VIDEO_VERIFICATION', 'ADDRESS_VERIFICATION'];

    // Query each request type from GSI2
    const queryPromises = requestTypes.map(requestType => {
      const query: any = {
        TableName: TABLE_NAME,
        IndexName: 'StatusIndex',
        KeyConditionExpression: 'gsi2pk = :gsi2pk',
        ExpressionAttributeValues: {
          ':gsi2pk': `REQUEST#${requestType}`,
        },
      };

      // If status filter provided, add to sort key condition
      if (statusFilter) {
        query.KeyConditionExpression += ' AND begins_with(gsi2sk, :statusPrefix)';
        query.ExpressionAttributeValues[':statusPrefix'] = `STATUS#${statusFilter}#`;
      }

      return docClient.send(new QueryCommand(query));
    });

    const results = await Promise.all(queryPromises);

    // Combine all requests from all types
    const requests = results.flatMap(result => (result.Items || [])) as Request[];

    console.log(`Found ${requests.length} requests${statusFilter ? ` with status ${statusFilter}` : ''}${typeFilter ? ` and type ${typeFilter}` : ''}`);

    // 4. Convert to summary format (includes fetching host names)
    const requestSummaries = await Promise.all(
      requests.map(request => toRequestSummary(request))
    );

    // 5. Sort by createdAt (newest first)
    requestSummaries.sort((a, b) => 
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    // 6. Paginate
    const result = paginateArray(requestSummaries, page, limit);

    console.log(`✅ Returning ${result.items.length} requests (page ${page}, total ${result.pagination.total})`);

    // 7. Return response
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        success: true,
        data: result,
      }),
    };
  } catch (error) {
    console.error('❌ List requests error:', error);

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
          message: 'Failed to list requests',
        },
      }),
    };
  }
};













