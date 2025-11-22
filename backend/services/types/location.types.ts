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
 */
export interface LocationRecord {
  // Primary key
  pk: string;                    // "LOCATION#<mapboxPlaceId>"
  sk: string;                    // "NAME#<name>" (e.g., "NAME#Belgrade" or "NAME#Beograd")
  
  // Core fields
  locationId: string;            // Canonical ID (same as mapboxPlaceId)
  locationType: 'PLACE';         // Always "PLACE" for now
  name: string;                  // Place name (e.g., "Zlatibor", "Belgrade", "Beograd")
  regionName: string;            // Region name (e.g., "Zlatibor District")
  countryName: string;           // Country name (e.g., "Serbia")
  
  // Mapbox IDs
  mapboxPlaceId: string;         // Mapbox place ID (same as locationId)
  mapboxRegionId: string;        // Mapbox region ID
  
  // Search & routing
  slug: string;                  // URL-safe slug (e.g., "zlatibor-serbia")
  searchName: string;            // Normalized search text (e.g., "zlatibor zlatibor district serbia")
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
  locationId: string;  // Mapbox place ID
  name: string;        // Display name (e.g., "Užice")
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


