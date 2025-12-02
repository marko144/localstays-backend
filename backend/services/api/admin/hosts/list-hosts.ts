/**
 * Admin API: List All Hosts
 * 
 * GET /api/v1/admin/hosts
 * 
 * Returns paginated list of all hosts with headline data.
 * Permission required: ADMIN_HOST_VIEW_ALL
 */

import { APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';
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
  console.log('List hosts request:', { queryParams: event.queryStringParameters });

  try {
    // 1. Require admin permission
    const authResult = requirePermission(event, 'ADMIN_HOST_VIEW_ALL');
    if ('error' in authResult) {
      return authResult.error;
    }

    const { user } = authResult;
    console.log(`Admin ${user.email} listing all hosts`);

    // 2. Parse pagination params
    const { page, limit } = parsePaginationParams(event.queryStringParameters || {});

    // 3. Scan for all host records (pk starts with "HOST#", sk = "META")
    const scanResult = await docClient.send(
      new ScanCommand({
        TableName: TABLE_NAME,
        FilterExpression: 'begins_with(pk, :pkPrefix) AND sk = :sk',
        ExpressionAttributeValues: {
          ':pkPrefix': 'HOST#',
          ':sk': 'META',
        },
      })
    );

    const hosts = (scanResult.Items || []) as Host[];

    // 4. Convert to summary format
    const hostSummaries = hosts.map(toHostSummary);

    // 5. Sort by createdAt (newest first)
    hostSummaries.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    // 6. Paginate
    const result = paginateArray(hostSummaries, page, limit);

    console.log(`✅ Returning ${result.items.length} hosts (page ${page}, total ${result.pagination.total})`);

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
    console.error('❌ List hosts error:', error);

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
          message: 'Failed to list hosts',
        },
      }),
    };
  }
};

