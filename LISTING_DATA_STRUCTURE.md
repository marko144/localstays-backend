# Listing Data Structure Documentation

## Overview

This document describes the complete DynamoDB data structure for property listings in the Localstays platform. Listings use a **single-table design** with multiple record types stored under the same partition key (`HOST#{hostId}`), enabling efficient queries and transactional operations.

---

## Table of Contents

1. [DynamoDB Table Structure](#dynamodb-table-structure)
2. [Core Record Types](#core-record-types)
3. [Listing Metadata](#listing-metadata)
4. [Listing Images](#listing-images)
5. [Listing Amenities](#listing-amenities)
6. [Verification Documents](#verification-documents)
7. [Pricing System](#pricing-system)
8. [Global Secondary Indexes](#global-secondary-indexes)
9. [Enums and Constants](#enums-and-constants)

---

## DynamoDB Table Structure

### Single Table Design

All listing-related data is stored in the main application table using the following key pattern:

```
pk: HOST#{hostId}
sk: {RECORD_TYPE}#{listingId}#{optional_suffix}
```

### Record Types

| Sort Key Pattern                                     | Description                 |
| ---------------------------------------------------- | --------------------------- |
| `LISTING_META#{listingId}`                           | Core listing metadata       |
| `LISTING_IMAGE#{listingId}#{imageId}`                | Individual listing images   |
| `LISTING_AMENITIES#{listingId}`                      | Amenities for the listing   |
| `LISTING_DOC#{listingId}#{documentType}`             | Verification documents      |
| `LISTING_PRICING#{listingId}#BASE#{basePriceId}`     | Base pricing records        |
| `LISTING_PRICING#{listingId}#LENGTH_OF_STAY#{losId}` | Length-of-stay discounts    |
| `LISTING_PRICING#{listingId}#MATRIX`                 | Denormalized pricing matrix |

---

## Core Record Types

## Listing Metadata

The primary record containing all core listing information.

### DynamoDB Keys

```typescript
pk: "HOST#{hostId}";
sk: "LISTING_META#{listingId}";
```

### Full Structure

```typescript
interface ListingMetadata {
  // ============================================================================
  // IDENTIFIERS
  // ============================================================================

  pk: string; // "HOST#{hostId}"
  sk: string; // "LISTING_META#{listingId}"
  listingId: string; // Unique listing identifier
  hostId: string; // Owner's host ID

  // ============================================================================
  // BASIC INFORMATION
  // ============================================================================

  listingName: string; // Property name/title
  propertyType: {
    // Type of property (bilingual)
    key: string; // APARTMENT | HOUSE | VILLA | STUDIO | ROOM
    en: string; // English label
    sr: string; // Serbian label
    isEntirePlace: boolean; // Whether guest rents entire place
  };
  status: ListingStatus; // Current lifecycle status (see Enums section)
  description: string; // Full property description

  // ============================================================================
  // ADDRESS (Mapbox Format)
  // ============================================================================

  address: {
    fullAddress: string; // Complete formatted address
    street: string; // Street name
    streetNumber: string; // Street number
    apartmentNumber?: string; // Optional apartment/unit number
    city: string; // City name
    municipality?: string; // Optional municipality/district
    postalCode: string; // Postal/ZIP code
    country: string; // Country name
    countryCode: string; // ISO country code
    coordinates: {
      latitude: number; // Latitude coordinate
      longitude: number; // Longitude coordinate
    };
    mapboxPlaceId?: string; // Optional Mapbox place identifier
  };

  // ============================================================================
  // MAPBOX LOCATION METADATA (Optional, for internal use)
  // ============================================================================

  mapboxMetadata?: {
    region?: {
      mapbox_id: string; // Mapbox region identifier
      name: string; // Region name (e.g., "Belgrade District")
    };
    place?: {
      mapbox_id: string; // Mapbox place identifier
      name: string; // Place name (e.g., "Belgrade")
    };
  };

  // ============================================================================
  // CAPACITY
  // ============================================================================

  capacity: {
    beds: number; // Number of beds
    sleeps: number; // Maximum guests
  };

  // ============================================================================
  // PRICING
  // ============================================================================

  // Legacy pricing field (optional, may be undefined on new listings)
  pricing?: {
    pricePerNight: number; // Simple per-night price
    currency: string; // 3-letter ISO code (EUR, USD, etc.)
  };

  // Pricing configuration flag
  hasPricing: boolean; // True if detailed pricing has been configured
  // via the pricing API (separate from legacy pricing)

  // ============================================================================
  // POLICIES
  // ============================================================================

  // Pet Policy
  pets: {
    allowed: boolean; // Whether pets are allowed
    policy?: string; // Optional additional policy text
  };

  // Smoking Policy
  smokingAllowed: boolean; // Whether smoking is allowed

  // Cancellation Policy
  cancellationPolicy: {
    type: {
      // Selected preset policy (bilingual)
      key: string; // NO_CANCELLATION | 24_HOURS | 2_DAYS | etc.
      en: string; // English label
      sr: string; // Serbian label
    };
    customText?: string; // Free text if type.key === 'OTHER'
  };

  // ============================================================================
  // CHECK-IN / CHECK-OUT
  // ============================================================================

  checkIn: {
    type: {
      // Check-in method (bilingual)
      key: string; // SELF_CHECKIN | HOST_GREETING | LOCKBOX | DOORMAN
      en: string; // English label
      sr: string; // Serbian label
    };
    description?: string; // Optional additional instructions
    checkInFrom: string; // Earliest check-in time (HH:MM format, e.g., "15:00")
    checkOutBy: string; // Latest check-out time (HH:MM format, e.g., "11:00")
  };

  // ============================================================================
  // PARKING
  // ============================================================================

  parking: {
    type: {
      // Parking availability (bilingual)
      key: string; // NO_PARKING | FREE | PAID
      en: string; // English label
      sr: string; // Serbian label
    };
    description?: string; // Optional additional details
  };

  // ============================================================================
  // PAYMENT TYPE
  // ============================================================================

  paymentType: {
    // Payment method (bilingual)
    key: string; // PAY_ONLINE | PAY_DEPOSIT_ONLINE | PAY_LATER_CASH | PAY_LATER_CARD
    en: string; // English label
    sr: string; // Serbian label
  };

  // ============================================================================
  // S3 REFERENCES
  // ============================================================================

  s3Prefix: string; // Base S3 path for listing files
  // Format: "hosts/{hostId}/listings/{listingId}/"

  // ============================================================================
  // VERIFICATION
  // ============================================================================

  rightToListDocumentNumber?: string; // Optional document reference number
  // (max 30 chars, e.g., property deed #)

  // ============================================================================
  // SUBMISSION WORKFLOW
  // ============================================================================

  submissionToken?: string; // Unique token for confirming submission
  submissionTokenExpiresAt?: string; // ISO timestamp of token expiry

  // ============================================================================
  // METADATA & TIMESTAMPS
  // ============================================================================

  createdAt: string; // ISO timestamp of creation
  updatedAt: string; // ISO timestamp of last update
  submittedAt?: string; // ISO timestamp of submission for review
  approvedAt?: string; // ISO timestamp of admin approval
  rejectedAt?: string; // ISO timestamp of admin rejection
  rejectionReason?: string; // Admin's reason for rejection

  // ============================================================================
  // ADMIN REVIEW TRACKING
  // ============================================================================

  reviewStartedAt?: string; // When admin started reviewing
  reviewedBy?: string; // Admin email who is reviewing

  // ============================================================================
  // ADMIN LOCK (for LOCKED status)
  // ============================================================================

  lockedAt?: string; // When listing was locked
  lockedBy?: string; // Admin user ID who locked it
  lockReason?: string; // Reason for locking

  // ============================================================================
  // SOFT DELETE
  // ============================================================================

  isDeleted: boolean; // Soft delete flag
  deletedAt?: string; // ISO timestamp of deletion
  deletedBy?: string; // hostId or adminId who deleted

  // ============================================================================
  // GLOBAL SECONDARY INDEX ATTRIBUTES
  // ============================================================================

  // GSI2: Query by status (admin review queue)
  gsi2pk?: string; // "LISTING_STATUS#{status}"
  gsi2sk?: string; // ISO timestamp for sorting

  // GSI3: Direct lookup by listingId
  gsi3pk?: string; // "LISTING#{listingId}"
  gsi3sk?: string; // "LISTING_META#{listingId}"
}
```

---

## Listing Images

Individual image records for each listing photo.

### DynamoDB Keys

```typescript
pk: "HOST#{hostId}";
sk: "LISTING_IMAGE#{listingId}#{imageId}";
```

### Structure

```typescript
interface ListingImage {
  // Keys
  pk: string; // "HOST#{hostId}"
  sk: string; // "LISTING_IMAGE#{listingId}#{imageId}"

  // Identifiers
  listingId: string;
  imageId: string; // Unique image identifier

  // Display Properties
  displayOrder: number; // Sort order (1-15)
  isPrimary: boolean; // True for the main listing photo
  caption?: string; // Optional image caption

  // Original Upload (S3)
  s3Key: string; // Path to original file in staging/
  s3Url?: string; // Legacy field for backward compatibility

  // File Metadata (Original)
  contentType: string; // MIME type (image/jpeg, image/png, etc.)
  fileSize: number; // Bytes
  width?: number; // Original image width (px)
  height?: number; // Original image height (px)

  // Processing Status
  status: ImageUploadStatus; // PENDING_UPLOAD | UPLOADED | SCANNING | READY | QUARANTINED
  pendingApproval?: boolean; // True if awaiting admin approval (image updates)

  // Processed Images (WebP Conversions)
  processedAt?: string; // ISO timestamp of processing completion
  webpUrls?: {
    full: string; // Full-size WebP (85% quality) - CloudFront URL
    thumbnail: string; // 400px thumbnail WebP (85% quality) - CloudFront URL
  };
  dimensions?: {
    width: number; // Actual processed image width
    height: number; // Actual processed image height
  };

  // Timestamps
  uploadedAt: string; // ISO timestamp of upload
  updatedAt: string; // ISO timestamp (used for CloudFront cache versioning)

  // Soft Delete
  isDeleted: boolean;
  deletedAt?: string;
}
```

### Image Upload Status Flow

```
PENDING_UPLOAD → UPLOADED → SCANNING → READY
                                    ↓
                              QUARANTINED (if malware detected)
```

---

## Listing Amenities

A single record containing all amenities for a listing.

### DynamoDB Keys

```typescript
pk: "HOST#{hostId}";
sk: "LISTING_AMENITIES#{listingId}";
```

### Structure

```typescript
interface ListingAmenities {
  // Keys
  pk: string; // "HOST#{hostId}"
  sk: string; // "LISTING_AMENITIES#{listingId}"

  // Identifiers
  listingId: string;

  // Amenities Array (Bilingual)
  amenities: Array<{
    key: string; // Amenity key (e.g., WIFI, AIR_CONDITIONING)
    en: string; // English label
    sr: string; // Serbian label
    category: AmenityCategory; // BASICS | KITCHEN | LAUNDRY | etc.
  }>;

  // Metadata
  updatedAt: string; // ISO timestamp
  isDeleted: boolean; // Soft delete flag
}
```

### Amenity Categories

- **BASICS**: WiFi, air conditioning, heating, hot water
- **KITCHEN**: Kitchen, refrigerator, microwave, oven, stove, dishwasher, coffee maker
- **LAUNDRY**: Washing machine, dryer, iron
- **ENTERTAINMENT**: TV, cable TV, streaming services
- **OUTDOOR**: Balcony, terrace, garden, BBQ grill
- **BUILDING**: Elevator, parking, doorman, gym, pool
- **FAMILY**: Crib, high chair, child friendly
- **ACCESSIBILITY**: Wheelchair accessible, step-free access
- **SAFETY**: Smoke detector, carbon monoxide detector, fire extinguisher, first aid kit
- **WORK**: Workspace, desk, office chair

---

## Verification Documents

Documents proving the host's right to list the property.

### DynamoDB Keys

```typescript
pk: "HOST#{hostId}";
sk: "LISTING_DOC#{listingId}#{documentType}";
```

### Structure

```typescript
interface ListingVerificationDocument {
  // Keys
  pk: string; // "HOST#{hostId}"
  sk: string; // "LISTING_DOC#{listingId}#{documentType}"

  // Identifiers
  listingId: string;
  documentType: VerificationDocType; // PROOF_OF_RIGHT_TO_LIST | EXISTING_PROFILE_PROOF

  // S3 References
  s3Key: string; // S3 object key
  s3Url?: string; // Legacy field

  // File Metadata
  contentType: string; // MIME type (application/pdf, image/jpeg, etc.)
  fileSize: number; // Bytes

  // Review Status
  status: DocumentReviewStatus; // PENDING_UPLOAD | PENDING_REVIEW | APPROVED | REJECTED
  reviewedAt?: string; // ISO timestamp of admin review
  reviewNotes?: string; // Admin notes/feedback

  // Timestamps
  uploadedAt: string; // ISO timestamp

  // Soft Delete
  isDeleted: boolean;
  deletedAt?: string;
}
```

---

## Pricing System

The pricing system uses **multiple related records** to support complex pricing configurations including base prices, seasonal pricing, length-of-stay discounts, and members-only pricing.

### Architecture

1. **Normalized Records**: Base prices and length-of-stay discounts stored as individual records (source of truth)
2. **Denormalized Matrix**: Pre-calculated pricing matrix for fast reads (derived data)

### Base Price Records

Stores individual base prices (default year-round or seasonal date ranges).

#### DynamoDB Keys

```typescript
pk: "HOST#{hostId}";
sk: "LISTING_PRICING#{listingId}#BASE#{basePriceId}";
```

#### Structure

```typescript
interface BasePriceRecord {
  // Keys
  pk: string; // "HOST#{hostId}"
  sk: string; // "LISTING_PRICING#{listingId}#BASE#{basePriceId}"

  // Identifiers
  listingId: string;
  basePriceId: string; // "default" for year-round, or "season_{uuid}" for seasonal
  isDefault: boolean; // true for the default year-round price

  // Date Range (null for default)
  dateRange: {
    startDate: string; // ISO format: "2025-06-01"
    endDate: string; // ISO format: "2025-08-31"
    displayStart: string; // European format: "01-06-2025"
    displayEnd: string; // European format: "31-08-2025"
  } | null;

  // Standard Pricing
  standardPrice: number; // Price per night (e.g., 150.00)

  // Members-Only Discount (Optional)
  membersDiscount: {
    type: "PERCENTAGE" | "ABSOLUTE";
    percentage?: number; // If type=PERCENTAGE (e.g., 10 means 10% off)
    absolutePrice?: number; // If type=ABSOLUTE (user-set exact price)
    calculatedPrice: number; // Final price after discount
    calculatedPercentage: number; // Discount percentage (calculated if absolute)
  } | null;

  // Timestamps
  createdAt: string; // ISO timestamp
  updatedAt: string; // ISO timestamp

  // GSI3: Direct lookup by listingId
  gsi3pk: string; // "LISTING#{listingId}"
  gsi3sk: string; // "BASE_PRICE#{basePriceId}"
}
```

### Length-of-Stay Discount Records

Stores discounts based on the length of the booking.

#### DynamoDB Keys

```typescript
pk: "HOST#{hostId}";
sk: "LISTING_PRICING#{listingId}#LENGTH_OF_STAY#{losId}";
```

#### Structure

```typescript
interface LengthOfStayRecord {
  // Keys
  pk: string; // "HOST#{hostId}"
  sk: string; // "LISTING_PRICING#{listingId}#LENGTH_OF_STAY#{losId}"

  // Identifiers
  listingId: string;
  lengthOfStayId: string; // "los_{uuid}"

  // Threshold
  minNights: number; // Minimum nights to qualify (e.g., 7, 14, 30)

  // Discount Configuration
  discountType: "PERCENTAGE" | "ABSOLUTE";
  discountPercentage?: number; // If type=PERCENTAGE (e.g., 5 means 5% off per night)
  discountAbsolute?: number; // If type=ABSOLUTE (€10 off per night)

  // Timestamps
  createdAt: string; // ISO timestamp
  updatedAt: string; // ISO timestamp

  // GSI3: Direct lookup by listingId
  gsi3pk: string; // "LISTING#{listingId}"
  gsi3sk: string; // "LENGTH_OF_STAY#{losId}"
}
```

### Pricing Matrix Record

Denormalized, pre-calculated pricing matrix for fast reads.

#### DynamoDB Keys

```typescript
pk: "HOST#{hostId}";
sk: "LISTING_PRICING#{listingId}#MATRIX";
```

#### Structure

```typescript
interface PricingMatrixRecord {
  // Keys
  pk: string; // "HOST#{hostId}"
  sk: string; // "LISTING_PRICING#{listingId}#MATRIX"

  // Identifiers
  listingId: string;
  currency: string; // 3-letter ISO code (EUR, USD, GBP, RSD, etc.)

  // Pre-calculated Pricing Matrix
  matrix: {
    basePrices: Array<{
      basePriceId: string;
      isDefault: boolean;
      dateRange: {
        startDate: string; // ISO format
        endDate: string; // ISO format
        displayStart: string; // European format
        displayEnd: string; // European format
      } | null;

      // Base pricing
      standardPrice: number;
      membersDiscount: {
        type: "PERCENTAGE" | "ABSOLUTE";
        inputValue: number; // The value user entered
        calculatedPrice: number; // Final price
        calculatedPercentage: number; // Always calculated for display
      } | null;

      // Length-of-stay pricing for this base price
      lengthOfStayPricing: Array<{
        minNights: number;
        discountType: "PERCENTAGE" | "ABSOLUTE";
        discountValue: number; // Percentage or absolute amount
        standardPrice: number; // Calculated price (standard rate)
        membersPrice: number | null; // Calculated price (members rate)
      }>;
    }>;
  };

  // Tourist Tax Configuration (Optional)
  touristTax?: {
    type: "PER_NIGHT" | "PER_STAY"; // Per-night per-person or one-time per-person
    adultAmount: number; // Amount per adult in listing currency
    childAmount: number; // Amount per child in listing currency
  };

  // Timestamps
  lastCalculatedAt: string; // ISO timestamp
  updatedAt: string; // ISO timestamp

  // GSI3: Direct lookup by listingId
  gsi3pk: string; // "LISTING#{listingId}"
  gsi3sk: string; // "PRICING_MATRIX"
}
```

### Pricing System Example

**Scenario**: Host sets up pricing with:

- Base price: €100/night (members: 10% off = €90)
- Summer season (01-06-2025 to 31-08-2025): €150/night (members: €130 absolute)
- Length-of-stay discount: 7+ nights = 5% off per night

**DynamoDB Records Created**:

1. **Base Price - Default**:

   - `sk`: `LISTING_PRICING#listing_123#BASE#default`
   - `standardPrice`: 100
   - `membersDiscount`: `{ type: 'PERCENTAGE', percentage: 10, calculatedPrice: 90, calculatedPercentage: 10 }`

2. **Base Price - Summer**:

   - `sk`: `LISTING_PRICING#listing_123#BASE#season_abc123`
   - `dateRange`: `{ startDate: "2025-06-01", endDate: "2025-08-31", ... }`
   - `standardPrice`: 150
   - `membersDiscount`: `{ type: 'ABSOLUTE', absolutePrice: 130, calculatedPrice: 130, calculatedPercentage: 13.33 }`

3. **Length-of-Stay Discount**:

   - `sk`: `LISTING_PRICING#listing_123#LENGTH_OF_STAY#los_xyz789`
   - `minNights`: 7
   - `discountType`: 'PERCENTAGE'
   - `discountPercentage`: 5

4. **Pricing Matrix** (denormalized for fast reads):
   - `sk`: `LISTING_PRICING#listing_123#MATRIX`
   - Contains pre-calculated prices for all combinations:
     - Default base: €100 standard, €90 members
     - Default base + 7-night discount: €95 standard, €85.50 members
     - Summer base: €150 standard, €130 members
     - Summer base + 7-night discount: €142.50 standard, €123.50 members

---

## Global Secondary Indexes

### GSI2: Query by Status (Admin Review Queue)

**Purpose**: Allow admins to query all listings by status.

```typescript
gsi2pk: "LISTING_STATUS#{status}"; // e.g., "LISTING_STATUS#IN_REVIEW"
gsi2sk: "{timestamp}"; // ISO timestamp for chronological sorting
```

**Query Examples**:

- Get all listings in review: `gsi2pk = "LISTING_STATUS#IN_REVIEW"`
- Get all approved listings: `gsi2pk = "LISTING_STATUS#APPROVED"`

### GSI3: Direct Lookup by Listing ID

**Purpose**: Retrieve listing data without knowing the host ID.

```typescript
gsi3pk: "LISTING#{listingId}";
gsi3sk: "{RECORD_TYPE}#{identifier}";
```

**Sort Key Patterns**:

- Listing metadata: `LISTING_META#{listingId}`
- Base prices: `BASE_PRICE#{basePriceId}`
- Length-of-stay: `LENGTH_OF_STAY#{losId}`
- Pricing matrix: `PRICING_MATRIX`

**Query Example**: Get all pricing data for a listing:

```
gsi3pk = "LISTING#listing_123"
```

Returns: metadata, base prices, length-of-stay discounts, and pricing matrix.

---

## Enums and Constants

### Listing Status

```typescript
type ListingStatus =
  | "DRAFT" // Being created by host
  | "IN_REVIEW" // Submitted, waiting for admin approval
  | "REVIEWING" // Admin is actively reviewing
  | "APPROVED" // Approved by admin, not yet live
  | "REJECTED" // Rejected by admin
  | "ONLINE" // Live and bookable
  | "OFFLINE" // Temporarily deactivated by host
  | "LOCKED" // Admin locked due to violation
  | "ARCHIVED"; // Permanently removed (soft deleted)
```

### Property Types

```typescript
type PropertyType = "APARTMENT" | "HOUSE" | "VILLA" | "STUDIO" | "ROOM";
```

### Check-In Types

```typescript
type CheckInType =
  | "SELF_CHECKIN" // Guest can check in without host
  | "HOST_GREETING" // Host greets guest in person
  | "LOCKBOX" // Key available in lockbox
  | "DOORMAN"; // Building doorman assists
```

### Parking Types

```typescript
type ParkingType =
  | "NO_PARKING" // No parking available
  | "FREE" // Free parking available
  | "PAID"; // Paid parking available
```

### Payment Types

```typescript
type PaymentType =
  | "PAY_ONLINE" // Full payment online via platform
  | "PAY_DEPOSIT_ONLINE" // Deposit online, remainder later
  | "PAY_LATER_CASH" // Pay in cash on arrival
  | "PAY_LATER_CARD"; // Pay by card on arrival
```

### Cancellation Policy Types

```typescript
type CancellationPolicyType =
  | "NO_CANCELLATION" // No refunds
  | "24_HOURS" // Full refund if cancelled 24h before
  | "2_DAYS" // Full refund if cancelled 2 days before
  | "3_DAYS" // Full refund if cancelled 3 days before
  | "4_DAYS" // Full refund if cancelled 4 days before
  | "ONE_WEEK" // Full refund if cancelled 1 week before
  | "OTHER"; // Custom policy (requires customText)
```

### Amenity Keys (Examples)

```typescript
type AmenityKey =
  // Basics
  | "WIFI"
  | "AIR_CONDITIONING"
  | "HEATING"
  | "HOT_WATER"
  // Kitchen
  | "KITCHEN"
  | "REFRIGERATOR"
  | "MICROWAVE"
  | "OVEN"
  | "STOVE"
  | "DISHWASHER"
  | "COFFEE_MAKER"
  // Laundry
  | "WASHING_MACHINE"
  | "DRYER"
  | "IRON"
  // Entertainment
  | "TV"
  | "CABLE_TV"
  | "STREAMING_SERVICES"
  // Comfort
  | "BED_LINENS"
  | "TOWELS"
  | "TOILETRIES"
  | "HAIR_DRYER"
  // Outdoor
  | "BALCONY"
  | "TERRACE"
  | "GARDEN"
  | "BBQ_GRILL"
  // Building
  | "ELEVATOR"
  | "PARKING"
  | "DOORMAN"
  | "GYM"
  | "POOL"
  // Family
  | "CRIB"
  | "HIGH_CHAIR"
  | "CHILD_FRIENDLY"
  // Accessibility
  | "WHEELCHAIR_ACCESSIBLE"
  | "STEP_FREE_ACCESS"
  // Safety
  | "SMOKE_DETECTOR"
  | "CARBON_MONOXIDE_DETECTOR"
  | "FIRE_EXTINGUISHER"
  | "FIRST_AID_KIT"
  // Work
  | "WORKSPACE"
  | "DESK"
  | "OFFICE_CHAIR";
```

### Image Upload Status

```typescript
type ImageUploadStatus =
  | "PENDING_UPLOAD" // Waiting for upload to S3
  | "UPLOADED" // Uploaded to staging, awaiting scan
  | "SCANNING" // Being scanned by GuardDuty
  | "READY" // Processed and ready for display
  | "QUARANTINED"; // Infected with malware
```

### Document Review Status

```typescript
type DocumentReviewStatus =
  | "PENDING_UPLOAD" // Not yet uploaded
  | "PENDING_REVIEW" // Uploaded, awaiting admin review
  | "APPROVED" // Approved by admin
  | "REJECTED"; // Rejected by admin
```

### Verification Document Types

```typescript
type VerificationDocType =
  | "PROOF_OF_RIGHT_TO_LIST" // Property deed, rental agreement, etc.
  | "EXISTING_PROFILE_PROOF"; // Proof from another platform (Airbnb, Booking.com, etc.)
```

---

## Data Relationships

### How Records Hang Together

```
HOST#{hostId}
├── LISTING_META#{listingId}                      ← Core metadata
├── LISTING_IMAGE#{listingId}#{imageId}           ← Multiple images
├── LISTING_AMENITIES#{listingId}                 ← Single amenities record
├── LISTING_DOC#{listingId}#{documentType}        ← Verification documents
└── LISTING_PRICING#{listingId}#...
    ├── BASE#{basePriceId}                        ← Base prices (normalized)
    ├── LENGTH_OF_STAY#{losId}                    ← LOS discounts (normalized)
    └── MATRIX                                    ← Pre-calculated matrix (denormalized)
```

### Query Patterns

1. **Get All Data for a Listing (by hostId)**:

   ```
   pk = "HOST#{hostId}"
   sk BEGINS_WITH "LISTING_"
   ```

2. **Get Specific Listing Metadata**:

   ```
   pk = "HOST#{hostId}"
   sk = "LISTING_META#{listingId}"
   ```

3. **Get All Images for a Listing**:

   ```
   pk = "HOST#{hostId}"
   sk BEGINS_WITH "LISTING_IMAGE#{listingId}#"
   ```

4. **Get All Pricing Data for a Listing**:

   ```
   pk = "HOST#{hostId}"
   sk BEGINS_WITH "LISTING_PRICING#{listingId}#"
   ```

5. **Get Listing by ID (without knowing hostId)**:

   ```
   GSI3: gsi3pk = "LISTING#{listingId}"
   ```

6. **Get All Listings in Review (Admin)**:
   ```
   GSI2: gsi2pk = "LISTING_STATUS#IN_REVIEW"
   ```

---

## API Response Formats

### Get Listing Response

```typescript
{
  listing: {
    listingId: string;
    hostId: string;
    listingName: string;
    propertyType: BilingualEnum & { isEntirePlace: boolean };
    status: ListingStatus;
    description: string;
    address: { /* full address object */ };
    capacity: { beds: number; sleeps: number };
    pricing?: { pricePerNight: number; currency: string };
    hasPricing: boolean;
    pets: { allowed: boolean; policy?: string };
    checkIn: { type: BilingualEnum; description?: string; checkInFrom: string; checkOutBy: string };
    parking: { type: BilingualEnum; description?: string };
    smokingAllowed: boolean;
    cancellationPolicy: { type: BilingualEnum; customText?: string };
    createdAt: string;
    updatedAt: string;
    submittedAt?: string;
    approvedAt?: string;
    rejectedAt?: string;
    rejectionReason?: string;
  };
  images: Array<{
    imageId: string;
    thumbnailUrl: string;
    fullUrl: string;
    displayOrder: number;
    isPrimary: boolean;
    caption?: string;
    width: number;
    height: number;
  }>;
  amenities: Array<BilingualEnum & { category: AmenityCategory }>;
  verificationDocuments?: Array<{
    documentType: VerificationDocType;
    status: DocumentReviewStatus;
    contentType: string;
    uploadedAt: string;
  }>;
}
```

### Get Pricing Response

```typescript
{
  listingId: string;
  currency: string;                    // EUR, USD, GBP, RSD, etc.
  configuration: {
    basePrice: {
      standardPrice: number;
      membersDiscount: {
        type: 'PERCENTAGE' | 'ABSOLUTE';
        percentage?: number;
        absolutePrice?: number;
      } | null;
    };
    seasonalPrices: Array<{
      basePriceId: string;
      dateRange: { startDate: string; endDate: string };  // European format
      standardPrice: number;
      membersDiscount: { /* same as basePrice */ } | null;
    }>;
    lengthOfStayDiscounts: Array<{
      lengthOfStayId: string;
      minNights: number;
      discountType: 'PERCENTAGE' | 'ABSOLUTE';
      discountPercentage?: number;
      discountAbsolute?: number;
    }>;
    touristTax?: {
      type: 'PER_NIGHT' | 'PER_STAY';
      adultAmount: number;
      childAmount: number;
    };
  };
  matrix: {
    basePrices: Array<{
      basePriceId: string;
      isDefault: boolean;
      dateRange: { /* full date range */ } | null;
      standardPrice: number;
      membersDiscount: { /* calculated values */ } | null;
      lengthOfStayPricing: Array<{
        minNights: number;
        discountType: 'PERCENTAGE' | 'ABSOLUTE';
        discountValue: number;
        standardPrice: number;
        membersPrice: number | null;
      }>;
    }>;
  };
  lastUpdatedAt: string;
}
```

---

## Notes

1. **Bilingual Support**: Most enum values (property types, check-in types, parking, etc.) are stored with English and Serbian labels to support the bilingual platform.

2. **Soft Deletes**: All major entities use `isDeleted` flag instead of hard deletes to maintain audit trails.

3. **CloudFront Integration**: Image URLs point to CloudFront CDN for optimal performance.

4. **S3 Structure**: All listing files follow the pattern:

   ```
   hosts/{hostId}/listings/{listingId}/
   ├── images/
   │   ├── staging/{imageId}.{ext}       ← Original uploads
   │   └── processed/{imageId}/          ← WebP conversions
   │       ├── full.webp
   │       └── thumbnail.webp
   └── documents/
       └── {documentType}.{ext}
   ```

5. **Pricing Complexity**: The pricing system supports extremely flexible configurations while maintaining fast read performance through the denormalized pricing matrix.

6. **GSI Usage**: Global Secondary Indexes enable efficient queries without knowing the partition key (hostId), critical for admin operations and public listing searches.

---

## Related Documentation

- [LISTING_PRICING_SYSTEM.md](./LISTING_PRICING_SYSTEM.md) - Detailed pricing system architecture
- [MAPBOX\_\_NEW_RATE_LIMITING_IMPLEMENTATION.md](./MAPBOX__NEW_RATE_LIMITING_IMPLEMENTATION.md) - Address geocoding rate limiting

---

**Last Updated**: 2024-11-19
