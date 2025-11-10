/**
 * Host Requests Handler (Consolidated Router)
 * Routes:
 * - GET    /api/v1/hosts/{hostId}/requests
 * - GET    /api/v1/hosts/{hostId}/requests/{requestId}
 * - POST   /api/v1/hosts/{hostId}/requests/{requestId}/submit-intent
 * - POST   /api/v1/hosts/{hostId}/requests/{requestId}/confirm-submission
 * - GET    /api/v1/hosts/{hostId}/listings/{listingId}/requests
 * - POST   /api/v1/hosts/{hostId}/listings/{listingId}/requests/{requestId}/submit-video-intent
 * - POST   /api/v1/hosts/{hostId}/listings/{listingId}/requests/{requestId}/confirm-video
 * - POST   /api/v1/hosts/{hostId}/listings/{listingId}/requests/{requestId}/submit-code
 */

import { APIGatewayProxyHandler, APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import * as response from '../lib/response';

// Import individual handlers
import { handler as listRequestsHandler } from './list-requests';
import { handler as getRequestHandler } from './get-request';
import { handler as submitIntentHandler } from './submit-intent';
import { handler as confirmSubmissionHandler } from './confirm-submission';
import { handler as submitVideoIntentHandler } from '../hosts/submit-video-intent';
import { handler as confirmVideoHandler } from '../hosts/confirm-video';
import { handler as submitVerificationCodeHandler } from '../hosts/submit-verification-code';
import { handler as getListingRequestsHandler } from '../hosts/get-listing-requests';

/**
 * Main router handler - dispatches to appropriate operation based on route and method
 * 
 * Supported routes:
 * - GET    /api/v1/hosts/{hostId}/requests                                           → list host's requests
 * - GET    /api/v1/hosts/{hostId}/requests/{requestId}                               → get request details
 * - POST   /api/v1/hosts/{hostId}/requests/submit-intent                             → submit new request intent
 * - POST   /api/v1/hosts/{hostId}/requests/{requestId}/confirm-submission            → confirm request submission
 * - GET    /api/v1/hosts/{hostId}/listings/{listingId}/requests                      → get listing's requests
 * - POST   /api/v1/hosts/{hostId}/listings/{listingId}/requests/{requestId}/submit-video-intent  → submit video intent
 * - POST   /api/v1/hosts/{hostId}/listings/{listingId}/requests/{requestId}/confirm-video        → confirm video upload
 * - POST   /api/v1/hosts/{hostId}/listings/{listingId}/requests/{requestId}/submit-code → submit verification code
 */
export const handler: APIGatewayProxyHandler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  const method = event.httpMethod;
  const resource = event.resource;

  console.log('Host requests router:', {
    method,
    resource,
    pathParameters: event.pathParameters,
  });

  try {
    // Route: GET /api/v1/hosts/{hostId}/requests
    if (method === 'GET' && resource === '/api/v1/hosts/{hostId}/requests') {
      return await listRequestsHandler(event);
    }

    // Route: GET /api/v1/hosts/{hostId}/requests/{requestId}
    if (method === 'GET' && resource === '/api/v1/hosts/{hostId}/requests/{requestId}') {
      return await getRequestHandler(event);
    }

    // Route: POST /api/v1/hosts/{hostId}/requests/{requestId}/submit-intent
    if (method === 'POST' && resource === '/api/v1/hosts/{hostId}/requests/{requestId}/submit-intent') {
      return await submitIntentHandler(event);
    }

    // Route: POST /api/v1/hosts/{hostId}/requests/{requestId}/confirm-submission
    if (method === 'POST' && resource === '/api/v1/hosts/{hostId}/requests/{requestId}/confirm-submission') {
      return await confirmSubmissionHandler(event);
    }

    // Route: GET /api/v1/hosts/{hostId}/listings/{listingId}/requests
    if (method === 'GET' && resource === '/api/v1/hosts/{hostId}/listings/{listingId}/requests') {
      return await getListingRequestsHandler(event);
    }

    // Route: POST /api/v1/hosts/{hostId}/listings/{listingId}/requests/{requestId}/submit-video-intent
    if (method === 'POST' && resource === '/api/v1/hosts/{hostId}/listings/{listingId}/requests/{requestId}/submit-video-intent') {
      return await submitVideoIntentHandler(event);
    }

    // Route: POST /api/v1/hosts/{hostId}/listings/{listingId}/requests/{requestId}/confirm-video
    if (method === 'POST' && resource === '/api/v1/hosts/{hostId}/listings/{listingId}/requests/{requestId}/confirm-video') {
      return await confirmVideoHandler(event);
    }

    // Route: POST /api/v1/hosts/{hostId}/listings/{listingId}/requests/{requestId}/submit-code
    if (method === 'POST' && resource === '/api/v1/hosts/{hostId}/listings/{listingId}/requests/{requestId}/submit-code') {
      return await submitVerificationCodeHandler(event);
    }

    // Unknown route
    console.error('Unknown route:', { method, resource });
    return response.notFound('Route not found');

  } catch (error) {
    console.error('Router error:', error);
    return response.internalError('Internal server error');
  }
};

