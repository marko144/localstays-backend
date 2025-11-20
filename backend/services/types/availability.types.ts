/**
 * Availability Types
 * 
 * Defines types for listing availability tracking.
 * This is a negative availability model - we store records for dates when a listing is NOT available.
 * Each record represents one unavailable night.
 */

// ============================================================================
// ENUMS
// ============================================================================

/**
 * Type of unavailability
 * - BOOKING: Night is booked by a guest (revenue-generating)
 * - BLOCK: Night is blocked with no guest (maintenance, host closed, etc.)
 */
export type AvailabilityKind = 'BOOKING' | 'BLOCK';

/**
 * Source of the availability event
 * - HOST_CLOSED: Host manually blocked dates (no guest)
 * - LOCALSTAYS: Booking made via Localstays platform
 * - BOOKING_COM: Booking synced from Booking.com
 * - AIRBNB: Booking synced from Airbnb
 * - OTHER: Any other external channel
 */
export type AvailabilityEventSource = 
  | 'HOST_CLOSED'
  | 'LOCALSTAYS'
  | 'BOOKING_COM'
  | 'AIRBNB'
  | 'OTHER';

// ============================================================================
// AVAILABILITY RECORD (DynamoDB)
// ============================================================================

/**
 * Represents one unavailable night for a listing
 * 
 * PK: LISTING_AVAILABILITY#<listingId>
 * SK: DATE#<YYYY-MM-DD>
 * 
 * For multi-night bookings/blocks, create one record per night.
 * 
 * Example: 3-night booking (Jan 10 check-in, Jan 13 check-out)
 * Creates records for: Jan 10, Jan 11, Jan 12 (checkout date excluded)
 */
export interface AvailabilityRecord {
  // DynamoDB Keys
  pk: string;  // LISTING_AVAILABILITY#<listingId>
  sk: string;  // DATE#<YYYY-MM-DD>
  
  // Core Fields
  listingId: string;
  hostId: string;
  date: string;  // YYYY-MM-DD format
  
  // Event Classification
  kind: AvailabilityKind;  // BOOKING or BLOCK
  eventSource: AvailabilityEventSource;
  
  /**
   * Event ID - groups all nights of a single booking or block
   * - For bookings: "BOOKING#<bookingId>"
   * - For blocks: "BLOCK#<uuid>"
   * 
   * Use this to delete/query all nights of a booking or block.
   */
  eventId: string;
  
  // Booking Details (for kind = BOOKING)
  /**
   * Internal booking ID
   * - Always present for kind = BOOKING (even for external bookings)
   * - null for kind = BLOCK
   */
  bookingId: string | null;
  
  /**
   * External reservation ID from channel (e.g., Booking.com, Airbnb)
   * - Present for external bookings (BOOKING_COM, AIRBNB, OTHER)
   * - null for LOCALSTAYS bookings
   * - null for kind = BLOCK
   */
  externalReservationId: string | null;
  
  // Audit
  createdAt: string;  // ISO timestamp
  
  // GSI1: Query all availability for a host across all their listings
  gsi1pk?: string;  // HOST_AVAILABILITY#<hostId>
  gsi1sk?: string;  // DATE#<YYYY-MM-DD>#LISTING#<listingId>
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Generate PK for availability records
 */
export function buildAvailabilityPK(listingId: string): string {
  return `LISTING_AVAILABILITY#${listingId}`;
}

/**
 * Generate SK for a specific date
 */
export function buildAvailabilitySK(date: string): string {
  return `DATE#${date}`;
}

/**
 * Generate eventId for a booking
 */
export function buildBookingEventId(bookingId: string): string {
  return `BOOKING#${bookingId}`;
}

/**
 * Generate eventId for a block (host closed, maintenance, etc.)
 */
export function buildBlockEventId(blockId: string): string {
  return `BLOCK#${blockId}`;
}

/**
 * Generate GSI1PK for querying all availability by host
 */
export function buildHostAvailabilityGSI1PK(hostId: string): string {
  return `HOST_AVAILABILITY#${hostId}`;
}

/**
 * Generate GSI1SK for sorting by date and listing
 * Format: DATE#<YYYY-MM-DD>#LISTING#<listingId>
 * This allows sorting by date first, then by listing
 */
export function buildHostAvailabilityGSI1SK(date: string, listingId: string): string {
  return `DATE#${date}#LISTING#${listingId}`;
}

/**
 * Extract listingId from PK
 */
export function extractListingIdFromPK(pk: string): string {
  return pk.replace('LISTING_AVAILABILITY#', '');
}

/**
 * Extract date from SK
 */
export function extractDateFromSK(sk: string): string {
  return sk.replace('DATE#', '');
}

/**
 * Generate array of date strings between check-in and check-out (exclusive of checkout)
 * 
 * Example: checkIn = "2025-01-10", checkOut = "2025-01-13"
 * Returns: ["2025-01-10", "2025-01-11", "2025-01-12"]
 * 
 * @param checkIn - Check-in date (YYYY-MM-DD)
 * @param checkOut - Check-out date (YYYY-MM-DD)
 * @returns Array of date strings for unavailable nights
 */
export function generateNightsBetween(checkIn: string, checkOut: string): string[] {
  const nights: string[] = [];
  const start = new Date(checkIn);
  const end = new Date(checkOut);
  
  // Validate dates
  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    throw new Error(`Invalid date format. Expected YYYY-MM-DD. Got checkIn: ${checkIn}, checkOut: ${checkOut}`);
  }
  
  if (start >= end) {
    throw new Error(`Check-in date must be before check-out date. Got checkIn: ${checkIn}, checkOut: ${checkOut}`);
  }
  
  const current = new Date(start);
  
  // Generate dates from check-in up to (but not including) check-out
  while (current < end) {
    nights.push(current.toISOString().split('T')[0]); // YYYY-MM-DD
    current.setDate(current.getDate() + 1);
  }
  
  return nights;
}

/**
 * Generate array of date strings between start and end date (INCLUSIVE of both)
 * Used for HOST BLOCKS where all selected dates should be unavailable.
 * 
 * Example: startDate = "2026-01-27", endDate = "2026-01-29"
 * Returns: ["2026-01-27", "2026-01-28", "2026-01-29"]
 * 
 * @param startDate - Start date (YYYY-MM-DD)
 * @param endDate - End date (YYYY-MM-DD)
 * @returns Array of date strings for blocked dates
 */
export function generateDatesInclusive(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  const start = new Date(startDate);
  const end = new Date(endDate);
  
  // Validate dates
  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    throw new Error(`Invalid date format. Expected YYYY-MM-DD. Got startDate: ${startDate}, endDate: ${endDate}`);
  }
  
  if (start > end) {
    throw new Error(`Start date must be before or equal to end date. Got startDate: ${startDate}, endDate: ${endDate}`);
  }
  
  const current = new Date(start);
  
  // Generate dates from startDate to endDate (inclusive)
  while (current <= end) {
    dates.push(current.toISOString().split('T')[0]); // YYYY-MM-DD
    current.setDate(current.getDate() + 1);
  }
  
  return dates;
}

/**
 * Validate date format (YYYY-MM-DD)
 */
export function isValidDateFormat(date: string): boolean {
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(date)) {
    return false;
  }
  
  const parsed = new Date(date);
  return !isNaN(parsed.getTime());
}

