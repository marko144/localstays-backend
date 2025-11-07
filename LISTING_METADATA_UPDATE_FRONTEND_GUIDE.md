# Listing Metadata Update - Frontend Integration Guide

## Overview

This guide explains how to integrate the listing metadata update feature into the frontend. This feature allows hosts to edit various aspects of their listings (except address, images, and verification documents) after initial submission.

---

## Endpoint

```
PUT /api/v1/hosts/{hostId}/listings/{listingId}/update
```

---

## Authentication

- **Required:** Valid Cognito JWT token in `Authorization` header
- **User Group:** `HOST`
- **Authorization:** User must own the listing (hostId must match token)

---

## Eligible Listing Statuses

Updates are **allowed** for listings in the following statuses:

- ✅ `IN_REVIEW` - Listing is submitted and awaiting admin review
- ✅ `REJECTED` - Listing was rejected by admin
- ✅ `APPROVED` - Listing was approved but not yet live
- ✅ `ONLINE` - Listing is live and bookable
- ✅ `OFFLINE` - Listing is temporarily deactivated

Updates are **NOT allowed** for:

- ❌ `DRAFT` - Use the draft update flow instead
- ❌ `REVIEWING` - Admin is actively reviewing, changes locked
- ❌ `LOCKED` - Admin locked the listing
- ❌ `ARCHIVED` - Listing is deleted

---

## Request Body Structure

### Key Concept: Partial Updates

**IMPORTANT:** Only send the fields you want to update. Fields that are **not present** in the request will **not be updated** (they keep their existing values).

```typescript
{
  "updates": {
    // Only include the fields you want to update
    // Omit fields you don't want to change
  }
}
```

### Do NOT send:

- Empty strings (`""`)
- Null values (`null`)
- Undefined values

### Instead:

- Simply **omit** the field from the `updates` object

---

## Available Update Fields

### 1. Listing Name

```typescript
{
  "updates": {
    "listingName"?: string  // Max 100 characters
  }
}
```

**Example:**

```json
{
  "updates": {
    "listingName": "Beautiful Apartment in Belgrade"
  }
}
```

---

### 2. Property Type

```typescript
{
  "updates": {
    "propertyType"?: "APARTMENT" | "HOUSE" | "VILLA" | "STUDIO" | "ROOM"
  }
}
```

**Example:**

```json
{
  "updates": {
    "propertyType": "APARTMENT"
  }
}
```

---

### 3. Description

```typescript
{
  "updates": {
    "description"?: string  // Max 2000 characters
  }
}
```

**Example:**

```json
{
  "updates": {
    "description": "A cozy apartment with amazing city views and modern amenities. Perfect for couples or small families."
  }
}
```

---

### 4. Capacity

```typescript
{
  "updates": {
    "capacity"?: {
      "beds": number,      // Required if capacity is present (1-50)
      "sleeps": number     // Required if capacity is present (1-100)
    }
  }
}
```

**Example:**

```json
{
  "updates": {
    "capacity": {
      "beds": 3,
      "sleeps": 6
    }
  }
}
```

**Note:** If you send `capacity`, you must send both `beds` and `sleeps`. You cannot update just one of them.

---

### 5. Pricing

```typescript
{
  "updates": {
    "pricing"?: {
      "pricePerNight": number,  // Required if pricing is present (1-100000)
      "currency": string        // Required if pricing is present (3-letter ISO code)
    }
  }
}
```

**Example:**

```json
{
  "updates": {
    "pricing": {
      "pricePerNight": 85,
      "currency": "EUR"
    }
  }
}
```

**Note:** If you send `pricing`, you must send both `pricePerNight` and `currency`.

---

### 6. Pets Policy

```typescript
{
  "updates": {
    "pets"?: {
      "allowed": boolean,
      "policy"?: string    // Optional, max 500 characters
    }
  }
}
```

**Examples:**

Pets allowed with policy:

```json
{
  "updates": {
    "pets": {
      "allowed": true,
      "policy": "Small dogs only, max 10kg. Additional cleaning fee applies."
    }
  }
}
```

Pets not allowed:

```json
{
  "updates": {
    "pets": {
      "allowed": false
    }
  }
}
```

**Note:** If you send `pets`, you must send `allowed`. The `policy` field is optional.

---

### 7. Check-in/Check-out

```typescript
{
  "updates": {
    "checkIn"?: {
      "type": "SELF_CHECKIN" | "HOST_GREETING" | "LOCKBOX" | "DOORMAN",
      "description"?: string,  // Optional, max 500 characters
      "checkInFrom": string,   // Required: HH:MM format (e.g., "14:00")
      "checkOutBy": string     // Required: HH:MM format (e.g., "11:00")
    }
  }
}
```

**Example:**

```json
{
  "updates": {
    "checkIn": {
      "type": "SELF_CHECKIN",
      "description": "Lockbox code will be sent 24 hours before arrival",
      "checkInFrom": "15:00",
      "checkOutBy": "11:00"
    }
  }
}
```

**Note:** If you send `checkIn`, you must send `type`, `checkInFrom`, and `checkOutBy`. The `description` is optional.

---

### 8. Parking

```typescript
{
  "updates": {
    "parking"?: {
      "type": "NO_PARKING" | "FREE" | "PAID",
      "description"?: string   // Optional, max 500 characters
    }
  }
}
```

**Example:**

```json
{
  "updates": {
    "parking": {
      "type": "FREE",
      "description": "Street parking available in front of building"
    }
  }
}
```

**Note:** If you send `parking`, you must send `type`. The `description` is optional.

---

### 9. Smoking Policy

```typescript
{
  "updates": {
    "smokingAllowed"?: boolean
  }
}
```

**Example:**

```json
{
  "updates": {
    "smokingAllowed": false
  }
}
```

---

### 10. Cancellation Policy

```typescript
{
  "updates": {
    "cancellationPolicy"?: {
      "type": "NO_CANCELLATION" | "24_HOURS" | "2_DAYS" | "3_DAYS" | "4_DAYS" | "ONE_WEEK" | "OTHER",
      "customText"?: string    // Required if type = "OTHER", max 1000 characters
    }
  }
}
```

**Examples:**

Standard policy:

```json
{
  "updates": {
    "cancellationPolicy": {
      "type": "2_DAYS"
    }
  }
}
```

Custom policy:

```json
{
  "updates": {
    "cancellationPolicy": {
      "type": "OTHER",
      "customText": "Full refund if cancelled 7 days before arrival. 50% refund if cancelled 3 days before."
    }
  }
}
```

**Note:** If you send `cancellationPolicy`, you must send `type`. If `type` is `"OTHER"`, you must also send `customText`.

---

### 11. Amenities

```typescript
{
  "updates": {
    "amenities"?: string[]   // Array of amenity keys, max 50 items
  }
}
```

**Example:**

```json
{
  "updates": {
    "amenities": [
      "WIFI",
      "AIR_CONDITIONING",
      "KITCHEN",
      "PARKING",
      "TV",
      "WASHING_MACHINE",
      "BALCONY",
      "ELEVATOR"
    ]
  }
}
```

**IMPORTANT - Full Replacement:**
When updating amenities, send the **complete list** of amenities you want. The backend will replace the entire amenities list with what you send.

- To **add** an amenity: Send the old list + the new one
- To **remove** an amenity: Send the list without it
- To **remove all** amenities: Send an empty array `[]`

**Available Amenity Keys:**

**Basics:** `WIFI`, `AIR_CONDITIONING`, `HEATING`, `HOT_WATER`

**Kitchen:** `KITCHEN`, `REFRIGERATOR`, `MICROWAVE`, `OVEN`, `STOVE`, `DISHWASHER`, `COFFEE_MAKER`

**Laundry:** `WASHING_MACHINE`, `DRYER`, `IRON`

**Entertainment:** `TV`, `CABLE_TV`, `STREAMING_SERVICES`

**Comfort:** `BED_LINENS`, `TOWELS`, `TOILETRIES`, `HAIR_DRYER`

**Outdoor:** `BALCONY`, `TERRACE`, `GARDEN`, `BBQ_GRILL`

**Building:** `ELEVATOR`, `PARKING`, `DOORMAN`, `GYM`, `POOL`

**Family:** `CRIB`, `HIGH_CHAIR`, `CHILD_FRIENDLY`

**Accessibility:** `WHEELCHAIR_ACCESSIBLE`, `STEP_FREE_ACCESS`

**Safety:** `SMOKE_DETECTOR`, `CARBON_MONOXIDE_DETECTOR`, `FIRE_EXTINGUISHER`, `FIRST_AID_KIT`

**Work:** `WORKSPACE`, `DESK`, `OFFICE_CHAIR`

---

### 12. Document Reference Number

```typescript
{
  "updates": {
    "rightToListDocumentNumber"?: string  // Max 30 characters
  }
}
```

**Example:**

```json
{
  "updates": {
    "rightToListDocumentNumber": "DOC-2024-12345"
  }
}
```

---

## Combining Multiple Updates

You can update multiple fields in a single request:

```json
{
  "updates": {
    "listingName": "Luxury Villa with Pool",
    "description": "Stunning villa with private pool and garden",
    "pricing": {
      "pricePerNight": 150,
      "currency": "EUR"
    },
    "amenities": ["WIFI", "POOL", "GARDEN", "BBQ_GRILL", "AIR_CONDITIONING"],
    "smokingAllowed": false,
    "capacity": {
      "beds": 4,
      "sleeps": 8
    }
  }
}
```

---

## Success Response

**Status Code:** `200 OK`

```typescript
{
  "success": true,
  "data": {
    "listingId": string,
    "updatedFields": string[],    // List of top-level fields that were updated
    "message": string
  }
}
```

**Example:**

```json
{
  "success": true,
  "data": {
    "listingId": "listing_abc123",
    "updatedFields": ["listingName", "pricing", "amenities"],
    "message": "Listing updated successfully"
  }
}
```

---

## Error Responses

### 400 Bad Request - Invalid Status

Listing cannot be edited in its current status.

```json
{
  "success": false,
  "error": {
    "code": "INVALID_STATUS",
    "message": "Listing cannot be edited in current status: LOCKED"
  }
}
```

---

### 400 Bad Request - Validation Error

Invalid data provided.

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid property type: CASTLE"
  }
}
```

**Common Validation Errors:**

- `"Listing name must be a non-empty string"`
- `"Listing name must not exceed 100 characters"`
- `"Invalid property type: {value}"`
- `"Description must not exceed 2000 characters"`
- `"When updating capacity, both beds and sleeps are required"`
- `"Beds must be between 1 and 50"`
- `"Sleeps must be between 1 and 100"`
- `"When updating pricing, both pricePerNight and currency are required"`
- `"Price per night must be between 1 and 100000"`
- `"Currency must be a valid 3-letter ISO code (e.g., EUR, USD)"`
- `"checkInFrom must be in HH:MM format"`
- `"Custom text is required when cancellation policy type is OTHER"`
- `"Maximum 50 amenities allowed"`

---

### 400 Bad Request - Missing Required Field

A nested object was sent without all required fields.

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "When updating capacity, both beds and sleeps are required"
  }
}
```

---

### 400 Bad Request - Empty Update

No fields provided for update.

```json
{
  "success": false,
  "error": {
    "code": "BAD_REQUEST",
    "message": "At least one field must be provided for update"
  }
}
```

---

### 404 Not Found

Listing does not exist.

```json
{
  "success": false,
  "error": {
    "code": "NOT_FOUND",
    "message": "Listing not found"
  }
}
```

---

### 403 Forbidden

User does not own the listing.

```json
{
  "success": false,
  "error": {
    "code": "FORBIDDEN",
    "message": "You do not have permission to edit this listing"
  }
}
```

---

### 401 Unauthorized

Missing or invalid authentication token.

```json
{
  "success": false,
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Missing or invalid authentication token"
  }
}
```

---

## Frontend Implementation Examples

### Example 1: Update from "Basic Info" Card

```typescript
const updateBasicInfo = async (
  hostId: string,
  listingId: string,
  name: string,
  token: string
) => {
  try {
    const response = await fetch(
      `https://your-api.com/api/v1/hosts/${hostId}/listings/${listingId}/update`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          updates: {
            listingName: name,
          },
        }),
      }
    );

    const result = await response.json();

    if (!result.success) {
      throw new Error(result.error.message);
    }

    return result.data;
  } catch (error) {
    console.error("Failed to update listing:", error);
    throw error;
  }
};
```

---

### Example 2: Update from "Description" Card

```typescript
const updateDescription = async (
  hostId: string,
  listingId: string,
  description: string,
  token: string
) => {
  const response = await fetch(
    `https://your-api.com/api/v1/hosts/${hostId}/listings/${listingId}/update`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        updates: {
          description: description,
        },
      }),
    }
  );

  return await response.json();
};
```

---

### Example 3: Update from "Amenities" Card

```typescript
const updateAmenities = async (
  hostId: string,
  listingId: string,
  selectedAmenities: string[],
  token: string
) => {
  const response = await fetch(
    `https://your-api.com/api/v1/hosts/${hostId}/listings/${listingId}/update`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        updates: {
          amenities: selectedAmenities, // Send complete list
        },
      }),
    }
  );

  return await response.json();
};
```

---

### Example 4: Update from "Pricing" Card

```typescript
const updatePricing = async (
  hostId: string,
  listingId: string,
  price: number,
  currency: string,
  token: string
) => {
  const response = await fetch(
    `https://your-api.com/api/v1/hosts/${hostId}/listings/${listingId}/update`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        updates: {
          pricing: {
            pricePerNight: price,
            currency: currency,
          },
        },
      }),
    }
  );

  return await response.json();
};
```

---

### Example 5: Update from "Capacity" Card

```typescript
const updateCapacity = async (
  hostId: string,
  listingId: string,
  beds: number,
  sleeps: number,
  token: string
) => {
  const response = await fetch(
    `https://your-api.com/api/v1/hosts/${hostId}/listings/${listingId}/update`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        updates: {
          capacity: {
            beds: beds,
            sleeps: sleeps,
          },
        },
      }),
    }
  );

  return await response.json();
};
```

---

### Example 6: Update Multiple Fields at Once

```typescript
const updateMultipleFields = async (
  hostId: string,
  listingId: string,
  updates: any,
  token: string
) => {
  const response = await fetch(
    `https://your-api.com/api/v1/hosts/${hostId}/listings/${listingId}/update`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ updates }),
    }
  );

  return await response.json();
};

// Usage:
await updateMultipleFields(
  hostId,
  listingId,
  {
    listingName: "Updated Name",
    pricing: { pricePerNight: 100, currency: "EUR" },
    smokingAllowed: false,
  },
  token
);
```

---

## UI/UX Recommendations

### 1. Status Check Before Showing Edit UI

Before allowing the user to edit, check that the listing status allows updates:

```typescript
const canEditListing = (status: string): boolean => {
  const editableStatuses = [
    "IN_REVIEW",
    "REJECTED",
    "APPROVED",
    "ONLINE",
    "OFFLINE",
  ];
  return editableStatuses.includes(status);
};

// In your component:
if (!canEditListing(listing.status)) {
  // Show read-only view or message
  return <div>This listing cannot be edited in its current status.</div>;
}
```

---

### 2. Refresh After Update

After a successful update, refresh the listing data to show the latest values:

```typescript
const handleUpdate = async (updates: any) => {
  try {
    await updateListing(hostId, listingId, updates, token);

    // Refresh listing data
    await fetchListing(hostId, listingId, token);

    // Show success message
    showSuccessToast("Listing updated successfully");
  } catch (error) {
    showErrorToast(error.message);
  }
};
```

---

### 3. Handle Validation Errors

Display validation errors clearly to the user:

```typescript
const handleUpdate = async (updates: any) => {
  try {
    const result = await updateListing(hostId, listingId, updates, token);

    if (!result.success) {
      // Show error message from API
      setErrorMessage(result.error.message);
      return;
    }

    // Success
    onUpdateSuccess();
  } catch (error) {
    setErrorMessage("Failed to update listing. Please try again.");
  }
};
```

---

### 4. Optimistic UI Updates (Optional)

For better UX, you can update the UI immediately and revert on error:

```typescript
const handleUpdate = async (updates: any) => {
  // Save current state
  const previousState = { ...listing };

  // Update UI immediately
  setListing({ ...listing, ...updates });

  try {
    await updateListing(hostId, listingId, updates, token);
    showSuccessToast("Updated successfully");
  } catch (error) {
    // Revert on error
    setListing(previousState);
    showErrorToast("Update failed. Please try again.");
  }
};
```

---

### 5. Amenities Management

For amenities, maintain the complete list and send it on every update:

```typescript
const [selectedAmenities, setSelectedAmenities] = useState<string[]>(
  listing.amenities.map((a) => a.key)
);

const toggleAmenity = (amenityKey: string) => {
  setSelectedAmenities(
    (prev) =>
      prev.includes(amenityKey)
        ? prev.filter((k) => k !== amenityKey) // Remove
        : [...prev, amenityKey] // Add
  );
};

const saveAmenities = async () => {
  await updateListing(
    hostId,
    listingId,
    {
      amenities: selectedAmenities, // Send complete list
    },
    token
  );
};
```

---

## Key Points Summary

1. ✅ **Partial Updates:** Only send fields you want to update. Omit fields you don't want to change.

2. ✅ **Not Empty, Not Present:** Don't send empty strings or null values. Simply don't include the field.

3. ✅ **Nested Objects:** When updating nested objects (pricing, capacity, etc.), send all required fields within that object.

4. ✅ **Amenities:** Always send the complete list. The backend replaces the entire list.

5. ✅ **Status Check:** Verify the listing status allows editing before showing the edit UI.

6. ✅ **Refresh After Update:** Fetch the latest listing data after successful update.

7. ✅ **No Status Change:** The listing status will not change when you update metadata.

8. ✅ **No Email Notifications:** The system does not send email notifications for metadata updates.

9. ✅ **Unlimited Updates:** Hosts can make as many updates as they want with no rate limiting.

10. ✅ **Individual or Batch:** You can update one field at a time (e.g., from individual cards) or multiple fields in one request.

---

## Testing Checklist

- [ ] Can update listing name only
- [ ] Can update description only
- [ ] Can update pricing only
- [ ] Can update capacity only
- [ ] Can update amenities only (add/remove)
- [ ] Can update multiple fields at once
- [ ] Cannot update when status is LOCKED
- [ ] Cannot update when status is ARCHIVED
- [ ] Can update when status is IN_REVIEW
- [ ] Can update when status is REJECTED
- [ ] Can update when status is APPROVED
- [ ] Can update when status is ONLINE
- [ ] Can update when status is OFFLINE
- [ ] Validation errors are displayed correctly
- [ ] Success message is shown after update
- [ ] Listing data refreshes after update
- [ ] Cannot update listing owned by another host

---

## Support

For questions or issues, contact the backend team or refer to the API documentation.
