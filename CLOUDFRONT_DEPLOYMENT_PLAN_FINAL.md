# CloudFront Deployment Plan - Final Version

## Deployment Strategy: Infrastructure First, Then Code

This approach deploys CloudFront infrastructure first, then updates the code to use it. This is safer and allows testing at each step.

---

## Phase 1: Deploy CloudFront Infrastructure (30 minutes)

### Step 1: Deploy CloudFront Stack

```bash
cd /Users/markobabic/LocalDev/localstays-backend/infra

# Build CDK
npm run build

# Deploy CloudFront stack ONLY
npm run cdk -- deploy -c env=staging LocalstaysStagingCloudFrontStack --require-approval never
```

**What happens:**

1. CloudFront distribution is created
2. AWS assigns a domain (e.g., `d1234567890abc.cloudfront.net`)
3. S3 bucket policy is updated to allow CloudFront access
4. Origin Access Control (OAC) is configured

**Expected output:**

```
✅ LocalstaysStagingCloudFrontStack

Outputs:
LocalstaysStagingCloudFrontStack.DistributionId = E1234567890ABC
LocalstaysStagingCloudFrontStack.DistributionDomainName = d1234567890abc.cloudfront.net

Stack ARN:
arn:aws:cloudformation:eu-north-1:123456789012:stack/localstays-staging-cloudfront/...
```

**📝 SAVE THIS DOMAIN!** You'll need it for verification.

---

### Step 2: Verify CloudFront Distribution

```bash
# Check distribution status (should be "Deployed" after ~15 minutes)
aws cloudfront get-distribution \
  --id E1234567890ABC \
  --query 'Distribution.Status' \
  --output text \
  --region us-east-1

# Expected output: "Deployed"
```

**Wait for "Deployed" status before proceeding!**

---

### Step 3: Test CloudFront Access to S3

```bash
# Find an existing image in S3
aws s3 ls s3://localstays-staging-host-assets/ --recursive | grep "\.webp$" | head -5

# Example output:
# 2024-11-10 host_01HF123/listings/listing_01HF456/images/img_01HF789-full.webp

# Test CloudFront URL (replace with actual path)
curl -I https://d1234567890abc.cloudfront.net/host_01HF123/listings/listing_01HF456/images/img_01HF789-full.webp

# Expected response:
# HTTP/2 200
# content-type: image/webp
# x-cache: Miss from cloudfront (first request)
# x-amz-cf-id: ...

# Test again (should be cached)
curl -I https://d1234567890abc.cloudfront.net/host_01HF123/listings/listing_01HF456/images/img_01HF789-full.webp

# Expected response:
# HTTP/2 200
# x-cache: Hit from cloudfront
```

**✅ If you get HTTP 200, CloudFront is working!**

---

## Phase 2: Update Code to Use CloudFront (30 minutes)

### Step 4: Create CloudFront URL Builder Utility

Create `/Users/markobabic/LocalDev/localstays-backend/backend/services/api/lib/cloudfront-urls.ts`:

```typescript
/**
 * CloudFront URL Generation
 * Builds CDN URLs for listing images and profile photos with versioning
 */

const CLOUDFRONT_DOMAIN = process.env.CLOUDFRONT_DOMAIN!;
const USE_CLOUDFRONT = process.env.USE_CLOUDFRONT === "true";

/**
 * Build CloudFront URL from S3 key with versioning
 */
export function buildCloudFrontUrl(
  s3Key: string | undefined | null,
  updatedAt?: string
): string {
  if (!s3Key) {
    return "";
  }

  const cleanKey = s3Key.startsWith("/") ? s3Key.substring(1) : s3Key;
  const baseUrl = `https://${CLOUDFRONT_DOMAIN}/${cleanKey}`;

  if (updatedAt) {
    const version = new Date(updatedAt).getTime();
    return `${baseUrl}?v=${version}`;
  }

  return baseUrl;
}

/**
 * Build profile photo URLs with versioning
 */
export function buildProfilePhotoUrls(
  webpUrls?: { thumbnail?: string; full?: string },
  updatedAt?: string
) {
  if (!webpUrls) {
    return { thumbnailUrl: "", fullUrl: "" };
  }

  return {
    thumbnailUrl: buildCloudFrontUrl(webpUrls.thumbnail, updatedAt),
    fullUrl: buildCloudFrontUrl(webpUrls.full, updatedAt),
  };
}

/**
 * Build listing image URLs with versioning
 */
export function buildListingImageUrls(
  webpUrls?: { thumbnail?: string; full?: string },
  updatedAt?: string
) {
  if (!webpUrls) {
    return { thumbnailUrl: "", fullUrl: "" };
  }

  return {
    thumbnailUrl: buildCloudFrontUrl(webpUrls.thumbnail, updatedAt),
    fullUrl: buildCloudFrontUrl(webpUrls.full, updatedAt),
  };
}

/**
 * Build image URL with fallback to presigned URL
 * Used for rollback capability via USE_CLOUDFRONT flag
 */
export function buildImageUrl(
  s3Key: string | undefined | null,
  updatedAt?: string
): string {
  if (USE_CLOUDFRONT) {
    return buildCloudFrontUrl(s3Key, updatedAt);
  } else {
    const { generateDownloadUrl } = require("./s3-presigned");
    return generateDownloadUrl(s3Key || "");
  }
}
```

---

### Step 5: Update API Handlers

I'll provide the exact changes for each file. Let me know when you're ready and I'll help update:

1. `backend/services/api/hosts/get-profile.ts`
2. `backend/services/api/listings/get-listing.ts`
3. `backend/services/api/listings/list-listings.ts`
4. `backend/services/api/admin/requests/get-request.ts`
5. `backend/services/api/admin/listings/get-listing.ts`

---

## Phase 3: Deploy Updated API Stack (10 minutes)

### Step 6: Deploy API Stack with CloudFront Integration

```bash
cd /Users/markobabic/LocalDev/localstays-backend/infra

# Build (includes updated backend code)
npm run build

# Deploy API stack
npm run cdk -- deploy -c env=staging LocalstaysStagingApiStack --require-approval never
```

**What happens:**

1. Lambda functions are updated with new code
2. Environment variables are set:
   - `CLOUDFRONT_DOMAIN=d1234567890abc.cloudfront.net`
   - `USE_CLOUDFRONT=true`
3. API handlers now return CloudFront URLs instead of presigned URLs

**Expected output:**

```
✅ LocalstaysStagingApiStack

Outputs:
LocalstaysStagingApiStack.ApiEndpoint = https://tr8eo3kgec.execute-api.eu-north-1.amazonaws.com/staging/
```

---

## Phase 4: Testing (30 minutes)

### Step 7: Test API Endpoints Return CloudFront URLs

```bash
# Get auth token
TOKEN="your-staging-auth-token"

# Test host profile endpoint
curl -H "Authorization: Bearer $TOKEN" \
  https://tr8eo3kgec.execute-api.eu-north-1.amazonaws.com/staging/api/v1/hosts/profile \
  | jq '.profilePhoto'

# Expected output:
# {
#   "photoId": "photo_01HF...",
#   "thumbnailUrl": "https://d123.cloudfront.net/host123/profile/photo_thumbnail.webp?v=1699716600000",
#   "fullUrl": "https://d123.cloudfront.net/host123/profile/photo_full.webp?v=1699716600000",
#   ...
# }

# Test listings endpoint
curl -H "Authorization: Bearer $TOKEN" \
  https://tr8eo3kgec.execute-api.eu-north-1.amazonaws.com/staging/api/v1/listings \
  | jq '.listings[0].primaryImage'

# Expected output:
# {
#   "imageId": "img_01HF...",
#   "thumbnailUrl": "https://d123.cloudfront.net/host123/listings/listing_x/images/img_y-thumb.webp?v=..."
# }
```

**✅ If URLs start with `https://d123.cloudfront.net/`, it's working!**

---

### Step 8: Test Images Load in Browser

1. Copy a CloudFront URL from API response
2. Paste into browser
3. Image should load

**✅ If image loads, CloudFront is serving correctly!**

---

## Phase 5: Rollback Test (5 minutes)

### Step 9: Test Rollback to Presigned URLs

```bash
# Get Lambda function name
aws lambda list-functions \
  --query 'Functions[?contains(FunctionName, `hostListingsHandler`)].FunctionName' \
  --output text \
  --region eu-north-1

# Set USE_CLOUDFRONT=false
aws lambda update-function-configuration \
  --function-name <function-name-from-above> \
  --environment Variables='{
    "TABLE_NAME": "localstays-staging-main",
    "BUCKET_NAME": "localstays-staging-host-assets",
    "EMAIL_TEMPLATES_TABLE": "localstays-staging-email-templates",
    "SENDGRID_PARAM": "/localstays/staging/sendgrid-api-key",
    "FROM_EMAIL": "marko@localstays.me",
    "STAGE": "staging",
    "CLOUDFRONT_DOMAIN": "d123.cloudfront.net",
    "USE_CLOUDFRONT": "false"
  }' \
  --region eu-north-1

# Wait 30 seconds

# Test API - should return presigned URLs
curl -H "Authorization: Bearer $TOKEN" \
  https://tr8eo3kgec.execute-api.eu-north-1.amazonaws.com/staging/api/v1/hosts/profile \
  | jq '.profilePhoto.fullUrl'

# Expected: S3 presigned URL with X-Amz-Algorithm, X-Amz-Expires, etc.

# Re-enable CloudFront
aws lambda update-function-configuration \
  --function-name <function-name> \
  --environment Variables='{..., "USE_CLOUDFRONT": "true"}' \
  --region eu-north-1
```

**✅ Rollback works! You have a kill switch.**

---

## Phase 6: Monitor (1 week)

### Step 10: Set Up CloudWatch Alarms

```bash
# Create alarm for high bandwidth
aws cloudwatch put-metric-alarm \
  --alarm-name "CloudFront-Staging-High-Bandwidth" \
  --alarm-description "Alert when CloudFront bandwidth exceeds 10GB/day" \
  --metric-name BytesDownloaded \
  --namespace AWS/CloudFront \
  --statistic Sum \
  --period 86400 \
  --threshold 10737418240 \
  --comparison-operator GreaterThanThreshold \
  --evaluation-periods 1 \
  --dimensions Name=DistributionId,Value=E1234567890ABC \
  --region us-east-1
```

### Step 11: Daily Monitoring (1 week)

**Check daily:**

- [ ] CloudWatch metrics (bandwidth, requests, errors)
- [ ] Cost Explorer (CloudFront costs should be ~$0.50-1/day for staging)
- [ ] Frontend - verify images load correctly
- [ ] No broken images reported

---

## Summary: Deployment Flow

```
┌─────────────────────────────────────────────────────────┐
│ Phase 1: Deploy CloudFront Infrastructure              │
│ - CloudFront distribution created                      │
│ - AWS assigns domain: d123.cloudfront.net              │
│ - S3 bucket policy updated                             │
│ - Test: curl CloudFront URL → HTTP 200                 │
└─────────────────────────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────┐
│ Phase 2: Update Code                                    │
│ - Create cloudfront-urls.ts                            │
│ - Update 5 API handlers                                │
│ - Code references CLOUDFRONT_DOMAIN env var            │
└─────────────────────────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────┐
│ Phase 3: Deploy API Stack                              │
│ - CDK passes CloudFront domain to Lambda env vars      │
│ - CLOUDFRONT_DOMAIN=d123.cloudfront.net                │
│ - USE_CLOUDFRONT=true                                  │
│ - Lambda functions updated with new code               │
└─────────────────────────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────┐
│ Phase 4: Testing                                        │
│ - API returns CloudFront URLs                          │
│ - Images load via CloudFront                           │
│ - Rollback test works                                  │
└─────────────────────────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────┐
│ Phase 5: Monitor (1 week)                              │
│ - Daily checks                                         │
│ - Verify costs                                         │
│ - No issues → Deploy to production                     │
└─────────────────────────────────────────────────────────┘
```

---

## Key Points

**✅ CloudFront domain is automatically injected:**

- CDK captures the domain from CloudFront stack
- Passes it to API stack as a prop
- API stack sets it as Lambda environment variable
- No manual configuration needed!

**✅ Deployment order is correct:**

1. Storage (S3)
2. CloudFront (CDN)
3. API (Lambda functions)

**✅ Code changes happen BETWEEN CloudFront and API deployments:**

- Deploy CloudFront first
- Update code to use CloudFront URLs
- Deploy API stack with updated code

**✅ Rollback is instant:**

- Set `USE_CLOUDFRONT=false` (30 seconds)
- Falls back to presigned URLs
- No code changes needed

---

## Next Steps

**Ready to start?**

1. Deploy CloudFront stack
2. Let me know the CloudFront domain from output
3. I'll help update the 5 API handlers
4. Deploy API stack
5. Test together

---

**Document Version:** 2.0  
**Last Updated:** 2025-11-11  
**Status:** ✅ Ready to Execute



