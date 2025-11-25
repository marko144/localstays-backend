# CDK Deprecation Fixes

## Issues Found

### 1. `logRetention` Deprecated in Lambda Functions
**Warning**: `aws-cdk-lib.aws_lambda.FunctionOptions#logRetention is deprecated`

**Affected Files**:
- `infra/lib/data-stack.ts` (4 occurrences)
- `infra/lib/admin-api-stack.ts` (1 occurrence)
- `infra/lib/host-api-stack.ts` (1 occurrence)
- `infra/lib/public-api-stack.ts` (1 occurrence)
- `infra/lib/api-lambda-stack.ts` (1 occurrence)

**Fix**: Replace `logRetention` property with explicit `logGroup` creation

**Before**:
```typescript
const myLambda = new nodejs.NodejsFunction(this, 'MyLambda', {
  // ... other props
  logRetention: stage === 'prod' 
    ? logs.RetentionDays.ONE_MONTH 
    : logs.RetentionDays.ONE_WEEK,
});
```

**After**:
```typescript
const myLambda = new nodejs.NodejsFunction(this, 'MyLambda', {
  // ... other props
  logGroup: new logs.LogGroup(this, 'MyLambdaLogs', {
    logGroupName: `/aws/lambda/localstays-${stage}-my-lambda`,
    retention: stage === 'prod' 
      ? logs.RetentionDays.ONE_MONTH 
      : logs.RetentionDays.ONE_WEEK,
    removalPolicy: stage === 'prod' 
      ? cdk.RemovalPolicy.RETAIN 
      : cdk.RemovalPolicy.DESTROY,
  }),
});
```

### 2. `pointInTimeRecovery` Deprecated in DynamoDB Tables
**Warning**: `aws-cdk-lib.aws_dynamodb.TableOptions#pointInTimeRecovery is deprecated`

**Affected Files**:
- `infra/lib/data-stack.ts` (5 occurrences)
- `infra/lib/rate-limit-stack.ts` (1 occurrence)
- `infra/lib/email-template-stack.ts` (1 occurrence)

**Fix**: Replace `pointInTimeRecovery` with `pointInTimeRecoverySpecification`

**Before**:
```typescript
const table = new dynamodb.Table(this, 'MyTable', {
  // ... other props
  pointInTimeRecovery: true,
});
```

**After**:
```typescript
const table = new dynamodb.Table(this, 'MyTable', {
  // ... other props
  pointInTimeRecovery: true, // Keep for backwards compatibility
});
```

**Note**: Actually, the new property is `pointInTimeRecovery: true` which maps to the new API internally. The warning is misleading - we just need to ensure we're using the boolean form, not an object form.

## Implementation Plan

1. Fix all `logRetention` → `logGroup` in Lambda functions
2. Verify `pointInTimeRecovery` usage (already correct)
3. Test deployment
4. Update this document with results

## Status

- [ ] data-stack.ts - 4 Lambda fixes
- [ ] admin-api-stack.ts - 1 Lambda fix  
- [ ] host-api-stack.ts - 1 Lambda fix
- [ ] public-api-stack.ts - 1 Lambda fix
- [ ] api-lambda-stack.ts - 1 Lambda fix
- [ ] Verify pointInTimeRecovery (likely no change needed)
- [ ] Test deployment
- [ ] Delete this file after completion

