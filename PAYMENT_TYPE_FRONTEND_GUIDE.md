# Payment Type - Frontend Integration Guide

## Overview

Payment type is a **required field** for listing creation. Users select one payment method from 4 options.

---

## Payment Type Options

| Key                  | English Label      | Serbian Label               |
| -------------------- | ------------------ | --------------------------- |
| `PAY_ONLINE`         | Pay Online         | Plaćanje online             |
| `PAY_DEPOSIT_ONLINE` | Pay Deposit Online | Plaćanje depozita online    |
| `PAY_LATER_CASH`     | Pay Later (Cash)   | Plaćanje kasnije (Gotovina) |
| `PAY_LATER_CARD`     | Pay Later (Card)   | Plaćanje kasnije (Kartica)  |

---

## Getting Payment Types for Dropdown

### Endpoint

```
GET /api/v1/listings/metadata
```

### Response (Extract)

```json
{
  "paymentTypes": [
    {
      "key": "PAY_ONLINE",
      "en": "Pay Online",
      "sr": "Plaćanje online",
      "sortOrder": 1
    },
    {
      "key": "PAY_DEPOSIT_ONLINE",
      "en": "Pay Deposit Online",
      "sr": "Plaćanje depozita online",
      "sortOrder": 2
    },
    {
      "key": "PAY_LATER_CASH",
      "en": "Pay Later (Cash)",
      "sr": "Plaćanje kasnije (Gotovina)",
      "sortOrder": 3
    },
    {
      "key": "PAY_LATER_CARD",
      "en": "Pay Later (Card)",
      "sr": "Plaćanje kaldes (Kartica)",
      "sortOrder": 4
    }
  ]
}
```

### Frontend Usage

```javascript
// Fetch metadata on app load
const metadata = await fetch("/api/v1/listings/metadata");
const { paymentTypes } = await metadata.json();

// Populate dropdown
const dropdown = paymentTypes.map((pt) => ({
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

### Request Body (New Field)

```json
{
  "listingName": "My Apartment",
  "propertyType": "APARTMENT",
  "paymentType": "PAY_ONLINE", // ← NEW REQUIRED FIELD
  "parking": {
    "type": "FREE"
  }
  // ... other fields
}
```

### Validation

- **Required**: Must be provided
- **Valid values**: `PAY_ONLINE`, `PAY_DEPOSIT_ONLINE`, `PAY_LATER_CASH`, `PAY_LATER_CARD`

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
    "paymentType": {
      // ← NEW FIELD
      "key": "PAY_ONLINE",
      "en": "Pay Online",
      "sr": "Plaćanje online"
    },
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

## Updating Payment Type

### Endpoint

```
PUT /api/v1/hosts/{hostId}/listings/{listingId}/update
```

### Request Body (Partial Update)

```json
{
  "updates": {
    "paymentType": "PAY_LATER_CASH" // ← Send only the key
  }
}
```

---

## Notes

- Payment type is stored as a **bilingual enum** (same pattern as parking, check-in, etc.)
- Always send the **key** (`PAY_ONLINE`) in requests
- Backend returns the **full bilingual object** in responses
- All existing listings have been migrated to default: `PAY_ONLINE`


