# Payment Types - Frontend Integration Guide

## Overview

Payment types is a **required field** for listing creation. Users can now select **multiple payment methods** from the available options.

---

## Payment Type Options

| Key                   | English Label             | Serbian Label                    |
| --------------------- | ------------------------- | -------------------------------- |
| `PAY_LATER`           | Pay Later                 | Plaćanje kasnije                 |
| `PAY_LATER_CASH_ONLY` | Pay Later - Cash Only     | Plaćanje kasnije - Samo gotovina |
| `LOKALSTAYS_ONLINE`   | LokalStays Online Payment | LokalStays online naplate        |

---

## Getting Payment Types for Multi-Select

### Endpoint

```
GET /api/v1/listings/metadata
```

### Response (Extract)

```json
{
  "paymentTypes": [
    {
      "key": "PAY_LATER",
      "en": "Pay Later",
      "sr": "Plaćanje kasnije",
      "sortOrder": 1
    },
    {
      "key": "PAY_LATER_CASH_ONLY",
      "en": "Pay Later - Cash Only",
      "sr": "Plaćanje kasnije - Samo gotovina",
      "sortOrder": 2
    },
    {
      "key": "LOKALSTAYS_ONLINE",
      "en": "LokalStays Online Payment",
      "sr": "LokalStays online naplate",
      "sortOrder": 3
    }
  ]
}
```

### Frontend Usage

```javascript
// Fetch metadata on app load
const metadata = await fetch("/api/v1/listings/metadata");
const { paymentTypes } = await metadata.json();

// Populate multi-select/checkbox group
const options = paymentTypes.map((pt) => ({
  value: pt.key,
  label: currentLanguage === "en" ? pt.en : pt.sr,
}));
```

---

## Creating a Listing

### Endpoint

```
POST /api/v1/hosts/{hostId}/listings/submit-intent
```

### Request Body

```json
{
  "listingName": "My Apartment",
  "propertyType": "APARTMENT",
  "paymentTypes": ["PAY_LATER", "LOKALSTAYS_ONLINE"], // ← ARRAY of keys
  "parking": {
    "type": "FREE"
  }
  // ... other fields
}
```

### Validation

- **Required**: Must be provided
- **Type**: Array of strings
- **Minimum**: At least 1 payment type must be selected
- **Valid values**: `PAY_LATER`, `PAY_LATER_CASH_ONLY`, `LOKALSTAYS_ONLINE`

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
    "listingName": "My Apartment",
    "paymentTypes": [
      {
        "key": "PAY_LATER",
        "en": "Pay Later",
        "sr": "Plaćanje kasnije"
      },
      {
        "key": "LOKALSTAYS_ONLINE",
        "en": "LokalStays Online Payment",
        "sr": "LokalStays online naplate"
      }
    ],
    "parking": {
      "type": {
        "key": "FREE",
        "en": "Free Parking",
        "sr": "Besplatno parkiranje"
      }
    }
    // ... other fields
  }
}
```

---

## Updating Payment Types

### Endpoint

```
PUT /api/v1/hosts/{hostId}/listings/{listingId}/update
```

### Request Body (Partial Update)

```json
{
  "updates": {
    "paymentTypes": ["PAY_LATER_CASH_ONLY"] // ← Send array of keys (replaces existing)
  }
}
```

---

## Notes

- Payment types are stored as an **array of bilingual enums**
- Always send an **array of keys** in requests (e.g., `["PAY_LATER", "LOKALSTAYS_ONLINE"]`)
- Backend returns the **full bilingual objects array** in responses
- At least one payment type must be selected
- The array is a full replacement - send all desired payment types each time
