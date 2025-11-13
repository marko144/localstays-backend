# CloudFront Cost Optimization - Quick Reference

**Target:** Europe + US/Canada users  
**Goal:** Maximum performance, minimum cost

---

## Key Configuration Decisions

### 1. Price Class: `PriceClass_100` ✅

**Edge locations:** US, Canada, Europe only

**Cost savings:** ~30% cheaper than global distribution

**Performance:**

- ✅ Europe: Excellent (local edge)
- ✅ US/Canada: Excellent (local edge)
- ⚠️ Other regions: Routed to nearest edge (slightly higher latency)

**Verdict:** Perfect for vacation rental platform focused on Europe/North America

---

### 2. Cache TTL: 365 Days ✅

**Why maximum TTL:**

- 99% cache hit rate after warmup
- Minimizes expensive S3 GET requests
- Versioned URLs handle updates automatically

**Cost comparison (1M image views/month):**

- 1 day TTL (50% hit rate): $9.50/month
- 7 day TTL (80% hit rate): $9.35/month
- 30 day TTL (95% hit rate): $9.27/month
- **365 day TTL (99% hit rate): $9.25/month** ✅

---

### 3. Request Methods: GET + HEAD Only ✅

```typescript
allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD;
```

**Why not OPTIONS:**

- Images don't need CORS preflight
- `<img>` tags only use GET
- Reduces unnecessary requests

---

### 4. Compression: Enabled ✅

```typescript
compress: true;
enableAcceptEncodingGzip: true;
enableAcceptEncodingBrotli: true;
```

**Why enable:**

- Free feature
- Reduces data transfer
- Better performance

---

### 5. HTTP/2 and HTTP/3: Enabled ✅

```typescript
httpVersion: cloudfront.HttpVersion.HTTP2_AND_3;
```

**Why enable:**

- Free feature
- Better performance (multiplexing)
- Modern browser support

---

## Features to DISABLE (Cost Savings)

### ❌ CloudFront Logging

```typescript
enableLogging: false;
```

**Savings:** ~$10-50/month

**Why disable:**

- Logging costs add up at scale
- S3 storage costs for logs
- Lambda logs sufficient for debugging

**When to enable:** Temporarily for CloudFront-specific debugging

---

### ❌ Real-Time Logs

**Savings:** ~$20-100/month

**Why disable:**

- Expensive ($0.01 per 1M log lines)
- Standard CloudWatch metrics are sufficient
- Not needed for static images

---

### ❌ Lambda@Edge / CloudFront Functions

**Savings:** ~$50-200/month

**Why disable:**

- Not needed (path-based behaviors handle security)
- Expensive ($0.60 per 1M requests)
- Adds latency

**When to enable:** Only if you need dynamic image resizing or complex transformations

---

### ❌ Origin Shield

**Savings:** ~$100+/month

**Why disable:**

- Costs $0.01 per 10,000 requests
- Only beneficial at very high traffic (10M+ requests/month)
- S3 can handle current load

**When to enable:** If S3 costs become significant (>$100/month)

---

### ❌ Field-Level Encryption

**Savings:** ~$5-20/month

**Why disable:**

- Images are not sensitive data
- Adds processing overhead
- Unnecessary cost

---

### ❌ AWS WAF (For Image CDN)

**Cost:** $8-14/month ($5 Web ACL + $3 rules + $0.60 per 1M requests)

**Why disable for image CDN:**

- Images are read-only (no user input)
- GuardDuty already scans for malware
- Lower priority than web app WAF
- Enable only if bandwidth costs spike or scraping detected

**Important:** This is separate from **web app WAF** (which SHOULD be enabled for production web app)

---

### ❌ Real-Time Metrics

**Savings:** ~$7/month ($0.01 per metric per hour)

**Why disable:**

- Standard CloudWatch metrics are free and sufficient
- Real-time not needed for images

---

## Total Cost Savings (Image CDN Only)

**By keeping configuration lean:** **$254-579/month saved**

**Breakdown:**

- CloudFront Logging: $10-50/month
- Real-time Logs: $20-100/month
- Lambda@Edge: $50-200/month
- CloudFront Functions: $10-50/month
- Origin Shield: $100+/month
- Field-level Encryption: $5-20/month
- WAF (image CDN): $8-14/month
- Real-time Metrics: $7/month

**Note:** This is for the image CDN only. Web app WAF is a separate consideration and SHOULD be enabled for production.

---

## Monitoring (Free)

**Use built-in CloudWatch metrics:**

- Cache hit rate
- Error rate (4xx, 5xx)
- Bytes downloaded
- Request count

**Access:**

```bash
aws cloudwatch get-metric-statistics \
  --namespace AWS/CloudFront \
  --metric-name Requests \
  --dimensions Name=DistributionId,Value=E123... \
  --start-time 2024-11-01T00:00:00Z \
  --end-time 2024-11-11T00:00:00Z \
  --period 3600 \
  --statistics Sum
```

---

## When to Revisit Configuration

### Enable Origin Shield when:

- Traffic exceeds 10M requests/month
- S3 costs exceed $100/month
- Cache hit rate drops below 90%

### Enable CloudFront Logging when:

- Debugging CloudFront-specific issues
- Investigating unusual traffic patterns
- Compliance requirements

### Enable WAF on Image CDN when:

- Bandwidth costs spike (>$100/month)
- Unusual traffic patterns detected
- Image scraping/hotlinking detected
- Under DDoS attack specifically targeting images

### Enable WAF on Web App (PRIORITY):

- ✅ **Production launch** (protect authentication, API, user data)
- Protects against OWASP Top 10 (SQL injection, XSS, etc.)
- Rate limits API calls
- Blocks credential stuffing
- **Geo-blocking:** Block Asian countries (reduce bot traffic)
- **Cost:** ~$12/month (4 rules: Core, Bad Inputs, Rate Limit, Geo-block)

### Enable Lambda@Edge when:

- Need dynamic image resizing
- Need request/response manipulation
- Need geolocation-based logic

---

## Cost Comparison: Current vs CloudFront

**Scenario:** 1M image views/month, 100KB average image size

### Current (S3 Presigned URLs)

- S3 Data Transfer: 100GB × $0.09 = $9.00
- S3 GET Requests: 1M × $0.0004/1000 = $0.40
- Lambda (presigned URL generation): $0.20
- **Total: $9.60/month**

### With CloudFront (Optimized)

- CloudFront Data Transfer: 100GB × $0.085 = $8.50
- CloudFront Requests: 1M × $0.0075/10000 = $0.75
- S3 GET (1% cache miss): 10K × $0.0004/1000 = $0.004
- **Total: $9.25/month**

**Savings: $0.35/month (3.6%)**

**At 10M views/month:**

- Current: $96/month
- CloudFront: $81/month
- **Savings: $15/month (15.6%)**

**Savings increase with traffic due to caching!**

---

## Quick Checklist

**Before deployment:**

- [ ] Confirm target audience is primarily Europe + US/Canada
- [ ] Verify 365-day cache TTL is acceptable
- [ ] Confirm versioning strategy (using `updatedAt` timestamp)
- [ ] Verify no need for real-time logs or Lambda@Edge

**After deployment:**

- [ ] Monitor cache hit rate (should reach >95% after warmup)
- [ ] Monitor error rates (should be <1%)
- [ ] Verify CloudFront costs are as expected
- [ ] Confirm images load correctly in all regions

**Monthly review:**

- [ ] Check cache hit rate (target: >95%)
- [ ] Review CloudFront costs
- [ ] Check for any 4xx/5xx errors
- [ ] Verify no unnecessary features enabled

---

**Document Version:** 1.0  
**Last Updated:** 2025-11-11  
**Status:** ✅ Approved
