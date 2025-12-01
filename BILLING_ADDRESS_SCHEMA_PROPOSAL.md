# Billing Address Schema Proposal

## Current State

### Existing Host Schema

```typescript
export interface BaseHost {
  pk: string; // HOST#<hostId>
  sk: "META";
  hostId: string;
  // ... other fields ...
  address: Address; // Currently: primary/physical address
  // ... other fields ...
}

export interface Address {
  addressLine1: string;
  addressLine2: string | null;
  locality: string; // City
  administrativeArea: string; // State/Province
  postalCode: string;
  countryCode: string; // ISO-3166-1 alpha-2
}
```

### Current Access Pattern

- **PK**: `HOST#<hostId>`
- **SK**: `META`
- **Query**: Direct GetItem - no scanning required ✅

---

## Proposed Solution

### Option 1: Embedded Billing Address (RECOMMENDED) ⭐

Add billing address fields directly to the Host entity with a flag to indicate if it's the same as the primary address.

#### Schema Changes

```typescript
export interface BaseHost {
  pk: string; // HOST#<hostId>
  sk: "META";
  hostId: string;
  // ... existing fields ...

  // Primary/Physical Address
  address: Address;

  // Billing Address Configuration
  billingAddressSameAsPhysical: boolean; // Default: true
  billingAddress: Address | null; // null if billingAddressSameAsPhysical = true

  // ... other fields ...
}
```

#### Benefits

✅ **No scanning required** - single GetItem retrieves everything  
✅ **Simple to query** - all data in one record  
✅ **Atomic updates** - billing address updated with host profile  
✅ **No additional GSI needed**  
✅ **Minimal code changes** - just add fields to existing entity  
✅ **Efficient storage** - billing address only stored when different

#### DynamoDB Item Example

**Case 1: Billing address same as physical**

```json
{
  "pk": "HOST#host_123",
  "sk": "META",
  "hostId": "host_123",
  "address": {
    "addressLine1": "123 Main St",
    "addressLine2": null,
    "locality": "Belgrade",
    "administrativeArea": "Belgrade",
    "postalCode": "11000",
    "countryCode": "RS"
  },
  "billingAddressSameAsPhysical": true,
  "billingAddress": null
}
```

**Case 2: Different billing address**

```json
{
  "pk": "HOST#host_123",
  "sk": "META",
  "hostId": "host_123",
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
  }
}
```

#### Access Patterns

All existing access patterns remain unchanged:

1. **Get host profile** (Host API):

   ```typescript
   GetItem(pk: "HOST#<hostId>", sk: "META")
   // Returns: address, billingAddressSameAsPhysical, billingAddress
   ```

2. **Get host profile** (Admin API):

   ```typescript
   GetItem(pk: "HOST#<hostId>", sk: "META")
   // Returns: address, billingAddressSameAsPhysical, billingAddress
   ```

3. **Update host profile**:
   ```typescript
   UpdateItem(pk: "HOST#<hostId>", sk: "META")
   // Update: billingAddressSameAsPhysical and/or billingAddress
   ```

**No scanning required** ✅

---

### Option 2: Separate Billing Address Item (NOT RECOMMENDED) ❌

Store billing address as a separate DynamoDB item.

#### Schema

```typescript
{
  pk: "HOST#<hostId>",
  sk: "BILLING_ADDRESS",
  hostId: string,
  billingAddressSameAsPhysical: boolean,
  billingAddress: Address | null,
  createdAt: string,
  updatedAt: string
}
```

#### Why NOT Recommended

❌ Requires **two GetItem calls** to fetch complete profile  
❌ More complex code - need to handle missing billing address item  
❌ Potential consistency issues - two separate updates  
❌ Increased latency - multiple DynamoDB calls  
❌ Higher costs - double the read capacity units  
❌ No real benefit over embedded approach

---

## Implementation Plan

### 1. Type Definitions Update

**File**: `backend/services/types/host.types.ts`

```typescript
export interface BaseHost {
  // ... existing fields ...
  address: Address;

  // NEW: Billing address fields
  billingAddressSameAsPhysical: boolean;
  billingAddress: Address | null;

  // ... existing fields ...
}

export interface IndividualProfileData {
  hostType: "INDIVIDUAL";
  // ... existing fields ...
  address: Address;

  // NEW: Billing address fields
  billingAddressSameAsPhysical: boolean;
  billingAddress?: Address | null; // Optional in submission

  // ... existing fields ...
}

export interface BusinessProfileData {
  hostType: "BUSINESS";
  // ... existing fields ...
  address: Address;

  // NEW: Billing address fields
  billingAddressSameAsPhysical: boolean;
  billingAddress?: Address | null; // Optional in submission

  // ... existing fields ...
}
```

### 2. API Endpoints to Update

#### Host API (for hosts to manage their own profile)

**A. Submit Intent** (`backend/services/api/hosts/submit-intent.ts`)

- Add validation for `billingAddressSameAsPhysical` (required boolean)
- Add validation for `billingAddress` (required if flag is false)
- Store both fields in DynamoDB

**B. Get Profile** (`backend/services/api/hosts/get-profile.ts`)

- Return `billingAddressSameAsPhysical` and `billingAddress` in response
- If flag is true, frontend can display physical address as billing address

**C. Update Profile** (if exists - need to check)

- Allow updating billing address fields

#### Admin API (for admins to view host profiles)

**D. Get Host** (`backend/services/api/admin/hosts/get-host.ts`)

- Return `billingAddressSameAsPhysical` and `billingAddress` in response
- Admin can see both physical and billing addresses

**E. List Hosts** (`backend/services/api/admin/hosts/list-hosts.ts`)

- No changes needed (summary view doesn't need billing address)

### 3. Validation Rules

```typescript
// In profile-validation.ts or similar

function validateBillingAddress(data: ProfileData): ValidationError[] {
  const errors: ValidationError[] = [];

  // billingAddressSameAsPhysical is required
  if (typeof data.billingAddressSameAsPhysical !== "boolean") {
    errors.push({
      field: "billingAddressSameAsPhysical",
      message: "Billing address flag is required",
    });
  }

  // If flag is false, billingAddress must be provided
  if (data.billingAddressSameAsPhysical === false) {
    if (!data.billingAddress) {
      errors.push({
        field: "billingAddress",
        message:
          "Billing address is required when different from physical address",
      });
    } else {
      // Validate billing address structure (same as physical address validation)
      errors.push(...validateAddress(data.billingAddress, "billingAddress"));
    }
  }

  // If flag is true, billingAddress should be null/undefined
  if (data.billingAddressSameAsPhysical === true && data.billingAddress) {
    errors.push({
      field: "billingAddress",
      message:
        "Billing address should not be provided when same as physical address",
    });
  }

  return errors;
}
```

### 4. Migration Strategy

#### For Existing Hosts

**Option A: Lazy Migration (RECOMMENDED)**

- Set default values when host record is read:

  ```typescript
  const host = result.Item as Host;

  // Set defaults for existing records without billing address fields
  if (host.billingAddressSameAsPhysical === undefined) {
    host.billingAddressSameAsPhysical = true;
    host.billingAddress = null;
  }
  ```

**Option B: Batch Migration Script**

- Create a migration script to update all existing host records:
  ```typescript
  // Scan all hosts and update with default values
  UpdateCommand({
    Key: { pk: "HOST#<hostId>", sk: "META" },
    UpdateExpression:
      "SET billingAddressSameAsPhysical = :flag, billingAddress = :addr",
    ExpressionAttributeValues: {
      ":flag": true,
      ":addr": null,
    },
  });
  ```

**Recommendation**: Use **Option A (Lazy Migration)** initially, then run a batch migration script during low-traffic hours if needed.

### 5. Frontend Changes Required

#### Host Profile Form

1. Add checkbox: "Billing address is the same as my physical address"
2. If unchecked, show billing address form fields (same structure as physical address)
3. Submit both `billingAddressSameAsPhysical` and `billingAddress` (if different)

#### Host Profile Display

1. Show physical address section
2. Show billing address section:
   - If `billingAddressSameAsPhysical` is true: display "Same as physical address"
   - If false: display the separate billing address

#### Admin Host Profile View

1. Display both addresses clearly labeled
2. Show indicator if they're the same

### 6. API Response Examples

#### Host API - Get Profile Response

```json
{
  "hostId": "host_123",
  "hostType": "BUSINESS",
  "email": "business@example.com",
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
  "legalName": "Example Business Ltd",
  "registrationNumber": "12345678",
  "vatRegistered": true,
  "vatNumber": "RS123456789"
}
```

#### Host API - Submit Intent Request

```json
{
  "hostType": "BUSINESS",
  "email": "business@example.com",
  "phone": "+381601234567",
  "preferredLanguage": "sr-RS",
  "countryCode": "RS",
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
  "legalName": "Example Business Ltd",
  "registrationNumber": "12345678",
  "vatRegistered": true,
  "vatNumber": "RS123456789",
  "profilePhoto": { ... },
  "documents": [ ... ]
}
```

---

## Summary

### Recommended Approach: **Option 1 - Embedded Billing Address**

**Why?**

- ✅ No scanning required - single GetItem
- ✅ Atomic updates
- ✅ Simple implementation
- ✅ No additional GSI needed
- ✅ Efficient storage
- ✅ Minimal code changes

**Storage Impact**:

- Adds ~200-300 bytes per host (only when billing address differs)
- Negligible cost increase
- No additional read/write capacity needed

**Performance Impact**:

- Zero - same number of DynamoDB operations
- No additional latency

**Implementation Effort**:

- Low - just add fields to existing entity
- Update 3-4 API endpoints
- Add validation logic
- Update frontend forms

---

## Next Steps

1. ✅ Review and approve this proposal
2. Update type definitions
3. Update validation logic
4. Update API endpoints (submit-intent, get-profile, admin get-host)
5. Test with sample data
6. Deploy to staging
7. Provide frontend API specification
8. Consider lazy migration vs batch migration for existing hosts




