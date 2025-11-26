# CloudWatch Alarms - Current State & Gap Analysis

**Date:** November 26, 2025  
**Environment:** Staging + Dev1

---

## Current Alarm Coverage

### ✅ What We Have (9 alarms per environment)

**Shared Services Stack** - Image & Verification Processing

| Alarm Name                                 | Metric                             | Threshold      | Purpose                 | Status                 |
| ------------------------------------------ | ---------------------------------- | -------------- | ----------------------- | ---------------------- |
| **Image Processing**                       |
| `{stage}-image-queue-backlog`              | ApproximateAgeOfOldestMessage      | 600s (10 min)  | Queue processing delay  | ✅ OK                  |
| `{stage}-image-queue-old-messages`         | ApproximateAgeOfOldestMessage      | 1800s (30 min) | Severe queue delay      | ✅ OK                  |
| `{stage}-image-dlq-messages`               | ApproximateNumberOfMessagesVisible | ≥1             | Failed image processing | ✅ OK                  |
| `{stage}-image-processor-errors`           | Lambda Errors                      | ≥5 in 5 min    | Lambda failures         | ✅ OK                  |
| `{stage}-image-processor-throttles`        | Lambda Throttles                   | ≥10 in 5 min   | Concurrency limit hit   | ✅ OK                  |
| **Verification Processing**                |
| `{stage}-verification-queue-backlog`       | ApproximateAgeOfOldestMessage      | 600s (10 min)  | Queue processing delay  | ✅ OK                  |
| `{stage}-verification-dlq-messages`        | ApproximateNumberOfMessagesVisible | ≥1             | Failed verification     | 🔴 **ALARM** (staging) |
| `{stage}-verification-processor-errors`    | Lambda Errors                      | ≥5 in 5 min    | Lambda failures         | ✅ OK                  |
| `{stage}-verification-processor-throttles` | Lambda Throttles                   | ≥10 in 5 min   | Concurrency limit hit   | ✅ OK                  |

**Note:** `staging-verification-dlq-messages` is currently in ALARM state - needs investigation!

---

## ❌ Critical Gaps - What We're Missing

### 1. API Gateway Alarms (CRITICAL)

**Missing for ALL 4 API Gateways:**

- Host API
- Admin API
- Guest API (Public)
- Public API (Geocoding)

| Missing Alarm           | Why Critical            | Risk                            |
| ----------------------- | ----------------------- | ------------------------------- |
| **5XX Error Rate**      | Backend failures        | Users see errors, no visibility |
| **4XX Error Rate**      | Client errors / attacks | Potential DDoS or brute force   |
| **High Latency (p99)**  | Performance degradation | Poor UX, no early warning       |
| **Request Count Spike** | Traffic surge / DDoS    | Cost spike, potential outage    |
| **Throttled Requests**  | Rate limit hit          | Users blocked, no visibility    |

**Impact:** 🔴 **CRITICAL** - No visibility into API health or attacks

---

### 2. Lambda Function Alarms (HIGH PRIORITY)

**Missing for 25 Lambda functions:**

- 10 Host API functions
- 4 Admin API functions
- 2 Guest API functions
- 1 Public API function
- 4 Auth Trigger functions
- 2 Data Seeding functions

| Missing Alarm             | Why Important         | Risk                             |
| ------------------------- | --------------------- | -------------------------------- |
| **Function Errors**       | Code failures         | Silent failures, data corruption |
| **Function Throttles**    | Concurrency limit hit | Users blocked, no visibility     |
| **High Duration**         | Performance issues    | Increased costs, poor UX         |
| **Concurrent Executions** | Approaching limits    | Early warning before throttles   |

**Impact:** 🟡 **HIGH** - No visibility into function health

**Note:** We have these alarms for image/verification processors, but not for API functions!

---

### 3. DynamoDB Alarms (HIGH PRIORITY)

**Missing for 5 DynamoDB tables:**

- Main Table (single-table design)
- Locations Table
- Public Listings Table
- Public Listing Media Table
- Availability Table
- Rate Limit Table
- Email Templates Table

| Missing Alarm                  | Why Important     | Risk                      |
| ------------------------------ | ----------------- | ------------------------- |
| **Read Throttles**             | Capacity exceeded | Failed reads, errors      |
| **Write Throttles**            | Capacity exceeded | Failed writes, data loss  |
| **System Errors**              | DynamoDB issues   | Service disruption        |
| **User Errors**                | Bad requests      | Potential bugs or attacks |
| **Conditional Check Failures** | Race conditions   | Data integrity issues     |

**Impact:** 🟡 **HIGH** - No visibility into database health

---

### 4. Account-Level Alarms (CRITICAL)

**Missing for AWS account limits:**

| Missing Alarm                     | Why Critical          | Risk                      |
| --------------------------------- | --------------------- | ------------------------- |
| **Lambda Concurrent Executions**  | Account-wide limit    | All functions throttled   |
| **Lambda Unreserved Concurrency** | Shared pool exhausted | New functions can't scale |
| **API Gateway Account Limit**     | Too many APIs         | Can't deploy new APIs     |

**Impact:** 🔴 **CRITICAL** - Could affect entire platform

---

### 5. Cost & Abuse Alarms (MEDIUM PRIORITY)

**Missing for cost protection:**

| Missing Alarm                 | Why Important        | Risk                   |
| ----------------------------- | -------------------- | ---------------------- |
| **High Lambda Invocations**   | Potential attack/bug | Cost spike             |
| **High DynamoDB Consumption** | Unusual usage        | Cost spike             |
| **High S3 Data Transfer**     | Potential abuse      | Cost spike             |
| **High SendGrid Usage**       | Email spam/abuse     | Cost spike, reputation |

**Impact:** 🟡 **MEDIUM** - Cost protection

---

### 6. CloudFront Alarms (MEDIUM PRIORITY)

**Missing for CDN monitoring:**

| Missing Alarm           | Why Important           | Risk               |
| ----------------------- | ----------------------- | ------------------ |
| **High 4XX Error Rate** | Missing files / attacks | Poor UX            |
| **High 5XX Error Rate** | Origin failures         | Service disruption |
| **Low Cache Hit Rate**  | Performance issues      | Increased costs    |
| **High Request Rate**   | Traffic spike / DDoS    | Cost spike         |

**Impact:** 🟡 **MEDIUM** - CDN health visibility

---

## Proposed Alarm Strategy

### Phase 1: Critical API & Lambda Alarms (URGENT)

**Deploy First - Essential for Production**

#### API Gateway Alarms (Per API)

```typescript
// 5XX Error Rate (Backend failures)
new cloudwatch.Alarm(this, "ApiGateway5XXErrors", {
  alarmName: `${stage}-${apiName}-5xx-errors`,
  metric: api.metricServerError({
    period: cdk.Duration.minutes(5),
    statistic: "Sum",
  }),
  threshold: 10, // 10+ errors in 5 minutes
  evaluationPeriods: 2,
  comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
  treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
});

// 4XX Error Rate (Client errors / potential attacks)
new cloudwatch.Alarm(this, "ApiGateway4XXErrors", {
  alarmName: `${stage}-${apiName}-4xx-errors`,
  metric: api.metricClientError({
    period: cdk.Duration.minutes(5),
    statistic: "Sum",
  }),
  threshold: 100, // 100+ errors in 5 minutes (20/min)
  evaluationPeriods: 2,
  comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
  treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
});

// High Latency (p99)
new cloudwatch.Alarm(this, "ApiGatewayHighLatency", {
  alarmName: `${stage}-${apiName}-high-latency`,
  metric: api.metricLatency({
    period: cdk.Duration.minutes(5),
    statistic: "p99",
  }),
  threshold: 5000, // 5 seconds (p99)
  evaluationPeriods: 3,
  comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
  treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
});

// Request Count Spike (potential DDoS)
new cloudwatch.Alarm(this, "ApiGatewayRequestSpike", {
  alarmName: `${stage}-${apiName}-request-spike`,
  metric: api.metricCount({
    period: cdk.Duration.minutes(1),
    statistic: "Sum",
  }),
  threshold: stage === "prod" ? 10000 : 1000, // Adjust per API
  evaluationPeriods: 2,
  comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
  treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
});
```

**Apply to:**

- ✅ Host API (high priority - authenticated users)
- ✅ Admin API (medium priority - low traffic but critical)
- ✅ Guest API (critical - public-facing)
- ✅ Public API (critical - public-facing)

---

#### Lambda Function Alarms (Per Critical Function)

```typescript
// Function Errors
new cloudwatch.Alarm(this, `${functionName}Errors`, {
  alarmName: `${stage}-${functionName}-errors`,
  metric: lambdaFunction.metricErrors({
    period: cdk.Duration.minutes(5),
    statistic: "Sum",
  }),
  threshold: 5,
  evaluationPeriods: 1,
  comparisonOperator:
    cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
  treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
});

// Function Throttles
new cloudwatch.Alarm(this, `${functionName}Throttles`, {
  alarmName: `${stage}-${functionName}-throttles`,
  metric: lambdaFunction.metricThrottles({
    period: cdk.Duration.minutes(5),
    statistic: "Sum",
  }),
  threshold: 10,
  evaluationPeriods: 1,
  comparisonOperator:
    cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
  treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
});

// High Duration (performance degradation)
new cloudwatch.Alarm(this, `${functionName}HighDuration`, {
  alarmName: `${stage}-${functionName}-high-duration`,
  metric: lambdaFunction.metricDuration({
    period: cdk.Duration.minutes(5),
    statistic: "Average",
  }),
  threshold: 10000, // 10 seconds (adjust per function)
  evaluationPeriods: 3,
  comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
  treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
});
```

**Priority Functions (add alarms first):**

1. `search-listings` (critical - public search)
2. `search-locations` (critical - public search)
3. `host-listings-handler` (high - CRUD operations)
4. `pre-token-generation` (high - every auth request)
5. `admin-requests-handler` (high - approval workflow)

---

### Phase 2: DynamoDB & Account-Level Alarms (HIGH)

**Deploy Second - Database & Account Health**

#### DynamoDB Alarms (Per Table)

```typescript
// Read Throttles
new cloudwatch.Alarm(this, `${tableName}ReadThrottles`, {
  alarmName: `${stage}-${tableName}-read-throttles`,
  metric: table.metricUserErrors({
    period: cdk.Duration.minutes(5),
    statistic: "Sum",
  }),
  threshold: 10,
  evaluationPeriods: 2,
  comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
  treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
});

// Write Throttles
new cloudwatch.Alarm(this, `${tableName}WriteThrottles`, {
  alarmName: `${stage}-${tableName}-write-throttles`,
  metric: table.metricSystemErrorsForOperations({
    operations: [dynamodb.Operation.PUT_ITEM, dynamodb.Operation.UPDATE_ITEM],
    period: cdk.Duration.minutes(5),
    statistic: "Sum",
  }),
  threshold: 10,
  evaluationPeriods: 2,
  comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
  treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
});
```

**Apply to:**

- Main Table (highest priority)
- Public Listings Table (high priority)
- Availability Table (high priority)
- Others (medium priority)

---

#### Account-Level Alarms

```typescript
// Lambda Account Concurrent Executions
new cloudwatch.Alarm(this, "LambdaAccountConcurrency", {
  alarmName: `${stage}-lambda-account-concurrency`,
  metric: new cloudwatch.Metric({
    namespace: "AWS/Lambda",
    metricName: "ConcurrentExecutions",
    statistic: "Maximum",
    period: cdk.Duration.minutes(1),
  }),
  threshold: stage === "prod" ? 800 : 8, // 80% of account limit
  evaluationPeriods: 2,
  comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
  treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
});

// Lambda Unreserved Concurrency (shared pool)
new cloudwatch.Alarm(this, "LambdaUnreservedConcurrency", {
  alarmName: `${stage}-lambda-unreserved-concurrency-low`,
  metric: new cloudwatch.Metric({
    namespace: "AWS/Lambda",
    metricName: "UnreservedConcurrentExecutions",
    statistic: "Maximum",
    period: cdk.Duration.minutes(1),
  }),
  threshold: stage === "prod" ? 50 : 2, // Alert if pool is low
  evaluationPeriods: 2,
  comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
  treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
});
```

---

### Phase 3: Cost & Abuse Alarms (MEDIUM)

**Deploy Third - Cost Protection**

```typescript
// High Lambda Invocations (potential attack/bug)
new cloudwatch.Alarm(this, "HighLambdaInvocations", {
  alarmName: `${stage}-high-lambda-invocations`,
  metric: new cloudwatch.Metric({
    namespace: "AWS/Lambda",
    metricName: "Invocations",
    statistic: "Sum",
    period: cdk.Duration.minutes(5),
  }),
  threshold: stage === "prod" ? 100000 : 10000, // Adjust based on expected traffic
  evaluationPeriods: 2,
  comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
});

// High DynamoDB Consumed Read Capacity
new cloudwatch.Alarm(this, "HighDynamoDBReads", {
  alarmName: `${stage}-high-dynamodb-reads`,
  metric: table.metricConsumedReadCapacityUnits({
    period: cdk.Duration.minutes(5),
    statistic: "Sum",
  }),
  threshold: 10000, // Adjust based on expected usage
  evaluationPeriods: 2,
  comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
});
```

---

### Phase 4: CloudFront & Additional Alarms (LOW)

**Deploy Last - Nice to Have**

```typescript
// CloudFront 5XX Error Rate
new cloudwatch.Alarm(this, "CloudFront5XXErrors", {
  alarmName: `${stage}-cloudfront-5xx-errors`,
  metric: distribution.metricOriginLatency({
    period: cdk.Duration.minutes(5),
    statistic: "Sum",
  }),
  threshold: 10,
  evaluationPeriods: 2,
  comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
});

// CloudFront Cache Hit Rate
new cloudwatch.Alarm(this, "CloudFrontLowCacheHitRate", {
  alarmName: `${stage}-cloudfront-low-cache-hit-rate`,
  metric: distribution.metricCacheHitRate({
    period: cdk.Duration.minutes(15),
    statistic: "Average",
  }),
  threshold: 80, // Alert if < 80%
  evaluationPeriods: 3,
  comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
});
```

---

## Summary: Alarm Counts

### Current State

| Environment | Alarms Deployed | Coverage                |
| ----------- | --------------- | ----------------------- |
| Staging     | 9               | Image/Verification only |
| Dev1        | 9               | Image/Verification only |
| Production  | 0               | None                    |

### Proposed State (Full Implementation)

| Category                                 | Alarms per Env | Priority    | Status             |
| ---------------------------------------- | -------------- | ----------- | ------------------ |
| **Phase 1: API & Lambda**                |
| API Gateway (4 APIs × 4 alarms)          | 16             | 🔴 Critical | ❌ Not implemented |
| Critical Lambda Functions (5 × 3 alarms) | 15             | 🔴 Critical | ❌ Not implemented |
| **Phase 2: Database & Account**          |
| DynamoDB Tables (7 × 2 alarms)           | 14             | 🟡 High     | ❌ Not implemented |
| Account-Level                            | 2              | 🔴 Critical | ❌ Not implemented |
| **Phase 3: Cost Protection**             |
| Cost & Abuse                             | 5              | 🟡 Medium   | ❌ Not implemented |
| **Phase 4: Additional**                  |
| CloudFront                               | 3              | 🟢 Low      | ❌ Not implemented |
| **Current (Background Processing)**      |
| Image/Verification                       | 9              | ✅ Done     | ✅ Implemented     |
| **Total**                                | **64 alarms**  |             |                    |

---

## Immediate Actions Required

### 1. Investigate Current Alarm

**Status:** 🔴 `staging-verification-dlq-messages` is in ALARM state

**Action:** Check what's in the DLQ and why verification is failing

```bash
# Check DLQ messages
aws sqs get-queue-attributes \
  --queue-url $(aws sqs get-queue-url --queue-name staging-verification-processing-dlq --query 'QueueUrl' --output text) \
  --attribute-names ApproximateNumberOfMessages \
  --region eu-north-1

# Receive and inspect messages
aws sqs receive-message \
  --queue-url $(aws sqs get-queue-url --queue-name staging-verification-processing-dlq --query 'QueueUrl' --output text) \
  --max-number-of-messages 10 \
  --region eu-north-1
```

### 2. Prioritize Alarm Implementation

**For Production Launch:**

- ✅ Phase 1 (API & Lambda) - MUST HAVE
- ✅ Phase 2 (DynamoDB & Account) - MUST HAVE
- ⏸️ Phase 3 (Cost Protection) - NICE TO HAVE
- ⏸️ Phase 4 (CloudFront) - NICE TO HAVE

### 3. Notification Strategy

**Current:** No SNS topics configured (alarms exist but don't notify anyone!)

**Needed:**

```typescript
// Create SNS topic for alarm notifications
const alarmTopic = new sns.Topic(this, "AlarmTopic", {
  topicName: `${stage}-alarm-notifications`,
  displayName: "LocalStays Alarm Notifications",
});

// Subscribe email
alarmTopic.addSubscription(
  new subscriptions.EmailSubscription("ops@localstays.me")
);

// Add to all alarms
alarm.addAlarmAction(new actions.SnsAction(alarmTopic));
```

---

## Cost Estimate

### CloudWatch Alarms Pricing

- **First 10 alarms:** Free
- **Next alarms:** $0.10 per alarm per month

**Estimated cost:**

- Staging: 64 alarms × $0.10 = $6.40/month
- Production: 64 alarms × $0.10 = $6.40/month
- **Total:** ~$13/month

**Value:** Early detection of issues worth thousands in prevented downtime/costs

---

## Next Steps

1. **Investigate current alarm** - Fix staging verification DLQ issue
2. **Decide on alarm strategy** - Which phases to implement now vs. later
3. **Set up SNS notifications** - Ensure alarms actually notify someone
4. **Implement Phase 1** - API Gateway & critical Lambda alarms
5. **Test in staging** - Trigger alarms to verify they work
6. **Deploy to production** - After testing

---

## Questions to Answer

1. **Who should receive alarm notifications?**

   - Email address(es)?
   - Slack channel?
   - PagerDuty / OpsGenie?

2. **What's the priority for production launch?**

   - Phase 1 only (API & Lambda)?
   - Phase 1 + 2 (add DynamoDB & Account)?
   - All phases?

3. **What are acceptable thresholds?**

   - Current thresholds are conservative
   - May need tuning based on actual traffic

4. **Do we need different alarms for staging vs. production?**
   - Staging: More lenient (testing environment)
   - Production: Stricter (real users)
