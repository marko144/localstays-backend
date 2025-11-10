# Docker Image Deployment - Lessons Learned

**Date:** 2025-11-10  
**Environment:** Staging Deployment  
**Status:** ✅ Resolved

---

## 🔴 **Issues Encountered During Staging Deployment**

### **Issue 1: Wrong Docker Platform (AMD64 vs ARM64)**

**What Happened:**

- Initially built Docker image for `linux/amd64` platform
- Lambda was configured for `ARM_64` (Graviton2) architecture
- Deployment failed with error: `The image manifest, config or layer media type for the source image is not supported`

**Root Cause:**

- Used `docker build --platform linux/amd64` instead of `linux/arm64`
- Mismatch between Docker image architecture and Lambda configuration

**Incorrect Command:**

```bash
docker build --platform linux/amd64 -t staging-localstays-image-processor:latest .
```

**Correct Command:**

```bash
docker build --platform linux/arm64 -t staging-localstays-image-processor:latest .
```

**Why It Matters:**

- AWS Lambda on ARM64 (Graviton2) is **20% cheaper** and often faster
- Docker images MUST match the Lambda architecture exactly
- Multi-architecture manifests are NOT supported by Lambda

---

### **Issue 2: Missing Provenance and SBOM Flags**

**What Happened:**

- Docker BuildKit creates multi-platform manifest lists by default
- AWS Lambda only accepts **single-platform manifests**
- Even with `--platform linux/arm64`, Docker was creating manifest lists

**Root Cause:**

- Docker Desktop's BuildKit creates attestation manifests (provenance & SBOM) by default
- These create multi-platform manifest lists that Lambda cannot use

**Incorrect Command:**

```bash
docker build --platform linux/arm64 -t staging-localstays-image-processor:latest .
```

**Correct Command:**

```bash
docker build --platform linux/arm64 --provenance=false --sbom=false -t staging-localstays-image-processor:latest .
```

**Why It Matters:**

- Lambda requires a **single-platform manifest**, not a manifest list
- Without these flags, Lambda deployment fails with manifest errors
- This is documented in `IMAGE_PROCESSING_DEPLOYMENT.md` but was overlooked

**Reference:**
See `backend/services/image-processor/deploy.sh` line 63 for the correct command.

---

### **Issue 3: ECR Repository Already Exists**

**What Happened:**

- Manually created ECR repository using AWS CLI
- CDK stack tried to create the same repository
- Stack deployment failed with: `Repository already exists`

**Root Cause:**

- Created ECR repo manually: `aws ecr create-repository --repository-name staging-localstays-image-processor`
- CDK stack (`api-lambda-stack.ts`) was configured to create the repository
- Conflict between manual creation and CDK-managed resources

**Solution Applied:**
Changed CDK stack to reference existing repository instead of creating new one:

```typescript
// BEFORE (creates new repository):
const imageProcessorRepository = new ecr.Repository(
  this,
  "ImageProcessorRepo",
  {
    repositoryName: `${stage}-localstays-image-processor`,
    // ... config
  }
);

// AFTER (references existing repository):
const imageProcessorRepository = ecr.Repository.fromRepositoryName(
  this,
  "ImageProcessorRepo",
  `${stage}-localstays-image-processor`
);
```

**Why It Matters:**

- Mixing manual resource creation with CDK causes conflicts
- CDK should manage ALL infrastructure or NONE of it
- Use `fromRepositoryName` for existing resources

---

### **Issue 4: Lambda Architecture Mismatch (Attempted Wrong Fix)**

**What Happened:**

- When Docker image failed to deploy, initially tried to change Lambda architecture from ARM64 to X86_64
- This was the WRONG approach

**Incorrect Fix Attempted:**

```typescript
architecture: lambda.Architecture.X86_64,  // ❌ WRONG
```

**Correct Fix:**

```typescript
architecture: lambda.Architecture.ARM_64,  // ✅ CORRECT
// AND rebuild Docker image for ARM64
```

**Why It Matters:**

- ARM64 (Graviton2) is cheaper and faster
- Should fix the Docker build, not change the Lambda architecture
- Always prefer ARM64 unless there's a specific reason not to

---

### **Issue 5: Stack Rollback Due to User Cancellation**

**What Happened:**

- CDK deployment was taking a long time
- User canceled the deployment thinking it was hanging
- Stack rolled back to `ROLLBACK_COMPLETE` state
- Had to delete and redeploy

**Root Cause:**

- API stack deployment takes 5-10 minutes (creates 339 resources!)
- Used `tail` command which appeared to hang
- User thought deployment was stuck

**Solution:**

- Don't use `tail` with CDK deployments
- Let CDK run to completion without piping output
- Educate that large stacks take time

**Correct Deployment Command:**

```bash
# ❌ DON'T DO THIS (appears to hang):
npx cdk deploy LocalstaysStagingApiStack -c env=staging --require-approval never 2>&1 | tail -100

# ✅ DO THIS (shows progress):
npx cdk deploy LocalstaysStagingApiStack -c env=staging --require-approval never
```

---

## ✅ **Correct Docker Image Build & Deploy Process**

### **Step-by-Step Process:**

#### **1. Build Docker Image for ARM64**

```bash
cd backend/services/image-processor

docker build \
  --platform linux/arm64 \
  --provenance=false \
  --sbom=false \
  -t staging-localstays-image-processor:latest \
  .
```

**Key Points:**

- ✅ `--platform linux/arm64` - Match Lambda architecture
- ✅ `--provenance=false` - No attestation manifest
- ✅ `--sbom=false` - No SBOM manifest
- ✅ Single-platform manifest only

#### **2. Tag Image for ECR**

```bash
docker tag \
  staging-localstays-image-processor:latest \
  041608526793.dkr.ecr.eu-north-1.amazonaws.com/staging-localstays-image-processor:latest
```

#### **3. Authenticate to ECR**

```bash
aws ecr get-login-password --region eu-north-1 | \
  docker login --username AWS --password-stdin \
  041608526793.dkr.ecr.eu-north-1.amazonaws.com
```

#### **4. Push to ECR**

```bash
docker push \
  041608526793.dkr.ecr.eu-north-1.amazonaws.com/staging-localstays-image-processor:latest
```

#### **5. Deploy CDK Stack**

```bash
cd /Users/markobabic/LocalDev/localstays-backend

# Build CDK
npm run build

# Deploy API stack (includes image processor Lambda)
npx cdk deploy LocalstaysStagingApiStack \
  -c env=staging \
  --require-approval never \
  --region eu-north-1
```

**Expected Time:** 5-10 minutes for API stack (339 resources)

---

## 📋 **Pre-Deployment Checklist**

Before deploying image processor to a new environment:

### **1. Verify CDK Configuration**

- [ ] Check `infra/lib/api-lambda-stack.ts` Lambda architecture is `ARM_64`
- [ ] Verify ECR repository reference uses `fromRepositoryName` if repo exists
- [ ] Confirm stage name matches environment (dev1, staging, prod)

### **2. Docker Build Verification**

- [ ] Build command includes `--platform linux/arm64`
- [ ] Build command includes `--provenance=false --sbom=false`
- [ ] Verify image builds successfully locally
- [ ] Check image size is reasonable (~1.5GB for image processor)

### **3. ECR Repository Setup**

- [ ] ECR repository exists: `aws ecr describe-repositories --repository-names <stage>-localstays-image-processor`
- [ ] If not, create it: `aws ecr create-repository --repository-name <stage>-localstays-image-processor`
- [ ] Update CDK to use `fromRepositoryName` if manually created

### **4. Deployment Preparation**

- [ ] Clean previous builds: `rm -rf dist/ backend/dist/ cdk.out/`
- [ ] Run `npm run build` successfully
- [ ] Synthesize CDK: `npx cdk synth --all -c env=<stage>`
- [ ] No TypeScript errors

### **5. Deployment Execution**

- [ ] Don't use `tail` - let CDK show full output
- [ ] Don't cancel deployment - API stack takes 5-10 minutes
- [ ] Monitor CloudFormation console if needed
- [ ] Wait for "✅ Deployment complete" message

---

## 🔧 **Troubleshooting Guide**

### **Error: "Image manifest not supported"**

**Symptoms:**

```
The image manifest, config or layer media type for the source image is not supported
```

**Diagnosis:**

- Wrong platform (AMD64 vs ARM64)
- Multi-platform manifest list instead of single-platform

**Fix:**

```bash
# Rebuild with correct flags
docker build \
  --platform linux/arm64 \
  --provenance=false \
  --sbom=false \
  -t <image-name>:latest \
  .

# Re-tag and push
docker tag <image-name>:latest <ecr-uri>:latest
docker push <ecr-uri>:latest

# Redeploy Lambda
npx cdk deploy <StackName> -c env=<stage>
```

---

### **Error: "Repository already exists"**

**Symptoms:**

```
CREATE_FAILED | AWS::ECR::Repository | Repository already exists
```

**Diagnosis:**

- ECR repository created manually
- CDK trying to create the same repository

**Fix:**
Update `infra/lib/api-lambda-stack.ts`:

```typescript
// Change from:
const imageProcessorRepository = new ecr.Repository(
  this,
  "ImageProcessorRepo",
  {
    repositoryName: `${stage}-localstays-image-processor`,
    // ...
  }
);

// To:
const imageProcessorRepository = ecr.Repository.fromRepositoryName(
  this,
  "ImageProcessorRepo",
  `${stage}-localstays-image-processor`
);
```

Then redeploy.

---

### **Error: "Stack in ROLLBACK_COMPLETE state"**

**Symptoms:**

- Stack deployment failed
- Stack status is `ROLLBACK_COMPLETE`
- Cannot update stack

**Diagnosis:**

- Previous deployment failed
- Stack rolled back
- Must delete before redeploying

**Fix:**

```bash
# Delete failed stack
aws cloudformation delete-stack \
  --stack-name <stack-name> \
  --region <region>

# Wait for deletion
aws cloudformation wait stack-delete-complete \
  --stack-name <stack-name> \
  --region <region>

# Redeploy
npx cdk deploy <StackName> -c env=<stage>
```

---

## 📚 **Reference Documentation**

### **Existing Documentation:**

1. **`IMAGE_PROCESSING_DEPLOYMENT.md`** - Original deployment guide with correct flags
2. **`backend/services/image-processor/deploy.sh`** - Automated deployment script
3. **`backend/services/image-processor/README.md`** - Image processor overview

### **Key Sections to Reference:**

- `IMAGE_PROCESSING_DEPLOYMENT.md` lines 70-73: Correct build command
- `deploy.sh` line 63: Build command with all flags
- `README.md` line 91: Platform specification

---

## 🎓 **Key Takeaways**

### **1. Always Use Existing Documentation**

- ✅ Check `IMAGE_PROCESSING_DEPLOYMENT.md` BEFORE deploying
- ✅ Use `deploy.sh` script when available
- ✅ Don't improvise Docker commands

### **2. Docker Image Requirements for Lambda**

- ✅ Must match Lambda architecture exactly (ARM64 or X86_64)
- ✅ Must be single-platform manifest (use `--provenance=false --sbom=false`)
- ✅ Must be pushed to ECR in same region as Lambda

### **3. CDK Best Practices**

- ✅ Let CDK manage ALL infrastructure
- ✅ Use `fromRepositoryName` for existing resources
- ✅ Don't mix manual creation with CDK
- ✅ Don't cancel deployments - they take time

### **4. Deployment Patience**

- ✅ API stack creates 339 resources - takes 5-10 minutes
- ✅ Don't use `tail` - it hides progress
- ✅ Don't cancel - wait for completion
- ✅ Monitor CloudFormation console if concerned

### **5. ARM64 is Preferred**

- ✅ 20% cheaper than X86_64
- ✅ Often faster performance
- ✅ Use unless there's a specific reason not to

---

## 🔄 **Process Improvements Made**

### **1. Updated CDK Stack**

- Changed ECR repository creation to reference existing repo
- Ensures no conflicts with manually created resources

### **2. Documentation Created**

- This document captures all lessons learned
- Provides troubleshooting guide
- Includes pre-deployment checklist

### **3. Deployment Command Standardization**

- Don't use `tail` with CDK deployments
- Let full output display
- Wait for completion

---

## ✅ **Verification Steps**

After successful deployment, verify:

```bash
# 1. Check Lambda exists and is using ARM64
aws lambda get-function \
  --function-name <stage>-image-processor \
  --region <region> \
  --query '[FunctionName,Architectures,PackageType]'

# Expected output:
# [
#   "staging-image-processor",
#   ["arm64"],
#   "Image"
# ]

# 2. Check ECR image exists
aws ecr describe-images \
  --repository-name <stage>-localstays-image-processor \
  --region <region>

# 3. Check Lambda can pull image
aws lambda update-function-code \
  --function-name <stage>-image-processor \
  --image-uri <ecr-uri>:latest \
  --region <region>
```

---

## 📝 **Summary**

**Total Issues:** 5
**Resolution Time:** ~30 minutes
**Root Causes:**

1. Not following existing documentation
2. Missing Docker build flags
3. Mixing manual and CDK resource creation
4. Impatience with long deployments
5. Attempting wrong fixes first

**Prevention:**

- ✅ Always check existing documentation first
- ✅ Use deployment scripts when available
- ✅ Let CDK manage all infrastructure
- ✅ Be patient with large deployments
- ✅ Verify before attempting fixes

---

**Status:** ✅ All issues resolved and documented
**Next Deployment:** Should be smooth with this guide


