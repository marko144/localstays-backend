# 🔍 Code Environment References - Clarification

## You Were Right!

I found environment-specific references in your code. Let me clarify what they are and why they're **NOT a problem**:

---

## 📋 Where "dev" and "dev1" Appear

### **1. Infrastructure Comments (Documentation Only)**

**Files:** All CDK stack files in `infra/lib/`

```typescript
// infra/lib/api-lambda-stack.ts (line 23)
/** Environment stage (dev, dev1, staging, prod) */

// infra/lib/cognito-stack.ts (line 12)
/** Environment stage (dev, dev1, staging, prod) */

// infra/lib/data-stack.ts (line 13)
/** Environment stage (dev, dev1, staging, prod) */
```

**Impact:** ✅ **NONE** - These are just TypeScript comments documenting what values are valid.

---

### **2. Seed Script Default Values**

**Files:** Seed scripts in `backend/services/seed/`

```typescript
// seed-enums.ts (line 15)
const TABLE_NAME = process.env.TABLE_NAME || "localstays-dev";

// seed-roles.ts (line 13)
const TABLE_NAME = process.env.TABLE_NAME || "localstays-dev";

// seed-admin-templates.ts (line 13)
const tableName = process.env.TABLE_NAME || "localstays-dev1-email-templates";

// seed-verification-templates.ts (line 14)
const TABLE_NAME = "localstays-dev1-email-templates"; // ⚠️ HARDCODED!

// migrate-listing-gsi3.ts (line 19)
const tableName = process.env.TABLE_NAME || "localstays-dev1";

// migrate-request-gsi3.ts (line 19)
const tableName = process.env.TABLE_NAME || "localstays-dev1";
```

**Impact:** ⚠️ **MINOR** - These are **default fallback values** if you don't provide `TABLE_NAME` environment variable.

---

## 🎯 What This Means

### **The Good News:**

1. ✅ **Infrastructure code is environment-agnostic** - No hardcoded environments
2. ✅ **Lambda code is environment-agnostic** - Uses environment variables
3. ✅ **Seed scripts work with any environment** - Just pass `TABLE_NAME`

### **The Minor Issue:**

⚠️ **One hardcoded value:** `seed-verification-templates.ts` has a hardcoded table name.

---

## 🔧 How to Use Seed Scripts Correctly

### **✅ Correct Usage (Always Provide TABLE_NAME):**

```bash
# For dev1
AWS_REGION=eu-north-1 \
TABLE_NAME=localstays-dev1 \
npx ts-node backend/services/seed/seed-enums.ts

# For staging
AWS_REGION=eu-north-1 \
TABLE_NAME=localstays-staging \
npx ts-node backend/services/seed/seed-enums.ts

# For production
AWS_REGION=eu-central-1 \
TABLE_NAME=localstays-prod \
npx ts-node backend/services/seed/seed-enums.ts
```

**When you provide `TABLE_NAME`, the default values are ignored!**

---

### **❌ What Happens If You Don't Provide TABLE_NAME:**

```bash
# Without TABLE_NAME (uses default)
npx ts-node backend/services/seed/seed-enums.ts

# This would try to seed: localstays-dev (the default)
# ⚠️ Wrong environment!
```

---

## 🚨 One File Needs Fixing

### **Problem File: `seed-verification-templates.ts`**

**Current (HARDCODED):**

```typescript
const TABLE_NAME = "localstays-dev1-email-templates"; // ⚠️ BAD!
```

**Should Be:**

```typescript
const TABLE_NAME = process.env.TABLE_NAME || "localstays-dev1-email-templates"; // ✅ GOOD!
```

Let me fix this:

---

## 🔨 Fix for seed-verification-templates.ts

**File:** `backend/services/seed/seed-verification-templates.ts`

**Change Line 14:**

**BEFORE:**

```typescript
const TABLE_NAME = "localstays-dev1-email-templates";
```

**AFTER:**

```typescript
const TABLE_NAME = process.env.TABLE_NAME || "localstays-dev1-email-templates";
```

---

## ✅ Updated Staging Deployment Commands

### **Step 12: Seed Database**

```bash
# Seed core configuration
AWS_REGION=eu-north-1 \
TABLE_NAME=localstays-staging \
npx ts-node backend/services/seed/seed-handler.ts
```

### **Email Templates Seeding**

**BEFORE (Would fail for staging):**

```bash
# This would try to seed localstays-dev1-email-templates (wrong!)
npx ts-node backend/services/seed/seed-admin-templates.ts
```

**AFTER (Correct):**

```bash
# Explicitly provide table name
AWS_REGION=eu-north-1 \
TABLE_NAME=localstays-staging-email-templates \
npx ts-node backend/services/seed/seed-admin-templates.ts

AWS_REGION=eu-north-1 \
TABLE_NAME=localstays-staging-email-templates \
npx ts-node backend/services/seed/seed-verification-templates.ts
```

---

## 📊 Summary: Environment References

| Location                           | Type            | Impact     | Action Needed               |
| ---------------------------------- | --------------- | ---------- | --------------------------- |
| **Infrastructure comments**        | Documentation   | ✅ None    | None                        |
| **Seed script defaults**           | Fallback values | ⚠️ Minor   | Always provide `TABLE_NAME` |
| **seed-verification-templates.ts** | Hardcoded       | ❌ Problem | Fix to use env var          |
| **Lambda code**                    | None            | ✅ Perfect | None                        |
| **Infrastructure code**            | None            | ✅ Perfect | None                        |

---

## 🎯 Conclusion

### **Your Concern Was Valid!**

Yes, there are `dev` and `dev1` references in the code, but they are:

1. **Comments** (documentation only)
2. **Default fallback values** (only used if you forget to provide `TABLE_NAME`)
3. **One hardcoded value** (needs fixing)

### **Your Architecture Is Still Excellent!**

The core architecture is environment-agnostic:

- ✅ Infrastructure code generates environment-specific names dynamically
- ✅ Lambda code reads from environment variables
- ✅ Seed scripts accept `TABLE_NAME` as environment variable

### **Best Practice:**

**Always provide `TABLE_NAME` when running seed scripts:**

```bash
# ✅ ALWAYS DO THIS
TABLE_NAME=localstays-staging npx ts-node backend/services/seed/...

# ❌ NEVER DO THIS (relies on defaults)
npx ts-node backend/services/seed/...
```

---

## 🔧 Quick Fix Needed

Let me fix the one hardcoded value in `seed-verification-templates.ts`:


