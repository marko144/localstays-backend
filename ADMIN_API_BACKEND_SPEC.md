# Admin API Backend Specification

**Environment**: dev1  
**Base URL**: `https://tqaq505m83.execute-api.eu-north-1.amazonaws.com/dev1/api/v1/admin`  
**Authentication**: Cognito JWT (must have `ADMIN` role)

---

## Authentication

All endpoints require:

- `Authorization: Bearer <idToken>` header
- JWT must contain `custom:role = "ADMIN"`
- JWT contains `custom:permissions` (comma-separated list)

Each endpoint checks for specific permissions.

---

## Pagination

All list endpoints return paginated results:

- **Fixed page size**: 20 items
- **Query param**: `?page=1` (default: 1)
- **Response format**:

```json
{
  "items": [...],
  "total": 100,
  "page": 1,
  "pageSize": 20,
  "totalPages": 5
}
```

---

## Host Management (9 endpoints)

### 1. List All Hosts

**GET** `/hosts?page=1`  
**Permission**: `ADMIN_HOST_VIEW_ALL`  
**Purpose**: View paginated list of all hosts  
**Response**:

```json
{
  "hosts": [
    {
      "hostId": "uuid",
      "hostType": "INDIVIDUAL",
      "name": "John Doe",
      "email": "john@example.com",
      "countryCode": "RS",
      "status": "VERIFIED",
      "createdAt": "2025-01-01T00:00:00Z",
      "submittedAt": "2025-01-02T00:00:00Z"
    }
  ],
  "total": 100,
  "page": 1,
  "pageSize": 20,
  "totalPages": 5
}
```

### 2. Search Hosts

**GET** `/hosts/search?q=john&page=1`  
**Permission**: `ADMIN_HOST_SEARCH`  
**Purpose**: Search hosts by name or email (partial match)  
**Query**: `q` (required)  
**Response**: Same as List All Hosts

### 3. Get Host Details

**GET** `/hosts/{hostId}`  
**Permission**: `ADMIN_HOST_VIEW_ALL`  
**Purpose**: View full host profile including all fields  
**Response**:

```json
{
  "host": {
    "hostId": "uuid",
    "hostType": "INDIVIDUAL",
    "forename": "John",
    "surname": "Doe",
    "email": "john@example.com",
    "phoneNumber": "+381...",
    "dateOfBirth": "1990-01-01",
    "countryCode": "RS",
    "status": "VERIFIED",
    "kyc": {
      "status": "APPROVED",
      "submittedAt": "...",
      "approvedAt": "..."
    },
    "createdAt": "...",
    "updatedAt": "..."
  }
}
```

### 4. List Host Documents

**GET** `/hosts/{hostId}/documents`  
**Permission**: `ADMIN_KYC_VIEW_ALL`  
**Purpose**: List all KYC documents with download URLs  
**Response**:

```json
{
  "documents": [
    {
      "documentId": "uuid",
      "documentType": "PASSPORT",
      "fileName": "passport.pdf",
      "contentType": "application/pdf",
      "fileSize": 1024000,
      "uploadedAt": "2025-01-01T00:00:00Z",
      "status": "VERIFIED",
      "s3Url": "https://...?X-Amz-Expires=900"
    }
  ]
}
```

**Note**: S3 URLs expire in 15 minutes and force download.

### 5. Get Pending Review Hosts

**GET** `/hosts/pending-review?page=1`  
**Permission**: `ADMIN_KYC_VIEW_ALL`  
**Purpose**: List hosts in `VERIFICATION` status awaiting review  
**Response**: Same format as List All Hosts

### 6. Approve Host

**PUT** `/hosts/{hostId}/approve`  
**Permission**: `ADMIN_KYC_APPROVE`  
**Purpose**: Approve host profile (status → `VERIFIED`)  
**Body**: None  
**Response**:

```json
{
  "message": "Host profile approved successfully."
}
```

**Side effects**: Sends approval email (bilingual)

### 7. Reject Host

**PUT** `/hosts/{hostId}/reject`  
**Permission**: `ADMIN_KYC_REJECT`  
**Purpose**: Reject host profile (status → `REJECTED`)  
**Body**:

```json
{
  "rejectionReason": "Incomplete documents" // 1-500 chars
}
```

**Response**:

```json
{
  "message": "Host profile rejected successfully."
}
```

**Side effects**: Sends rejection email with reason (bilingual)

### 8. Suspend Host

**PUT** `/hosts/{hostId}/suspend`  
**Permission**: `ADMIN_HOST_SUSPEND`  
**Purpose**: Suspend host (status → `SUSPENDED`)  
**Body**:

```json
{
  "suspendedReason": "Fraudulent activity" // 1-500 chars
}
```

**Response**:

```json
{
  "message": "Host suspended successfully and all online listings set to OFFLINE."
}
```

**Side effects**:

- Sets all `ONLINE` listings to `OFFLINE`
- Sends suspension email (bilingual)

### 9. Reinstate Host

**PUT** `/hosts/{hostId}/reinstate`  
**Permission**: `ADMIN_HOST_REINSTATE`  
**Purpose**: Reinstate suspended host (status → `VERIFIED`)  
**Body**: None  
**Response**:

```json
{
  "message": "Host reinstated successfully."
}
```

**Note**: Listings remain `OFFLINE` (host must manually set them back to `ONLINE`)

---

## Listing Management (7 endpoints)

### 10. List All Listings

**GET** `/listings?page=1`  
**Permission**: `ADMIN_LISTING_VIEW_ALL`  
**Purpose**: View paginated list of all listings  
**Response**:

```json
{
  "listings": [
    {
      "listingId": "uuid",
      "hostId": "uuid",
      "listingName": "Cozy Apartment",
      "propertyType": "Apartment",
      "status": "APPROVED",
      "city": "Belgrade",
      "countryCode": "RS",
      "pricePerNight": 5000,
      "currency": "RSD",
      "createdAt": "2025-01-01T00:00:00Z",
      "updatedAt": "2025-01-01T00:00:00Z"
    }
  ],
  "total": 50,
  "page": 1,
  "pageSize": 20,
  "totalPages": 3
}
```

### 11. Get Pending Review Listings

**GET** `/listings/pending-review?page=1`  
**Permission**: `ADMIN_LISTING_VIEW_ALL`  
**Purpose**: List listings in `IN_REVIEW` status  
**Response**: Same format as List All Listings

### 12. Get Host's Listings

**GET** `/hosts/{hostId}/listings?page=1`  
**Permission**: `ADMIN_LISTING_VIEW_ALL`  
**Purpose**: List all listings for a specific host  
**Response**: Same format as List All Listings

### 13. Get Listing Details

**GET** `/listings/{listingId}`  
**Permission**: `ADMIN_LISTING_VIEW_ALL`  
**Purpose**: View full listing details including images and documents  
**Response**:

```json
{
  "listing": {
    "listingId": "uuid",
    "hostId": "uuid",
    "listingName": "Cozy Apartment",
    "propertyType": { "en": "Apartment", "sr": "Апартман" },
    "status": "IN_REVIEW",
    "address": {
      "street": "Knez Mihailova 1",
      "city": "Belgrade",
      "countryCode": "RS",
      "postalCode": "11000",
      "coordinates": { "lat": 44.8176, "lng": 20.4633 }
    },
    "pricing": {
      "pricePerNight": 5000,
      "currency": "RSD",
      "cleaningFee": 1000,
      "securityDeposit": 5000
    },
    "amenities": [...],
    "images": [
      {
        "imageId": "uuid",
        "url": "https://...?X-Amz-Expires=900",
        "order": 1
      }
    ],
    "documents": [...],
    "createdAt": "...",
    "updatedAt": "..."
  }
}
```

### 14. Approve Listing

**PUT** `/listings/{listingId}/approve`  
**Permission**: `ADMIN_LISTING_APPROVE`  
**Purpose**: Approve listing (status → `APPROVED`)  
**Body**: None  
**Response**:

```json
{
  "message": "Listing approved successfully."
}
```

**Side effects**: Sends approval email (bilingual)

### 15. Reject Listing

**PUT** `/listings/{listingId}/reject`  
**Permission**: `ADMIN_LISTING_REJECT`  
**Purpose**: Reject listing (status → `REJECTED`)  
**Body**:

```json
{
  "rejectionReason": "Photos do not match property description" // 1-500 chars
}
```

**Response**:

```json
{
  "message": "Listing rejected successfully."
}
```

**Side effects**: Sends rejection email (bilingual)

### 16. Suspend Listing

**PUT** `/listings/{listingId}/suspend`  
**Permission**: `ADMIN_LISTING_SUSPEND`  
**Purpose**: Suspend listing (status → `LOCKED`)  
**Body**:

```json
{
  "lockReason": "Safety violation" // 1-500 chars
}
```

**Response**:

```json
{
  "message": "Listing suspended successfully."
}
```

**Side effects**: Sends suspension email (bilingual)

---

## Request Management (6 endpoints)

### 17. List All Requests

**GET** `/requests?page=1`  
**Permission**: `ADMIN_REQUEST_VIEW_ALL`  
**Purpose**: View paginated list of all submitted requests  
**Response**:

```json
{
  "requests": [
    {
      "requestId": "uuid",
      "hostId": "uuid",
      "hostName": "John Doe",
      "requestType": "Live ID Check",
      "status": "RECEIVED",
      "createdAt": "2025-01-01T00:00:00Z",
      "submittedAt": "2025-01-02T00:00:00Z"
    }
  ],
  "total": 30,
  "page": 1,
  "pageSize": 20,
  "totalPages": 2
}
```

### 18. Get Pending Review Requests

**GET** `/requests/pending-review?page=1`  
**Permission**: `ADMIN_REQUEST_VIEW_ALL`  
**Purpose**: List requests in `RECEIVED` status awaiting review  
**Response**: Same format as List All Requests

### 19. Get Host's Requests

**GET** `/hosts/{hostId}/requests?page=1`  
**Permission**: `ADMIN_REQUEST_VIEW_ALL`  
**Purpose**: List all requests for a specific host  
**Response**: Same format as List All Requests

### 20. Get Request Details

**GET** `/requests/{requestId}`  
**Permission**: `ADMIN_REQUEST_VIEW_ALL`  
**Purpose**: View Live ID check details with video download URL  
**Response**:

```json
{
  "request": {
    "requestId": "uuid",
    "hostId": "uuid",
    "requestType": "LIVE_ID_CHECK",
    "status": "RECEIVED",
    "videoFile": {
      "fileName": "live-id-check.mp4",
      "fileSize": 52428800,
      "contentType": "video/mp4",
      "s3Key": "host123/requests/req456/live-id-check.mp4",
      "s3Url": "https://...?X-Amz-Expires=900"
    },
    "createdAt": "2025-01-01T00:00:00Z",
    "submittedAt": "2025-01-02T00:00:00Z"
  }
}
```

**Note**: S3 video URL expires in 15 minutes.

### 21. Approve Request

**PUT** `/requests/{requestId}/approve`  
**Permission**: `ADMIN_REQUEST_APPROVE`  
**Purpose**: Approve Live ID check (status → `VERIFIED`)  
**Body**: None  
**Response**:

```json
{
  "message": "Request approved successfully."
}
```

**Side effects**: Sends approval email (bilingual)

### 22. Reject Request

**PUT** `/requests/{requestId}/reject`  
**Permission**: `ADMIN_REQUEST_REJECT`  
**Purpose**: Reject Live ID check (status → `REJECTED`)  
**Body**:

```json
{
  "rejectionReason": "Video quality insufficient" // 1-500 chars
}
```

**Response**:

```json
{
  "message": "Request rejected successfully."
}
```

**Side effects**: Sends rejection email (bilingual)

---

## Error Responses

All endpoints return standard error format:

```json
{
  "error": "ERROR_CODE",
  "message": "Human-readable error message"
}
```

**Common Status Codes**:

- `400` - Bad Request (invalid input)
- `401` - Unauthorized (missing/invalid token)
- `403` - Forbidden (missing permission)
- `404` - Not Found
- `409` - Conflict (status changed by another process)
- `500` - Internal Server Error

---

## Email Notifications

The following actions trigger automatic bilingual emails (EN/SR based on host's `preferredLanguage`):

1. Host profile approved
2. Host profile rejected (includes reason)
3. Host suspended (includes reason)
4. Listing approved
5. Listing rejected (includes reason)
6. Listing suspended (includes reason)
7. Request approved
8. Request rejected (includes reason)

Hosts are NOT notified when reinstated (per design).

---

## S3 Pre-signed URLs

Documents and videos are accessed via S3 pre-signed URLs:

- **Expiry**: 15 minutes
- **Behavior**: Force download (not inline viewing)
- **Regeneration**: Call the endpoint again to get a fresh URL

---

## Implementation Notes

- **Pagination**: Fixed at 20 items per page, no configuration
- **Sorting**:
  - Hosts/Listings: Oldest created first
  - Requests: Oldest submitted first
- **Concurrency**: Update operations use conditional writes to prevent race conditions
- **Logging**: All admin actions are logged with user context
- **Cascade**: Suspending a host sets all their `ONLINE` listings to `OFFLINE`

---

## Testing Checklist

1. ✅ Get admin JWT token from Cognito (must have `ADMIN` role)
2. ✅ Verify token contains `custom:permissions`
3. ✅ Test each endpoint with valid token
4. ✅ Test pagination (page=1, page=2)
5. ✅ Test search functionality
6. ✅ Verify S3 URLs work and expire after 15 minutes
7. ✅ Confirm emails are sent for approval/rejection/suspension actions
8. ✅ Test error cases (403, 404, 409)
9. ✅ Verify cascading suspend (host → listings)
10. ✅ Check bilingual email delivery
