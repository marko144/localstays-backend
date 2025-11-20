# 🚀 Staging Environment Deployment - Master Plan

## 📋 Executive Summary

This document provides a comprehensive, step-by-step plan for deploying a complete **staging** environment for the Localstays backend infrastructure, including all manual interventions, dependencies, and best practices.

**📚 Related Documentation:**

- **`DOCKER_IMAGE_DEPLOYMENT_LESSONS_LEARNED.md`** - Critical troubleshooting for Docker/ECR issues
- **`STAGING_DEPLOYMENT_CODE_STRATEGY.md`** - Single codebase strategy explained
- **`ENVIRONMENT_VARIABLES_GUIDE.md`** - SSM parameters and Lambda env vars

---

## 🎯 Deployment Strategy: Full vs. Incremental

### ✅ **RECOMMENDED: Full Clean Deployment (What We'll Do)**

**Why This Approach?**

- ✅ **Complete isolation** from dev1 environment
- ✅ **Clean slate** - no legacy issues or configuration drift
- ✅ **Production-like** - mirrors what you'll do for prod
- ✅ **Testing ground** for deployment procedures
- ✅ **Rollback safety** - dev1 remains untouched
- ✅ **AWS best practice** for multi-environment architectures

**What Gets Created:**

- New Cognito User Pool (`localstays-staging-users`)
- New DynamoDB table (`localstays-staging`)
- New S3 bucket (`localstays-staging-host-assets-<account>`)
- New API Gateway (`localstays-staging-api`)
- New Lambda functions (all with `staging-` prefix)
- New KMS keys
- New SSM parameters
- New ECR repository for image processor
- Separate CloudWatch log groups

**Cost Impact:** ~$5-10/month for staging (similar to dev1)

---

### ❌ **NOT RECOMMENDED: Incremental/Shared Resources**

**Why Not?**

- ❌ Risk of breaking dev1 during staging changes
- ❌ Difficult to test deployment procedures
- ❌ Shared state can cause race conditions
- ❌ Can't test disaster recovery
- ❌ Harder to track costs per environment
- ❌ Not production-ready practice

---

## 🏗️ Architecture Overview

### Current State

```
┌─────────────────────────────────────────────────────────┐
│ AWS Account: 041608526793                               │
│ Region: eu-north-1                                      │
│                                                          │
│  ┌──────────────────────────────────────────────────┐  │
│  │ DEV1 Environment (Fully Deployed)                │  │
│  │ - Cognito: eu-north-1_XXXXXXX                    │  │
│  │ - DynamoDB: localstays-dev1                      │  │
│  │ - S3: localstays-dev1-host-assets-*              │  │
│  │ - API: https://xxx.execute-api.eu-north-1...     │  │
│  │ - Lambdas: localstays-dev1-*                     │  │
│  └──────────────────────────────────────────────────┘  │
│                                                          │
│  ┌──────────────────────────────────────────────────┐  │
│  │ STAGING Environment (To Be Created)              │  │
│  │ - Cognito: TBD                                   │  │
│  │ - DynamoDB: localstays-staging                   │  │
│  │ - S3: localstays-staging-host-assets-*           │  │
│  │ - Host API: TBD                                  │  │
│  │ - Admin API: TBD                                 │  │
│  │ - Public API: TBD                                │  │
│  │ - Lambdas: localstays-staging-*                  │  │
│  └──────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

### Target State After Deployment

```
staging/
├── Cognito User Pool (localstays-staging-users)
├── DynamoDB Tables (localstays-staging, email-templates, rate-limits)
├── S3 Bucket (localstays-staging-host-assets-*)
├── Host API Gateway (localstays-staging-host-api)
├── Admin API Gateway (localstays-staging-admin-api)
├── Public API Gateway (localstays-staging-public-api)
├── 14 Lambda Functions (all staging-prefixed)
├── ECR Repository (staging-localstays-image-processor)
├── SQS Queues (staging-image-processing-queue, etc.)
├── EventBridge Rules (staging-guardduty-scan-complete)
├── CloudWatch Alarms (staging-*)
├── KMS Keys (localstays/staging/cognito-custom-sender)
└── SSM Parameters (/localstays/staging/*)
```

---

## 📦 Stack Deployment Order & Dependencies

### Phase 1: Foundation (Independent Stacks) - ~5 minutes

```
1. ParamsStack          → SSM Parameters
2. DataStack           → DynamoDB tables
3. EmailTemplateStack  → Email templates table
4. StorageStack        → S3 buckets
5. KmsStack            → KMS encryption keys
```

**Dependencies:** None (can deploy in parallel, but CDK handles sequencing)

---

### Phase 2: Authentication (Dependent on Phase 1) - ~3 minutes

```
6. CognitoStack        → User Pool (depends on KmsStack)
7. AuthTriggerStack    → Lambda triggers (depends on all Phase 1 + CognitoStack)
```

**Dependencies:**

- CognitoStack requires KmsStack (for CustomEmailSender encryption)
- AuthTriggerStack requires ALL Phase 1 stacks + CognitoStack

---

### Phase 3: CDN (Dependent on Phase 2) - ~3 minutes

```
9. CloudFrontStack     → CDN for images
```

**Dependencies:**

- Requires StorageStack (for S3 origin)

---

### Phase 4: Shared Services (Dependent on Phase 1-3) - ~3 minutes

```
10. SharedServicesStack → Image/verification processing infrastructure
```

**Dependencies:**

- Requires DataStack (for DynamoDB access)
- Requires StorageStack (for S3 access)

---

### Phase 5: API Layer (Dependent on Phase 4) - ~15 minutes total

```
11. HostApiStack       → Host-facing API Gateway + Lambda handlers (~5 min)
12. AdminApiStack      → Admin dashboard API Gateway + Lambda handlers (~5 min)
13. PublicApiStack     → Public-facing API Gateway + Lambda handlers (~2 min)
```

**Dependencies:**

- **HostApiStack** requires: CognitoStack, DataStack, EmailTemplateStack, StorageStack, ParamsStack, CloudFrontStack, SharedServicesStack
- **AdminApiStack** requires: CognitoStack, DataStack, EmailTemplateStack, StorageStack, ParamsStack, SharedServicesStack
- **PublicApiStack** requires: CognitoStack, DataStack, RateLimitStack

---

## 🔧 Manual Interventions Required

### ⚠️ **CRITICAL: These Cannot Be Automated**

| #   | Step                                    | When                     | Why Manual?                                 | Time   |
| --- | --------------------------------------- | ------------------------ | ------------------------------------------- | ------ |
| 1   | **Copy SendGrid API Key**               | After ParamsStack        | Security - requires AWS CLI with decryption | 1 min  |
| 2   | **Attach Cognito Triggers**             | After AuthTriggerStack   | Cognito limitation - must use CLI           | 2 min  |
| 3   | **Upgrade Cognito to Plus Tier**        | After CognitoStack       | AWS Console only - billing change           | 5 min  |
| 4   | **Enable Advanced Security ENFORCED**   | After Cognito upgrade    | Required for CustomEmailSender              | 1 min  |
| 5   | **Build & Push Docker Image**           | Before ApiStack deploy   | ECR image must exist first                  | 15 min |
| 6   | **Seed Database with Roles**            | After all stacks         | Requires stack outputs                      | 2 min  |
| 7   | **Create Admin User**                   | After seeding            | Requires Cognito + DynamoDB                 | 2 min  |
| 8   | **Enable GuardDuty Malware Protection** | After S3 bucket creation | AWS Console - security feature              | 5 min  |

**Total Manual Time: ~33 minutes**

---

## 📝 Complete Deployment Procedure

### Prerequisites Checklist

```bash
# Verify AWS CLI is configured
aws sts get-caller-identity

# Expected output:
# {
#   "UserId": "...",
#   "Account": "041608526793",
#   "Arn": "arn:aws:iam::041608526793:user/..."
# }

# Verify Node.js version
node --version  # Should be 20.x or higher

# Verify CDK is installed
npx cdk --version  # Should be 2.110.0 or higher

# Verify Docker is running (for image processor)
docker --version
docker ps  # Should not error

# Verify you're in the project root
pwd  # Should end with /localstays-backend
```

---

### Step 1: Build Project (2 minutes)

```bash
cd /Users/markobabic/LocalDev/localstays-backend

# Clean previous builds
rm -rf dist/
rm -rf backend/dist/
rm -rf cdk.out/

# Install dependencies (if needed)
npm install

# Build infrastructure and backend
npm run build
```

**Expected Output:**

```
✓ Compiled successfully
✓ No TypeScript errors
```

**Troubleshooting:**

- If build fails, check `tsconfig.json` is present
- Ensure all `.ts` files have no syntax errors
- Run `npm install` if dependencies are missing
- **See `BUILD_QUALITY_FIXES.md`** for details on build quality enforcement

---

### Step 2: Synthesize CDK Stacks (1 minute)

```bash
# Generate CloudFormation templates for staging
npx cdk synth --all -c env=staging
```

**What This Does:**

- Validates all stack definitions
- Generates CloudFormation templates in `cdk.out/`
- Checks for circular dependencies
- Validates IAM permissions

**Expected Output:**

```
Successfully synthesized to /Users/markobabic/LocalDev/localstays-backend/cdk.out
Supply a stack id (LocalstaysStagingParamsStack, LocalstaysStagingDataStack, ...) to display its template.
```

**If This Fails:**

- Check `cdk.json` has `environments.staging` configured
- Verify all stack files in `infra/lib/` compile
- Check for missing dependencies in `package.json`

---

### Step 3: Deploy Phase 1 - Foundation Stacks (5 minutes)

```bash
# Deploy all Phase 1 stacks
npx cdk deploy \
  LocalstaysStagingParamsStack \
  LocalstaysStagingDataStack \
  LocalstaysStagingEmailTemplateStack \
  LocalstaysStagingStorageStack \
  LocalstaysStagingKmsStack \
  -c env=staging \
  --require-approval never \
  --region eu-north-1
```

**What Gets Created:**

1. **ParamsStack**: SSM parameter placeholders
2. **DataStack**: DynamoDB table `localstays-staging` with GSIs
3. **EmailTemplateStack**: DynamoDB table for email templates
4. **StorageStack**: S3 bucket `localstays-staging-host-assets-<hash>`
5. **KmsStack**: KMS key for Cognito CustomEmailSender

**Expected Outputs (SAVE THESE):**

```
LocalstaysStagingDataStack.TableName = localstays-staging
LocalstaysStagingDataStack.TableArn = arn:aws:dynamodb:eu-north-1:041608526793:table/localstays-staging

LocalstaysStagingStorageStack.BucketName = localstays-staging-host-assets-<hash>
LocalstaysStagingStorageStack.BucketArn = arn:aws:s3:::localstays-staging-host-assets-<hash>

LocalstaysStagingKmsStack.CognitoCustomSenderKeyArn = arn:aws:kms:eu-north-1:041608526793:key/<key-id>

LocalstaysStagingEmailTemplateStack.EmailTemplatesTableName = localstays-staging-email-templates
```

**Verification:**

```bash
# Verify DynamoDB table
aws dynamodb describe-table \
  --table-name localstays-staging \
  --region eu-north-1 \
  --query 'Table.[TableName,TableStatus,ItemCount]'

# Verify S3 bucket
aws s3 ls | grep localstays-staging

# Verify KMS key
aws kms list-aliases --region eu-north-1 | grep staging
```

---

### Step 4: 🔴 MANUAL - Copy SendGrid API Key (1 minute)

```bash
# Copy SendGrid API key from dev1 to staging
./scripts/copy-sendgrid-key.sh dev1 staging
```

**What This Does:**

- Reads encrypted API key from `/localstays/dev1/sendgrid`
- Writes to `/localstays/staging/sendgrid` (encrypted)
- Uses AWS SSM SecureString encryption

**Verification:**

```bash
# Verify parameter exists (don't decrypt in logs!)
aws ssm describe-parameters \
  --filters "Key=Name,Values=/localstays/staging/sendgrid" \
  --region eu-north-1

# Test decryption (be careful with output)
aws ssm get-parameter \
  --name /localstays/staging/sendgrid \
  --with-decryption \
  --region eu-north-1 \
  --query 'Parameter.Value' \
  --output text | head -c 10
# Should show: SG.xxxxxxx
```

**If This Fails:**

- Ensure dev1 parameter exists: `aws ssm get-parameter --name /localstays/dev1/sendgrid --region eu-north-1`
- Check IAM permissions for SSM read/write
- Manually create if needed:
  ```bash
  aws ssm put-parameter \
    --name /localstays/staging/sendgrid \
    --value "SG.your-sendgrid-api-key" \
    --type SecureString \
    --region eu-north-1
  ```

---

### Step 5: Deploy Phase 2 - Authentication Stacks (3 minutes)

```bash
# Deploy Cognito and Auth Triggers
npx cdk deploy \
  LocalstaysStagingCognitoStack \
  LocalstaysStagingAuthTriggerStack \
  -c env=staging \
  --require-approval never \
  --region eu-north-1
```

**What Gets Created:**

1. **CognitoStack**: User Pool with custom attributes
2. **AuthTriggerStack**: 4 Lambda functions (pre-signup, post-confirmation, pre-token-generation, custom-email-sender)

**Expected Outputs (SAVE THESE - CRITICAL):**

```
LocalstaysStagingCognitoStack.UserPoolId = eu-north-1_XXXXXXX
LocalstaysStagingCognitoStack.UserPoolClientId = xxxxxxxxxxxxxxxxxxxxxxxxxx
LocalstaysStagingCognitoStack.UserPoolArn = arn:aws:cognito-idp:eu-north-1:041608526793:userpool/eu-north-1_XXXXXXX
LocalstaysStagingCognitoStack.Region = eu-north-1
LocalstaysStagingCognitoStack.HostGroupName = HOST
LocalstaysStagingCognitoStack.AdminGroupName = ADMIN

LocalstaysStagingAuthTriggerStack.PreSignupLambdaArn = arn:aws:lambda:eu-north-1:041608526793:function:localstays-staging-pre-signup
LocalstaysStagingAuthTriggerStack.PostConfirmationLambdaArn = arn:aws:lambda:eu-north-1:041608526793:function:localstays-staging-post-confirmation
LocalstaysStagingAuthTriggerStack.PreTokenGenerationLambdaArn = arn:aws:lambda:eu-north-1:041608526793:function:localstays-staging-pre-token-generation
LocalstaysStagingAuthTriggerStack.CustomEmailSenderLambdaArn = arn:aws:lambda:eu-north-1:041608526793:function:localstays-staging-custom-email-sender
```

**Verification:**

```bash
# Verify User Pool exists
aws cognito-idp describe-user-pool \
  --user-pool-id <USER_POOL_ID_FROM_OUTPUT> \
  --region eu-north-1 \
  --query 'UserPool.[Id,Name,Status]'

# Verify Lambda functions exist
aws lambda list-functions \
  --region eu-north-1 \
  --query 'Functions[?contains(FunctionName, `staging`)].FunctionName'
```

---

### Step 6: 🔴 MANUAL - Attach Cognito Triggers (2 minutes)

**Why Manual?** Cognito requires ALL Lambda triggers + KMS key in a single command. If done via CDK, it can clear existing settings.

```bash
# Get User Pool ID from Step 5 output
USER_POOL_ID="<from-step-5-output>"

# Get KMS Key ARN from Step 3 output
KMS_KEY_ARN="<from-step-3-output>"

# Attach all triggers at once
aws cognito-idp update-user-pool \
  --user-pool-id ${USER_POOL_ID} \
  --lambda-config '{
    "PreSignUp": "arn:aws:lambda:eu-north-1:041608526793:function:localstays-staging-pre-signup",
    "PostConfirmation": "arn:aws:lambda:eu-north-1:041608526793:function:localstays-staging-post-confirmation",
    "PreTokenGeneration": "arn:aws:lambda:eu-north-1:041608526793:function:localstays-staging-pre-token-generation",
    "CustomEmailSender": {
      "LambdaVersion": "V1_0",
      "LambdaArn": "arn:aws:lambda:eu-north-1:041608526793:function:localstays-staging-custom-email-sender"
    },
    "KMSKeyID": "'"${KMS_KEY_ARN}"'"
  }' \
  --auto-verified-attributes email \
  --region eu-north-1
```

**Verification:**

```bash
# Verify triggers are attached
aws cognito-idp describe-user-pool \
  --user-pool-id ${USER_POOL_ID} \
  --region eu-north-1 \
  --query 'UserPool.LambdaConfig'

# Expected output should show all 4 triggers
```

**If This Fails:**

- Check Lambda ARNs are correct (copy from Step 5 outputs)
- Verify KMS key ARN is correct
- Ensure IAM permissions allow `cognito-idp:UpdateUserPool`
- Check Lambda functions have resource-based policies allowing Cognito invocation

---

### Step 7: 🔴 MANUAL - Upgrade Cognito to Plus Tier (5 minutes)

**Why Required?** CustomEmailSender trigger ONLY works with Advanced Security Mode ENFORCED, which requires Plus tier.

**Steps:**

1. Open AWS Console → Cognito → User Pools
2. Select `localstays-staging-users`
3. Click "Upgrade to Plus" (or similar button)
4. Confirm billing change (~$0.05 per MAU)
5. Wait for upgrade to complete (~2 minutes)

**Cost Impact:** ~$5/month for staging (assuming 100 MAUs)

---

### Step 8: 🔴 MANUAL - Enable Advanced Security ENFORCED (1 minute)

```bash
# Enable ENFORCED mode (required for CustomEmailSender)
aws cognito-idp update-user-pool \
  --user-pool-id ${USER_POOL_ID} \
  --user-pool-add-ons AdvancedSecurityMode=ENFORCED \
  --region eu-north-1
```

**Verification:**

```bash
aws cognito-idp describe-user-pool \
  --user-pool-id ${USER_POOL_ID} \
  --region eu-north-1 \
  --query 'UserPool.UserPoolAddOns'

# Expected output:
# {
#   "AdvancedSecurityMode": "ENFORCED"
# }
```

---

### Step 9: 🔴 MANUAL - Build & Push Image Processor Docker Image (15 minutes)

**Why Manual?** Docker build requires local Docker daemon and ECR authentication.

**🚨 CRITICAL - READ BEFORE BUILDING:**

- **MUST use `--platform linux/arm64`** (matches Lambda ARM64/Graviton2)
- **MUST use `--provenance=false --sbom=false`** (Lambda requires single-platform manifest)
- **DON'T use `linux/amd64`** (causes "manifest not supported" error)
- **DON'T cancel CDK deployment** (API stack takes 5-10 minutes for 339 resources)
- **See `DOCKER_IMAGE_DEPLOYMENT_LESSONS_LEARNED.md`** for full troubleshooting

```bash
# Navigate to image processor directory
cd backend/services/image-processor

# Build and push to ECR (uses correct flags automatically)
./deploy.sh staging eu-north-1 041608526793
```

**Alternative: Manual Build (if deploy.sh fails):**

```bash
cd backend/services/image-processor

# 1. Build with correct flags
docker build \
  --platform linux/arm64 \
  --provenance=false \
  --sbom=false \
  -t staging-localstays-image-processor:latest \
  .

# 2. Tag for ECR
docker tag staging-localstays-image-processor:latest \
  041608526793.dkr.ecr.eu-north-1.amazonaws.com/staging-localstays-image-processor:latest

# 3. Authenticate to ECR
aws ecr get-login-password --region eu-north-1 | \
  docker login --username AWS --password-stdin \
  041608526793.dkr.ecr.eu-north-1.amazonaws.com

# 4. Push to ECR
docker push 041608526793.dkr.ecr.eu-north-1.amazonaws.com/staging-localstays-image-processor:latest
```

**What This Does:**

1. Authenticates Docker to ECR
2. Builds ARM64 Docker image (~10 minutes first time)
3. Tags image for ECR
4. Pushes to ECR repository
5. Converts manifest for Lambda compatibility

**Expected Output:**

```
============================================
✅ Deployment Complete!
============================================

Next steps:
1. Update Lambda function:
   aws lambda update-function-code \
     --function-name staging-image-processor \
     --image-uri 041608526793.dkr.ecr.eu-north-1.amazonaws.com/staging-localstays-image-processor:latest \
     --region eu-north-1
```

**⚠️ IMPORTANT:** Don't run the `update-function-code` command yet - Lambda doesn't exist until Step 11 (SharedServicesStack deployment)!

**Verification:**

```bash
# Verify image exists in ECR
aws ecr describe-images \
  --repository-name staging-localstays-image-processor \
  --region eu-north-1 \
  --query 'imageDetails[0].[imageTags,imageSizeInBytes,imagePushedAt]'
```

**If This Fails:**

- Ensure Docker is running: `docker ps`
- Check ECR repository exists (created by ApiStack, deploy ApiStack first if needed)
- Verify AWS credentials have ECR push permissions
- Try building locally first: `docker build --platform linux/arm64 -t test .`

---

### Step 10: Deploy Phase 3 - CloudFront CDN (3 minutes)

```bash
# Deploy CloudFront distribution for images
npx cdk deploy \
  LocalstaysStagingCloudFrontStack \
  -c env=staging \
  --require-approval never \
  --region eu-north-1
```

**What Gets Created:**

1. **CloudFront Distribution**: CDN for serving listing images
2. **OAI (Origin Access Identity)**: Secure S3 access
3. **Cache Policies**: Optimized for images

**Expected Outputs (SAVE THESE):**

```
LocalstaysStagingCloudFrontStack.DistributionDomainName = dxxxxxxxxxx.cloudfront.net
LocalstaysStagingCloudFrontStack.DistributionId = EXXXXXXXXXX
```

---

### Step 11: Deploy Phase 4 - Shared Services Stack (3 minutes)

```bash
# Deploy shared infrastructure (image/verification processing)
npx cdk deploy \
  LocalstaysStagingSharedServicesStack \
  -c env=staging \
  --require-approval never \
  --region eu-north-1
```

**What Gets Created:**

1. **Image Processor Lambda**: Container-based Lambda (uses ECR image from Step 9)
2. **Verification Processor Lambda**: For document scanning
3. **SQS Queues**: Image processing queue + DLQ, verification queue + DLQ
4. **EventBridge Rules**: GuardDuty scan result routing (2 rules)
5. **CloudWatch Alarms**: Monitoring for queues and Lambdas (8 alarms)

**Expected Outputs (SAVE THESE):**

```
LocalstaysStagingSharedServicesStack.ImageProcessingQueueUrl = https://sqs.eu-north-1...
LocalstaysStagingSharedServicesStack.VerificationProcessingQueueUrl = https://sqs.eu-north-1...
LocalstaysStagingSharedServicesStack.ImageProcessorLambdaName = staging-image-processor
LocalstaysStagingSharedServicesStack.VerificationProcessorLambdaName = staging-verification-processor
```

**Verification:**

```bash
# Verify SQS queues exist
aws sqs list-queues --region eu-north-1 | grep staging

# Verify Lambda functions exist
aws lambda list-functions \
  --region eu-north-1 \
  --query 'Functions[?contains(FunctionName, `staging`)].FunctionName'
```

---

### Step 12: Deploy Phase 5a - Host API Stack (5 minutes)

```bash
# Deploy Host API Gateway + Lambda functions
npx cdk deploy \
  LocalstaysStagingHostApiStack \
  -c env=staging \
  --require-approval never \
  --region eu-north-1
```

**What Gets Created:**

1. **Host API Gateway**: REST API for host-facing endpoints
2. **Cognito Authorizer**: For host authentication
3. **7 Lambda Functions**:
   - `localstays-staging-host-profile-handler`
   - `localstays-staging-get-subscription`
   - `localstays-staging-host-listings-handler`
   - `localstays-staging-host-requests-handler`
   - `localstays-staging-subscribe-notification`
   - `localstays-staging-unsubscribe-notification`
   - `localstays-staging-list-subscriptions`
4. **25+ API Routes**: Profile, subscription, listings, requests, notifications

**Expected Outputs (SAVE THESE - CRITICAL FOR FRONTEND):**

```
LocalstaysStagingHostApiStack.HostApiEndpoint = https://xxxxx.execute-api.eu-north-1.amazonaws.com/staging/
LocalstaysStagingHostApiStack.HostApiId = xxxxx
LocalstaysStagingHostApiStack.HostProfileHandlerLambdaName = localstays-staging-host-profile-handler
LocalstaysStagingHostApiStack.HostListingsHandlerLambdaName = localstays-staging-host-listings-handler
```

**Verification:**

```bash
# Verify Host API Gateway exists
aws apigateway get-rest-apis \
  --region eu-north-1 \
  --query 'items[?name==`localstays-staging-host-api`].[id,name]'

# Test Host API endpoint (should return 401 Unauthorized - expected without auth)
curl https://xxxxx.execute-api.eu-north-1.amazonaws.com/staging/api/v1/listings/metadata
```

---

### Step 13: Deploy Phase 5b - Admin API Stack (5 minutes)

```bash
# Deploy Admin API Gateway + Lambda functions
npx cdk deploy \
  LocalstaysStagingAdminApiStack \
  -c env=staging \
  --require-approval never \
  --region eu-north-1
```

**What Gets Created:**

1. **Admin API Gateway**: REST API for admin dashboard
2. **Cognito Authorizer**: For admin authentication
3. **4 Lambda Functions**:
   - `localstays-staging-admin-hosts-handler`
   - `localstays-staging-admin-listings-handler`
   - `localstays-staging-admin-requests-handler`
   - `localstays-staging-send-notification`
4. **20+ API Routes**: Host management, listing review, request approval

**Expected Outputs (SAVE THESE - CRITICAL FOR ADMIN DASHBOARD):**

```
LocalstaysStagingAdminApiStack.AdminApiEndpoint = https://yyyyy.execute-api.eu-north-1.amazonaws.com/staging/
LocalstaysStagingAdminApiStack.AdminApiId = yyyyy
LocalstaysStagingAdminApiStack.AdminHostsHandlerLambdaName = localstays-staging-admin-hosts-handler
LocalstaysStagingAdminApiStack.AdminListingsHandlerLambdaName = localstays-staging-admin-listings-handler
```

**Verification:**

```bash
# Verify Admin API Gateway exists
aws apigateway get-rest-apis \
  --region eu-north-1 \
  --query 'items[?name==`localstays-staging-admin-api`].[id,name]'

# Test Admin API endpoint (should return 401 Unauthorized)
curl https://yyyyy.execute-api.eu-north-1.amazonaws.com/staging/api/v1/admin/hosts
```

---

### Step 14: Deploy Phase 5c - Public API Stack (2 minutes)

```bash
# Deploy Public API Gateway + Lambda functions
npx cdk deploy \
  LocalstaysStagingPublicApiStack \
  -c env=staging \
  --require-approval never \
  --region eu-north-1
```

**What Gets Created:**

1. **Public API Gateway**: REST API for public/unauthenticated endpoints
2. **Cognito Authorizer**: For authenticated public calls
3. **1 Lambda Function**:
   - `localstays-staging-check-increment-rate-limit`
4. **1 API Route**: Geocoding rate limiting

**Expected Outputs (SAVE THESE):**

```
LocalstaysStagingPublicApiStack.PublicApiEndpoint = https://zzzzz.execute-api.eu-north-1.amazonaws.com/staging/
LocalstaysStagingPublicApiStack.PublicApiId = zzzzz
LocalstaysStagingPublicApiStack.CheckAndIncrementRateLimitLambdaName = localstays-staging-check-increment-rate-limit
```

**Verification:**

```bash
# Verify Public API Gateway exists
aws apigateway get-rest-apis \
  --region eu-north-1 \
  --query 'items[?name==`localstays-staging-public-api`].[id,name]'

# Test Public API endpoint (should return 401 Unauthorized)
curl https://zzzzz.execute-api.eu-north-1.amazonaws.com/staging/api/v1/geocode/rate-limit
```

**📝 IMPORTANT - FRONTEND CONFIGURATION:**

After deploying all 3 API stacks, you now have **3 separate API URLs**:

1. **Host API**: `https://xxxxx.execute-api.eu-north-1.amazonaws.com/staging/`
2. **Admin API**: `https://yyyyy.execute-api.eu-north-1.amazonaws.com/staging/`
3. **Public API**: `https://zzzzz.execute-api.eu-north-1.amazonaws.com/staging/`

The frontend will need to be updated to use the correct API URL for each set of endpoints. See **"Frontend Configuration Guide"** at the end of this document.

---

### Step 15: 🔴 MANUAL - Enable GuardDuty Malware Protection (5 minutes)

**Why Required?** GuardDuty Malware Protection scans S3 uploads for viruses. Required for image/document security.

**Steps:**

1. Open AWS Console → GuardDuty
2. Click "Malware Protection" in left menu
3. Click "Enable Malware Protection for S3"
4. Select bucket: `localstays-staging-host-assets-*`
5. Click "Enable"

**Cost Impact:** $0.15 per GB scanned (first 150 GB/month free)

**Verification:**

```bash
# Check GuardDuty is enabled
aws guardduty list-detectors --region eu-north-1

# Check Malware Protection status
aws guardduty get-malware-scan-settings \
  --detector-id <detector-id-from-above> \
  --region eu-north-1
```

---

### Step 16: Seed Database with Roles & Enums (3 minutes)

```bash
# Navigate back to project root
cd /Users/markobabic/LocalDev/localstays-backend

# Seed all configuration data (roles, enums, amenities, etc.)
AWS_REGION=eu-north-1 \
TABLE_NAME=localstays-staging \
npx ts-node backend/services/seed/seed-handler.ts
```

**What This Seeds:**

1. **Roles**: HOST, ADMIN with permissions
2. **Host & User Enums**: HOST_STATUS, USER_STATUS, HOST_TYPE
3. **Listing Enums**: PROPERTY_TYPE, CHECKIN_TYPE, PARKING_TYPE, CANCELLATION_POLICY
4. **Amenities**: 100+ amenities with categories and translations
5. **Document Types**: PASSPORT, ID_CARD, DRIVERS_LICENSE, etc.
6. **Listing Statuses**: DRAFT, IN_REVIEW, APPROVED, REJECTED, ONLINE, OFFLINE, etc.
7. **Subscription Plans**: FREE, BASIC, PREMIUM

**Expected Output:**

```
✅ Seeded HOST role with 8 permissions
✅ Seeded ADMIN role with 11 permissions
✅ Seeded 5 HOST_STATUS values
✅ Seeded 3 USER_STATUS values
✅ Seeded 2 HOST_TYPE values
✅ Seeded 3 subscription plans
✅ Seeded 5 PROPERTY_TYPE values
✅ Seeded 4 CHECKIN_TYPE values
✅ Seeded 3 PARKING_TYPE values
✅ Seeded 7 CANCELLATION_POLICY values
✅ Seeded 4 AMENITY_CATEGORY values
✅ Seeded 100+ AMENITY values
✅ Seeded 10+ VERIFICATION_DOC_TYPE values
✅ Seeded 9 LISTING_STATUS values
```

**Verification:**

```bash
# Verify roles exist
aws dynamodb get-item \
  --table-name localstays-staging \
  --key '{"pk": {"S": "ROLE#HOST"}, "sk": {"S": "META"}}' \
  --region eu-north-1

# Verify enums exist
aws dynamodb query \
  --table-name localstays-staging \
  --key-condition-expression "pk = :pk" \
  --expression-attribute-values '{":pk":{"S":"ENUM#HOST_STATUS"}}' \
  --region eu-north-1

# Count all seeded data
aws dynamodb scan \
  --table-name localstays-staging \
  --filter-expression "begins_with(pk, :pk)" \
  --expression-attribute-values '{":pk":{"S":"ENUM#"}}' \
  --select COUNT \
  --region eu-north-1
# Expected: ~150+ items
```

**Note:** If email templates are not included in `seed-handler.ts`, seed them separately:

```bash
# Seed admin email templates
AWS_REGION=eu-north-1 \
TABLE_NAME=localstays-staging-email-templates \
npx ts-node backend/services/seed/seed-admin-templates.ts

# Seed verification email templates
AWS_REGION=eu-north-1 \
TABLE_NAME=localstays-staging-email-templates \
npx ts-node backend/services/seed/seed-verification-templates.ts
```

---

### Step 17: Create Admin User (2 minutes)

```bash
# Run the admin user seed script
AWS_REGION=eu-north-1 \
TABLE_NAME=localstays-staging \
USER_POOL_ID=<YOUR_USER_POOL_ID> \
npx ts-node backend/services/seed/seed-admin-user.ts
```

**What This Does:**

1. Fetches ADMIN role permissions from DynamoDB (15 permissions)
2. Creates admin user in Cognito with verified email
3. Adds user to ADMIN group
4. Creates user record in DynamoDB with full permission set
5. Sets permanent password

**Expected Output:**

```
✅ ✅ ✅ Admin user seeding complete! ✅ ✅ ✅

🔑 Login credentials:
   Email: marko+admin@velocci.me
   Password: Password1*
   User Sub: 80dcf9bc-3081-70ce-f698-2f04685939a4
   Role: ADMIN
   Permissions: 15 permissions
```

**Verification:**

```bash
# Verify user exists in Cognito
aws cognito-idp admin-get-user \
  --user-pool-id ${USER_POOL_ID} \
  --username marko+admin@velocci.me \
  --region eu-north-1

# Verify user is in ADMIN group
aws cognito-idp admin-list-groups-for-user \
  --user-pool-id ${USER_POOL_ID} \
  --username marko+admin@velocci.me \
  --region eu-north-1

# Verify user has all 15 permissions in DynamoDB
aws dynamodb query \
  --table-name localstays-staging \
  --key-condition-expression "pk = :pk AND sk = :sk" \
  --expression-attribute-values '{":pk":{"S":"USER#<USER_SUB>"},":sk":{"S":"PROFILE"}}' \
  --region eu-north-1 | jq '.Items[0].permissions.L | map(.S)'
```

**⚠️ IMPORTANT: Permission Verification**

The admin user MUST have these 15 permissions:

- `ADMIN_HOST_VIEW_ALL`
- `ADMIN_HOST_SEARCH`
- `ADMIN_HOST_SUSPEND`
- `ADMIN_HOST_REINSTATE`
- `ADMIN_KYC_VIEW_ALL`
- `ADMIN_KYC_APPROVE`
- `ADMIN_KYC_REJECT`
- `ADMIN_LISTING_VIEW_ALL`
- `ADMIN_LISTING_REVIEW` ← **Critical for setting listings to REVIEWING status**
- `ADMIN_LISTING_APPROVE`
- `ADMIN_LISTING_REJECT`
- `ADMIN_LISTING_SUSPEND`
- `ADMIN_REQUEST_VIEW_ALL`
- `ADMIN_REQUEST_APPROVE`
- `ADMIN_REQUEST_REJECT`

If any permissions are missing, the admin user will get 403 errors when trying to perform those actions.

---

## ✅ Post-Deployment Verification

### Test 1: User Signup Flow (5 minutes)

```bash
# Test signup via AWS CLI
aws cognito-idp sign-up \
  --client-id <USER_POOL_CLIENT_ID> \
  --username test@example.com \
  --password Test123! \
  --user-attributes Name=email,Value=test@example.com \
  --region eu-north-1
```

**Expected:**

1. User created in Cognito
2. Verification email sent via SendGrid
3. PreSignUp trigger logs consent
4. PostConfirmation trigger creates host record

**Check Logs:**

```bash
# PreSignUp logs
aws logs tail /aws/lambda/localstays-staging-pre-signup --follow --region eu-north-1

# CustomEmailSender logs
aws logs tail /aws/lambda/localstays-staging-custom-email-sender --follow --region eu-north-1

# PostConfirmation logs
aws logs tail /aws/lambda/localstays-staging-post-confirmation --follow --region eu-north-1
```

---

### Test 2: API Gateway Health Check (2 minutes)

```bash
# Get API endpoint from Step 10 output
API_ENDPOINT="<from-step-10-output>"

# Test public endpoint (no auth required)
curl ${API_ENDPOINT}api/v1/listings/metadata

# Expected: 200 OK with metadata
```

---

### Test 3: Image Upload & Processing (10 minutes)

**Prerequisites:**

1. Test user signed up and confirmed
2. JWT access token obtained

```bash
# 1. Get JWT token (use your frontend or Postman)
# 2. Upload test image to S3 staging area
# 3. Confirm submission
# 4. Monitor image processing queue

# Check queue depth
aws sqs get-queue-attributes \
  --queue-url https://sqs.eu-north-1.amazonaws.com/041608526793/staging-image-processing-queue \
  --attribute-names ApproximateNumberOfMessages \
  --region eu-north-1

# Check image processor logs
aws logs tail /aws/lambda/staging-image-processor --follow --region eu-north-1
```

---

### Test 4: Admin Dashboard Access (3 minutes)

```bash
# Login as admin user (from Step 13)
# Use frontend or Postman to call:

# GET /api/v1/admin/hosts
curl -H "Authorization: Bearer <ADMIN_JWT_TOKEN>" \
  ${API_ENDPOINT}api/v1/admin/hosts

# Expected: 200 OK with list of hosts
```

---

## 🔄 Propagating Changes: dev1 → staging

### Strategy 1: **Full Redeploy (Recommended for Major Changes)**

```bash
# 1. Test changes in dev1
# 2. Commit to git
# 3. Deploy to staging

cd /Users/markobabic/LocalDev/localstays-backend
git pull origin main
npm run build
npx cdk deploy --all -c env=staging --require-approval never --region eu-north-1
```

**When to Use:**

- Infrastructure changes (new stacks, resources)
- Major Lambda updates
- Schema changes
- New API endpoints

---

### Strategy 2: **Selective Stack Deploy (For Isolated Changes)**

```bash
# Only deploy changed stack
npx cdk deploy LocalstaysStagingApiStack -c env=staging --region eu-north-1
```

**When to Use:**

- Lambda code changes only
- API Gateway route changes
- No infrastructure changes

---

### Strategy 3: **Hotswap for Lambda Code (Fast Iteration)**

```bash
# Fast deploy for Lambda code changes only (bypasses CloudFormation)
npx cdk deploy LocalstaysStagingApiStack -c env=staging --hotswap --region eu-north-1
```

**⚠️ WARNING:** Only use for development testing, never for production!

**When to Use:**

- Rapid Lambda code iteration
- Testing bug fixes
- Development only

---

### Strategy 4: **Database Migrations**

```bash
# Run migration script against staging
AWS_REGION=eu-north-1 \
TABLE_NAME=localstays-staging \
npx ts-node backend/services/seed/migrate-<feature>.ts
```

**When to Use:**

- Schema changes
- Data transformations
- Adding new enums

---

### Strategy 5: **Image Processor Updates**

```bash
# Rebuild and push Docker image
cd backend/services/image-processor
./deploy.sh staging eu-north-1 041608526793

# Update Lambda function code
aws lambda update-function-code \
  --function-name staging-image-processor \
  --image-uri 041608526793.dkr.ecr.eu-north-1.amazonaws.com/staging-localstays-image-processor:latest \
  --region eu-north-1

# Wait for update to complete
aws lambda wait function-updated \
  --function-name staging-image-processor \
  --region eu-north-1
```

**When to Use:**

- Image processing logic changes
- Sharp library updates
- Container dependency updates

---

## 🎯 Best Practices for Multi-Environment Management

### 1. **Git Branching Strategy**

```
main (production-ready)
  ↓
staging (pre-production testing)
  ↓
dev1 (active development)
```

**Workflow:**

1. Develop in `dev1` branch → deploy to dev1 environment
2. Merge to `staging` branch → deploy to staging environment
3. After QA approval → merge to `main` → deploy to production

---

### 2. **Configuration Management**

**Store environment-specific configs in:**

- `cdk.json` → Infrastructure config
- SSM Parameter Store → Secrets (SendGrid, API keys)
- Environment variables → Runtime config

**Example:**

```typescript
// infra/lib/api-lambda-stack.ts
const environment = {
  TABLE_NAME: table.tableName,
  STAGE: stage, // 'dev1', 'staging', 'prod'
  LOG_LEVEL: stage === "prod" ? "ERROR" : "DEBUG",
};
```

---

### 3. **Cost Optimization**

| Environment | Retention | Alarms        | Reserved Concurrency | Cost/Month |
| ----------- | --------- | ------------- | -------------------- | ---------- |
| dev1        | 7 days    | Disabled      | None                 | ~$5        |
| staging     | 7 days    | Enabled       | None                 | ~$10       |
| production  | 30 days   | Enabled + SNS | 10 per Lambda        | ~$50       |

**Implement:**

```typescript
// In api-lambda-stack.ts
const logRetention =
  stage === "prod" ? logs.RetentionDays.ONE_MONTH : logs.RetentionDays.ONE_WEEK;

const reservedConcurrency = stage === "prod" ? 10 : undefined;
```

---

### 4. **Monitoring & Alerting**

**Staging Should Have:**

- ✅ CloudWatch Alarms (but no SNS notifications)
- ✅ CloudWatch Dashboards
- ✅ X-Ray tracing enabled
- ✅ Detailed logging

**Setup:**

```bash
# Create CloudWatch Dashboard for staging
aws cloudwatch put-dashboard \
  --dashboard-name localstays-staging \
  --dashboard-body file://monitoring/staging-dashboard.json \
  --region eu-north-1
```

---

### 5. **Disaster Recovery**

**Backup Strategy:**

- **DynamoDB**: Enable Point-in-Time Recovery (PITR)
- **S3**: Enable versioning
- **Cognito**: Export users weekly

```bash
# Enable PITR for staging
aws dynamodb update-continuous-backups \
  --table-name localstays-staging \
  --point-in-time-recovery-specification PointInTimeRecoveryEnabled=true \
  --region eu-north-1

# Enable S3 versioning
aws s3api put-bucket-versioning \
  --bucket localstays-staging-host-assets-<hash> \
  --versioning-configuration Status=Enabled \
  --region eu-north-1
```

---

### 6. **Testing Strategy**

**Staging Testing Checklist:**

- [ ] Smoke tests (API health checks)
- [ ] Integration tests (end-to-end flows)
- [ ] Load tests (simulate production traffic)
- [ ] Security tests (penetration testing)
- [ ] Disaster recovery tests (restore from backup)

---

### 7. **Deployment Automation**

**Create deployment script:**

```bash
#!/bin/bash
# deploy-staging.sh

set -e

ENV="staging"
REGION="eu-north-1"

echo "🚀 Deploying to ${ENV}..."

# Build
npm run build

# Deploy
npx cdk deploy --all -c env=${ENV} --require-approval never --region ${REGION}

# Verify
./scripts/verify-deployment.sh ${ENV}

echo "✅ Deployment complete!"
```

---

## 📊 Resource Summary

### Total Resources Created (Staging)

| Category                     | Count | Examples                                                                  |
| ---------------------------- | ----- | ------------------------------------------------------------------------- |
| **CloudFormation Stacks**    | 13    | Params, Data, Cognito, SharedServices, HostApi, AdminApi, PublicApi, etc. |
| **Lambda Functions**         | 16    | 4 auth triggers + 2 processors + 7 host + 4 admin + 1 public              |
| **DynamoDB Tables**          | 3     | localstays-staging, email-templates, rate-limits                          |
| **S3 Buckets**               | 1     | localstays-staging-host-assets-\*                                         |
| **Cognito User Pools**       | 1     | localstays-staging-users                                                  |
| **API Gateways**             | 3     | host-api, admin-api, public-api                                           |
| **Cognito Authorizers**      | 3     | One per API Gateway                                                       |
| **CloudFront Distributions** | 1     | CDN for images                                                            |
| **SQS Queues**               | 4     | Image queue, DLQ, verification queue, DLQ                                 |
| **EventBridge Rules**        | 2     | GuardDuty scan routing (images + verification)                            |
| **CloudWatch Alarms**        | 10+   | Queue backlog, Lambda errors, etc.                                        |
| **CloudWatch Log Groups**    | 19+   | 16 Lambdas + 3 API Gateways                                               |
| **KMS Keys**                 | 1     | Cognito CustomEmailSender encryption                                      |
| **ECR Repositories**         | 1     | staging-localstays-image-processor                                        |
| **SSM Parameters**           | 5+    | SendGrid API key, VAPID keys, config                                      |

**Total Cost Estimate:** ~$10-15/month

---

## 🚨 Troubleshooting Guide

### Issue 1: "Stack is in UPDATE_ROLLBACK_FAILED state"

**Cause:** Previous deployment failed and CloudFormation is stuck

**Fix:**

```bash
# Continue rollback
aws cloudformation continue-update-rollback \
  --stack-name localstays-staging-<stack-name> \
  --region eu-north-1

# Wait for rollback to complete
aws cloudformation wait stack-rollback-complete \
  --stack-name localstays-staging-<stack-name> \
  --region eu-north-1

# Retry deployment
npx cdk deploy <StackName> -c env=staging
```

---

### Issue 2: "No verification email received"

**Checklist:**

1. ✅ Cognito triggers attached (Step 6)
2. ✅ Advanced Security ENFORCED (Step 8)
3. ✅ SendGrid API key correct (Step 4)
4. ✅ CustomEmailSender Lambda has SSM permissions

**Debug:**

```bash
# Check Lambda logs
aws logs tail /aws/lambda/localstays-staging-custom-email-sender --follow --region eu-north-1

# Check Lambda has SSM permission
aws lambda get-policy \
  --function-name localstays-staging-custom-email-sender \
  --region eu-north-1
```

---

### Issue 3: "Image processor Lambda timeout"

**Cause:** Large images or slow S3 download

**Fix:**

```bash
# Increase Lambda timeout (currently 90s)
aws lambda update-function-configuration \
  --function-name staging-image-processor \
  --timeout 120 \
  --region eu-north-1

# Increase memory (currently 2048 MB)
aws lambda update-function-configuration \
  --function-name staging-image-processor \
  --memory-size 3008 \
  --region eu-north-1
```

---

### Issue 4: "API Gateway returns 403 Forbidden"

**Cause:** Cognito authorizer misconfigured

**Debug:**

```bash
# Check authorizer configuration
aws apigateway get-authorizers \
  --rest-api-id <API_ID> \
  --region eu-north-1

# Test JWT token
curl -H "Authorization: Bearer <JWT_TOKEN>" \
  ${API_ENDPOINT}api/v1/hosts/<HOST_ID>/profile
```

---

### Issue 5: "DynamoDB ConditionalCheckFailedException"

**Cause:** Concurrent writes or incorrect conditions

**Debug:**

```bash
# Check CloudWatch Insights
aws logs start-query \
  --log-group-name /aws/lambda/localstays-staging-host-profile-handler \
  --start-time $(date -u -d '1 hour ago' +%s) \
  --end-time $(date -u +%s) \
  --query-string 'fields @timestamp, @message | filter @message like /ConditionalCheckFailedException/' \
  --region eu-north-1
```

---

## 📋 Deployment Checklist

### Pre-Deployment

- [ ] AWS CLI configured and authenticated
- [ ] Node.js 20+ installed
- [ ] Docker installed and running
- [ ] CDK 2.110.0+ installed
- [ ] Project built successfully (`npm run build`)
- [ ] SendGrid API key available
- [ ] `cdk.json` has `staging` environment configured

### Phase 1: Foundation

- [ ] ParamsStack deployed
- [ ] DataStack deployed
- [ ] EmailTemplateStack deployed
- [ ] StorageStack deployed
- [ ] KmsStack deployed
- [ ] SendGrid API key copied to staging

### Phase 2: Authentication

- [ ] CognitoStack deployed
- [ ] AuthTriggerStack deployed
- [ ] Cognito triggers attached manually
- [ ] Cognito upgraded to Plus tier
- [ ] Advanced Security ENFORCED enabled

### Phase 3: API & Processing

- [ ] Docker image built and pushed to ECR
- [ ] ApiStack deployed
- [ ] GuardDuty Malware Protection enabled

### Phase 4: Data Seeding

- [ ] Database seeded with roles and enums
- [ ] Email templates seeded
- [ ] Admin user created

### Phase 5: Verification

- [ ] User signup flow tested
- [ ] API Gateway health check passed
- [ ] Image upload and processing tested
- [ ] Admin dashboard accessible
- [ ] CloudWatch logs showing activity
- [ ] No errors in DLQ

---

## 🎉 Success Criteria

**Staging environment is ready when:**

1. ✅ All 8 stacks deployed successfully
2. ✅ User can sign up and receive verification email
3. ✅ User can log in and get JWT with custom claims
4. ✅ API endpoints return expected responses
5. ✅ Image upload triggers processing pipeline
6. ✅ Admin user can access admin endpoints
7. ✅ CloudWatch alarms are configured (not alarming)
8. ✅ No messages in DLQ
9. ✅ Frontend can connect and authenticate
10. ✅ All manual interventions documented

---

## 📚 Next Steps After Staging Deployment

1. **Update Frontend Configuration**

   ```env
   VITE_COGNITO_USER_POOL_ID=<staging-user-pool-id>
   VITE_COGNITO_CLIENT_ID=<staging-client-id>
   VITE_API_ENDPOINT=<staging-api-endpoint>
   VITE_ENVIRONMENT=staging
   ```

2. **Set Up CI/CD Pipeline**

   - GitHub Actions for automated deployments
   - Automated testing on PR
   - Deployment approval workflow

3. **Configure Monitoring**

   - CloudWatch Dashboard
   - SNS topics for critical alarms
   - PagerDuty integration (optional)

4. **Document Runbooks**

   - Incident response procedures
   - Rollback procedures
   - Disaster recovery procedures

5. **Plan Production Deployment**
   - Use this staging deployment as template
   - Update `cdk.json` with production config
   - Set up separate AWS account for production (recommended)

---

## 💡 Pro Tips

1. **Use CDK Diff Before Deploying**

   ```bash
   npx cdk diff LocalstaysStagingApiStack -c env=staging
   ```

2. **Tag Everything**

   ```typescript
   cdk.Tags.of(app).add("Environment", "staging");
   cdk.Tags.of(app).add("CostCenter", "Engineering");
   cdk.Tags.of(app).add("Owner", "marko@localstays.me");
   ```

3. **Use CloudFormation Change Sets**

   ```bash
   npx cdk deploy --no-execute -c env=staging
   # Review change set in AWS Console
   # Execute manually if approved
   ```

4. **Keep Deployment Logs**

   ```bash
   npx cdk deploy --all -c env=staging 2>&1 | tee deployment-$(date +%Y%m%d-%H%M%S).log
   ```

5. **Automate Verification**
   ```bash
   # Create verify-deployment.sh script
   ./scripts/verify-deployment.sh staging
   ```

---

## 📞 Support & Questions

**If you encounter issues:**

1. Check this document's Troubleshooting section
2. Review CloudWatch logs for specific Lambda
3. Check CloudFormation events for stack deployment errors
4. Review IAM permissions for Lambda execution roles

**Common Gotchas:**

- Cognito triggers not attached → No custom claims in JWT
- Advanced Security not ENFORCED → CustomEmailSender doesn't trigger
- ECR image not pushed → Image processor Lambda fails to deploy
- GuardDuty not enabled → Images never processed

---

## 🌐 Frontend Configuration Guide

### ⚠️ BREAKING CHANGE: 3 Separate API URLs

After the infrastructure restructure, you now have **3 separate API Gateways** instead of 1:

1. **Host API** - For host-facing endpoints
2. **Admin API** - For admin dashboard endpoints
3. **Public API** - For public/unauthenticated endpoints

### API URL Mapping

| Endpoint Pattern            | API Gateway    | Environment Variable  |
| --------------------------- | -------------- | --------------------- |
| `/api/v1/hosts/{hostId}/**` | **Host API**   | `VITE_HOST_API_URL`   |
| `/api/v1/listings/metadata` | **Host API**   | `VITE_HOST_API_URL`   |
| `/api/v1/notifications/**`  | **Host API**   | `VITE_HOST_API_URL`   |
| `/api/v1/admin/**`          | **Admin API**  | `VITE_ADMIN_API_URL`  |
| `/api/v1/geocode/**`        | **Public API** | `VITE_PUBLIC_API_URL` |

### Frontend Environment Variables (Example)

```env
# Host App (.env.staging)
VITE_HOST_API_URL=https://xxxxx.execute-api.eu-north-1.amazonaws.com/staging
VITE_PUBLIC_API_URL=https://zzzzz.execute-api.eu-north-1.amazonaws.com/staging

# Admin Dashboard (.env.staging)
VITE_ADMIN_API_URL=https://yyyyy.execute-api.eu-north-1.amazonaws.com/staging
```

### Code Changes Required

**Before (Single API):**

```typescript
const API_URL = import.meta.env.VITE_API_URL;

// All calls go to same URL
await fetch(`${API_URL}/api/v1/hosts/${hostId}/profile`);
await fetch(`${API_URL}/api/v1/admin/hosts`);
await fetch(`${API_URL}/api/v1/geocode/rate-limit`);
```

**After (Multiple APIs):**

```typescript
const HOST_API_URL = import.meta.env.VITE_HOST_API_URL;
const ADMIN_API_URL = import.meta.env.VITE_ADMIN_API_URL;
const PUBLIC_API_URL = import.meta.env.VITE_PUBLIC_API_URL;

// Route to correct API
await fetch(`${HOST_API_URL}/api/v1/hosts/${hostId}/profile`); // Host API
await fetch(`${ADMIN_API_URL}/api/v1/admin/hosts`); // Admin API
await fetch(`${PUBLIC_API_URL}/api/v1/geocode/rate-limit`); // Public API
```

### Recommended Approach: API Client Abstraction

Create separate API clients for each concern:

```typescript
// src/lib/api/host-api.ts
const HOST_API_URL = import.meta.env.VITE_HOST_API_URL;

export const hostApi = {
  getProfile: (hostId: string) =>
    fetch(`${HOST_API_URL}/api/v1/hosts/${hostId}/profile`),
  getListings: (hostId: string) =>
    fetch(`${HOST_API_URL}/api/v1/hosts/${hostId}/listings`),
  // ... all host endpoints
};

// src/lib/api/admin-api.ts
const ADMIN_API_URL = import.meta.env.VITE_ADMIN_API_URL;

export const adminApi = {
  getHosts: () => fetch(`${ADMIN_API_URL}/api/v1/admin/hosts`),
  approveHost: (hostId: string) =>
    fetch(`${ADMIN_API_URL}/api/v1/admin/hosts/${hostId}/approve`, {
      method: "PUT",
    }),
  // ... all admin endpoints
};

// src/lib/api/public-api.ts
const PUBLIC_API_URL = import.meta.env.VITE_PUBLIC_API_URL;

export const publicApi = {
  checkRateLimit: () =>
    fetch(`${PUBLIC_API_URL}/api/v1/geocode/rate-limit`, { method: "POST" }),
  // ... all public endpoints
};
```

### Benefits of This Restructure

1. **Better Organization**: Clear separation between host, admin, and public concerns
2. **Independent Scaling**: Each API can be scaled independently based on traffic
3. **Security**: Admin endpoints isolated from public/host APIs
4. **Resource Limits**: Each API stays well under CloudFormation's 500 resource limit
5. **Monitoring**: Separate CloudWatch logs per API for easier debugging
6. **Cost Transparency**: Clear cost breakdown per API type

### Migration Checklist

- [ ] Update environment variables in frontend projects
- [ ] Create API client abstractions (host-api.ts, admin-api.ts, public-api.ts)
- [ ] Update all API calls to use correct client
- [ ] Test all endpoints in staging
- [ ] Update CI/CD pipelines with new environment variables
- [ ] Update documentation with new API URLs

---

**Estimated Total Deployment Time: 50-65 minutes**

- Automated steps: ~20 minutes (now deploying 13 stacks instead of 8)
- Manual interventions: ~33 minutes
- Verification & testing: ~15 minutes

---

**Last Updated:** 2025-11-19 (Infrastructure Restructure)
**CDK Version:** 2.110.0
**Node Version:** 20.x
**Region:** eu-north-1
**Stacks:** 13 (previously 8)
