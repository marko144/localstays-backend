# Localstays Backend Infrastructure

AWS serverless backend for the Localstays platform, built with AWS CDK (TypeScript).

## 🏗️ Architecture Overview

**Phase 1: Signup + Custom Email Verification via Cognito Trigger**

### Tech Stack

- **IaC**: AWS CDK v2 (TypeScript)
- **Runtime**: Node.js 18.x Lambda
- **Auth**: AWS Cognito User Pool (existing)
- **Database**: DynamoDB (single table design)
- **Email**: SendGrid API (no SES)
- **Config/Secrets**: SSM Parameter Store (SecureString)
- **Region**: eu-north-1 (Europe Stockholm)

### Verification Pattern (Pattern A)

Cognito generates and manages verification codes and expiry. We bypass SES by using the Custom Email Sender trigger to send custom emails through SendGrid. The email contains a verification link with username & code. The frontend calls `ConfirmSignUp(username, code)` with the Cognito SDK.

### Components

#### 1. **ParamsStack** - Configuration & Secrets

- SSM Parameter: `/localstays/dev/sendgrid` (SecureString)
- Stores SendGrid API key securely

#### 2. **DataStack** - DynamoDB Database

- Table: `localstays-dev`
- Keys: `pk` (partition key), `sk` (sort key)
- Features:
  - Point-in-time recovery (PITR) enabled
  - TTL attribute: `ttl` (future-proof)
  - DynamoDB Streams enabled (NEW_AND_OLD_IMAGES)
  - RemovalPolicy: DESTROY (dev only)

#### 3. **AuthTriggerStack** - Cognito Custom Email Sender

- Lambda: `localstays-dev-custom-email-sender`
- KMS Key: For Cognito advanced security (required)
- Triggers:
  - `CustomEmailSender_SignUp`: Initial signup verification
  - `CustomEmailSender_ResendCode`: Resend verification code

**Lambda Behavior:**

1. Loads SendGrid API key from SSM (cached)
2. Upserts User record to DynamoDB: `pk=USER#<sub>`, `sk=PROFILE`
3. Builds verification link: `http://localhost:3000/verify?username=<u>&code=<c>`
4. Sends custom verification email via SendGrid
5. Returns event unchanged to Cognito

**IAM Permissions (Least Privilege):**

- `ssm:GetParameter` on `/localstays/dev/sendgrid`
- `dynamodb:PutItem` and `dynamodb:UpdateItem` on `localstays-dev`
- `kms:Decrypt` on Cognito KMS key
- CloudWatch Logs write access

## 📋 Prerequisites

### 1. AWS CLI Configuration

You need AWS credentials configured before deploying.

```bash
# Configure AWS CLI with your IAM user credentials
aws configure

# When prompted, enter:
# - AWS Access Key ID: <your-access-key>
# - AWS Secret Access Key: <your-secret-key>
# - Default region: eu-north-1
# - Default output format: json
```

**Creating IAM User (if needed):**

1. Log into AWS Console as admin/root
2. Navigate to: IAM → Users → Create user
3. Username: `localstays-dev-admin` (or your preference)
4. Attach policy: `AdministratorAccess`
5. After creation: Security credentials → Create access key
6. Choose "Command Line Interface (CLI)"
7. Download credentials and use in `aws configure`

### 2. Verify AWS CLI Setup

```bash
# Confirm your AWS identity
aws sts get-caller-identity

# Should output your account ID and user info
```

### 3. Node.js and npm

Ensure you have Node.js 18.x or later installed:

```bash
node --version  # Should be v18.x or higher
npm --version
```

## 🚀 Getting Started

### Quick Start (Automated)

For a fully automated deployment, use the provided script:

```bash
# Make sure you've set your SendGrid API key first, then run:
./QUICK_START.sh
```

This script will:

1. Check prerequisites
2. Bootstrap CDK if needed
3. Build the project
4. Deploy all stacks
5. Attach the Cognito trigger automatically

### Manual Deployment (Step-by-Step)

If you prefer manual control, follow these steps:

### Step 1: Install Dependencies

```bash
# Install root (infrastructure) dependencies
npm install

# Install backend (Lambda) dependencies
cd backend
npm install
cd ..
```

### Step 2: Set SendGrid API Key

Before deploying, you need to set your SendGrid API key in SSM Parameter Store.

**Option A: Set now (recommended if you have the key)**

```bash
aws ssm put-parameter \
  --name "/localstays/dev/sendgrid" \
  --type SecureString \
  --value "SG.your-actual-sendgrid-api-key-here" \
  --region eu-north-1
```

**Option B: Deploy first, then set the key**
The stack will deploy with a placeholder value. Update it before testing:

```bash
aws ssm put-parameter \
  --name "/localstays/dev/sendgrid" \
  --type SecureString \
  --value "SG.your-actual-sendgrid-api-key-here" \
  --overwrite \
  --region eu-north-1
```

**Getting a SendGrid API Key:**

1. Sign up at https://sendgrid.com (free tier available)
2. Navigate to: Settings → API Keys → Create API Key
3. Choose "Restricted Access" and enable "Mail Send" permission
4. Copy the key (starts with `SG.`)

### Step 3: Bootstrap CDK (First-time only)

If this is your first time using CDK in this AWS account/region:

```bash
npx cdk bootstrap --region eu-north-1
```

This creates an S3 bucket and other resources needed for CDK deployments.

### Step 4: Build the Project

```bash
# Build infrastructure and Lambda code
npm run build
```

### Step 5: Synthesize CloudFormation Templates (Optional)

Preview what will be deployed:

```bash
npx cdk synth -c userPoolId=eu-north-1_NhDbGTVZd
```

### Step 6: Deploy

Deploy all stacks:

```bash
npx cdk deploy --all -c userPoolId=eu-north-1_NhDbGTVZd
```

**Note:** Replace `eu-north-1_NhDbGTVZd` with your actual Cognito User Pool ID if different.

The deployment will:

1. Create SSM parameter for SendGrid API key
2. Create DynamoDB table `localstays-dev`
3. Deploy Custom Email Sender Lambda
4. Create KMS key for Cognito encryption
5. Grant necessary IAM permissions

### Step 7: Attach Custom Email Sender Trigger

After deployment, CDK will output a command to attach the trigger. Run it:

```bash
# The command will look like this (use the exact output from CDK):
aws cognito-idp update-user-pool \
  --user-pool-id eu-north-1_NhDbGTVZd \
  --lambda-config "CustomEmailSender={LambdaVersion=V1_0,LambdaArn=arn:aws:lambda:eu-north-1:ACCOUNT:function:localstays-dev-custom-email-sender}" \
  --region eu-north-1
```

Alternatively, you can attach it via AWS Console:

1. Navigate to: Cognito → User Pools → Your Pool
2. User pool properties → Lambda triggers
3. Custom email sender trigger → Choose Lambda function
4. Select: `localstays-dev-custom-email-sender`
5. Save changes

## 📁 Project Structure

```
.
├── README.md                           # This file
├── package.json                        # Root dependencies (CDK)
├── tsconfig.json                       # TypeScript config for infrastructure
├── cdk.json                            # CDK configuration
├── .gitignore                          # Git ignore rules
│
├── infra/                              # CDK Infrastructure code
│   ├── bin/
│   │   └── infra.ts                    # CDK app entry point
│   └── lib/
│       ├── params-stack.ts             # SSM Parameter Store stack
│       ├── data-stack.ts               # DynamoDB table stack
│       └── auth-trigger-stack.ts       # Custom Email Sender Lambda + Cognito trigger
│
└── backend/                            # Lambda functions
    ├── package.json                    # Backend dependencies
    ├── tsconfig.json                   # TypeScript config for Lambda
    └── services/
        └── auth/
            └── cognito-custom-email-sender.ts  # Custom Email Sender Lambda
```

## 🔧 Configuration

### Environment Variables (Lambda)

The Custom Email Sender Lambda uses these environment variables (set by CDK):

| Variable          | Value                             | Description               |
| ----------------- | --------------------------------- | ------------------------- |
| `TABLE_NAME`      | `localstays-dev`                  | DynamoDB table name       |
| `VERIFY_URL_BASE` | `http://localhost:3000/en/verify` | Frontend verification URL |
| `SENDGRID_PARAM`  | `/localstays/dev/sendgrid`        | SSM parameter path        |
| `FROM_EMAIL`      | `marko@localstays.me`             | Email sender address      |

**Changing the Verify URL:**

For production or different environments, you can update the `VERIFY_URL_BASE` in two ways:

1. **Edit CDK code** (`infra/lib/auth-trigger-stack.ts`):

   ```typescript
   environment: {
     VERIFY_URL_BASE: 'https://hosts.localstays.me/verify',  // Change this
     // ...
   }
   ```

   Then redeploy: `npx cdk deploy LocalstaysDevAuthTriggerStack -c userPoolId=...`

2. **Update directly in AWS Console** (no redeploy needed):
   - Lambda → Functions → `localstays-dev-custom-email-sender`
   - Configuration → Environment variables
   - Edit `VERIFY_URL_BASE`

### DynamoDB Schema

#### User Profile Record

```
pk: "USER#<cognito-sub>"
sk: "PROFILE"
sub: "<cognito-sub>"
email: "user@example.com"
createdAt: "2025-10-23T10:30:00.000Z"
updatedAt: "2025-10-23T10:30:00.000Z"
isDeleted: false
```

## 🧪 Testing

### Test Signup Flow

1. **Start your frontend** (on `http://localhost:3000`)

2. **Initiate signup** via Cognito SDK:

   ```javascript
   import {
     CognitoIdentityProviderClient,
     SignUpCommand,
   } from "@aws-sdk/client-cognito-identity-provider";

   const client = new CognitoIdentityProviderClient({ region: "eu-north-1" });

   await client.send(
     new SignUpCommand({
       ClientId: "your-app-client-id",
       Username: "user@example.com",
       Password: "SecurePass123!",
       UserAttributes: [{ Name: "email", Value: "user@example.com" }],
     })
   );
   ```

3. **Check email** - User receives verification email with link:

   ```
   http://localhost:3000/verify?username=user@example.com&code=123456
   ```

4. **Verify email** - Frontend extracts params and calls:

   ```javascript
   import {
     CognitoIdentityProviderClient,
     ConfirmSignUpCommand,
   } from "@aws-sdk/client-cognito-identity-provider";

   await client.send(
     new ConfirmSignUpCommand({
       ClientId: "your-app-client-id",
       Username: "user@example.com",
       ConfirmationCode: "123456",
     })
   );
   ```

5. **Check DynamoDB** - User record should exist:
   ```bash
   aws dynamodb get-item \
     --table-name localstays-dev \
     --key '{"pk":{"S":"USER#<sub>"},"sk":{"S":"PROFILE"}}' \
     --region eu-north-1
   ```

### View Lambda Logs

```bash
# Tail Lambda logs in real-time
aws logs tail /aws/lambda/localstays-dev-custom-email-sender --follow --region eu-north-1

# View recent logs
aws logs tail /aws/lambda/localstays-dev-custom-email-sender --since 1h --region eu-north-1
```

### Test SendGrid Configuration

```bash
# Verify SSM parameter exists
aws ssm get-parameter \
  --name "/localstays/dev/sendgrid" \
  --with-decryption \
  --region eu-north-1
```

## 🔄 Common Operations

### Update SendGrid API Key

```bash
aws ssm put-parameter \
  --name "/localstays/dev/sendgrid" \
  --type SecureString \
  --value "SG.new-api-key-here" \
  --overwrite \
  --region eu-north-1
```

The Lambda will pick up the new key on the next cold start (or restart it manually).

### Redeploy Lambda Only

```bash
npx cdk deploy LocalstaysDevAuthTriggerStack -c userPoolId=eu-north-1_NhDbGTVZd
```

### Update User Pool ID

If your User Pool ID changes, redeploy with the new context:

```bash
npx cdk deploy --all -c userPoolId=<new-pool-id>
```

Then re-run the attach trigger command with the new pool ID.

### View Stack Outputs

```bash
aws cloudformation describe-stacks \
  --stack-name localstays-dev-auth-triggers \
  --query 'Stacks[0].Outputs' \
  --region eu-north-1
```

### Destroy Stacks (Cleanup)

**⚠️ Warning: This will delete all resources including the DynamoDB table and data!**

```bash
npx cdk destroy --all -c userPoolId=eu-north-1_NhDbGTVZd
```

Or destroy individual stacks:

```bash
npx cdk destroy LocalstaysDevAuthTriggerStack -c userPoolId=eu-north-1_NhDbGTVZd
npx cdk destroy LocalstaysDevDataStack
npx cdk destroy LocalstaysDevParamsStack
```

## 🐛 Troubleshooting

### Issue: `User Pool ID is required` error

**Solution:** Pass the User Pool ID via CDK context:

```bash
npx cdk deploy --all -c userPoolId=eu-north-1_NhDbGTVZd
```

### Issue: `Cannot find module` errors during build

**Solution:** Install dependencies in both root and backend:

```bash
npm install
cd backend && npm install && cd ..
npm run build
```

### Issue: Email not sending

**Checklist:**

1. Verify SendGrid API key is set correctly:

   ```bash
   aws ssm get-parameter --name "/localstays/dev/sendgrid" --with-decryption --region eu-north-1
   ```

2. Check Lambda logs for errors:

   ```bash
   aws logs tail /aws/lambda/localstays-dev-custom-email-sender --since 1h --region eu-north-1
   ```

3. Verify SendGrid API key has "Mail Send" permissions

4. Check SendGrid dashboard for sending stats/errors

### Issue: `AccessDenied` when deploying

**Solution:** Ensure your IAM user has `AdministratorAccess` or required permissions:

- CloudFormation full access
- Lambda full access
- DynamoDB full access
- IAM role creation
- SSM Parameter Store write
- KMS key creation
- Cognito read access

### Issue: Custom Email Sender trigger not working

**Solution:** Ensure the trigger is attached:

```bash
aws cognito-idp describe-user-pool \
  --user-pool-id eu-north-1_NhDbGTVZd \
  --region eu-north-1 \
  --query 'UserPool.LambdaConfig.CustomEmailSender'
```

If empty, run the attach command from Step 7.

### Issue: KMS key permissions error

**Solution:** The KMS key policy should allow Cognito. Check:

```bash
aws kms get-key-policy \
  --key-id alias/localstays/dev/cognito-custom-sender \
  --policy-name default \
  --region eu-north-1
```

## 📚 Next Steps

### Phase 2 Features (Future)

- [ ] Sign-in API
- [ ] Password reset flow
- [ ] User profile management
- [ ] Additional DynamoDB entities (hosts, properties, bookings)
- [ ] API Gateway + REST/GraphQL APIs
- [ ] CI/CD pipeline
- [ ] Production environment setup

### Production Readiness Checklist

- [ ] Change `RemovalPolicy` to `RETAIN` for DynamoDB table
- [ ] Enable deletion protection on DynamoDB table
- [ ] Implement proper monitoring and alarms
- [ ] Set up CloudWatch dashboards
- [ ] Configure AWS Backup for DynamoDB
- [ ] Implement rate limiting on signup
- [ ] Add honeypot/CAPTCHA for signup form
- [ ] Use custom domain for email (`no-reply@localstays.me`)
- [ ] Implement proper error handling and retry logic
- [ ] Add integration tests
- [ ] Set up staging environment
- [ ] Implement secrets rotation for SendGrid API key
- [ ] Add CloudTrail for audit logging
- [ ] Enable AWS Config for compliance
- [ ] Set up cost alerts

## 📞 Support

For issues or questions:

1. Check the Troubleshooting section above
2. Review CloudWatch Logs for Lambda errors
3. Check AWS CloudFormation stack events for deployment issues
4. Verify all prerequisites are met

## 📄 License

MIT

---

**Built with ❤️ using AWS CDK**
