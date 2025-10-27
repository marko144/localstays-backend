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
import { DynamoDBDocumentClient, ScanCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
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

    // 3. Scan for all request records (both host-level and listing-level)
    const scanParams: any = {
      TableName: TABLE_NAME,
      FilterExpression: '(begins_with(pk, :hostPrefix) OR begins_with(pk, :listingPrefix)) AND begins_with(sk, :sk)',
      ExpressionAttributeValues: {
        ':hostPrefix': 'HOST#',
        ':listingPrefix': 'LISTING#',
        ':sk': 'REQUEST#',
      },
    };

    // Add status filter if provided
    if (statusFilter) {
      scanParams.FilterExpression += ' AND #status = :status';
      scanParams.ExpressionAttributeNames = {
        '#status': 'status',
      };
      scanParams.ExpressionAttributeValues[':status'] = statusFilter;
    }

    // Add type filter if provided
    if (typeFilter) {
      scanParams.FilterExpression += ' AND requestType = :requestType';
      if (!scanParams.ExpressionAttributeNames) {
        scanParams.ExpressionAttributeNames = {};
      }
      scanParams.ExpressionAttributeValues[':requestType'] = typeFilter;
    }

    const scanResult = await docClient.send(new ScanCommand(scanParams));

    const requests = (scanResult.Items || []) as Request[];

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













