# 🎯 Staging Deployment - Code Strategy & Data Seeding

## Question 1: Single Codebase vs. Environment-Specific Code

### ✅ **Answer: Single Codebase, Multiple Targets**

You use **ONE set of code** that works across all environments. The environment is selected at deployment time using the `-c env=<environment>` flag.

---

## 📁 How It Works in Practice

### **1. Infrastructure Code (CDK) - Environment Selection**

```typescript
// infra/bin/infra.ts
const envName = app.node.tryGetContext('env') || 'dev1';  // ← Gets from CLI
const envConfig = environments[envName];  // ← Reads from cdk.json

// Environment configs in cdk.json:
"environments": {
  "dev1": { "account": "041608526793", "region": "eu-north-1", "stage": "dev1" },
  "staging": { "account": "041608526793", "region": "eu-north-1", "stage": "staging" },
  "prod": { "account": "TBD", "region": "eu-central-1", "stage": "prod" }
}
```

**Result:** Stack names are generated dynamically:

```
dev1    → LocalstaysDev1DataStack
staging → LocalstaysStagingDataStack
prod    → LocalstaysProdDataStack
```

---

### **2. Lambda Code (Backend) - Environment Variables**

Your Lambda functions are **completely environment-agnostic**. They read configuration from environment variables set by CDK:

```typescript
// backend/services/api/listings/get-listing.ts
const TABLE_NAME = process.env.TABLE_NAME!; // ← Set by CDK per environment
const BUCKET_NAME = process.env.BUCKET_NAME!;
const STAGE = process.env.STAGE!; // 'dev1', 'staging', or 'prod'

// Same code runs in all environments, just different config
```

**How CDK Sets These:**

```typescript
// infra/lib/api-lambda-stack.ts
const commonEnvironment = {
  TABLE_NAME: table.tableName,  // ← localstays-dev1 or localstays-staging
  BUCKET_NAME: bucket.bucketName,  // ← localstays-dev1-host-assets-* or localstays-staging-host-assets-*
  STAGE: stage,  // ← 'dev1', 'staging', or 'prod'
  EMAIL_TEMPLATES_TABLE: emailTemplatesTable.tableName,
  SENDGRID_PARAM: sendGridParamName,  // ← /localstays/dev1/sendgrid or /localstays/staging/sendgrid
  FROM_EMAIL: 'marko@localstays.me',
};

this.hostListingsHandlerLambda = new nodejs.NodejsFunction(this, 'HostListingsHandlerLambda', {
  functionName: `localstays-${stage}-host-listings-handler`,  // ← Environment-specific name
  environment: commonEnvironment,  // ← Environment-specific values
  ...
});
```

---

### **3. Seed Scripts - Environment Variables**

Seed scripts also use environment variables:

```typescript
// backend/services/seed/seed-enums.ts
const TABLE_NAME = process.env.TABLE_NAME || "localstays-dev";

// Run for dev1:
// TABLE_NAME=localstays-dev1 npx ts-node backend/services/seed/seed-enums.ts

// Run for staging:
// TABLE_NAME=localstays-staging npx ts-node backend/services/seed/seed-enums.ts
```

---

## 📂 Files with `dev1` in Names

I checked your codebase - **NO source code files have `dev1` in their names**. Only documentation:

```bash
# Only documentation file:
DEPLOYMENT_INSTRUCTIONS_DEV1.md  ← Documentation only
```

**Your code is environment-agnostic! ✅**

---

## 🚀 Deployment Commands

### **Deploy to dev1:**

```bash
npx cdk deploy --all -c env=dev1 --region eu-north-1
```

### **Deploy to staging:**

```bash
npx cdk deploy --all -c env=staging --region eu-north-1
```

### **Deploy to production:**

```bash
npx cdk deploy --all -c env=prod --region eu-central-1
```

**Same code, different targets!**

---

## 🎯 Git Workflow (Recommended)

### **Branch Strategy:**

```
main (production)
  ↓
staging (pre-production)
  ↓
dev1 (development)
```

### **Typical Workflow:**

```bash
# 1. Develop in dev1
git checkout dev1
# Make changes
npm run build
npx cdk deploy --all -c env=dev1 --region eu-north-1

# 2. Merge to staging
git checkout staging
git merge dev1
npm run build
npx cdk deploy --all -c env=staging --region eu-north-1

# 3. After QA approval, merge to main
git checkout main
git merge staging
npm run build
npx cdk deploy --all -c env=prod --region eu-central-1
```

**One codebase, three environments!**

---

## Question 2: Data Seeding Coverage

### ✅ **Answer: You Have Comprehensive Seeding**

Let me show you what's covered:

---

## 📊 Current Seeding Coverage

### **1. Roles & Permissions** ✅

**File:** `backend/services/seed/seed-roles.ts`

**What's Seeded:**

```typescript
ROLE#HOST → CONFIG
- Permissions: [
    'HOST_LISTING_CREATE',
    'HOST_LISTING_EDIT_DRAFT',
    'HOST_LISTING_SUBMIT_REVIEW',
    'HOST_LISTING_SET_OFFLINE',
    'HOST_LISTING_SET_ONLINE',
    'HOST_LISTING_VIEW_OWN',
    'HOST_LISTING_DELETE',
    'HOST_KYC_SUBMIT',
  ]

ROLE#ADMIN → CONFIG
- Permissions: [
    'ADMIN_HOST_VIEW_ALL',
    'ADMIN_HOST_SUSPEND',
    'ADMIN_HOST_REINSTATE',
    'ADMIN_KYC_VIEW_ALL',
    'ADMIN_KYC_APPROVE',
    'ADMIN_KYC_REJECT',
    'ADMIN_LISTING_VIEW_ALL',
    'ADMIN_LISTING_REVIEW',
    'ADMIN_LISTING_APPROVE',
    'ADMIN_LISTING_REJECT',
    'ADMIN_LISTING_SUSPEND',
  ]
```

**Status:** ✅ **COVERED**

---

### **2. Host & User Enums** ✅

**File:** `backend/services/seed/seed-enums.ts`

**What's Seeded:**

```typescript
ENUM#HOST_STATUS → VALUE#INCOMPLETE
ENUM#HOST_STATUS → VALUE#VERIFICATION
ENUM#HOST_STATUS → VALUE#VERIFIED
ENUM#HOST_STATUS → VALUE#INFO_REQUIRED
ENUM#HOST_STATUS → VALUE#SUSPENDED

ENUM#USER_STATUS → VALUE#ACTIVE
ENUM#USER_STATUS → VALUE#SUSPENDED
ENUM#USER_STATUS → VALUE#BANNED

ENUM#HOST_TYPE → VALUE#INDIVIDUAL
ENUM#HOST_TYPE → VALUE#BUSINESS
```

**Status:** ✅ **COVERED**

---

### **3. Listing Enums** ⚠️ **PARTIALLY COVERED**

**File:** `backend/services/seed/seed-handler.ts` (more comprehensive version)

**What's Seeded:**

```typescript
ENUM#PROPERTY_TYPE → VALUE#APARTMENT, HOUSE, VILLA, STUDIO, ROOM

ENUM#CHECKIN_TYPE → VALUE#SELF_CHECKIN, HOST_GREETING, LOCKBOX, DOORMAN

ENUM#PARKING_TYPE → VALUE#NO_PARKING, FREE, PAID

ENUM#CANCELLATION_POLICY → VALUE#NO_CANCELLATION, 24_HOURS, 2_DAYS, 3_DAYS, 4_DAYS, ONE_WEEK, OTHER

ENUM#AMENITY_CATEGORY → VALUE#ESSENTIALS, FEATURES, SAFETY, ACCESSIBILITY

ENUM#AMENITY → VALUE#(100+ amenities with translations)

ENUM#VERIFICATION_DOC_TYPE → VALUE#PASSPORT, ID_CARD, DRIVERS_LICENSE, etc.

ENUM#LISTING_STATUS → VALUE#DRAFT, IN_REVIEW, REVIEWING, APPROVED, REJECTED, ONLINE, OFFLINE, LOCKED, ARCHIVED
```

**Status:** ✅ **COVERED in seed-handler.ts**

---

### **4. Email Templates** ✅

**Files:**

- `backend/services/seed/seed-admin-templates.ts`
- `backend/services/seed/seed-verification-templates.ts`
- `backend/services/seed/verification-email-templates.ts`

**What's Seeded:**

- Verification emails (signup, password reset)
- Admin approval/rejection emails
- Host notification emails
- Multi-language support (English, Serbian)

**Status:** ✅ **COVERED**

---

## 🚨 **ISSUE IDENTIFIED: Two Different Seed Scripts**

You have **TWO seed scripts** with different coverage:

### **Script 1: `seed-all.ts` (Simple)**

```typescript
import { seedRoles } from "./seed-roles";
import { seedEnums } from "./seed-enums";

async function seedAll() {
  await seedRoles(); // ✅ Roles & permissions
  await seedEnums(); // ⚠️ Only HOST_STATUS, USER_STATUS, HOST_TYPE
}
```

**Coverage:** Basic (3 enum types)

---

### **Script 2: `seed-handler.ts` (Comprehensive)**

```typescript
async function seedAll() {
  await seedRoles(); // ✅ Roles & permissions
  await seedEnums(); // ✅ HOST_STATUS, USER_STATUS, HOST_TYPE
  await seedSubscriptionPlans(); // ✅ Subscription plans
  await seedListingEnums(); // ✅ PROPERTY_TYPE, CHECKIN_TYPE, PARKING_TYPE, CANCELLATION_POLICY
  await seedAmenities(); // ✅ 100+ amenities with categories
  await seedVerificationDocTypes(); // ✅ Document types
  await seedListingStatuses(); // ✅ Listing statuses
}
```

**Coverage:** Comprehensive (12+ enum types, 100+ amenities)

---

## ✅ **RECOMMENDATION: Use Comprehensive Seed Script**

### **Update Master Plan Step 12:**

**BEFORE (Current):**

```bash
AWS_REGION=eu-north-1 \
TABLE_NAME=localstays-staging \
npx ts-node backend/services/seed/seed-all.ts
```

**AFTER (Recommended):**

```bash
AWS_REGION=eu-north-1 \
TABLE_NAME=localstays-staging \
npx ts-node backend/services/seed/seed-handler.ts
```

---

## 📋 Complete Seeding Checklist for Staging

### **Step 1: Seed Core Configuration**

```bash
AWS_REGION=eu-north-1 \
TABLE_NAME=localstays-staging \
npx ts-node backend/services/seed/seed-handler.ts
```

**This seeds:**

- ✅ Roles (HOST, ADMIN)
- ✅ Permissions (8 host, 11 admin)
- ✅ Host statuses (5 values)
- ✅ User statuses (3 values)
- ✅ Host types (2 values)
- ✅ Subscription plans
- ✅ Property types (5 values)
- ✅ Check-in types (4 values)
- ✅ Parking types (3 values)
- ✅ Cancellation policies (7 values)
- ✅ Amenity categories (4 values)
- ✅ Amenities (100+ values with translations)
- ✅ Verification document types (10+ values)
- ✅ Listing statuses (9 values)

---

### **Step 2: Seed Email Templates**

```bash
AWS_REGION=eu-north-1 \
TABLE_NAME=localstays-staging \
EMAIL_TEMPLATES_TABLE=localstays-staging-email-templates \
npx ts-node backend/services/seed/seed-admin-templates.ts

AWS_REGION=eu-north-1 \
TABLE_NAME=localstays-staging \
EMAIL_TEMPLATES_TABLE=localstays-staging-email-templates \
npx ts-node backend/services/seed/seed-verification-templates.ts
```

**This seeds:**

- ✅ Verification emails (signup, password reset)
- ✅ Admin notification emails
- ✅ Host approval/rejection emails
- ✅ Multi-language templates (EN, SR)

---

### **Step 3: Create Admin User**

```bash
./scripts/seed-admin-user.sh
```

**This creates:**

- ✅ Admin user in Cognito
- ✅ Admin group membership
- ✅ Admin host record in DynamoDB

---

## 🔍 Verification Commands

### **Verify Roles:**

```bash
aws dynamodb get-item \
  --table-name localstays-staging \
  --key '{"pk": {"S": "ROLE#HOST"}, "sk": {"S": "CONFIG"}}' \
  --region eu-north-1
```

### **Verify Enums:**

```bash
# Check property types
aws dynamodb query \
  --table-name localstays-staging \
  --key-condition-expression "pk = :pk" \
  --expression-attribute-values '{":pk":{"S":"ENUM#PROPERTY_TYPE"}}' \
  --region eu-north-1

# Check amenities
aws dynamodb query \
  --table-name localstays-staging \
  --key-condition-expression "pk = :pk" \
  --expression-attribute-values '{":pk":{"S":"ENUM#AMENITY"}}' \
  --region eu-north-1

# Check cancellation policies
aws dynamodb query \
  --table-name localstays-staging \
  --key-condition-expression "pk = :pk" \
  --expression-attribute-values '{":pk":{"S":"ENUM#CANCELLATION_POLICY"}}' \
  --region eu-north-1

# Check listing statuses
aws dynamodb query \
  --table-name localstays-staging \
  --key-condition-expression "pk = :pk" \
  --expression-attribute-values '{":pk":{"S":"ENUM#LISTING_STATUS"}}' \
  --region eu-north-1
```

### **Count All Seeded Data:**

```bash
# Count all enum types
aws dynamodb scan \
  --table-name localstays-staging \
  --filter-expression "begins_with(pk, :pk)" \
  --expression-attribute-values '{":pk":{"S":"ENUM#"}}' \
  --select COUNT \
  --region eu-north-1
```

---

## 📊 Expected Seeding Results

| Data Type                 | Count | Status                                                                                |
| ------------------------- | ----- | ------------------------------------------------------------------------------------- |
| **Roles**                 | 2     | ✅ HOST, ADMIN                                                                        |
| **Host Statuses**         | 5     | ✅ INCOMPLETE, VERIFICATION, VERIFIED, INFO_REQUIRED, SUSPENDED                       |
| **User Statuses**         | 3     | ✅ ACTIVE, SUSPENDED, BANNED                                                          |
| **Host Types**            | 2     | ✅ INDIVIDUAL, BUSINESS                                                               |
| **Property Types**        | 5     | ✅ APARTMENT, HOUSE, VILLA, STUDIO, ROOM                                              |
| **Check-in Types**        | 4     | ✅ SELF_CHECKIN, HOST_GREETING, LOCKBOX, DOORMAN                                      |
| **Parking Types**         | 3     | ✅ NO_PARKING, FREE, PAID                                                             |
| **Cancellation Policies** | 7     | ✅ NO_CANCELLATION, 24_HOURS, 2_DAYS, 3_DAYS, 4_DAYS, ONE_WEEK, OTHER                 |
| **Amenity Categories**    | 4     | ✅ ESSENTIALS, FEATURES, SAFETY, ACCESSIBILITY                                        |
| **Amenities**             | 100+  | ✅ WiFi, Kitchen, Parking, Pool, etc.                                                 |
| **Document Types**        | 10+   | ✅ PASSPORT, ID_CARD, DRIVERS_LICENSE, etc.                                           |
| **Listing Statuses**      | 9     | ✅ DRAFT, IN_REVIEW, REVIEWING, APPROVED, REJECTED, ONLINE, OFFLINE, LOCKED, ARCHIVED |
| **Email Templates**       | 15+   | ✅ Verification, approval, rejection, etc.                                            |
| **Subscription Plans**    | 3+    | ✅ FREE, BASIC, PREMIUM                                                               |

**Total Records:** ~150+ enum values + templates

---

## 🎯 Summary

### **Question 1: Single Codebase or Environment-Specific?**

✅ **Single Codebase** - You deploy the same code to different environments using:

```bash
npx cdk deploy --all -c env=<environment>
```

- Infrastructure: Environment-specific stack names generated dynamically
- Lambda code: Environment-agnostic, reads from environment variables
- Seed scripts: Environment-agnostic, uses TABLE_NAME environment variable

**No files have `dev1` in their names (except documentation).**

---

### **Question 2: Data Seeding Coverage?**

✅ **Comprehensive Coverage** - You have seeding for:

1. ✅ Roles & Permissions (HOST, ADMIN)
2. ✅ Host & User Enums (statuses, types)
3. ✅ Listing Enums (property types, check-in, parking, cancellation)
4. ✅ Amenities (100+ with categories and translations)
5. ✅ Document Types (verification documents)
6. ✅ Listing Statuses (9 statuses)
7. ✅ Email Templates (15+ templates in multiple languages)
8. ✅ Subscription Plans

**Recommendation:** Use `seed-handler.ts` instead of `seed-all.ts` for complete coverage.

---

## 🚀 Updated Staging Deployment Step 12

**Replace this in the master plan:**

```bash
# Step 12: Seed Database (3 minutes)

# 1. Seed core configuration (roles, enums, amenities, etc.)
AWS_REGION=eu-north-1 \
TABLE_NAME=localstays-staging \
npx ts-node backend/services/seed/seed-handler.ts

# 2. Seed email templates
AWS_REGION=eu-north-1 \
EMAIL_TEMPLATES_TABLE=localstays-staging-email-templates \
npx ts-node backend/services/seed/seed-admin-templates.ts

AWS_REGION=eu-north-1 \
EMAIL_TEMPLATES_TABLE=localstays-staging-email-templates \
npx ts-node backend/services/seed/seed-verification-templates.ts

# 3. Verify seeding
aws dynamodb scan \
  --table-name localstays-staging \
  --filter-expression "begins_with(pk, :pk)" \
  --expression-attribute-values '{":pk":{"S":"ENUM#"}}' \
  --select COUNT \
  --region eu-north-1
# Expected: ~150+ items
```

---

## ✅ You're All Set!

Your codebase is:

- ✅ Environment-agnostic (single codebase)
- ✅ Properly configured for multi-environment deployment
- ✅ Comprehensive data seeding coverage
- ✅ Production-ready architecture

**No changes needed to your code structure!**


