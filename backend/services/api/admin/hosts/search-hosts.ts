/**
 * Admin API: Search Hosts
 * 
 * GET /api/v1/admin/hosts/search?q=<search_query>&page=<page>
 * 
 * Search hosts by name or email (partial match, case-insensitive).
 * Permission required: ADMIN_HOST_SEARCH
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
 * Check if host matches search query
 * Search in: name (forename, surname, legalName, businessName, displayName) and email
 */
function matchesSearchQuery(host: Host, query: string): boolean {
  const lowerQuery = query.toLowerCase();
  
  // Search in email
  if (host.email.toLowerCase().includes(lowerQuery)) {
    return true;
  }
  
  // Search in name fields
  if (isIndividualHost(host)) {
    if (host.forename.toLowerCase().includes(lowerQuery)) return true;
    if (host.surname.toLowerCase().includes(lowerQuery)) return true;
    // Also check full name
    const fullName = `${host.forename} ${host.surname}`.toLowerCase();
    if (fullName.includes(lowerQuery)) return true;
  } else if (isBusinessHost(host)) {
    if (host.legalName.toLowerCase().includes(lowerQuery)) return true;
    if (host.businessName?.toLowerCase().includes(lowerQuery)) return true;
    if (host.displayName?.toLowerCase().includes(lowerQuery)) return true;
  }
  
  return false;
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
  console.log('Search hosts request:', { queryParams: event.queryStringParameters });

  try {
    // 1. Require admin permission
    const authResult = requirePermission(event, 'ADMIN_HOST_SEARCH');
    if ('error' in authResult) {
      return authResult.error;
    }

    const { user } = authResult;

    // 2. Validate search query
    const searchQuery = event.queryStringParameters?.q?.trim();
    
    if (!searchQuery || searchQuery.length < 1) {
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
            message: 'Search query (q) is required and must be at least 1 character',
          },
        }),
      };
    }

    console.log(`Admin ${user.email} searching hosts: "${searchQuery}"`);

    // 3. Parse pagination params
    const { page, limit } = parsePaginationParams(event.queryStringParameters || {});

    // 4. Query EmailIndex for exact email match
    const normalizedEmail = searchQuery.toLowerCase().trim();
    
    const queryResult = await docClient.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        IndexName: 'EmailIndex',
        KeyConditionExpression: 'gsi6pk = :email',
        ExpressionAttributeValues: {
          ':email': normalizedEmail,
        },
      })
    );

    const matchingHosts = (queryResult.Items || []) as Host[];

    console.log(`Found ${matchingHosts.length} hosts matching email "${searchQuery}"`);

    // 5. Convert to summary format
    const hostSummaries = matchingHosts.map(toHostSummary);

    // 6. Sort by newest first
    hostSummaries.sort((a, b) => {
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

    // 7. Paginate
    const result = paginateArray(hostSummaries, page, limit);

    console.log(`✅ Returning ${result.items.length} hosts (page ${page}, total ${result.pagination.total})`);

    // 9. Return response
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
    console.error('❌ Search hosts error:', error);

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
          message: 'Failed to search hosts',
        },
      }),
    };
  }
};

