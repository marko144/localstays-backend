# CloudFront Deployment Lessons Learned

## Date: November 11, 2025

## Environment: Staging

## Distribution ID: E3EUKZ7Z8VLB3Q

## Domain: dz45r0splw6d0.cloudfront.net

---

## Executive Summary

Successfully deployed CloudFront CDN for serving listing images and profile photos from S3 using Origin Access Control (OAC). This document captures critical lessons learned to avoid repeating the same mistakes in future deployments.

---

## Key Issues Encountered & Solutions

### 1. Circular Dependency Between CloudFront and S3 Stacks

**Problem:**
When using AWS CDK's high-level constructs (`S3BucketOrigin.withOriginAccessControl()`), the construct automatically tries to update the S3 bucket policy. Since CloudFront stack depends on Storage stack (for bucket reference), and the automatic bucket policy update creates a dependency from Storage → CloudFront, this creates a circular reference.

**Error Message:**

```
ValidationError: 'LocalstaysStagingCloudFrontStack' depends on 'LocalstaysStagingStorageStack'.
Adding this dependency (LocalstaysStagingStorageStack -> LocalstaysStagingCloudFrontStack/AssetsDistribution.Ref)
would create a cyclic reference.
```

**Root Cause:**

- High-level CDK constructs (`S3BucketOrigin.withOriginAccessControl()`) automatically call `bucket.addToResourcePolicy()`
- This creates a dependency from the Storage stack back to the CloudFront stack
- CDK doesn't allow circular dependencies between stacks

**Solution:**

1. Use L1 (CFN) constructs instead of L2 constructs for CloudFront distribution
2. Create the distribution using `cloudfront.CfnDistribution` directly
3. **Do NOT** call `bucket.addToResourcePolicy()` in the CloudFront stack
4. Apply the S3 bucket policy manually after CloudFront deployment

**Code Pattern - CORRECT:**

```typescript
// In CloudFront stack - Use L1 construct
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

**Code Pattern - WRONG:**

```typescript
// ❌ This creates circular dependency
const distribution = new cloudfront.Distribution(this, "Distribution", {
  defaultBehavior: {
    origin: origins.S3BucketOrigin.withOriginAccessControl(bucket), // ❌ Auto-updates bucket policy
  },
});
```

---

### 2. S3OriginConfig Configuration with OAC

**Problem:**
When configuring CloudFront with OAC, the S3OriginConfig must be present but with an empty `originAccessIdentity` field. Setting it to `undefined` or omitting it causes CloudFront to reject the configuration.

**Error Message:**

```
Invalid request provided: Exactly one of CustomOriginConfig, VpcOriginConfig and S3OriginConfig must be specified
```

**Root Cause:**

- CloudFront requires one of the three origin config types
- When using OAC, you still need `s3OriginConfig` but with empty `originAccessIdentity`
- The OAC ID is specified separately in `originAccessControlId`

**Solution:**

```typescript
origins: [
  {
    id: `S3-${bucket.bucketName}`,
    domainName: bucket.bucketRegionalDomainName,
    originAccessControlId: oac.originAccessControlId, // ✅ OAC reference
    s3OriginConfig: {
      originAccessIdentity: "", // ✅ Empty string for OAC (not undefined, not omitted)
    },
  },
];
```

**What NOT to do:**

```typescript
// ❌ Wrong - omitting s3OriginConfig
origins: [
  {
    id: `S3-${bucket.bucketName}`,
    domainName: bucket.bucketRegionalDomainName,
    originAccessControlId: oac.originAccessControlId,
    // Missing s3OriginConfig
  },
];

// ❌ Wrong - setting to undefined
s3OriginConfig: undefined;

// ❌ Wrong - using OAI pattern with OAC
s3OriginConfig: {
  originAccessIdentity: oai.cloudFrontOriginAccessIdentityS3CanonicalUserId;
}
```

---

### 3. Manual S3 Bucket Policy Application

**Problem:**
After CloudFront is deployed, S3 bucket needs a policy to allow CloudFront service principal to access objects. This must be done manually to avoid circular dependency.

**Solution:**
Create and apply bucket policy after CloudFront deployment:

```bash
# 1. Create policy file
cat > bucket-policy.json << 'EOF'
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
  --policy file://bucket-policy.json \
  --region REGION
```

**Important Notes:**

- Replace `BUCKET-NAME`, `ACCOUNT-ID`, `DISTRIBUTION-ID`, and `REGION` with actual values
- The `AWS:SourceArn` condition restricts access to only your specific CloudFront distribution
- This policy allows CloudFront to perform `s3:GetObject` on all objects in the bucket

---

### 4. CDK Lock File Issues

**Problem:**
When CDK deployments fail or are interrupted, lock files in `cdk.out` directory can prevent subsequent deployments.

**Error Message:**

```
Other CLIs (PID=400) are currently reading from cdk.out.
Invoke the CLI in sequence, or use '--output' to synth into different directories.
```

**Solutions:**

**Option 1: Clean CDK output directory**

```bash
rm -rf cdk.out
npm run cdk -- deploy ...
```

**Option 2: Use different output directory**

```bash
npm run cdk -- deploy ... --output cdk.out.new
```

**Prevention:**

- Don't interrupt CDK deployments mid-process
- Let failed deployments roll back completely before retrying
- Avoid using `tail` or other commands that might cause terminal disconnections during deployment

---

## Correct Deployment Sequence

### Step 1: Deploy CloudFront Stack

```bash
cd infra
npm run build
npm run cdk -- deploy -c env=staging LocalstaysStagingCloudFrontStack --require-approval never
```

**Expected Output:**

- Distribution ID (e.g., `E3EUKZ7Z8VLB3Q`)
- Distribution Domain (e.g., `dz45r0splw6d0.cloudfront.net`)
- OAC ID (e.g., `E178AI1GE2NDZ3`)

### Step 2: Apply S3 Bucket Policy

```bash
# Create policy file with actual values
cat > /tmp/cf-bucket-policy.json << 'EOF'
{
  "Version": "2012-10-17",
  "Statement": [{
    "Sid": "AllowCloudFrontServicePrincipal",
    "Effect": "Allow",
    "Principal": {"Service": "cloudfront.amazonaws.com"},
    "Action": "s3:GetObject",
    "Resource": "arn:aws:s3:::localstays-staging-host-assets/*",
    "Condition": {
      "StringEquals": {
        "AWS:SourceArn": "arn:aws:cloudfront::041608526793:distribution/E3EUKZ7Z8VLB3Q"
      }
    }
  }]
}
EOF

# Apply policy
aws s3api put-bucket-policy \
  --bucket localstays-staging-host-assets \
  --policy file:///tmp/cf-bucket-policy.json \
  --region eu-north-1
```

### Step 3: Test CloudFront Access

```bash
# Find an existing image in S3
aws s3 ls s3://localstays-staging-host-assets/ --recursive | grep "\.webp" | head -1

# Test CloudFront access (replace with actual image path)
curl -I "https://dz45r0splw6d0.cloudfront.net/HOST_ID/listings/LISTING_ID/images/IMAGE_ID-full.webp"
```

**Expected Response:**

- HTTP/2 200
- `x-cache: Miss from cloudfront` (first request) or `Hit from cloudfront` (subsequent)
- `via: CloudFront`

### Step 4: Deploy API Stack with CloudFront Domain

```bash
# This will update Lambda environment variables with CloudFront domain
npm run cdk -- deploy -c env=staging LocalstaysStagingApiStack --require-approval never
```

---

## Architecture Decisions

### Why L1 (CFN) Constructs Instead of L2?

**L2 Constructs (High-level):**

- ✅ Easier to use, more abstraction
- ✅ Automatic best practices
- ❌ Automatic bucket policy updates cause circular dependencies
- ❌ Less control over exact CloudFormation template

**L1 Constructs (Low-level):**

- ✅ Full control over CloudFormation template
- ✅ No automatic cross-stack dependencies
- ✅ Can avoid circular dependency issues
- ❌ More verbose code
- ❌ Need to handle more details manually

**Decision:** Use L1 constructs for CloudFront when bucket is in a separate stack.

### Why Manual Bucket Policy?

**Alternatives Considered:**

1. **Put CloudFront and S3 in same stack**

   - ❌ Violates separation of concerns
   - ❌ Makes stack updates riskier
   - ❌ Harder to manage independently

2. **Use Custom Resource to apply policy**

   - ❌ Adds complexity
   - ❌ Still creates dependency
   - ❌ Harder to debug

3. **Manual policy application** ✅
   - ✅ Simple and explicit
   - ✅ No circular dependencies
   - ✅ Easy to understand and debug
   - ✅ One-time operation per environment
   - ❌ Requires manual step (acceptable trade-off)

---

## CloudFront Configuration Details

### Origin Access Control (OAC) vs Origin Access Identity (OAI)

**Why OAC?**

- ✅ AWS recommended (OAI is legacy)
- ✅ Supports SSE-KMS encryption
- ✅ Supports dynamic requests (PUT, DELETE)
- ✅ Works with all S3 buckets (including those created after Dec 2022)
- ✅ Better security with service principal + condition

**OAC Configuration:**

```typescript
const oac = new cloudfront.S3OriginAccessControl(this, "OAC", {
  signing: cloudfront.Signing.SIGV4_NO_OVERRIDE,
});
```

### Cache Policy Configuration

**365-Day TTL for Images:**

```typescript
const imageCachePolicy = new cloudfront.CachePolicy(this, "ImageCachePolicy", {
  cachePolicyName: `localstays-${stage}-image-cache`,
  defaultTtl: cdk.Duration.days(365),
  minTtl: cdk.Duration.seconds(0),
  maxTtl: cdk.Duration.days(365),
  queryStringBehavior: cloudfront.CacheQueryStringBehavior.all(), // For versioning via ?v=timestamp
  headerBehavior: cloudfront.CacheHeaderBehavior.none(),
  cookieBehavior: cloudfront.CacheCookieBehavior.none(),
  enableAcceptEncodingGzip: true,
  enableAcceptEncodingBrotli: true,
});
```

**Why 365 days?**

- Images rarely change
- Use versioned URLs (`?v=timestamp`) to force cache refresh when needed
- Maximizes cache hit ratio and reduces costs

### Path-Based Behaviors

**Whitelisted Paths:**

1. `*/listings/*/images/*.webp` - Listing images (full and thumbnails)
2. `*/profile/*.webp` - Host profile photos

**Default Behavior:**

- Returns 403 Forbidden for non-whitelisted paths
- Prevents unauthorized access to verification documents and other sensitive files

### Cost Optimizations Applied

1. **PriceClass_100** - US, Canada, Europe only (~50% cost reduction)
2. **Logging disabled** - Saves storage and processing costs
3. **HTTP/2 and HTTP/3 enabled** - Better performance, no extra cost
4. **Compression enabled** - Reduces bandwidth, no extra cost
5. **IPv6 enabled** - Better connectivity, no extra cost
6. **No WAF initially** - Add only if bandwidth costs spike

---

## Testing Checklist

After deployment, verify:

- [ ] CloudFront distribution is deployed and enabled
- [ ] S3 bucket policy is applied
- [ ] Can access existing images via CloudFront URL
- [ ] First request shows `x-cache: Miss from cloudfront`
- [ ] Second request shows `x-cache: Hit from cloudfront`
- [ ] Non-whitelisted paths return 403 Forbidden
- [ ] Direct S3 access is blocked (bucket is private)
- [ ] CloudFront domain is passed to Lambda environment variables

---

## Common Errors & Quick Fixes

### Error: "Exactly one of CustomOriginConfig, VpcOriginConfig and S3OriginConfig must be specified"

**Fix:** Ensure `s3OriginConfig` is present with empty `originAccessIdentity: ""`

### Error: "ValidationError: ... would create a cyclic reference"

**Fix:** Remove `bucket.addToResourcePolicy()` from CloudFront stack, apply policy manually

### Error: "Other CLIs are currently reading from cdk.out"

**Fix:** `rm -rf cdk.out` or use `--output cdk.out.new`

### Error: "Access Denied" when accessing CloudFront URL

**Fix:** Check S3 bucket policy is applied correctly with correct distribution ID

### Error: CloudFront returns 403 for valid image paths

**Fix:** Verify path patterns in cache behaviors match your S3 key structure

---

## Future Improvements

1. **Automate bucket policy application** - Use CDK custom resource or separate deployment step
2. **Add monitoring** - CloudWatch alarms for 4xx/5xx errors, cache hit ratio
3. **Add WAF** - If bandwidth costs exceed threshold
4. **Custom domain** - For production (e.g., `cdn.localstays.com`)
5. **Geo-restriction** - If needed for compliance
6. **Lambda@Edge** - For advanced URL rewriting or authentication (evaluate cost first)

---

## References

- [AWS CloudFront OAC Documentation](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-s3.html)
- [AWS CDK CloudFront Origins](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_cloudfront_origins-readme.html)
- [CloudFront Best Practices](https://docs.aws.amazon.com/whitepapers/latest/secure-content-delivery-amazon-cloudfront/document-revisions.html)
- `CLOUDFRONT_INTEGRATION_PLAN.md` - Original planning document
- `CLOUDFRONT_COST_OPTIMIZATION_SUMMARY.md` - Cost optimization decisions
- `WAF_STRATEGY.md` - WAF implementation strategy
- `EMERGENCY_KILL_SWITCH_PROCEDURES.md` - Emergency procedures

---

## Deployment History

| Date       | Environment | Distribution ID | Status     | Notes                                                                   |
| ---------- | ----------- | --------------- | ---------- | ----------------------------------------------------------------------- |
| 2025-11-11 | staging     | E3EUKZ7Z8VLB3Q  | ✅ Success | Initial deployment, multiple attempts due to circular dependency issues |

---

## Key Takeaways

1. **Use L1 constructs for cross-stack CloudFront + S3 configurations** to avoid circular dependencies
2. **Always include `s3OriginConfig: { originAccessIdentity: "" }`** when using OAC
3. **Apply S3 bucket policy manually** after CloudFront deployment
4. **Test thoroughly** before updating API to use CloudFront URLs
5. **Document everything** - these issues are not obvious and easy to repeat
6. **Clean up lock files** if deployments fail or are interrupted

---

_Last Updated: November 11, 2025_
_Author: AI Assistant_
_Reviewed By: [Pending]_



