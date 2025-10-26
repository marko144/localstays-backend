# Subscription API Documentation

## Overview

The Subscription API allows hosts to retrieve their subscription plan details and entitlements. This is used to enforce listing limits and display subscription information in the frontend.

---

## Endpoint

### Get Host Subscription

Retrieves the subscription details and entitlements for a specific host.

**Endpoint:** `GET /api/v1/hosts/{hostId}/subscription`

**Authentication:** Required (Cognito JWT token)

**Authorization:**

- Hosts can only access their own subscription
- Admins can access any host's subscription

---

## Request

### Path Parameters

| Parameter | Type   | Required | Description                                                                            |
| --------- | ------ | -------- | -------------------------------------------------------------------------------------- |
| `hostId`  | string | Yes      | The unique identifier for the host (e.g., `host_5fd9e097-81bd-4bcd-a612-0a8a8993e657`) |

### Headers

| Header          | Value              | Required | Description                   |
| --------------- | ------------------ | -------- | ----------------------------- |
| `Authorization` | `Bearer <token>`   | Yes      | Cognito JWT access token      |
| `Content-Type`  | `application/json` | No       | Not required for GET requests |

### Example Request

```bash
curl -X GET \
  'https://tqaq505m83.execute-api.eu-north-1.amazonaws.com/dev1/api/v1/hosts/host_5fd9e097-81bd-4bcd-a612-0a8a8993e657/subscription' \
  -H 'Authorization: Bearer eyJraWQiOiJ...'
```

```typescript
// TypeScript/JavaScript Example
const getSubscription = async (hostId: string, accessToken: string) => {
  const response = await fetch(
    `${API_BASE_URL}/api/v1/hosts/${hostId}/subscription`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }
  );

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  return await response.json();
};
```

---

## Response

### Success Response (200 OK)

```json
{
  "hostId": "host_5fd9e097-81bd-4bcd-a612-0a8a8993e657",
  "planName": "FREE",
  "displayName": "Free Plan",
  "status": "ACTIVE",
  "maxListings": 2,
  "monthlyPrice": 0.0,
  "description": "Perfect for getting started with up to 2 property listings",
  "startedAt": "2025-10-25T10:23:51.187Z",
  "expiresAt": null,
  "cancelledAt": null,
  "isActive": true
}
```

### Response Fields

| Field          | Type           | Description                                                          |
| -------------- | -------------- | -------------------------------------------------------------------- |
| `hostId`       | string         | The host's unique identifier                                         |
| `planName`     | string         | Plan identifier: `FREE`, `ONE`, `FIVE`, `TEN`, or `PRO`              |
| `displayName`  | string         | Human-readable plan name (e.g., "Free Plan")                         |
| `status`       | string         | Subscription status: `ACTIVE`, `SUSPENDED`, or `CANCELLED`           |
| `maxListings`  | number         | Maximum number of property listings allowed                          |
| `monthlyPrice` | number         | Monthly price in EUR (e.g., 0.00, 9.99, 29.99)                       |
| `description`  | string         | Plan description                                                     |
| `startedAt`    | string         | ISO 8601 timestamp when subscription started                         |
| `expiresAt`    | string \| null | ISO 8601 timestamp when subscription expires (null if never expires) |
| `cancelledAt`  | string \| null | ISO 8601 timestamp when subscription was cancelled (null if active)  |
| `isActive`     | boolean        | Whether the subscription is currently active                         |

---

## Subscription Plans

| Plan Name | Display Name    | Max Listings | Description                          |
| --------- | --------------- | ------------ | ------------------------------------ |
| `FREE`    | Free Plan       | 2            | Default plan for new users           |
| `ONE`     | One Property    | 1            | For single property owners           |
| `FIVE`    | Five Properties | 5            | For growing portfolios               |
| `TEN`     | Ten Properties  | 10           | For established property managers    |
| `PRO`     | Professional    | 999          | Unlimited listings for professionals |

---

## Error Responses

### 400 Bad Request

Missing or invalid `hostId` parameter.

```json
{
  "error": "hostId is required in path"
}
```

### 401 Unauthorized

Missing or invalid authentication token.

```json
{
  "message": "Unauthorized"
}
```

### 403 Forbidden

User attempting to access another host's subscription.

```json
{
  "error": "FORBIDDEN: User sub_xxx (host: host_abc) cannot access host host_xyz"
}
```

### 404 Not Found

Subscription not found for the specified host.

```json
{
  "error": "Subscription not found for host: host_xxx"
}
```

### 500 Internal Server Error

Server-side error occurred.

```json
{
  "error": "Internal server error"
}
```

---

## Frontend Usage Examples

### 1. Display Subscription Info in Dashboard

```typescript
interface SubscriptionDisplayProps {
  hostId: string;
  accessToken: string;
}

const SubscriptionDisplay: React.FC<SubscriptionDisplayProps> = ({
  hostId,
  accessToken,
}) => {
  const [subscription, setSubscription] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchSubscription = async () => {
      try {
        const data = await getSubscription(hostId, accessToken);
        setSubscription(data);
      } catch (error) {
        console.error("Failed to fetch subscription:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchSubscription();
  }, [hostId, accessToken]);

  if (loading) return <div>Loading...</div>;
  if (!subscription) return <div>No subscription found</div>;

  return (
    <div className="subscription-card">
      <h3>{subscription.displayName}</h3>
      <p>{subscription.description}</p>

      <div className="subscription-details">
        <div className="detail-row">
          <strong>Plan:</strong> {subscription.planName}
        </div>
        <div className="detail-row">
          <strong>Status:</strong> {subscription.status}
        </div>
        <div className="detail-row">
          <strong>Max Listings:</strong> {subscription.maxListings}
        </div>
        <div className="detail-row">
          <strong>Monthly Price:</strong> €
          {subscription.monthlyPrice.toFixed(2)}
        </div>
        <div className="detail-row">
          <strong>Started:</strong>{" "}
          {new Date(subscription.startedAt).toLocaleDateString()}
        </div>
      </div>
    </div>
  );
};
```

---

## Notes

1. **Caching**: Consider caching subscription data in the frontend state management (Redux, Context, etc.) to avoid repeated API calls
2. **Real-time Updates**: Subscription data should be refreshed after upgrading/downgrading plan
3. **Error Handling**: Always handle 403 errors gracefully - they indicate the user is trying to access another host's data
4. **JWT Claims**: The `hostId` is also available in the JWT token claims, so you can extract it from the access token
5. **Listing Limits**: When listings are implemented in the future, the API will be extended to include current listing counts and enforcement logic

---

## Environment URLs

| Environment | Base URL                                                       |
| ----------- | -------------------------------------------------------------- |
| dev1        | `https://tqaq505m83.execute-api.eu-north-1.amazonaws.com/dev1` |
| staging     | TBD                                                            |
| production  | TBD                                                            |

---

## TypeScript Types

```typescript
export type SubscriptionPlanName = "FREE" | "ONE" | "FIVE" | "TEN" | "PRO";
export type SubscriptionStatus = "ACTIVE" | "SUSPENDED" | "CANCELLED";

export interface SubscriptionResponse {
  hostId: string;
  planName: SubscriptionPlanName;
  displayName: string;
  status: SubscriptionStatus;
  maxListings: number;
  monthlyPrice: number;
  description: string;
  startedAt: string;
  expiresAt: string | null;
  cancelledAt: string | null;
  isActive: boolean;
}
```
