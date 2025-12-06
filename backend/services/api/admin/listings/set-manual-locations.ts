/**
 * Admin API: Set Manual Locations for Listing
 * 
 * PUT /api/v1/admin/listings/{listingId}/manual-locations
 * 
 * Associates a listing with one or more locations from the Locations table.
 * Used when hosts enter addresses manually without Mapbox autocomplete.
 * 
 * If a LOCALITY is selected, automatically includes the parent PLACE as well.
 * 
 * Permission required: ADMIN_LISTING_APPROVE
 */

import { APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { requirePermission } from '../../lib/auth-middleware';
import { LocationRecord } from '../../../types/location.types';

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client, {
  marshallOptions: { removeUndefinedValues: true },
});

const TABLE_NAME = process.env.TABLE_NAME!;
const LOCATIONS_TABLE_NAME = process.env.LOCATIONS_TABLE_NAME!;

/**
 * Request body
 */
interface SetManualLocationsRequest {
  locationId: string;  // Single location ID (PLACE or LOCALITY)
}

/**
 * Main handler
 */
export const handler: APIGatewayProxyHandler = async (event) => {
  const listingId = event.pathParameters?.listingId;
  
  console.log('Set manual locations request:', { listingId, body: event.body });

  try {
    // 1. Require admin permission
    const authResult = requirePermission(event, 'ADMIN_LISTING_APPROVE');
    if ('error' in authResult) {
      return authResult.error;
    }

    const { user } = authResult;
    console.log(`Admin ${user.email} setting manual locations for listing ${listingId}`);

    // 2. Validate listingId
    if (!listingId) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({
          success: false,
          error: {
            code: 'MISSING_LISTING_ID',
            message: 'Listing ID is required',
          },
        }),
      };
    }

    // 3. Parse and validate request body
    if (!event.body) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({
          success: false,
          error: {
            code: 'MISSING_BODY',
            message: 'Request body is required',
          },
        }),
      };
    }

    let body: SetManualLocationsRequest;
    try {
      body = JSON.parse(event.body);
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
            message: 'Invalid JSON in request body',
          },
        }),
      };
    }

    if (!body.locationId) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({
          success: false,
          error: {
            code: 'MISSING_LOCATION_ID',
            message: 'locationId is required',
          },
        }),
      };
    }

    // 4. Find the listing using DocumentStatusIndex (same as get-listing)
    const listingResult = await docClient.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        IndexName: 'DocumentStatusIndex',
        KeyConditionExpression: 'gsi3pk = :gsi3pk AND begins_with(gsi3sk, :gsi3sk)',
        ExpressionAttributeValues: {
          ':gsi3pk': `LISTING#${listingId}`,
          ':gsi3sk': 'LISTING_META#',
        },
        Limit: 1,
      })
    );

    if (!listingResult.Items || listingResult.Items.length === 0) {
      return {
        statusCode: 404,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({
          success: false,
          error: {
            code: 'LISTING_NOT_FOUND',
            message: 'Listing not found',
          },
        }),
      };
    }

    const listing = listingResult.Items[0];
    const hostId = listing.hostId;

    // 5. Validate the location exists in our Locations table
    // Query for any name variant of this location
    const locationResult = await docClient.send(
      new QueryCommand({
        TableName: LOCATIONS_TABLE_NAME,
        KeyConditionExpression: 'pk = :pk',
        ExpressionAttributeValues: {
          ':pk': `LOCATION#${body.locationId}`,
        },
        Limit: 1,
      })
    );

    if (!locationResult.Items || locationResult.Items.length === 0) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({
          success: false,
          error: {
            code: 'LOCATION_NOT_FOUND',
            message: `Location with ID "${body.locationId}" not found in locations table`,
          },
        }),
      };
    }

    const location = locationResult.Items[0] as LocationRecord;

    // 6. Build the manualLocationIds array
    // If LOCALITY, include both the LOCALITY ID and its parent PLACE ID
    let manualLocationIds: string[];
    let locationNames: string[] = [];

    if (location.locationType === 'LOCALITY') {
      // LOCALITY selected - include both LOCALITY and parent PLACE
      const parentPlaceId = location.mapboxPlaceId;
      
      if (parentPlaceId && parentPlaceId !== body.locationId) {
        // Verify parent PLACE exists
        const parentResult = await docClient.send(
          new QueryCommand({
            TableName: LOCATIONS_TABLE_NAME,
            KeyConditionExpression: 'pk = :pk',
            ExpressionAttributeValues: {
              ':pk': `LOCATION#${parentPlaceId}`,
            },
            Limit: 1,
          })
        );

        if (parentResult.Items && parentResult.Items.length > 0) {
          const parentLocation = parentResult.Items[0] as LocationRecord;
          manualLocationIds = [parentPlaceId, body.locationId]; // PLACE first, then LOCALITY
          locationNames = [parentLocation.name, location.name];
          console.log(`Setting manual locations: PLACE (${parentLocation.name}) + LOCALITY (${location.name})`);
        } else {
          // Parent not found - just use the LOCALITY
          manualLocationIds = [body.locationId];
          locationNames = [location.name];
          console.warn(`Parent PLACE ${parentPlaceId} not found, using LOCALITY only`);
        }
      } else {
        // No different parent - just use the selected location
        manualLocationIds = [body.locationId];
        locationNames = [location.name];
      }
    } else {
      // PLACE selected - just use the PLACE
      manualLocationIds = [body.locationId];
      locationNames = [location.name];
      console.log(`Setting manual location: PLACE (${location.name})`);
    }

    // 7. Update the listing with manualLocationIds and denormalized locationId
    const now = new Date().toISOString();
    
    // The first ID in manualLocationIds is always the PLACE (primary location for querying)
    const locationId = manualLocationIds[0];

    await docClient.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: {
          pk: `HOST#${hostId}`,
          sk: `LISTING_META#${listingId}`,
        },
        UpdateExpression: 'SET manualLocationIds = :locationIds, locationId = :locationId, gsi8pk = :gsi8pk, gsi8sk = :gsi8sk, updatedAt = :now',
        ExpressionAttributeValues: {
          ':locationIds': manualLocationIds,
          ':locationId': locationId,
          ':gsi8pk': `LOCATION#${locationId}`,
          ':gsi8sk': `LISTING#${listingId}`,
          ':now': now,
        },
      })
    );

    console.log(`Updated listing ${listingId} with manualLocationIds: ${manualLocationIds.join(', ')}, locationId: ${locationId}`);

    // 8. Return success response
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        success: true,
        data: {
          listingId,
          manualLocationIds,
          locationNames,
          message: `Listing associated with ${manualLocationIds.length} location(s)`,
        },
      }),
    };
  } catch (error) {
    console.error('Error setting manual locations:', error);
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
          message: 'An error occurred while setting manual locations',
        },
      }),
    };
  }
};





