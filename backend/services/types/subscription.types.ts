/**
 * Subscription Types
 * 
 * Defines the structure for host subscriptions stored in the main table.
 * This file contains the HostSubscription interface and related types.
 * 
 * Note: SubscriptionPlan types are in subscription-plan.types.ts
 * Note: AdvertisingSlot types are in advertising-slot.types.ts
 */

// ============================================================================
// ENUMS
// ============================================================================

/**
 * Subscription status (aligned with Stripe subscription statuses)
 */
export type SubscriptionStatus = 
  | 'INCOMPLETE'  // Checkout started but not completed
  | 'TRIALING'    // In trial period (no payment yet)
  | 'ACTIVE'      // Active subscription with successful payment
  | 'PAST_DUE'    // Payment failed, in grace period
  | 'CANCELLED'   // Cancelled but still active until period end
  | 'EXPIRED';    // Subscription has ended

// ============================================================================
// HOST SUBSCRIPTION (DynamoDB Record - Main Table)
// ============================================================================

/**
 * Host Subscription Record
 * 
 * Stored in the main table under the host entity.
 * Key pattern: pk = HOST#<hostId>, sk = SUBSCRIPTION
 * 
 * This record tracks the host's current subscription status, plan, and billing period.
 * Token availability is calculated by counting active slots in the AdvertisingSlots table.
 */
export interface HostSubscription {
  // Keys
  pk: string;                      // HOST#<hostId>
  sk: string;                      // SUBSCRIPTION

  // Identifiers
  hostId: string;

  // Current Plan
  planId: string;                  // e.g., "basic", "pro", "agency"
  priceId: string;                 // e.g., "basic_monthly", "basic_semi_annual"

  // Stripe Integration
  stripeCustomerId: string | null;     // Stripe customer ID
  stripeSubscriptionId: string | null; // Stripe subscription ID

  // Token Allowance (from plan.adSlots)
  totalTokens: number;             // Max concurrent ads allowed

  // Status (from Stripe)
  status: SubscriptionStatus;

  // Trial Period (if applicable)
  trialStart: string | null;       // ISO timestamp when trial began
  trialEnd: string | null;         // ISO timestamp when trial ends

  // Billing Period (from Stripe)
  currentPeriodStart: string;      // ISO timestamp
  currentPeriodEnd: string;        // ISO timestamp

  // Subscription Lifecycle
  startedAt: string;               // ISO timestamp when subscription first created

  // Cancellation
  cancelledAt: string | null;      // ISO timestamp when cancelled
  cancelAtPeriodEnd: boolean;      // If true, subscription ends at period end

  // GSI4: Query subscriptions by status and period end
  gsi4pk: string;                  // SUBSCRIPTION_STATUS#<status>
  gsi4sk: string;                  // <currentPeriodEnd>

  // GSI7: Query subscription by Stripe Customer ID (for EventBridge handler)
  gsi7pk: string | null;           // STRIPE_CUSTOMER#<stripeCustomerId> or null
  gsi7sk: string | null;           // SUBSCRIPTION or null

  // Metadata
  createdAt: string;
  updatedAt: string;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Build the partition key for a host subscription
 */
export function buildHostSubscriptionPK(hostId: string): string {
  return `HOST#${hostId}`;
}

/**
 * Build the sort key for a host subscription
 */
export function buildHostSubscriptionSK(): string {
  return 'SUBSCRIPTION';
}

/**
 * Build GSI4 partition key
 */
export function buildSubscriptionGSI4PK(status: SubscriptionStatus): string {
  return `SUBSCRIPTION_STATUS#${status}`;
}

/**
 * Build GSI4 sort key
 */
export function buildSubscriptionGSI4SK(currentPeriodEnd: string): string {
  return currentPeriodEnd;
}

/**
 * Check if subscription allows publishing new ads
 */
export function canPublishAds(subscription: HostSubscription): boolean {
  // Can publish if TRIALING or ACTIVE
  return subscription.status === 'TRIALING' || subscription.status === 'ACTIVE';
}

/**
 * Check if subscription is in grace period (payment failed but not cancelled)
 */
export function isInGracePeriod(subscription: HostSubscription): boolean {
  return subscription.status === 'PAST_DUE';
}

/**
 * Get the period end date for slot expiry calculation
 * Uses trial end if trialing, otherwise current period end
 */
export function getEffectivePeriodEnd(subscription: HostSubscription): string {
  if (subscription.status === 'TRIALING' && subscription.trialEnd) {
    return subscription.trialEnd;
  }
  return subscription.currentPeriodEnd;
}

// ============================================================================
// API RESPONSE TYPES
// ============================================================================

/**
 * Subscription summary for host dashboard
 */
export interface SubscriptionSummary {
  planId: string;
  priceId: string;
  planName: string;
  planName_sr: string;
  status: SubscriptionStatus;
  totalTokens: number;
  usedTokens: number;           // Count of active slots
  availableTokens: number;      // totalTokens - usedTokens
  currentPeriodStart: string;
  currentPeriodEnd: string;
  trialEnd: string | null;
  cancelAtPeriodEnd: boolean;
}

/**
 * Full subscription details for subscription management page
 */
export interface SubscriptionDetails extends SubscriptionSummary {
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  startedAt: string;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Plan change preview response
 */
export interface PlanChangePreview {
  currentPlan: {
    planId: string;
    priceId: string;
    adSlots: number;
  };
  newPlan: {
    planId: string;
    priceId: string;
    adSlots: number;
  };
  tokenChange: number;           // Positive = more tokens, negative = fewer
  currentActiveSlots: number;
  requiresAdTermination: boolean;
  adsToTerminate?: number;       // Only if requiresAdTermination is true
  activeAds?: Array<{            // Only if requiresAdTermination is true
    slotId: string;
    listingId: string;
    listingName: string;
    thumbnailUrl: string;
    expiresAt: string;
  }>;
  message: string;
  message_sr: string;
}

// ============================================================================
// LEGACY TYPES (for backward compatibility during migration)
// ============================================================================

/**
 * @deprecated Use planId from HostSubscription instead
 */
export type SubscriptionPlanName = 
  | 'FREE'
  | 'ONE'
  | 'FIVE'
  | 'TEN'
  | 'PRO';

/**
 * @deprecated Legacy subscription plan structure
 * Use SubscriptionPlan from subscription-plan.types.ts instead
 */
export interface LegacySubscriptionPlan {
  pk: string;
  sk: string;
  planName: SubscriptionPlanName;
  displayName: string;
  maxListings: number;
  monthlyPrice: number;
  description: string;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * @deprecated Legacy host subscription structure
 * Use HostSubscription instead
 */
export interface LegacyHostSubscription {
  pk: string;
  sk: string;
  hostId: string;
  planName: SubscriptionPlanName;
  maxListings: number;
  status: 'ACTIVE' | 'SUSPENDED' | 'CANCELLED';
  startedAt: string;
  expiresAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
  gsi4pk?: string;
  gsi4sk?: string;
}

/**
 * @deprecated Use DEFAULT_SUBSCRIPTION_PLANS from subscription-plan.types.ts instead
 */
export const SUBSCRIPTION_PLANS: Omit<LegacySubscriptionPlan, 'pk' | 'sk' | 'createdAt' | 'updatedAt'>[] = [
  {
    planName: 'FREE',
    displayName: 'Free Plan',
    maxListings: 2,
    monthlyPrice: 0.00,
    description: 'Perfect for getting started with up to 2 property listings',
    isActive: true,
    sortOrder: 1,
  },
];

/**
 * @deprecated Use 'basic' planId instead
 */
export const DEFAULT_SUBSCRIPTION_PLAN: SubscriptionPlanName = 'FREE';

/**
 * @deprecated
 */
export function getSubscriptionPlanConfig(planName: SubscriptionPlanName): Omit<LegacySubscriptionPlan, 'pk' | 'sk' | 'createdAt' | 'updatedAt'> | undefined {
  return SUBSCRIPTION_PLANS.find(plan => plan.planName === planName);
}
