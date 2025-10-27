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
 * Convert Request to RequestSummary
 */
function toRequestSummary(request: Request, hostName: string): RequestSummary {
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

    // 4. Query all requests for this host
    const result = await docClient.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :sk)',
        ExpressionAttributeValues: {
          ':pk': `HOST#${hostId}`,
          ':sk': 'REQUEST#',
        },
      })
    );

    const requests = (result.Items || []) as Request[];

    console.log(`Found ${requests.length} requests for host ${hostId}`);

    // 5. Get host name once
    const hostName = await getHostName(hostId);

    // 6. Convert to summary format
    const requestSummaries = requests.map(request => toRequestSummary(request, hostName));

    // 7. Sort by createdAt (newest first)
    requestSummaries.sort((a, b) => 
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    // 8. Paginate
    const resultData = paginateArray(requestSummaries, page, limit);

    console.log(`✅ Returning ${resultData.items.length} requests (page ${page}, total ${resultData.pagination.total})`);

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















