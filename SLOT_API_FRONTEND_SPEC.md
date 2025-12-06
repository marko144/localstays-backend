# Advertising Slots API - Frontend Integration Guide

This document describes the host-facing API endpoints for managing advertising slots.

## Overview

Advertising slots are created when a listing is published. Each slot:

- Is permanently bound to one listing
- Has an expiry date aligned with the subscription period
- Can be set to "do not renew" to stop auto-renewal at period end
- Automatically renews when the subscription renews (unless marked do-not-renew)

## Token Model

**Tokens = Maximum concurrent published listings**

- A subscription plan grants X tokens (e.g., Small Portfolio = 5 tokens)
- Publishing a listing creates a slot and uses 1 token
- `availableTokens = totalTokens - activeSlots.length`
- At subscription renewal:
  - Slots with `doNotRenew=false` → automatically extended (token spent)
  - Slots with `doNotRenew=true` → expire, listing goes offline, token freed
- **Hosts cannot manually unpublish/delete slots** - they can only set `doNotRenew=true` and wait for natural expiry at period end

**Why no unpublish?**

- Prevents gaming the system (publish/unpublish/publish different listings)
- Tokens represent concurrent ad capacity, not a "publish budget"
- To free a token, host sets `doNotRenew=true` and the slot expires at period end

---

## Endpoints

### 1. Get Host Subscription (includes active slots)

**Endpoint:** `GET /api/v1/hosts/{hostId}/subscription`

**Description:** Returns the host's subscription details including all active advertising slots.

**Authentication:** Required (Cognito JWT)

**Authorization:** Must be the host owner or admin

**Response:**

```json
{
  "hostId": "host_2f58aff4-a9f1-43d8-bdf9-c3f4e6728e5e",
  "status": "ACTIVE",
  "statusLabel": "Active",
  "statusLabel_sr": "Aktivna",
  "planId": "Small Portfolio",
  "planName": "Small Portfolio",
  "planName_sr": "Mali Portfolio",
  "totalTokens": 5,
  "usedTokens": 2,
  "availableTokens": 3,
  "canPublishNewAd": true,
  "currentPeriodStart": "2025-12-05T17:22:48.000Z",
  "currentPeriodEnd": "2026-01-05T17:22:48.000Z",
  "effectivePeriodEnd": "2026-01-05T17:22:48.000Z",
  "cancelAtPeriodEnd": false,
  "isTrialPeriod": false,
  "stripeCustomerId": "cus_TY90xE9nAlGQcc",
  "hasPaymentMethod": true,
  "activeSlots": [
    {
      "slotId": "slot_abc123-def456",
      "listingId": "lst_xyz789",
      "listingName": "Cozy Apartment in Belgrade",
      "thumbnailUrl": "https://cdn.localstays.rs/images/...",
      "activatedAt": "2025-12-05T18:00:00.000Z",
      "expiresAt": "2026-01-05T23:59:59.999Z",
      "daysRemaining": 31,
      "reviewCompensationDays": 0,
      "doNotRenew": false,
      "isPastDue": false,
      "displayStatus": "AUTO_RENEWS",
      "displayLabel": "Auto-renews on Jan 5",
      "displayLabel_sr": "Automatski se obnavlja 5. jan"
    },
    {
      "slotId": "slot_ghi789-jkl012",
      "listingId": "lst_abc456",
      "listingName": "Mountain Cabin",
      "thumbnailUrl": "https://cdn.localstays.rs/images/...",
      "activatedAt": "2025-12-01T10:00:00.000Z",
      "expiresAt": "2026-01-05T23:59:59.999Z",
      "daysRemaining": 31,
      "reviewCompensationDays": 3,
      "doNotRenew": true,
      "isPastDue": false,
      "displayStatus": "EXPIRES",
      "displayLabel": "Expires on Jan 5",
      "displayLabel_sr": "Ističe 5. jan"
    }
  ],
  "createdAt": "2025-12-05T17:22:54.196Z",
  "updatedAt": "2025-12-05T18:23:11.456Z"
}
```

**Slot Display Statuses:**

| Status          | Description                                             | UI Guidance               |
| --------------- | ------------------------------------------------------- | ------------------------- |
| `AUTO_RENEWS`   | Will be extended at next renewal                        | Show green indicator      |
| `EXPIRES`       | Will expire (doNotRenew=true or subscription cancelled) | Show orange indicator     |
| `EXPIRING_SOON` | Expires within 7 days                                   | Show red/urgent indicator |
| `PAST_DUE`      | Payment failed, in grace period                         | Show warning banner       |

---

### 2. Publish Listing (creates slot)

**Endpoint:** `POST /api/v1/hosts/{hostId}/listings/{listingId}/publish`

**Description:** Publishes an APPROVED or OFFLINE listing, creating an advertising slot.

**Authentication:** Required (Cognito JWT)

**Authorization:** Must be the host owner

**Prerequisites:**

- Listing must be in `APPROVED` or `OFFLINE` status
- Host must have an active subscription with available tokens (`canPublishNewAd: true`)

**Request Body:** None required

**Response (Success):**

```json
{
  "message": "Listing published successfully",
  "listingId": "lst_xyz789",
  "locationId": "dXJuOm1ieHBsYzpBZGlH",
  "status": "ONLINE",
  "slotId": "slot_abc123-def456",
  "slotExpiresAt": "2026-01-05T23:59:59.999Z"
}
```

**Error Responses:**

| Status | Error                                            | Description                            |
| ------ | ------------------------------------------------ | -------------------------------------- |
| 400    | `Listing must be APPROVED or OFFLINE to publish` | Wrong listing status                   |
| 403    | `No active subscription`                         | Host has no subscription               |
| 403    | `No tokens available`                            | All tokens are in use                  |
| 403    | `Subscription is past due`                       | Payment failed, cannot publish new ads |

---

### 3. Set Slot Do Not Renew

**Endpoint:** `PUT /api/v1/hosts/{hostId}/listings/{listingId}/slot/do-not-renew`

**Description:** Toggle whether a listing's advertising slot should be automatically renewed.

**Authentication:** Required (Cognito JWT)

**Authorization:** Must be the host owner

**Request Body:**

```json
{
  "doNotRenew": true
}
```

| Field        | Type    | Required | Description                                |
| ------------ | ------- | -------- | ------------------------------------------ |
| `doNotRenew` | boolean | Yes      | `true` = don't renew, `false` = auto-renew |

**Response (Success):**

```json
{
  "success": true,
  "listingId": "lst_xyz789",
  "slotId": "slot_abc123-def456",
  "doNotRenew": true,
  "expiresAt": "2026-01-05T23:59:59.999Z",
  "message": "Ad will not be automatically renewed. It will expire on the shown date.",
  "message_sr": "Oglas neće biti automatski obnovljen. Ističe na prikazani datum."
}
```

**When `doNotRenew: false`:**

```json
{
  "success": true,
  "listingId": "lst_xyz789",
  "slotId": "slot_abc123-def456",
  "doNotRenew": false,
  "expiresAt": "2026-01-05T23:59:59.999Z",
  "message": "Ad will be automatically renewed at your next subscription renewal.",
  "message_sr": "Oglas će biti automatski obnovljen pri sledećem obnavljanju pretplate."
}
```

**Error Responses:**

| Status | Error                              | Description              |
| ------ | ---------------------------------- | ------------------------ |
| 400    | `doNotRenew must be a boolean`     | Invalid request body     |
| 400    | `No active advertising slot found` | Listing is not published |
| 404    | `Listing not found`                | Listing doesn't exist    |

---

## TypeScript Types

```typescript
// Slot display status
type SlotDisplayStatus =
  | "AUTO_RENEWS" // Will be extended at next renewal
  | "EXPIRES" // Will expire (doNotRenew = true or subscription cancelled)
  | "PAST_DUE" // Payment failed, in grace period
  | "EXPIRING_SOON"; // Expires within 7 days

// Slot summary (returned in subscription response)
interface SlotSummary {
  slotId: string;
  listingId: string;
  listingName: string;
  thumbnailUrl: string;
  activatedAt: string; // ISO timestamp
  expiresAt: string; // ISO timestamp
  daysRemaining: number; // Days until expiry
  reviewCompensationDays: number; // Extra days added for review time
  doNotRenew: boolean; // If true, won't renew
  isPastDue: boolean; // Payment failed
  displayStatus: SlotDisplayStatus;
  displayLabel: string; // e.g., "Auto-renews on Jan 5"
  displayLabel_sr: string; // Serbian translation
}

// Subscription with slots
interface HostSubscription {
  hostId: string;
  status:
    | "NONE"
    | "INCOMPLETE"
    | "TRIALING"
    | "ACTIVE"
    | "PAST_DUE"
    | "CANCELLED"
    | "EXPIRED";
  statusLabel: string;
  statusLabel_sr: string;
  planId: string | null;
  planName: string | null;
  planName_sr: string | null;
  totalTokens: number;
  usedTokens: number;
  availableTokens: number;
  canPublishNewAd: boolean;
  currentPeriodStart?: string;
  currentPeriodEnd?: string;
  effectivePeriodEnd?: string;
  cancelAtPeriodEnd: boolean;
  isTrialPeriod: boolean;
  stripeCustomerId?: string;
  hasPaymentMethod: boolean;
  activeSlots: SlotSummary[];
  createdAt: string | null;
  updatedAt: string | null;
}

// Publish response
interface PublishListingResponse {
  message: string;
  listingId: string;
  locationId: string;
  status: string;
  slotId: string;
  slotExpiresAt: string;
}

// Set do-not-renew response
interface SetDoNotRenewResponse {
  success: boolean;
  listingId: string;
  slotId: string;
  doNotRenew: boolean;
  expiresAt: string;
  message: string;
  message_sr: string;
}
```

---

## User Flows

### Publishing a Listing

```
1. Check subscription status (GET /subscription)
   - Verify canPublishNewAd === true
   - If false, show upgrade prompt or "no tokens available" message

2. User clicks "Publish"
   - POST /listings/{listingId}/publish

3. On success:
   - Update listing status to ONLINE in local state
   - Show success message with slot expiry date
   - Refresh subscription to update activeSlots and availableTokens

4. On error:
   - Show appropriate error message
   - If "No tokens available", prompt to set another listing to "do not renew" or upgrade
```

### Setting Do Not Renew (Stop Auto-Renewal)

```
1. User toggles "Auto-renew" switch on a slot
   - PUT /listings/{listingId}/slot/do-not-renew
   - Body: { doNotRenew: !currentValue }

2. On success:
   - Update slot in local state
   - Show bilingual message from response
   - Update displayStatus and displayLabel accordingly

3. UI considerations:
   - When doNotRenew=true: Show "Expires on [date]" with warning color
   - When doNotRenew=false: Show "Auto-renews on [date]" with success color
```

---

## Review Compensation

When a listing is submitted for review and takes longer than the billing period to be approved, the host receives extra days on their slot:

- **Calculation:** `max(0, reviewDays - billingPeriodDays)`, capped at 60 days
- **Example:** Monthly plan (30 days), review takes 35 days → 5 compensation days
- **Display:** Show `reviewCompensationDays` in slot details if > 0

---

## Grace Period (Past Due)

When payment fails:

1. Subscription status becomes `PAST_DUE`
2. All slots get `isPastDue: true`
3. `displayStatus` becomes `PAST_DUE`
4. Existing ads continue running during grace period
5. Host cannot publish new ads until payment succeeds
6. If payment ultimately fails, slots are marked for expiry

**UI Guidance:**

- Show warning banner on subscription page
- Show "Payment pending" status on affected slots
- Disable "Publish" buttons
- Link to Stripe billing portal to update payment method

---

## Error Handling

All endpoints return errors in this format:

```json
{
  "error": "ERROR_CODE",
  "message": "Human readable message",
  "message_sr": "Poruka na srpskom" // Optional
}
```

Common error codes:

- `BAD_REQUEST` (400)
- `UNAUTHORIZED` (401)
- `FORBIDDEN` (403)
- `NOT_FOUND` (404)
- `TOO_MANY_REQUESTS` (429)
- `INTERNAL_ERROR` (500)
