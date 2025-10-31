# 📊 DEPLOYMENT STATUS - Image Processing Pipeline

**Environment:** dev1  
**Last Updated:** 2025-10-30 14:10 UTC  
**Status:** 🟢 **DEPLOYED & READY FOR TESTING**

---

## 🎯 WHAT'S DEPLOYED

### ✅ Infrastructure (AWS Resources)

All infrastructure is **deployed and active** in `eu-north-1`:

| Component                        | Status    | ARN/Name                          |
| -------------------------------- | --------- | --------------------------------- |
| **S3 Bucket**                    | ✅ Active | `localstays-dev1-host-assets`     |
| **DynamoDB Table**               | ✅ Active | `localstays-dev1`                 |
| **SQS Queue**                    | ✅ Active | `dev1-image-processing-queue`     |
| **SQS DLQ**                      | ✅ Active | `dev1-image-processing-dlq`       |
| **ECR Repository**               | ✅ Active | `dev1-localstays-image-processor` |
| **EventBridge Rule**             | ✅ Active | `dev1-guardduty-scan-complete`    |
| **Image Processor Lambda**       | ✅ Active | `dev1-image-processor`            |
| **CloudWatch Alarms**            | ✅ Active | 5 alarms configured               |
| **GuardDuty Malware Protection** | ✅ Active | Monitoring S3 bucket              |

### ✅ Lambda Functions

| Lambda                       | Version | Last Deploy      | Status                         |
| ---------------------------- | ------- | ---------------- | ------------------------------ |
| `dev1-submit-listing-intent` | Latest  | 2025-10-30 14:10 | ✅ Updated (staging folder)    |
| `dev1-get-listing`           | Latest  | 2025-10-29       | ✅ Updated (WebP support)      |
| `dev1-list-listings`         | Latest  | 2025-10-29       | ✅ Updated (thumbnail support) |
| `dev1-image-processor`       | Latest  | 2025-10-29 21:13 | ✅ Deployed (container)        |

### ✅ Docker Image

| Component           | Status      | Details                           |
| ------------------- | ----------- | --------------------------------- |
| **Base Image**      | ✅ Built    | `public.ecr.aws/lambda/nodejs:20` |
| **Architecture**    | ✅ ARM64    | Optimized for Lambda              |
| **Sharp Version**   | ✅ 0.33.5   | Latest stable                     |
| **libheif Version** | ✅ 1.19.5   | HEIC support                      |
| **AWS SDK**         | ✅ 3.709.0  | Latest v3                         |
| **Image Size**      | ✅ ~250MB   | Compressed                        |
| **ECR Tag**         | ✅ `latest` | Pushed successfully               |

---

## 🔧 CONFIGURATION

### Lambda Configuration

```yaml
Function Name: dev1-image-processor
Runtime: nodejs:20 (Container)
Architecture: ARM64
Memory: 2048 MB
Timeout: 90 seconds
Reserved Concurrency: None (account limit)
Handler: index.handler (from container)
```

### SQS Configuration

```yaml
Queue Name: dev1-image-processing-queue
Visibility Timeout: 180 seconds (3 minutes)
Retention Period: 4 days
Receive Wait Time: 20 seconds (long polling)
Max Receives: 3 (then → DLQ)
Batch Size: 1 message per Lambda invocation
```

### GuardDuty Configuration

```yaml
Service: GuardDuty Malware Protection for S3
Monitored Bucket: localstays-dev1-host-assets
Scan Path: */listings/*/staging/*
Event Target: EventBridge → SQS
Status: Active
```

### S3 Path Structure

```
hostId/
  listings/
    listingId/
      staging/           ← NEW: Images uploaded here first
        imageId.heic
        imageId.jpg
      quarantine/        ← NEW: Infected files moved here
        imageId.heic
      images/            ← NEW: Processed images stored here
        imageId-full.webp
        imageId-thumb.webp
      verification/
        address-verification-requestId.pdf
        property-video-requestId.mp4
```

---

## 📊 MONITORING

### CloudWatch Alarms

| Alarm                | Threshold                  | Action |
| -------------------- | -------------------------- | ------ |
| **Queue Backlog**    | >10 messages for 5 minutes | Alert  |
| **Old Messages**     | Messages >15 minutes old   | Alert  |
| **DLQ Messages**     | ≥1 message in DLQ          | Alert  |
| **Lambda Errors**    | Error rate >5%             | Alert  |
| **Lambda Throttles** | Any throttle               | Alert  |

### Log Groups

- `/aws/lambda/dev1-image-processor` - Image processing logs
- `/aws/lambda/dev1-submit-listing-intent` - Upload logs
- `/aws/events/guardduty-malware` - GuardDuty events (via EventBridge)

---

## 🚀 DEPLOYMENT FLOW (COMPLETE)

### Step 1: Infrastructure ✅

```bash
npx cdk deploy LocalstaysDev1ApiStack -c env=dev1
```

- Created SQS queues, ECR, EventBridge rule, CloudWatch alarms
- Lambda commented out (ECR image doesn't exist yet)

### Step 2: Docker Build & Push ✅

```bash
cd backend/services/image-processor
docker build --platform linux/arm64 -t dev1-localstays-image-processor:latest .
aws ecr get-login-password --region eu-north-1 | docker login --username AWS --password-stdin 041608526793.dkr.ecr.eu-north-1.amazonaws.com
docker tag dev1-localstays-image-processor:latest 041608526793.dkr.ecr.eu-north-1.amazonaws.com/dev1-localstays-image-processor:latest
docker push 041608526793.dkr.ecr.eu-north-1.amazonaws.com/dev1-localstays-image-processor:latest
```

- Built Docker image with libheif + Sharp
- Pushed to ECR

### Step 3: Lambda Deployment ✅

```bash
# Uncommented Lambda in CDK
npx cdk deploy LocalstaysDev1ApiStack -c env=dev1
```

- Deployed Lambda function from ECR image
- Connected SQS event source
- Configured permissions

### Step 4: GuardDuty Setup ✅

- Manually enabled GuardDuty Malware Protection via AWS Console
- Configured S3 bucket protection
- Set scan path pattern

### Step 5: Staging Folder Update ✅

```bash
# Updated submit-intent.ts to use staging/ folder
npx cdk deploy LocalstaysDev1ApiStack -c env=dev1
```

- Images now upload to `staging/` folder
- Status set to `PENDING_UPLOAD`

---

## 🧪 WHAT'S READY TO TEST

### Test Scenario 1: Normal Image Upload ✅ READY

1. Create a new listing from frontend
2. Upload an image (JPEG, PNG, HEIC, etc.)
3. **Expected behavior:**
   - Image uploads to `{hostId}/listings/{listingId}/staging/{imageId}.ext`
   - DynamoDB record created with `status: PENDING_UPLOAD`
   - After upload, status → `UPLOADED`
   - GuardDuty scans the file (~2-5 minutes)
   - EventBridge catches `COMPLETED` event
   - SQS receives message
   - Lambda processes:
     - Converts to WebP (full + thumbnail)
     - Saves to `images/` folder
     - Updates DynamoDB: `status: READY`, adds `webpUrls`
     - Deletes staging file

### Test Scenario 2: Malware Upload ✅ READY

1. Upload a malicious file (or EICAR test file)
2. **Expected behavior:**
   - GuardDuty detects malware
   - Lambda moves file to `quarantine/`
   - DynamoDB record created: `MALWARE#timestamp`
   - Image status → `QUARANTINED`

### Test Scenario 3: API Retrieval ✅ READY

1. Call `GET /api/v1/listings/{listingId}`
2. **Expected behavior:**
   - Only returns images with `status: READY`
   - Returns `thumbnailUrl` and `fullUrl` (WebP)
   - Includes image dimensions

---

## 🔍 HOW TO MONITOR

### Check SQS Queue

```bash
aws sqs get-queue-attributes \
  --queue-url https://sqs.eu-north-1.amazonaws.com/041608526793/dev1-image-processing-queue \
  --attribute-names All
```

### Check Lambda Logs

```bash
aws logs tail /aws/lambda/dev1-image-processor --follow
```

### Check GuardDuty Findings

```bash
aws guardduty list-findings \
  --detector-id <detector-id> \
  --finding-criteria '{"Criterion":{"service.additionalInfo.threatListName":{"Eq":["GuardDuty Malware Protection"]}}}'
```

### Check DynamoDB Image Records

```bash
aws dynamodb query \
  --table-name localstays-dev1 \
  --key-condition-expression "pk = :pk AND begins_with(sk, :sk)" \
  --expression-attribute-values '{":pk":{"S":"HOST#<hostId>"},":sk":{"S":"LISTING_IMAGE#"}}'
```

---

## ⚠️ KNOWN ISSUES & LIMITATIONS

### 1. Reserved Concurrency Removed

- **Issue:** AWS account has concurrency limit of 10 total
- **Impact:** Lambda can scale to account limit
- **Mitigation:** SQS queue buffers requests

### 2. GuardDuty Scan Delay

- **Issue:** Scans take 2-5 minutes per file
- **Impact:** Images not immediately available
- **Mitigation:** Frontend should poll for `status: READY`

### 3. Legacy Images

- **Issue:** Existing images don't have WebP versions
- **Impact:** API falls back to `s3Url`
- **Mitigation:** API includes fallback logic

---

## 📈 COST ESTIMATE (Per Month)

| Service                | Usage            | Cost              |
| ---------------------- | ---------------- | ----------------- |
| **GuardDuty Scans**    | 1000 scans       | $0.40             |
| **Lambda Invocations** | 1000 runs        | $0.20             |
| **Lambda Compute**     | 90s × 2GB × 1000 | $3.00             |
| **SQS Requests**       | 10,000 requests  | $0.00 (free tier) |
| **ECR Storage**        | 250 MB image     | $0.03             |
| **S3 Storage**         | 10 GB images     | $0.23             |
| **CloudWatch Alarms**  | 5 alarms         | $0.50             |
| **EventBridge**        | 1000 events      | $0.00 (free tier) |
| **Total**              |                  | **~$4.36/month**  |

For 10,000 images/month: **~$43.60/month**

---

## 🎯 NEXT STEPS

### Immediate Testing (You):

1. ✅ Upload a test image from frontend
2. ✅ Monitor CloudWatch logs for Lambda
3. ✅ Check SQS queue for messages
4. ✅ Verify file appears in staging/, then images/
5. ✅ Confirm API returns WebP URLs

### Future Enhancements (Later):

- [ ] Add progress indicator in frontend
- [ ] Add bulk image migration script
- [ ] Add admin dashboard for quarantined images
- [ ] Add image optimization metrics
- [ ] Consider Lambda Provisioned Concurrency for faster cold starts

---

## 📚 REFERENCE LINKS

- **Implementation Progress:** `IMAGE_PROCESSING_IMPLEMENTATION.md`
- **Deployment Guide:** `IMAGE_PROCESSING_DEPLOYMENT.md`
- **Version Info:** `IMAGE_PROCESSING_VERSIONS.md`
- **Docker Build:** `backend/services/image-processor/README.md`

---

**🎉 STATUS: READY FOR PRODUCTION TESTING!**
