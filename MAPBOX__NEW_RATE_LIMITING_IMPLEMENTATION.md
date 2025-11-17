# Mapbox Rate Limiting - Backend Implementation

## Overview

This document describes the backend implementation of rate limiting for Mapbox geocoding API calls. The frontend calls Mapbox directly, but checks and updates rate limits via backend API endpoints.

---

## Architecture

```
Frontend (Amplify SSR)
  ↓ 1. POST /api/v1/geocode/rate-limit (check & increment atomically)
  ↓ 2. Call Mapbox API directly (if allowed)
Backend API
  ↓ DynamoDB (geocode-rate-limits-{stage})
```

**Key Design Decisions:**

- ✅ Separate DynamoDB table for security isolation
- ✅ No Mapbox token in backend (frontend handles Mapbox calls)
- ✅ No provisioned concurrency (accept occasional cold starts)
- ✅ Simple key-value design (no GSIs needed)
- ✅ **Single atomic endpoint** (check + increment in one call)

---

## API Endpoint

### Check and Increment Rate Limit (Atomic)

**Endpoint:** `POST /api/v1/geocode/rate-limit`

**Authentication:** Cognito JWT required

**Request Body:** Empty

**Success Response (200):**

```json
{
  "success": true,
  "status": {
    "allowed": true,
    "hourlyRemaining": 17,
    "lifetimeRemaining": 94,
    "resetAt": "2025-11-17T19:00:00.000Z"
  }
}
```

**Response Headers:**

```
X-RateLimit-Hourly-Remaining: 17
X-RateLimit-Lifetime-Remaining: 94
X-RateLimit-Reset: 2025-11-17T19:00:00.000Z
```

**Error Response (429 - Rate Limit Exceeded):**

```json
{
  "error": "Rate limit exceeded",
  "message": "Hourly limit of 20 searches reached. Try again in 15 minutes."
}
```

**How it works:**

1. Checks if user is under hourly AND lifetime limits
2. If allowed: Atomically increments both counters and returns success
3. If exceeded: Returns 429 error without incrementing

---

## DynamoDB Schema

**Table Name:** `geocode-rate-limits-{stage}`

**Partition Key:** `id` (String)

**No Sort Key** - Simple key-value design

**TTL Attribute:** `ttl` (Number, Unix timestamp in seconds)

### Record Types

#### Hourly Record

Tracks searches within a specific hour. Auto-deleted 2 hours after the hour ends.

```typescript
{
  id: "hourly:userId:1731510000000",  // PK: hourly:{userId}:{hourStartTimestamp}
  userId: "c0ec79bc-c0c1-7017-e598-505f5ef53288",
  count: 15,
  resetAt: 1731513600000,  // Unix timestamp (ms) when hour ends
  createdAt: 1731510123000,  // Unix timestamp (ms) when first search happened
  ttl: 1731520800  // Unix timestamp (seconds) = resetAt + 2 hours
}
```

#### Lifetime Record

Tracks total searches for a user. Persists forever.

```typescript
{
  id: "lifetime:userId",  // PK: lifetime:{userId}
  userId: "c0ec79bc-c0c1-7017-e598-505f5ef53288",
  count: 87,
  createdAt: 1730000000000,  // Unix timestamp (ms) when user made first search
  lastUsedAt: 1731513800000  // Unix timestamp (ms) when user made most recent search
}
```

### How Hourly Keys Work

The hourly key includes the hour's start timestamp, so the frontend automatically "knows" which record to use:

```typescript
const now = Date.now(); // e.g., 1731513800000 (10:30:00 AM)
const hourStart = Math.floor(now / 3600000) * 3600000; // e.g., 1731510000000 (10:00:00 AM)
const hourlyKey = `hourly:${userId}:${hourStart}`; // "hourly:abc123:1731510000000"
```

- All searches between 10:00-10:59 AM use the **same hourly key**
- At 11:00 AM, the calculation automatically generates a **new hourly key**
- Old hourly records are auto-deleted by DynamoDB TTL

---

## Rate Limits

### Default Limits (Configurable per Environment)

| Environment | Hourly Limit | Lifetime Limit |
| ----------- | ------------ | -------------- |
| dev         | 20           | 100            |
| dev1        | 20           | 100            |
| staging     | 20           | 100            |
| prod        | 50           | 500            |

### Configuration

Limits are configured in `cdk.json`:

```json
{
  "environments": {
    "staging": {
      "geocodeHourlyLimit": 20,
      "geocodeLifetimeLimit": 100
    }
  }
}
```

---

## Frontend Integration

### Example Flow

```typescript
// 1. Check and increment rate limit atomically
const rateLimitResponse = await fetch(`${API_URL}/api/v1/geocode/rate-limit`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${jwtToken}`,
  },
});

// Check if rate limit exceeded
if (rateLimitResponse.status === 429) {
  const error = await rateLimitResponse.json();
  // Show error to user: error.message
  return;
}

const { success, status } = await rateLimitResponse.json();

if (!success || !status.allowed) {
  // Show error to user
  return;
}

// 2. Call Mapbox API directly (rate limit already incremented)
const mapboxResponse = await fetch(
  `https://api.mapbox.com/geocoding/v5/mapbox.places/${query}.json?access_token=${MAPBOX_TOKEN}`
);

const results = await mapboxResponse.json();

// 3. Use results
return results;
```

**Benefits of Single Endpoint:**

- ✅ **50% fewer API calls** (1 instead of 2)
- ✅ **Atomic operation** (no race conditions)
- ✅ **Simpler frontend code** (one request instead of two)
- ✅ **Lower cost** (~$10.50/month savings on API Gateway)

---

## Infrastructure

### CDK Stacks

**New Stack:** `RateLimitStack`

- Creates `geocode-rate-limits-{stage}` DynamoDB table
- Enables TTL on `ttl` attribute
- No PITR (data is disposable)
- No deletion protection (even in prod)

**Updated Stack:** `ApiLambdaStack`

- Adds `checkAndIncrementRateLimitLambda` (single POST endpoint)
- Grants DynamoDB read/write permissions
- Adds API Gateway route

### Lambda Function

| Function                     | Name                                            | Entry Point                                                      | Permissions                            |
| ---------------------------- | ----------------------------------------------- | ---------------------------------------------------------------- | -------------------------------------- |
| Check & Increment Rate Limit | `localstays-{stage}-check-increment-rate-limit` | `backend/services/api/geocode/check-and-increment-rate-limit.ts` | DynamoDB: GetItem, PutItem, UpdateItem |

### Environment Variables

The Lambda receives:

- `RATE_LIMIT_TABLE_NAME`: `geocode-rate-limits-{stage}`
- `GEOCODE_HOURLY_LIMIT`: `20` (or configured value)
- `GEOCODE_LIFETIME_LIMIT`: `100` (or configured value)

---

## Deployment

### Deploy to Staging

```bash
cd /Users/markobabic/LocalDev/localstays-backend
npx cdk deploy LocalstaysStagingRateLimitStack LocalstaysStagingApiStack --context env=staging
```

### Verify Deployment

```bash
# Check table exists
aws dynamodb describe-table \
  --table-name geocode-rate-limits-staging \
  --region eu-north-1

# Check TTL is enabled
aws dynamodb describe-time-to-live \
  --table-name geocode-rate-limits-staging \
  --region eu-north-1

# Test check endpoint
curl -X GET \
  https://YOUR_API_ID.execute-api.eu-north-1.amazonaws.com/staging/api/v1/geocode/rate-limit \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"

# Test increment endpoint
curl -X POST \
  https://YOUR_API_ID.execute-api.eu-north-1.amazonaws.com/staging/api/v1/geocode/rate-limit \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

---

## Monitoring

### CloudWatch Metrics

**DynamoDB:**

- `ConsumedReadCapacityUnits`
- `ConsumedWriteCapacityUnits`
- `UserErrors` (should be 0)

**Lambda:**

- `Invocations`
- `Duration`
- `Errors`
- `Throttles`

### CloudWatch Logs

**Check Rate Limit Lambda:**

```
/aws/lambda/localstays-staging-check-rate-limit
```

**Increment Rate Limit Lambda:**

```
/aws/lambda/localstays-staging-increment-rate-limit
```

### Useful Queries

```bash
# View user's current rate limits
aws dynamodb get-item \
  --table-name geocode-rate-limits-staging \
  --key '{"id": {"S": "lifetime:USER_ID_HERE"}}' \
  --region eu-north-1

# View user's hourly usage (calculate hourStart first)
aws dynamodb get-item \
  --table-name geocode-rate-limits-staging \
  --key '{"id": {"S": "hourly:USER_ID:HOUR_START_TIMESTAMP"}}' \
  --region eu-north-1

# Reset user's lifetime limit (delete record)
aws dynamodb delete-item \
  --table-name geocode-rate-limits-staging \
  --key '{"id": {"S": "lifetime:USER_ID_HERE"}}' \
  --region eu-north-1
```

---

## Cost Estimate

### DynamoDB (On-Demand)

**Assumptions:**

- 100 users
- 20 searches/user/hour
- 2,000 searches/hour
- 1.5M searches/month

**Reads:** 3M/month (hourly + lifetime = 2 reads per search)

- Cost: 3M × $0.25/million = **$0.75/month**

**Writes:** 3M/month (hourly + lifetime = 2 writes per search)

- Cost: 3M × $1.25/million = **$3.75/month**

**Storage:** ~20 KB (negligible, well under 25 GB free tier)

- Cost: **$0/month**

**Total DynamoDB:** **~$4.50/month**

### Lambda

**Invocations:** 3M/month (single endpoint)

- Cost: (3M - 1M free) × $0.20/million = **$0.40/month**

**Compute:** 3M × 100ms × 512MB

- Cost: ~**$0.25/month**

**Total Lambda:** **~$0.65/month**

### API Gateway

**Requests:** 3M/month (single endpoint)

- Cost: 3M × $3.50/million = **$10.50/month**

### Total Monthly Cost

| Service     | Cost              |
| ----------- | ----------------- |
| DynamoDB    | $4.50             |
| Lambda      | $0.65             |
| API Gateway | $10.50            |
| **Total**   | **~$15.65/month** |

**Savings vs 2 endpoints:** ~$10.85/month (41% cost reduction!)

**Note:** This is for 100 active users. Scales linearly with usage.

---

## Security

### Authentication

- ✅ All endpoints require Cognito JWT
- ✅ User ID extracted from JWT claims (cannot be spoofed)

### Authorization

- ✅ Users can only check/increment their own rate limits
- ✅ No admin bypass (even admins are rate limited)

### Data Isolation

- ✅ Separate table from user/host/listing data
- ✅ No PII stored (only user IDs and counts)
- ✅ Data is disposable (can be deleted without impact)

### IAM Permissions

- ✅ Lambda has minimal permissions (only to rate limit table)
- ✅ No cross-table access
- ✅ No S3, SES, or other service access

---

## Troubleshooting

### Issue: Rate limit not enforced

**Check:**

1. Table exists: `aws dynamodb describe-table --table-name geocode-rate-limits-staging`
2. Lambda has permissions: Check IAM role in AWS Console
3. Frontend is calling increment endpoint after Mapbox call

---

### Issue: Cold start latency

**Expected:** First request after 5-15 minutes of inactivity takes 200-500ms

**Solution:** Accept it (per user request, no provisioned concurrency)

---

### Issue: User reports "rate limit exceeded" but hasn't used it

**Check:**

```bash
# View user's lifetime usage
aws dynamodb get-item \
  --table-name geocode-rate-limits-staging \
  --key '{"id": {"S": "lifetime:USER_ID"}}' \
  --region eu-north-1

# View user's hourly usage
aws dynamodb get-item \
  --table-name geocode-rate-limits-staging \
  --key '{"id": {"S": "hourly:USER_ID:HOUR_START"}}' \
  --region eu-north-1
```

**Solution:** Reset user's limits if needed (delete records)

---

## Future Enhancements

### 1. Admin Override

- Add admin endpoint to reset user limits
- Add admin endpoint to increase limits for specific users

### 2. Tiered Limits

- Free users: 20/hour, 100/lifetime
- Premium users: 100/hour, 1000/lifetime
- Store tier in user profile, check in Lambda

### 3. Analytics Dashboard

- Track usage per user
- Identify power users
- Predict when users will hit limits

### 4. Caching

- Cache popular searches (e.g., "Beograd", "Novi Sad")
- Reduce Mapbox API calls by 30-50%
- Don't count cached results against rate limit

---

## Files Created/Modified

### New Files

- `infra/lib/rate-limit-stack.ts` - DynamoDB table stack
- `backend/services/types/rate-limit.types.ts` - TypeScript types
- `backend/services/api/geocode/check-and-increment-rate-limit.ts` - Single atomic endpoint
- `MAPBOX_RATE_LIMITING_IMPLEMENTATION.md` - This document

### Modified Files

- `infra/lib/api-lambda-stack.ts` - Added rate limit Lambdas and routes
- `infra/bin/infra.ts` - Added RateLimitStack to deployment
- `cdk.json` - Added rate limit configuration per environment

---

## Summary

✅ **Separate DynamoDB table** for security isolation
✅ **No Mapbox token in backend** - frontend handles Mapbox calls
✅ **Single atomic endpoint** - check and increment in one call
✅ **Automatic hourly reset** - no cron jobs needed
✅ **TTL cleanup** - no manual maintenance
✅ **Environment-specific limits** - configurable per stage
✅ **Low cost** - ~$15.65/month for 100 users (41% cheaper than 2 endpoints!)
✅ **No provisioned concurrency** - accept occasional cold starts

**Ready to deploy!** 🚀
