# 🚀 Staging Deployment - Quick Reference Checklist

## ⏱️ Time Estimate: 45-60 minutes

---

## 📋 Pre-Flight Checks (5 min)

```bash
# 1. Verify AWS CLI
aws sts get-caller-identity
# Expected: Account 041608526793

# 2. Verify Node.js
node --version
# Expected: v20.x or higher

# 3. Verify Docker
docker ps
# Expected: No errors

# 4. Verify CDK
npx cdk --version
# Expected: 2.110.0+

# 5. Navigate to project
cd /Users/markobabic/LocalDev/localstays-backend
```

---

## 🔨 Build & Synth (3 min)

```bash
# Clean build
rm -rf dist/ backend/dist/ cdk.out/

# Install dependencies
npm install

# Build project
npm run build

# Synthesize stacks
npx cdk synth --all -c env=staging
```

---

## 🏗️ Phase 1: Foundation (5 min)

```bash
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

**Save These Outputs:**

- ✅ `TableName`: ************\_\_\_************
- ✅ `BucketName`: ************\_\_\_************
- ✅ `KmsKeyArn`: ************\_\_\_************

---

## 🔑 MANUAL: Copy SendGrid Key (1 min)

```bash
./scripts/copy-sendgrid-key.sh dev1 staging

# Verify
aws ssm describe-parameters \
  --filters "Key=Name,Values=/localstays/staging/sendgrid" \
  --region eu-north-1
```

---

## 🔐 Phase 2: Authentication (3 min)

```bash
npx cdk deploy \
  LocalstaysStagingCognitoStack \
  LocalstaysStagingAuthTriggerStack \
  -c env=staging \
  --require-approval never \
  --region eu-north-1
```

**Save These Outputs:**

- ✅ `UserPoolId`: ************\_\_\_************
- ✅ `UserPoolClientId`: ************\_\_\_************
- ✅ `PreSignupLambdaArn`: ************\_\_\_************
- ✅ `PostConfirmationLambdaArn`: ************\_\_\_************
- ✅ `PreTokenGenerationLambdaArn`: ************\_\_\_************
- ✅ `CustomEmailSenderLambdaArn`: ************\_\_\_************

---

## 🔗 MANUAL: Attach Cognito Triggers (2 min)

```bash
# Set variables from outputs above
USER_POOL_ID="<from-output>"
KMS_KEY_ARN="<from-phase-1-output>"

# Attach triggers
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

# Verify
aws cognito-idp describe-user-pool \
  --user-pool-id ${USER_POOL_ID} \
  --region eu-north-1 \
  --query 'UserPool.LambdaConfig'
```

---

## 💳 MANUAL: Upgrade Cognito (5 min)

**AWS Console Steps:**

1. Open AWS Console → Cognito → User Pools
2. Select `localstays-staging-users`
3. Click "Upgrade to Plus"
4. Confirm billing (~$5/month)
5. Wait for upgrade

---

## 🔒 MANUAL: Enable Advanced Security (1 min)

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
```

---

## 🐳 MANUAL: Build Docker Image (15 min)

```bash
cd backend/services/image-processor

./deploy.sh staging eu-north-1 041608526793

# Verify
aws ecr describe-images \
  --repository-name staging-localstays-image-processor \
  --region eu-north-1

cd ../../..
```

---

## 🌐 Phase 3: API Stack (5 min)

```bash
npx cdk deploy \
  LocalstaysStagingApiStack \
  -c env=staging \
  --require-approval never \
  --region eu-north-1
```

**Save These Outputs:**

- ✅ `ApiEndpoint`: ************\_\_\_************
- ✅ `ApiId`: ************\_\_\_************

---

## 🛡️ MANUAL: Enable GuardDuty (5 min)

**AWS Console Steps:**

1. Open GuardDuty
2. Click "Malware Protection"
3. Enable for S3
4. Select bucket: `localstays-staging-host-assets-*`
5. Confirm

---

## 🌱 Seed Database (2 min)

```bash
AWS_REGION=eu-north-1 \
TABLE_NAME=localstays-staging \
npx ts-node backend/services/seed/seed-all.ts
```

---

## 👤 Create Admin User (2 min)

```bash
# Update script for staging
sed -i '' 's/ENV="dev1"/ENV="staging"/g' scripts/seed-admin-user.sh

# Run
./scripts/seed-admin-user.sh

# Save credentials
# Email: marko+admin@velocci.me
# Password: Password1*
```

---

## ✅ Verification Tests (10 min)

### Test 1: API Health

```bash
API_ENDPOINT="<from-phase-3-output>"
curl ${API_ENDPOINT}api/v1/listings/metadata
# Expected: 200 OK
```

### Test 2: User Signup

```bash
aws cognito-idp sign-up \
  --client-id <USER_POOL_CLIENT_ID> \
  --username test@example.com \
  --password Test123! \
  --user-attributes Name=email,Value=test@example.com \
  --region eu-north-1
# Expected: User created, email sent
```

### Test 3: Check Logs

```bash
aws logs tail /aws/lambda/localstays-staging-custom-email-sender --follow --region eu-north-1
# Expected: Email sending logs
```

### Test 4: Admin Login

```bash
# Use frontend or Postman
# Login: marko+admin@velocci.me / Password1*
# Verify JWT has admin claims
```

---

## 📊 Final Checklist

- [ ] All 8 stacks deployed
- [ ] SendGrid key copied
- [ ] Cognito triggers attached
- [ ] Cognito upgraded to Plus
- [ ] Advanced Security ENFORCED
- [ ] Docker image in ECR
- [ ] GuardDuty enabled
- [ ] Database seeded
- [ ] Admin user created
- [ ] API health check passes
- [ ] User signup works
- [ ] Email received
- [ ] Admin login works
- [ ] No errors in logs

---

## 🎯 Frontend Configuration

```env
# Update your frontend .env file
VITE_COGNITO_USER_POOL_ID=<USER_POOL_ID>
VITE_COGNITO_CLIENT_ID=<USER_POOL_CLIENT_ID>
VITE_API_ENDPOINT=<API_ENDPOINT>
VITE_ENVIRONMENT=staging
VITE_REGION=eu-north-1
```

---

## 🚨 Quick Troubleshooting

### No email received?

```bash
# Check triggers attached
aws cognito-idp describe-user-pool --user-pool-id ${USER_POOL_ID} --region eu-north-1 --query 'UserPool.LambdaConfig'

# Check Advanced Security
aws cognito-idp describe-user-pool --user-pool-id ${USER_POOL_ID} --region eu-north-1 --query 'UserPool.UserPoolAddOns'

# Check Lambda logs
aws logs tail /aws/lambda/localstays-staging-custom-email-sender --follow --region eu-north-1
```

### API returns 403?

```bash
# Check authorizer
aws apigateway get-authorizers --rest-api-id <API_ID> --region eu-north-1

# Test with valid JWT
curl -H "Authorization: Bearer <JWT>" ${API_ENDPOINT}api/v1/hosts/<HOST_ID>/profile
```

### Stack deployment failed?

```bash
# Check CloudFormation events
aws cloudformation describe-stack-events \
  --stack-name localstays-staging-<stack-name> \
  --region eu-north-1 \
  --max-items 10

# Continue rollback if stuck
aws cloudformation continue-update-rollback \
  --stack-name localstays-staging-<stack-name> \
  --region eu-north-1
```

---

## 📞 Need Help?

See full documentation: `STAGING_DEPLOYMENT_MASTER_PLAN.md`

---

**Deployment Time:** 45-60 minutes
**Cost:** ~$10-15/month
**Region:** eu-north-1
**Account:** 041608526793


