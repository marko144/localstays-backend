/**
 * Host Listings Handler (Consolidated Router)
 * Routes requests to appropriate listing operation handlers
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import * as response from '../lib/response';

// Import individual handlers
import { handler as getMetadataHandler } from './get-metadata';
import { handler as submitIntentHandler } from './submit-intent';
import { handler as confirmSubmissionHandler } from './confirm-submission';
import { handler as listListingsHandler } from './list-listings';
import { handler as getListingHandler } from './get-listing';
import { handler as deleteListingHandler } from './delete-listing';
import { handler as submitImageUpdateHandler } from './submit-image-update';
import { handler as confirmImageUpdateHandler } from './confirm-image-update';
import { handler as updateListingHandler } from './update-listing';
import { handler as resubmitForReviewHandler } from './resubmit-for-review';
import { handler as getPricingHandler } from './get-pricing';
import { handler as setPricingHandler } from './set-pricing';

/**
 * Main router handler - dispatches to appropriate operation based on route and method
 */
export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const method = event.httpMethod;
  const resource = event.resource;

  console.log('Host listings router:', {
    method,
    resource,
    pathParameters: event.pathParameters,
  });

  try {
    // Route: GET /api/v1/listings/metadata (public, no hostId)
    if (method === 'GET' && resource === '/api/v1/listings/metadata') {
      return await getMetadataHandler(event);
    }

    // Route: POST /api/v1/hosts/{hostId}/listings/submit-intent
    if (method === 'POST' && resource === '/api/v1/hosts/{hostId}/listings/submit-intent') {
      return await submitIntentHandler(event);
    }

    // Route: POST /api/v1/hosts/{hostId}/listings/{listingId}/confirm-submission
    if (method === 'POST' && resource === '/api/v1/hosts/{hostId}/listings/{listingId}/confirm-submission') {
      return await confirmSubmissionHandler(event);
    }

    // Route: GET /api/v1/hosts/{hostId}/listings (list all)
    if (method === 'GET' && resource === '/api/v1/hosts/{hostId}/listings') {
      return await listListingsHandler(event);
    }

    // Route: GET /api/v1/hosts/{hostId}/listings/{listingId}
    if (method === 'GET' && resource === '/api/v1/hosts/{hostId}/listings/{listingId}') {
      return await getListingHandler(event);
    }

    // Route: DELETE /api/v1/hosts/{hostId}/listings/{listingId}
    if (method === 'DELETE' && resource === '/api/v1/hosts/{hostId}/listings/{listingId}') {
      return await deleteListingHandler(event);
    }

    // Route: POST /api/v1/hosts/{hostId}/listings/{listingId}/image-update
    if (method === 'POST' && resource === '/api/v1/hosts/{hostId}/listings/{listingId}/image-update') {
      return await submitImageUpdateHandler(event);
    }

    // Route: POST /api/v1/hosts/{hostId}/listings/{listingId}/image-update/confirm
    if (method === 'POST' && resource === '/api/v1/hosts/{hostId}/listings/{listingId}/image-update/confirm') {
      return await confirmImageUpdateHandler(event);
    }

    // Route: PUT /api/v1/hosts/{hostId}/listings/{listingId}/update
    if (method === 'PUT' && resource === '/api/v1/hosts/{hostId}/listings/{listingId}/update') {
      return await updateListingHandler(event);
    }

    // Route: POST /api/v1/hosts/{hostId}/listings/{listingId}/resubmit
    if (method === 'POST' && resource === '/api/v1/hosts/{hostId}/listings/{listingId}/resubmit') {
      return await resubmitForReviewHandler(event);
    }

    // Route: GET /api/v1/hosts/{hostId}/listings/{listingId}/pricing
    if (method === 'GET' && resource === '/api/v1/hosts/{hostId}/listings/{listingId}/pricing') {
      return await getPricingHandler(event);
    }

    // Route: PUT /api/v1/hosts/{hostId}/listings/{listingId}/pricing
    if (method === 'PUT' && resource === '/api/v1/hosts/{hostId}/listings/{listingId}/pricing') {
      return await setPricingHandler(event);
    }

    // Unknown route
    console.error('Unknown route:', { method, resource });
    return response.notFound('Route not found');

  } catch (error) {
    console.error('Router error:', error);
    return response.internalError('Internal server error');
  }
}


