# Guest API Documentation

Public-facing API endpoints for location search and listing search. These endpoints are accessible to both anonymous guests and authenticated members.

---

## Base URL

```bash
# Staging
https://40usmhyfm9.execute-api.eu-north-1.amazonaws.com/staging/

# Environment Variable (for frontend)
NEXT_PUBLIC_GUEST_API_URL=https://40usmhyfm9.execute-api.eu-north-1.amazonaws.com/staging/
```

---

## 1. Location Search API

Autocomplete search endpoint for finding locations by name.

### Endpoint

```
GET /api/v1/public/locations/search
```

### Authentication

**Not required** - Public endpoint

### Rate Limiting

- **60 requests per minute** per IP address
- Returns `429 Too Many Requests` if exceeded

### Query Parameters

| Parameter | Type   | Required | Description          | Validation        |
| --------- | ------ | -------- | -------------------- | ----------------- |
| `q`       | string | Yes      | Search query         | 2-50 chars        |

### Response

```json
{
  "locations": [
    {
      "locationId": "dXJuOm1ieHBsYzpBUVRC",
      "name": "Belgrade"
    }
  ]
}
```

### Example Request

```bash
curl "https://40usmhyfm9.execute-api.eu-north-1.amazonaws.com/staging/api/v1/public/locations/search?q=Bel"
```

### Features

- ✅ Returns max 10 results sorted by popularity (`listingsCount`)
- ✅ Handles special characters (e.g., "Uzi" matches "Užice")
- ✅ Deduplicates by `locationId` (e.g., "Belgrade" and "Beograd" return same ID)
- ✅ Case-insensitive search
- ✅ CORS restricted to allowed origins

---

## 2. Listing Search API

Comprehensive listing search endpoint that returns available properties based on location, dates, guests, and optional filters. Returns calculated pricing based on authentication status.

### Endpoint

```
GET /api/v1/public/listings/search
```

### Authentication

**Optional** - If `Authorization: Bearer <token>` header is provided, members pricing will be applied where available.

### Rate Limiting

- **60 requests per minute** per IP address
- Returns `429 Too Many Requests` if exceeded

### Query Parameters

#### Required Parameters

| Parameter    | Type   | Description                 | Example                | Validation                           |
| ------------ | ------ | --------------------------- | ---------------------- | ------------------------------------ |
| `locationId` | string | Mapbox Place ID             | `dXJuOm1ieHBsYzpBUVRC` | Alphanumeric, 10-50 chars            |
| `checkIn`    | string | Check-in date (ISO format)  | `2025-06-15`           | YYYY-MM-DD, today or future          |
| `checkOut`   | string | Check-out date (ISO format) | `2025-06-20`           | YYYY-MM-DD, after checkIn, max 365d  |
| `adults`     | number | Number of adults            | `2`                    | Integer, 1-50                        |

#### Optional Parameters

| Parameter            | Type    | Description                      | Example                         | Validation                                   |
| -------------------- | ------- | -------------------------------- | ------------------------------- | -------------------------------------------- |
| `children`           | number  | Number of children               | `1`                             | Integer, 0-50                                |
| `cursor`             | string  | Pagination cursor (base64)       | `eyJsYXN0S2V5Ijp7Li4ufX0=`      | Valid base64, max 2000 chars                 |
| `petsAllowed`        | boolean | Filter: Pets allowed             | `true`                          | `true` or `false`                            |
| `hasWIFI`            | boolean | Filter: WiFi available           | `true`                          | `true` or `false`                            |
| `hasAirConditioning` | boolean | Filter: Air conditioning         | `true`                          | `true` or `false`                            |
| `hasParking`         | boolean | Filter: Parking available        | `true`                          | `true` or `false`                            |
| `hasGym`             | boolean | Filter: Gym available            | `true`                          | `true` or `false`                            |
| `hasPool`            | boolean | Filter: Pool available           | `true`                          | `true` or `false`                            |
| `hasWorkspace`       | boolean | Filter: Dedicated workspace      | `true`                          | `true` or `false`                            |
| `parkingType`        | string  | Filter: Parking type (enum key)  | `FREE`, `PAID`, `STREET`        | One of: `FREE`, `PAID`, `STREET`, `NONE`     |
| `checkInType`        | string  | Filter: Check-in type (enum key) | `SELF_CHECKIN`, `HOST_GREETING` | One of: `SELF_CHECKIN`, `HOST_GREETING`, ... |
| `instantBook`        | boolean | Filter: Instant booking          | `true`                          | `true` or `false`                            |

### Response Structure

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
    
    // Filters
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
      totalPrice: number;              // Total for all nights
      pricePerNight: number;           // Average per night
      breakdown: Array<{
        date: string;                  // ISO date
        basePrice: number;             // Price before LoS discount
        finalPrice: number;            // Price after LoS discount
        isMembersPrice: boolean;       // Whether members discount was applied
        isSeasonalPrice: boolean;      // Whether seasonal pricing was used
      }>;
      lengthOfStayDiscount: {
        applied: boolean;
        minNights: number;
        discountType: "PERCENTAGE" | "ABSOLUTE";
        discountValue: number;
        totalSavings: number;
      } | null;
      membersPricingApplied: boolean;  // Whether user got members pricing
      touristTax: {
        type: "PER_NIGHT" | "PER_STAY";  // How the tax is charged
        adultAmount: number;             // Amount per adult per night
        childRates: Array<{              // Age-based child rates
          childRateId: string;
          ageFrom: number;               // 0-17 (inclusive)
          ageTo: number;                 // 0-17 (inclusive)
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
  };
  
  searchMeta: {
    locationId: string;
    checkIn: string;
    checkOut: string;
    nights: number;
    adults: number;
    children: number;
    totalGuests: number;
  };
}
```

### Example Requests

#### Anonymous Search (Standard Pricing)

```bash
curl "https://40usmhyfm9.execute-api.eu-north-1.amazonaws.com/staging/api/v1/public/listings/search?locationId=dXJuOm1ieHBsYzpBUVRC&checkIn=2025-06-15&checkOut=2025-06-20&adults=2&children=1&hasWIFI=true"
```

#### Authenticated Search (Members Pricing)

```bash
curl -H "Authorization: Bearer <cognito-jwt-token>" \
  "https://40usmhyfm9.execute-api.eu-north-1.amazonaws.com/staging/api/v1/public/listings/search?locationId=dXJuOm1ieHBsYzpBUVRC&checkIn=2025-06-15&checkOut=2025-06-20&adults=2"
```

#### With Pagination

```bash
curl "https://40usmhyfm9.execute-api.eu-north-1.amazonaws.com/staging/api/v1/public/listings/search?locationId=dXJuOm1ieHBsYzpBUVRC&checkIn=2025-06-15&checkOut=2025-06-20&adults=2&cursor=eyJwayI6IkxPQ0FUSU9OI2RYSnVPbTFpZUhCc1l6cEJVVlJDIiwic2siOiJMSVNUSU5HI2xpc3RpbmdfMTIzIn0="
```

### Example Response

```json
{
  "listings": [
    {
      "listingId": "listing_123abc",
      "hostId": "host_456def",
      "name": "Modern Apartment in City Center",
      "shortDescription": "Beautiful 2-bedroom apartment with stunning views...",
      "thumbnailUrl": "https://cdn.localstays.me/listings/listing_123abc/thumb.webp",
      "placeName": "Belgrade",
      "regionName": "Belgrade",
      "coordinates": {
        "latitude": 44.8176,
        "longitude": 20.4633
      },
      "maxGuests": 4,
      "bedrooms": 2,
      "beds": 2,
      "bathrooms": 1,
      "petsAllowed": false,
      "hasWIFI": true,
      "hasAirConditioning": true,
      "hasParking": true,
      "hasGym": false,
      "hasPool": false,
      "hasWorkspace": true,
      "parkingType": "FREE",
      "checkInType": "SELF_CHECKIN",
      "instantBook": false,
      "pricing": {
        "currency": "EUR",
        "totalPrice": 475.00,
        "pricePerNight": 95.00,
        "breakdown": [
          {
            "date": "2025-06-15",
            "basePrice": 100.00,
            "finalPrice": 95.00,
            "isMembersPrice": false,
            "isSeasonalPrice": false
          },
          {
            "date": "2025-06-16",
            "basePrice": 100.00,
            "finalPrice": 95.00,
            "isMembersPrice": false,
            "isSeasonalPrice": false
          },
          {
            "date": "2025-06-17",
            "basePrice": 100.00,
            "finalPrice": 95.00,
            "isMembersPrice": false,
            "isSeasonalPrice": false
          },
          {
            "date": "2025-06-18",
            "basePrice": 100.00,
            "finalPrice": 95.00,
            "isMembersPrice": false,
            "isSeasonalPrice": false
          },
          {
            "date": "2025-06-19",
            "basePrice": 100.00,
            "finalPrice": 95.00,
            "isMembersPrice": false,
            "isSeasonalPrice": false
          }
        ],
        "lengthOfStayDiscount": {
          "applied": true,
          "minNights": 5,
          "discountType": "PERCENTAGE",
          "discountValue": 5,
          "totalSavings": 25.00
        },
        "membersPricingApplied": false,
        "touristTax": {
          "perNightAdult": 1.50,
          "perNightChild": 0.75
        }
      }
    }
  ],
  "pagination": {
    "hasMore": false,
    "nextCursor": null,
    "totalReturned": 1
  },
  "searchMeta": {
    "locationId": "dXJuOm1ieHBsYzpBUVRC",
    "checkIn": "2025-06-15",
    "checkOut": "2025-06-20",
    "nights": 5,
    "adults": 2,
    "children": 1,
    "totalGuests": 3
  }
}
```

### Error Responses

#### 400 Bad Request - Validation Error

```json
{
  "error": "checkIn cannot be in the past",
  "code": "VALIDATION_ERROR"
}
```

**Common validation errors:**
- `locationId is required`
- `Invalid locationId format`
- `checkIn must be in YYYY-MM-DD format`
- `checkOut must be after checkIn`
- `Date range cannot exceed 365 days`
- `adults must be between 1 and 50`
- `Total guests cannot exceed 50`
- `Invalid cursor`

#### 429 Too Many Requests

```json
{
  "error": "Too many requests. Please try again later.",
  "code": "RATE_LIMIT_EXCEEDED"
}
```

#### 500 Internal Server Error

```json
{
  "error": "Internal server error",
  "code": "INTERNAL_ERROR"
}
```

### Performance

- **Expected latency**: 300-500ms for typical searches
- **Max results per request**: 100 listings
- **Parallel processing**: 40 concurrent availability/pricing queries
- **Optimizations**: 
  - Early filtering (boolean filters applied in Lambda)
  - Parameterized queries (no SQL injection risk)
  - Batch processing (parallel DynamoDB queries)
  - Efficient availability checks (single query per listing)

### Security Features

✅ **Input Validation**
- All inputs validated with strict regex patterns
- Length limits enforced
- Range checks for numeric values
- Enum whitelist validation

✅ **Injection Prevention**
- Parameterized DynamoDB queries only
- No string interpolation in queries
- Validated keys before use

✅ **Rate Limiting**
- IP-based rate limiting (60 req/min)
- Prevents brute force and DoS attacks

✅ **Resource Limits**
- Max 365 day search range
- Max 50 guests total
- Max 100 results per request
- Max 2000 char cursor size

✅ **Error Handling**
- No stack traces exposed
- Generic 500 errors
- Detailed CloudWatch logging

✅ **CORS Protection**
- Restricted to specific domains
- No wildcard origins

---

## Implementation Details

### Pricing Calculation Logic

1. **Base Price Selection**: For each night, find applicable base price (seasonal or default)
2. **Members Discount**: Apply members discount if user is authenticated and discount exists
3. **Length-of-Stay Discount**: Apply highest qualifying LoS discount across all nights
4. **Tourist Tax**: Return per-night rates only (not added to totals)

### Availability Logic

- Uses **negative availability model** (only unavailable nights are stored)
- Query range: `checkIn` to `checkOut - 1 day` (checkout day is available)
- If ANY record found in range → listing is unavailable
- Parallel batch processing (40 queries at a time)

### Pagination

- Uses DynamoDB `LastEvaluatedKey` for cursor-based pagination
- Cursor is base64-encoded JSON
- Max 100 results per page
- Frontend should use `nextCursor` from response for next page

---

## CORS Configuration

### Allowed Origins

**Staging:**
- `http://localhost:3000`
- `http://localhost:3001`
- `https://staging.localstays.me`

**Production:**
- `https://localstays.me`
- `https://www.localstays.me`

### Allowed Methods

- `GET`, `POST`, `PUT`, `DELETE`, `OPTIONS`

### Allowed Headers

- `Content-Type`
- `Authorization`
- `X-Amz-Date`
- `X-Api-Key`
- `X-Amz-Security-Token`

---

## Testing

### Location Search

```bash
# Search for Belgrade
curl "https://40usmhyfm9.execute-api.eu-north-1.amazonaws.com/staging/api/v1/public/locations/search?q=bel"

# Search for Užice (with special chars)
curl "https://40usmhyfm9.execute-api.eu-north-1.amazonaws.com/staging/api/v1/public/locations/search?q=uz"
```

### Listing Search

```bash
# Basic search (Belgrade, 5 nights, 2 adults)
curl "https://40usmhyfm9.execute-api.eu-north-1.amazonaws.com/staging/api/v1/public/listings/search?locationId=dXJuOm1ieHBsYzpBUVRC&checkIn=2025-06-15&checkOut=2025-06-20&adults=2"

# With filters (WiFi + Free Parking)
curl "https://40usmhyfm9.execute-api.eu-north-1.amazonaws.com/staging/api/v1/public/listings/search?locationId=dXJuOm1ieHBsYzpBUVRC&checkIn=2025-06-15&checkOut=2025-06-20&adults=2&hasWIFI=true&parkingType=FREE"

# With authentication (members pricing)
curl -H "Authorization: Bearer eyJraWQiOi..." \
  "https://40usmhyfm9.execute-api.eu-north-1.amazonaws.com/staging/api/v1/public/listings/search?locationId=dXJuOm1ieHBsYzpBUVRC&checkIn=2025-06-15&checkOut=2025-06-20&adults=2"
```




