# DynamoDB Encryption Policy

## Standard: Always Use DEFAULT Encryption

**All DynamoDB tables MUST use `DEFAULT` encryption (AWS-owned keys).**

```typescript
encryption: dynamodb.TableEncryption.DEFAULT,
```

## Why DEFAULT Instead of AWS_MANAGED?

### Cost & Performance

- **DEFAULT**: Zero KMS API calls, zero KMS charges, faster operations
- **AWS_MANAGED**: Every read/write operation calls KMS (~$0.03 per 10,000 requests)

### Security

Both options provide the same level of encryption at rest:

- ✅ Data encrypted at rest
- ✅ AES-256 encryption
- ✅ Keys managed by AWS
- ✅ Meets compliance requirements for most use cases

### Real-World Impact

With 4,000+ Lambda invocations per month and ~4 DynamoDB operations per invocation:

- **AWS_MANAGED**: ~18,000 KMS API calls/month
- **DEFAULT**: 0 KMS API calls from DynamoDB

## Encryption Options Explained

| Option           | KMS Calls        | Cost              | Use Case                     |
| ---------------- | ---------------- | ----------------- | ---------------------------- |
| **DEFAULT** ✅   | 0                | $0                | **Standard for all tables**  |
| AWS_MANAGED      | Every read/write | $0.03/10k         | Only if audit trail required |
| CUSTOMER_MANAGED | Every read/write | $1/mo + $0.03/10k | Only for strict compliance   |

## When to Use AWS_MANAGED or CUSTOMER_MANAGED

Only use KMS-based encryption if you have specific requirements:

- ✅ Need to audit every encryption/decryption operation in CloudTrail
- ✅ Need custom key rotation schedules
- ✅ Need cross-account key access
- ✅ Specific compliance certifications require it (e.g., HIPAA with audit trail)

For 99% of applications, including ours, **DEFAULT is the correct choice**.

## Implementation

### ✅ Correct (Use This)

```typescript
const table = new dynamodb.Table(this, "MyTable", {
  tableName: `my-table-${stage}`,
  partitionKey: { name: "pk", type: dynamodb.AttributeType.STRING },
  sortKey: { name: "sk", type: dynamodb.AttributeType.STRING },
  billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,

  // Encryption at rest using AWS-owned keys (no KMS charges, same security)
  // Note: Use DEFAULT instead of AWS_MANAGED to avoid KMS API charges
  encryption: dynamodb.TableEncryption.DEFAULT,
});
```

### ❌ Incorrect (Don't Use This)

```typescript
const table = new dynamodb.Table(this, "MyTable", {
  // ... other config ...

  // ❌ This causes KMS API charges for every read/write operation
  encryption: dynamodb.TableEncryption.AWS_MANAGED,
});
```

## Migration from AWS_MANAGED to DEFAULT

If you have existing tables with `AWS_MANAGED` encryption:

1. **Update CDK code** to use `DEFAULT`
2. **Deploy the change** - AWS handles re-encryption automatically
3. **Zero downtime** - table remains available during transition
4. **Zero data loss** - all data is preserved
5. **Instant for small tables** (< 1 minute for tables under 10MB)

```bash
# After updating the code
cd infra
cdk deploy <StackName> -c env=<environment>
```

## Verification

Check table encryption after deployment:

```bash
aws dynamodb describe-table --table-name <table-name> --region <region> | jq '.Table.SSEDescription'
```

**Expected output with DEFAULT:**

```json
{
  "Status": "ENABLED",
  "SSEType": "AES256"
}
```

**Output with AWS_MANAGED (avoid this):**

```json
{
  "Status": "ENABLED",
  "SSEType": "KMS",
  "KMSMasterKeyArn": "arn:aws:kms:..."
}
```

## Summary

- ✅ **Always use `DEFAULT` encryption** for DynamoDB tables
- ✅ Same security as AWS_MANAGED
- ✅ Zero KMS costs
- ✅ Faster operations (no KMS API calls)
- ✅ Simpler architecture
- ❌ Only use KMS encryption if you have specific audit/compliance requirements

---

**Last Updated**: November 2025  
**Policy Owner**: Infrastructure Team
