# Booking Terms Enums Implementation Proposal

**Date:** 2025-11-29  
**Status:** Proposal

---

## Overview

Add two new booking term fields to listings:

1. **Maximum Advance Booking** - How far in advance guests can book (in days)
2. **Maximum Booking Duration** - Maximum number of nights for a single booking

Both fields will:

- Be stored as enums in DynamoDB with bilingual translations
- Be returned in the metadata API for form dropdowns
- Be tracked in the main listing table
- Be synced to the public listings table for search/filtering

---

## 1. New TypeScript Types

### Add to `listing.types.ts`

```typescript
// ============================================================================
// ENUMS
// ============================================================================

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
```

### Update `ListingMetadata` interface

```typescript
export interface ListingMetadata {
  // ... existing fields ...

  // Payment Type
  paymentType: BilingualEnum;

  // Smoking Policy
  smokingAllowed: boolean;

  // NEW: Booking Terms
  advanceBooking: BilingualEnum & { days: number }; // How far in advance guests can book
  maxBookingDuration: BilingualEnum & { nights: number }; // Maximum nights per booking

  // Cancellation Policy
  cancellationPolicy: {
    type: BilingualEnum;
    customText?: string;
  };

  // ... rest of fields ...
}
```

### Update API Request Types

```typescript
export interface SubmitListingIntentRequest {
  // ... existing fields ...
  paymentType: PaymentType;
  smokingAllowed: boolean;

  // NEW
  advanceBooking: AdvanceBookingType;
  maxBookingDuration: MaxBookingDurationType;

  cancellationPolicy: {
    type: CancellationPolicyType;
    customText?: string;
  };
  // ... rest of fields ...
}

export interface UpdateListingMetadataRequest {
  updates: {
    // ... existing fields ...
    paymentType?: PaymentType;
    smokingAllowed?: boolean;

    // NEW
    advanceBooking?: AdvanceBookingType;
    maxBookingDuration?: MaxBookingDurationType;

    cancellationPolicy?: {
      type: CancellationPolicyType;
      customText?: string;
    };
    // ... rest of fields ...
  };
}
```

### Update Metadata Response Type

```typescript
export interface ListingMetadataResponse {
  propertyTypes: Array<
    BilingualEnum & { isEntirePlace: boolean; sortOrder: number }
  >;
  amenities: Array<
    BilingualEnum & {
      category: AmenityCategory;
      sortOrder: number;
      isFilter: boolean;
    }
  >;
  checkInTypes: Array<BilingualEnum & { sortOrder: number }>;
  parkingTypes: Array<BilingualEnum & { sortOrder: number }>;
  paymentTypes: Array<BilingualEnum & { sortOrder: number }>;

  // NEW
  advanceBookingOptions: Array<
    BilingualEnum & { days: number; sortOrder: number }
  >;
  maxBookingDurationOptions: Array<
    BilingualEnum & { nights: number; sortOrder: number }
  >;

  cancellationPolicyTypes: Array<BilingualEnum & { sortOrder: number }>;
  verificationDocumentTypes: Array<
    BilingualEnum & { description: BilingualText; sortOrder: number }
  >;
  listingStatuses: Array<BilingualEnum & { description: BilingualText }>;
  amenityCategories: Array<BilingualEnum & { sortOrder: number }>;
}
```

---

## 2. DynamoDB Enum Storage

### Enum Records Structure

Both enums follow the existing pattern:

```
pk: ENUM#ADVANCE_BOOKING
sk: VALUE#DAYS_30
enumType: ADVANCE_BOOKING
enumValue: DAYS_30
translations: { en: "30 days", sr: "30 dana" }
metadata: { days: 30 }
isActive: true
sortOrder: 1
createdAt: "2025-11-29T..."
updatedAt: "2025-11-29T..."
```

```
pk: ENUM#MAX_BOOKING_DURATION
sk: VALUE#NIGHTS_7
enumType: MAX_BOOKING_DURATION
enumValue: NIGHTS_7
translations: { en: "7 nights", sr: "7 noći" }
metadata: { nights: 7 }
isActive: true
sortOrder: 1
createdAt: "2025-11-29T..."
updatedAt: "2025-11-29T..."
```

### Seed Data

**Advance Booking Options:**

| Key      | English   | Serbian   | Days | Sort Order |
| -------- | --------- | --------- | ---- | ---------- |
| DAYS_30  | 30 days   | 30 dana   | 30   | 1          |
| DAYS_60  | 60 days   | 60 dana   | 60   | 2          |
| DAYS_90  | 90 days   | 90 dana   | 90   | 3          |
| DAYS_180 | 6 months  | 6 meseci  | 180  | 4          |
| DAYS_240 | 8 months  | 8 meseci  | 240  | 5          |
| DAYS_300 | 10 months | 10 meseci | 300  | 6          |
| DAYS_365 | 1 year    | 1 godina  | 365  | 7          |

**Max Booking Duration Options:**

| Key       | English  | Serbian   | Nights | Sort Order |
| --------- | -------- | --------- | ------ | ---------- |
| NIGHTS_7  | 1 week   | 1 nedelja | 7      | 1          |
| NIGHTS_14 | 2 weeks  | 2 nedelje | 14     | 2          |
| NIGHTS_30 | 1 month  | 1 mesec   | 30     | 3          |
| NIGHTS_60 | 2 months | 2 meseca  | 60     | 4          |
| NIGHTS_90 | 3 months | 3 meseca  | 90     | 5          |

---

## 3. Listing Table Updates

### Listing Metadata Record

Add two new fields to the listing metadata record:

```typescript
{
  pk: "HOST#{hostId}",
  sk: "LISTING_META#{listingId}",

  // ... existing fields ...

  paymentType: {
    key: "PAY_LATER",
    en: "Pay Later",
    sr: "Plati kasnije"
  },

  smokingAllowed: false,

  // NEW FIELDS
  advanceBooking: {
    key: "DAYS_180",
    en: "6 months",
    sr: "6 meseci",
    days: 180
  },

  maxBookingDuration: {
    key: "NIGHTS_30",
    en: "1 month",
    sr: "1 mesec",
    nights: 30
  },

  cancellationPolicy: {
    type: {
      key: "24_HOURS",
      en: "24 hours",
      sr: "24 sata"
    }
  },

  // ... rest of fields ...
}
```

---

## 4. Public Listings Table Updates

### Add to `public-listing.types.ts`

```typescript
export interface PublicListingRecord {
  // ... existing fields ...

  // Categorical filters (stored as enum keys)
  parkingType: string;
  checkInType: string;
  propertyType: string;

  // NEW: Booking terms (stored as numerical values for filtering/sorting)
  advanceBookingDays: number; // e.g., 180
  maxBookingNights: number; // e.g., 30

  // Booking behaviour
  instantBook: boolean;

  // ... rest of fields ...
}
```

### Sync Logic in `publish-listing.ts`

```typescript
const basePublicListing = {
  listingId: listingId,
  hostId: hostId,

  name: listing.listingName,
  shortDescription: shortDescription,

  // ... capacity, images, filters ...

  parkingType: listing.parking.type.key,
  checkInType: listing.checkIn.type.key,
  propertyType: listing.propertyType.key,

  // NEW: Extract numerical values for filtering
  advanceBookingDays: listing.advanceBooking.days,
  maxBookingNights: listing.maxBookingDuration.nights,

  instantBook: false,
  hostVerified: hostResult.Item.status === "VERIFIED",
  listingVerified: listing.listingVerified || false,

  // ... timestamps ...
};
```

---

## 5. API Changes Required

### 5.1 Metadata API (`get-metadata.ts`)

**Update handler to fetch new enums:**

```typescript
const [
  propertyTypes,
  amenities,
  checkInTypes,
  parkingTypes,
  paymentTypes,
  advanceBookingOptions,        // NEW
  maxBookingDurationOptions,    // NEW
  cancellationPolicyTypes,
  verificationDocTypes,
  listingStatuses,
  amenityCategories,
] = await Promise.all([
  fetchEnumValues('PROPERTY_TYPE'),
  fetchEnumValues('AMENITY'),
  fetchEnumValues('CHECKIN_TYPE'),
  fetchEnumValues('PARKING_TYPE'),
  fetchEnumValues('PAYMENT_TYPE'),
  fetchEnumValues('ADVANCE_BOOKING'),           // NEW
  fetchEnumValues('MAX_BOOKING_DURATION'),      // NEW
  fetchEnumValues('CANCELLATION_POLICY'),
  fetchEnumValues('VERIFICATION_DOC_TYPE'),
  fetchEnumValues('LISTING_STATUS'),
  fetchEnumValues('AMENITY_CATEGORY'),
]);

const metadata: ListingMetadataResponse = {
  propertyTypes: /* ... */,
  amenities: /* ... */,
  checkInTypes: /* ... */,
  parkingTypes: /* ... */,
  paymentTypes: /* ... */,

  // NEW
  advanceBookingOptions: advanceBookingOptions.map((item) => ({
    key: item.enumValue,
    en: item.translations.en,
    sr: item.translations.sr,
    days: item.metadata?.days || 0,
    sortOrder: item.sortOrder,
  })),

  maxBookingDurationOptions: maxBookingDurationOptions.map((item) => ({
    key: item.enumValue,
    en: item.translations.en,
    sr: item.translations.sr,
    nights: item.metadata?.nights || 0,
    sortOrder: item.sortOrder,
  })),

  cancellationPolicyTypes: /* ... */,
  verificationDocumentTypes: /* ... */,
  listingStatuses: /* ... */,
  amenityCategories: /* ... */,
};
```

### 5.2 Submit Listing Intent (`submit-intent.ts`)

**Add validation:**

```typescript
const VALID_ADVANCE_BOOKING: AdvanceBookingType[] = [
  "DAYS_30",
  "DAYS_60",
  "DAYS_90",
  "DAYS_180",
  "DAYS_240",
  "DAYS_300",
  "DAYS_365",
];

const VALID_MAX_BOOKING_DURATION: MaxBookingDurationType[] = [
  "NIGHTS_7",
  "NIGHTS_14",
  "NIGHTS_30",
  "NIGHTS_60",
  "NIGHTS_90",
];

// In validation function:
if (!VALID_ADVANCE_BOOKING.includes(body.advanceBooking)) {
  return response.badRequest("Invalid advance booking option");
}

if (!VALID_MAX_BOOKING_DURATION.includes(body.maxBookingDuration)) {
  return response.badRequest("Invalid max booking duration option");
}
```

**Fetch translations and store:**

```typescript
// Fetch enum translations
const [
  propertyTypeEnum,
  paymentTypeEnum,
  advanceBookingEnum, // NEW
  maxBookingDurationEnum, // NEW
  checkInTypeEnum,
  parkingTypeEnum,
  cancellationPolicyEnum,
] = await Promise.all([
  fetchEnumTranslation("PROPERTY_TYPE", body.propertyType),
  fetchEnumTranslation("PAYMENT_TYPE", body.paymentType),
  fetchEnumTranslation("ADVANCE_BOOKING", body.advanceBooking), // NEW
  fetchEnumTranslation("MAX_BOOKING_DURATION", body.maxBookingDuration), // NEW
  fetchEnumTranslation("CHECKIN_TYPE", body.checkIn.type),
  fetchEnumTranslation("PARKING_TYPE", body.parking.type),
  fetchEnumTranslation("CANCELLATION_POLICY", body.cancellationPolicy.type),
]);

// Store in listing metadata:
await docClient.send(
  new PutCommand({
    TableName: TABLE_NAME,
    Item: {
      pk: `HOST#${hostId}`,
      sk: `LISTING_META#${listingId}`,

      // ... existing fields ...

      paymentType: paymentTypeEnum,
      smokingAllowed: body.smokingAllowed,

      // NEW
      advanceBooking: advanceBookingEnum,
      maxBookingDuration: maxBookingDurationEnum,

      cancellationPolicy: {
        type: cancellationPolicyEnum,
        customText: body.cancellationPolicy.customText,
      },

      // ... rest of fields ...
    },
  })
);
```

### 5.3 Update Listing (`update-listing.ts`)

**Add validation:**

```typescript
const VALID_ADVANCE_BOOKING: AdvanceBookingType[] = [
  "DAYS_30",
  "DAYS_60",
  "DAYS_90",
  "DAYS_180",
  "DAYS_240",
  "DAYS_300",
  "DAYS_365",
];

const VALID_MAX_BOOKING_DURATION: MaxBookingDurationType[] = [
  "NIGHTS_7",
  "NIGHTS_14",
  "NIGHTS_30",
  "NIGHTS_60",
  "NIGHTS_90",
];

// In validateUpdates function:
if (
  updates.advanceBooking &&
  !VALID_ADVANCE_BOOKING.includes(updates.advanceBooking)
) {
  return "Invalid advance booking option";
}

if (
  updates.maxBookingDuration &&
  !VALID_MAX_BOOKING_DURATION.includes(updates.maxBookingDuration)
) {
  return "Invalid max booking duration option";
}
```

**Build update expression:**

```typescript
const updateParts: string[] = [];
const attrValues: any = { ":now": now };
const attrNames: any = {};

// ... existing update logic ...

if (updates.advanceBooking) {
  const advanceBookingEnum = await fetchEnumTranslation(
    "ADVANCE_BOOKING",
    updates.advanceBooking
  );
  updateParts.push("advanceBooking = :advanceBooking");
  attrValues[":advanceBooking"] = advanceBookingEnum;
  updatedFields.push("advanceBooking");
}

if (updates.maxBookingDuration) {
  const maxBookingDurationEnum = await fetchEnumTranslation(
    "MAX_BOOKING_DURATION",
    updates.maxBookingDuration
  );
  updateParts.push("maxBookingDuration = :maxBookingDuration");
  attrValues[":maxBookingDuration"] = maxBookingDurationEnum;
  updatedFields.push("maxBookingDuration");
}

// ... sync to public listings if status is ONLINE ...
```

### 5.4 Publish Listing (`publish-listing.ts`)

**Extract values for public listing:**

```typescript
const basePublicListing = {
  listingId: listingId,
  hostId: hostId,

  // ... existing fields ...

  parkingType: listing.parking.type.key,
  checkInType: listing.checkIn.type.key,
  propertyType: listing.propertyType.key,

  // NEW
  advanceBookingDays: listing.advanceBooking.days,
  maxBookingNights: listing.maxBookingDuration.nights,

  instantBook: false,

  // ... rest of fields ...
};
```

### 5.5 Unpublish Listing (`unpublish-listing.ts`)

No changes needed - removes entire public listing record.

### 5.6 Get Listing (`get-listing.ts`)

**Return in response:**

```typescript
const responseData: GetListingResponse = {
  listing: {
    listingId: listing.listingId,
    hostId: listing.hostId,

    // ... existing fields ...

    paymentType: listing.paymentType,
    smokingAllowed: listing.smokingAllowed,

    // NEW
    advanceBooking: listing.advanceBooking,
    maxBookingDuration: listing.maxBookingDuration,

    cancellationPolicy: listing.cancellationPolicy,

    // ... rest of fields ...
  },
  images: /* ... */,
  amenities: /* ... */,
  verificationDocuments: /* ... */,
};
```

### 5.7 Sync Public Listings on Update (`update-listing.ts`)

**In `syncPublicListing` function:**

```typescript
async function syncPublicListing(
  listing: any,
  images: any[],
  amenities: any[]
) {
  // ... existing sync logic ...

  const updateExpression =
    "SET #name = :name, shortDescription = :shortDescription, " +
    "maxGuests = :maxGuests, bedrooms = :bedrooms, beds = :beds, bathrooms = :bathrooms, " +
    "thumbnailUrl = :thumbnailUrl, " +
    "petsAllowed = :petsAllowed, hasWIFI = :hasWIFI, hasAirConditioning = :hasAirConditioning, " +
    "hasParking = :hasParking, hasGym = :hasGym, hasPool = :hasPool, hasWorkspace = :hasWorkspace, " +
    "parkingType = :parkingType, checkInType = :checkInType, propertyType = :propertyType, " +
    "advanceBookingDays = :advanceBookingDays, maxBookingNights = :maxBookingNights, " + // NEW
    "officialStarRating = :officialStarRating, updatedAt = :updatedAt";

  const expressionAttributeValues = {
    // ... existing values ...
    ":parkingType": listing.parking.type.key,
    ":checkInType": listing.checkIn.type.key,
    ":propertyType": listing.propertyType.key,
    ":advanceBookingDays": listing.advanceBooking.days, // NEW
    ":maxBookingNights": listing.maxBookingDuration.nights, // NEW
    ":officialStarRating": listing.officialStarRating || null,
    ":updatedAt": now,
  };

  // ... update both PLACE and LOCALITY records if they exist ...
}
```

---

## 6. Seeding Implementation

### Update `seed-handler.ts`

Add to `seedListingEnums()` function:

```typescript
// Advance Booking Options
const advanceBookingOptions = [
  { key: "DAYS_30", en: "30 days", sr: "30 dana", days: 30, sortOrder: 1 },
  { key: "DAYS_60", en: "60 days", sr: "60 dana", days: 60, sortOrder: 2 },
  { key: "DAYS_90", en: "90 days", sr: "90 dana", days: 90, sortOrder: 3 },
  { key: "DAYS_180", en: "6 months", sr: "6 meseci", days: 180, sortOrder: 4 },
  { key: "DAYS_240", en: "8 months", sr: "8 meseci", days: 240, sortOrder: 5 },
  {
    key: "DAYS_300",
    en: "10 months",
    sr: "10 meseci",
    days: 300,
    sortOrder: 6,
  },
  { key: "DAYS_365", en: "1 year", sr: "1 godina", days: 365, sortOrder: 7 },
];

advanceBookingOptions.forEach((option) => {
  enumRecords.push({
    pk: "ENUM#ADVANCE_BOOKING",
    sk: `VALUE#${option.key}`,
    enumType: "ADVANCE_BOOKING",
    enumValue: option.key,
    translations: { en: option.en, sr: option.sr },
    metadata: { days: option.days },
    isActive: true,
    sortOrder: option.sortOrder,
    createdAt: now,
    updatedAt: now,
  });
});

// Max Booking Duration Options
const maxBookingDurationOptions = [
  { key: "NIGHTS_7", en: "1 week", sr: "1 nedelja", nights: 7, sortOrder: 1 },
  {
    key: "NIGHTS_14",
    en: "2 weeks",
    sr: "2 nedelje",
    nights: 14,
    sortOrder: 2,
  },
  { key: "NIGHTS_30", en: "1 month", sr: "1 mesec", nights: 30, sortOrder: 3 },
  {
    key: "NIGHTS_60",
    en: "2 months",
    sr: "2 meseca",
    nights: 60,
    sortOrder: 4,
  },
  {
    key: "NIGHTS_90",
    en: "3 months",
    sr: "3 meseca",
    nights: 90,
    sortOrder: 5,
  },
];

maxBookingDurationOptions.forEach((option) => {
  enumRecords.push({
    pk: "ENUM#MAX_BOOKING_DURATION",
    sk: `VALUE#${option.key}`,
    enumType: "MAX_BOOKING_DURATION",
    enumValue: option.key,
    translations: { en: option.en, sr: option.sr },
    metadata: { nights: option.nights },
    isActive: true,
    sortOrder: option.sortOrder,
    createdAt: now,
    updatedAt: now,
  });
});
```

---

## 7. Migration Strategy

### For Existing Listings

Create migration script: `backend/services/migrations/add-booking-terms.ts`

```typescript
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  ScanCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";

const TABLE_NAME = process.env.TABLE_NAME || "localstays-staging";
const client = new DynamoDBClient({ region: "eu-north-1" });
const docClient = DynamoDBDocumentClient.from(client);

// Default values
const DEFAULT_ADVANCE_BOOKING = {
  key: "DAYS_180",
  en: "6 months",
  sr: "6 meseci",
  days: 180,
};

const DEFAULT_MAX_BOOKING_DURATION = {
  key: "NIGHTS_30",
  en: "1 month",
  sr: "1 mesec",
  nights: 30,
};

async function migrateListings() {
  console.log("Starting booking terms migration...");

  let updatedCount = 0;
  let lastEvaluatedKey: any = undefined;

  do {
    const scanResult = await docClient.send(
      new ScanCommand({
        TableName: TABLE_NAME,
        FilterExpression:
          "begins_with(sk, :sk) AND attribute_not_exists(advanceBooking)",
        ExpressionAttributeValues: {
          ":sk": "LISTING_META#",
        },
        ExclusiveStartKey: lastEvaluatedKey,
      })
    );

    const listings = scanResult.Items || [];

    for (const listing of listings) {
      await docClient.send(
        new UpdateCommand({
          TableName: TABLE_NAME,
          Key: {
            pk: listing.pk,
            sk: listing.sk,
          },
          UpdateExpression:
            "SET advanceBooking = :advanceBooking, maxBookingDuration = :maxBookingDuration, updatedAt = :now",
          ExpressionAttributeValues: {
            ":advanceBooking": DEFAULT_ADVANCE_BOOKING,
            ":maxBookingDuration": DEFAULT_MAX_BOOKING_DURATION,
            ":now": new Date().toISOString(),
          },
        })
      );

      updatedCount++;
      console.log(`✅ Updated listing: ${listing.listingId}`);
    }

    lastEvaluatedKey = scanResult.LastEvaluatedKey;
  } while (lastEvaluatedKey);

  console.log(`Migration complete. Updated ${updatedCount} listings.`);
}

migrateListings().catch(console.error);
```

### For Existing Public Listings

Create migration script: `backend/services/migrations/sync-public-listing-booking-terms.ts`

```typescript
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  ScanCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";

const PUBLIC_LISTINGS_TABLE_NAME =
  process.env.PUBLIC_LISTINGS_TABLE_NAME ||
  "localstays-public-listings-staging";
const client = new DynamoDBClient({ region: "eu-north-1" });
const docClient = DynamoDBDocumentClient.from(client);

async function migratePublicListings() {
  console.log("Starting public listings booking terms migration...");

  let updatedCount = 0;
  let lastEvaluatedKey: any = undefined;

  do {
    const scanResult = await docClient.send(
      new ScanCommand({
        TableName: PUBLIC_LISTINGS_TABLE_NAME,
        FilterExpression: "attribute_not_exists(advanceBookingDays)",
        ExclusiveStartKey: lastEvaluatedKey,
      })
    );

    const publicListings = scanResult.Items || [];

    for (const publicListing of publicListings) {
      await docClient.send(
        new UpdateCommand({
          TableName: PUBLIC_LISTINGS_TABLE_NAME,
          Key: {
            pk: publicListing.pk,
            sk: publicListing.sk,
          },
          UpdateExpression:
            "SET advanceBookingDays = :advanceBookingDays, maxBookingNights = :maxBookingNights, updatedAt = :now",
          ExpressionAttributeValues: {
            ":advanceBookingDays": 180, // Default: 6 months
            ":maxBookingNights": 30, // Default: 1 month
            ":now": new Date().toISOString(),
          },
        })
      );

      updatedCount++;
      console.log(`✅ Updated public listing: ${publicListing.listingId}`);
    }

    lastEvaluatedKey = scanResult.LastEvaluatedKey;
  } while (lastEvaluatedKey);

  console.log(`Migration complete. Updated ${updatedCount} public listings.`);
}

migratePublicListings().catch(console.error);
```

---

## 8. Implementation Checklist

### Phase 1: Types & Enums

- [ ] Update `listing.types.ts` with new enum types
- [ ] Update `ListingMetadata` interface
- [ ] Update `SubmitListingIntentRequest` interface
- [ ] Update `UpdateListingMetadataRequest` interface
- [ ] Update `ListingMetadataResponse` interface
- [ ] Update `GetListingResponse` interface
- [ ] Update `public-listing.types.ts` with new fields

### Phase 2: Database Seeding

- [ ] Update `seed-handler.ts` with new enum records
- [ ] Run seeding in staging environment
- [ ] Verify enums in DynamoDB

### Phase 3: API Updates

- [ ] Update `get-metadata.ts` to fetch and return new enums
- [ ] Update `submit-intent.ts` validation and storage
- [ ] Update `update-listing.ts` validation and update logic
- [ ] Update `publish-listing.ts` to sync numerical values
- [ ] Update `get-listing.ts` to return new fields

### Phase 4: Migration

- [ ] Run migration script for existing listings
- [ ] Run migration script for existing public listings
- [ ] Verify all listings have new fields

### Phase 5: Testing

- [ ] Test creating new listing with booking terms
- [ ] Test updating existing listing booking terms
- [ ] Test publishing listing syncs values correctly
- [ ] Test metadata API returns new enums
- [ ] Test validation rejects invalid values
- [ ] Test frontend can display and submit values

### Phase 6: Deployment

- [ ] Deploy to staging
- [ ] Run migrations in staging
- [ ] Test end-to-end in staging
- [ ] Deploy to production
- [ ] Run migrations in production

---

## 9. Frontend Integration

The frontend will receive these new fields in the metadata API response:

```json
{
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

When submitting/updating, send only the key:

```json
{
  "advanceBooking": "DAYS_180",
  "maxBookingDuration": "NIGHTS_30"
}
```

---

## 10. Notes & Considerations

1. **Default Values:** For existing listings without these fields, we'll default to:

   - Advance Booking: `DAYS_180` (6 months)
   - Max Booking Duration: `NIGHTS_30` (1 month)

2. **Public Listings:** Store numerical values (`days` and `nights`) for efficient filtering in search queries.

3. **Validation:** Both fields are **required** for new listings but migration will add defaults to existing ones.

4. **Future Extensibility:** If you need to add more options, just add new enum records to the database - no code changes needed (except validation arrays).

5. **Booking Logic:** These values will be used by the booking system to:

   - Prevent bookings beyond the advance booking window
   - Prevent bookings exceeding maximum duration

6. **Admin Override:** Consider if admins should be able to set custom values outside the preset options (not included in this proposal).

---

**End of Proposal**


