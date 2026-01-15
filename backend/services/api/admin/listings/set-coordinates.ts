/**
 * Admin API: Set/Update Coordinates for Listing
 * 
 * PUT /api/v1/admin/listings/{listingId}/coordinates
 * 
 * Allows admins to set or update the latitude and longitude coordinates
 * for a listing. If the listing is published, the coordinates are also
 * synced to the PublicListings table.
 * 
 * Permission required: ADMIN_LISTING_APPROVE
 */

import { APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { requirePermission } from '../../lib/auth-middleware';
import { ListingMetadata } from '../../../types/listing.types';

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client, {
  marshallOptions: { removeUndefinedValues: true },
});

const TABLE_NAME = process.env.TABLE_NAME!;
const PUBLIC_LISTINGS_TABLE_NAME = process.env.PUBLIC_LISTINGS_TABLE_NAME!;

/**
 * Request body
 */
interface SetCoordinatesRequest {
  latitude: number;
  longitude: number;
}

/**
 * Validates latitude value
 * Valid range: -90 to 90
 */
function isValidLatitude(lat: number): boolean {
  return typeof lat === 'number' && !isNaN(lat) && lat >= -90 && lat <= 90;
}

/**
 * Validates longitude value
 * Valid range: -180 to 180
 */
function isValidLongitude(lng: number): boolean {
  return typeof lng === 'number' && !isNaN(lng) && lng >= -180 && lng <= 180;
}

/**
 * Main handler
 */
export const handler: APIGatewayProxyHandler = async (event) => {
  const listingId = event.pathParameters?.listingId;
  
  console.log('Set coordinates request:', { listingId, body: event.body });

  try {
    // 1. Require admin permission
    const authResult = requirePermission(event, 'ADMIN_LISTING_APPROVE');
    if ('error' in authResult) {
      return authResult.error;
    }

    const { user } = authResult;
    console.log(`Admin ${user.email} setting coordinates for listing ${listingId}`);

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

    let body: SetCoordinatesRequest;
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

    // 4. Validate coordinates
    if (body.latitude === undefined || body.longitude === undefined) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({
          success: false,
          error: {
            code: 'MISSING_COORDINATES',
            message: 'Both latitude and longitude are required',
          },
        }),
      };
    }

    if (!isValidLatitude(body.latitude)) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({
          success: false,
          error: {
            code: 'INVALID_LATITUDE',
            message: 'Latitude must be a number between -90 and 90',
          },
        }),
      };
    }

    if (!isValidLongitude(body.longitude)) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({
          success: false,
          error: {
            code: 'INVALID_LONGITUDE',
            message: 'Longitude must be a number between -180 and 180',
          },
        }),
      };
    }

    // 5. Find the listing using DocumentStatusIndex
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

    const listing = listingResult.Items[0] as ListingMetadata & { pk: string; sk: string };
    const hostId = listing.hostId;

    // 6. Update the listing with new coordinates
    const now = new Date().toISOString();
    
    // Build the updated address object
    const updatedAddress = {
      ...(listing.address || {}),
      coordinates: {
        latitude: body.latitude,
        longitude: body.longitude,
      },
    };

    await docClient.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: {
          pk: `HOST#${hostId}`,
          sk: `LISTING_META#${listingId}`,
        },
        UpdateExpression: 'SET address = :address, updatedAt = :now',
        ExpressionAttributeValues: {
          ':address': updatedAddress,
          ':now': now,
        },
      })
    );

    console.log(`Updated listing ${listingId} with coordinates: ${body.latitude}, ${body.longitude}`);

    // 7. If listing is published, sync to PublicListings table
    if (listing.status === 'PUBLISHED') {
      try {
        await docClient.send(
          new UpdateCommand({
            TableName: PUBLIC_LISTINGS_TABLE_NAME,
            Key: {
              pk: `LISTING#${listingId}`,
              sk: 'METADATA',
            },
            UpdateExpression: 'SET latitude = :lat, longitude = :lng, updatedAt = :now',
            ExpressionAttributeValues: {
              ':lat': body.latitude,
              ':lng': body.longitude,
              ':now': now,
            },
          })
        );
        console.log(`Synced coordinates to PublicListings for listing ${listingId}`);
      } catch (syncError) {
        // Log but don't fail - the main update succeeded
        console.error('Failed to sync coordinates to PublicListings:', syncError);
      }
    }

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
          coordinates: {
            latitude: body.latitude,
            longitude: body.longitude,
          },
          synced: listing.status === 'PUBLISHED',
          message: 'Coordinates updated successfully',
        },
      }),
    };
  } catch (error) {
    console.error('Error setting coordinates:', error);
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
          message: 'An error occurred while setting coordinates',
        },
      }),
    };
  }
};


