# Comprehensive Listing Search API - Implementation Plan

## Overview

This document specifies the implementation of a comprehensive listing search API that returns available listings based on location, dates, guest count, and optional filters.

---

## API Endpoint

**Path**: `GET /guest/search/listings`

**Authentication**: Optional (affects pricing - members get discounted rates if authenticated)

**Rate Limiting**: Yes (same mechanism as location search)

---

## Query Parameters

### Required Parameters

| Parameter    | Type   | Description                 | Example                |
| ------------ | ------ | --------------------------- | ---------------------- |
| `locationId` | string | Mapbox Place ID             | `dXJuOm1ieHBsYzpBUVRC` |
| `checkIn`    | string | Check-in date (ISO format)  | `2025-06-15`           |
| `checkOut`   | string | Check-out date (ISO format) | `2025-06-20`           |
| `adults`     | number | Number of adults (≥1)       | `2`                    |

### Optional Parameters

| Parameter            | Type    | Description                      | Example                         |
| -------------------- | ------- | -------------------------------- | ------------------------------- |
| `children`           | number  | Number of children (≥0)          | `1`                             |
| `cursor`             | string  | Pagination cursor (base64)       | `eyJsYXN0S2V5Ijp7Li4ufX0=`      |
| `petsAllowed`        | boolean | Filter: Pets allowed             | `true`                          |
| `hasWIFI`            | boolean | Filter: WiFi available           | `true`                          |
| `hasAirConditioning` | boolean | Filter: Air conditioning         | `true`                          |
| `hasParking`         | boolean | Filter: Parking available        | `true`                          |
| `hasGym`             | boolean | Filter: Gym available            | `true`                          |
| `hasPool`            | boolean | Filter: Pool available           | `true`                          |
| `hasWorkspace`       | boolean | Filter: Dedicated workspace      | `true`                          |
| `parkingType`        | string  | Filter: Parking type (enum key)  | `FREE`, `PAID`, `STREET`        |
| `checkInType`        | string  | Filter: Check-in type (enum key) | `SELF_CHECKIN`, `HOST_GREETING` |
| `instantBook`        | boolean | Filter: Instant booking          | `true`                          |

---

## Response Structure

```typescript
{
  listings: Array<{
    // Listing identification
    listingId: string;
    hostId: string;

    // Display information
    name: string;
    shortDescription: string;
    thumbnailUrl: string;

    // Location
    placeName: string;
    regionName: string;
    coordinates: {
      latitude: number;
      longitude: number;
    };

    // Capacity
    maxGuests: number;
    bedrooms: number;
    beds: number;
    bathrooms: number;

    // Filters (for display)
    petsAllowed: boolean;
    hasWIFI: boolean;
    hasAirConditioning: boolean;
    hasParking: boolean;
    hasGym: boolean;
    hasPool: boolean;
    hasWorkspace: boolean;
    parkingType: string;
    checkInType: string;
    instantBook: boolean;

    // Pricing for this search
    pricing: {
      currency: string;
      totalPrice: number; // Total for all nights (standard or members)
      pricePerNight: number; // Average per night
      breakdown: Array<{
        date: string; // ISO date
        basePrice: number; // Price before LoS discount
        finalPrice: number; // Price after LoS discount
        isMembersPrice: boolean; // Whether members discount was applied
        isSeasonalPrice: boolean; // Whether seasonal pricing was used
      }>;
      lengthOfStayDiscount: {
        applied: boolean;
        minNights: number;
        discountType: "PERCENTAGE" | "ABSOLUTE";
        discountValue: number;
        totalSavings: number;
      } | null;
      membersPricingApplied: boolean; // Whether user got members pricing
      touristTax: {
        type: "PER_NIGHT" | "PER_STAY"; // How the tax is charged
        adultAmount: number; // Amount per adult per night
        childRates: Array<{
          childRateId: string;
          ageFrom: number; // 0-17 (inclusive)
          ageTo: number; // 0-17 (inclusive)
          amount: number;
          displayLabel: {
            en: string;
            sr: string;
          };
        }>;
      } | null;
    };
  }>;

  pagination: {
    hasMore: boolean;
    nextCursor: string | null;
    totalReturned: number;
  }

  searchMeta: {
    locationId: string;
    checkIn: string;
    checkOut: string;
    nights: number;
    adults: number;
    children: number;
    totalGuests: number;
  }
}
```

---

## Implementation Flow

### Phase 1: Query Validation & Setup

1. **Validate Required Parameters**

   **Security-First Validation** - All inputs are untrusted and must be validated:

   ```typescript
   // 1. locationId validation
   const locationId = event.queryStringParameters?.locationId?.trim();
   if (!locationId) {
     return {
       statusCode: 400,
       body: JSON.stringify({ error: "locationId is required" }),
     };
   }
   // Validate format: Mapbox IDs are base64-like strings, typically 20-30 chars
   if (!/^[A-Za-z0-9_-]{10,50}$/.test(locationId)) {
     return {
       statusCode: 400,
       body: JSON.stringify({ error: "Invalid locationId format" }),
     };
   }

   // 2. checkIn validation
   const checkIn = event.queryStringParameters?.checkIn?.trim();
   if (!checkIn) {
     return {
       statusCode: 400,
       body: JSON.stringify({ error: "checkIn is required" }),
     };
   }
   // Validate ISO date format (YYYY-MM-DD)
   if (!/^\d{4}-\d{2}-\d{2}$/.test(checkIn)) {
     return {
       statusCode: 400,
       body: JSON.stringify({ error: "checkIn must be in YYYY-MM-DD format" }),
     };
   }
   const checkInDate = new Date(checkIn);
   if (isNaN(checkInDate.getTime())) {
     return {
       statusCode: 400,
       body: JSON.stringify({ error: "Invalid checkIn date" }),
     };
   }
   // Prevent past dates (allow today)
   const today = new Date();
   today.setHours(0, 0, 0, 0);
   if (checkInDate < today) {
     return {
       statusCode: 400,
       body: JSON.stringify({ error: "checkIn cannot be in the past" }),
     };
   }

   // 3. checkOut validation
   const checkOut = event.queryStringParameters?.checkOut?.trim();
   if (!checkOut) {
     return {
       statusCode: 400,
       body: JSON.stringify({ error: "checkOut is required" }),
     };
   }
   if (!/^\d{4}-\d{2}-\d{2}$/.test(checkOut)) {
     return {
       statusCode: 400,
       body: JSON.stringify({ error: "checkOut must be in YYYY-MM-DD format" }),
     };
   }
   const checkOutDate = new Date(checkOut);
   if (isNaN(checkOutDate.getTime())) {
     return {
       statusCode: 400,
       body: JSON.stringify({ error: "Invalid checkOut date" }),
     };
   }
   // checkOut must be after checkIn
   if (checkOutDate <= checkInDate) {
     return {
       statusCode: 400,
       body: JSON.stringify({ error: "checkOut must be after checkIn" }),
     };
   }
   // Limit date range to prevent abuse (max 365 days)
   const daysDiff = Math.floor(
     (checkOutDate.getTime() - checkInDate.getTime()) / (1000 * 60 * 60 * 24)
   );
   if (daysDiff > 365) {
     return {
       statusCode: 400,
       body: JSON.stringify({ error: "Date range cannot exceed 365 days" }),
     };
   }
   // Reasonable minimum stay (1 night)
   if (daysDiff < 1) {
     return {
       statusCode: 400,
       body: JSON.stringify({ error: "Minimum stay is 1 night" }),
     };
   }

   // 4. adults validation
   const adultsStr = event.queryStringParameters?.adults?.trim();
   if (!adultsStr) {
     return {
       statusCode: 400,
       body: JSON.stringify({ error: "adults is required" }),
     };
   }
   const adults = parseInt(adultsStr, 10);
   if (isNaN(adults) || adults < 1 || adults > 50) {
     return {
       statusCode: 400,
       body: JSON.stringify({ error: "adults must be between 1 and 50" }),
     };
   }

   // 5. children validation (optional)
   let children = 0;
   if (event.queryStringParameters?.children) {
     const childrenStr = event.queryStringParameters.children.trim();
     children = parseInt(childrenStr, 10);
     if (isNaN(children) || children < 0 || children > 50) {
       return {
         statusCode: 400,
         body: JSON.stringify({ error: "children must be between 0 and 50" }),
       };
     }
   }

   // 6. Total guests validation
   const totalGuests = adults + children;
   if (totalGuests > 50) {
     return {
       statusCode: 400,
       body: JSON.stringify({ error: "Total guests cannot exceed 50" }),
     };
   }

   // 7. cursor validation (optional, for pagination)
   let decodedCursor = undefined;
   if (event.queryStringParameters?.cursor) {
     try {
       const cursorStr = event.queryStringParameters.cursor.trim();
       // Validate base64 format
       if (!/^[A-Za-z0-9+/]+=*$/.test(cursorStr)) {
         return {
           statusCode: 400,
           body: JSON.stringify({ error: "Invalid cursor format" }),
         };
       }
       // Limit cursor size to prevent memory attacks
       if (cursorStr.length > 2000) {
         return {
           statusCode: 400,
           body: JSON.stringify({ error: "Cursor too large" }),
         };
       }
       const decoded = Buffer.from(cursorStr, "base64").toString("utf-8");
       decodedCursor = JSON.parse(decoded);
     } catch (error) {
       return {
         statusCode: 400,
         body: JSON.stringify({ error: "Invalid cursor" }),
       };
     }
   }

   // 8. Boolean filter validation (optional)
   const booleanFilters = [
     "petsAllowed",
     "hasWIFI",
     "hasAirConditioning",
     "hasParking",
     "hasGym",
     "hasPool",
     "hasWorkspace",
     "instantBook",
   ];
   const filters: Record<string, boolean> = {};
   for (const filterName of booleanFilters) {
     if (event.queryStringParameters?.[filterName]) {
       const value = event.queryStringParameters[filterName].toLowerCase();
       if (value !== "true" && value !== "false") {
         return {
           statusCode: 400,
           body: JSON.stringify({
             error: `${filterName} must be 'true' or 'false'`,
           }),
         };
       }
       filters[filterName] = value === "true";
     }
   }

   // 9. Categorical filter validation (optional)
   const parkingType = event.queryStringParameters?.parkingType
     ?.trim()
     .toUpperCase();
   if (parkingType) {
     const validParkingTypes = ["FREE", "PAID", "STREET", "NONE"];
     if (!validParkingTypes.includes(parkingType)) {
       return {
         statusCode: 400,
         body: JSON.stringify({ error: "Invalid parkingType" }),
       };
     }
   }

   const checkInType = event.queryStringParameters?.checkInType
     ?.trim()
     .toUpperCase();
   if (checkInType) {
     const validCheckInTypes = [
       "SELF_CHECKIN",
       "HOST_GREETING",
       "KEYPAD",
       "LOCKBOX",
     ];
     if (!validCheckInTypes.includes(checkInType)) {
       return {
         statusCode: 400,
         body: JSON.stringify({ error: "Invalid checkInType" }),
       };
     }
   }
   ```

2. **Calculate Search Metadata**

   ```typescript
   const nights = daysDiff; // Already calculated during validation
   const nightDates = generateNightDates(checkIn, checkOut); // Excludes checkout date
   ```

3. **Check Authentication**

   ```typescript
   const isAuthenticated = !!event.requestContext.authorizer?.claims?.sub;
   const userId = isAuthenticated
     ? event.requestContext.authorizer.claims.sub
     : null;
   ```

4. **Apply Rate Limiting**
   - Use IP-based rate limiting (same as location search)
   - Limit: 60 requests per minute per IP
   - Extract IP from `event.requestContext.identity.sourceIp`
   - Validate IP format to prevent injection

---

### Phase 2: Query PublicListings Table

**Query Strategy**: Use partition key to get all listings in the location.

```typescript
const queryParams = {
  TableName: PUBLIC_LISTINGS_TABLE,
  KeyConditionExpression: "pk = :pk",
  ExpressionAttributeValues: {
    ":pk": `LOCATION#${locationId}`,
  },
  Limit: MAX_RESULTS_LIMIT, // Configurable: 100
  ExclusiveStartKey: cursor ? decodeCursor(cursor) : undefined,
};
```

**Filter Expression** (applied in DynamoDB):

```typescript
// Only filter by maxGuests in DynamoDB (most selective)
FilterExpression: 'maxGuests >= :totalGuests',
ExpressionAttributeValues: {
  ':pk': `LOCATION#${locationId}`,
  ':totalGuests': totalGuests,
}
```

**Result**: List of candidate listings (up to 100) that can accommodate the guests.

---

### Phase 3: Apply Optional Filters (In Lambda)

Apply boolean and categorical filters in-memory to reduce the candidate set before availability checks.

```typescript
let filteredListings = candidateListings;

// Boolean filters
if (petsAllowed !== undefined) {
  filteredListings = filteredListings.filter(
    (l) => l.petsAllowed === petsAllowed
  );
}
if (hasWIFI !== undefined) {
  filteredListings = filteredListings.filter((l) => l.hasWIFI === hasWIFI);
}
// ... repeat for all boolean filters

// Categorical filters
if (parkingType) {
  filteredListings = filteredListings.filter(
    (l) => l.parkingType === parkingType
  );
}
if (checkInType) {
  filteredListings = filteredListings.filter(
    (l) => l.checkInType === checkInType
  );
}
if (instantBook !== undefined) {
  filteredListings = filteredListings.filter(
    (l) => l.instantBook === instantBook
  );
}
```

**Why in Lambda?**

- DynamoDB filter expressions count toward read capacity even for filtered-out items
- Boolean filters are fast in-memory
- Reduces number of availability checks needed

---

### Phase 4: Check Availability (Parallel Batches)

For each filtered listing, query the Availability table to check if any nights are unavailable.

**Query Strategy**: Single query per listing using sort key range.

```typescript
const availabilityQuery = {
  TableName: AVAILABILITY_TABLE,
  KeyConditionExpression: "pk = :pk AND sk BETWEEN :startSk AND :endSk",
  ExpressionAttributeValues: {
    ":pk": `LISTING_AVAILABILITY#${listingId}`,
    ":startSk": `DATE#${checkIn}`,
    ":endSk": `DATE#${lastNight}`, // checkOut - 1 day (checkout date is available)
  },
  Limit: 1, // We only need to know if ANY record exists
};
```

**Optimization**: Run queries in parallel batches.

```typescript
const AVAILABILITY_BATCH_SIZE = 40; // Configurable

async function checkAvailabilityBatch(
  listings: PublicListingRecord[]
): Promise<PublicListingRecord[]> {
  const availableListings: PublicListingRecord[] = [];

  // Process in batches of 40
  for (let i = 0; i < listings.length; i += AVAILABILITY_BATCH_SIZE) {
    const batch = listings.slice(i, i + AVAILABILITY_BATCH_SIZE);

    const availabilityChecks = batch.map(async (listing) => {
      const result = await docClient.send(
        new QueryCommand({
          TableName: AVAILABILITY_TABLE,
          KeyConditionExpression: "pk = :pk AND sk BETWEEN :startSk AND :endSk",
          ExpressionAttributeValues: {
            ":pk": `LISTING_AVAILABILITY#${listing.listingId}`,
            ":startSk": `DATE#${checkIn}`,
            ":endSk": `DATE#${lastNight}`,
          },
          Limit: 1,
        })
      );

      // If no records found, listing is available
      return result.Items?.length === 0 ? listing : null;
    });

    const batchResults = await Promise.all(availabilityChecks);
    availableListings.push(...batchResults.filter((l) => l !== null));
  }

  return availableListings;
}
```

**Result**: List of available listings.

---

### Phase 5: Fetch Pricing (Parallel Batches)

For each available listing, fetch the PricingMatrix record.

**Query Strategy**: Use GSI3 to fetch pricing by listingId.

```typescript
const pricingQuery = {
  TableName: MAIN_TABLE,
  IndexName: "DocumentStatusIndex", // GSI3
  KeyConditionExpression: "gsi3pk = :pk AND gsi3sk = :sk",
  ExpressionAttributeValues: {
    ":pk": `LISTING#${listingId}`,
    ":sk": "PRICING_MATRIX",
  },
  Limit: 1,
};
```

**Optimization**: Run queries in parallel batches (same batch size as availability).

```typescript
const PRICING_BATCH_SIZE = 40; // Same as availability

async function fetchPricingBatch(
  listings: PublicListingRecord[]
): Promise<Map<string, PricingMatrixRecord>> {
  const pricingMap = new Map<string, PricingMatrixRecord>();

  for (let i = 0; i < listings.length; i += PRICING_BATCH_SIZE) {
    const batch = listings.slice(i, i + PRICING_BATCH_SIZE);

    const pricingFetches = batch.map(async (listing) => {
      const result = await docClient.send(
        new QueryCommand({
          TableName: MAIN_TABLE,
          IndexName: "DocumentStatusIndex",
          KeyConditionExpression: "gsi3pk = :pk AND gsi3sk = :sk",
          ExpressionAttributeValues: {
            ":pk": `LISTING#${listing.listingId}`,
            ":sk": "PRICING_MATRIX",
          },
          Limit: 1,
        })
      );

      if (result.Items?.[0]) {
        return {
          listingId: listing.listingId,
          pricing: result.Items[0] as PricingMatrixRecord,
        };
      }
      return null;
    });

    const batchResults = await Promise.all(pricingFetches);
    batchResults.forEach((result) => {
      if (result) {
        pricingMap.set(result.listingId, result.pricing);
      }
    });
  }

  return pricingMap;
}
```

**Result**: Map of listingId → PricingMatrixRecord.

---

### Phase 6: Calculate Pricing for Each Listing

For each available listing with pricing data, calculate the total price for the search date range.

#### Pricing Calculation Logic

```typescript
function calculateListingPrice(
  pricingMatrix: PricingMatrixRecord,
  nightDates: string[], // Array of ISO dates (excludes checkout)
  isAuthenticated: boolean
): ListingPricing {
  const { matrix, currency, touristTax } = pricingMatrix;
  const nights = nightDates.length;

  // Step 1: Determine base price for each night
  const nightlyBreakdown = nightDates.map((date) => {
    // Find applicable base price (seasonal or default)
    const basePrice = findApplicableBasePrice(matrix.basePrices, date);

    // Determine if using members pricing
    const useMembersPrice =
      isAuthenticated && basePrice.membersDiscount !== null;
    const pricePerNight = useMembersPrice
      ? basePrice.membersDiscount.calculatedPrice
      : basePrice.standardPrice;

    return {
      date,
      basePrice: pricePerNight,
      isMembersPrice: useMembersPrice,
      isSeasonalPrice: !basePrice.isDefault,
    };
  });

  // Step 2: Apply length-of-stay discount (if applicable)
  const losDiscount = findApplicableLengthOfStayDiscount(
    matrix.basePrices,
    nights
  );

  let totalPrice = 0;
  let totalSavings = 0;

  const finalBreakdown = nightlyBreakdown.map((night) => {
    let finalPrice = night.basePrice;

    if (losDiscount) {
      if (losDiscount.discountType === "PERCENTAGE") {
        const discount = (night.basePrice * losDiscount.discountValue) / 100;
        finalPrice = night.basePrice - discount;
        totalSavings += discount;
      } else {
        // ABSOLUTE
        finalPrice = night.basePrice - losDiscount.discountValue;
        totalSavings += losDiscount.discountValue;
      }
    }

    totalPrice += finalPrice;

    return {
      ...night,
      finalPrice,
    };
  });

  return {
    currency,
    totalPrice,
    pricePerNight: totalPrice / nights,
    breakdown: finalBreakdown,
    lengthOfStayDiscount: losDiscount
      ? {
          applied: true,
          minNights: losDiscount.minNights,
          discountType: losDiscount.discountType,
          discountValue: losDiscount.discountValue,
          totalSavings,
        }
      : null,
    membersPricingApplied:
      isAuthenticated && nightlyBreakdown.some((n) => n.isMembersPrice),
    touristTax: touristTax
      ? {
          perNightAdult: touristTax.adultAmount,
          perNightChild: touristTax.childAmount,
        }
      : null,
  };
}
```

#### Helper: Find Applicable Base Price

```typescript
function findApplicableBasePrice(
  basePrices: BasePriceWithDiscounts[],
  date: string
): BasePriceWithDiscounts {
  // Check seasonal prices first
  for (const basePrice of basePrices) {
    if (!basePrice.isDefault && basePrice.dateRange) {
      const { startDate, endDate } = basePrice.dateRange;
      if (date >= startDate && date <= endDate) {
        return basePrice;
      }
    }
  }

  // Fall back to default
  return basePrices.find((bp) => bp.isDefault)!;
}
```

#### Helper: Find Applicable Length-of-Stay Discount

```typescript
function findApplicableLengthOfStayDiscount(
  basePrices: BasePriceWithDiscounts[],
  nights: number
): { minNights: number; discountType: string; discountValue: number } | null {
  // Collect all LoS discounts from all base prices
  const allLosDiscounts: LengthOfStayPricing[] = [];
  basePrices.forEach((bp) => {
    allLosDiscounts.push(...bp.lengthOfStayPricing);
  });

  // Find the highest minNights threshold that the booking qualifies for
  const applicableDiscounts = allLosDiscounts
    .filter((los) => nights >= los.minNights)
    .sort((a, b) => b.minNights - a.minNights); // Highest threshold first

  if (applicableDiscounts.length === 0) {
    return null;
  }

  const bestDiscount = applicableDiscounts[0];
  return {
    minNights: bestDiscount.minNights,
    discountType: bestDiscount.discountType,
    discountValue: bestDiscount.discountValue,
  };
}
```

---

### Phase 7: Build Response

Combine listing data with calculated pricing.

```typescript
const results = availableListings
  .map((listing) => {
    const pricing = pricingMap.get(listing.listingId);

    if (!pricing) {
      // Skip listings without pricing
      return null;
    }

    const calculatedPricing = calculateListingPrice(
      pricing,
      nightDates,
      isAuthenticated
    );

    return {
      // Listing data
      listingId: listing.listingId,
      hostId: listing.hostId,
      name: listing.name,
      shortDescription: listing.shortDescription,
      thumbnailUrl: listing.thumbnailUrl,
      placeName: listing.placeName,
      regionName: listing.regionName,
      coordinates: {
        latitude: listing.latitude,
        longitude: listing.longitude,
      },
      maxGuests: listing.maxGuests,
      bedrooms: listing.bedrooms,
      beds: listing.beds,
      bathrooms: listing.bathrooms,
      petsAllowed: listing.petsAllowed,
      hasWIFI: listing.hasWIFI,
      hasAirConditioning: listing.hasAirConditioning,
      hasParking: listing.hasParking,
      hasGym: listing.hasGym,
      hasPool: listing.hasPool,
      hasWorkspace: listing.hasWorkspace,
      parkingType: listing.parkingType,
      checkInType: listing.checkInType,
      instantBook: listing.instantBook,

      // Calculated pricing
      pricing: calculatedPricing,
    };
  })
  .filter((l) => l !== null);

return {
  statusCode: 200,
  body: JSON.stringify({
    listings: results,
    pagination: {
      hasMore: !!lastEvaluatedKey,
      nextCursor: lastEvaluatedKey ? encodeCursor(lastEvaluatedKey) : null,
      totalReturned: results.length,
    },
    searchMeta: {
      locationId,
      checkIn,
      checkOut,
      nights,
      adults,
      children: children || 0,
      totalGuests,
    },
  }),
};
```

---

## Security Measures

### Input Validation & Sanitization

**All user inputs are treated as untrusted and validated:**

1. **String Inputs**

   - Trimmed to remove leading/trailing whitespace
   - Length limits enforced (prevent DoS via large inputs)
   - Format validation using regex patterns
   - No direct string interpolation into queries (use parameterized queries)

2. **Numeric Inputs**

   - Parsed and validated as integers
   - Range checks (min/max values)
   - NaN checks to prevent invalid operations

3. **Date Inputs**

   - Format validation (YYYY-MM-DD)
   - Validity checks (actual calendar dates)
   - Range checks (past dates, max future dates)
   - Business logic validation (checkout after checkin)

4. **Enum Inputs**

   - Whitelist validation (only accept known values)
   - Case normalization (convert to uppercase)
   - Reject unknown values

5. **Base64 Inputs (cursor)**
   - Format validation (valid base64 characters)
   - Size limits (max 2000 chars)
   - JSON parsing with try-catch
   - Reject malformed cursors

### SQL/NoSQL Injection Prevention

- ✅ **Parameterized Queries**: All DynamoDB queries use `ExpressionAttributeValues`
- ✅ **No String Interpolation**: Never concatenate user input into query strings
- ✅ **Validated Keys**: Partition and sort keys are validated before use

```typescript
// ✅ SAFE: Parameterized query
const query = {
  KeyConditionExpression: "pk = :pk",
  ExpressionAttributeValues: {
    ":pk": `LOCATION#${locationId}`, // locationId is validated
  },
};

// ❌ UNSAFE: String interpolation (we never do this)
// const query = `SELECT * FROM table WHERE pk = 'LOCATION#${locationId}'`;
```

### Rate Limiting

- **IP-based rate limiting**: 60 requests/minute per IP
- **Prevents**: Brute force attacks, DoS, scraping
- **Implementation**: DynamoDB-based rate limit tracking
- **IP validation**: Ensure sourceIp is valid format

### Authentication

- **Optional but recommended**: Users get better pricing when authenticated
- **Token validation**: Cognito JWT tokens validated by API Gateway
- **No sensitive data exposure**: Unauthenticated users get standard pricing only

### Resource Limits

- **Max results per request**: 100 listings (prevent large response attacks)
- **Max date range**: 365 days (prevent expensive queries)
- **Max guests**: 50 (reasonable business limit)
- **Max cursor size**: 2000 chars (prevent memory exhaustion)
- **Query timeouts**: Lambda timeout set to prevent runaway queries

### Error Handling

- **No stack traces in responses**: Only user-friendly error messages
- **Detailed logging**: Full error context logged to CloudWatch for debugging
- **Generic 500 errors**: Don't expose internal implementation details

### CORS Protection

- **Restricted origins**: Only allow specific domains (localhost, staging, production)
- **Credentials allowed**: For authenticated requests
- **No wildcard origins**: Explicit domain list

---

## Configuration

Store these as environment variables in the Lambda:

```typescript
const MAX_RESULTS_LIMIT = parseInt(process.env.MAX_RESULTS_LIMIT || "100");
const AVAILABILITY_BATCH_SIZE = parseInt(
  process.env.AVAILABILITY_BATCH_SIZE || "40"
);
const PRICING_BATCH_SIZE = parseInt(process.env.PRICING_BATCH_SIZE || "40");
```

---

## Error Handling

### Validation Errors (400)

**All validation errors return structured JSON responses:**

```typescript
{
  statusCode: 400,
  body: JSON.stringify({
    error: 'Descriptive error message',
    code: 'VALIDATION_ERROR'
  })
}
```

**Validation checks:**

- ✅ Missing required parameters (`locationId`, `checkIn`, `checkOut`, `adults`)
- ✅ Invalid `locationId` format (must be alphanumeric with dashes/underscores, 10-50 chars)
- ✅ Invalid date formats (must be `YYYY-MM-DD`)
- ✅ Invalid date values (must be valid calendar dates)
- ✅ Past `checkIn` dates (must be today or future)
- ✅ `checkOut` before or equal to `checkIn`
- ✅ Date range > 365 days (prevent abuse)
- ✅ Date range < 1 day (minimum stay)
- ✅ `adults` < 1 or > 50
- ✅ `children` < 0 or > 50
- ✅ Total guests > 50
- ✅ Invalid `cursor` format (must be valid base64)
- ✅ Cursor too large (max 2000 chars, prevent memory attacks)
- ✅ Invalid boolean filter values (must be `'true'` or `'false'`)
- ✅ Invalid `parkingType` enum (must be `FREE`, `PAID`, `STREET`, `NONE`)
- ✅ Invalid `checkInType` enum (must be `SELF_CHECKIN`, `HOST_GREETING`, `KEYPAD`, `LOCKBOX`)

### Rate Limiting (429)

- More than 60 requests per minute per IP
- IP address extracted from `event.requestContext.identity.sourceIp`
- IP format validated to prevent injection attacks

### Server Errors (500)

- DynamoDB query failures (with retry logic)
- Pricing calculation errors
- Unexpected exceptions (logged with full context)

---

## Performance Considerations

### Expected Performance

- **PublicListings query**: ~50-100ms (single partition query)
- **In-memory filtering**: ~1-5ms (negligible)
- **Availability checks**: ~100-200ms (40 parallel queries per batch)
- **Pricing fetches**: ~100-200ms (40 parallel queries per batch)
- **Pricing calculations**: ~10-50ms (in-memory)

**Total estimated latency**: ~300-500ms for typical search

### Optimization Strategies

1. **Parallel batching**: Run 40 DynamoDB queries simultaneously
2. **Early filtering**: Apply boolean filters before availability checks
3. **Limit results**: Cap at 100 listings per request (pagination for more)
4. **Efficient queries**: Use `Limit: 1` for availability checks (we only need to know if ANY record exists)

---

## Edge Cases

### Overlapping Seasonal Prices

- **Scenario**: Multiple seasonal prices overlap for the same date
- **Solution**: First match wins (iterate in order)

### No Pricing Data

- **Scenario**: Listing is published but has no pricing matrix
- **Solution**: Skip listing (don't include in results)

### Partial Availability

- **Scenario**: Listing is available for some nights but not all
- **Solution**: Exclude listing (must be available for entire date range)

### Length-of-Stay Discounts

- **Scenario**: Multiple LoS discounts exist (e.g., 7+ nights, 14+ nights, 30+ nights)
- **Solution**: Apply the highest threshold that the booking qualifies for

---

## Future Enhancements

1. **Sorting**: Add `sortBy` parameter (price, rating, distance)
2. **Map bounds**: Add `bounds` parameter to filter by map viewport
3. **Flexible dates**: Add `flexibleDates` to search ±3 days
4. **Caching**: Cache pricing matrices for hot listings
5. **Search analytics**: Track popular searches for optimization

---

## Testing Checklist

- [ ] Query validation (all required params, date logic)
- [ ] Rate limiting enforcement
- [ ] Boolean filter combinations
- [ ] Categorical filter combinations
- [ ] Availability check accuracy (exclude checkout date)
- [ ] Pricing calculation with default base price only
- [ ] Pricing calculation with seasonal prices
- [ ] Pricing calculation with length-of-stay discounts
- [ ] Pricing calculation with members pricing (authenticated)
- [ ] Pricing calculation with tourist tax
- [ ] Pagination (cursor encoding/decoding)
- [ ] Empty results (no listings in location)
- [ ] No available listings (all booked)
- [ ] Performance with 100 listings
- [ ] Parallel batch processing
