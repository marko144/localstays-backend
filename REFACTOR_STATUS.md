# Refactor Status - Environment Support Implementation

## ✅ COMPLETED

### 1. Core Infrastructure Files

- ✅ `cdk.json` - Added environment config (dev, dev1, staging, prod)
- ✅ `infra/lib/kms-stack.ts` - Created standalone KMS stack
- ✅ `infra/lib/cognito-stack.ts` - Updated with stage parameter
- ✅ `infra/lib/auth-trigger-stack.ts` - Updated with stage parameter, removed KMS creation
- ✅ `infra/lib/data-stack.ts` - Added stage parameter (partial - needs more updates)

### 2. Documentation

- ✅ `REFACTOR_SUMMARY.md` - Comprehensive overview of changes

## 🔄 IN PROGRESS / NEEDS COMPLETION

### Critical Files That Need Updates:

#### 1. `infra/lib/data-stack.ts`

**Status**: Interface added, tableName updated
**Still Needs**:

- Update exports to use stage variable
- Update tags to use stage variable
- Update removal policy based on stage

#### 2. `infra/lib/storage-stack.ts`

**Status**: Not started
**Needs**:

- Add `StorageStackProps` interface with `stage` parameter
- Update bucket name: `localstays-${stage}-host-assets`
- Update export names to use stage
- Update removal policy based on stage

#### 3. `infra/lib/params-stack.ts`

**Status**: Not started  
**Needs**:

- Add `ParamsStackProps` interface with `stage` parameter
- Update parameter name: `/localstays/${stage}/sendgrid`
- Update export names to use stage

#### 4. `infra/bin/infra.ts` ⚠️ **CRITICAL - MAIN ORCHESTRATION**

**Status**: Not started
**Needs**: Complete rewrite with:

- Read environment from context: `-c env=dev1`
- Get environment config from cdk.json
- Pass stage to ALL stacks
- **New stack order**:
  ```
  1. ParamsStack (pass stage)
  2. DataStack (pass stage)
  3. StorageStack (pass stage)
  4. KmsStack (pass stage)
  5. CognitoStack (pass stage, kmsKey from KmsStack)
  6. AuthTriggerStack (pass stage, all dependencies)
  ```
- Remove userPoolId from context (get from Cognito stack outputs)

### Helper Scripts Needed:

#### 5. `scripts/copy-sendgrid-key.sh`

```bash
#!/bin/bash
# Copy SendGrid API key between environments
SOURCE_ENV=$1
TARGET_ENV=$2

aws ssm get-parameter --name /localstays/$SOURCE_ENV/sendgrid --with-decryption \
  --query 'Parameter.Value' --output text | \
aws ssm put-parameter --name /localstays/$TARGET_ENV/sendgrid \
  --value "$(cat -)" --type SecureString --overwrite
```

#### 6. `scripts/get-frontend-config.sh`

```bash
#!/bin/bash
# Generate frontend config JSON from CDK outputs
ENV=$1

aws cloudformation describe-stacks \
  --stack-name localstays-${ENV}-cognito \
  --query 'Stacks[0].Outputs' \
  --output json | jq '{
    userPoolId: .[] | select(.OutputKey=="UserPoolId") | .OutputValue,
    clientId: .[] | select(.OutputKey=="UserPoolClientId") | .OutputValue,
    region: .[] | select(.OutputKey=="Region") | .OutputValue
  }'
```

## 🚧 BUILD ERRORS TO EXPECT

When you try to build/deploy now, you'll get TypeScript errors because:

1. **`infra/bin/infra.ts`** is still passing old props to stacks
2. **DataStack, StorageStack, ParamsStack** constructors changed but not used correctly yet
3. **KmsStack** import is missing in `infra.ts`

## 📋 RECOMMENDED COMPLETION ORDER

### Phase 1: Finish Stack Updates (30 min)

1. Update `infra/lib/data-stack.ts` (exports, tags, removal policy)
2. Update `infra/lib/storage-stack.ts` (add stage prop)
3. Update `infra/lib/params-stack.ts` (add stage prop)

### Phase 2: Update Main Orchestration (30 min)

4. **Rewrite `infra/bin/infra.ts`** - This is the critical piece that ties everything together

### Phase 3: Helper Scripts (15 min)

5. Create `scripts/copy-sendgrid-key.sh`
6. Create `scripts/get-frontend-config.sh`
7. Make them executable

### Phase 4: Test (30 min)

8. Build: `npm run build`
9. Deploy to dev1: `npx cdk deploy --all -c env=dev1`
10. Verify all stacks deployed
11. Get frontend config
12. Test user signup flow

### Phase 5: Documentation (45 min)

13. Create unified `DEPLOYMENT.md`
14. Update `README.md`
15. Consolidate RBAC docs
16. Delete old docs

## 🎯 QUICK WIN OPTION

If you want to test the current changes without finishing everything:

**Option A: Finish Critical Files Only**

1. Complete `infra/bin/infra.ts` rewrite (30 min)
2. Quick updates to DataStack, StorageStack, ParamsStack (30 min)
3. Deploy and test (30 min)
   **Total: 1.5 hours**

**Option B: I Continue Implementation**
Let me continue implementing the remaining pieces systematically.

## Current Decision Point

**What would you like me to do?**

1. ✅ **Continue implementing** - I'll finish all remaining infrastructure files, create scripts, and provide deployment instructions
2. 🤝 **Pair with you** - I'll update the critical files (infra.ts mainly) and you test
3. 📝 **Documentation first** - Pause implementation, create deployment docs now, finish implementation later

**My Recommendation**: Option 1 - Let me finish the infrastructure files (especially `infra/bin/infra.ts`) so you have a complete, working solution ready to deploy.

This will take about 45 more minutes of implementation, then you'll have:

- ✅ Fully working multi-environment infrastructure
- ✅ Scripts to help with deployment
- ✅ Clear documentation
- ✅ Ready to deploy dev1 environment

What's your preference?

