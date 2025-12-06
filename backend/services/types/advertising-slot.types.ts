/**
 * Advertising Slot Types
 * 
 * Defines the structure for advertising slots stored in the AdvertisingSlots table.
 * A slot is created when a listing goes ONLINE and tracks the ad's duration and renewal status.
 * 
 * Key Design:
 * - Primary key: LISTING#<listingId> / SLOT#<slotId> (one slot per listing at a time)
 * - GSI1 (HostSlotsIndex): HOST#<hostId> / <activatedAt> (get all slots for a host)
 * - GSI2 (ExpiryIndex): SLOT_EXPIRY / <expiresAt>#<listingId>#<slotId> (query expiring slots)
 */

import { BillingPeriod } from './subscription-plan.types';

// ============================================================================
// ADVERTISING SLOT (DynamoDB Record - AdvertisingSlots Table)
// ============================================================================

/**
 * Advertising Slot Record
 * 
 * Created when a listing is published (goes ONLINE).
 * Tracks the ad's duration, expiry, and renewal preferences.
 * Permanently bound to one listing (no swapping).
 */
export interface AdvertisingSlot {
  // Keys
  pk: string;                      // LISTING#<listingId>
  sk: string;                      // SLOT#<slotId>

  // Identifiers
  slotId: string;                  // UUID
  listingId: string;               // Permanently bound to this listing
  hostId: string;                  // Denormalized for GSI1 queries

  // Audit Trail
  planIdAtCreation: string;        // Plan ID when slot was created (for audit)

  // Timing
  activatedAt: string;             // ISO timestamp when slot was created (listing published)
  expiresAt: string;               // ISO timestamp: periodEnd + reviewCompensationDays
  reviewCompensationDays: number;  // Extra days added for admin review time (max 60)

  // Renewal Control
  doNotRenew: boolean;             // If true, slot will not be extended at renewal

  // Grace Period / Payment Status
  isPastDue: boolean;              // True if subscription payment failed (grace period)
  markedForImmediateExpiry: boolean; // True if payment ultimately failed, expire on next job run

  // GSI1: HostSlotsIndex (get all slots for a host)
  gsi1pk: string;                  // HOST#<hostId>
  gsi1sk: string;                  // <activatedAt> (ISO timestamp for sorting)

  // GSI2: ExpiryIndex (query expiring slots for daily job)
  gsi2pk: string;                  // SLOT_EXPIRY (constant)
  gsi2sk: string;                  // <expiresAt>#<listingId>#<slotId> (sortable by expiry)

  // Metadata
  createdAt: string;
  updatedAt: string;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Build the partition key for an advertising slot
 */
export function buildAdvertisingSlotPK(listingId: string): string {
  return `LISTING#${listingId}`;
}

/**
 * Build the sort key for an advertising slot
 */
export function buildAdvertisingSlotSK(slotId: string): string {
  return `SLOT#${slotId}`;
}

/**
 * Build GSI1 partition key (HostSlotsIndex)
 */
export function buildSlotGSI1PK(hostId: string): string {
  return `HOST#${hostId}`;
}

/**
 * Build GSI1 sort key (HostSlotsIndex)
 */
export function buildSlotGSI1SK(activatedAt: string): string {
  return activatedAt;
}

/**
 * Build GSI2 partition key (ExpiryIndex)
 */
export function buildSlotGSI2PK(): string {
  return 'SLOT_EXPIRY';
}

/**
 * Build GSI2 sort key (ExpiryIndex)
 */
export function buildSlotGSI2SK(expiresAt: string, listingId: string, slotId: string): string {
  return `${expiresAt}#${listingId}#${slotId}`;
}

/**
 * Extract listingId from partition key
 */
export function extractListingIdFromSlotPK(pk: string): string {
  return pk.replace('LISTING#', '');
}

/**
 * Extract slotId from sort key
 */
export function extractSlotIdFromSK(sk: string): string {
  return sk.replace('SLOT#', '');
}

/**
 * Add billing period to a date using calendar month logic (like Stripe)
 * 
 * Examples:
 * - Jan 15 + MONTHLY = Feb 15 (not Jan 15 + 30 days)
 * - Jan 31 + MONTHLY = Feb 28/29 (clamped to last day of month)
 * - Dec 15 + QUARTERLY = Mar 15
 * 
 * @param startDate - The starting date
 * @param billingPeriod - The billing period to add
 * @returns New date with billing period added
 */
export function addBillingPeriodToDate(startDate: Date, billingPeriod: BillingPeriod): Date {
  const result = new Date(startDate);
  const originalDay = result.getDate();
  
  switch (billingPeriod) {
    case 'MONTHLY':
      result.setMonth(result.getMonth() + 1);
      break;
    case 'QUARTERLY':
      result.setMonth(result.getMonth() + 3);
      break;
    case 'SEMI_ANNUAL':
      result.setMonth(result.getMonth() + 6);
      break;
    case 'YEARLY':
      result.setFullYear(result.getFullYear() + 1);
      break;
    default:
      result.setMonth(result.getMonth() + 1);
  }
  
  // Handle month overflow (e.g., Jan 31 + 1 month should be Feb 28, not Mar 3)
  // If the day changed, we overflowed - set to last day of previous month
  if (result.getDate() !== originalDay) {
    result.setDate(0); // Sets to last day of previous month
  }
  
  return result;
}

/**
 * Calculate slot expiry date for a NEW slot
 * 
 * New slots get the full billing period from their creation date, ensuring
 * hosts get full value even if they create an ad mid-subscription-cycle.
 * 
 * @param creationDate - When the slot is being created (usually now)
 * @param billingPeriod - The subscription billing period
 * @param reviewCompensationDays - Extra days to add for admin review time
 * @returns ISO timestamp for slot expiry
 */
export function calculateNewSlotExpiry(
  creationDate: string,
  billingPeriod: BillingPeriod,
  reviewCompensationDays: number
): string {
  const startDate = new Date(creationDate);
  
  // Add full billing period using calendar month logic
  const expiryDate = addBillingPeriodToDate(startDate, billingPeriod);
  
  // Add review compensation days
  expiryDate.setDate(expiryDate.getDate() + reviewCompensationDays);
  
  // Set to end of day
  expiryDate.setHours(23, 59, 59, 999);
  
  return expiryDate.toISOString();
}

/**
 * Calculate slot expiry date (for renewals and plan changes)
 * 
 * Used when updating existing slots to a new subscription period end.
 * 
 * @param periodEnd - The subscription period end date
 * @param reviewCompensationDays - Extra days to add for admin review time
 * @returns ISO timestamp for slot expiry
 */
export function calculateSlotExpiry(periodEnd: string, reviewCompensationDays: number): string {
  const date = new Date(periodEnd);
  date.setDate(date.getDate() + reviewCompensationDays);
  // Set to end of day
  date.setHours(23, 59, 59, 999);
  return date.toISOString();
}

/**
 * Calculate review compensation days
 * 
 * Compensates hosts for the time their listing spent in admin review.
 * Capped at 60 days maximum.
 * 
 * @param submittedAt - When listing was submitted for review
 * @param approvedAt - When listing was approved
 * @returns Number of compensation days (0 to 60)
 */
export function calculateReviewCompensationDays(
  submittedAt: string,
  approvedAt: string
): number {
  const submittedDate = new Date(submittedAt);
  const approvedDate = new Date(approvedAt);
  
  // Calculate review duration in days
  const reviewDays = Math.ceil(
    (approvedDate.getTime() - submittedDate.getTime()) / (1000 * 60 * 60 * 24)
  );
  
  // Return the review days, capped at 60
  return Math.min(Math.max(0, reviewDays), 60);
}

// ============================================================================
// API RESPONSE TYPES
// ============================================================================

/**
 * Slot display status for UI
 */
export type SlotDisplayStatus = 
  | 'AUTO_RENEWS'      // Will be extended at next renewal
  | 'EXPIRES'          // Will expire (doNotRenew = true or subscription cancelled)
  | 'PAST_DUE'         // Payment failed, in grace period
  | 'EXPIRING_SOON';   // Expires within 7 days

/**
 * Slot summary for host dashboard
 */
export interface SlotSummary {
  slotId: string;
  listingId: string;
  listingName: string;
  thumbnailUrl: string;
  activatedAt: string;
  expiresAt: string;
  daysRemaining: number;
  reviewCompensationDays: number;
  doNotRenew: boolean;
  isPastDue: boolean;
  displayStatus: SlotDisplayStatus;
  displayLabel: string;
  displayLabel_sr: string;
}

/**
 * Slot details for subscription page
 */
export interface SlotDetails extends SlotSummary {
  planIdAtCreation: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Slots summary for subscription page
 */
export interface SlotsSummary {
  totalSlots: number;       // Count of active slots
  totalTokens: number;      // From subscription plan
  availableTokens: number;  // totalTokens - totalSlots
}

/**
 * Get display status for a slot
 */
export function getSlotDisplayStatus(
  slot: Pick<AdvertisingSlot, 'doNotRenew' | 'isPastDue' | 'expiresAt'>,
  subscriptionCancelAtPeriodEnd: boolean
): SlotDisplayStatus {
  if (slot.isPastDue) {
    return 'PAST_DUE';
  }
  
  // Check if expiring within 7 days
  const now = new Date();
  const expiresAt = new Date(slot.expiresAt);
  const daysUntilExpiry = Math.ceil((expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  
  if (daysUntilExpiry <= 7 && (slot.doNotRenew || subscriptionCancelAtPeriodEnd)) {
    return 'EXPIRING_SOON';
  }
  
  if (slot.doNotRenew || subscriptionCancelAtPeriodEnd) {
    return 'EXPIRES';
  }
  
  return 'AUTO_RENEWS';
}

/**
 * Get display label for a slot
 */
export function getSlotDisplayLabel(
  displayStatus: SlotDisplayStatus,
  expiresAt: string,
  language: 'en' | 'sr' = 'en'
): string {
  const date = new Date(expiresAt);
  const formattedDate = date.toLocaleDateString(language === 'sr' ? 'sr-Latn' : 'en-US', {
    month: 'short',
    day: 'numeric',
  });
  
  switch (displayStatus) {
    case 'AUTO_RENEWS':
      return language === 'sr' 
        ? `Automatski se obnavlja ${formattedDate}`
        : `Auto-renews on ${formattedDate}`;
    case 'EXPIRES':
      return language === 'sr'
        ? `Ističe ${formattedDate}`
        : `Expires on ${formattedDate}`;
    case 'EXPIRING_SOON':
      return language === 'sr'
        ? `Ističe uskoro - ${formattedDate}`
        : `Expiring soon - ${formattedDate}`;
    case 'PAST_DUE':
      return language === 'sr'
        ? 'Plaćanje na čekanju'
        : 'Payment pending';
    default:
      return '';
  }
}

/**
 * Calculate days remaining until slot expires
 */
export function calculateDaysRemaining(expiresAt: string): number {
  const now = new Date();
  const expiry = new Date(expiresAt);
  const diffMs = expiry.getTime() - now.getTime();
  return Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
}

