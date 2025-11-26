# Production Hardening - Remaining Work

## Blocked (Waiting for AWS)

- **Lambda Concurrency Limits**: Requested increase from 10 to 1000+ (ticket submitted)

## Critical for Launch

### 1. WAF on API Gateway

- Deploy AWS WAF Web ACL on all API Gateways (Host, Admin, Public, Guest)
- Enable AWS Managed Rules:
  - Core Rule Set (OWASP Top 10)
  - Known Bad Inputs
  - Rate-based rule (2000 requests per 5 minutes per IP)
- Estimated cost: ~$10/month + $1 per million requests

### 2. CloudWatch Alarms

#### API Gateway Alarms (per API)

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

## SNS Topic

- Create `prod-alerts` SNS topic
- Subscribe: marko@localstays.me
