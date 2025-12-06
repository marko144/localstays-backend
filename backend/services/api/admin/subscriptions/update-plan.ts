/**
 * Admin API: Update Subscription Plan
 * 
 * PUT /api/v1/admin/subscription-plans/{planId}
 * 
 * Updates an existing subscription plan.
 * Note: Some fields (like stripeProductId) should match Stripe configuration.
 * 
 * Permission required: ADMIN_SUBSCRIPTION_MANAGE
 */

import { APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { requirePermission, logAdminAction } from '../../lib/auth-middleware';
import { 
  BillingPeriod,
  buildSubscriptionPlanPK, 
  buildSubscriptionPlanSK 
} from '../../../types/subscription-plan.types';

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client, {
  marshallOptions: { removeUndefinedValues: true },
});

const SUBSCRIPTION_PLANS_TABLE_NAME = process.env.SUBSCRIPTION_PLANS_TABLE_NAME!;

interface UpdatePlanRequest {
  stripeProductId?: string;
  displayName?: string;
  displayName_sr?: string;
  description?: string;
  description_sr?: string;
  adSlots?: number;
  prices?: Array<{
    priceId: string;
    stripePriceId: string;
    billingPeriod: BillingPeriod;
    priceAmount: number;
    currency: string;
  }>;
  hasTrialPeriod?: boolean;
  trialDays?: number | null;
  features?: string[];
  features_sr?: string[];
  isActive?: boolean;
  sortOrder?: number;
}

/**
 * Validate request body
 */
function validateRequest(body: any): { valid: boolean; error?: string; data?: UpdatePlanRequest } {
  if (!body || Object.keys(body).length === 0) {
    return { valid: false, error: 'Request body must contain at least one field to update' };
  }

  // Validate specific fields if provided
  if (body.adSlots !== undefined && (typeof body.adSlots !== 'number' || body.adSlots < 0)) {
    return { valid: false, error: 'adSlots must be a non-negative number' };
  }

  if (body.prices !== undefined) {
    if (!Array.isArray(body.prices)) {
      return { valid: false, error: 'prices must be an array' };
    }
    
    const validBillingPeriods: BillingPeriod[] = ['MONTHLY', 'QUARTERLY', 'SEMI_ANNUAL'];
    for (const price of body.prices) {
      if (!price.priceId || !price.stripePriceId || !price.billingPeriod || 
          typeof price.priceAmount !== 'number' || !price.currency) {
        return { valid: false, error: 'Each price must have priceId, stripePriceId, billingPeriod, priceAmount, and currency' };
      }
      
      if (!validBillingPeriods.includes(price.billingPeriod)) {
        return { valid: false, error: `Invalid billingPeriod: ${price.billingPeriod}` };
      }
    }
  }

  if (body.features !== undefined && !Array.isArray(body.features)) {
    return { valid: false, error: 'features must be an array' };
  }

  if (body.features_sr !== undefined && !Array.isArray(body.features_sr)) {
    return { valid: false, error: 'features_sr must be an array' };
  }

  if (body.sortOrder !== undefined && typeof body.sortOrder !== 'number') {
    return { valid: false, error: 'sortOrder must be a number' };
  }

  if (body.isActive !== undefined && typeof body.isActive !== 'boolean') {
    return { valid: false, error: 'isActive must be a boolean' };
  }

  return { valid: true, data: body as UpdatePlanRequest };
}

/**
 * Main handler
 */
export const handler: APIGatewayProxyHandler = async (event) => {
  console.log('Update subscription plan request:', { pathParameters: event.pathParameters });

  try {
    // 1. Require admin permission
    const authResult = requirePermission(event, 'ADMIN_SUBSCRIPTION_MANAGE');
    if ('error' in authResult) {
      return authResult.error;
    }

    const { user } = authResult;

    // 2. Extract planId from path
    const planId = event.pathParameters?.planId;

    if (!planId) {
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
            message: 'planId is required',
          },
        }),
      };
    }

    // 3. Parse and validate request body
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

    // 4. Check if plan exists
    const existingPlan = await docClient.send(
      new GetCommand({
        TableName: SUBSCRIPTION_PLANS_TABLE_NAME,
        Key: {
          pk: buildSubscriptionPlanPK(planId),
          sk: buildSubscriptionPlanSK(),
        },
      })
    );

    if (!existingPlan.Item) {
      return {
        statusCode: 404,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: `Subscription plan not found: ${planId}`,
          },
        }),
      };
    }

    // 5. Build update expression dynamically
    const now = new Date().toISOString();
    const updateParts: string[] = ['#updatedAt = :updatedAt'];
    const expressionNames: Record<string, string> = { '#updatedAt': 'updatedAt' };
    const expressionValues: Record<string, any> = { ':updatedAt': now };

    const fieldMappings: Record<string, string> = {
      stripeProductId: 'stripeProductId',
      displayName: 'displayName',
      displayName_sr: 'displayName_sr',
      description: 'description',
      description_sr: 'description_sr',
      adSlots: 'adSlots',
      prices: 'prices',
      hasTrialPeriod: 'hasTrialPeriod',
      trialDays: 'trialDays',
      features: 'features',
      features_sr: 'features_sr',
      isActive: 'isActive',
      sortOrder: 'sortOrder',
    };

    for (const [key, dbField] of Object.entries(fieldMappings)) {
      if (data[key as keyof UpdatePlanRequest] !== undefined) {
        updateParts.push(`#${key} = :${key}`);
        expressionNames[`#${key}`] = dbField;
        expressionValues[`:${key}`] = data[key as keyof UpdatePlanRequest];
      }
    }

    // 6. Execute update
    await docClient.send(
      new UpdateCommand({
        TableName: SUBSCRIPTION_PLANS_TABLE_NAME,
        Key: {
          pk: buildSubscriptionPlanPK(planId),
          sk: buildSubscriptionPlanSK(),
        },
        UpdateExpression: `SET ${updateParts.join(', ')}`,
        ExpressionAttributeNames: expressionNames,
        ExpressionAttributeValues: expressionValues,
        ReturnValues: 'ALL_NEW',
      })
    );

    console.log(`✅ Updated subscription plan: ${planId}`);

    // 7. Log admin action
    logAdminAction(user, 'UPDATE_SUBSCRIPTION_PLAN', 'SUBSCRIPTION_PLAN', planId, {
      updatedFields: Object.keys(data),
    });

    // 8. Return response
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        success: true,
        message: 'Subscription plan updated successfully',
        planId,
        updatedFields: Object.keys(data),
      }),
    };
  } catch (error) {
    console.error('❌ Update subscription plan error:', error);

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
          message: 'Failed to update subscription plan',
        },
      }),
    };
  }
};

