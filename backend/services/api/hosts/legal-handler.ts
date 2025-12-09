/**
 * Host Legal Handler
 * 
 * Routes legal operations to their respective handlers:
 * - GET /hosts/{hostId}/legal/status - Get legal status
 * - POST /hosts/{hostId}/legal/accept - Accept legal documents
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getLegalStatus } from './get-legal-status';
import { acceptLegal } from './accept-legal';

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  console.log('Host Legal Handler:', {
    path: event.path,
    method: event.httpMethod,
    pathParameters: event.pathParameters,
  });

  const { httpMethod, path } = event;

  try {
    // GET /api/v1/hosts/{hostId}/legal/status
    if (httpMethod === 'GET' && path.includes('/legal/status')) {
      return await getLegalStatus(event);
    }

    // POST /api/v1/hosts/{hostId}/legal/accept
    if (httpMethod === 'POST' && path.includes('/legal/accept')) {
      return await acceptLegal(event);
    }

    // Unknown route
    return {
      statusCode: 404,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        error: 'NOT_FOUND',
        message: `Route not found: ${httpMethod} ${path}`,
      }),
    };
  } catch (error) {
    console.error('Host Legal Handler error:', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        error: 'INTERNAL_ERROR',
        message: error instanceof Error ? error.message : 'An unexpected error occurred',
      }),
    };
  }
};

