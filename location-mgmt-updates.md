# Location Management - Frontend Updates

## New Admin API Endpoints

### 1. GET `/api/v1/admin/locations` - Search/List Locations

**Query Parameters:**

| Parameter         | Type                               | Required | Description                                      |
| ----------------- | ---------------------------------- | -------- | ------------------------------------------------ |
| `q`               | string                             | No       | Search term (begins_with match on location name) |
| `type`            | `COUNTRY` \| `PLACE` \| `LOCALITY` | No       | Filter by location type                          |
| `isLive`          | `true` \| `false`                  | No       | Filter by live status                            |
| `includeChildren` | `true` \| `false`                  | No       | Include child locations in results               |
| `limit`           | number                             | No       | Max results (default: 50, max: 100)              |
| `nextToken`       | string                             | No       | Pagination token                                 |

**Response:**

```json
{
  "locations": [
    {
      "locationId": "urn:mbx:place:abc123",
      "locationType": "PLACE",
      "name": "Zlatibor",
      "displayName": "Zlatibor",
      "countryName": "Serbia",
      "regionName": "Zlatiborski Okrug",
      "listingsCount": 15,
      "isLive": true,
      "createdAt": "2024-01-15T10:30:00.000Z",
      "updatedAt": "2024-01-15T10:30:00.000Z"
    }
  ],
  "nextToken": "eyJ...",
  "total": 42
}
```

---

### 2. POST `/api/v1/admin/locations` - Create Location

**Request Body:**

```json
{
  "locationId": "urn:mbx:place:xyz789",
  "locationType": "PLACE",
  "name": "Belgrade",
  "countryName": "Serbia",
  "countryCode": "RS",
  "regionName": "Belgrade Region",
  "mapboxCountryId": "urn:mbx:country:rs",
  "mapboxPlaceId": "urn:mbx:place:abc",
  "isLive": false
}
```

**Field Requirements by Location Type:**

| Field             | COUNTRY                   | PLACE                     | LOCALITY                  |
| ----------------- | ------------------------- | ------------------------- | ------------------------- |
| `locationId`      | Required                  | Required                  | Required                  |
| `locationType`    | Required                  | Required                  | Required                  |
| `name`            | Required                  | Required                  | Required                  |
| `countryName`     | Required                  | Required                  | Required                  |
| `countryCode`     | Required                  | Optional                  | Optional                  |
| `regionName`      | -                         | Required                  | Required                  |
| `mapboxCountryId` | -                         | Required (parent)         | Optional                  |
| `mapboxPlaceId`   | -                         | -                         | Required (parent)         |
| `isLive`          | Optional (default: false) | Optional (default: false) | Optional (default: false) |

**Validation Rules done in back end**

- `PLACE` requires `mapboxCountryId` - parent COUNTRY must exist
- `LOCALITY` requires `mapboxPlaceId` - parent PLACE must exist

**Response (201 Created):**

```json
{
  "locationId": "urn:mbx:place:xyz789",
  "locationType": "PLACE",
  "name": "Belgrade",
  "displayName": "Belgrade",
  "slug": "belgrade-rs",
  "countryName": "Serbia",
  "regionName": "Belgrade Region",
  "listingsCount": 0,
  "isLive": false,
  "createdAt": "2024-01-15T10:30:00.000Z",
  "updatedAt": "2024-01-15T10:30:00.000Z"
}
```

---

### 3. PUT `/api/v1/admin/locations/{locationId}` - Update Location

**Path Parameters:**

- `locationId` - URL-encoded Mapbox ID (e.g., `urn%3Ambx%3Aplace%3Aabc123`)

**Request Body:**

```json
{
  "isLive": true,
  "name": "Updated Name",
  "regionName": "New Region"
}
```

All fields are optional - only include fields you want to update.

**Response (200 OK):**

```json
{
  "locationId": "urn:mbx:place:abc123",
  "locationType": "PLACE",
  "name": "Updated Name",
  "displayName": "Updated Name",
  "countryName": "Serbia",
  "regionName": "New Region",
  "listingsCount": 15,
  "isLive": true,
  "createdAt": "2024-01-15T10:30:00.000Z",
  "updatedAt": "2024-01-16T14:20:00.000Z"
}
```

---

## Location Types Hierarchy

```
COUNTRY (e.g., Serbia)
  └── PLACE (e.g., Zlatibor, Belgrade)
        └── LOCALITY (e.g., Čajetina, Stari Grad)
```

---

## Key Behavior Changes

| Event                            | What Happens                                                                |
| -------------------------------- | --------------------------------------------------------------------------- |
| Host submits listing for review  | Location created (if new) with `isLive: false`, `listingsCount` incremented |
| Admin toggles `isLive` to `true` | Location appears in public search                                           |
| Host deletes listing             | `listingsCount` decremented                                                 |
| Host unpublishes/admin suspends  | **No change** to `listingsCount`                                            |

## UI Recommendations

### Location Search Page

- Search input with "begins with" matching
- Filters: Type dropdown, Live status toggle
- Table columns: Name, Type, Country, Listings Count, Live Status, Actions

### Create Location Modal

- Type selector (shows/hides relevant fields based on type)
- Parent location typeahead:
  - For PLACE → search Countries
  - For LOCALITY → search Places
- Live toggle (default OFF)

### Edit Location

- Inline toggle for `isLive` status
- Modal for editing name/region if needed

---

## Error Responses

| Status | Meaning                                                              |
| ------ | -------------------------------------------------------------------- |
| 400    | Bad request - missing required fields or validation failed           |
| 404    | Location not found (for PUT) or parent location not found (for POST) |
| 409    | Conflict - location with this ID already exists (for POST)           |
| 500    | Internal server error                                                |

---

## Additional Admin Listing Endpoints

### 4. PUT `/api/v1/admin/listings/{listingId}/coordinates` - Set/Update Coordinates

Sets or updates the latitude and longitude for a listing. If the listing is published, coordinates are synced to the public listings table.

**Path Parameters:**

- `listingId` - The listing UUID

**Request Body:**

```json
{
  "latitude": 42.423953,
  "longitude": 18.707541
}
```

**Validation:**

| Field       | Type   | Required | Valid Range |
| ----------- | ------ | -------- | ----------- |
| `latitude`  | number | Yes      | -90 to 90   |
| `longitude` | number | Yes      | -180 to 180 |

**Response (200 OK):**

```json
{
  "success": true,
  "data": {
    "listingId": "abc123",
    "coordinates": {
      "latitude": 42.423953,
      "longitude": 18.707541
    },
    "synced": true,
    "message": "Coordinates updated successfully"
  }
}
```

**Notes:**

- `synced: true` indicates the listing was published and coordinates were synced to public listings
- `synced: false` indicates the listing is not yet published (draft/in-review)

**Error Codes:**

| Code                  | Status | Message                                         |
| --------------------- | ------ | ----------------------------------------------- |
| `MISSING_LISTING_ID`  | 400    | Listing ID is required                          |
| `MISSING_COORDINATES` | 400    | Both latitude and longitude are required        |
| `INVALID_LATITUDE`    | 400    | Latitude must be a number between -90 and 90    |
| `INVALID_LONGITUDE`   | 400    | Longitude must be a number between -180 and 180 |
| `LISTING_NOT_FOUND`   | 404    | Listing not found                               |
