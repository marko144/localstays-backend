import { APIGatewayProxyHandler, APIGatewayProxyEvent, APIGatewayProxyResult, Context, Callback } from 'aws-lambda';

// Import all individual operation handlers
import { handler as listListings } from './list-listings';
import { handler as pendingReviewListings } from './pending-review';
import { handler as listHostListings } from './list-host-listings';
import { handler as getListing } from './get-listing';
import { handler as setReviewing } from './set-reviewing';
import { handler as approveListing } from './approve-listing';
import { handler as rejectListing } from './reject-listing';
import { handler as suspendListing } from './suspend-listing';

/**
 * Consolidated Admin Listings Handler (v1.1 - supports LOCKED status)
 * 
 * Routes all admin listing operations to their respective handlers based on
 * HTTP method and resource path.
 * 
 * Supported routes:
 * - GET    /api/v1/admin/listings                        → list all listings
 * - GET    /api/v1/admin/listings/pending-review        → list pending review listings
 * - GET    /api/v1/admin/hosts/{hostId}/listings        → list listings for a host
 * - GET    /api/v1/admin/listings/{listingId}           → get listing details
 * - PUT    /api/v1/admin/listings/{listingId}/reviewing → set listing to reviewing
 * - PUT    /api/v1/admin/listings/{listingId}/approve   → approve listing (IN_REVIEW/REVIEWING/LOCKED)
 * - PUT    /api/v1/admin/listings/{listingId}/reject    → reject listing (IN_REVIEW/REVIEWING/LOCKED)
 * - PUT    /api/v1/admin/listings/{listingId}/suspend   → suspend listing
 */
export const handler: APIGatewayProxyHandler = async (
  event: APIGatewayProxyEvent,
  context: Context,
  callback: Callback<APIGatewayProxyResult>
): Promise<APIGatewayProxyResult> => {
  const method = event.httpMethod;
  const resource = event.resource;

  console.log('Admin listings router:', { method, resource, pathParameters: event.pathParameters });

  try {
    // Route based on method + resource pattern
    // Note: event.resource contains the API Gateway resource pattern (e.g., /api/v1/admin/listings/{listingId})

    // GET /api/v1/admin/listings
    if (method === 'GET' && resource === '/api/v1/admin/listings') {
      return (await listListings(event, context, callback)) as APIGatewayProxyResult;
    }

    // GET /api/v1/admin/listings/pending-review
    if (method === 'GET' && resource === '/api/v1/admin/listings/pending-review') {
      return (await pendingReviewListings(event, context, callback)) as APIGatewayProxyResult;
    }

    // GET /api/v1/admin/hosts/{hostId}/listings
    if (method === 'GET' && resource === '/api/v1/admin/hosts/{hostId}/listings') {
      return (await listHostListings(event, context, callback)) as APIGatewayProxyResult;
    }

    // GET /api/v1/admin/listings/{listingId}
    if (method === 'GET' && resource === '/api/v1/admin/listings/{listingId}') {
      return (await getListing(event, context, callback)) as APIGatewayProxyResult;
    }

    // PUT /api/v1/admin/listings/{listingId}/reviewing
    if (method === 'PUT' && resource === '/api/v1/admin/listings/{listingId}/reviewing') {
      return (await setReviewing(event, context, callback)) as APIGatewayProxyResult;
    }

    // PUT /api/v1/admin/listings/{listingId}/approve
    if (method === 'PUT' && resource === '/api/v1/admin/listings/{listingId}/approve') {
      return (await approveListing(event, context, callback)) as APIGatewayProxyResult;
    }

    // PUT /api/v1/admin/listings/{listingId}/reject
    if (method === 'PUT' && resource === '/api/v1/admin/listings/{listingId}/reject') {
      return (await rejectListing(event, context, callback)) as APIGatewayProxyResult;
    }

    // PUT /api/v1/admin/listings/{listingId}/suspend
    if (method === 'PUT' && resource === '/api/v1/admin/listings/{listingId}/suspend') {
      return (await suspendListing(event, context, callback)) as APIGatewayProxyResult;
    }

    // Route not found
    console.warn('Route not matched:', { method, resource });
    return {
      statusCode: 404,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        success: false,
        error: {
          code: 'ROUTE_NOT_FOUND',
          message: 'The requested route does not exist',
        },
      }),
    };
  } catch (error) {
    console.error('Router error:', error);
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
          message: 'An unexpected error occurred in the routing layer',
        },
      }),
    };
  }
};

