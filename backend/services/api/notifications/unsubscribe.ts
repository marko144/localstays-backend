/**
 * DELETE /api/v1/notifications/subscribe/{subscriptionId}
 * 
 * Unsubscribe from push notifications
 * Soft deletes the subscription (sets isActive = false, isDeleted = true)
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { UnsubscribeResponse, PushSubscription } from '../../types/notification.types';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const TABLE_NAME = process.env.TABLE_NAME!;

/**
 * Lambda handler
 */
export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  console.log('Unsubscribe from notifications:', JSON.stringify(event, null, 2));

  try {
    // Get user from JWT (added by authorizer)
    const userId = event.requestContext.authorizer?.claims?.sub;
    if (!userId) {
      return {
        statusCode: 401,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: false, message: 'Unauthorized' }),
      };
    }

    // Get subscription ID from path
    const subscriptionId = event.pathParameters?.subscriptionId;
    if (!subscriptionId) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          success: false, 
          message: 'Missing subscriptionId in path' 
        }),
      };
    }

    // Get subscription to verify ownership
    const result = await docClient.send(new GetCommand({
      TableName: TABLE_NAME,
      Key: {
        pk: `USER#${userId}`,
        sk: `PUSH_SUB#${subscriptionId}`,
      },
    }));

    const subscription = result.Item as PushSubscription | undefined;

    if (!subscription) {
      return {
        statusCode: 404,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          success: false, 
          message: 'Subscription not found' 
        }),
      };
    }

    // Verify ownership (subscription's userId must match JWT userId)
    if (subscription.userId !== userId) {
      return {
        statusCode: 403,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          success: false, 
          message: 'Forbidden: You do not own this subscription' 
        }),
      };
    }

    // Soft delete: Set isActive = false, isDeleted = true
    const now = new Date().toISOString();

    await docClient.send(new UpdateCommand({
      TableName: TABLE_NAME,
      Key: {
        pk: `USER#${userId}`,
        sk: `PUSH_SUB#${subscriptionId}`,
      },
      UpdateExpression: `
        SET isActive = :inactive,
            isDeleted = :deleted,
            deletedAt = :now,
            updatedAt = :now,
            gsi5pk = :gsi5pk
      `,
      ExpressionAttributeValues: {
        ':inactive': false,
        ':deleted': true,
        ':now': now,
        ':gsi5pk': 'PUSH_SUB_INACTIVE',
      },
    }));

    console.log(`Unsubscribed: ${subscriptionId} for user ${userId}`);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        message: 'Successfully unsubscribed from push notifications',
      } as UnsubscribeResponse),
    };

  } catch (error) {
    console.error('Error unsubscribing from notifications:', error);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        success: false, 
        message: 'Internal server error' 
      }),
    };
  }
}






