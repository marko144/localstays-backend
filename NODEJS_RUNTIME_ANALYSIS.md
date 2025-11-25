# Node.js Runtime Analysis - AWS Health Warning

## 🚨 Issue Summary

AWS has notified you that **Node.js 20.x runtime will reach End-of-Life (EOL) on April 30, 2026**.

### What This Means:

- ✅ **Your functions will continue to run** after April 30, 2026
- ❌ **No security patches** will be applied after EOL
- ❌ **No bug fixes** from AWS Lambda team
- ⚠️ **Security risk** - unpatched vulnerabilities

## 📊 Scope of the Issue

### Current Runtime Usage:

**Node.js 20.x (AFFECTED):** 11 occurrences across 7 stacks

- `public-api-stack.ts` - 1 Lambda (uses commonLambdaProps)
- `host-api-stack.ts` - 10 Lambdas (uses commonLambdaProps)
- `data-stack.ts` - 2 Lambdas (seed handlers)
- `admin-api-stack.ts` - 4 Lambdas (uses commonLambdaProps)
- `guest-api-stack.ts` - 2 Lambdas (uses commonLambdaProps)
- `shared-services-stack.ts` - 1 Lambda (verification processor)
- `auth-trigger-stack.ts` - 4 Lambdas (Cognito triggers)

**Total affected: ~24 Lambda functions**

**Node.js 18.x (NOT AFFECTED):** 1 occurrence

- `email-template-stack.ts` - 1 Lambda (seed email templates)

## 🎯 Recommended Action

### Upgrade to Node.js 22.x (Latest LTS)

Node.js 22.x is the current Long-Term Support (LTS) version and will be supported until **April 2027** (1 year longer than 20.x).

### Timeline:

- **Now - April 2026**: You have **~16 months** to upgrade
- **April 30, 2026**: Node.js 20.x EOL - no more security patches
- **Recommended**: Upgrade within the next 3-6 months

## 🔧 How to Fix

### Option 1: Global Replace (Fastest)

Replace all instances of `NODEJS_20_X` with `NODEJS_22_X`:

```bash
# In all stack files
find infra/lib -name "*.ts" -exec sed -i '' 's/NODEJS_20_X/NODEJS_22_X/g' {} \;
```

### Option 2: Manual Update (Safer)

Update each stack file individually:

1. **Stacks using `commonLambdaProps`:**

   - `infra/lib/public-api-stack.ts`
   - `infra/lib/host-api-stack.ts`
   - `infra/lib/admin-api-stack.ts`
   - `infra/lib/guest-api-stack.ts`

   Change:

   ```typescript
   const commonLambdaProps = {
     runtime: lambda.Runtime.NODEJS_20_X, // ❌
     // ... other props
   };
   ```

   To:

   ```typescript
   const commonLambdaProps = {
     runtime: lambda.Runtime.NODEJS_22_X, // ✅
     // ... other props
   };
   ```

2. **Individual Lambda definitions:**

   - `infra/lib/data-stack.ts` (2 Lambdas)
   - `infra/lib/shared-services-stack.ts` (1 Lambda)
   - `infra/lib/auth-trigger-stack.ts` (4 Lambdas)

   Change each:

   ```typescript
   runtime: lambda.Runtime.NODEJS_20_X,  // ❌
   ```

   To:

   ```typescript
   runtime: lambda.Runtime.NODEJS_22_X,  // ✅
   ```

## ✅ Testing Requirements

After upgrading:

1. **Test in staging first** (deploy all stacks)
2. **Verify Lambda execution** (check CloudWatch logs)
3. **Test critical paths:**
   - Host profile submission
   - Listing creation/publishing
   - Admin approval workflows
   - Guest search
   - Authentication flows
4. **Monitor for errors** for 24-48 hours
5. **Deploy to production** once verified

## 📝 Compatibility Notes

### Node.js 20.x → 22.x Changes:

**Breaking Changes (Unlikely to affect you):**

- None that would impact typical AWS Lambda usage
- Your TypeScript code (compiled to ES2022) should work fine

**Benefits of 22.x:**

- Better performance
- Security improvements
- Longer support window (until April 2027)

### Your Code Compatibility:

- ✅ **TypeScript**: Compiled to ES2022 (compatible)
- ✅ **AWS SDK v3**: Already using modular imports (compatible)
- ✅ **Dependencies**: Should work fine (npm packages are runtime-agnostic)

## ⚠️ Risks of NOT Upgrading

If you don't upgrade by April 30, 2026:

1. **Security vulnerabilities** won't be patched
2. **Compliance issues** (running unsupported software)
3. **No AWS support** for runtime-related issues
4. **Potential breaking changes** if AWS makes infrastructure changes

## 🚀 Recommended Action Plan

### Phase 1: Preparation (Week 1)

1. Read this analysis
2. Review Node.js 22.x release notes
3. Plan deployment window

### Phase 2: Update Code (Week 1)

1. Create a new branch: `upgrade/nodejs-22`
2. Update all runtime references to `NODEJS_22_X`
3. Commit changes

### Phase 3: Testing (Week 2)

1. Deploy to staging
2. Run comprehensive tests
3. Monitor for 48 hours

### Phase 4: Production (Week 3)

1. Deploy to production
2. Monitor closely
3. Document completion

## 📚 References

- [AWS Lambda Runtimes](https://docs.aws.amazon.com/lambda/latest/dg/lambda-runtimes.html)
- [Node.js Release Schedule](https://nodejs.org/en/about/previous-releases)
- [AWS Lambda Runtime Support Policy](https://docs.aws.amazon.com/lambda/latest/dg/runtime-support-policy.html)

## 🎯 Bottom Line

**This is NOT urgent, but should be addressed within the next 3-6 months.**

You have plenty of time, and the upgrade is straightforward. The main risk is NOT upgrading and running on an unsupported runtime after April 2026.

**Estimated effort:** 2-4 hours (including testing)
**Risk level:** Low (Node.js 22.x is stable and compatible)
**Priority:** Medium (16 months until EOL)

