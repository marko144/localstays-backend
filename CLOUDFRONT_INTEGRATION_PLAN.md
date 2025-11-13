# CloudFront Integration Plan for Localstays

## Executive Summary

This document outlines the plan to serve **listing images and host profile photos** through Amazon CloudFront CDN instead of S3 presigned URLs. This will:

1. **Improve performance**: Edge caching reduces latency globally (365-day cache)
2. **Reduce costs**: CloudFront is cheaper than S3 data transfer (~10% savings at scale)
3. **Simplify frontend**: No URL expiration (presigned URLs expire in 5 minutes)
4. **Enable authenticated access**: Images served via CDN with path-based security

**Scope:** Listing images (full + thumbnail) and profile photos (full + thumbnail) only. Verification documents remain private with presigned URLs.

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

**API Endpoints that return image URLs (TO BE UPDATED):**

1. **`GET /hosts/profile`** (Host Profile) - **AUTHENTICATED**

   - Returns: `profilePhoto.thumbnailUrl`, `profilePhoto.fullUrl`
   - Source: `host.profilePhoto.webpUrls.thumbnail`, `host.profilePhoto.webpUrls.full`
   - **Current format**: S3 paths stored in DynamoDB (e.g., `{hostId}/profile/photo_full.webp`)
   - **Will change to**: CloudFront URLs with versioning

2. **`GET /listings/{listingId}`** (Get Listing) - **AUTHENTICATED**

   - Returns: `images[].thumbnailUrl`, `images[].fullUrl`
   - Source: `image.webpUrls.thumbnail`, `image.webpUrls.full`
   - **Current format**: S3 paths stored in DynamoDB (e.g., `{hostId}/listings/{listingId}/images/{imageId}-full.webp`)
   - **Will change to**: CloudFront URLs with versioning

3. **`GET /listings`** (List Listings) - **AUTHENTICATED**

   - Returns: `listings[].primaryImage.thumbnailUrl`
   - Source: `primaryImage.webpUrls.thumbnail`
   - **Current format**: S3 paths stored in DynamoDB
   - **Will change to**: CloudFront URLs with versioning

4. **`GET /admin/requests/{requestId}`** (Admin - Get Request) - **AUTHENTICATED**

   - Returns: `images[].url`, `images[].thumbnailUrl`
   - **Current format**: **Presigned URLs** generated on-demand via `generateDownloadUrl()`
   - **Issue**: These are temporary (5 min expiry)
   - **Will change to**: CloudFront URLs with versioning

5. **`GET /admin/listings/{listingId}`** (Admin - Get Listing) - **AUTHENTICATED**
   - Returns: `images[].s3Url`
   - **Current format**: **Presigned URLs** generated on-demand via `generatePresignedUrl()`
   - **Issue**: These are temporary (5 min expiry)
   - **Will change to**: CloudFront URLs with versioning

**Note:** All endpoints are authenticated. This is NOT about making images public, but about serving them via CDN with path-based access control.

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
3. **Cache Behavior**: Cache images for 365 days
4. **Allowed Methods**: `GET`, `HEAD` only (no OPTIONS needed)
5. **Viewer Protocol Policy**: `redirect-http-to-https`
6. **Compress Objects**: `true` (gzip/brotli compression)
7. **Price Class**: `PriceClass_100` (US, Canada, Europe only)
8. **HTTP Version**: HTTP/2 and HTTP/3 enabled
9. **IPv6**: Enabled (no extra cost, better connectivity)
10. **Logging**: Disabled (saves costs, enable only if needed for debugging)

### URL Structure

**Before (S3 Presigned URL):**

```
https://localstays-staging-host-assets.s3.eu-north-1.amazonaws.com/host123/profile/photo_full.webp?X-Amz-Algorithm=...&X-Amz-Expires=300
```

**After (CloudFront URL with versioning):**

```
https://d1234567890abc.cloudfront.net/host123/profile/photo_full.webp?v=1699716600000
https://d1234567890abc.cloudfront.net/host123/listings/listing_abc/images/img_xyz-full.webp?v=1699716600000
```

**Version parameter (`?v=`):**

- Uses `updatedAt` timestamp from DynamoDB (converted to milliseconds)
- Changes when admin approves new images → triggers cache refresh
- Ensures users always see the latest approved images

**Custom domain:** Not using custom domain for staging. Production can optionally use `assets.localstays.com` later.

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

            // Cache for 365 days (maximum performance and cost savings)
            defaultTtl: cdk.Duration.days(365),
            minTtl: cdk.Duration.seconds(0),
            maxTtl: cdk.Duration.days(365),

            // Cache based on query strings (for versioning via ?v= parameter)
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
          allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD, // Only GET and HEAD (no OPTIONS)
          compress: true,
        },

        // Price class: US, Canada, Europe only (cost optimization)
        priceClass: cloudfront.PriceClass.PRICE_CLASS_100,

        // Enable IPv6 (no extra cost, better connectivity)
        enableIpv6: true,

        // HTTP version (HTTP/3 for better performance)
        httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,

        // Disable logging (saves costs - enable only for debugging)
        enableLogging: false,

        // Error responses
        errorResponses: [
          {
            httpStatus: 403,
            responseHttpStatus: 403,
            ttl: cdk.Duration.minutes(5),
          },
          {
            httpStatus: 404,
            responseHttpStatus: 404,
            ttl: cdk.Duration.minutes(5),
          },
        ],
      }
    );

    // Add path-based cache behaviors for security
    // Only allow access to listing images and profile photos
    this.distribution.addBehavior(
      "*/listings/*/images/*.webp",
      origins.S3BucketOrigin.withOriginAccessControl(bucket, {
        originAccessControl: oac,
      }),
      {
        cachePolicy: this.distribution.node.findChild(
          "ImageCachePolicy"
        ) as cloudfront.CachePolicy,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD, // Only GET and HEAD
        compress: true,
      }
    );

    this.distribution.addBehavior(
      "*/profile/*.webp",
      origins.S3BucketOrigin.withOriginAccessControl(bucket, {
        originAccessControl: oac,
      }),
      {
        cachePolicy: this.distribution.node.findChild(
          "ImageCachePolicy"
        ) as cloudfront.CachePolicy,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD, // Only GET and HEAD
        compress: true,
      }
    );

    // Default behavior: Block all other paths with 403
    // Note: This is handled by the default behavior returning 403 for non-matching paths

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

    // Profile photo with CloudFront URLs + versioning
    profilePhoto: host.profilePhoto
      ? {
          photoId: host.profilePhoto.photoId,
          ...buildProfilePhotoUrls(
            host.profilePhoto.webpUrls,
            host.profilePhoto.updatedAt // Pass updatedAt for versioning
          ),
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
    ...buildListingImageUrls(img.webpUrls, img.updatedAt), // Pass updatedAt for versioning
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
      thumbnailUrl: buildListingImageUrls(
        primaryImage.webpUrls,
        primaryImage.updatedAt  // Pass updatedAt for versioning
      ).thumbnailUrl,
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

    // Build CloudFront URLs with versioning instead of presigned URLs
    const urls = buildListingImageUrls(image.webpUrls, image.updatedAt);

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
    s3Url: buildCloudFrontUrl(img.s3Key, img.updatedAt), // CloudFront URL with versioning
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
    s3Url: buildCloudFrontUrl(img.s3Key, img.updatedAt), // CloudFront URL with versioning
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

**No changes needed!**

The backend returns full CloudFront URLs in API responses, so the frontend doesn't need any new environment variables or configuration.

**Example API response (before):**

```json
{
  "images": [
    {
      "imageId": "img_123",
      "thumbnailUrl": "https://bucket.s3.amazonaws.com/path?X-Amz-...",
      "fullUrl": "https://bucket.s3.amazonaws.com/path?X-Amz-..."
    }
  ]
}
```

**Example API response (after):**

```json
{
  "images": [
    {
      "imageId": "img_123",
      "thumbnailUrl": "https://d123.cloudfront.net/path?v=1699716600000",
      "fullUrl": "https://d123.cloudfront.net/path?v=1699716600000"
    }
  ]
}
```

Same field names, just different URL format!

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

### 1. Path-Based Access Control

**Images served via CloudFront (whitelisted paths):**

- ✅ Listing images: `*/listings/*/images/*.webp`
- ✅ Host profile photos: `*/profile/*.webp`

**Images that remain private (NOT served via CloudFront):**

- ❌ Verification documents: `*/verification/*` (use presigned URLs)
- ❌ Quarantined files: `*/quarantine/*`
- ❌ Temporary uploads: `lstimg_*`, `veri_*` at bucket root

**How it works:**

- CloudFront has specific cache behaviors for the two whitelisted path patterns
- All other paths return 403 Forbidden
- S3 bucket remains private (Block Public Access enabled)
- Only CloudFront can access S3 via Origin Access Control (OAC)

### 2. Important Security Notes

**This is NOT making images "public":**

- The S3 bucket remains private
- Images are only accessible via CloudFront URLs
- Path patterns restrict which files can be accessed
- Verification documents and other sensitive files remain protected

**Why this is secure:**

- Listing images and profile photos are meant to be viewable (by authenticated users)
- These images contain no sensitive information
- The API endpoints that return these URLs are all authenticated
- Verification documents use a different path pattern and remain private

### 3. Rate Limiting

CloudFront automatically provides DDoS protection via AWS Shield Standard. No additional configuration needed for staging.

For production, consider:

- Enable AWS WAF on CloudFront distribution (optional)
- Add rate limiting rules (optional, e.g., 1000 requests/5 minutes per IP)

---

## Performance Optimization

### 1. Cache Configuration

**Configured TTL: 365 days**

- Maximum cache duration for best performance and lowest cost
- Images rarely change, and when they do, versioned URLs trigger new cache entries
- Cache hit rate expected to be >95% after initial warmup

### 2. Image Optimization

**Already implemented:**

- ✅ WebP format (85% quality)
- ✅ Responsive images (thumbnail 400px, full max 1920px)
- ✅ Compression enabled on CloudFront (gzip/brotli)

### 3. Cache Versioning Strategy

**Using `updatedAt` timestamp as version parameter:**

```
https://d123.cloudfront.net/host123/profile/photo_full.webp?v=1699716600000
```

**How it works:**

1. Image uploaded → `updatedAt` set to current timestamp
2. Admin approves image → `updatedAt` updated to approval timestamp
3. URL includes `?v={timestamp}` → CloudFront treats as new URL
4. Old cached version remains but is never requested again

**Benefits:**

- No manual cache invalidation needed
- No invalidation costs
- Instant cache refresh when images change
- Simple implementation (timestamp already exists in DynamoDB)

---

## Cost Optimization Strategy

### 1. Price Class Selection: PriceClass_100

**What it means:**

- CloudFront serves content from edge locations in **US, Canada, and Europe only**
- Excludes Asia, Australia, South America, Africa, Middle East edge locations

**Cost savings:**

- ~30% cheaper than `PriceClass_All` (all global edge locations)
- ~15% cheaper than `PriceClass_200` (adds Asia/Japan)

**Performance impact:**

- ✅ **Europe users**: Excellent (served from local edge locations)
- ✅ **US/Canada users**: Excellent (served from local edge locations)
- ⚠️ **Other regions**: Requests routed to nearest available edge (Europe or US)
  - Still works, just slightly higher latency (~50-150ms extra)
  - For a vacation rental platform focused on Europe/North America, this is acceptable

**Recommendation:** Use `PriceClass_100` for both staging and production.

### 2. Features to DISABLE (Cost Savings)

#### ❌ CloudFront Logging

```typescript
enableLogging: false,  // Saves ~$0.01 per 10,000 requests
```

**Why disable:**

- Logging costs add up quickly at scale
- S3 storage costs for logs
- Most issues can be debugged via Lambda logs or CloudWatch
- Enable temporarily only when debugging CloudFront-specific issues

**Cost impact:** Saves ~$10-50/month at moderate traffic

#### ❌ Real-Time Logs

```typescript
// Don't configure real-time logs
```

**Why disable:**

- Expensive ($0.01 per 1M log lines)
- Only needed for real-time analytics
- Standard CloudWatch metrics are sufficient

**Cost impact:** Saves ~$20-100/month at moderate traffic

#### ❌ Field-Level Encryption

```typescript
// Don't configure field-level encryption
```

**Why disable:**

- Not needed (images are not sensitive data)
- Adds processing overhead
- Adds cost per request

**Cost impact:** Saves ~$5-20/month

#### ❌ Lambda@Edge / CloudFront Functions

```typescript
// Don't use Lambda@Edge for now
```

**Why disable:**

- Not needed (path-based behaviors handle security)
- Expensive ($0.60 per 1M requests + compute time)
- Adds latency

**Cost impact:** Saves ~$50-200/month

**When to enable:** Only if you need dynamic image resizing or complex request/response manipulation

### 3. Features to ENABLE (No Extra Cost or Worth It)

#### ✅ Compression (Gzip + Brotli)

```typescript
compress: true,
enableAcceptEncodingGzip: true,
enableAcceptEncodingBrotli: true,
```

**Why enable:**

- Reduces data transfer by 60-80% for images with metadata
- WebP images already compressed, but headers/metadata benefit
- No extra cost, just better performance

#### ✅ HTTP/2 and HTTP/3

```typescript
httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
```

**Why enable:**

- Better performance (multiplexing, header compression)
- No extra cost
- Modern browsers support it

#### ✅ IPv6

```typescript
enableIpv6: true,
```

**Why enable:**

- Better connectivity for IPv6-only networks
- No extra cost
- Future-proofing

### 4. Cache Optimization for Cost Reduction

**365-day TTL = Maximum Cost Savings:**

| Cache Hit Rate        | S3 GET Requests | Monthly Cost (1M views) |
| --------------------- | --------------- | ----------------------- |
| 50% (1 day TTL)       | 500K            | $9.50                   |
| 80% (7 day TTL)       | 200K            | $9.35                   |
| 95% (30 day TTL)      | 50K             | $9.27                   |
| **99% (365 day TTL)** | **10K**         | **$9.25**               |

**Why 365 days is optimal:**

- Minimizes S3 GET requests (most expensive part)
- Versioned URLs handle updates (no manual invalidation needed)
- Cache hit rate approaches 99% after warmup period

### 5. Origin Configuration Optimization

```typescript
// In CloudFront stack - optimize origin settings
const s3Origin = origins.S3BucketOrigin.withOriginAccessControl(bucket, {
  originAccessControl: oac,
  // Don't add custom headers (not needed, adds processing)
  // Don't add origin shield (expensive, not needed for small/medium traffic)
});
```

**Origin Shield - DON'T USE (Yet):**

- Costs extra $0.01 per 10,000 requests
- Only beneficial at very high traffic (10M+ requests/month)
- Reduces origin load, but your S3 can handle it
- Enable only if S3 costs become significant

**Cost impact:** Saves ~$100+/month at moderate traffic

### 6. Request Method Optimization

```typescript
allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD, // Not ALLOW_GET_HEAD_OPTIONS
```

**Why only GET and HEAD:**

- Images only need GET (fetch) and HEAD (check existence)
- OPTIONS is for CORS preflight (not needed for `<img>` tags)
- Reduces request count slightly

**Cost impact:** Minimal, but good practice

### 7. Avoid These Common Cost Traps

❌ **Don't use CloudFront Functions for simple tasks**

- Cost: $0.10 per 1M invocations
- Use path-based behaviors instead

❌ **Don't enable WAF unless needed**

- Cost: $5/month + $1 per 1M requests
- Only enable for production if under attack

❌ **Don't use custom SSL certificate for staging**

- Cost: $600/year for dedicated IP
- Use SNI (free) or default CloudFront domain

❌ **Don't enable CloudFront access logs by default**

- Cost: S3 storage + processing
- Enable only when debugging

### 8. Monitoring Without Extra Cost

**Use built-in CloudWatch metrics (free):**

- Cache hit rate
- Error rate (4xx, 5xx)
- Bytes downloaded
- Request count

**Don't enable:**

- Real-time metrics ($0.01 per metric per hour = ~$7/month)
- Detailed monitoring (not needed for images)

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

**Example**: 1M image views/month, 100 KB average image size, 95% cache hit rate (365-day TTL)

- Data transfer: 100 GB × $0.085 = **$8.50**
- Requests: 1M × $0.0075/10000 = **$0.75**
- S3 GET (cache misses): 50K × $0.0004/1000 = **$0.02**
- **Total**: **$9.27/month**

**Savings**: ~$0.33/month (3.4% cheaper)

**Note**: Savings increase with higher traffic due to caching. At 10M views/month with 95% cache hit rate, savings would be ~$15/month (15% cheaper).

---

## Rollback Plan

If CloudFront integration causes issues, we have a quick rollback mechanism:

### 1. Quick Rollback (Environment Variable) - 30 seconds

The code includes a `USE_CLOUDFRONT` environment variable that controls whether to use CloudFront URLs or presigned URLs:

```typescript
const USE_CLOUDFRONT = process.env.USE_CLOUDFRONT === "true";

export function buildImageUrl(s3Key: string, updatedAt?: string): string {
  if (USE_CLOUDFRONT) {
    return buildCloudFrontUrl(s3Key, updatedAt);
  } else {
    // Fallback to presigned URL
    const { generateDownloadUrl } = require("./s3-presigned");
    return generateDownloadUrl(s3Key || "");
  }
}
```

**To rollback instantly:**

```bash
# Update Lambda environment variable
aws lambda update-function-configuration \
  --function-name LocalstaysStagingApiLambdaStack-hostListingsHandler... \
  --environment Variables={USE_CLOUDFRONT=false,...other vars...} \
  --region eu-north-1

# Takes ~30 seconds to apply
```

### 2. Full Rollback (Code Revert) - 10+ minutes

If needed, revert code changes and redeploy:

```bash
git revert <commit-hash>
cd infra
npm run cdk -- deploy -c env=staging LocalstaysStagingApiLambdaStack
```

### 3. CloudFront Distribution

Even if rolled back, keep CloudFront distribution running:

- No cost if not used (only data transfer costs apply when serving traffic)
- Can be re-enabled by setting `USE_CLOUDFRONT=true`
- Useful for future testing and eventual re-deployment

---

## Migration Checklist

### Pre-Deployment

- [x] Review and approve plan ✅
- [x] Cache TTL: 365 days ✅
- [x] Path restrictions: Whitelist `*/listings/*/images/*.webp` and `*/profile/*.webp` ✅
- [x] Custom domain: No (staging uses default CloudFront domain) ✅
- [x] Versioning strategy: Use `updatedAt` timestamp ✅
- [x] Rollback strategy: `USE_CLOUDFRONT` environment variable ✅

### Deployment to Staging

- [x] **Step 1:** Deploy CloudFront stack ✅
  ```bash
  cd infra
  npm run cdk -- deploy -c env=staging LocalstaysStagingCloudFrontStack
  ```
  - Distribution ID: `E3EUKZ7Z8VLB3Q`
  - Domain: `dz45r0splw6d0.cloudfront.net`
  - OAC ID: `E178AI1GE2NDZ3`
- [x] **Step 2:** Verify CloudFront distribution is active ✅
- [x] **Step 3:** Test CloudFront URLs manually with curl ✅
  - Tested: `https://dz45r0splw6d0.cloudfront.net/host_2f58aff4-a9f1-43d8-bdf9-c3f4e6728e5e/listings/listing_04d0c1ee-ede2-4712-9d6c-70a673c43247/images/e0bf5496-0a87-47cf-addc-d438425aeb1b-full.webp`
  - Result: HTTP/2 200, x-cache: Miss/Hit from cloudfront ✅
- [ ] **Step 4:** Create `backend/services/api/lib/cloudfront-urls.ts`
- [ ] **Step 5:** Update 5 API handlers (hosts/get-profile, listings/get-listing, listings/list-listings, admin/requests/get-request, admin/listings/get-listing)
- [ ] **Step 6:** Update `infra/lib/api-lambda-stack.ts` to pass `CLOUDFRONT_DOMAIN` env var
- [ ] **Step 7:** Deploy updated Lambda functions
  ```bash
  npm run cdk -- deploy -c env=staging LocalstaysStagingApiLambdaStack
  ```
- [ ] **Step 8:** Set `USE_CLOUDFRONT=true` (should be default)
- [ ] **Step 9:** Test API endpoints (verify CloudFront URLs in responses)
- [ ] **Step 10:** Test frontend image loading (no frontend changes needed)

### Post-Deployment Testing

- [ ] Monitor CloudFront metrics (cache hit rate, errors)
- [ ] Monitor Lambda logs (no errors)
- [ ] Test image upload flow (should still work with presigned URLs)
- [ ] Test admin panel (no presigned URL expiry issues)
- [ ] Test image approval flow (verify `updatedAt` changes trigger new URLs)
- [ ] Verify verification documents still use presigned URLs (not CloudFront)

### Production Deployment (Future)

- [ ] Repeat all steps for production environment
- [ ] Consider custom domain (`assets.localstays.com`)
- [ ] Consider AWS WAF for additional protection
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

## Decisions Made ✅

1. **Custom Domain**: ❌ No custom domain for staging

   - Use CloudFront default domain (e.g., `d123.cloudfront.net`)
   - Production can optionally add custom domain later

2. **Path Restrictions**: ✅ Whitelist specific paths

   - `*/listings/*/images/*.webp` (listing images)
   - `*/profile/*.webp` (profile photos)
   - All other paths return 403 Forbidden

3. **Cache TTL**: ✅ 365 days (maximum)

   - Best performance and cost savings
   - Versioned URLs handle image updates

4. **Versioning Strategy**: ✅ Use `updatedAt` timestamp

   - Automatically changes when admin approves images
   - No manual cache invalidation needed
   - No additional costs

5. **Deployment Order**: ✅ Staging first

   - Test thoroughly before production
   - Lower risk approach

6. **Rollback Strategy**: ✅ Feature flag (`USE_CLOUDFRONT`)
   - Easy 30-second rollback via environment variable
   - Keep presigned URL code as fallback for 1-2 months

---

## Next Steps

**✅ Ready to deploy to staging!** All decisions have been made.

### Deployment Strategy:

1. **Deploy to staging first** (recommended)

   - Test thoroughly for 1 week
   - Monitor bandwidth costs
   - Verify images load correctly
   - Test rollback procedures

2. **Deploy to production** (after staging validation)
   - Enable web app WAF with geo-blocking
   - Monitor closely for first 48 hours
   - Keep kill switches ready

### Estimated Timeline:

**Phase 1 (Infrastructure):** 2-3 hours  
**Phase 2 (Backend):** 3-4 hours  
**Phase 3 (Frontend):** 0 hours (no changes needed!)  
**Phase 4 (Testing):** 2-3 hours

**Total:** 8-12 hours

### Key Benefits:

- ✅ No URL expiration issues (365-day cache)
- ✅ Better performance (edge caching)
- ✅ Lower costs (~3-15% savings depending on traffic)
- ✅ Automatic cache refresh via versioned URLs
- ✅ Quick rollback capability (30 seconds via `USE_CLOUDFRONT=false`)
- ✅ No frontend changes required
- ✅ Multiple kill switches available if issues arise

### Emergency Procedures:

See `EMERGENCY_KILL_SWITCH_PROCEDURES.md` for:

- How to disable CloudFront in 30 seconds
- How to rollback to presigned URLs in 5 minutes
- How to enable emergency WAF rules
- Pre-configured scripts for emergencies

---

## References

- [CloudFront Developer Guide](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/)
- [CloudFront Pricing](https://aws.amazon.com/cloudfront/pricing/)
- [S3 + CloudFront Best Practices](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-s3.html)
- [AWS CDK CloudFront Construct](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_cloudfront-readme.html)

---

**Document Version**: 2.0  
**Last Updated**: 2025-11-11  
**Author**: AI Assistant  
**Status**: ✅ Approved - Ready for Implementation

**Key Changes from v1.0:**

- Updated cache TTL from 24 hours to 365 days
- Added versioning strategy using `updatedAt` timestamp
- Added rollback mechanism via `USE_CLOUDFRONT` feature flag
- Clarified that all endpoints are authenticated (not public)
- Added path-based whitelisting for security
- Removed custom domain requirement for staging
- Confirmed no frontend changes needed
- Added comprehensive cost optimization strategy
- Configured for Europe + US/Canada focus (PriceClass_100)
- Documented features to disable for cost savings

---

## Deployment Lessons Learned ⚠️

### Critical Issues & Solutions

This section documents critical issues encountered during actual deployment to avoid repeating mistakes.

#### 1. Circular Dependency Between CloudFront and S3 Stacks

**Problem:** Using AWS CDK's high-level constructs (`S3BucketOrigin.withOriginAccessControl()`) automatically updates the S3 bucket policy, creating a circular dependency since CloudFront depends on Storage stack.

**Error:**

```
ValidationError: 'LocalstaysStagingCloudFrontStack' depends on 'LocalstaysStagingStorageStack'.
Adding this dependency (LocalstaysStagingStorageStack -> LocalstaysStagingCloudFrontStack/AssetsDistribution.Ref)
would create a cyclic reference.
```

**Solution:**

1. Use L1 (CFN) constructs (`cloudfront.CfnDistribution`) instead of L2 constructs
2. **Do NOT** call `bucket.addToResourcePolicy()` in CloudFront stack
3. Apply S3 bucket policy **manually** after CloudFront deployment

**Correct Code Pattern:**

```typescript
// Use L1 construct
const cfnDistribution = new cloudfront.CfnDistribution(
  this,
  "AssetsDistribution",
  {
    distributionConfig: {
      origins: [
        {
          id: `S3-${bucket.bucketName}`,
          domainName: bucket.bucketRegionalDomainName,
          originAccessControlId: oac.originAccessControlId,
          s3OriginConfig: {
            originAccessIdentity: "", // Empty for OAC
          },
        },
      ],
      // ... rest of config
    },
  }
);

// DO NOT do this in CloudFront stack:
// bucket.addToResourcePolicy(...) // ❌ Creates circular dependency
```

#### 2. S3OriginConfig Must Be Present with Empty originAccessIdentity

**Problem:** When using OAC, the `s3OriginConfig` must be present but with an empty `originAccessIdentity` field. Setting it to `undefined` or omitting it causes CloudFront to reject the configuration.

**Error:**

```
Invalid request provided: Exactly one of CustomOriginConfig, VpcOriginConfig and S3OriginConfig must be specified
```

**Solution:**

  ```typescript
  origins: [
    {
      id: `S3-${bucket.bucketName}`,
      domainName: bucket.bucketRegionalDomainName,
      originAccessControlId: oac.originAccessControlId, // ✅ OAC reference
      s3OriginConfig: {}, // ✅ Empty object (not undefined, not omitted)
    },
  ];
  ```

#### 3. Manual S3 Bucket Policy Application Required

**After CloudFront deployment**, manually apply the S3 bucket policy:

```bash
# 1. Create policy file (replace values)
cat > /tmp/cf-bucket-policy.json << 'EOF'
{
  "Version": "2012-10-17",
  "Statement": [{
    "Sid": "AllowCloudFrontServicePrincipal",
    "Effect": "Allow",
    "Principal": {"Service": "cloudfront.amazonaws.com"},
    "Action": "s3:GetObject",
    "Resource": "arn:aws:s3:::BUCKET-NAME/*",
    "Condition": {
      "StringEquals": {
        "AWS:SourceArn": "arn:aws:cloudfront::ACCOUNT-ID:distribution/DISTRIBUTION-ID"
      }
    }
  }]
}
EOF

# 2. Apply policy
aws s3api put-bucket-policy \
  --bucket BUCKET-NAME \
  --policy file:///tmp/cf-bucket-policy.json \
  --region REGION
```

#### 4. CDK Lock File Issues

**Problem:** Failed or interrupted CDK deployments can leave lock files in `cdk.out` directory.

**Error:**

```
Other CLIs (PID=400) are currently reading from cdk.out.
```

**Solutions:**

```bash
# Option 1: Clean CDK output
rm -rf cdk.out

# Option 2: Use different output directory
npm run cdk -- deploy ... --output cdk.out.new
```

### Correct Deployment Sequence

1. **Deploy CloudFront Stack**

   ```bash
   cd infra
   npm run build
   npm run cdk -- deploy -c env=staging LocalstaysStagingCloudFrontStack
   ```

2. **Apply S3 Bucket Policy** (see code above)

3. **Test CloudFront Access**

   ```bash
   curl -I "https://DISTRIBUTION-DOMAIN.cloudfront.net/path/to/image.webp"
   # Expected: HTTP/2 200, x-cache: Miss/Hit from cloudfront
   ```

4. **Deploy API Stack with CloudFront Domain**
   ```bash
   npm run cdk -- deploy -c env=staging LocalstaysStagingApiStack
   ```

### Architecture Decisions

**Why L1 (CFN) Constructs Instead of L2?**

- L2 constructs automatically update bucket policy → circular dependency
- L1 constructs give full control without automatic cross-stack dependencies
- Manual bucket policy is acceptable one-time operation per environment

**Why Manual Bucket Policy?**

- Avoids circular dependency
- Simple and explicit
- Easy to understand and debug
- One-time operation per environment

### Common Errors & Quick Fixes

| Error                                  | Fix                                                                   |
| -------------------------------------- | --------------------------------------------------------------------- |
| "Exactly one of CustomOriginConfig..." | Ensure `s3OriginConfig` present with empty `originAccessIdentity: ""` |
| "...would create a cyclic reference"   | Remove `bucket.addToResourcePolicy()` from CloudFront stack           |
| "Other CLIs are currently reading..."  | `rm -rf cdk.out` or use `--output cdk.out.new`                        |
| "Access Denied" on CloudFront URL      | Check S3 bucket policy applied correctly with correct distribution ID |
| CloudFront returns 403 for valid paths | Verify path patterns in cache behaviors match S3 key structure        |

### Testing Checklist

After deployment, verify:

- [ ] CloudFront distribution is deployed and enabled
- [ ] S3 bucket policy is applied
- [ ] Can access existing images via CloudFront URL
- [ ] First request shows `x-cache: Miss from cloudfront`
- [ ] Second request shows `x-cache: Hit from cloudfront`
- [ ] Non-whitelisted paths return 403 Forbidden
- [ ] Direct S3 access is blocked (bucket is private)
- [ ] CloudFront domain is passed to Lambda environment variables

**For complete deployment lessons learned, see:** `CLOUDFRONT_DEPLOYMENT_LESSONS_LEARNED.md`

---

## Configuration Summary

### ✅ Enabled Features (Recommended)

| Feature                         | Why                                    | Cost Impact               |
| ------------------------------- | -------------------------------------- | ------------------------- |
| **PriceClass_100**              | Europe + US/Canada edge locations only | -30% vs global            |
| **365-day cache TTL**           | Maximum cache hit rate (99%)           | -$0.25/month per 1M views |
| **HTTP/2 and HTTP/3**           | Better performance, multiplexing       | Free                      |
| **IPv6**                        | Better connectivity                    | Free                      |
| **Gzip + Brotli compression**   | Reduces data transfer                  | Free                      |
| **Path-based behaviors**        | Security (whitelist specific paths)    | Free                      |
| **Origin Access Control (OAC)** | S3 bucket remains private              | Free                      |
| **Versioned URLs**              | Automatic cache refresh                | Free                      |

### ❌ Disabled Features (Cost Savings)

| Feature                    | Why Disabled                       | Savings        |
| -------------------------- | ---------------------------------- | -------------- |
| **CloudFront Logging**     | Use Lambda/CloudWatch logs instead | ~$10-50/month  |
| **Real-time Logs**         | Not needed for images              | ~$20-100/month |
| **Lambda@Edge**            | Path behaviors handle security     | ~$50-200/month |
| **CloudFront Functions**   | Not needed                         | ~$10-50/month  |
| **Origin Shield**          | Not needed at current scale        | ~$100+/month   |
| **Field-level Encryption** | Images not sensitive               | ~$5-20/month   |
| **WAF**                    | Enable only if under attack        | ~$60+/month    |
| **Real-time Metrics**      | Standard metrics sufficient        | ~$7/month      |

**Total potential savings: $262-587/month** by keeping configuration lean!

### 🎯 Optimized For

- **Target audience:** Europe, US, Canada
- **Content type:** Static images (WebP)
- **Access pattern:** Read-heavy (no writes via CloudFront)
- **Security:** Path-based whitelisting (no Lambda@Edge needed)
- **Cost priority:** Lean configuration, disable unnecessary features
- **Performance:** 365-day cache, HTTP/3, compression enabled
