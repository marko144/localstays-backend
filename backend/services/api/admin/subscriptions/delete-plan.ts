/**
 * Admin API: Delete (Deactivate) Subscription Plan
 * 
 * DELETE /api/v1/admin/subscription-plans/{planId}
 * 
 * Soft deletes a subscription plan by setting isActive to false.
 * Does not actually delete the record to preserve history and
 * existing subscriptions that reference this plan.
 * 
 * Permission required: ADMIN_SUBSCRIPTION_MANAGE
 */

import { APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { requirePermission, logAdminAction } from '../../lib/auth-middleware';
import { 
  buildSubscriptionPlanPK, 
  buildSubscriptionPlanSK 
} from '../../../types/subscription-plan.types';

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

const SUBSCRIPTION_PLANS_TABLE_NAME = process.env.SUBSCRIPTION_PLANS_TABLE_NAME!;

/**
 * Main handler
 */
export const handler: APIGatewayProxyHandler = async (event) => {
  console.log('Delete subscription plan request:', { pathParameters: event.pathParameters });

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

    // 3. Check if plan exists
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

    // Check if already inactive
    if (!existingPlan.Item.isActive) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({
          success: false,
          error: {
            code: 'ALREADY_INACTIVE',
            message: `Subscription plan is already inactive: ${planId}`,
          },
        }),
      };
    }

    // 4. Soft delete by setting isActive to false
    const now = new Date().toISOString();
    
    await docClient.send(
      new UpdateCommand({
        TableName: SUBSCRIPTION_PLANS_TABLE_NAME,
        Key: {
          pk: buildSubscriptionPlanPK(planId),
          sk: buildSubscriptionPlanSK(),
        },
        UpdateExpression: 'SET isActive = :inactive, deactivatedAt = :now, deactivatedBy = :adminId, updatedAt = :now',
        ExpressionAttributeValues: {
          ':inactive': false,
          ':now': now,
          ':adminId': user.sub,
        },
      })
    );

    console.log(`✅ Deactivated subscription plan: ${planId}`);

    // 5. Log admin action
    logAdminAction(user, 'DELETE_SUBSCRIPTION_PLAN', 'SUBSCRIPTION_PLAN', planId, {
      displayName: existingPlan.Item.displayName,
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
        message: 'Subscription plan deactivated successfully',
        planId,
        deactivatedAt: now,
      }),
    };
  } catch (error) {
    console.error('❌ Delete subscription plan error:', error);

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
          message: 'Failed to delete subscription plan',
        },
      }),
    };
  }
};

