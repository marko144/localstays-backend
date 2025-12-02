# Billing Address - Frontend API Specification

## Overview

Hosts can now specify a separate billing address or indicate it's the same as their physical address.

---

## 1. Submit Profile Intent

**POST** `/api/v1/hosts/{hostId}/submit-intent`

### New Required Fields

```typescript
{
  "profile": {
    // ... existing fields ...
    "address": { ... },                           // Physical address
    "billingAddressSameAsPhysical": boolean,      // REQUIRED: true or false
    "billingAddress": Address | null,             // REQUIRED if flag is false, null if true
    // ... other fields ...
  }
}
```

### Examples

**Same billing address:**

```json
{
  "profile": {
    "address": { "addressLine1": "123 Main St", ... },
    "billingAddressSameAsPhysical": true,
    "billingAddress": null
  }
}
```

**Different billing address:**

```json
{
  "profile": {
    "address": { "addressLine1": "123 Main St", ... },
    "billingAddressSameAsPhysical": false,
    "billingAddress": { "addressLine1": "456 Business Ave", ... }
  }
}
```

### Validation

- `billingAddressSameAsPhysical`: Required boolean
- `billingAddress`:
  - If flag is `false`: Required, must be valid Address
  - If flag is `true`: Must be `null`

---

## 2. Get Host Profile (Host View)

**GET** `/api/v1/hosts/{hostId}/profile`

### Response

```typescript
{
  "hostId": "string",
  "hostType": "INDIVIDUAL" | "BUSINESS",
  "address": Address,
  "billingAddressSameAsPhysical": boolean,
  "billingAddress": Address | null,
  // ... other fields ...
}
```

### Example

```json
{
  "hostId": "host_123",
  "address": { "addressLine1": "123 Main St", ... },
  "billingAddressSameAsPhysical": false,
  "billingAddress": { "addressLine1": "456 Business Ave", ... }
}
```

---

## 3. Get Host Details (Admin View)

**GET** `/api/v1/admin/hosts/{hostId}`

### Response

```typescript
{
  "success": true,
  "data": {
    "hostId": "string",
    "address": Address,
    "billingAddressSameAsPhysical": boolean,
    "billingAddress": Address | null,
    // ... all other host fields ...
  }
}
```

---

## Frontend Implementation

### Form Component

```typescript
const [billingAddressSameAsPhysical, setBillingAddressSameAsPhysical] =
  useState(true);
const [billingAddress, setBillingAddress] = useState<Address | null>(null);

// Checkbox
<Checkbox
  checked={billingAddressSameAsPhysical}
  onChange={(e) => {
    setBillingAddressSameAsPhysical(e.target.checked);
    if (e.target.checked) setBillingAddress(null);
  }}
>
  Billing address is the same as my physical address
</Checkbox>;

// Conditional address form
{
  !billingAddressSameAsPhysical && (
    <AddressForm value={billingAddress} onChange={setBillingAddress} required />
  );
}
```

### Display Component (Host View)

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

### Display Component (Admin View)

```typescript
<Grid columns={2}>
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

### Client-Side

```typescript
function validateBillingAddress(data) {
  if (typeof data.billingAddressSameAsPhysical !== "boolean") {
    return "Billing address flag is required";
  }

  if (!data.billingAddressSameAsPhysical && !data.billingAddress) {
    return "Billing address is required when different from physical address";
  }

  if (data.billingAddressSameAsPhysical && data.billingAddress) {
    return "Billing address should not be provided when same as physical address";
  }

  if (data.billingAddress) {
    return validateAddress(data.billingAddress); // Use existing address validation
  }

  return null; // Valid
}
```

### Server-Side Errors

- `"Billing address flag is required"`
- `"Billing address is required when different from physical address"`
- `"Billing address should not be provided when same as physical address"`
- Standard address validation errors (e.g., "Address line 1 is required")

---

## Address Type

```typescript
interface Address {
  addressLine1: string; // Required, max 200 chars
  addressLine2: string | null; // Optional, max 200 chars
  locality: string; // Required, max 100 chars (City)
  administrativeArea: string; // Required, max 100 chars (State/Province)
  postalCode: string; // Required, max 20 chars
  countryCode: string; // Required, ISO-3166-1 alpha-2 (e.g., "RS", "GB")
}
```

---

## Notes

- Both `billingAddressSameAsPhysical` and `billingAddress` are now **required** in all profile submissions
- Existing hosts already have these fields set (migrated with `billingAddressSameAsPhysical: true`)
- The same validation applies to profile updates after rejection
