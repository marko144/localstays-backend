# 🔐 Environment Variables & Configuration Guide

## Complete Reference for Backend & Frontend Configuration

---

## 📊 Overview

This document covers:

1. **SSM Parameter Store** - Secrets stored in AWS
2. **Lambda Environment Variables** - Runtime configuration
3. **Frontend Configuration** - What the frontend needs
4. **How to Retrieve Values** - Scripts and commands

---

## 🔒 SSM Parameter Store (AWS Secrets)

### **What's Stored in SSM:**

| Parameter Name                 | Type         | Value          | Purpose                             | Environments        |
| ------------------------------ | ------------ | -------------- | ----------------------------------- | ------------------- |
| `/localstays/{stage}/sendgrid` | SecureString | `SG.xxxxxxxxx` | SendGrid API key for sending emails | dev1, staging, prod |

**Current Environments:**

- `/localstays/dev1/sendgrid` ✅ Exists
- `/localstays/staging/sendgrid` ⚠️ To be created (Step 4 of deployment)
- `/localstays/prod/sendgrid` ❌ Not yet

---

### **How to Manage SSM Parameters:**

#### **View Parameter (Without Decryption):**

```bash
aws ssm describe-parameters \
  --filters "Key=Name,Values=/localstays/staging/sendgrid" \
  --region eu-north-1
```

#### **Get Parameter Value (With Decryption):**

```bash
aws ssm get-parameter \
  --name /localstays/staging/sendgrid \
  --with-decryption \
  --region eu-north-1 \
  --query 'Parameter.Value' \
  --output text
```

#### **Copy Between Environments:**

```bash
# Use the provided script
./scripts/copy-sendgrid-key.sh dev1 staging
```

#### **Create New Parameter:**

```bash
aws ssm put-parameter \
  --name /localstays/staging/sendgrid \
  --value "SG.your-sendgrid-api-key" \
  --type SecureString \
  --region eu-north-1
```

#### **Update Existing Parameter:**

```bash
aws ssm put-parameter \
  --name /localstays/staging/sendgrid \
  --value "SG.new-sendgrid-api-key" \
  --type SecureString \
  --overwrite \
  --region eu-north-1
```

---

## 🔧 Lambda Environment Variables (Backend)

### **Common Environment Variables (All Lambdas):**

Set automatically by CDK in `infra/lib/api-lambda-stack.ts` (lines 532-540):

| Variable                | Example (dev1)                       | Example (staging)                       | Purpose                                 |
| ----------------------- | ------------------------------------ | --------------------------------------- | --------------------------------------- |
| `TABLE_NAME`            | `localstays-dev1`                    | `localstays-staging`                    | DynamoDB table name                     |
| `BUCKET_NAME`           | `localstays-dev1-host-assets-<hash>` | `localstays-staging-host-assets-<hash>` | S3 bucket name                          |
| `EMAIL_TEMPLATES_TABLE` | `localstays-dev1-email-templates`    | `localstays-staging-email-templates`    | Email templates table                   |
| `SENDGRID_PARAM`        | `/localstays/dev1/sendgrid`          | `/localstays/staging/sendgrid`          | SSM parameter name for SendGrid key     |
| `FROM_EMAIL`            | `marko@localstays.me`                | `marko@localstays.me`                   | Email sender address                    |
| `STAGE`                 | `dev1`                               | `staging`                               | Environment name                        |
| `AWS_REGION`            | `eu-north-1`                         | `eu-north-1`                            | AWS region (auto-set by Lambda runtime) |

---

### **Lambda-Specific Environment Variables:**

#### **Image Processor Lambda:**

```typescript
{
  TABLE_NAME: table.tableName,
  BUCKET_NAME: bucket.bucketName,
}
```

#### **Verification Processor Lambda:**

```typescript
{
  TABLE_NAME: table.tableName,
  BUCKET_NAME: bucket.bucketName,
}
```

#### **All API Handler Lambdas:**

```typescript
{
  TABLE_NAME: table.tableName,
  BUCKET_NAME: bucket.bucketName,
  EMAIL_TEMPLATES_TABLE: emailTemplatesTable.tableName,
  SENDGRID_PARAM: sendGridParamName,
  FROM_EMAIL: 'marko@localstays.me',
  STAGE: stage,
}
```

---

### **How to View Lambda Environment Variables:**

```bash
# View environment variables for a specific Lambda
aws lambda get-function-configuration \
  --function-name localstays-staging-host-listings-handler \
  --region eu-north-1 \
  --query 'Environment.Variables'

# Expected output:
# {
#   "TABLE_NAME": "localstays-staging",
#   "BUCKET_NAME": "localstays-staging-host-assets-xxxxx",
#   "EMAIL_TEMPLATES_TABLE": "localstays-staging-email-templates",
#   "SENDGRID_PARAM": "/localstays/staging/sendgrid",
#   "FROM_EMAIL": "marko@localstays.me",
#   "STAGE": "staging",
#   "AWS_REGION": "eu-north-1"
# }
```

---

## 🌐 Frontend Configuration

### **What the Frontend Needs:**

The frontend requires **3 values from Cognito** to authenticate users:

| Variable               | Example (dev1)                                           | Example (staging)                                           | Purpose               |
| ---------------------- | -------------------------------------------------------- | ----------------------------------------------------------- | --------------------- |
| `COGNITO_USER_POOL_ID` | `eu-north-1_NhDbGTVZd`                                   | `eu-north-1_XXXXXXX`                                        | Cognito User Pool ID  |
| `COGNITO_CLIENT_ID`    | `7abc...xyz`                                             | `8def...uvw`                                                | Cognito App Client ID |
| `COGNITO_REGION`       | `eu-north-1`                                             | `eu-north-1`                                                | AWS Region            |
| `API_ENDPOINT`         | `https://xxx.execute-api.eu-north-1.amazonaws.com/dev1/` | `https://yyy.execute-api.eu-north-1.amazonaws.com/staging/` | API Gateway URL       |

---

### **How to Get Frontend Configuration:**

#### **Method 1: Use the Script (Recommended)**

```bash
# Get configuration for staging
./scripts/get-frontend-config.sh staging
```

**Output:**

```
Fetching Cognito configuration for environment: staging (Region: eu-north-1)

--- Frontend Configuration ---
COGNITO_USER_POOL_ID=eu-north-1_XXXXXXX
COGNITO_CLIENT_ID=xxxxxxxxxxxxxxxxxxxxxxxxxx
COGNITO_REGION=eu-north-1
----------------------------

--- JSON Format ---
{
  "userPoolId": "eu-north-1_XXXXXXX",
  "clientId": "xxxxxxxxxxxxxxxxxxxxxxxxxx",
  "region": "eu-north-1"
}
-------------------
```

---

#### **Method 2: Manual CloudFormation Query**

```bash
# Get User Pool ID
aws cloudformation describe-stacks \
  --stack-name localstays-staging-cognito \
  --query "Stacks[0].Outputs[?OutputKey=='UserPoolId'].OutputValue" \
  --output text \
  --region eu-north-1

# Get Client ID
aws cloudformation describe-stacks \
  --stack-name localstays-staging-cognito \
  --query "Stacks[0].Outputs[?OutputKey=='UserPoolClientId'].OutputValue" \
  --output text \
  --region eu-north-1

# Get API Endpoint
aws cloudformation describe-stacks \
  --stack-name localstays-staging-api \
  --query "Stacks[0].Outputs[?OutputKey=='ApiEndpoint'].OutputValue" \
  --output text \
  --region eu-north-1
```

---

### **Frontend Environment Files:**

#### **React/Vite (.env.staging)**

```env
# Cognito Configuration
VITE_COGNITO_USER_POOL_ID=eu-north-1_XXXXXXX
VITE_COGNITO_CLIENT_ID=xxxxxxxxxxxxxxxxxxxxxxxxxx
VITE_COGNITO_REGION=eu-north-1

# API Configuration
VITE_API_ENDPOINT=https://xxxxxxxxxx.execute-api.eu-north-1.amazonaws.com/staging/
VITE_API_VERSION=v1

# Environment
VITE_ENVIRONMENT=staging
VITE_STAGE=staging

# Optional: Feature Flags
VITE_ENABLE_DEBUG=false
VITE_ENABLE_ANALYTICS=true
```

#### **Next.js (.env.staging)**

```env
# Cognito Configuration
NEXT_PUBLIC_COGNITO_USER_POOL_ID=eu-north-1_XXXXXXX
NEXT_PUBLIC_COGNITO_CLIENT_ID=xxxxxxxxxxxxxxxxxxxxxxxxxx
NEXT_PUBLIC_COGNITO_REGION=eu-north-1

# API Configuration
NEXT_PUBLIC_API_ENDPOINT=https://xxxxxxxxxx.execute-api.eu-north-1.amazonaws.com/staging/
NEXT_PUBLIC_API_VERSION=v1

# Environment
NEXT_PUBLIC_ENVIRONMENT=staging
NEXT_PUBLIC_STAGE=staging
```

---

## 📋 Configuration by Environment

### **dev1 Environment:**

```bash
# Backend (Lambda Environment Variables)
TABLE_NAME=localstays-dev1
BUCKET_NAME=localstays-dev1-host-assets-<hash>
EMAIL_TEMPLATES_TABLE=localstays-dev1-email-templates
SENDGRID_PARAM=/localstays/dev1/sendgrid
FROM_EMAIL=marko@localstays.me
STAGE=dev1
AWS_REGION=eu-north-1

# Frontend
COGNITO_USER_POOL_ID=eu-north-1_NhDbGTVZd  # Example
COGNITO_CLIENT_ID=7abc...xyz  # Example
COGNITO_REGION=eu-north-1
API_ENDPOINT=https://xxx.execute-api.eu-north-1.amazonaws.com/dev1/
```

---

### **staging Environment:**

```bash
# Backend (Lambda Environment Variables)
TABLE_NAME=localstays-staging
BUCKET_NAME=localstays-staging-host-assets-<hash>
EMAIL_TEMPLATES_TABLE=localstays-staging-email-templates
SENDGRID_PARAM=/localstays/staging/sendgrid
FROM_EMAIL=marko@localstays.me
STAGE=staging
AWS_REGION=eu-north-1

# Frontend
COGNITO_USER_POOL_ID=<from-deployment-step-5>
COGNITO_CLIENT_ID=<from-deployment-step-5>
COGNITO_REGION=eu-north-1
API_ENDPOINT=<from-deployment-step-10>
```

---

### **prod Environment:**

```bash
# Backend (Lambda Environment Variables)
TABLE_NAME=localstays-prod
BUCKET_NAME=localstays-prod-host-assets-<hash>
EMAIL_TEMPLATES_TABLE=localstays-prod-email-templates
SENDGRID_PARAM=/localstays/prod/sendgrid
FROM_EMAIL=marko@localstays.me
STAGE=prod
AWS_REGION=eu-central-1  # Different region!

# Frontend
COGNITO_USER_POOL_ID=<to-be-determined>
COGNITO_CLIENT_ID=<to-be-determined>
COGNITO_REGION=eu-central-1  # Different region!
API_ENDPOINT=<to-be-determined>
```

---

## 🔍 How to Verify Configuration

### **Backend Verification:**

```bash
# 1. Check SSM Parameter exists
aws ssm describe-parameters \
  --filters "Key=Name,Values=/localstays/staging/sendgrid" \
  --region eu-north-1

# 2. Check Lambda environment variables
aws lambda get-function-configuration \
  --function-name localstays-staging-host-listings-handler \
  --region eu-north-1 \
  --query 'Environment.Variables'

# 3. Check DynamoDB table exists
aws dynamodb describe-table \
  --table-name localstays-staging \
  --region eu-north-1 \
  --query 'Table.[TableName,TableStatus]'

# 4. Check S3 bucket exists
aws s3 ls | grep localstays-staging

# 5. Check API Gateway endpoint
aws apigateway get-rest-apis \
  --region eu-north-1 \
  --query 'items[?name==`localstays-staging-api`].[id,name]'
```

---

### **Frontend Verification:**

```bash
# 1. Get Cognito configuration
./scripts/get-frontend-config.sh staging

# 2. Test Cognito User Pool
aws cognito-idp describe-user-pool \
  --user-pool-id <USER_POOL_ID> \
  --region eu-north-1 \
  --query 'UserPool.[Id,Name,Status]'

# 3. Test API endpoint
curl <API_ENDPOINT>api/v1/listings/metadata
# Should return 401 Unauthorized (expected without auth)
```

---

## 🚨 Security Best Practices

### **DO:**

✅ **Store secrets in SSM Parameter Store** (encrypted)
✅ **Use environment variables for configuration**
✅ **Use different SendGrid keys per environment**
✅ **Rotate SendGrid API keys regularly**
✅ **Use IAM roles for Lambda permissions** (not hardcoded credentials)
✅ **Use SecureString type for SSM parameters**
✅ **Restrict SSM parameter access via IAM policies**

---

### **DON'T:**

❌ **Never commit secrets to git**
❌ **Never hardcode API keys in Lambda code**
❌ **Never share SendGrid keys between environments**
❌ **Never log decrypted secrets**
❌ **Never use plaintext SSM parameters for secrets**
❌ **Never expose backend environment variables to frontend**

---

## 📝 Deployment Checklist

### **When Deploying to a New Environment:**

- [ ] **Step 1:** Deploy ParamsStack (creates SSM parameter structure)
- [ ] **Step 2:** Copy SendGrid API key to SSM
  ```bash
  ./scripts/copy-sendgrid-key.sh dev1 staging
  ```
- [ ] **Step 3:** Deploy all other stacks
- [ ] **Step 4:** Get frontend configuration
  ```bash
  ./scripts/get-frontend-config.sh staging
  ```
- [ ] **Step 5:** Update frontend `.env.staging` file
- [ ] **Step 6:** Verify Lambda environment variables
  ```bash
  aws lambda get-function-configuration \
    --function-name localstays-staging-host-listings-handler \
    --region eu-north-1 \
    --query 'Environment.Variables'
  ```
- [ ] **Step 7:** Test API endpoint
- [ ] **Step 8:** Test frontend authentication

---

## 🔄 Updating Configuration

### **Update SendGrid API Key:**

```bash
# Update in SSM
aws ssm put-parameter \
  --name /localstays/staging/sendgrid \
  --value "SG.new-api-key" \
  --type SecureString \
  --overwrite \
  --region eu-north-1

# No Lambda restart needed - they read from SSM at runtime
```

### **Update Lambda Environment Variables:**

```bash
# Update via CDK (recommended)
npx cdk deploy LocalstaysStagingApiStack -c env=staging --region eu-north-1

# Or update directly (not recommended)
aws lambda update-function-configuration \
  --function-name localstays-staging-host-listings-handler \
  --environment Variables="{TABLE_NAME=localstays-staging,BUCKET_NAME=...}" \
  --region eu-north-1
```

---

## 📊 Summary Table

### **Backend Configuration:**

| Component                 | Storage Location    | Set By        | Accessible By    |
| ------------------------- | ------------------- | ------------- | ---------------- |
| **SendGrid API Key**      | SSM Parameter Store | Manual/Script | Lambda (via IAM) |
| **Table Name**            | Lambda Env Vars     | CDK           | Lambda           |
| **Bucket Name**           | Lambda Env Vars     | CDK           | Lambda           |
| **Email Templates Table** | Lambda Env Vars     | CDK           | Lambda           |
| **From Email**            | Lambda Env Vars     | CDK           | Lambda           |
| **Stage**                 | Lambda Env Vars     | CDK           | Lambda           |

### **Frontend Configuration:**

| Component        | Storage Location      | Set By | Accessible By     |
| ---------------- | --------------------- | ------ | ----------------- |
| **User Pool ID** | CloudFormation Output | CDK    | Frontend (public) |
| **Client ID**    | CloudFormation Output | CDK    | Frontend (public) |
| **Region**       | CloudFormation Output | CDK    | Frontend (public) |
| **API Endpoint** | CloudFormation Output | CDK    | Frontend (public) |

---

## 🎯 Quick Reference Commands

```bash
# Get all configuration for staging
./scripts/get-frontend-config.sh staging

# Copy SendGrid key
./scripts/copy-sendgrid-key.sh dev1 staging

# View Lambda env vars
aws lambda get-function-configuration \
  --function-name localstays-staging-host-listings-handler \
  --region eu-north-1 \
  --query 'Environment.Variables'

# View SSM parameter (encrypted)
aws ssm get-parameter \
  --name /localstays/staging/sendgrid \
  --with-decryption \
  --region eu-north-1

# Get API endpoint
aws cloudformation describe-stacks \
  --stack-name localstays-staging-api \
  --query "Stacks[0].Outputs[?OutputKey=='ApiEndpoint'].OutputValue" \
  --output text \
  --region eu-north-1
```

---

## ✅ You're All Set!

This guide covers:

- ✅ SSM Parameter Store (SendGrid API key)
- ✅ Lambda environment variables (all 7 variables)
- ✅ Frontend configuration (4 required values)
- ✅ How to retrieve all values
- ✅ Security best practices
- ✅ Deployment checklist

**Everything is documented and automated!** 🎉


