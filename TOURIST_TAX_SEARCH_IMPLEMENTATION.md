# Tourist Tax Search API Implementation Plan

## Overview

Enhance the search API to:

1. Accept individual child ages (not just count)
2. Calculate tourist tax based on guest ages and pricing matrix
3. Respect `taxesIncludedInPrice` flag
4. Add tourist tax to total price (if not included)
5. Return detailed tax breakdown

---

## Phase 1: `taxesIncludedInPrice` Flag ✅ COMPLETE

### Changes Made

#### 1. Updated `ListingMetadata` Interface

**File:** `backend/services/types/listing.types.ts`

```typescript
export interface ListingMetadata {
  // ... existing fields
  hasPricing: boolean;
  taxesIncludedInPrice: boolean; // NEW: True if tourist tax is included in accommodation price
  // ... rest of fields
}
```

#### 2. Updated `GetListingResponse`

```typescript
export interface GetListingResponse {
  listing: {
    // ... existing fields
    hasPricing: boolean;
    taxesIncludedInPrice: boolean; // NEW
    // ... rest of fields
  };
  // ...
}
```

#### 3. Updated `UpdateListingMetadataRequest`

```typescript
export interface UpdateListingMetadataRequest {
  updates: {
    // ... existing fields
    taxesIncludedInPrice?: boolean; // NEW
  };
}
```

#### 4. Updated `PublicListingRecord`

**File:** `backend/services/types/public-listing.types.ts`

```typescript
export interface PublicListingRecord {
  // ... existing fields
  officialStarRating?: number;
  taxesIncludedInPrice: boolean; // NEW
  createdAt: string;
  updatedAt: string;
}
```

### Default Value

**Recommendation:** Default to `false` (taxes NOT included)

- Safer assumption
- Encourages hosts to explicitly set the flag
- Prevents accidentally hiding tax from guests

---

## Phase 2: Search API Enhancement (TO IMPLEMENT)

### Step 1: Update Query Parameters

#### Current Parameters

```
GET /api/v1/guest/search?
  locationSlug=zlatibor-serbia
  &checkIn=2025-12-20
  &checkOut=2025-12-27
  &adults=2
  &children=3              // Just a count
```

#### New Parameters

```
GET /api/v1/guest/search?
  locationSlug=zlatibor-serbia
  &checkIn=2025-12-20
  &checkOut=2025-12-27
  &adults=2
  &childAges=[5,7,15]      // NEW: JSON array of individual ages
```

#### Validation Rules

```typescript
childAges?: number[]

Validation:
✓ Optional parameter (can be omitted or empty array)
✓ Must be valid JSON array if provided
✓ Each element must be integer 0-17
✓ Maximum 50 children
✓ Can have duplicate ages (e.g., [5, 5, 7])
✓ Array length determines number of children

Backward Compatibility:
- If childAges provided: children = childAges.length
- If only children provided (legacy): assume all children are age 10
```

---

### Step 2: Update Response Structure

#### Current Response

```typescript
pricing: {
  currency: "EUR",
  totalPrice: 700.00,              // Accommodation only
  pricePerNight: 100.00,
  breakdown: [...],
  touristTax: {                    // Just the rates, no calculation
    type: "PER_NIGHT",
    adultAmount: 2.50,
    childRates: [...]
  } | null
}
```

#### New Response

```typescript
pricing: {
  currency: "EUR",

  // Accommodation pricing
  accommodationPrice: 700.00,      // RENAMED from totalPrice
  pricePerNight: 100.00,
  breakdown: [...],
  lengthOfStayDiscount: {...},
  membersPricingApplied: boolean,

  // NEW: Tourist tax calculation
  touristTaxAmount: 52.50,         // Calculated total (0 if taxesIncludedInPrice=true)
  touristTaxIncludedInPrice: false, // Flag from listing
  touristTaxBreakdown: {
    type: "PER_NIGHT",
    rates: {
      adult: {
        count: 2,
        amountPerPerson: 2.50,     // Per night if PER_NIGHT, per stay if PER_STAY
        subtotal: 5.00
      },
      children: [
        {
          count: 1,
          ageRange: "0-7 years",
          ageRangeLocal: "0-7 godina",
          amountPerPerson: 0,
          subtotal: 0
        },
        {
          count: 2,
          ageRange: "7-17 years",
          ageRangeLocal: "7-17 godina",
          amountPerPerson: 1.50,
          subtotal: 3.00
        }
      ]
    },
    subtotalPerNight: 8.00,        // Sum of all subtotals
    nights: 7,
    total: 56.00                   // subtotalPerNight × nights (if PER_NIGHT)
  } | null,

  // Grand total
  totalPrice: 756.00               // accommodationPrice + touristTaxAmount
}
```

---

### Step 3: Tax Calculation Logic

#### Function: `calculateTouristTax()`

```typescript
function calculateTouristTax(
  touristTax: TouristTax,
  adults: number,
  childAges: number[],
  nights: number,
  taxesIncludedInPrice: boolean // NEW: Flag from listing
): {
  totalAmount: number;
  breakdown: TouristTaxBreakdown;
} {
  // Step 1: Calculate adult tax
  const adultSubtotal = adults * touristTax.adultAmount;

  // Step 2: Group children by matching rate
  const childrenByRate = new Map<
    string,
    { rate: ChildTouristTaxRate; count: number }
  >();

  for (const age of childAges) {
    const matchingRate = touristTax.childRates.find(
      (rate) => age >= rate.ageFrom && age <= rate.ageTo
    );

    if (!matchingRate) {
      // Defensive: Frontend should guarantee coverage, but fallback to €0
      console.warn(
        `No tourist tax rate found for child age ${age}, charging 0`
      );
      continue;
    }

    const key = matchingRate.childRateId;
    if (!childrenByRate.has(key)) {
      childrenByRate.set(key, { rate: matchingRate, count: 0 });
    }
    childrenByRate.get(key)!.count++;
  }

  // Step 3: Build children breakdown
  const childrenBreakdown = Array.from(childrenByRate.values()).map(
    ({ rate, count }) => ({
      count,
      ageRange: rate.displayLabel.en,
      ageRangeLocal: rate.displayLabel.sr,
      amountPerPerson: rate.amount,
      subtotal: count * rate.amount,
    })
  );

  // Step 4: Calculate subtotal (before night multiplication)
  const childSubtotal = childrenBreakdown.reduce(
    (sum, c) => sum + c.subtotal,
    0
  );
  const subtotalPerNight = adultSubtotal + childSubtotal;

  // Step 5: Apply night multiplier if PER_NIGHT
  let total =
    touristTax.type === "PER_NIGHT"
      ? subtotalPerNight * nights
      : subtotalPerNight;

  // Step 6: If taxes are included in price, return 0 for totalAmount
  // but still return the breakdown for informational purposes
  const totalAmount = taxesIncludedInPrice ? 0 : total;

  return {
    totalAmount: Math.round(totalAmount * 100) / 100,
    breakdown: {
      type: touristTax.type,
      rates: {
        adult: {
          count: adults,
          amountPerPerson: touristTax.adultAmount,
          subtotal: adultSubtotal,
        },
        children: childrenBreakdown,
      },
      subtotalPerNight: Math.round(subtotalPerNight * 100) / 100,
      nights,
      total: Math.round(total * 100) / 100,
    },
  };
}
```

#### Key Logic Points

1. **Adult Calculation**

   - Simple: `adults × adultAmount`

2. **Child Calculation**

   - Group children by matching rate bracket
   - Each child finds their rate based on age
   - Count children per bracket
   - Calculate subtotal per bracket

3. **Night Multiplication**

   - `PER_NIGHT`: Multiply by number of nights
   - `PER_STAY`: Don't multiply (one-time fee)

4. **Taxes Included Flag**
   - If `taxesIncludedInPrice = true`:
     - `touristTaxAmount = 0` (don't add to total)
     - Still return full `touristTaxBreakdown` (for display)
   - If `taxesIncludedInPrice = false`:
     - `touristTaxAmount = calculated total`
     - Add to `totalPrice`

---

### Step 4: Update `calculateListingPrice()` Function

**File:** `backend/services/api/guest/search-listings.ts` (lines 770-848)

```typescript
function calculateListingPrice(
  pricingMatrix: PricingMatrixRecord,
  nightDates: string[],
  isAuthenticated: boolean,
  adults: number,                    // NEW
  childAges: number[],               // NEW
  taxesIncludedInPrice: boolean      // NEW
): ListingPricing {
  const { matrix, currency, touristTax } = pricingMatrix;
  const nights = nightDates.length;

  // ... existing accommodation price calculation (lines 778-824)
  // This calculates: totalPrice, finalBreakdown, losDiscount, etc.

  // NEW: Calculate tourist tax
  let touristTaxAmount = 0;
  let touristTaxBreakdown = null;

  if (touristTax) {
    const taxCalc = calculateTouristTax(
      touristTax,
      adults,
      childAges,
      nights,
      taxesIncludedInPrice
    );

    touristTaxAmount = taxCalc.totalAmount;  // Will be 0 if taxesIncludedInPrice=true
    touristTaxBreakdown = taxCalc.breakdown;
  }

  return {
    currency,
    accommodationPrice: Math.round(totalPrice * 100) / 100,
    pricePerNight: Math.round((totalPrice / nights) * 100) / 100,
    breakdown: finalBreakdown,
    lengthOfStayDiscount: losDiscount ? {...} : null,
    membersPricingApplied: isAuthenticated && nightlyBreakdown.some((n) => n.isMembersPrice),
    touristTaxAmount: Math.round(touristTaxAmount * 100) / 100,
    touristTaxIncludedInPrice: taxesIncludedInPrice,
    touristTaxBreakdown,
    totalPrice: Math.round((totalPrice + touristTaxAmount) * 100) / 100,
  };
}
```

---

### Step 5: Update TypeScript Interfaces

**File:** `backend/services/api/guest/search-listings.ts` (lines 60-87)

```typescript
interface ListingPricing {
  currency: string;
  accommodationPrice: number; // RENAMED from totalPrice
  pricePerNight: number;
  breakdown: NightlyPriceBreakdown[];
  lengthOfStayDiscount: {
    applied: boolean;
    minNights: number;
    discountType: "PERCENTAGE" | "ABSOLUTE";
    discountValue: number;
    totalSavings: number;
  } | null;
  membersPricingApplied: boolean;

  // NEW: Tourist tax fields
  touristTaxAmount: number;
  touristTaxIncludedInPrice: boolean;
  touristTaxBreakdown: {
    type: "PER_NIGHT" | "PER_STAY";
    rates: {
      adult: {
        count: number;
        amountPerPerson: number;
        subtotal: number;
      };
      children: Array<{
        count: number;
        ageRange: string;
        ageRangeLocal: string;
        amountPerPerson: number;
        subtotal: number;
      }>;
    };
    subtotalPerNight: number;
    nights: number;
    total: number;
  } | null;

  totalPrice: number; // Grand total (accommodation + tax if not included)
}
```

---

## Implementation Checklist

### Phase 1: Flag ✅

- [x] Add `taxesIncludedInPrice` to `ListingMetadata`
- [x] Add `taxesIncludedInPrice` to `GetListingResponse`
- [x] Add `taxesIncludedInPrice` to `UpdateListingMetadataRequest`
- [x] Add `taxesIncludedInPrice` to `PublicListingRecord`
- [x] Add `taxesIncludedInPrice` to `PublicListingResponse`

### Phase 2: Search API (TODO)

- [ ] Update validation to accept `childAges` parameter
- [ ] Add backward compatibility for legacy `children` parameter
- [ ] Implement `calculateTouristTax()` function
- [ ] Update `calculateListingPrice()` to call tax calculation
- [ ] Pass `adults`, `childAges`, `taxesIncludedInPrice` through pipeline
- [ ] Update `ListingPricing` interface
- [ ] Update function call to include new parameters
- [ ] Test with various scenarios

### Phase 3: Existing Endpoints (TODO)

- [ ] Update `submit-intent.ts` to accept `taxesIncludedInPrice`
- [ ] Update `update-listing.ts` to accept `taxesIncludedInPrice`
- [ ] Update `publish-listing.ts` to copy flag to public listing
- [ ] Update `get-listing.ts` to return flag
- [ ] Create migration script for existing listings (default to `false`)

### Phase 4: Documentation (TODO)

- [ ] Update `GUEST_API_DOCUMENTATION.md`
- [ ] Update `LISTING_SEARCH_API_IMPLEMENTATION.md`
- [ ] Update `FRONTEND_SEARCH_API.md`
- [ ] Create frontend integration guide for `childAges` parameter

---

## Example Scenarios

### Scenario 1: Taxes NOT Included (taxesIncludedInPrice = false)

**Request:**

```
GET /api/v1/guest/search?
  locationSlug=zlatibor-serbia
  &checkIn=2025-12-20
  &checkOut=2025-12-27
  &adults=2
  &childAges=[5,7,15]
```

**Response:**

```json
{
  "pricing": {
    "currency": "EUR",
    "accommodationPrice": 700.0,
    "pricePerNight": 100.0,
    "touristTaxAmount": 56.0,
    "touristTaxIncludedInPrice": false,
    "touristTaxBreakdown": {
      "type": "PER_NIGHT",
      "rates": {
        "adult": {
          "count": 2,
          "amountPerPerson": 2.5,
          "subtotal": 5.0
        },
        "children": [
          {
            "count": 1,
            "ageRange": "0-7 years",
            "ageRangeLocal": "0-7 godina",
            "amountPerPerson": 0,
            "subtotal": 0
          },
          {
            "count": 2,
            "ageRange": "7-17 years",
            "ageRangeLocal": "7-17 godina",
            "amountPerPerson": 1.5,
            "subtotal": 3.0
          }
        ]
      },
      "subtotalPerNight": 8.0,
      "nights": 7,
      "total": 56.0
    },
    "totalPrice": 756.0
  }
}
```

**Frontend Display:**

```
Accommodation: €700.00
Tourist Tax: €56.00
  Adults (2) × €2.50/night = €5.00/night
  Children 0-7 (1) × €0/night = €0/night
  Children 7-17 (2) × €1.50/night = €3.00/night
  Subtotal: €8.00/night × 7 nights
─────────────────────
Total: €756.00
```

---

### Scenario 2: Taxes INCLUDED (taxesIncludedInPrice = true)

**Request:** Same as above

**Response:**

```json
{
  "pricing": {
    "currency": "EUR",
    "accommodationPrice": 700.00,
    "pricePerNight": 100.00,
    "touristTaxAmount": 0,           // NOT added to total
    "touristTaxIncludedInPrice": true,
    "touristTaxBreakdown": {
      "type": "PER_NIGHT",
      "rates": {
        "adult": {
          "count": 2,
          "amountPerPerson": 2.50,
          "subtotal": 5.00
        },
        "children": [...]
      },
      "subtotalPerNight": 8.00,
      "nights": 7,
      "total": 56.00               // Still shows what tax would be
    },
    "totalPrice": 700.00            // Tax NOT added
  }
}
```

**Frontend Display:**

```
Accommodation: €700.00
  (Tourist tax included: €56.00)
  ⓘ This price includes all taxes
─────────────────────
Total: €700.00
```

---

## Migration Strategy

### Existing Listings

**Default Value:** `taxesIncludedInPrice = false`

**Migration Script:**

```typescript
// backend/services/migrations/add-taxes-included-flag.ts

async function migrateListings() {
  // Scan all LISTING_META# records
  // Add taxesIncludedInPrice: false to each
  // Also add to corresponding PublicListingRecord
}
```

**Rationale:**

- Safer to assume taxes are NOT included
- Prevents accidentally hiding costs from guests
- Hosts can explicitly enable if they include taxes

---

## Questions/Decisions

1. ✅ **Default value for flag?** → `false` (taxes NOT included)
2. ✅ **Show breakdown when included?** → Yes (for transparency)
3. ✅ **Child age not covered?** → Charge €0 (defensive fallback)
4. ✅ **Query parameter format?** → JSON array `childAges=[5,7,15]`
5. ✅ **Backward compatibility?** → Support legacy `children` parameter

---

## Next Steps

1. ✅ **Phase 1 Complete:** Flag added to types
2. **Implement Phase 2:** Search API enhancement
3. **Implement Phase 3:** Update existing endpoints
4. **Create migrations:** Add flag to existing listings
5. **Update documentation:** Frontend integration guides
6. **Deploy & test:** Staging environment

**Ready to proceed with Phase 2 implementation?**



