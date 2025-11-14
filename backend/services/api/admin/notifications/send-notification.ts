/**
 * POST /api/v1/admin/notifications/send
 * 
 * Send push notifications (admin only)
 * Supports:
 * - Send to specific user(s)
 * - Send to all users (broadcast)
 * - Send to users with specific role (future)
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import type { SendNotificationRequest, SendNotificationResponse, PushSubscription } from '../../../types/notification.types';
import { 
  getVapidConfig, 
  getUserSubscriptions, 
  getAllActiveSubscriptions,
  sendPushNotification,
  updateSubscriptionAfterSend
} from '../../lib/notification-utils';

/**
 * Lambda handler
 */
export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  console.log('Send notification (admin):', JSON.stringify(event, null, 2));

  try {
    // Verify admin permissions (should be handled by authorizer, but double-check)
    const userId = event.requestContext.authorizer?.claims?.sub;
    if (!userId) {
      return {
        statusCode: 401,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: false, message: 'Unauthorized' }),
      };
    }

    // Parse request body
    const body: SendNotificationRequest = JSON.parse(event.body || '{}');

    // Validate notification payload
    if (!body.notification?.title || !body.notification?.body) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          success: false, 
          message: 'Invalid notification payload. Required: title, body' 
        }),
      };
    }

    // Validate target type
    if (!body.targetType || !['user', 'all', 'role'].includes(body.targetType)) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          success: false, 
          message: 'Invalid targetType. Must be: user, all, or role' 
        }),
      };
    }

    // Load VAPID configuration
    await getVapidConfig();

    // Get target subscriptions based on targetType
    let subscriptions: PushSubscription[] = [];

    if (body.targetType === 'user') {
      // Send to specific user(s)
      if (!body.targetIds || body.targetIds.length === 0) {
        return {
          statusCode: 400,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            success: false, 
            message: 'targetIds required when targetType is "user"' 
          }),
        };
      }

      // Get subscriptions for all target users
      const userSubscriptions = await Promise.all(
        body.targetIds.map(userId => getUserSubscriptions(userId))
      );

      subscriptions = userSubscriptions.flat();

    } else if (body.targetType === 'all') {
      // Send to all users (broadcast)
      subscriptions = await getAllActiveSubscriptions();

    } else if (body.targetType === 'role') {
      // TODO: Implement role-based targeting in Phase 2
      // For now, return error
      return {
        statusCode: 501,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          success: false, 
          message: 'Role-based targeting not yet implemented' 
        }),
      };
    }

    if (subscriptions.length === 0) {
      console.log('No active subscriptions found for target');
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: true,
          sent: 0,
          failed: 0,
          deactivated: 0,
          message: 'No active subscriptions found',
        } as SendNotificationResponse),
      };
    }

    console.log(`Sending notification to ${subscriptions.length} subscriptions`);

    // Send notifications to all subscriptions
    const results = await Promise.all(
      subscriptions.map(sub => sendPushNotification(sub, body.notification))
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

    // Collect errors for failed sends (limit to first 10 for response size)
    const errors = results
      .filter(r => !r.success)
      .slice(0, 10)
      .map(r => ({
        subscriptionId: r.subscriptionId,
        error: r.error || 'Unknown error',
      }));

    console.log(`Notification sent: ${sent} sent, ${failed} failed, ${deactivated} deactivated`);

    const response: SendNotificationResponse = {
      success: true,
      sent,
      failed,
      deactivated,
      errors: errors.length > 0 ? errors : undefined,
    };

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(response),
    };

  } catch (error) {
    console.error('Error sending notification:', error);
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




