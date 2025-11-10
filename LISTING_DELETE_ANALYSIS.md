# Listing Delete Functionality - Complete Analysis

## Overview

**Endpoint:** `DELETE /api/v1/hosts/{hostId}/listings/{listingId}`

**File:** `backend/services/api/listings/delete-listing.ts`

**Type:** **SOFT DELETE** (not a hard delete)

---

## 🔍 What Currently Happens

### Step-by-Step Process

#### 1. **Authentication & Authorization** (Lines 32-41)

- Verifies user is authenticated
- Checks user has permission to access this host's resources
- HOST can delete own listings, ADMIN can delete any listing

#### 2. **Fetch Listing Metadata** (Lines 44-63)

- Retrieves listing from DynamoDB
- Key: `HOST#{hostId}` / `LISTING_META#{listingId}`
- Checks if listing exists
- Checks if already deleted (prevents double-deletion)

#### 3. **Fetch All Child Records** (Lines 66-100)

Queries DynamoDB for all related records:

- **Images:** `LISTING#{listingId}` / `IMAGE#*`
- **Documents:** `HOST#{hostId}` / `LISTING_DOC#{listingId}#*`
- **Amenities:** `HOST#{hostId}` / `LISTING_AMENITIES#{listingId}`

#### 4. **Build Transaction for Soft Delete** (Lines 103-179)

Creates a DynamoDB transaction to update all records atomically:

**Listing Metadata Update:**

```typescript
{
  isDeleted: true,
  deletedAt: "2025-11-08T...",
  deletedBy: hostId,
  status: "ARCHIVED",
  updatedAt: "2025-11-08T...",
  gsi2pk: "LISTING_STATUS#ARCHIVED"
}
```

**All Images Update:**

```typescript
{
  isDeleted: true,
  deletedAt: "2025-11-08T..."
}
```

**All Documents Update:**

```typescript
{
  isDeleted: true,
  deletedAt: "2025-11-08T..."
}
```

**Amenities Update:**

```typescript
{
  isDeleted: true;
}
```

#### 5. **Execute Transaction** (Lines 191-195)

- All updates happen atomically (all succeed or all fail)
- Maximum 100 items per transaction (DynamoDB limit)
- Typical listing: ~21 items (1 listing + 15 images + 4 docs + 1 amenity)

#### 6. **Return Success Response** (Lines 204-209)

```json
{
  "success": true,
  "listingId": "listing_...",
  "message": "Listing deleted successfully",
  "deletedAt": "2025-11-08T..."
}
```

---

## 📁 What Gets Deleted vs. What Remains

### ✅ DynamoDB Records - SOFT DELETED (Marked as deleted, not removed)

| Record Type          | Action      | Details                                                         |
| -------------------- | ----------- | --------------------------------------------------------------- |
| **Listing Metadata** | Soft Delete | `isDeleted: true`, `status: ARCHIVED`, `deletedAt`, `deletedBy` |
| **Images**           | Soft Delete | `isDeleted: true`, `deletedAt`                                  |
| **Documents**        | Soft Delete | `isDeleted: true`, `deletedAt`                                  |
| **Amenities**        | Soft Delete | `isDeleted: true`                                               |

**Important:** Records are **NOT physically deleted** from DynamoDB. They remain in the database with `isDeleted: true` flag.

---

### ❌ S3 Files - NOT DELETED (Remain in S3)

**From Line 22:**

> "S3 files remain (for audit purposes)"

| File Type             | Location                                                              | Status        |
| --------------------- | --------------------------------------------------------------------- | ------------- |
| **Original Images**   | `s3://{bucket}/{hostId}/listings/{listingId}/images/original/`        | ✅ **REMAIN** |
| **WebP Images**       | `s3://{bucket}/{hostId}/listings/{listingId}/images/webp/`            | ✅ **REMAIN** |
| **Thumbnails**        | `s3://{bucket}/{hostId}/listings/{listingId}/images/webp/thumbnails/` | ✅ **REMAIN** |
| **Documents**         | `s3://{bucket}/{hostId}/listings/{listingId}/documents/`              | ✅ **REMAIN** |
| **Verification PDFs** | `s3://{bucket}/{hostId}/listings/{listingId}/verification/`           | ✅ **REMAIN** |

**Result:** All S3 files remain in storage indefinitely.

---

## 🎯 Key Characteristics

### 1. **Soft Delete Pattern**

- Records are marked as deleted, not removed
- Allows for potential recovery
- Maintains audit trail
- Preserves historical data

### 2. **Atomic Operation**

- Uses DynamoDB transaction
- All updates succeed or all fail
- No partial deletions

### 3. **Cascade Delete**

- Automatically marks all child records as deleted
- Images, documents, and amenities all updated
- No orphaned records

### 4. **Status Change**

- Listing status changes to `ARCHIVED`
- GSI2 updated to `LISTING_STATUS#ARCHIVED`
- Removes from active listings queries

### 5. **Audit Trail**

- `deletedAt` timestamp recorded
- `deletedBy` records who deleted it
- Original data preserved

---

## 🔒 What Queries Are Affected

### Queries That Will NOT Return Deleted Listings

Most queries filter out deleted listings using `FilterExpression`:

**Example from `list-listings.ts` (line 47):**

```typescript
FilterExpression: 'isDeleted = :notDeleted'
ExpressionAttributeValues: {
  ':notDeleted': false
}
```

**Affected Endpoints:**

- `GET /api/v1/hosts/{hostId}/listings` - List all listings
- `GET /api/v1/hosts/{hostId}/listings/{listingId}` - Get listing details (likely)
- Admin listing queries (pending review, approved, etc.)

### Queries That COULD Return Deleted Listings

If a query doesn't include `isDeleted` filter, it could return deleted listings:

- Direct DynamoDB queries without filter
- Admin audit/reporting queries
- Data recovery operations

---

## 💾 Storage Impact

### DynamoDB Storage

- **Increases over time** (soft deletes accumulate)
- Deleted records remain indefinitely
- No automatic cleanup

### S3 Storage

- **Increases over time** (files never deleted)
- All images, documents, PDFs remain
- No automatic cleanup
- **Cost implication:** Paying for storage of deleted listing files

---

## 🚨 Potential Issues

### 1. **Storage Costs**

- **Problem:** S3 files from deleted listings remain forever
- **Impact:** Increasing storage costs over time
- **Scale:** Each listing could have 15 images × 3 versions (original, webp, thumbnail) = 45 files
- **Example:** 1000 deleted listings = ~45,000 orphaned files

### 2. **DynamoDB Size**

- **Problem:** Soft deleted records accumulate
- **Impact:** Larger table size, slower scans
- **Mitigation:** Queries use filters, so performance impact is minimal

### 3. **No Cleanup Process**

- **Problem:** No automated cleanup of old deleted listings
- **Impact:** Data and storage accumulate indefinitely
- **Risk:** Compliance issues if data should be permanently deleted after certain period

### 4. **Data Recovery**

- **Current State:** Possible to "undelete" by setting `isDeleted: false`
- **Risk:** No formal recovery process or admin UI for this

### 5. **GDPR/Privacy Compliance**

- **Problem:** If user requests data deletion, soft delete may not be sufficient
- **Requirement:** May need hard delete for compliance
- **Current Gap:** No mechanism for permanent deletion

---

## 🔄 Comparison with Other Delete Operations

### Host Profile Delete

- **Pattern:** Likely soft delete (need to verify)
- **S3 Files:** Profile images, ID documents

### Request Delete

- **Pattern:** Likely soft delete or status change
- **S3 Files:** Uploaded documents for verification

### Image Delete (within listing)

- **Pattern:** Soft delete (sets `isDeleted: true`)
- **S3 Files:** Image files remain

**Consistency:** Soft delete pattern is used throughout the system.

---

## 💡 Recommendations

### Short-Term (Current Implementation)

✅ **Keep as-is** if:

- You need audit trail
- You want ability to recover deleted listings
- Storage costs are acceptable
- No compliance requirements for hard deletion

### Medium-Term Improvements

#### 1. **Add S3 Lifecycle Policies**

- Move deleted listing files to S3 Glacier after 30 days
- Permanently delete after 90 days (or compliance period)
- Reduces storage costs significantly

#### 2. **Add Cleanup Lambda**

- Scheduled job (monthly) to hard delete old soft-deleted listings
- Only delete listings deleted > 90 days ago
- Delete DynamoDB records AND S3 files

#### 3. **Add Admin Recovery UI**

- Allow admins to view deleted listings
- Provide "Restore" functionality
- Set time limit (e.g., 30 days) for recovery

#### 4. **Add Hard Delete Option**

- Separate endpoint for permanent deletion
- Require admin permission
- Delete DynamoDB records AND S3 files
- Use for compliance/GDPR requests

### Long-Term Considerations

#### 1. **Data Retention Policy**

```
Deleted Listings:
- Days 0-30: Soft deleted, full recovery available
- Days 31-90: Moved to cold storage, recovery possible but slower
- Days 90+: Permanently deleted (DynamoDB + S3)
```

#### 2. **Compliance Features**

- GDPR "Right to be Forgotten" endpoint
- Hard delete with audit logging
- Compliance reporting

#### 3. **Storage Optimization**

- Compress images before archiving
- Deduplicate identical files
- Monitor and alert on storage growth

---

## 📊 Summary

### Current Behavior

| Aspect               | Status      | Details                                |
| -------------------- | ----------- | -------------------------------------- |
| **Delete Type**      | Soft Delete | Records marked as deleted, not removed |
| **DynamoDB Records** | Preserved   | `isDeleted: true` flag set             |
| **S3 Files**         | Preserved   | All files remain in S3                 |
| **Recovery**         | Possible    | Can flip `isDeleted` back to `false`   |
| **Cleanup**          | None        | No automated cleanup process           |
| **Audit Trail**      | Complete    | `deletedAt`, `deletedBy` recorded      |
| **Status**           | Changed     | Listing status → `ARCHIVED`            |
| **Cascade**          | Yes         | All child records marked deleted       |
| **Transaction**      | Atomic      | All updates succeed or fail together   |

### Storage Growth Over Time

```
Month 1: 10 deleted listings × 45 files = 450 files
Month 6: 60 deleted listings × 45 files = 2,700 files
Year 1: 120 deleted listings × 45 files = 5,400 files
Year 5: 600 deleted listings × 45 files = 27,000 files
```

**Recommendation:** Implement lifecycle policies or cleanup process to manage storage costs.

---

## 🎯 Conclusion

**Current Implementation:**

- ✅ Soft delete with full audit trail
- ✅ Atomic cascade delete of all child records
- ✅ Preserves all data (DynamoDB + S3)
- ❌ No S3 file cleanup
- ❌ No automated data retention policy
- ❌ No hard delete option for compliance

**Best For:**

- Audit requirements
- Data recovery needs
- Early-stage product (flexibility)

**Consider Improving If:**

- Storage costs become significant
- Compliance requires hard deletion
- Need to implement data retention policies
- Want to optimize storage usage


