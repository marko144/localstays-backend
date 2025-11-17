/**
 * Unsubscribe from Push Notifications
 * 
 * DELETE /api/v1/notifications/subscribe/{subscriptionId}
 * 
 * Allows authenticated users to unsubscribe from push notifications.
 * Marks the subscription as inactive in DynamoDB.
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { requireAuth } from '../lib/auth-middleware';
import * as response from '../lib/response';

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

const TABLE_NAME = process.env.TABLE_NAME!;

/**
 * Main handler
 */
export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  console.log('Unsubscribe from push notifications:', {
    path: event.path,
    method: event.httpMethod,
    pathParameters: event.pathParameters,
  });

  try {
    // 1. Authenticate user
    const authResult = requireAuth(event);
    if ('error' in authResult) {
      return authResult.error;
    }

    const { user } = authResult;

    // 2. Get subscription ID from path
    const subscriptionId = event.pathParameters?.subscriptionId;
    if (!subscriptionId) {
      return response.badRequest('subscriptionId is required');
    }

    // 3. Fetch subscription to verify ownership
    const subscriptionResult = await docClient.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: {
          pk: `USER#${user.sub}`,
          sk: `PUSH_SUB#${subscriptionId}`,
        },
      })
    );

    if (!subscriptionResult.Item) {
      return response.notFound('Subscription not found');
    }

    const subscription = subscriptionResult.Item;

    // 4. Verify ownership
    if (subscription.userSub !== user.sub) {
      return response.forbidden('You do not have permission to delete this subscription');
    }

    // 5. Mark subscription as inactive (soft delete)
    await docClient.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: {
          pk: `USER#${user.sub}`,
          sk: `PUSH_SUB#${subscriptionId}`,
        },
        UpdateExpression: 'SET isActive = :inactive, updatedAt = :now, gsi5pk = :gsi5pk',
        ExpressionAttributeValues: {
          ':inactive': false,
          ':now': new Date().toISOString(),
          ':gsi5pk': 'PUSH_SUB_INACTIVE', // Move to inactive GSI partition
        },
      })
    );

    console.log('✅ Push subscription deactivated:', {
      subscriptionId,
      userSub: user.sub,
    });

    return response.success({
      message: 'Successfully unsubscribed from push notifications',
    });

  } catch (error: any) {
    console.error('Error unsubscribing from push notifications:', error);
    return response.internalError('Failed to unsubscribe from push notifications', error);
  }
}
