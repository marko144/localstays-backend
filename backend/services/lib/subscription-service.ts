/**
 * Subscription Service
 * 
 * Core business logic for managing subscriptions and advertising slots.
 * This service handles:
 * - Token availability checking
 * - Slot creation and deletion
 * - Slot expiry calculation
 * - Review compensation calculation
 * - Subscription status checks
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { 
  DynamoDBDocumentClient, 
  GetCommand, 
  PutCommand, 
  DeleteCommand, 
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import { randomUUID } from 'crypto';

import {
  HostSubscription,
  buildHostSubscriptionPK,
  buildHostSubscriptionSK,
  canPublishAds,
} from '../types/subscription.types';

import {
  AdvertisingSlot,
  SlotSummary,
  buildAdvertisingSlotPK,
  buildAdvertisingSlotSK,
  buildSlotGSI1PK,
  buildSlotGSI1SK,
  buildSlotGSI2PK,
  buildSlotGSI2SK,
  calculateSlotExpiry,
  calculateNewSlotExpiry,
  calculateReviewCompensationDays,
  getSlotDisplayStatus,
  getSlotDisplayLabel,
  calculateDaysRemaining,
} from '../types/advertising-slot.types';

import {
  SubscriptionPlan,
  StripeProductRecord,
  StripePriceRecord,
  BillingPeriod,
  buildSubscriptionPlanPK,
  buildSubscriptionPlanSK,
  buildStripePricePK,
  buildStripeProductPK,
} from '../types/subscription-plan.types';

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client, {
  marshallOptions: { removeUndefinedValues: true },
});
const ssmClient = new SSMClient({});

// Table names from environment
const TABLE_NAME = process.env.TABLE_NAME!;
const SUBSCRIPTION_PLANS_TABLE_NAME = process.env.SUBSCRIPTION_PLANS_TABLE_NAME!;
const ADVERTISING_SLOTS_TABLE_NAME = process.env.ADVERTISING_SLOTS_TABLE_NAME!;
const STAGE = process.env.STAGE || 'staging';

// ============================================================================
// SSM PARAMETER CACHE FOR REVIEW COMPENSATION
// ============================================================================

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

let reviewCompensationCache: {
  value: boolean;
  expiresAt: number;
} | null = null;

/**
 * Get review compensation setting from SSM Parameter Store
 * Cached for 5 minutes to avoid excessive SSM calls
 */
async function getReviewCompensationEnabled(): Promise<boolean> {
  const now = Date.now();
  
  // Return cached value if still valid
  if (reviewCompensationCache && reviewCompensationCache.expiresAt > now) {
    return reviewCompensationCache.value;
  }

  const parameterName = `/localstays/${STAGE}/config/review-compensation-enabled`;
  
  try {
    const response = await ssmClient.send(
      new GetParameterCommand({
        Name: parameterName,
      })
    );

    const value = response.Parameter?.Value?.toLowerCase() === 'true';
    
    // Cache the result
    reviewCompensationCache = {
      value,
      expiresAt: now + CACHE_TTL_MS,
    };
    
    console.log(`Review compensation setting loaded from SSM: ${value}`);
    return value;
  } catch (error: any) {
    // If parameter doesn't exist, default to false
    if (error.name === 'ParameterNotFound') {
      console.log(`Review compensation parameter not found, defaulting to false`);
      reviewCompensationCache = {
        value: false,
        expiresAt: now + CACHE_TTL_MS,
      };
      return false;
    }
    
    console.error(`Error reading review compensation setting from SSM:`, error);
    // On error, use cached value if available, otherwise default to false
    return reviewCompensationCache?.value ?? false;
  }
}

// ============================================================================
// SUBSCRIPTION QUERIES
// ============================================================================

/**
 * Get a host's subscription record
 */
export async function getHostSubscription(hostId: string): Promise<HostSubscription | null> {
  const result = await docClient.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: {
        pk: buildHostSubscriptionPK(hostId),
        sk: buildHostSubscriptionSK(),
      },
    })
  );

  return (result.Item as HostSubscription) || null;
}

/**
 * Get a host's subscription by Stripe Customer ID
 * Used by EventBridge handler to look up host when Stripe events arrive
 */
export async function getHostSubscriptionByStripeCustomerId(
  stripeCustomerId: string
): Promise<HostSubscription | null> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: 'StripeCustomerIndex',
      KeyConditionExpression: 'gsi7pk = :pk AND gsi7sk = :sk',
      ExpressionAttributeValues: {
        ':pk': `STRIPE_CUSTOMER#${stripeCustomerId}`,
        ':sk': 'SUBSCRIPTION',
      },
      Limit: 1,
    })
  );

  return (result.Items?.[0] as HostSubscription) || null;
}

/**
 * Get a subscription plan by ID (legacy format)
 */
export async function getSubscriptionPlan(planId: string): Promise<SubscriptionPlan | null> {
  const result = await docClient.send(
    new GetCommand({
      TableName: SUBSCRIPTION_PLANS_TABLE_NAME,
      Key: {
        pk: buildSubscriptionPlanPK(planId),
        sk: buildSubscriptionPlanSK(),
      },
    })
  );

  return (result.Item as SubscriptionPlan) || null;
}

/**
 * Get a Stripe price record by price ID
 * Returns the price record with product info
 */
export async function getStripePriceRecord(stripePriceId: string): Promise<StripePriceRecord | null> {
  const result = await docClient.send(
    new GetCommand({
      TableName: SUBSCRIPTION_PLANS_TABLE_NAME,
      Key: {
        pk: buildStripePricePK(stripePriceId),
        sk: 'PRICE',
      },
    })
  );

  return (result.Item as StripePriceRecord) || null;
}

/**
 * Get a Stripe product record by product ID
 */
export async function getStripeProductRecord(stripeProductId: string): Promise<StripeProductRecord | null> {
  const result = await docClient.send(
    new GetCommand({
      TableName: SUBSCRIPTION_PLANS_TABLE_NAME,
      Key: {
        pk: buildStripeProductPK(stripeProductId),
        sk: 'PRODUCT',
      },
    })
  );

  return (result.Item as StripeProductRecord) || null;
}

/**
 * Get plan info by Stripe price ID
 * This is the main function used by event handlers to look up plan details
 * Returns product info (including adSlots) for a given price
 */
export async function getPlanInfoByStripePriceId(stripePriceId: string): Promise<{
  stripeProductId: string;
  stripePriceId: string;
  adSlots: number;
  name: string;
  billingPeriod: BillingPeriod;
} | null> {
  // First, get the price record to find the product ID
  const priceRecord = await getStripePriceRecord(stripePriceId);
  if (!priceRecord) {
    console.warn(`Price record not found for ${stripePriceId}`);
    return null;
  }

  // Then get the product record to get adSlots
  const productRecord = await getStripeProductRecord(priceRecord.stripeProductId);
  if (!productRecord) {
    console.warn(`Product record not found for ${priceRecord.stripeProductId}`);
    return null;
  }

  return {
    stripeProductId: productRecord.stripeProductId,
    stripePriceId: priceRecord.stripePriceId,
    adSlots: productRecord.adSlots,
    name: productRecord.name,
    billingPeriod: priceRecord.billingPeriod,
  };
}

/**
 * Get all active subscription plans (for pricing page)
 */
export async function getActiveSubscriptionPlans(): Promise<SubscriptionPlan[]> {
  // Since it's a small table, we can scan it
  // In production, you might want to add a GSI for isActive
  const result = await docClient.send(
    new QueryCommand({
      TableName: SUBSCRIPTION_PLANS_TABLE_NAME,
      KeyConditionExpression: 'begins_with(pk, :prefix)',
      FilterExpression: 'isActive = :active',
      ExpressionAttributeValues: {
        ':prefix': 'PLAN#',
        ':active': true,
      },
    })
  );

  const plans = (result.Items || []) as SubscriptionPlan[];
  return plans.sort((a, b) => a.sortOrder - b.sortOrder);
}

// ============================================================================
// SLOT QUERIES
// ============================================================================

/**
 * Get all advertising slots for a host
 */
export async function getHostSlots(hostId: string): Promise<AdvertisingSlot[]> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: ADVERTISING_SLOTS_TABLE_NAME,
      IndexName: 'HostSlotsIndex',
      KeyConditionExpression: 'gsi1pk = :hostPk',
      ExpressionAttributeValues: {
        ':hostPk': buildSlotGSI1PK(hostId),
      },
    })
  );

  return (result.Items || []) as AdvertisingSlot[];
}

/**
 * Get a specific slot by listing ID
 * Since a listing can only have one active slot, we query by listing
 */
export async function getSlotByListingId(listingId: string): Promise<AdvertisingSlot | null> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: ADVERTISING_SLOTS_TABLE_NAME,
      KeyConditionExpression: 'pk = :pk',
      ExpressionAttributeValues: {
        ':pk': buildAdvertisingSlotPK(listingId),
      },
      Limit: 1,
    })
  );

  return (result.Items?.[0] as AdvertisingSlot) || null;
}

/**
 * Get slots expiring on or before a given date
 * Used by the expiry processor job
 */
export async function getExpiringSlots(beforeDate: string): Promise<AdvertisingSlot[]> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: ADVERTISING_SLOTS_TABLE_NAME,
      IndexName: 'ExpiryIndex',
      KeyConditionExpression: 'gsi2pk = :pk AND gsi2sk <= :beforeDate',
      ExpressionAttributeValues: {
        ':pk': buildSlotGSI2PK(),
        ':beforeDate': beforeDate,
      },
    })
  );

  return (result.Items || []) as AdvertisingSlot[];
}

/**
 * Get slots expiring on a specific date (for warning emails)
 */
export async function getSlotsExpiringOnDate(date: string): Promise<AdvertisingSlot[]> {
  // Query for slots expiring on this date (between start and end of day)
  const startOfDay = `${date}T00:00:00.000Z`;
  const endOfDay = `${date}T23:59:59.999Z`;

  const result = await docClient.send(
    new QueryCommand({
      TableName: ADVERTISING_SLOTS_TABLE_NAME,
      IndexName: 'ExpiryIndex',
      KeyConditionExpression: 'gsi2pk = :pk AND gsi2sk BETWEEN :start AND :end',
      ExpressionAttributeValues: {
        ':pk': buildSlotGSI2PK(),
        ':start': startOfDay,
        ':end': endOfDay,
      },
    })
  );

  return (result.Items || []) as AdvertisingSlot[];
}

// ============================================================================
// COMMISSION-BASED SLOT LIMITS
// ============================================================================

const MAX_COMMISSION_BASED_SLOTS = 100;

/**
 * Count how many commission-based (free) slots a host has
 */
export async function countCommissionBasedSlots(hostId: string): Promise<number> {
  const slots = await getHostSlots(hostId);
  return slots.filter(s => s.isCommissionBased).length;
}

/**
 * Count how many subscription-based slots a host has
 * (These are the ones that consume tokens)
 */
export async function countSubscriptionBasedSlots(hostId: string): Promise<number> {
  const slots = await getHostSlots(hostId);
  return slots.filter(s => !s.isCommissionBased).length;
}

// ============================================================================
// TOKEN AVAILABILITY
// ============================================================================

/**
 * Check how many tokens are available for a host
 * Note: Only subscription-based slots consume tokens
 */
export async function getTokenAvailability(hostId: string): Promise<{
  totalTokens: number;
  usedTokens: number;
  availableTokens: number;
  canPublish: boolean;
  reason?: string;
}> {
  // Get subscription
  const subscription = await getHostSubscription(hostId);
  
  if (!subscription) {
    return {
      totalTokens: 0,
      usedTokens: 0,
      availableTokens: 0,
      canPublish: false,
      reason: 'NO_SUBSCRIPTION',
    };
  }

  // Check subscription status
  if (!canPublishAds(subscription)) {
    let reason: string;
    switch (subscription.status) {
      case 'PAST_DUE':
        reason = 'SUBSCRIPTION_PAST_DUE';
        break;
      case 'CANCELLED':
        reason = 'SUBSCRIPTION_CANCELLED';
        break;
      case 'EXPIRED':
        reason = 'SUBSCRIPTION_EXPIRED';
        break;
      default:
        reason = 'SUBSCRIPTION_INACTIVE';
    }
    
    return {
      totalTokens: subscription.totalTokens,
      usedTokens: 0,
      availableTokens: 0,
      canPublish: false,
      reason,
    };
  }

  // Count active subscription-based slots only (commission-based don't consume tokens)
  const usedTokens = await countSubscriptionBasedSlots(hostId);
  const availableTokens = Math.max(0, subscription.totalTokens - usedTokens);

  return {
    totalTokens: subscription.totalTokens,
    usedTokens,
    availableTokens,
    canPublish: availableTokens > 0,
    reason: availableTokens === 0 ? 'NO_TOKENS_AVAILABLE' : undefined,
  };
}

/**
 * Check what publishing options are available for a host.
 * 
 * The frontend decides which ad type to use based on these options.
 * 
 * @returns Available publishing options
 */
export async function getPublishingOptions(hostId: string): Promise<{
  canPublishSubscriptionBased: boolean;
  canPublishCommissionBased: boolean;
  subscriptionReason?: string;  // Why subscription-based is unavailable
  commissionReason?: string;    // Why commission-based is unavailable
  subscription?: HostSubscription;
  availableTokens?: number;
  commissionSlotsUsed?: number;
  commissionSlotsLimit: number;
}> {
  const subscription = await getHostSubscription(hostId);
  
  // Check subscription-based availability
  let canPublishSubscriptionBased = false;
  let subscriptionReason: string | undefined;
  let availableTokens: number | undefined;
  
  if (!subscription) {
    subscriptionReason = 'NO_SUBSCRIPTION';
  } else if (subscription.status === 'PAST_DUE') {
    subscriptionReason = 'SUBSCRIPTION_PAST_DUE';
  } else if (!canPublishAds(subscription)) {
    subscriptionReason = 'SUBSCRIPTION_INACTIVE';
  } else {
    const availability = await getTokenAvailability(hostId);
    availableTokens = availability.availableTokens;
    if (availability.canPublish) {
      canPublishSubscriptionBased = true;
    } else {
      subscriptionReason = 'NO_TOKENS_AVAILABLE';
    }
  }
  
  // Check commission-based availability
  const commissionSlotCount = await countCommissionBasedSlots(hostId);
  let canPublishCommissionBased = true;
  let commissionReason: string | undefined;
  
  if (commissionSlotCount >= MAX_COMMISSION_BASED_SLOTS) {
    canPublishCommissionBased = false;
    commissionReason = 'COMMISSION_SLOT_LIMIT_REACHED';
  }
  
  return {
    canPublishSubscriptionBased,
    canPublishCommissionBased,
    subscriptionReason,
    commissionReason,
    subscription: subscription || undefined,
    availableTokens,
    commissionSlotsUsed: commissionSlotCount,
    commissionSlotsLimit: MAX_COMMISSION_BASED_SLOTS,
  };
}

/**
 * Check if a host can publish using their preferred ad type.
 * Used by admin auto-publish to decide which type to use automatically.
 * 
 * Logic for auto-publish:
 * 1. If host has active subscription with available tokens → use subscription-based
 * 2. If no subscription or no tokens → fall back to commission-based (if under limit)
 * 3. If commission-based limit reached → cannot publish
 * 
 * @returns Publishing availability with recommended ad model
 */
export async function canHostPublishListing(hostId: string): Promise<{
  canPublish: boolean;
  useCommissionBased: boolean;
  reason?: string;
  subscription?: HostSubscription;
}> {
  const options = await getPublishingOptions(hostId);
  
  // Prefer subscription-based if available
  if (options.canPublishSubscriptionBased) {
    return { 
      canPublish: true, 
      useCommissionBased: false,
      subscription: options.subscription,
    };
  }
  
  // Fall back to commission-based
  if (options.canPublishCommissionBased) {
    return { 
      canPublish: true, 
      useCommissionBased: true,
      subscription: options.subscription,
    };
  }
  
  // Neither available
  return { 
    canPublish: false, 
    useCommissionBased: false,
    reason: options.commissionReason || options.subscriptionReason || 'CANNOT_PUBLISH',
    subscription: options.subscription,
  };
}

// ============================================================================
// SLOT CREATION
// ============================================================================

/**
 * Create a new subscription-based advertising slot for a listing
 * 
 * New slots get the FULL billing period duration from the creation date,
 * not just until the current subscription period ends. This ensures hosts
 * get full value even if they create an ad mid-subscription-cycle.
 * 
 * Example: Monthly subscription started Dec 1, ends Dec 31.
 * - Ad created Dec 1 → expires Jan 1 (full month)
 * - Ad created Dec 15 → expires Jan 15 (full month, NOT Dec 31)
 * 
 * Review Compensation:
 * - Calculated as days between listing creation and first review completion
 * - Only applied if SSM parameter /localstays/{stage}/config/review-compensation-enabled is 'true'
 * - Stored on slot and "burns down" over time at renewals/plan changes
 */
export async function createAdvertisingSlot(params: {
  hostId: string;
  listingId: string;
  planId: string;
  subscription: HostSubscription;
  listingCreatedAt?: string;          // When the listing was created
  firstReviewCompletedAt?: string;    // When admin first approved/rejected
}): Promise<AdvertisingSlot> {
  const { hostId, listingId, planId, subscription, listingCreatedAt, firstReviewCompletedAt } = params;
  
  const slotId = `slot_${randomUUID()}`;
  const now = new Date().toISOString();
  
  // Get the plan to determine billing period
  const plan = await getSubscriptionPlan(planId);
  const priceInfo = plan?.prices.find(p => p.priceId === subscription.priceId);
  const billingPeriod: BillingPeriod = priceInfo?.billingPeriod || 'MONTHLY';
  
  // Calculate review compensation days (time listing waited for first review)
  // Only apply if compensation is enabled (via SSM) and we have both dates
  // Note: Review compensation is NOT applied during trial periods
  const isTrialPeriod = subscription.status === 'TRIALING' && !!subscription.trialEnd;
  const compensationEnabled = await getReviewCompensationEnabled();
  let reviewCompensationDays = 0;
  
  if (!isTrialPeriod && compensationEnabled && listingCreatedAt && firstReviewCompletedAt) {
    reviewCompensationDays = calculateReviewCompensationDays(
      listingCreatedAt,
      firstReviewCompletedAt
    );
    console.log(`📅 Review compensation calculated: ${reviewCompensationDays} days (created: ${listingCreatedAt}, reviewed: ${firstReviewCompletedAt})`);
  } else if (isTrialPeriod) {
    console.log(`📅 Review compensation not applied during trial period`);
  } else if (!compensationEnabled) {
    console.log(`📅 Review compensation disabled (SSM parameter)`);
  }
  
  // Calculate expiry date based on subscription status:
  // - TRIALING: Use trial end date (no compensation, slots expire when trial ends)
  // - ACTIVE/other: Use full billing period from creation date + compensation
  let expiresAt: string;
  
  if (isTrialPeriod) {
    // During trial: slots expire when trial ends
    // No review compensation during trial - it will be applied when trial converts to paid
    expiresAt = subscription.trialEnd!;
    console.log(`📅 Trial period: slot expires at trial end ${expiresAt}`);
  } else {
    // Normal subscription: full billing period from creation date + review compensation
    expiresAt = calculateNewSlotExpiry(now, billingPeriod, reviewCompensationDays);
    console.log(`📅 Paid subscription: slot expires at ${expiresAt} (billing period: ${billingPeriod}, compensation: ${reviewCompensationDays} days)`);
  }
  
  const slot: AdvertisingSlot = {
    pk: buildAdvertisingSlotPK(listingId),
    sk: buildAdvertisingSlotSK(slotId),
    
    slotId,
    listingId,
    hostId,
    
    isCommissionBased: false,
    planIdAtCreation: planId,
    
    activatedAt: now,
    expiresAt,
    reviewCompensationDays,
    
    doNotRenew: false,
    isPastDue: false,
    markedForImmediateExpiry: false,
    
    gsi1pk: buildSlotGSI1PK(hostId),
    gsi1sk: buildSlotGSI1SK(now),
    
    gsi2pk: buildSlotGSI2PK(),
    gsi2sk: buildSlotGSI2SK(expiresAt, listingId, slotId),
    
    createdAt: now,
    updatedAt: now,
  };
  
  await docClient.send(
    new PutCommand({
      TableName: ADVERTISING_SLOTS_TABLE_NAME,
      Item: slot,
    })
  );
  
  console.log(`✅ Created subscription-based advertising slot ${slotId} for listing ${listingId}`, {
    createdAt: now,
    expiresAt,
    reviewCompensationDays,
    billingPeriod,
    compensationEnabled,
  });
  
  return slot;
}

/**
 * Create a new commission-based (free) advertising slot for a listing
 * 
 * Commission-based slots:
 * - Have no expiry date (run indefinitely)
 * - Are not indexed in ExpiryIndex (sparse index)
 * - Don't consume subscription tokens
 * - Are monetized via booking commission instead of subscription fee
 */
export async function createCommissionBasedSlot(params: {
  hostId: string;
  listingId: string;
}): Promise<AdvertisingSlot> {
  const { hostId, listingId } = params;
  
  const slotId = `slot_${randomUUID()}`;
  const now = new Date().toISOString();
  
  const slot: AdvertisingSlot = {
    pk: buildAdvertisingSlotPK(listingId),
    sk: buildAdvertisingSlotSK(slotId),
    
    slotId,
    listingId,
    hostId,
    
    isCommissionBased: true,
    // No planIdAtCreation for commission-based slots
    // No expiresAt - commission slots don't expire
    // No reviewCompensationDays - not applicable
    // No doNotRenew - not applicable (no renewal concept)
    // No isPastDue - not applicable (no payment)
    // No markedForImmediateExpiry - not applicable
    
    activatedAt: now,
    
    // GSI1: HostSlotsIndex - included for querying all host slots
    gsi1pk: buildSlotGSI1PK(hostId),
    gsi1sk: buildSlotGSI1SK(now),
    
    // GSI2: ExpiryIndex - NOT included (sparse index, commission slots don't expire)
    // gsi2pk and gsi2sk are undefined
    
    createdAt: now,
    updatedAt: now,
  };
  
  await docClient.send(
    new PutCommand({
      TableName: ADVERTISING_SLOTS_TABLE_NAME,
      Item: slot,
    })
  );
  
  console.log(`✅ Created commission-based advertising slot ${slotId} for listing ${listingId}`, {
    createdAt: now,
    isCommissionBased: true,
  });
  
  return slot;
}

// ============================================================================
// SLOT UPDATES
// ============================================================================

/**
 * Mark a slot as "do not renew"
 */
export async function setSlotDoNotRenew(
  listingId: string,
  slotId: string,
  doNotRenew: boolean
): Promise<void> {
  await docClient.send(
    new UpdateCommand({
      TableName: ADVERTISING_SLOTS_TABLE_NAME,
      Key: {
        pk: buildAdvertisingSlotPK(listingId),
        sk: buildAdvertisingSlotSK(slotId),
      },
      UpdateExpression: 'SET doNotRenew = :doNotRenew, updatedAt = :updatedAt',
      ExpressionAttributeValues: {
        ':doNotRenew': doNotRenew,
        ':updatedAt': new Date().toISOString(),
      },
    })
  );
  
  console.log(`✅ Set doNotRenew=${doNotRenew} for slot ${slotId}`);
}

/**
 * Mark all subscription-based slots for a host as past due (payment failed)
 * Commission-based slots are not affected by subscription payment status
 */
export async function markHostSlotsPastDue(hostId: string, isPastDue: boolean): Promise<void> {
  const slots = await getHostSlots(hostId);
  
  // Only affect subscription-based slots
  const subscriptionSlots = slots.filter((s) => !s.isCommissionBased);
  
  if (subscriptionSlots.length === 0) {
    console.log(`No subscription-based slots to mark as past due for host ${hostId}`);
    return;
  }
  
  const now = new Date().toISOString();
  
  // Update each subscription-based slot
  await Promise.all(
    subscriptionSlots.map((slot) =>
      docClient.send(
        new UpdateCommand({
          TableName: ADVERTISING_SLOTS_TABLE_NAME,
          Key: {
            pk: slot.pk,
            sk: slot.sk,
          },
          UpdateExpression: 'SET isPastDue = :isPastDue, updatedAt = :updatedAt',
          ExpressionAttributeValues: {
            ':isPastDue': isPastDue,
            ':updatedAt': now,
          },
        })
      )
    )
  );
  
  console.log(`✅ Marked ${subscriptionSlots.length} subscription-based slots as isPastDue=${isPastDue} for host ${hostId}`);
}

/**
 * Mark subscription-based slots for immediate expiry (payment ultimately failed)
 * Commission-based slots are not affected by subscription payment status
 */
export async function markSlotsForImmediateExpiry(hostId: string): Promise<void> {
  const slots = await getHostSlots(hostId);
  // Only affect subscription-based slots that are past due
  const pastDueSlots = slots.filter((s) => !s.isCommissionBased && s.isPastDue);
  
  if (pastDueSlots.length === 0) {
    console.log(`No past-due slots to mark for immediate expiry for host ${hostId}`);
    return;
  }
  
  const now = new Date().toISOString();
  
  await Promise.all(
    pastDueSlots.map((slot) =>
      docClient.send(
        new UpdateCommand({
          TableName: ADVERTISING_SLOTS_TABLE_NAME,
          Key: {
            pk: slot.pk,
            sk: slot.sk,
          },
          UpdateExpression: 'SET markedForImmediateExpiry = :marked, updatedAt = :updatedAt',
          ExpressionAttributeValues: {
            ':marked': true,
            ':updatedAt': now,
          },
        })
      )
    )
  );
  
  console.log(`✅ Marked ${pastDueSlots.length} slots for immediate expiry for host ${hostId}`);
}

/**
 * Convert a commission-based slot to subscription-based
 * 
 * This is like publishing a new subscription-based ad:
 * - Requires active subscription with available token
 * - Sets expiry based on billing period (full period from now)
 * - No review compensation (listing already approved)
 */
export async function convertSlotToSubscriptionBased(
  slot: AdvertisingSlot,
  subscription: HostSubscription,
  planId: string
): Promise<AdvertisingSlot> {
  if (!slot.isCommissionBased) {
    throw new Error('Slot is already subscription-based');
  }
  
  const now = new Date().toISOString();
  
  // Get billing period from subscription
  const plan = await getSubscriptionPlan(planId);
  const priceInfo = plan?.prices.find(p => p.priceId === subscription.priceId);
  const billingPeriod: BillingPeriod = priceInfo?.billingPeriod || 'MONTHLY';
  
  // Calculate expiry (no review compensation for conversion)
  const isTrialPeriod = subscription.status === 'TRIALING' && !!subscription.trialEnd;
  let expiresAt: string;
  
  if (isTrialPeriod) {
    expiresAt = subscription.trialEnd!;
  } else {
    expiresAt = calculateNewSlotExpiry(now, billingPeriod, 0);
  }
  
  // Update the slot
  await docClient.send(
    new UpdateCommand({
      TableName: ADVERTISING_SLOTS_TABLE_NAME,
      Key: {
        pk: slot.pk,
        sk: slot.sk,
      },
      UpdateExpression: `
        SET isCommissionBased = :isCommissionBased,
            planIdAtCreation = :planId,
            activatedAt = :activatedAt,
            expiresAt = :expiresAt,
            reviewCompensationDays = :reviewCompensationDays,
            doNotRenew = :doNotRenew,
            isPastDue = :isPastDue,
            markedForImmediateExpiry = :markedForImmediateExpiry,
            gsi2pk = :gsi2pk,
            gsi2sk = :gsi2sk,
            updatedAt = :updatedAt
      `,
      ExpressionAttributeValues: {
        ':isCommissionBased': false,
        ':planId': planId,
        ':activatedAt': now,
        ':expiresAt': expiresAt,
        ':reviewCompensationDays': 0,
        ':doNotRenew': false,
        ':isPastDue': false,
        ':markedForImmediateExpiry': false,
        ':gsi2pk': buildSlotGSI2PK(),
        ':gsi2sk': buildSlotGSI2SK(expiresAt, slot.listingId, slot.slotId),
        ':updatedAt': now,
      },
    })
  );
  
  console.log(`✅ Converted slot ${slot.slotId} from commission-based to subscription-based`, {
    expiresAt,
    billingPeriod,
    planId,
  });
  
  // Return updated slot
  return {
    ...slot,
    isCommissionBased: false,
    planIdAtCreation: planId,
    activatedAt: now,
    expiresAt,
    reviewCompensationDays: 0,
    doNotRenew: false,
    isPastDue: false,
    markedForImmediateExpiry: false,
    gsi2pk: buildSlotGSI2PK(),
    gsi2sk: buildSlotGSI2SK(expiresAt, slot.listingId, slot.slotId),
    updatedAt: now,
  };
}

/**
 * Convert a subscription-based slot to commission-based
 * 
 * This instantly converts the slot:
 * - Removes expiry (slot runs indefinitely)
 * - Removes from ExpiryIndex
 * - Frees up a subscription token
 */
export async function convertSlotToCommissionBased(
  slot: AdvertisingSlot
): Promise<AdvertisingSlot> {
  if (slot.isCommissionBased) {
    throw new Error('Slot is already commission-based');
  }
  
  const now = new Date().toISOString();
  
  // Update the slot - REMOVE expiry-related fields
  await docClient.send(
    new UpdateCommand({
      TableName: ADVERTISING_SLOTS_TABLE_NAME,
      Key: {
        pk: slot.pk,
        sk: slot.sk,
      },
      UpdateExpression: `
        SET isCommissionBased = :isCommissionBased,
            updatedAt = :updatedAt
        REMOVE expiresAt, reviewCompensationDays, doNotRenew, isPastDue, 
               markedForImmediateExpiry, planIdAtCreation, gsi2pk, gsi2sk
      `,
      ExpressionAttributeValues: {
        ':isCommissionBased': true,
        ':updatedAt': now,
      },
    })
  );
  
  console.log(`✅ Converted slot ${slot.slotId} from subscription-based to commission-based`);
  
  // Return updated slot
  return {
    ...slot,
    isCommissionBased: true,
    planIdAtCreation: undefined,
    expiresAt: undefined,
    reviewCompensationDays: undefined,
    doNotRenew: undefined,
    isPastDue: undefined,
    markedForImmediateExpiry: undefined,
    gsi2pk: undefined,
    gsi2sk: undefined,
    updatedAt: now,
  };
}

/**
 * Calculate remaining compensation days for a slot
 * 
 * Compensation "burns down" over time - if the slot has been active for
 * longer than the original compensation, no more compensation is applied.
 * 
 * @param slot - The advertising slot
 * @returns Remaining compensation days (0 or more)
 */
function calculateRemainingCompensation(slot: AdvertisingSlot): number {
  // Commission-based slots don't have review compensation
  if (!slot.reviewCompensationDays || slot.reviewCompensationDays <= 0) {
    return 0;
  }
  
  const activatedAt = new Date(slot.activatedAt);
  const now = new Date();
  const daysSinceActivation = Math.ceil(
    (now.getTime() - activatedAt.getTime()) / (1000 * 60 * 60 * 24)
  );
  
  const remaining = Math.max(0, slot.reviewCompensationDays - daysSinceActivation);
  
  console.log(`📅 Compensation burn-down for slot ${slot.slotId}: original=${slot.reviewCompensationDays}, active=${daysSinceActivation} days, remaining=${remaining}`);
  
  return remaining;
}

/**
 * Update slot expiry dates to match new subscription period
 * 
 * Used for plan changes (upgrades AND downgrades).
 * This WILL update slots to the new period even if it's shorter,
 * because the host has paid (pro-rata) for the new billing cycle.
 * 
 * Review compensation "burns down" - only remaining compensation is applied.
 */
export async function updateSlotsToNewPeriod(
  hostId: string,
  newPeriodEnd: string
): Promise<number> {
  const slots = await getHostSlots(hostId);
  
  // Only update subscription-based slots that are NOT marked as doNotRenew
  // Commission-based slots don't have expiry dates and are not affected by subscription changes
  const eligibleSlots = slots.filter((s) => !s.isCommissionBased && !s.doNotRenew);
  
  if (eligibleSlots.length === 0) {
    console.log(`No slots to update for host ${hostId}`);
    return 0;
  }
  
  const now = new Date().toISOString();
  
  await Promise.all(
    eligibleSlots.map((slot) => {
      // Calculate remaining compensation (burns down over time)
      const remainingCompensation = calculateRemainingCompensation(slot);
      const newExpiresAt = calculateSlotExpiry(newPeriodEnd, remainingCompensation);
      const newGsi2sk = buildSlotGSI2SK(newExpiresAt, slot.listingId, slot.slotId);
      
      console.log(`📅 Updating slot ${slot.slotId} expiry: ${slot.expiresAt} → ${newExpiresAt} (remaining comp: ${remainingCompensation} days)`);
      
      return docClient.send(
        new UpdateCommand({
          TableName: ADVERTISING_SLOTS_TABLE_NAME,
          Key: {
            pk: slot.pk,
            sk: slot.sk,
          },
          UpdateExpression: 'SET expiresAt = :expiresAt, gsi2sk = :gsi2sk, isPastDue = :isPastDue, updatedAt = :updatedAt',
          ExpressionAttributeValues: {
            ':expiresAt': newExpiresAt,
            ':gsi2sk': newGsi2sk,
            ':isPastDue': false,
            ':updatedAt': now,
          },
        })
      );
    })
  );
  
  console.log(`✅ Updated ${eligibleSlots.length} slots to new period end ${newPeriodEnd} for host ${hostId}`);
  
  return eligibleSlots.length;
}

/**
 * Extend slot expiry dates at renewal (invoice.paid)
 * 
 * IMPORTANT: This function only EXTENDS slots - it will NOT shorten expiry dates.
 * This prevents invoice.paid events (which may have prorated periods) from
 * overwriting correct expiry dates set by subscription.updated events.
 * 
 * Review compensation "burns down" - only remaining compensation is applied.
 * 
 * Use updateSlotsToNewPeriod() for plan changes where shortening is expected.
 */
export async function extendSlotsAtRenewal(
  hostId: string,
  newPeriodEnd: string
): Promise<number> {
  const slots = await getHostSlots(hostId);
  
  // Only extend subscription-based slots that are NOT marked as doNotRenew
  // Commission-based slots don't have expiry dates and are not affected by subscription changes
  const eligibleSlots = slots.filter((s) => !s.isCommissionBased && !s.doNotRenew);
  
  if (eligibleSlots.length === 0) {
    console.log(`No slots to extend for host ${hostId}`);
    return 0;
  }
  
  const now = new Date().toISOString();
  
  // Filter to only slots that would actually be extended (new expiry > current expiry)
  const slotsToExtend = eligibleSlots.filter((slot) => {
    // Skip slots without expiry (should not happen since we filter isCommissionBased above)
    if (!slot.expiresAt) {
      return false;
    }
    
    // Calculate remaining compensation (burns down over time)
    const remainingCompensation = calculateRemainingCompensation(slot);
    const newExpiresAt = calculateSlotExpiry(newPeriodEnd, remainingCompensation);
    const shouldExtend = newExpiresAt > slot.expiresAt;
    
    if (!shouldExtend) {
      console.log(`⏭️ Skipping slot ${slot.slotId} - new expiry ${newExpiresAt} is not later than current ${slot.expiresAt}`);
    }
    
    return shouldExtend;
  });
  
  if (slotsToExtend.length === 0) {
    console.log(`No slots need extending for host ${hostId} - all slots already have later expiry dates`);
    return 0;
  }
  
  await Promise.all(
    slotsToExtend.map((slot) => {
      // Calculate remaining compensation (burns down over time)
      const remainingCompensation = calculateRemainingCompensation(slot);
      const newExpiresAt = calculateSlotExpiry(newPeriodEnd, remainingCompensation);
      const newGsi2sk = buildSlotGSI2SK(newExpiresAt, slot.listingId, slot.slotId);
      
      return docClient.send(
        new UpdateCommand({
          TableName: ADVERTISING_SLOTS_TABLE_NAME,
          Key: {
            pk: slot.pk,
            sk: slot.sk,
          },
          UpdateExpression: 'SET expiresAt = :expiresAt, gsi2sk = :gsi2sk, isPastDue = :isPastDue, updatedAt = :updatedAt',
          ExpressionAttributeValues: {
            ':expiresAt': newExpiresAt,
            ':gsi2sk': newGsi2sk,
            ':isPastDue': false,
            ':updatedAt': now,
          },
        })
      );
    })
  );
  
  console.log(`✅ Extended ${slotsToExtend.length} slots to ${newPeriodEnd} for host ${hostId}`);
  
  return slotsToExtend.length;
}

// ============================================================================
// SLOT DELETION
// ============================================================================

/**
 * Delete an advertising slot
 */
export async function deleteAdvertisingSlot(listingId: string, slotId: string): Promise<void> {
  await docClient.send(
    new DeleteCommand({
      TableName: ADVERTISING_SLOTS_TABLE_NAME,
      Key: {
        pk: buildAdvertisingSlotPK(listingId),
        sk: buildAdvertisingSlotSK(slotId),
      },
    })
  );
  
  console.log(`✅ Deleted advertising slot ${slotId} for listing ${listingId}`);
}

// ============================================================================
// SLOT DISPLAY HELPERS
// ============================================================================

/**
 * Build slot summary for API response
 */
export function buildSlotSummary(
  slot: AdvertisingSlot,
  listingName: string,
  thumbnailUrl: string,
  subscriptionCancelAtPeriodEnd: boolean
): SlotSummary {
  const displayStatus = getSlotDisplayStatus(slot, subscriptionCancelAtPeriodEnd);
  
  // For commission-based slots, we return a simpler summary
  if (slot.isCommissionBased) {
    return {
      slotId: slot.slotId,
      listingId: slot.listingId,
      listingName,
      thumbnailUrl,
      activatedAt: slot.activatedAt,
      isCommissionBased: true,
      displayStatus,
      displayLabel: getSlotDisplayLabel(displayStatus, undefined, 'en'),
      displayLabel_sr: getSlotDisplayLabel(displayStatus, undefined, 'sr'),
    };
  }
  
  return {
    slotId: slot.slotId,
    listingId: slot.listingId,
    listingName,
    thumbnailUrl,
    activatedAt: slot.activatedAt,
    isCommissionBased: false,
    expiresAt: slot.expiresAt,
    daysRemaining: calculateDaysRemaining(slot.expiresAt),
    reviewCompensationDays: slot.reviewCompensationDays,
    doNotRenew: slot.doNotRenew,
    isPastDue: slot.isPastDue,
    displayStatus,
    displayLabel: getSlotDisplayLabel(displayStatus, slot.expiresAt, 'en'),
    displayLabel_sr: getSlotDisplayLabel(displayStatus, slot.expiresAt, 'sr'),
  };
}

// ============================================================================
// SUBSCRIPTION UPDATES
// ============================================================================

/**
 * Update host subscription (used by Stripe webhook handlers)
 */
export async function updateHostSubscription(
  hostId: string,
  updates: Partial<HostSubscription>
): Promise<void> {
  const now = new Date().toISOString();
  
  // Build update expression dynamically
  const updateParts: string[] = ['updatedAt = :updatedAt'];
  const expressionValues: Record<string, any> = { ':updatedAt': now };
  
  Object.entries(updates).forEach(([key, value]) => {
    if (key !== 'pk' && key !== 'sk' && key !== 'hostId') {
      updateParts.push(`#${key} = :${key}`);
      expressionValues[`:${key}`] = value;
    }
  });
  
  const expressionNames: Record<string, string> = {};
  Object.keys(updates).forEach((key) => {
    if (key !== 'pk' && key !== 'sk' && key !== 'hostId') {
      expressionNames[`#${key}`] = key;
    }
  });
  
  await docClient.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: {
        pk: buildHostSubscriptionPK(hostId),
        sk: buildHostSubscriptionSK(),
      },
      UpdateExpression: `SET ${updateParts.join(', ')}`,
      ExpressionAttributeNames: Object.keys(expressionNames).length > 0 ? expressionNames : undefined,
      ExpressionAttributeValues: expressionValues,
    })
  );
  
  console.log(`✅ Updated subscription for host ${hostId}`, updates);
}

/**
 * Create or update host subscription
 */
export async function saveHostSubscription(subscription: HostSubscription): Promise<void> {
  await docClient.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        ...subscription,
        updatedAt: new Date().toISOString(),
      },
    })
  );
  
  console.log(`✅ Saved subscription for host ${subscription.hostId}`);
}

