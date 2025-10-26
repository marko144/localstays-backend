/**
 * Get Host Subscription Lambda Handler
 * Retrieves host subscription details and entitlements
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';

import { getAuthContext, assertCanAccessHost } from '../lib/auth';
import * as response from '../lib/response';

const client = new DynamoDBClient({ region: process.env.AWS_REGION });
const docClient = DynamoDBDocumentClient.from(client);

const TABLE_NAME = process.env.TABLE_NAME!;

interface HostSubscription {
  pk: string;
  sk: string;
  hostId: string;
  planName: string;
  maxListings: number;
  status: string;
  startedAt: string;
  expiresAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface SubscriptionPlan {
  pk: string;
  sk: string;
  planName: string;
  displayName: string;
  maxListings: number;
  monthlyPrice: number;
  description: string;
  isActive: boolean;
  sortOrder: number;
}

/**
 * Main Lambda handler
 */
export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  console.log('Get subscription request:', {
    path: event.path,
    method: event.httpMethod,
    pathParameters: event.pathParameters,
  });

  try {
    // 1. Extract authentication context
    const auth = getAuthContext(event);
    const hostId = event.pathParameters?.hostId;

    if (!hostId) {
      return response.badRequest('hostId is required in path');
    }

    // 2. Verify authorization
    assertCanAccessHost(auth, hostId);

    // 3. Fetch host subscription
    const subscription = await getHostSubscription(hostId);

    if (!subscription) {
      return response.notFound(`Subscription not found for host: ${hostId}`);
    }

    // 4. Fetch subscription plan details
    const plan = await getSubscriptionPlan(subscription.planName);

    // 5. Build simplified response
    const subscriptionResponse = {
      hostId: subscription.hostId,
      planName: subscription.planName,
      displayName: plan?.displayName || subscription.planName,
      status: subscription.status,
      maxListings: subscription.maxListings,
      monthlyPrice: plan?.monthlyPrice || 0.00,
      description: plan?.description || '',
      startedAt: subscription.startedAt,
      expiresAt: subscription.expiresAt,
      cancelledAt: subscription.cancelledAt,
      isActive: subscription.status === 'ACTIVE',
    };

    return response.success(subscriptionResponse);

  } catch (error: any) {
    console.error('Get subscription error:', error);
    return response.handleError(error);
  }
}

/**
 * Get host subscription from DynamoDB
 */
async function getHostSubscription(hostId: string): Promise<HostSubscription | null> {
  const result = await docClient.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: {
        pk: `HOST#${hostId}`,
        sk: 'SUBSCRIPTION',
      },
    })
  );

  return result.Item as HostSubscription | null;
}

/**
 * Get subscription plan configuration from DynamoDB
 */
async function getSubscriptionPlan(planName: string): Promise<SubscriptionPlan | null> {
  const result = await docClient.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: {
        pk: `SUBSCRIPTION_PLAN#${planName}`,
        sk: 'CONFIG',
      },
    })
  );

  return result.Item as SubscriptionPlan | null;
}
