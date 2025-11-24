/**
 * Check Notification Status
 * 
 * POST /api/v1/notifications/status
 * 
 * Checks if notifications are enabled for a specific device/endpoint.
 * Returns the subscription status and details if found.
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { requireAuth } from '../lib/auth-middleware';
import * as response from '../lib/response';

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

const TABLE_NAME = process.env.TABLE_NAME!;

interface CheckStatusRequest {
  endpoint: string;  // The push subscription endpoint to check
}

interface StatusResponse {
  enabled: boolean;
  subscription?: {
    subscriptionId: string;
    deviceType: 'desktop' | 'mobile' | 'tablet';
    platform: string;
    browser: string;
    createdAt: string;
    lastUsedAt: string;
  };
  message: string;
}

/**
 * Main handler
 */
export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  console.log('Check notification status:', {
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

    // 2. Parse request body
    if (!event.body) {
      return response.badRequest('Request body is required');
    }

    const body = JSON.parse(event.body) as CheckStatusRequest;

    if (!body.endpoint) {
      return response.badRequest('endpoint is required');
    }

    const { endpoint } = body;

    console.log('Checking notification status for user:', {
      userSub: user.sub,
      endpointPreview: endpoint.substring(0, 50) + '...',
    });

    // 3. Query all subscriptions for this user
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
      return response.success<StatusResponse>({
        enabled: false,
        message: 'No subscriptions found for this user',
      });
    }

    // 4. Find subscription with matching endpoint
    const subscription = result.Items.find((item) => item.endpoint === endpoint);

    if (!subscription) {
      return response.success<StatusResponse>({
        enabled: false,
        message: 'No subscription found for this device',
      });
    }

    // 5. Check if subscription is active
    const isActive = subscription.isActive === true;

    if (!isActive) {
      return response.success<StatusResponse>({
        enabled: false,
        subscription: {
          subscriptionId: subscription.subscriptionId,
          deviceType: subscription.deviceType,
          platform: subscription.platform,
          browser: subscription.browser,
          createdAt: subscription.createdAt,
          lastUsedAt: subscription.lastUsedAt,
        },
        message: 'Notifications are disabled for this device',
      });
    }

    // 6. Return active subscription details
    console.log('✅ Found active subscription:', {
      subscriptionId: subscription.subscriptionId,
      deviceType: subscription.deviceType,
    });

    return response.success<StatusResponse>({
      enabled: true,
      subscription: {
        subscriptionId: subscription.subscriptionId,
        deviceType: subscription.deviceType,
        platform: subscription.platform,
        browser: subscription.browser,
        createdAt: subscription.createdAt,
        lastUsedAt: subscription.lastUsedAt,
      },
      message: 'Notifications are enabled for this device',
    });

  } catch (error: any) {
    console.error('Error checking notification status:', error);
    return response.internalError('Failed to check notification status', error);
  }
}



