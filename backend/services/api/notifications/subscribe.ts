/**
 * Subscribe to Push Notifications
 * 
 * POST /api/v1/notifications/subscribe
 * 
 * Allows authenticated users to subscribe to push notifications.
 * Stores the push subscription in DynamoDB for later use.
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { requireAuth } from '../lib/auth-middleware';
import * as response from '../lib/response';
import { v4 as uuidv4 } from 'uuid';

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

const TABLE_NAME = process.env.TABLE_NAME!;

interface SubscribeRequest {
  subscription: PushSubscriptionJSON;
  deviceInfo?: {
    type?: 'desktop' | 'mobile' | 'tablet';
    platform?: string;
    browser?: string;
  };
}

interface PushSubscriptionJSON {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
}

/**
 * Main handler
 */
export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  console.log('Subscribe to push notifications:', {
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

    const body = JSON.parse(event.body) as SubscribeRequest;

    if (!body.subscription) {
      return response.badRequest('subscription is required');
    }

    const { subscription, deviceInfo } = body;

    // 3. Validate subscription object
    if (!subscription.endpoint || !subscription.keys?.p256dh || !subscription.keys?.auth) {
      return response.badRequest('Invalid subscription format');
    }

    // 4. Check if this subscription already exists for this user
    const existingSubscription = await findExistingSubscription(user.sub, subscription.endpoint);
    
    if (existingSubscription) {
      console.log('Subscription already exists:', existingSubscription.subscriptionId);
      
      // Update lastUsedAt timestamp
      await docClient.send(
        new PutCommand({
          TableName: TABLE_NAME,
          Item: {
            ...existingSubscription,
            lastUsedAt: new Date().toISOString(),
            isActive: true,
          },
        })
      );

      return response.success({
        subscriptionId: existingSubscription.subscriptionId,
        message: 'Subscription already exists and has been updated',
      });
    }

    // 5. Create new subscription record
    const subscriptionId = `sub_${uuidv4()}`;
    const now = new Date().toISOString();

    const subscriptionRecord = {
      pk: `USER#${user.sub}`,
      sk: `PUSH_SUB#${subscriptionId}`,
      entityType: 'PUSH_SUBSCRIPTION',
      subscriptionId,
      userId: user.sub,
      endpoint: subscription.endpoint,
      keys: {
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
      },
      deviceType: deviceInfo?.type || detectDeviceType(event.headers),
      platform: deviceInfo?.platform || event.headers['User-Agent'] || 'unknown',
      browser: deviceInfo?.browser || detectBrowser(event.headers),
      isActive: true,
      isDeleted: false,
      failureCount: 0,
      createdAt: now,
      lastUsedAt: now,
      // GSI5 attributes for querying active subscriptions
      gsi5pk: 'PUSH_SUB_ACTIVE',
      gsi5sk: now,
    };

    await docClient.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: subscriptionRecord,
      })
    );

    console.log('✅ Push subscription created:', {
      subscriptionId,
      userSub: user.sub,
      deviceType: subscriptionRecord.deviceType,
    });

    return response.success({
      subscriptionId,
      message: 'Successfully subscribed to push notifications',
    });

  } catch (error: any) {
    console.error('Error subscribing to push notifications:', error);
    return response.internalError('Failed to subscribe to push notifications', error);
  }
}

/**
 * Find existing subscription by endpoint
 */
async function findExistingSubscription(
  userSub: string,
  endpoint: string
): Promise<any | null> {
  try {
    const result = await docClient.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :sk)',
        ExpressionAttributeValues: {
          ':pk': `USER#${userSub}`,
          ':sk': 'PUSH_SUB#',
        },
      })
    );

    if (!result.Items || result.Items.length === 0) {
      return null;
    }

    // Find subscription with matching endpoint
    const existing = result.Items.find((item) => item.endpoint === endpoint);
    return existing || null;
  } catch (error) {
    console.error('Error finding existing subscription:', error);
    return null;
  }
}

/**
 * Detect device type from User-Agent
 */
function detectDeviceType(headers: { [key: string]: string | undefined }): 'desktop' | 'mobile' | 'tablet' {
  const userAgent = (headers['User-Agent'] || headers['user-agent'] || '').toLowerCase();
  
  if (/mobile|android|iphone|ipod|blackberry|windows phone/i.test(userAgent)) {
    return 'mobile';
  }
  
  if (/tablet|ipad/i.test(userAgent)) {
    return 'tablet';
  }
  
  return 'desktop';
}

/**
 * Detect browser from User-Agent
 */
function detectBrowser(headers: { [key: string]: string | undefined }): string {
  const userAgent = headers['User-Agent'] || headers['user-agent'] || '';
  
  if (/chrome/i.test(userAgent) && !/edge|edg/i.test(userAgent)) {
    return 'Chrome';
  }
  if (/safari/i.test(userAgent) && !/chrome/i.test(userAgent)) {
    return 'Safari';
  }
  if (/firefox/i.test(userAgent)) {
    return 'Firefox';
  }
  if (/edge|edg/i.test(userAgent)) {
    return 'Edge';
  }
  
  return 'Unknown';
}
