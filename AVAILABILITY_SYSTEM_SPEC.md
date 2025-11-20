# Listing Availability Tracking System

## Overview

This document specifies the **Availability Tracking System** for Localstays. This system uses a **negative availability model** - we store records only for dates when a listing is **NOT available** (either booked or blocked).

---

## Table Schema

**Table Name**: `localstays-availability-<stage>`

**Keys**:

- **PK**: `LISTING_AVAILABILITY#<listingId>`
- **SK**: `DATE#<YYYY-MM-DD>`

**GSI1 - HostAvailabilityIndex**:

- **GSI1PK**: `HOST_AVAILABILITY#<hostId>`
- **GSI1SK**: `DATE#<YYYY-MM-DD>#LISTING#<listingId>`
- **Purpose**: Query all unavailable dates across all listings for a host

**Billing Mode**: Pay-per-request

**Features**:

- Point-in-time recovery enabled
- AWS managed encryption
- Production: Deletion protection + RETAIN policy
- Non-production: DESTROY policy

---

## Data Model

### Record Structure

```typescript
{
  // DynamoDB Keys
  pk: "LISTING_AVAILABILITY#lst_123abc",
  sk: "DATE#2025-01-15",

  // Core Fields
  listingId: "lst_123abc",
  hostId: "host_456def",
  date: "2025-01-15",  // YYYY-MM-DD

  // Event Classification
  kind: "BOOKING",                    // "BOOKING" | "BLOCK"
  eventSource: "LOCALSTAYS",          // see enum below
  eventId: "BOOKING#bk_001",          // group ID for booking/block

  // Booking Details
  bookingId: "bk_001",                // internal booking ID (null for BLOCK)
  externalReservationId: null,        // external channel ID (null for Localstays/blocks)

  // Audit
  createdAt: "2025-01-15T10:30:00Z",

  // GSI1: Query all availability for a host
  gsi1pk: "HOST_AVAILABILITY#host_456def",
  gsi1sk: "DATE#2025-01-15#LISTING#lst_123abc"
}
```

---

## Enums

### AvailabilityKind

Distinguishes between revenue-generating bookings and non-revenue blocks.

```typescript
type AvailabilityKind = "BOOKING" | "BLOCK";
```

- **BOOKING**: Night is booked by a guest (revenue-generating)
- **BLOCK**: Night is blocked with no guest (maintenance, host closed, etc.)

### AvailabilityEventSource

Tracks the origin of the unavailability.

```typescript
type AvailabilityEventSource =
  | "HOST_CLOSED" // Host manually blocked dates (no guest)
  | "LOCALSTAYS" // Booking made via Localstays platform
  | "BOOKING_COM" // Booking synced from Booking.com
  | "AIRBNB" // Booking synced from Airbnb
  | "OTHER"; // Any other external channel
```

---

## Field Requirements by Scenario

### Scenario 1: Localstays Booking

```typescript
{
  kind: "BOOKING",
  eventSource: "LOCALSTAYS",
  eventId: "BOOKING#bk_001",          // Same as bookingId
  bookingId: "bk_001",                // ✅ Required
  externalReservationId: null,        // ❌ Always null for Localstays
  // ...
}
```

### Scenario 2: External Booking (Booking.com, Airbnb, etc.)

```typescript
{
  kind: "BOOKING",
  eventSource: "BOOKING_COM",
  eventId: "BOOKING#bk_002",          // Internal booking ID
  bookingId: "bk_002",                // ✅ Required (internal ID)
  externalReservationId: "BC789456",  // ✅ Required (channel's reservation ID)
  // ...
}
```

### Scenario 3: Host Closed / Manual Block

```typescript
{
  kind: "BLOCK",
  eventSource: "HOST_CLOSED",
  eventId: "BLOCK#uuid-here",         // Auto-generated UUID
  bookingId: null,                    // ❌ Always null for blocks
  externalReservationId: null,        // ❌ Always null for blocks
  // ...
}
```

---

## Multi-Night Bookings/Blocks

For multi-night stays, **create one record per night**.

### Date Range Rules

**Critical**:

- ✅ **Include check-in date** (guest arrives, night is unavailable)
- ❌ **Exclude check-out date** (guest leaves, night becomes available for new check-in)

### Example

**Booking**: Check-in `2025-01-10`, Check-out `2025-01-13` (3 nights)

**Records Created**:

```typescript
// Night 1
{
  pk: "LISTING_AVAILABILITY#lst_123",
  sk: "DATE#2025-01-10",
  eventId: "BOOKING#bk_001",
  // ...
}

// Night 2
{
  pk: "LISTING_AVAILABILITY#lst_123",
  sk: "DATE#2025-01-11",
  eventId: "BOOKING#bk_001",
  // ...
}

// Night 3
{
  pk: "LISTING_AVAILABILITY#lst_123",
  sk: "DATE#2025-01-12",
  eventId: "BOOKING#bk_001",
  // ...
}

// ❌ NO record for 2025-01-13 (checkout date)
```

---

## Query Patterns

### Check Availability for a Date Range

**Use Case**: Check if listing is available from `2025-01-15` to `2025-01-20`

**Query**:

```typescript
{
  KeyConditionExpression: 'pk = :pk AND sk BETWEEN :startDate AND :endDate',
  ExpressionAttributeValues: {
    ':pk': 'LISTING_AVAILABILITY#lst_123',
    ':startDate': 'DATE#2025-01-15',
    ':endDate': 'DATE#2025-01-19'  // Exclude checkout date
  }
}
```

**Result**:

- If **no items** returned: Listing is available for all nights
- If **items returned**: Listing is unavailable for those specific nights

### Delete All Nights of a Booking/Block

**Use Case**: Guest cancels booking, or host removes block

**Approach**: Use `eventId` to identify all nights

```typescript
// Step 1: Query all nights with this eventId
const nights = await query({
  KeyConditionExpression: "pk = :pk",
  FilterExpression: "eventId = :eventId",
  ExpressionAttributeValues: {
    ":pk": "LISTING_AVAILABILITY#lst_123",
    ":eventId": "BOOKING#bk_001",
  },
});

// Step 2: Batch delete all items
for (const night of nights.Items) {
  await deleteItem({
    Key: {
      pk: night.pk,
      sk: night.sk,
    },
  });
}
```

### Query All Availability for a Host (GSI1)

**Use Case**: Show calendar with all unavailable dates across all host's listings

**Query All Dates**:

```typescript
{
  TableName: AVAILABILITY_TABLE,
  IndexName: 'HostAvailabilityIndex',
  KeyConditionExpression: 'gsi1pk = :hostPk',
  ExpressionAttributeValues: {
    ':hostPk': 'HOST_AVAILABILITY#host_456'
  }
}
```

**Query Host's Availability for Date Range**:

```typescript
{
  TableName: AVAILABILITY_TABLE,
  IndexName: 'HostAvailabilityIndex',
  KeyConditionExpression: 'gsi1pk = :hostPk AND gsi1sk BETWEEN :startDate AND :endDate',
  ExpressionAttributeValues: {
    ':hostPk': 'HOST_AVAILABILITY#host_456',
    ':startDate': 'DATE#2025-01-10',
    ':endDate': 'DATE#2025-01-31'
  }
}
```

**Result**: Returns all unavailable dates for all host's listings, sorted by date then listing ID

---

## Helper Functions

The system provides several utility functions in `availability.types.ts`:

### PK/SK Builders

```typescript
buildAvailabilityPK(listingId: string): string
// Returns: "LISTING_AVAILABILITY#<listingId>"

buildAvailabilitySK(date: string): string
// Returns: "DATE#<YYYY-MM-DD>"
```

### Event ID Generators

```typescript
buildBookingEventId(bookingId: string): string
// Returns: "BOOKING#<bookingId>"

buildBlockEventId(blockId: string): string
// Returns: "BLOCK#<uuid>"
```

### GSI Builders

```typescript
buildHostAvailabilityGSI1PK(hostId: string): string
// Returns: "HOST_AVAILABILITY#<hostId>"

buildHostAvailabilityGSI1SK(date: string, listingId: string): string
// Returns: "DATE#<YYYY-MM-DD>#LISTING#<listingId>"
```

### Date Range Generator

```typescript
generateNightsBetween(checkIn: string, checkOut: string): string[]
// Example: ("2025-01-10", "2025-01-13") → ["2025-01-10", "2025-01-11", "2025-01-12"]
// Excludes checkout date
```

### Date Validation

```typescript
isValidDateFormat(date: string): boolean
// Validates YYYY-MM-DD format
```

---

## Usage Examples

### Example 1: Create Availability Records for a Booking

```typescript
import {
  generateNightsBetween,
  buildAvailabilityPK,
  buildAvailabilitySK,
  buildBookingEventId,
  buildHostAvailabilityGSI1PK,
  buildHostAvailabilityGSI1SK,
} from "./types/availability.types";

const listingId = "lst_123abc";
const hostId = "host_456def";
const bookingId = "bk_001";
const checkIn = "2025-01-10";
const checkOut = "2025-01-13";

// Generate all nights (excludes checkout)
const nights = generateNightsBetween(checkIn, checkOut);
// → ["2025-01-10", "2025-01-11", "2025-01-12"]

const now = new Date().toISOString();

// Create records for each night
for (const date of nights) {
  const record = {
    pk: buildAvailabilityPK(listingId),
    sk: buildAvailabilitySK(date),

    listingId,
    hostId,
    date,

    kind: "BOOKING" as const,
    eventSource: "LOCALSTAYS" as const,
    eventId: buildBookingEventId(bookingId),

    bookingId,
    externalReservationId: null,

    createdAt: now,

    // GSI1 for querying by host
    gsi1pk: buildHostAvailabilityGSI1PK(hostId),
    gsi1sk: buildHostAvailabilityGSI1SK(date, listingId),
  };

  await dynamodb.put({ TableName: AVAILABILITY_TABLE, Item: record });
}
```

### Example 2: Create Block for Host Closed Dates

```typescript
import { randomUUID } from "crypto";
import {
  generateNightsBetween,
  buildAvailabilityPK,
  buildAvailabilitySK,
  buildBlockEventId,
  buildHostAvailabilityGSI1PK,
  buildHostAvailabilityGSI1SK,
} from "./types/availability.types";

const listingId = "lst_123abc";
const hostId = "host_456def";
const blockId = randomUUID(); // Generate unique block ID
const startDate = "2025-02-01";
const endDate = "2025-02-05";

const nights = generateNightsBetween(startDate, endDate);
const now = new Date().toISOString();

for (const date of nights) {
  const record = {
    pk: buildAvailabilityPK(listingId),
    sk: buildAvailabilitySK(date),

    listingId,
    hostId,
    date,

    kind: "BLOCK" as const,
    eventSource: "HOST_CLOSED" as const,
    eventId: buildBlockEventId(blockId),

    bookingId: null,
    externalReservationId: null,

    createdAt: now,

    // GSI1 for querying by host
    gsi1pk: buildHostAvailabilityGSI1PK(hostId),
    gsi1sk: buildHostAvailabilityGSI1SK(date, listingId),
  };

  await dynamodb.put({ TableName: AVAILABILITY_TABLE, Item: record });
}
```

### Example 3: Check Availability for Date Range

```typescript
import {
  buildAvailabilityPK,
  buildAvailabilitySK,
} from "./types/availability.types";

async function checkAvailability(
  listingId: string,
  checkIn: string,
  checkOut: string
): Promise<boolean> {
  // Calculate last night to check (excludes checkout date)
  const lastNight = new Date(checkOut);
  lastNight.setDate(lastNight.getDate() - 1);
  const lastNightStr = lastNight.toISOString().split("T")[0];

  const result = await dynamodb.query({
    TableName: AVAILABILITY_TABLE,
    KeyConditionExpression: "pk = :pk AND sk BETWEEN :start AND :end",
    ExpressionAttributeValues: {
      ":pk": buildAvailabilityPK(listingId),
      ":start": buildAvailabilitySK(checkIn),
      ":end": buildAvailabilitySK(lastNightStr),
    },
  });

  // If any records found, listing is unavailable
  return result.Items.length === 0;
}

// Usage
const isAvailable = await checkAvailability(
  "lst_123",
  "2025-01-10",
  "2025-01-13"
);
console.log(isAvailable ? "Available" : "Not available");
```

---

## Integration Points

### When to Create Availability Records

1. **Booking Confirmation**: Create records when booking status changes to `CONFIRMED`
2. **External Sync**: Create records when syncing bookings from Booking.com, Airbnb
3. **Host Blocks**: Create records when host manually blocks dates
4. **Admin Blocks**: Create records when admin blocks dates for maintenance

### When to Delete Availability Records

1. **Booking Cancellation**: Delete all records with matching `eventId`
2. **Host Unblocks**: Delete all records with matching `eventId`
3. **Booking Modification**: Delete old records + create new ones for modified dates

### Booking Lifecycle Example

```typescript
// 1. Guest makes booking
createAvailabilityRecords(listingId, checkIn, checkOut, bookingId);

// 2. Guest cancels booking
deleteAvailabilityRecordsByEventId(listingId, `BOOKING#${bookingId}`);

// 3. Guest modifies dates (change checkout from Jan 13 → Jan 15)
deleteAvailabilityRecordsByEventId(listingId, `BOOKING#${bookingId}`);
createAvailabilityRecords(listingId, checkIn, newCheckOut, bookingId);
```

---

## Frontend Requirements

### Host Dashboard - Availability Calendar

**Display**:

- Show calendar view with unavailable dates highlighted
- Color code: Bookings (green), Blocks (gray)
- Click date to view booking/block details

**Actions**:

- Block dates: Create `HOST_CLOSED` records
- Unblock dates: Delete records by `eventId`
- View booking details: Click booked dates

### Booking Flow - Availability Check

**Before showing listing**:

```typescript
const isAvailable = await checkAvailability(listingId, checkIn, checkOut);
if (!isAvailable) {
  // Show "Dates not available" message
  // Suggest alternative dates
}
```

**Before payment**:

```typescript
// Re-check availability (could have changed)
const stillAvailable = await checkAvailability(listingId, checkIn, checkOut);
if (!stillAvailable) {
  return error("These dates are no longer available");
}
```

---

## Performance Considerations

### Query Efficiency

- ✅ **Efficient**: Query by `listingId` + date range (uses PK + SK)
- ✅ **Efficient**: Small result sets (only unavailable dates)
- ❌ **Inefficient**: Querying across multiple listings (requires multiple queries)

### Storage Optimization

- **Negative model** is optimal: Most dates are available, few are unavailable
- Example: Listing with 10 bookings/year × 3 nights each = 30 records/year
- vs. Positive model: 365 records/year

### Scaling Strategy

- No GSI needed currently (all queries by listing + dates)
- Future: Add GSI if need to query by `bookingId` or `eventSource` across listings

---

## Summary

| Feature            | Value                                                |
| ------------------ | ---------------------------------------------------- |
| **Model**          | Negative availability (store unavailable dates only) |
| **Granularity**    | One record per night                                 |
| **Date Range**     | Check-in (inclusive) to check-out (exclusive)        |
| **Booking ID**     | Always present for bookings (even external)          |
| **External ID**    | Only for external channels                           |
| **Event Grouping** | Use `eventId` for bulk operations                    |
| **GSI1**           | Query all availability by host (across all listings) |
| **Host ID**        | Always present, enables GSI1 queries                 |

---

## Next Steps

1. ✅ **Infrastructure**: DynamoDB table created
2. ✅ **Types**: TypeScript types and helpers defined
3. ⏳ **Endpoints**: Create API endpoints for:
   - Block/unblock dates (host)
   - Check availability (public)
   - Sync external bookings (admin)
4. ⏳ **Integration**: Hook into booking lifecycle
5. ⏳ **Frontend**: Build availability calendar UI
