# Deploy to dev1 Environment - Complete Guide

## 🎯 What You're About to Deploy

A complete, isolated **dev1** environment with:

- ✅ New Cognito User Pool
- ✅ New DynamoDB table (`localstays-dev1`)
- ✅ New S3 bucket (`localstays-dev1-host-assets`)
- ✅ New Lambda triggers
- ✅ New KMS key
- ✅ Separate SSM parameters

**Your existing `dev` environment will remain untouched.**

---

## 📋 Prerequisites

1. ✅ AWS CLI configured with credentials
2. ✅ Node.js 20+ installed
3. ✅ CDK installed: `npm install -g aws-cdk`
4. ✅ SendGrid API key available (will copy from dev)

---

## 🚀 Deployment Steps

### Step 1: Build the Project

```bash
cd /Users/markobabic/LocalDev/localstays-backend
npm run build
```

**Expected Output**: No errors, both infra and backend compile successfully.

---

### Step 2: Deploy All Stacks to dev1

```bash
npx cdk deploy --all -c env=dev1 --require-approval never
```

**What Happens**:

- Deploys 6 stacks in sequence
- Takes ~10-15 minutes total
- Each stack shows progress

**Stack Order**:

1. `localstays-dev1-params` (SSM Parameters)
2. `localstays-dev1-data` (DynamoDB)
3. `localstays-dev1-storage` (S3)
4. `localstays-dev1-kms` (KMS Keys)
5. `localstays-dev1-cognito` (User Pool) ← **This creates your new User Pool**
6. `localstays-dev1-auth-triggers` (Lambda functions)

**Expected Outputs** (save these):

```
LocalstaysDev1CognitoStack.UserPoolId = eu-north-1_XXXXXXX
LocalstaysDev1CognitoStack.UserPoolClientId = xxxxxxxxxx
LocalstaysDev1CognitoStack.Region = eu-north-1
```

---

### Step 3: Copy SendGrid API Key

```bash
./scripts/copy-sendgrid-key.sh dev dev1
```

**What This Does**:

- Reads API key from `/localstays/dev/sendgrid`
- Writes to `/localstays/dev1/sendgrid`
- Secure (uses AWS SSM encryption)

**Verify**:

```bash
aws ssm get-parameter --name /localstays/dev1/sendgrid --with-decryption --region eu-north-1
```

---

### Step 4: Attach Cognito Triggers (Manual - Required Once)

**Why Manual?** AWS Cognito requires ALL settings in one command to avoid clearing configurations.

Get the exact command from CDK output (it's pre-filled with ARNs):

```bash
aws cloudformation describe-stacks \
  --stack-name localstays-dev1-auth-triggers \
  --query 'Stacks[0].Outputs[?OutputKey==`AttachTriggerCommand`].OutputValue' \
  --output text \
  --region eu-north-1
```

**OR manually construct** (replace `<USER_POOL_ID>` with value from Step 2):

```bash
aws cognito-idp update-user-pool \
  --user-pool-id <USER_POOL_ID> \
  --lambda-config '{
    "PreSignUp":"arn:aws:lambda:eu-north-1:041608526793:function:localstays-dev1-pre-signup",
    "PostConfirmation":"arn:aws:lambda:eu-north-1:041608526793:function:localstays-dev1-post-confirmation",
    "PreTokenGeneration":"arn:aws:lambda:eu-north-1:041608526793:function:localstays-dev1-pre-token-generation",
    "CustomEmailSender":{
      "LambdaVersion":"V1_0",
      "LambdaArn":"arn:aws:lambda:eu-north-1:041608526793:function:localstays-dev1-custom-email-sender"
    },
    "KMSKeyID":"<KMS_KEY_ARN_FROM_KMS_STACK>"
  }' \
  --auto-verified-attributes email \
  --region eu-north-1
```

**Verify Triggers Attached**:

```bash
aws cognito-idp describe-user-pool \
  --user-pool-id <USER_POOL_ID> \
  --region eu-north-1 \
  --query 'UserPool.LambdaConfig'
```

---

### Step 5: Seed Database with Roles

```bash
# Update TABLE_NAME environment variable for dev1
TABLE_NAME=localstays-dev1 npm run seed
```

**What This Seeds**:

- HOST role with 8 permissions
- ADMIN role with admin permissions
- Enum configurations (HOST_STATUS, USER_STATUS, HOST_TYPE)

---

### Step 6: Get Frontend Configuration

```bash
./scripts/get-frontend-config.sh dev1
```

**Output** (save this):

```json
{
  "userPoolId": "eu-north-1_XXXXXXX",
  "clientId": "xxxxxxxxxx",
  "region": "eu-north-1"
}
```

**Update Your Frontend**:

In your frontend `.env` or config file:

```env
COGNITO_USER_POOL_ID=eu-north-1_XXXXXXX
COGNITO_CLIENT_ID=xxxxxxxxxx
COGNITO_REGION=eu-north-1
```

---

## ⚠️ Important: Cognito Advanced Security

### Current State: AUDIT Mode (Free Tier)

Your User Pool is deployed with `AdvancedSecurityMode=AUDIT` which:

- ✅ Works on free tier
- ✅ Logs security threats
- ⚠️ **CustomEmailSender may not trigger** until upgraded to ENFORCED

### Upgrade to ENFORCED Mode (Required for Custom Emails)

1. **Upgrade Cognito to Plus Tier** in AWS Console (costs ~$0.05/MAU)
2. **Enable ENFORCED mode**:

```bash
aws cognito-idp update-user-pool \
  --user-pool-id <USER_POOL_ID> \
  --user-pool-add-ons AdvancedSecurityMode=ENFORCED \
  --region eu-north-1
```

**Verify**:

```bash
aws cognito-idp describe-user-pool \
  --user-pool-id <USER_POOL_ID> \
  --region eu-north-1 \
  --query 'UserPool.UserPoolAddOns'
```

---

## ✅ Testing the Deployment

### Test 1: User Signup Flow

1. **Sign up a new user** via your frontend (pointed to dev1)
2. **Check SendGrid** for verification email
3. **Click verification link**
4. **Check CloudWatch Logs**:
   - `/aws/lambda/localstays-dev1-pre-signup`
   - `/aws/lambda/localstays-dev1-custom-email-sender`
   - `/aws/lambda/localstays-dev1-post-confirmation`
   - `/aws/lambda/localstays-dev1-pre-token-generation`

### Test 2: Verify DynamoDB Records

```bash
# Check User record
aws dynamodb get-item \
  --table-name localstays-dev1 \
  --key '{"pk": {"S": "USER#<cognito-sub>"}, "sk": {"S": "PROFILE"}}' \
  --region eu-north-1

# Check Host record
aws dynamodb scan \
  --table-name localstays-dev1 \
  --filter-expression "begins_with(pk, :pk)" \
  --expression-attribute-values '{":pk":{"S":"HOST#"}}' \
  --limit 1 \
  --region eu-north-1
```

### Test 3: Verify S3 Folder Structure

```bash
aws s3 ls s3://localstays-dev1-host-assets/ --recursive | head -10
```

Should see:

```
host_<uuid>/verification/.keep
host_<uuid>/listings/.keep
```

### Test 4: Check JWT Token

1. Log in with the test user
2. Decode the JWT access token (use jwt.io)
3. Verify custom claims:
   - `role`: "HOST"
   - `hostId`: "host_xxxxxxxx"
   - `hostStatus`: "INCOMPLETE"
   - `permissions`: "[...]" (JSON string)
   - `status`: "ACTIVE"

---

## 🔧 Troubleshooting

### Issue: "No verification email received"

**Check**:

1. SendGrid API key is correct: `aws ssm get-parameter --name /localstays/dev1/sendgrid --with-decryption`
2. Lambda triggers are attached: See Step 4 verification
3. Advanced Security is ENFORCED (see warning above)
4. CloudWatch logs for errors: `/aws/lambda/localstays-dev1-custom-email-sender`

### Issue: "PostConfirmation failed"

**Cause**: Lambda doesn't have DynamoDB/S3/Cognito permissions

**Fix**: Redeploy AuthTriggerStack:

```bash
npx cdk deploy LocalstaysDev1AuthTriggerStack -c env=dev1
```

### Issue: "PreTokenGeneration not adding claims"

**Check**:

1. Trigger is attached (Step 4)
2. User has completed PostConfirmation (check DynamoDB)
3. Role seeding completed (Step 5)

### Issue: "Can't find environment config"

**Error**: `Environment 'dev1' not found in cdk.json`

**Fix**: Check `cdk.json` has `environments.dev1` configured

---

## 📊 Resource Summary

### AWS Resources Created:

| Resource          | Name                                    | Purpose          |
| ----------------- | --------------------------------------- | ---------------- |
| Cognito User Pool | `localstays-dev1-users`                 | Authentication   |
| Cognito Client    | `localstays-dev1-web-client`            | Frontend auth    |
| DynamoDB Table    | `localstays-dev1`                       | Data storage     |
| S3 Bucket         | `localstays-dev1-host-assets`           | File storage     |
| KMS Key           | `localstays/dev1/cognito-custom-sender` | Email encryption |
| Lambda            | `localstays-dev1-pre-signup`            | Consent capture  |
| Lambda            | `localstays-dev1-post-confirmation`     | RBAC init        |
| Lambda            | `localstays-dev1-pre-token-generation`  | JWT claims       |
| Lambda            | `localstays-dev1-custom-email-sender`   | SendGrid emails  |
| SSM Parameter     | `/localstays/dev1/sendgrid`             | API key          |

---

## 🎉 Success Checklist

- [ ] All 6 stacks deployed successfully
- [ ] SendGrid API key copied
- [ ] Cognito triggers attached
- [ ] Database seeded with roles
- [ ] Frontend config updated
- [ ] Test user can sign up
- [ ] Verification email received
- [ ] User record in DynamoDB
- [ ] Host record created
- [ ] S3 folders created
- [ ] JWT contains custom claims

---

## 🔄 Future Updates

### Deploying Code Changes

```bash
# Build
npm run build

# Deploy only changed stacks (CDK is smart about this)
npx cdk deploy --all -c env=dev1
```

### Adding a New Lambda

1. Write Lambda code in `backend/services/`
2. Add to `AuthTriggerStack`
3. Deploy: `npx cdk deploy LocalstaysDev1AuthTriggerStack -c env=dev1`

### Destroying dev1 (if needed)

```bash
npx cdk destroy --all -c env=dev1
```

---

## 📝 Next Steps

1. **Test thoroughly** in dev1 before promoting changes
2. **Document any issues** you encounter
3. **Update frontend** to support environment switching
4. **Consider creating staging** environment next

---

## 💡 Tips

- Use `--all` for most deployments (CDK handles deltas)
- Check CloudWatch logs first when troubleshooting
- Keep dev and dev1 in sync for testing
- Use dev1 for experimental features

---

**Questions?** Check `REFACTOR_SUMMARY.md` for architecture details.
