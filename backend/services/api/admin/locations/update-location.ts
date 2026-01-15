/**
 * Admin API: Update Location
 * 
 * PUT /api/v1/admin/locations/{locationId}
 * 
 * Update a location's isLive status.
 * Updates all name variants for the same locationId.
 * 
 * Permission required: ADMIN_LISTING_APPROVE
 */

import { APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { requirePermission } from '../../lib/auth-middleware';
import { LocationRecord, UpdateLocationRequest, AdminLocationSearchResult } from '../../../types/location.types';

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client, {
  marshallOptions: { removeUndefinedValues: true },
});

const LOCATIONS_TABLE_NAME = process.env.LOCATIONS_TABLE_NAME!;

/**
 * Main handler
 */
export const handler: APIGatewayProxyHandler = async (event) => {
  const locationId = event.pathParameters?.locationId;
  console.log('Admin update location request:', { locationId, body: event.body });

  try {
    // 1. Require admin permission
    const authResult = requirePermission(event, 'ADMIN_LISTING_APPROVE');
    if ('error' in authResult) {
      return authResult.error;
    }

    const { user } = authResult;
    console.log(`Admin ${user.email} updating location ${locationId}`);

    // 2. Validate path parameter
    if (!locationId) {
      return errorResponse(400, 'MISSING_LOCATION_ID', 'locationId path parameter is required');
    }

    // 3. Parse and validate request body
    if (!event.body) {
      return errorResponse(400, 'MISSING_BODY', 'Request body is required');
    }

    let request: UpdateLocationRequest;
    try {
      request = JSON.parse(event.body);
    } catch {
      return errorResponse(400, 'INVALID_JSON', 'Request body must be valid JSON');
    }

    if (typeof request.isLive !== 'boolean') {
      return errorResponse(400, 'INVALID_IS_LIVE', 'isLive must be a boolean');
    }

    // 4. Find all name variants for this location
    const queryResult = await docClient.send(
      new QueryCommand({
        TableName: LOCATIONS_TABLE_NAME,
        KeyConditionExpression: 'pk = :pk',
        ExpressionAttributeValues: {
          ':pk': `LOCATION#${locationId}`,
        },
      })
    );

    if (!queryResult.Items || queryResult.Items.length === 0) {
      return errorResponse(404, 'LOCATION_NOT_FOUND', `Location with ID ${locationId} not found`);
    }

    const locations = queryResult.Items as LocationRecord[];
    console.log(`Found ${locations.length} name variant(s) for location ${locationId}`);

    // 5. Update all variants
    const now = new Date().toISOString();
    const updatePromises = locations.map((loc) =>
      docClient.send(
        new UpdateCommand({
          TableName: LOCATIONS_TABLE_NAME,
          Key: {
            pk: loc.pk,
            sk: loc.sk,
          },
          UpdateExpression: 'SET isLive = :isLive, updatedAt = :updatedAt',
          ExpressionAttributeValues: {
            ':isLive': request.isLive,
            ':updatedAt': now,
          },
          ReturnValues: 'ALL_NEW',
        })
      )
    );

    const updateResults = await Promise.all(updatePromises);
    console.log(`Updated ${updateResults.length} location variant(s) to isLive=${request.isLive}`);

    // 6. Return the first updated location as response
    const updatedLocation = updateResults[0].Attributes as LocationRecord;

    const result: AdminLocationSearchResult = {
      locationId: updatedLocation.locationId,
      locationType: updatedLocation.locationType || 'PLACE',
      name: updatedLocation.name,
      displayName: updatedLocation.displayName || updatedLocation.name,
      countryName: updatedLocation.countryName,
      countryCode: updatedLocation.countryCode,
      regionName: updatedLocation.regionName,
      parentPlaceName: updatedLocation.parentPlaceName,
      slug: updatedLocation.slug,
      isLive: updatedLocation.isLive,
      listingsCount: updatedLocation.listingsCount || 0,
      createdAt: updatedLocation.createdAt,
    };

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        success: true,
        data: {
          location: result,
          variantsUpdated: updateResults.length,
        },
      }),
    };
  } catch (error) {
    console.error('Error updating location:', error);
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
          message: 'An error occurred while updating the location',
        },
      }),
    };
  }
};

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

