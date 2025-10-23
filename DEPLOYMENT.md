# Localstays Backend - Quick Deployment Guide

## Prerequisites ✅

- [x] AWS CLI configured with credentials
- [x] Node.js 18.x or later installed
- [x] Cognito User Pool ID: `eu-north-1_NhDbGTVZd`
- [x] SendGrid account (for API key)

## Deployment Steps

### 1. Set SendGrid API Key

**Before deploying**, set your SendGrid API key:

```bash
aws ssm put-parameter \
  --name "/localstays/dev/sendgrid" \
  --type SecureString \
  --value "SG.your-sendgrid-api-key-here" \
  --region eu-north-1
```

**Don't have a SendGrid key yet?**

- Sign up: https://sendgrid.com (free tier available)
- Create API Key: Settings → API Keys → Create API Key
- Enable "Mail Send" permission

### 2. Bootstrap CDK (First-time only)

```bash
npx cdk bootstrap --region eu-north-1
```

### 3. Deploy All Stacks

```bash
npx cdk deploy --all -c userPoolId=eu-north-1_NhDbGTVZd
```

This will deploy:

1. **LocalstaysDevParamsStack** - SSM parameters
2. **LocalstaysDevDataStack** - DynamoDB table
3. **LocalstaysDevAuthTriggerStack** - Lambda + KMS key

Review changes and confirm when prompted.

### 4. Attach Custom Email Sender Trigger

After deployment completes, CDK will output a command. Run it:

```bash
aws cognito-idp update-user-pool \
  --user-pool-id eu-north-1_NhDbGTVZd \
  --lambda-config "CustomEmailSender={LambdaVersion=V1_0,LambdaArn=arn:aws:lambda:eu-north-1:YOUR-ACCOUNT:function:localstays-dev-custom-email-sender}" \
  --region eu-north-1
```

**Or attach via AWS Console:**

1. Go to: Cognito → User Pools → eu-north-1_NhDbGTVZd
2. User pool properties → Lambda triggers
3. Custom email sender trigger → Choose Lambda function
4. Select: `localstays-dev-custom-email-sender`
5. Save

### 5. Verify Deployment

Check resources were created:

```bash
# Check DynamoDB table
aws dynamodb describe-table --table-name localstays-dev --region eu-north-1

# Check Lambda function
aws lambda get-function --function-name localstays-dev-custom-email-sender --region eu-north-1

# Check SSM parameter
aws ssm get-parameter --name "/localstays/dev/sendgrid" --region eu-north-1
```

## Testing

### Test Signup Flow

1. Use Cognito SDK to sign up a new user
2. Check email for verification link
3. User clicks link: `http://localhost:3000/verify?username=...&code=...`
4. Frontend calls `confirmSignUp()` with username and code

### View Lambda Logs

```bash
# Real-time logs
aws logs tail /aws/lambda/localstays-dev-custom-email-sender --follow --region eu-north-1

# Recent logs
aws logs tail /aws/lambda/localstays-dev-custom-email-sender --since 1h --region eu-north-1
```

## Stack Outputs

After deployment, you'll see:

- **SendGridParamName**: `/localstays/dev/sendgrid`
- **TableName**: `localstays-dev`
- **CustomEmailSenderLambdaName**: `localstays-dev-custom-email-sender`
- **KmsKeyId**: Key for Cognito encryption
- **AttachTriggerCommand**: AWS CLI command to attach trigger

## Updating

### Update SendGrid API Key

```bash
aws ssm put-parameter \
  --name "/localstays/dev/sendgrid" \
  --type SecureString \
  --value "SG.new-key-here" \
  --overwrite \
  --region eu-north-1
```

### Redeploy Lambda Only

```bash
npx cdk deploy LocalstaysDevAuthTriggerStack -c userPoolId=eu-north-1_NhDbGTVZd
```

### Update Environment Variables

Edit `infra/lib/auth-trigger-stack.ts`, then:

```bash
npm run build
npx cdk deploy LocalstaysDevAuthTriggerStack -c userPoolId=eu-north-1_NhDbGTVZd
```

## Cleanup

**⚠️ Warning: This deletes all data!**

```bash
npx cdk destroy --all -c userPoolId=eu-north-1_NhDbGTVZd
```

## Troubleshooting

### Issue: Email not sending

1. Verify SendGrid key:

   ```bash
   aws ssm get-parameter --name "/localstays/dev/sendgrid" --with-decryption --region eu-north-1
   ```

2. Check Lambda logs for errors

3. Verify SendGrid key has "Mail Send" permission

### Issue: Trigger not firing

Check if trigger is attached:

```bash
aws cognito-idp describe-user-pool \
  --user-pool-id eu-north-1_NhDbGTVZd \
  --region eu-north-1 \
  --query 'UserPool.LambdaConfig.CustomEmailSender'
```

If empty, run the attach command from Step 4.

## Cost Estimate (Development)

- **DynamoDB**: ~$0 (free tier: 25 GB storage, 25 WCU, 25 RCU)
- **Lambda**: ~$0 (free tier: 1M requests/month)
- **KMS**: ~$1/month (CMK)
- **CloudWatch Logs**: ~$0 (low volume)
- **SSM Parameter Store**: $0 (standard params free)

**Total: ~$1-2/month for dev**

## Next Steps

1. ✅ Deploy infrastructure
2. ✅ Attach Cognito trigger
3. 🔄 Test signup flow
4. 🔄 Build frontend verification page
5. 🔄 Implement sign-in flow (Phase 2)

---

For detailed information, see [README.md](./README.md)
