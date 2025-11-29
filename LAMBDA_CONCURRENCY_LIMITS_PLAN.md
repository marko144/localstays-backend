# Lambda Concurrency Limits - Production Readiness Plan

**Date:** November 27, 2025  
**Status:** ✅ Approved - Ready for Implementation

---

## Overview

Lambda concurrency limits control the maximum number of concurrent executions for a function. This is critical for production to:

1. **Cost Control** - Prevent runaway costs from infinite loops or attacks
2. **Resource Protection** - Prevent overwhelming downstream services (DynamoDB, external APIs)
3. **Predictable Performance** - Ensure critical functions have guaranteed capacity
4. **Account Limit Management** - AWS accounts have a default limit of 1,000 concurrent executions across all functions

---

## Current State

**Status:** ❌ No concurrency limits set on any Lambda functions

**Risk Level:** 🔴 HIGH for production

**Potential Issues:**

- A bug or attack could spawn thousands of concurrent executions
- DynamoDB could be overwhelmed (even with on-demand scaling)
- External API costs could spike (SendGrid, Mapbox)
- Account-wide concurrency could be exhausted, affecting all functions

---

## AWS Lambda Concurrency Model

### Account-Level Limits

- **Default:** 1,000 concurrent executions per region
- **Can be increased:** Request via AWS Support
- **Shared across all functions:** If one function uses 900, only 100 remain for others

### Function-Level Reserved Concurrency

```typescript
reservedConcurrentExecutions: 50;
```

**Effect:**

- **Guarantees** this function can always scale to 50 concurrent executions
- **Limits** this function to max 50 concurrent executions
- **Reserves** 50 from the account pool (reduces available for other functions)

**Formula:**

```
Available for unreserved functions = 1000 - (sum of all reserved concurrency)
```

### Unreserved Concurrency Pool

Functions without reserved concurrency share the remaining pool and compete for capacity.

---

## Lambda Function Inventory

### Current Functions (25 total)

| Function                          | Type         | Current Limit | Expected Load | Risk Level  |
| --------------------------------- | ------------ | ------------- | ------------- | ----------- |
| **Host API (10 functions)**       |
| host-profile-handler              | Consolidated | None          | Medium        | 🟡 Medium   |
| get-subscription                  | Single       | None          | Low           | 🟢 Low      |
| host-listings-handler             | Consolidated | None          | High          | 🔴 High     |
| publish-listing                   | Single       | None          | Medium        | 🟡 Medium   |
| unpublish-listing                 | Single       | None          | Low           | 🟢 Low      |
| host-availability-handler         | Consolidated | None          | Medium        | 🟡 Medium   |
| host-requests-handler             | Consolidated | None          | Medium        | 🟡 Medium   |
| subscribe-notification            | Single       | None          | Low           | 🟢 Low      |
| unsubscribe-notification          | Single       | None          | Low           | 🟢 Low      |
| check-notification-status         | Single       | None          | Low           | 🟢 Low      |
| **Admin API (4 functions)**       |
| admin-hosts-handler               | Consolidated | None          | Low           | 🟢 Low      |
| admin-listings-handler            | Consolidated | None          | Low           | 🟢 Low      |
| admin-requests-handler            | Consolidated | None          | Low           | 🟢 Low      |
| send-notification                 | Single       | None          | Low           | 🟢 Low      |
| **Public API (1 function)**       |
| check-increment-rate-limit        | Single       | None          | High          | 🔴 High     |
| **Guest API (2 functions)**       |
| search-locations                  | Single       | None          | High          | 🔴 High     |
| search-listings                   | Single       | None          | Very High     | 🔴 Critical |
| **Shared Services (2 functions)** |
| image-processor                   | Container    | None          | Medium        | 🟡 Medium   |
| verification-processor            | Single       | None          | Low           | 🟢 Low      |
| **Auth Triggers (4 functions)**   |
| custom-email-sender               | Trigger      | None          | Medium        | 🟡 Medium   |
| pre-signup                        | Trigger      | None          | Medium        | 🟡 Medium   |
| post-confirmation                 | Trigger      | None          | Low           | 🟢 Low      |
| pre-token-generation              | Trigger      | None          | High          | 🔴 High     |
| **Data Seeding (2 functions)**    |
| seed-handler                      | One-time     | None          | N/A           | 🟢 Low      |
| seed-location-variants            | One-time     | None          | N/A           | 🟢 Low      |

---

## Final Approved Concurrency Limits

### Strategy

1. **High-traffic public endpoints** - Reserve capacity to ensure availability
2. **Write operations** - Limit to protect DynamoDB and prevent cost spikes
3. **External API calls** - Limit to control costs (SendGrid, Mapbox)
4. **Admin functions** - Minimal limits (low traffic)
5. **Background processors** - Higher limits for longer-running operations (image/document processing)
6. **Staging** - Minimal allocation for testing only

### Final Allocation Table (Shared Account Limit: 1,000)

| Function                   | Staging | Production | Notes                             |
| -------------------------- | ------- | ---------- | --------------------------------- |
| **Guest API (Public)**     |
| search-listings            | 2       | 200        | Critical, high traffic            |
| search-locations           | 2       | 50         | Public search                     |
| **Public API**             |
| check-increment-rate-limit | 2       | 25         | Host listing creation             |
| **Host API**               |
| host-listings-handler      | 3       | 100        | High usage CRUD                   |
| host-profile-handler       | 2       | 50         | Profile operations                |
| host-availability-handler  | 2       | 50         | Availability management           |
| host-requests-handler      | 2       | 50         | Request management                |
| publish-listing            | 2       | 20         | Rate-limited publish              |
| unpublish-listing          | 2       | 20         | Rate-limited unpublish            |
| get-subscription           | 2       | 10         | Subscription queries              |
| subscribe-notification     | 2       | 10         | Notification subscription         |
| unsubscribe-notification   | 2       | 10         | Notification unsubscribe          |
| check-notification-status  | 2       | 10         | Notification status               |
| **Admin API**              |
| admin-hosts-handler        | 2       | 5          | Admin host management             |
| admin-listings-handler     | 2       | 5          | Admin listing management          |
| admin-requests-handler     | 2       | 5          | Admin request management          |
| send-notification          | 2       | 5          | Admin notifications               |
| **Shared Services**        |
| image-processor            | 3       | 50         | Memory-intensive, longer duration |
| verification-processor     | 3       | 30         | Document processing               |
| **Auth Triggers**          |
| pre-token-generation       | 2       | 50         | Login/token refresh               |
| custom-email-sender        | 2       | 20         | Email sending                     |
| pre-signup                 | 2       | 20         | Signup validation                 |
| post-confirmation          | 2       | 10         | Post-signup initialization        |
| **Data Seeding**           |
| seed-handler               | 0       | 0          | Unreserved (one-time use)         |
| seed-location-variants     | 0       | 0          | Unreserved (one-time use)         |
| **TOTAL RESERVED**         | **56**  | **815**    | **871 total**                     |
| **UNRESERVED POOL**        |         |            | **129 remaining**                 |

**Account Limit:** 1,000  
**Total Reserved (Staging + Production):** 871  
**Remaining Unreserved:** 129

**Key Decisions:**

- Staging kept minimal (56 total) for testing only
- Production prioritizes public-facing APIs (search: 250 total)
- Image/verification processors get higher limits due to longer execution times
- Admin APIs kept low (5 each) - low traffic, can use unreserved pool if needed
- Geocoding rate limit reduced to 25 (infrequent operation during listing creation)
- 129 unreserved for burst capacity and flexibility

---

## Implementation Plan

### Phase 1: Critical Functions (Deploy First)

**Priority:** 🔴 Critical

**Functions:**

1. `search-listings` - 200 (prod) / 20 (staging)
2. `search-locations` - 50 (prod) / 10 (staging)
3. `pre-token-generation` - 50 (prod) / 10 (staging)
4. `host-listings-handler` - 100 (prod) / 20 (staging)

**Reasoning:** These handle the highest traffic and are most critical to user experience.

### Phase 2: Write Operations (Deploy Second)

**Priority:** 🟡 High

**Functions:**

1. `host-profile-handler` - 50 (prod) / 10 (staging)
2. `publish-listing` - 20 (prod) / 5 (staging)
3. `unpublish-listing` - 20 (prod) / 5 (staging)
4. `image-processor` - 20 (prod) / 5 (staging)

**Reasoning:** Protect write paths and external services.

### Phase 3: Admin & Support Functions (Deploy Third)

**Priority:** 🟢 Medium

**Functions:**

1. All Admin API functions - 10-20 (prod) / 5 (staging)
2. All Auth Triggers - 10-50 (prod) / 5-10 (staging)
3. Remaining Host API functions - 10-50 (prod) / 5-10 (staging)

**Reasoning:** Lower traffic, but need guaranteed capacity.

---

## Monitoring & Alerts

### CloudWatch Metrics to Watch

1. **ConcurrentExecutions** - Current concurrent executions
2. **UnreservedConcurrentExecutions** - Available in shared pool
3. **Throttles** - Requests rejected due to concurrency limits
4. **Duration** - Execution time (affects concurrency)

### Recommended Alarms

```typescript
// Alert if function is consistently hitting its limit
new cloudwatch.Alarm(this, "HighConcurrency", {
  metric: lambdaFunction.metricConcurrentExecutions(),
  threshold: reservedConcurrency * 0.8, // 80% of limit
  evaluationPeriods: 3,
  comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
});

// Alert if function is being throttled
new cloudwatch.Alarm(this, "Throttles", {
  metric: lambdaFunction.metricThrottles(),
  threshold: 10,
  evaluationPeriods: 2,
  statistic: "Sum",
});

// Alert if unreserved pool is low
new cloudwatch.Alarm(this, "LowUnreservedConcurrency", {
  metricName: "UnreservedConcurrentExecutions",
  namespace: "AWS/Lambda",
  threshold: 50, // Alert if < 50 available
  evaluationPeriods: 2,
});
```

---

## Cost Impact

### Reserved Concurrency Cost

**Good news:** Reserved concurrency is **FREE**!

- No additional charge for setting limits
- You only pay for actual execution time
- Limits prevent unexpected cost spikes

### Expected Savings

By preventing runaway executions:

- **Lambda costs:** Capped at predictable levels
- **DynamoDB costs:** Protected from overwhelming writes
- **External API costs:** Limited (SendGrid, Mapbox)

**Estimated monthly savings from preventing one incident:** $500-$5,000

---

## Risks & Mitigations

### Risk 1: Legitimate Traffic Throttled

**Symptom:** Users see errors during peak traffic

**Mitigation:**

- Start with conservative limits
- Monitor throttle metrics
- Increase limits if needed (can be done instantly)
- Set up alarms to detect throttling early

### Risk 2: Limits Too Low for Burst Traffic

**Symptom:** Slow response times during traffic spikes

**Mitigation:**

- Use API Gateway throttling as first line of defense
- Keep 100 unreserved executions for burst capacity
- Monitor and adjust based on real traffic patterns

### Risk 3: Account Limit Exhausted

**Symptom:** All functions throttled simultaneously

**Mitigation:**

- Total reserved < 1000
- Request limit increase from AWS if needed
- Monitor account-level unreserved concurrency

---

## Testing Plan

### Staging Tests

1. **Normal Load Test**

   - Verify functions work with limits in place
   - Check no unexpected throttling

2. **Burst Load Test**

   - Simulate traffic spike
   - Verify limits prevent runaway scaling
   - Check throttle metrics

3. **Sustained Load Test**
   - Run at 80% of limit for 10 minutes
   - Verify no performance degradation
   - Check CloudWatch metrics

### Production Rollout

1. **Deploy to production during low-traffic period**
2. **Monitor for 24 hours**
3. **Adjust limits if throttling detected**
4. **Document actual usage patterns**

---

## Rollback Plan

If issues occur:

```typescript
// Remove concurrency limit (instant)
reservedConcurrentExecutions: undefined;

// Or increase limit
reservedConcurrentExecutions: newHigherLimit;
```

**Deployment time:** < 1 minute via CDK

---

## Next Steps

1. **Review and approve limits** - Confirm proposed limits make sense
2. **Implement in CDK** - Add `reservedConcurrentExecutions` to Lambda definitions
3. **Deploy to staging** - Test with staging limits
4. **Monitor for 24 hours** - Verify no issues
5. **Deploy to production** - Use production limits
6. **Set up alarms** - Monitor throttles and concurrency
7. **Document actual usage** - Adjust limits based on real data

---

## References

- [AWS Lambda Concurrency](https://docs.aws.amazon.com/lambda/latest/dg/configuration-concurrency.html)
- [Reserved Concurrency vs Provisioned Concurrency](https://docs.aws.amazon.com/lambda/latest/dg/provisioned-concurrency.html)
- [Lambda Throttling Behavior](https://docs.aws.amazon.com/lambda/latest/dg/invocation-scaling.html)
