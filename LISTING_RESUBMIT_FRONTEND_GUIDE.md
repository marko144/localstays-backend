# Listing Resubmit for Review - Frontend Integration Guide

## Overview

This endpoint allows hosts to resubmit a **REJECTED** listing back to the admin for review. It simply changes the listing status from `REJECTED` to `IN_REVIEW`.

---

## Endpoint Details

### POST `/api/v1/hosts/{hostId}/listings/{listingId}/resubmit`

**Purpose:** Resubmit a rejected listing for admin review

**Authentication:** Required (Cognito JWT token)

**Authorization:**

- **HOST**: Can resubmit their own listings
- **ADMIN**: Can resubmit any listing

---

## Request

### Path Parameters

| Parameter   | Type   | Required | Description                     |
| ----------- | ------ | -------- | ------------------------------- |
| `hostId`    | string | Yes      | The host's unique identifier    |
| `listingId` | string | Yes      | The listing's unique identifier |

### Headers

```http
Authorization: Bearer <cognito-jwt-token>
Content-Type: application/json
```

### Request Body

**No request body required** - this is a simple status change endpoint.

---

## Response

### Success Response (200 OK)

```json
{
  "success": true,
  "data": {
    "listingId": "listing_332839fd-2b72-416a-87fa-032cbb0052f8",
    "previousStatus": "REJECTED",
    "newStatus": "IN_REVIEW",
    "message": "Listing successfully resubmitted for review"
  }
}
```

### Error Responses

#### 400 Bad Request - Invalid Status

Listing is not in REJECTED status.

```json
{
  "success": false,
  "error": {
    "code": "INVALID_STATUS",
    "message": "Listing cannot be resubmitted in current status: APPROVED. Only REJECTED listings can be resubmitted."
  }
}
```

#### 401 Unauthorized

Missing or invalid authentication token.

```json
{
  "success": false,
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Authentication required"
  }
}
```

#### 403 Forbidden

User doesn't have permission to resubmit this listing.

```json
{
  "success": false,
  "error": {
    "code": "FORBIDDEN",
    "message": "You do not have permission to access this resource"
  }
}
```

#### 404 Not Found

Listing doesn't exist.

```json
{
  "success": false,
  "error": {
    "code": "NOT_FOUND",
    "message": "Listing not found"
  }
}
```

---

## Frontend Implementation

### When to Show Resubmit Button

Only show the "Resubmit for Review" button when:

- Listing status is `REJECTED`
- User is the listing owner (HOST) or an ADMIN

```typescript
function shouldShowResubmitButton(
  listing: Listing,
  currentUser: User
): boolean {
  return (
    listing.status === "REJECTED" &&
    (currentUser.role === "ADMIN" || currentUser.hostId === listing.hostId)
  );
}
```

### Example API Call

```typescript
async function resubmitListing(
  hostId: string,
  listingId: string,
  token: string
): Promise<void> {
  const response = await fetch(
    `https://api.localstays.me/api/v1/hosts/${hostId}/listings/${listingId}/resubmit`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    }
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error?.message || "Failed to resubmit listing");
  }

  const result = await response.json();
  return result.data;
}
```

### Example Usage in Component

```typescript
import { useState } from "react";

function ListingDetailsPage({ listing, currentUser, token }) {
  const [isResubmitting, setIsResubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleResubmit = async () => {
    if (
      !confirm("Are you sure you want to resubmit this listing for review?")
    ) {
      return;
    }

    setIsResubmitting(true);
    setError(null);

    try {
      await resubmitListing(listing.hostId, listing.listingId, token);

      // Show success message
      alert("Listing successfully resubmitted for review!");

      // Refresh listing data or update local state
      window.location.reload(); // Or use your state management solution
    } catch (err) {
      setError(err.message);
      console.error("Failed to resubmit listing:", err);
    } finally {
      setIsResubmitting(false);
    }
  };

  // Only show button for REJECTED listings
  if (listing.status !== "REJECTED") {
    return null;
  }

  return (
    <div>
      <button
        onClick={handleResubmit}
        disabled={isResubmitting}
        className="btn-primary"
      >
        {isResubmitting ? "Resubmitting..." : "Resubmit for Review"}
      </button>

      {error && <div className="error-message">{error}</div>}
    </div>
  );
}
```

---

## User Flow

### For Hosts

1. **Listing is Rejected**: Admin rejects the listing with feedback
2. **Host Reviews Feedback**: Host sees rejection reason and makes necessary changes
3. **Host Makes Updates**: Host updates listing metadata, images, etc. as needed
4. **Host Resubmits**: Host clicks "Resubmit for Review" button
5. **Status Changes**: Listing status changes from `REJECTED` to `IN_REVIEW`
6. **Admin Reviews Again**: Listing appears in admin's "Pending Review" queue

### Status Flow

```
REJECTED → [Host clicks Resubmit] → IN_REVIEW → [Admin reviews] → APPROVED/REJECTED
```

---

## Important Notes

### 1. Status Validation

- **Only works for REJECTED listings**
- Attempting to resubmit listings in other statuses will fail with `INVALID_STATUS` error

### 2. No Automatic Notifications

- This endpoint does **not** send email notifications
- The listing simply moves back into the admin review queue
- Consider showing a success message to the user after resubmission

### 3. Before Resubmitting

- Ensure the host has addressed the rejection feedback
- Consider showing a checklist or reminder of what was rejected
- Allow hosts to review their changes before resubmitting

### 4. After Resubmission

- Update the UI to reflect the new `IN_REVIEW` status
- Remove or disable the "Resubmit" button
- Show appropriate status badge/indicator

### 5. Multiple Resubmissions

- There is no limit on how many times a listing can be resubmitted
- Each rejection → resubmission cycle is allowed
- Consider tracking resubmission count in your frontend analytics

---

## UI/UX Recommendations

### Button Placement

- Place the "Resubmit for Review" button prominently on rejected listing pages
- Consider placing it near the rejection feedback/reason
- Make it visually distinct (e.g., primary button style)

### Confirmation Dialog

- Show a confirmation dialog before resubmitting
- Include a reminder to review rejection feedback
- Optional: Show a checklist of common rejection reasons

### Success Feedback

- Show a clear success message after resubmission
- Update the listing status badge immediately
- Consider redirecting to the listing list or dashboard

### Error Handling

- Display clear error messages if resubmission fails
- For `INVALID_STATUS` errors, explain that only rejected listings can be resubmitted
- Provide a way to retry if the request fails due to network issues

---

## Testing Checklist

- [ ] Resubmit button only appears for REJECTED listings
- [ ] Resubmit button hidden for other statuses (DRAFT, IN_REVIEW, APPROVED, etc.)
- [ ] Successful resubmission updates listing status to IN_REVIEW
- [ ] Success message displayed after resubmission
- [ ] Error handling works for invalid status
- [ ] Error handling works for unauthorized access
- [ ] Loading state shown during API call
- [ ] Button disabled during resubmission to prevent double-clicks
- [ ] Confirmation dialog prevents accidental resubmissions
- [ ] UI updates correctly after resubmission (status badge, button visibility)
