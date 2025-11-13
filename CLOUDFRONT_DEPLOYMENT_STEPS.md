# CloudFront Deployment Steps for Staging

## Phase 1: Deploy CloudFront Infrastructure (30 minutes)

### Step 1: Build and Deploy CloudFront Stack

```bash
cd /Users/markobabic/LocalDev/localstays-backend/infra

# Build TypeScript
npm run build

# Deploy CloudFront stack only
npm run cdk -- deploy -c env=staging LocalstaysStagingCloudFrontStack --require-approval never
```

**What this does:**

- Creates CloudFront distribution
- Sets up Origin Access Control (OAC) for S3
- Configures path-based behaviors for `/*/listings/*/images/*.webp` and `/*/profile/*.webp`
- Sets 365-day cache TTL
- Updates S3 bucket policy to allow CloudFront access

**Expected output:**

```
✅ LocalstaysStagingCloudFrontStack

Outputs:
LocalstaysStagingCloudFrontStack.DistributionId = E1234567890ABC
LocalstaysStagingCloudFrontStack.DistributionDomainName = d1234567890abc.cloudfront.net
```

**Save the CloudFront domain!** You'll need it for the next step.

---

## Phase 2: Create CloudFront URL Builder (10 minutes)

### Step 2: Create `cloudfront-urls.ts` utility

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
 *
 * @param s3Key - S3 object key (e.g., "host123/profile/photo_full.webp")
 * @param updatedAt - ISO timestamp from DynamoDB (e.g., "2024-11-11T15:30:00.000Z")
 * @returns CloudFront URL with version (e.g., "https://d123.cloudfront.net/host123/profile/photo_full.webp?v=1699716600000")
 */
export function buildCloudFrontUrl(
  s3Key: string | undefined | null,
  updatedAt?: string
): string {
  if (!s3Key) {
    return "";
  }

  // Remove leading slash if present
  const cleanKey = s3Key.startsWith("/") ? s3Key.substring(1) : s3Key;

  // Build base CloudFront URL
  const baseUrl = `https://${CLOUDFRONT_DOMAIN}/${cleanKey}`;

  // Add version parameter from updatedAt timestamp
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
    return {
      thumbnailUrl: "",
      fullUrl: "",
    };
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
    return {
      thumbnailUrl: "",
      fullUrl: "",
    };
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
    // Fallback to presigned URL (requires s3-presigned.ts import)
    const { generateDownloadUrl } = require("./s3-presigned");
    return generateDownloadUrl(s3Key || "");
  }
}

/**
 * Validate CloudFront domain is configured
 */
export function validateCloudFrontConfig(): void {
  if (USE_CLOUDFRONT && !CLOUDFRONT_DOMAIN) {
    throw new Error(
      "CLOUDFRONT_DOMAIN environment variable is not set when USE_CLOUDFRONT=true"
    );
  }
}
```

---

## Phase 3: Update API Handlers (30 minutes)

### Files to Update:

1. `backend/services/api/hosts/get-profile.ts`
2. `backend/services/api/listings/get-listing.ts`
3. `backend/services/api/listings/list-listings.ts`
4. `backend/services/api/admin/requests/get-request.ts`
5. `backend/services/api/admin/listings/get-listing.ts`

**I'll provide the specific changes for each file in the next step.**

---

## Phase 4: Deploy Updated Lambda Functions (10 minutes)

### Step 3: Deploy API Stack with CloudFront Integration

```bash
cd /Users/markobabic/LocalDev/localstays-backend/infra

# Deploy API stack (includes CloudFront domain env var)
npm run cdk -- deploy -c env=staging LocalstaysStagingApiStack --require-approval never
```

**What this does:**

- Updates Lambda functions with `CLOUDFRONT_DOMAIN` environment variable
- Sets `USE_CLOUDFRONT=true` by default
- Deploys updated API handlers with CloudFront URL generation

---

## Phase 5: Testing (30 minutes)

### Step 4: Verify CloudFront Distribution

```bash
# Get CloudFront distribution details
aws cloudfront get-distribution --id E1234567890ABC --region us-east-1

# Check distribution status (should be "Deployed")
aws cloudfront get-distribution --id E1234567890ABC --query 'Distribution.Status' --output text --region us-east-1
```

### Step 5: Test CloudFront URLs Manually

```bash
# Test profile photo URL (replace with actual values from staging)
curl -I https://d1234567890abc.cloudfront.net/host_01234567890/profile/photo_full.webp

# Expected response:
# HTTP/2 200
# content-type: image/webp
# x-cache: Miss from cloudfront (first request)
# x-amz-cf-id: ...

# Test again (should be cached)
curl -I https://d1234567890abc.cloudfront.net/host_01234567890/profile/photo_full.webp

# Expected response:
# HTTP/2 200
# x-cache: Hit from cloudfront
```

### Step 6: Test API Endpoints

```bash
# Get auth token first
TOKEN="your-staging-auth-token"

# Test host profile endpoint
curl -H "Authorization: Bearer $TOKEN" \
  https://tr8eo3kgec.execute-api.eu-north-1.amazonaws.com/staging/api/v1/hosts/profile

# Verify response contains CloudFront URLs:
# "profilePhoto": {
#   "thumbnailUrl": "https://d123.cloudfront.net/host123/profile/photo_thumbnail.webp?v=1699716600000",
#   "fullUrl": "https://d123.cloudfront.net/host123/profile/photo_full.webp?v=1699716600000"
# }
```

---

## Phase 6: Rollback Test (5 minutes)

### Step 7: Test Rollback to Presigned URLs

```bash
# Set USE_CLOUDFRONT=false
aws lambda update-function-configuration \
  --function-name LocalstaysStagingApiStack-hostListingsHandler... \
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

# Wait 30 seconds for Lambda to update

# Test API again - should return presigned URLs
curl -H "Authorization: Bearer $TOKEN" \
  https://tr8eo3kgec.execute-api.eu-north-1.amazonaws.com/staging/api/v1/hosts/profile

# Verify response contains S3 presigned URLs (not CloudFront)

# Rollback the rollback (re-enable CloudFront)
aws lambda update-function-configuration \
  --function-name LocalstaysStagingApiStack-hostListingsHandler... \
  --environment Variables='{
    ...
    "USE_CLOUDFRONT": "true"
  }' \
  --region eu-north-1
```

---

## Phase 7: Monitor (1 week)

### Step 8: Set Up Monitoring

```bash
# Create CloudWatch alarm for high bandwidth
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
  --alarm-actions arn:aws:sns:eu-north-1:123456789012:bandwidth-alerts \
  --region us-east-1
```

### Step 9: Daily Monitoring Checklist

**For 1 week, check daily:**

- [ ] CloudWatch metrics (bandwidth, requests, errors)
- [ ] Cost Explorer (CloudFront costs)
- [ ] Frontend - verify images load correctly
- [ ] No broken images reported

---

## Deployment Summary

| Phase                | Time   | Command                                       |
| -------------------- | ------ | --------------------------------------------- |
| 1. Deploy CloudFront | 30 min | `cdk deploy LocalstaysStagingCloudFrontStack` |
| 2. Create utility    | 10 min | Create `cloudfront-urls.ts`                   |
| 3. Update handlers   | 30 min | Update 5 API files                            |
| 4. Deploy API        | 10 min | `cdk deploy LocalstaysStagingApiStack`        |
| 5. Testing           | 30 min | Manual tests                                  |
| 6. Rollback test     | 5 min  | Test `USE_CLOUDFRONT=false`                   |
| 7. Monitor           | 1 week | Daily checks                                  |

**Total active time:** ~2 hours  
**Total monitoring:** 1 week

---

## Troubleshooting

### Issue: CloudFront returns 403 Forbidden

**Cause:** S3 bucket policy not updated correctly

**Fix:**

```bash
# Check S3 bucket policy
aws s3api get-bucket-policy --bucket localstays-staging-host-assets

# Should include CloudFront service principal
```

### Issue: Images not loading (404)

**Cause:** S3 keys don't match CloudFront path patterns

**Fix:**

- Verify S3 keys follow pattern: `{hostId}/listings/{listingId}/images/*.webp`
- Check CloudFront behaviors are configured correctly

### Issue: Old images showing after update

**Cause:** Cache not invalidated, versioning not working

**Fix:**

- Verify `updatedAt` timestamp is being passed to `buildCloudFrontUrl()`
- Check URL includes `?v=` parameter

---

## Next Steps After 1 Week

If staging is successful:

1. Deploy to production
2. Enable web app WAF with geo-blocking
3. Monitor closely for 48 hours
4. Update frontend config with production CloudFront domain

---

**Document Version:** 1.0  
**Last Updated:** 2025-11-11  
**Status:** ✅ Ready to Execute



