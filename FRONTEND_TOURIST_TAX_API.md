# Frontend Integration: Tourist Tax with Child Age Brackets

## Overview

The tourist tax system now supports **age-based child rates** instead of a single flat child rate. Hosts can configure multiple child tax rates with specific age ranges (0-17 years).

### Key Changes

- ✅ **Adults:** Single rate (unchanged)
- ✅ **Children:** Multiple age-based rates (0-17 years)
- ✅ **Inclusive Age Ranges:** `ageFrom: 0, ageTo: 7` includes ages 0, 1, 2, 3, 4, 5, 6, **and 7**
- ✅ **Conditional Validation:** Tourist tax is **required** when `taxesIncludedInPrice = false`, **optional** when `true`
- ✅ **Validation:** No overlaps, at least 1 child rate required (when tourist tax is provided)

---

## API Endpoints

### 1. Set/Update Pricing

**Endpoint:** `PUT /api/v1/hosts/{hostId}/listings/{listingId}/pricing`

**Request Body:**

```typescript
{
  currency: "EUR",
  basePrices: { /* ... */ },
  lengthOfStayDiscounts: [ /* ... */ ],
  taxesIncludedInPrice: boolean,     // Default: false
  touristTax?: {                     // REQUIRED if taxesIncludedInPrice = false
    type: "PER_NIGHT" | "PER_STAY",
    adultAmount: number,
    childRates: [
      {
        ageFrom: number,        // 0-16 (inclusive)
        ageTo: number,          // 1-17 (inclusive, must be > ageFrom)
        amount: number,         // Can be 0
        displayLabel: {
          en: string,           // "Children 0-7 years"
          sr: string            // "Deca 0-7 godina"
        }
      }
    ]
  }
}
```

**Example Request:**

```json
{
  "currency": "EUR",
  "basePrices": {
    "default": {
      "standardPrice": 100,
      "membersDiscount": null
    },
    "seasonal": []
  },
  "lengthOfStayDiscounts": [],
  "touristTax": {
    "type": "PER_NIGHT",
    "adultAmount": 2.5,
    "childRates": [
      {
        "ageFrom": 0,
        "ageTo": 7,
        "amount": 0,
        "displayLabel": {
          "en": "Children 0-7 years",
          "sr": "Deca 0-7 godina"
        }
      },
      {
        "ageFrom": 7,
        "ageTo": 13,
        "amount": 1.0,
        "displayLabel": {
          "en": "Children 7-12 years",
          "sr": "Deca 7-12 godina"
        }
      },
      {
        "ageFrom": 13,
        "ageTo": 18,
        "amount": 1.5,
        "displayLabel": {
          "en": "Youth 13-17 years",
          "sr": "Mladi 13-17 godina"
        }
      }
    ]
  }
}
```

**Response:** Same structure as request, plus `matrix` and metadata.

---

### 2. Get Pricing

**Endpoint:** `GET /api/v1/hosts/{hostId}/listings/{listingId}/pricing`

**Response:**

```typescript
{
  listingId: string,
  currency: string,
  configuration: {
    basePrice: { /* ... */ },
    seasonalPrices: [ /* ... */ ],
    lengthOfStayDiscounts: [ /* ... */ ],
    touristTax: {
      type: "PER_NIGHT" | "PER_STAY",
      adultAmount: number,
      childRates: [
        {
          childRateId: string,  // UUID (backend-generated)
          ageFrom: number,
          ageTo: number,
          amount: number,
          displayLabel: {
            en: string,
            sr: string
          }
        }
      ]
    }
  },
  matrix: { /* ... */ },
  lastUpdatedAt: string
}
```

---

### 3. Search Listings (Guest API)

**Endpoint:** `GET /api/v1/guest/search`

**Response includes tourist tax in pricing:**

```typescript
{
  listings: [
    {
      listingId: string,
      // ... other listing fields ...
      pricing: {
        currency: string,
        totalPrice: number,
        pricePerNight: number,
        breakdown: [...],
        lengthOfStayDiscount: {...} | null,
        membersPricingApplied: boolean,
        touristTax: {
          type: "PER_NIGHT" | "PER_STAY",
          adultAmount: number,
          childRates: [
            {
              childRateId: string,
              ageFrom: number,
              ageTo: number,
              amount: number,
              displayLabel: {
                en: string,
                sr: string
              }
            }
          ]
        } | null
      }
    }
  ]
}
```

**Note:** The search API returns the **full childRates array**, not a simplified version. This allows the frontend to display accurate tax information for different guest age configurations.

---

## TypeScript Types

### Request Types

```typescript
interface ChildTouristTaxRateInput {
  ageFrom: number; // 0-16
  ageTo: number; // 1-17 (must be > ageFrom)
  amount: number; // >= 0
  displayLabel: {
    en: string;
    sr: string;
  };
}

interface TouristTaxInput {
  type: "PER_NIGHT" | "PER_STAY";
  adultAmount: number;
  childRates: ChildTouristTaxRateInput[]; // At least 1 required
}
```

### Response Types

```typescript
interface ChildTouristTaxRate {
  childRateId: string; // UUID (backend-generated)
  ageFrom: number;
  ageTo: number;
  amount: number;
  displayLabel: {
    en: string;
    sr: string;
  };
}

interface TouristTax {
  type: "PER_NIGHT" | "PER_STAY";
  adultAmount: number;
  childRates: ChildTouristTaxRate[];
}
```

---

## Validation Rules

### Backend Validation

**Conditional Requirement:**

- When `taxesIncludedInPrice = false` (or not provided): Tourist tax configuration **IS REQUIRED**
- When `taxesIncludedInPrice = true`: Tourist tax is **OPTIONAL** (can be omitted entirely)

**When tourist tax IS provided, the backend enforces these rules:**

1. ✅ **At least 1 child rate required**
2. ✅ **Maximum 10 child rates**
3. ✅ **ageFrom:** 0-16 (inclusive)
4. ✅ **ageTo:** 1-17 (inclusive)
5. ✅ **ageTo must be > ageFrom** (minimum 1 year difference)
6. ✅ **amount:** Non-negative number
7. ✅ **No overlapping age ranges**
8. ✅ **Display labels required** (both `en` and `sr`)

### Frontend Validation (Recommended)

```typescript
function validateChildRate(rate: ChildTouristTaxRateInput): string | null {
  // Age range validation
  if (rate.ageFrom < 0 || rate.ageFrom > 16) {
    return "Age from must be between 0 and 16";
  }

  if (rate.ageTo < 1 || rate.ageTo > 17) {
    return "Age to must be between 1 and 17";
  }

  if (rate.ageTo <= rate.ageFrom) {
    return "Age to must be greater than age from";
  }

  // Amount validation
  if (rate.amount < 0) {
    return "Amount cannot be negative";
  }

  // Display label validation
  if (!rate.displayLabel.en?.trim() || !rate.displayLabel.sr?.trim()) {
    return "Display labels are required in both languages";
  }

  return null;
}

function validateChildRates(rates: ChildTouristTaxRateInput[]): string | null {
  if (rates.length === 0) {
    return "At least one child rate is required";
  }

  if (rates.length > 10) {
    return "Maximum 10 child rates allowed";
  }

  // Validate each rate
  for (let i = 0; i < rates.length; i++) {
    const error = validateChildRate(rates[i]);
    if (error) return `Rate ${i + 1}: ${error}`;
  }

  // Check for overlaps
  for (let i = 0; i < rates.length; i++) {
    for (let j = i + 1; j < rates.length; j++) {
      const rate1 = rates[i];
      const rate2 = rates[j];

      // Check if ranges overlap (inclusive)
      if (rate1.ageFrom <= rate2.ageTo && rate1.ageTo >= rate2.ageFrom) {
        return `Age ranges ${rate1.ageFrom}-${rate1.ageTo} and ${rate2.ageFrom}-${rate2.ageTo} overlap`;
      }
    }
  }

  return null;
}
```

---

## UI Components

### Age Range Selector

```typescript
interface AgeRangeSelectorProps {
  ageFrom: number;
  ageTo: number;
  onChange: (ageFrom: number, ageTo: number) => void;
}

function AgeRangeSelector({ ageFrom, ageTo, onChange }: AgeRangeSelectorProps) {
  return (
    <div className="flex gap-4 items-center">
      <div>
        <label>From Age</label>
        <select
          value={ageFrom}
          onChange={(e) => onChange(Number(e.target.value), ageTo)}
        >
          {Array.from({ length: 17 }, (_, i) => (
            <option key={i} value={i}>
              {i} years
            </option>
          ))}
        </select>
      </div>

      <span>to</span>

      <div>
        <label>To Age</label>
        <select
          value={ageTo}
          onChange={(e) => onChange(ageFrom, Number(e.target.value))}
        >
          {Array.from({ length: 17 }, (_, i) => i + 1)
            .filter((age) => age > ageFrom)
            .map((age) => (
              <option key={age} value={age}>
                {age} years
              </option>
            ))}
        </select>
      </div>
    </div>
  );
}
```

### Child Rate Form

```typescript
interface ChildRateFormProps {
  rate: ChildTouristTaxRateInput;
  onChange: (rate: ChildTouristTaxRateInput) => void;
  onRemove: () => void;
  language: "en" | "sr";
}

function ChildRateForm({
  rate,
  onChange,
  onRemove,
  language,
}: ChildRateFormProps) {
  return (
    <div className="border p-4 rounded-lg">
      <div className="flex justify-between items-start mb-4">
        <h4>Child Rate</h4>
        <button onClick={onRemove} className="text-red-600">
          Remove
        </button>
      </div>

      <AgeRangeSelector
        ageFrom={rate.ageFrom}
        ageTo={rate.ageTo}
        onChange={(ageFrom, ageTo) => {
          onChange({
            ...rate,
            ageFrom,
            ageTo,
            displayLabel: {
              en: `Children ${ageFrom}-${ageTo} years`,
              sr: `Deca ${ageFrom}-${ageTo} godina`,
            },
          });
        }}
      />

      <div className="mt-4">
        <label>Tax Amount</label>
        <input
          type="number"
          min="0"
          step="0.01"
          value={rate.amount}
          onChange={(e) =>
            onChange({ ...rate, amount: Number(e.target.value) })
          }
        />
      </div>

      <div className="mt-2 text-sm text-gray-600">
        Display: {rate.displayLabel[language]}
      </div>
    </div>
  );
}
```

### Complete Tourist Tax Form

```typescript
interface TouristTaxFormProps {
  value: TouristTaxInput | null;
  onChange: (value: TouristTaxInput | null) => void;
  currency: string;
  language: "en" | "sr";
}

function TouristTaxForm({
  value,
  onChange,
  currency,
  language,
}: TouristTaxFormProps) {
  const [enabled, setEnabled] = useState(!!value);

  const handleToggle = (checked: boolean) => {
    setEnabled(checked);
    if (checked) {
      // Initialize with default child rate (0-17 years)
      onChange({
        type: "PER_NIGHT",
        adultAmount: 0,
        childRates: [
          {
            ageFrom: 0,
            ageTo: 17,
            amount: 0,
            displayLabel: {
              en: "Children 0-17 years",
              sr: "Deca 0-17 godina",
            },
          },
        ],
      });
    } else {
      onChange(null);
    }
  };

  const addChildRate = () => {
    if (!value) return;

    // Find the next available age range
    const existingRanges = value.childRates.map((r) => ({
      from: r.ageFrom,
      to: r.ageTo,
    }));
    const sortedRanges = existingRanges.sort((a, b) => a.from - b.from);

    // Find first gap or add after last range
    let newAgeFrom = 0;
    let newAgeTo = 17;

    if (sortedRanges.length > 0) {
      const lastRange = sortedRanges[sortedRanges.length - 1];
      if (lastRange.to < 17) {
        newAgeFrom = lastRange.to;
        newAgeTo = 17;
      }
    }

    onChange({
      ...value,
      childRates: [
        ...value.childRates,
        {
          ageFrom: newAgeFrom,
          ageTo: newAgeTo,
          amount: 0,
          displayLabel: {
            en: `Children ${newAgeFrom}-${newAgeTo} years`,
            sr: `Deca ${newAgeFrom}-${newAgeTo} godina`,
          },
        },
      ],
    });
  };

  const removeChildRate = (index: number) => {
    if (!value) return;
    onChange({
      ...value,
      childRates: value.childRates.filter((_, i) => i !== index),
    });
  };

  const updateChildRate = (index: number, rate: ChildTouristTaxRateInput) => {
    if (!value) return;
    onChange({
      ...value,
      childRates: value.childRates.map((r, i) => (i === index ? rate : r)),
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => handleToggle(e.target.checked)}
        />
        <label>Enable Tourist Tax</label>
      </div>

      {enabled && value && (
        <>
          <div>
            <label>Tax Type</label>
            <select
              value={value.type}
              onChange={(e) =>
                onChange({ ...value, type: e.target.value as any })
              }
            >
              <option value="PER_NIGHT">Per Night</option>
              <option value="PER_STAY">Per Stay</option>
            </select>
          </div>

          <div>
            <label>Adult Amount ({currency})</label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={value.adultAmount}
              onChange={(e) =>
                onChange({ ...value, adultAmount: Number(e.target.value) })
              }
            />
          </div>

          <div>
            <div className="flex justify-between items-center mb-2">
              <label className="font-semibold">Child Rates</label>
              <button
                onClick={addChildRate}
                disabled={value.childRates.length >= 10}
                className="text-blue-600"
              >
                + Add Age Bracket
              </button>
            </div>

            <div className="space-y-3">
              {value.childRates.map((rate, index) => (
                <ChildRateForm
                  key={index}
                  rate={rate}
                  onChange={(updated) => updateChildRate(index, updated)}
                  onRemove={() => removeChildRate(index)}
                  language={language}
                />
              ))}
            </div>

            {value.childRates.length === 0 && (
              <p className="text-red-600 text-sm">
                At least one child rate is required
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
```

---

## Display in Booking Flow

### Calculate Total Tourist Tax

```typescript
interface Guest {
  age: number;
}

function calculateTouristTax(
  touristTax: TouristTax,
  guests: Guest[],
  nights: number
): number {
  let total = 0;

  for (const guest of guests) {
    if (guest.age >= 18) {
      // Adult
      total += touristTax.adultAmount;
    } else {
      // Child - find matching rate
      const matchingRate = touristTax.childRates.find(
        (rate) => guest.age >= rate.ageFrom && guest.age <= rate.ageTo
      );

      if (matchingRate) {
        total += matchingRate.amount;
      }
    }
  }

  // Multiply by nights if PER_NIGHT
  if (touristTax.type === "PER_NIGHT") {
    total *= nights;
  }

  return total;
}
```

### Display Tourist Tax Breakdown

```typescript
function TouristTaxBreakdown({
  touristTax,
  guests,
  nights,
  currency,
  language,
}: {
  touristTax: TouristTax;
  guests: Guest[];
  nights: number;
  currency: string;
  language: "en" | "sr";
}) {
  const adults = guests.filter((g) => g.age >= 18);
  const children = guests.filter((g) => g.age < 18);

  const adultTax = adults.length * touristTax.adultAmount;

  // Group children by rate
  const childrenByRate = new Map<
    string,
    { rate: ChildTouristTaxRate; count: number }
  >();

  for (const child of children) {
    const matchingRate = touristTax.childRates.find(
      (rate) => child.age >= rate.ageFrom && child.age <= rate.ageTo
    );

    if (matchingRate) {
      const key = matchingRate.childRateId;
      const existing = childrenByRate.get(key);
      if (existing) {
        existing.count++;
      } else {
        childrenByRate.set(key, { rate: matchingRate, count: 1 });
      }
    }
  }

  const childTax = Array.from(childrenByRate.values()).reduce(
    (sum, { rate, count }) => sum + rate.amount * count,
    0
  );

  const subtotal = adultTax + childTax;
  const total = touristTax.type === "PER_NIGHT" ? subtotal * nights : subtotal;

  return (
    <div className="border-t pt-4">
      <h4 className="font-semibold mb-2">
        Tourist Tax (
        {touristTax.type === "PER_NIGHT" ? "per night" : "per stay"})
      </h4>

      {adults.length > 0 && (
        <div className="flex justify-between text-sm">
          <span>
            {adults.length} adult(s) × {touristTax.adultAmount} {currency}
          </span>
          <span>
            {adultTax.toFixed(2)} {currency}
          </span>
        </div>
      )}

      {Array.from(childrenByRate.values()).map(({ rate, count }) => (
        <div key={rate.childRateId} className="flex justify-between text-sm">
          <span>
            {count} × {rate.displayLabel[language]} × {rate.amount} {currency}
          </span>
          <span>
            {(count * rate.amount).toFixed(2)} {currency}
          </span>
        </div>
      ))}

      {touristTax.type === "PER_NIGHT" && nights > 1 && (
        <div className="flex justify-between text-sm text-gray-600 mt-1">
          <span>× {nights} nights</span>
          <span></span>
        </div>
      )}

      <div className="flex justify-between font-semibold mt-2 pt-2 border-t">
        <span>Total Tourist Tax</span>
        <span>
          {total.toFixed(2)} {currency}
        </span>
      </div>
    </div>
  );
}
```

---

## Migration Notes

### Existing Data

Listings with the old `childAmount` field will be automatically migrated using the migration script:

```bash
TABLE_NAME=localstays-staging ts-node backend/services/migrations/migrate-tourist-tax-child-rates.ts
```

**Migration converts:**

- Old: `{ childAmount: 1.50 }`
- New: `{ childRates: [{ ageFrom: 0, ageTo: 17, amount: 1.50, ... }] }`

### Backward Compatibility

The backend maintains backward compatibility during migration:

- Old records with `childAmount` will be converted
- New records must use `childRates` array
- Frontend should always use `childRates` array

---

## Error Handling

### Common Validation Errors

```typescript
// Age range errors
"Child rate 1: ageFrom must be between 0 and 16";
"Child rate 2: ageTo must be between 1 and 17";
"Child rate 1: ageTo must be greater than ageFrom";

// Overlap errors
"Child rate 2: age range 7-13 overlaps with existing range 0-10";

// Count errors
"At least one child tax rate is required";
"Maximum 10 child rates allowed";

// Amount errors
"Child rate 1: amount must be a non-negative number";

// Label errors
"Child rate 1: displayLabel.en is required";
```

### Error Display

```typescript
function ErrorMessage({ error }: { error: string | null }) {
  if (!error) return null;

  return (
    <div className="bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded">
      <p className="text-sm">{error}</p>
    </div>
  );
}
```

---

## Testing Checklist

- [ ] Can add tourist tax with single child rate (0-17)
- [ ] Can add multiple child rates with different age brackets
- [ ] Age selectors properly restrict ranges (0-16 for from, 1-17 for to)
- [ ] Cannot create overlapping age ranges
- [ ] Display labels auto-generate correctly in both languages
- [ ] Can remove child rates (except last one)
- [ ] Validation errors display clearly
- [ ] Tourist tax calculates correctly in booking flow
- [ ] Breakdown shows correct amounts per age group
- [ ] PER_NIGHT vs PER_STAY calculation works correctly
- [ ] Migration script converts old childAmount successfully
- [ ] Can edit existing tourist tax configuration
- [ ] Can disable tourist tax entirely

---

## Questions?

Contact the backend team for:

- API endpoint issues
- Validation rule clarifications
- Migration support
- Database schema questions
