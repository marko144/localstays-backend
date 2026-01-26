/**
 * Admin Config API Handler
 * 
 * Routes requests to the appropriate config handler based on HTTP method and path.
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { handler as getLanguagesHandler } from './get-languages';
import { handler as updateLanguagesHandler } from './update-languages';

/**
 * Main router for admin config endpoints
 */
export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const method = event.httpMethod;
  const path = event.path;

  console.log(`Admin Config API: ${method} ${path}`);

  // Route: /api/v1/admin/config/languages
  if (path.endsWith('/config/languages') || path.endsWith('/config/languages/')) {
    if (method === 'GET') {
      return getLanguagesHandler(event, {} as any, () => {}) as Promise<APIGatewayProxyResult>;
    }
    if (method === 'PUT') {
      return updateLanguagesHandler(event, {} as any, () => {}) as Promise<APIGatewayProxyResult>;
    }
  }

  // No matching route
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
        message: `Route not found: ${method} ${path}`,
      },
    }),
  };
}


