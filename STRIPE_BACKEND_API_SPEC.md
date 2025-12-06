# 🔥 Backend API Specification - Stripe Integration

## Overview
This document specifies the backend API endpoints required for Stripe subscription integration. The frontend will fetch pricing data and create checkout sessions through these endpoints.

---

## **Required Endpoints**

### **1. GET /api/stripe/prices**
Fetch all active subscription prices and products from Stripe.

#### **Authentication**
- Optional (public endpoint) OR
- Requires valid JWT/session token (your choice)

#### **Request**
```
GET /api/stripe/prices
```

No body required.

#### **Response (Success - 200)**
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

#### **Response (Error - 500)**
```json
{
  "success": false,
  "error": "Failed to fetch prices from Stripe"
}
```

#### **Implementation Pseudo-code**
```typescript
async function getPrices(req, res) {
  try {
    // Fetch all active prices with product data
    const prices = await stripe.prices.list({
      active: true,
      type: 'recurring',
      expand: ['data.product'],
      limit: 100
    });

    // Group by product and interval
    const grouped = groupPricesByProduct(prices.data);
    
    return res.json({ success: true, data: grouped });
  } catch (error) {
    console.error('Stripe prices fetch error:', error);
    return res.status(500).json({ 
      success: false, 
      error: 'Failed to fetch prices from Stripe' 
    });
  }
}

function groupPricesByProduct(prices) {
  const productMap = new Map();
  
  prices.forEach(price => {
    const product = price.product;
    
    if (!productMap.has(product.id)) {
      productMap.set(product.id, {
        product: {
          id: product.id,
          name: product.name,
          description: product.description,
          metadata: product.metadata
        },
        prices: {}
      });
    }
    
    const group = productMap.get(product.id);
    let key;
    
    // Determine interval key
    if (price.recurring.interval === 'month' && price.recurring.interval_count === 1) {
      key = 'monthly';
    } else if (price.recurring.interval === 'month' && price.recurring.interval_count === 3) {
      key = 'quarterly';
    } else if (price.recurring.interval === 'year' && price.recurring.interval_count === 1) {
      key = 'yearly';
    }
    
    if (key) {
      group.prices[key] = {
        id: price.id,
        amount: price.unit_amount,
        currency: price.currency,
        interval: price.recurring.interval,
        interval_count: price.recurring.interval_count
      };
    }
  });
  
  return Array.from(productMap.values());
}
```

---

### **2. POST /api/stripe/create-checkout-session**
Create a Stripe checkout session for subscription purchase.

#### **Authentication**
- **REQUIRED**: Valid JWT/session token
- Extract `hostId` and `email` from authenticated user

#### **Request**
```http
POST /api/stripe/create-checkout-session
Content-Type: application/json
Authorization: Bearer <JWT_TOKEN>

{
  "priceId": "price_1Saj0wPJx4Nm1hJJxxx"
}
```

#### **Request Body Schema**
```typescript
{
  priceId: string; // Stripe price ID (e.g., "price_xxx")
}
```

#### **Response (Success - 200)**
```json
{
  "success": true,
  "url": "https://checkout.stripe.com/c/pay/cs_test_xxx..."
}
```

#### **Response (Error - 400)**
```json
{
  "success": false,
  "error": "Invalid price ID" // or "Price ID required"
}
```

#### **Response (Error - 401)**
```json
{
  "success": false,
  "error": "Unauthorized"
}
```

#### **Response (Error - 500)**
```json
{
  "success": false,
  "error": "Failed to create checkout session"
}
```

#### **Implementation Pseudo-code**
```typescript
async function createCheckoutSession(req, res) {
  const { priceId } = req.body;
  const user = req.user; // From auth middleware
  
  // Validation
  if (!priceId) {
    return res.status(400).json({ 
      success: false, 
      error: 'Price ID required' 
    });
  }
  
  if (!user || !user.hostId || !user.email) {
    return res.status(401).json({ 
      success: false, 
      error: 'Unauthorized' 
    });
  }
  
  try {
    // Create Stripe checkout session
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{
        price: priceId,
        quantity: 1
      }],
      customer_email: user.email,
      client_reference_id: user.hostId, // CRITICAL: For webhook linking
      success_url: `${process.env.FRONTEND_URL}/sr/subscription-success`,
      cancel_url: `${process.env.FRONTEND_URL}/sr/plans`,
      metadata: {
        hostId: user.hostId
      }
    });
    
    return res.json({ 
      success: true, 
      url: session.url 
    });
    
  } catch (error) {
    console.error('Stripe checkout error:', error);
    return res.status(500).json({ 
      success: false, 
      error: 'Failed to create checkout session' 
    });
  }
}
```

---

## **Environment Variables Required**

```bash
# Stripe Configuration
STRIPE_SECRET_KEY=sk_test_51SaiN1PJx4Nm1hJJ...  # Stripe secret key (NEVER expose to frontend)

# Frontend URL (for redirect URLs)
FRONTEND_URL=http://localhost:3000  # Development
# FRONTEND_URL=https://yourdomain.com  # Production
```

---

## **Security Requirements**

### **Endpoint 1: GET /api/stripe/prices**
- ✅ Can be public OR authenticated (your choice)
- ✅ Only returns public pricing data (safe to expose)
- ✅ No sensitive information leaked

### **Endpoint 2: POST /api/stripe/create-checkout-session**
- ✅ **MUST** be authenticated
- ✅ Validate `priceId` exists in Stripe before creating session (optional but recommended)
- ✅ Validate `hostId` belongs to authenticated user
- ✅ Never expose `STRIPE_SECRET_KEY` to frontend
- ✅ Use HTTPS in production

---

## **Webhook Handling**

Your webhook should already handle the `checkout.session.completed` event to link the Stripe customer to the host.

### **Expected Webhook Event Structure**
```json
{
  "type": "checkout.session.completed",
  "data": {
    "object": {
      "id": "cs_test_xxx",
      "customer": "cus_xxx",
      "customer_email": "user@example.com",
      "client_reference_id": "host_abc123",
      "metadata": {
        "hostId": "host_abc123"
      },
      "subscription": "sub_xxx"
    }
  }
}
```

### **Webhook Handler Pseudo-code**
```typescript
async function handleWebhook(req, res) {
  const event = req.body;
  
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const hostId = session.client_reference_id; // "host_abc123"
    const stripeCustomerId = session.customer; // "cus_xyz"
    const email = session.customer_email;
    
    // Validate: Does this email match the hostId in your DB?
    const host = await db.hosts.findOne({ hostId });
    if (host.email !== email) {
      console.error('Email mismatch for hostId:', hostId);
      return res.status(400).json({ error: 'Email mismatch' });
    }
    
    // Save Stripe customer ID to your database
    await db.hosts.update(
      { hostId },
      { stripeCustomerId }
    );
    
    console.log(`Linked Stripe customer ${stripeCustomerId} to host ${hostId}`);
  }
  
  res.json({ received: true });
}
```

---

## **Testing**

### **Test Endpoint 1: Fetch Prices**
```bash
# Public endpoint (if not authenticated)
curl http://localhost:YOUR_PORT/api/stripe/prices

# Authenticated endpoint (if required)
curl http://localhost:YOUR_PORT/api/stripe/prices \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

**Expected Response:**
```json
{
  "success": true,
  "data": [
    {
      "product": { "id": "prod_xxx", "name": "Basic Plan", ... },
      "prices": {
        "monthly": { "id": "price_xxx", "amount": 1299, ... }
      }
    }
  ]
}
```

---

### **Test Endpoint 2: Create Checkout Session**
```bash
curl -X POST http://localhost:YOUR_PORT/api/stripe/create-checkout-session \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{"priceId": "price_1Saj0wPJx4Nm1hJJxxx"}'
```

**Expected Response:**
```json
{
  "success": true,
  "url": "https://checkout.stripe.com/c/pay/cs_test_xxx..."
}
```

---

### **Test Stripe Checkout Flow**
1. Call endpoint 2 to get checkout URL
2. Open the URL in browser
3. Use test card: `4242 4242 4242 4242`
4. Any future expiry date, any CVC
5. Complete checkout
6. Should redirect to: `http://localhost:3000/sr/subscription-success`
7. Check webhook logs for `checkout.session.completed` event
8. Verify `client_reference_id` contains correct hostId

---

## **Product Metadata Format**

To display features in the pricing cards, add this metadata to your Stripe products:

**In Stripe Dashboard:**
1. Go to: Products → Edit Product → Metadata
2. Add key: `features`
3. Add value (JSON array as string):
   ```json
   ["Unlimited listings", "Priority support", "Analytics dashboard", "Custom branding"]
   ```

**Example:**
```json
{
  "features": "[\"1 listing\", \"Basic support\", \"Monthly billing\"]"
}
```

The frontend will parse this and display as bullet points.

---

## **Estimated Implementation Time**

| Task | Time |
|------|------|
| Endpoint 1: GET /api/stripe/prices | ~20 minutes |
| Endpoint 2: POST /api/stripe/create-checkout-session | ~15 minutes |
| Testing both endpoints | ~10 minutes |
| **Total** | **~45 minutes** |

---

## **Dependencies**

### **Node.js (Stripe SDK)**
```bash
npm install stripe
```

```typescript
import Stripe from 'stripe';
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2024-11-20.acacia'
});
```

---

## **Questions?**

If anything is unclear or you need clarification on any part of this spec, please ask!

---

## **Frontend Integration**

Once these endpoints are implemented, the frontend will:
1. Call `GET /api/stripe/prices` to fetch pricing data
2. Display pricing cards with interval switcher
3. When user clicks "Subscribe", call `POST /api/stripe/create-checkout-session`
4. Redirect user to the returned Stripe checkout URL
5. After payment, Stripe redirects to `/sr/subscription-success`
6. User is redirected to dashboard with updated subscription

---

**End of Specification**

