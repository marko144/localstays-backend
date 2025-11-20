# Infrastructure Restructuring Plan

## Current State Analysis

### Stack Overview (10 Stacks Total)

#### **Current Deployment Order:**

```
Phase 1: Foundation (Independent - 6 stacks)
1. ParamsStack           →  SSM parameters
2. DataStack             →  Main DynamoDB table
3. EmailTemplateStack    →  Email templates table
4. RateLimitStack        →  Rate limiting table
5. StorageStack          →  S3 bucket
6. KmsStack              →  KMS encryption keys

Phase 2: Authentication (2 stacks)
7. CognitoStack          →  User Pool (depends on KmsStack)
8. AuthTriggerStack      →  Lambda triggers (depends on all Phase 1 + Cognito)

Phase 3: CDN (1 stack)
9. CloudFrontStack       →  CDN (depends on StorageStack)

Phase 4: API Layer (1 MASSIVE stack) 🔴
10. ApiLambdaStack       →  412 RESOURCES (82% of 500 limit!)
    ├─ 14 Lambda functions
    ├─ 56 unique API endpoints
    ├─ 112 routes (with OPTIONS)
    ├─ API Gateway
    ├─ Cognito Authorizer
    ├─ IAM roles & policies
    ├─ CloudWatch logs
    ├─ SQS queues
    ├─ SNS topics
    └─ EventBridge rules
```

---

## The Problem

### ApiLambdaStack Resource Breakdown

**Total: 412 resources (approaching 500 limit)**

| Component                        | Count   | Resources Each                                           | Total Resources |
| -------------------------------- | ------- | -------------------------------------------------------- | --------------- |
| Lambda Functions                 | 14      | ~5 (function + role + policy + log group + permissions)  | ~70             |
| API Routes                       | 56      | ~3 (resource + method + permission)                      | ~168            |
| OPTIONS Routes (CORS)            | 56      | ~2 (method + mock integration)                           | ~112            |
| API Gateway Base                 | 1       | ~10 (API + deployment + stage + authorizer + CloudWatch) | ~10             |
| SQS Queues                       | 2       | ~3 each                                                  | ~6              |
| SNS Topics                       | 1       | ~3                                                       | ~3              |
| EventBridge Rules                | 2       | ~5 each                                                  | ~10             |
| CloudWatch Alarms                | Various | ~1 each                                                  | ~10             |
| Misc (permissions, integrations) | -       | -                                                        | ~23             |

**Estimated headroom:** ~88 resources (~20-25 more API endpoints OR 5-10 more Lambdas)

---

## Lambda Function Distribution

### Current 14 Lambdas in ApiStack:

```
HOST OPERATIONS (4 Lambdas, ~25 routes)
├─ hostProfileHandlerLambda       → submit-intent, confirm, update-rejected, get
├─ hostListingsHandlerLambda      → CRUD listings, pricing, images, requests
├─ hostRequestsHandlerLambda      → verification requests workflow
└─ getSubscriptionLambda          → subscription details

ADMIN OPERATIONS (3 Lambdas, ~26 routes)
├─ adminHostsHandlerLambda        → host review, approve, reject, suspend
├─ adminListingsHandlerLambda     → listing review, approve, reject
└─ adminRequestsHandlerLambda     → verification requests review

NOTIFICATIONS (4 Lambdas, ~4 routes)
├─ subscribeNotificationLambda    → subscribe to topics
├─ unsubscribeNotificationLambda  → unsubscribe
├─ listSubscriptionsLambda        → list user subscriptions
└─ sendNotificationLambda         → send push notifications (admin)

BACKGROUND PROCESSING (2 Lambdas, event-driven)
├─ imageProcessorLambda           → S3-triggered image optimization (container)
└─ verificationProcessorLambda    → SQS-driven video verification

UTILITIES (1 Lambda, 1 route)
└─ checkAndIncrementRateLimitLambda → Mapbox geocoding rate limiting
```

---

## Proposed Restructuring

### Strategy: Split ApiStack into 4 Domain-Specific Stacks

#### **Why 4 stacks?**

- **Clear domain boundaries** (host, admin, public, shared)
- **Independent deployment** (faster, safer)
- **Isolated blast radius** (bug in admin doesn't affect host API)
- **Better organization** (each stack ~100-150 resources)
- **Room for growth** (each stack can grow independently)

---

## New Stack Structure

### **Phase 4A: Shared Services Stack** (NEW)

```
LocalstaysSharedServicesStack (~50 resources)
├─ Notification system (4 Lambdas + SNS + routes)
├─ Background processors (2 Lambdas + SQS + EventBridge)
├─ Shared utilities (rate limiting Lambda)
└─ Shared resources (SQS queues, SNS topics)
```

**Purpose:** Centralize cross-cutting concerns used by multiple APIs

**Resources:**

- 7 Lambda functions
- 4 API routes (notifications)
- 2 SQS queues
- 1 SNS topic
- 2 EventBridge rules
- IAM roles & policies
- CloudWatch logs

**Dependencies:**

- DataStack (DynamoDB)
- RateLimitStack (DynamoDB)
- CognitoStack (Authorizer)
- StorageStack (S3 for image processing)

---

### **Phase 4B: Host API Stack** (NEW)

```
LocalstaysHostApiStack (~120-150 resources)
├─ REST API Gateway (host.api.localstays.com)
├─ Cognito Authorizer (HOST group)
├─ Host Profile Lambda (4 routes)
│  ├─ POST   /api/v1/hosts/{hostId}/profile/submit-intent
│  ├─ POST   /api/v1/hosts/{hostId}/profile/confirm-submission
│  ├─ PUT    /api/v1/hosts/{hostId}/profile/update-rejected
│  └─ GET    /api/v1/hosts/{hostId}/profile
├─ Host Listings Lambda (~16 routes)
│  ├─ GET/POST/PUT/DELETE listings
│  ├─ Pricing endpoints (GET/PUT)
│  ├─ Image update workflow
│  └─ Verification requests
├─ Host Requests Lambda (5 routes)
├─ Get Subscription Lambda (1 route)
└─ Metadata Lambda (1 route) - public, no auth
```

**Purpose:** All host-facing API endpoints

**Total Routes:** ~27 unique endpoints = ~54 with OPTIONS

**Resources Estimate:**

- 4 Lambda functions × 5 = ~20 resources
- 27 routes × 3 = ~81 resources
- 27 OPTIONS × 2 = ~54 resources
- API Gateway base = ~10 resources
- **Total: ~165 resources** (33% of limit)

**Dependencies:**

- DataStack
- EmailTemplateStack
- StorageStack
- CloudFrontStack
- CognitoStack
- SharedServicesStack (for notifications, image processing)

---

### **Phase 4C: Admin API Stack** (NEW)

```
LocalstaysAdminApiStack (~120-150 resources)
├─ REST API Gateway (admin.api.localstays.com)
├─ Cognito Authorizer (ADMIN group)
├─ Admin Hosts Lambda (~11 routes)
│  ├─ GET    /api/v1/admin/hosts (list, search, pending)
│  ├─ GET    /api/v1/admin/hosts/{hostId}
│  ├─ PUT    /api/v1/admin/hosts/{hostId}/(approve|reject|suspend|reinstate)
│  └─ GET    /api/v1/admin/hosts/{hostId}/(documents|listings|requests)
├─ Admin Listings Lambda (~10 routes)
│  ├─ GET    /api/v1/admin/listings (list, pending)
│  ├─ GET    /api/v1/admin/listings/{listingId}
│  ├─ PUT    /api/v1/admin/listings/{listingId}/(approve|reject|suspend|reviewing)
│  ├─ GET    /api/v1/admin/listings/{listingId}/requests
│  └─ POST   /api/v1/admin/listings/{listingId}/requests/(address-verification|property-video)
└─ Admin Requests Lambda (5 routes)
   ├─ GET    /api/v1/admin/requests (list, pending)
   ├─ GET    /api/v1/admin/requests/{requestId}
   └─ PUT    /api/v1/admin/requests/{requestId}/(approve|reject)
```

**Purpose:** All admin-facing API endpoints

**Total Routes:** ~26 unique endpoints = ~52 with OPTIONS

**Resources Estimate:**

- 3 Lambda functions × 5 = ~15 resources
- 26 routes × 3 = ~78 resources
- 26 OPTIONS × 2 = ~52 resources
- API Gateway base = ~10 resources
- **Total: ~155 resources** (31% of limit)

**Dependencies:**

- DataStack
- EmailTemplateStack
- CognitoStack
- SharedServicesStack (for sending notifications)

---

### **Phase 4D: Public API Stack** (FUTURE)

```
LocalstaysPublicApiStack (~100-150 resources)
├─ REST API Gateway (api.localstays.com)
├─ NO Cognito Authorizer (public endpoints with rate limiting)
├─ Search Lambda
│  ├─ GET    /api/v1/search/listings
│  ├─ GET    /api/v1/search/locations
│  └─ GET    /api/v1/listings/{listingId} (public view)
├─ Booking Lambda
│  ├─ POST   /api/v1/bookings
│  ├─ GET    /api/v1/bookings/{bookingId}
│  └─ POST   /api/v1/bookings/{bookingId}/confirm
└─ Payment Lambda (Stripe integration)
   ├─ POST   /api/v1/payments/create-intent
   ├─ POST   /api/v1/payments/webhooks
   └─ GET    /api/v1/payments/{paymentId}
```

**Purpose:** Guest-facing public APIs (search, booking, payments)

**Status:** Not yet implemented - reserved for future

**Dependencies:**

- DataStack
- LocationsStack (NEW - for search)
- StripeStack (NEW - for payments)
- RateLimitStack (for public API rate limiting)

---

## Revised Deployment Order

```
Phase 1: Foundation (6 stacks - UNCHANGED)
1.  ParamsStack
2.  DataStack
3.  EmailTemplateStack
4.  RateLimitStack
5.  StorageStack
6.  KmsStack

Phase 2: Authentication (2 stacks - UNCHANGED)
7.  CognitoStack
8.  AuthTriggerStack

Phase 3: CDN (1 stack - UNCHANGED)
9.  CloudFrontStack

Phase 4: API Layer (4 stacks - SPLIT) ⭐ NEW
10. SharedServicesStack    (~50 resources)  ← Background jobs, notifications, utilities
11. HostApiStack           (~165 resources) ← Host-facing endpoints
12. AdminApiStack          (~155 resources) ← Admin-facing endpoints
13. PublicApiStack         (~150 resources) ← Guest-facing endpoints (FUTURE)

TOTAL: 13 stacks (currently 12, future 13)
```

---

## Migration Path

### Phase 1: Preparation (No Deployment)

**1. Create new stack files:**

```
infra/lib/
├─ shared-services-stack.ts  (NEW)
├─ host-api-stack.ts          (NEW)
├─ admin-api-stack.ts         (NEW)
└─ public-api-stack.ts        (NEW - empty for now)
```

**2. Extract Lambda definitions from `api-lambda-stack.ts`:**

- Move notification Lambdas → `shared-services-stack.ts`
- Move processor Lambdas → `shared-services-stack.ts`
- Move host Lambdas → `host-api-stack.ts`
- Move admin Lambdas → `admin-api-stack.ts`

**3. Extract API route definitions:**

- Move host routes → `host-api-stack.ts`
- Move admin routes → `admin-api-stack.ts`
- Move notification routes → `shared-services-stack.ts`

**4. Update `infra/bin/infra.ts`:**

- Import new stack classes
- Add new stack instantiations
- Set up dependencies

---

### Phase 2: Deploy Shared Services (First)

**Why first?** Host and Admin APIs will depend on it.

**Deploy:**

```bash
cdk deploy LocalstaysStagingSharedServicesStack --context env=staging
```

**Includes:**

- Notification Lambdas (with their own API routes)
- Image processor Lambda
- Verification processor Lambda
- Rate limiting Lambda
- SQS queues
- SNS topics
- EventBridge rules

**Test:** Verify notification endpoints work independently.

---

### Phase 3: Deploy Host API

**Deploy:**

```bash
cdk deploy LocalstaysStagingHostApiStack --context env=staging
```

**Includes:**

- New API Gateway instance (separate from old one)
- Host profile Lambda
- Host listings Lambda
- Host requests Lambda
- Subscription Lambda
- All host routes

**Test:**

- Host profile submission
- Listing creation
- Image upload
- Verification workflow

**Validation:** Run full host onboarding flow end-to-end.

---

### Phase 4: Deploy Admin API

**Deploy:**

```bash
cdk deploy LocalstaysStagingAdminApiStack --context env=staging
```

**Includes:**

- New API Gateway instance
- Admin hosts Lambda
- Admin listings Lambda
- Admin requests Lambda
- All admin routes

**Test:**

- Admin login
- Host review workflow
- Listing approval
- Request review

**Validation:** Run full admin review flow end-to-end.

---

### Phase 5: Cutover & Cleanup

**1. Update frontend API URLs:**

```typescript
// Old (single API)
const API_URL =
  "https://tr8eo3kgec.execute-api.eu-north-1.amazonaws.com/staging";

// New (split APIs)
const HOST_API_URL =
  "https://abc123.execute-api.eu-north-1.amazonaws.com/staging";
const ADMIN_API_URL =
  "https://def456.execute-api.eu-north-1.amazonaws.com/staging";
const SHARED_API_URL =
  "https://ghi789.execute-api.eu-north-1.amazonaws.com/staging";
```

**2. Deploy frontend changes**

**3. Monitor for 48 hours:**

- Check CloudWatch logs
- Verify all endpoints working
- Check error rates
- Monitor performance

**4. Delete old ApiLambdaStack:**

```bash
cdk destroy LocalstaysStagingApiStack --context env=staging
```

**5. Clean up old stack file:**

```bash
rm infra/lib/api-lambda-stack.ts
rm infra/lib/api-gateway-stack.ts  # if separate
```

---

## Benefits of This Restructuring

### 1. **Scalability**

- Each stack can grow to 500 resources independently
- **Current capacity:** 412 resources in 1 stack = 82% used
- **New capacity:** ~370 resources across 3 stacks = 25% average utilization
- **Growth potential:** Can add ~400 more API endpoints before hitting limits again

### 2. **Deployment Speed**

- **Before:** Deploy all 412 resources every time (~5-10 minutes)
- **After:** Deploy only changed stack (~2-3 minutes)
- **Example:** Admin bug fix only deploys AdminApiStack

### 3. **Blast Radius Reduction**

- Bug in admin API doesn't break host API
- Host API downtime doesn't affect admin operations
- Independent rollback capabilities

### 4. **Better Organization**

- Clear domain boundaries
- Easier to onboard new developers
- Simpler code reviews (changes are localized)

### 5. **Independent Scaling**

- Admin API can have different throttle limits than host API
- Can optimize Lambda memory/timeout per domain
- Different monitoring/alerting strategies

### 6. **Security Improvements**

- Admin API can have stricter IP allowlisting
- Host API can have different CORS policies
- Separate CloudWatch log groups for better compliance

---

## Resource Estimates Post-Split

| Stack                   | Resources | % of Limit                | Headroom                     |
| ----------------------- | --------- | ------------------------- | ---------------------------- |
| SharedServicesStack     | ~50       | 10%                       | Can add 30+ background jobs  |
| HostApiStack            | ~165      | 33%                       | Can add 80+ endpoints        |
| AdminApiStack           | ~155      | 31%                       | Can add 80+ endpoints        |
| PublicApiStack (future) | ~150      | 30%                       | Can add 80+ endpoints        |
| **TOTAL**               | **520**   | **26%** (across 4 stacks) | **Massive growth potential** |

---

## Implementation Timeline

**Total estimated effort:** 2-3 days

| Phase                 | Time     | Tasks                                              |
| --------------------- | -------- | -------------------------------------------------- |
| Preparation           | 4 hours  | Create new stack files, extract Lambda definitions |
| Deploy SharedServices | 1 hour   | Deploy + test notifications                        |
| Deploy HostApi        | 2 hours  | Deploy + test host workflows                       |
| Deploy AdminApi       | 2 hours  | Deploy + test admin workflows                      |
| Frontend Updates      | 2 hours  | Update API URLs, test integration                  |
| Monitoring            | 48 hours | Watch for issues (passive)                         |
| Cleanup               | 1 hour   | Delete old stack, clean up code                    |

**Risk level:** Low-Medium

- Running both old and new stacks in parallel during cutover
- Can rollback frontend changes if issues
- No data migration required (same DynamoDB tables)

---

## Alternative: Defer Until Necessary

### **Option: "Wait and See"**

**Current situation:**

- 412/500 resources (82% used)
- ~88 resources headroom
- ~20-25 more endpoints before hitting limit

**When to split:**

- When you reach **450 resources** (90%)
- Or when adding **booking/search** features (major expansion)
- Or when **deployment times** become painful (>10 minutes)

**Trade-offs:**

- ✅ Defer complexity
- ✅ Focus on features now
- ❌ Forced to split under pressure later
- ❌ Larger migration when you do it

---

## Recommendation

### **Split NOW (Proactive)**

**Why:**

1. **You have time** - not in crisis mode yet
2. **Better planning** - can design clean boundaries
3. **Learning opportunity** - understand multi-stack patterns before you need them
4. **Future-proof** - ready for booking/search features
5. **Minimal risk** - can run old + new in parallel during migration

**When to start:** After current feature work stabilizes (e.g., after Locations table work)

---

## Questions to Consider

1. **API Gateway costs:** 3 separate APIs = 3× base cost (~$3.50/month each). Is this acceptable?
2. **Custom domains:** Do you want `host.api.localstays.com`, `admin.api.localstays.com`? (requires Route53 + ACM)
3. **Deployment automation:** Should we update CI/CD to deploy only changed stacks?
4. **Monitoring:** Do you want separate CloudWatch dashboards per API?
5. **Rate limiting:** Different throttle limits for host vs admin vs public?

---

## Next Steps

**Choose your path:**

**A) Split Now (Recommended)**

1. Review and approve this plan
2. Create new stack files (preparation)
3. Deploy SharedServicesStack first
4. Deploy HostApiStack
5. Deploy AdminApiStack
6. Update frontend
7. Monitor + cleanup

**B) Defer Splitting**

1. Continue with current architecture
2. Monitor resource count
3. Split when approaching 450 resources

**C) Hybrid Approach**

1. Extract SharedServicesStack NOW (most reusable)
2. Keep Host + Admin together for now
3. Split Host/Admin later when needed

---

## Summary

**Current:** 1 massive ApiStack (412 resources, 82% capacity)

**Proposed:** 4 focused stacks (~130 avg resources each, 26% avg capacity)

**Benefit:** 4× the growth potential, faster deploys, better isolation

**Effort:** 2-3 days of focused work

**Risk:** Low (parallel deployment, easy rollback)

**Recommendation:** Split NOW while you have breathing room

---

## 📝 Implementation Log

### Analysis Phase - 2025-11-19

**✅ Step 1: Analyzed current `api-lambda-stack.ts`**

- **File size:** 1,831 lines
- **Estimated resources:** 402 (82% of 500 limit)
- **Lambdas:** 14 total (11 API handlers + 3 processors)
- **API Routes:** 56 unique endpoints (56 OPTIONS = 112 total route resources)

**Key Findings:**

1. **Shared Infrastructure (will go to SharedServicesStack):**

   - Image Processing Lambda (container-based) + SQS queue + DLQ + EventBridge rule
   - Verification Processing Lambda + SQS queue + DLQ + EventBridge rule
   - CloudWatch Alarms (8 total) for queue monitoring
   - ECR repository reference

2. **Host API Components (will go to HostApiStack):**

   - Lambdas: `hostProfileHandler`, `getSubscription`, `hostListingsHandler`, `hostRequestsHandler`
   - Notification Lambdas: `subscribeNotification`, `unsubscribeNotification`, `listSubscriptions`
   - Routes: ~25 endpoints under `/api/v1/hosts/...` and `/api/v1/listings/metadata`

3. **Admin API Components (will go to AdminApiStack):**

   - Lambdas: `adminHostsHandler`, `adminListingsHandler`, `adminRequestsHandler`, `sendNotification`
   - Routes: ~20 endpoints under `/api/v1/admin/...`

4. **Public API Components (will go to PublicApiStack):**

   - Lambdas: `checkAndIncrementRateLimit`
   - Routes: 2 endpoints (rate-limit check + listings metadata if we move it here)

5. **Cognito Authorizer:**
   - Currently created once in ApiLambdaStack
   - Will need to create separately in **each** API stack
   - Same config (references same Cognito User Pool), different resource instances

**Dependencies Identified:**

- All new API stacks depend on: `CognitoStack`, `DataStack`, `EmailTemplateStack`, `StorageStack`, `ParamsStack`, `CloudFrontStack`
- `HostApiStack`, `AdminApiStack` depend on: `SharedServicesStack` (for notification sending to shared queues)
- `RateLimitStack` → only needed by `PublicApiStack`

**Lessons from Past Work (Cross-referenced):**

- **`DOCKER_IMAGE_DEPLOYMENT_LESSONS_LEARNED.md`**: Docker images must use `--platform linux/arm64` and be pushed before stack deployment
- **Resource consolidation**: We already consolidated Lambda handlers to reduce CloudFormation resources
- **CORS handling**: OPTIONS methods double route count (already implemented with Gateway Responses)

**Next:** Create `SharedServicesStack` first (image/verification processing + shared infrastructure)

---

**✅ Step 2: Created `SharedServicesStack` (infra/lib/shared-services-stack.ts)**

- **File size:** 494 lines
- **Resources:** ~40 estimated (SQS queues, EventBridge rules, Lambdas, alarms, log groups)
- **Purpose:** Shared infrastructure used by all API stacks

**What's included:**

1. **Image Processing:**

   - Image Processor Lambda (container-based, ARM64)
   - SQS queue + DLQ
   - EventBridge rule (GuardDuty → SQS) for `lstimg_` prefix
   - CloudWatch alarms (queue backlog, errors, throttles)
   - ECR repository reference

2. **Verification Processing:**

   - Verification Processor Lambda (Node.js 20, ARM64)
   - SQS queue + DLQ
   - EventBridge rule (GuardDuty → SQS) for `veri_` prefix
   - CloudWatch alarms (queue backlog, errors, throttles)

3. **Public Exports:**
   - Queue URLs (for reference by other stacks if needed)
   - Lambda function names

**Key Design Decisions:**

- Kept all processing infrastructure together (image + verification)
- Used same alarm thresholds as original implementation
- Maintained container-based Lambda for image processing (Sharp library)
- Exported queue URLs and Lambda names for potential cross-stack references
- Added detailed comments referencing `DOCKER_IMAGE_DEPLOYMENT_LESSONS_LEARNED.md`

**Next:** Create `HostApiStack` (host-facing API Gateway + endpoints + Lambdas)

---

**✅ Step 3-5: Created API Stack Files**

- **`HostApiStack`** (infra/lib/host-api-stack.ts): 908 lines, ~140-150 estimated resources
- **`AdminApiStack`** (infra/lib/admin-api-stack.ts): 700 lines, ~110-120 estimated resources
- **`PublicApiStack`** (infra/lib/public-api-stack.ts): 280 lines, ~20-30 estimated resources

**What's included:**

**HostApiStack** (largest):

- 7 Lambdas: hostProfile, getSubscription, hostListings, hostRequests, subscribeNotification, unsubscribeNotification, listSubscriptions
- ~25 API routes: profile, subscription, listings (CRUD + pricing + image-update), requests, notifications
- Cognito authorizer (separate instance)
- CORS gateway responses

**AdminApiStack** (medium):

- 4 Lambdas: adminHosts, adminListings, adminRequests, sendNotification
- ~20 API routes: hosts (CRUD + approve/reject/suspend), listings (review + approve/reject), requests (approve/reject)
- Cognito authorizer (separate instance)
- Includes font bundling for PDF generation (address verification)

**PublicApiStack** (smallest):

- 1 Lambda: checkAndIncrementRateLimit
- 1 API route: geocode rate limiting
- Cognito authorizer (for authenticated public calls)
- Higher throttle limits (public-facing)

**Key Design Decisions:**

- Each API stack has its own Cognito authorizer (required - can't share across API Gateways)
- Same Lambda configuration across all stacks (Node.js 20, ARM64, 512MB, 30s timeout)
- Separate log groups per API Gateway for better organization
- Different throttle limits per API (Host: 1000, Admin: 500, Public: 2000 req/sec)

---

**✅ Step 6: Updated `infra/bin/infra.ts`**

- Removed import for old `ApiLambdaStack`
- Added imports for 4 new stacks
- Updated deployment order comments (13 stacks total)
- Configured dependencies:
  - `SharedServicesStack` depends on: DataStack, StorageStack
  - `HostApiStack` depends on: CognitoStack, DataStack, EmailTemplateStack, StorageStack, ParamsStack, CloudFrontStack, SharedServicesStack
  - `AdminApiStack` depends on: CognitoStack, DataStack, EmailTemplateStack, StorageStack, ParamsStack, SharedServicesStack
  - `PublicApiStack` depends on: CognitoStack, DataStack, RateLimitStack
- Updated console log output to show all 13 stacks

---

**✅ Step 7: Tested CDK Synth - SUCCESS! ✅**

```bash
npx cdk synth --all -c env=staging
```

**Result:** Exit code 0 (success)

**All 13 stacks synthesized successfully:**

1. ✅ LocalstaysStagingParamsStack
2. ✅ LocalstaysStagingDataStack
3. ✅ LocalstaysStagingEmailTemplateStack
4. ✅ LocalstaysStagingRateLimitStack
5. ✅ LocalstaysStagingStorageStack
6. ✅ LocalstaysStagingKmsStack
7. ✅ LocalstaysStagingCognitoStack
8. ✅ LocalstaysStagingAuthTriggerStack
9. ✅ LocalstaysStagingCloudFrontStack
10. ✅ LocalstaysStagingSharedServicesStack
11. ✅ LocalstaysStagingHostApiStack
12. ✅ LocalstaysStagingAdminApiStack
13. ✅ LocalstaysStagingPublicApiStack

**Warnings (non-blocking):**

- Deprecation warnings for `logRetention` (use `logGroup` instead) - cosmetic only
- Deprecation warning for `pointInTimeRecovery` - cosmetic only
- AWS SDK v2 warnings - can be ignored (we're using v3)

**Outcome:** Infrastructure code is valid and ready for deployment.

---

**Next:** Update deployment documentation and prepare frontend config guide

---

_Document created: 2025-11-19_  
_Last updated: 2025-11-19_  
_Next review: When adding booking/search features OR at 450 resources_
