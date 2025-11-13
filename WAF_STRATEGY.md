# AWS WAF Strategy for Localstays

## Overview

AWS WAF (Web Application Firewall) protects against common web exploits and bots. We need WAF in **two places**:

1. **Web App CloudFront** (Frontend + API) - **HIGH PRIORITY** 🔴
2. **Image CDN CloudFront** (S3 images) - **LOW PRIORITY** 🟡

---

## WAF Pricing (Official AWS Pricing)

```
Web ACL (firewall): $5.00/month
Each rule: $1.00/month
Requests: $0.60 per 1 million requests
```

**Example costs:**

| Traffic        | Web ACL | Rules (3) | Requests | Total      |
| -------------- | ------- | --------- | -------- | ---------- |
| 1M req/month   | $5      | $3        | $0.60    | **$8.60**  |
| 10M req/month  | $5      | $3        | $6.00    | **$14.00** |
| 100M req/month | $5      | $3        | $60.00   | **$68.00** |

---

## 1. Web App WAF (HIGH PRIORITY) 🔴

### What It Protects

- **Frontend application** (React/Next.js served via CloudFront)
- **API Gateway endpoints** (authentication, listings, bookings)
- **User authentication** (login, signup, password reset)
- **Admin panel** (sensitive operations)

### Attack Vectors It Prevents

✅ **SQL Injection** - Malicious database queries  
✅ **Cross-Site Scripting (XSS)** - Injected JavaScript  
✅ **Cross-Site Request Forgery (CSRF)** - Unauthorized actions  
✅ **Credential Stuffing** - Automated login attempts  
✅ **API Abuse** - Excessive API calls  
✅ **Bot Traffic** - Automated scrapers and bots  
✅ **DDoS Attacks** - Overwhelming traffic

### Impact If Compromised

🔴 **CRITICAL:**

- User data breach
- Account takeover
- Payment information exposure
- Admin panel compromise
- Database manipulation

### Recommended Rules

#### 1. AWS Managed Rules - Core Rule Set ($1/month)

```
Protects against OWASP Top 10:
- SQL injection
- Cross-site scripting (XSS)
- Local file inclusion (LFI)
- Remote file inclusion (RFI)
- PHP injection
- Command injection
```

#### 2. AWS Managed Rules - Known Bad Inputs ($1/month)

```
Blocks known malicious patterns:
- Known exploit patterns
- Malicious user agents
- Known bad IP addresses
```

#### 3. Rate Limiting Rule ($1/month)

```json
{
  "Name": "RateLimitRule",
  "Priority": 1,
  "Statement": {
    "RateBasedStatement": {
      "Limit": 2000,
      "AggregateKeyType": "IP"
    }
  },
  "Action": {
    "Block": {}
  }
}
```

**Limits:** 2,000 requests per 5 minutes per IP

**Protects:**

- API endpoints from abuse
- Login endpoints from brute force
- Signup endpoints from bot registration

#### 4. Geo-Blocking Rule ($1/month) ✅ **ENABLED**

**Strategy:** Block Asian countries, allow Europe/US/Canada

```json
{
  "Name": "BlockAsiaRule",
  "Priority": 4,
  "Statement": {
    "GeoMatchStatement": {
      "CountryCodes": [
        "CN",
        "IN",
        "JP",
        "KR",
        "TH",
        "VN",
        "ID",
        "PH",
        "MY",
        "SG",
        "BD",
        "PK",
        "MM",
        "KH",
        "LA",
        "NP",
        "LK",
        "AF",
        "MN",
        "BT",
        "TW",
        "HK",
        "MO"
      ]
    }
  },
  "Action": {
    "Block": {}
  }
}
```

**Blocks:** Asian countries (China, India, Japan, Korea, Thailand, Vietnam, Indonesia, Philippines, Malaysia, Singapore, Bangladesh, Pakistan, Myanmar, Cambodia, Laos, Nepal, Sri Lanka, Afghanistan, Mongolia, Bhutan, Taiwan, Hong Kong, Macau)

**Allows:** Europe, US, Canada, Australia, New Zealand, South America, Africa, Middle East

**Benefits:**

- Reduces bot traffic from high-bot regions
- Reduces credential stuffing attempts
- Reduces API abuse
- Aligns with target market (Europe + North America)

**Note:** If you have legitimate users from blocked regions, they can contact support for whitelisting

### Cost Estimate (Web App WAF)

**Staging:**

- Traffic: ~100K requests/month
- Rules: 4 (Core, Bad Inputs, Rate Limit, Geo-block)
- Cost: $5 + $4 + $0.06 = **$9.06/month**

**Production (estimated):**

- Traffic: ~5M requests/month
- Rules: 4 (Core, Bad Inputs, Rate Limit, Geo-block)
- Cost: $5 + $4 + $3.00 = **$12.00/month**

### Recommendation

✅ **Enable for production launch** (with geo-blocking)  
❌ **Optional for staging** (low traffic, not critical)

---

## 2. Image CDN WAF (LOW PRIORITY) 🟡

### What It Protects

- **Listing images** (property photos)
- **Profile photos** (host avatars)
- **Static assets** (served via CloudFront)

### Attack Vectors It Prevents

⚠️ **Image Hotlinking** - Bandwidth theft  
⚠️ **Image Scraping** - Automated download of all images  
⚠️ **DDoS on Images** - Overwhelming image requests

### Impact If Compromised

🟡 **MEDIUM:**

- Increased bandwidth costs
- Slower image loading for legitimate users
- Potential data scraping (images are meant to be viewable anyway)

**NOT AT RISK:**

- No user data exposure (images are not sensitive)
- No authentication bypass
- No database access

### Recommended Rules (If Enabled)

#### 1. Rate Limiting Rule ($1/month)

```json
{
  "Name": "ImageRateLimitRule",
  "Priority": 1,
  "Statement": {
    "RateBasedStatement": {
      "Limit": 10000,
      "AggregateKeyType": "IP"
    }
  },
  "Action": {
    "Block": {}
  }
}
```

**Limits:** 10,000 requests per 5 minutes per IP  
**Protects:** Against scraping and excessive downloads

#### 2. Geo-Blocking Rule (Optional, $1/month)

```json
{
  "Name": "ImageGeoBlockRule",
  "Statement": {
    "NotStatement": {
      "Statement": {
        "GeoMatchStatement": {
          "CountryCodes": [
            "US",
            "CA",
            "GB",
            "DE",
            "FR",
            "IT",
            "ES",
            "NL",
            "SE",
            "NO",
            "DK",
            "FI"
          ]
        }
      }
    }
  },
  "Action": {
    "Block": {}
  }
}
```

**Aligns with:** PriceClass_100 (Europe + US/Canada)

### Cost Estimate (Image CDN WAF)

**If enabled:**

- Traffic: ~1M requests/month
- Cost: $5 + $2 + $0.60 = **$7.60/month**

### Recommendation

❌ **Start disabled** - Monitor bandwidth costs first  
✅ **Enable only if:**

- Bandwidth costs exceed $100/month
- Unusual traffic patterns detected
- Image scraping detected
- Under DDoS attack

---

## WAF Deployment Strategy

### Phase 1: Staging (Current)

```
Web App WAF: ❌ Disabled (low traffic, not critical)
Image CDN WAF: ❌ Disabled (not needed)
```

**Cost:** $0/month

---

### Phase 2: Production Launch

```
Web App WAF: ✅ ENABLED (protect users and API)
  - Core Rule Set
  - Known Bad Inputs
  - Rate Limiting (2,000 req/5min)
  - Geo-blocking (block Asia, allow Europe/US/Canada)

Image CDN WAF: ❌ Disabled (monitor first)
```

**Cost:** ~$12/month (web app with 4 rules)

---

### Phase 3: If Issues Arise

```
Web App WAF: ✅ Enabled
Image CDN WAF: ✅ Enable if bandwidth costs spike
```

**Cost:** ~$11 + $8 = **$19/month** (both)

---

## WAF vs Other Security Measures

### What WAF Does NOT Replace

❌ **GuardDuty** - Malware scanning (already enabled for S3)  
❌ **Cognito** - User authentication and authorization  
❌ **API Gateway throttling** - Request rate limiting at API level  
❌ **DynamoDB encryption** - Data at rest encryption  
❌ **HTTPS/TLS** - Data in transit encryption

### What WAF Adds

✅ **Application-layer protection** - OWASP Top 10  
✅ **Bot detection** - Automated traffic filtering  
✅ **Rate limiting** - Per-IP request limits  
✅ **Geo-blocking** - Country-based access control  
✅ **Custom rules** - Flexible pattern matching

---

## Monitoring WAF (Free)

### CloudWatch Metrics (Included)

- **AllowedRequests** - Requests that passed WAF
- **BlockedRequests** - Requests blocked by WAF
- **CountedRequests** - Requests matched but not blocked (count mode)

### View Blocked Requests

```bash
aws wafv2 list-web-acls --scope CLOUDFRONT --region us-east-1

aws wafv2 get-sampled-requests \
  --web-acl-id <web-acl-id> \
  --rule-metric-name <rule-name> \
  --scope CLOUDFRONT \
  --time-window StartTime=<timestamp>,EndTime=<timestamp> \
  --max-items 100 \
  --region us-east-1
```

### CloudWatch Dashboard (Free)

Create a dashboard to monitor:

- Blocked requests over time
- Top blocked IPs
- Rule match counts
- Request rate trends

---

## Cost-Benefit Analysis

### Web App WAF

**Cost:** ~$11/month  
**Benefit:** Protects against data breach, account takeover, API abuse  
**ROI:** High - One prevented breach saves thousands in damages and reputation

**Verdict:** ✅ **Worth it for production**

---

### Image CDN WAF

**Cost:** ~$8/month  
**Benefit:** Reduces bandwidth theft and scraping  
**ROI:** Low - Only saves money if bandwidth costs are high

**Scenario 1: Low traffic (1M image views/month)**

- Bandwidth cost without WAF: ~$9/month
- WAF cost: $8/month
- **Verdict:** ❌ Not worth it (WAF costs almost as much as bandwidth)

**Scenario 2: High traffic (100M image views/month)**

- Bandwidth cost without WAF: ~$900/month
- Bandwidth cost with WAF (blocks 20% bad traffic): ~$720/month
- WAF cost: $68/month
- **Savings:** $180 - $68 = $112/month
- **Verdict:** ✅ Worth it (saves $112/month)

**Threshold:** Enable image CDN WAF when bandwidth costs exceed **$100/month**

---

## Implementation Checklist

### Web App WAF (Production Launch)

- [ ] Create Web ACL for web app CloudFront distribution
- [ ] Add Core Rule Set (AWS Managed)
- [ ] Add Known Bad Inputs (AWS Managed)
- [ ] Add Rate Limiting Rule (2,000 req/5min)
- [ ] Add Geo-blocking Rule (block Asian countries)
- [ ] Associate Web ACL with web app CloudFront distribution
- [ ] Test with legitimate traffic from Europe/US/Canada
- [ ] Verify Asian traffic is blocked
- [ ] Monitor blocked requests
- [ ] Adjust rules if false positives occur

### Image CDN WAF (If Needed)

- [ ] Monitor bandwidth costs monthly
- [ ] If costs exceed $100/month, investigate traffic patterns
- [ ] If scraping/hotlinking detected, create Web ACL for image CDN
- [ ] Add Rate Limiting Rule (10,000 req/5min)
- [ ] Optional: Add Geo-blocking Rule
- [ ] Associate Web ACL with image CDN CloudFront distribution
- [ ] Monitor effectiveness

---

## Summary

| Aspect                    | Web App WAF                                  | Image CDN WAF              |
| ------------------------- | -------------------------------------------- | -------------------------- |
| **Priority**              | 🔴 High                                      | 🟡 Low                     |
| **When to enable**        | Production launch                            | When bandwidth >$100/month |
| **Cost**                  | ~$12/month (4 rules inc. geo-blocking)       | ~$8/month                  |
| **Protects**              | User data, auth, API                         | Bandwidth, scraping        |
| **Rules**                 | Core, Bad Inputs, Rate Limit, Geo-block Asia | Rate Limit, Geo-block      |
| **Impact if compromised** | Critical (data breach)                       | Low (cost increase)        |
| **Recommendation**        | ✅ Enable for production with geo-blocking   | ❌ Start disabled, monitor |

---

**Document Version:** 1.0  
**Last Updated:** 2025-11-11  
**Status:** ✅ Approved
