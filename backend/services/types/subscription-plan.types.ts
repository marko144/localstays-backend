/**
 * Subscription Plan Types
 * 
 * Defines the structure for subscription plans stored in the SubscriptionPlans table.
 * Plans are synced from Stripe and use Stripe IDs as primary keys for easy lookup.
 * 
 * Key patterns:
 * - Product record: pk = STRIPE_PRODUCT#<stripeProductId>, sk = PRODUCT
 * - Price record:   pk = STRIPE_PRICE#<stripePriceId>, sk = PRICE
 * 
 * This allows direct lookup by either Stripe product ID or price ID.
 */

// ============================================================================
// ENUMS
// ============================================================================

/**
 * Billing period options for subscription pricing
 */
export type BillingPeriod = 'MONTHLY' | 'QUARTERLY' | 'SEMI_ANNUAL' | 'YEARLY';

/**
 * Get the number of days for a billing period
 */
export function getBillingPeriodDays(period: BillingPeriod): number {
  switch (period) {
    case 'MONTHLY':
      return 30;
    case 'QUARTERLY':
      return 90;
    case 'SEMI_ANNUAL':
      return 180;
    case 'YEARLY':
      return 365;
    default:
      return 30;
  }
}

/**
 * Map Stripe interval to our billing period
 */
export function stripeToBillingPeriod(interval: string, intervalCount: number): BillingPeriod {
  if (interval === 'month' && intervalCount === 1) return 'MONTHLY';
  if (interval === 'month' && intervalCount === 3) return 'QUARTERLY';
  if (interval === 'month' && intervalCount === 6) return 'SEMI_ANNUAL';
  if (interval === 'year' && intervalCount === 1) return 'YEARLY';
  return 'MONTHLY'; // Default fallback
}

// ============================================================================
// STRIPE PRODUCT RECORD (DynamoDB - SubscriptionPlans Table)
// ============================================================================

/**
 * Stripe Product Record
 * 
 * Synced from Stripe. Contains product info and metadata.
 * Key pattern: pk = STRIPE_PRODUCT#<stripeProductId>, sk = PRODUCT
 */
export interface StripeProductRecord {
  // Keys
  pk: string;                      // STRIPE_PRODUCT#<stripeProductId>
  sk: string;                      // PRODUCT

  // Stripe IDs
  stripeProductId: string;         // prod_xxx

  // Display (from Stripe)
  name: string;                    // Product name from Stripe
  description: string | null;      // Product description from Stripe

  // Metadata (from Stripe product.metadata)
  adSlots: number;                 // Number of ad slots/tokens (from metadata.adSlots)
  displayName_sr: string | null;   // Serbian name (from metadata.displayName_sr)
  description_sr: string | null;   // Serbian description (from metadata.description_sr)
  features: string[];              // Features list (from metadata.features as JSON)
  features_sr: string[];           // Serbian features (from metadata.features_sr as JSON)
  sortOrder: number;               // Display order (from metadata.sortOrder)

  // Status
  isActive: boolean;               // From Stripe product.active

  // Metadata
  createdAt: string;
  updatedAt: string;
  syncedAt: string;                // When last synced from Stripe
}

// ============================================================================
// STRIPE PRICE RECORD (DynamoDB - SubscriptionPlans Table)
// ============================================================================

/**
 * Stripe Price Record
 * 
 * Synced from Stripe. Contains price info linked to a product.
 * Key pattern: pk = STRIPE_PRICE#<stripePriceId>, sk = PRICE
 * 
 * GSI: gsi1pk = STRIPE_PRODUCT#<stripeProductId>, gsi1sk = PRICE#<billingPeriod>
 * This allows querying all prices for a product.
 */
export interface StripePriceRecord {
  // Keys
  pk: string;                      // STRIPE_PRICE#<stripePriceId>
  sk: string;                      // PRICE

  // Stripe IDs
  stripePriceId: string;           // price_xxx
  stripeProductId: string;         // prod_xxx (parent product)

  // Pricing
  amount: number;                  // In cents (e.g., 1299 = €12.99)
  currency: string;                // "eur"
  billingPeriod: BillingPeriod;    // MONTHLY, QUARTERLY, etc.
  interval: string;                // "month" or "year"
  intervalCount: number;           // 1, 3, 6, 12

  // Status
  isActive: boolean;               // From Stripe price.active

  // GSI1: Query prices by product
  gsi1pk: string;                  // STRIPE_PRODUCT#<stripeProductId>
  gsi1sk: string;                  // PRICE#<billingPeriod>

  // Metadata
  createdAt: string;
  updatedAt: string;
  syncedAt: string;                // When last synced from Stripe
}

// ============================================================================
// LEGACY SUBSCRIPTION PLAN (for backward compatibility)
// ============================================================================

/**
 * Price option for a subscription plan (legacy format)
 * @deprecated Use StripePriceRecord instead
 */
export interface SubscriptionPlanPrice {
  priceId: string;           // Internal ID: "basic_monthly", "basic_quarterly"
  stripePriceId: string;     // Stripe price ID: "price_xxx"
  billingPeriod: BillingPeriod;
  priceAmount: number;       // In cents (e.g., 1299 = €12.99)
  currency: string;          // "EUR"
}

/**
 * Subscription Plan Configuration (legacy format)
 * @deprecated Use StripeProductRecord instead
 * 
 * Stored in the SubscriptionPlans table.
 * Key pattern: pk = PLAN#<planId>, sk = CONFIG
 */
export interface SubscriptionPlan {
  // Keys
  pk: string;                      // PLAN#<planId>
  sk: string;                      // CONFIG

  // Identifiers
  planId: string;                  // e.g., "basic", "pro", "agency"
  stripeProductId: string;         // Stripe product ID

  // Display
  displayName: string;             // "Basic Plan"
  displayName_sr: string;          // "Osnovni Plan"
  description: string;
  description_sr: string;

  // Token Allowance (same for all billing periods of this plan)
  adSlots: number;                 // Max concurrent ads (tokens)

  // Pricing Options (multiple prices per plan for different billing periods)
  prices: SubscriptionPlanPrice[];

  // Trial Configuration (optional, configured in Stripe)
  hasTrialPeriod: boolean;
  trialDays: number | null;        // e.g., 14, 30

  // Features (for display on pricing page)
  features: string[];
  features_sr: string[];

  // Status
  isActive: boolean;               // Whether this plan is currently available for purchase
  sortOrder: number;               // Display order on pricing page

  // Metadata
  createdAt: string;
  updatedAt: string;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Build the partition key for a Stripe product record
 */
export function buildStripeProductPK(stripeProductId: string): string {
  return `STRIPE_PRODUCT#${stripeProductId}`;
}

/**
 * Build the partition key for a Stripe price record
 */
export function buildStripePricePK(stripePriceId: string): string {
  return `STRIPE_PRICE#${stripePriceId}`;
}

/**
 * Build GSI1 keys for price records (to query prices by product)
 */
export function buildPriceGSI1Keys(stripeProductId: string, billingPeriod: BillingPeriod): { gsi1pk: string; gsi1sk: string } {
  return {
    gsi1pk: `STRIPE_PRODUCT#${stripeProductId}`,
    gsi1sk: `PRICE#${billingPeriod}`,
  };
}

/**
 * Extract Stripe product ID from partition key
 */
export function extractStripeProductIdFromPK(pk: string): string {
  return pk.replace('STRIPE_PRODUCT#', '');
}

/**
 * Extract Stripe price ID from partition key
 */
export function extractStripePriceIdFromPK(pk: string): string {
  return pk.replace('STRIPE_PRICE#', '');
}

// Legacy helper functions (for backward compatibility)

/**
 * Build the partition key for a subscription plan
 * @deprecated Use buildStripeProductPK instead
 */
export function buildSubscriptionPlanPK(planId: string): string {
  return `PLAN#${planId}`;
}

/**
 * Build the sort key for a subscription plan
 * @deprecated Use 'PRODUCT' or 'PRICE' instead
 */
export function buildSubscriptionPlanSK(): string {
  return 'CONFIG';
}

/**
 * Extract planId from a partition key
 * @deprecated Use extractStripeProductIdFromPK instead
 */
export function extractPlanIdFromPK(pk: string): string {
  return pk.replace('PLAN#', '');
}

// ============================================================================
// API RESPONSE TYPES
// ============================================================================

/**
 * Public subscription plan response (for pricing page)
 */
export interface PublicSubscriptionPlan {
  planId: string;
  displayName: string;
  displayName_sr: string;
  description: string;
  description_sr: string;
  adSlots: number;
  hasTrialPeriod: boolean;
  trialDays: number | null;
  prices: Array<{
    priceId: string;
    billingPeriod: BillingPeriod;
    priceAmount: number;
    currency: string;
  }>;
  features: string[];
  features_sr: string[];
  sortOrder: number;
}

/**
 * Admin subscription plan response (includes Stripe IDs and status)
 */
export interface AdminSubscriptionPlan extends PublicSubscriptionPlan {
  stripeProductId: string;
  prices: SubscriptionPlanPrice[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

// ============================================================================
// SEED DATA
// ============================================================================

/**
 * Default subscription plans to seed
 * Note: Stripe IDs will need to be updated after creating products in Stripe
 */
export const DEFAULT_SUBSCRIPTION_PLANS: Omit<SubscriptionPlan, 'pk' | 'sk' | 'createdAt' | 'updatedAt'>[] = [
  {
    planId: 'basic',
    stripeProductId: 'prod_PLACEHOLDER_basic',
    displayName: 'Basic',
    displayName_sr: 'Osnovni',
    description: 'Perfect for single property owners',
    description_sr: 'Savršeno za vlasnike jednog objekta',
    adSlots: 1,
    prices: [
      {
        priceId: 'basic_monthly',
        stripePriceId: 'price_PLACEHOLDER_basic_monthly',
        billingPeriod: 'MONTHLY',
        priceAmount: 1299,
        currency: 'EUR',
      },
      {
        priceId: 'basic_quarterly',
        stripePriceId: 'price_PLACEHOLDER_basic_quarterly',
        billingPeriod: 'QUARTERLY',
        priceAmount: 3499,
        currency: 'EUR',
      },
      {
        priceId: 'basic_semi_annual',
        stripePriceId: 'price_PLACEHOLDER_basic_semi_annual',
        billingPeriod: 'SEMI_ANNUAL',
        priceAmount: 6499,
        currency: 'EUR',
      },
    ],
    hasTrialPeriod: true,
    trialDays: 14,
    features: [
      '1 active listing',
      'Email support',
      'Basic analytics',
    ],
    features_sr: [
      '1 aktivan oglas',
      'Email podrška',
      'Osnovna analitika',
    ],
    isActive: true,
    sortOrder: 1,
  },
  {
    planId: 'standard',
    stripeProductId: 'prod_PLACEHOLDER_standard',
    displayName: 'Standard',
    displayName_sr: 'Standardni',
    description: 'Great for growing portfolios',
    description_sr: 'Odlično za rastuće portfolije',
    adSlots: 3,
    prices: [
      {
        priceId: 'standard_monthly',
        stripePriceId: 'price_PLACEHOLDER_standard_monthly',
        billingPeriod: 'MONTHLY',
        priceAmount: 1799,
        currency: 'EUR',
      },
      {
        priceId: 'standard_quarterly',
        stripePriceId: 'price_PLACEHOLDER_standard_quarterly',
        billingPeriod: 'QUARTERLY',
        priceAmount: 4799,
        currency: 'EUR',
      },
      {
        priceId: 'standard_semi_annual',
        stripePriceId: 'price_PLACEHOLDER_standard_semi_annual',
        billingPeriod: 'SEMI_ANNUAL',
        priceAmount: 8999,
        currency: 'EUR',
      },
    ],
    hasTrialPeriod: true,
    trialDays: 14,
    features: [
      '3 active listings',
      'Priority email support',
      'Advanced analytics',
      'Booking calendar sync',
    ],
    features_sr: [
      '3 aktivna oglasa',
      'Prioritetna email podrška',
      'Napredna analitika',
      'Sinhronizacija kalendara rezervacija',
    ],
    isActive: true,
    sortOrder: 2,
  },
  {
    planId: 'pro',
    stripeProductId: 'prod_PLACEHOLDER_pro',
    displayName: 'Professional',
    displayName_sr: 'Profesionalni',
    description: 'For established property managers',
    description_sr: 'Za iskusne upravnike nekretnina',
    adSlots: 10,
    prices: [
      {
        priceId: 'pro_monthly',
        stripePriceId: 'price_PLACEHOLDER_pro_monthly',
        billingPeriod: 'MONTHLY',
        priceAmount: 3499,
        currency: 'EUR',
      },
      {
        priceId: 'pro_quarterly',
        stripePriceId: 'price_PLACEHOLDER_pro_quarterly',
        billingPeriod: 'QUARTERLY',
        priceAmount: 9499,
        currency: 'EUR',
      },
      {
        priceId: 'pro_semi_annual',
        stripePriceId: 'price_PLACEHOLDER_pro_semi_annual',
        billingPeriod: 'SEMI_ANNUAL',
        priceAmount: 17999,
        currency: 'EUR',
      },
    ],
    hasTrialPeriod: true,
    trialDays: 14,
    features: [
      '10 active listings',
      'Priority support',
      'Advanced analytics',
      'Booking calendar sync',
      'Multi-user access',
    ],
    features_sr: [
      '10 aktivnih oglasa',
      'Prioritetna podrška',
      'Napredna analitika',
      'Sinhronizacija kalendara rezervacija',
      'Višekorisnički pristup',
    ],
    isActive: true,
    sortOrder: 3,
  },
  {
    planId: 'agency',
    stripeProductId: 'prod_PLACEHOLDER_agency',
    displayName: 'Agency',
    displayName_sr: 'Agencija',
    description: 'Unlimited listings for professional agencies',
    description_sr: 'Neograničeni oglasi za profesionalne agencije',
    adSlots: 50,
    prices: [
      {
        priceId: 'agency_monthly',
        stripePriceId: 'price_PLACEHOLDER_agency_monthly',
        billingPeriod: 'MONTHLY',
        priceAmount: 8999,
        currency: 'EUR',
      },
      {
        priceId: 'agency_quarterly',
        stripePriceId: 'price_PLACEHOLDER_agency_quarterly',
        billingPeriod: 'QUARTERLY',
        priceAmount: 24999,
        currency: 'EUR',
      },
      {
        priceId: 'agency_semi_annual',
        stripePriceId: 'price_PLACEHOLDER_agency_semi_annual',
        billingPeriod: 'SEMI_ANNUAL',
        priceAmount: 47999,
        currency: 'EUR',
      },
    ],
    hasTrialPeriod: false,
    trialDays: null,
    features: [
      '50 active listings',
      'Dedicated account manager',
      'Advanced analytics & reporting',
      'API access',
      'Multi-user access',
      'Custom branding',
    ],
    features_sr: [
      '50 aktivnih oglasa',
      'Posvećeni menadžer naloga',
      'Napredna analitika i izveštavanje',
      'API pristup',
      'Višekorisnički pristup',
      'Prilagođeni brending',
    ],
    isActive: true,
    sortOrder: 4,
  },
];

