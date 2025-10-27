/**
 * Admin API: Get Hosts Pending Review
 * 
 * GET /api/v1/admin/hosts/pending-review?page=<page>
 * 
 * Returns paginated list of hosts awaiting verification (status = VERIFICATION).
 * Sorted by oldest submitted first.
 * Permission required: ADMIN_KYC_VIEW_ALL
 */

import { APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { requirePermission } from '../../lib/auth-middleware';
import { parsePaginationParams, paginateArray } from '../../lib/pagination';
import { HostSummary } from '../../../types/admin.types';
import { Host, isIndividualHost, isBusinessHost } from '../../../types/host.types';

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

const TABLE_NAME = process.env.TABLE_NAME!;

/**
 * Format host name based on host type
 */
function formatHostName(host: Host): string {
  if (isIndividualHost(host)) {
    return `${host.forename} ${host.surname}`;
  } else if (isBusinessHost(host)) {
    return host.legalName || host.displayName || host.businessName || 'Unknown Business';
  }
  return 'Unknown';
}

/**
 * Convert Host entity to HostSummary
 */
function toHostSummary(host: Host): HostSummary {
  return {
    hostId: host.hostId,
    hostType: host.hostType,
    name: formatHostName(host),
    email: host.email,
    countryCode: host.countryCode,
    status: host.status,
    createdAt: host.createdAt,
    submittedAt: host.submission?.lastSubmissionAttempt || undefined,
  };
}

/**
 * Main handler
 */
export const handler: APIGatewayProxyHandler = async (event) => {
  console.log('Get pending review hosts request:', { queryParams: event.queryStringParameters });

  try {
    // 1. Require admin permission
    const authResult = requirePermission(event, 'ADMIN_KYC_VIEW_ALL');
    if ('error' in authResult) {
      return authResult.error;
    }

    const { user } = authResult;
    console.log(`Admin ${user.email} viewing pending review hosts`);

    // 2. Parse pagination params
    const { page, limit } = parsePaginationParams(event.queryStringParameters || {});

    // 3. Query GSI2 for hosts with status = VERIFICATION
    const result = await docClient.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        IndexName: 'StatusIndex',
        KeyConditionExpression: 'gsi2pk = :gsi2pk',
        FilterExpression: 'isDeleted = :isDeleted',
        ExpressionAttributeValues: {
          ':gsi2pk': 'HOST#VERIFICATION',
          ':isDeleted': false,
        },
      })
    );

    const hosts = (result.Items || []) as Host[];

    console.log(`Found ${hosts.length} hosts pending review`);

    // 4. Convert to summary format
    const hostSummaries = hosts.map(toHostSummary);

    // 5. Sort by submittedAt (oldest first - FIFO queue)
    hostSummaries.sort((a, b) => {
      const aDate = a.submittedAt ? new Date(a.submittedAt).getTime() : 0;
      const bDate = b.submittedAt ? new Date(b.submittedAt).getTime() : 0;
      return aDate - bDate; // Oldest first
    });

    // 6. Paginate
    const resultData = paginateArray(hostSummaries, page, limit);

    console.log(`✅ Returning ${resultData.items.length} hosts (page ${page}, total ${resultData.pagination.total})`);

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
    console.error('❌ Get pending review hosts error:', error);

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
          message: 'Failed to fetch pending review hosts',
        },
      }),
    };
  }
};

