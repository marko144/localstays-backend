# Stripe Frontend Integration Guide

## Overview

This guide explains how to integrate the Stripe subscription flow into the LocalStays frontend. The backend provides two endpoints for fetching pricing data and creating checkout sessions.

---

## API Endpoints

### Base URL (Staging)

```
https://k27ar3e32j.execute-api.eu-north-1.amazonaws.com/staging
```

---

## 1. Fetch Subscription Prices

Fetches all active subscription products and their prices from Stripe.

### Request

```http
GET /api/v1/hosts/{hostId}/stripe/prices
Authorization: Bearer <JWT_TOKEN>
```

### Response (200 OK)

```json
{
  "success": true,
  "data": [
    {
      "product": {
        "id": "prod_xxx",
        "name": "Basic Plan",
        "description": "Perfect for getting started",
        "metadata": {
          "features": "[\"1 listing\", \"Basic support\", \"Monthly billing\"]"
        }
      },
      "prices": {
        "monthly": {
          "id": "price_monthly_xxx",
          "amount": 1299,
          "currency": "eur",
          "interval": "month",
          "interval_count": 1
        },
        "quarterly": {
          "id": "price_quarterly_xxx",
          "amount": 3499,
          "currency": "eur",
          "interval": "month",
          "interval_count": 3
        },
        "yearly": {
          "id": "price_yearly_xxx",
          "amount": 12999,
          "currency": "eur",
          "interval": "year",
          "interval_count": 1
        }
      }
    }
  ]
}
```

### Notes

- `amount` is in **cents** (e.g., 1299 = €12.99)
- `metadata.features` is a JSON string array - parse it to display as bullet points
- Not all products will have all price intervals (monthly/quarterly/yearly)
- Products are sorted alphabetically by name

### Example: Parsing Features

```typescript
const features = JSON.parse(product.metadata.features || "[]");
// ["1 listing", "Basic support", "Monthly billing"]
```

### Example: Formatting Price

```typescript
const formatPrice = (amount: number, currency: string) => {
  return new Intl.NumberFormat("en-EU", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(amount / 100);
};

// formatPrice(1299, 'eur') => "€12.99"
```

---

## 2. Create Checkout Session

Creates a Stripe Checkout session for a new subscription purchase.

### Request

```http
POST /api/v1/hosts/{hostId}/stripe/checkout-session
Authorization: Bearer <JWT_TOKEN>
Content-Type: application/json

{
  "priceId": "price_xxx"
}
```

### Response (200 OK)

```json
{
  "success": true,
  "url": "https://checkout.stripe.com/c/pay/cs_test_xxx..."
}
```

### Error Responses

**400 Bad Request** - Missing or invalid price ID

```json
{
  "success": false,
  "error": "Price ID required"
}
```

**403 Forbidden** - Not authorized

```json
{
  "success": false,
  "error": "Forbidden"
}
```

**404 Not Found** - Host not found

```json
{
  "success": false,
  "error": "Host not found"
}
```

---

## Frontend Flow

### 1. Display Pricing Page

```tsx
// 1. Fetch prices on page load
const [products, setProducts] = useState([]);
const [billingInterval, setBillingInterval] = useState("monthly");

useEffect(() => {
  const fetchPrices = async () => {
    const response = await fetch(`/api/v1/hosts/${hostId}/stripe/prices`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await response.json();
    if (data.success) {
      setProducts(data.data);
    }
  };
  fetchPrices();
}, [hostId]);

// 2. Display interval switcher (Monthly / Quarterly / Yearly)
<IntervalSwitcher value={billingInterval} onChange={setBillingInterval} />;

// 3. Display pricing cards
{
  products.map((product) => (
    <PricingCard
      key={product.product.id}
      name={product.product.name}
      description={product.product.description}
      features={JSON.parse(product.product.metadata.features || "[]")}
      price={product.prices[billingInterval]}
      onSubscribe={() => handleSubscribe(product.prices[billingInterval].id)}
    />
  ));
}
```

### 2. Handle Subscribe Button Click

```tsx
const handleSubscribe = async (priceId: string) => {
  setLoading(true);

  try {
    const response = await fetch(
      `/api/v1/hosts/${hostId}/stripe/checkout-session`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ priceId }),
      }
    );

    const data = await response.json();

    if (data.success && data.url) {
      // Redirect to Stripe Checkout
      window.location.href = data.url;
    } else {
      // Show error
      toast.error(data.error || "Failed to start checkout");
    }
  } catch (error) {
    toast.error("Something went wrong");
  } finally {
    setLoading(false);
  }
};
```

### 3. Handle Success/Cancel Redirects

After checkout, Stripe redirects the user to:

| Outcome | Redirect URL                                                                     |
| ------- | -------------------------------------------------------------------------------- |
| Success | `http://localhost:3000/sr/subscription-success?session_id={CHECKOUT_SESSION_ID}` |
| Cancel  | `http://localhost:3000/sr/plans`                                                 |

#### Success Page (`/sr/subscription-success`)

```tsx
// pages/sr/subscription-success.tsx
export default function SubscriptionSuccess() {
  const searchParams = useSearchParams();
  const sessionId = searchParams.get("session_id");

  // Optional: Verify the session or just show success message
  // The backend webhook has already processed the subscription

  return (
    <div>
      <h1>🎉 Subscription Successful!</h1>
      <p>Thank you for subscribing. Your account has been upgraded.</p>
      <Link href="/dashboard">Go to Dashboard</Link>
    </div>
  );
}
```

#### Cancel Page (`/sr/plans`)

Just show the pricing page again - the user can try again or choose a different plan.

---

## Managing Existing Subscriptions

For users who already have a subscription, use the **Customer Portal** endpoint:

### Request

```http
POST /api/v1/hosts/{hostId}/subscription/customer-portal
Authorization: Bearer <JWT_TOKEN>
Content-Type: application/json

{
  "returnUrl": "http://localhost:3000/subscription"  // Optional
}
```

### Response (200 OK)

```json
{
  "success": true,
  "data": {
    "url": "https://billing.stripe.com/session/..."
  }
}
```

### Usage

```tsx
const handleManageSubscription = async () => {
  const response = await fetch(
    `/api/v1/hosts/${hostId}/subscription/customer-portal`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        returnUrl: window.location.href,
      }),
    }
  );

  const data = await response.json();

  if (data.success) {
    window.location.href = data.data.url;
  }
};
```

The Customer Portal allows users to:

- View current subscription
- Upgrade/downgrade plan
- Update payment method
- View billing history
- Cancel subscription

---

## Complete User Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                    NEW USER SUBSCRIPTION FLOW                    │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. User visits /sr/plans                                        │
│     └─> Frontend calls GET /stripe/prices                        │
│     └─> Display pricing cards with interval switcher             │
│                                                                  │
│  2. User clicks "Subscribe" on a plan                            │
│     └─> Frontend calls POST /stripe/checkout-session             │
│     └─> Redirect to Stripe Checkout URL                          │
│                                                                  │
│  3. User completes payment on Stripe                             │
│     └─> Stripe redirects to /sr/subscription-success             │
│     └─> Backend webhook creates subscription record              │
│                                                                  │
│  4. User is now subscribed!                                      │
│     └─> Can publish listings using their tokens                  │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                 EXISTING USER MANAGEMENT FLOW                    │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. User clicks "Manage Subscription"                            │
│     └─> Frontend calls POST /subscription/customer-portal        │
│     └─> Redirect to Stripe Customer Portal URL                   │
│                                                                  │
│  2. User makes changes in Stripe Portal                          │
│     └─> Stripe webhooks update backend subscription record       │
│                                                                  │
│  3. User clicks "Return" in portal                               │
│     └─> Redirects back to returnUrl                              │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Testing

### Test Card Numbers (Stripe Test Mode)

| Card Number           | Description                       |
| --------------------- | --------------------------------- |
| `4242 4242 4242 4242` | Successful payment                |
| `4000 0000 0000 3220` | 3D Secure authentication required |
| `4000 0000 0000 9995` | Payment declined                  |

Use any future expiry date and any 3-digit CVC.

### Test Flow

1. Log in as a host without a subscription
2. Navigate to pricing page
3. Select a plan and click Subscribe
4. Complete checkout with test card `4242 4242 4242 4242`
5. Verify redirect to success page
6. Check that subscription is now active via `GET /subscription`

---

## TypeScript Types

```typescript
interface StripePrice {
  id: string;
  amount: number;
  currency: string;
  interval: "month" | "year";
  interval_count: number;
}

interface StripeProduct {
  id: string;
  name: string;
  description: string | null;
  metadata: {
    features?: string; // JSON array string
    [key: string]: string | undefined;
  };
}

interface ProductWithPrices {
  product: StripeProduct;
  prices: {
    monthly?: StripePrice;
    quarterly?: StripePrice;
    yearly?: StripePrice;
  };
}

interface GetPricesResponse {
  success: boolean;
  data?: ProductWithPrices[];
  error?: string;
}

interface CreateCheckoutSessionResponse {
  success: boolean;
  url?: string;
  error?: string;
}

interface CustomerPortalResponse {
  success: boolean;
  data?: {
    url: string;
  };
  error?: string;
}
```

---

## Questions?

Contact the backend team if you need:

- Different redirect URLs
- Additional metadata on products
- Changes to the response format
- Help with testing
