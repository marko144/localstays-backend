/**
 * List Push Subscriptions
 * 
 * GET /api/v1/notifications/subscriptions
 * 
 * Returns all active push subscriptions for the authenticated user.
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { requireAuth } from '../lib/auth-middleware';
import * as response from '../lib/response';

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

const TABLE_NAME = process.env.TABLE_NAME!;

interface SubscriptionResponse {
  subscriptionId: string;
  deviceType: 'desktop' | 'mobile' | 'tablet';
  platform: string;
  browser: string;
  isActive: boolean;
  createdAt: string;
  lastUsedAt: string;
}

/**
 * Main handler
 */
export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  console.log('List push subscriptions:', {
    path: event.path,
    method: event.httpMethod,
  });

  try {
    // 1. Authenticate user
    const authResult = requireAuth(event);
    if ('error' in authResult) {
      return authResult.error;
    }

    const { user } = authResult;

    // 2. Query all subscriptions for this user
    const result = await docClient.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :sk)',
        ExpressionAttributeValues: {
          ':pk': `USER#${user.sub}`,
          ':sk': 'PUSH_SUB#',
        },
      })
    );

    if (!result.Items || result.Items.length === 0) {
      return response.success({
        subscriptions: [],
        total: 0,
      });
    }

    // 3. Map to response format (exclude sensitive keys)
    const subscriptions: SubscriptionResponse[] = result.Items.map((item) => ({
      subscriptionId: item.subscriptionId,
      deviceType: item.deviceType,
      platform: item.platform,
      browser: item.browser,
      isActive: item.isActive,
      createdAt: item.createdAt,
      lastUsedAt: item.lastUsedAt,
    }));

    // 4. Sort by lastUsedAt (most recent first)
    subscriptions.sort((a, b) => 
      new Date(b.lastUsedAt).getTime() - new Date(a.lastUsedAt).getTime()
    );

    console.log('✅ Found subscriptions:', {
      userSub: user.sub,
      total: subscriptions.length,
      active: subscriptions.filter(s => s.isActive).length,
    });

    return response.success({
      subscriptions,
      total: subscriptions.length,
      active: subscriptions.filter(s => s.isActive).length,
    });

  } catch (error: any) {
    console.error('Error listing push subscriptions:', error);
    return response.internalError('Failed to list push subscriptions', error);
  }
}
