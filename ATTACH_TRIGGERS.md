# Attach Cognito Triggers - Manual Steps

## Why Manual?

AWS CDK does not yet support the `PreTokenGeneration` trigger declaratively. It must be attached manually via AWS CLI or Console after the Lambda is deployed.

---

## Prerequisites

- ✅ CDK stacks deployed (`npx cdk deploy --all`)
- ✅ Lambda ARNs available from CDK outputs

---

## Step 1: Get Lambda ARNs

After deploying, CDK will output the Lambda ARNs. You can also retrieve them:

```bash
# Get PreTokenGeneration Lambda ARN
aws cloudformation describe-stacks \
  --stack-name LocalstaysDevAuthTriggerStack \
  --query 'Stacks[0].Outputs[?OutputKey==`PreTokenGenerationLambdaArn`].OutputValue' \
  --output text \
  --region eu-north-1

# Get PostConfirmation Lambda ARN (if not already attached)
aws cloudformation describe-stacks \
  --stack-name LocalstaysDevAuthTriggerStack \
  --query 'Stacks[0].Outputs[?OutputKey==`PostConfirmationLambdaArn`].OutputValue' \
  --output text \
  --region eu-north-1

# Get PreSignUp Lambda ARN (if not already attached)
aws cloudformation describe-stacks \
  --stack-name LocalstaysDevAuthTriggerStack \
  --query 'Stacks[0].Outputs[?OutputKey==`PreSignUpLambdaArn`].OutputValue' \
  --output text \
  --region eu-north-1

# Get CustomEmailSender Lambda ARN (if not already attached)
aws cloudformation describe-stacks \
  --stack-name LocalstaysDevAuthTriggerStack \
  --query 'Stacks[0].Outputs[?OutputKey==`CustomEmailSenderLambdaArn`].OutputValue' \
  --output text \
  --region eu-north-1

# Get KMS Key ARN (for CustomEmailSender)
aws cloudformation describe-stacks \
  --stack-name LocalstaysDevAuthTriggerStack \
  --query 'Stacks[0].Outputs[?OutputKey==`KmsKeyArn`].OutputValue' \
  --output text \
  --region eu-north-1
```

---

## Step 2: Attach All Triggers at Once

**Option A: Attach PreTokenGeneration Only** (if others are already attached)

```bash
aws cognito-idp update-user-pool \
  --user-pool-id eu-north-1_ZKkIbkbWG \
  --lambda-config PreTokenGeneration=<PRE_TOKEN_GENERATION_ARN> \
  --region eu-north-1
```

**Option B: Attach All Triggers** (recommended for complete setup)

```bash
aws cognito-idp update-user-pool \
  --user-pool-id eu-north-1_ZKkIbkbWG \
  --lambda-config \
    PreSignUp=<PRE_SIGNUP_ARN> \
    PostConfirmation=<POST_CONFIRMATION_ARN> \
    PreTokenGeneration=<PRE_TOKEN_GENERATION_ARN> \
    CustomEmailSender=<CUSTOM_EMAIL_SENDER_ARN>,KMSKeyID=<KMS_KEY_ARN> \
  --region eu-north-1
```

**Example with actual ARNs:**

```bash
aws cognito-idp update-user-pool \
  --user-pool-id eu-north-1_ZKkIbkbWG \
  --lambda-config \
    PreSignUp=arn:aws:lambda:eu-north-1:123456789012:function:localstays-dev-pre-signup \
    PostConfirmation=arn:aws:lambda:eu-north-1:123456789012:function:localstays-dev-post-confirmation \
    PreTokenGeneration=arn:aws:lambda:eu-north-1:123456789012:function:localstays-dev-pre-token-generation \
    CustomEmailSender=arn:aws:lambda:eu-north-1:123456789012:function:localstays-dev-custom-email-sender,KMSKeyID=arn:aws:kms:eu-north-1:123456789012:key/abc123... \
  --region eu-north-1
```

---

## Step 3: Verify Triggers

```bash
aws cognito-idp describe-user-pool \
  --user-pool-id eu-north-1_ZKkIbkbWG \
  --region eu-north-1 \
  --query 'UserPool.LambdaConfig'
```

**Expected Output:**

```json
{
  "PreSignUp": "arn:aws:lambda:eu-north-1:...:function:localstays-dev-pre-signup",
  "PostConfirmation": "arn:aws:lambda:eu-north-1:...:function:localstays-dev-post-confirmation",
  "PreTokenGeneration": "arn:aws:lambda:eu-north-1:...:function:localstays-dev-pre-token-generation",
  "CustomEmailSender": {
    "LambdaVersion": "V1_0",
    "LambdaArn": "arn:aws:lambda:eu-north-1:...:function:localstays-dev-custom-email-sender"
  },
  "KMSKeyID": "arn:aws:kms:eu-north-1:...:key/..."
}
```

---

## Step 4: Test Triggers

### Test PreTokenGeneration

1. Log in with an existing user
2. Check CloudWatch Logs for PreTokenGeneration Lambda
3. Decode JWT token and verify custom claims exist:

```bash
# Get access token from login response
ACCESS_TOKEN="<your-access-token>"

# Decode JWT (use jwt.io or a CLI tool)
echo $ACCESS_TOKEN | cut -d '.' -f 2 | base64 -d | jq
```

**Expected Claims:**

```json
{
  "sub": "123e4567-e89b-12d3-a456-426614174000",
  "email": "host@example.com",
  "cognito:groups": ["HOST"],
  "role": "HOST",
  "hostId": "host_123e4567-e89b-12d3-a456-426614174000",
  "permissions": [
    "HOST_LISTING_CREATE",
    "HOST_LISTING_EDIT_DRAFT",
    "HOST_LISTING_SUBMIT_REVIEW",
    "HOST_LISTING_SET_OFFLINE",
    "HOST_LISTING_SET_ONLINE",
    "HOST_LISTING_VIEW_OWN",
    "HOST_LISTING_DELETE",
    "HOST_KYC_SUBMIT"
  ],
  "status": "ACTIVE",
  ...
}
```

### Test PostConfirmation (New User Signup)

1. Sign up a new user via the frontend
2. Confirm email
3. Check CloudWatch Logs for PostConfirmation Lambda
4. Verify DynamoDB entries:

```bash
# Check User record
aws dynamodb get-item \
  --table-name localstays-dev \
  --key '{"pk": {"S": "USER#<cognito-sub>"}, "sk": {"S": "PROFILE"}}' \
  --region eu-north-1

# Check Host record
aws dynamodb get-item \
  --table-name localstays-dev \
  --key '{"pk": {"S": "HOST#<cognito-sub>"}, "sk": {"S": "PROFILE"}}' \
  --region eu-north-1
```

---

## Troubleshooting

### Error: "Lambda does not have permission to be invoked by Cognito"

**Solution:** The CDK stack should have added the invoke permissions. If not, add manually:

```bash
aws lambda add-permission \
  --function-name localstays-dev-pre-token-generation \
  --statement-id CognitoInvoke \
  --action lambda:InvokeFunction \
  --principal cognito-idp.amazonaws.com \
  --source-arn arn:aws:cognito-idp:eu-north-1:123456789012:userpool/eu-north-1_ZKkIbkbWG \
  --region eu-north-1
```

### Error: "User not found in DynamoDB" (PreTokenGeneration)

**Cause:** User signed up before PostConfirmation Lambda was deployed.

**Solution:** Run migration script to backfill user data (see RBAC_IMPLEMENTATION_STATUS.md).

### PreTokenGeneration Not Triggering

**Check:**

1. Trigger is attached: `aws cognito-idp describe-user-pool --user-pool-id eu-north-1_ZKkIbkbWG --query 'UserPool.LambdaConfig.PreTokenGeneration'`
2. Lambda has correct permissions
3. Lambda not timing out (check CloudWatch Logs)

---

## Alternative: AWS Console

If you prefer using the AWS Console:

1. Go to **Cognito** → **User Pools** → `localstays-dev`
2. Go to **User pool properties** → **Lambda triggers**
3. Click **Add Lambda trigger**
4. Select:
   - **Trigger type**: Authentication
   - **Authentication trigger**: Pre token generation
   - **Lambda function**: `localstays-dev-pre-token-generation`
5. Click **Add Lambda trigger**

---

## Notes

- **PreTokenGeneration must be fast** (< 5 seconds). It blocks token issuance.
- **Trigger updates don't require redeployment**. You can detach/reattach anytime.
- **Multiple triggers can be attached at once** using `update-user-pool`.

---

## Related Documentation

- [RBAC_IMPLEMENTATION_STATUS.md](./RBAC_IMPLEMENTATION_STATUS.md) - Implementation status
- [DEPLOYMENT_GUIDE.md](./DEPLOYMENT_GUIDE.md) - Full deployment guide
