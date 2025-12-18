# Free Ads (Commission-Based) - Frontend Integration

## Overview

Hosts can now publish listings as either:
- **Subscription-based**: Uses tokens from their subscription, has expiry/renewal
- **Commission-based (Free)**: No subscription required, no expiry, monetized via booking commission (6.5%)

The frontend decides which type to use based on what's available.

---

## Endpoints

### 1. Get Publishing Options

**Before showing publish UI**, call this to determine what options are available.

```
GET /api/v1/hosts/{hostId}/listings/{listingId}/publishing-options
```

**Response:**
```json
{
  "canPublishSubscriptionBased": true,
  "canPublishCommissionBased": true,
  "subscriptionReason": null,
  "commissionReason": null,
  "availableTokens": 3,
  "totalTokens": 5,
  "commissionSlotsUsed": 2,
  "commissionSlotsLimit": 100,
  "hasActiveSubscription": true
}
```

| Field | Type | Description |
|-------|------|-------------|
| `canPublishSubscriptionBased` | boolean | Can use subscription tokens |
| `canPublishCommissionBased` | boolean | Can create free ad (under limit) |
| `subscriptionReason` | string? | Why subscription unavailable: `NO_SUBSCRIPTION`, `SUBSCRIPTION_PAST_DUE`, `NO_TOKENS_AVAILABLE`, `SUBSCRIPTION_INACTIVE` |
| `commissionReason` | string? | Why commission unavailable: `COMMISSION_SLOT_LIMIT_REACHED` |
| `availableTokens` | number? | Tokens available (if has subscription) |
| `totalTokens` | number? | Total tokens in plan |
| `commissionSlotsUsed` | number | Free ads currently active |
| `commissionSlotsLimit` | number | Max free ads allowed (100) |
| `hasActiveSubscription` | boolean | Has active subscription |

---

### 2. Publish Listing

```
POST /api/v1/hosts/{hostId}/listings/{listingId}/publish
```

**Request Body:**
```json
{
  "isCommissionBased": true
}
```

| Field | Type | Description |
|-------|------|-------------|
| `isCommissionBased` | boolean | `true` = free ad, `false` = subscription-based |

**Success Response:**
```json
{
  "message": "Listing published successfully",
  "listingId": "listing_abc123",
  "locationId": "dXJuOm1ieHBsYzpBZ...",
  "status": "ONLINE",
  "slotId": "slot_xyz789",
  "isCommissionBased": true,
  "slotExpiresAt": "2025-01-15T23:59:59.999Z"  // Only for subscription-based
}
```

**Error Response (400):**
```json
{
  "error": "No advertising slots available. All your tokens are in use.",
  "message_sr": "Nema dostupnih oglasnih slotova. Svi vaši tokeni su u upotrebi.",
  "reason": "NO_TOKENS_AVAILABLE",
  "availableTokens": 0
}
```

---

### 3. Convert Slot Type

Convert an existing published listing between ad types.

```
POST /api/v1/hosts/{hostId}/listings/{listingId}/slot/convert
```

**Request Body:**
```json
{
  "toCommissionBased": true
}
```

| Field | Type | Description |
|-------|------|-------------|
| `toCommissionBased` | boolean | `true` = convert to free, `false` = convert to subscription |

**Success Response:**
```json
{
  "success": true,
  "message": "Slot converted to commission-based successfully",
  "slot": {
    "slotId": "slot_xyz789",
    "listingId": "listing_abc123",
    "isCommissionBased": true,
    "expiresAt": null
  }
}
```

---

## Frontend Logic

```typescript
// 1. Check options before showing publish dialog
const options = await getPublishingOptions(hostId, listingId);

// 2. Determine what to show
if (options.canPublishSubscriptionBased && options.canPublishCommissionBased) {
  // Show choice dialog: "Use subscription token" vs "Publish as free ad"
} else if (options.canPublishSubscriptionBased) {
  // Only subscription available - auto-select or show single option
} else if (options.canPublishCommissionBased) {
  // Only free ad available - default to commission-based
} else {
  // Neither available - show error
  // e.g., "You've reached the maximum of 100 free ads"
}

// 3. Publish with user's choice
await publishListing(hostId, listingId, { 
  isCommissionBased: userChoseCommission 
});
```

---

## Display Considerations

**For subscription-based listings:**
- Show expiry date
- Show "Auto-renews on [date]" or "Expires on [date]"

**For commission-based listings:**
- Show "Free ad (commission-based)" badge
- No expiry date to display
- Consider showing: "6.5% commission on bookings"

---

## Error Codes

| Reason | Description |
|--------|-------------|
| `NO_SUBSCRIPTION` | No active subscription |
| `SUBSCRIPTION_PAST_DUE` | Payment failed |
| `SUBSCRIPTION_INACTIVE` | Subscription cancelled/expired |
| `NO_TOKENS_AVAILABLE` | All tokens in use |
| `COMMISSION_SLOT_LIMIT_REACHED` | 100 free ads limit reached |

