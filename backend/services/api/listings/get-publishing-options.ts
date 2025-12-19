/**
 * Get Publishing Options Handler
 * 
 * GET /api/v1/hosts/{hostId}/publishing-options
 * 
 * Returns what publishing options are available for a host:
 * - Can they publish subscription-based? (with available tokens)
 * - Can they publish commission-based? (under free ad limit)
 * 
 * The frontend uses this to determine what options to show the user.
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import * as response from '../lib/response';
import { getPublishingOptions } from '../../lib/subscription-service';

interface PublishingOptionsResponse {
  canPublishSubscriptionBased: boolean;
  canPublishCommissionBased: boolean;
  subscriptionReason?: string;
  commissionReason?: string;
  availableTokens?: number;
  totalTokens?: number;
  commissionSlotsUsed: number;
  commissionSlotsLimit: number;
  hasActiveSubscription: boolean;
}

/**
 * Main handler
 */
export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  try {
    // Extract path parameters
    const hostId = event.pathParameters?.hostId;

    if (!hostId) {
      return response.badRequest('Missing hostId');
    }

    // Extract user from JWT
    const sub = event.requestContext.authorizer?.claims?.sub;
    const cognitoGroups = event.requestContext.authorizer?.claims?.['cognito:groups'] || '';
    const groups = typeof cognitoGroups === 'string' ? cognitoGroups.split(',') : cognitoGroups;

    if (!sub) {
      return response.unauthorized('Unauthorized');
    }

    // Verify user is a HOST
    if (!groups.includes('HOST')) {
      return response.forbidden('Only hosts can view publishing options');
    }

    // Get publishing options
    const options = await getPublishingOptions(hostId);

    const responseData: PublishingOptionsResponse = {
      canPublishSubscriptionBased: options.canPublishSubscriptionBased,
      canPublishCommissionBased: options.canPublishCommissionBased,
      subscriptionReason: options.subscriptionReason,
      commissionReason: options.commissionReason,
      availableTokens: options.availableTokens,
      totalTokens: options.subscription?.totalTokens,
      commissionSlotsUsed: options.commissionSlotsUsed || 0,
      commissionSlotsLimit: options.commissionSlotsLimit,
      hasActiveSubscription: !!options.subscription && 
        options.subscription.status !== 'CANCELLED' && 
        options.subscription.status !== 'EXPIRED',
    };

    return response.success(responseData);

  } catch (error) {
    console.error('Error getting publishing options:', error);
    return response.internalError('Failed to get publishing options', error as Error);
  }
}

