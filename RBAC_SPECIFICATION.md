# Localstays Host Portal — Authorization & RBAC

## Scope
Role-based access control for the **Host Portal** using:
- **Coarse roles** via Cognito Groups: `HOST`, `ADMIN`
- **Fine permissions** in DynamoDB and injected into JWT via **PreTokenGen**

You confirmed:
- Listing lifecycle: `DRAFT → PENDING_REVIEW → APPROVED → ONLINE/OFFLINE`, with `REJECTED` returning to `DRAFT`.
- Host can toggle **ONLINE/OFFLINE only** for `APPROVED` listings.
- **Delete**: Host may delete any listing; `APPROVED` listings are **soft-deleted** and must **not** affect bookings.
- **Offline** is a soft action (hide from search only).
- **KYC** is tied to **Host** (business or individual). Resubmission allowed after rejection.
- Users do **not** belong to multiple Hosts (one Host per user today).
- **Suspending a Host** suspends **all listings** for that Host.
- No audit log for now (may add later).
- Permission naming agreed as proposed.

---

## Roles and Permissions

### Roles
- **HOST** — manages their own Host, KYC, and Listings.
- **ADMIN** — platform-wide oversight and moderation.

### Permissions (canonical)
#### Host-scoped
- `HOST_LISTING_CREATE`
- `HOST_LISTING_EDIT_DRAFT`
- `HOST_LISTING_SUBMIT_REVIEW`
- `HOST_LISTING_SET_OFFLINE`
- `HOST_LISTING_SET_ONLINE`  *(only if APPROVED)*
- `HOST_LISTING_VIEW_OWN`
- `HOST_LISTING_DELETE`      *(soft-delete if APPROVED)*
- `HOST_KYC_SUBMIT`

#### Admin (global)
- `ADMIN_HOST_VIEW_ALL`
- `ADMIN_HOST_SUSPEND`
- `ADMIN_HOST_REINSTATE`
- `ADMIN_KYC_VIEW_ALL`
- `ADMIN_KYC_APPROVE`
- `ADMIN_KYC_REJECT`
- `ADMIN_LISTING_VIEW_ALL`
- `ADMIN_LISTING_APPROVE`
- `ADMIN_LISTING_REJECT`
- `ADMIN_LISTING_SUSPEND`

### Role → Permission Matrix
| Permission | HOST | ADMIN |
|---|---:|---:|
| HOST_LISTING_CREATE | ✅ | — |
| HOST_LISTING_EDIT_DRAFT | ✅ | — |
| HOST_LISTING_SUBMIT_REVIEW | ✅ | — |
| HOST_LISTING_SET_OFFLINE | ✅ | — |
| HOST_LISTING_SET_ONLINE | ✅ | — |
| HOST_LISTING_VIEW_OWN | ✅ | — |
| HOST_LISTING_DELETE | ✅ | — |
| HOST_KYC_SUBMIT | ✅ | — |
| ADMIN_HOST_VIEW_ALL | — | ✅ |
| ADMIN_HOST_SUSPEND | — | ✅ |
| ADMIN_HOST_REINSTATE | — | ✅ |
| ADMIN_KYC_VIEW_ALL | — | ✅ |
| ADMIN_KYC_APPROVE | — | ✅ |
| ADMIN_KYC_REJECT | — | ✅ |
| ADMIN_LISTING_VIEW_ALL | — | ✅ |
| ADMIN_LISTING_APPROVE | — | ✅ |
| ADMIN_LISTING_REJECT | — | ✅ |
| ADMIN_LISTING_SUSPEND | — | ✅ |

> HOST permissions are always tenant-scoped: operations must match `claims.hostId` with the resource's `hostId`.

---

## Token Claims (PreTokenGen)

**Source of truth**: DynamoDB user row + Cognito groups

**Injected claims example (ID/Access token):**
```json
{
  "sub": "uuid-of-user",
  "email": "owner@example.com",
  "role": "HOST",                // or "ADMIN"
  "hostId": "host_abc123",       // present for HOST users
  "permissions": [
    "HOST_LISTING_CREATE",
    "HOST_LISTING_EDIT_DRAFT",
    "HOST_LISTING_SUBMIT_REVIEW",
    "HOST_LISTING_SET_OFFLINE",
    "HOST_LISTING_SET_ONLINE",
    "HOST_LISTING_VIEW_OWN",
    "HOST_LISTING_DELETE",
    "HOST_KYC_SUBMIT"
  ]
}
```

**Rules:**
- `role` derives from Cognito Group (`HOST` or `ADMIN`). If both existed, `ADMIN` wins.
- `hostId` is set for `HOST` users only.
- `permissions` come from DynamoDB; for `ADMIN`, the backend treats `permissions` as all `ADMIN_*` (explicit list recommended).

---

## Listing State Machine

### States
- `DRAFT`
- `PENDING_REVIEW`
- `APPROVED`
- `ONLINE`
- `OFFLINE`
- `REJECTED`
- `SUSPENDED`

### Transitions
| From | Action | To | Who | Notes |
|---|---|---|---|---|
| DRAFT | submit | PENDING_REVIEW | HOST | requires `HOST_LISTING_SUBMIT_REVIEW` |
| DRAFT | edit | DRAFT | HOST | `HOST_LISTING_EDIT_DRAFT` |
| DRAFT | delete | (deleted) | HOST | `HOST_LISTING_DELETE` **hard delete** |
| REJECTED | edit | DRAFT | HOST | fix issues |
| REJECTED | submit | PENDING_REVIEW | HOST | `HOST_LISTING_SUBMIT_REVIEW` |
| PENDING_REVIEW | approve | APPROVED | ADMIN | `ADMIN_LISTING_APPROVE` |
| PENDING_REVIEW | reject | REJECTED | ADMIN | `ADMIN_LISTING_REJECT` with reason |
| APPROVED | set_online | ONLINE | HOST | `HOST_LISTING_SET_ONLINE` |
| APPROVED | delete | (soft-deleted) | HOST | `HOST_LISTING_DELETE` **soft delete**; keep bookings intact |
| ONLINE | set_offline | OFFLINE | HOST | `HOST_LISTING_SET_OFFLINE` (hide from search) |
| OFFLINE | set_online | ONLINE | HOST | `HOST_LISTING_SET_ONLINE` |
| ANY | suspend | SUSPENDED | ADMIN | `ADMIN_LISTING_SUSPEND`; hidden from search |
| SUSPENDED | reinstate | OFFLINE | ADMIN | returns to OFFLINE by default |

**Soft delete semantics**
- For `APPROVED` (and descendants), soft-delete sets `isDeleted=true`, retains record for historical bookings, hides from search and new bookings.

**Offline semantics**
- `OFFLINE` listings remain visible to the owner but excluded from search results and cannot accept new bookings.

---

## Host Suspension Cascade

- `ADMIN_HOST_SUSPEND` sets Host `status=SUSPENDED` and cascades to all listings → `SUSPENDED` (hide from search, block booking ops).
- `ADMIN_HOST_REINSTATE` sets Host `status=ACTIVE` and moves all previously suspended listings to `OFFLINE` (owner can toggle to `ONLINE`).

---

## KYC Rules (Host-based)

- KYC is a **Host** record attribute with statuses: `PENDING`, `APPROVED`, `REJECTED`.
- Only `HOST_KYC_SUBMIT` can create/update KYC packages for their own Host.
- Admin can `APPROVE`/`REJECT` via `ADMIN_KYC_*` permissions.
- Rejection allows resubmission at any time (no cooldown currently).

---

## Data Model Additions (DynamoDB)

### Listing (example shape)
```json
{
  "pk": "LISTING#list_123",
  "sk": "META",
  "hostId": "host_abc123",
  "status": "DRAFT | PENDING_REVIEW | APPROVED | ONLINE | OFFLINE | REJECTED | SUSPENDED",
  "isDeleted": false,
  "deletedAt": null,
  "moderation": {
    "approvedAt": null,
    "rejectedAt": null,
    "rejectReason": null,
    "approvedBy": null,
    "rejectedBy": null
  },
  "createdAt": "ISO",
  "updatedAt": "ISO"
}
```

### Host
```json
{
  "pk": "HOST#host_abc123",
  "sk": "META",
  "status": "ACTIVE | SUSPENDED",
  "kyc": {
    "status": "PENDING | APPROVED | REJECTED",
    "submittedAt": "ISO",
    "approvedAt": null,
    "rejectedAt": null,
    "rejectReason": null
  }
}
```

---

## Enforcement Points

1) **Frontend Routing**
   - Read `role` claim to route to Admin vs Host home.
   - For HOST actions, UI hides controls not permitted by `permissions` and state.

2) **API Gateway Authorizer**
   - Validate JWT via Cognito; reject missing/expired tokens.

3) **Lambda Guards (pseudocode)**
```ts
function authorize(ctx, resourceHostId, requiredPerms) {
  const { role, hostId, permissions } = ctx.claims;
  if (role === 'ADMIN') return hasAll(permissions, requiredPerms);
  if (role === 'HOST') {
    if (hostId !== resourceHostId) throw Forbidden('Wrong tenant');
    return hasAll(permissions, requiredPerms);
  }
  throw Forbidden('Unknown role');
}
```

- Endpoint examples:
  - `POST /hosts/{hostId}/listings` → `HOST_LISTING_CREATE`
  - `PUT /listings/{id}/submit` → `HOST_LISTING_SUBMIT_REVIEW`
  - `PUT /listings/{id}/online` → `HOST_LISTING_SET_ONLINE`
  - `PUT /listings/{id}/offline` → `HOST_LISTING_SET_OFFLINE`
  - `DELETE /listings/{id}` → `HOST_LISTING_DELETE` (soft if approved)
  - `GET /admin/hosts` → `ADMIN_HOST_VIEW_ALL`
  - `PUT /admin/hosts/{hostId}/suspend` → `ADMIN_HOST_SUSPEND`
  - `PUT /admin/listings/{id}/approve` → `ADMIN_LISTING_APPROVE`

**Notes**
- The UI should not rely solely on client-side checks; server authorizes every operation.
- Missing audit trail for now; plan as a later addition.

---

## Open Items (deferred)
- Define exact reject reasons enumerations (listings & KYC).
- Decide whether `ONLINE` should require KYC `APPROVED` and/or Host `ACTIVE` (recommended). 
- Consider future "team members" under a Host; add Membership entity when needed.

