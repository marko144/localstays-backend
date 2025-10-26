/**
 * Subscription Entity Type Definitions
 * For managing host subscription plans and entitlements
 */

export type SubscriptionPlanName = 
  | 'FREE'
  | 'ONE'
  | 'FIVE'
  | 'TEN'
  | 'PRO';

/**
 * Subscription Plan Configuration (stored in DynamoDB as CONFIG records)
 */
export interface SubscriptionPlan {
  pk: string;                      // SUBSCRIPTION_PLAN#<planName>
  sk: string;                      // CONFIG
  
  planName: SubscriptionPlanName;
  displayName: string;             // e.g., "Free Plan", "One Property", etc.
  maxListings: number;             // Maximum number of property listings allowed
  monthlyPrice: number;            // Monthly price in EUR (e.g., 0.00, 9.99, 29.99)
  description: string;             // Plan description
  
  // Metadata
  isActive: boolean;               // Whether this plan is currently available
  sortOrder: number;               // Display order
  createdAt: string;
  updatedAt: string;
}

/**
 * Host Subscription (associated with a specific host)
 */
export interface HostSubscription {
  pk: string;                      // HOST#<hostId>
  sk: string;                      // SUBSCRIPTION
  
  hostId: string;
  planName: SubscriptionPlanName;
  maxListings: number;             // Cached from plan for quick access
  
  // Subscription lifecycle
  status: 'ACTIVE' | 'SUSPENDED' | 'CANCELLED';
  startedAt: string;
  expiresAt: string | null;        // null for plans that never expire
  cancelledAt: string | null;
  
  // Metadata
  createdAt: string;
  updatedAt: string;
  
  // GSI for querying subscriptions by plan
  gsi4pk?: string;                 // SUBSCRIPTION_PLAN#<planName>
  gsi4sk?: string;                 // <startedAt>
}

/**
 * Subscription plan definitions (seeded at deployment)
 */
export const SUBSCRIPTION_PLANS: Omit<SubscriptionPlan, 'pk' | 'sk' | 'createdAt' | 'updatedAt'>[] = [
  {
    planName: 'FREE',
    displayName: 'Free Plan',
    maxListings: 2,
    monthlyPrice: 0.00,
    description: 'Perfect for getting started with up to 2 property listings',
    isActive: true,
    sortOrder: 1,
  },
  {
    planName: 'ONE',
    displayName: 'One Property',
    maxListings: 1,
    monthlyPrice: 0.00, // TODO: Set actual pricing
    description: 'Ideal for single property owners',
    isActive: true,
    sortOrder: 2,
  },
  {
    planName: 'FIVE',
    displayName: 'Five Properties',
    maxListings: 5,
    monthlyPrice: 0.00, // TODO: Set actual pricing
    description: 'Great for growing portfolios',
    isActive: true,
    sortOrder: 3,
  },
  {
    planName: 'TEN',
    displayName: 'Ten Properties',
    maxListings: 10,
    monthlyPrice: 0.00, // TODO: Set actual pricing
    description: 'For established property managers',
    isActive: true,
    sortOrder: 4,
  },
  {
    planName: 'PRO',
    displayName: 'Professional',
    maxListings: 999, // Effectively unlimited
    monthlyPrice: 0.00, // TODO: Set actual pricing
    description: 'Unlimited listings for professional property managers',
    isActive: true,
    sortOrder: 5,
  },
];

/**
 * Default subscription plan for new hosts
 */
export const DEFAULT_SUBSCRIPTION_PLAN: SubscriptionPlanName = 'FREE';

/**
 * Get subscription plan configuration by name
 */
export function getSubscriptionPlanConfig(planName: SubscriptionPlanName): Omit<SubscriptionPlan, 'pk' | 'sk' | 'createdAt' | 'updatedAt'> | undefined {
  return SUBSCRIPTION_PLANS.find(plan => plan.planName === planName);
}

