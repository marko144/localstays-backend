# Frontend API Changes: Booking Terms

**Date:** 2025-11-29  
**Status:** Ready for Implementation

---

## Overview

Two new booking term fields have been added to listings:

1. **Advance Booking** - How far in advance guests can book (in days)
2. **Max Booking Duration** - Maximum number of nights for a single booking

Both fields are **required** when creating or updating listings.

---

## API Changes

### 1. Metadata API (GET `/api/v1/listings/metadata`)

**New Response Fields:**

```typescript
{
  // ... existing fields ...

  "advanceBookingOptions": [
    {
      "key": "DAYS_30",
      "en": "30 days",
      "sr": "30 dana",
      "days": 30,
      "sortOrder": 1
    },
    {
      "key": "DAYS_60",
      "en": "60 days",
      "sr": "60 dana",
      "days": 60,
      "sortOrder": 2
    },
    {
      "key": "DAYS_90",
      "en": "90 days",
      "sr": "90 dana",
      "days": 90,
      "sortOrder": 3
    },
    {
      "key": "DAYS_180",
      "en": "6 months",
      "sr": "6 meseci",
      "days": 180,
      "sortOrder": 4
    },
    {
      "key": "DAYS_240",
      "en": "8 months",
      "sr": "8 meseci",
      "days": 240,
      "sortOrder": 5
    },
    {
      "key": "DAYS_300",
      "en": "10 months",
      "sr": "10 meseci",
      "days": 300,
      "sortOrder": 6
    },
    {
      "key": "DAYS_365",
      "en": "1 year",
      "sr": "1 godina",
      "days": 365,
      "sortOrder": 7
    }
  ],

  "maxBookingDurationOptions": [
    {
      "key": "NIGHTS_7",
      "en": "1 week",
      "sr": "1 nedelja",
      "nights": 7,
      "sortOrder": 1
    },
    {
      "key": "NIGHTS_14",
      "en": "2 weeks",
      "sr": "2 nedelje",
      "nights": 14,
      "sortOrder": 2
    },
    {
      "key": "NIGHTS_30",
      "en": "1 month",
      "sr": "1 mesec",
      "nights": 30,
      "sortOrder": 3
    },
    {
      "key": "NIGHTS_60",
      "en": "2 months",
      "sr": "2 meseca",
      "nights": 60,
      "sortOrder": 4
    },
    {
      "key": "NIGHTS_90",
      "en": "3 months",
      "sr": "3 meseca",
      "nights": 90,
      "sortOrder": 5
    }
  ]
}
```

**Frontend Implementation:**

```typescript
// Fetch metadata on component mount
const metadata = await fetch('/api/v1/listings/metadata').then(r => r.json());

// Render dropdown for advance booking
<Select>
  {metadata.advanceBookingOptions.map(option => (
    <option key={option.key} value={option.key}>
      {language === 'en' ? option.en : option.sr}
    </option>
  ))}
</Select>

// Render dropdown for max booking duration
<Select>
  {metadata.maxBookingDurationOptions.map(option => (
    <option key={option.key} value={option.key}>
      {language === 'en' ? option.en : option.sr}
    </option>
  ))}
</Select>
```

---

### 2. Create Listing (POST `/api/v1/hosts/{hostId}/listings/submit-intent`)

**Request Changes:**

```typescript
{
  // ... existing fields ...
  "paymentType": "PAY_LATER",
  "smokingAllowed": false,

  // NEW REQUIRED FIELDS
  "advanceBooking": "DAYS_180",        // ← NEW
  "maxBookingDuration": "NIGHTS_30",   // ← NEW

  "cancellationPolicy": {
    "type": "24_HOURS"
  },
  "amenities": ["WIFI", "AIR_CONDITIONING"]
}
```

**Validation:**

- Both fields are **required**
- Must be valid enum keys
- Backend will return `400 Bad Request` if invalid

**Example:**

```typescript
const createListing = async (formData) => {
  const response = await fetch(
    `/api/v1/hosts/${hostId}/listings/submit-intent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        listingName: formData.name,
        propertyType: formData.propertyType,
        // ... other fields ...
        paymentType: formData.paymentType,
        smokingAllowed: formData.smokingAllowed,
        advanceBooking: formData.advanceBooking, // e.g., "DAYS_180"
        maxBookingDuration: formData.maxBookingDuration, // e.g., "NIGHTS_30"
        cancellationPolicy: {
          type: formData.cancellationPolicy,
        },
        // ... images, amenities ...
      }),
    }
  );

  return response.json();
};
```

---

### 3. Update Listing (PUT `/api/v1/hosts/{hostId}/listings/{listingId}/update`)

**Request Changes:**

```typescript
{
  "updates": {
    // ... any fields you want to update ...
    "advanceBooking": "DAYS_90",        // ← OPTIONAL
    "maxBookingDuration": "NIGHTS_14"   // ← OPTIONAL
  }
}
```

**Notes:**

- Fields are **optional** in updates
- If not provided, existing values remain unchanged
- Only send the fields you want to update

**Example:**

```typescript
const updateListing = async (listingId, updates) => {
  const response = await fetch(
    `/api/v1/hosts/${hostId}/listings/${listingId}/update`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        updates: {
          advanceBooking: updates.advanceBooking,
          maxBookingDuration: updates.maxBookingDuration,
        },
      }),
    }
  );

  return response.json();
};
```

---

### 4. Get Listing (GET `/api/v1/hosts/{hostId}/listings/{listingId}`)

**Response Changes:**

```typescript
{
  "listing": {
    "listingId": "listing_abc123",
    "hostId": "host_xyz456",
    // ... existing fields ...
    "paymentType": {
      "key": "PAY_LATER",
      "en": "Pay Later",
      "sr": "Plati kasnije"
    },
    "smokingAllowed": false,

    // NEW FIELDS
    "advanceBooking": {
      "key": "DAYS_180",
      "en": "6 months",
      "sr": "6 meseci",
      "days": 180
    },
    "maxBookingDuration": {
      "key": "NIGHTS_30",
      "en": "1 month",
      "sr": "1 mesec",
      "nights": 30
    },

    "cancellationPolicy": {
      "type": {
        "key": "24_HOURS",
        "en": "24 Hours",
        "sr": "24 sata"
      }
    }
  },
  "images": [ /* ... */ ],
  "amenities": [ /* ... */ ]
}
```

**Frontend Display:**

```typescript
const ListingDetails = ({ listing }) => {
  const { advanceBooking, maxBookingDuration } = listing;

  return (
    <>
      <div>
        <label>Advance Booking Window:</label>
        <span>{language === "en" ? advanceBooking.en : advanceBooking.sr}</span>
      </div>

      <div>
        <label>Maximum Booking Duration:</label>
        <span>
          {language === "en" ? maxBookingDuration.en : maxBookingDuration.sr}
        </span>
      </div>
    </>
  );
};
```

---

## Available Options

### Advance Booking (Days)

| Key      | English   | Serbian   | Days |
| -------- | --------- | --------- | ---- |
| DAYS_30  | 30 days   | 30 dana   | 30   |
| DAYS_60  | 60 days   | 60 dana   | 60   |
| DAYS_90  | 90 days   | 90 dana   | 90   |
| DAYS_180 | 6 months  | 6 meseci  | 180  |
| DAYS_240 | 8 months  | 8 meseci  | 240  |
| DAYS_300 | 10 months | 10 meseci | 300  |
| DAYS_365 | 1 year    | 1 godina  | 365  |

### Max Booking Duration (Nights)

| Key       | English  | Serbian   | Nights |
| --------- | -------- | --------- | ------ |
| NIGHTS_7  | 1 week   | 1 nedelja | 7      |
| NIGHTS_14 | 2 weeks  | 2 nedelje | 14     |
| NIGHTS_30 | 1 month  | 1 mesec   | 30     |
| NIGHTS_60 | 2 months | 2 meseca  | 60     |
| NIGHTS_90 | 3 months | 3 meseca  | 90     |

---

## TypeScript Types

```typescript
// Add to your frontend types file
export type AdvanceBookingType =
  | "DAYS_30"
  | "DAYS_60"
  | "DAYS_90"
  | "DAYS_180"
  | "DAYS_240"
  | "DAYS_300"
  | "DAYS_365";

export type MaxBookingDurationType =
  | "NIGHTS_7"
  | "NIGHTS_14"
  | "NIGHTS_30"
  | "NIGHTS_60"
  | "NIGHTS_90";

export interface BilingualEnumOption {
  key: string;
  en: string;
  sr: string;
}

export interface AdvanceBookingOption extends BilingualEnumOption {
  days: number;
  sortOrder: number;
}

export interface MaxBookingDurationOption extends BilingualEnumOption {
  nights: number;
  sortOrder: number;
}

export interface CreateListingRequest {
  // ... existing fields ...
  paymentType: string;
  smokingAllowed: boolean;
  advanceBooking: AdvanceBookingType; // ← NEW
  maxBookingDuration: MaxBookingDurationType; // ← NEW
  cancellationPolicy: {
    type: string;
    customText?: string;
  };
  // ... rest of fields ...
}

export interface ListingDetails {
  // ... existing fields ...
  paymentType: BilingualEnumOption;
  smokingAllowed: boolean;
  advanceBooking: AdvanceBookingOption; // ← NEW
  maxBookingDuration: MaxBookingDurationOption; // ← NEW
  cancellationPolicy: {
    type: BilingualEnumOption;
    customText?: string;
  };
  // ... rest of fields ...
}
```

---

## Form Validation

Add these validation rules to your listing forms:

```typescript
const validateListingForm = (formData) => {
  const errors = {};

  // ... existing validations ...

  if (!formData.advanceBooking) {
    errors.advanceBooking = "Advance booking window is required";
  }

  if (!formData.maxBookingDuration) {
    errors.maxBookingDuration = "Maximum booking duration is required";
  }

  return errors;
};
```

---

## Default Values (Recommended)

When creating a new listing form, consider these default values for better UX:

```typescript
const defaultFormValues = {
  // ... existing defaults ...
  advanceBooking: "DAYS_180", // 6 months (most flexible)
  maxBookingDuration: "NIGHTS_30", // 1 month (common for short stays)
};
```

---

## Migration Notes

**For Existing Listings:**

- All existing listings have been migrated with default values:
  - **Advance Booking:** `DAYS_180` (6 months)
  - **Max Booking Duration:** `NIGHTS_30` (1 month)
- Hosts can update these values at any time through the listing edit flow

---

## Error Handling

```typescript
const handleCreateListing = async (formData) => {
  try {
    const response = await createListing(formData);

    if (!response.ok) {
      const error = await response.json();

      // Handle validation errors
      if (error.code === "VALIDATION_ERROR") {
        if (error.message.includes("advanceBooking")) {
          setFieldError("advanceBooking", "Invalid advance booking option");
        }
        if (error.message.includes("maxBookingDuration")) {
          setFieldError(
            "maxBookingDuration",
            "Invalid booking duration option"
          );
        }
      }

      return;
    }

    // Success handling
    navigate(`/listings/${response.listingId}`);
  } catch (error) {
    console.error("Failed to create listing:", error);
    showError("Something went wrong. Please try again.");
  }
};
```

---

## Summary for Frontend Team

### What You Need to Do:

1. ✅ **Fetch metadata** - Add `advanceBookingOptions` and `maxBookingDurationOptions` to metadata fetch
2. ✅ **Add form fields** - Add two dropdowns to listing create/edit forms
3. ✅ **Update form submission** - Include `advanceBooking` and `maxBookingDuration` in request payload
4. ✅ **Update listing display** - Show these fields when displaying listing details
5. ✅ **Add validation** - Both fields are required for create, optional for update

### Effort Estimate:

- **Low complexity** - Follow existing patterns for other enum fields (e.g., `paymentType`, `propertyType`)
- **Estimated time:** 2-3 hours
- **Files to update:**
  - Metadata fetching hook
  - Listing create form component
  - Listing edit form component
  - Listing detail display component
  - TypeScript type definitions

---

**Questions?** Contact the backend team for clarification.


