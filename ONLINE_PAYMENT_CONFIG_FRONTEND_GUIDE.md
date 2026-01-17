# Online Payment Configuration - Frontend Implementation Guide

## Overview

When a host selects **LOKALSTAYS_ONLINE** as one of their payment types, they must also configure how online payments work for their listing. This allows hosts to specify:

1. **Full Payment** - Guests pay 100% of the booking total online
2. **Deposit** - Guests pay a percentage (1-70%) upfront, with the remainder due later

Hosts can enable one or both options.

---

## Data Model

### `onlinePaymentConfig` Object

```typescript
interface OnlinePaymentConfig {
  allowFullPayment: boolean;      // Host accepts full payment online
  allowDeposit: boolean;          // Host accepts deposit payment
  depositPercentage?: number;     // 1-70%, required if allowDeposit is true
}
```

### Validation Rules

| Rule | Description |
|------|-------------|
| **Required when** | `paymentTypes` array includes `LOKALSTAYS_ONLINE` |
| **At least one option** | Either `allowFullPayment` OR `allowDeposit` must be `true` |
| **Deposit percentage** | Required when `allowDeposit: true`, must be integer 1-70 |
| **Auto-removal** | Config is automatically cleared if `LOKALSTAYS_ONLINE` is removed from `paymentTypes` |

---

## UI/UX Recommendations

### During Listing Creation (`submit-intent`)

When the user selects `LOKALSTAYS_ONLINE` from the payment types:

1. **Show additional configuration section** immediately below the payment type selection
2. **Two checkboxes** (at least one required):
   - ☑️ "Allow full payment online" (`allowFullPayment`)
   - ☑️ "Allow deposit payment" (`allowDeposit`)
3. **Deposit percentage input** (shown when "Allow deposit payment" is checked):
   - Number input or slider
   - Range: 1-70%
   - Default suggestion: 50%
   - Label: "Deposit percentage" / "Procenat depozita"

### Visual Example (Wireframe)

```
┌─────────────────────────────────────────────────────────────┐
│ Payment Options                                             │
├─────────────────────────────────────────────────────────────┤
│ ☐ Pay Later (cash or card on arrival)                      │
│ ☐ Pay Later (cash only)                                    │
│ ☑ LokalStays Online Payment                                │
│                                                             │
│   ┌─────────────────────────────────────────────────────┐  │
│   │ Online Payment Settings                              │  │
│   │                                                      │  │
│   │ ☑ Allow full payment online                         │  │
│   │ ☑ Allow deposit payment                             │  │
│   │                                                      │  │
│   │   Deposit percentage: [50] %                        │  │
│   │   ────────────●──────────                           │  │
│   │   1%                                           70%  │  │
│   └─────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

---

## API Integration

### Submit Intent (Create Listing)

**Endpoint:** `POST /api/v1/hosts/{hostId}/listings/submit-intent`

**Request Body (relevant fields):**

```json
{
  "paymentTypes": ["PAY_LATER", "LOKALSTAYS_ONLINE"],
  "onlinePaymentConfig": {
    "allowFullPayment": true,
    "allowDeposit": true,
    "depositPercentage": 50
  }
}
```

### Update Listing

**Endpoint:** `PUT /api/v1/hosts/{hostId}/listings/{listingId}/update`

**Request Body:**

```json
{
  "updates": {
    "paymentTypes": ["LOKALSTAYS_ONLINE"],
    "onlinePaymentConfig": {
      "allowFullPayment": false,
      "allowDeposit": true,
      "depositPercentage": 30
    }
  }
}
```

**Note:** If you update `paymentTypes` to remove `LOKALSTAYS_ONLINE`, the backend will automatically set `onlinePaymentConfig` to `null`.

### Get Listing

**Endpoint:** `GET /api/v1/hosts/{hostId}/listings/{listingId}`

**Response (relevant fields):**

```json
{
  "listing": {
    "paymentTypes": [
      { "key": "LOKALSTAYS_ONLINE", "en": "LokalStays Online Payment", "sr": "LokalStays Online Naplata" }
    ],
    "onlinePaymentConfig": {
      "allowFullPayment": true,
      "allowDeposit": true,
      "depositPercentage": 50
    }
  }
}
```

---

## Error Handling

### Validation Errors (400 Bad Request)

| Error Message | Cause |
|---------------|-------|
| `onlinePaymentConfig can only be provided when LOKALSTAYS_ONLINE is in paymentTypes` | Config provided but `LOKALSTAYS_ONLINE` not in `paymentTypes` |
| `onlinePaymentConfig is required when LOKALSTAYS_ONLINE is in paymentTypes` | `LOKALSTAYS_ONLINE` selected but no config provided |
| `At least one of allowFullPayment or allowDeposit must be true` | Both options set to `false` |
| `depositPercentage is required when allowDeposit is true` | Deposit enabled but no percentage |
| `depositPercentage must be an integer between 1 and 70` | Invalid percentage value |

---

## Bilingual Labels

| Field | English | Serbian |
|-------|---------|---------|
| Section title | Online Payment Settings | Podešavanja Online Plaćanja |
| Full payment checkbox | Allow full payment online | Dozvoli plaćanje u celosti online |
| Deposit checkbox | Allow deposit payment | Dozvoli plaćanje depozita |
| Deposit percentage label | Deposit percentage | Procenat depozita |
| Percentage suffix | % | % |

---

## State Management

### Form State

```typescript
interface ListingFormState {
  paymentTypes: PaymentType[];
  onlinePaymentConfig: {
    allowFullPayment: boolean;
    allowDeposit: boolean;
    depositPercentage: number;
  } | null;
}

// Show config section only when LOKALSTAYS_ONLINE is selected
const showOnlinePaymentConfig = paymentTypes.includes('LOKALSTAYS_ONLINE');

// Initialize with defaults when LOKALSTAYS_ONLINE is first selected
const defaultConfig = {
  allowFullPayment: true,
  allowDeposit: true,
  depositPercentage: 50,
};
```

### Conditional Rendering Logic

```typescript
// When LOKALSTAYS_ONLINE is added to paymentTypes
if (newPaymentTypes.includes('LOKALSTAYS_ONLINE') && !onlinePaymentConfig) {
  setOnlinePaymentConfig(defaultConfig);
}

// When LOKALSTAYS_ONLINE is removed from paymentTypes
if (!newPaymentTypes.includes('LOKALSTAYS_ONLINE') && onlinePaymentConfig) {
  setOnlinePaymentConfig(null);
}
```

---

## Testing Checklist

- [ ] Config section appears when `LOKALSTAYS_ONLINE` is selected
- [ ] Config section hides when `LOKALSTAYS_ONLINE` is deselected
- [ ] At least one checkbox must be selected (show error if both unchecked)
- [ ] Deposit percentage input only shows when "Allow deposit" is checked
- [ ] Deposit percentage validates 1-70 range
- [ ] Form submits successfully with valid config
- [ ] Form shows validation errors for invalid config
- [ ] Edit listing displays existing config correctly
- [ ] Edit listing can modify config
- [ ] Removing `LOKALSTAYS_ONLINE` clears the config

---

## Migration Notes

Existing listings with `LOKALSTAYS_ONLINE` have been migrated with the following default configuration:

```json
{
  "allowFullPayment": true,
  "allowDeposit": true,
  "depositPercentage": 50
}
```

Hosts can modify these settings at any time via the listing update flow.

