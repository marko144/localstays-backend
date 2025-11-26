# Production Security Review: API Rate Limiting & Throttling

**Review Date:** 2025-11-26  
**Reviewer:** System Analysis  
**Status:** ⚠️ REQUIRES ATTENTION BEFORE PRODUCTION DEPLOYMENT

---

## Executive Summary

Your API infrastructure has **multi-layered rate limiting** configured, but there are **critical gaps** and **inconsistencies** that must be addressed before production deployment.

### Critical Issues Found:

1. ❌ **No rate limiting on write operations** (profile/listing submission, image uploads)
2. ❌ **No Lambda concurrency limits** (risk of cost explosion)
3. ⚠️ **Legacy API Gateway stack has weak rate limits** (100 req/s prod) - may not be in use
4. ⚠️ **Guest API rate limits may be too low** (500 req/s for public search)
5. ℹ️ **No WAF on API Gateway** (acceptable for launch, add later if needed)

---

## Current Rate Limiting Architecture

### Layer 1: API Gateway Stage-Level Throttling

These are **hard limits** enforced by AWS API Gateway at the deployment stage level.

| API Stack              | Environment | Rate Limit (req/s) | Burst Limit | Daily Quota | Status                 |
| ---------------------- | ----------- | ------------------ | ----------- | ----------- | ---------------------- |
| **Public API**         | prod        | 2,000              | 4,000       | None        | ✅ Appropriate         |
| **Public API**         | staging     | 200                | 400         | None        | ✅ Appropriate         |
| **Guest API**          | prod        | 500                | 1,000       | None        | ⚠️ May be low          |
| **Guest API**          | staging     | 100                | 200         | None        | ✅ Appropriate         |
| **Host API**           | prod        | 1,000              | 2,000       | None        | ✅ Appropriate         |
| **Host API**           | staging     | 100                | 200         | None        | ✅ Appropriate         |
| **Admin API**          | prod        | 500                | 1,000       | None        | ✅ Appropriate         |
| **Admin API**          | staging     | 50                 | 100         | None        | ✅ Appropriate         |
| **Legacy API Gateway** | prod        | 1,000              | 2,000       | None        | ⚠️ Check if still used |
| **Legacy API Gateway** | staging     | 100                | 200         | None        | ⚠️ Check if still used |

### Layer 2: Usage Plans (Legacy API Gateway Only)

**Location:** `infra/lib/api-gateway-stack.ts`

```typescript
throttle: {
  rateLimit: stage === 'prod' ? 100 : 10,      // ❌ VERY LOW for prod
  burstLimit: stage === 'prod' ? 200 : 20,     // ❌ VERY LOW for prod
},
quota: {
  limit: stage === 'prod' ? 100000 : 10000,    // 100k requests/day
  period: apigateway.Period.DAY,
}
```

**Issues:**

- ❌ **100 req/s is extremely low** for production (should be 1000+)
- ❌ **Usage plan is created but NOT enforced** (no API keys required)
- ⚠️ This stack appears to be legacy - confirm if still in use

### Layer 3: Application-Level Rate Limiting (DynamoDB-backed)

#### 3.1 Mapbox Geocoding Rate Limiting

**Endpoints:**

- `POST /api/v1/geocode/rate-limit` (Public API)

**Limits:**

- **Hourly:** 20 searches per user
- **Lifetime:** 100 searches per user
- **Storage:** DynamoDB table with TTL
- **Status:** ✅ Well-implemented

**Code:** `backend/services/api/geocode/check-and-increment-rate-limit.ts`

#### 3.2 Location Search Rate Limiting

**Endpoint:**

- `GET /api/v1/locations/search` (Guest API)

**Limits:**

- **Per-minute:** 30 requests per IP address
- **Window:** 1 minute (60 seconds)
- **Storage:** DynamoDB table with TTL
- **Status:** ✅ Implemented

**Code:** `backend/services/api/guest/search-locations.ts` (lines 174-222)

#### 3.3 Listing Search Rate Limiting

**Endpoint:**

- `GET /api/v1/listings/search` (Guest API)

**Limits:**

- **Per-minute:** 30 requests per IP address
- **Window:** 1 minute (60 seconds)
- **Storage:** DynamoDB table with TTL
- **Status:** ✅ Implemented

**Code:** `backend/services/api/guest/search-listings.ts` (lines 942-988)

---

## Critical Gaps & Recommendations

### 1. ❌ CRITICAL: No Rate Limiting on Sensitive Write Operations

**Missing rate limits on:**

#### Host API (All require Cognito auth but no rate limiting)

- `POST /api/v1/hosts/{hostId}/profile/submit-intent` - Profile submission
- `POST /api/v1/hosts/{hostId}/profile/confirm-submission` - Profile confirmation
- `POST /api/v1/hosts/{hostId}/listings/submit-intent` - Listing creation
- `POST /api/v1/hosts/{hostId}/listings/{listingId}/confirm-submission` - Listing confirmation
- `POST /api/v1/hosts/{hostId}/listings/{listingId}/publish` - Listing publication
- `POST /api/v1/hosts/{hostId}/listings/{listingId}/unpublish` - Listing unpublication
- `PUT /api/v1/hosts/{hostId}/listings/{listingId}/images` - Image upload URLs
- `DELETE /api/v1/hosts/{hostId}/listings/{listingId}/images/{imageId}` - Image deletion

**Risk:** Malicious user could:

- Spam profile submissions (DDoS attack on verification queue)
- Create thousands of listings (database pollution)
- Request unlimited pre-signed S3 upload URLs (S3 cost attack)
- Spam image uploads (storage cost attack, GuardDuty scanning costs)

**Recommendation:**

```typescript
// Add per-user rate limiting for write operations
const WRITE_OPERATION_LIMITS = {
  "submit-intent": { perHour: 10, perDay: 50 },
  "confirm-submission": { perHour: 10, perDay: 50 },
  publish: { perHour: 20, perDay: 100 },
  "image-upload": { perHour: 50, perDay: 200 },
  "image-delete": { perHour: 100, perDay: 500 },
};
```

#### Admin API (Requires Cognito + admin group, but no rate limiting)

- `PUT /api/v1/admin/hosts/{hostId}/approve` - Host approval
- `PUT /api/v1/admin/hosts/{hostId}/reject` - Host rejection
- `PUT /api/v1/admin/listings/{listingId}/approve` - Listing approval
- `PUT /api/v1/admin/listings/{listingId}/reject` - Listing rejection
- `POST /api/v1/admin/notifications/send` - Send notification

**Risk:** Compromised admin account could:

- Mass approve/reject hosts/listings
- Spam notifications to all users

**Recommendation:**

```typescript
const ADMIN_OPERATION_LIMITS = {
  "approve-reject": { perMinute: 30, perHour: 500 },
  "send-notification": { perHour: 10, perDay: 50 },
  "bulk-operations": { perHour: 5, perDay: 20 },
};
```

### 2. ⚠️ WARNING: Inconsistent Rate Limits Across APIs

**Issue:** Different APIs have vastly different rate limits without clear justification.

| API        | Prod Rate Limit | Justification                                       |
| ---------- | --------------- | --------------------------------------------------- |
| Public API | 2,000 req/s     | ✅ Public-facing, needs high throughput             |
| Host API   | 1,000 req/s     | ✅ Authenticated users, moderate traffic            |
| Guest API  | 500 req/s       | ⚠️ **Too low?** Public search traffic could be high |
| Admin API  | 500 req/s       | ✅ Small number of admin users                      |

**Recommendation:**

- **Guest API** should be increased to **1,000 req/s** for production
- Monitor actual traffic patterns in staging before production

### 3. ⚠️ MEDIUM: No WAF on API Gateway (Optional for Launch)

**Current State:**

- No AWS WAF integration with API Gateway
- APIs can be called directly (bypassing web app WAF)
- Relying on API Gateway rate limits + application-level rate limiting

**Risk Assessment:**

- ⚠️ **Medium Risk** for pre-launch startup
- ✅ Mitigated by: Cognito auth, API Gateway rate limits, application-level rate limiting
- 📈 **Becomes High Risk** when: Mobile apps launch, API costs >$500/month, third-party integrations

**Decision: DEFER TO POST-LAUNCH**

**Rationale:**

1. ✅ You plan to add WAF on CloudFront (web app) - this protects browser-based attacks
2. ✅ Your APIs have good rate limiting already (500-2000 req/s at API Gateway level)
3. ✅ Critical endpoints have application-level rate limiting (search, geocoding)
4. ✅ Most write operations require Cognito authentication
5. ✅ You can add API WAF later if you see abuse patterns
6. ✅ Lower initial costs ($10/month vs. $20-30/month)

**When to Add API WAF:**

- 📱 When you launch mobile apps (more direct API access)
- 🤝 When you have third-party API integrations
- 💰 When API costs become significant (>$500/month)
- 🚨 After detecting suspicious API traffic patterns
- 📈 When traffic exceeds 1M requests/month

**Implementation (For Future):**

```typescript
// Add to each API stack when needed
const webAcl = new wafv2.CfnWebACL(this, "ApiWaf", {
  scope: "REGIONAL",
  defaultAction: { allow: {} },
  rules: [
    {
      name: "RateLimitRule",
      priority: 1,
      statement: {
        rateBasedStatement: {
          limit: 2000,
          aggregateKeyType: "IP",
        },
      },
      action: { block: {} },
    },
    {
      name: "AWSManagedRulesCommonRuleSet",
      priority: 2,
      statement: {
        managedRuleGroupStatement: {
          vendorName: "AWS",
          name: "AWSManagedRulesCommonRuleSet",
        },
      },
      overrideAction: { none: {} },
    },
  ],
});

// Associate with API Gateway
const association = new wafv2.CfnWebACLAssociation(this, "WafAssociation", {
  resourceArn: this.api.deploymentStage.stageArn,
  webAclArn: webAcl.attrArn,
});
```

**Cost:** ~$5-10/month + $0.60 per million requests (when implemented)

### 4. ⚠️ WARNING: Usage Plan Not Enforced

**Issue:** `api-gateway-stack.ts` creates a usage plan but doesn't require API keys.

**Current Code:**

```typescript
const usagePlan = this.api.addUsagePlan("UsagePlan", {
  throttle: { rateLimit: 100, burstLimit: 200 },
  quota: { limit: 100000, period: apigateway.Period.DAY },
});
```

**Problem:** Without API keys, the usage plan is **not enforced**.

**Options:**

1. **Remove the usage plan** (if not needed)
2. **Enforce with API keys** (for partner integrations)
3. **Document that it's for future use**

**Recommendation:** If this is the legacy API Gateway stack, **delete it** if no longer used.

### 5. ⚠️ WARNING: No Lambda Concurrency Limits

**Issue:** Lambda functions have no reserved or provisioned concurrency limits.

**Risk:**

- Single malicious user could consume all Lambda concurrency
- Account-level Lambda throttling (1000 concurrent executions default)
- Cost explosion

**Recommendation:**

```typescript
// Add to critical Lambda functions
const submitIntentLambda = new nodejs.NodejsFunction(
  this,
  "SubmitIntentLambda",
  {
    // ... existing config
    reservedConcurrentExecutions: stage === "prod" ? 100 : 10,
  }
);
```

**Suggested Limits:**

- **Submit Intent / Confirm Submission:** 50-100 concurrent executions
- **Image Processor:** 50 concurrent executions
- **Search endpoints:** 200 concurrent executions
- **Admin endpoints:** 20 concurrent executions

### 6. ✅ GOOD: CloudWatch Alarms for Throttling

**Found in:** `infra/lib/shared-services-stack.ts`

```typescript
new cloudwatch.Alarm(this, "ImageProcessorThrottlesAlarm", {
  metric: this.imageProcessorLambda.metricThrottles(),
  threshold: 10,
});
```

**Status:** ✅ Good practice, but should be extended to all Lambda functions.

---

## Recommended Rate Limiting Strategy for Production

### Tier 1: API Gateway Stage-Level (Hard Limits)

```typescript
// Public API (unauthenticated public endpoints)
throttlingRateLimit: 2000,
throttlingBurstLimit: 4000,

// Guest API (public search, may have Cognito auth)
throttlingRateLimit: 1000,  // ⬆️ Increase from 500
throttlingBurstLimit: 2000,

// Host API (authenticated hosts)
throttlingRateLimit: 1000,
throttlingBurstLimit: 2000,

// Admin API (authenticated admins)
throttlingRateLimit: 500,
throttlingBurstLimit: 1000,
```

### Tier 2: Application-Level (Per-User/IP)

| Endpoint Type            | Rate Limit | Window | Key        |
| ------------------------ | ---------- | ------ | ---------- |
| **Public Search**        | 30 req     | 1 min  | IP address |
| **Authenticated Search** | 100 req    | 1 min  | User ID    |
| **Geocoding**            | 20 req     | 1 hour | User ID    |
| **Profile Submission**   | 10 req     | 1 hour | User ID    |
| **Listing Creation**     | 10 req     | 1 hour | User ID    |
| **Image Upload**         | 50 req     | 1 hour | User ID    |
| **Admin Actions**        | 30 req     | 1 min  | User ID    |

### Tier 3: Lambda Concurrency Limits

| Function Type          | Reserved Concurrency |
| ---------------------- | -------------------- |
| Submit Intent          | 100                  |
| Confirm Submission     | 100                  |
| Image Processor        | 50                   |
| Verification Processor | 50                   |
| Search Endpoints       | 200                  |
| Admin Endpoints        | 20                   |

### Tier 4: WAF Rules

- **Rate-based rule:** 2000 req per 5 minutes per IP
- **AWS Managed Rules:** Common Rule Set (OWASP Top 10)
- **Geo-blocking:** (Optional) Block high-risk countries
- **IP reputation:** Block known malicious IPs

---

## Implementation Priority

### Phase 1: CRITICAL (Before Production Launch)

1. ✅ **Add rate limiting to write operations** - Prevents abuse of costly operations (submit-intent, confirm-submission, image uploads)
2. ✅ **Add Lambda concurrency limits** - Prevents cost explosion and account-level throttling
3. ⚠️ **Increase Guest API rate limits** - Consider increasing from 500 to 1,000 req/s for production
4. ⚠️ **Review legacy API Gateway stack** - Confirm if still in use, remove if not
5. ℹ️ **Add WAF to CloudFront (web app)** - Protects browser-based attacks (already planned)

### Phase 2: HIGH (First Week of Production)

1. Monitor actual traffic patterns
2. Adjust rate limits based on real data
3. Add CloudWatch alarms for all rate limit breaches
4. Implement automated responses to sustained attacks

### Phase 3: MEDIUM (First Month)

1. Add per-endpoint granular rate limits
2. Implement tiered rate limits (free vs. paid users)
3. Add rate limit headers to all responses
4. Implement rate limit bypass for trusted partners

---

## Monitoring & Alerting

### CloudWatch Metrics to Monitor

```typescript
// Add these alarms to all API stacks
new cloudwatch.Alarm(this, "ApiThrottledRequests", {
  metric: api.metricCount({
    statistic: "Sum",
    period: cdk.Duration.minutes(5),
  }),
  threshold: 100,
  evaluationPeriods: 2,
  alarmDescription: "Alert when API requests are throttled",
});

new cloudwatch.Alarm(this, "Api4xxErrors", {
  metric: api.metric4XXError({
    statistic: "Sum",
    period: cdk.Duration.minutes(5),
  }),
  threshold: 50,
  evaluationPeriods: 2,
});

new cloudwatch.Alarm(this, "Api5xxErrors", {
  metric: api.metric5XXError({
    statistic: "Sum",
    period: cdk.Duration.minutes(5),
  }),
  threshold: 10,
  evaluationPeriods: 2,
});
```

### Dashboard Metrics

Create a CloudWatch Dashboard with:

- API Gateway request count (by API)
- Throttled requests (by API)
- Lambda throttles (by function)
- 4xx/5xx error rates
- DynamoDB rate limit table size
- WAF blocked requests

---

## Testing Rate Limits

### Before Production Deployment

```bash
# Test API Gateway throttling
for i in {1..1000}; do
  curl -X GET "https://api.staging.localstays.com/api/v1/listings/search?location=London" &
done
wait

# Test application-level rate limiting
for i in {1..50}; do
  curl -X POST "https://api.staging.localstays.com/api/v1/geocode/rate-limit" \
    -H "Authorization: Bearer $TOKEN"
done

# Test Lambda concurrency limits
# (Requires load testing tool like Artillery or k6)
```

---

## Cost Implications

### Current Monthly Costs (Estimated)

| Service                | Current     | With Rate Limiting | With Concurrency Limits | With API WAF (Future) |
| ---------------------- | ----------- | ------------------ | ----------------------- | --------------------- |
| API Gateway            | ~$3.50      | ~$3.50             | ~$3.50                  | ~$3.50                |
| CloudFront WAF         | $0          | ~$10               | ~$10                    | ~$10                  |
| API Gateway WAF        | $0          | $0                 | $0                      | ~$10                  |
| Lambda                 | ~$50        | ~$50               | ~$40 (savings)          | ~$40                  |
| DynamoDB (rate limits) | ~$1         | ~$2                | ~$2                     | ~$2                   |
| **Total**              | **~$54.50** | **~$65.50**        | **~$55.50**             | **~$75.50**           |

**Notes:**

- **CloudFront WAF:** ~$10/month protects web app (recommended for launch)
- **API Gateway WAF:** ~$10/month protects direct API access (defer to post-launch)
- **Lambda concurrency limits:** Save ~$10/month by preventing runaway executions
- **Application-level rate limiting:** Minimal DynamoDB cost increase (~$1/month)

---

## Action Items

### Immediate (Before Production)

- [ ] **CRITICAL:** Add rate limiting to write operations (submit-intent, confirm-submission, image uploads)
- [ ] **CRITICAL:** Add Lambda concurrency limits to prevent cost explosion
- [ ] Review and confirm if `api-gateway-stack.ts` is still in use (may be legacy)
- [ ] Consider increasing Guest API rate limits to 1000 req/s (currently 500)
- [ ] Add CloudWatch alarms for throttling on all Lambda functions
- [ ] Add WAF to CloudFront (web app) - already planned

### Short-term (First Week)

- [ ] Monitor production traffic patterns
- [ ] Adjust rate limits based on real data
- [ ] Add rate limit response headers
- [ ] Document rate limits for frontend developers

### Medium-term (First Month)

- [ ] Implement tiered rate limits (if needed)
- [ ] Add rate limit bypass mechanism for partners
- [ ] Create CloudWatch dashboard
- [ ] Set up automated incident response

---

## Questions for Review

1. **Is `api-gateway-stack.ts` still in use?** If not, should it be deleted?
2. **What are expected traffic volumes?** (helps size rate limits correctly)
3. **Do you plan to offer paid tiers with higher limits?**
4. **Are there any partner integrations that need bypass mechanisms?**
5. **What is your budget for WAF?** ($10-20/month)

---

## Conclusion

Your rate limiting implementation has **good foundations** but **critical gaps** that must be addressed before production:

✅ **Strengths:**

- Multi-layered approach (API Gateway + application-level)
- DynamoDB-backed rate limiting for specific endpoints
- CloudWatch alarms for some throttling events

❌ **Critical Issues:**

- No rate limiting on write operations (profile/listing submission, image uploads)
- No WAF protection
- No Lambda concurrency limits
- Inconsistent rate limits across APIs

**Recommendation:** **DO NOT deploy to production** until Phase 1 items are completed.

**Estimated Implementation Time:** 4-6 hours for Phase 1 items.

---

**Next Steps:**

1. Review this document
2. Confirm which items to implement
3. I can help implement the changes
