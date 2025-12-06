/**
 * Admin API: List All Listings
 * 
 * GET /api/v1/admin/listings?page=<page>&status=<status>
 * 
 * Returns paginated list of all listings with headline data.
 * Optional status filter.
 * Permission required: ADMIN_LISTING_VIEW_ALL
 */

import { APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { requirePermission } from '../../lib/auth-middleware';
import { parsePaginationParams, paginateArray } from '../../lib/pagination';
import { ListingSummary } from '../../../types/admin.types';
import { ListingMetadata } from '../../../types/listing.types';
import { Host, isIndividualHost } from '../../../types/host.types';

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

const TABLE_NAME = process.env.TABLE_NAME!;

/**
 * Get host name for a listing
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
async function toListingSummary(listing: ListingMetadata): Promise<ListingSummary> {
  const hostName = await getHostName(listing.hostId);

  return {
    listingId: listing.listingId,
    listingName: listing.listingName,
    propertyType: listing.propertyType,
    status: listing.status,
    hostId: listing.hostId,
    hostName,
    createdAt: listing.createdAt,
    submittedAt: listing.submittedAt,
    // Primary image would require fetching from images table - skip for now
    primaryImageUrl: undefined,
  };
}

/**
 * Main handler
 */
export const handler: APIGatewayProxyHandler = async (event) => {
  console.log('List listings request:', { queryParams: event.queryStringParameters });

  try {
    // 1. Require admin permission
    const authResult = requirePermission(event, 'ADMIN_LISTING_VIEW_ALL');
    if ('error' in authResult) {
      return authResult.error;
    }

    const { user } = authResult;
    console.log(`Admin ${user.email} listing all listings`);

    // 2. Parse pagination params and optional status filter
    const { page, limit } = parsePaginationParams(event.queryStringParameters || {});
    const statusFilter = event.queryStringParameters?.status;

    // 3. Scan for all listing records (including deleted - admins see everything)
    const scanParams: any = {
      TableName: TABLE_NAME,
      FilterExpression: 'begins_with(pk, :pkPrefix) AND begins_with(sk, :sk)',
      ExpressionAttributeValues: {
        ':pkPrefix': 'HOST#',
        ':sk': 'LISTING_META#',
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

    const scanResult = await docClient.send(new ScanCommand(scanParams));

    const listings = (scanResult.Items || []) as ListingMetadata[];

    console.log(`Found ${listings.length} listings${statusFilter ? ` with status ${statusFilter}` : ''}`);

    // 4. Convert to summary format (includes fetching host names)
    const listingSummaries = await Promise.all(
      listings.map(listing => toListingSummary(listing))
    );

    // 5. Sort by createdAt (newest first)
    listingSummaries.sort((a, b) => 
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    // 6. Paginate
    const result = paginateArray(listingSummaries, page, limit);

    console.log(`✅ Returning ${result.items.length} listings (page ${page}, total ${result.pagination.total})`);

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
    console.error('❌ List listings error:', error);

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
          message: 'Failed to list listings',
        },
      }),
    };
  }
};
