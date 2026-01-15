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
  
  // Visibility
  isLive: boolean;               // Whether visible to public search (default: true for existing, false for new)
  
  // Timestamps
  createdAt: string;             // ISO timestamp
  updatedAt: string;             // ISO timestamp
}

/**
 * Base request fields for creating a location
 */
interface CreateLocationBaseRequest {
  locationId: string;            // Mapbox ID (admin provides this)
  name: string;                  // Location name
  isLive?: boolean;              // Default: false
}

/**
 * Request to create a COUNTRY location
 */
export interface CreateCountryRequest extends CreateLocationBaseRequest {
  locationType: 'COUNTRY';
  countryCode: string;           // ISO country code (e.g., "RS")
}

/**
 * Request to create a PLACE location
 */
export interface CreatePlaceRequest extends CreateLocationBaseRequest {
  locationType: 'PLACE';
  regionName: string;            // Region/District name
  countryName: string;           // Country name
  mapboxCountryId: string;       // Parent country's Mapbox ID (validated)
  mapboxRegionId: string;        // Mapbox region ID
}

/**
 * Request to create a LOCALITY location
 */
export interface CreateLocalityRequest extends CreateLocationBaseRequest {
  locationType: 'LOCALITY';
  regionName: string;            // Region/District name
  countryName: string;           // Country name
  mapboxPlaceId: string;         // Parent place's Mapbox ID (validated)
  parentPlaceName: string;       // Parent place name (e.g., "Užice")
}

/**
 * Union type for create location requests
 */
export type CreateLocationRequest = CreateCountryRequest | CreatePlaceRequest | CreateLocalityRequest;

/**
 * Request to update a location
 */
export interface UpdateLocationRequest {
  isLive: boolean;
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
 * Admin location search result (includes additional fields for management)
 */
export interface AdminLocationSearchResult {
  locationId: string;
  locationType: 'COUNTRY' | 'PLACE' | 'LOCALITY';
  name: string;
  displayName: string;
  countryName: string;
  countryCode?: string;          // For COUNTRY type
  regionName?: string;           // For PLACE/LOCALITY
  parentPlaceName?: string;      // For LOCALITY
  slug: string;
  isLive: boolean;
  listingsCount: number;
  createdAt: string;
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


