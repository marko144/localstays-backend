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
  getEffectivePeriodEnd,
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
// TOKEN AVAILABILITY
// ============================================================================

/**
 * Check how many tokens are available for a host
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

  // Count active slots
  const slots = await getHostSlots(hostId);
  const usedTokens = slots.length;
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
 * Check if a host can publish a new listing
 */
export async function canHostPublishListing(hostId: string): Promise<{
  canPublish: boolean;
  reason?: string;
  subscription?: HostSubscription;
}> {
  const subscription = await getHostSubscription(hostId);
  
  if (!subscription) {
    return { canPublish: false, reason: 'NO_SUBSCRIPTION' };
  }

  if (subscription.status === 'PAST_DUE') {
    return { 
      canPublish: false, 
      reason: 'SUBSCRIPTION_PAST_DUE',
      subscription,
    };
  }

  if (!canPublishAds(subscription)) {
    return { 
      canPublish: false, 
      reason: 'SUBSCRIPTION_INACTIVE',
      subscription,
    };
  }

  const availability = await getTokenAvailability(hostId);
  
  if (!availability.canPublish) {
    return { 
      canPublish: false, 
      reason: availability.reason,
      subscription,
    };
  }

  return { canPublish: true, subscription };
}

// ============================================================================
// SLOT CREATION
// ============================================================================

/**
 * Create a new advertising slot for a listing
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
  
  console.log(`✅ Created advertising slot ${slotId} for listing ${listingId}`, {
    createdAt: now,
    expiresAt,
    reviewCompensationDays,
    billingPeriod,
    compensationEnabled,
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
 * Mark all slots for a host as past due (payment failed)
 */
export async function markHostSlotsPastDue(hostId: string, isPastDue: boolean): Promise<void> {
  const slots = await getHostSlots(hostId);
  
  if (slots.length === 0) {
    console.log(`No slots to mark as past due for host ${hostId}`);
    return;
  }
  
  const now = new Date().toISOString();
  
  // Update each slot
  await Promise.all(
    slots.map((slot) =>
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
  
  console.log(`✅ Marked ${slots.length} slots as isPastDue=${isPastDue} for host ${hostId}`);
}

/**
 * Mark slots for immediate expiry (payment ultimately failed)
 */
export async function markSlotsForImmediateExpiry(hostId: string): Promise<void> {
  const slots = await getHostSlots(hostId);
  const pastDueSlots = slots.filter((s) => s.isPastDue);
  
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
 * Calculate remaining compensation days for a slot
 * 
 * Compensation "burns down" over time - if the slot has been active for
 * longer than the original compensation, no more compensation is applied.
 * 
 * @param slot - The advertising slot
 * @returns Remaining compensation days (0 or more)
 */
function calculateRemainingCompensation(slot: AdvertisingSlot): number {
  if (slot.reviewCompensationDays <= 0) {
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
  
  // Only update slots that are NOT marked as doNotRenew
  const eligibleSlots = slots.filter((s) => !s.doNotRenew);
  
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
  
  // Only extend slots that are NOT marked as doNotRenew
  const eligibleSlots = slots.filter((s) => !s.doNotRenew);
  
  if (eligibleSlots.length === 0) {
    console.log(`No slots to extend for host ${hostId}`);
    return 0;
  }
  
  const now = new Date().toISOString();
  
  // Filter to only slots that would actually be extended (new expiry > current expiry)
  const slotsToExtend = eligibleSlots.filter((slot) => {
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
  
  return {
    slotId: slot.slotId,
    listingId: slot.listingId,
    listingName,
    thumbnailUrl,
    activatedAt: slot.activatedAt,
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

