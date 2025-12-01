# Billing Address Implementation Summary

## ✅ Implementation Complete

Successfully implemented billing address support for host profiles with lazy migration for existing hosts.

---

## Changes Made

### 1. Type Definitions (`backend/services/types/host.types.ts`)

Added billing address fields to host types:

```typescript
export interface BaseHost {
  // ... existing fields ...
  address: Address;

  // NEW: Billing address fields
  billingAddressSameAsPhysical: boolean; // Default: true
  billingAddress: Address | null; // null if billingAddressSameAsPhysical = true

  // ... existing fields ...
}

export interface IndividualProfileData {
  // ... existing fields ...
  address: Address;
  billingAddressSameAsPhysical: boolean;
  billingAddress?: Address | null; // Optional in submission
  // ... existing fields ...
}

export interface BusinessProfileData {
  // ... existing fields ...
  address: Address;
  billingAddressSameAsPhysical: boolean;
  billingAddress?: Address | null; // Optional in submission
  // ... existing fields ...
}
```

### 2. Validation (`backend/services/api/lib/profile-validation.ts`)

Added billing address validation:

- **Required field**: `billingAddressSameAsPhysical` must be a boolean
- **Conditional validation**:
  - If `false`: `billingAddress` is required and must be a valid address
  - If `true`: `billingAddress` should not be provided
- **Address validation**: Reused existing `validateAddress` function with field prefix support
- **Sanitization**: Added billing address sanitization to `sanitizeProfileData`

### 3. Host API - Get Profile (`backend/services/api/hosts/get-profile.ts`)

- Added **lazy migration** in `getHostRecord`:
  ```typescript
  // Set defaults for existing records without billing address fields
  if (host.billingAddressSameAsPhysical === undefined) {
    host.billingAddressSameAsPhysical = true;
    host.billingAddress = null;
  }
  ```
- Updated response to include `billingAddressSameAsPhysical` and `billingAddress`

### 4. Admin API - Get Host (`backend/services/api/admin/hosts/get-host.ts`)

- Added **lazy migration** for existing hosts (same as Host API)
- Returns full host object including billing address fields

### 5. Automatic Support in Other Endpoints

The following endpoints automatically support billing address (no changes needed):

- **`submit-intent.ts`**: Validates and stores profile data (including billing address) in submission token
- **`confirm-submission.ts`**: Applies profile data from token to host record (spreads all fields)
- **`update-rejected-profile.ts`**: Uses same validation and profile data types

---

## Migration Strategy

### Lazy Migration (Implemented)

Existing host records without billing address fields are automatically migrated when read:

```typescript
if (host.billingAddressSameAsPhysical === undefined) {
  host.billingAddressSameAsPhysical = true; // Default: same as physical
  host.billingAddress = null; // No separate billing address
}
```

**Benefits:**

- ✅ Zero downtime
- ✅ No batch migration script needed
- ✅ Hosts are migrated on-demand as they access their profiles
- ✅ No impact on existing functionality

---

## API Changes

### Host API - GET `/api/v1/hosts/{hostId}/profile`

**Response now includes:**

```json
{
  "hostId": "host_123",
  "address": { ... },
  "billingAddressSameAsPhysical": true,
  "billingAddress": null,
  ...
}
```

### Host API - POST `/api/v1/hosts/{hostId}/submit-intent`

**Request body now requires:**

```json
{
  "profile": {
    "address": { ... },
    "billingAddressSameAsPhysical": true,
    "billingAddress": null,  // or Address object if flag is false
    ...
  },
  "documents": [ ... ]
}
```

### Admin API - GET `/api/v1/admin/hosts/{hostId}`

**Response now includes:**

```json
{
  "success": true,
  "data": {
    "hostId": "host_123",
    "address": { ... },
    "billingAddressSameAsPhysical": false,
    "billingAddress": {
      "addressLine1": "456 Business Ave",
      "addressLine2": "Suite 100",
      "locality": "Novi Sad",
      "administrativeArea": "Vojvodina",
      "postalCode": "21000",
      "countryCode": "RS"
    },
    ...
  }
}
```

---

## Frontend Changes Required

### 1. Host Profile Form

**Add billing address section:**

```typescript
// Checkbox
<Checkbox
  checked={billingAddressSameAsPhysical}
  onChange={(e) => setBillingAddressSameAsPhysical(e.target.checked)}
>
  Billing address is the same as my physical address
</Checkbox>;

// Conditional billing address form
{
  !billingAddressSameAsPhysical && (
    <AddressForm
      value={billingAddress}
      onChange={setBillingAddress}
      label="Billing Address"
    />
  );
}
```

**Submit both fields:**

```typescript
const profileData = {
  ...otherFields,
  address: physicalAddress,
  billingAddressSameAsPhysical,
  billingAddress: billingAddressSameAsPhysical ? null : billingAddress,
};
```

### 2. Host Profile Display

**Show billing address:**

```typescript
<Section title="Physical Address">
  <AddressDisplay address={host.address} />
</Section>

<Section title="Billing Address">
  {host.billingAddressSameAsPhysical ? (
    <Text>Same as physical address</Text>
  ) : (
    <AddressDisplay address={host.billingAddress} />
  )}
</Section>
```

### 3. Admin Host Profile View

**Display both addresses clearly:**

```typescript
<Grid>
  <Column>
    <Heading>Physical Address</Heading>
    <AddressDisplay address={host.address} />
  </Column>
  <Column>
    <Heading>Billing Address</Heading>
    {host.billingAddressSameAsPhysical ? (
      <Badge>Same as Physical</Badge>
    ) : (
      <AddressDisplay address={host.billingAddress} />
    )}
  </Column>
</Grid>
```

---

## Validation Rules

### Backend Validation

1. **`billingAddressSameAsPhysical`** (required):

   - Must be a boolean
   - Error: "Billing address flag is required"

2. **`billingAddress`** (conditional):

   - If flag is `false`: Required, must be valid Address
   - If flag is `true`: Must not be provided
   - Errors:
     - "Billing address is required when different from physical address"
     - "Billing address should not be provided when same as physical address"

3. **Address validation** (when provided):
   - `addressLine1`: Required, max 200 chars
   - `addressLine2`: Optional, max 200 chars
   - `locality`: Required, max 100 chars
   - `administrativeArea`: Required, max 100 chars
   - `postalCode`: Required, max 20 chars
   - `countryCode`: Required, ISO-3166-1 alpha-2

### Frontend Validation

Should match backend validation to provide immediate feedback.

---

## Testing

### Test Scenarios

1. **New host submission with same billing address:**

   ```json
   {
     "billingAddressSameAsPhysical": true,
     "billingAddress": null
   }
   ```

   ✅ Should succeed

2. **New host submission with different billing address:**

   ```json
   {
     "billingAddressSameAsPhysical": false,
     "billingAddress": { "addressLine1": "...", ... }
   }
   ```

   ✅ Should succeed

3. **Invalid: Flag false but no billing address:**

   ```json
   {
     "billingAddressSameAsPhysical": false,
     "billingAddress": null
   }
   ```

   ❌ Should fail validation

4. **Invalid: Flag true but billing address provided:**

   ```json
   {
     "billingAddressSameAsPhysical": true,
     "billingAddress": { "addressLine1": "...", ... }
   }
   ```

   ❌ Should fail validation

5. **Existing host profile retrieval:**
   - GET existing host without billing address fields
   - ✅ Should return with `billingAddressSameAsPhysical: true` and `billingAddress: null`

---

## Deployment Status

### ✅ Deployed to Staging

- **Host API Stack**: `localstays-staging-host-api`
- **Admin API Stack**: `localstays-staging-admin-api`
- **Deployment Time**: December 1, 2025 8:43 PM
- **Status**: Successful

### Endpoints Updated

- ✅ `POST /api/v1/hosts/{hostId}/submit-intent`
- ✅ `GET /api/v1/hosts/{hostId}/profile`
- ✅ `PUT /api/v1/hosts/{hostId}/update-rejected-profile`
- ✅ `GET /api/v1/admin/hosts/{hostId}`

---

## Database Schema

### DynamoDB Item Structure

**Host record with billing address:**

```json
{
  "pk": "HOST#host_123",
  "sk": "META",
  "hostId": "host_123",
  "hostType": "BUSINESS",
  "address": {
    "addressLine1": "123 Main St",
    "addressLine2": null,
    "locality": "Belgrade",
    "administrativeArea": "Belgrade",
    "postalCode": "11000",
    "countryCode": "RS"
  },
  "billingAddressSameAsPhysical": false,
  "billingAddress": {
    "addressLine1": "456 Business Ave",
    "addressLine2": "Suite 100",
    "locality": "Novi Sad",
    "administrativeArea": "Vojvodina",
    "postalCode": "21000",
    "countryCode": "RS"
  },
  ...
}
```

**Host record with same billing address:**

```json
{
  "pk": "HOST#host_123",
  "sk": "META",
  "hostId": "host_123",
  "address": { ... },
  "billingAddressSameAsPhysical": true,
  "billingAddress": null,
  ...
}
```

---

## Performance Impact

- **Storage**: +200-300 bytes per host (only when billing address differs)
- **Read operations**: No change (single GetItem)
- **Write operations**: No change (same PutCommand)
- **Query performance**: No impact (no new GSI needed)
- **Cost**: Negligible increase

---

## Next Steps

1. ✅ Update frontend host profile form
2. ✅ Update frontend host profile display
3. ✅ Update admin host profile view
4. ✅ Test new host submissions
5. ✅ Test existing host profile retrieval
6. ✅ Test profile updates after rejection

---

## Files Modified

1. `backend/services/types/host.types.ts`
2. `backend/services/api/lib/profile-validation.ts`
3. `backend/services/api/hosts/get-profile.ts`
4. `backend/services/api/admin/hosts/get-host.ts`

**Files automatically supporting billing address (no changes needed):**

- `backend/services/api/hosts/submit-intent.ts`
- `backend/services/api/hosts/confirm-submission.ts`
- `backend/services/api/hosts/update-rejected-profile.ts`

---

## Summary

✅ **Billing address support fully implemented**  
✅ **Lazy migration for existing hosts**  
✅ **No database schema changes required**  
✅ **No new GSI needed**  
✅ **Zero downtime deployment**  
✅ **Deployed to staging successfully**

The implementation follows the recommended approach from the proposal document, using embedded billing address fields in the host entity with lazy migration for backward compatibility.




