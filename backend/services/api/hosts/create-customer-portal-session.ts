/**
 * Create Customer Portal Session
 * 
 * Generates a Stripe Customer Portal session URL for the authenticated host.
 * The Customer Portal allows hosts to:
 * - View their current subscription
 * - Upgrade/downgrade their plan
 * - Update payment method
 * - Cancel subscription
 * - View billing history
 * 
 * POST /api/v1/hosts/{hostId}/subscription/customer-portal
 * 
 * Request Body:
 * {
 *   "returnUrl": "https://app.localstays.rs/subscription"  // Optional, defaults to frontendUrl
 * }
 * 
 * Response:
 * {
 *   "success": true,
 *   "data": {
 *     "url": "https://billing.stripe.com/session/...",
 *     "expiresAt": "2024-01-15T12:00:00.000Z"
 *   }
 * }
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import Stripe from 'stripe';
import { getHostSubscription } from '../../lib/subscription-service';
import { getAuthContext, assertCanAccessHost } from '../lib/auth';

const ssmClient = new SSMClient({});
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://app.localstays.rs';
const STAGE = process.env.STAGE || 'dev1';

// Cache the Stripe client after first initialization
let stripeClient: Stripe | null = null;

/**
 * Get Stripe client, initializing with secret from SSM if needed
 */
async function getStripeClient(): Promise<Stripe> {
  if (stripeClient) {
    return stripeClient;
  }

  const parameterName = `/localstays/${STAGE}/stripe/secret-key`;
  
  try {
    const response = await ssmClient.send(
      new GetParameterCommand({
        Name: parameterName,
        WithDecryption: true,
      })
    );

    const secretKey = response.Parameter?.Value;
    if (!secretKey) {
      throw new Error(`Stripe secret key not found at ${parameterName}`);
    }

    stripeClient = new Stripe(secretKey);
    return stripeClient;
  } catch (error) {
    console.error(`Failed to retrieve Stripe secret key from SSM: ${parameterName}`, error);
    throw error;
  }
}

interface CreatePortalSessionRequest {
  returnUrl?: string;
}

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  };

  try {
    // Get hostId from path
    const hostId = event.pathParameters?.hostId;
    if (!hostId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          success: false,
          error: {
            code: 'MISSING_HOST_ID',
            message: 'Host ID is required',
            message_sr: 'ID domaćina je obavezan',
          },
        }),
      };
    }

    // Verify the authenticated user can access this host
    const auth = getAuthContext(event);
    assertCanAccessHost(auth, hostId);

    // Parse request body
    let requestBody: CreatePortalSessionRequest = {};
    if (event.body) {
      try {
        requestBody = JSON.parse(event.body);
      } catch {
        // Ignore parse errors, use defaults
      }
    }

    // Get host subscription to find Stripe customer ID
    const subscription = await getHostSubscription(hostId);
    
    if (!subscription) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({
          success: false,
          error: {
            code: 'NO_SUBSCRIPTION',
            message: 'No subscription found. Please subscribe first.',
            message_sr: 'Pretplata nije pronađena. Molimo vas da se prvo pretplatite.',
          },
        }),
      };
    }

    if (!subscription.stripeCustomerId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          success: false,
          error: {
            code: 'NO_STRIPE_CUSTOMER',
            message: 'No Stripe customer linked. Please contact support.',
            message_sr: 'Stripe nalog nije povezan. Molimo kontaktirajte podršku.',
          },
        }),
      };
    }

    // Determine return URL
    const returnUrl = requestBody.returnUrl || `${FRONTEND_URL}/subscription`;

    // Get Stripe client (loads secret from SSM)
    let stripe: Stripe;
    try {
      stripe = await getStripeClient();
    } catch (error) {
      console.error('Failed to initialize Stripe client:', error);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({
          success: false,
          error: {
            code: 'CONFIGURATION_ERROR',
            message: 'Payment service not configured. Please contact support.',
            message_sr: 'Servis za plaćanje nije konfigurisan. Molimo kontaktirajte podršku.',
          },
        }),
      };
    }

    // Create Stripe Customer Portal session
    console.log('Creating Customer Portal session for:', {
      hostId,
      stripeCustomerId: subscription.stripeCustomerId,
      returnUrl,
    });

    const portalSession = await stripe.billingPortal.sessions.create({
      customer: subscription.stripeCustomerId,
      return_url: returnUrl,
    });

    console.log('Customer Portal session created:', {
      sessionId: portalSession.id,
      url: portalSession.url.substring(0, 50) + '...',
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        data: {
          url: portalSession.url,
          // Portal sessions don't have an explicit expiry, but they're short-lived
          // Typically valid for a few hours
        },
      }),
    };
  } catch (error) {
    console.error('Error creating Customer Portal session:', error);

    // Handle Stripe-specific errors
    if (error instanceof Stripe.errors.StripeError) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          success: false,
          error: {
            code: 'STRIPE_ERROR',
            message: error.message,
            message_sr: 'Greška pri kreiranju portala za plaćanje',
          },
        }),
      };
    }

    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to create portal session',
          message_sr: 'Neuspešno kreiranje sesije portala',
        },
      }),
    };
  }
};

