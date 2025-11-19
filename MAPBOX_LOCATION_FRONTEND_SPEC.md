# Mapbox Location Data - Frontend Spec

## Overview

When creating a listing, you can **optionally** send Mapbox region and place metadata for internal use.

---

## Data Structure

### What to Send

```typescript
interface MapboxMetadata {
  region?: {
    mapbox_id: string; // Mapbox region ID
    name: string; // Region name (e.g., "Belgrade")
  };
  place?: {
    mapbox_id: string; // Mapbox place ID
    name: string; // Place name (e.g., "Stari Grad")
  };
}
```

---

## Creating a Listing

### Endpoint

```
POST /api/v1/hosts/{hostId}/listings/submit-intent
```

### Request Body (New Optional Field)

```json
{
  "listingName": "My Apartment",
  "address": {
    "fullAddress": "Knez Mihailova 10, Belgrade",
    "city": "Belgrade",
    "coordinates": { "latitude": 44.8176, "longitude": 20.4564 }
  },

  "mapboxMetadata": {
    // ← NEW OPTIONAL FIELD
    "region": {
      "mapbox_id": "dXJuOm1ieHBsYzpBZzRB",
      "name": "Belgrade"
    },
    "place": {
      "mapbox_id": "dXJuOm1ieHBsYzpCZ3dB",
      "name": "Stari Grad"
    }
  }
}
```

### Rules

- **Optional**: Can be omitted entirely
- **Partial**: Can send only `region`, only `place`, or both
- **Required if provided**: Both `mapbox_id` and `name` must be present

---

## Getting Listing Details

### Endpoint

```
GET /api/v1/hosts/{hostId}/listings/{listingId}
```

### Response (Extract)

```json
{
  "listing": {
    "listingId": "listing_123",
    "address": {
      /* ... */
    },

    "mapboxMetadata": {
      // ← NEW FIELD (if provided)
      "region": {
        "mapbox_id": "dXJuOm1ieHBsYzpBZzRB",
        "name": "Belgrade"
      },
      "place": {
        "mapbox_id": "dXJuOm1ieHBsYzpCZ3dB",
        "name": "Stari Grad"
      }
    }
  }
}
```

---

## Example: Mapbox Geocoding Integration

```javascript
// When user selects address from Mapbox Geocoder
const handlePlaceSelect = (result) => {
  const address = {
    fullAddress: result.place_name,
    city: extractCity(result),
    coordinates: {
      latitude: result.center[1],
      longitude: result.center[0],
    },
  };

  // Extract Mapbox metadata from context
  const mapboxMetadata = {
    region: result.context?.find((c) => c.id.startsWith("region"))
      ? {
          mapbox_id: result.context.find((c) => c.id.startsWith("region")).id,
          name: result.context.find((c) => c.id.startsWith("region")).text,
        }
      : undefined,
    place: result.context?.find((c) => c.id.startsWith("place"))
      ? {
          mapbox_id: result.context.find((c) => c.id.startsWith("place")).id,
          name: result.context.find((c) => c.id.startsWith("place")).text,
        }
      : undefined,
  };

  // Send to backend
  submitListing({ address, mapboxMetadata });
};
```

---

## Notes

- **Not required**: Existing flow works without this field
- **Internal use**: Not displayed to users (yet)
- **Future-proof**: Enables region-based search/analytics later
