/**
 * Admin API: Search Listings by Location(s)
 * 
 * POST /api/v1/admin/listings/by-location
 * 
 * Body: { locationIds: string[], readyToApprove?: boolean, limit?: number, nextToken?: string }
 * 
 * Returns listings in one or more locations using GSI8 (LocationIndex).
 * Queries each location in parallel and merges results.
 * 
 * Request Body:
 * - locationIds: Array of location IDs to search (required, 1-20 IDs)
 * - readyToApprove: Optional filter - true or false (if omitted, no filter applied)
 * - limit: Number of items per page (default: 200, max: 500)
 * - nextToken: Pagination token from previous response (base64 encoded)
 * 
 * Response includes:
 * - listingId, listingName
 * - hostId, hostName, hostEmail
 * - locationId, locationName
 * - status, readyToApprove flag
 * - total count, nextToken (if more results exist)
 * 
 * Permission required: ADMIN_LISTING_VIEW_ALL
 */

import { APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { requirePermission } from '../../lib/auth-middleware';
import { Host, isIndividualHost } from '../../../types/host.types';

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 500;
const MAX_LOCATION_IDS = 20;

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

const TABLE_NAME = process.env.TABLE_NAME!;
const LOCATIONS_TABLE_NAME = process.env.LOCATIONS_TABLE_NAME!;

interface SearchByLocationRequest {
  locationIds: string[];
  readyToApprove?: boolean;
  limit?: number;
  nextToken?: string;
}

interface ListingByLocationResult {
  listingId: string;
  listingName: string;
  hostId: string;
  hostName: string;
  hostEmail: string;
  locationId: string;
  locationName: string;
  status: string;
  readyToApprove: boolean;
  createdAt: string;
}

/**
 * Decode pagination token from base64
 */
function decodeNextToken(token: string | undefined): number {
  if (!token) return 0;
  try {
    const decoded = JSON.parse(Buffer.from(token, 'base64').toString('utf-8'));
    return decoded.offset || 0;
  } catch {
    return 0;
  }
}

/**
 * Encode pagination token to base64
 */
function encodeNextToken(offset: number): string {
  return Buffer.from(JSON.stringify({ offset })).toString('base64');
}

/**
 * Get host details (name and email)
 */
async function getHostDetails(hostId: string): Promise<{ name: string; email: string }> {
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
      return { name: 'Unknown Host', email: 'unknown' };
    }

    const host = result.Item as Host;
    
    let name: string;
    if (isIndividualHost(host)) {
      name = `${host.forename} ${host.surname}`;
    } else {
      name = host.legalName || host.displayName || host.businessName || 'Unknown Business';
    }

    return { name, email: host.email || 'unknown' };
  } catch (error) {
    console.error(`Failed to fetch host ${hostId}:`, error);
    return { name: 'Unknown Host', email: 'unknown' };
  }
}

/**
 * Get location name from Locations table
 */
async function getLocationName(locationId: string): Promise<string> {
  try {
    const result = await docClient.send(
      new QueryCommand({
        TableName: LOCATIONS_TABLE_NAME,
        KeyConditionExpression: 'pk = :pk',
        ExpressionAttributeValues: {
          ':pk': `LOCATION#${locationId}`,
        },
        Limit: 1,
      })
    );

    if (result.Items && result.Items.length > 0) {
      return result.Items[0].name || 'Unknown Location';
    }

    return 'Unknown Location';
  } catch (error) {
    console.error(`Failed to fetch location ${locationId}:`, error);
    return 'Unknown Location';
  }
}

/**
 * Query listings for a single location
 */
async function queryListingsForLocation(
  locationId: string,
  readyToApproveFilter: boolean | undefined
): Promise<any[]> {
  const pk = `LOCATION#${locationId}`;
  
  let keyConditionExpression: string;
  const expressionAttributeValues: Record<string, any> = { ':pk': pk };
  
  if (readyToApproveFilter !== undefined) {
    keyConditionExpression = 'gsi8pk = :pk AND begins_with(gsi8sk, :skPrefix)';
    expressionAttributeValues[':skPrefix'] = `READY#${readyToApproveFilter}#`;
  } else {
    keyConditionExpression = 'gsi8pk = :pk';
  }

  const allListings: any[] = [];
  let lastEvaluatedKey: Record<string, any> | undefined;

  // Paginate through all results for this location
  do {
    const result = await docClient.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        IndexName: 'LocationIndex',
        KeyConditionExpression: keyConditionExpression,
        ExpressionAttributeValues: expressionAttributeValues,
        ExclusiveStartKey: lastEvaluatedKey,
      })
    );

    if (result.Items) {
      allListings.push(...result.Items);
    }
    lastEvaluatedKey = result.LastEvaluatedKey;
  } while (lastEvaluatedKey);

  return allListings;
}

/**
 * Main handler
 */
export const handler: APIGatewayProxyHandler = async (event) => {
  console.log('Search listings by location(s) request:', { 
    body: event.body,
  });

  try {
    // 1. Require admin permission
    const authResult = requirePermission(event, 'ADMIN_LISTING_VIEW_ALL');
    if ('error' in authResult) {
      return authResult.error;
    }

    const { user } = authResult;

    // 2. Parse and validate request body
    let requestBody: SearchByLocationRequest;
    try {
      requestBody = JSON.parse(event.body || '{}');
    } catch {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({
          success: false,
          error: {
            code: 'INVALID_JSON',
            message: 'Request body must be valid JSON',
          },
        }),
      };
    }

    const { locationIds, readyToApprove, limit: requestedLimit, nextToken } = requestBody;

    // 3. Validate locationIds
    if (!locationIds || !Array.isArray(locationIds) || locationIds.length === 0) {
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
            message: 'locationIds is required and must be a non-empty array',
          },
        }),
      };
    }

    if (locationIds.length > MAX_LOCATION_IDS) {
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
            message: `Maximum ${MAX_LOCATION_IDS} location IDs allowed per request`,
          },
        }),
      };
    }

    // Validate each locationId is a non-empty string
    const invalidIds = locationIds.filter(id => typeof id !== 'string' || id.trim() === '');
    if (invalidIds.length > 0) {
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
            message: 'All locationIds must be non-empty strings',
          },
        }),
      };
    }

    const uniqueLocationIds = [...new Set(locationIds.map(id => id.trim()))];
    const limit = Math.min(MAX_LIMIT, Math.max(1, requestedLimit || DEFAULT_LIMIT));
    const offset = decodeNextToken(nextToken);

    console.log(`Admin ${user.email} searching listings for ${uniqueLocationIds.length} location(s):`, uniqueLocationIds);

    // 4. Query all locations in parallel
    const locationResults = await Promise.all(
      uniqueLocationIds.map(locationId => queryListingsForLocation(locationId, readyToApprove))
    );

    // 5. Merge and deduplicate results by listingId
    const listingsMap = new Map<string, any>();
    for (const listings of locationResults) {
      for (const listing of listings) {
        if (!listingsMap.has(listing.listingId)) {
          listingsMap.set(listing.listingId, listing);
        }
      }
    }

    const allListings = Array.from(listingsMap.values());
    const totalCount = allListings.length;

    console.log(`Found ${totalCount} unique listings across ${uniqueLocationIds.length} location(s)`);

    // 6. Sort by createdAt descending (newest first)
    allListings.sort((a, b) => {
      const dateA = new Date(a.createdAt || 0).getTime();
      const dateB = new Date(b.createdAt || 0).getTime();
      return dateB - dateA;
    });

    // 7. Apply pagination
    const paginatedListings = allListings.slice(offset, offset + limit);
    const hasMore = (offset + limit) < totalCount;
    const responseNextToken = hasMore ? encodeNextToken(offset + limit) : null;

    if (paginatedListings.length === 0) {
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({
          success: true,
          data: {
            items: [],
            total: totalCount,
            nextToken: null,
          },
        }),
      };
    }

    // 8. Get location names for all unique locations in results
    const resultLocationIds = [...new Set(paginatedListings.map(l => l.locationId))];
    const locationNamesMap = new Map<string, string>();
    
    await Promise.all(
      resultLocationIds.map(async (locId) => {
        const name = await getLocationName(locId);
        locationNamesMap.set(locId, name);
      })
    );

    // 9. Get unique host IDs and fetch their details
    const uniqueHostIds = [...new Set(paginatedListings.map(l => l.hostId))];
    const hostDetailsMap = new Map<string, { name: string; email: string }>();
    
    await Promise.all(
      uniqueHostIds.map(async (hostId) => {
        const details = await getHostDetails(hostId);
        hostDetailsMap.set(hostId, details);
      })
    );

    // 10. Build result array
    const results: ListingByLocationResult[] = paginatedListings.map(listing => {
      const hostDetails = hostDetailsMap.get(listing.hostId) || { name: 'Unknown', email: 'unknown' };
      const locationName = locationNamesMap.get(listing.locationId) || 'Unknown Location';
      
      return {
        listingId: listing.listingId,
        listingName: listing.listingName,
        hostId: listing.hostId,
        hostName: hostDetails.name,
        hostEmail: hostDetails.email,
        locationId: listing.locationId,
        locationName,
        status: listing.status,
        readyToApprove: listing.readyToApprove || false,
        createdAt: listing.createdAt,
      };
    });

    console.log(`✅ Returning ${results.length} of ${totalCount} listings, nextToken: ${responseNextToken ? 'present' : 'none'}`);

    // 11. Return response
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        success: true,
        data: {
          items: results,
          total: totalCount,
          nextToken: responseNextToken,
        },
      }),
    };
  } catch (error) {
    console.error('❌ Search by location error:', error);

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
          message: 'Failed to search listings by location',
        },
      }),
    };
  }
};
