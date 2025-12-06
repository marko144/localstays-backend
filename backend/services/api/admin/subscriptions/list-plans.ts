/**
 * Admin API: List Subscription Plans
 * 
 * GET /api/v1/admin/subscription-plans
 * 
 * Lists all subscription plans (including inactive ones).
 * Permission required: ADMIN_SUBSCRIPTION_MANAGE
 */

import { APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { requirePermission, logAdminAction } from '../../lib/auth-middleware';
import { SubscriptionPlan } from '../../../types/subscription-plan.types';

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

const SUBSCRIPTION_PLANS_TABLE_NAME = process.env.SUBSCRIPTION_PLANS_TABLE_NAME!;

/**
 * Main handler
 */
export const handler: APIGatewayProxyHandler = async (event) => {
  console.log('List subscription plans request');

  try {
    // 1. Require admin permission
    const authResult = requirePermission(event, 'ADMIN_SUBSCRIPTION_MANAGE');
    if ('error' in authResult) {
      return authResult.error;
    }

    const { user } = authResult;

    // 2. Query parameters for filtering
    const includeInactive = event.queryStringParameters?.includeInactive === 'true';

    // 3. Scan all plans from the SubscriptionPlans table
    // Note: This is a small table so scan is acceptable
    const result = await docClient.send(
      new ScanCommand({
        TableName: SUBSCRIPTION_PLANS_TABLE_NAME,
        FilterExpression: includeInactive ? undefined : 'isActive = :active',
        ExpressionAttributeValues: includeInactive ? undefined : {
          ':active': true,
        },
      })
    );

    const plans = (result.Items || []) as SubscriptionPlan[];

    // 4. Sort by sortOrder
    plans.sort((a, b) => a.sortOrder - b.sortOrder);

    // 5. Log admin action
    logAdminAction(user, 'LIST_SUBSCRIPTION_PLANS', 'SUBSCRIPTION_PLAN', 'all', {
      includeInactive,
      count: plans.length,
    });

    // 6. Return response
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        success: true,
        plans: plans.map(formatPlanForResponse),
        total: plans.length,
      }),
    };
  } catch (error) {
    console.error('❌ List subscription plans error:', error);

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
          message: 'Failed to list subscription plans',
        },
      }),
    };
  }
};

/**
 * Format plan for API response
 */
function formatPlanForResponse(plan: SubscriptionPlan) {
  return {
    planId: plan.planId,
    stripeProductId: plan.stripeProductId,
    displayName: plan.displayName,
    displayName_sr: plan.displayName_sr,
    description: plan.description,
    description_sr: plan.description_sr,
    adSlots: plan.adSlots,
    prices: plan.prices.map(price => ({
      priceId: price.priceId,
      stripePriceId: price.stripePriceId,
      billingPeriod: price.billingPeriod,
      priceAmount: price.priceAmount,
      currency: price.currency,
    })),
    hasTrialPeriod: plan.hasTrialPeriod,
    trialDays: plan.trialDays,
    features: plan.features,
    features_sr: plan.features_sr,
    isActive: plan.isActive,
    sortOrder: plan.sortOrder,
    createdAt: plan.createdAt,
    updatedAt: plan.updatedAt,
  };
}

