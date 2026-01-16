/**
 * Advertising Slot Types
 * 
 * Defines the structure for advertising slots stored in the AdvertisingSlots table.
 * A slot is created when a listing goes ONLINE and tracks the ad's duration and renewal status.
 * 
 * Key Design:
 * - Primary key: HOST#<hostId> / SLOT#<slotId> (slots belong to hosts, can be reused)
 * - GSI1 (HostSlotsIndex): HOST#<hostId> / <activatedAt> (get all slots for a host - same as PK)
 * - GSI2 (ExpiryIndex): SLOT_EXPIRY / <expiresAt>#<hostId>#<slotId> (query expiring slots)
 *   Note: Commission-based slots are excluded from GSI2 (sparse index) as they don't expire
 * 
 * Ad Models:
 * - Subscription-based (isCommissionBased: false): Has expiry, renews with subscription, uses tokens
 * - Commission-based (isCommissionBased: true): No expiry, no renewal, monetized via booking commission
 * 
 * Slot Reusability (token-based only):
 * - When a token-based listing is deleted, the slot becomes "empty" (listingId = null)
 * - Empty slots can be reused when publishing a new listing
 * - Empty slots are deleted at subscription renewal
 * - Commission-based slots are always deleted with their listing (not reusable)
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
 * 
 * Two ad models:
 * - Subscription-based: Has expiry, renews with subscription, consumes tokens, reusable
 * - Commission-based: No expiry, no renewal, monetized via booking commission, not reusable
 * 
 * Slot Lifecycle (token-based):
 * - Created: listingId is set to the published listing
 * - Listing deleted: listingId set to null (slot becomes "empty" and reusable)
 * - Reused: listingId set to a new listing
 * - Renewal: empty slots are deleted, active slots are extended
 */
export interface AdvertisingSlot {
  // Keys
  pk: string;                      // HOST#<hostId>
  sk: string;                      // SLOT#<slotId>

  // Identifiers
  slotId: string;                  // UUID
  listingId: string | null;        // null = empty slot (reusable). Set when listing attached.
  hostId: string;                  // Host who owns this slot

  // Ad Model
  isCommissionBased: boolean;      // true = free ad (commission model), false = subscription-based

  // Audit Trail
  planIdAtCreation?: string;       // Plan ID when slot was created (for audit). Undefined for commission-based.

  // Timing (subscription-based only)
  activatedAt: string;             // ISO timestamp when slot was created (listing published)
  expiresAt?: string;              // ISO timestamp: periodEnd + reviewCompensationDays. Undefined for commission-based.
  reviewCompensationDays?: number; // Extra days added for admin review time (max 60). Undefined for commission-based.

  // Renewal Control (subscription-based only)
  doNotRenew?: boolean;            // If true, slot will not be extended at renewal. Ignored for commission-based.

  // Grace Period / Payment Status (subscription-based only)
  isPastDue?: boolean;             // True if subscription payment failed (grace period). Ignored for commission-based.
  markedForImmediateExpiry?: boolean; // True if payment ultimately failed. Ignored for commission-based.

  // GSI1: HostSlotsIndex (get all slots for a host) - ALL slots indexed
  gsi1pk: string;                  // HOST#<hostId>
  gsi1sk: string;                  // <activatedAt> (ISO timestamp for sorting)

  // GSI2: ExpiryIndex (query expiring slots for daily job) - Subscription-based only
  // Commission-based slots have these undefined (sparse index - not projected)
  gsi2pk?: string;                 // SLOT_EXPIRY (constant). Undefined for commission-based.
  gsi2sk?: string;                 // <expiresAt>#<listingId>#<slotId>. Undefined for commission-based.

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
export function buildAdvertisingSlotPK(hostId: string): string {
  return `HOST#${hostId}`;
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
 * Note: Uses hostId instead of listingId since slots now belong to hosts
 */
export function buildSlotGSI2SK(expiresAt: string, hostId: string, slotId: string): string {
  return `${expiresAt}#${hostId}#${slotId}`;
}

/**
 * Extract hostId from partition key
 */
export function extractHostIdFromSlotPK(pk: string): string {
  return pk.replace('HOST#', '');
}

/**
 * Check if a slot is empty (no listing attached)
 * Only token-based slots can be empty; commission-based slots are always deleted with their listing
 */
export function isEmptySlot(slot: AdvertisingSlot): boolean {
  return !slot.isCommissionBased && (slot.listingId === null || slot.listingId === undefined);
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
  | 'EXPIRING_SOON'    // Expires within 7 days
  | 'COMMISSION_BASED' // Commission-based (no expiry)
  | 'EMPTY';           // Token-based slot with no listing attached (reusable)

/**
 * Slot summary for host dashboard
 */
export interface SlotSummary {
  slotId: string;
  listingId: string | null;        // null for empty slots
  listingName: string | null;      // null for empty slots
  thumbnailUrl: string | null;     // null for empty slots
  activatedAt: string;
  isCommissionBased: boolean;
  isEmpty: boolean;                // true if slot has no listing attached
  // The following are undefined for commission-based slots
  expiresAt?: string;
  daysRemaining?: number;
  reviewCompensationDays?: number;
  doNotRenew?: boolean;
  isPastDue?: boolean;
  displayStatus: SlotDisplayStatus;
  displayLabel: string;
  displayLabel_sr: string;
}

/**
 * Slot details for subscription page
 */
export interface SlotDetails extends SlotSummary {
  planIdAtCreation?: string;  // Undefined for commission-based slots
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
  slot: Pick<AdvertisingSlot, 'isCommissionBased' | 'doNotRenew' | 'isPastDue' | 'expiresAt' | 'listingId'>,
  subscriptionCancelAtPeriodEnd: boolean
): SlotDisplayStatus {
  // Commission-based slots have a special status
  if (slot.isCommissionBased) {
    return 'COMMISSION_BASED';
  }
  
  // Empty token-based slots (no listing attached)
  if (!slot.listingId) {
    return 'EMPTY';
  }
  
  if (slot.isPastDue) {
    return 'PAST_DUE';
  }
  
  // Check if expiring within 7 days (only for subscription-based slots)
  if (slot.expiresAt) {
    const now = new Date();
    const expiresAt = new Date(slot.expiresAt);
    const daysUntilExpiry = Math.ceil((expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    
    if (daysUntilExpiry <= 7 && (slot.doNotRenew || subscriptionCancelAtPeriodEnd)) {
      return 'EXPIRING_SOON';
    }
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
  expiresAt: string | undefined,
  language: 'en' | 'sr' = 'en'
): string {
  // Handle commission-based slots first (no expiry date)
  if (displayStatus === 'COMMISSION_BASED') {
    return language === 'sr'
      ? 'Besplatan oglas (provizija)'
      : 'Free ad (commission-based)';
  }
  
  // Handle empty slots
  if (displayStatus === 'EMPTY') {
    if (!expiresAt) {
      return language === 'sr'
        ? 'Prazan slot - dostupan za korišćenje'
        : 'Empty slot - available for use';
    }
    const date = new Date(expiresAt);
    const formattedDate = date.toLocaleDateString(language === 'sr' ? 'sr-Latn' : 'en-US', {
      month: 'short',
      day: 'numeric',
    });
    return language === 'sr'
      ? `Prazan slot - ističe ${formattedDate}`
      : `Empty slot - expires ${formattedDate}`;
  }
  
  // For status that require expiry date
  if (!expiresAt) {
    return '';
  }
  
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
 * Returns undefined for commission-based slots (no expiry)
 */
export function calculateDaysRemaining(expiresAt: string | undefined): number | undefined {
  if (!expiresAt) {
    return undefined;
  }
  const now = new Date();
  const expiry = new Date(expiresAt);
  const diffMs = expiry.getTime() - now.getTime();
  return Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
}

