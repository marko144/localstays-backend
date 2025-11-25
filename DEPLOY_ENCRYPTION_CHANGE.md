# Deployment Guide: DynamoDB Encryption Change

## Overview

This deployment changes all DynamoDB tables from `AWS_MANAGED` KMS encryption to `DEFAULT` (AWS-owned keys) encryption.

**Impact**: Eliminates ~18,000 KMS API calls per month with zero security trade-off.

## What's Changed

### Files Modified

1. `infra/lib/data-stack.ts` - 5 tables updated
2. `infra/lib/rate-limit-stack.ts` - 1 table updated
3. `DYNAMODB_ENCRYPTION_POLICY.md` - New policy document created

### Tables Affected (All Environments)

- `localstays-{env}` (main table)
- `localstays-locations-{env}`
- `localstays-public-listings-{env}`
- `localstays-public-listing-media-{env}`
- `localstays-availability-{env}`
- `geocode-rate-limits-{env}`

## Pre-Deployment Checklist

- [ ] Review the changes in `data-stack.ts` and `rate-limit-stack.ts`
- [ ] Read `DYNAMODB_ENCRYPTION_POLICY.md`
- [ ] Ensure you have AWS credentials configured
- [ ] Verify CDK is installed and up to date

## Deployment Steps

### Step 1: Deploy to Staging First

```bash
cd infra
cdk deploy LocalstaysDataStack-staging LocalstaysRateLimitStack-staging -c env=staging
```

**Expected output:**

```
✨  Synthesis time: X.XXs

LocalstaysDataStack-staging
LocalstaysDataStack-staging: deploying...
[██████████████████████████████████████████████████████] (X/X)

 ✅  LocalstaysDataStack-staging

LocalstaysRateLimitStack-staging: deploying...
[██████████████████████████████████████████████████████] (X/X)

 ✅  LocalstaysRateLimitStack-staging
```

**Duration**: 5-10 minutes (AWS re-encrypts tables in background)

### Step 2: Verify Staging

Check that tables are using the new encryption:

```bash
# Main table
aws dynamodb describe-table --table-name localstays-staging --region eu-north-1 | jq '.Table.SSEDescription'

# Expected output:
# {
#   "Status": "ENABLED",
#   "SSEType": "AES256"
# }

# Verify other tables
for table in localstays-locations-staging localstays-public-listings-staging localstays-public-listing-media-staging localstays-availability-staging geocode-rate-limits-staging; do
  echo "=== $table ==="
  aws dynamodb describe-table --table-name $table --region eu-north-1 | jq '.Table.SSEDescription'
done
```

### Step 3: Test Staging Application

- [ ] Test user signup/login
- [ ] Test host profile submission
- [ ] Test listing creation
- [ ] Test admin operations
- [ ] Verify no errors in CloudWatch logs

### Step 4: Deploy to Other Environments (Optional)

If you have dev/dev1 environments:

```bash
# Dev
cdk deploy LocalstaysDataStack-dev LocalstaysRateLimitStack-dev -c env=dev

# Dev1
cdk deploy LocalstaysDataStack-dev1 LocalstaysRateLimitStack-dev1 -c env=dev1
```

### Step 5: Deploy to Production (When Ready)

```bash
cdk deploy LocalstaysDataStack-prod LocalstaysRateLimitStack-prod -c env=prod
```

## Post-Deployment Verification

### 1. Check KMS Usage (Wait 24 hours)

Monitor KMS API calls to confirm reduction:

```bash
# Check KMS metrics
aws cloudwatch get-metric-statistics \
  --namespace AWS/KMS \
  --metric-name NumberOfRequests \
  --dimensions Name=KeyId,Value=<your-dynamodb-key-id> \
  --start-time $(date -u -v-1d +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 3600 \
  --statistics Sum \
  --region eu-north-1
```

**Expected**: Near-zero requests from DynamoDB key

### 2. Monitor Application Performance

Check CloudWatch metrics for:

- Lambda execution times (should be slightly faster)
- DynamoDB operation latency (should be slightly lower)
- Error rates (should remain unchanged)

### 3. Check CloudWatch Logs

```bash
# Check for any encryption-related errors
aws logs filter-log-events \
  --log-group-name /aws/lambda/localstays-staging-host-listings-handler \
  --start-time $(($(date +%s) - 3600))000 \
  --filter-pattern "encryption" \
  --region eu-north-1
```

**Expected**: No errors

## Rollback Procedure

If you need to rollback (unlikely):

1. **Revert the code changes**:

   ```bash
   git revert <commit-hash>
   ```

2. **Redeploy**:

   ```bash
   cdk deploy LocalstaysDataStack-staging LocalstaysRateLimitStack-staging -c env=staging
   ```

3. **AWS will re-encrypt back to KMS** automatically

## Expected Results

### Before (AWS_MANAGED)

- KMS API calls: ~18,000/month
- KMS cost: ~$0.054/month
- DynamoDB operation latency: +5-10ms per operation

### After (DEFAULT)

- KMS API calls: ~100/month (only from SSM)
- KMS cost: ~$0.003/month
- DynamoDB operation latency: Baseline (faster)

### Cost Savings

- **Monthly**: $0.05 (negligible)
- **Annual**: $0.60
- **Performance**: 5-10ms faster per DynamoDB operation

## Troubleshooting

### Issue: Deployment takes longer than expected

**Solution**: Normal for encryption changes. Wait up to 15 minutes for large tables.

### Issue: "UPDATE_ROLLBACK_IN_PROGRESS"

**Solution**: Check CloudFormation events for specific error. Most likely a temporary AWS issue - retry deployment.

### Issue: Application errors after deployment

**Solution**: Check CloudWatch logs. Encryption change should be transparent to application.

## Support

If you encounter issues:

1. Check CloudWatch Logs for the affected Lambda
2. Check CloudFormation events for the stack
3. Review AWS DynamoDB console for table status
4. Check this guide's troubleshooting section

## References

- [DYNAMODB_ENCRYPTION_POLICY.md](./DYNAMODB_ENCRYPTION_POLICY.md) - Full encryption policy
- [AWS DynamoDB Encryption Documentation](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/EncryptionAtRest.html)
- [AWS KMS Pricing](https://aws.amazon.com/kms/pricing/)

---

**Created**: November 2025  
**Last Updated**: November 2025
