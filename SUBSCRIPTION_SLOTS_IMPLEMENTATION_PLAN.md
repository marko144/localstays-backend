# Subscription & Advertising Slots - Implementation Plan

> **Version**: 1.2
> **Created**: December 4, 2025
> **Updated**: December 5, 2025
> **Status**: Approved for Implementation

---

## Table of Contents

1. [Overview](#overview)
2. [Core Concepts](#core-concepts)
3. [Stripe Integration Architecture](#stripe-integration-architecture)
4. [Database Architecture](#database-architecture)
5. [Data Model](#data-model)
6. [Business Rules](#business-rules)
7. [API Endpoints](#api-endpoints)
8. [Stripe EventBridge Handlers](#stripe-eventbridge-handlers)
9. [Scheduled Jobs](#scheduled-jobs)
10. [Notifications & Emails](#notifications--emails)
11. [Implementation Phases](#implementation-phases)
12. [Migration Considerations](#migration-considerations)

---

## Overview

This document outlines the implementation of a subscription-based advertising system for LocalStays. The system allows hosts to purchase subscription plans that grant them "tokens" - the ability to run a certain number of concurrent ads. Each ad runs for the duration of the billing period, and ads are automatically renewed when the subscription renews.

### Key Features

- **Token-based ad allowance**: Tokens represent max concurrent ads, not a consumable resource
- **Billing period = Ad duration**: Monthly subscription = 30-day ads, Semi-annual = 180-day ads
- **Auto-publish on approval**: When admin approves a listing, it goes live automatically if tokens available
- **Grace period handling**: Ads stay live during payment retry period
- **Plan changes**: Immediate effect with pro-rata billing via Stripe
- **Trial support**: Trial period configured per plan in Stripe
- **Stripe Pricing Table**: Embedded UI for plan selection and checkout (no custom checkout flow)
- **Stripe Customer Portal**: Hosted UI for subscription management (upgrades, cancellations, payment updates)
- **EventBridge Integration**: Stripe events delivered via AWS EventBridge (not HTTP webhooks)

---

## Stripe Integration Architecture

### Overview

We use **Stripe's hosted solutions** to minimize custom code:

| Component | Provider | Purpose |
|-----------|----------|---------|
| **Pricing Table** | Stripe (embedded) | Display plans, initiate checkout |
| **Checkout** | Stripe (hosted) | Payment collection |
| **Customer Portal** | Stripe (hosted) | Subscription management |
| **Event Delivery** | AWS EventBridge | Receive Stripe events |

### Flow Diagrams

#### New Subscription Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                           FRONTEND                                   │
│                                                                      │
│    ┌─────────────────────────────────────────┐                      │
│    │  <stripe-pricing-table                  │                      │
│    │    pricing-table-id="prctbl_xxx"        │                      │
│    │    publishable-key="pk_xxx"             │                      │
│    │    client-reference-id={hostId} />      │  ← Pass hostId here! │
│    │                                         │                      │
│    │  [Basic €12.99]  [Pro €17.99]  [Agency] │                      │
│    └──────────────────┬──────────────────────┘                      │
│                       │ User clicks "Subscribe"                      │
└───────────────────────┼──────────────────────────────────────────────┘
                        │
                        ▼
┌───────────────────────────────────────────────────────────────────────┐
│                         STRIPE (their servers)                        │
│                                                                       │
│    ┌─────────────────┐      ┌─────────────────┐                      │
│    │ Checkout Page   │ ──►  │ Process Payment │                      │
│    │ (hosted)        │      │                 │                      │
│    └─────────────────┘      └────────┬────────┘                      │
│                                      │                                │
│                                      │ Payment successful             │
│                                      ▼                                │
│                             ┌─────────────────┐                      │
│                             │  Fire Events    │                      │
│                             │  to EventBridge │                      │
│                             └────────┬────────┘                      │
└──────────────────────────────────────┼────────────────────────────────┘
                                       │
                                       ▼
┌──────────────────────────────────────────────────────────────────────┐
│                        AWS (your account)                             │
│                                                                       │
│    ┌─────────────────────────────────────────────────────────────┐   │
│    │  EventBridge (Partner Event Bus)                            │   │
│    │  aws.partner/stripe.com/ed_xxx                              │   │
│    └─────────────────────────┬───────────────────────────────────┘   │
│                              │                                        │
│                              ▼                                        │
│    ┌─────────────────────────────────────────────────────────────┐   │
│    │  EventBridge Rule                                           │   │
│    │  Pattern: source = ["stripe.com"]                           │   │
│    │           detail-type = ["checkout.session.completed", ...] │   │
│    └─────────────────────────┬───────────────────────────────────┘   │
│                              │                                        │
│                              ▼                                        │
│    ┌─────────────────┐      ┌─────────────────┐                      │
│    │  Lambda Handler │ ──►  │  DynamoDB       │                      │
│    │  (your code)    │      │  - HostSub      │                      │
│    │                 │      │  - Slots        │                      │
│    └─────────────────┘      └─────────────────┘                      │
└──────────────────────────────────────────────────────────────────────┘
```

#### Subscription Management Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                           FRONTEND                                   │
│                                                                      │
│    ┌──────────────────────────────────────────┐                     │
│    │  Subscription Dashboard                   │                     │
│    │                                           │                     │
│    │  Plan: Pro (€17.99/month)                │                     │
│    │  Status: Active                           │                     │
│    │  Renews: January 5, 2025                 │                     │
│    │                                           │                     │
│    │  [Manage Subscription] ──────────────────┼──► POST /customer-portal
│    └──────────────────────────────────────────┘           │         │
└───────────────────────────────────────────────────────────┼─────────┘
                                                            │
                                                            ▼
┌──────────────────────────────────────────────────────────────────────┐
│                        YOUR BACKEND                                   │
│                                                                       │
│    POST /api/v1/hosts/{hostId}/customer-portal                       │
│                                                                       │
│    1. Get host's stripeCustomerId from HostSubscription              │
│    2. Call stripe.billingPortal.sessions.create({ customer: ... })   │
│    3. Return { url: "https://billing.stripe.com/..." }               │
└──────────────────────────────────────────────────────────────────────┘
                                                            │
                                                            ▼
┌──────────────────────────────────────────────────────────────────────┐
│                    STRIPE CUSTOMER PORTAL                             │
│                                                                       │
│    ┌────────────────────────────────────────────────────────────┐    │
│    │  • View current plan                                        │    │
│    │  • Change plan (upgrade/downgrade)                         │    │
│    │  • Update payment method                                    │    │
│    │  • Cancel subscription                                      │    │
│    │  • View invoices                                            │    │
│    │                                                             │    │
│    │  [← Back to LocalStays]                                    │    │
│    └────────────────────────────────────────────────────────────┘    │
│                                                                       │
│    Any changes fire events to EventBridge → Your Lambda              │
└──────────────────────────────────────────────────────────────────────┘
```

### Stripe Customer Lifecycle

**Important**: Stripe Customer ≠ User Login

| Entity | Lifecycle | What Happens on Cancel |
|--------|-----------|------------------------|
| **Customer** (`cus_xxx`) | Permanent | Stays forever - never deleted |
| **Subscription** (`sub_xxx`) | Temporary | Gets cancelled/deleted |

```
Customer (permanent) - linked to host via stripeCustomerId
├── email
├── payment methods
├── metadata
│
├── Subscription #1 (Jan 2024 - Mar 2024) ← cancelled
├── Subscription #2 (Jun 2024 - Dec 2024) ← cancelled  
└── Subscription #3 (Jan 2025 - ongoing)  ← active
```

When a user returns after cancellation:
- **Same `stripeCustomerId`** (Stripe recognizes by email)
- **New `stripeSubscriptionId`**
- Your `HostSubscription` record gets updated with new subscription details

### Linking Host to Stripe Customer

The `client_reference_id` passed to the Pricing Table is the key:

```html
<stripe-pricing-table 
  client-reference-id="host_abc123">  <!-- Your hostId -->
</stripe-pricing-table>
```

This ID comes back in `checkout.session.completed`:

```json
{
  "type": "checkout.session.completed",
  "data": {
    "object": {
      "client_reference_id": "host_abc123",  // Your hostId!
      "customer": "cus_xyz789",              // Stripe customer ID
      "subscription": "sub_def456"
    }
  }
}
```

### EventBridge Setup

**Existing Event Bus** (already created in AWS):
```
aws.partner/stripe.com/ed_test_61Tk7Xvlo3KznFDAL16Tk6KN2VE9BfC6cP2LuQVWSC5I
```

**Events to Enable in Stripe Dashboard**:
```
checkout.session.completed      ← Links hostId to stripeCustomerId
customer.subscription.created   ← Full subscription details
customer.subscription.updated   ← Plan changes, status changes
customer.subscription.deleted   ← Subscription ended
invoice.paid                    ← Successful payment/renewal
invoice.payment_failed          ← Payment failed (grace period)
```

**Staging vs Production**:
- Stripe Sandbox → Staging EventBridge bus → Staging Lambda
- Stripe Live → Production EventBridge bus → Production Lambda

---

## Core Concepts

### Tokens

Tokens represent the **maximum number of concurrent ads** a host can have running.

```
totalTokens = 5 (from subscription plan)
activeSlots = 3 (current live ads)
canPublishMore = totalTokens - activeSlots = 2
```

- Tokens are **NOT consumed or returned**
- They are a **parallel limit**, not a pool
- When a slot expires, `activeSlots` decreases, so `canPublishMore` increases

### Advertising Slots

A slot is created when a listing goes ONLINE. It tracks:

- Which listing it's bound to (permanent, no swapping)
- When it expires
- Review compensation days
- Renewal preferences

### Ad Duration

Ad duration is determined by the subscription billing period:

| Billing Period | Ad Duration               |
| -------------- | ------------------------- |
| Monthly        | ~30 days (to period end)  |
| Quarterly      | ~90 days (to period end)  |
| Semi-Annual    | ~180 days (to period end) |

**Formula**: `expiresAt = currentPeriodEnd + reviewCompensationDays`

### Review Compensation

If admin review takes longer than the billing period, host gets extra days:

```
reviewCompensationDays = max(0, reviewDays - billingPeriodDays)
```

- Only applied on **first publish** (not re-publish from APPROVED)
- Preserved across renewals and plan changes

---

## Database Architecture

### Table Overview

The subscription system uses **3 tables**:

| Table                       | Purpose                            | Key Pattern                             |
| --------------------------- | ---------------------------------- | --------------------------------------- |
| **SubscriptionPlans** (NEW) | Reference data for available plans | `PLAN#<planId>` / `CONFIG`              |
| **AdvertisingSlots** (NEW)  | Active ad slots linked to listings | `LISTING#<listingId>` / `SLOT#<slotId>` |
| **Main Table (localstays)** | Host subscription records          | `HOST#<hostId>` / `SUBSCRIPTION`        |

### Why Separate Tables?

1. **SubscriptionPlans**: Reference data that rarely changes, accessed by all users. Separate table keeps it clean and cacheable.

2. **AdvertisingSlots**:

   - Slots are transient (created/deleted frequently)
   - A host could have 200+ slots over time
   - Need dedicated GSIs for expiry queries
   - Keyed by listing (1:1 relationship) for easy lookup

3. **HostSubscription**: Stays in main table under host entity - it's core host data.

### SubscriptionPlans Table

**Table Name**: `localstays-subscription-plans-{env}`

```
PK: PLAN#<planId>
SK: CONFIG

No GSIs needed - small reference table, infrequent access
```

### AdvertisingSlots Table

**Table Name**: `localstays-advertising-slots-{env}`

```
PK: LISTING#<listingId>
SK: SLOT#<slotId>

GSI1 (HostSlotsIndex):
  PK: HOST#<hostId>
  SK: <activatedAt>
  Purpose: Get all slots for a host (for subscription page, renewal processing)

GSI2 (ExpiryIndex):
  PK: SLOT_EXPIRY
  SK: <expiresAt>#<listingId>#<slotId>
  Purpose: Query expiring slots for daily expiry job
```

**Note**: Primary key is `LISTING#<listingId>` because:

- A slot is permanently bound to one listing
- Easy to check if a listing has an active slot
- One listing can only have one active slot at a time

### Main Table (localstays)

HostSubscription remains here:

```
PK: HOST#<hostId>
SK: SUBSCRIPTION
```

Uses existing GSI4 for querying by status/period end.

---

## Data Model

### SubscriptionPlan

**Table**: SubscriptionPlans
**Keys**: `pk: PLAN#<planId>`, `sk: CONFIG`

```typescript
interface SubscriptionPlan {
  pk: string; // PLAN#<planId>
  sk: string; // CONFIG

  planId: string; // e.g., "basic", "pro", "agency"
  stripeProductId: string; // Stripe product ID

  // Display
  displayName: string; // "Basic Plan"
  displayName_sr: string; // "Osnovni Plan"
  description: string;
  description_sr: string;

  // Token Allowance (same for all billing periods)
  adSlots: number; // Max concurrent ads (tokens)

  // Pricing Options (multiple prices per plan)
  prices: Array<{
    priceId: string; // Internal ID: "basic_monthly"
    stripePriceId: string; // Stripe price ID
    billingPeriod: "MONTHLY" | "QUARTERLY" | "SEMI_ANNUAL";
    priceAmount: number; // In cents (e.g., 1299 = €12.99)
    currency: string; // "EUR"
  }>;

  // Trial (optional, configured in Stripe)
  hasTrialPeriod: boolean;
  trialDays: number | null; // e.g., 14, 30

  // Features (for display on pricing page)
  features: string[];
  features_sr: string[];

  // Status
  isActive: boolean;
  sortOrder: number;

  createdAt: string;
  updatedAt: string;
}
```

### HostSubscription

**Table**: Main table (localstays)
**Keys**: `pk: HOST#<hostId>`, `sk: SUBSCRIPTION`

```typescript
interface HostSubscription {
  pk: string; // HOST#<hostId>
  sk: string; // SUBSCRIPTION

  hostId: string;

  // Current Plan
  planId: string; // e.g., "basic", "pro"
  priceId: string; // e.g., "basic_monthly", "basic_semi_annual"

  // Stripe Integration
  stripeCustomerId: string | null;     // Permanent - never changes for this host
  stripeSubscriptionId: string | null; // Changes with each new subscription

  // Token Allowance
  totalTokens: number; // From plan.adSlots

  // Status (from Stripe)
  status: "TRIALING" | "ACTIVE" | "PAST_DUE" | "CANCELLED" | "EXPIRED";

  // Trial Period (separate tracking)
  trialStart: string | null; // When trial began
  trialEnd: string | null; // When trial ends

  // Billing Period (from Stripe)
  currentPeriodStart: string;
  currentPeriodEnd: string;

  // Subscription Start
  startedAt: string; // When subscription first created

  // Cancellation
  cancelledAt: string | null;
  cancelAtPeriodEnd: boolean;

  // GSI4: Query by status and period end
  gsi4pk: string; // SUBSCRIPTION_STATUS#<status>
  gsi4sk: string; // <currentPeriodEnd>

  // GSI5: Query by Stripe Customer ID (for EventBridge handlers)
  gsi5pk: string; // STRIPE_CUSTOMER#<stripeCustomerId>
  gsi5sk: string; // SUBSCRIPTION

  createdAt: string;
  updatedAt: string;
}
```

**GSI5 (StripeCustomerIndex)**: Required to look up host when Stripe events arrive.

```
GSI5:
  PK: STRIPE_CUSTOMER#<stripeCustomerId>
  SK: SUBSCRIPTION
  Purpose: Find HostSubscription by stripeCustomerId (from Stripe events)
```

### AdvertisingSlot

**Table**: AdvertisingSlots
**Keys**: `pk: LISTING#<listingId>`, `sk: SLOT#<slotId>`

```typescript
interface AdvertisingSlot {
  pk: string; // LISTING#<listingId>
  sk: string; // SLOT#<slotId>

  // Identifiers
  slotId: string; // UUID
  listingId: string; // Permanently bound to this listing
  hostId: string; // Denormalized for GSI1

  // Audit Trail
  planIdAtCreation: string; // Plan ID when slot was created

  // Timing
  activatedAt: string; // When slot was created (listing published)
  expiresAt: string; // periodEnd + reviewCompensationDays
  reviewCompensationDays: number; // Extra days added for review time

  // Renewal Control
  doNotRenew: boolean; // If true, skip at renewal, let expire

  // Grace Period / Payment Status
  isPastDue: boolean; // True if subscription payment failed
  markedForImmediateExpiry: boolean; // True if payment ultimately failed

  // GSI1: HostSlotsIndex (get all slots for a host)
  gsi1pk: string; // HOST#<hostId>
  gsi1sk: string; // <activatedAt>

  // GSI2: ExpiryIndex (query expiring slots)
  gsi2pk: string; // SLOT_EXPIRY
  gsi2sk: string; // <expiresAt>#<listingId>#<slotId>

  createdAt: string;
  updatedAt: string;
}
```

### ListingMetadata Additions

Add these fields to existing `ListingMetadata` in main table:

```typescript
// Review Tracking
submittedForReviewAt?: string;     // When host confirmed submission (IN_REVIEW)
reviewDurationDays?: number;       // Days in review (calculated at approval)

// Slot Association (denormalized for display)
activeSlotId?: string;             // Current slot ID (if ONLINE)
slotExpiresAt?: string;            // From slot.expiresAt
slotDoNotRenew?: boolean;          // From slot.doNotRenew
slotIsPastDue?: boolean;           // From slot.isPastDue
```

### ListingStatus

```typescript
export type ListingStatus =
  | "DRAFT" // Being created by host
  | "IN_REVIEW" // Submitted, waiting for admin
  | "REVIEWING" // Admin actively reviewing
  | "APPROVED" // Approved, not published (no slot or slot expired)
  | "REJECTED" // Rejected by admin
  | "ONLINE" // Live and visible (has active slot)
  | "LOCKED" // Admin locked due to violation
  | "ARCHIVED"; // Soft deleted
```

**Note**: No PAUSED/OFFLINE state. Ads are either ONLINE (in slot) or APPROVED (no slot). Hosts can mark ads as "do not renew" but cannot take them offline.

---

## Business Rules

### Token Rules

| Rule                          | Description                                     |
| ----------------------------- | ----------------------------------------------- |
| Token limit                   | `totalTokens` = max concurrent ads allowed      |
| Can publish                   | Only if `activeSlots < totalTokens`             |
| Slot expires                  | `activeSlots` count decreases, can publish more |
| Plan upgrade (more tokens)    | `totalTokens` increases immediately             |
| Plan downgrade (fewer tokens) | Must terminate excess ads first                 |

### Ad Duration Rules

| Rule                     | Description                                              |
| ------------------------ | -------------------------------------------------------- |
| Ad expiry                | `periodEnd + reviewCompensationDays`                     |
| Period end               | `trialEnd` if trialing, else `currentPeriodEnd`          |
| Review compensation      | `max(0, reviewDays - periodDays)`, only on first publish |
| Re-publish from APPROVED | `reviewCompensationDays = 0`                             |

### Plan Change Rules

| Change                   | When Applied                     | Effect on Ads                                                              |
| ------------------------ | -------------------------------- | -------------------------------------------------------------------------- |
| More tokens              | Immediately                      | Can publish more ads                                                       |
| Fewer tokens             | After user terminates excess ads | Must terminate excess first                                                |
| Different billing period | Immediately                      | All ONLINE ads (not doNotRenew): `expiresAt = newPeriodEnd + compensation` |

### Renewal Rules

| Slot State                 | At Renewal                                          |
| -------------------------- | --------------------------------------------------- |
| ONLINE, doNotRenew = false | Extended: `expiresAt = newPeriodEnd + compensation` |
| ONLINE, doNotRenew = true  | NOT extended, expires at current date               |
| isPastDue = true           | Skipped until payment resolves                      |

### Grace Period Rules (5-7 days, configured in Stripe)

| Event                                       | Action                                                         |
| ------------------------------------------- | -------------------------------------------------------------- |
| Payment fails                               | `subscription.status = PAST_DUE`, all `slots.isPastDue = true` |
| Expiry job sees isPastDue slot              | Skips (keeps ad live during grace period)                      |
| Payment succeeds (retry)                    | `status = ACTIVE`, `isPastDue = false`, extend ads normally    |
| Subscription cancelled after failed payment | `slots.markedForImmediateExpiry = true`                        |
| Expiry job sees markedForImmediateExpiry    | Deletes immediately                                            |

### User Restrictions During PAST_DUE

| Action                    | Allowed |
| ------------------------- | ------- |
| View ads                  | ✅ Yes  |
| Mark ad as "do not renew" | ✅ Yes  |
| Undo "do not renew"       | ✅ Yes  |
| Publish new ads           | ❌ No   |
| Change plan               | ❌ No   |

### Auto-Publish Rules

When admin approves a listing:

| Subscription Status | Tokens Available | Result                   |
| ------------------- | ---------------- | ------------------------ |
| ACTIVE or TRIALING  | Yes              | ✅ Auto-publish → ONLINE |
| ACTIVE or TRIALING  | No               | ❌ APPROVED only         |
| PAST_DUE            | Any              | ❌ APPROVED only         |
| EXPIRED             | Any              | ❌ APPROVED only         |
| CANCELLED           | Any              | ❌ APPROVED only         |

---

## API Endpoints

### Public Endpoints (No Auth)

#### GET `/subscription-plans`

List all active subscription plans for pricing page.

**Response**:

```json
{
  "plans": [
    {
      "planId": "basic",
      "displayName": "Basic",
      "displayName_sr": "Osnovni",
      "description": "Perfect for single property owners",
      "description_sr": "Savršeno za vlasnike jednog objekta",
      "adSlots": 1,
      "hasTrialPeriod": true,
      "trialDays": 14,
      "prices": [
        {
          "priceId": "basic_monthly",
          "billingPeriod": "MONTHLY",
          "priceAmount": 1299,
          "currency": "EUR"
        },
        {
          "priceId": "basic_quarterly",
          "billingPeriod": "QUARTERLY",
          "priceAmount": 3499,
          "currency": "EUR"
        },
        {
          "priceId": "basic_semi_annual",
          "billingPeriod": "SEMI_ANNUAL",
          "priceAmount": 6499,
          "currency": "EUR"
        }
      ],
      "features": ["1 active listing", "Email support"],
      "features_sr": ["1 aktivan oglas", "Email podrška"],
      "sortOrder": 1
    }
  ]
}
```

---

### Host Endpoints

#### GET `/hosts/{hostId}/subscription`

Get host's current subscription with token and slot info.

**Auth**: Host (own) or Admin

**Response**:

```json
{
  "subscription": {
    "planId": "basic",
    "priceId": "basic_monthly",
    "planName": "Basic",
    "status": "ACTIVE",
    "totalTokens": 3,
    "usedTokens": 2,
    "availableTokens": 1,
    "currentPeriodStart": "2025-01-01T00:00:00Z",
    "currentPeriodEnd": "2025-01-31T00:00:00Z",
    "trialEnd": null,
    "cancelAtPeriodEnd": false
  },
  "slots": [
    {
      "slotId": "slot_abc123",
      "listingId": "listing_xyz",
      "listingName": "Cozy Apartment",
      "thumbnailUrl": "https://cdn.../thumb.webp",
      "activatedAt": "2025-01-05T10:00:00Z",
      "expiresAt": "2025-02-05T00:00:00Z",
      "reviewCompensationDays": 5,
      "doNotRenew": false,
      "isPastDue": false,
      "displayStatus": "AUTO_RENEWS",
      "displayLabel": "Auto-renews on Feb 5",
      "displayLabel_sr": "Automatski se obnavlja 5. feb"
    }
  ]
}
```

---

#### GET `/hosts/{hostId}/slots`

List all active advertising slots with listing thumbnails.

**Auth**: Host (own) or Admin

**Response**:

```json
{
  "slots": [
    {
      "slotId": "slot_abc123",
      "listingId": "listing_xyz",
      "listingName": "Cozy Apartment",
      "thumbnailUrl": "https://cdn.../thumb.webp",
      "activatedAt": "2025-01-05T10:00:00Z",
      "expiresAt": "2025-02-05T00:00:00Z",
      "daysRemaining": 25,
      "doNotRenew": false,
      "isPastDue": false,
      "displayStatus": "AUTO_RENEWS"
    }
  ],
  "summary": {
    "totalSlots": 2,
    "totalTokens": 3,
    "availableTokens": 1
  }
}
```

---

#### PUT `/hosts/{hostId}/slots/{slotId}/do-not-renew`

Mark or unmark a slot as "do not renew".

**Auth**: Host (own)

**Request**:

```json
{
  "doNotRenew": true
}
```

**Response**:

```json
{
  "success": true,
  "slotId": "slot_abc123",
  "doNotRenew": true,
  "expiresAt": "2025-02-05T00:00:00Z",
  "message": "This ad will expire on Feb 5 and will not be renewed.",
  "message_sr": "Ovaj oglas ističe 5. feb i neće biti obnovljen."
}
```

---

#### POST `/hosts/{hostId}/listings/{listingId}/publish`

Manually publish an APPROVED listing (only when auto-publish wasn't possible).

**Auth**: Host (own)

**Preconditions**:

- Listing must be in APPROVED status
- Subscription status must be ACTIVE or TRIALING (not PAST_DUE, EXPIRED, CANCELLED)
- Host must have available tokens

**Response (Success)**:

```json
{
  "success": true,
  "listingId": "listing_xyz",
  "status": "ONLINE",
  "slot": {
    "slotId": "slot_new123",
    "activatedAt": "2025-01-15T10:00:00Z",
    "expiresAt": "2025-01-31T00:00:00Z",
    "reviewCompensationDays": 0
  },
  "message": "Your listing is now live!",
  "message_sr": "Vaš oglas je sada aktivan!"
}
```

**Response (Cannot Publish - PAST_DUE)**:

```json
{
  "success": false,
  "error": {
    "code": "SUBSCRIPTION_PAST_DUE",
    "message": "Cannot publish new ads while payment is overdue. Please update your payment method.",
    "message_sr": "Ne možete objaviti nove oglase dok je plaćanje dospelo. Molimo ažurirajte način plaćanja."
  }
}
```

**Response (Cannot Publish - No Tokens)**:

```json
{
  "success": false,
  "error": {
    "code": "NO_TOKENS_AVAILABLE",
    "message": "No tokens available. Mark an ad as 'do not renew' and wait for it to expire.",
    "message_sr": "Nema dostupnih tokena. Označite oglas kao 'ne obnavljaj' i sačekajte da istekne."
  }
}
```

---

#### POST `/hosts/{hostId}/subscription/change-preview`

Preview what happens when changing plans.

**Auth**: Host (own)

**Request**:

```json
{
  "newPlanId": "pro",
  "newPriceId": "pro_monthly"
}
```

**Response (Upgrade)**:

```json
{
  "currentPlan": {
    "planId": "basic",
    "priceId": "basic_monthly",
    "adSlots": 1
  },
  "newPlan": {
    "planId": "pro",
    "priceId": "pro_monthly",
    "adSlots": 5
  },
  "tokenChange": 4,
  "currentActiveSlots": 1,
  "requiresAdTermination": false,
  "message": "You will immediately have 4 additional tokens.",
  "message_sr": "Odmah ćete dobiti 4 dodatna tokena."
}
```

**Response (Downgrade - Requires Ad Termination)**:

```json
{
  "currentPlan": {
    "planId": "pro",
    "priceId": "pro_monthly",
    "adSlots": 5
  },
  "newPlan": {
    "planId": "basic",
    "priceId": "basic_monthly",
    "adSlots": 1
  },
  "tokenChange": -4,
  "currentActiveSlots": 4,
  "requiresAdTermination": true,
  "adsToTerminate": 3,
  "activeAds": [
    {
      "slotId": "slot_1",
      "listingId": "listing_a",
      "listingName": "Cozy Apartment",
      "thumbnailUrl": "https://cdn.../thumb.webp",
      "expiresAt": "2025-02-15"
    }
  ],
  "message": "You have 4 active ads but new plan only allows 1. Select 3 ads to terminate.",
  "message_sr": "Imate 4 aktivna oglasa, ali novi plan dozvoljava samo 1. Izaberite 3 oglasa za ukidanje."
}
```

---

#### POST `/hosts/{hostId}/subscription/confirm-downgrade`

Terminate selected ads and proceed with downgrade.

**Auth**: Host (own)

**Request**:

```json
{
  "newPlanId": "basic",
  "newPriceId": "basic_monthly",
  "slotsToTerminate": ["slot_1", "slot_2", "slot_3"]
}
```

**Response**:

```json
{
  "success": true,
  "terminatedSlots": 3,
  "remainingSlots": 1,
  "message": "Ads terminated. Proceeding with plan change.",
  "message_sr": "Oglasi su ukinuti. Nastavljamo sa promenom plana.",
  "stripeCheckoutUrl": "https://checkout.stripe.com/..."
}
```

---

### Admin Endpoints

#### PUT `/admin/listings/{listingId}/approve` (Modified)

Approve listing and auto-publish if possible.

**Auth**: Admin with `ADMIN_LISTING_APPROVE` permission

**Request**:

```json
{
  "listingVerified": true
}
```

**Response (Auto-Published)**:

```json
{
  "success": true,
  "listingId": "listing_xyz",
  "status": "ONLINE",
  "autoPublished": true,
  "slot": {
    "slotId": "slot_new123",
    "expiresAt": "2025-02-05T00:00:00Z",
    "reviewCompensationDays": 5
  },
  "reviewDurationDays": 5,
  "message": "Listing approved and published automatically."
}
```

**Response (Approved Only)**:

```json
{
  "success": true,
  "listingId": "listing_xyz",
  "status": "APPROVED",
  "autoPublished": false,
  "reason": "NO_TOKENS_AVAILABLE",
  "reviewDurationDays": 5,
  "message": "Listing approved. Host notified to publish when tokens available."
}
```

---

#### GET `/admin/subscription-plans`

List all subscription plans (including inactive).

**Auth**: Admin

**Response**:

```json
{
  "plans": [
    {
      "planId": "basic",
      "stripeProductId": "prod_xxx",
      "displayName": "Basic",
      "adSlots": 1,
      "isActive": true,
      "prices": [...],
      "createdAt": "...",
      "updatedAt": "..."
    }
  ]
}
```

---

#### GET `/admin/subscription-plans/{planId}`

Get single plan details.

**Auth**: Admin

---

#### PUT `/admin/subscription-plans/{planId}`

Update plan details (sync with Stripe configuration).

**Auth**: Admin

**Request**:

```json
{
  "displayName": "Basic Plan",
  "displayName_sr": "Osnovni Plan",
  "description": "...",
  "adSlots": 2,
  "prices": [
    {
      "priceId": "basic_monthly",
      "stripePriceId": "price_xxx",
      "billingPeriod": "MONTHLY",
      "priceAmount": 1499,
      "currency": "EUR"
    }
  ],
  "features": ["..."],
  "isActive": true
}
```

---

#### POST `/admin/subscription-plans`

Create new plan (after creating in Stripe).

**Auth**: Admin

---

#### DELETE `/admin/subscription-plans/{planId}`

Deactivate plan (soft delete).

**Auth**: Admin

---

### Dev-Only Simulation Endpoints (Staging Only)

These endpoints are **only deployed in staging** environment for testing without Stripe.

#### POST `/admin/dev/subscriptions/{hostId}/simulate-signup`

Simulate host signing up for a plan with optional trial.

**Auth**: Admin

**Request**:

```json
{
  "planId": "basic",
  "priceId": "basic_monthly",
  "withTrial": true,
  "trialDays": 14,
  "overrides": {
    "trialStart": "2025-01-01T00:00:00Z",
    "trialEnd": "2025-01-15T00:00:00Z",
    "currentPeriodStart": "2025-01-01T00:00:00Z",
    "currentPeriodEnd": "2025-01-15T00:00:00Z"
  }
}
```

---

#### POST `/admin/dev/subscriptions/{hostId}/simulate-payment`

Simulate successful payment (invoice.paid event).

**Auth**: Admin

**Request**:

```json
{
  "overrides": {
    "currentPeriodStart": "2025-01-15T00:00:00Z",
    "currentPeriodEnd": "2025-02-15T00:00:00Z"
  }
}
```

---

#### POST `/admin/dev/subscriptions/{hostId}/simulate-payment-failed`

Simulate payment failure (invoice.payment_failed event).

**Auth**: Admin

**Request**:

```json
{}
```

---

#### POST `/admin/dev/subscriptions/{hostId}/simulate-plan-change`

Simulate plan change.

**Auth**: Admin

**Request**:

```json
{
  "newPlanId": "pro",
  "newPriceId": "pro_semi_annual",
  "overrides": {
    "currentPeriodStart": "2025-01-20T00:00:00Z",
    "currentPeriodEnd": "2025-07-20T00:00:00Z"
  }
}
```

---

#### POST `/admin/dev/subscriptions/{hostId}/simulate-cancellation`

Simulate subscription cancellation.

**Auth**: Admin

**Request**:

```json
{
  "immediate": false
}
```

---

#### PUT `/admin/dev/subscriptions/{hostId}/update-dates`

Manually set subscription dates for testing.

**Auth**: Admin

**Request**:

```json
{
  "status": "ACTIVE",
  "trialStart": "2025-01-01T00:00:00Z",
  "trialEnd": "2025-01-15T00:00:00Z",
  "currentPeriodStart": "2025-01-15T00:00:00Z",
  "currentPeriodEnd": "2025-02-15T00:00:00Z"
}
```

---

### Host Subscription Management

#### POST `/hosts/{hostId}/customer-portal`

Generate a Stripe Customer Portal URL for subscription management.

**Auth**: Host (own) or Admin

**Response**:

```json
{
  "url": "https://billing.stripe.com/p/session/test_abc123..."
}
```

**Notes**:
- URL is temporary and authenticated
- Host can: view plan, change plan, update payment, cancel, view invoices
- Any changes fire events to EventBridge → Your Lambda processes them

---

## Stripe EventBridge Handlers

### Overview

Stripe events arrive via **AWS EventBridge** (not HTTP webhooks). This provides:
- No signature verification needed (EventBridge handles trust)
- Built-in retry and dead-letter queue support
- Better reliability and observability

### Event Bus

**Staging**: `aws.partner/stripe.com/ed_test_xxx` (Stripe Sandbox)
**Production**: `aws.partner/stripe.com/ed_live_xxx` (Stripe Live)

### Events Handled

| Event | Purpose | Action |
|-------|---------|--------|
| `checkout.session.completed` | New subscription via Pricing Table | Link hostId ↔ stripeCustomerId, create HostSubscription |
| `customer.subscription.created` | Subscription details available | Update HostSubscription with full details |
| `customer.subscription.updated` | Plan change, status change | Update plan, tokens, period dates, extend ads |
| `customer.subscription.deleted` | Subscription ended | Mark expired, trigger slot expiry |
| `invoice.paid` | Successful payment/renewal | Extend ONLINE ads, clear PAST_DUE |
| `invoice.payment_failed` | Payment failed | Set PAST_DUE, mark slots |

### `checkout.session.completed`

**First event** - links your hostId to Stripe customer. This is the ONLY event with `client_reference_id`.

```typescript
async function handleCheckoutSessionCompleted(session: Stripe.Checkout.Session) {
  const hostId = session.client_reference_id;  // Your hostId from Pricing Table!
  const stripeCustomerId = session.customer as string;
  const stripeSubscriptionId = session.subscription as string;

  if (!hostId) {
    console.error('No client_reference_id in checkout session');
    return;
  }

  // Create or update HostSubscription with the link
  const existingSubscription = await getHostSubscription(hostId);
  
  const subscription: HostSubscription = {
    ...existingSubscription,
    hostId,
    stripeCustomerId,
    stripeSubscriptionId,
    // Other fields will be filled by customer.subscription.created
    gsi5pk: `STRIPE_CUSTOMER#${stripeCustomerId}`,
    gsi5sk: 'SUBSCRIPTION',
  };

  await saveSubscription(subscription);
}
```

### `customer.subscription.created`

**Second event** - provides full subscription details.

```typescript
async function handleSubscriptionCreated(
  stripeSubscription: Stripe.Subscription
) {
  // Look up host by stripeCustomerId (via GSI5)
  const stripeCustomerId = typeof stripeSubscription.customer === 'string' 
    ? stripeSubscription.customer 
    : stripeSubscription.customer.id;
    
  const subscription = await findSubscriptionByStripeCustomerId(stripeCustomerId);
  
  if (!subscription) {
    console.error('No subscription found for customer:', stripeCustomerId);
    return;
  }

  // Update with full details
  subscription.planId = extractPlanId(stripeSubscription);
  subscription.priceId = extractPriceId(stripeSubscription);
  subscription.stripeSubscriptionId = stripeSubscription.id;
  subscription.totalTokens = await getPlanTokens(stripeSubscription);
  subscription.status = mapStripeStatus(stripeSubscription.status);
  subscription.trialStart = stripeSubscription.trial_start
    ? toISOString(stripeSubscription.trial_start)
    : null;
  subscription.trialEnd = stripeSubscription.trial_end
    ? toISOString(stripeSubscription.trial_end)
    : null;
  subscription.currentPeriodStart = toISOString(
    stripeSubscription.items.data[0]?.current_period_start
  );
  subscription.currentPeriodEnd = toISOString(
    stripeSubscription.items.data[0]?.current_period_end
  );
  subscription.startedAt = subscription.startedAt || new Date().toISOString();
  subscription.cancelAtPeriodEnd = stripeSubscription.cancel_at_period_end;

  await saveSubscription(subscription);
  
  // Check for existing slots to extend (returning customer)
  const existingSlots = await getHostSlots(subscription.hostId);
  if (existingSlots.length > 0) {
    await extendSlotsAtRenewal(subscription.hostId, subscription.currentPeriodEnd);
  }
}
```

### `customer.subscription.updated`

```typescript
async function handleSubscriptionUpdated(
  stripeSubscription: Stripe.Subscription
) {
  const subscription = await findSubscriptionByStripeSubscriptionId(stripeSubscription.id);
  
  if (!subscription) {
    console.error('No subscription found for:', stripeSubscription.id);
    return;
  }

  // Update subscription fields
  subscription.planId = extractPlanId(stripeSubscription);
  subscription.priceId = extractPriceId(stripeSubscription);
  subscription.totalTokens = await getPlanTokens(stripeSubscription);
  subscription.status = mapStripeStatus(stripeSubscription.status);
  subscription.currentPeriodStart = toISOString(
    stripeSubscription.items.data[0]?.current_period_start
  );
  subscription.currentPeriodEnd = toISOString(
    stripeSubscription.items.data[0]?.current_period_end
  );
  subscription.cancelAtPeriodEnd = stripeSubscription.cancel_at_period_end;

  await saveSubscription(subscription);

  // Update all ONLINE slots (not doNotRenew) with new period end
  const slots = await getHostSlots(subscription.hostId);
  const periodEnd =
    subscription.status === "TRIALING"
      ? subscription.trialEnd
      : subscription.currentPeriodEnd;

  for (const slot of slots) {
    if (!slot.doNotRenew) {
      slot.expiresAt = addDays(periodEnd, slot.reviewCompensationDays);
      await saveSlot(slot);
      await updateListingSlotExpiry(slot.listingId, slot.expiresAt);
    }
  }
}
```

### `invoice.paid`

```typescript
async function handleInvoicePaid(invoice: Stripe.Invoice) {
  // In Stripe API 2025+, subscription is in parent.subscription_details
  const subscriptionRef = invoice.parent?.subscription_details?.subscription;
  if (!subscriptionRef) return;  // Not a subscription invoice
  
  const stripeSubscriptionId = typeof subscriptionRef === 'string' 
    ? subscriptionRef 
    : subscriptionRef.id;
    
  const subscription = await findSubscriptionByStripeSubscriptionId(stripeSubscriptionId);
  if (!subscription) return;

  // Update subscription
  subscription.status = "ACTIVE";
  subscription.currentPeriodStart = toISOString(invoice.period_start);
  subscription.currentPeriodEnd = toISOString(invoice.period_end);
  await saveSubscription(subscription);

  // Extend ONLINE slots and clear past_due flags
  const slots = await getHostSlots(subscription.hostId);

  for (const slot of slots) {
    slot.isPastDue = false;

    if (!slot.doNotRenew) {
      slot.expiresAt = addDays(
        subscription.currentPeriodEnd,
        slot.reviewCompensationDays
      );
    }

    await saveSlot(slot);
    await updateListing(slot.listingId, {
      slotExpiresAt: slot.expiresAt,
      slotIsPastDue: false,
    });
  }

  await sendNotification(subscription.hostId, "SUBSCRIPTION_RENEWED");
}
```

### `invoice.payment_failed`

```typescript
async function handlePaymentFailed(invoice: Stripe.Invoice) {
  const subscriptionRef = invoice.parent?.subscription_details?.subscription;
  if (!subscriptionRef) return;
  
  const stripeSubscriptionId = typeof subscriptionRef === 'string' 
    ? subscriptionRef 
    : subscriptionRef.id;
    
  const subscription = await findSubscriptionByStripeSubscriptionId(stripeSubscriptionId);
  if (!subscription) return;

  subscription.status = "PAST_DUE";
  await saveSubscription(subscription);

  // Mark all slots as past due (ads stay live during grace period)
  const slots = await getHostSlots(subscription.hostId);
  for (const slot of slots) {
    slot.isPastDue = true;
    await saveSlot(slot);
    await updateListing(slot.listingId, { slotIsPastDue: true });
  }

  await sendNotification(subscription.hostId, "PAYMENT_FAILED");
}
```

### `customer.subscription.deleted`

```typescript
async function handleSubscriptionDeleted(
  stripeSubscription: Stripe.Subscription
) {
  const subscription = await findSubscriptionByStripeSubscriptionId(stripeSubscription.id);
  if (!subscription) return;

  subscription.status = "EXPIRED";
  subscription.cancelledAt = new Date().toISOString();
  await saveSubscription(subscription);

  // Mark past-due slots for immediate expiry
  const slots = await getHostSlots(subscription.hostId);
  for (const slot of slots) {
    if (slot.isPastDue) {
      slot.markedForImmediateExpiry = true;
      await saveSlot(slot);
    }
  }

  await sendNotification(subscription.hostId, "SUBSCRIPTION_CANCELLED");
}
```

---

## Scheduled Jobs

### Slot Expiry Processor

**Trigger**: EventBridge rule, daily at 00:05 UTC

**Logic**:

```
1. Query AdvertisingSlots table GSI2 (ExpiryIndex) for slots where expiresAt <= now

2. For each slot:

   If markedForImmediateExpiry = true:
     → Expire immediately

   Else if isPastDue = true:
     → Skip (keep ad live during grace period)

   Else:
     → Expire normally

3. Expire slot:
   - Delete PublicListing records (PLACE and LOCALITY)
   - Delete PublicListingMedia records
   - Decrement location counts (COUNTRY, PLACE, LOCALITY)
   - Update listing in main table: status = 'APPROVED', clear slot fields
   - Delete slot record from AdvertisingSlots table
   - Add to notification batch

4. Group expired slots by hostId, send notifications
```

### Expiry Warning Processor

**Trigger**: EventBridge rule, daily at 00:10 UTC

**Logic**:

```
1. Query AdvertisingSlots table GSI2 (ExpiryIndex) for slots where expiresAt = today + 7 days

2. Filter to slots that will NOT auto-renew:
   - doNotRenew = true
   - OR subscription.cancelAtPeriodEnd = true
   - OR subscription.status in ['CANCELLED', 'EXPIRED']

   Do NOT send warnings for:
   - subscription.status = 'TRIALING' (user knows trial ends)
   - subscription.status = 'ACTIVE' with doNotRenew = false (will auto-renew)

3. Group by hostId, send warning notifications
```

---

## Notifications & Emails

### Notification Templates

| Template ID                      | Trigger                    | Title (EN)             | Title (SR)            |
| -------------------------------- | -------------------------- | ---------------------- | --------------------- |
| `LISTING_PUBLISHED`              | Ad goes online             | Your listing is live!  | Vaš oglas je aktivan! |
| `LISTING_APPROVED_NOT_PUBLISHED` | Approved but can't publish | Listing approved       | Oglas odobren         |
| `SLOT_EXPIRING_SOON`             | 7 days before expiry       | Ads expiring soon      | Oglasi uskoro ističu  |
| `SLOT_EXPIRED`                   | Slot expires               | Ads expired            | Oglasi su istekli     |
| `SUBSCRIPTION_RENEWED`           | Invoice paid               | Subscription renewed   | Pretplata obnovljena  |
| `PAYMENT_FAILED`                 | Payment fails              | Payment failed         | Plaćanje neuspešno    |
| `SUBSCRIPTION_CANCELLED`         | Sub cancelled              | Subscription cancelled | Pretplata otkazana    |
| `TRIAL_ENDING_SOON`              | 3 days before trial end    | Trial ending soon      | Proba uskoro ističe   |

### Email Templates

| Template ID                      | Subject (EN)                    | Subject (SR)                        |
| -------------------------------- | ------------------------------- | ----------------------------------- |
| `listing_published`              | Your listing is now live!       | Vaš oglas je sada aktivan!          |
| `listing_approved_not_published` | Your listing was approved       | Vaš oglas je odobren                |
| `slots_expiring_soon`            | Your ads expire in 7 days       | Vaši oglasi ističu za 7 dana        |
| `slots_expired`                  | Your ads have expired           | Vaši oglasi su istekli              |
| `subscription_renewed`           | Subscription renewed            | Pretplata obnovljena                |
| `payment_failed`                 | Action required: Payment failed | Potrebna akcija: Plaćanje neuspešno |
| `subscription_cancelled`         | Subscription cancelled          | Pretplata otkazana                  |
| `trial_ending_soon`              | Your free trial ends soon       | Vaša besplatna proba uskoro ističe  |

---

## Implementation Phases

### Phase 1: Data Model & Infrastructure ✅ COMPLETE

- [x] Create `subscription-plan.types.ts` (for SubscriptionPlans table)
- [x] Create `advertising-slot.types.ts` (for AdvertisingSlots table)
- [x] Update `subscription.types.ts` (enhanced HostSubscription for main table)
- [x] Update `listing.types.ts` with new fields (`submittedForReviewAt`, `reviewDurationDays`, slot fields)
- [x] Create SubscriptionPlans table (CDK)
- [x] Create AdvertisingSlots table with GSI1 and GSI2 (CDK)
- [x] Add environment variables to Lambda stacks
- [x] Seed initial SubscriptionPlan records

### Phase 2: Core Subscription Service ✅ COMPLETE

- [x] Create `subscription-service.ts` library
- [x] Create `subscription-events.ts` (core event handling logic)
- [x] Implement token availability checking (query AdvertisingSlots by host)
- [x] Implement slot creation (write to AdvertisingSlots table)
- [x] Implement slot deletion (delete from AdvertisingSlots table)
- [x] Implement slot expiry calculation
- [x] Implement review compensation calculation

### Phase 3: Host Endpoints ✅ MOSTLY COMPLETE

- [x] GET `/hosts/{hostId}/subscription` (query main table + AdvertisingSlots)
- [x] PUT `/hosts/{hostId}/listings/{listingId}/slot/do-not-renew`
- [x] POST `/hosts/{hostId}/listings/{listingId}/publish` (updated for slots)
- [ ] POST `/hosts/{hostId}/customer-portal` ← **NEW: Returns Stripe portal URL**
- [ ] POST `/hosts/{hostId}/subscription/change-preview` (may not be needed with Customer Portal)
- [ ] POST `/hosts/{hostId}/subscription/confirm-downgrade` (may not be needed with Customer Portal)

### Phase 4: Admin Endpoints ✅ COMPLETE

- [x] Modify PUT `/admin/listings/{listingId}/approve` for auto-publish
- [x] GET `/admin/subscription-plans` (query SubscriptionPlans table)
- [x] GET `/admin/subscription-plans/{planId}`
- [x] PUT `/admin/subscription-plans/{planId}`
- [x] POST `/admin/subscription-plans`
- [x] DELETE `/admin/subscription-plans/{planId}`

### Phase 5: Public Endpoints

- [ ] GET `/subscription-plans` (public pricing page - query SubscriptionPlans table)

### Phase 6: Stripe EventBridge Integration ⬅️ **CURRENT**

- [ ] Add GSI5 (StripeCustomerIndex) to main table for lookups
- [ ] Update `subscription.types.ts` with GSI5 fields
- [ ] Create EventBridge rule to route Stripe events to Lambda (CDK)
- [ ] Create `stripe-eventbridge-handler.ts` Lambda
- [ ] Implement `checkout.session.completed` handler (links hostId ↔ stripeCustomerId)
- [ ] Implement `customer.subscription.created` handler
- [ ] Implement `customer.subscription.updated` handler
- [ ] Implement `customer.subscription.deleted` handler
- [ ] Implement `invoice.paid` handler
- [ ] Implement `invoice.payment_failed` handler
- [ ] Create POST `/hosts/{hostId}/customer-portal` endpoint

### Phase 7: Scheduled Jobs

- [ ] Create EventBridge rules for scheduled jobs (CDK)
- [ ] Implement `slot-expiry-processor` Lambda (query AdvertisingSlots GSI2)
- [ ] Implement `expiry-warning-processor` Lambda

### Phase 8: Notifications & Emails

- [ ] Create notification templates
- [ ] Create email templates
- [ ] Integrate with existing notification service

### Phase 9: Migration & Testing

- [ ] Write migration scripts for existing data
- [ ] Migrate existing SubscriptionPlan records to new table
- [ ] Create slots for existing ONLINE listings
- [ ] Test with Stripe Sandbox via EventBridge
- [ ] Deploy to staging
- [ ] Production migration

---

## Dev Simulation Endpoints (OPTIONAL)

These endpoints were created but may not be needed since we're using Stripe Sandbox for testing:

- `POST /admin/dev/subscriptions/{hostId}/simulate-signup`
- `POST /admin/dev/subscriptions/{hostId}/simulate-payment`
- `POST /admin/dev/subscriptions/{hostId}/simulate-payment-failed`
- `POST /admin/dev/subscriptions/{hostId}/simulate-plan-change`
- `POST /admin/dev/subscriptions/{hostId}/simulate-cancellation`
- `PUT /admin/dev/subscriptions/{hostId}/update-dates`

**Status**: Created in `dev-simulator.ts` but not wired up to CDK. Can be deleted if not needed.

---

## Migration Considerations

### Existing SubscriptionPlan Records

Current plans are in main table with `pk: SUBSCRIPTION_PLAN#<planName>`.

**Migration**:

1. Read existing plans from main table
2. Transform to new schema (add Stripe fields, prices array)
3. Write to new SubscriptionPlans table
4. Delete from main table (optional, or leave for rollback)

### Existing FREE Subscriptions

Current hosts have a FREE subscription with `maxListings` limit. Options:

1. **Convert to trial**: Give existing users a trial period on a real plan
2. **Grandfather**: Keep FREE tier for existing users only
3. **Migrate to basic**: Auto-assign to basic plan with trial

**Decision needed before implementation.**

### Existing ONLINE Listings

For each existing ONLINE listing:

1. Create an AdvertisingSlot in new table
2. Set `expiresAt` based on new subscription period
3. Set `reviewCompensationDays = 0` (no historical data)
4. Update listing with slot fields

### Existing OFFLINE Listings

- If we're removing OFFLINE status, convert to APPROVED
- These listings can be published when host has tokens

---

## Appendix: State Diagrams

### Listing Status Transitions

```
DRAFT
  │
  ▼ (host submits)
IN_REVIEW
  │
  ▼ (admin starts review)
REVIEWING
  │
  ├──▶ REJECTED (admin rejects)
  │       │
  │       ▼ (host fixes & resubmits)
  │    IN_REVIEW
  │
  ▼ (admin approves)
  │
  ├──▶ ONLINE (if tokens available - auto-publish)
  │       │
  │       ▼ (slot expires)
  │    APPROVED
  │
  └──▶ APPROVED (if no tokens - manual publish later)
          │
          ▼ (host publishes when tokens available)
       ONLINE
```

### Subscription Status Transitions

```
(new signup)
     │
     ▼
 TRIALING ──────────────────────────────┐
     │                                  │
     ▼ (trial ends, payment succeeds)   │ (trial ends, no payment)
  ACTIVE ◄──────────────────────────────┤
     │                                  │
     ├──▶ PAST_DUE (payment fails)      │
     │       │                          │
     │       ├──▶ ACTIVE (retry works)  │
     │       │                          │
     │       └──▶ EXPIRED ◄─────────────┘
     │              (payment fails permanently)
     │
     └──▶ CANCELLED (user cancels)
              │
              ▼ (period ends)
          EXPIRED
```

---

## Appendix: Cross-Table Transactions

DynamoDB TransactWriteItems supports up to 100 items across multiple tables. Key transactions:

### Publishing a Listing

```typescript
// Transaction across 3 tables:
await docClient.send(new TransactWriteCommand({
  TransactItems: [
    // 1. Create slot in AdvertisingSlots table
    { Put: { TableName: SLOTS_TABLE, Item: slotRecord } },

    // 2. Update listing in main table
    { Update: { TableName: MAIN_TABLE, Key: listingKey, ... } },

    // 3. Create PublicListing in PublicListings table
    { Put: { TableName: PUBLIC_LISTINGS_TABLE, Item: publicListing } },

    // 4. Create PublicListingMedia records
    ...mediaRecords.map(m => ({ Put: { TableName: MEDIA_TABLE, Item: m } }))
  ]
}));
```

### Expiring a Slot

```typescript
// Transaction across multiple tables:
await docClient.send(new TransactWriteCommand({
  TransactItems: [
    // 1. Delete slot from AdvertisingSlots table
    { Delete: { TableName: SLOTS_TABLE, Key: slotKey } },

    // 2. Update listing in main table
    { Update: { TableName: MAIN_TABLE, Key: listingKey, ... } },

    // 3. Delete PublicListing records
    { Delete: { TableName: PUBLIC_LISTINGS_TABLE, Key: placeKey } },
    { Delete: { TableName: PUBLIC_LISTINGS_TABLE, Key: localityKey } },

    // 4. Delete PublicListingMedia records
    ...mediaKeys.map(k => ({ Delete: { TableName: MEDIA_TABLE, Key: k } }))
  ]
}));
```

---

_End of Implementation Plan_
