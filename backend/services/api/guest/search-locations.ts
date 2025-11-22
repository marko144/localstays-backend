import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { LocationSearchResponse, LocationSearchResult } from '../../types/location.types';

const client = new DynamoDBClient({ region: process.env.AWS_REGION });
const docClient = DynamoDBDocumentClient.from(client, {
  marshallOptions: { removeUndefinedValues: true },
});

const LOCATIONS_TABLE_NAME = process.env.LOCATIONS_TABLE_NAME!;
const RATE_LIMIT_TABLE_NAME = process.env.RATE_LIMIT_TABLE_NAME!;
const STAGE = process.env.STAGE || 'staging';

// Rate limiting constants
const RATE_LIMIT_MAX_REQUESTS = 20; // 20 requests per minute

// Allowed origins for CORS
const ALLOWED_ORIGINS = STAGE === 'prod'
  ? ['https://localstays.me', 'https://www.localstays.me']
  : ['http://localhost:3000', 'http://localhost:3001', 'https://staging.localstays.me'];

/**
 * GET /api/v1/public/locations/search?q={query}
 * 
 * Search locations for autocomplete as user types.
 * No authentication required.
 * 
 * Query parameters:
 * - q (required): Search query (min 2 chars, max 50 chars)
 * 
 * Rate limit: 20 requests per minute per IP
 * 
 * Returns:
 * - Array of matching locations (max 10 results)
 * - Sorted by listingsCount DESC
 */
export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  console.log('Location search request:', {
    requestId: event.requestContext.requestId,
    queryParams: event.queryStringParameters,
    sourceIp: event.requestContext.identity.sourceIp,
    origin: event.headers.origin || event.headers.Origin,
  });

  // Determine allowed origin for CORS
  const requestOrigin = event.headers.origin || event.headers.Origin || '';
  const allowedOrigin = ALLOWED_ORIGINS.includes(requestOrigin) ? requestOrigin : ALLOWED_ORIGINS[0];

  try {
    // 1. Extract and validate query parameter
    const query = event.queryStringParameters?.q?.trim();

    if (!query) {
      return errorResponse(400, 'MISSING_QUERY', 'Query parameter "q" is required', allowedOrigin);
    }

    if (query.length < 2) {
      return errorResponse(400, 'QUERY_TOO_SHORT', 'Query must be at least 2 characters', allowedOrigin);
    }

    if (query.length > 50) {
      return errorResponse(400, 'QUERY_TOO_LONG', 'Query must be at most 50 characters', allowedOrigin);
    }

    // Normalize query for search (remove diacritics, lowercase)
    // This matches the normalization in generateSearchName()
    const normalizedQuery = query
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '') // Remove diacritics
      .toLowerCase()
      .trim();

    // 2. Check rate limit
    const sourceIp = event.requestContext.identity.sourceIp;

    const isRateLimited = await checkRateLimit(sourceIp);
    if (isRateLimited) {
      return errorResponse(429, 'RATE_LIMIT_EXCEEDED', 'Too many requests. Please try again in a minute.', allowedOrigin);
    }

    // 3. Query locations using LocationSearchIndex GSI
    // Partition key: entityType = "LOCATION"
    // Sort key: searchName begins_with normalizedQuery
    const queryResult = await docClient.send(
      new QueryCommand({
        TableName: LOCATIONS_TABLE_NAME,
        IndexName: 'LocationSearchIndex',
        KeyConditionExpression: 'entityType = :type AND begins_with(searchName, :query)',
        ExpressionAttributeValues: {
          ':type': 'LOCATION',
          ':query': normalizedQuery,
        },
        Limit: 20, // Fetch more than we need for sorting
      })
    );

    const locations = queryResult.Items || [];

    console.log(`Found ${locations.length} location name variant(s) matching "${query}"`);

    // 4. Deduplicate by locationId (in case multiple name variants match)
    // Keep the variant with the highest priority (prefer exact match, then alphabetical)
    const locationMap = new Map<string, any>();
    
    for (const loc of locations) {
      const existing = locationMap.get(loc.locationId);
      
      if (!existing) {
        locationMap.set(loc.locationId, loc);
      } else {
        // If multiple variants exist, prefer the one that starts with the query more closely
        const existingMatch = existing.searchName.startsWith(normalizedQuery);
        const currentMatch = loc.searchName.startsWith(normalizedQuery);
        
        if (currentMatch && !existingMatch) {
          locationMap.set(loc.locationId, loc);
        } else if (currentMatch === existingMatch) {
          // Both match equally, prefer alphabetically first name
          if (loc.name < existing.name) {
            locationMap.set(loc.locationId, loc);
          }
        }
      }
    }

    const uniqueLocations = Array.from(locationMap.values());
    console.log(`Deduplicated to ${uniqueLocations.length} unique location(s)`);

    // 5. Sort by listingsCount DESC and take top 10
    const sortedLocations = uniqueLocations
      .sort((a, b) => (b.listingsCount || 0) - (a.listingsCount || 0))
      .slice(0, 10);

    // 6. Map to response format
    const results: LocationSearchResult[] = sortedLocations.map((loc) => ({
      locationId: loc.locationId,
      name: loc.name,
    }));

    // 7. Build response
    const response: LocationSearchResponse = {
      locations: results,
    };

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': allowedOrigin,
        'Access-Control-Allow-Credentials': 'true',
      },
      body: JSON.stringify(response),
    };
  } catch (error) {
    console.error('Error searching locations:', error);
    return errorResponse(500, 'INTERNAL_ERROR', 'An error occurred while searching locations', allowedOrigin);
  }
}

/**
 * Check if request exceeds rate limit
 * Uses DynamoDB for distributed rate limiting
 * 
 * Strategy: Store one record per minute window with count
 * id = "location-search:{sourceIp}:{minuteTimestamp}"
 */
async function checkRateLimit(sourceIp: string): Promise<boolean> {
  try {
    const now = Date.now();
    const currentMinute = Math.floor(now / 60000) * 60000; // Round down to minute
    const recordId = `location-search:${sourceIp}:${currentMinute}`;

    // Try to get existing record for this minute
    const { GetCommand } = await import('@aws-sdk/lib-dynamodb');
    const result = await docClient.send(
      new GetCommand({
        TableName: RATE_LIMIT_TABLE_NAME,
        Key: { id: recordId },
      })
    );

    const currentCount = result.Item?.count || 0;

    console.log(`Rate limit check for ${sourceIp}: ${currentCount}/${RATE_LIMIT_MAX_REQUESTS} requests this minute`);

    if (currentCount >= RATE_LIMIT_MAX_REQUESTS) {
      return true; // Rate limited
    }

    // Increment counter (or create if doesn't exist)
    const { UpdateCommand } = await import('@aws-sdk/lib-dynamodb');
    await docClient.send(
      new UpdateCommand({
        TableName: RATE_LIMIT_TABLE_NAME,
        Key: { id: recordId },
        UpdateExpression: 'SET #count = if_not_exists(#count, :zero) + :inc, #ttl = :ttl',
        ExpressionAttributeNames: {
          '#count': 'count',
          '#ttl': 'ttl',
        },
        ExpressionAttributeValues: {
          ':zero': 0,
          ':inc': 1,
          ':ttl': Math.floor((currentMinute + 120000) / 1000), // Expire 2 minutes after window
        },
      })
    );

    return false; // Not rate limited
  } catch (error) {
    console.error('Error checking rate limit:', error);
    // On error, allow the request (fail open)
    return false;
  }
}

/**
 * Build error response
 */
function errorResponse(statusCode: number, code: string, message: string, allowedOrigin: string): APIGatewayProxyResult {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': allowedOrigin,
      'Access-Control-Allow-Credentials': 'true',
    },
    body: JSON.stringify({
      error: {
        code,
        message,
      },
    }),
  };
}

