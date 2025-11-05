# Admin API: Set Listing to Reviewing Status

## Endpoint

```
PUT /api/v1/admin/listings/{listingId}/reviewing
```

## Authentication

Requires Cognito JWT token with `ADMIN_LISTING_REVIEW` permission.

## Request

### Path Parameters

- `listingId` (string, required) - The listing UUID

### Headers

```
Authorization: Bearer <cognito-jwt-token>
Content-Type: application/json
```

### Body

None (empty body)

## Response

### Success Response (200 OK)

```json
{
  "success": true,
  "message": "Listing set to reviewing status",
  "data": {
    "listingId": "listing_abc123...",
    "status": "REVIEWING",
    "reviewedBy": "admin@example.com",
    "reviewStartedAt": "2025-11-03T12:00:00.000Z"
  }
}
```

### Error Responses

#### 400 - Invalid Status Transition

Listing is not in `IN_REVIEW` status.

```json
{
  "success": false,
  "error": {
    "code": "INVALID_STATUS_TRANSITION",
    "message": "Cannot set listing to REVIEWING with current status APPROVED. Expected IN_REVIEW."
  }
}
```

#### 404 - Not Found

Listing does not exist.

```json
{
  "success": false,
  "error": {
    "code": "NOT_FOUND",
    "message": "Listing not found"
  }
}
```

#### 500 - Internal Server Error

```json
{
  "success": false,
  "error": {
    "code": "INTERNAL_ERROR",
    "message": "Failed to set listing to reviewing status"
  }
}
```

## Business Logic

- Only listings in `IN_REVIEW` status can be transitioned to `REVIEWING`
- Records the admin's email and timestamp when review starts
- Updates the listing's GSI for status-based queries

## Frontend Implementation Example

```typescript
async function setListingToReviewing(listingId: string): Promise<void> {
  const response = await fetch(
    `${API_BASE_URL}/api/v1/admin/listings/${listingId}/reviewing`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${getAuthToken()}`,
        "Content-Type": "application/json",
      },
    }
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error.message);
  }

  return data;
}
```
