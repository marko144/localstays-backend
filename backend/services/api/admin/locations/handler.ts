/**
 * Admin Locations API Handler
 * 
 * Routes requests to the appropriate location management handler based on HTTP method and path.
 * 
 * Routes:
 * - GET /api/v1/admin/locations - List/search locations
 * - POST /api/v1/admin/locations - Create new location
 * - PUT /api/v1/admin/locations/{locationId} - Update location
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { handler as listLocationsHandler } from './list-locations';
import { handler as createLocationHandler } from './create-location';
import { handler as updateLocationHandler } from './update-location';

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const method = event.httpMethod;
  const locationId = event.pathParameters?.locationId;

  console.log('Admin Locations Handler:', { method, path: event.path, locationId });

  try {
    // Route based on HTTP method and path parameters
    if (method === 'GET' && !locationId) {
      // GET /api/v1/admin/locations - List/search locations
      return await listLocationsHandler(event, {} as any, () => {}) as APIGatewayProxyResult;
    }

    if (method === 'POST' && !locationId) {
      // POST /api/v1/admin/locations - Create new location
      return await createLocationHandler(event, {} as any, () => {}) as APIGatewayProxyResult;
    }

    if (method === 'PUT' && locationId) {
      // PUT /api/v1/admin/locations/{locationId} - Update location
      return await updateLocationHandler(event, {} as any, () => {}) as APIGatewayProxyResult;
    }

    // Unknown route
    return {
      statusCode: 404,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: `Unknown route: ${method} ${event.path}`,
        },
      }),
    };
  } catch (error) {
    console.error('Admin Locations Handler Error:', error);
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
          message: 'An unexpected error occurred',
        },
      }),
    };
  }
}

