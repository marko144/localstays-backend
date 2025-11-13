# Bandwidth Cost Monitoring Guide

## How to Know If Your Bandwidth Costs Are Spiking

This guide shows you how to monitor CloudFront and S3 bandwidth costs to detect spikes early.

---

## 1. CloudWatch Metrics (Free, Built-in)

### CloudFront Metrics

**View in AWS Console:**

1. Go to **CloudWatch** → **Metrics** → **All metrics**
2. Select **CloudFront**
3. Select **Per-Distribution Metrics**
4. Choose your distribution ID

**Key metrics to monitor:**

| Metric              | What It Measures       | Normal Range      | Alert Threshold |
| ------------------- | ---------------------- | ----------------- | --------------- |
| **BytesDownloaded** | Total data transferred | Varies by traffic | >100 GB/day     |
| **Requests**        | Number of requests     | Varies by traffic | >1M/day         |
| **4xxErrorRate**    | Client errors (%)      | <1%               | >5%             |
| **5xxErrorRate**    | Server errors (%)      | <0.1%             | >1%             |

---

### S3 Metrics

**View in AWS Console:**

1. Go to **CloudWatch** → **Metrics** → **All metrics**
2. Select **S3**
3. Select **Storage Metrics** or **Request Metrics**

**Key metrics to monitor:**

| Metric              | What It Measures         | Normal Range   | Alert Threshold |
| ------------------- | ------------------------ | -------------- | --------------- |
| **BytesDownloaded** | Data transferred from S3 | Varies         | >50 GB/day      |
| **GetRequests**     | Number of GET requests   | Varies         | >500K/day       |
| **BucketSizeBytes** | Total storage used       | Growing slowly | Sudden jumps    |

---

## 2. AWS Cost Explorer (Free, Daily Updates)

**Best for:** Understanding actual costs over time

### How to Use:

1. Go to **AWS Billing Console** → **Cost Explorer**
2. Click **Create report**
3. Configure:
   - **Time range:** Last 30 days
   - **Granularity:** Daily
   - **Group by:** Service
   - **Filter:** Service = CloudFront OR S3

### What to Look For:

**Normal pattern:**

```
Day 1: $0.30
Day 2: $0.32
Day 3: $0.29
Day 4: $0.31
```

**Spike pattern:**

```
Day 1: $0.30
Day 2: $0.32
Day 3: $2.50  ← SPIKE!
Day 4: $2.80  ← Continued spike
```

### Cost Breakdown:

**CloudFront costs:**

- Data Transfer Out: $0.085/GB
- Requests: $0.0075 per 10,000

**S3 costs:**

- Data Transfer Out: $0.09/GB
- GET Requests: $0.0004 per 1,000

---

## 3. CloudWatch Alarms (Free, Real-time)

### Create Alarm for High Bandwidth

**For CloudFront:**

```bash
aws cloudwatch put-metric-alarm \
  --alarm-name "CloudFront-High-Bandwidth" \
  --alarm-description "Alert when CloudFront bandwidth exceeds 100GB/day" \
  --metric-name BytesDownloaded \
  --namespace AWS/CloudFront \
  --statistic Sum \
  --period 86400 \
  --threshold 107374182400 \
  --comparison-operator GreaterThanThreshold \
  --evaluation-periods 1 \
  --dimensions Name=DistributionId,Value=E1234567890ABC \
  --alarm-actions arn:aws:sns:eu-north-1:123456789012:billing-alerts
```

**For S3:**

```bash
aws cloudwatch put-metric-alarm \
  --alarm-name "S3-High-Bandwidth" \
  --alarm-description "Alert when S3 bandwidth exceeds 50GB/day" \
  --metric-name BytesDownloaded \
  --namespace AWS/S3 \
  --statistic Sum \
  --period 86400 \
  --threshold 53687091200 \
  --comparison-operator GreaterThanThreshold \
  --evaluation-periods 1 \
  --dimensions Name=BucketName,Value=localstays-staging-host-assets \
  --alarm-actions arn:aws:sns:eu-north-1:123456789012:billing-alerts
```

### Recommended Thresholds:

| Environment           | CloudFront | S3        | Total Daily Cost |
| --------------------- | ---------- | --------- | ---------------- |
| **Staging**           | 10 GB/day  | 5 GB/day  | ~$1.50/day       |
| **Production (low)**  | 100 GB/day | 20 GB/day | ~$10/day         |
| **Production (high)** | 500 GB/day | 50 GB/day | ~$50/day         |

---

## 4. Budget Alerts (Free, Monthly)

### Create AWS Budget:

1. Go to **AWS Billing Console** → **Budgets**
2. Click **Create budget**
3. Select **Cost budget**
4. Configure:
   - **Budget name:** CloudFront-S3-Monthly
   - **Period:** Monthly
   - **Budget amount:** $50 (adjust based on expected usage)
   - **Filters:** Service = CloudFront OR S3

### Alert Thresholds:

- **50% of budget:** Warning email
- **80% of budget:** Critical email
- **100% of budget:** Critical email + SMS (optional)

---

## 5. Daily Cost Monitoring Script

### Create a Simple Script:

```bash
#!/bin/bash
# daily-cost-check.sh

DISTRIBUTION_ID="E1234567890ABC"
BUCKET_NAME="localstays-staging-host-assets"
THRESHOLD_GB=100

# Get CloudFront bytes downloaded in last 24 hours
BYTES=$(aws cloudwatch get-metric-statistics \
  --namespace AWS/CloudFront \
  --metric-name BytesDownloaded \
  --dimensions Name=DistributionId,Value=$DISTRIBUTION_ID \
  --start-time $(date -u -d '24 hours ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 86400 \
  --statistics Sum \
  --query 'Datapoints[0].Sum' \
  --output text)

# Convert to GB
GB=$(echo "scale=2; $BYTES / 1073741824" | bc)

echo "CloudFront bandwidth in last 24h: ${GB} GB"

# Check if over threshold
if (( $(echo "$GB > $THRESHOLD_GB" | bc -l) )); then
  echo "⚠️  WARNING: Bandwidth spike detected!"
  # Send alert (email, Slack, etc.)
fi
```

### Run Daily via Cron:

```bash
# Add to crontab
0 9 * * * /path/to/daily-cost-check.sh >> /var/log/bandwidth-check.log
```

---

## 6. What Causes Bandwidth Spikes?

### Common Causes:

1. **Image Scraping**

   - Someone downloading all images systematically
   - Solution: Enable WAF with rate limiting

2. **Hotlinking**

   - Other websites embedding your images
   - Solution: Enable WAF with referer checking

3. **DDoS Attack**

   - Malicious traffic overwhelming your CDN
   - Solution: Enable WAF with rate limiting and geo-blocking

4. **Viral Content**

   - Legitimate traffic spike (good problem!)
   - Solution: Monitor and scale if needed

5. **Bot Traffic**

   - Automated crawlers downloading images
   - Solution: Enable WAF with bot detection

6. **Large File Uploads/Downloads**
   - Users uploading very large images
   - Solution: Implement file size limits in frontend

---

## 7. Investigating a Spike

### Step 1: Check CloudWatch Metrics

```bash
# Get CloudFront requests in last 24 hours
aws cloudwatch get-metric-statistics \
  --namespace AWS/CloudFront \
  --metric-name Requests \
  --dimensions Name=DistributionId,Value=E1234567890ABC \
  --start-time $(date -u -d '24 hours ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 3600 \
  --statistics Sum
```

### Step 2: Check S3 Access Logs (if enabled)

```bash
# Download recent S3 access logs
aws s3 sync s3://your-logs-bucket/cloudfront/ ./logs/ --exclude "*" --include "$(date +%Y-%m-%d)*"

# Analyze top IPs
cat logs/* | awk '{print $5}' | sort | uniq -c | sort -rn | head -20
```

### Step 3: Check CloudFront Access Logs (if enabled)

```bash
# Download recent CloudFront logs
aws s3 sync s3://your-logs-bucket/cloudfront/ ./logs/ --exclude "*" --include "$(date +%Y-%m-%d)*"

# Analyze top requesting IPs
zcat logs/*.gz | awk '{print $5}' | sort | uniq -c | sort -rn | head -20

# Analyze top requested files
zcat logs/*.gz | awk '{print $8}' | sort | uniq -c | sort -rn | head -20
```

### Step 4: Check for Patterns

**Questions to ask:**

- Is it a single IP or multiple IPs?
- Is it targeting specific files or all files?
- Is it coming from a specific country?
- Is it during specific hours?
- Is the traffic legitimate (users) or automated (bots)?

---

## 8. Quick Response Actions

### If Bandwidth Spike Detected:

**Immediate (5 minutes):**

1. Check CloudWatch metrics to confirm spike
2. Check Cost Explorer to see actual cost impact
3. Identify if it's CloudFront or S3 (or both)

**Short-term (1 hour):**

1. Enable CloudFront logging temporarily
2. Analyze logs to identify source
3. If malicious, block IPs via WAF
4. If scraping, enable rate limiting

**Long-term (1 day):**

1. Enable WAF if not already enabled
2. Add rate limiting rules
3. Add geo-blocking if traffic from unexpected regions
4. Review and optimize cache settings

---

## 9. Cost Estimation Calculator

### Quick Calculation:

**CloudFront cost per GB:**

```
$0.085/GB × [GB transferred] = CloudFront cost
```

**Example:**

- 100 GB/day × $0.085 = $8.50/day = **$255/month**
- 500 GB/day × $0.085 = $42.50/day = **$1,275/month**

**S3 cost per GB:**

```
$0.09/GB × [GB transferred] = S3 cost
```

**Total monthly cost estimate:**

```
(Daily GB × 30 days × $0.085) + (Requests/10K × $0.0075) = Monthly cost
```

---

## 10. Monitoring Dashboard (CloudWatch)

### Create Custom Dashboard:

1. Go to **CloudWatch** → **Dashboards** → **Create dashboard**
2. Add widgets:

**Widget 1: CloudFront Bandwidth (Line graph)**

- Metric: `BytesDownloaded`
- Statistic: Sum
- Period: 1 hour
- Time range: Last 7 days

**Widget 2: CloudFront Requests (Line graph)**

- Metric: `Requests`
- Statistic: Sum
- Period: 1 hour
- Time range: Last 7 days

**Widget 3: Error Rates (Line graph)**

- Metrics: `4xxErrorRate`, `5xxErrorRate`
- Statistic: Average
- Period: 5 minutes
- Time range: Last 24 hours

**Widget 4: Daily Cost (Number)**

- Use Math expression: `BytesDownloaded / 1073741824 * 0.085`
- Shows estimated daily cost

### Example Dashboard JSON:

```json
{
  "widgets": [
    {
      "type": "metric",
      "properties": {
        "metrics": [["AWS/CloudFront", "BytesDownloaded", { "stat": "Sum" }]],
        "period": 3600,
        "stat": "Sum",
        "region": "us-east-1",
        "title": "CloudFront Bandwidth (GB/hour)",
        "yAxis": {
          "left": {
            "label": "Bytes"
          }
        }
      }
    }
  ]
}
```

---

## 11. Recommended Monitoring Schedule

### Daily:

- ✅ Check CloudWatch dashboard (5 minutes)
- ✅ Review any alarm notifications

### Weekly:

- ✅ Review Cost Explorer for trends (10 minutes)
- ✅ Check for unusual patterns

### Monthly:

- ✅ Full cost analysis (30 minutes)
- ✅ Adjust budgets and alarms if needed
- ✅ Review and optimize cache settings

---

## 12. Alert Notification Setup

### Create SNS Topic for Alerts:

```bash
# Create SNS topic
aws sns create-topic --name bandwidth-alerts

# Subscribe email
aws sns subscribe \
  --topic-arn arn:aws:sns:eu-north-1:123456789012:bandwidth-alerts \
  --protocol email \
  --notification-endpoint your-email@example.com

# Subscribe SMS (optional)
aws sns subscribe \
  --topic-arn arn:aws:sns:eu-north-1:123456789012:bandwidth-alerts \
  --protocol sms \
  --notification-endpoint +1234567890
```

### Email Alert Example:

```
Subject: ⚠️ CloudFront Bandwidth Spike Detected

CloudFront distribution E1234567890ABC has exceeded the bandwidth threshold.

Current bandwidth: 150 GB/day
Threshold: 100 GB/day
Estimated daily cost: $12.75

Action required:
1. Check CloudWatch metrics
2. Review access logs
3. Enable WAF if not already enabled

View metrics: https://console.aws.amazon.com/cloudwatch/...
```

---

## Summary: Quick Reference

| Monitoring Method      | Update Frequency | Best For              | Cost              |
| ---------------------- | ---------------- | --------------------- | ----------------- |
| **CloudWatch Metrics** | Real-time        | Quick checks          | Free              |
| **Cost Explorer**      | Daily            | Cost trends           | Free              |
| **CloudWatch Alarms**  | Real-time        | Automated alerts      | Free              |
| **AWS Budgets**        | Daily            | Monthly cost tracking | Free              |
| **Access Logs**        | Real-time        | Detailed analysis     | Storage cost only |
| **Custom Dashboard**   | Real-time        | Visual monitoring     | Free              |

### Recommended Setup:

1. ✅ **Create CloudWatch alarms** for bandwidth >100 GB/day
2. ✅ **Set up AWS Budget** for monthly CloudFront+S3 costs
3. ✅ **Create CloudWatch dashboard** for daily monitoring
4. ✅ **Enable SNS notifications** for email alerts
5. ⚠️ **Enable access logs** only when investigating issues (costs extra)

### When to Enable Image CDN WAF:

- Bandwidth costs exceed **$100/month** (sustained)
- Multiple bandwidth spikes detected
- Scraping or hotlinking identified
- DDoS attack targeting images

---

**Document Version:** 1.0  
**Last Updated:** 2025-11-11  
**Status:** ✅ Approved
