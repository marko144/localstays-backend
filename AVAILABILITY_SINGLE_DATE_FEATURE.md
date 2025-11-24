# Availability Single Date Blocking Feature

## Overview

Updated the availability blocking/unblocking API to support both single date and date range operations for HOST_CLOSED blocks.

## Changes Made

### 1. Service Layer (`availability-service.ts`)

#### Updated `blockDates()` function:

- Made `endDate` parameter optional
- Defaults to `startDate` if not provided (single day block)
- Validates single date or date range appropriately
- Uses `generateDatesInclusive()` for all HOST_CLOSED blocks

```typescript
export async function blockDates(
  docClient: DynamoDBDocumentClient,
  listingId: string,
  hostId: string,
  startDate: string,
  endDate?: string // ← Now optional
): Promise<{ blockId: string; nightsBlocked: string[] }>;
```

#### Updated `unblockDateRange()` function:

- Made `endDate` parameter optional
- Defaults to `startDate` if not provided (single day unblock)
- Validates single date or date range appropriately
- Uses `generateDatesInclusive()` for all HOST_CLOSED blocks

```typescript
export async function unblockDateRange(
  docClient: DynamoDBDocumentClient,
  listingId: string,
  hostId: string,
  startDate: string,
  endDate?: string // ← Now optional
): Promise<{ nightsUnblocked: string[] }>;
```

### 2. API Handler (`availability-handler.ts`)

#### Updated `handleBlockDates()`:

- Changed validation to only require `startDate`
- `endDate` is now optional
- Updated response message based on whether it's a single date or range
- Updated logging to indicate single day vs range

```typescript
// Request body
{
  "startDate": "2025-01-15",  // Required
  "endDate": "2025-01-17"     // Optional - if omitted, only startDate is blocked
}
```

#### Updated `handleUnblockDates()`:

- Changed validation to only require `startDate`
- `endDate` is now optional
- Updated response message based on whether it's a single date or range
- Updated logging to indicate single day vs range

```typescript
// Request body
{
  "startDate": "2025-01-15",  // Required
  "endDate": "2025-01-17"     // Optional - if omitted, only startDate is unblocked
}
```

## API Usage Examples

### Block a Single Date

```bash
POST /api/v1/hosts/{hostId}/listings/{listingId}/availability/block
{
  "startDate": "2025-12-25"
}

# Response:
{
  "message": "Date blocked successfully",
  "blockId": "abc-123-def-456",
  "listingId": "listing_123",
  "dateRange": {
    "startDate": "2025-12-25",
    "endDate": "2025-12-25"
  },
  "nightsBlocked": ["2025-12-25"],
  "totalNights": 1
}
```

### Block a Date Range

```bash
POST /api/v1/hosts/{hostId}/listings/{listingId}/availability/block
{
  "startDate": "2025-12-28",
  "endDate": "2025-12-31"
}

# Response:
{
  "message": "Date range blocked successfully",
  "blockId": "xyz-789-uvw-012",
  "listingId": "listing_123",
  "dateRange": {
    "startDate": "2025-12-28",
    "endDate": "2025-12-31"
  },
  "nightsBlocked": ["2025-12-28", "2025-12-29", "2025-12-30", "2025-12-31"],
  "totalNights": 4
}
```

### Unblock a Single Date

```bash
DELETE /api/v1/hosts/{hostId}/listings/{listingId}/availability/unblock
{
  "startDate": "2025-12-25"
}

# Response:
{
  "message": "Date unblocked successfully",
  "listingId": "listing_123",
  "dateRange": {
    "startDate": "2025-12-25",
    "endDate": "2025-12-25"
  },
  "nightsUnblocked": ["2025-12-25"],
  "totalNights": 1
}
```

### Unblock a Date Range

```bash
DELETE /api/v1/hosts/{hostId}/listings/{listingId}/availability/unblock
{
  "startDate": "2025-12-28",
  "endDate": "2025-12-31"
}

# Response:
{
  "message": "Date range unblocked successfully",
  "listingId": "listing_123",
  "dateRange": {
    "startDate": "2025-12-28",
    "endDate": "2025-12-31"
  },
  "nightsUnblocked": ["2025-12-28", "2025-12-29", "2025-12-30", "2025-12-31"],
  "totalNights": 4
}
```

## Behavior

### Blocking:

- **Single Date**: Only `startDate` is required. The system will block just that one night.
- **Date Range**: Both `startDate` and `endDate` are provided. All dates are blocked **inclusive** (both start and end dates are blocked).
- All blocks are `HOST_CLOSED` type with `kind: 'BLOCK'`.
- Each block action generates a unique `eventId` (e.g., `BLOCK#uuid`).

### Unblocking:

- **Single Date**: Only `startDate` is required. The system will unblock just that one night if it's a HOST_CLOSED block.
- **Date Range**: Both `startDate` and `endDate` are provided. All dates in the range are unblocked **inclusive**.
- Only `HOST_CLOSED` blocks can be unblocked via this API.
- Security checks ensure the host owns the listing and the dates are HOST_CLOSED blocks.

### Flexibility:

- Hosts can block a range (e.g., Jan 1-10) and then selectively unblock specific dates (e.g., Jan 5-6) within that range.
- Each date is independent - there's no requirement to unblock entire blocks by `eventId`.

## Deployment

Deployed to **staging** environment on November 24, 2025.

**Stack**: `LocalstaysStagingHostApiStack`  
**Lambda**: `HostAvailabilityHandlerLambda` updated

## Testing

The feature can be tested via the Host API:

- **Endpoint**: `https://k27ar3e32j.execute-api.eu-north-1.amazonaws.com/staging/`
- **Paths**:
  - `POST /api/v1/hosts/{hostId}/listings/{listingId}/availability/block`
  - `DELETE /api/v1/hosts/{hostId}/listings/{listingId}/availability/unblock`

## Notes

- This feature is specifically for `HOST_CLOSED` blocks only (manual host blocks).
- External bookings (Booking.com, Airbnb, etc.) are not part of this implementation.
- The `eventId` field exists in the database but is not used for unblocking HOST_CLOSED blocks - hosts can unblock any subset of dates regardless of which block action created them.
- All date operations use **inclusive** logic (both start and end dates are included in the operation).

## Files Modified

1. `/backend/services/api/availability/lib/availability-service.ts`

   - Updated `blockDates()` to accept optional `endDate`
   - Updated `unblockDateRange()` to accept optional `endDate`

2. `/backend/services/api/availability/availability-handler.ts`
   - Updated `handleBlockDates()` to handle optional `endDate`
   - Updated `handleUnblockDates()` to handle optional `endDate`

## Backward Compatibility

✅ **Fully backward compatible** - existing frontend code that passes both `startDate` and `endDate` will continue to work exactly as before. The change only adds the ability to omit `endDate` for single-date operations.



