# 🎯 Staging Deployment - Questions & Answers

## Your Questions Answered

---

## Q1: Is a full clean deployment onto a new staging environment the right way to go?

### ✅ **YES - Full Clean Deployment is the RIGHT Approach**

**Reasons:**

### 1. **AWS Best Practice**

- ✅ Complete environment isolation
- ✅ Mirrors production deployment process
- ✅ Allows testing of infrastructure as code
- ✅ Enables disaster recovery testing
- ✅ Prevents configuration drift

### 2. **Risk Management**

- ✅ Dev1 remains untouched during staging changes
- ✅ Can test breaking changes safely
- ✅ Easy rollback (just delete staging stack)
- ✅ No shared state = no race conditions

### 3. **Production Readiness**

- ✅ Validates your deployment procedures
- ✅ Tests all manual interventions
- ✅ Identifies missing documentation
- ✅ Proves infrastructure is reproducible

### 4. **Cost-Effective**

- ✅ Only ~$10-15/month for staging
- ✅ Can delete when not needed
- ✅ Pay-per-use serverless architecture
- ✅ No wasted resources

### 5. **Testing Benefits**

- ✅ Production-like environment
- ✅ Can test load/performance
- ✅ Can test disaster recovery
- ✅ Can test security configurations

---

## Q2: What is the best practice approach for creating a new environment?

### **Best Practice: Infrastructure as Code (IaC) with CDK**

Your current setup **already follows best practices**:

### ✅ **What You're Doing Right:**

#### 1. **Multi-Environment Configuration in CDK**

```typescript
// cdk.json
"environments": {
  "dev1": { "account": "041608526793", "region": "eu-north-1", "stage": "dev1" },
  "staging": { "account": "041608526793", "region": "eu-north-1", "stage": "staging" },
  "prod": { "account": "TBD", "region": "eu-central-1", "stage": "prod" }
}
```

**Why This is Good:**

- ✅ Single codebase for all environments
- ✅ Environment-specific configuration
- ✅ Easy to add new environments
- ✅ Consistent naming conventions

---

#### 2. **Environment-Specific Resource Naming**

```typescript
// infra/bin/infra.ts
const stackPrefix = `Localstays${
  stage.charAt(0).toUpperCase() + stage.slice(1)
}`;

// Results in:
// dev1    → LocalstaysDev1DataStack
// staging → LocalstaysStagingDataStack
// prod    → LocalstaysProdDataStack
```

**Why This is Good:**

- ✅ No naming conflicts
- ✅ Easy to identify resources
- ✅ CloudFormation stack names are unique
- ✅ Supports multiple environments in same account

---

#### 3. **Dependency Management**

```typescript
// infra/bin/infra.ts
authTriggerStack.addDependency(paramsStack);
authTriggerStack.addDependency(dataStack);
authTriggerStack.addDependency(storageStack);
authTriggerStack.addDependency(kmsStack);
authTriggerStack.addDependency(cognitoStack);
```

**Why This is Good:**

- ✅ CDK handles deployment order
- ✅ Prevents circular dependencies
- ✅ Ensures resources exist before use
- ✅ Automatic rollback on failure

---

#### 4. **Environment-Specific Settings**

```typescript
// Different settings per environment
const logRetention =
  stage === "prod" ? logs.RetentionDays.ONE_MONTH : logs.RetentionDays.ONE_WEEK;

const deletionProtection = stage === "prod";

const corsOrigins =
  stage === "prod"
    ? ["https://app.localstays.com"]
    : apigateway.Cors.ALL_ORIGINS;
```

**Why This is Good:**

- ✅ Production gets stricter settings
- ✅ Dev/staging are more permissive
- ✅ Cost optimization (shorter log retention)
- ✅ Security appropriate to environment

---

### 🎯 **Industry Best Practices You're Following:**

| Practice                      | Your Implementation             | Status       |
| ----------------------------- | ------------------------------- | ------------ |
| **Infrastructure as Code**    | AWS CDK with TypeScript         | ✅ Excellent |
| **Multi-Environment Support** | `cdk.json` environments         | ✅ Excellent |
| **Resource Isolation**        | Separate stacks per env         | ✅ Excellent |
| **Naming Conventions**        | `localstays-{stage}-{resource}` | ✅ Excellent |
| **Dependency Management**     | CDK dependencies                | ✅ Excellent |
| **Configuration Management**  | SSM Parameter Store             | ✅ Excellent |
| **Secrets Management**        | SSM SecureString                | ✅ Excellent |
| **Monitoring**                | CloudWatch per environment      | ✅ Excellent |
| **Cost Tagging**              | Environment tags                | ✅ Excellent |

---

### 🚀 **Additional Best Practices to Consider:**

#### 1. **Separate AWS Accounts for Production** (Future)

```
Dev Account (041608526793)
├── dev1 environment
└── staging environment

Prod Account (TBD)
└── production environment
```

**Benefits:**

- ✅ Complete blast radius isolation
- ✅ Separate billing
- ✅ Different IAM policies
- ✅ Compliance requirements

**When to Implement:** Before production launch

---

#### 2. **CI/CD Pipeline** (Future)

```
GitHub Actions Workflow:
├── On PR → Deploy to dev1 → Run tests
├── On merge to staging → Deploy to staging → Run integration tests
└── On tag → Deploy to production → Run smoke tests
```

**Benefits:**

- ✅ Automated deployments
- ✅ Consistent process
- ✅ Audit trail
- ✅ Rollback capability

**When to Implement:** After staging is stable

---

#### 3. **Environment Promotion Strategy** (Future)

```
Code Flow:
dev1 branch → staging branch → main branch

Deployment Flow:
dev1 env → staging env → production env
```

**Benefits:**

- ✅ Controlled releases
- ✅ Testing at each stage
- ✅ Approval gates
- ✅ Rollback points

**When to Implement:** Before production launch

---

## Q3: How would propagating changes from dev1 to staging work?

### **Strategy: Git-Based Promotion with CDK Deployment**

---

### **Scenario 1: Lambda Code Changes Only**

#### Example: Fix bug in `get-listing.ts`

```bash
# 1. Develop and test in dev1
cd /Users/markobabic/LocalDev/localstays-backend
# Edit backend/services/api/listings/get-listing.ts
npm run build

# Deploy to dev1
npx cdk deploy LocalstaysDev1ApiStack -c env=dev1 --region eu-north-1

# Test in dev1
curl https://dev1-api.execute-api.eu-north-1.amazonaws.com/dev1/api/v1/hosts/host_123/listings/listing_456

# 2. Commit to git
git add backend/services/api/listings/get-listing.ts
git commit -m "fix: Handle null listingName in get-listing"
git push origin dev1

# 3. Merge to staging branch (via PR or direct)
git checkout staging
git merge dev1
git push origin staging

# 4. Deploy to staging
npm run build
npx cdk deploy LocalstaysStagingApiStack -c env=staging --region eu-north-1

# 5. Test in staging
curl https://staging-api.execute-api.eu-north-1.amazonaws.com/staging/api/v1/hosts/host_123/listings/listing_456

# 6. If successful, merge to main for production
git checkout main
git merge staging
git push origin main
```

**Time:** ~5 minutes
**Risk:** Low (only Lambda code changes)

---

### **Scenario 2: Infrastructure Changes (New API Endpoint)**

#### Example: Add new endpoint `PUT /api/v1/hosts/{hostId}/listings/{listingId}/publish`

```bash
# 1. Develop in dev1
# Edit infra/lib/api-lambda-stack.ts
# Add new route and Lambda integration
npm run build

# Deploy to dev1
npx cdk deploy LocalstaysDev1ApiStack -c env=dev1 --region eu-north-1

# Test new endpoint
curl -X PUT https://dev1-api.../api/v1/hosts/host_123/listings/listing_456/publish

# 2. Commit infrastructure changes
git add infra/lib/api-lambda-stack.ts
git add backend/services/api/listings/publish-listing.ts
git commit -m "feat: Add publish listing endpoint"
git push origin dev1

# 3. Merge to staging
git checkout staging
git merge dev1
git push origin staging

# 4. Deploy to staging (full stack)
npm run build
npx cdk deploy LocalstaysStagingApiStack -c env=staging --region eu-north-1

# 5. Verify new endpoint exists
aws apigateway get-resources \
  --rest-api-id <STAGING_API_ID> \
  --region eu-north-1 | grep publish

# 6. Test new endpoint
curl -X PUT https://staging-api.../api/v1/hosts/host_123/listings/listing_456/publish
```

**Time:** ~10 minutes
**Risk:** Medium (API Gateway changes)

---

### **Scenario 3: Database Schema Changes**

#### Example: Add new GSI for querying listings by city

```bash
# 1. Develop in dev1
# Edit infra/lib/data-stack.ts
# Add new GSI
npm run build

# Deploy to dev1
npx cdk deploy LocalstaysDev1DataStack -c env=dev1 --region eu-north-1

# Wait for GSI to backfill (can take hours for large tables)
aws dynamodb describe-table \
  --table-name localstays-dev1 \
  --region eu-north-1 \
  --query 'Table.GlobalSecondaryIndexes[?IndexName==`GSI4`].IndexStatus'

# Test queries using new GSI
# Update Lambda code to use new GSI

# 2. Commit changes
git add infra/lib/data-stack.ts
git add backend/services/api/listings/search-by-city.ts
git commit -m "feat: Add city search GSI"
git push origin dev1

# 3. Merge to staging
git checkout staging
git merge dev1
git push origin staging

# 4. Deploy to staging
npm run build
npx cdk deploy LocalstaysStagingDataStack -c env=staging --region eu-north-1

# 5. Wait for GSI backfill in staging
aws dynamodb describe-table \
  --table-name localstays-staging \
  --region eu-north-1 \
  --query 'Table.GlobalSecondaryIndexes[?IndexName==`GSI4`].IndexStatus'

# 6. Deploy Lambda changes
npx cdk deploy LocalstaysStagingApiStack -c env=staging --region eu-north-1

# 7. Test new search functionality
```

**Time:** ~30 minutes + GSI backfill time
**Risk:** High (schema changes can break existing code)

---

### **Scenario 4: Data Migrations**

#### Example: Migrate listing status from `ACTIVE` to `ONLINE`

```bash
# 1. Create migration script
# backend/services/seed/migrate-listing-status.ts

# 2. Test in dev1
AWS_REGION=eu-north-1 \
TABLE_NAME=localstays-dev1 \
DRY_RUN=true \
npx ts-node backend/services/seed/migrate-listing-status.ts

# Review output, then run for real
AWS_REGION=eu-north-1 \
TABLE_NAME=localstays-dev1 \
npx ts-node backend/services/seed/migrate-listing-status.ts

# 3. Verify migration
aws dynamodb scan \
  --table-name localstays-dev1 \
  --filter-expression "attribute_exists(#status)" \
  --expression-attribute-names '{"#status":"status"}' \
  --region eu-north-1

# 4. Commit migration script
git add backend/services/seed/migrate-listing-status.ts
git commit -m "chore: Migrate listing status ACTIVE → ONLINE"
git push origin dev1

# 5. Merge to staging
git checkout staging
git merge dev1
git push origin staging

# 6. Run migration in staging
AWS_REGION=eu-north-1 \
TABLE_NAME=localstays-staging \
DRY_RUN=true \
npx ts-node backend/services/seed/migrate-listing-status.ts

# Review, then run for real
AWS_REGION=eu-north-1 \
TABLE_NAME=localstays-staging \
npx ts-node backend/services/seed/migrate-listing-status.ts

# 7. Verify migration in staging
aws dynamodb scan \
  --table-name localstays-staging \
  --filter-expression "attribute_exists(#status)" \
  --expression-attribute-names '{"#status":"status"}' \
  --region eu-north-1
```

**Time:** ~20 minutes
**Risk:** High (data integrity)

---

### **Scenario 5: Docker Image Updates (Image Processor)**

#### Example: Update Sharp library version

```bash
# 1. Update in dev1
cd backend/services/image-processor
# Edit Dockerfile or package.json
./deploy.sh dev1 eu-north-1 041608526793

# Update Lambda function
aws lambda update-function-code \
  --function-name dev1-image-processor \
  --image-uri 041608526793.dkr.ecr.eu-north-1.amazonaws.com/dev1-localstays-image-processor:latest \
  --region eu-north-1

# Wait for update
aws lambda wait function-updated \
  --function-name dev1-image-processor \
  --region eu-north-1

# Test image processing
# Upload test image and verify processing

# 2. Commit changes
git add backend/services/image-processor/Dockerfile
git commit -m "chore: Update Sharp to v0.33.0"
git push origin dev1

# 3. Merge to staging
git checkout staging
git merge dev1
git push origin staging

# 4. Build and push staging image
cd backend/services/image-processor
./deploy.sh staging eu-north-1 041608526793

# 5. Update staging Lambda
aws lambda update-function-code \
  --function-name staging-image-processor \
  --image-uri 041608526793.dkr.ecr.eu-north-1.amazonaws.com/staging-localstays-image-processor:latest \
  --region eu-north-1

# Wait for update
aws lambda wait function-updated \
  --function-name staging-image-processor \
  --region eu-north-1

# 6. Test in staging
# Upload test image and verify processing
```

**Time:** ~20 minutes
**Risk:** Medium (image processing changes)

---

### **Scenario 6: Environment Variable Changes**

#### Example: Add new environment variable `ENABLE_FEATURE_X=true`

```bash
# 1. Update in dev1
# Edit infra/lib/api-lambda-stack.ts
const commonEnvironment = {
  TABLE_NAME: table.tableName,
  BUCKET_NAME: bucket.bucketName,
  ENABLE_FEATURE_X: 'true',  // Add this
  ...
};

npm run build

# Deploy to dev1
npx cdk deploy LocalstaysDev1ApiStack -c env=dev1 --region eu-north-1

# Test feature X
curl https://dev1-api.../api/v1/feature-x

# 2. Commit changes
git add infra/lib/api-lambda-stack.ts
git commit -m "feat: Enable feature X"
git push origin dev1

# 3. Merge to staging
git checkout staging
git merge dev1
git push origin staging

# 4. Deploy to staging
npm run build
npx cdk deploy LocalstaysStagingApiStack -c env=staging --region eu-north-1

# 5. Verify environment variable
aws lambda get-function-configuration \
  --function-name localstays-staging-host-listings-handler \
  --region eu-north-1 \
  --query 'Environment.Variables.ENABLE_FEATURE_X'

# 6. Test feature X in staging
curl https://staging-api.../api/v1/feature-x
```

**Time:** ~10 minutes
**Risk:** Low (environment variables)

---

## **Propagation Decision Matrix**

| Change Type            | Deploy Command                       | Risk   | Time    | Rollback                     |
| ---------------------- | ------------------------------------ | ------ | ------- | ---------------------------- |
| **Lambda code only**   | `cdk deploy ApiStack`                | Low    | 5 min   | Redeploy previous version    |
| **API Gateway routes** | `cdk deploy ApiStack`                | Medium | 10 min  | Redeploy previous version    |
| **DynamoDB schema**    | `cdk deploy DataStack`               | High   | 30+ min | Complex - may need migration |
| **S3 bucket config**   | `cdk deploy StorageStack`            | Low    | 5 min   | Redeploy previous version    |
| **Cognito settings**   | Manual CLI                           | High   | 10 min  | Manual revert                |
| **Docker image**       | `./deploy.sh + update-function-code` | Medium | 20 min  | Redeploy previous image      |
| **Environment vars**   | `cdk deploy ApiStack`                | Low    | 10 min  | Redeploy previous version    |
| **Data migration**     | Run migration script                 | High   | 20+ min | Reverse migration script     |
| **IAM permissions**    | `cdk deploy ApiStack`                | Medium | 10 min  | Redeploy previous version    |
| **CloudWatch alarms**  | `cdk deploy ApiStack`                | Low    | 5 min   | Redeploy previous version    |

---

## **Automated Propagation (Future CI/CD)**

### **GitHub Actions Workflow Example:**

```yaml
# .github/workflows/deploy-staging.yml
name: Deploy to Staging

on:
  push:
    branches:
      - staging

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: "20"

      - name: Install dependencies
        run: npm install

      - name: Build project
        run: npm run build

      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v2
        with:
          aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: eu-north-1

      - name: Deploy to staging
        run: |
          npx cdk deploy --all -c env=staging --require-approval never --region eu-north-1

      - name: Run smoke tests
        run: |
          npm run test:staging

      - name: Notify on failure
        if: failure()
        uses: 8398a7/action-slack@v3
        with:
          status: ${{ job.status }}
          text: "Staging deployment failed!"
          webhook_url: ${{ secrets.SLACK_WEBHOOK }}
```

---

## **Summary: Propagation Best Practices**

### ✅ **DO:**

1. **Test thoroughly in dev1 first**
2. **Use git branches for environment promotion**
3. **Run `cdk diff` before deploying to staging**
4. **Keep staging data realistic (not production data)**
5. **Document all manual steps**
6. **Use migration scripts for data changes**
7. **Tag releases in git**
8. **Monitor CloudWatch after deployment**

### ❌ **DON'T:**

1. **Don't deploy directly to staging without testing in dev1**
2. **Don't skip `npm run build` before deploying**
3. **Don't use `--hotswap` in staging (dev1 only)**
4. **Don't copy production data to staging**
5. **Don't make manual changes without documenting**
6. **Don't deploy during business hours (staging can have downtime)**

---

## **Conclusion**

Your current architecture is **excellent** and follows AWS best practices. The full clean deployment approach for staging is the **right choice**.

**Key Takeaways:**

1. ✅ Your CDK setup supports multi-environment deployments perfectly
2. ✅ Full clean deployment is the AWS-recommended approach
3. ✅ Propagation is as simple as: `git merge` → `cdk deploy`
4. ✅ Your infrastructure is production-ready
5. ✅ Consider CI/CD automation after staging is stable

**Next Steps:**

1. Deploy staging using the master plan
2. Test propagation with a small change
3. Document any issues encountered
4. Plan CI/CD automation
5. Prepare for production deployment

---

**Questions?** Refer to:

- `STAGING_DEPLOYMENT_MASTER_PLAN.md` - Complete deployment guide
- `STAGING_DEPLOYMENT_CHECKLIST.md` - Quick reference
- This document - Strategy and best practices


