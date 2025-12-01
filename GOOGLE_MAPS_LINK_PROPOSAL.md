# Google Maps Link - Implementation Proposal

## Overview

Add optional Google Maps link field to listing address data with backend validation.

---

## Data Structure Changes

### 1. Address Type Update

**Current:**

```typescript
address: {
  fullAddress: string;
  street: string;
  streetNumber: string;
  apartmentNumber?: string;
  city: string;
  municipality?: string;
  postalCode: string;
  country: string;
  countryCode: string;
  coordinates?: {
    latitude: number;
    longitude: number;
  };
  mapboxPlaceId?: string;
}
```

**Proposed:**

```typescript
address: {
  // ... all existing fields ...
  googleMapsLink?: string;  // NEW: Optional Google Maps URL
}
```

### 2. Affected Types

- `ListingMetadata.address` (DynamoDB record)
- `SubmitListingIntentRequest.address` (API request)
- `UpdateListingMetadataRequest.updates.address` (API update)
- `GetListingResponse.listing.address` (API response)

---

## Validation Rules

### Valid Google Maps URL Formats

Google Maps links can be in multiple formats:

1. **Place URL:** `https://maps.google.com/maps?q=...`
2. **Place URL (short):** `https://goo.gl/maps/...`
3. **Place URL (new):** `https://www.google.com/maps/place/...`
4. **Search URL:** `https://www.google.com/maps/search/...`
5. **Coordinates URL:** `https://www.google.com/maps/@latitude,longitude,zoom`
6. **Directions URL:** `https://www.google.com/maps/dir/...`
7. **Country-specific:** `https://maps.google.rs/...`, `https://maps.google.co.uk/...`

### Validation Logic

```typescript
function validateGoogleMapsLink(url: string): boolean {
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

  // Check if hostname matches or is a country-specific Google Maps domain
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
```

### Error Messages

- `"Google Maps link must be a valid HTTPS URL"`
- `"Google Maps link must be from maps.google.com or google.com/maps"`
- `"Google Maps link is invalid"`

---

## Implementation Points

### 1. Submit Intent (`submit-intent.ts`)

**Location:** `validateSubmitIntentRequest` function (line ~388)

**Add after coordinate validation (line ~417):**

```typescript
// Validate Google Maps link if provided
if (body.address.googleMapsLink) {
  if (!validateGoogleMapsLink(body.address.googleMapsLink)) {
    return "Google Maps link must be a valid HTTPS URL from maps.google.com or google.com/maps";
  }
}
```

**Update `normalizeAddress` function (line ~701):**

```typescript
// Only include optional fields if they have values
if (address.googleMapsLink) {
  normalized.googleMapsLink = address.googleMapsLink.trim();
}
```

### 2. Update Listing (`update-listing.ts`)

**Location:** `validateUpdates` function (line ~483)

**Add after coordinate validation (line ~537):**

```typescript
// Validate Google Maps link if provided
if (updates.address.googleMapsLink !== undefined) {
  if (
    updates.address.googleMapsLink &&
    !validateGoogleMapsLink(updates.address.googleMapsLink)
  ) {
    return "Google Maps link must be a valid HTTPS URL from maps.google.com or google.com/maps";
  }
}
```

### 3. Shared Validation Utility

**Create:** `backend/services/api/lib/url-validation.ts`

```typescript
/**
 * Validate Google Maps URL
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
```

---

## Frontend API Changes

### Submit Intent Request

```json
{
  "address": {
    "fullAddress": "123 Main St, Belgrade, Serbia",
    "street": "Main St",
    "streetNumber": "123",
    "city": "Belgrade",
    "postalCode": "11000",
    "country": "Serbia",
    "countryCode": "RS",
    "googleMapsLink": "https://maps.google.com/maps?q=44.8176,20.4564"
  }
}
```

### Get Listing Response

```json
{
  "listing": {
    "address": {
      "fullAddress": "123 Main St, Belgrade, Serbia",
      "street": "Main St",
      "city": "Belgrade",
      "googleMapsLink": "https://maps.google.com/maps?q=44.8176,20.4564"
    }
  }
}
```

---

## Database Impact

- **No migration needed** - field is optional
- **No schema changes** - DynamoDB is schemaless
- Existing listings without `googleMapsLink` will simply not have the field

---

## Testing Scenarios

### Valid URLs

- `https://maps.google.com/maps?q=44.8176,20.4564`
- `https://www.google.com/maps/place/Belgrade,+Serbia/@44.8176,20.4564,12z`
- `https://goo.gl/maps/abc123`
- `https://maps.google.rs/maps?q=Belgrade`
- `https://maps.google.co.uk/maps?q=London`

### Invalid URLs

- `http://maps.google.com/...` (not HTTPS)
- `https://example.com/maps` (wrong domain)
- `https://google.com/search` (not /maps path)
- `not-a-url` (invalid URL format)
- `https://fakemaps.google.com/...` (suspicious subdomain)

---

## Security Considerations

1. **URL Validation:** Strict domain checking prevents phishing/malicious links
2. **HTTPS Only:** Ensures secure links
3. **No Execution:** URL is stored as string, never executed server-side
4. **Frontend Display:** Frontend should render as clickable link with `target="_blank"` and `rel="noopener noreferrer"`

---

## Deployment

1. Create `url-validation.ts` utility
2. Update `listing.types.ts` to add `googleMapsLink?: string` to address interfaces
3. Update `submit-intent.ts` validation and normalization
4. Update `update-listing.ts` validation
5. Deploy API stacks
6. Update frontend to include optional field in forms

**No data migration required** - field is optional and backward compatible.



