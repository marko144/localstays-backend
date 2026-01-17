import { APIGatewayProxyHandler, APIGatewayProxyEvent, APIGatewayProxyResult, Context, Callback } from 'aws-lambda';

// v2: Added REQUESTED status to online payment endpoint
// Import all individual operation handlers
import { handler as listHosts } from './list-hosts';
import { handler as searchHosts } from './search-hosts';
import { handler as getHost } from './get-host';
import { handler as listDocuments } from './list-documents';
import { handler as pendingReviewHosts } from './pending-review';
import { handler as approveHost } from './approve-host';
import { handler as rejectHost } from './reject-host';
import { handler as suspendHost } from './suspend-host';
import { handler as reinstateHost } from './reinstate-host';
import { handler as updateOnlinePayment } from './update-online-payment';

/**
 * Consolidated Admin Hosts Handler (v1.0)
 * 
 * Routes all admin host operations to their respective handlers based on
 * HTTP method and resource path.
 * 
 * Supported routes:
 * - GET    /api/v1/admin/hosts                      → list all hosts
 * - GET    /api/v1/admin/hosts/search              → search hosts
 * - GET    /api/v1/admin/hosts/pending-review      → list pending review hosts
 * - GET    /api/v1/admin/hosts/{hostId}            → get host details
 * - GET    /api/v1/admin/hosts/{hostId}/documents  → list host documents
 * - PUT    /api/v1/admin/hosts/{hostId}/approve    → approve host
 * - PUT    /api/v1/admin/hosts/{hostId}/reject     → reject host
 * - PUT    /api/v1/admin/hosts/{hostId}/suspend         → suspend host
 * - PUT    /api/v1/admin/hosts/{hostId}/reinstate       → reinstate host
 * - PUT    /api/v1/admin/hosts/{hostId}/online-payment  → update online payment status
 */
export const handler: APIGatewayProxyHandler = async (
  event: APIGatewayProxyEvent,
  context: Context,
  callback: Callback<APIGatewayProxyResult>
): Promise<APIGatewayProxyResult> => {
  const method = event.httpMethod;
  const resource = event.resource;

  console.log('Admin hosts router:', { method, resource, pathParameters: event.pathParameters });

  try {
    // Route based on method + resource pattern

    // GET /api/v1/admin/hosts
    if (method === 'GET' && resource === '/api/v1/admin/hosts') {
      return (await listHosts(event, context, callback)) as APIGatewayProxyResult;
    }

    // GET /api/v1/admin/hosts/search
    if (method === 'GET' && resource === '/api/v1/admin/hosts/search') {
      return (await searchHosts(event, context, callback)) as APIGatewayProxyResult;
    }

    // GET /api/v1/admin/hosts/pending-review
    if (method === 'GET' && resource === '/api/v1/admin/hosts/pending-review') {
      return (await pendingReviewHosts(event, context, callback)) as APIGatewayProxyResult;
    }

    // GET /api/v1/admin/hosts/{hostId}
    if (method === 'GET' && resource === '/api/v1/admin/hosts/{hostId}') {
      return (await getHost(event, context, callback)) as APIGatewayProxyResult;
    }

    // GET /api/v1/admin/hosts/{hostId}/documents
    if (method === 'GET' && resource === '/api/v1/admin/hosts/{hostId}/documents') {
      return (await listDocuments(event, context, callback)) as APIGatewayProxyResult;
    }

    // PUT /api/v1/admin/hosts/{hostId}/approve
    if (method === 'PUT' && resource === '/api/v1/admin/hosts/{hostId}/approve') {
      return (await approveHost(event, context, callback)) as APIGatewayProxyResult;
    }

    // PUT /api/v1/admin/hosts/{hostId}/reject
    if (method === 'PUT' && resource === '/api/v1/admin/hosts/{hostId}/reject') {
      return (await rejectHost(event, context, callback)) as APIGatewayProxyResult;
    }

    // PUT /api/v1/admin/hosts/{hostId}/suspend
    if (method === 'PUT' && resource === '/api/v1/admin/hosts/{hostId}/suspend') {
      return (await suspendHost(event, context, callback)) as APIGatewayProxyResult;
    }

    // PUT /api/v1/admin/hosts/{hostId}/reinstate
    if (method === 'PUT' && resource === '/api/v1/admin/hosts/{hostId}/reinstate') {
      return (await reinstateHost(event, context, callback)) as APIGatewayProxyResult;
    }

    // PUT /api/v1/admin/hosts/{hostId}/online-payment
    if (method === 'PUT' && resource === '/api/v1/admin/hosts/{hostId}/online-payment') {
      return (await updateOnlinePayment(event, context, callback)) as APIGatewayProxyResult;
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

