/**
 * Admin Subscriptions Handler (Consolidated Router)
 * Routes requests to appropriate subscription management handlers
 */

import { APIGatewayProxyHandler, APIGatewayProxyEvent, APIGatewayProxyResult, Context, Callback } from 'aws-lambda';

// Import individual handlers
import { handler as listPlansHandler } from './list-plans';
import { handler as getPlanHandler } from './get-plan';
import { handler as createPlanHandler } from './create-plan';
import { handler as updatePlanHandler } from './update-plan';
import { handler as deletePlanHandler } from './delete-plan';

/**
 * Consolidated Admin Subscriptions Handler
 * 
 * Routes all admin subscription plan operations to their respective handlers based on
 * HTTP method and resource path.
 * 
 * Supported routes:
 * - GET    /api/v1/admin/subscription-plans              → list all plans
 * - GET    /api/v1/admin/subscription-plans/{planId}     → get plan details
 * - POST   /api/v1/admin/subscription-plans              → create new plan
 * - PUT    /api/v1/admin/subscription-plans/{planId}     → update plan
 * - DELETE /api/v1/admin/subscription-plans/{planId}     → deactivate plan
 */
export const handler: APIGatewayProxyHandler = async (
  event: APIGatewayProxyEvent,
  context: Context,
  callback: Callback<APIGatewayProxyResult>
): Promise<APIGatewayProxyResult> => {
  const method = event.httpMethod;
  const resource = event.resource;

  console.log('Admin subscriptions router:', {
    method,
    resource,
    pathParameters: event.pathParameters,
  });

  try {
    // GET /api/v1/admin/subscription-plans
    if (method === 'GET' && resource === '/api/v1/admin/subscription-plans') {
      return (await listPlansHandler(event, context, callback)) as APIGatewayProxyResult;
    }

    // GET /api/v1/admin/subscription-plans/{planId}
    if (method === 'GET' && resource === '/api/v1/admin/subscription-plans/{planId}') {
      return (await getPlanHandler(event, context, callback)) as APIGatewayProxyResult;
    }

    // POST /api/v1/admin/subscription-plans
    if (method === 'POST' && resource === '/api/v1/admin/subscription-plans') {
      return (await createPlanHandler(event, context, callback)) as APIGatewayProxyResult;
    }

    // PUT /api/v1/admin/subscription-plans/{planId}
    if (method === 'PUT' && resource === '/api/v1/admin/subscription-plans/{planId}') {
      return (await updatePlanHandler(event, context, callback)) as APIGatewayProxyResult;
    }

    // DELETE /api/v1/admin/subscription-plans/{planId}
    if (method === 'DELETE' && resource === '/api/v1/admin/subscription-plans/{planId}') {
      return (await deletePlanHandler(event, context, callback)) as APIGatewayProxyResult;
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
