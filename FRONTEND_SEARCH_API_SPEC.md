# Search API Frontend Specification & Test Plan

## Deployment

✅ **Deployed to Staging**: December 1, 2025, 9:39 PM

**Base URL**: `https://40usmhyfm9.execute-api.eu-north-1.amazonaws.com/staging/`

---

## API Changes Summary

### 🔴 **BREAKING CHANGE**

The `children` query parameter (integer count) has been **replaced** with `childAges` (comma-separated ages).

### New Features

1. **Individual child ages** for accurate tourist tax calculation
2. **Booking terms filtering** (min/max nights, advance booking)
3. **Enhanced tourist tax response** with detailed breakdown
4. **Optional tourist tax** based on `taxesIncludedInPrice` flag

---

## API Endpoint

### `GET /api/v1/guest/search`

#### Query Parameters

| Parameter       | Type           | Required | Format       | Description                       | Changes    |
| --------------- | -------------- | -------- | ------------ | --------------------------------- | ---------- |
| `locationSlug`  | string         | Yes\*    | `belgrade`   | Location slug (preferred)         | No change  |
| `locationId`    | string         | Yes\*    | UUID         | Location ID (fallback)            | No change  |
| `checkIn`       | string         | Yes      | `YYYY-MM-DD` | Check-in date                     | No change  |
| `checkOut`      | string         | Yes      | `YYYY-MM-DD` | Check-out date                    | No change  |
| `adults`        | integer        | Yes      | `1-50`       | Number of adults                  | No change  |
| `childAges`     | string         | No       | `0,5,12,7`   | Comma-separated child ages (0-17) | **NEW** ⚠️ |
| `cursor`        | string         | No       | Base64       | Pagination cursor                 | No change  |
| Various filters | boolean/string | No       | See below    | Amenity/feature filters           | No change  |

**\*Either `locationSlug` OR `locationId` is required**

#### ⚠️ **Migration Guide: `children` → `childAges`**

**Old Format** (DEPRECATED):

```
GET /api/v1/guest/search?locationSlug=belgrade&checkIn=2025-12-15&checkOut=2025-12-20&adults=2&children=3
```

**New Format** (REQUIRED):

```
GET /api/v1/guest/search?locationSlug=belgrade&checkIn=2025-12-15&checkOut=2025-12-20&adults=2&childAges=5,8,12
```

**If no children**:

```
GET /api/v1/guest/search?locationSlug=belgrade&checkIn=2025-12-15&checkOut=2025-12-20&adults=2
```

(Omit `childAges` parameter entirely)

#### Validation Rules

- Each child age must be between `0` and `17` (inclusive)
- Maximum 50 children
- Total guests (adults + children) cannot exceed 50
- Invalid ages return `400 Bad Request`

**Examples**:

- ✅ `childAges=0,5,12,17` - Valid
- ✅ `childAges=7` - Single child
- ✅ `childAges=5,5,5` - Three children all age 5 (allowed)
- ❌ `childAges=18` - Invalid (too old)
- ❌ `childAges=-1` - Invalid (negative)
- ❌ `childAges=5,abc` - Invalid (not a number)

---

## Response Structure Changes

### Updated `ListingPricing` Type

```typescript
interface ListingPricing {
  currency: string;
  totalPrice: number; // Base price WITHOUT tourist tax
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

  // ⚠️ When taxesIncludedInPrice = false
  totalPriceWithTax?: number; // Base price + tourist tax
  touristTaxAmount?: number;
  touristTaxBreakdown?: {
    adults: {
      count: number;
      perNight: number;
      total: number;
    };
    children: Array<{
      count: number;
      ageFrom: number;
      ageTo: number;
      perNight: number;
      total: number;
      displayLabel: {
        en: string;
        sr: string;
      };
    }>;
  };

  // ⚠️ When taxesIncludedInPrice = true
  taxesIncludedInPrice?: boolean; // Will be true when taxes are included in totalPrice
}
```

### Tourist Tax Scenarios

#### Scenario 1: Taxes NOT Included in Price (`taxesIncludedInPrice = false`)

**Tourist tax IS calculated and returned separately**

```json
{
  "pricing": {
    "currency": "EUR",
    "totalPrice": 500.00,         // Base price WITHOUT tax
    "totalPriceWithTax": 547.50,  // Base (500) + Tourist Tax (47.50) ⚠️ NEW
    "pricePerNight": 100,
    "breakdown": [...],
    "touristTaxAmount": 47.50,
    "touristTaxBreakdown": {
      "adults": {
        "count": 2,
        "perNight": 2.50,
        "total": 25.00  // 2 adults × €2.50 × 5 nights
      },
      "children": [
        {
          "count": 2,
          "ageFrom": 0,
          "ageTo": 7,
          "perNight": 0,
          "total": 0,
          "displayLabel": {
            "en": "Children 0-7 years",
            "sr": "Deca 0-7 godina"
          }
        },
        {
          "count": 1,
          "ageFrom": 8,
          "ageTo": 17,
          "perNight": 1.90,
          "total": 9.50,  // 1 child × €1.90 × 5 nights
          "displayLabel": {
            "en": "Children 8-17 years",
            "sr": "Deca 8-17 godina"
          }
        }
      ]
    }
  }
}
```

#### Scenario 2: Taxes Included in Price (`taxesIncludedInPrice = true`)

**NO tourist tax calculated, flag returned to indicate taxes are included**

```json
{
  "pricing": {
    "currency": "EUR",
    "totalPrice": 500.00,  // All-inclusive price (tax already included)
    "pricePerNight": 100,
    "breakdown": [...],
    "membersPricingApplied": false,
    "taxesIncludedInPrice": true  // ⚠️ NEW - Frontend can show "Taxes included"
    // NO touristTaxAmount, totalPriceWithTax, or touristTaxBreakdown fields
  }
}
```

#### Scenario 3: No Tourist Tax Configured

**Same as taxes included - no tourist tax fields**

```json
{
  "pricing": {
    "currency": "EUR",
    "totalPrice": 500.00,
    "pricePerNight": 100,
    "breakdown": [...],
    "membersPricingApplied": false
    // NO touristTaxAmount or touristTaxBreakdown fields
  }
}
```

---

## Frontend Implementation

### TypeScript Types

```typescript
interface SearchListingsRequest {
  locationSlug?: string;
  locationId?: string;
  checkIn: string; // YYYY-MM-DD
  checkOut: string; // YYYY-MM-DD
  adults: number;
  childAges?: number[]; // NEW: Array of child ages (0-17)
  cursor?: string;
  // ... filters
}

interface ListingPricing {
  currency: string;
  totalPrice: number;
  pricePerNight: number;
  breakdown: NightlyPriceBreakdown[];
  lengthOfStayDiscount: LengthOfStayDiscount | null;
  membersPricingApplied: boolean;

  // Optional tourist tax info
  touristTaxAmount?: number;
  touristTaxBreakdown?: {
    adults: {
      count: number;
      perNight: number;
      total: number;
    };
    children: Array<{
      count: number;
      ageFrom: number;
      ageTo: number;
      perNight: number;
      total: number;
      displayLabel: {
        en: string;
        sr: string;
      };
    }>;
  };
}

interface SearchResult {
  listingId: string;
  // ... other listing fields
  pricing: ListingPricing;
}

interface SearchResponse {
  listings: SearchResult[];
  pagination: {
    hasMore: boolean;
    nextCursor: string | null;
    totalReturned: number;
  };
  searchMeta: {
    locationId: string;
    checkIn: string;
    checkOut: string;
    nights: number;
    adults: number;
    children: number; // Calculated count from childAges.length
    totalGuests: number;
  };
}
```

### Query String Builder

```typescript
function buildSearchQuery(params: SearchListingsRequest): string {
  const queryParams = new URLSearchParams();

  if (params.locationSlug) {
    queryParams.append("locationSlug", params.locationSlug);
  } else if (params.locationId) {
    queryParams.append("locationId", params.locationId);
  }

  queryParams.append("checkIn", params.checkIn);
  queryParams.append("checkOut", params.checkOut);
  queryParams.append("adults", params.adults.toString());

  // NEW: Convert child ages array to comma-separated string
  if (params.childAges && params.childAges.length > 0) {
    queryParams.append("childAges", params.childAges.join(","));
  }

  if (params.cursor) {
    queryParams.append("cursor", params.cursor);
  }

  // Add filters...

  return queryParams.toString();
}
```

### UI Display Examples

#### Tourist Tax Display

```tsx
function PricingDisplay({ pricing }: { pricing: ListingPricing }) {
  return (
    <div className="pricing-display">
      {/* Base price */}
      <div className="price-line">
        <span>Accommodation</span>
        <span>
          {pricing.totalPrice.toFixed(2)} {pricing.currency}
        </span>
      </div>

      {/* Tourist tax breakdown (if not included) */}
      {pricing.touristTaxAmount && pricing.touristTaxBreakdown && (
        <>
          <div className="tax-section">
            <div className="tax-line">
              <span>
                Adults ({pricing.touristTaxBreakdown.adults.count}×) @{" "}
                {pricing.touristTaxBreakdown.adults.perNight} per night
              </span>
              <span>{pricing.touristTaxBreakdown.adults.total.toFixed(2)}</span>
            </div>

            {pricing.touristTaxBreakdown.children.map((childRate, index) => (
              <div key={index} className="tax-line">
                <span>
                  {childRate.displayLabel.en} ({childRate.count}×) @{" "}
                  {childRate.perNight} per night
                </span>
                <span>{childRate.total.toFixed(2)}</span>
              </div>
            ))}
          </div>

          {/* Total with tax */}
          <div className="total-line">
            <strong>Total</strong>
            <strong>
              {pricing.totalPriceWithTax!.toFixed(2)} {pricing.currency}
            </strong>
          </div>
        </>
      )}

      {/* Taxes included message */}
      {pricing.taxesIncludedInPrice && (
        <div className="taxes-included-notice">
          <span>✓ Taxes included in price</span>
          <strong>
            {pricing.totalPrice.toFixed(2)} {pricing.currency}
          </strong>
        </div>
      )}
    </div>
  );
}
```

#### Child Age Selector

```tsx
function ChildAgeSelector({
  onChange,
}: {
  onChange: (ages: number[]) => void;
}) {
  const [childAges, setChildAges] = useState<number[]>([]);

  const addChild = () => {
    setChildAges([...childAges, 0]);
    onChange([...childAges, 0]);
  };

  const removeChild = (index: number) => {
    const newAges = childAges.filter((_, i) => i !== index);
    setChildAges(newAges);
    onChange(newAges);
  };

  const updateAge = (index: number, age: number) => {
    const newAges = [...childAges];
    newAges[index] = age;
    setChildAges(newAges);
    onChange(newAges);
  };

  return (
    <div>
      <label>Children</label>
      {childAges.map((age, index) => (
        <div key={index} className="child-age-input">
          <select
            value={age}
            onChange={(e) => updateAge(index, parseInt(e.target.value))}
          >
            {Array.from({ length: 18 }, (_, i) => (
              <option key={i} value={i}>
                {i === 0 ? "Under 1" : `${i} years`}
              </option>
            ))}
          </select>
          <button onClick={() => removeChild(index)}>Remove</button>
        </div>
      ))}
      <button onClick={addChild}>Add Child</button>
    </div>
  );
}
```

---

## Testing Plan

### Test 1: Basic Search with Child Ages

**Objective**: Verify childAges parameter works and tourist tax is calculated

**Request**:

```
GET https://40usmhyfm9.execute-api.eu-north-1.amazonaws.com/staging/api/v1/guest/search?locationSlug=belgrade&checkIn=2025-12-15&checkOut=2025-12-20&adults=2&childAges=5,12
```

**Expected**:

- ✅ Status 200
- ✅ `searchMeta.children` = 2
- ✅ `searchMeta.totalGuests` = 4
- ✅ Listings returned with pricing
- ✅ If listing has tourist tax (and `taxesIncludedInPrice = false`):
  - `touristTaxAmount` present
  - `touristTaxBreakdown.adults.count` = 2
  - `touristTaxBreakdown.children` array has entries matching child ages
  - `totalPrice` includes tourist tax

### Test 2: No Children

**Objective**: Verify search works without children

**Request**:

```
GET https://40usmhyfm9.execute-api.eu-north-1.amazonaws.com/staging/api/v1/guest/search?locationSlug=belgrade&checkIn=2025-12-15&checkOut=2025-12-20&adults=2
```

**Expected**:

- ✅ Status 200
- ✅ `searchMeta.children` = 0
- ✅ `searchMeta.totalGuests` = 2
- ✅ Tourist tax only calculated for adults (if applicable)

### Test 3: Multiple Children Same Age

**Objective**: Verify grouping logic works

**Request**:

```
GET https://40usmhyfm9.execute-api.eu-north-1.amazonaws.com/staging/api/v1/guest/search?locationSlug=belgrade&checkIn=2025-12-15&checkOut=2025-12-20&adults=2&childAges=5,5,5
```

**Expected**:

- ✅ Status 200
- ✅ `searchMeta.children` = 3
- ✅ Tourist tax breakdown groups 3 children in same age bracket
- ✅ `count` field reflects 3 children

### Test 4: Edge Case - Age Boundaries

**Objective**: Test inclusive age range matching

**Request**:

```
GET https://40usmhyfm9.execute-api.eu-north-1.amazonaws.com/staging/api/v1/guest/search?locationSlug=belgrade&checkIn=2025-12-15&checkOut=2025-12-20&adults=1&childAges=0,7,17
```

**Expected**:

- ✅ Status 200
- ✅ Ages 0, 7, 17 all matched to correct tax brackets
- ✅ Tourist tax calculated correctly for boundary ages

### Test 5: Invalid Child Age - Too High

**Objective**: Verify validation rejects age > 17

**Request**:

```
GET https://40usmhyfm9.execute-api.eu-north-1.amazonaws.com/staging/api/v1/guest/search?locationSlug=belgrade&checkIn=2025-12-15&checkOut=2025-12-20&adults=2&childAges=5,18
```

**Expected**:

- ✅ Status 400
- ✅ Error message: "Each child age must be between 0 and 17"

### Test 6: Invalid Child Age - Negative

**Objective**: Verify validation rejects negative ages

**Request**:

```
GET https://40usmhyfm9.execute-api.eu-north-1.amazonaws.com/staging/api/v1/guest/search?locationSlug=belgrade&checkIn=2025-12-15&checkOut=2025-12-20&adults=2&childAges=-1
```

**Expected**:

- ✅ Status 400
- ✅ Error message: "Each child age must be between 0 and 17"

### Test 7: Invalid Child Age - Non-Numeric

**Objective**: Verify validation rejects non-numbers

**Request**:

```
GET https://40usmhyfm9.execute-api.eu-north-1.amazonaws.com/staging/api/v1/guest/search?locationSlug=belgrade&checkIn=2025-12-15&checkOut=2025-12-20&adults=2&childAges=5,abc
```

**Expected**:

- ✅ Status 400
- ✅ Error message: "Each child age must be between 0 and 17"

### Test 8: Booking Terms Filtering

**Objective**: Verify listings are filtered by min/max nights and advance booking

**Setup**: Need a listing with specific booking terms (e.g., `minBookingNights = 3`, `maxBookingNights = 14`, `advanceBookingDays = 30`)

**Request 1** (Too short - 2 nights):

```
GET https://40usmhyfm9.execute-api.eu-north-1.amazonaws.com/staging/api/v1/guest/search?locationSlug=belgrade&checkIn=2025-12-15&checkOut=2025-12-17&adults=2
```

**Expected**: ✅ Listing with `minBookingNights = 3` NOT returned

**Request 2** (Within range - 5 nights):

```
GET https://40usmhyfm9.execute-api.eu-north-1.amazonaws.com/staging/api/v1/guest/search?locationSlug=belgrade&checkIn=2025-12-15&checkOut=2025-12-20&adults=2
```

**Expected**: ✅ Listing with `minBookingNights = 3` IS returned

**Request 3** (Too far in advance - 60 days):

```
GET https://40usmhyfm9.execute-api.eu-north-1.amazonaws.com/staging/api/v1/guest/search?locationSlug=belgrade&checkIn=2026-01-30&checkOut=2026-02-05&adults=2
```

**Expected**: ✅ Listing with `advanceBookingDays = 30` NOT returned

### Test 9: Taxes Included in Price Flag

**Objective**: Verify no tourist tax when `taxesIncludedInPrice = true`

**Setup**: Need a listing with `taxesIncludedInPrice = true` in pricing

**Request**:

```
GET https://40usmhyfm9.execute-api.eu-north-1.amazonaws.com/staging/api/v1/guest/search?locationSlug=belgrade&checkIn=2025-12-15&checkOut=2025-12-20&adults=2&childAges=5,12
```

**Expected**:

- ✅ Status 200
- ✅ `touristTaxAmount` field NOT present
- ✅ `touristTaxBreakdown` field NOT present
- ✅ `totalPrice` does NOT include tourist tax calculation

### Test 10: Authenticated vs Unauthenticated

**Objective**: Verify members pricing still works

**Request 1** (No auth):

```
GET https://40usmhyfm9.execute-api.eu-north-1.amazonaws.com/staging/api/v1/guest/search?locationSlug=belgrade&checkIn=2025-12-15&checkOut=2025-12-20&adults=2
```

**Request 2** (With valid auth token):

```
GET https://40usmhyfm9.execute-api.eu-north-1.amazonaws.com/staging/api/v1/guest/search?locationSlug=belgrade&checkIn=2025-12-15&checkOut=2025-12-20&adults=2
Authorization: Bearer <valid-token>
```

**Expected**:

- ✅ Request 2 shows `membersPricingApplied = true` (if listing has members discount)
- ✅ Lower `totalPrice` for authenticated request
- ✅ Tourist tax still calculated correctly for both

---

## Error Scenarios

| Scenario                                | Status | Error Message                                   |
| --------------------------------------- | ------ | ----------------------------------------------- |
| Missing `locationSlug` and `locationId` | 400    | "Either locationSlug or locationId is required" |
| Invalid child age > 17                  | 400    | "Each child age must be between 0 and 17"       |
| Invalid child age < 0                   | 400    | "Each child age must be between 0 and 17"       |
| Non-numeric child age                   | 400    | "Each child age must be between 0 and 17"       |
| Total guests > 50                       | 400    | "Total guests cannot exceed 50"                 |
| More than 50 children                   | 400    | "Maximum 50 children allowed"                   |
| Invalid date format                     | 400    | "checkIn must be in YYYY-MM-DD format"          |
| Check-in in the past                    | 400    | "checkIn cannot be in the past"                 |

---

## Key Behavioral Changes

### 1. **Child Count → Child Ages**

- Old: `children=3` (just a count)
- New: `childAges=5,8,12` (specific ages)
- Impact: More accurate tourist tax calculation

### 2. **Tourist Tax Calculation**

- Now calculated **per child** based on age brackets
- Multiple children in same bracket are grouped in response
- Only shown if `taxesIncludedInPrice = false`

### 3. **Total Price Calculation**

- `totalPrice` is **always** the base accommodation price (without tax)
- `totalPriceWithTax` provides the final price including tourist tax (when `taxesIncludedInPrice = false`)
- `touristTaxAmount` and breakdown show full tax details
- If `taxesIncludedInPrice = true`, only `totalPrice` is shown with the flag set

### 4. **Booking Terms Filtering**

- Listings automatically filtered by:
  - Minimum booking nights
  - Maximum booking nights
  - Advance booking days
- Frontend doesn't need to filter these

### 5. **Response Size**

- `touristTaxBreakdown` can be large if many age brackets
- Only returned when taxes apply
- Consider truncating display for many children

---

## Migration Checklist

- [ ] Update API client to use `childAges` instead of `children`
- [ ] Update search form to collect individual child ages
- [ ] Update TypeScript types for `ListingPricing`
- [ ] Handle optional `touristTaxAmount` and `touristTaxBreakdown`
- [ ] Update pricing display components
- [ ] Add tourist tax breakdown display
- [ ] Test all 10 scenarios above
- [ ] Update mobile app if applicable
- [ ] Update any cached/saved search logic

---

## Support & Questions

For any issues or clarifications:

- Review this document
- Check test results against expected outcomes
- Verify listing has proper pricing configuration in database
- Check CloudWatch logs for detailed error messages (Lambda: `localstays-staging-guest-search-handler`)
