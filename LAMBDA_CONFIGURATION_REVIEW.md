# Lambda Configuration & Cost Analysis

**Date:** 2025-10-31  
**Environment:** dev1  
**Region:** eu-north-1

---

## 📊 Account-Level Limits

| Metric                          | Value | Notes                                             |
| ------------------------------- | ----- | ------------------------------------------------- |
| **Concurrent Executions Limit** | 10    | ⚠️ **LOW** - Shared across ALL Lambdas in account |
| **Total Functions**             | 62    | High function count but most are low-traffic      |
| **Unreserved Concurrency**      | 10    | All 10 available (no reserved concurrency set)    |

> ⚠️ **CRITICAL**: Your account has a **10 concurrent execution limit**, which is significantly below the default 1,000 limit. This is likely a new AWS account restriction. This is **the most important constraint** for your system.

---

## 🎯 Processing Pipeline Configuration

### Image Processor Lambda (Container)

```yaml
Function Name: dev1-image-processor
Type: Container (ECR)
Runtime: FROM_IMAGE (Node.js via Dockerfile)
Architecture: ARM64 (Graviton2)
Memory: 2048 MB
Timeout: 90 seconds
Reserved Concurrency: None (unreserved)
```

**Purpose**: Process listing images - resize, convert to WebP, handle malware scan results

**Configuration Rationale**:

- **2048 MB Memory**: Sharp library for image processing is memory-intensive. Processing 5712x4284 images requires significant RAM.
- **90s Timeout**: Large images can take time to process (resize + WebP conversion + S3 uploads). Current processing time: ~2.6 seconds.
- **ARM64**: ~20% cost savings vs x86_64 with same performance for Sharp operations.
- **Batch Size: 1**: Process one image at a time for predictable memory usage and easier error tracking.

**SQS Queue Configuration**:

```yaml
Queue: dev1-image-processing-queue
Visibility Timeout: 180 seconds (2x Lambda timeout)
Message Retention: 4 days
DLQ: dev1-image-processing-dlq (after 3 failed attempts)
Long Polling: 20 seconds
```

---

### Verification Processor Lambda

```yaml
Function Name: dev1-verification-processor
Type: Node.js Function
Runtime: nodejs20.x
Architecture: ARM64
Memory: 512 MB
Timeout: 60 seconds
Reserved Concurrency: None (unreserved)
```

**Purpose**: Process verification files (profile docs, listing docs, videos) - **NO VIDEO PROCESSING**, just S3 move operations after malware scan

**What It Does**:

- ✅ Copy file from root (`veri_*`) to final destination
- ✅ Delete staging file
- ✅ Update DynamoDB record
- ❌ **Does NOT decode, transcode, or analyze videos**
- ❌ **Does NOT process images**

**Configuration Rationale**:

- **512 MB Memory**: Minimal processing (S3 copy/delete + DynamoDB update). **No video/image decoding or processing**.
- **60s Timeout**: S3 copy operations can take time for large videos (up to 500 MB), but it's just file copying, not transcoding.
- **ARM64**: Cost savings with no performance tradeoff for simple S3/DynamoDB ops.
- **Batch Size: 1**: Process one file at a time.

> 💡 **Key Point**: This Lambda doesn't process videos - it just moves them after malware scanning. Video analysis happens manually by admins viewing the files.

**SQS Queue Configuration**:

```yaml
Queue: dev1-verification-processing-queue
Visibility Timeout: 90 seconds (1.5x Lambda timeout)
Message Retention: 4 days
DLQ: dev1-verification-processing-dlq (after 3 failed attempts)
Long Polling: 20 seconds
```

---

## 🎬 Why Is There No Video Processing?

**Short Answer**: Videos are **stored and viewed**, not **analyzed or transcoded**.

### Current Video Workflow

1. **Host uploads video** → S3 root with `veri_` prefix
2. **GuardDuty scans** → Malware check
3. **Verification processor** → Just moves file to final location
4. **Admin reviews** → Watches video in admin portal (pre-signed URL)
5. **Manual approval/rejection** → Admin decision

### No Automated Video Processing Because:

- **LIVE_ID_CHECK videos**: Admin needs to visually verify the host is holding their ID
- **Property videos**: Admin needs to see the actual property condition
- **These are human verification tasks** - can't be automated

### If You Ever Need Video Processing

For automated video analysis (e.g., face detection, transcoding), you'd need:

```yaml
New Lambda: video-processor
Memory: 3008-10240 MB (FFmpeg is memory-intensive)
Timeout: 900s (15 min max)
Dependencies: FFmpeg binary layer or container
Use Case: Transcoding, thumbnail generation, content analysis
```

But currently: **Not needed** ✅

---

## 💰 Cost Analysis

### Processing Lambdas (Image + Verification)

**Image Processor** (2048 MB, ARM64):

- **Compute**: $0.0000133334 per GB-second (ARM64 pricing)
- **Duration**: 2048 MB × 2.6s = 5324.8 MB-seconds = 5.2 GB-seconds
- **Cost per invocation**: $0.000069 (~0.007 cents)
- **1000 images/month**: $0.069 (~7 cents)

**Verification Processor** (512 MB, ARM64):

- **Compute**: $0.0000133334 per GB-second
- **Duration**: 512 MB × 0.6s = 307.2 MB-seconds = 0.3 GB-seconds
- **Cost per invocation**: $0.000004 (~0.0004 cents)
- **1000 files/month**: $0.004 (~0.4 cents)

### API Lambdas (Standard Functions)

**Configuration** (512 MB, x86_64, 30s timeout):

- **Compute**: $0.0000166667 per GB-second (x86_64 pricing)
- **Typical duration**: 200-600ms
- **Cost per invocation**: $0.000001-$0.000005 (~0.0001-0.0005 cents)

**Total API Lambdas**: 56 functions × minimal cost = negligible in dev

---

## ⚡ Concurrency & Throttling

### Current Configuration

```yaml
Reserved Concurrency: NONE (all functions unreserved)
Total Available: 10 concurrent executions
Strategy: Account-level throttling (automatic)
```

### Why No Reserved Concurrency?

From CDK configuration (line 344-346):

```typescript
// NOTE: Reserved concurrency removed due to account limit of 10 concurrent executions
// SQS queue provides natural backpressure and rate limiting
// Account-level limits prevent runaway costs
```

**Decision Rationale**:

1. **Account Limit is Too Low**: Only 10 concurrent executions total. Reserving concurrency for one function would starve others.
2. **SQS Provides Backpressure**: Image/verification processing queues will buffer requests when at capacity.
3. **Natural Rate Limiting**: The 10-execution cap prevents runaway costs without explicit reserved concurrency.

### Concurrency Scenarios

| Scenario                       | Concurrent Executions    | Behavior                     |
| ------------------------------ | ------------------------ | ---------------------------- |
| **1 image upload**             | 1 (image processor)      | Processes immediately        |
| **5 images + 3 docs uploaded** | Up to 8 (mixed)          | Processes immediately        |
| **15 images uploaded at once** | 10 (max)                 | 10 process, 5 wait in queue  |
| **API traffic spike**          | Up to 10 (API functions) | Requests throttled at 10     |
| **Mixed load**                 | 10 total across all      | Lambdas compete for 10 slots |

### Throttling Behavior

When concurrency hits 10:

- **SQS-triggered Lambdas**: Messages stay in queue, processed when capacity available
- **API Gateway Lambdas**: Return 429 (Too Many Requests) or 503 (Service Unavailable)
- **CloudWatch Alarm**: `ImageProcessorThrottlesAlarm` triggers at 10+ throttles/5min

---

## 📈 Scaling Considerations

### Current Bottlenecks

1. **Account Concurrency Limit (10)**:

   - This is the **PRIMARY constraint**
   - Affects ALL Lambdas in the account
   - Typical for new AWS accounts
   - Can request increase via AWS Support

2. **Image Processing Memory**:

   - 2048 MB is appropriate for current image sizes
   - Monitor max memory used (currently 251 MB → only 12% utilized!)

3. **No Reserved Concurrency**:
   - Processing Lambdas share the 10-execution pool with API Lambdas
   - High API traffic could starve image/verification processing

### Scaling Recommendations

#### Short-term (Current Setup)

✅ **Keep as-is** for dev/low-traffic:

- Account limit (10) is sufficient for development
- SQS queues provide natural buffering
- No reserved concurrency prevents starvation

#### Medium-term (Production Prep)

1. **Request Concurrency Limit Increase**:

   ```bash
   # Request via AWS Support Console
   # Typical increase: 10 → 1000 concurrent executions
   # Justification: Production workload for file processing platform
   ```

2. **Consider Reserved Concurrency** (after limit increase):

   ```yaml
   Image Processor: Reserve 50 (ensures image processing capacity)
   Verification Processor: Reserve 20 (ensures doc processing)
   API Lambdas: Unreserved (use remaining ~930)
   ```

3. **Optimize Image Processor Memory**:
   ```yaml
   Current: 2048 MB (12% utilized)
   Recommendation: Test with 1024 MB or 1536 MB
   Savings: 25-33% cost reduction if stable
   ```

#### Long-term (Scale Optimization)

1. **ARM64 for All Lambdas**:

   - Current: Only image/verification processors use ARM64
   - Opportunity: Migrate all 56 API Lambdas to ARM64
   - Savings: ~20% cost reduction

2. **Right-size Memory**:

   - Current: All API Lambdas at 512 MB (one-size-fits-all)
   - Opportunity: Profile each Lambda, reduce light ones to 256 MB
   - Savings: ~50% for low-memory functions

3. **Batch Processing**:
   - Current: Batch size = 1 for both processors
   - Opportunity: Increase verification processor to batch 5-10 files
   - Benefit: Reduce cold starts, improve throughput

---

## 🚨 Monitoring & Alarms

### Image Processing

| Alarm                | Threshold           | Action                        |
| -------------------- | ------------------- | ----------------------------- |
| **Queue Backlog**    | 10+ min old message | Investigate capacity          |
| **Old Messages**     | 30+ min in queue    | Check for failures            |
| **DLQ Messages**     | ≥1 message          | Manual review required        |
| **Lambda Errors**    | ≥5 errors/5min      | Check logs                    |
| **Lambda Throttles** | ≥10 throttles/5min  | Consider concurrency increase |

### Verification Processing

Same alarm structure as image processing (separate queues/DLQs)

---

## 🎯 Immediate Action Items

### Critical (Address Now)

❌ **Nothing critical** - current setup works for dev traffic

### Recommended (Before Production)

1. **Request Account Limit Increase**:

   - Target: 1000 concurrent executions
   - Timeline: 1-2 weeks (AWS Support ticket)
   - Justification: Production file processing workload

2. **Test Image Processor Memory**:

   - Current: 2048 MB @ 12% utilization
   - Test: 1024 MB with typical workload
   - Monitor: Max memory used in CloudWatch

3. **Monitor Throttling**:
   - Watch for throttle events in CloudWatch
   - Current setup should handle dev traffic fine

### Nice-to-Have (Optimization)

1. **Migrate API Lambdas to ARM64**:

   - 20% cost savings
   - Minimal code changes (transparent)

2. **Right-size API Lambda Memory**:
   - Profile memory usage per function
   - Reduce where possible (512 MB → 256 MB for lightweight functions)

---

## 📋 Configuration Summary Table

| Lambda Type                | Count | Memory  | Timeout | Runtime    | Arch   | Concurrency |
| -------------------------- | ----- | ------- | ------- | ---------- | ------ | ----------- |
| **Image Processor**        | 1     | 2048 MB | 90s     | Container  | ARM64  | Unreserved  |
| **Verification Processor** | 1     | 512 MB  | 60s     | Node.js 20 | ARM64  | Unreserved  |
| **API Functions**          | 56    | 512 MB  | 30s     | Node.js 20 | x86_64 | Unreserved  |
| **Cognito Triggers**       | 3     | 256 MB  | 5-30s   | Node.js 20 | x86_64 | Unreserved  |
| **CDK Framework**          | 5     | 128 MB  | 900s    | Node.js 22 | x86_64 | Unreserved  |

**Total**: 66 Lambda functions

---

## 💡 Key Takeaways

1. **Account Limit (10) is the Bottleneck**: This is your primary constraint, not individual Lambda configuration.

2. **Current Config is Appropriate**: Memory, timeout, and architecture settings are well-tuned for their workloads.

3. **No Reserved Concurrency is Correct**: With only 10 total executions available, sharing is essential.

4. **SQS Provides Natural Buffering**: Queue-based processing prevents data loss during throttling.

5. **Cost is Negligible in Dev**: Processing pipeline costs ~$0.073 per 1000 files.

6. **Production Requires Limit Increase**: Request 1000 concurrent executions before scaling.

7. **Optimization Opportunities Exist**:
   - Image processor memory (50% reduction possible)
   - ARM64 for all functions (20% savings)
   - Right-sizing API Lambda memory (case-by-case)

---

## 🔗 Related Files

- **Infrastructure**: `infra/lib/api-lambda-stack.ts` (lines 104-559)
- **Image Processor**: `backend/services/image-processor/index.js`
- **Verification Processor**: `backend/services/verification-processor/index.js`
- **EventBridge Rules**: Lines 248-266 (images), 444-462 (verification)
- **SQS Queues**: Lines 191-222 (images), 410-442 (verification)
- **CloudWatch Alarms**: Lines 271-404 (images), 464-559 (verification)

---

**Last Updated**: 2025-10-31
