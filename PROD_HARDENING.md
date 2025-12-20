# Production Hardening - Remaining Work

**Last Updated:** December 19, 2025

## Blocked (Waiting for AWS)

- **Lambda Concurrency Limits**: Requested increase from 10 to 1000+ (ticket submitted)

## Critical for Launch

### 1. CloudWatch Alarms (~30 alarms)

#### API Gateway Alarms (per API × 4 APIs)

- 5xx error rate > 1%
- 4xx error rate > 10%
- Latency p99 > 5 seconds

#### Lambda Alarms (critical functions only)

- Error rate > 1%
- Throttles > 0
- Duration approaching timeout

#### DynamoDB Alarms

- Read/Write throttles > 0
- System errors > 0

#### Account-Level Alarms

- Lambda concurrent executions > 80% of quota

### Monitoring Approach

- **Initial:** Manual monitoring via CloudWatch console
- Check CloudWatch Alarms dashboard daily during launch period
- Add SNS notifications later if needed

---

## Post-Launch (After Verifying Production Works)

### 1. WAF on API Gateway

**Status:** ⏸️ DEFERRED - Implement after production is stable

**Why Deferred:**
- Never implemented WAF before - risk of misconfiguration
- API Gateway rate limits already provide baseline protection
- Want to verify production works first without additional complexity

**When to Implement:**
- After 1-2 weeks of stable production operation
- If we see suspicious traffic patterns
- Before major marketing push / increased traffic

**Implementation Plan:**
1. Test WAF configuration in staging first
2. Deploy to one API Gateway (Guest API - public-facing)
3. Monitor for false positives for 24-48 hours
4. Roll out to remaining APIs

**Configuration (when ready):**
- Deploy AWS WAF Web ACL on all API Gateways (Host, Admin, Public, Guest)
- Enable AWS Managed Rules:
  - Core Rule Set (OWASP Top 10)
  - Known Bad Inputs
  - Rate-based rule (2000 requests per 5 minutes per IP)
- Estimated cost: ~$10/month + $1 per million requests

### 2. SNS Notifications for Alarms

**Status:** ⏸️ DEFERRED - Manual monitoring initially

**When to Implement:**
- If manual monitoring becomes burdensome
- When on-call rotation is established
