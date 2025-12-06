/**
 * Admin API: Get Subscription Plan
 * 
 * GET /api/v1/admin/subscription-plans/{planId}
 * 
 * Gets a single subscription plan by ID.
 * Permission required: ADMIN_SUBSCRIPTION_MANAGE
 */

import { APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { requirePermission, logAdminAction } from '../../lib/auth-middleware';
import { SubscriptionPlan, buildSubscriptionPlanPK, buildSubscriptionPlanSK } from '../../../types/subscription-plan.types';

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

const SUBSCRIPTION_PLANS_TABLE_NAME = process.env.SUBSCRIPTION_PLANS_TABLE_NAME!;

/**
 * Main handler
 */
export const handler: APIGatewayProxyHandler = async (event) => {
  console.log('Get subscription plan request:', { pathParameters: event.pathParameters });

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

    // 3. Fetch plan from database
    const result = await docClient.send(
      new GetCommand({
        TableName: SUBSCRIPTION_PLANS_TABLE_NAME,
        Key: {
          pk: buildSubscriptionPlanPK(planId),
          sk: buildSubscriptionPlanSK(),
        },
      })
    );

    if (!result.Item) {
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

    const plan = result.Item as SubscriptionPlan;

    // 4. Log admin action
    logAdminAction(user, 'VIEW_SUBSCRIPTION_PLAN', 'SUBSCRIPTION_PLAN', planId, {});

    // 5. Return response
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        success: true,
        plan: {
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
        },
      }),
    };
  } catch (error) {
    console.error('❌ Get subscription plan error:', error);

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
          message: 'Failed to get subscription plan',
        },
      }),
    };
  }
};

