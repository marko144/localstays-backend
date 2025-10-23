# Localstays Backend Deployment Guide

## Overview
This guide covers the complete deployment process for the Localstays backend infrastructure, including manual post-deployment steps required for Cognito configuration.

---

## Prerequisites

1. **AWS CLI** configured with credentials
2. **Node.js 18+** and npm installed
3. **AWS CDK** installed globally: `npm install -g aws-cdk`
4. **SendGrid API Key** ready

---

## Initial Setup (First Time Only)

### 1. Install Dependencies

```bash
# Install root dependencies (CDK)
npm install

# Install Lambda dependencies
cd backend
npm install
cd ..
```

### 2. Bootstrap CDK (First Time Only)

```bash
npx cdk bootstrap aws://ACCOUNT-ID/eu-north-1
```

---

## Deployment Steps

### Step 1: Build the Project

```bash
npm run build
```

This compiles both the CDK infrastructure and Lambda functions.

### Step 2: Deploy CDK Stacks

For **existing User Pool** (current setup):
```bash
npx cdk deploy --all -c userPoolId=eu-north-1_BtUJVZhtP --require-approval never
```

This deploys:
- ✅ **ParamsStack** - SSM Parameter for SendGrid API key
- ✅ **DataStack** - DynamoDB table (`localstays-dev`)
- ✅ **AuthTriggerStack** - Lambda functions (PreSignUp, PostConfirmation, CustomEmailSender)

### Step 3: Configure SendGrid API Key

After deployment, set the SendGrid API key in SSM Parameter Store:

```bash
aws ssm put-parameter \
  --name /localstays/dev/sendgrid \
  --value "YOUR_SENDGRID_API_KEY_HERE" \
  --type SecureString \
  --overwrite \
  --region eu-north-1
```

---

## 🚨 CRITICAL: Manual Post-Deployment Steps

After CDK deployment, you **MUST** manually configure the Cognito User Pool. AWS CDK cannot attach Lambda triggers directly due to circular dependency issues with KMS encryption.

### Step 4: Attach Lambda Triggers and Configure User Pool

Run this **SINGLE COMMAND** with ALL settings to avoid AWS clearing configurations:

```bash
aws cognito-idp update-user-pool \
  --user-pool-id eu-north-1_BtUJVZhtP \
  --lambda-config '{
    "PreSignUp":"arn:aws:lambda:eu-north-1:041608526793:function:localstays-dev-pre-signup",
    "PostConfirmation":"arn:aws:lambda:eu-north-1:041608526793:function:localstays-dev-post-confirmation",
    "CustomEmailSender":{
      "LambdaVersion":"V1_0",
      "LambdaArn":"arn:aws:lambda:eu-north-1:041608526793:function:localstays-dev-custom-email-sender"
    },
    "KMSKeyID":"arn:aws:kms:eu-north-1:041608526793:key/0b4ab7aa-d352-4fa8-8444-c53d1aaa7cc9"
  }' \
  --user-pool-add-ons AdvancedSecurityMode=ENFORCED \
  --auto-verified-attributes email \
  --region eu-north-1
```

⚠️ **IMPORTANT**: You MUST include ALL three settings in one command:
- `--lambda-config` (all triggers + KMS key)
- `--user-pool-add-ons` (Advanced Security - required for Custom Email Sender)
- `--auto-verified-attributes` (email verification)

**Why?** AWS Cognito's `update-user-pool` command **silently clears** any setting you don't explicitly include. Running separate commands will break your configuration!

### Step 5: Verify Configuration

Check that everything is configured correctly:

```bash
aws cognito-idp describe-user-pool \
  --user-pool-id eu-north-1_BtUJVZhtP \
  --region eu-north-1 \
  --query 'UserPool.{LambdaConfig:LambdaConfig,UserPoolAddOns:UserPoolAddOns,AutoVerify:AutoVerifiedAttributes}' \
  --output json
```

Expected output:
```json
{
  "LambdaConfig": {
    "PreSignUp": "arn:aws:lambda:...:function:localstays-dev-pre-signup",
    "PostConfirmation": "arn:aws:lambda:...:function:localstays-dev-post-confirmation",
    "CustomEmailSender": {
      "LambdaVersion": "V1_0",
      "LambdaArn": "arn:aws:lambda:...:function:localstays-dev-custom-email-sender"
    },
    "KMSKeyID": "arn:aws:kms:...:key/..."
  },
  "UserPoolAddOns": {
    "AdvancedSecurityMode": "ENFORCED"
  },
  "AutoVerify": ["email"]
}
```

---

## Lambda Functions Overview

### 1. PreSignUp Lambda
- **Trigger**: Before user is created
- **Purpose**: 
  - Captures custom attributes (consent data)
  - Stores temporary consent record in DynamoDB
- **Custom Attributes Used**:
  - `custom:termsAccepted` (required)
  - `custom:termsAcceptedAt`
  - `custom:marketingOptIn` (optional)
  - `custom:marketingOptInAt`

### 2. CustomEmailSender Lambda
- **Trigger**: When verification email needs to be sent
- **Purpose**:
  - Decrypts verification code using KMS
  - Retrieves consent data from DynamoDB
  - Updates user record with consent info
  - Sends custom verification email via SendGrid
- **Requires**: Advanced Security Mode (Premium tier)

### 3. PostConfirmation Lambda
- **Trigger**: After user confirms their email
- **Purpose**: 
  - Automatically assigns user to `HOST` group
- **IAM Permission**: `cognito-idp:AdminAddUserToGroup`

---

## Environment Variables

Lambda functions use these environment variables (set by CDK):

| Variable | Value | Used By |
|----------|-------|---------|
| `TABLE_NAME` | `localstays-dev` | PreSignUp, CustomEmailSender |
| `USER_POOL_ID` | `eu-north-1_BtUJVZhtP` | PostConfirmation |
| `SENDGRID_PARAM` | `/localstays/dev/sendgrid` | CustomEmailSender |
| `FROM_EMAIL` | `marko@localstays.me` | CustomEmailSender |
| `VERIFY_URL_BASE` | `http://localhost:3000/en/verify` | CustomEmailSender |
| `RESET_PASSWORD_URL_BASE` | `http://localhost:3000/en/reset-password` | CustomEmailSender |
| `KMS_KEY_ARN` | `arn:aws:kms:...` | CustomEmailSender |

---

## Cognito Groups

Two groups are automatically created by CDK:

| Group | Precedence | Description | Auto-Assigned |
|-------|------------|-------------|---------------|
| `HOST` | 10 | Property hosts | ✅ Yes (PostConfirmation) |
| `ADMIN` | 5 | System admins | ❌ No (manual) |

### Manually Assign User to ADMIN Group

```bash
aws cognito-idp admin-add-user-to-group \
  --user-pool-id eu-north-1_BtUJVZhtP \
  --username <email-or-username> \
  --group-name ADMIN \
  --region eu-north-1
```

---

## Updating Lambda Functions

When you update Lambda code:

```bash
# 1. Build
npm run build

# 2. Deploy only the auth trigger stack
npx cdk deploy LocalstaysDevAuthTriggerStack \
  -c userPoolId=eu-north-1_BtUJVZhtP \
  --require-approval never
```

⚠️ **IMPORTANT**: After deploying Lambda updates, you **MUST** re-run Step 4 above to re-attach the Lambda triggers, otherwise AWS will clear them!

---

## Testing

### Test Signup Flow

1. Sign up from frontend with custom attributes
2. Check PreSignUp Lambda logs:
   ```bash
   aws logs tail /aws/lambda/localstays-dev-pre-signup --since 5m --region eu-north-1
   ```
3. Check CustomEmailSender Lambda logs:
   ```bash
   aws logs tail /aws/lambda/localstays-dev-custom-email-sender --since 5m --region eu-north-1
   ```
4. Verify email should arrive via SendGrid
5. After user confirms email, check PostConfirmation logs:
   ```bash
   aws logs tail /aws/lambda/localstays-dev-post-confirmation --since 5m --region eu-north-1
   ```
6. Verify user is in HOST group:
   ```bash
   aws cognito-idp admin-list-groups-for-user \
     --user-pool-id eu-north-1_BtUJVZhtP \
     --username <username> \
     --region eu-north-1
   ```

---

## Troubleshooting

### No Verification Email Sent

**Check 1**: Lambda triggers attached?
```bash
aws cognito-idp describe-user-pool \
  --user-pool-id eu-north-1_BtUJVZhtP \
  --query 'UserPool.LambdaConfig' \
  --region eu-north-1
```

**Check 2**: Advanced Security enabled?
```bash
aws cognito-idp describe-user-pool \
  --user-pool-id eu-north-1_BtUJVZhtP \
  --query 'UserPool.UserPoolAddOns' \
  --region eu-north-1
```

**Check 3**: Auto-verify enabled?
```bash
aws cognito-idp describe-user-pool \
  --user-pool-id eu-north-1_BtUJVZhtP \
  --query 'UserPool.AutoVerifiedAttributes' \
  --region eu-north-1
```

**Fix**: Re-run the combined command from Step 4.

### Lambda Permission Errors

Ensure Lambda has permission to be invoked by Cognito:
```bash
aws lambda get-policy \
  --function-name localstays-dev-custom-email-sender \
  --region eu-north-1
```

Should show a statement with source ARN matching your User Pool.

---

## Cost Considerations

- **DynamoDB**: Pay-per-request (on-demand) - very low for dev
- **Lambda**: Free tier covers most dev usage
- **Cognito Premium**: Required for Custom Email Sender
  - ~$0.05 per MAU (Monthly Active User)
  - Advanced Security Features included
- **KMS**: ~$1/month per key + $0.03 per 10,000 requests
- **SendGrid**: Free tier (100 emails/day) or paid plan

---

## Clean Up

To destroy all infrastructure:

```bash
# Delete all stacks
npx cdk destroy --all

# Note: User Pool eu-north-1_BtUJVZhtP is NOT managed by CDK
# Delete manually if needed via AWS Console
```

---

## Support

For issues or questions, check:
- CloudWatch Logs for Lambda errors
- AWS Console > Cognito > User Pool > Triggers tab
- DynamoDB table for stored consent data

---

## Deployment Checklist

- [ ] Dependencies installed (`npm install` in root and `/backend`)
- [ ] Project built (`npm run build`)
- [ ] CDK stacks deployed (`npx cdk deploy --all`)
- [ ] SendGrid API key set in SSM Parameter Store
- [ ] **Lambda triggers attached to Cognito User Pool** ⚠️
- [ ] **Advanced Security Mode enabled** ⚠️
- [ ] **Auto-verified attributes set to email** ⚠️
- [ ] Configuration verified via CLI
- [ ] Test signup completed successfully
- [ ] Verification email received via SendGrid
- [ ] User auto-assigned to HOST group after confirmation

