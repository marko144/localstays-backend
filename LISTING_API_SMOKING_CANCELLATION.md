# Listing API: Smoking & Cancellation Policy

## New Fields Added

Two new fields added to listing creation:

- **`smokingAllowed`**: `boolean` - Whether smoking is allowed
- **`cancellationPolicy`**: `object` - Cancellation policy with preset or custom text

---

## 1. Get Metadata (Form Options)

**Endpoint**: `GET /api/v1/listings/metadata`

**Response** (new field added):

```json
{
  "success": true,
  "data": {
    "propertyTypes": [...],
    "amenities": [...],
    "checkInTypes": [...],
    "parkingTypes": [...],
    "cancellationPolicyTypes": [
      {
        "key": "NO_CANCELLATION",
        "en": "No Cancellation",
        "sr": "Bez otkaza",
        "sortOrder": 1
      },
      {
        "key": "24_HOURS",
        "en": "24 Hours",
        "sr": "24 sata",
        "sortOrder": 2
      },
      {
        "key": "2_DAYS",
        "en": "2 Days",
        "sr": "2 dana",
        "sortOrder": 3
      },
      {
        "key": "3_DAYS",
        "en": "3 Days",
        "sr": "3 dana",
        "sortOrder": 4
      },
      {
        "key": "4_DAYS",
        "en": "4 Days",
        "sr": "4 dana",
        "sortOrder": 5
      },
      {
        "key": "ONE_WEEK",
        "en": "One Week",
        "sr": "Jedna nedelja",
        "sortOrder": 6
      },
      {
        "key": "OTHER",
        "en": "Other (Custom)",
        "sr": "Drugo (Prilagođeno)",
        "sortOrder": 7
      }
    ],
    "verificationDocumentTypes": [...],
    "listingStatuses": [...],
    "amenityCategories": [...]
  }
}
```

---

## 2. Submit Listing Intent

**Endpoint**: `POST /api/v1/hosts/{hostId}/listings/submit-intent`

**Request Body** (new fields):

```json
{
  "listingName": "...",
  "propertyType": "APARTMENT",
  "description": "...",
  "address": {...},
  "capacity": {...},
  "pricing": {...},
  "pets": {...},
  "checkIn": {...},
  "parking": {...},

  "smokingAllowed": false,
  "cancellationPolicy": {
    "type": "24_HOURS"
  },

  "amenities": [...],
  "images": [...]
}
```

**If user selects "OTHER"**:

```json
{
  "smokingAllowed": true,
  "cancellationPolicy": {
    "type": "OTHER",
    "customText": "Flexible cancellation up to 48 hours before check-in with 50% refund"
  }
}
```

**Validation Rules**:

- `smokingAllowed`: Required, must be `boolean`
- `cancellationPolicy.type`: Required, must be one of the enum keys
- `cancellationPolicy.customText`: Required if `type === "OTHER"`, 5-500 characters

**Response**: Same as before (no changes)

---

## 3. Get Listing (Host)

**Endpoint**: `GET /api/v1/hosts/{hostId}/listings/{listingId}`

**Response** (new fields in `listing` object):

```json
{
  "success": true,
  "data": {
    "listing": {
      "listingId": "listing_...",
      "hostId": "host_...",
      "listingName": "...",
      "propertyType": {...},
      "status": "DRAFT",
      "description": "...",
      "address": {...},
      "capacity": {...},
      "pricing": {...},
      "pets": {...},
      "checkIn": {...},
      "parking": {...},

      "smokingAllowed": false,
      "cancellationPolicy": {
        "type": {
          "key": "24_HOURS",
          "en": "24 Hours",
          "sr": "24 sata"
        }
      },

      "createdAt": "...",
      "updatedAt": "..."
    },
    "images": [...],
    "amenities": [...],
    "verificationDocuments": [...]
  }
}
```

**If cancellation policy is "OTHER"**:

```json
{
  "smokingAllowed": true,
  "cancellationPolicy": {
    "type": {
      "key": "OTHER",
      "en": "Other (Custom)",
      "sr": "Drugo (Prilagođeno)"
    },
    "customText": "Flexible cancellation up to 48 hours before check-in with 50% refund"
  }
}
```

---

## 4. Get Listing (Admin)

**Endpoint**: `GET /api/v1/admin/listings/{listingId}`

**Response**: Same structure as host endpoint - includes `smokingAllowed` and `cancellationPolicy` in `listing` object.

---

## Frontend Implementation Notes

1. **Display cancellation options**: Use `cancellationPolicyTypes` from metadata endpoint
2. **Show custom text field**: Only when user selects `type === "OTHER"`
3. **Display policy on listing page**:
   - If `type.key !== "OTHER"`: Show `type.en` or `type.sr` based on language
   - If `type.key === "OTHER"`: Show `customText`
4. **Smoking policy**: Simple checkbox/toggle for `smokingAllowed`
