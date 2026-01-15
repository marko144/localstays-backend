/**
 * Admin API: List/Search Locations
 * 
 * GET /api/v1/admin/locations?q=<query>&type=<type>&isLive=<boolean>&includeChildren=<boolean>&limit=<number>
 * 
 * Search locations from the Locations table with filters.
 * Supports searching by name (begins_with) and filtering by type/live status.
 * Optionally includes child locations where matched location is the parent.
 * 
 * Permission required: ADMIN_LISTING_APPROVE
 */

import { APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { requirePermission } from '../../lib/auth-middleware';
import { LocationRecord, AdminLocationSearchResult } from '../../../types/location.types';

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client, {
  marshallOptions: { removeUndefinedValues: true },
});

const LOCATIONS_TABLE_NAME = process.env.LOCATIONS_TABLE_NAME!;

/**
 * Main handler
 */
export const handler: APIGatewayProxyHandler = async (event) => {
  console.log('Admin list locations request:', { queryParams: event.queryStringParameters });

  try {
    // 1. Require admin permission
    const authResult = requirePermission(event, 'ADMIN_LISTING_APPROVE');
    if ('error' in authResult) {
      return authResult.error;
    }

    const { user } = authResult;
    console.log(`Admin ${user.email} listing locations`);

    // 2. Extract query parameters
    const query = event.queryStringParameters?.q?.trim();
    const typeFilter = event.queryStringParameters?.type as 'COUNTRY' | 'PLACE' | 'LOCALITY' | undefined;
    const isLiveParam = event.queryStringParameters?.isLive;
    const includeChildren = event.queryStringParameters?.includeChildren === 'true';
    const limit = Math.min(parseInt(event.queryStringParameters?.limit || '20'), 100);

    // Parse isLive filter (undefined means no filter)
    let isLiveFilter: boolean | undefined;
    if (isLiveParam === 'true') isLiveFilter = true;
    else if (isLiveParam === 'false') isLiveFilter = false;

    // Validate query if provided
    if (query && query.length < 2) {
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

    // Validate type filter
    if (typeFilter && !['COUNTRY', 'PLACE', 'LOCALITY'].includes(typeFilter)) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({
          success: false,
          error: {
            code: 'INVALID_TYPE',
            message: 'Type must be one of: COUNTRY, PLACE, LOCALITY',
          },
        }),
      };
    }

    let locations: LocationRecord[] = [];

    if (query) {
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
          Limit: 50, // Fetch more for deduplication and filtering
        })
      );

      locations = (queryResult.Items || []) as LocationRecord[];
      console.log(`Found ${locations.length} location(s) matching "${query}"`);

      // 5. Include children if requested
      if (includeChildren && locations.length > 0) {
        const childLocations = await fetchChildLocations(locations);
        locations = [...locations, ...childLocations];
        console.log(`Added ${childLocations.length} child location(s)`);
      }
    } else {
      // No query - scan all locations (with limit)
      const scanResult = await docClient.send(
        new ScanCommand({
          TableName: LOCATIONS_TABLE_NAME,
          Limit: 100,
        })
      );
      locations = (scanResult.Items || []) as LocationRecord[];
      console.log(`Scanned ${locations.length} location(s)`);
    }

    // 6. Deduplicate by locationId (multiple name variants may match)
    const locationMap = new Map<string, LocationRecord>();
    
    for (const loc of locations) {
      const existing = locationMap.get(loc.locationId);
      
      if (!existing) {
        locationMap.set(loc.locationId, loc);
      } else if (query) {
        // Prefer the variant that matches the query more closely
        const normalizedQuery = query.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
        const existingMatch = existing.searchName?.startsWith(normalizedQuery);
        const currentMatch = loc.searchName?.startsWith(normalizedQuery);
        
        if (currentMatch && !existingMatch) {
          locationMap.set(loc.locationId, loc);
        } else if (currentMatch === existingMatch && loc.name < existing.name) {
          locationMap.set(loc.locationId, loc);
        }
      }
    }

    let uniqueLocations = Array.from(locationMap.values());

    // 7. Apply filters
    if (typeFilter) {
      uniqueLocations = uniqueLocations.filter(loc => loc.locationType === typeFilter);
    }
    if (isLiveFilter !== undefined) {
      uniqueLocations = uniqueLocations.filter(loc => loc.isLive === isLiveFilter);
    }

    // 8. Sort by listingsCount DESC and take top N
    const sortedLocations = uniqueLocations
      .sort((a, b) => (b.listingsCount || 0) - (a.listingsCount || 0))
      .slice(0, limit);

    // 9. Map to response format
    const results: AdminLocationSearchResult[] = sortedLocations.map((loc) => ({
      locationId: loc.locationId,
      locationType: loc.locationType || 'PLACE',
      name: loc.name,
      displayName: loc.displayName || loc.name,
      countryName: loc.countryName,
      countryCode: loc.countryCode,
      regionName: loc.regionName,
      parentPlaceName: loc.parentPlaceName,
      slug: loc.slug,
      isLive: loc.isLive ?? true, // Default to true for existing records without isLive
      listingsCount: loc.listingsCount || 0,
      createdAt: loc.createdAt,
    }));

    // 10. Return response
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
    console.error('Error listing locations:', error);
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
          message: 'An error occurred while listing locations',
        },
      }),
    };
  }
};

/**
 * Fetch child locations for matched locations
 * - For COUNTRY: fetch all PLACEs with mapboxCountryId = locationId
 * - For PLACE: fetch all LOCALITYs with mapboxPlaceId = locationId
 */
async function fetchChildLocations(parentLocations: LocationRecord[]): Promise<LocationRecord[]> {
  const childLocations: LocationRecord[] = [];

  for (const parent of parentLocations) {
    if (parent.locationType === 'COUNTRY') {
      // Fetch PLACEs with this country as parent
      const result = await docClient.send(
        new ScanCommand({
          TableName: LOCATIONS_TABLE_NAME,
          FilterExpression: 'mapboxCountryId = :countryId AND locationType = :type',
          ExpressionAttributeValues: {
            ':countryId': parent.locationId,
            ':type': 'PLACE',
          },
        })
      );
      childLocations.push(...((result.Items || []) as LocationRecord[]));
    } else if (parent.locationType === 'PLACE') {
      // Fetch LOCALITYs with this place as parent
      const result = await docClient.send(
        new ScanCommand({
          TableName: LOCATIONS_TABLE_NAME,
          FilterExpression: 'mapboxPlaceId = :placeId AND locationType = :type',
          ExpressionAttributeValues: {
            ':placeId': parent.locationId,
            ':type': 'LOCALITY',
          },
        })
      );
      childLocations.push(...((result.Items || []) as LocationRecord[]));
    }
  }

  return childLocations;
}

