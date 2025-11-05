# TTL-Based Cleanup Implementation

## Overview

Implemented automatic cleanup of orphaned documents and profile photos using DynamoDB TTL and S3 Lifecycle policies. This prevents duplicate files and zombie records when users make multiple submission attempts.

---

## The Problem

### Scenario: Multiple Submission Attempts

**Attempt 1** (Partial Upload):

1. User creates submission intent → Documents `doc_A`, `doc_B` created in DynamoDB (`PENDING_UPLOAD`)
2. User uploads `doc_A` to S3 ✅
3. User fails to upload `doc_B` ❌
4. `confirm-submission` fails validation
5. **Result**: `doc_A` file orphaned in S3, both DynamoDB records stuck at `PENDING_UPLOAD`

**Attempt 2** (Full Upload):

1. User creates NEW submission intent → Documents `doc_C`, `doc_D` created
2. User uploads both files ✅✅
3. `confirm-submission` succeeds
4. **Result**: Host references `[doc_C, doc_D]`, but `doc_A`, `doc_B` remain orphaned

### Edge Case: GuardDuty Race Condition

If GuardDuty scans `doc_A` AFTER its DynamoDB record expires (deleted by TTL):

- Without fix: Creates zombie record, moves file to final location, never cleaned up
- With fix: Detects missing record, cleans up moved file, logs warning

---

## Solution

### Two-Tier Automatic Cleanup

#### **Tier 1: DynamoDB TTL (24 hours)**

- Documents/photos created with `expiresAt` = Unix timestamp (now + 24h)
- If `confirm-submission` succeeds → `expiresAt` cleared (set to `null`)
- If not confirmed within 24h → DynamoDB automatically deletes record

#### **Tier 2: S3 Lifecycle Policy (7 days)**

- Files uploaded to temporary prefixes: `veri_profile-doc_*`, `lstimg_*`
- S3 Lifecycle deletes files with these prefixes after 7 days
- Successfully processed files are moved to final locations (outside lifecycle scope)
- Gives GuardDuty/processors time to complete before cleanup

---

## Implementation

### 1. Submit Intent (`submit-intent.ts`)

**Documents:**

```typescript
const expiresAtTimestamp = Math.floor(Date.now() / 1000) + (24 * 60 * 60);

Item: {
  // ... existing fields ...
  status: 'PENDING_UPLOAD',
  expiresAt: expiresAtTimestamp, // TTL: Auto-delete after 24h if not confirmed
}
```

**Profile Photos:**

```typescript
const expiresAtTimestamp = Math.floor(Date.now() / 1000) + (24 * 60 * 60);

Item: {
  // ... existing fields ...
  status: 'PENDING_UPLOAD',
  expiresAt: expiresAtTimestamp, // TTL: Auto-delete after 24h if not confirmed
}
```

### 2. Confirm Submission (`confirm-submission.ts`)

**Clear TTL on successful confirmation:**

```typescript
// Documents
Item: {
  ...doc,
  status: 'PENDING',
  expiresAt: null, // Clear TTL - document confirmed, keep forever
}

// Profile Photos
Item: {
  ...profilePhoto,
  status: 'PENDING_SCAN',
  expiresAt: null, // Clear TTL - photo confirmed, keep forever
}
```

### 3. Verification Processor (`verification-processor/index.js`)

**Prevent zombie records:**

```javascript
await docClient.send(
  new UpdateCommand({
    // ... existing params ...
    ConditionExpression: "attribute_exists(pk)", // Only update if record exists
  })
);
```

**Clean up orphaned files:**

```javascript
catch (error) {
  if (error.name === 'ConditionalCheckFailedException') {
    console.warn(`⚠️  DynamoDB record not found (likely expired). Cleaning up moved file.`);
    await s3Client.send(new DeleteObjectCommand({
      Bucket: bucket,
      Key: finalS3Key,
    }));
    return; // Don't retry
  }
  throw error; // Retry other errors
}
```

### 4. Image Processor (`image-processor/index.js`)

**Same protection for listing images and profile photos:**

```javascript
// Add ConditionExpression to all UpdateCommand calls
ConditionExpression: 'attribute_exists(pk)',

// Clean up processed files if record doesn't exist
catch (error) {
  if (error.name === 'ConditionalCheckFailedException') {
    console.warn(`⚠️  DynamoDB record not found. Cleaning up processed files.`);
    await s3Client.send(new DeleteObjectCommand({ Bucket: bucket, Key: fullS3Key }));
    await s3Client.send(new DeleteObjectCommand({ Bucket: bucket, Key: thumbnailS3Key }));
    return;
  }
  throw error;
}
```

### 5. Storage Stack (`storage-stack.ts`)

**S3 Lifecycle policies:**

```typescript
lifecycleRules: [
  {
    id: 'CleanupUnconfirmedDocuments',
    enabled: true,
    prefix: 'veri_profile-doc_',
    expiration: cdk.Duration.days(7),
  },
  {
    id: 'CleanupUnconfirmedPhotos',
    enabled: true,
    prefix: 'lstimg_',
    expiration: cdk.Duration.days(7),
  },
],
```

---

## How It Works

### Happy Path (Successful Submission)

1. **Hour 0**: `submit-intent` creates records with `expiresAt` = Hour 24
2. **Hour 0**: User uploads files to S3 (`veri_*` or `lstimg_*` prefixes)
3. **Hour 0**: `confirm-submission` succeeds → Sets `expiresAt` = null
4. **Hour 1**: GuardDuty scans files
5. **Hour 1**: Verification/Image processor moves files to final location
   - Files moved from `veri_*` → `host_X/verification/*`
   - Files moved from `lstimg_*` → `host_X/profile/*`
6. **Result**: ✅ Records persist forever (no TTL), ✅ Files outside lifecycle scope

### Sad Path (Incomplete Submission)

1. **Hour 0**: `submit-intent` creates records with `expiresAt` = Hour 24
2. **Hour 0**: User uploads some/no files
3. **Hour 0**: `confirm-submission` never called OR fails validation
4. **Hour 24**: DynamoDB TTL deletes records ✅
5. **Day 7**: S3 Lifecycle deletes orphaned files ✅
6. **Result**: ✅ Complete cleanup, no orphans

### Edge Case (GuardDuty After TTL Expiration)

1. **Hour 0**: `submit-intent` creates `doc_A` with `expiresAt` = Hour 24
2. **Hour 0**: User uploads file to S3
3. **Hour 0**: `confirm-submission` fails
4. **Hour 24**: DynamoDB TTL deletes `doc_A` record ✅
5. **Hour 26**: GuardDuty finally scans file
6. **Hour 26**: Verification processor runs:
   - Copies file to final location
   - Tries to update DynamoDB → `ConditionalCheckFailedException`
   - Catches error, deletes moved file ✅
   - Logs warning, returns (no retry)
7. **Day 7**: S3 Lifecycle deletes original file ✅
8. **Result**: ✅ No zombie records, ✅ No orphaned files

---

## Benefits

✅ **Automatic cleanup** - No manual intervention needed
✅ **No background jobs** - DynamoDB TTL and S3 Lifecycle are free and automatic
✅ **No zombie records** - Conditional expressions prevent creating records for expired items
✅ **Idempotent submissions** - Multiple attempts are safe
✅ **Audit trail** - CloudWatch logs show all cleanup actions
✅ **Cost-effective** - TTL deletions are free, S3 lifecycle is free
✅ **Handles edge cases** - GuardDuty race conditions handled gracefully

---

## Testing

### Test Scenarios

1. **Normal submission** - Verify no cleanup happens
2. **Abandoned submission** - Wait 24h+ and verify DynamoDB cleanup
3. **Partial upload** - Upload 1 of 2 files, wait 24h, verify cleanup
4. **Multiple attempts** - Submit 3 times, verify only last attempt persists
5. **GuardDuty delay** - Manually delay processing, verify cleanup handling

### Monitoring

Check CloudWatch Logs for:

- `🧹 Deleted orphaned file` - S3 cleanup after conditional check failure
- `⚠️  DynamoDB record not found` - GuardDuty processed expired record

---

## Configuration

### TTL Settings

- **DynamoDB**: Already enabled on `localstays-dev1` table

  - Attribute: `expiresAt`
  - Configured in: `infra/lib/data-stack.ts` (line 47)

- **Duration**: 24 hours for unconfirmed records
  - Documents: `submit-intent.ts` line 370
  - Profile Photos: `submit-intent.ts` line 520

### S3 Lifecycle Settings

- **Duration**: 7 days for temporary files

  - Documents: `storage-stack.ts` line 83
  - Photos: `storage-stack.ts` line 89

- **Prefixes**:
  - Documents: `veri_profile-doc_*`
  - Photos: `lstimg_*`

---

## Future Enhancements

### Optional: Add to Other Entity Types

The same pattern can be applied to:

- Listing images (`lstimg_*` already covered)
- Listing documents (`veri_listing-doc_*`)
- Request videos (`veri_property-video_*`, `veri_live-id-check_*`)

### Optional: Analytics

Add CloudWatch metrics to track:

- Number of expired records (TTL deletions)
- Number of orphaned files cleaned up
- GuardDuty processing delays

---

## Deployment

Changes are code-only and require deployment:

```bash
# Deploy storage stack (S3 lifecycle rules)
npm run cdk:deploy -- -c env=dev1 LocalstaysDev1StorageStack

# Deploy API stack (verification & image processors)
npm run cdk:deploy -- -c env=dev1 LocalstaysDev1ApiStack
```

**Note**: TTL is already enabled on the DynamoDB table, so no database changes needed.

---

## Related Files

### Modified Files:

1. `backend/services/api/hosts/submit-intent.ts` - Set TTL on creation
2. `backend/services/api/hosts/confirm-submission.ts` - Clear TTL on confirmation
3. `backend/services/verification-processor/index.js` - Conditional updates + cleanup
4. `backend/services/image-processor/index.js` - Conditional updates + cleanup
5. `infra/lib/storage-stack.ts` - S3 lifecycle rules

### Related Documentation:

- `PROFILE_PHOTO_FRONTEND_GUIDE.md` - Frontend integration guide
- `ADMIN_SET_LISTING_REVIEWING_API.md` - Admin API documentation

