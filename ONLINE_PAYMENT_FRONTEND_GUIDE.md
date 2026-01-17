# Online Payment Status - Frontend Integration

## Overview

Hosts can now request LokalStays to handle online payments. This is a boolean option during profile creation.

---

## Host Profile Form

Add a checkbox/toggle during profile creation (both Individual and Business):

```
☐ I want LokalStays to handle online payments for my bookings
```

### Submit Intent Request

Include `requestOnlinePayment` in the profile object:

```json
{
  "profile": {
    "hostType": "INDIVIDUAL",
    "email": "host@example.com",
    "requestOnlinePayment": true,
    ...
  },
  "documents": [...]
}
```

---

## Reading Status

`GET /api/v1/hosts/{hostId}/profile` returns:

```json
{
  "onlinePaymentStatus": "NOT_REQUESTED" | "REQUESTED" | "APPROVED" | "REJECTED",
  "onlinePaymentRequestedAt": "2026-01-16T12:00:00Z" | null
}
```

### Display Logic

| Status          | What to show                                               |
| --------------- | ---------------------------------------------------------- |
| `NOT_REQUESTED` | Show opt-in option                                         |
| `REQUESTED`     | "Pending approval" badge                                   |
| `APPROVED`      | "Online payments enabled" ✓                                |
| `REJECTED`      | "Request declined" (host can re-request on profile update) |

---

## Admin Panel

`GET /api/v1/admin/hosts/{hostId}` returns full status including:

- `onlinePaymentStatus`
- `onlinePaymentRequestedAt`
- `onlinePaymentDecidedAt`
- `onlinePaymentDecidedBy`
- `onlinePaymentRejectReason`

### Admin Action

`PUT /api/v1/admin/hosts/{hostId}/online-payment`

```json
// Approve
{ "status": "APPROVED" }

// Reject (reason required)
{ "status": "REJECTED", "reason": "Missing bank details" }
```
