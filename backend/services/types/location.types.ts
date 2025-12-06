/**
 * Location Types
 * 
 * Types for the Locations table, which tracks unique places/locations
 * and their association with listings.
 */

/**
 * Location record in DynamoDB
 * 
 * Access patterns:
 * - By locationId: pk=LOCATION#<mapboxPlaceId>, sk=NAME#<name>
 * - By slug: GSI (SlugIndex) slug=<slug>
 * 
 * Note: Multiple name variants can exist for the same location (e.g., "Belgrade" and "Beograd")
 * All variants share the same locationId (Mapbox Place ID) and listingsCount
 * 
 * Hierarchy: COUNTRY > PLACE > LOCALITY
 * - COUNTRY: Top level, no parent
 * - PLACE: Links to COUNTRY via mapboxCountryId
 * - LOCALITY: Links to PLACE via mapboxPlaceId
 */
export interface LocationRecord {
  // Primary key
  pk: string;                    // "LOCATION#<mapboxId>" (country, place, or locality)
  sk: string;                    // "NAME#<name>" (e.g., "NAME#Belgrade" or "NAME#Beograd")
  
  // Core fields
  locationId: string;            // Canonical ID (mapboxCountryId, mapboxPlaceId, or mapboxLocalityId)
  locationType: 'COUNTRY' | 'PLACE' | 'LOCALITY';  // Location type in hierarchy
  name: string;                  // Location name (e.g., "Serbia", "Zlatibor", "Čajetina")
  displayName: string;           // Display name for autocomplete (e.g., "Zlatibor" or "Čajetina, Zlatibor")
  regionName?: string;           // Region name (e.g., "Zlatibor District") - not for COUNTRY
  countryName: string;           // Country name (e.g., "Serbia")
  countryCode?: string;          // ISO country code (e.g., "RS") - for COUNTRY type
  
  // Parent references (hierarchy)
  parentPlaceName?: string;      // Parent place name - only for LOCALITY type
  mapboxCountryId?: string;      // Parent country ID - for PLACE type
  
  // Mapbox IDs
  mapboxPlaceId?: string;        // Mapbox place ID - for PLACE type, or parent place for LOCALITY
  mapboxRegionId?: string;       // Mapbox region ID - not for COUNTRY
  mapboxLocalityId?: string;     // Mapbox locality ID - only for LOCALITY type
  
  // Search & routing
  slug: string;                  // URL-safe slug (e.g., "serbia", "zlatibor-rs", "cajetina-rs")
  searchName: string;            // Normalized search text (e.g., "zlatibor zlatibor district")
  entityType: string;            // Always "LOCATION" - used as GSI partition key for search
  
  // Metrics
  listingsCount: number;         // Number of active listings in this location (shared across all name variants)
  
  // Timestamps
  createdAt: string;             // ISO timestamp
  updatedAt: string;             // ISO timestamp
}

/**
 * Request to create or update a location
 */
export interface CreateLocationRequest {
  mapboxPlaceId: string;
  name: string;
  regionName: string;
  countryName: string;
  mapboxRegionId: string;
}

/**
 * Response when fetching a location
 */
export interface GetLocationResponse {
  locationId: string;
  name: string;
  regionName: string;
  countryName: string;
  slug: string;
  listingsCount: number;
}

/**
 * Location search result for autocomplete
 */
export interface LocationSearchResult {
  locationId: string;            // Mapbox place ID or locality ID
  slug: string;                  // SEO-friendly slug (e.g., "zlatibor-rs" or "cajetina-rs")
  name: string;                  // Raw name (e.g., "Zlatibor" or "Čajetina")
  displayName: string;           // Display name for UI (e.g., "Zlatibor" or "Čajetina, Zlatibor")
  locationType: 'COUNTRY' | 'PLACE' | 'LOCALITY';  // Location type indicator
  countryName?: string;          // Country name (for PLACE and LOCALITY)
  parentPlaceName?: string;      // Parent place name (for LOCALITY only)
}

/**
 * Response for location search endpoint
 */
export interface LocationSearchResponse {
  locations: LocationSearchResult[];
}

/**
 * Helper to generate slug from location data
 * Format: "place-name-countrycode" (e.g., "zlatibor-rs")
 */
export function generateLocationSlug(name: string, countryCode: string): string {
  const normalize = (str: string) => 
    str
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '') // Remove diacritics
      .replace(/[^a-z0-9\s-]/g, '')     // Remove special chars
      .replace(/\s+/g, '-')             // Replace spaces with hyphens
      .replace(/-+/g, '-')              // Replace multiple hyphens with single
      .replace(/^-|-$/g, '');           // Remove leading/trailing hyphens
  
  return `${normalize(name)}-${countryCode.toLowerCase()}`;
}

/**
 * Helper to generate searchName from location data
 * Format: "placename regionname" (lowercase, normalized, space-separated for substring matching)
 * Removes diacritics so "Užice" becomes "uzice" for easier searching
 */
export function generateSearchName(name: string, regionName: string): string {
  const normalize = (str: string) => 
    str
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, ''); // Remove diacritics
  
  return `${normalize(name)} ${normalize(regionName)}`;
}


