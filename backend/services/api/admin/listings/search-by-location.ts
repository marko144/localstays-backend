/**
 * Admin API: Search Listings by Location
 * 
 * GET /api/v1/admin/listings/by-location/{locationId}?limit=200&nextToken=xxx&readyToApprove=true
 * 
 * Returns listings in a specific location using GSI8 (LocationIndex).
 * Efficient query - no table scan required.
 * 
 * Query Parameters:
 * - limit: Number of items per page (default: 200, max: 500)
 * - nextToken: Pagination token from previous response (base64 encoded)
 * - readyToApprove: Optional filter - "true" or "false" (if omitted, no filter applied)
 * 
 * Response includes:
 * - listingId, listingName
 * - hostId, hostName, hostEmail
 * - locationName
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

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

const TABLE_NAME = process.env.TABLE_NAME!;
const LOCATIONS_TABLE_NAME = process.env.LOCATIONS_TABLE_NAME!;

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
    // Query for any name variant of this location
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
 * Decode pagination token from base64
 */
function decodeNextToken(token: string | undefined): Record<string, any> | undefined {
  if (!token) return undefined;
  try {
    return JSON.parse(Buffer.from(token, 'base64').toString('utf-8'));
  } catch {
    return undefined;
  }
}

/**
 * Encode pagination token to base64
 */
function encodeNextToken(lastEvaluatedKey: Record<string, any> | undefined): string | undefined {
  if (!lastEvaluatedKey) return undefined;
  return Buffer.from(JSON.stringify(lastEvaluatedKey)).toString('base64');
}

/**
 * Main handler
 */
export const handler: APIGatewayProxyHandler = async (event) => {
  const locationId = event.pathParameters?.locationId;
  
  console.log('Search listings by location request:', { 
    locationId,
    queryParams: event.queryStringParameters,
  });

  try {
    // 1. Require admin permission
    const authResult = requirePermission(event, 'ADMIN_LISTING_VIEW_ALL');
    if ('error' in authResult) {
      return authResult.error;
    }

    const { user } = authResult;
    console.log(`Admin ${user.email} searching listings by location: ${locationId}`);

    // 2. Validate locationId
    if (!locationId) {
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
            message: 'locationId is required',
          },
        }),
      };
    }

    // 3. Parse pagination and filter params
    const limit = Math.min(
      MAX_LIMIT,
      Math.max(1, parseInt(event.queryStringParameters?.limit || String(DEFAULT_LIMIT), 10))
    );
    const nextToken = event.queryStringParameters?.nextToken;
    const exclusiveStartKey = decodeNextToken(nextToken);
    
    // Parse optional readyToApprove filter (only apply if explicitly provided)
    const readyToApproveParam = event.queryStringParameters?.readyToApprove;
    const readyToApproveFilter = readyToApproveParam !== undefined 
      ? readyToApproveParam === 'true' 
      : undefined;

    // 4. Build query params - only add filter if readyToApprove is specified
    const baseExpressionValues: Record<string, any> = {
      ':pk': `LOCATION#${locationId}`,
    };
    
    let filterExpression: string | undefined;
    let expressionAttributeNames: Record<string, string> | undefined;
    
    if (readyToApproveFilter !== undefined) {
      filterExpression = 'readyToApprove = :readyToApprove';
      baseExpressionValues[':readyToApprove'] = readyToApproveFilter;
    }

    console.log('Query params:', { limit, readyToApproveFilter, hasNextToken: !!nextToken });

    // 5. Query GSI8 (LocationIndex) for listings in this location
    // Run two queries in parallel: one for items, one for total count
    const [queryResult, countResult] = await Promise.all([
      docClient.send(
        new QueryCommand({
          TableName: TABLE_NAME,
          IndexName: 'LocationIndex',
          KeyConditionExpression: 'gsi8pk = :pk',
          ExpressionAttributeValues: baseExpressionValues,
          ...(filterExpression && { FilterExpression: filterExpression }),
          ...(expressionAttributeNames && { ExpressionAttributeNames: expressionAttributeNames }),
          Limit: limit,
          ExclusiveStartKey: exclusiveStartKey,
        })
      ),
      docClient.send(
        new QueryCommand({
          TableName: TABLE_NAME,
          IndexName: 'LocationIndex',
          KeyConditionExpression: 'gsi8pk = :pk',
          ExpressionAttributeValues: baseExpressionValues,
          ...(filterExpression && { FilterExpression: filterExpression }),
          ...(expressionAttributeNames && { ExpressionAttributeNames: expressionAttributeNames }),
          Select: 'COUNT',
        })
      ),
    ]);

    const listings = queryResult.Items || [];
    const lastEvaluatedKey = queryResult.LastEvaluatedKey;
    const responseNextToken = encodeNextToken(lastEvaluatedKey);
    const totalCount = countResult.Count || 0;

    console.log(`Found ${listings.length} listings for location ${locationId}, total: ${totalCount}, hasMore: ${!!lastEvaluatedKey}`);

    if (listings.length === 0) {
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

    // 5. Get location name (once, since all listings share the same location)
    const locationName = await getLocationName(locationId);

    // 6. Get unique host IDs and fetch their details
    const uniqueHostIds = [...new Set(listings.map(l => l.hostId))];
    const hostDetailsMap = new Map<string, { name: string; email: string }>();
    
    // Fetch host details in parallel
    await Promise.all(
      uniqueHostIds.map(async (hostId) => {
        const details = await getHostDetails(hostId);
        hostDetailsMap.set(hostId, details);
      })
    );

    // 7. Build result array
    const results: ListingByLocationResult[] = listings.map(listing => {
      const hostDetails = hostDetailsMap.get(listing.hostId) || { name: 'Unknown', email: 'unknown' };
      
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

    // 8. Return response
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
          nextToken: responseNextToken || null,
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

