# Listing Pricing System

## Overview

The Listing Pricing System provides a flexible, hierarchical pricing model for rental listings. It supports:

- **Base pricing** (year-round default)
- **Seasonal pricing** (date-range specific base prices)
- **Length-of-stay discounts** (applied to all base prices)
- **Members-only pricing** (for both base prices and length-of-stay discounts)

---

## Table of Contents

1. [Pricing Hierarchy](#pricing-hierarchy)
2. [Data Model](#data-model)
3. [DynamoDB Schema](#dynamodb-schema)
4. [API Endpoints](#api-endpoints)
5. [Frontend Implementation](#frontend-implementation)
6. [Backend Implementation](#backend-implementation)
7. [Validation Rules](#validation-rules)
8. [Example Scenarios](#example-scenarios)

---

## Pricing Hierarchy

### Conceptual Model

```
LISTING PRICING
│
├─ BASE PRICES (Foundation)
│  ├─ Default Base Price (required, year-round)
│  │  ├─ Standard Price
│  │  └─ Members Price (optional)
│  │
│  └─ Seasonal Base Prices (optional, date-range specific)
│     ├─ Summer Season
│     │  ├─ Standard Price
│     │  └─ Members Price (optional)
│     │
│     └─ Winter Holidays
│        ├─ Standard Price
│        └─ Members Price (optional)
│
└─ LENGTH OF STAY DISCOUNTS (Modifiers, applied to ALL base prices)
   ├─ 7+ nights (e.g., 5% off)
   ├─ 14+ nights (e.g., 10% off)
   └─ 30+ nights (e.g., 15% off)
```

### Pricing Matrix Example

For a listing with:

- Default base: €100 (members: €90)
- Summer season: €150 (members: €135)
- 7+ nights: 5% off
- 14+ nights: 10% off

**Resulting Matrix:**

| Period         | Guest Type | Standard | 7+ Nights | 14+ Nights |
| -------------- | ---------- | -------- | --------- | ---------- |
| **Year-round** | Standard   | €100     | €95       | €90        |
|                | Members    | €90      | €85.50    | €81        |
| **Summer**     | Standard   | €150     | €142.50   | €135       |
|                | Members    | €135     | €128.25   | €121.50    |

---

## Data Model

### Discount Types

Both **members-only discounts** and **length-of-stay discounts** support two input methods:

1. **Percentage Discount**: User specifies a percentage (e.g., "10% off")

   - We store the percentage and calculate the absolute price
   - When base price changes, percentage-based discounts are recalculated

2. **Absolute Discount**: User specifies a fixed amount
   - For members-only: User sets the exact price (e.g., "€90/night")
   - For length-of-stay: User sets the amount off (e.g., "€10 off per night")
   - When base price changes, absolute discounts remain unchanged (but percentage is recalculated for display)

### Currency

- Currency is set at the **listing level** (inherited from `ListingMetadata.pricing.currency`)
- All prices for a listing use the same currency
- Currency cannot be changed at the pricing configuration level

---

## DynamoDB Schema

### Storage Pattern

All pricing records are stored in the main `localstays-{stage}` table using the existing single-table design:

```
pk: HOST#{hostId}
sk: LISTING_PRICING#{listingId}#{TYPE}#{id}
```

### Record Types

#### 1. Base Price Record (Default)

```typescript
{
  pk: "HOST#{hostId}",
  sk: "LISTING_PRICING#{listingId}#BASE#default",

  // Identifiers
  listingId: string,
  basePriceId: "default",
  isDefault: true,

  // Date range (null for default)
  dateRange: null,

  // Standard pricing
  standardPrice: number,              // €100

  // Members-only pricing (optional)
  membersDiscount: {
    type: "PERCENTAGE" | "ABSOLUTE",

    // If type=PERCENTAGE:
    percentage: number,               // 10 (means 10% off)
    calculatedPrice: number,          // €90 (calculated)
    calculatedPercentage: number,     // 10 (same as input)

    // If type=ABSOLUTE:
    absolutePrice: number,            // €90 (user input)
    calculatedPrice: number,          // €90 (same as input)
    calculatedPercentage: number,     // 10 (calculated for display)
  } | null,

  // Metadata
  createdAt: string,
  updatedAt: string,

  // GSI3: Direct lookup by listingId
  gsi3pk: "LISTING#{listingId}",
  gsi3sk: "BASE_PRICE#default",
}
```

#### 2. Base Price Record (Seasonal)

```typescript
{
  pk: "HOST#{hostId}",
  sk: "LISTING_PRICING#{listingId}#BASE#{seasonId}",

  // Identifiers
  listingId: string,
  basePriceId: string,                // "season_uuid"
  isDefault: false,

  // Date range (required for seasonal)
  dateRange: {
    startDate: string,                // "2025-06-01" (ISO format)
    endDate: string,                  // "2025-08-31" (ISO format)
    displayStart: string,             // "01-06-2025" (European format)
    displayEnd: string,               // "31-08-2025" (European format)
  },

  // Standard pricing
  standardPrice: number,              // €150

  // Members-only pricing (optional)
  membersDiscount: {
    type: "PERCENTAGE" | "ABSOLUTE",
    percentage: number | null,
    absolutePrice: number | null,
    calculatedPrice: number,
    calculatedPercentage: number,
  } | null,

  // Metadata
  createdAt: string,
  updatedAt: string,

  // GSI3: Direct lookup by listingId
  gsi3pk: "LISTING#{listingId}",
  gsi3sk: "BASE_PRICE#{seasonId}",
}
```

#### 3. Length of Stay Discount Record

```typescript
{
  pk: "HOST#{hostId}",
  sk: "LISTING_PRICING#{listingId}#LENGTH_OF_STAY#{losId}",

  // Identifiers
  listingId: string,
  lengthOfStayId: string,             // "los_uuid"

  // Minimum nights threshold
  minNights: number,                  // 7, 14, 30, etc.

  // Discount configuration
  discountType: "PERCENTAGE" | "ABSOLUTE",
  discountPercentage: number | null,  // 5 (if percentage)
  discountAbsolute: number | null,    // €10 (if absolute)

  // Metadata
  createdAt: string,
  updatedAt: string,

  // GSI3: Direct lookup by listingId
  gsi3pk: "LISTING#{listingId}",
  gsi3sk: "LENGTH_OF_STAY#{losId}",
}
```

#### 4. Pricing Matrix (Denormalized)

```typescript
{
  pk: "HOST#{hostId}",
  sk: "LISTING_PRICING#{listingId}#MATRIX",

  // Identifiers
  listingId: string,
  currency: string,                   // Inherited from listing

  // Full calculated pricing matrix
  matrix: {
    basePrices: [
      {
        basePriceId: string,
        isDefault: boolean,
        dateRange: {
          startDate: string,
          endDate: string,
          displayStart: string,
          displayEnd: string,
        } | null,

        // Base pricing
        standardPrice: number,
        membersDiscount: {
          type: "PERCENTAGE" | "ABSOLUTE",
          inputValue: number,         // The value user entered
          calculatedPrice: number,    // Final price
          calculatedPercentage: number, // Always calculated for display
        } | null,

        // Length of stay pricing (applied to this base price)
        lengthOfStayPricing: [
          {
            minNights: number,
            discountType: "PERCENTAGE" | "ABSOLUTE",
            discountValue: number,    // Percentage or absolute amount
            standardPrice: number,    // Calculated price
            membersPrice: number,     // Calculated price (if members discount exists)
          }
        ]
      }
    ]
  },

  // Metadata
  lastCalculatedAt: string,
  updatedAt: string,

  // GSI3: Direct lookup by listingId
  gsi3pk: "LISTING#{listingId}",
  gsi3sk: "PRICING_MATRIX",
}
```

---

## API Endpoints

### 1. Get Pricing Configuration

```http
GET /api/v1/hosts/{hostId}/listings/{listingId}/pricing
```

**Authorization:** Host must own the listing

**Response:**

```json
{
  "listingId": "listing_abc123",
  "currency": "EUR",
  "configuration": {
    "basePrice": {
      "standardPrice": 100,
      "membersDiscount": {
        "type": "PERCENTAGE",
        "percentage": 10
      }
    },
    "seasonalPrices": [
      {
        "basePriceId": "season_uuid",
        "dateRange": {
          "startDate": "01-06-2025",
          "endDate": "31-08-2025"
        },
        "standardPrice": 150,
        "membersDiscount": {
          "type": "ABSOLUTE",
          "absolutePrice": 135
        }
      }
    ],
    "lengthOfStayDiscounts": [
      {
        "lengthOfStayId": "los_uuid",
        "minNights": 7,
        "discountType": "PERCENTAGE",
        "discountPercentage": 5
      },
      {
        "lengthOfStayId": "los_uuid2",
        "minNights": 14,
        "discountType": "ABSOLUTE",
        "discountAbsolute": 15
      }
    ]
  },
  "matrix": {
    "basePrices": [
      {
        "basePriceId": "default",
        "isDefault": true,
        "dateRange": null,
        "standardPrice": 100,
        "membersDiscount": {
          "type": "PERCENTAGE",
          "inputValue": 10,
          "calculatedPrice": 90,
          "calculatedPercentage": 10
        },
        "lengthOfStayPricing": [
          {
            "minNights": 7,
            "discountType": "PERCENTAGE",
            "discountValue": 5,
            "standardPrice": 95,
            "membersPrice": 85.5
          },
          {
            "minNights": 14,
            "discountType": "ABSOLUTE",
            "discountValue": 15,
            "standardPrice": 85,
            "membersPrice": 75
          }
        ]
      },
      {
        "basePriceId": "season_uuid",
        "isDefault": false,
        "dateRange": {
          "startDate": "2025-06-01",
          "endDate": "2025-08-31",
          "displayStart": "01-06-2025",
          "displayEnd": "31-08-2025"
        },
        "standardPrice": 150,
        "membersDiscount": {
          "type": "ABSOLUTE",
          "inputValue": 135,
          "calculatedPrice": 135,
          "calculatedPercentage": 10
        },
        "lengthOfStayPricing": [
          {
            "minNights": 7,
            "discountType": "PERCENTAGE",
            "discountValue": 5,
            "standardPrice": 142.5,
            "membersPrice": 128.25
          },
          {
            "minNights": 14,
            "discountType": "ABSOLUTE",
            "discountValue": 15,
            "standardPrice": 135,
            "membersPrice": 120
          }
        ]
      }
    ]
  },
  "lastUpdatedAt": "2025-11-18T10:00:00Z"
}
```

**Error Responses:**

- `404 Not Found`: Listing doesn't exist or has no pricing configured
- `403 Forbidden`: User doesn't own this listing

---

### 2. Set/Update Pricing Configuration

```http
PUT /api/v1/hosts/{hostId}/listings/{listingId}/pricing
```

**Authorization:** Host must own the listing

**Request Body:**

```json
{
  "basePrices": {
    "default": {
      "standardPrice": 100,
      "membersDiscount": {
        "type": "PERCENTAGE",
        "percentage": 10
      }
    },
    "seasonal": [
      {
        "dateRange": {
          "startDate": "01-06-2025",
          "endDate": "31-08-2025"
        },
        "standardPrice": 150,
        "membersDiscount": {
          "type": "ABSOLUTE",
          "absolutePrice": 135
        }
      }
    ]
  },
  "lengthOfStayDiscounts": [
    {
      "minNights": 7,
      "discountType": "PERCENTAGE",
      "discountPercentage": 5
    },
    {
      "minNights": 14,
      "discountType": "ABSOLUTE",
      "discountAbsolute": 15
    }
  ]
}
```

**Backend Behavior:**

1. Validates the entire configuration
2. **Deletes ALL existing pricing records** for this listing
3. Creates new base price records
4. Creates new length-of-stay records
5. Calculates and stores the pricing matrix
6. Returns the complete configuration + matrix

**Response:** Same as GET endpoint (full configuration + matrix)

**Error Responses:**

- `400 Bad Request`: Validation errors (see [Validation Rules](#validation-rules))
- `403 Forbidden`: User doesn't own this listing
- `404 Not Found`: Listing doesn't exist

---

## Frontend Implementation

### State Management

```typescript
interface PricingState {
  basePrice: {
    standardPrice: number;
    membersDiscount: {
      type: "PERCENTAGE" | "ABSOLUTE";
      percentage?: number;
      absolutePrice?: number;
    } | null;
  } | null;

  seasonalPrices: Array<{
    id?: string; // Only present when editing existing
    dateRange: {
      startDate: string; // "01-06-2025" (European format)
      endDate: string; // "31-08-2025"
    };
    standardPrice: number;
    membersDiscount: {
      type: "PERCENTAGE" | "ABSOLUTE";
      percentage?: number;
      absolutePrice?: number;
    } | null;
  }>;

  lengthOfStayDiscounts: Array<{
    id?: string; // Only present when editing existing
    minNights: number;
    discountType: "PERCENTAGE" | "ABSOLUTE";
    discountPercentage?: number;
    discountAbsolute?: number;
  }>;
}
```

### Loading Existing Pricing

```typescript
const loadPricing = async () => {
  try {
    const response = await api.get(
      `/api/v1/hosts/${hostId}/listings/${listingId}/pricing`
    );

    setPricingState({
      basePrice: response.configuration.basePrice || null,
      seasonalPrices: response.configuration.seasonalPrices || [],
      lengthOfStayDiscounts: response.configuration.lengthOfStayDiscounts || [],
    });

    // Store the matrix for preview
    setPricingMatrix(response.matrix);
  } catch (error) {
    if (error.status === 404) {
      // No pricing configured yet, start fresh
      setPricingState({
        basePrice: null,
        seasonalPrices: [],
        lengthOfStayDiscounts: [],
      });
    } else {
      // Handle other errors
      console.error("Failed to load pricing:", error);
    }
  }
};
```

### Saving Pricing

```typescript
const savePricing = async () => {
  // Validate base price is set
  if (!pricingState.basePrice) {
    showError("Base price is required");
    return;
  }

  // Prepare payload
  const payload = {
    basePrices: {
      default: pricingState.basePrice,
      seasonal: pricingState.seasonalPrices.map((sp) => ({
        dateRange: sp.dateRange,
        standardPrice: sp.standardPrice,
        membersDiscount: sp.membersDiscount,
      })),
    },
    lengthOfStayDiscounts: pricingState.lengthOfStayDiscounts.map((los) => ({
      minNights: los.minNights,
      discountType: los.discountType,
      discountPercentage: los.discountPercentage,
      discountAbsolute: los.discountAbsolute,
    })),
  };

  try {
    const response = await api.put(
      `/api/v1/hosts/${hostId}/listings/${listingId}/pricing`,
      payload
    );

    // Update state with server response
    setPricingState(response.configuration);
    setPricingMatrix(response.matrix);

    showSuccess("Pricing saved successfully!");
  } catch (error) {
    if (error.status === 400) {
      // Validation error
      showError(error.message);
    } else {
      showError("Failed to save pricing");
    }
  }
};
```

### Real-time Matrix Calculation

The frontend should calculate the pricing matrix in real-time as the user makes changes:

```typescript
const calculateMatrix = (state: PricingState): PricingMatrix => {
  if (!state.basePrice) return null;

  const basePrices = [
    {
      id: "default",
      isDefault: true,
      dateRange: null,
      ...calculateBasePriceWithDiscounts(
        state.basePrice,
        state.lengthOfStayDiscounts
      ),
    },
    ...state.seasonalPrices.map((sp) => ({
      id: sp.id || "temp_" + Math.random(),
      isDefault: false,
      dateRange: sp.dateRange,
      ...calculateBasePriceWithDiscounts(
        {
          standardPrice: sp.standardPrice,
          membersDiscount: sp.membersDiscount,
        },
        state.lengthOfStayDiscounts
      ),
    })),
  ];

  return { basePrices };
};

const calculateBasePriceWithDiscounts = (
  basePrice: { standardPrice: number; membersDiscount: any },
  losDiscounts: Array<any>
) => {
  // Calculate members price
  const membersPrice = basePrice.membersDiscount
    ? calculateMembersPrice(basePrice.standardPrice, basePrice.membersDiscount)
    : null;

  // Calculate length-of-stay pricing
  const lengthOfStayPricing = losDiscounts.map((los) => ({
    minNights: los.minNights,
    discountType: los.discountType,
    discountValue: los.discountPercentage || los.discountAbsolute,
    standardPrice: applyDiscount(
      basePrice.standardPrice,
      los.discountType,
      los.discountPercentage || los.discountAbsolute
    ),
    membersPrice: membersPrice
      ? applyDiscount(
          membersPrice,
          los.discountType,
          los.discountPercentage || los.discountAbsolute
        )
      : null,
  }));

  return {
    standardPrice: basePrice.standardPrice,
    membersPrice,
    lengthOfStayPricing,
  };
};

const calculateMembersPrice = (
  standardPrice: number,
  discount: any
): number => {
  if (discount.type === "PERCENTAGE") {
    return standardPrice * (1 - discount.percentage / 100);
  } else {
    return discount.absolutePrice;
  }
};

const applyDiscount = (
  price: number,
  discountType: string,
  discountValue: number
): number => {
  if (discountType === "PERCENTAGE") {
    return price * (1 - discountValue / 100);
  } else {
    return price - discountValue;
  }
};
```

### Progressive Saves

Users can save at any stage:

1. **After setting base price:**

   ```typescript
   {
     basePrices: {
       default: { standardPrice: 100, membersDiscount: {...} },
       seasonal: []
     },
     lengthOfStayDiscounts: []
   }
   ```

2. **After adding seasonal pricing:**

   ```typescript
   {
     basePrices: {
       default: { ... },
       seasonal: [{ ... }]
     },
     lengthOfStayDiscounts: []
   }
   ```

3. **After adding length-of-stay discounts:**
   ```typescript
   {
     basePrices: {
       default: { ... },
       seasonal: [{ ... }]
     },
     lengthOfStayDiscounts: [{ ... }, { ... }]
   }
   ```

**Key principle:** Frontend always sends the **complete current state**, even if some arrays are empty.

### Date Validation

```typescript
const validateDateRange = (
  newRange: { startDate: string; endDate: string },
  existingRanges: Array<{ startDate: string; endDate: string }>,
  excludeIndex?: number
): { valid: boolean; error?: string } => {
  // Parse dates (European format: DD-MM-YYYY)
  const parseDate = (dateStr: string): Date => {
    const [day, month, year] = dateStr.split("-").map(Number);
    return new Date(year, month - 1, day);
  };

  const newStart = parseDate(newRange.startDate);
  const newEnd = parseDate(newRange.endDate);

  // Check end date is after start date
  if (newEnd <= newStart) {
    return {
      valid: false,
      error: "End date must be after start date",
    };
  }

  // Check for overlaps with existing ranges
  for (let i = 0; i < existingRanges.length; i++) {
    if (excludeIndex !== undefined && i === excludeIndex) {
      continue; // Skip when editing the same range
    }

    const existingStart = parseDate(existingRanges[i].startDate);
    const existingEnd = parseDate(existingRanges[i].endDate);

    // Check for overlap
    if (
      (newStart >= existingStart && newStart <= existingEnd) ||
      (newEnd >= existingStart && newEnd <= existingEnd) ||
      (newStart <= existingStart && newEnd >= existingEnd)
    ) {
      return {
        valid: false,
        error: `Date range overlaps with existing season (${existingRanges[i].startDate} to ${existingRanges[i].endDate})`,
      };
    }
  }

  return { valid: true };
};
```

### UI Components

#### Base Price Form

```typescript
<div className="base-price-section">
  <h3>Base Price (Year-round)</h3>

  <div className="form-group">
    <label>Standard Price per Night *</label>
    <input
      type="number"
      value={pricingState.basePrice?.standardPrice || ""}
      onChange={(e) =>
        updateBasePrice("standardPrice", parseFloat(e.target.value))
      }
      placeholder="100"
      required
    />
    <span className="currency">{currency}</span>
  </div>

  <div className="form-group">
    <label>
      <input
        type="checkbox"
        checked={!!pricingState.basePrice?.membersDiscount}
        onChange={(e) => toggleMembersDiscount(e.target.checked)}
      />
      Offer members-only discount
    </label>
  </div>

  {pricingState.basePrice?.membersDiscount && (
    <div className="members-discount-form">
      <div className="discount-type-selector">
        <label>
          <input
            type="radio"
            value="PERCENTAGE"
            checked={
              pricingState.basePrice.membersDiscount.type === "PERCENTAGE"
            }
            onChange={() => setMembersDiscountType("PERCENTAGE")}
          />
          Percentage discount
        </label>
        <label>
          <input
            type="radio"
            value="ABSOLUTE"
            checked={pricingState.basePrice.membersDiscount.type === "ABSOLUTE"}
            onChange={() => setMembersDiscountType("ABSOLUTE")}
          />
          Fixed price
        </label>
      </div>

      {pricingState.basePrice.membersDiscount.type === "PERCENTAGE" ? (
        <div className="form-group">
          <label>Discount Percentage</label>
          <input
            type="number"
            value={pricingState.basePrice.membersDiscount.percentage || ""}
            onChange={(e) =>
              updateMembersDiscount("percentage", parseFloat(e.target.value))
            }
            placeholder="10"
            min="0"
            max="100"
          />
          <span>%</span>
          <div className="calculated-preview">
            💡 Members will pay {calculateMembersPrice(pricingState.basePrice)}
            {currency}/night
          </div>
        </div>
      ) : (
        <div className="form-group">
          <label>Members Price per Night</label>
          <input
            type="number"
            value={pricingState.basePrice.membersDiscount.absolutePrice || ""}
            onChange={(e) =>
              updateMembersDiscount("absolutePrice", parseFloat(e.target.value))
            }
            placeholder="90"
          />
          <span className="currency">{currency}</span>
          <div className="calculated-preview">
            💡 This is {calculatePercentageOff(pricingState.basePrice)}% off the
            standard price
          </div>
        </div>
      )}
    </div>
  )}
</div>
```

#### Seasonal Price Form

```typescript
<div className="seasonal-prices-section">
  <h3>Seasonal Pricing (Optional)</h3>

  {pricingState.seasonalPrices.map((season, index) => (
    <div key={index} className="seasonal-price-card">
      <div className="form-group">
        <label>Date Range</label>
        <div className="date-range-inputs">
          <input
            type="text"
            value={season.dateRange.startDate}
            onChange={(e) =>
              updateSeasonalPrice(index, "dateRange.startDate", e.target.value)
            }
            placeholder="DD-MM-YYYY"
          />
          <span>to</span>
          <input
            type="text"
            value={season.dateRange.endDate}
            onChange={(e) =>
              updateSeasonalPrice(index, "dateRange.endDate", e.target.value)
            }
            placeholder="DD-MM-YYYY"
          />
        </div>
      </div>

      <div className="form-group">
        <label>Standard Price per Night</label>
        <input
          type="number"
          value={season.standardPrice}
          onChange={(e) =>
            updateSeasonalPrice(
              index,
              "standardPrice",
              parseFloat(e.target.value)
            )
          }
        />
        <span className="currency">{currency}</span>
      </div>

      {/* Members discount form (same as base price) */}

      <button onClick={() => removeSeasonalPrice(index)}>Remove Season</button>
    </div>
  ))}

  <button onClick={addSeasonalPrice}>+ Add Seasonal Price</button>
</div>
```

#### Length of Stay Discounts Form

```typescript
<div className="length-of-stay-section">
  <h3>Length of Stay Discounts (Optional)</h3>

  {pricingState.lengthOfStayDiscounts.map((los, index) => (
    <div key={index} className="los-discount-card">
      <div className="form-group">
        <label>Minimum Nights</label>
        <input
          type="number"
          value={los.minNights}
          onChange={(e) =>
            updateLosDiscount(index, "minNights", parseInt(e.target.value))
          }
          min="1"
        />
      </div>

      <div className="discount-type-selector">
        <label>
          <input
            type="radio"
            value="PERCENTAGE"
            checked={los.discountType === "PERCENTAGE"}
            onChange={() => setLosDiscountType(index, "PERCENTAGE")}
          />
          Percentage discount
        </label>
        <label>
          <input
            type="radio"
            value="ABSOLUTE"
            checked={los.discountType === "ABSOLUTE"}
            onChange={() => setLosDiscountType(index, "ABSOLUTE")}
          />
          Fixed amount off per night
        </label>
      </div>

      {los.discountType === "PERCENTAGE" ? (
        <div className="form-group">
          <label>Discount Percentage</label>
          <input
            type="number"
            value={los.discountPercentage || ""}
            onChange={(e) =>
              updateLosDiscount(
                index,
                "discountPercentage",
                parseFloat(e.target.value)
              )
            }
            min="0"
            max="100"
          />
          <span>%</span>
        </div>
      ) : (
        <div className="form-group">
          <label>Discount Amount</label>
          <input
            type="number"
            value={los.discountAbsolute || ""}
            onChange={(e) =>
              updateLosDiscount(
                index,
                "discountAbsolute",
                parseFloat(e.target.value)
              )
            }
          />
          <span className="currency">{currency} per night</span>
        </div>
      )}

      <div className="preview">
        💡 Preview:
        <ul>
          {previewLosDiscount(los).map((preview, i) => (
            <li key={i}>{preview}</li>
          ))}
        </ul>
      </div>

      <button onClick={() => removeLosDiscount(index)}>Remove Discount</button>
    </div>
  ))}

  <button onClick={addLosDiscount}>+ Add Length of Stay Discount</button>
</div>
```

#### Pricing Matrix Preview

```typescript
<div className="pricing-matrix-preview">
  <h3>📊 Pricing Preview</h3>

  {pricingMatrix?.basePrices.map((basePrice) => (
    <div key={basePrice.basePriceId} className="matrix-section">
      <h4>
        {basePrice.isDefault
          ? "Base Price (Year-round)"
          : `${basePrice.dateRange.displayStart} to ${basePrice.dateRange.displayEnd}`}
      </h4>

      <table className="pricing-table">
        <thead>
          <tr>
            <th></th>
            <th>Standard</th>
            {basePrice.lengthOfStayPricing.map((los) => (
              <th key={los.minNights}>{los.minNights}+ Nights</th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Standard</td>
            <td>
              {currency}
              {basePrice.standardPrice}
            </td>
            {basePrice.lengthOfStayPricing.map((los) => (
              <td key={los.minNights}>
                {currency}
                {los.standardPrice}
              </td>
            ))}
          </tr>
          {basePrice.membersDiscount && (
            <tr>
              <td>Members</td>
              <td>
                {currency}
                {basePrice.membersDiscount.calculatedPrice}
              </td>
              {basePrice.lengthOfStayPricing.map((los) => (
                <td key={los.minNights}>
                  {currency}
                  {los.membersPrice}
                </td>
              ))}
            </tr>
          )}
        </tbody>
      </table>
    </div>
  ))}

  <p className="preview-note">
    💡 This preview is calculated in real-time as you make changes
  </p>
</div>
```

---

## Backend Implementation

### Lambda Handler Structure

```typescript
// backend/services/api/hosts/listings/pricing/set-pricing.ts

import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  QueryCommand,
  BatchWriteCommand,
  PutCommand,
} from "@aws-sdk/lib-dynamodb";
import {
  success,
  badRequest,
  forbidden,
  notFound,
} from "../../../lib/response";
import { v4 as uuidv4 } from "uuid";

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const TABLE_NAME = process.env.TABLE_NAME!;

export async function handler(
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> {
  console.log("Set pricing:", { path: event.path, method: event.httpMethod });

  try {
    const { hostId, listingId } = event.pathParameters!;
    const userId = event.requestContext.authorizer?.claims?.sub;
    const body = JSON.parse(event.body!);

    // 1. Verify ownership
    const listing = await getListingMetadata(hostId, listingId);
    if (!listing) {
      return notFound("Listing not found");
    }
    if (listing.hostId !== hostId) {
      return forbidden("You do not own this listing");
    }

    // 2. Get listing currency
    const currency = listing.pricing?.currency || "EUR";

    // 3. Validate pricing configuration
    const validationError = validatePricingConfiguration(body);
    if (validationError) {
      return badRequest(validationError);
    }

    // 4. Delete all existing pricing records
    await deleteAllPricingRecords(hostId, listingId);

    // 5. Create base price records
    const basePriceRecords = await createBasePriceRecords(
      hostId,
      listingId,
      body.basePrices
    );

    // 6. Create length-of-stay records
    const losRecords = await createLengthOfStayRecords(
      hostId,
      listingId,
      body.lengthOfStayDiscounts || []
    );

    // 7. Calculate pricing matrix
    const matrix = calculatePricingMatrix(
      basePriceRecords,
      losRecords,
      currency
    );

    // 8. Store pricing matrix
    await storePricingMatrix(hostId, listingId, matrix, currency);

    // 9. Return complete configuration + matrix
    return success({
      listingId,
      currency,
      configuration: body,
      matrix,
      lastUpdatedAt: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error("Failed to set pricing:", err);
    return {
      statusCode: 500,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
      body: JSON.stringify({
        error: "Failed to set pricing",
        message: err.message,
      }),
    };
  }
}
```

### Validation Function

```typescript
function validatePricingConfiguration(body: any): string | null {
  // 1. Base price is required
  if (!body.basePrices?.default) {
    return "Base price is required";
  }

  const defaultPrice = body.basePrices.default;

  // 2. Validate default base price
  if (
    typeof defaultPrice.standardPrice !== "number" ||
    defaultPrice.standardPrice <= 0
  ) {
    return "Base price must be a positive number";
  }

  // 3. Validate members discount (if present)
  if (defaultPrice.membersDiscount) {
    const membersError = validateMembersDiscount(
      defaultPrice.standardPrice,
      defaultPrice.membersDiscount
    );
    if (membersError) return membersError;
  }

  // 4. Validate seasonal prices (if present)
  if (body.basePrices.seasonal && body.basePrices.seasonal.length > 0) {
    const seasonalError = validateSeasonalPrices(body.basePrices.seasonal);
    if (seasonalError) return seasonalError;
  }

  // 5. Validate length-of-stay discounts (if present)
  if (body.lengthOfStayDiscounts && body.lengthOfStayDiscounts.length > 0) {
    const losError = validateLengthOfStayDiscounts(
      body.lengthOfStayDiscounts,
      defaultPrice.standardPrice
    );
    if (losError) return losError;
  }

  return null;
}

function validateMembersDiscount(
  standardPrice: number,
  discount: any
): string | null {
  if (discount.type === "PERCENTAGE") {
    if (
      typeof discount.percentage !== "number" ||
      discount.percentage < 0 ||
      discount.percentage > 100
    ) {
      return "Members discount percentage must be between 0 and 100";
    }
  } else if (discount.type === "ABSOLUTE") {
    if (
      typeof discount.absolutePrice !== "number" ||
      discount.absolutePrice <= 0 ||
      discount.absolutePrice >= standardPrice
    ) {
      return "Members absolute price must be positive and less than standard price";
    }
  } else {
    return "Invalid members discount type";
  }
  return null;
}

function validateSeasonalPrices(seasonalPrices: any[]): string | null {
  const dateRanges: Array<{ start: Date; end: Date }> = [];

  for (const seasonal of seasonalPrices) {
    // Validate date range exists
    if (!seasonal.dateRange?.startDate || !seasonal.dateRange?.endDate) {
      return "Seasonal price must have a date range";
    }

    // Parse European dates (DD-MM-YYYY)
    const startDate = parseEuropeanDate(seasonal.dateRange.startDate);
    const endDate = parseEuropeanDate(seasonal.dateRange.endDate);

    if (!startDate || !endDate) {
      return "Invalid date format. Use DD-MM-YYYY";
    }

    // Check end date is after start date
    if (endDate <= startDate) {
      return "End date must be after start date";
    }

    // Check for overlaps
    for (const existing of dateRanges) {
      if (
        (startDate >= existing.start && startDate <= existing.end) ||
        (endDate >= existing.start && endDate <= existing.end) ||
        (startDate <= existing.start && endDate >= existing.end)
      ) {
        return "Seasonal date ranges cannot overlap";
      }
    }

    dateRanges.push({ start: startDate, end: endDate });

    // Validate standard price
    if (
      typeof seasonal.standardPrice !== "number" ||
      seasonal.standardPrice <= 0
    ) {
      return "Seasonal standard price must be a positive number";
    }

    // Validate members discount (if present)
    if (seasonal.membersDiscount) {
      const membersError = validateMembersDiscount(
        seasonal.standardPrice,
        seasonal.membersDiscount
      );
      if (membersError) return membersError;
    }
  }

  return null;
}

function validateLengthOfStayDiscounts(
  discounts: any[],
  basePrice: number
): string | null {
  const minNights = new Set<number>();

  for (const discount of discounts) {
    // Validate minNights
    if (typeof discount.minNights !== "number" || discount.minNights <= 0) {
      return "Minimum nights must be a positive number";
    }

    // Check for duplicates
    if (minNights.has(discount.minNights)) {
      return `Duplicate length-of-stay discount for ${discount.minNights} nights`;
    }
    minNights.add(discount.minNights);

    // Validate discount type
    if (discount.discountType === "PERCENTAGE") {
      if (
        typeof discount.discountPercentage !== "number" ||
        discount.discountPercentage < 0 ||
        discount.discountPercentage > 100
      ) {
        return "Length-of-stay discount percentage must be between 0 and 100";
      }
    } else if (discount.discountType === "ABSOLUTE") {
      if (
        typeof discount.discountAbsolute !== "number" ||
        discount.discountAbsolute <= 0 ||
        discount.discountAbsolute >= basePrice
      ) {
        return "Length-of-stay absolute discount must be positive and less than base price";
      }
    } else {
      return "Invalid length-of-stay discount type";
    }
  }

  return null;
}

function parseEuropeanDate(dateStr: string): Date | null {
  const parts = dateStr.split("-");
  if (parts.length !== 3) return null;

  const day = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10) - 1; // JS months are 0-indexed
  const year = parseInt(parts[2], 10);

  if (isNaN(day) || isNaN(month) || isNaN(year)) return null;

  const date = new Date(year, month, day);
  return date;
}
```

### Delete All Pricing Records

```typescript
async function deleteAllPricingRecords(
  hostId: string,
  listingId: string
): Promise<void> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: "pk = :pk AND begins_with(sk, :sk)",
      ExpressionAttributeValues: {
        ":pk": `HOST#${hostId}`,
        ":sk": `LISTING_PRICING#${listingId}#`,
      },
    })
  );

  if (!result.Items || result.Items.length === 0) {
    console.log("No existing pricing records to delete");
    return;
  }

  const deleteRequests = result.Items.map((item) => ({
    DeleteRequest: {
      Key: {
        pk: item.pk,
        sk: item.sk,
      },
    },
  }));

  // Batch delete (25 items per request)
  for (let i = 0; i < deleteRequests.length; i += 25) {
    const chunk = deleteRequests.slice(i, i + 25);
    await docClient.send(
      new BatchWriteCommand({
        RequestItems: {
          [TABLE_NAME]: chunk,
        },
      })
    );
  }

  console.log(`Deleted ${deleteRequests.length} existing pricing records`);
}
```

### Create Base Price Records

```typescript
async function createBasePriceRecords(
  hostId: string,
  listingId: string,
  basePrices: any
): Promise<any[]> {
  const now = new Date().toISOString();
  const records = [];

  // 1. Create default base price
  const defaultRecord = {
    pk: `HOST#${hostId}`,
    sk: `LISTING_PRICING#${listingId}#BASE#default`,
    listingId,
    basePriceId: "default",
    isDefault: true,
    dateRange: null,
    standardPrice: basePrices.default.standardPrice,
    membersDiscount: calculateMembersDiscount(
      basePrices.default.standardPrice,
      basePrices.default.membersDiscount
    ),
    createdAt: now,
    updatedAt: now,
    gsi3pk: `LISTING#${listingId}`,
    gsi3sk: "BASE_PRICE#default",
  };
  records.push(defaultRecord);

  // 2. Create seasonal base prices
  for (const seasonal of basePrices.seasonal || []) {
    const seasonalId = `season_${uuidv4()}`;
    const startDate = parseEuropeanDate(seasonal.dateRange.startDate);
    const endDate = parseEuropeanDate(seasonal.dateRange.endDate);

    const seasonalRecord = {
      pk: `HOST#${hostId}`,
      sk: `LISTING_PRICING#${listingId}#BASE#${seasonalId}`,
      listingId,
      basePriceId: seasonalId,
      isDefault: false,
      dateRange: {
        startDate: startDate!.toISOString().split("T")[0], // "2025-06-01"
        endDate: endDate!.toISOString().split("T")[0],
        displayStart: seasonal.dateRange.startDate, // "01-06-2025"
        displayEnd: seasonal.dateRange.endDate,
      },
      standardPrice: seasonal.standardPrice,
      membersDiscount: calculateMembersDiscount(
        seasonal.standardPrice,
        seasonal.membersDiscount
      ),
      createdAt: now,
      updatedAt: now,
      gsi3pk: `LISTING#${listingId}`,
      gsi3sk: `BASE_PRICE#${seasonalId}`,
    };
    records.push(seasonalRecord);
  }

  // Batch write all base price records
  await batchWriteRecords(records);

  console.log(`Created ${records.length} base price records`);
  return records;
}

function calculateMembersDiscount(
  standardPrice: number,
  membersDiscount: any
): any {
  if (!membersDiscount) {
    return null;
  }

  if (membersDiscount.type === "PERCENTAGE") {
    const percentage = membersDiscount.percentage;
    const calculatedPrice = standardPrice * (1 - percentage / 100);
    return {
      type: "PERCENTAGE",
      percentage,
      calculatedPrice: roundToTwoDecimals(calculatedPrice),
      calculatedPercentage: percentage,
    };
  } else {
    // type === 'ABSOLUTE'
    const absolutePrice = membersDiscount.absolutePrice;
    const calculatedPercentage =
      ((standardPrice - absolutePrice) / standardPrice) * 100;
    return {
      type: "ABSOLUTE",
      absolutePrice,
      calculatedPrice: absolutePrice,
      calculatedPercentage: roundToTwoDecimals(calculatedPercentage),
    };
  }
}
```

### Create Length-of-Stay Records

```typescript
async function createLengthOfStayRecords(
  hostId: string,
  listingId: string,
  losDiscounts: any[]
): Promise<any[]> {
  if (!losDiscounts || losDiscounts.length === 0) {
    console.log("No length-of-stay discounts to create");
    return [];
  }

  const now = new Date().toISOString();
  const records = losDiscounts.map((los) => {
    const losId = `los_${uuidv4()}`;
    return {
      pk: `HOST#${hostId}`,
      sk: `LISTING_PRICING#${listingId}#LENGTH_OF_STAY#${losId}`,
      listingId,
      lengthOfStayId: losId,
      minNights: los.minNights,
      discountType: los.discountType,
      discountPercentage: los.discountPercentage || null,
      discountAbsolute: los.discountAbsolute || null,
      createdAt: now,
      updatedAt: now,
      gsi3pk: `LISTING#${listingId}`,
      gsi3sk: `LENGTH_OF_STAY#${losId}`,
    };
  });

  await batchWriteRecords(records);

  console.log(`Created ${records.length} length-of-stay records`);
  return records;
}
```

### Calculate Pricing Matrix

```typescript
function calculatePricingMatrix(
  basePriceRecords: any[],
  losRecords: any[],
  currency: string
): any {
  const matrix = {
    basePrices: basePriceRecords.map((basePrice) => {
      const lengthOfStayPricing = losRecords.map((los) => {
        // Apply length-of-stay discount to standard price
        const standardPrice = applyDiscount(
          basePrice.standardPrice,
          los.discountType,
          los.discountPercentage || los.discountAbsolute
        );

        // Apply length-of-stay discount to members price (if exists)
        const membersBasePrice =
          basePrice.membersDiscount?.calculatedPrice || basePrice.standardPrice;
        const membersPrice = basePrice.membersDiscount
          ? applyDiscount(
              membersBasePrice,
              los.discountType,
              los.discountPercentage || los.discountAbsolute
            )
          : null;

        return {
          minNights: los.minNights,
          discountType: los.discountType,
          discountValue: los.discountPercentage || los.discountAbsolute,
          standardPrice: roundToTwoDecimals(standardPrice),
          membersPrice: membersPrice ? roundToTwoDecimals(membersPrice) : null,
        };
      });

      return {
        basePriceId: basePrice.basePriceId,
        isDefault: basePrice.isDefault,
        dateRange: basePrice.dateRange,
        standardPrice: basePrice.standardPrice,
        membersDiscount: basePrice.membersDiscount,
        lengthOfStayPricing,
      };
    }),
  };

  return matrix;
}

function applyDiscount(
  price: number,
  discountType: string,
  discountValue: number
): number {
  if (discountType === "PERCENTAGE") {
    return price * (1 - discountValue / 100);
  } else {
    return price - discountValue;
  }
}

function roundToTwoDecimals(value: number): number {
  return Math.round(value * 100) / 100;
}
```

### Store Pricing Matrix

```typescript
async function storePricingMatrix(
  hostId: string,
  listingId: string,
  matrix: any,
  currency: string
): Promise<void> {
  const now = new Date().toISOString();

  await docClient.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        pk: `HOST#${hostId}`,
        sk: `LISTING_PRICING#${listingId}#MATRIX`,
        listingId,
        currency,
        matrix,
        lastCalculatedAt: now,
        updatedAt: now,
        gsi3pk: `LISTING#${listingId}`,
        gsi3sk: "PRICING_MATRIX",
      },
    })
  );

  console.log("Stored pricing matrix");
}
```

### Batch Write Helper

```typescript
async function batchWriteRecords(records: any[]): Promise<void> {
  const putRequests = records.map((item) => ({
    PutRequest: { Item: item },
  }));

  // Batch write (25 items per request)
  for (let i = 0; i < putRequests.length; i += 25) {
    const chunk = putRequests.slice(i, i + 25);
    await docClient.send(
      new BatchWriteCommand({
        RequestItems: {
          [TABLE_NAME]: chunk,
        },
      })
    );
  }
}
```

### Get Pricing Handler

```typescript
// backend/services/api/hosts/listings/pricing/get-pricing.ts

export async function handler(
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> {
  console.log("Get pricing:", { path: event.path, method: event.httpMethod });

  try {
    const { hostId, listingId } = event.pathParameters!;

    // 1. Verify ownership
    const listing = await getListingMetadata(hostId, listingId);
    if (!listing) {
      return notFound("Listing not found");
    }
    if (listing.hostId !== hostId) {
      return forbidden("You do not own this listing");
    }

    // 2. Get all pricing records
    const result = await docClient.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: "pk = :pk AND begins_with(sk, :sk)",
        ExpressionAttributeValues: {
          ":pk": `HOST#${hostId}`,
          ":sk": `LISTING_PRICING#${listingId}#`,
        },
      })
    );

    if (!result.Items || result.Items.length === 0) {
      return notFound("No pricing configured for this listing");
    }

    // 3. Parse records
    const basePrices: any[] = [];
    const losDiscounts: any[] = [];
    let matrix: any = null;

    for (const item of result.Items) {
      if (item.sk.includes("#BASE#")) {
        basePrices.push(item);
      } else if (item.sk.includes("#LENGTH_OF_STAY#")) {
        losDiscounts.push(item);
      } else if (item.sk.includes("#MATRIX")) {
        matrix = item.matrix;
      }
    }

    // 4. Build configuration object
    const defaultBasePrice = basePrices.find((bp) => bp.isDefault);
    const seasonalPrices = basePrices
      .filter((bp) => !bp.isDefault)
      .map((bp) => ({
        basePriceId: bp.basePriceId,
        dateRange: {
          startDate: bp.dateRange.displayStart,
          endDate: bp.dateRange.displayEnd,
        },
        standardPrice: bp.standardPrice,
        membersDiscount: bp.membersDiscount
          ? {
              type: bp.membersDiscount.type,
              percentage: bp.membersDiscount.percentage,
              absolutePrice: bp.membersDiscount.absolutePrice,
            }
          : null,
      }));

    const configuration = {
      basePrice: defaultBasePrice
        ? {
            standardPrice: defaultBasePrice.standardPrice,
            membersDiscount: defaultBasePrice.membersDiscount
              ? {
                  type: defaultBasePrice.membersDiscount.type,
                  percentage: defaultBasePrice.membersDiscount.percentage,
                  absolutePrice: defaultBasePrice.membersDiscount.absolutePrice,
                }
              : null,
          }
        : null,
      seasonalPrices,
      lengthOfStayDiscounts: losDiscounts.map((los) => ({
        lengthOfStayId: los.lengthOfStayId,
        minNights: los.minNights,
        discountType: los.discountType,
        discountPercentage: los.discountPercentage,
        discountAbsolute: los.discountAbsolute,
      })),
    };

    // 5. Return configuration + matrix
    return success({
      listingId,
      currency: listing.pricing?.currency || "EUR",
      configuration,
      matrix,
      lastUpdatedAt: defaultBasePrice?.updatedAt || new Date().toISOString(),
    });
  } catch (err: any) {
    console.error("Failed to get pricing:", err);
    return {
      statusCode: 500,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
      body: JSON.stringify({
        error: "Failed to get pricing",
        message: err.message,
      }),
    };
  }
}
```

---

## Validation Rules

### Base Price Validation

1. **Required**: Base price must be set
2. **Positive**: `standardPrice > 0`
3. **Members discount**:
   - If `type=PERCENTAGE`: `0 <= percentage <= 100`
   - If `type=ABSOLUTE`: `0 < absolutePrice < standardPrice`

### Seasonal Price Validation

1. **Date range required**: Both `startDate` and `endDate` must be present
2. **Date format**: European format `DD-MM-YYYY`
3. **Date order**: `endDate > startDate`
4. **No overlaps**: Date ranges cannot overlap with other seasonal prices
5. **Positive price**: `standardPrice > 0`
6. **Members discount**: Same rules as base price

### Length-of-Stay Validation

1. **Positive nights**: `minNights > 0`
2. **Unique nights**: No duplicate `minNights` values
3. **Discount type**:
   - If `type=PERCENTAGE`: `0 <= discountPercentage <= 100`
   - If `type=ABSOLUTE`: `0 < discountAbsolute < basePrice`

---

## Example Scenarios

### Scenario 1: Base Price Only

**Request:**

```json
{
  "basePrices": {
    "default": {
      "standardPrice": 100,
      "membersDiscount": {
        "type": "PERCENTAGE",
        "percentage": 10
      }
    },
    "seasonal": []
  },
  "lengthOfStayDiscounts": []
}
```

**DynamoDB Records Created:**

- 1 base price record (default)
- 1 pricing matrix record

**Matrix:**

```json
{
  "basePrices": [
    {
      "basePriceId": "default",
      "isDefault": true,
      "dateRange": null,
      "standardPrice": 100,
      "membersDiscount": {
        "type": "PERCENTAGE",
        "inputValue": 10,
        "calculatedPrice": 90,
        "calculatedPercentage": 10
      },
      "lengthOfStayPricing": []
    }
  ]
}
```

---

### Scenario 2: Base + Seasonal Pricing

**Request:**

```json
{
  "basePrices": {
    "default": {
      "standardPrice": 100,
      "membersDiscount": { "type": "PERCENTAGE", "percentage": 10 }
    },
    "seasonal": [
      {
        "dateRange": { "startDate": "01-06-2025", "endDate": "31-08-2025" },
        "standardPrice": 150,
        "membersDiscount": { "type": "ABSOLUTE", "absolutePrice": 135 }
      }
    ]
  },
  "lengthOfStayDiscounts": []
}
```

**DynamoDB Records Created:**

- 2 base price records (default + summer)
- 1 pricing matrix record

**Matrix:**

```json
{
  "basePrices": [
    {
      "basePriceId": "default",
      "standardPrice": 100,
      "membersDiscount": { "calculatedPrice": 90 },
      "lengthOfStayPricing": []
    },
    {
      "basePriceId": "season_uuid",
      "dateRange": {
        "startDate": "2025-06-01",
        "endDate": "2025-08-31",
        "displayStart": "01-06-2025",
        "displayEnd": "31-08-2025"
      },
      "standardPrice": 150,
      "membersDiscount": { "calculatedPrice": 135 },
      "lengthOfStayPricing": []
    }
  ]
}
```

---

### Scenario 3: Complete Configuration

**Request:**

```json
{
  "basePrices": {
    "default": {
      "standardPrice": 100,
      "membersDiscount": { "type": "PERCENTAGE", "percentage": 10 }
    },
    "seasonal": [
      {
        "dateRange": { "startDate": "01-06-2025", "endDate": "31-08-2025" },
        "standardPrice": 150,
        "membersDiscount": { "type": "PERCENTAGE", "percentage": 10 }
      }
    ]
  },
  "lengthOfStayDiscounts": [
    { "minNights": 7, "discountType": "PERCENTAGE", "discountPercentage": 5 },
    { "minNights": 14, "discountType": "ABSOLUTE", "discountAbsolute": 15 }
  ]
}
```

**DynamoDB Records Created:**

- 2 base price records
- 2 length-of-stay records
- 1 pricing matrix record

**Matrix:**

```json
{
  "basePrices": [
    {
      "basePriceId": "default",
      "standardPrice": 100,
      "membersDiscount": { "calculatedPrice": 90 },
      "lengthOfStayPricing": [
        {
          "minNights": 7,
          "discountType": "PERCENTAGE",
          "discountValue": 5,
          "standardPrice": 95,
          "membersPrice": 85.5
        },
        {
          "minNights": 14,
          "discountType": "ABSOLUTE",
          "discountValue": 15,
          "standardPrice": 85,
          "membersPrice": 75
        }
      ]
    },
    {
      "basePriceId": "season_uuid",
      "standardPrice": 150,
      "membersDiscount": { "calculatedPrice": 135 },
      "lengthOfStayPricing": [
        {
          "minNights": 7,
          "discountType": "PERCENTAGE",
          "discountValue": 5,
          "standardPrice": 142.5,
          "membersPrice": 128.25
        },
        {
          "minNights": 14,
          "discountType": "ABSOLUTE",
          "discountValue": 15,
          "standardPrice": 135,
          "membersPrice": 120
        }
      ]
    }
  ]
}
```

---

## Key Design Decisions

### 1. Full Replacement Strategy

**Decision:** Every `PUT /pricing` call replaces ALL pricing records for the listing.

**Rationale:**

- ✅ Simple, predictable behavior
- ✅ No complex merge logic
- ✅ Frontend is the source of truth during editing
- ✅ Idempotent operations
- ✅ Easy to implement and test

**Trade-off:** Larger payloads, but pricing data is small (~1-5KB)

---

### 2. Denormalized Pricing Matrix

**Decision:** Store a pre-calculated pricing matrix alongside the source records.

**Rationale:**

- ✅ Fast reads (no calculation needed)
- ✅ Consistent pricing display
- ✅ Easy to query for booking systems
- ✅ Matrix is regenerated on every update

**Trade-off:** Extra storage, but negligible cost

---

### 3. European Date Format (DD-MM-YYYY)

**Decision:** Accept European format from frontend, store ISO format internally.

**Rationale:**

- ✅ Better UX for European users
- ✅ ISO format for internal consistency
- ✅ Easy to convert between formats

**Implementation:**

- Frontend sends: `"01-06-2025"`
- Backend stores: `"2025-06-01"` (ISO)
- Backend returns: Both formats for flexibility

---

### 4. Single Table Design

**Decision:** Store all pricing records in the main `localstays-{stage}` table.

**Rationale:**

- ✅ Consistent with existing architecture
- ✅ Single query to fetch all pricing for a listing
- ✅ Transactional updates possible
- ✅ No additional table to manage

**Access Pattern:**

```
pk = HOST#{hostId}
sk begins_with LISTING_PRICING#{listingId}#
```

---

### 5. Progressive Saves

**Decision:** Allow users to save at any stage (base only, base + seasonal, etc.)

**Rationale:**

- ✅ Better UX (save and come back later)
- ✅ No data loss
- ✅ Each save is a valid configuration
- ✅ Backend doesn't need to track "completion state"

---

## Future Enhancements

### 1. Pricing History

Track changes to pricing over time for analytics and auditing.

### 2. Bulk Pricing Updates

Allow hosts to update pricing for multiple listings at once.

### 3. Smart Pricing Suggestions

Use ML to suggest optimal pricing based on demand, seasonality, and competition.

### 4. Dynamic Pricing

Automatically adjust prices based on occupancy, demand, and other factors.

### 5. Promotional Pricing

Support time-limited promotions and flash sales.

### 6. Group Discounts

Offer discounts for larger groups or multiple bookings.

---

## Testing Checklist

### Backend Tests

- [ ] Validate base price is required
- [ ] Validate positive prices
- [ ] Validate members discount (percentage and absolute)
- [ ] Validate seasonal date ranges (format, order, overlaps)
- [ ] Validate length-of-stay discounts (positive, unique, valid types)
- [ ] Test full replacement (delete + create)
- [ ] Test matrix calculation (all combinations)
- [ ] Test progressive saves (base only, base + seasonal, full)
- [ ] Test error handling (invalid data, missing listing, unauthorized)

### Frontend Tests

- [ ] Load existing pricing
- [ ] Add/edit/remove base price
- [ ] Add/edit/remove seasonal prices
- [ ] Add/edit/remove length-of-stay discounts
- [ ] Toggle members discount
- [ ] Switch between percentage and absolute discounts
- [ ] Validate date range overlaps
- [ ] Real-time matrix calculation
- [ ] Save and reload
- [ ] Progressive saves (save at each stage)
- [ ] Error handling (validation errors, network errors)

---

## Deployment Checklist

- [ ] Create pricing types file (`backend/services/types/pricing.types.ts`)
- [ ] Implement `set-pricing.ts` Lambda handler
- [ ] Implement `get-pricing.ts` Lambda handler
- [ ] Add API Gateway routes to `api-lambda-stack.ts`
- [ ] Update IAM permissions for Lambda functions
- [ ] Deploy backend infrastructure
- [ ] Test API endpoints with Postman/curl
- [ ] Implement frontend pricing form
- [ ] Implement frontend matrix preview
- [ ] Test end-to-end flow
- [ ] Deploy frontend
- [ ] Monitor CloudWatch logs for errors
- [ ] Update documentation

---

## Support and Maintenance

### Common Issues

**Issue:** Date range overlap validation not working

- **Solution:** Check date parsing logic, ensure European format is correctly converted

**Issue:** Matrix calculation incorrect

- **Solution:** Verify discount application logic, check rounding

**Issue:** Pricing not saving

- **Solution:** Check validation errors, verify ownership, check DynamoDB permissions

**Issue:** Old pricing still showing after update

- **Solution:** Verify delete operation completed, check for stale frontend cache

### Monitoring

- Monitor CloudWatch logs for validation errors
- Track API latency for pricing endpoints
- Monitor DynamoDB read/write capacity
- Track pricing update frequency per listing

---

## Conclusion

The Listing Pricing System provides a flexible, hierarchical pricing model that supports:

- Base pricing with optional members-only discounts
- Seasonal pricing for date-specific rates
- Length-of-stay discounts applied across all base prices
- Progressive saves for better UX
- Real-time pricing matrix preview

The system is designed for simplicity, maintainability, and scalability, using a full-replacement strategy and denormalized pricing matrix for fast reads.
