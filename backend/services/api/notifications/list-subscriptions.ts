/**
 * GET /api/v1/notifications/subscriptions
 * 
 * List all push subscriptions for the authenticated user
 * Returns active and inactive subscriptions
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import type { ListSubscriptionsResponse, PushSubscription } from '../../types/notification.types';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const TABLE_NAME = process.env.TABLE_NAME!;

/**
 * Lambda handler
 */
export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  console.log('List subscriptions:', JSON.stringify(event, null, 2));

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

    // Query all subscriptions for this user (active and inactive)
    const result = await docClient.send(new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :sk)',
      FilterExpression: 'isDeleted = :notDeleted',
      ExpressionAttributeValues: {
        ':pk': `USER#${userId}`,
        ':sk': 'PUSH_SUB#',
        ':notDeleted': false,
      },
    }));

    const subscriptions = (result.Items || []) as PushSubscription[];

    // Map to response format (don't expose sensitive data like keys)
    const response: ListSubscriptionsResponse = {
      success: true,
      subscriptions: subscriptions.map(sub => ({
        subscriptionId: sub.subscriptionId,
        deviceType: sub.deviceType,
        platform: sub.platform,
        isActive: sub.isActive,
        createdAt: sub.createdAt,
        lastUsedAt: sub.lastUsedAt,
      })),
    };

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(response),
    };

  } catch (error) {
    console.error('Error listing subscriptions:', error);
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






