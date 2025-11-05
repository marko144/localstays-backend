import { APIGatewayProxyHandler, APIGatewayProxyEvent, APIGatewayProxyResult, Context, Callback } from 'aws-lambda';

// Import all individual operation handlers
import { handler as listRequests } from './list-requests';
import { handler as pendingReviewRequests } from './pending-review';
import { handler as getRequest } from './get-request';
import { handler as approveRequest } from './approve-request';
import { handler as rejectRequest } from './reject-request';
import { handler as listHostRequests } from './list-host-requests';
import { handler as getListingRequests } from './get-listing-requests';
import { handler as createPropertyVideoVerification } from './create-property-video-verification';
import { handler as createAddressVerification } from './create-address-verification';

/**
 * Consolidated Admin Requests Handler
 *
 * Routes all admin request operations to their respective handlers based on
 * HTTP method and resource path.
 *
 * Supported routes:
 * - GET    /api/v1/admin/requests                                          → list all requests
 * - GET    /api/v1/admin/requests/pending-review                          → list pending review requests
 * - GET    /api/v1/admin/requests/{requestId}                             → get request details
 * - PUT    /api/v1/admin/requests/{requestId}/approve                     → approve request
 * - PUT    /api/v1/admin/requests/{requestId}/reject                      → reject request
 * - GET    /api/v1/admin/hosts/{hostId}/requests                          → list host's requests
 * - GET    /api/v1/admin/listings/{listingId}/requests                    → list listing's requests
 * - POST   /api/v1/admin/listings/{listingId}/requests/property-video     → create property video verification
 * - POST   /api/v1/admin/listings/{listingId}/requests/address-verification → create address verification
 */
export const handler: APIGatewayProxyHandler = async (
  event: APIGatewayProxyEvent,
  context: Context,
  callback: Callback<APIGatewayProxyResult>
): Promise<APIGatewayProxyResult> => {
  const method = event.httpMethod;
  const resource = event.resource;

  console.log('Admin requests router:', { method, resource, pathParameters: event.pathParameters });

  // GET /api/v1/admin/requests
  if (method === 'GET' && resource === '/api/v1/admin/requests') {
    return (await listRequests(event, context, callback)) as APIGatewayProxyResult;
  }

  // GET /api/v1/admin/requests/pending-review
  if (method === 'GET' && resource === '/api/v1/admin/requests/pending-review') {
    return (await pendingReviewRequests(event, context, callback)) as APIGatewayProxyResult;
  }

  // GET /api/v1/admin/requests/{requestId}
  if (method === 'GET' && resource === '/api/v1/admin/requests/{requestId}') {
    return (await getRequest(event, context, callback)) as APIGatewayProxyResult;
  }

  // PUT /api/v1/admin/requests/{requestId}/approve
  if (method === 'PUT' && resource === '/api/v1/admin/requests/{requestId}/approve') {
    return (await approveRequest(event, context, callback)) as APIGatewayProxyResult;
  }

  // PUT /api/v1/admin/requests/{requestId}/reject
  if (method === 'PUT' && resource === '/api/v1/admin/requests/{requestId}/reject') {
    return (await rejectRequest(event, context, callback)) as APIGatewayProxyResult;
  }

  // GET /api/v1/admin/hosts/{hostId}/requests
  if (method === 'GET' && resource === '/api/v1/admin/hosts/{hostId}/requests') {
    return (await listHostRequests(event, context, callback)) as APIGatewayProxyResult;
  }

  // GET /api/v1/admin/listings/{listingId}/requests
  if (method === 'GET' && resource === '/api/v1/admin/listings/{listingId}/requests') {
    return (await getListingRequests(event, context, callback)) as APIGatewayProxyResult;
  }

  // POST /api/v1/admin/listings/{listingId}/requests/property-video
  if (method === 'POST' && resource === '/api/v1/admin/listings/{listingId}/requests/property-video') {
    return await createPropertyVideoVerification(event);
  }

  // POST /api/v1/admin/listings/{listingId}/requests/address-verification
  if (method === 'POST' && resource === '/api/v1/admin/listings/{listingId}/requests/address-verification') {
    return await createAddressVerification(event);
  }

  // Route not found
  console.warn('Route not matched:', { method, resource });
  return {
    statusCode: 404,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify({ success: false, error: { code: 'NOT_FOUND', message: 'Route not found' } }),
  };
};


