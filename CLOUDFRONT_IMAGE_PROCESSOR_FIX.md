# CloudFront Image Processor Fix - S3 Keys vs Full URLs

**Date:** 2025-11-11  
**Environment:** Staging  
**Status:** ✅ Fixed and Deployed

---

## Problem

CloudFront URLs were not loading correctly. Investigation revealed that the image processor was storing **full S3 URLs** in the `webpUrls` field instead of just the S3 keys.

### Example of Incorrect Data

```json
{
  "webpUrls": {
    "full": "https://localstays-staging-host-assets.s3.eu-north-1.amazonaws.com/host_xxx/listings/listing_xxx/images/xxx-full.webp",
    "thumbnail": "https://localstays-staging-host-assets.s3.eu-north-1.amazonaws.com/host_xxx/listings/listing_xxx/images/xxx-thumb.webp"
  }
}
```

### What Was Happening

1. Image processor stored full S3 URLs in DynamoDB
2. `buildCloudFrontUrl()` received these URLs and tried to build CloudFront URLs from them
3. Result: `https://dz45r0splw6d0.cloudfront.net/https://localstays-staging-host-assets.s3.eu-north-1.amazonaws.com/...` (double URL!)
4. Frontend received malformed URLs that didn't load

---

## Root Cause

In `backend/services/image-processor/index.js`, lines 377-379 were constructing full S3 URLs:

```javascript
// INCORRECT (OLD CODE)
const fullUrl = `https://${bucket}.s3.${process.env.AWS_REGION}.amazonaws.com/${fullS3Key}`;
const thumbnailUrl = `https://${bucket}.s3.${process.env.AWS_REGION}.amazonaws.com/${thumbnailS3Key}`;

await docClient.send(
  new UpdateCommand({
    // ...
    ExpressionAttributeValues: {
      ":webpUrls": {
        full: fullUrl, // ❌ Full URL stored
        thumbnail: thumbnailUrl, // ❌ Full URL stored
      },
    },
  })
);
```

This was problematic because:

- CloudFront URLs should be built dynamically in the API layer
- Storing full S3 URLs makes it impossible to switch CDN providers or change bucket configurations
- The `buildCloudFrontUrl()` function expected S3 keys, not full URLs

---

## Solution

### The Proper Fix (Implemented)

**Modified Files:**

1. `backend/services/image-processor/index.js` (lines 377-405)
2. `backend/services/image-processor/index.js` (lines 524-557 for profile photos)
3. `backend/services/image-processor/index.js` (lines 560-586 for HOST META record)

**Changes:**

- Store **S3 keys only** in `webpUrls` fields
- CloudFront URLs are built dynamically in API handlers using `buildCloudFrontUrl()`
- This makes the system flexible and allows easy CDN switching

```javascript
// CORRECT (NEW CODE)
// 9. Store S3 keys (not full URLs) for CloudFront compatibility
// CloudFront URLs will be built dynamically in the API layer

await docClient.send(
  new UpdateCommand({
    // ...
    ExpressionAttributeValues: {
      ":webpUrls": {
        full: fullS3Key, // ✅ S3 key only
        thumbnail: thumbnailS3Key, // ✅ S3 key only
      },
    },
  })
);
```

### Example of Correct Data (New Images)

```json
{
  "webpUrls": {
    "full": "host_xxx/listings/listing_xxx/images/xxx-full.webp",
    "thumbnail": "host_xxx/listings/listing_xxx/images/xxx-thumb.webp"
  }
}
```

---

## Deployment Steps

### 1. Updated Image Processor Code

```bash
cd backend/services/image-processor
# Modified index.js to store S3 keys instead of full URLs
```

### 2. Rebuilt Docker Image

```bash
docker build \
  --platform linux/arm64 \
  --provenance=false \
  --sbom=false \
  -t staging-localstays-image-processor:latest \
  .
```

### 3. Tagged and Pushed to ECR

```bash
docker tag staging-localstays-image-processor:latest \
  041608526793.dkr.ecr.eu-north-1.amazonaws.com/staging-localstays-image-processor:latest

aws ecr get-login-password --region eu-north-1 | \
  docker login --username AWS --password-stdin \
  041608526793.dkr.ecr.eu-north-1.amazonaws.com

docker push 041608526793.dkr.ecr.eu-north-1.amazonaws.com/staging-localstays-image-processor:latest
```

### 4. Updated Lambda Function

```bash
aws lambda update-function-code \
  --region eu-north-1 \
  --function-name staging-image-processor \
  --image-uri 041608526793.dkr.ecr.eu-north-1.amazonaws.com/staging-localstays-image-processor:latest
```

### 5. Redeployed API Stack

```bash
cd infra
npm run build
npm run cdk -- deploy -c env=staging LocalstaysStagingApiStack --require-approval never
```

---

## Impact on Existing Data

### Existing Images (Before Fix)

- Still have full S3 URLs in DynamoDB
- `buildCloudFrontUrl()` now handles these gracefully (extracts S3 key from URL)
- **No reprocessing required** - existing images will continue to work

### New Images (After Fix)

- Will store S3 keys only
- CloudFront URLs built dynamically
- Cleaner, more flexible architecture

---

## Testing

### Test New Image Upload

1. Upload a new listing image
2. Verify DynamoDB `webpUrls` contains S3 keys (not full URLs)
3. Verify API returns correct CloudFront URLs
4. Verify images load in frontend

### Test Existing Images

1. Check admin listing details for existing listing
2. Verify CloudFront URLs are correctly built from existing full URLs
3. Verify images load in frontend

---

## Related Files

- `backend/services/image-processor/index.js` - Image processor Lambda
- `backend/services/api/lib/cloudfront-urls.ts` - CloudFront URL builder
- `backend/services/api/admin/listings/get-listing.ts` - Admin listing details handler
- `backend/services/api/listings/get-listing.ts` - Public listing details handler
- `backend/services/api/listings/list-listings.ts` - Listing list handler
- `backend/services/api/hosts/get-profile.ts` - Host profile handler

---

## Key Takeaways

1. **Always store raw S3 keys in DynamoDB**, not full URLs
2. **Build URLs dynamically** in the API layer based on configuration
3. **This allows flexibility** to switch CDN providers, change bucket names, or toggle between CloudFront and presigned URLs
4. **The image processor should be agnostic** about how images are served to end users

---

## Migration of Existing Images

All existing images in staging have been migrated to use S3 keys:

```bash
cd backend/services/scripts
AWS_REGION=eu-north-1 TABLE_NAME=localstays-staging DRY_RUN=false npx ts-node migrate-image-urls.ts
```

**Results:**

- ✅ 13 listing images migrated
- ✅ 2 profile photos migrated
- ✅ 0 errors

All `webpUrls` fields now contain S3 keys instead of full URLs.

---

## Next Steps

1. ✅ Monitor CloudWatch logs for image processor
2. ✅ Test new image uploads
3. ✅ Verify CloudFront URLs load correctly
4. ✅ Migrate existing images to use S3 keys
