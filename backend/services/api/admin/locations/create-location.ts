/**
 * Admin API: Create Location
 * 
 * POST /api/v1/admin/locations
 * 
 * Create a new location (COUNTRY, PLACE, or LOCALITY).
 * Validates parent existence for PLACE (requires COUNTRY) and LOCALITY (requires PLACE).
 * 
 * Permission required: ADMIN_LISTING_APPROVE
 */

import { APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { requirePermission } from '../../lib/auth-middleware';
import { 
  LocationRecord, 
  CreateLocationRequest,
  CreateCountryRequest,
  CreatePlaceRequest,
  CreateLocalityRequest,
  generateLocationSlug,
  generateSearchName,
} from '../../../types/location.types';

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client, {
  marshallOptions: { removeUndefinedValues: true },
});

const LOCATIONS_TABLE_NAME = process.env.LOCATIONS_TABLE_NAME!;

/**
 * Main handler
 */
export const handler: APIGatewayProxyHandler = async (event) => {
  console.log('Admin create location request:', { body: event.body });

  try {
    // 1. Require admin permission
    const authResult = requirePermission(event, 'ADMIN_LISTING_APPROVE');
    if ('error' in authResult) {
      return authResult.error;
    }

    const { user } = authResult;
    console.log(`Admin ${user.email} creating location`);

    // 2. Parse and validate request body
    if (!event.body) {
      return errorResponse(400, 'MISSING_BODY', 'Request body is required');
    }

    let request: CreateLocationRequest;
    try {
      request = JSON.parse(event.body);
    } catch {
      return errorResponse(400, 'INVALID_JSON', 'Request body must be valid JSON');
    }

    // 3. Validate based on location type
    const validationError = await validateRequest(request);
    if (validationError) {
      return validationError;
    }

    // 4. Check if location already exists
    const existingCheck = await docClient.send(
      new QueryCommand({
        TableName: LOCATIONS_TABLE_NAME,
        KeyConditionExpression: 'pk = :pk',
        ExpressionAttributeValues: {
          ':pk': `LOCATION#${request.locationId}`,
        },
        Limit: 1,
      })
    );

    if (existingCheck.Items && existingCheck.Items.length > 0) {
      return errorResponse(409, 'LOCATION_EXISTS', `Location with ID ${request.locationId} already exists`);
    }

    // 5. Build location record
    const now = new Date().toISOString();
    const locationRecord = buildLocationRecord(request, now);

    // 6. Save to DynamoDB
    await docClient.send(
      new PutCommand({
        TableName: LOCATIONS_TABLE_NAME,
        Item: locationRecord,
        ConditionExpression: 'attribute_not_exists(pk)',
      })
    );

    console.log(`Created ${request.locationType} location: ${request.name} (${request.locationId})`);

    // 7. Return success response
    return {
      statusCode: 201,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        success: true,
        data: {
          location: {
            locationId: locationRecord.locationId,
            locationType: locationRecord.locationType,
            name: locationRecord.name,
            displayName: locationRecord.displayName,
            countryName: locationRecord.countryName,
            countryCode: locationRecord.countryCode,
            regionName: locationRecord.regionName,
            parentPlaceName: locationRecord.parentPlaceName,
            slug: locationRecord.slug,
            isLive: locationRecord.isLive,
            listingsCount: locationRecord.listingsCount,
            createdAt: locationRecord.createdAt,
          },
        },
      }),
    };
  } catch (error) {
    console.error('Error creating location:', error);
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
          message: 'An error occurred while creating the location',
        },
      }),
    };
  }
};

/**
 * Validate request based on location type
 */
async function validateRequest(request: CreateLocationRequest): Promise<ReturnType<typeof errorResponse> | null> {
  // Common validations
  if (!request.locationId || typeof request.locationId !== 'string') {
    return errorResponse(400, 'INVALID_LOCATION_ID', 'locationId is required and must be a string');
  }
  if (!request.name || typeof request.name !== 'string') {
    return errorResponse(400, 'INVALID_NAME', 'name is required and must be a string');
  }
  if (!['COUNTRY', 'PLACE', 'LOCALITY'].includes(request.locationType)) {
    return errorResponse(400, 'INVALID_LOCATION_TYPE', 'locationType must be COUNTRY, PLACE, or LOCALITY');
  }

  // Type-specific validations
  switch (request.locationType) {
    case 'COUNTRY':
      return validateCountryRequest(request);
    case 'PLACE':
      return validatePlaceRequest(request);
    case 'LOCALITY':
      return validateLocalityRequest(request);
  }
}

/**
 * Validate COUNTRY request
 */
function validateCountryRequest(request: CreateCountryRequest): ReturnType<typeof errorResponse> | null {
  if (!request.countryCode || typeof request.countryCode !== 'string') {
    return errorResponse(400, 'INVALID_COUNTRY_CODE', 'countryCode is required for COUNTRY type');
  }
  if (request.countryCode.length !== 2) {
    return errorResponse(400, 'INVALID_COUNTRY_CODE', 'countryCode must be a 2-letter ISO code');
  }
  return null;
}

/**
 * Validate PLACE request and check parent COUNTRY exists
 */
async function validatePlaceRequest(request: CreatePlaceRequest): Promise<ReturnType<typeof errorResponse> | null> {
  if (!request.regionName || typeof request.regionName !== 'string') {
    return errorResponse(400, 'INVALID_REGION_NAME', 'regionName is required for PLACE type');
  }
  if (!request.countryName || typeof request.countryName !== 'string') {
    return errorResponse(400, 'INVALID_COUNTRY_NAME', 'countryName is required for PLACE type');
  }
  if (!request.mapboxCountryId || typeof request.mapboxCountryId !== 'string') {
    return errorResponse(400, 'INVALID_MAPBOX_COUNTRY_ID', 'mapboxCountryId is required for PLACE type');
  }
  if (!request.mapboxRegionId || typeof request.mapboxRegionId !== 'string') {
    return errorResponse(400, 'INVALID_MAPBOX_REGION_ID', 'mapboxRegionId is required for PLACE type');
  }

  // Verify parent COUNTRY exists
  const parentCheck = await docClient.send(
    new QueryCommand({
      TableName: LOCATIONS_TABLE_NAME,
      KeyConditionExpression: 'pk = :pk',
      ExpressionAttributeValues: {
        ':pk': `LOCATION#${request.mapboxCountryId}`,
      },
      Limit: 1,
    })
  );

  if (!parentCheck.Items || parentCheck.Items.length === 0) {
    return errorResponse(400, 'PARENT_NOT_FOUND', `Parent COUNTRY with ID ${request.mapboxCountryId} does not exist`);
  }

  const parentLocation = parentCheck.Items[0] as LocationRecord;
  if (parentLocation.locationType !== 'COUNTRY') {
    return errorResponse(400, 'INVALID_PARENT_TYPE', `Location ${request.mapboxCountryId} is not a COUNTRY`);
  }

  return null;
}

/**
 * Validate LOCALITY request and check parent PLACE exists
 */
async function validateLocalityRequest(request: CreateLocalityRequest): Promise<ReturnType<typeof errorResponse> | null> {
  if (!request.regionName || typeof request.regionName !== 'string') {
    return errorResponse(400, 'INVALID_REGION_NAME', 'regionName is required for LOCALITY type');
  }
  if (!request.countryName || typeof request.countryName !== 'string') {
    return errorResponse(400, 'INVALID_COUNTRY_NAME', 'countryName is required for LOCALITY type');
  }
  if (!request.mapboxPlaceId || typeof request.mapboxPlaceId !== 'string') {
    return errorResponse(400, 'INVALID_MAPBOX_PLACE_ID', 'mapboxPlaceId is required for LOCALITY type');
  }
  if (!request.parentPlaceName || typeof request.parentPlaceName !== 'string') {
    return errorResponse(400, 'INVALID_PARENT_PLACE_NAME', 'parentPlaceName is required for LOCALITY type');
  }

  // Verify parent PLACE exists
  const parentCheck = await docClient.send(
    new QueryCommand({
      TableName: LOCATIONS_TABLE_NAME,
      KeyConditionExpression: 'pk = :pk',
      ExpressionAttributeValues: {
        ':pk': `LOCATION#${request.mapboxPlaceId}`,
      },
      Limit: 1,
    })
  );

  if (!parentCheck.Items || parentCheck.Items.length === 0) {
    return errorResponse(400, 'PARENT_NOT_FOUND', `Parent PLACE with ID ${request.mapboxPlaceId} does not exist`);
  }

  const parentLocation = parentCheck.Items[0] as LocationRecord;
  if (parentLocation.locationType !== 'PLACE') {
    return errorResponse(400, 'INVALID_PARENT_TYPE', `Location ${request.mapboxPlaceId} is not a PLACE`);
  }

  return null;
}

/**
 * Build location record from request
 */
function buildLocationRecord(request: CreateLocationRequest, now: string): LocationRecord {
  const baseRecord: Partial<LocationRecord> = {
    pk: `LOCATION#${request.locationId}`,
    sk: `NAME#${request.name}`,
    locationId: request.locationId,
    locationType: request.locationType,
    name: request.name,
    entityType: 'LOCATION',
    listingsCount: 0,
    isLive: request.isLive ?? false,
    createdAt: now,
    updatedAt: now,
  };

  switch (request.locationType) {
    case 'COUNTRY':
      return {
        ...baseRecord,
        countryName: request.name,
        countryCode: request.countryCode.toUpperCase(),
        displayName: request.name,
        slug: request.countryCode.toLowerCase(),
        searchName: request.name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''),
      } as LocationRecord;

    case 'PLACE':
      // Get countryCode from parent country for slug generation
      return {
        ...baseRecord,
        countryName: request.countryName,
        regionName: request.regionName,
        displayName: request.name,
        mapboxPlaceId: request.locationId,
        mapboxCountryId: request.mapboxCountryId,
        mapboxRegionId: request.mapboxRegionId,
        slug: generateLocationSlug(request.name, getCountryCodeFromName(request.countryName)),
        searchName: generateSearchName(request.name, request.regionName),
      } as LocationRecord;

    case 'LOCALITY':
      return {
        ...baseRecord,
        countryName: request.countryName,
        regionName: request.regionName,
        displayName: `${request.name}, ${request.parentPlaceName}`,
        parentPlaceName: request.parentPlaceName,
        mapboxPlaceId: request.mapboxPlaceId,
        mapboxLocalityId: request.locationId,
        slug: generateLocationSlug(request.name, getCountryCodeFromName(request.countryName)),
        searchName: generateSearchName(request.name, request.regionName),
      } as LocationRecord;
  }
}

/**
 * Simple mapping of country names to codes (expand as needed)
 */
function getCountryCodeFromName(countryName: string): string {
  const mapping: Record<string, string> = {
    'Serbia': 'RS',
    'Montenegro': 'ME',
    'Croatia': 'HR',
    'Bosnia and Herzegovina': 'BA',
    'Slovenia': 'SI',
    'North Macedonia': 'MK',
    'Albania': 'AL',
    'Kosovo': 'XK',
    'Greece': 'GR',
    'Bulgaria': 'BG',
    'Romania': 'RO',
    'Hungary': 'HU',
  };
  return mapping[countryName] || 'XX';
}

/**
 * Helper to create error response
 */
function errorResponse(statusCode: number, code: string, message: string) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
    body: JSON.stringify({
      success: false,
      error: { code, message },
    }),
  };
}

