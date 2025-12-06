/**
 * Admin API: Create Subscription Plan
 * 
 * POST /api/v1/admin/subscription-plans
 * 
 * Creates a new subscription plan.
 * Note: The plan should already be created in Stripe first.
 * This endpoint stores the local reference to sync with Stripe.
 * 
 * Permission required: ADMIN_SUBSCRIPTION_MANAGE
 */

import { APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { requirePermission, logAdminAction } from '../../lib/auth-middleware';
import { 
  SubscriptionPlan, 
  SubscriptionPlanPrice,
  BillingPeriod,
  buildSubscriptionPlanPK, 
  buildSubscriptionPlanSK 
} from '../../../types/subscription-plan.types';

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client, {
  marshallOptions: { removeUndefinedValues: true },
});

const SUBSCRIPTION_PLANS_TABLE_NAME = process.env.SUBSCRIPTION_PLANS_TABLE_NAME!;

interface CreatePlanRequest {
  planId: string;
  stripeProductId: string;
  displayName: string;
  displayName_sr: string;
  description: string;
  description_sr: string;
  adSlots: number;
  prices: Array<{
    priceId: string;
    stripePriceId: string;
    billingPeriod: BillingPeriod;
    priceAmount: number;
    currency: string;
  }>;
  hasTrialPeriod?: boolean;
  trialDays?: number | null;
  features: string[];
  features_sr: string[];
  isActive?: boolean;
  sortOrder: number;
}

/**
 * Validate request body
 */
function validateRequest(body: any): { valid: boolean; error?: string; data?: CreatePlanRequest } {
  if (!body) {
    return { valid: false, error: 'Request body is required' };
  }

  if (!body.planId || typeof body.planId !== 'string') {
    return { valid: false, error: 'planId is required and must be a string' };
  }

  if (!body.stripeProductId || typeof body.stripeProductId !== 'string') {
    return { valid: false, error: 'stripeProductId is required and must be a string' };
  }

  if (!body.displayName || typeof body.displayName !== 'string') {
    return { valid: false, error: 'displayName is required and must be a string' };
  }

  if (!body.displayName_sr || typeof body.displayName_sr !== 'string') {
    return { valid: false, error: 'displayName_sr is required and must be a string' };
  }

  if (typeof body.adSlots !== 'number' || body.adSlots < 0) {
    return { valid: false, error: 'adSlots is required and must be a non-negative number' };
  }

  if (!Array.isArray(body.prices) || body.prices.length === 0) {
    return { valid: false, error: 'prices is required and must be a non-empty array' };
  }

  // Validate each price
  for (const price of body.prices) {
    if (!price.priceId || !price.stripePriceId || !price.billingPeriod || 
        typeof price.priceAmount !== 'number' || !price.currency) {
      return { valid: false, error: 'Each price must have priceId, stripePriceId, billingPeriod, priceAmount, and currency' };
    }
    
    const validBillingPeriods: BillingPeriod[] = ['MONTHLY', 'QUARTERLY', 'SEMI_ANNUAL'];
    if (!validBillingPeriods.includes(price.billingPeriod)) {
      return { valid: false, error: `Invalid billingPeriod: ${price.billingPeriod}. Must be one of: ${validBillingPeriods.join(', ')}` };
    }
  }

  if (!Array.isArray(body.features)) {
    return { valid: false, error: 'features is required and must be an array' };
  }

  if (!Array.isArray(body.features_sr)) {
    return { valid: false, error: 'features_sr is required and must be an array' };
  }

  if (typeof body.sortOrder !== 'number') {
    return { valid: false, error: 'sortOrder is required and must be a number' };
  }

  return { valid: true, data: body as CreatePlanRequest };
}

/**
 * Main handler
 */
export const handler: APIGatewayProxyHandler = async (event) => {
  console.log('Create subscription plan request');

  try {
    // 1. Require admin permission
    const authResult = requirePermission(event, 'ADMIN_SUBSCRIPTION_MANAGE');
    if ('error' in authResult) {
      return authResult.error;
    }

    const { user } = authResult;

    // 2. Parse and validate request body
    let body: any;
    try {
      body = JSON.parse(event.body || '{}');
    } catch {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid JSON in request body',
          },
        }),
      };
    }

    const validation = validateRequest(body);
    if (!validation.valid) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: validation.error,
          },
        }),
      };
    }

    const data = validation.data!;

    // 3. Check if plan already exists
    const existingPlan = await docClient.send(
      new GetCommand({
        TableName: SUBSCRIPTION_PLANS_TABLE_NAME,
        Key: {
          pk: buildSubscriptionPlanPK(data.planId),
          sk: buildSubscriptionPlanSK(),
        },
      })
    );

    if (existingPlan.Item) {
      return {
        statusCode: 409,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({
          success: false,
          error: {
            code: 'CONFLICT',
            message: `Subscription plan already exists: ${data.planId}`,
          },
        }),
      };
    }

    // 4. Create the plan
    const now = new Date().toISOString();
    const plan: SubscriptionPlan = {
      pk: buildSubscriptionPlanPK(data.planId),
      sk: buildSubscriptionPlanSK(),
      planId: data.planId,
      stripeProductId: data.stripeProductId,
      displayName: data.displayName,
      displayName_sr: data.displayName_sr,
      description: data.description || '',
      description_sr: data.description_sr || '',
      adSlots: data.adSlots,
      prices: data.prices as SubscriptionPlanPrice[],
      hasTrialPeriod: data.hasTrialPeriod || false,
      trialDays: data.trialDays || null,
      features: data.features,
      features_sr: data.features_sr,
      isActive: data.isActive !== false, // Default to true
      sortOrder: data.sortOrder,
      createdAt: now,
      updatedAt: now,
    };

    await docClient.send(
      new PutCommand({
        TableName: SUBSCRIPTION_PLANS_TABLE_NAME,
        Item: plan,
      })
    );

    console.log(`✅ Created subscription plan: ${data.planId}`);

    // 5. Log admin action
    logAdminAction(user, 'CREATE_SUBSCRIPTION_PLAN', 'SUBSCRIPTION_PLAN', data.planId, {
      displayName: data.displayName,
      adSlots: data.adSlots,
    });

    // 6. Return response
    return {
      statusCode: 201,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        success: true,
        message: 'Subscription plan created successfully',
        plan: {
          planId: plan.planId,
          stripeProductId: plan.stripeProductId,
          displayName: plan.displayName,
          displayName_sr: plan.displayName_sr,
          adSlots: plan.adSlots,
          isActive: plan.isActive,
          createdAt: plan.createdAt,
        },
      }),
    };
  } catch (error) {
    console.error('❌ Create subscription plan error:', error);

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
          message: 'Failed to create subscription plan',
        },
      }),
    };
  }
};

