/**
 * POST /api/v1/notifications/subscribe
 * 
 * Subscribe to push notifications
 * User provides their browser's PushSubscription object
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import type { SubscribeRequest, SubscribeResponse, PushSubscription } from '../../types/notification.types';
import { generateSubscriptionId, parseDeviceType, parsePlatform } from '../lib/notification-utils';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const TABLE_NAME = process.env.TABLE_NAME!;

/**
 * Lambda handler
 */
export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  console.log('Subscribe to notifications:', JSON.stringify(event, null, 2));

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

    // Parse request body
    const body: SubscribeRequest = JSON.parse(event.body || '{}');

    // Validate subscription object
    if (!body.subscription?.endpoint || !body.subscription?.keys?.p256dh || !body.subscription?.keys?.auth) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          success: false, 
          message: 'Invalid subscription object. Required: endpoint, keys.p256dh, keys.auth' 
        }),
      };
    }

    // Check if this endpoint already exists for this user
    const existingSubscriptions = await docClient.send(new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :sk)',
      FilterExpression: 'endpoint = :endpoint',
      ExpressionAttributeValues: {
        ':pk': `USER#${userId}`,
        ':sk': 'PUSH_SUB#',
        ':endpoint': body.subscription.endpoint,
      },
    }));

    // If subscription already exists, reactivate it
    if (existingSubscriptions.Items && existingSubscriptions.Items.length > 0) {
      const existing = existingSubscriptions.Items[0] as PushSubscription;
      
      console.log(`Subscription already exists for endpoint: ${existing.subscriptionId}`);
      
      // If it's inactive or deleted, we could reactivate it here
      // For now, just return the existing subscription ID
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: true,
          subscriptionId: existing.subscriptionId,
          message: 'Subscription already exists',
        } as SubscribeResponse),
      };
    }

    // Parse device info
    const userAgent = event.headers['User-Agent'] || event.headers['user-agent'] || 'Unknown';
    const deviceType = body.deviceType || parseDeviceType(userAgent);
    const platform = parsePlatform(userAgent);

    // Create new subscription
    const now = new Date().toISOString();
    const oneYearFromNow = Math.floor(Date.now() / 1000) + (365 * 24 * 60 * 60);
    const subscriptionId = generateSubscriptionId();

    const subscription: PushSubscription = {
      pk: `USER#${userId}`,
      sk: `PUSH_SUB#${subscriptionId}`,
      subscriptionId,
      userId,
      endpoint: body.subscription.endpoint,
      keys: {
        p256dh: body.subscription.keys.p256dh,
        auth: body.subscription.keys.auth,
      },
      expirationTime: body.subscription.expirationTime || null,
      deviceType,
      userAgent,
      platform,
      isActive: true,
      lastUsedAt: now,
      failureCount: 0,
      lastFailureAt: null,
      lastFailureReason: null,
      gsi5pk: 'PUSH_SUB_ACTIVE',
      gsi5sk: now,
      isDeleted: false,
      deletedAt: null,
      createdAt: now,
      updatedAt: now,
      expiresAt: oneYearFromNow,
    };

    await docClient.send(new PutCommand({
      TableName: TABLE_NAME,
      Item: subscription,
    }));

    console.log(`Created push subscription: ${subscriptionId} for user ${userId}`);

    return {
      statusCode: 201,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        subscriptionId,
        message: 'Successfully subscribed to push notifications',
      } as SubscribeResponse),
    };

  } catch (error) {
    console.error('Error subscribing to notifications:', error);
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






