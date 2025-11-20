# Bedrooms & Bathrooms - API Specification

## Overview

Added `bedrooms` and `bathrooms` fields to listing capacity. These are now required when creating or updating a listing.

---

## Data Structure

### Capacity Object (Updated)

```typescript
{
  beds: number; // Number of beds (min: 1, max: 50)
  bedrooms: number; // Number of bedrooms (min: 0, max: 20) - can be 0 for studio apartments
  bathrooms: number; // Number of bathrooms (min: 1, max: 20)
  sleeps: number; // Number of guests (min: 1, max: 100)
}
```

---

## API Endpoints

### 1. Create Listing (Submit Intent)

**Endpoint:** `POST /api/v1/hosts/{hostId}/listings/submit-intent`

**Request Body (Updated):**

```json
{
  "listingName": "Cozy Mountain Retreat",
  "propertyType": "APARTMENT",
  "description": "Beautiful apartment...",
  "address": {
    /* ... */
  },
  "capacity": {
    "beds": 2,
    "bedrooms": 1, // NEW - Required
    "bathrooms": 1, // NEW - Required
    "sleeps": 4
  },
  "checkIn": {
    /* ... */
  },
  "parking": {
    /* ... */
  },
  "paymentType": "PAY_ONLINE",
  "smokingAllowed": false,
  "cancellationPolicy": {
    /* ... */
  },
  "amenities": ["WIFI", "AIR_CONDITIONING"],
  "images": [
    /* ... */
  ]
}
```

**Validation Rules:**

- `beds`: Required, must be >= 1 and <= 50
- `bedrooms`: Required, must be >= 0 and <= 20 (0 is allowed for studios)
- `bathrooms`: Required, must be >= 1 and <= 20
- `sleeps`: Required, must be >= 1 and <= 100

**Response:**

```json
{
  "listingId": "listing_abc123",
  "status": "DRAFT",
  "capacity": {
    "beds": 2,
    "bedrooms": 1,
    "bathrooms": 1,
    "sleeps": 4
  }
  // ... other fields
}
```

---

### 2. Update Draft Listing

**Endpoint:** `PUT /api/v1/hosts/{hostId}/listings/{listingId}/update`

**Request Body (Partial Update):**

```json
{
  "updates": {
    "capacity": {
      "beds": 3,
      "bedrooms": 2, // NEW - Required when updating capacity
      "bathrooms": 2, // NEW - Required when updating capacity
      "sleeps": 6
    }
  }
}
```

**Validation Rules (when updating capacity):**

- All 4 fields are required if you're updating capacity
- Same min/max rules as create

**Response:**

```json
{
  "listingId": "listing_abc123",
  "updatedFields": ["capacity"],
  "message": "Listing updated successfully"
}
```

---

### 3. Get Listing Details

**Endpoint:** `GET /api/v1/hosts/{hostId}/listings/{listingId}`

**Response (Updated):**

```json
{
  "listing": {
    "listingId": "listing_abc123",
    "listingName": "Cozy Mountain Retreat",
    "capacity": {
      "beds": 2,
      "bedrooms": 1, // NEW - Always returned
      "bathrooms": 1, // NEW - Always returned
      "sleeps": 4
    }
    // ... other fields
  },
  "images": [
    /* ... */
  ],
  "amenities": [
    /* ... */
  ]
}
```

---

## Frontend Implementation Guide

### Form Fields

#### Create/Edit Listing Form

Add two new number inputs in the capacity section:

```tsx
// Existing fields
<NumberInput
  label="Number of Beds"
  value={capacity.beds}
  onChange={(val) => setCapacity({...capacity, beds: val})}
  min={1}
  max={50}
  required
/>

<NumberInput
  label="Number of Guests"
  value={capacity.sleeps}
  onChange={(val) => setCapacity({...capacity, sleeps: val})}
  min={1}
  max={100}
  required
/>

// NEW FIELDS
<NumberInput
  label="Number of Bedrooms"
  value={capacity.bedrooms}
  onChange={(val) => setCapacity({...capacity, bedrooms: val})}
  min={0}
  max={20}
  required
  helperText="Enter 0 for studio apartments"
/>

<NumberInput
  label="Number of Bathrooms"
  value={capacity.bathrooms}
  onChange={(val) => setCapacity({...capacity, bathrooms: val})}
  min={1}
  max={20}
  required
/>
```

### TypeScript Interface

```typescript
interface Capacity {
  beds: number;
  bedrooms: number; // NEW
  bathrooms: number; // NEW
  sleeps: number;
}

interface ListingFormData {
  listingName: string;
  propertyType: string;
  description: string;
  address: Address;
  capacity: Capacity; // Updated
  // ... other fields
}
```

### Validation

```typescript
function validateCapacity(capacity: Capacity): string | null {
  if (capacity.beds < 1 || capacity.beds > 50) {
    return "Beds must be between 1 and 50";
  }
  if (capacity.bedrooms < 0 || capacity.bedrooms > 20) {
    return "Bedrooms must be between 0 and 20";
  }
  if (capacity.bathrooms < 1 || capacity.bathrooms > 20) {
    return "Bathrooms must be between 1 and 20";
  }
  if (capacity.sleeps < 1 || capacity.sleeps > 100) {
    return "Guests must be between 1 and 100";
  }
  return null;
}
```

### Display

When showing listing details:

```tsx
<div className="capacity-info">
  <div className="capacity-item">
    <Icon name="bed" />
    <span>{listing.capacity.beds} Beds</span>
  </div>
  <div className="capacity-item">
    <Icon name="door" />
    <span>{listing.capacity.bedrooms} Bedrooms</span> {/* NEW */}
  </div>
  <div className="capacity-item">
    <Icon name="bath" />
    <span>{listing.capacity.bathrooms} Bathrooms</span> {/* NEW */}
  </div>
  <div className="capacity-item">
    <Icon name="users" />
    <span>{listing.capacity.sleeps} Guests</span>
  </div>
</div>
```

---

## Migration Notes

### Existing Listings

- Existing listings in the database do NOT have `bedrooms` and `bathrooms` fields
- When fetching existing listings, these fields will be `undefined`
- Frontend should handle this gracefully (show "N/A" or prompt host to update)
- When a host edits an existing listing, they will be required to provide these values

### Recommended Approach

```typescript
// When displaying existing listings
const bedrooms = listing.capacity.bedrooms ?? "N/A";
const bathrooms = listing.capacity.bathrooms ?? "N/A";

// When editing existing listings
const [capacity, setCapacity] = useState({
  beds: listing.capacity.beds,
  bedrooms: listing.capacity.bedrooms ?? 1, // Default to 1 if missing
  bathrooms: listing.capacity.bathrooms ?? 1, // Default to 1 if missing
  sleeps: listing.capacity.sleeps,
});
```

---

## Error Responses

### Validation Errors

```json
{
  "error": "VALIDATION_ERROR",
  "message": "Bedrooms must be between 0 and 20",
  "statusCode": 400
}
```

### Missing Fields

```json
{
  "error": "VALIDATION_ERROR",
  "message": "When updating capacity, beds, bedrooms, bathrooms, and sleeps are required",
  "statusCode": 400
}
```

---

## Summary of Changes

✅ Added `bedrooms` field (0-20, required)
✅ Added `bathrooms` field (1-20, required)
✅ Updated create listing validation
✅ Updated update listing validation
✅ Both fields returned in all GET responses
✅ Bedrooms can be 0 (for studio apartments)
✅ Bathrooms must be at least 1

**Ready to implement on frontend!**
