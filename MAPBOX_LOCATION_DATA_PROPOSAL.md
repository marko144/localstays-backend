# Mapbox Location Data - Implementation Proposal

## Overview

Add optional Mapbox region and place metadata to listings for internal use and future querying.

---

## Proposed Data Structure

### TypeScript Interface

```typescript
// Add to ListingMetadata interface
interface ListingMetadata {
  // ... existing fields

  // Mapbox Location Metadata (optional, for internal use)
  mapboxMetadata?: {
    region?: {
      mapbox_id: string; // Mapbox region ID (e.g., "dXJuOm1ieHBsYzpBZzRB")
      name: string; // Region name (e.g., "Belgrade")
    };
    place?: {
      mapbox_id: string; // Mapbox place ID (e.g., "dXJuOm1ieHBsYzpCZ3dB")
      name: string; // Place name (e.g., "Stari Grad")
    };
  };
}
```

---

## API Changes

### Create Listing Request

**Endpoint**: `POST /api/v1/hosts/{hostId}/listings/submit-intent`

**New Optional Field**:

```json
{
  "listingName": "My Apartment",
  "propertyType": "APARTMENT",
  "address": {
    "fullAddress": "Knez Mihailova 10, Belgrade",
    "street": "Knez Mihailova",
    "streetNumber": "10",
    "city": "Belgrade",
    "country": "Serbia",
    "countryCode": "RS",
    "coordinates": {
      "latitude": 44.8176,
      "longitude": 20.4564
    },
    "mapboxPlaceId": "ChIJvT-116N6WkcR5H4X8lxkuB0"
  },

  // NEW OPTIONAL FIELD
  "mapboxMetadata": {
    "region": {
      "mapbox_id": "dXJuOm1ieHBsYzpBZzRB",
      "name": "Belgrade"
    },
    "place": {
      "mapbox_id": "dXJuOm1ieHBsYzpCZ3dB",
      "name": "Stari Grad"
    }
  }

  // ... other fields
}
```

### Get Listing Response

**Endpoint**: `GET /api/v1/hosts/{hostId}/listings/{listingId}`

**Response includes new field**:

```json
{
  "listing": {
    "listingId": "listing_123",
    "listingName": "My Apartment",
    "address": {
      "fullAddress": "Knez Mihailova 10, Belgrade",
      "city": "Belgrade",
      "coordinates": {
        "latitude": 44.8176,
        "longitude": 20.4564
      }
      // ... other address fields
    },

    // NEW FIELD (only if provided during creation)
    "mapboxMetadata": {
      "region": {
        "mapbox_id": "dXJuOm1ieHBsYzpBZzRB",
        "name": "Belgrade"
      },
      "place": {
        "mapbox_id": "dXJuOm1ieHBsYzpCZ3dB",
        "name": "Stari Grad"
      }
    }

    // ... other fields
  }
}
```

---

## DynamoDB Changes

### Storage Location

Store in **ListingMetadata** record (no new table needed).

### Schema Addition

```typescript
// Add to existing ListingMetadata DynamoDB record
{
  pk: "HOST#{hostId}",
  sk: "LISTING_META#{listingId}",

  // ... existing fields (listingName, address, etc.)

  // NEW FIELD (optional)
  mapboxMetadata?: {
    region?: {
      mapbox_id: string;
      name: string;
    };
    place?: {
      mapbox_id: string;
      name: string;
    };
  }
}
```

### Querying

- **By Listing ID**: Returns full listing including `mapboxMetadata`
- **By Region**: Can query `mapboxMetadata.region.mapbox_id` (requires GSI if frequent)
- **By Place**: Can query `mapboxMetadata.place.mapbox_id` (requires GSI if frequent)

### GSI Consideration (Optional - for future)

If we need to query listings by region/place frequently:

```
GSI4:
  pk: MAPBOX_REGION#{regionId}
  sk: LISTING#{listingId}

GSI5:
  pk: MAPBOX_PLACE#{placeId}
  sk: LISTING#{listingId}
```

**Recommendation**: Start without GSI, add later if needed based on query patterns.

---

## Implementation Steps

1. ✅ Update `ListingMetadata` interface in `listing.types.ts`
2. ✅ Update `SubmitListingIntentRequest` interface
3. ✅ Update `GetListingResponse` interface
4. ✅ Update `submit-intent.ts` handler to accept and store `mapboxMetadata`
5. ✅ Update `get-listing.ts` handler to return `mapboxMetadata`
6. ✅ Update `list-listings.ts` if needed (probably not - summary view)
7. ✅ Update `update-listing.ts` to allow updating `mapboxMetadata`
8. ✅ No migration needed (optional field, existing listings = undefined)

---

## Validation Rules

- **Optional**: Can be omitted entirely
- **Partial**: Can provide only `region`, only `place`, or both
- **Region validation**:
  - If provided, both `mapbox_id` and `name` are required
  - `mapbox_id` must be a non-empty string
  - `name` must be a non-empty string
- **Place validation**:
  - If provided, both `mapbox_id` and `name` are required
  - `mapbox_id` must be a non-empty string
  - `name` must be a non-empty string

---

## Notes

- **Internal use only**: Not displayed to guests (yet)
- **Future use cases**:
  - Search/filter listings by region
  - Analytics by location
  - Recommendations based on place
  - Pricing insights by region
- **No migration needed**: Existing listings will have `mapboxMetadata: undefined`
- **Backward compatible**: Frontend can omit this field entirely
