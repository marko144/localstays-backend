# IMAGE PROCESSING PIPELINE - DEPLOYMENT SUMMARY

**Date:** 2025-10-29  
**Status:** ✅ **SUCCESSFULLY DEPLOYED**

---

## 🎉 DEPLOYMENT COMPLETE

All infrastructure and Lambda functions have been successfully deployed to AWS!

### ✅ What Was Deployed:

1. **SQS Queues**

   - Main processing queue: `dev1-image-processing-queue`
   - Dead letter queue: `dev1-image-processing-dlq`
   - Visibility timeout: 3 minutes
   - Long polling enabled (20 seconds)

2. **ECR Repository**

   - Repository: `dev1-localstays-image-processor`
   - Docker image pushed: `041608526793.dkr.ecr.eu-north-1.amazonaws.com/dev1-localstays-image-processor:latest`
   - Platform: ARM64
   - Size: ~1.5 GB (includes libheif for HEIC support)

3. **Lambda Function**

   - Function name: `dev1-image-processor`
   - Runtime: Container Image (Node.js 20)
   - Architecture: ARM64
   - Memory: 2048 MB
   - Timeout: 90 seconds
   - State: **Active**
   - Event source: SQS queue
   - Batch size: 1 message at a time

4. **EventBridge Rule**

   - Rule name: `dev1-guardduty-scan-complete`
   - Event source: GuardDuty Malware Protection
   - Target: SQS queue
   - Filters: Only objects in `*/listings/*/staging/` path

5. **CloudWatch Alarms**

   - `dev1-image-queue-backlog` - Queue size > 50
   - `dev1-image-queue-old-messages` - Message age > 10 minutes
   - `dev1-image-dlq-messages` - Any messages in DLQ
   - `dev1-image-processor-errors` - Error rate > 5%
   - `dev1-image-processor-throttles` - Throttles > 10 in 5 minutes

6. **IAM Roles & Policies**
   - Lambda execution role with S3 read/write
   - DynamoDB read/write permissions
   - SQS message consumption permissions
   - CloudWatch Logs permissions

---

## 📋 DEPLOYMENT ISSUES ENCOUNTERED & RESOLVED

### Issue 1: Docker Image Manifest Not Supported

**Error:** `The image manifest, config or layer media type for the source image is not supported`

**Cause:** Docker buildx was creating multi-platform manifests by default

**Solution:** Rebuilt with `--provenance=false --sbom=false` flags to create single-platform ARM64 image

```bash
docker build --platform linux/arm64 --provenance=false --sbom=false -t dev1-localstays-image-processor:latest .
```

### Issue 2: Reserved Concurrency Limit

**Error:** `ReservedConcurrentExecutions decreases account's UnreservedConcurrentExecution below minimum of 10`

**Cause:** AWS account has total concurrent execution limit of only **10** (not 1000 like most accounts)

**Solution:** Removed `reservedConcurrentExecutions` entirely. SQS queue provides natural backpressure, and account-level limits prevent runaway costs.

---

## 🚨 MANUAL STEPS REQUIRED (NOT YET COMPLETE)

### Step 1: Enable GuardDuty Malware Protection

You must manually enable GuardDuty Malware Protection for S3 in the AWS Console:

1. Go to **AWS Console → GuardDuty → Protection plans**
2. Navigate to **Malware Protection for S3**
3. Click **Configure**
4. Enable scanning for bucket: `localstays-dev1-host-assets`
5. Configure to scan objects in path pattern: `*/listings/*/staging/*`
6. Save configuration

**Important:** GuardDuty must be enabled before the pipeline will work!

### Step 2: Verify Event Flow

After enabling GuardDuty, test the event flow:

1. Upload a test image to: `s3://localstays-dev1-host-assets/<hostId>/listings/<listingId>/staging/<imageId>.jpg`
2. Check GuardDuty triggers scan
3. Check EventBridge rule catches scan completion event
4. Check SQS queue receives message
5. Check Lambda processes message
6. Check CloudWatch logs for Lambda execution

---

## 📊 MONITORING & TROUBLESHOOTING

### CloudWatch Log Groups

- **Lambda logs**: `/aws/lambda/dev1-image-processor`
- Check for:
  - Image processing duration
  - Sharp library errors
  - S3 upload/download errors
  - DynamoDB write errors

### SQS Queue Metrics

Monitor in CloudWatch:

- `ApproximateNumberOfMessagesVisible` - Queue backlog
- `ApproximateAgeOfOldestMessage` - Message processing lag
- `NumberOfMessagesSent` - GuardDuty events received
- `NumberOfMessagesDeleted` - Successfully processed

### Lambda Metrics

Monitor in CloudWatch:

- `Invocations` - How many images processed
- `Errors` - Processing failures
- `Duration` - Processing time per image
- `Throttles` - Should be 0 (if not, account limit reached)
- `ConcurrentExecutions` - Max is 10 (account limit)

---

## 🔧 TESTING CHECKLIST

### Before Production:

- [ ] Enable GuardDuty Malware Protection
- [ ] Upload EICAR test file to verify malware detection works
- [ ] Upload real HEIC image from iPhone
- [ ] Verify WebP conversion works
- [ ] Verify thumbnail generation works
- [ ] Verify clean images get status = READY
- [ ] Verify infected images get status = QUARANTINED
- [ ] Check S3 paths are correct:
  - Staging: `{hostId}/listings/{listingId}/staging/{imageId}.ext`
  - Processed: `{hostId}/listings/{listingId}/images/{imageId}_full.webp`
  - Thumbnail: `{hostId}/listings/{listingId}/images/{imageId}_thumb.webp`
  - Quarantine: `{hostId}/listings/{listingId}/staging/quarantine/{imageId}.ext`

---

## 💰 COST ESTIMATES

Based on 1,000 image uploads/month:

| Service                          | Usage                       | Cost/Month       |
| -------------------------------- | --------------------------- | ---------------- |
| **GuardDuty Malware Protection** | 1,000 scans                 | $1.00            |
| **Lambda (2048 MB, 90s avg)**    | 1,000 invocations @ 30s avg | $0.10            |
| **SQS**                          | 1,000 messages              | $0.00            |
| **ECR Storage**                  | 1.5 GB                      | $0.07            |
| **CloudWatch Logs**              | 100 MB                      | $0.05            |
| **S3 Storage**                   | 10 GB images                | $0.23            |
| **S3 Requests**                  | 3,000 PUT/GET               | $0.02            |
| **EventBridge**                  | 1,000 events                | $0.00            |
| **CloudWatch Alarms**            | 5 alarms                    | $0.50            |
| **TOTAL**                        |                             | **~$2.00/month** |

For 10,000 uploads/month: **~$11/month**

---

## 📝 IMPORTANT NOTES

### Account Limitations:

- **Lambda concurrent executions**: 10 (account-wide limit)
- This means all Lambdas in the account share this pool
- No reserved concurrency can be used
- SQS queue provides natural rate limiting

### Image Processing:

- **Supported formats**: JPEG, PNG, GIF, HEIC, WebP
- **Output format**: WebP @ 85% quality
- **Thumbnail size**: 400px (longest edge, maintains aspect ratio)
- **Max processing time**: 90 seconds
- **Memory**: 2048 MB (required for large images)

### S3 Path Structure:

```
{hostId}/
  └── listings/
      └── {listingId}/
          ├── staging/               # Upload here (GuardDuty scans)
          │   ├── {imageId}.jpg
          │   └── quarantine/        # Infected files moved here
          │       └── {imageId}.jpg
          └── images/                # Processed files
              ├── {imageId}_full.webp    # Full size
              └── {imageId}_thumb.webp   # 400px thumbnail
```

---

## 🎯 NEXT STEPS

1. **Enable GuardDuty** (manual - see above)
2. **Test image upload** to staging folder
3. **Monitor Lambda logs** during first test
4. **Verify E2E flow** works correctly
5. **Update frontend** to use new WebP URLs
6. **Document for team**

---

## 📚 RESOURCES

- **Lambda function**: `dev1-image-processor`
- **ECR repository**: `041608526793.dkr.ecr.eu-north-1.amazonaws.com/dev1-localstays-image-processor`
- **SQS queue**: `dev1-image-processing-queue`
- **S3 bucket**: `localstays-dev1-host-assets`
- **CloudWatch logs**: `/aws/lambda/dev1-image-processor`
- **Implementation tracker**: `IMAGE_PROCESSING_IMPLEMENTATION.md`
- **Version analysis**: `IMAGE_PROCESSING_VERSIONS.md`

---

**Deployment completed successfully! 🚀**
