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
import { handler as searchLocations } from './search-locations';
import { handler as setManualLocations } from './set-manual-locations';
import { handler as bulkApprove } from './bulk-approve';
import { handler as bulkApproveByIds } from './bulk-approve-by-ids';
import { handler as searchByLocation } from './search-by-location';
import { handler as setCoordinates } from './set-coordinates';
import { handler as setTranslations } from './set-translations';
import { handler as listTranslationRequests } from './list-translation-requests';
import { handler as completeTranslationRequest } from './complete-translation-request';
import { handler as getLanguages } from '../config/get-languages';
import { handler as updateLanguages } from '../config/update-languages';

/**
 * Consolidated Admin Listings Handler (v2.0 - multi-language translation support)
 * 
 * Routes all admin listing operations to their respective handlers based on
 * HTTP method and resource path.
 * 
 * Supported routes:
 * - GET    /api/v1/admin/listings                                   → list all listings
 * - GET    /api/v1/admin/listings/pending-review                    → list pending review listings
 * - GET    /api/v1/admin/translation-requests                       → list pending translation requests
 * - PATCH  /api/v1/admin/translation-requests/{listingId}/complete  → mark translation request complete
 * - GET    /api/v1/admin/config/languages                           → get language configuration
 * - PUT    /api/v1/admin/config/languages                           → update language configuration
 * - POST   /api/v1/admin/listings/by-location                       → search listings by one or more locations
 * - GET    /api/v1/admin/hosts/{hostId}/listings                    → list listings for a host
 * - GET    /api/v1/admin/listings/{listingId}                       → get listing details
 * - GET    /api/v1/admin/locations/search                           → search locations for manual association
 * - POST   /api/v1/admin/listings/bulk-approve                      → bulk approve ready listings (by readyToApprove flag)
 * - POST   /api/v1/admin/listings/bulk-approve-by-ids               → bulk approve listings by IDs
 * - POST   /api/v1/admin/listings/{listingId}/pre-approve           → mark listing ready (sets flag, keeps status)
 * - PUT    /api/v1/admin/listings/{listingId}/reviewing             → set listing to reviewing
 * - PUT    /api/v1/admin/listings/{listingId}/approve               → approve listing (IN_REVIEW/REVIEWING/LOCKED)
 * - PUT    /api/v1/admin/listings/{listingId}/reject                → reject listing (IN_REVIEW/REVIEWING/LOCKED)
 * - PUT    /api/v1/admin/listings/{listingId}/suspend               → suspend listing
 * - PUT    /api/v1/admin/listings/{listingId}/manual-locations      → set manual locations for listing
 * - PUT    /api/v1/admin/listings/{listingId}/coordinates           → set/update coordinates for listing
 * - PUT    /api/v1/admin/listings/{listingId}/translations          → set translations for listing
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

    // POST /api/v1/admin/listings/by-location (search by one or more location IDs)
    if (method === 'POST' && resource === '/api/v1/admin/listings/by-location') {
      return (await searchByLocation(event, context, callback)) as APIGatewayProxyResult;
    }

    // GET /api/v1/admin/hosts/{hostId}/listings
    if (method === 'GET' && resource === '/api/v1/admin/hosts/{hostId}/listings') {
      return (await listHostListings(event, context, callback)) as APIGatewayProxyResult;
    }

    // GET /api/v1/admin/listings/{listingId}
    if (method === 'GET' && resource === '/api/v1/admin/listings/{listingId}') {
      return (await getListing(event, context, callback)) as APIGatewayProxyResult;
    }

    // GET /api/v1/admin/locations/search
    if (method === 'GET' && resource === '/api/v1/admin/locations/search') {
      return (await searchLocations(event, context, callback)) as APIGatewayProxyResult;
    }

    // POST /api/v1/admin/listings/bulk-approve
    if (method === 'POST' && resource === '/api/v1/admin/listings/bulk-approve') {
      return (await bulkApprove(event, context, callback)) as APIGatewayProxyResult;
    }

    // POST /api/v1/admin/listings/bulk-approve-by-ids
    if (method === 'POST' && resource === '/api/v1/admin/listings/bulk-approve-by-ids') {
      return (await bulkApproveByIds(event, context, callback)) as APIGatewayProxyResult;
    }

    // PUT /api/v1/admin/listings/{listingId}/reviewing
    if (method === 'PUT' && resource === '/api/v1/admin/listings/{listingId}/reviewing') {
      return (await setReviewing(event, context, callback)) as APIGatewayProxyResult;
    }

    // PUT /api/v1/admin/listings/{listingId}/approve
    if (method === 'PUT' && resource === '/api/v1/admin/listings/{listingId}/approve') {
      return (await approveListing(event, context, callback)) as APIGatewayProxyResult;
    }

    // POST /api/v1/admin/listings/{listingId}/pre-approve (mark ready without approving)
    if (method === 'POST' && resource === '/api/v1/admin/listings/{listingId}/pre-approve') {
      // Inject markReadyOnly into the body, with listingVerified defaulting to true
      // (pre-approve implies the listing has been verified as ready)
      const modifiedEvent = {
        ...event,
        body: JSON.stringify({ markReadyOnly: true, listingVerified: true }),
      };
      return (await approveListing(modifiedEvent as APIGatewayProxyEvent, context, callback)) as APIGatewayProxyResult;
    }

    // PUT /api/v1/admin/listings/{listingId}/reject
    if (method === 'PUT' && resource === '/api/v1/admin/listings/{listingId}/reject') {
      return (await rejectListing(event, context, callback)) as APIGatewayProxyResult;
    }

    // PUT /api/v1/admin/listings/{listingId}/suspend
    if (method === 'PUT' && resource === '/api/v1/admin/listings/{listingId}/suspend') {
      return (await suspendListing(event, context, callback)) as APIGatewayProxyResult;
    }

    // PUT /api/v1/admin/listings/{listingId}/manual-locations
    if (method === 'PUT' && resource === '/api/v1/admin/listings/{listingId}/manual-locations') {
      return (await setManualLocations(event, context, callback)) as APIGatewayProxyResult;
    }

    // PUT /api/v1/admin/listings/{listingId}/coordinates
    if (method === 'PUT' && resource === '/api/v1/admin/listings/{listingId}/coordinates') {
      return (await setCoordinates(event, context, callback)) as APIGatewayProxyResult;
    }

    // PUT /api/v1/admin/listings/{listingId}/translations
    if (method === 'PUT' && resource === '/api/v1/admin/listings/{listingId}/translations') {
      return (await setTranslations(event, context, callback)) as APIGatewayProxyResult;
    }

    // GET /api/v1/admin/translation-requests
    if (method === 'GET' && resource === '/api/v1/admin/translation-requests') {
      return (await listTranslationRequests(event, context, callback)) as APIGatewayProxyResult;
    }

    // PATCH /api/v1/admin/translation-requests/{listingId}/complete
    if (method === 'PATCH' && resource === '/api/v1/admin/translation-requests/{listingId}/complete') {
      return (await completeTranslationRequest(event, context, callback)) as APIGatewayProxyResult;
    }

    // GET /api/v1/admin/config/languages
    if (method === 'GET' && resource === '/api/v1/admin/config/languages') {
      return (await getLanguages(event, context, callback)) as APIGatewayProxyResult;
    }

    // PUT /api/v1/admin/config/languages
    if (method === 'PUT' && resource === '/api/v1/admin/config/languages') {
      return (await updateLanguages(event, context, callback)) as APIGatewayProxyResult;
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

