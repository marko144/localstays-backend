# CloudFront Integration Plan for Localstays

## Executive Summary

This document outlines the plan to serve listing images and host profile photos through Amazon CloudFront CDN instead of S3 presigned URLs. This will:

1. **Improve performance**: Edge caching reduces latency globally
2. **Reduce costs**: CloudFront is cheaper than S3 data transfer
3. **Simplify frontend**: No URL expiration (presigned URLs expire in 5 minutes)
4. **Enable public sharing**: Listing images can be shared without authentication

---

## Current Architecture

### Image Storage Structure

After processing by the Image Processor Lambda, images are stored in S3:

```
s3://localstays-{stage}-host-assets/
├── {hostId}/
│   ├── profile/
│   │   ├── photo_full.webp          ← Profile photo (full size)
│   │   └── photo_thumbnail.webp     ← Profile photo (thumbnail, 400px)
│   └── listings/
│       └── {listingId}/
│           └── images/
│               ├── {imageId}-full.webp   ← Listing image (full size, max 1920px)
│               └── {imageId}-thumb.webp  ← Listing image (thumbnail, 400px)
```

### Current URL Generation

**API Endpoints that return image URLs:**

1. **`GET /hosts/profile`** (Host Profile)

   - Returns: `profilePhoto.thumbnailUrl`, `profilePhoto.fullUrl`
   - Source: `host.profilePhoto.webpUrls.thumbnail`, `host.profilePhoto.webpUrls.full`
   - **Current format**: S3 paths stored in DynamoDB (e.g., `{hostId}/profile/photo_full.webp`)

2. **`GET /listings/{listingId}`** (Get Listing)

   - Returns: `images[].thumbnailUrl`, `images[].fullUrl`
   - Source: `image.webpUrls.thumbnail`, `image.webpUrls.full`
   - **Current format**: S3 paths stored in DynamoDB (e.g., `{hostId}/listings/{listingId}/images/{imageId}-full.webp`)

3. **`GET /listings`** (List Listings)

   - Returns: `listings[].primaryImage.thumbnailUrl`
   - Source: `primaryImage.webpUrls.thumbnail`
   - **Current format**: S3 paths stored in DynamoDB

4. **`GET /admin/requests/{requestId}`** (Admin - Get Request)

   - Returns: `images[].url`, `images[].thumbnailUrl`
   - **Current format**: **Presigned URLs** generated on-demand via `generateDownloadUrl()`
   - **Issue**: These are temporary (5 min expiry)

5. **`GET /admin/listings/{listingId}`** (Admin - Get Listing)
   - Returns: `images[].s3Url`
   - **Current format**: **Presigned URLs** generated on-demand via `generatePresignedUrl()`
   - **Issue**: These are temporary (5 min expiry)

### Current S3 Bucket Configuration

- **Block Public Access**: `BLOCK_ALL` (private bucket)
- **Encryption**: S3-managed encryption
- **CORS**: Configured for frontend uploads
- **Access**: Only via presigned URLs or IAM roles

---

## Target Architecture

### CloudFront Distribution

Create a CloudFront distribution with:

1. **Origin**: S3 bucket (`localstays-{stage}-host-assets`)
2. **Origin Access Control (OAC)**: CloudFront can read from private S3 bucket
3. **Cache Behavior**: Cache images for 24 hours (or longer)
4. **Allowed Methods**: `GET`, `HEAD`, `OPTIONS`
5. **Viewer Protocol Policy**: `redirect-http-to-https`
6. **Compress Objects**: `true` (gzip/brotli compression)
7. **Price Class**: `PriceClass_100` (US, Canada, Europe) or `PriceClass_All`

### URL Structure

**Before (S3 Presigned URL):**

```
https://localstays-staging-host-assets.s3.eu-north-1.amazonaws.com/host123/profile/photo_full.webp?X-Amz-Algorithm=...&X-Amz-Expires=300
```

**After (CloudFront URL):**

```
https://d1234567890abc.cloudfront.net/host123/profile/photo_full.webp
```

Or with custom domain (optional):

```
https://assets.localstays.com/host123/profile/photo_full.webp
```

---

## Implementation Plan

### Phase 1: Infrastructure Setup (CDK)

#### 1.1 Create CloudFront Distribution Stack

Create `infra/lib/cloudfront-stack.ts`:

```typescript
import * as cdk from "aws-cdk-lib";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as s3 from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";

export interface CloudFrontStackProps extends cdk.StackProps {
  stage: string;
  bucket: s3.IBucket;
}

export class CloudFrontStack extends cdk.Stack {
  public readonly distribution: cloudfront.Distribution;
  public readonly distributionDomainName: string;

  constructor(scope: Construct, id: string, props: CloudFrontStackProps) {
    super(scope, id, props);

    const { stage, bucket } = props;

    // Create Origin Access Control (OAC) for S3
    const oac = new cloudfront.S3OriginAccessControl(this, "OAC", {
      signing: cloudfront.Signing.SIGV4_NO_OVERRIDE,
    });

    // Create CloudFront distribution
    this.distribution = new cloudfront.Distribution(
      this,
      "AssetsDistribution",
      {
        comment: `Localstays ${stage} - Host Assets CDN`,

        // S3 origin with OAC
        defaultBehavior: {
          origin: origins.S3BucketOrigin.withOriginAccessControl(bucket, {
            originAccessControl: oac,
          }),

          // Cache settings
          cachePolicy: new cloudfront.CachePolicy(this, "ImageCachePolicy", {
            cachePolicyName: `localstays-${stage}-image-cache`,
            comment: "Cache policy for listing images and profile photos",

            // Cache for 24 hours (86400 seconds)
            defaultTtl: cdk.Duration.hours(24),
            minTtl: cdk.Duration.seconds(0),
            maxTtl: cdk.Duration.days(365),

            // Cache based on query strings (for future cache busting)
            queryStringBehavior: cloudfront.CacheQueryStringBehavior.all(),

            // Don't cache based on headers or cookies
            headerBehavior: cloudfront.CacheHeaderBehavior.none(),
            cookieBehavior: cloudfront.CacheCookieBehavior.none(),

            // Enable compression
            enableAcceptEncodingGzip: true,
            enableAcceptEncodingBrotli: true,
          }),

          // Viewer settings
          viewerProtocolPolicy:
            cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
          compress: true,
        },

        // Price class (adjust based on target audience)
        priceClass:
          stage === "prod"
            ? cloudfront.PriceClass.PRICE_CLASS_ALL
            : cloudfront.PriceClass.PRICE_CLASS_100, // US, Canada, Europe

        // Enable IPv6
        enableIpv6: true,

        // HTTP version
        httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,

        // Error responses (return 404 for missing images)
        errorResponses: [
          {
            httpStatus: 403,
            responseHttpStatus: 404,
            responsePagePath: "/404.html",
            ttl: cdk.Duration.minutes(5),
          },
          {
            httpStatus: 404,
            responseHttpStatus: 404,
            responsePagePath: "/404.html",
            ttl: cdk.Duration.minutes(5),
          },
        ],
      }
    );

    // Update S3 bucket policy to allow CloudFront OAC
    bucket.addToResourcePolicy(
      new cdk.aws_iam.PolicyStatement({
        sid: "AllowCloudFrontServicePrincipal",
        effect: cdk.aws_iam.Effect.ALLOW,
        principals: [
          new cdk.aws_iam.ServicePrincipal("cloudfront.amazonaws.com"),
        ],
        actions: ["s3:GetObject"],
        resources: [`${bucket.bucketArn}/*`],
        conditions: {
          StringEquals: {
            "AWS:SourceArn": `arn:aws:cloudfront::${this.account}:distribution/${this.distribution.distributionId}`,
          },
        },
      })
    );

    // Store distribution domain name
    this.distributionDomainName = this.distribution.distributionDomainName;

    // CloudFormation outputs
    new cdk.CfnOutput(this, "DistributionId", {
      value: this.distribution.distributionId,
      description: "CloudFront distribution ID",
      exportName: `Localstays${this.capitalize(stage)}DistributionId`,
    });

    new cdk.CfnOutput(this, "DistributionDomainName", {
      value: this.distributionDomainName,
      description: "CloudFront distribution domain name",
      exportName: `Localstays${this.capitalize(stage)}DistributionDomain`,
    });

    // Add tags
    cdk.Tags.of(this).add("Project", "Localstays");
    cdk.Tags.of(this).add("Environment", stage);
    cdk.Tags.of(this).add("ManagedBy", "CDK");
  }

  private capitalize(str: string): string {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }
}
```

#### 1.2 Update Main CDK App

Modify `infra/bin/infra.ts`:

```typescript
import { CloudFrontStack } from "../lib/cloudfront-stack";

// ... existing code ...

// Create CloudFront stack (after storage stack)
const cloudFrontStack = new CloudFrontStack(
  app,
  `Localstays${capitalizedStage}CloudFrontStack`,
  {
    stage,
    bucket: storageStack.bucket,
    env: awsEnv,
  }
);
cloudFrontStack.addDependency(storageStack);

// Pass CloudFront domain to API Lambda stack
const apiLambdaStack = new ApiLambdaStack(
  app,
  `Localstays${capitalizedStage}ApiLambdaStack`,
  {
    stage,
    table: dataStack.table,
    emailTemplatesTable: dataStack.emailTemplatesTable,
    bucket: storageStack.bucket,
    userPool: cognitoStack.userPool,
    userPoolClient: cognitoStack.userPoolClient,
    cloudFrontDomain: cloudFrontStack.distributionDomainName, // NEW
    env: awsEnv,
  }
);
```

#### 1.3 Update API Lambda Stack

Modify `infra/lib/api-lambda-stack.ts`:

```typescript
export interface ApiLambdaStackProps extends cdk.StackProps {
  // ... existing props ...
  cloudFrontDomain: string; // NEW
}

// In constructor, add to commonEnvironment:
const commonEnvironment = {
  TABLE_NAME: table.tableName,
  BUCKET_NAME: bucket.bucketName,
  EMAIL_TEMPLATES_TABLE_NAME: emailTemplatesTable.tableName,
  CLOUDFRONT_DOMAIN: props.cloudFrontDomain, // NEW
};
```

---

### Phase 2: Backend Changes

#### 2.1 Create CloudFront URL Builder Utility

Create `backend/services/api/lib/cloudfront-urls.ts`:

```typescript
/**
 * CloudFront URL Generation
 * Builds public CDN URLs for listing images and profile photos
 */

const CLOUDFRONT_DOMAIN = process.env.CLOUDFRONT_DOMAIN!;

/**
 * Build CloudFront URL from S3 key
 *
 * @param s3Key - S3 object key (e.g., "host123/profile/photo_full.webp")
 * @returns CloudFront URL (e.g., "https://d123.cloudfront.net/host123/profile/photo_full.webp")
 */
export function buildCloudFrontUrl(s3Key: string | undefined | null): string {
  if (!s3Key) {
    return "";
  }

  // Remove leading slash if present
  const cleanKey = s3Key.startsWith("/") ? s3Key.substring(1) : s3Key;

  // Build CloudFront URL
  return `https://${CLOUDFRONT_DOMAIN}/${cleanKey}`;
}

/**
 * Build profile photo URLs
 */
export function buildProfilePhotoUrls(webpUrls?: {
  thumbnail?: string;
  full?: string;
}) {
  if (!webpUrls) {
    return {
      thumbnailUrl: "",
      fullUrl: "",
    };
  }

  return {
    thumbnailUrl: buildCloudFrontUrl(webpUrls.thumbnail),
    fullUrl: buildCloudFrontUrl(webpUrls.full),
  };
}

/**
 * Build listing image URLs
 */
export function buildListingImageUrls(webpUrls?: {
  thumbnail?: string;
  full?: string;
}) {
  if (!webpUrls) {
    return {
      thumbnailUrl: "",
      fullUrl: "",
    };
  }

  return {
    thumbnailUrl: buildCloudFrontUrl(webpUrls.thumbnail),
    fullUrl: buildCloudFrontUrl(webpUrls.full),
  };
}

/**
 * Validate CloudFront domain is configured
 */
export function validateCloudFrontConfig(): void {
  if (!CLOUDFRONT_DOMAIN) {
    throw new Error("CLOUDFRONT_DOMAIN environment variable is not set");
  }
}
```

#### 2.2 Update Host Profile API

Modify `backend/services/api/hosts/get-profile.ts`:

```typescript
import { buildProfilePhotoUrls } from "../lib/cloudfront-urls";

function buildProfileResponse(host: Host, documents: Document[]) {
  const baseResponse = {
    hostId: host.hostId,
    hostType: host.hostType,
    status: host.status,
    email: host.email,
    phone: host.phone,
    preferredLanguage: host.preferredLanguage,
    countryCode: host.countryCode,
    address: host.address,

    // Profile photo with CloudFront URLs
    profilePhoto: host.profilePhoto
      ? {
          photoId: host.profilePhoto.photoId,
          ...buildProfilePhotoUrls(host.profilePhoto.webpUrls), // NEW
          width: host.profilePhoto.dimensions?.width || 0,
          height: host.profilePhoto.dimensions?.height || 0,
          status: host.profilePhoto.status,
        }
      : null,

    // ... rest of response
  };

  // ... rest of function
}
```

#### 2.3 Update Listing APIs

**`backend/services/api/listings/get-listing.ts`:**

```typescript
import { buildListingImageUrls } from "../lib/cloudfront-urls";

// In handler function:
const images = (imagesResult.Items || [])
  .filter((img) => img.status === "READY" || img.status === "ACTIVE")
  .map((img) => ({
    imageId: img.imageId,
    ...buildListingImageUrls(img.webpUrls), // NEW: Replace thumbnailUrl/fullUrl
    displayOrder: img.displayOrder,
    isPrimary: img.isPrimary,
    caption: img.caption,
    width: img.dimensions?.width || img.width || 0,
    height: img.dimensions?.height || img.height || 0,
  }))
  .sort((a, b) => a.displayOrder - b.displayOrder);
```

**`backend/services/api/listings/list-listings.ts`:**

```typescript
import { buildListingImageUrls } from '../lib/cloudfront-urls';

// In handler function:
primaryImage: primaryImage && primaryImage.status === 'READY'
  ? {
      imageId: primaryImage.imageId,
      thumbnailUrl: buildListingImageUrls(primaryImage.webpUrls).thumbnailUrl, // NEW
    }
  : undefined,
```

#### 2.4 Update Admin APIs

**`backend/services/api/admin/requests/get-request.ts`:**

```typescript
import { buildListingImageUrls } from "../lib/cloudfront-urls";

// Replace fetchImageDetails function:
async function fetchImageDetails(
  listingId: string,
  imageIds: string[]
): Promise<Array<ListingImage & { url: string; thumbnailUrl: string }>> {
  const imagePromises = imageIds.map(async (imageId) => {
    console.log(`Fetching image ${imageId} for listing ${listingId}`);

    const result = await docClient.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: {
          pk: `LISTING#${listingId}`,
          sk: `IMAGE#${imageId}`,
        },
      })
    );

    if (!result.Item) {
      console.warn(`Image ${imageId} not found in DynamoDB`);
      return null;
    }

    const image = result.Item as ListingImage;
    console.log(`Found image ${imageId}, status: ${image.status}`);

    // Build CloudFront URLs instead of presigned URLs
    const urls = buildListingImageUrls(image.webpUrls);

    return {
      ...image,
      url: urls.fullUrl,
      thumbnailUrl: urls.thumbnailUrl,
    };
  });

  const images = await Promise.all(imagePromises);
  const filtered = images.filter(
    (img): img is NonNullable<typeof img> => img !== null
  );
  console.log(`Returning ${filtered.length} of ${imageIds.length} images`);
  return filtered;
}
```

**`backend/services/api/admin/listings/get-listing.ts`:**

```typescript
import { buildCloudFrontUrl } from "../lib/cloudfront-urls";

// Replace presigned URL generation:
const imageDetails = await Promise.all(
  currentImages.map(async (img) => ({
    imageId: img.imageId,
    s3Url: buildCloudFrontUrl(img.s3Key), // NEW: CloudFront URL instead of presigned
    displayOrder: img.displayOrder,
    isPrimary: img.isPrimary,
    caption: img.caption,
    contentType: img.contentType,
    pendingApproval: false,
  }))
);

const pendingImageDetails = await Promise.all(
  pendingImages.map(async (img) => ({
    imageId: img.imageId,
    s3Url: buildCloudFrontUrl(img.s3Key), // NEW: CloudFront URL instead of presigned
    displayOrder: img.displayOrder,
    isPrimary: img.isPrimary,
    caption: img.caption,
    contentType: img.contentType,
    pendingApproval: true,
    status: img.status,
  }))
);
```

#### 2.5 Keep Presigned URLs for Uploads

**No changes needed** for upload functionality:

- `backend/services/api/hosts/submit-intent.ts` - Keep presigned upload URLs
- `backend/services/api/listings/submit-intent.ts` - Keep presigned upload URLs
- `backend/services/api/listings/submit-image-update.ts` - Keep presigned upload URLs

These use `generateUploadUrl()` for **uploads**, which is separate from **downloads**.

---

### Phase 3: Frontend Changes

#### 3.1 Environment Variables

Add to frontend `.env`:

```bash
# Existing
VITE_API_ENDPOINT=https://xyz.execute-api.eu-north-1.amazonaws.com/v1
VITE_COGNITO_USER_POOL_ID=eu-north-1_abc123
VITE_COGNITO_CLIENT_ID=abc123
VITE_AWS_REGION=eu-north-1

# NEW: CloudFront domain (not needed if backend returns full URLs)
# VITE_CLOUDFRONT_DOMAIN=d1234567890abc.cloudfront.net
```

**Note**: If backend returns full CloudFront URLs (recommended), frontend doesn't need the domain.

#### 3.2 Image Display

**Before:**

```typescript
// Presigned URLs expire in 5 minutes
<img src={listing.primaryImage.thumbnailUrl} alt="Listing" />
```

**After:**

```typescript
// CloudFront URLs never expire
<img src={listing.primaryImage.thumbnailUrl} alt="Listing" />
```

**No code changes needed** - URLs are still in the same response fields, just different format.

#### 3.3 Image Upload (No Changes)

Upload flow remains the same:

1. Call `/listings/submit-intent` → Get presigned upload URL
2. Upload directly to S3 using presigned URL
3. Call `/listings/confirm-submission`
4. Backend processes image → Stores in final location
5. Frontend fetches listing → Gets CloudFront URLs

---

### Phase 4: Testing & Validation

#### 4.1 Infrastructure Testing

```bash
# Deploy CloudFront stack
cd infra
npm run build
cdk deploy Localstays{Stage}CloudFrontStack --profile localstays

# Verify distribution
aws cloudfront get-distribution --id E1234567890ABC --region us-east-1

# Get CloudFront domain
aws cloudfront list-distributions --query "DistributionList.Items[?Comment=='Localstays staging - Host Assets CDN'].DomainName" --output text
```

#### 4.2 URL Testing

```bash
# Test CloudFront URL (replace with actual values)
curl -I https://d1234567890abc.cloudfront.net/host123/profile/photo_full.webp

# Expected response:
# HTTP/2 200
# content-type: image/webp
# x-cache: Hit from cloudfront
# x-amz-cf-id: ...
```

#### 4.3 API Testing

```bash
# Test host profile endpoint
curl -H "Authorization: Bearer $TOKEN" \
  https://xyz.execute-api.eu-north-1.amazonaws.com/v1/hosts/profile

# Verify response contains CloudFront URLs:
# "profilePhoto": {
#   "thumbnailUrl": "https://d123.cloudfront.net/host123/profile/photo_thumbnail.webp",
#   "fullUrl": "https://d123.cloudfront.net/host123/profile/photo_full.webp"
# }
```

#### 4.4 Frontend Testing

1. **List Listings**: Verify thumbnails load from CloudFront
2. **View Listing**: Verify full images load from CloudFront
3. **Host Profile**: Verify profile photo loads from CloudFront
4. **Admin Panel**: Verify images load from CloudFront (no expiry issues)
5. **Image Upload**: Verify upload still works (presigned URLs)

---

## Security Considerations

### 1. Public Access to Images

**Images that SHOULD be public:**

- ✅ Listing images (full + thumbnail)
- ✅ Host profile photos (full + thumbnail)

**Images that should NOT be public:**

- ❌ Verification documents (`veri_*` prefix)
- ❌ Quarantined files (`*/quarantine/*`)
- ❌ Temporary uploads (`lstimg_*`, `veri_*` at bucket root)

### 2. CloudFront Path Restrictions

**Option A: Whitelist specific paths** (Recommended)

Create multiple cache behaviors:

```typescript
// In CloudFront stack:
{
  // Behavior 1: Host profile photos (public)
  pathPattern: '*/profile/photo_*.webp',
  // ... cache settings
},
{
  // Behavior 2: Listing images (public)
  pathPattern: '*/listings/*/images/*.webp',
  // ... cache settings
},
{
  // Behavior 3: Block everything else
  pathPattern: '*',
  viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
  cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
  responseHeadersPolicy: new cloudfront.ResponseHeadersPolicy(this, 'BlockPolicy', {
    customHeadersBehavior: {
      customHeaders: [
        { header: 'x-robots-tag', value: 'noindex', override: true },
      ],
    },
  }),
}
```

**Option B: Lambda@Edge function** (Advanced)

Use Lambda@Edge to validate requests:

- Allow: `*/profile/photo_*.webp`
- Allow: `*/listings/*/images/*.webp`
- Deny: Everything else

### 3. Rate Limiting

CloudFront automatically provides DDoS protection via AWS Shield Standard.

For additional protection:

- Enable AWS WAF on CloudFront distribution
- Add rate limiting rules (e.g., 1000 requests/5 minutes per IP)

### 4. CORS Configuration

CloudFront will respect S3 CORS headers, but you can also configure CORS at CloudFront level:

```typescript
// In CloudFront cache behavior:
responseHeadersPolicy: new cloudfront.ResponseHeadersPolicy(this, 'CorsPolicy', {
  corsBehavior: {
    accessControlAllowOrigins: ['https://*.localstays.com', 'http://localhost:3000'],
    accessControlAllowMethods: ['GET', 'HEAD', 'OPTIONS'],
    accessControlAllowHeaders: ['*'],
    accessControlExposeHeaders: ['ETag'],
    accessControlMaxAge: cdk.Duration.hours(1),
    originOverride: true,
  },
}),
```

---

## Performance Optimization

### 1. Cache Configuration

**Recommended TTLs:**

- **Listing images**: 24 hours (images rarely change)
- **Profile photos**: 24 hours (photos rarely change)
- **Cache invalidation**: Use versioned URLs or manual invalidation

### 2. Image Optimization

**Already implemented:**

- ✅ WebP format (85% quality)
- ✅ Responsive images (thumbnail 400px, full max 1920px)
- ✅ Compression enabled on CloudFront

**Future optimizations:**

- Consider AWS Lambda@Edge for on-the-fly image resizing
- Add `Cache-Control` headers to S3 objects

### 3. Cache Invalidation Strategy

**Option A: Versioned URLs** (Recommended)

Add a version query parameter:

```
https://d123.cloudfront.net/host123/profile/photo_full.webp?v=1234567890
```

Update version when image changes.

**Option B: Manual Invalidation**

```bash
aws cloudfront create-invalidation \
  --distribution-id E1234567890ABC \
  --paths "/host123/profile/*"
```

**Cost**: First 1,000 invalidations/month are free, then $0.005 per path.

---

## Cost Analysis

### Current Costs (S3 Presigned URLs)

- **S3 Data Transfer**: $0.09/GB (first 10 TB)
- **S3 GET Requests**: $0.0004 per 1,000 requests
- **Lambda Invocations**: $0.20 per 1M requests (for generating presigned URLs)

**Example**: 1M image views/month, 100 KB average image size

- Data transfer: 100 GB × $0.09 = **$9.00**
- GET requests: 1M × $0.0004/1000 = **$0.40**
- Lambda: 1M × $0.20/1M = **$0.20**
- **Total**: **$9.60/month**

### Future Costs (CloudFront)

- **CloudFront Data Transfer**: $0.085/GB (first 10 TB, US/Europe)
- **CloudFront Requests**: $0.0075 per 10,000 requests
- **S3 Data Transfer to CloudFront**: **FREE** (same region)

**Example**: 1M image views/month, 100 KB average image size, 80% cache hit rate

- Data transfer: 100 GB × $0.085 = **$8.50**
- Requests: 1M × $0.0075/10000 = **$0.75**
- S3 GET (cache misses): 200K × $0.0004/1000 = **$0.08**
- **Total**: **$9.33/month**

**Savings**: ~$0.27/month (3% cheaper)

**Note**: Savings increase with higher traffic due to caching. At 10M views/month, savings would be ~$10/month (10% cheaper).

---

## Rollback Plan

If CloudFront integration causes issues:

### 1. Quick Rollback (Environment Variable)

Add feature flag to Lambda:

```typescript
const USE_CLOUDFRONT = process.env.USE_CLOUDFRONT === "true";

export function buildImageUrl(s3Key: string): string {
  if (USE_CLOUDFRONT) {
    return buildCloudFrontUrl(s3Key);
  } else {
    return generateDownloadUrl(s3Key); // Fallback to presigned URLs
  }
}
```

Update Lambda environment variable:

```bash
aws lambda update-function-configuration \
  --function-name staging-api-handler \
  --environment Variables={USE_CLOUDFRONT=false}
```

### 2. Full Rollback (Code Revert)

```bash
git revert <commit-hash>
cd infra
cdk deploy Localstays{Stage}ApiLambdaStack
```

### 3. Keep CloudFront Distribution

Even if rolled back, keep CloudFront distribution for future use. It doesn't cost anything if not used (only data transfer costs).

---

## Migration Checklist

### Pre-Deployment

- [ ] Review and approve this plan
- [ ] Decide on cache TTL values
- [ ] Decide on path restrictions (Option A or B)
- [ ] Decide on custom domain (optional)
- [ ] Test CloudFront stack in dev1 environment

### Deployment

- [ ] Deploy CloudFront stack to staging
- [ ] Verify CloudFront distribution is active
- [ ] Test CloudFront URLs manually (curl)
- [ ] Deploy updated Lambda functions
- [ ] Test API endpoints (verify CloudFront URLs in responses)
- [ ] Deploy frontend with updated environment variables
- [ ] Test frontend image loading

### Post-Deployment

- [ ] Monitor CloudFront metrics (cache hit rate, errors)
- [ ] Monitor Lambda logs (no errors)
- [ ] Monitor frontend (no broken images)
- [ ] Test image upload flow (should still work)
- [ ] Test admin panel (no presigned URL expiry issues)
- [ ] Document CloudFront domain for frontend team

### Production Deployment

- [ ] Repeat all steps for production environment
- [ ] Configure custom domain (optional)
- [ ] Enable AWS WAF (optional)
- [ ] Set up CloudWatch alarms for CloudFront errors

---

## Dependencies

### AWS Services

1. **Amazon CloudFront**: CDN for image delivery
2. **Amazon S3**: Origin for CloudFront
3. **AWS Lambda**: API handlers (updated to return CloudFront URLs)
4. **Amazon DynamoDB**: Stores S3 keys (no changes needed)
5. **AWS CDK**: Infrastructure as Code

### Backend Changes

1. **New file**: `backend/services/api/lib/cloudfront-urls.ts`
2. **Modified files**:
   - `backend/services/api/hosts/get-profile.ts`
   - `backend/services/api/listings/get-listing.ts`
   - `backend/services/api/listings/list-listings.ts`
   - `backend/services/api/admin/requests/get-request.ts`
   - `backend/services/api/admin/listings/get-listing.ts`

### Infrastructure Changes

1. **New stack**: `infra/lib/cloudfront-stack.ts`
2. **Modified files**:
   - `infra/bin/infra.ts`
   - `infra/lib/api-lambda-stack.ts`

### Frontend Changes

1. **Environment variables**: Add `CLOUDFRONT_DOMAIN` (optional)
2. **Code changes**: None (if backend returns full URLs)

---

## Timeline Estimate

- **Phase 1 (Infrastructure)**: 2-3 hours

  - Write CloudFront stack
  - Update CDK app
  - Deploy to staging
  - Test distribution

- **Phase 2 (Backend)**: 3-4 hours

  - Write CloudFront URL utility
  - Update 5 API handlers
  - Test API responses
  - Deploy to staging

- **Phase 3 (Frontend)**: 1-2 hours

  - Update environment variables
  - Test image loading
  - Deploy to staging

- **Phase 4 (Testing)**: 2-3 hours
  - End-to-end testing
  - Performance testing
  - Security testing
  - Documentation

**Total**: 8-12 hours

---

## Questions & Decisions Needed

1. **Custom Domain**: Do you want a custom domain like `assets.localstays.com`?

   - **Yes**: Requires Route53 hosted zone + ACM certificate (in us-east-1)
   - **No**: Use CloudFront default domain (e.g., `d123.cloudfront.net`)

2. **Path Restrictions**: How strict should CloudFront access be?

   - **Option A**: Whitelist specific paths (profile photos + listing images)
   - **Option B**: Lambda@Edge validation (more complex, more flexible)
   - **Option C**: No restrictions (simpler, but exposes all S3 paths)

3. **Cache TTL**: How long should images be cached?

   - **24 hours**: Good balance (recommended)
   - **7 days**: Longer caching, better performance, harder to update
   - **1 hour**: Shorter caching, easier to update, less performance benefit

4. **Deployment Order**: Which environment first?

   - **Staging first**: Test thoroughly, then production (recommended)
   - **Production immediately**: Faster, but riskier

5. **Rollback Strategy**: Keep presigned URL code as fallback?
   - **Yes**: Add feature flag, easy rollback (recommended)
   - **No**: Remove presigned URL code, cleaner but harder to rollback

---

## Next Steps

1. **Review this plan** and answer questions above
2. **Approve implementation** or request changes
3. **Start with Phase 1** (Infrastructure) in staging environment
4. **Test thoroughly** before proceeding to Phase 2
5. **Deploy to production** after successful staging deployment

---

## References

- [CloudFront Developer Guide](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/)
- [CloudFront Pricing](https://aws.amazon.com/cloudfront/pricing/)
- [S3 + CloudFront Best Practices](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-s3.html)
- [AWS CDK CloudFront Construct](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_cloudfront-readme.html)

---

**Document Version**: 1.0  
**Last Updated**: 2025-11-10  
**Author**: AI Assistant  
**Status**: Draft - Awaiting Approval

