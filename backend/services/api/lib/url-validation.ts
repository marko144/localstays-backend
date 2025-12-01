/**
 * URL Validation Utilities
 * 
 * Provides validation functions for external URLs (Google Maps, etc.)
 */

/**
 * Validate Google Maps URL
 * 
 * Accepts various Google Maps URL formats:
 * - https://maps.google.com/maps?q=...
 * - https://www.google.com/maps/place/...
 * - https://goo.gl/maps/...
 * - https://maps.google.rs/... (country-specific)
 * 
 * @param url - The URL to validate
 * @returns true if valid Google Maps URL, false otherwise
 */
export function validateGoogleMapsLink(url: string): boolean {
  if (!url || url.trim().length === 0) {
    return true; // Optional field
  }

  // Must be a valid URL
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return false;
  }

  // Must be HTTPS
  if (parsedUrl.protocol !== "https:") {
    return false;
  }

  // Must be a Google Maps domain
  const validDomains = [
    "maps.google.com",
    "www.google.com",
    "google.com",
    "goo.gl",
  ];

  const hostname = parsedUrl.hostname.toLowerCase();
  const isValidDomain = validDomains.some(
    (domain) => hostname === domain || hostname.endsWith(`.${domain}`)
  );
  const isCountrySpecificMaps = /^maps\.google\.[a-z]{2,3}(\.[a-z]{2})?$/.test(
    hostname
  );

  if (!isValidDomain && !isCountrySpecificMaps) {
    return false;
  }

  // For google.com domain, must have /maps in path
  if (
    (hostname === "google.com" || hostname === "www.google.com") &&
    !parsedUrl.pathname.startsWith("/maps")
  ) {
    return false;
  }

  return true;
}




