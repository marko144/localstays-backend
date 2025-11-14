/**
 * Push Notification Utilities
 * 
 * Shared utilities for working with Web Push notifications
 */

import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import * as webpush from 'web-push';
import type { 
  VapidConfig, 
  PushSubscription, 
  NotificationPayload,
  SendResult,
  DeviceType,
  Platform
} from '../../types/notification.types';

const ssmClient = new SSMClient({});
const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const TABLE_NAME = process.env.TABLE_NAME!;
const STAGE = process.env.STAGE || 'staging';

// Cache VAPID config to avoid repeated SSM calls
let vapidConfigCache: VapidConfig | null = null;

/**
 * Load VAPID configuration from SSM Parameter Store
 */
export async function getVapidConfig(): Promise<VapidConfig> {
  if (vapidConfigCache) {
    return vapidConfigCache;
  }

  try {
    const [publicKeyParam, privateKeyParam, subjectParam] = await Promise.all([
      ssmClient.send(new GetParameterCommand({
        Name: `/localstays/${STAGE}/vapid/publicKey`,
      })),
      ssmClient.send(new GetParameterCommand({
        Name: `/localstays/${STAGE}/vapid/privateKey`,
        WithDecryption: true,
      })),
      ssmClient.send(new GetParameterCommand({
        Name: `/localstays/${STAGE}/vapid/subject`,
      })),
    ]);

    vapidConfigCache = {
      publicKey: publicKeyParam.Parameter!.Value!,
      privateKey: privateKeyParam.Parameter!.Value!,
      subject: subjectParam.Parameter!.Value!,
    };

    // Configure web-push library
    webpush.setVapidDetails(
      vapidConfigCache.subject,
      vapidConfigCache.publicKey,
      vapidConfigCache.privateKey
    );

    console.log('VAPID configuration loaded successfully');
    return vapidConfigCache;
  } catch (error) {
    console.error('Failed to load VAPID configuration:', error);
    throw new Error('Failed to load VAPID configuration from SSM');
  }
}

/**
 * Get all active push subscriptions for a user
 */
export async function getUserSubscriptions(userId: string): Promise<PushSubscription[]> {
  const result = await docClient.send(new QueryCommand({
    TableName: TABLE_NAME,
    KeyConditionExpression: 'pk = :pk AND begins_with(sk, :sk)',
    FilterExpression: 'isActive = :active AND isDeleted = :notDeleted',
    ExpressionAttributeValues: {
      ':pk': `USER#${userId}`,
      ':sk': 'PUSH_SUB#',
      ':active': true,
      ':notDeleted': false,
    },
  }));

  return (result.Items || []) as PushSubscription[];
}

/**
 * Get all active push subscriptions (for broadcast)
 */
export async function getAllActiveSubscriptions(): Promise<PushSubscription[]> {
  const result = await docClient.send(new QueryCommand({
    TableName: TABLE_NAME,
    IndexName: 'PushSubscriptionIndex',
    KeyConditionExpression: 'gsi5pk = :gsi5pk',
    ExpressionAttributeValues: {
      ':gsi5pk': 'PUSH_SUB_ACTIVE',
    },
  }));

  return (result.Items || []) as PushSubscription[];
}

/**
 * Send a push notification to a single subscription
 */
export async function sendPushNotification(
  subscription: PushSubscription,
  payload: NotificationPayload
): Promise<SendResult> {
  try {
    await webpush.sendNotification(
      {
        endpoint: subscription.endpoint,
        keys: subscription.keys,
      },
      JSON.stringify(payload),
      {
        TTL: 86400, // 24 hours
      }
    );

    return {
      subscriptionId: subscription.subscriptionId,
      success: true,
    };
  } catch (error: any) {
    console.error(`Failed to send notification to ${subscription.subscriptionId}:`, error);
    
    return {
      subscriptionId: subscription.subscriptionId,
      success: false,
      error: error.message,
      statusCode: error.statusCode,
    };
  }
}

/**
 * Update subscription after send attempt
 * - On success: Reset failure count, update lastUsedAt, extend TTL
 * - On failure: Increment failure count, deactivate if >= 10 failures
 */
export async function updateSubscriptionAfterSend(
  subscription: PushSubscription,
  result: SendResult
): Promise<void> {
  const now = new Date().toISOString();
  const oneYearFromNow = Math.floor(Date.now() / 1000) + (365 * 24 * 60 * 60);

  if (result.success) {
    // Success: Reset failure count, update lastUsedAt, extend TTL
    await docClient.send(new UpdateCommand({
      TableName: TABLE_NAME,
      Key: {
        pk: subscription.pk,
        sk: subscription.sk,
      },
      UpdateExpression: `
        SET lastUsedAt = :now,
            failureCount = :zero,
            updatedAt = :now,
            expiresAt = :expiresAt
      `,
      ExpressionAttributeValues: {
        ':now': now,
        ':zero': 0,
        ':expiresAt': oneYearFromNow,
      },
    }));
  } else {
    // Failure: Increment failure count
    const newFailureCount = subscription.failureCount + 1;
    const shouldDeactivate = newFailureCount >= 10;

    // Check if it's a permanent failure (410 Gone, 404 Not Found)
    const isPermanentFailure = result.statusCode === 410 || result.statusCode === 404;

    if (shouldDeactivate || isPermanentFailure) {
      // Deactivate subscription
      await docClient.send(new UpdateCommand({
        TableName: TABLE_NAME,
        Key: {
          pk: subscription.pk,
          sk: subscription.sk,
        },
        UpdateExpression: `
          SET isActive = :inactive,
              failureCount = :failureCount,
              lastFailureAt = :now,
              lastFailureReason = :reason,
              updatedAt = :now,
              gsi5pk = :gsi5pk
        `,
        ExpressionAttributeValues: {
          ':inactive': false,
          ':failureCount': newFailureCount,
          ':now': now,
          ':reason': result.error || 'Unknown error',
          ':gsi5pk': 'PUSH_SUB_INACTIVE',
        },
      }));

      console.log(`Deactivated subscription ${subscription.subscriptionId} after ${newFailureCount} failures`);
    } else {
      // Just increment failure count
      await docClient.send(new UpdateCommand({
        TableName: TABLE_NAME,
        Key: {
          pk: subscription.pk,
          sk: subscription.sk,
        },
        UpdateExpression: `
          SET failureCount = :failureCount,
              lastFailureAt = :now,
              lastFailureReason = :reason,
              updatedAt = :now
        `,
        ExpressionAttributeValues: {
          ':failureCount': newFailureCount,
          ':now': now,
          ':reason': result.error || 'Unknown error',
        },
      }));
    }
  }
}

/**
 * Send notification to a user (all their active devices)
 */
export async function sendNotificationToUser(
  userId: string,
  payload: NotificationPayload
): Promise<{ sent: number; failed: number; deactivated: number }> {
  // Ensure VAPID is configured
  await getVapidConfig();

  // Get user's subscriptions
  const subscriptions = await getUserSubscriptions(userId);

  if (subscriptions.length === 0) {
    console.log(`No active subscriptions for user ${userId}`);
    return { sent: 0, failed: 0, deactivated: 0 };
  }

  // Send to all subscriptions
  const results = await Promise.all(
    subscriptions.map(sub => sendPushNotification(sub, payload))
  );

  // Update subscriptions based on results
  await Promise.all(
    subscriptions.map((sub, index) => 
      updateSubscriptionAfterSend(sub, results[index])
    )
  );

  // Count results
  const sent = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;
  const deactivated = results.filter((r, i) => 
    !r.success && (subscriptions[i].failureCount + 1 >= 10 || r.statusCode === 410 || r.statusCode === 404)
  ).length;

  console.log(`Sent notifications to user ${userId}: ${sent} sent, ${failed} failed, ${deactivated} deactivated`);

  return { sent, failed, deactivated };
}

/**
 * Parse device type from user agent
 */
export function parseDeviceType(userAgent: string): DeviceType {
  const ua = userAgent.toLowerCase();
  
  if (ua.includes('mobile') || ua.includes('android') || ua.includes('iphone')) {
    return 'mobile';
  }
  
  if (ua.includes('tablet') || ua.includes('ipad')) {
    return 'tablet';
  }
  
  return 'desktop';
}

/**
 * Parse platform (browser) from user agent
 */
export function parsePlatform(userAgent: string): Platform {
  const ua = userAgent.toLowerCase();
  
  if (ua.includes('edg/') || ua.includes('edge/')) {
    return 'Edge';
  }
  
  if (ua.includes('chrome/') && !ua.includes('edg')) {
    return 'Chrome';
  }
  
  if (ua.includes('safari/') && !ua.includes('chrome')) {
    return 'Safari';
  }
  
  if (ua.includes('firefox/')) {
    return 'Firefox';
  }
  
  return 'Other';
}

/**
 * Generate subscription ID
 */
export function generateSubscriptionId(): string {
  return `sub_${crypto.randomUUID()}`;
}




