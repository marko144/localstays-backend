/**
 * Type definitions for PublicListings table
 * 
 * This table stores read-optimized, denormalized listing data for public search/browse.
 * Populated when a host publishes an APPROVED listing.
 * 
 * Note: parkingType and checkInType store enum keys (e.g., "FREE", "SELF_CHECKIN")
 * which are language-agnostic. Frontend translates these keys to labels based on user's language.
 */

/**
 * Public listing record in DynamoDB
 * PK: LOCATION#<locationId>
 * SK: LISTING#<listingId>
 */
export interface PublicListingRecord {
  // Keys
  pk: string; // LOCATION#<locationId>
  sk: string; // LISTING#<listingId>

  // IDs
  listingId: string;
  hostId: string; // Host who owns this listing (needed for pricing lookup)
  locationId: string; // Mapbox place ID

  // Display information
  name: string;
  shortDescription: string; // First 100 chars of description
  placeName: string; // From Locations table
  regionName: string; // From Locations table

  // Capacity
  maxGuests: number;
  bedrooms: number;
  beds: number;
  bathrooms: number;

  // Thumbnail
  thumbnailUrl: string; // CloudFront URL of primary image thumbnail

  // Coordinates
  latitude: number;
  longitude: number;

  // Boolean filters (derived from amenities)
  petsAllowed: boolean;
  hasWIFI: boolean;
  hasAirConditioning: boolean;
  hasParking: boolean;
  hasGym: boolean;
  hasPool: boolean;
  hasWorkspace: boolean;

  // Categorical filters (stored as enum keys, e.g., "FREE", "SELF_CHECKIN")
  parkingType: string; // From listing.parking.type
  checkInType: string; // From listing.checkIn.type

  // Booking behaviour
  instantBook: boolean;

  // Timestamps
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
}

/**
 * Helper function to build PK for public listing
 */
export function buildPublicListingPK(locationId: string): string {
  return `LOCATION#${locationId}`;
}

/**
 * Helper function to build SK for public listing
 */
export function buildPublicListingSK(listingId: string): string {
  return `LISTING#${listingId}`;
}

/**
 * Helper function to extract locationId from PK
 */
export function extractLocationIdFromPK(pk: string): string {
  return pk.replace('LOCATION#', '');
}

/**
 * Helper function to extract listingId from SK
 */
export function extractListingIdFromSK(sk: string): string {
  return sk.replace('LISTING#', '');
}

/**
 * Response format for public listing (for API responses)
 */
export interface PublicListingResponse {
  listingId: string;
  hostId: string;
  locationId: string;
  name: string;
  shortDescription: string;
  placeName: string;
  regionName: string;
  capacity: {
    maxGuests: number;
    bedrooms: number;
    beds: number;
    bathrooms: number;
  };
  thumbnailUrl: string;
  coordinates: {
    latitude: number;
    longitude: number;
  };
  filters: {
    petsAllowed: boolean;
    hasWIFI: boolean;
    hasAirConditioning: boolean;
    hasParking: boolean;
    hasGym: boolean;
    hasPool: boolean;
    hasWorkspace: boolean;
  };
  parkingType: string;
  checkInType: string;
  instantBook: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * Convert DynamoDB record to API response format
 */
export function toPublicListingResponse(record: PublicListingRecord): PublicListingResponse {
  return {
    listingId: record.listingId,
    hostId: record.hostId,
    locationId: record.locationId,
    name: record.name,
    shortDescription: record.shortDescription,
    placeName: record.placeName,
    regionName: record.regionName,
    capacity: {
      maxGuests: record.maxGuests,
      bedrooms: record.bedrooms,
      beds: record.beds,
      bathrooms: record.bathrooms,
    },
    thumbnailUrl: record.thumbnailUrl,
    coordinates: {
      latitude: record.latitude,
      longitude: record.longitude,
    },
    filters: {
      petsAllowed: record.petsAllowed,
      hasWIFI: record.hasWIFI,
      hasAirConditioning: record.hasAirConditioning,
      hasParking: record.hasParking,
      hasGym: record.hasGym,
      hasPool: record.hasPool,
      hasWorkspace: record.hasWorkspace,
    },
    parkingType: record.parkingType,
    checkInType: record.checkInType,
    instantBook: record.instantBook,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

