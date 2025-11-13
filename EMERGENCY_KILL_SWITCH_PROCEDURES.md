# Emergency Kill Switch Procedures

## Overview

If your service is under attack (DDoS, abuse, excessive costs), you have multiple "kill switches" to stop the bleeding immediately.

**Response time hierarchy:**

1. **30 seconds:** Disable CloudFront distribution
2. **1 minute:** Enable WAF with aggressive blocking
3. **2 minutes:** Disable API Gateway
4. **5 minutes:** Rollback to presigned URLs
5. **Nuclear option:** Delete CloudFront distribution

---

## Kill Switch 1: Disable CloudFront Distribution (30 seconds) 🔴

**What it does:**

- Stops all traffic to CloudFront immediately
- Images stop loading (users see broken images)
- API still works (if separate from CloudFront)

**When to use:**

- DDoS attack specifically targeting images
- Bandwidth costs spiking uncontrollably
- Malicious traffic overwhelming CloudFront

### How to Execute:

**Via AWS Console (30 seconds):**

1. Go to **CloudFront** → **Distributions**
2. Select your distribution
3. Click **Disable**
4. Confirm

**Via AWS CLI (10 seconds):**

```bash
# Get distribution config
aws cloudfront get-distribution-config \
  --id E1234567890ABC \
  --query 'DistributionConfig' \
  > /tmp/dist-config.json

# Edit config: Set "Enabled": false
sed -i 's/"Enabled": true/"Enabled": false/' /tmp/dist-config.json

# Update distribution
aws cloudfront update-distribution \
  --id E1234567890ABC \
  --if-match $(aws cloudfront get-distribution-config --id E1234567890ABC --query 'ETag' --output text) \
  --distribution-config file:///tmp/dist-config.json
```

**Effect:**

- ✅ Stops all CloudFront traffic immediately
- ✅ Stops bandwidth costs
- ❌ Images stop loading (broken images on frontend)
- ❌ Takes 15-30 minutes to propagate globally

**Rollback:**

- Re-enable distribution (same process, set `"Enabled": true`)

---

## Kill Switch 2: Enable Emergency WAF Rules (1 minute) 🟡

**What it does:**

- Blocks all traffic except whitelisted IPs
- Or blocks all traffic from specific countries
- Or blocks all traffic above very low rate limit

**When to use:**

- Under DDoS attack
- Excessive bot traffic
- Need to allow only your team to access

### How to Execute:

**Option A: Block All Except Whitelisted IPs**

```bash
# Create emergency IP whitelist rule
aws wafv2 create-rule-group \
  --scope CLOUDFRONT \
  --name EmergencyWhitelist \
  --capacity 10 \
  --rules '[
    {
      "Name": "AllowOnlyWhitelistedIPs",
      "Priority": 0,
      "Statement": {
        "NotStatement": {
          "Statement": {
            "IPSetReferenceStatement": {
              "Arn": "arn:aws:wafv2:us-east-1:123456789012:global/ipset/whitelist/..."
            }
          }
        }
      },
      "Action": {
        "Block": {}
      }
    }
  ]' \
  --region us-east-1
```

**Option B: Aggressive Rate Limiting**

```bash
# Create emergency rate limit rule (100 requests per 5 minutes)
aws wafv2 update-web-acl \
  --scope CLOUDFRONT \
  --id <web-acl-id> \
  --name <web-acl-name> \
  --rules '[
    {
      "Name": "EmergencyRateLimit",
      "Priority": 0,
      "Statement": {
        "RateBasedStatement": {
          "Limit": 100,
          "AggregateKeyType": "IP"
        }
      },
      "Action": {
        "Block": {}
      }
    }
  ]' \
  --region us-east-1
```

**Option C: Block All Traffic**

```bash
# Create rule to block everything
aws wafv2 update-web-acl \
  --scope CLOUDFRONT \
  --id <web-acl-id> \
  --name <web-acl-name> \
  --default-action '{"Block": {}}' \
  --region us-east-1
```

**Effect:**

- ✅ Stops malicious traffic
- ✅ Reduces bandwidth costs
- ⚠️ May block legitimate users (depending on rule)
- ✅ Takes effect in seconds

**Rollback:**

- Remove emergency rules
- Restore original WAF configuration

---

## Kill Switch 3: Disable API Gateway (2 minutes) 🔴

**What it does:**

- Stops all API traffic
- Frontend cannot fetch data
- Entire application goes offline

**When to use:**

- Severe attack on API endpoints
- Database being overwhelmed
- Need to stop all traffic immediately

### How to Execute:

**Via AWS Console:**

1. Go to **API Gateway** → **APIs**
2. Select your API
3. Go to **Stages** → Select stage (e.g., `staging`)
4. Click **Disable**

**Via AWS CLI:**

```bash
# Update stage to disable
aws apigateway update-stage \
  --rest-api-id abc123 \
  --stage-name staging \
  --patch-operations op=replace,path=/deploymentId,value=null
```

**Effect:**

- ✅ Stops all API traffic immediately
- ❌ Entire application goes offline
- ✅ Stops all costs related to API calls

**Rollback:**

- Re-enable API Gateway stage
- Redeploy API

---

## Kill Switch 4: Rollback to Presigned URLs (5 minutes) 🟡

**What it does:**

- Switches from CloudFront URLs back to S3 presigned URLs
- CloudFront stays running but unused
- Images load from S3 directly

**When to use:**

- CloudFront issue causing problems
- Need to revert quickly
- CloudFront costs too high

### How to Execute:

**Update Lambda environment variable:**

```bash
# Set USE_CLOUDFRONT=false
aws lambda update-function-configuration \
  --function-name LocalstaysStagingApiLambdaStack-hostListingsHandler... \
  --environment Variables='{
    "TABLE_NAME": "localstays-staging-main",
    "BUCKET_NAME": "localstays-staging-host-assets",
    "CLOUDFRONT_DOMAIN": "d123.cloudfront.net",
    "USE_CLOUDFRONT": "false"
  }' \
  --region eu-north-1
```

**Effect:**

- ✅ Images load from S3 (presigned URLs)
- ✅ CloudFront bypassed
- ✅ Takes effect in 30 seconds
- ⚠️ Presigned URLs expire in 5 minutes (users need to refresh)

**Rollback:**

- Set `USE_CLOUDFRONT=true`

---

## Kill Switch 5: Delete CloudFront Distribution (Nuclear Option) 🔴💀

**What it does:**

- Permanently deletes CloudFront distribution
- Cannot be undone
- Must recreate from scratch

**When to use:**

- Only as absolute last resort
- If all other options fail
- If you decide to abandon CloudFront permanently

### How to Execute:

**Step 1: Disable distribution first**

```bash
aws cloudfront update-distribution \
  --id E1234567890ABC \
  --if-match <etag> \
  --distribution-config file:///tmp/disabled-config.json
```

**Step 2: Wait for deployment (15-30 minutes)**

**Step 3: Delete distribution**

```bash
aws cloudfront delete-distribution \
  --id E1234567890ABC \
  --if-match <etag>
```

**Effect:**

- ✅ Completely removes CloudFront
- ❌ Cannot be undone
- ❌ Must recreate and redeploy
- ❌ Takes 15-30 minutes

**Rollback:**

- Must redeploy entire CloudFront stack via CDK

---

## Emergency Response Playbook

### Scenario 1: DDoS Attack on Images

**Symptoms:**

- CloudFront bandwidth spiking
- Costs increasing rapidly
- Same images requested repeatedly

**Response (in order):**

1. **Enable WAF rate limiting** (1 minute)

   ```bash
   # Reduce rate limit to 1,000 req/5min
   aws wafv2 update-web-acl --rules '[{"RateBasedStatement": {"Limit": 1000}}]'
   ```

2. **Enable geo-blocking** (2 minutes)

   ```bash
   # Block all countries except target markets
   aws wafv2 update-web-acl --rules '[{"GeoMatchStatement": {"CountryCodes": [...]}}]'
   ```

3. **If still overwhelmed, disable CloudFront** (30 seconds)

   ```bash
   aws cloudfront update-distribution --distribution-config '{"Enabled": false}'
   ```

4. **Rollback to presigned URLs** (5 minutes)
   ```bash
   aws lambda update-function-configuration --environment Variables='{"USE_CLOUDFRONT": "false"}'
   ```

---

### Scenario 2: API Abuse

**Symptoms:**

- API Gateway costs spiking
- Database overwhelmed
- Excessive API calls

**Response (in order):**

1. **Enable WAF on API Gateway** (2 minutes)

   - Add rate limiting rule (100 req/5min)

2. **Enable API Gateway throttling** (1 minute)

   ```bash
   aws apigateway update-stage \
     --rest-api-id abc123 \
     --stage-name staging \
     --patch-operations op=replace,path=/throttle/rateLimit,value=100
   ```

3. **If still overwhelmed, disable API Gateway** (2 minutes)
   ```bash
   aws apigateway update-stage --deployment-id null
   ```

---

### Scenario 3: Bandwidth Costs Spiking

**Symptoms:**

- CloudFront costs >$100/day
- Unusual traffic patterns
- Scraping detected

**Response (in order):**

1. **Check CloudWatch metrics** (1 minute)

   - Identify source of traffic

2. **Enable WAF rate limiting** (1 minute)

   - Limit to 10,000 req/5min per IP

3. **Block malicious IPs** (2 minutes)

   ```bash
   aws wafv2 update-ip-set --addresses '["1.2.3.4/32", "5.6.7.8/32"]'
   ```

4. **If costs still high, disable CloudFront** (30 seconds)
   ```bash
   aws cloudfront update-distribution --distribution-config '{"Enabled": false}'
   ```

---

## Pre-Configured Kill Switch Scripts

### Create Emergency Scripts:

**`kill-switch-cloudfront.sh`:**

```bash
#!/bin/bash
# Emergency: Disable CloudFront distribution

DISTRIBUTION_ID="E1234567890ABC"

echo "⚠️  EMERGENCY: Disabling CloudFront distribution..."

# Get current config
aws cloudfront get-distribution-config \
  --id $DISTRIBUTION_ID \
  --query 'DistributionConfig' \
  > /tmp/dist-config.json

# Backup original
cp /tmp/dist-config.json /tmp/dist-config-backup-$(date +%s).json

# Disable
sed -i 's/"Enabled": true/"Enabled": false/' /tmp/dist-config.json

# Get ETag
ETAG=$(aws cloudfront get-distribution-config --id $DISTRIBUTION_ID --query 'ETag' --output text)

# Update
aws cloudfront update-distribution \
  --id $DISTRIBUTION_ID \
  --if-match $ETAG \
  --distribution-config file:///tmp/dist-config.json

echo "✅ CloudFront distribution disabled. Takes 15-30 minutes to propagate."
echo "📁 Backup saved: /tmp/dist-config-backup-*.json"
```

**`kill-switch-rollback-presigned.sh`:**

```bash
#!/bin/bash
# Emergency: Rollback to presigned URLs

FUNCTION_NAME="LocalstaysStagingApiLambdaStack-hostListingsHandler..."

echo "⚠️  EMERGENCY: Rolling back to presigned URLs..."

# Update Lambda environment
aws lambda update-function-configuration \
  --function-name $FUNCTION_NAME \
  --environment Variables='{
    "TABLE_NAME": "localstays-staging-main",
    "BUCKET_NAME": "localstays-staging-host-assets",
    "CLOUDFRONT_DOMAIN": "d123.cloudfront.net",
    "USE_CLOUDFRONT": "false"
  }' \
  --region eu-north-1

echo "✅ Rolled back to presigned URLs. Takes effect in 30 seconds."
```

**`kill-switch-waf-emergency.sh`:**

```bash
#!/bin/bash
# Emergency: Enable aggressive WAF rate limiting

WEB_ACL_ID="abc123..."
WEB_ACL_NAME="localstays-staging-web-acl"

echo "⚠️  EMERGENCY: Enabling aggressive WAF rate limiting..."

# Create emergency rate limit (100 req/5min)
aws wafv2 update-web-acl \
  --scope CLOUDFRONT \
  --id $WEB_ACL_ID \
  --name $WEB_ACL_NAME \
  --rules '[
    {
      "Name": "EmergencyRateLimit",
      "Priority": 0,
      "Statement": {
        "RateBasedStatement": {
          "Limit": 100,
          "AggregateKeyType": "IP"
        }
      },
      "Action": {
        "Block": {}
      },
      "VisibilityConfig": {
        "SampledRequestsEnabled": true,
        "CloudWatchMetricsEnabled": true,
        "MetricName": "EmergencyRateLimit"
      }
    }
  ]' \
  --region us-east-1

echo "✅ Emergency rate limiting enabled. Takes effect immediately."
```

---

## Recovery Procedures

### After Using Kill Switch:

1. **Investigate the issue**

   - Check CloudWatch logs
   - Analyze traffic patterns
   - Identify root cause

2. **Fix the issue**

   - Block malicious IPs
   - Enable WAF rules
   - Adjust rate limits

3. **Test in staging**

   - Re-enable CloudFront
   - Monitor for 1 hour
   - Verify issue resolved

4. **Re-enable production**
   - Gradually restore service
   - Monitor closely
   - Keep kill switch ready

---

## Monitoring After Kill Switch

**Set up enhanced monitoring:**

1. **CloudWatch alarms** (more aggressive thresholds)

   - Bandwidth >50 GB/day (was 100 GB/day)
   - Requests >500K/day (was 1M/day)

2. **Real-time monitoring** (temporarily)

   - Enable CloudFront logging
   - Monitor every hour

3. **Cost alerts** (lower thresholds)
   - Alert at $25/day (was $50/day)

---

## Summary: Kill Switch Options

| Kill Switch                 | Speed  | Impact                   | Reversible | When to Use       |
| --------------------------- | ------ | ------------------------ | ---------- | ----------------- |
| **Disable CloudFront**      | 30 sec | Images stop loading      | Yes        | DDoS on images    |
| **Emergency WAF**           | 1 min  | Blocks malicious traffic | Yes        | Bot attack        |
| **Disable API Gateway**     | 2 min  | App goes offline         | Yes        | Severe API abuse  |
| **Rollback presigned URLs** | 5 min  | CloudFront bypassed      | Yes        | CloudFront issues |
| **Delete CloudFront**       | 30 min | Permanent removal        | No         | Last resort only  |

### Recommended Order:

1. Try **Emergency WAF** first (least disruptive)
2. If that fails, **Rollback to presigned URLs**
3. If still issues, **Disable CloudFront**
4. Only as last resort, **Disable API Gateway**
5. Never delete CloudFront unless abandoning permanently

---

## Contact Information

**In case of emergency:**

- AWS Support: https://console.aws.amazon.com/support/
- Phone: [Your AWS support number]
- Slack: #infrastructure-alerts

**Keep these scripts ready:**

- `/scripts/kill-switch-cloudfront.sh`
- `/scripts/kill-switch-rollback-presigned.sh`
- `/scripts/kill-switch-waf-emergency.sh`

---

**Document Version:** 1.0  
**Last Updated:** 2025-11-11  
**Status:** ✅ Critical - Keep Updated
