import { APIGatewayProxyHandler, APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

// Import all individual operation handlers
import { handler as submitIntent } from './submit-intent';
import { handler as confirmSubmission } from './confirm-submission';
import { handler as updateRejectedProfile } from './update-rejected-profile';
import { handler as getProfile } from './get-profile';

/**
 * Consolidated Host Profile Handler
 *
 * Routes all host profile operations to their respective handlers based on
 * HTTP method and resource path.
 *
 * Supported routes:
 * - POST   /api/v1/hosts/{hostId}/profile/submit-intent       → submit host profile intent
 * - POST   /api/v1/hosts/{hostId}/profile/confirm-submission  → confirm submission
 * - PUT    /api/v1/hosts/{hostId}/profile/update-rejected     → update rejected profile
 * - GET    /api/v1/hosts/{hostId}/profile                     → get own profile
 */
export const handler: APIGatewayProxyHandler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  const method = event.httpMethod;
  const resource = event.resource;

  console.log('Host profile router:', { method, resource, pathParameters: event.pathParameters });

  // POST /api/v1/hosts/{hostId}/profile/submit-intent
  if (method === 'POST' && resource === '/api/v1/hosts/{hostId}/profile/submit-intent') {
    return await submitIntent(event);
  }

  // POST /api/v1/hosts/{hostId}/profile/confirm-submission
  if (method === 'POST' && resource === '/api/v1/hosts/{hostId}/profile/confirm-submission') {
    return await confirmSubmission(event);
  }

  // PUT /api/v1/hosts/{hostId}/profile/update-rejected
  if (method === 'PUT' && resource === '/api/v1/hosts/{hostId}/profile/update-rejected') {
    return await updateRejectedProfile(event);
  }

  // GET /api/v1/hosts/{hostId}/profile
  if (method === 'GET' && resource === '/api/v1/hosts/{hostId}/profile') {
    return await getProfile(event);
  }

  // Route not found
  console.warn('Route not matched:', { method, resource });
  return {
    statusCode: 404,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify({ success: false, error: { code: 'NOT_FOUND', message: 'Route not found' } }),
  };
};


