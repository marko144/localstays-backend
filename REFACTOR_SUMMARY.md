# Infrastructure Refactor Summary - dev1 Environment

## Overview

This document tracks the infrastructure refactoring to support multiple environments (dev, dev1, staging, prod) with proper dependency management and no circular dependencies.

## Changes Made

### 1. ✅ Environment Configuration (`cdk.json`)

- Added `environments` context with support for: `dev`, `dev1`, `staging`, `prod`
- Each environment has: `account`, `region`, `stage`

### 2. ✅ New KmsStack (`infra/lib/kms-stack.ts`)

**Why**: Break circular dependency between CognitoStack and AuthTriggerStack

- Created standalone stack for KMS key
- Both Cognito and AuthTrigger can now depend on KmsStack independently
- Environment-specific key alias: `localstays/{stage}/cognito-custom-sender`
- Prod-safe removal policy (RETAIN for prod, DESTROY for dev/staging)

### 3. ✅ Updated CognitoStack (`infra/lib/cognito-stack.ts`)

- Added `stage` parameter
- User Pool name: `localstays-{stage}-users`
- Client name: `localstays-{stage}-web-client`
- Environment-specific export names: `Localstays{Stage}UserPoolId`, etc.
- Advanced Security Mode set to AUDIT (free tier)
- Prod-safe deletion protection

### 4. ✅ Updated AuthTriggerStack (`infra/lib/auth-trigger-stack.ts`)

- Added `stage` parameter
- **Removed KMS key creation** (now uses KmsStack)
- All Lambda names: `localstays-{stage}-{function-name}`
- All CloudWatch log groups: `/aws/lambda/localstays-{stage}-{function-name}`
- Environment-specific export names
- Gets User Pool ID and ARN from CognitoStack (no more manual context parameter)

### 5. 🔄 DataStack, StorageStack, ParamsStack (IN PROGRESS)

Need to add `stage` parameter and update names

### 6. 🔄 Main Orchestration (`infra/bin/infra.ts`) (PENDING)

New stack order:

```
1. ParamsStack (independent)
2. DataStack (independent)
3. StorageStack (independent)
4. KmsStack (independent) ← NEW
5. CognitoStack (depends on KmsStack)
6. AuthTriggerStack (depends on all above)
```

## New Deployment Flow

### For dev1 Environment:

```bash
# 1. Build
npm run build

# 2. Deploy all stacks (with environment context)
npx cdk deploy --all -c env=dev1

# 3. Copy SendGrid key (automated script)
./scripts/copy-sendgrid-key.sh dev dev1

# 4. Attach Cognito triggers (one-time manual step)
# Script will output the exact command with ARNs

# 5. Enable Advanced Security (after upgrading to Plus tier)
aws cognito-idp update-user-pool \
  --user-pool-id <NEW_POOL_ID> \
  --user-pool-add-ons AdvancedSecurityMode=ENFORCED \
  --region eu-north-1

# 6. Seed database
npm run seed
```

## Stack Outputs (dev1)

After deployment, you'll get these key values for frontend config:

```json
{
  "userPoolId": "eu-north-1_XXXXXXX",
  "userPoolClientId": "xxxxx",
  "region": "eu-north-1"
}
```

## Frontend Configuration Changes

Update your frontend config:

```typescript
// OLD (dev)
COGNITO_USER_POOL_ID=eu-north-1_BtUJVZhtP
COGNITO_CLIENT_ID=<old_client_id>

// NEW (dev1)
COGNITO_USER_POOL_ID=<from_CDK_output>
COGNITO_CLIENT_ID=<from_CDK_output>
```

## Breaking Changes

### For Existing Environments

- Export names changed from `LocalstaysDevX` to `Localstays{Stage}X`
- Lambda function names changed from `localstays-dev-X` to `localstays-{stage}-X`
- KMS key moved to separate stack

### Migration Path (if updating existing dev)

1. Deploy new stacks with `-c env=dev`
2. Manually migrate User Pool ID references
3. Update frontend config
4. Test thoroughly before switching

## Benefits

✅ **No Circular Dependencies**: KmsStack breaks the cycle
✅ **Multi-Environment Support**: Easy to create staging, prod
✅ **Consistent Naming**: All resources use `{stage}` variable
✅ **CloudFormation Exports**: Stacks can reference each other cleanly
✅ **Prod-Safe**: Different removal policies for prod vs dev
✅ **Delta Deployments**: CDK only deploys changed stacks

## Next Steps

### Still TODO:

- [ ] Update DataStack, StorageStack, ParamsStack with stage parameter
- [ ] Update infra.ts with new stack ordering
- [ ] Create deployment helper scripts
- [ ] Create unified DEPLOYMENT.md
- [ ] Test full deployment to dev1
- [ ] Generate frontend config JSON

## Cognito Advanced Security Note

**Important**: CustomEmailSender trigger requires Advanced Security Mode, which requires Cognito Plus tier (~$0.05/MAU).

**Current State**:

- CDK deploys with `AUDIT` mode (free tier, logs threats only)
- CustomEmailSender may not work until upgraded to `ENFORCED`

**After Upgrading in Console**:

```bash
aws cognito-idp update-user-pool \
  --user-pool-id <POOL_ID> \
  --user-pool-add-ons AdvancedSecurityMode=ENFORCED \
  --region eu-north-1
```

This is documented in DEPLOYMENT.md with cost implications.

## Questions Answered

**Q: How do we handle future updates?**
A: CDK is smart about deltas. Use `npx cdk deploy --all` and it only deploys changed stacks.

**Q: Do we deploy everything every time?**
A: No. Use `npx cdk deploy <StackName>` for targeted deployments, or `--all` and CDK shows "(no changes)" for unchanged stacks.

**Q: What about the SendGrid API key?**
A: Script will copy from existing environment. Stored in SSM Parameter Store at `/localstays/{env}/sendgrid`.

**Q: Will we manually upgrade Cognito security?**
A: Yes, one-time after upgrading account to Plus tier. Documented in deployment guide with exact command.
