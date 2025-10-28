/**
 * Admin API: Get All Requests for a Listing
 * 
 * GET /api/v1/admin/listings/{listingId}/requests?page=<page>
 * 
 * Returns all requests (any status) for a specific listing.
 * Sorted by most recent first.
 * Permission required: ADMIN_REQUEST_VIEW_ALL
 */

import { APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { requirePermission } from '../../lib/auth-middleware';
import { parsePaginationParams, paginateArray } from '../../lib/pagination';
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
 * Convert Request to summary format
 */
async function toRequestSummary(request: Request) {
  const hostName = await getHostName(request.hostId);

  return {
    requestId: request.requestId,
    requestType: request.requestType,
    status: request.status,
    hostId: request.hostId,
    hostName,
    listingId: request.listingId,
    description: request.description,
    createdAt: request.createdAt,
    updatedAt: request.updatedAt,
    uploadedAt: request.uploadedAt,
    videoUrl: request.videoUrl,
    videoUploadedAt: request.videoUploadedAt,
    rejectionReason: request.rejectionReason,
    pdfLetterUrl: request.pdfLetterUrl,
    codeAttempts: request.codeAttempts,
  };
}

/**
 * Main handler
 */
export const handler: APIGatewayProxyHandler = async (event) => {
  console.log('Get listing requests:', { 
    pathParameters: event.pathParameters,
    queryParams: event.queryStringParameters 
  });

  try {
    // 1. Require admin permission
    const authResult = requirePermission(event, 'ADMIN_REQUEST_VIEW_ALL');
    if ('error' in authResult) {
      return authResult.error;
    }

    const { user } = authResult;
    
    // 2. Extract listingId from path
    const listingId = event.pathParameters?.listingId;
    
    if (!listingId) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({
          success: false,
          error: {
            code: 'INVALID_REQUEST',
            message: 'listingId is required in path',
          },
        }),
      };
    }

    console.log(`Admin ${user.email} viewing requests for listing ${listingId}`);

    // 3. Parse pagination params
    const { page, limit } = parsePaginationParams(event.queryStringParameters || {});

    // 4. Query all requests for this listing
    // Uses primary key: pk = LISTING#<listingId>, sk begins_with REQUEST#
    const result = await docClient.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :sk)',
        ExpressionAttributeValues: {
          ':pk': `LISTING#${listingId}`,
          ':sk': 'REQUEST#',
        },
      })
    );

    const requests = (result.Items || []) as Request[];

    console.log(`Found ${requests.length} requests for listing ${listingId}`);

    // 5. Convert to summary format (includes fetching host names)
    const requestSummaries = await Promise.all(
      requests.map(request => toRequestSummary(request))
    );

    // 6. Sort by most recent first (newest first)
    requestSummaries.sort((a, b) => 
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    // 7. Paginate
    const resultData = paginateArray(requestSummaries, page, limit);

    console.log(`✅ Returning ${resultData.items.length} requests (page ${page}, total ${resultData.pagination.total})`);

    // 8. Return response
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
    console.error('❌ Get listing requests error:', error);

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
          message: 'Failed to fetch listing requests',
        },
      }),
    };
  }
};


