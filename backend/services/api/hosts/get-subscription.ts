/**
 * Get Host Subscription Lambda Handler
 * 
 * GET /api/v1/hosts/{hostId}/subscription
 * 
 * Retrieves host subscription details including:
 * - Current subscription plan and status
 * - Token availability (total, used, available)
 * - Active advertising slots with their listings
 * - Billing information (period start/end, renewal date)
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';

import { getAuthContext, assertCanAccessHost } from '../lib/auth';
import * as response from '../lib/response';
import { buildCloudFrontUrl } from '../lib/cloudfront-urls';
import {
  getHostSubscription,
  getSubscriptionPlan,
  getHostSlots,
  getTokenAvailability,
  buildSlotSummary,
} from '../../lib/subscription-service';
import { getEffectivePeriodEnd } from '../../types/subscription.types';
import { AdvertisingSlot, SlotSummary } from '../../types/advertising-slot.types';

const client = new DynamoDBClient({ region: process.env.AWS_REGION });
const docClient = DynamoDBDocumentClient.from(client);
const ssmClient = new SSMClient({});

const TABLE_NAME = process.env.TABLE_NAME!;
const STAGE = process.env.STAGE || 'dev1';

// Cache for subscriptions enabled setting
let cachedSubscriptionsEnabled: boolean | null = null;

/**
 * Check if subscriptions are globally enabled
 * Returns true if enabled (default), false if explicitly disabled
 */
async function getSubscriptionsEnabled(): Promise<boolean> {
  if (cachedSubscriptionsEnabled !== null) {
    return cachedSubscriptionsEnabled;
  }

  const parameterName = `/localstays/${STAGE}/config/subscriptions-enabled`;

  try {
    const response = await ssmClient.send(
      new GetParameterCommand({
        Name: parameterName,
      })
    );

    const value = response.Parameter?.Value?.toLowerCase();
    cachedSubscriptionsEnabled = value === 'true';
    
    console.log(`Subscriptions enabled: ${cachedSubscriptionsEnabled}`);
    return cachedSubscriptionsEnabled;
  } catch (error: any) {
    // Parameter doesn't exist - default to enabled
    if (error.name === 'ParameterNotFound') {
      console.log('Subscriptions enabled parameter not found - defaulting to enabled');
      cachedSubscriptionsEnabled = true;
      return true;
    }
    console.error('Failed to get subscriptions-enabled from SSM:', error);
    // Default to enabled on error
    cachedSubscriptionsEnabled = true;
    return true;
  }
}

/**
 * Response structure for subscription endpoint
 */
interface SubscriptionResponse {
  // Global subscription availability
  subscriptionsEnabled: boolean;
  
  // Subscription info
  hostId: string;
  status: string;
  statusLabel: string;
  statusLabel_sr: string;
  
  // Plan info
  planId: string;
  planName: string;
  planName_sr: string;
  
  // Token info
  totalTokens: number;
  usedTokens: number;
  availableTokens: number;
  canPublishNewAd: boolean;
  
  // Billing info
  currentPeriodStart?: string;
  currentPeriodEnd?: string;
  effectivePeriodEnd?: string;  // Includes any extensions
  cancelAtPeriodEnd: boolean;
  
  // Trial info (if applicable)
  isTrialPeriod: boolean;
  trialEndsAt?: string;
  
  // Stripe info (for managing subscription)
  stripeCustomerId?: string;
  hasPaymentMethod: boolean;
  
  // Active slots
  activeSlots: SlotSummary[];
  
  // Timestamps
  createdAt: string;
  updatedAt: string;
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
      // Check if subscriptions are globally enabled
      const subscriptionsEnabled = await getSubscriptionsEnabled();
      
      // Return a "no subscription" response instead of 404
      return response.success({
        subscriptionsEnabled,
        hostId,
        status: 'NONE',
        statusLabel: 'No Subscription',
        statusLabel_sr: 'Nema pretplate',
        planId: null,
        planName: null,
        planName_sr: null,
        totalTokens: 0,
        usedTokens: 0,
        availableTokens: 0,
        canPublishNewAd: false,
        cancelAtPeriodEnd: false,
        isTrialPeriod: false,
        hasPaymentMethod: false,
        activeSlots: [],
        createdAt: null,
        updatedAt: null,
      });
    }

    // 4. Fetch subscription plan details
    const plan = await getSubscriptionPlan(subscription.planId);

    // 5. Get token availability
    const tokenAvailability = await getTokenAvailability(hostId);

    // 6. Get active slots with listing details
    const slots = await getHostSlots(hostId);
    const slotSummaries = await buildSlotSummariesWithListings(slots, subscription.cancelAtPeriodEnd);

    // 7. Check if subscriptions are globally enabled
    const subscriptionsEnabled = await getSubscriptionsEnabled();

    // 8. Build response
    const subscriptionResponse: SubscriptionResponse = {
      subscriptionsEnabled,
      hostId: subscription.hostId,
      status: subscription.status,
      statusLabel: getStatusLabel(subscription.status, 'en'),
      statusLabel_sr: getStatusLabel(subscription.status, 'sr'),
      
      planId: subscription.planId,
      planName: plan?.displayName || subscription.planId,
      planName_sr: plan?.displayName_sr || subscription.planId,
      
      totalTokens: subscription.totalTokens,
      usedTokens: tokenAvailability.usedTokens,
      availableTokens: tokenAvailability.availableTokens,
      canPublishNewAd: tokenAvailability.canPublish,
      
      currentPeriodStart: subscription.currentPeriodStart,
      currentPeriodEnd: subscription.currentPeriodEnd,
      effectivePeriodEnd: getEffectivePeriodEnd(subscription),
      cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
      
      isTrialPeriod: subscription.status === 'TRIALING',
      trialEndsAt: subscription.trialEnd || undefined,
      
      stripeCustomerId: subscription.stripeCustomerId || undefined,
      hasPaymentMethod: !!subscription.stripeCustomerId, // Simplified check
      
      activeSlots: slotSummaries,
      
      createdAt: subscription.createdAt,
      updatedAt: subscription.updatedAt || subscription.createdAt,
    };

    return response.success(subscriptionResponse);

  } catch (error: any) {
    console.error('Get subscription error:', error);
    return response.handleError(error);
  }
}

/**
 * Build slot summaries with listing details
 */
async function buildSlotSummariesWithListings(
  slots: AdvertisingSlot[],
  cancelAtPeriodEnd: boolean
): Promise<SlotSummary[]> {
  if (slots.length === 0) {
    return [];
  }

  // Fetch listing details for each slot
  const summaries: SlotSummary[] = [];

  for (const slot of slots) {
    // Fetch listing metadata
    const listingResult = await docClient.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: {
          pk: `HOST#${slot.hostId}`,
          sk: `LISTING_META#${slot.listingId}`,
        },
      })
    );

    const listing = listingResult.Item;
    const listingName = listing?.listingName || 'Unknown Listing';
    
    // Get thumbnail URL from listing images
    // Note: We cannot use Limit with FilterExpression because DynamoDB applies
    // Limit BEFORE the filter, which could return 0 results if the first N
    // records don't match the filter.
    let thumbnailUrl = '';
    if (listing) {
      const imagesResult = await docClient.send(
        new QueryCommand({
          TableName: TABLE_NAME,
          KeyConditionExpression: 'pk = :pk AND begins_with(sk, :sk)',
          FilterExpression: 'isPrimary = :isPrimary AND isDeleted = :notDeleted',
          ExpressionAttributeValues: {
            ':pk': `LISTING#${slot.listingId}`,
            ':sk': 'IMAGE#',
            ':isPrimary': true,
            ':notDeleted': false,
          },
          // No Limit - must scan all images to find the primary one
        })
      );

      const primaryImage = imagesResult.Items?.[0];
      if (primaryImage?.webpUrls?.thumbnail) {
        // Build full CloudFront URL from S3 key
        thumbnailUrl = buildCloudFrontUrl(primaryImage.webpUrls.thumbnail);
      }
    }

    const summary = buildSlotSummary(slot, listingName, thumbnailUrl, cancelAtPeriodEnd);
    summaries.push(summary);
  }

  // Sort by activation date (newest first)
  summaries.sort((a, b) => new Date(b.activatedAt).getTime() - new Date(a.activatedAt).getTime());

  return summaries;
}

/**
 * Get human-readable status label
 */
function getStatusLabel(status: string, lang: 'en' | 'sr'): string {
  const labels: Record<string, { en: string; sr: string }> = {
    TRIALING: { en: 'Free Trial', sr: 'Besplatni probni period' },
    ACTIVE: { en: 'Active', sr: 'Aktivna' },
    PAST_DUE: { en: 'Payment Past Due', sr: 'Plaćanje kasni' },
    CANCELLED: { en: 'Cancelled', sr: 'Otkazana' },
    EXPIRED: { en: 'Expired', sr: 'Istekla' },
    NONE: { en: 'No Subscription', sr: 'Nema pretplate' },
  };

  return labels[status]?.[lang] || status;
}
