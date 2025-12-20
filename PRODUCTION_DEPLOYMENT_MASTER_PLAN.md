# 🚀 Production Deployment Master Plan

## 📋 Executive Summary

This document provides a comprehensive, step-by-step plan for deploying the LocalStays backend to **production**. It incorporates all lessons learned from staging deployment and addresses gaps identified in the security review.

**Estimated Total Time:** 90-120 minutes
- Automated steps: ~30 minutes
- Manual interventions: ~45 minutes
- Verification & testing: ~30 minutes

**Region:** eu-north-1 (same as staging)
**Account:** 041608526793 (same as staging)
**Stacks:** 16

---

## 🚨 Configuration Decisions (RESOLVED)

### AWS Account & Region
- ✅ **Same account as staging:** 041608526793
- ✅ **Same region as staging:** eu-north-1
- ✅ **cdk.json updated** with correct account ID

### Stripe Configuration (TEMPORARY)
- ✅ Using **staging TEST key** (`sk_test_`) temporarily
- ✅ Using **staging EventBridge event source** temporarily
- ⚠️ **TODO:** Update to LIVE keys when ready for real payments:
  - Run: `./scripts/setup-stripe-ssm.sh prod sk_live_xxxxx`
  - Update `infra/bin/infra.ts` with production event source

### Domain & CloudFront
- [ ] Custom domain for CloudFront CDN? (e.g., `cdn.localstays.me`)
- [ ] SSL certificate in ACM?

---

## 📦 SSM Parameters Required for Production

All parameters must be created **BEFORE** deployment.

### Quick Setup (Recommended)

Use the unified setup script:

```bash
./scripts/setup-prod-ssm.sh
```

This script will:
1. Prompt for your Stripe LIVE key
2. Copy SendGrid key from staging
3. Set all VAPID keys for push notifications
4. Set all business configuration parameters

### Parameter Reference

#### Secrets (SecureString)

| Parameter | Value | Region | Notes |
|-----------|-------|--------|-------|
| `/localstays/prod/sendgrid` | `SG.xxxxx` | eu-north-1 | SendGrid API key (copied from staging) |
| `/localstays/prod/stripe/secret-key` | `sk_test_xxxxx` | eu-north-1 | **TEMPORARY:** Test key (copied from staging) |
| `/localstays/prod/vapid/privateKey` | (auto-generated) | eu-north-1 | VAPID private key for push notifications |

#### Configuration (String)

| Parameter | Value | Region | Notes |
|-----------|-------|--------|-------|
| `/localstays/prod/config/subscriptions-enabled` | `false` | eu-north-1 | Subscriptions NOT purchasable initially |
| `/localstays/prod/config/trial-days` | `60` | eu-north-1 | 60-day trial period |
| `/localstays/prod/config/commission-rate` | `0.066` | eu-north-1 | 6.6% commission rate |
| `/localstays/prod/config/auto-publish-on-approval` | `false` | eu-north-1 | Don't auto-publish on admin approval |
| `/localstays/prod/config/review-compensation-enabled` | `true` | eu-north-1 | Enable review compensation days |

#### VAPID Keys (for Push Notifications)

| Parameter | Value | Region | Notes |
|-----------|-------|--------|-------|
| `/localstays/prod/vapid/publicKey` | (auto-generated) | eu-north-1 | Frontend uses this for push subscription |
| `/localstays/prod/vapid/privateKey` | (auto-generated) | eu-north-1 | SecureString - signs push messages |
| `/localstays/prod/vapid/subject` | `mailto:support@localstays.me` | eu-north-1 | Contact email for push services |

### VAPID Keys (For Push Notifications - if applicable)

| Parameter | Value | Notes |
|-----------|-------|-------|
| `/localstays/prod/vapid/public-key` | VAPID public key | For web push |
| `/localstays/prod/vapid/private-key` | VAPID private key | For web push |
| `/localstays/prod/vapid/subject` | `mailto:support@localstays.me` | Contact email |

---

## 🏗️ Stack Deployment Order (16 Stacks)

### Phase 1: Foundation (Independent Stacks) - ~5 minutes

| # | Stack | Creates | Manual Steps After |
|---|-------|---------|-------------------|
| 1 | ParamsStack | SSM parameter placeholders | None |
| 2 | DataStack | DynamoDB tables (8 tables) | None |
| 3 | EmailTemplateStack | Email templates table | None |
| 4 | RateLimitStack | Rate limit table | None |
| 5 | StorageStack | S3 bucket | None |
| 6 | KmsStack | KMS keys | None |

### Phase 2: Authentication - ~5 minutes

| # | Stack | Creates | Manual Steps After |
|---|-------|---------|-------------------|
| 7 | CognitoStack | User Pool with custom attributes | Upgrade to Plus tier, Enable Advanced Security |
| 8 | AuthTriggerStack | 4 Lambda triggers | Attach triggers to Cognito |

### Phase 3: CDN - ~5 minutes

| # | Stack | Creates | Manual Steps After |
|---|-------|---------|-------------------|
| 9 | CloudFrontStack | CloudFront distribution | Apply S3 bucket policy |

### Phase 4: Shared Services - ~5 minutes

| # | Stack | Creates | Manual Steps After |
|---|-------|---------|-------------------|
| 10 | SharedServicesStack | Image processor, queues, alarms | Build & push Docker image |

### Phase 5: API Layer - ~10 minutes

| # | Stack | Creates | Manual Steps After |
|---|-------|---------|-------------------|
| 11 | HostApiStack | Host API Gateway + Lambdas | None |
| 12 | AdminApiStack | Admin API Gateway + Lambdas | None |
| 13 | PublicApiStack | Public API (geocoding) | None |
| 14 | GuestApiStack | Guest API (search) | None |
| 15 | StripeEventBridgeStack | Stripe event handler | Configure Stripe webhook |
| 16 | ScheduledJobsStack | Cron jobs | None |

---

## 📝 Complete Deployment Procedure

### Pre-Requisites Checklist

```bash
# 1. Verify AWS CLI is configured for production account
aws sts get-caller-identity
# Expected: Account should be production account ID

# 2. Verify Node.js version
node --version  # Should be 20.x or higher

# 3. Verify CDK is installed
npx cdk --version  # Should be 2.110.0 or higher

# 4. Verify Docker is running
docker --version
docker ps  # Should not error

# 5. Navigate to project
cd /Users/markobabic/LocalDev/localstays-backend
```

---

### Step 0: Verify cdk.json Configuration

**Already configured:**

```json
"prod": {
  "account": "041608526793",  // ✅ Same as staging
  "region": "eu-north-1",      // ✅ Same as staging
  "stage": "prod",
  "frontendUrl": "https://portal.localstays.me",
  "geocodeHourlyLimit": 50,
  "geocodeLifetimeLimit": 500
}
```

---

### Step 1: Create SSM Parameters (5 minutes)

```bash
# Navigate to project root
cd /Users/markobabic/LocalDev/localstays-backend

# Run the unified SSM setup script
# This will prompt for Stripe LIVE key and set all parameters
./scripts/setup-prod-ssm.sh
./scripts/setup-review-compensation-ssm.sh prod true

# Verify all parameters exist
aws ssm describe-parameters \
  --filters "Key=Name,Values=/localstays/prod" \
  --region eu-north-1 \
  --query 'Parameters[*].Name'
```

---

### Step 2: Bootstrap CDK (Skip if Same Account/Region as Staging)

Since we're using the same account and region as staging, CDK is already bootstrapped.

```bash
# Only run if not already bootstrapped:
# npx cdk bootstrap aws://041608526793/eu-north-1
```

---

### Step 3: Build Project

```bash
# Clean previous builds
rm -rf dist/
rm -rf backend/dist/
rm -rf cdk.out/

# Install dependencies
npm install

# Build project
npm run build

# Synthesize CDK stacks
npx cdk synth --all -c env=prod
```

---

### Step 4: Deploy Phase 1 - Foundation Stacks (5 minutes)

```bash
npx cdk deploy \
  LocalstaysProdParamsStack \
  LocalstaysProdDataStack \
  LocalstaysProdEmailTemplateStack \
  LocalstaysProdRateLimitStack \
  LocalstaysProdStorageStack \
  LocalstaysProdKmsStack \
  -c env=prod \
  --require-approval never \
  --region eu-north-1
```

**📝 SAVE THESE OUTPUTS:**
- `TableName`: `localstays-prod`
- `BucketName`: `localstays-prod-host-assets-<hash>`
- `KmsKeyArn`: `arn:aws:kms:eu-north-1:...`

---

### Step 5: Deploy Phase 2 - Authentication Stacks (5 minutes)

```bash
npx cdk deploy \
  LocalstaysProdCognitoStack \
  LocalstaysProdAuthTriggerStack \
  -c env=prod \
  --require-approval never \
  --region eu-north-1
```

**📝 SAVE THESE OUTPUTS (CRITICAL):**
- `UserPoolId`: `eu-north-1_XXXXXXX`
- `UserPoolClientId`: `xxxxxxxxxxxxxxxxxxxxxxxxxx`

---

### Step 6: 🔴 MANUAL - Attach Cognito Triggers

```bash
USER_POOL_ID="<from-step-5>"
KMS_KEY_ARN="<from-step-4>"

aws cognito-idp update-user-pool \
  --user-pool-id ${USER_POOL_ID} \
  --lambda-config '{
    "PreSignUp": "arn:aws:lambda:eu-north-1:041608526793:function:localstays-prod-pre-signup",
    "PostConfirmation": "arn:aws:lambda:eu-north-1:041608526793:function:localstays-prod-post-confirmation",
    "PreTokenGeneration": "arn:aws:lambda:eu-north-1:041608526793:function:localstays-prod-pre-token-generation",
    "CustomEmailSender": {
      "LambdaVersion": "V1_0",
      "LambdaArn": "arn:aws:lambda:eu-north-1:041608526793:function:localstays-prod-custom-email-sender"
    },
    "KMSKeyID": "'"${KMS_KEY_ARN}"'"
  }' \
  --auto-verified-attributes email \
  --region eu-north-1

# Verify
aws cognito-idp describe-user-pool \
  --user-pool-id ${USER_POOL_ID} \
  --region eu-north-1 \
  --query 'UserPool.LambdaConfig'
```

---

### Step 7: 🔴 MANUAL - Upgrade Cognito to Plus Tier (AWS Console)

**Why Required?** CustomEmailSender trigger ONLY works with Advanced Security Mode ENFORCED, which requires Plus tier.

1. Open AWS Console → Cognito → User Pools
2. Select `localstays-prod-users`
3. Click "Upgrade to Plus"
4. Confirm billing (~$0.05 per MAU)
5. Wait for upgrade to complete (~2 minutes)

---

### Step 8: 🔴 MANUAL - Enable Advanced Security ENFORCED

```bash
aws cognito-idp update-user-pool \
  --user-pool-id ${USER_POOL_ID} \
  --user-pool-add-ons AdvancedSecurityMode=ENFORCED \
  --region eu-north-1

# Verify
aws cognito-idp describe-user-pool \
  --user-pool-id ${USER_POOL_ID} \
  --region eu-north-1 \
  --query 'UserPool.UserPoolAddOns'
# Expected: {"AdvancedSecurityMode": "ENFORCED"}
```

---

### Step 9: Deploy Phase 3 - CloudFront CDN (5 minutes)

```bash
npx cdk deploy \
  LocalstaysProdCloudFrontStack \
  -c env=prod \
  --require-approval never \
  --region eu-north-1
```

**📝 SAVE THESE OUTPUTS:**
- `DistributionDomainName`: `dxxxxxxxxxx.cloudfront.net`
- `DistributionId`: `EXXXXXXXXXX`

---

### Step 10: 🔴 MANUAL - Apply S3 Bucket Policy for CloudFront

```bash
# Get values from stack outputs
BUCKET_NAME="<from-step-4>"
DISTRIBUTION_ID="<from-step-9>"
ACCOUNT_ID="<your-prod-account-id>"

# Create policy file
cat > /tmp/cf-bucket-policy.json << EOF
{
  "Version": "2012-10-17",
  "Statement": [{
    "Sid": "AllowCloudFrontServicePrincipal",
    "Effect": "Allow",
    "Principal": {"Service": "cloudfront.amazonaws.com"},
    "Action": "s3:GetObject",
    "Resource": "arn:aws:s3:::${BUCKET_NAME}/*",
    "Condition": {
      "StringEquals": {
        "AWS:SourceArn": "arn:aws:cloudfront::${ACCOUNT_ID}:distribution/${DISTRIBUTION_ID}"
      }
    }
  }]
}
EOF

# Apply policy
aws s3api put-bucket-policy \
  --bucket ${BUCKET_NAME} \
  --policy file:///tmp/cf-bucket-policy.json \
  --region eu-north-1
```

---

### Step 11: 🔴 MANUAL - Build & Push Docker Image (15 minutes)

**⚠️ CRITICAL FLAGS - Read DOCKER_IMAGE_DEPLOYMENT_LESSONS_LEARNED.md**

```bash
cd backend/services/image-processor

# Build with correct flags
docker build \
  --platform linux/arm64 \
  --provenance=false \
  --sbom=false \
  -t prod-localstays-image-processor:latest \
  .

# Tag for ECR
docker tag prod-localstays-image-processor:latest \
  041608526793.dkr.ecr.eu-north-1.amazonaws.com/prod-localstays-image-processor:latest

# Authenticate to ECR
aws ecr get-login-password --region eu-north-1 | \
  docker login --username AWS --password-stdin \
  041608526793.dkr.ecr.eu-north-1.amazonaws.com

# Push
docker push 041608526793.dkr.ecr.eu-north-1.amazonaws.com/prod-localstays-image-processor:latest

cd ../../..
```

---

### Step 12: Deploy Phase 4 - Shared Services (5 minutes)

```bash
npx cdk deploy \
  LocalstaysProdSharedServicesStack \
  -c env=prod \
  --require-approval never \
  --region eu-north-1
```

---

### Step 13: Deploy Phase 5 - All API Stacks (15 minutes)

```bash
npx cdk deploy \
  LocalstaysProdHostApiStack \
  LocalstaysProdAdminApiStack \
  LocalstaysProdPublicApiStack \
  LocalstaysProdGuestApiStack \
  LocalstaysProdStripeEventBridgeStack \
  LocalstaysProdScheduledJobsStack \
  -c env=prod \
  --require-approval never \
  --region eu-north-1
```

**📝 SAVE THESE OUTPUTS (For Frontend):**
- `HostApiEndpoint`: `https://xxxxx.execute-api.eu-north-1.amazonaws.com/prod/`
- `AdminApiEndpoint`: `https://yyyyy.execute-api.eu-north-1.amazonaws.com/prod/`
- `PublicApiEndpoint`: `https://zzzzz.execute-api.eu-north-1.amazonaws.com/prod/`
- `GuestApiEndpoint`: `https://aaaaa.execute-api.eu-north-1.amazonaws.com/prod/`

---

### Step 14: 🔴 MANUAL - Enable GuardDuty Malware Protection (AWS Console)

1. Open AWS Console → GuardDuty (eu-north-1)
2. Click "Malware Protection" in left menu
3. Click "Enable Malware Protection for S3"
4. Select bucket: `localstays-prod-host-assets-*`
5. Set up object prefix filters (optional):
   - `*/listings/*/images/` - Listing images
   - `*/profile/` - Profile photos
   - `*/verification/` - Verification documents
6. Click "Enable"

---

### Step 15: Seed Database (5 minutes)

```bash
cd /Users/markobabic/LocalDev/localstays-backend

# Seed all configuration data
AWS_REGION=eu-north-1 \
TABLE_NAME=localstays-prod \
npx ts-node backend/services/seed/seed-all.ts

# Seed email templates
AWS_REGION=eu-north-1 \
TABLE_NAME=localstays-prod \
npx ts-node backend/services/seed/seed-admin-templates.ts

AWS_REGION=eu-north-1 \
TABLE_NAME=localstays-prod \
npx ts-node backend/services/seed/seed-verification-templates.ts

AWS_REGION=eu-north-1 \
TABLE_NAME=localstays-prod \
npx ts-node backend/services/seed/seed-subscription-email-templates.ts

# Seed push notification templates (via Lambda)
aws lambda invoke \
  --function-name localstays-prod-seed-email-templates \
  --payload '{"RequestType": "Create"}' \
  --region eu-north-1 \
  /tmp/seed-output.json
```

---

### Step 16: Create Admin User (2 minutes)

```bash
AWS_REGION=eu-north-1 \
TABLE_NAME=localstays-prod \
USER_POOL_ID=<YOUR_PROD_USER_POOL_ID> \
npx ts-node backend/services/seed/seed-admin-user.ts

# 📝 SAVE CREDENTIALS:
# Email: marko+admin@velocci.me
# Password: <generated>
```

---

### Step 17: Sync Stripe Subscription Plans (Optional - Do Later)

**NOTE:** Subscription plans are NOT seeded automatically in production.

When you're ready to enable subscriptions, sync plans from Stripe:

```bash
STAGE=prod npx ts-node backend/scripts/sync-stripe-plans.ts --dry-run  # Preview
STAGE=prod npx ts-node backend/scripts/sync-stripe-plans.ts            # Apply
```

This pulls real products/prices from Stripe into DynamoDB.

---

### Step 18: ⚠️ Stripe EventBridge (TEMPORARY CONFIGURATION)

**Current Setup:** Using staging Stripe event source temporarily.

This means:
- ✅ All Stripe events will be processed by prod environment
- ⚠️ Using TEST keys (`sk_test_`) - no real payments
- ⚠️ Same event source as staging

**When ready for LIVE payments, update:**

1. Go to Stripe Dashboard → Developers → Webhooks
2. Create NEW EventBridge destination for production (with LIVE mode)
3. Update SSM: `./scripts/setup-stripe-ssm.sh prod sk_live_xxxxx`
4. Update `infra/bin/infra.ts`:
   ```typescript
   const stripeEventSourceNames: Record<string, string> = {
     staging: 'aws.partner/stripe.com/ed_test_...',
     prod: 'aws.partner/stripe.com/<NEW_PROD_EVENT_DESTINATION_ID>',
   };
   ```
5. Redeploy the StripeEventBridgeStack

---

## ✅ Post-Deployment Verification

### Test 1: User Signup Flow

```bash
# Test signup via AWS CLI
aws cognito-idp sign-up \
  --client-id <USER_POOL_CLIENT_ID> \
  --username test@example.com \
  --password Test123!Test \
  --user-attributes Name=email,Value=test@example.com \
  --region eu-north-1

# Check logs
aws logs tail /aws/lambda/localstays-prod-pre-signup --follow --region eu-north-1
aws logs tail /aws/lambda/localstays-prod-custom-email-sender --follow --region eu-north-1
```

### Test 2: API Health Check

```bash
# Test each API endpoint
curl https://xxxxx.execute-api.eu-north-1.amazonaws.com/prod/api/v1/listings/metadata
# Expected: 401 Unauthorized (correct - no auth)

curl https://zzzzz.execute-api.eu-north-1.amazonaws.com/prod/health
# Expected: 200 OK
```

### Test 3: CloudFront CDN

```bash
# Test CloudFront access (after uploading a test image)
curl -I "https://dxxxxxxxxxx.cloudfront.net/test-path/test.webp"
# Expected: 200 or 403 (depending on if file exists)
```

### Test 4: Admin Login

```bash
# Login as admin user created in Step 16
# Verify JWT has admin claims and all 15 permissions
```

### Test 5: Stripe Integration

```bash
# Create a test subscription via frontend
# Verify checkout.session.completed event received in CloudWatch logs
aws logs tail /aws/lambda/localstays-prod-stripe-event-handler --follow --region eu-north-1
```

---

## 🔒 Production Security Checklist

### Rate Limiting

| Endpoint Type | Rate Limit (prod) | Status |
|--------------|-------------------|--------|
| Host API | 1,000 req/s | ✅ Configured |
| Admin API | 500 req/s | ✅ Configured |
| Guest API | 1,000 req/s | ✅ Configured |
| Public API | 2,000 req/s | ✅ Configured |

### ⚠️ Critical: Add Write Operation Rate Limiting

Per `PRODUCTION_SECURITY_REVIEW_RATE_LIMITING.md`, add rate limiting to:
- [ ] `submit-intent` endpoints (10/hour)
- [ ] `confirm-submission` endpoints (10/hour)
- [ ] `image-upload` endpoints (50/hour)
- [ ] Admin actions (30/minute)

### Lambda Concurrency Limits

See `LAMBDA_CONCURRENCY_LIMITS_PLAN.md` for full allocation table.

**Summary (Production):**

| Category | Total Reserved | Key Functions |
|----------|---------------|---------------|
| Guest API (search) | 250 | search-listings: 200, search-locations: 50 |
| Host API | 325 | host-listings: 100, profile/availability/requests: 50 each |
| Admin API | 24 | 2-5 per function (low traffic) |
| Shared Services | 80 | image-processor: 50, verification: 30 |
| Auth Triggers | 100 | pre-token: 50, email/signup: 20 each |
| Scheduled Jobs | 2 | slot-expiry-processor: 2 |
| **TOTAL** | **831** | **107 unreserved** |

---

## 📊 Monitoring & Alarms

### Current Coverage (9 alarms per environment)
- ✅ Image processing queue backlog (10min, 30min thresholds)
- ✅ Image DLQ messages (≥1)
- ✅ Image processor errors/throttles
- ✅ Verification queue backlog
- ✅ Verification DLQ messages
- ✅ Verification processor errors/throttles

### Production Alarm Strategy (Per PROD_HARDENING.md)

**Simplified approach for launch - ~30 alarms total:**

#### API Gateway Alarms (per API × 4 APIs = 12 alarms)
- 5XX error rate > 1%
- 4XX error rate > 10%  
- Latency p99 > 5 seconds

#### Lambda Alarms (critical functions only ~5 = 15 alarms)
- Error rate > 1%
- Throttles > 0
- Duration approaching timeout

#### DynamoDB Alarms (2 alarms)
- Read/Write throttles > 0
- System errors > 0

#### Account-Level Alarms (1 alarm)
- Lambda concurrent executions > 80% of quota

### Monitoring Strategy

**Initial approach:** Manual monitoring via CloudWatch console
- Alarms will trigger and be visible in CloudWatch dashboard
- No SNS notifications initially - will add later if needed
- Check CloudWatch Alarms dashboard daily during launch period

---

## 💰 Cost Estimate (Production)

| Service | Monthly Cost |
|---------|-------------|
| DynamoDB (on-demand) | ~$20-50 |
| Lambda | ~$10-30 |
| S3 Storage | ~$5-10 |
| CloudFront | ~$10-30 |
| API Gateway | ~$5-10 |
| Cognito Plus | ~$10-20 |
| KMS | ~$2 |
| CloudWatch | ~$5-10 |
| SendGrid | ~$15-30 |
| **Total** | **~$80-200/month** |

---

## 🚨 Rollback Procedures

### Rollback Single Stack
```bash
# Check previous version
aws cloudformation list-stack-set-operation-results ...

# Rollback to previous
npx cdk deploy <StackName> -c env=prod --rollback
```

### Emergency: Disable APIs
```bash
# Disable API Gateway stage
aws apigateway update-stage \
  --rest-api-id xxxxx \
  --stage-name prod \
  --patch-operations op=replace,path=/throttling/rateLimit,value=0 \
  --region eu-north-1
```

### Database: Point-in-Time Recovery
```bash
# Restore DynamoDB to specific time
aws dynamodb restore-table-to-point-in-time \
  --source-table-name localstays-prod \
  --target-table-name localstays-prod-restored \
  --restore-date-time "2025-12-19T12:00:00Z" \
  --region eu-north-1
```

---

## 📋 Final Deployment Checklist

### Pre-Deployment
- [x] cdk.json updated with production account ID (041608526793)
- [ ] All SSM parameters created (run `./scripts/setup-prod-ssm.sh`)
- [ ] Stripe live key ready
- [ ] Docker running
- [ ] AWS CLI configured for prod account

### Phase 1: Foundation
- [ ] ParamsStack deployed
- [ ] DataStack deployed
- [ ] EmailTemplateStack deployed
- [ ] RateLimitStack deployed
- [ ] StorageStack deployed
- [ ] KmsStack deployed

### Phase 2: Authentication
- [ ] CognitoStack deployed
- [ ] AuthTriggerStack deployed
- [ ] Cognito triggers attached (manual)
- [ ] Cognito upgraded to Plus tier (manual)
- [ ] Advanced Security ENFORCED (manual)

### Phase 3: CDN
- [ ] CloudFrontStack deployed
- [ ] S3 bucket policy applied (manual)

### Phase 4: Processing
- [ ] Docker image built & pushed (manual)
- [ ] SharedServicesStack deployed

### Phase 5: APIs
- [ ] HostApiStack deployed
- [ ] AdminApiStack deployed
- [ ] PublicApiStack deployed
- [ ] GuestApiStack deployed
- [ ] StripeEventBridgeStack deployed
- [ ] ScheduledJobsStack deployed

### Post-Deployment
- [ ] GuardDuty enabled (manual)
- [ ] Database seeded
- [ ] Email templates seeded
- [ ] Push notification templates seeded
- [ ] Admin user created
- [ ] Stripe EventBridge configured
- [ ] All verification tests passed
- [ ] Frontend updated with prod endpoints

---

## 🚀 Post-Launch Hardening (After Production is Stable)

These items are **intentionally deferred** until production is verified working.

### Week 1-2: Stability Monitoring

- [ ] Monitor CloudWatch Alarms dashboard daily
- [ ] Check for any 5XX errors or throttling
- [ ] Verify all user flows work correctly
- [ ] Monitor costs in AWS Cost Explorer

### Week 2-3: WAF Implementation

**Why Deferred:** Never implemented WAF before - risk of misconfiguration blocking legitimate traffic.

**Implementation Process:**
1. [ ] Test WAF configuration in **staging** first
2. [ ] Deploy to Guest API (public-facing) only
3. [ ] Monitor for 24-48 hours for false positives
4. [ ] If stable, roll out to remaining APIs

**WAF Configuration (when ready):**
```bash
# See PROD_HARDENING.md for full WAF implementation details
# - AWS Managed Rules: Core Rule Set (OWASP Top 10)
# - AWS Managed Rules: Known Bad Inputs
# - Rate-based rule: 2000 requests per 5 minutes per IP
# - Estimated cost: ~$10/month + $1 per million requests
```

### When Needed: SNS Alarm Notifications

- [ ] Add SNS topic for critical alarms only
- [ ] Subscribe ops email
- Trigger: If manual monitoring becomes burdensome

### Future: Additional Rate Limiting

Per `PRODUCTION_SECURITY_REVIEW_RATE_LIMITING.md`:
- [ ] Per-user rate limiting on write operations (if abuse detected)
- [ ] Consider only if we see suspicious patterns

---

## 📚 Related Documentation

- `STAGING_DEPLOYMENT_MASTER_PLAN.md` - Staging deployment reference
- `DOCKER_IMAGE_DEPLOYMENT_LESSONS_LEARNED.md` - Docker troubleshooting
- `CLOUDFRONT_DEPLOYMENT_LESSONS_LEARNED.md` - CloudFront setup
- `PROD_HARDENING.md` - Post-launch hardening (WAF, SNS, etc.)
- `LAMBDA_CONCURRENCY_LIMITS_PLAN.md` - Lambda concurrency allocations
- `ENVIRONMENT_VARIABLES_GUIDE.md` - Config reference
- `STRIPE_BACKEND_API_SPEC.md` - Stripe integration

---

**Last Updated:** December 19, 2025
**Author:** AI Assistant
**Status:** Ready for production deployment (WAF deferred to post-launch)

