/**
 * Stripe Handler
 *
 * Handles Stripe-related operations for hosts:
 * - GET /stripe/prices - Fetch available subscription prices from Stripe
 * - POST /stripe/checkout-session - Create a checkout session for new subscribers
 *
 * These endpoints are authenticated and require a valid host session.
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import Stripe from 'stripe';

import { getAuthContext, assertCanAccessHost } from '../lib/auth';
import * as response from '../lib/response';
import { StripeProductRecord, StripePriceRecord, BillingPeriod } from '../../types/subscription-plan.types';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const ssmClient = new SSMClient({});

const TABLE_NAME = process.env.TABLE_NAME!;
const SUBSCRIPTION_PLANS_TABLE = process.env.SUBSCRIPTION_PLANS_TABLE_NAME!;
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';
const STAGE = process.env.STAGE || 'dev1';

// Cache the Stripe client after first initialization
let stripeClient: Stripe | null = null;

// Standard response headers
const headers = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
};

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

/**
 * Main handler - routes requests to appropriate function
 */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const method = event.httpMethod;
  const path = event.path;

  console.log('Stripe handler request:', { method, path, hostId: event.pathParameters?.hostId });

  try {
    // Route: GET /api/v1/hosts/{hostId}/stripe/prices
    if (method === 'GET' && path.endsWith('/stripe/prices')) {
      return await handleGetPrices(event);
    }

    // Route: POST /api/v1/hosts/{hostId}/stripe/checkout-session
    if (method === 'POST' && path.endsWith('/stripe/checkout-session')) {
      return await handleCreateCheckoutSession(event);
    }

    return {
      statusCode: 404,
      headers,
      body: JSON.stringify({
        success: false,
        error: 'Not found',
      }),
    };
  } catch (error) {
    console.error('Stripe handler error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        error: 'Internal server error',
      }),
    };
  }
};

// ============================================================================
// GET /stripe/prices - Fetch available subscription prices from local DB
// ============================================================================

interface PriceInfo {
  id: string;
  amount: number;
  currency: string;
  interval: string;
  interval_count: number;
  billingPeriod: BillingPeriod;
}

interface ProductWithPrices {
  product: {
    id: string;
    name: string;
    name_sr: string | null;
    description: string | null;
    description_sr: string | null;
    adSlots: number;
    features: string[];
    features_sr: string[];
    sortOrder: number;
  };
  prices: {
    monthly?: PriceInfo;
    quarterly?: PriceInfo;
    semiAnnual?: PriceInfo;
    yearly?: PriceInfo;
  };
}

/**
 * GET /api/v1/hosts/{hostId}/stripe/prices
 *
 * Fetches all active subscription prices from local DynamoDB table.
 * Returns product info with monthly/quarterly/semi-annual/yearly price options.
 * 
 * Data is synced from Stripe via EventBridge events.
 */
async function handleGetPrices(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const hostId = event.pathParameters?.hostId;

  if (!hostId) {
    return response.badRequest('hostId is required in path');
  }

  try {
    // Verify authentication using proper auth context
    const auth = getAuthContext(event);
    assertCanAccessHost(auth, hostId);

    // Fetch all products from local table
    const productsResult = await docClient.send(
      new ScanCommand({
        TableName: SUBSCRIPTION_PLANS_TABLE,
        FilterExpression: 'sk = :sk AND isActive = :active',
        ExpressionAttributeValues: {
          ':sk': 'PRODUCT',
          ':active': true,
        },
      })
    );

    // Fetch all prices from local table
    const pricesResult = await docClient.send(
      new ScanCommand({
        TableName: SUBSCRIPTION_PLANS_TABLE,
        FilterExpression: 'sk = :sk AND isActive = :active',
        ExpressionAttributeValues: {
          ':sk': 'PRICE',
          ':active': true,
        },
      })
    );

    const products = (productsResult.Items || []) as StripeProductRecord[];
    const prices = (pricesResult.Items || []) as StripePriceRecord[];

    // Group prices by product
    const grouped = groupLocalPricesByProduct(products, prices);

    console.log('Fetched prices from local DB:', {
      totalProducts: products.length,
      totalPrices: prices.length,
      groupedProducts: grouped.length,
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        data: grouped,
      }),
    };
  } catch (error) {
    console.error('Error fetching prices:', error);

    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        error: 'Failed to fetch subscription prices',
      }),
    };
  }
}

/**
 * Group local prices by product
 */
function groupLocalPricesByProduct(
  products: StripeProductRecord[],
  prices: StripePriceRecord[]
): ProductWithPrices[] {
  const result: ProductWithPrices[] = [];

  for (const product of products) {
    // Find all prices for this product
    const productPrices = prices.filter(p => p.stripeProductId === product.stripeProductId);

    const pricesMap: ProductWithPrices['prices'] = {};

    for (const price of productPrices) {
      const priceInfo: PriceInfo = {
        id: price.stripePriceId,
        amount: price.amount,
        currency: price.currency,
        interval: price.interval,
        interval_count: price.intervalCount,
        billingPeriod: price.billingPeriod,
      };

      switch (price.billingPeriod) {
        case 'MONTHLY':
          pricesMap.monthly = priceInfo;
          break;
        case 'QUARTERLY':
          pricesMap.quarterly = priceInfo;
          break;
        case 'SEMI_ANNUAL':
          pricesMap.semiAnnual = priceInfo;
          break;
        case 'YEARLY':
          pricesMap.yearly = priceInfo;
          break;
      }
    }

    result.push({
      product: {
        id: product.stripeProductId,
        name: product.name,
        name_sr: product.displayName_sr,
        description: product.description,
        description_sr: product.description_sr,
        adSlots: product.adSlots,
        features: product.features,
        features_sr: product.features_sr,
        sortOrder: product.sortOrder,
      },
      prices: pricesMap,
    });
  }

  // Sort by sortOrder, then by name
  return result.sort((a, b) => {
    if (a.product.sortOrder !== b.product.sortOrder) {
      return a.product.sortOrder - b.product.sortOrder;
    }
    return a.product.name.localeCompare(b.product.name);
  });
}

// ============================================================================
// POST /stripe/checkout-session - Create checkout session for new subscriber
// ============================================================================

interface CreateCheckoutSessionRequest {
  priceId: string;
  locale?: string; // User's current locale (e.g., 'en', 'sr') - defaults to 'en'
}

// Supported locales for URL paths
const SUPPORTED_LOCALES = ['en', 'sr'];
const DEFAULT_LOCALE = 'en';

/**
 * POST /api/v1/hosts/{hostId}/stripe/checkout-session
 *
 * Creates a Stripe Checkout session for a new subscription.
 * The hostId is embedded as client_reference_id for webhook linking.
 *
 * Request body:
 * {
 *   "priceId": "price_xxx",
 *   "locale": "en"  // Optional, defaults to 'en'
 * }
 *
 * Response:
 * {
 *   "success": true,
 *   "url": "https://checkout.stripe.com/..."
 * }
 */
async function handleCreateCheckoutSession(
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> {
  const hostId = event.pathParameters?.hostId;

  if (!hostId) {
    return response.badRequest('hostId is required in path');
  }

  try {
    // Verify authentication using proper auth context
    const auth = getAuthContext(event);
    assertCanAccessHost(auth, hostId);
  } catch (error: any) {
    console.error('Auth error:', error);
    return response.handleError(error);
  }

  // Parse request body
  let body: CreateCheckoutSessionRequest;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({
        success: false,
        error: 'Invalid request body',
      }),
    };
  }

  // Validate priceId
  if (!body.priceId) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({
        success: false,
        error: 'Price ID required',
      }),
    };
  }

  try {
    // Fetch host profile to get email
    const hostResult = await docClient.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: {
          pk: `HOST#${hostId}`,
          sk: 'META',
        },
      })
    );

    if (!hostResult.Item) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({
          success: false,
          error: 'Host not found',
        }),
      };
    }

    const hostEmail = hostResult.Item.email;
    if (!hostEmail) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          success: false,
          error: 'Host email not found',
        }),
      };
    }

    // Get Stripe client
    const stripe = await getStripeClient();

    // Validate the price exists and is active
    try {
      const price = await stripe.prices.retrieve(body.priceId);
      if (!price.active) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({
            success: false,
            error: 'Invalid or inactive price',
          }),
        };
      }
    } catch (priceError) {
      console.error('Error validating price:', priceError);
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          success: false,
          error: 'Invalid price ID',
        }),
      };
    }

    // Determine locale for redirect URLs (default to 'en' if not provided or invalid)
    const locale = body.locale && SUPPORTED_LOCALES.includes(body.locale) 
      ? body.locale 
      : DEFAULT_LOCALE;

    // Build success and cancel URLs with locale
    // Success URL includes session_id so the subscription page can detect successful payment
    const successUrl = `${FRONTEND_URL}/${locale}/subscription?session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${FRONTEND_URL}/${locale}/subscription`;

    // Create Stripe Checkout session
    console.log('Creating checkout session:', {
      hostId,
      email: hostEmail,
      priceId: body.priceId,
      locale,
      successUrl,
      cancelUrl,
    });

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [
        {
          price: body.priceId,
          quantity: 1,
        },
      ],
      customer_email: hostEmail,
      client_reference_id: hostId, // CRITICAL: Used by webhook to link customer to host
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: {
        hostId: hostId,
        locale: locale, // Store locale in metadata for potential use in webhooks
      },
      // Allow promotion codes if you have them set up in Stripe
      allow_promotion_codes: true,
    });

    console.log('Checkout session created:', {
      sessionId: session.id,
      url: session.url?.substring(0, 50) + '...',
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        url: session.url,
      }),
    };
  } catch (error) {
    console.error('Error creating checkout session:', error);

    if (error instanceof Stripe.errors.StripeError) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          success: false,
          error: error.message || 'Failed to create checkout session',
        }),
      };
    }

    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        error: 'Failed to create checkout session',
      }),
    };
  }
}


