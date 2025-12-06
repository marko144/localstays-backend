/**
 * Admin API: Search Locations
 * 
 * GET /api/v1/admin/locations/search?q=<query>
 * 
 * Search locations from the Locations table for manual association with listings.
 * Used when hosts enter addresses manually without Mapbox autocomplete.
 * 
 * Permission required: ADMIN_LISTING_APPROVE
 */

import { APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { requirePermission } from '../../lib/auth-middleware';
import { LocationRecord } from '../../../types/location.types';

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client, {
  marshallOptions: { removeUndefinedValues: true },
});

const LOCATIONS_TABLE_NAME = process.env.LOCATIONS_TABLE_NAME!;

/**
 * Location search result for admin UI
 */
interface AdminLocationSearchResult {
  locationId: string;
  name: string;
  displayName: string;
  locationType: 'PLACE' | 'LOCALITY' | 'COUNTRY';
  regionName?: string;
  countryName: string;
  parentPlaceName?: string;  // For LOCALITY, the parent place name
  mapboxPlaceId?: string;    // Parent place ID (for deriving PLACE when LOCALITY selected)
  listingsCount: number;
}

/**
 * Main handler
 */
export const handler: APIGatewayProxyHandler = async (event) => {
  console.log('Admin search locations request:', { queryParams: event.queryStringParameters });

  try {
    // 1. Require admin permission
    const authResult = requirePermission(event, 'ADMIN_LISTING_APPROVE');
    if ('error' in authResult) {
      return authResult.error;
    }

    const { user } = authResult;
    console.log(`Admin ${user.email} searching locations`);

    // 2. Extract and validate query parameter
    const query = event.queryStringParameters?.q?.trim();

    if (!query) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({
          success: false,
          error: {
            code: 'MISSING_QUERY',
            message: 'Query parameter "q" is required',
          },
        }),
      };
    }

    if (query.length < 2) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({
          success: false,
          error: {
            code: 'QUERY_TOO_SHORT',
            message: 'Query must be at least 2 characters',
          },
        }),
      };
    }

    // 3. Normalize query for search (remove diacritics, lowercase)
    const normalizedQuery = query
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '') // Remove diacritics
      .toLowerCase()
      .trim();

    // 4. Query locations using LocationSearchIndex GSI
    const queryResult = await docClient.send(
      new QueryCommand({
        TableName: LOCATIONS_TABLE_NAME,
        IndexName: 'LocationSearchIndex',
        KeyConditionExpression: 'entityType = :type AND begins_with(searchName, :query)',
        ExpressionAttributeValues: {
          ':type': 'LOCATION',
          ':query': normalizedQuery,
        },
        Limit: 30, // Fetch more for deduplication
      })
    );

    const locations = (queryResult.Items || []) as LocationRecord[];
    console.log(`Found ${locations.length} location(s) matching "${query}"`);

    // 5. Deduplicate by locationId (multiple name variants may match)
    const locationMap = new Map<string, LocationRecord>();
    
    for (const loc of locations) {
      const existing = locationMap.get(loc.locationId);
      
      if (!existing) {
        locationMap.set(loc.locationId, loc);
      } else {
        // Prefer the variant that matches the query more closely
        const existingMatch = existing.searchName.startsWith(normalizedQuery);
        const currentMatch = loc.searchName.startsWith(normalizedQuery);
        
        if (currentMatch && !existingMatch) {
          locationMap.set(loc.locationId, loc);
        } else if (currentMatch === existingMatch && loc.name < existing.name) {
          locationMap.set(loc.locationId, loc);
        }
      }
    }

    const uniqueLocations = Array.from(locationMap.values());

    // 6. Sort by listingsCount DESC and take top 20
    const sortedLocations = uniqueLocations
      .sort((a, b) => (b.listingsCount || 0) - (a.listingsCount || 0))
      .slice(0, 20);

    // 7. Map to response format
    const results: AdminLocationSearchResult[] = sortedLocations.map((loc) => ({
      locationId: loc.locationId,
      name: loc.name,
      displayName: loc.displayName || loc.name,
      locationType: loc.locationType || 'PLACE',
      regionName: loc.regionName,
      countryName: loc.countryName,
      parentPlaceName: loc.parentPlaceName,
      mapboxPlaceId: loc.mapboxPlaceId,
      listingsCount: loc.listingsCount || 0,
    }));

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
          locations: results,
        },
      }),
    };
  } catch (error) {
    console.error('Error searching locations:', error);
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
          message: 'An error occurred while searching locations',
        },
      }),
    };
  }
};





