/**
 * Admin API: Get Requests Pending Review
 * 
 * GET /api/v1/admin/requests/pending-review?page=<page>
 * 
 * Returns paginated list of requests awaiting review (status = RECEIVED).
 * Sorted by oldest first (FIFO queue).
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
 * Convert Request to RequestSummary
 */
async function toRequestSummary(request: Request): Promise<RequestSummary> {
  const hostName = await getHostName(request.hostId);

  return {
    requestId: request.requestId,
    requestType: request.requestType,
    status: request.status,
    hostId: request.hostId,
    hostName,
    createdAt: request.createdAt,
    uploadedAt: request.uploadedAt,
  };
}

/**
 * Main handler
 */
export const handler: APIGatewayProxyHandler = async (event) => {
  console.log('Get pending review requests request:', { queryParams: event.queryStringParameters });

  try {
    // 1. Require admin permission
    const authResult = requirePermission(event, 'ADMIN_REQUEST_VIEW_ALL');
    if ('error' in authResult) {
      return authResult.error;
    }

    const { user } = authResult;
    console.log(`Admin ${user.email} viewing pending review requests`);

    // 2. Parse pagination params
    const { page, limit } = parsePaginationParams(event.queryStringParameters || {});

    // 3. Query GSI2 for all request types with status = RECEIVED
    // Note: GSI2 for requests uses pattern: gsi2pk = "REQUEST#<type>", gsi2sk = "STATUS#<status>#<createdAt>"
    // We need to query multiple request types: LIVE_ID_CHECK, PROPERTY_VIDEO_VERIFICATION, ADDRESS_VERIFICATION
    const requestTypes = ['LIVE_ID_CHECK', 'PROPERTY_VIDEO_VERIFICATION', 'ADDRESS_VERIFICATION'];
    
    const queryPromises = requestTypes.map(requestType =>
      docClient.send(
        new QueryCommand({
          TableName: TABLE_NAME,
          IndexName: 'StatusIndex',
          KeyConditionExpression: 'gsi2pk = :gsi2pk AND begins_with(gsi2sk, :statusPrefix)',
          ExpressionAttributeValues: {
            ':gsi2pk': `REQUEST#${requestType}`,
            ':statusPrefix': 'STATUS#RECEIVED#',
          },
        })
      )
    );

    // Execute all queries in parallel
    const results = await Promise.all(queryPromises);

    // Combine all results
    const requests = results.flatMap(result => (result.Items || [])) as Request[];

    console.log(`Found ${requests.length} requests pending review across ${requestTypes.length} request types`);

    // 4. Convert to summary format (includes fetching host names)
    const requestSummaries = await Promise.all(
      requests.map(request => toRequestSummary(request))
    );

    // 5. Sort by createdAt (oldest first - FIFO queue)
    requestSummaries.sort((a, b) => 
      new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );

    // 6. Paginate
    const resultData = paginateArray(requestSummaries, page, limit);

    console.log(`✅ Returning ${resultData.items.length} requests (page ${page}, total ${resultData.pagination.total})`);

    // 7. Return response
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
    console.error('❌ Get pending review requests error:', error);

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
          message: 'Failed to fetch pending review requests',
        },
      }),
    };
  }
};




