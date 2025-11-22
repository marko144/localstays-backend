# Frontend Search API Integration Guide

## Base URL

```
https://40usmhyfm9.execute-api.eu-north-1.amazonaws.com/staging/
```

Store as: `NEXT_PUBLIC_GUEST_API_URL`

---

## 1. Location Search (Autocomplete)

### Endpoint

```
GET /api/v1/public/locations/search?q={query}
```

### Request

```typescript
const searchLocations = async (query: string) => {
  const response = await fetch(
    `${GUEST_API_URL}/api/v1/public/locations/search?q=${encodeURIComponent(
      query
    )}`
  );
  return response.json();
};
```

### Response

```typescript
{
  locations: Array<{
    locationId: string; // Use this for listing search
    name: string; // Display this
  }>;
}
```

### Example

```typescript
// User types "Bel"
const results = await searchLocations("Bel");
// Returns: [{ locationId: "dXJuOm1ieHBsYzpBUVRC", name: "Belgrade" }]
```

---

## 2. Listing Search

### Endpoint

```
GET /api/v1/public/listings/search
```

### Required Parameters

- `locationId` - From location search
- `checkIn` - ISO date (YYYY-MM-DD)
- `checkOut` - ISO date (YYYY-MM-DD)
- `adults` - Number (1-50)

### Optional Parameters

- `children` - Number (0-50)
- `cursor` - Pagination token from previous response
- `petsAllowed` - Boolean (`true`/`false`)
- `hasWIFI` - Boolean
- `hasAirConditioning` - Boolean
- `hasParking` - Boolean
- `hasGym` - Boolean
- `hasPool` - Boolean
- `hasWorkspace` - Boolean
- `parkingType` - String (`FREE`, `PAID`, `STREET`, `NONE`)
- `checkInType` - String (`SELF_CHECKIN`, `HOST_GREETING`, `KEYPAD`, `LOCKBOX`)
- `instantBook` - Boolean

### Request (Anonymous)

```typescript
const searchListings = async (params: {
  locationId: string;
  checkIn: string;
  checkOut: string;
  adults: number;
  children?: number;
  cursor?: string;
  filters?: Record<string, boolean | string>;
}) => {
  const queryParams = new URLSearchParams({
    locationId: params.locationId,
    checkIn: params.checkIn,
    checkOut: params.checkOut,
    adults: params.adults.toString(),
  });

  if (params.children)
    queryParams.append("children", params.children.toString());
  if (params.cursor) queryParams.append("cursor", params.cursor);

  // Add filters
  if (params.filters) {
    Object.entries(params.filters).forEach(([key, value]) => {
      queryParams.append(key, value.toString());
    });
  }

  const response = await fetch(
    `${GUEST_API_URL}/api/v1/public/listings/search?${queryParams}`
  );
  return response.json();
};
```

### Request (Authenticated - Members Pricing)

```typescript
const searchListingsAuth = async (params, accessToken: string) => {
  // Same as above, but add Authorization header
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
  return response.json();
};
```

### Response

```typescript
{
  listings: Array<{
    listingId: string;
    hostId: string;
    name: string;
    shortDescription: string;
    thumbnailUrl: string; // CloudFront URL
    placeName: string;
    regionName: string;
    coordinates: {
      latitude: number;
      longitude: number;
    };
    maxGuests: number;
    bedrooms: number;
    beds: number;
    bathrooms: number;
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
    pricing: {
      currency: string; // "EUR"
      totalPrice: number; // Total for all nights
      pricePerNight: number; // Average per night
      breakdown: Array<{
        date: string; // "2025-12-15"
        basePrice: number;
        finalPrice: number;
        isMembersPrice: boolean;
        isSeasonalPrice: boolean;
      }>;
      lengthOfStayDiscount: {
        applied: boolean;
        minNights: number;
        discountType: "PERCENTAGE" | "ABSOLUTE";
        discountValue: number;
        totalSavings: number;
      } | null;
      membersPricingApplied: boolean;
      touristTax: {
        perNightAdult: number; // Per adult per night
        perNightChild: number; // Per child per night
      } | null;
    };
  }>;
  pagination: {
    hasMore: boolean; // True if more results available
    nextCursor: string | null; // Pass this as 'cursor' param for next page
    totalReturned: number; // Number of results in this response
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

## 3. Pagination

### Implementation

```typescript
const [listings, setListings] = useState([]);
const [cursor, setCursor] = useState<string | null>(null);
const [hasMore, setHasMore] = useState(false);

const loadListings = async (isLoadMore = false) => {
  const params = {
    locationId: "dXJuOm1ieHBsYzpBUVRC",
    checkIn: "2025-12-15",
    checkOut: "2025-12-20",
    adults: 2,
    cursor: isLoadMore ? cursor : undefined, // Only include cursor for "load more"
  };

  const result = await searchListings(params);

  if (isLoadMore) {
    setListings((prev) => [...prev, ...result.listings]); // Append
  } else {
    setListings(result.listings); // Replace
  }

  setCursor(result.pagination.nextCursor);
  setHasMore(result.pagination.hasMore);
};

// Initial load
loadListings();

// Load more button
<button onClick={() => loadListings(true)} disabled={!hasMore}>
  Load More
</button>;
```

---

## 4. Display Pricing

### Show Total Price

```typescript
const { currency, totalPrice, pricePerNight } = listing.pricing;

// Display: "€320 total (€64/night)"
<div>
  {currency === "EUR" ? "€" : currency}
  {totalPrice} total
  <span>
    ({currency === "EUR" ? "€" : currency}
    {pricePerNight}/night)
  </span>
</div>;
```

### Show Discounts

```typescript
const { lengthOfStayDiscount, membersPricingApplied } = listing.pricing;

{
  lengthOfStayDiscount?.applied && (
    <div>
      Save €{lengthOfStayDiscount.totalSavings} with{" "}
      {lengthOfStayDiscount.minNights}+ night stay
    </div>
  );
}

{
  membersPricingApplied && <div>Members pricing applied ✓</div>;
}
```

### Show Tourist Tax (Separate)

```typescript
const { touristTax } = listing.pricing;
const { adults, children } = searchMeta;

{
  touristTax && (
    <div>
      Tourist tax: €{touristTax.perNightAdult}/night per adult
      {children > 0 && `, €${touristTax.perNightChild}/night per child`}
    </div>
  );
}
```

---

## 5. Error Handling

```typescript
try {
  const result = await searchListings(params);
  // Handle success
} catch (error) {
  const errorData = await error.response.json();

  switch (error.response.status) {
    case 400:
      // Validation error - show errorData.error to user
      alert(errorData.error);
      break;
    case 429:
      // Rate limited - ask user to wait
      alert("Too many requests. Please try again in a minute.");
      break;
    case 500:
      // Server error - generic message
      alert("Something went wrong. Please try again.");
      break;
  }
}
```

---

## 6. Example: Complete Search Flow

```typescript
// 1. User searches for location
const locations = await searchLocations("Belgrade");
const selectedLocation = locations[0]; // User selects Belgrade

// 2. User selects dates and guests
const searchParams = {
  locationId: selectedLocation.locationId,
  checkIn: "2025-12-15",
  checkOut: "2025-12-20",
  adults: 2,
  children: 1,
  filters: {
    hasWIFI: true,
    petsAllowed: true,
  },
};

// 3. Search listings
const results = await searchListings(searchParams);

// 4. Display results
results.listings.forEach((listing) => {
  console.log(`${listing.name} - €${listing.pricing.totalPrice}`);
});

// 5. Load more if available
if (results.pagination.hasMore) {
  const moreResults = await searchListings({
    ...searchParams,
    cursor: results.pagination.nextCursor,
  });
}
```

---

## 7. TypeScript Types

```typescript
interface Location {
  locationId: string;
  name: string;
}

interface Listing {
  listingId: string;
  hostId: string;
  name: string;
  shortDescription: string;
  thumbnailUrl: string;
  placeName: string;
  regionName: string;
  coordinates: { latitude: number; longitude: number };
  maxGuests: number;
  bedrooms: number;
  beds: number;
  bathrooms: number;
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
  pricing: {
    currency: string;
    totalPrice: number;
    pricePerNight: number;
    breakdown: Array<{
      date: string;
      basePrice: number;
      finalPrice: number;
      isMembersPrice: boolean;
      isSeasonalPrice: boolean;
    }>;
    lengthOfStayDiscount: {
      applied: boolean;
      minNights: number;
      discountType: "PERCENTAGE" | "ABSOLUTE";
      discountValue: number;
      totalSavings: number;
    } | null;
    membersPricingApplied: boolean;
    touristTax: {
      perNightAdult: number;
      perNightChild: number;
    } | null;
  };
}

interface SearchResponse {
  listings: Listing[];
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

---

## Notes

- **Rate Limit**: 60 requests/minute per IP
- **Max Results**: 100 per page
- **Date Format**: Always use `YYYY-MM-DD` (ISO 8601)
- **Thumbnail URLs**: Already CloudFront URLs, ready to display
- **Tourist Tax**: Display separately, NOT included in `totalPrice`
- **Members Pricing**: Only applies if user is authenticated AND host set members discount
- **Cursor**: Opaque base64 string - don't parse it, just pass it back



