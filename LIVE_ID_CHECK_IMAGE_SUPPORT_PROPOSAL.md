# Live ID Check: Add Image Support Proposal

**Date:** 2025-11-29  
**Status:** 🔍 **ASSESSMENT - NOT IMPLEMENTED**

---

## 📋 Executive Summary

**Current State:** LIVE_ID_CHECK requests only accept **video uploads** (mp4, mov, webm).

**Proposed Change:** Extend LIVE_ID_CHECK to accept **either a video OR a single image** (jpg, png, webp).

**Impact:** This requires changes across 5 key components: API endpoints, S3 upload flow, verification processor, DynamoDB schema, and admin review.

---

## 🔄 Current Flow Analysis

### Step 1: Submit Intent

**Endpoint:** `POST /api/v1/hosts/{hostId}/requests/{requestId}/submit-intent`

**File:** `backend/services/api/requests/submit-intent.ts`

**Current Behavior:**

- Accepts only `contentType` in request body
- Validates against `ALLOWED_VIDEO_TYPES`: `['video/mp4', 'video/mov', 'video/webm']`
- Generates S3 key: `veri_live-id-check_{requestId}.{ext}`
- Final S3 key: `{hostId}/requests/{requestId}/live-id-check.{ext}`
- Max file size: **100 MB**
- Upload URL expires in **30 minutes**

```typescript
// Lines 26-29
const SUBMISSION_TOKEN_EXPIRY_MINUTES = 30;
const MAX_FILE_SIZE_MB = 100;
const ALLOWED_VIDEO_TYPES = ["video/mp4", "video/mov", "video/webm"];
```

```typescript
// Lines 113-115
const s3Key = `veri_live-id-check_${requestId}.${fileExtension}`;
const finalS3Key = `${hostId}/requests/${requestId}/live-id-check.${fileExtension}`;
```

---

### Step 2: Host Uploads to S3

**Process:**

- Frontend uploads file to pre-signed S3 URL
- File lands at **bucket root** with `veri_` prefix
- GuardDuty **automatically scans for malware**

---

### Step 3: Confirm Submission

**Endpoint:** `POST /api/v1/hosts/{hostId}/requests/{requestId}/confirm-submission`

**File:** `backend/services/api/requests/confirm-submission.ts`

**Current Behavior:**

- Validates `submissionToken`
- Checks for uploaded file existence by **testing multiple extensions** (mp4, mov, webm)
- Validates file size (≤ 100 MB)
- Updates DynamoDB with `status: 'RECEIVED'`

```typescript
// Lines 106-130: File detection logic
const possibleExtensions = ["mp4", "mov", "webm"];
let s3Key: string | null = null;
let fileMetadata: any = null;

for (const ext of possibleExtensions) {
  const testKey = `veri_live-id-check_${requestId}.${ext}`;
  try {
    const headResult = await s3Client.send(
      new HeadObjectCommand({
        Bucket: BUCKET_NAME,
        Key: testKey,
      })
    );
    // File found!
    s3Key = testKey;
    fileMetadata = headResult;
    break;
  } catch (error: any) {
    // File not found, try next extension
  }
}
```

---

### Step 4: GuardDuty Malware Scan

**Process:**

- EventBridge captures GuardDuty scan result for all `veri_*` files
- Result sent to SQS queue: `verification-processing-queue`
- Lambda `verification-processor` processes the message

---

### Step 5: Verification Processor

**File:** `backend/services/verification-processor/index.js`

**Current Behavior:**

- Detects file type by S3 key prefix: `veri_live-id-check_`
- **CLEAN files:** Copies from root to final destination, updates DynamoDB
- **INFECTED files:** Moves to quarantine, updates status to `QUARANTINED`

```javascript
// Lines 303-312: LIVE_ID_CHECK handling
if (s3Key.startsWith("veri_live-id-check_")) {
  return {
    pk: `HOST#${hostId}`,
    sk: `REQUEST#${requestId}`,
    finalS3Key: `${hostId}/requests/${requestId}/live-id-check.${s3Key
      .split(".")
      .pop()}`,
    quarantineKey: `${hostId}/quarantine/${s3Key}`,
    isVideo: true, // ⚠️ HARDCODED AS VIDEO
  };
}
```

```javascript
// Lines 182-198: Video-specific update
if (isVideo) {
  // For video requests, update videoUrl
  await docClient.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { pk, sk },
      UpdateExpression:
        "SET videoUrl = :videoUrl, fileSize = :fileSize, #status = :status, updatedAt = :now",
      // ...
      ExpressionAttributeValues: {
        ":videoUrl": `https://${bucket}.s3.${process.env.AWS_REGION}.amazonaws.com/${finalS3Key}`,
        ":fileSize": fileSize,
        ":status": "RECEIVED",
        ":now": now,
      },
    })
  );
}
```

**Key Observation:** Updates `videoUrl` field in DynamoDB, assumes it's always a video.

---

### Step 6: Admin Review

**Process:**

- Admin views the request in admin portal
- Admin accesses the `videoUrl` from DynamoDB
- Admin manually reviews the video
- Admin approves/rejects the request

---

## 🎯 Proposed Solution

### Option 1: Single Field Approach (RECOMMENDED)

**Philosophy:** Keep it simple - one file per request, either video OR image.

**Changes Required:**

#### 1. Update Submit Intent API

**File:** `backend/services/api/requests/submit-intent.ts`

```typescript
// Before:
const ALLOWED_VIDEO_TYPES = ["video/mp4", "video/mov", "video/webm"];

// After:
const ALLOWED_CONTENT_TYPES = [
  // Videos
  "video/mp4",
  "video/mov",
  "video/webm",
  // Images
  "image/jpeg",
  "image/png",
  "image/webp",
];
```

**Update validation:**

```typescript
// Line 73-77
if (!ALLOWED_CONTENT_TYPES.includes(contentType)) {
  return response.badRequest(
    `Invalid content type. Allowed types: ${ALLOWED_CONTENT_TYPES.join(", ")}`
  );
}
```

**Add file extension helper:**

```typescript
function getFileExtension(contentType: string): string {
  const map: Record<string, string> = {
    // Videos
    "video/mp4": "mp4",
    "video/mov": "mov",
    "video/webm": "webm",
    // Images
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
  };

  return map[contentType.toLowerCase()] || "jpg";
}
```

**Update max file size:**

```typescript
// Different limits for video vs image
const MAX_VIDEO_SIZE_MB = 100;
const MAX_IMAGE_SIZE_MB = 10; // Images are much smaller

// In handler, determine limit based on contentType
const isVideo = contentType.startsWith("video/");
const maxFileSizeMB = isVideo ? MAX_VIDEO_SIZE_MB : MAX_IMAGE_SIZE_MB;
```

---

#### 2. Update Confirm Submission API

**File:** `backend/services/api/requests/confirm-submission.ts`

**Update file detection logic:**

```typescript
// Lines 106-130: Extend possibleExtensions
const possibleExtensions = [
  // Videos
  "mp4",
  "mov",
  "webm",
  // Images
  "jpg",
  "jpeg",
  "png",
  "webp",
];

// Rest of logic stays the same - still loops through extensions
```

**Update file size validation:**

```typescript
// Lines 137-143: Dynamic size limit based on detected file type
const isVideo = fileMetadata.ContentType?.startsWith("video/");
const maxSizeBytes = isVideo ? 100 * 1024 * 1024 : 10 * 1024 * 1024;

if (fileSize > maxSizeBytes) {
  const maxSizeMB = isVideo ? 100 : 10;
  return response.badRequest(
    `File size (${Math.round(
      fileSize / 1024 / 1024
    )}MB) exceeds maximum allowed size (${maxSizeMB}MB)`
  );
}
```

---

#### 3. Update Verification Processor

**File:** `backend/services/verification-processor/index.js`

**Change `isVideo` detection:**

```javascript
// Lines 303-312: BEFORE
if (s3Key.startsWith("veri_live-id-check_")) {
  return {
    pk: `HOST#${hostId}`,
    sk: `REQUEST#${requestId}`,
    finalS3Key: `${hostId}/requests/${requestId}/live-id-check.${s3Key
      .split(".")
      .pop()}`,
    quarantineKey: `${hostId}/quarantine/${s3Key}`,
    isVideo: true, // ⚠️ HARDCODED
  };
}

// AFTER
if (s3Key.startsWith("veri_live-id-check_")) {
  // Determine if video or image based on file extension
  const extension = s3Key.split(".").pop().toLowerCase();
  const videoExtensions = ["mp4", "mov", "webm"];
  const isVideo = videoExtensions.includes(extension);

  return {
    pk: `HOST#${hostId}`,
    sk: `REQUEST#${requestId}`,
    finalS3Key: `${hostId}/requests/${requestId}/live-id-check.${extension}`,
    quarantineKey: `${hostId}/quarantine/${s3Key}`,
    isVideo, // ✅ DYNAMIC
  };
}
```

**Update DynamoDB field name:**

```javascript
// Lines 182-198: BEFORE - Uses 'videoUrl'
if (isVideo) {
  await docClient.send(
    new UpdateCommand({
      UpdateExpression:
        "SET videoUrl = :videoUrl, fileSize = :fileSize, #status = :status, updatedAt = :now",
      ExpressionAttributeValues: {
        ":videoUrl": `https://${bucket}.s3.${process.env.AWS_REGION}.amazonaws.com/${finalS3Key}`,
        // ...
      },
    })
  );
}

// AFTER - Use generic 'fileUrl' or 'verificationUrl'
if (isVideo) {
  await docClient.send(
    new UpdateCommand({
      UpdateExpression:
        "SET verificationUrl = :url, fileType = :fileType, fileSize = :fileSize, #status = :status, updatedAt = :now",
      ExpressionAttributeValues: {
        ":url": `https://${bucket}.s3.${process.env.AWS_REGION}.amazonaws.com/${finalS3Key}`,
        ":fileType": "VIDEO", // or 'IMAGE'
        ":fileSize": fileSize,
        // ...
      },
    })
  );
} else {
  // Handle image upload
  await docClient.send(
    new UpdateCommand({
      UpdateExpression:
        "SET verificationUrl = :url, fileType = :fileType, fileSize = :fileSize, #status = :status, updatedAt = :now",
      ExpressionAttributeValues: {
        ":url": `https://${bucket}.s3.${process.env.AWS_REGION}.amazonaws.com/${finalS3Key}`,
        ":fileType": "IMAGE",
        ":fileSize": fileSize,
        // ...
      },
    })
  );
}
```

---

#### 4. Update DynamoDB Schema

**File:** `backend/services/types/request.types.ts`

**Add new fields:**

```typescript
export interface Request {
  // ... existing fields ...

  // OLD (keep for backward compatibility)
  videoUrl?: string; // Deprecated - still populated for old PROPERTY_VIDEO_VERIFICATION

  // NEW (for LIVE_ID_CHECK)
  verificationUrl?: string; // URL to video OR image
  fileType?: "VIDEO" | "IMAGE"; // Type of verification file

  // ... rest of fields ...
}
```

**Update API response type:**

```typescript
export interface GetRequestResponse {
  // ... existing fields ...

  videoUrl?: string; // Deprecated - only for PROPERTY_VIDEO_VERIFICATION
  verificationUrl?: string; // NEW - for LIVE_ID_CHECK
  fileType?: "VIDEO" | "IMAGE"; // NEW - indicates file type

  // ... rest of fields ...
}
```

---

#### 5. Update Admin API (if needed)

**Impact:** Admin APIs that fetch LIVE_ID_CHECK requests will now see:

- `verificationUrl` instead of (or in addition to) `videoUrl`
- `fileType` to determine how to display the file (video player vs image)

**Files to check:**

- `backend/services/api/admin/requests/get-request.ts`
- `backend/services/api/admin/requests/list-requests.ts`
- Admin frontend display logic

---

## 📊 Backward Compatibility Strategy

### Approach: Dual Field Support

**For existing LIVE_ID_CHECK requests with videos:**

1. Keep `videoUrl` populated (don't break existing admin views)
2. **Also** populate `verificationUrl` with the same URL
3. Set `fileType: 'VIDEO'`

**For new LIVE_ID_CHECK requests with images:**

1. Leave `videoUrl` undefined
2. Populate `verificationUrl` with image URL
3. Set `fileType: 'IMAGE'`

**Admin Frontend Logic:**

```typescript
// Display file based on type
if (
  request.fileType === "IMAGE" ||
  request.verificationUrl?.match(/\.(jpg|jpeg|png|webp)$/i)
) {
  return <img src={request.verificationUrl} alt="ID Verification" />;
} else if (request.fileType === "VIDEO" || request.videoUrl) {
  const url = request.verificationUrl || request.videoUrl;
  return <video src={url} controls />;
}
```

---

## 🔒 Security Considerations

### 1. Malware Scanning

✅ **No changes needed** - GuardDuty already scans ALL files with `veri_` prefix, including images.

### 2. File Size Limits

✅ **Already handled** - Different limits for video (100 MB) vs image (10 MB).

### 3. Content Type Validation

⚠️ **Add strict validation** - Verify `Content-Type` header matches actual file content (prevent MIME type spoofing).

**Recommendation:** Add file signature validation in confirm-submission:

```typescript
// Read first few bytes and validate against expected signatures
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff];
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47];
const WEBP_SIGNATURE = [0x52, 0x49, 0x46, 0x46]; // RIFF

// Could use a library like 'file-type' for this
```

### 4. Image Processing (Optional Enhancement)

🔮 **Future consideration** - Should images go through the image-processor Lambda for:

- Resize to standard dimensions?
- Strip EXIF data (privacy)?
- Convert to WebP (compression)?

**Current proposal:** Keep images as-is (no processing), just like videos.

---

## 📝 Summary of Files to Modify

| File                                                  | Changes                                                                  | Complexity |
| ----------------------------------------------------- | ------------------------------------------------------------------------ | ---------- |
| `backend/services/api/requests/submit-intent.ts`      | Add image content types, update validation, dynamic file size limits     | 🟡 Medium  |
| `backend/services/api/requests/confirm-submission.ts` | Extend file detection, validate against image types                      | 🟢 Low     |
| `backend/services/verification-processor/index.js`    | Dynamic `isVideo` detection, add `fileType` field, use `verificationUrl` | 🟡 Medium  |
| `backend/services/types/request.types.ts`             | Add `verificationUrl` and `fileType` fields                              | 🟢 Low     |
| `backend/services/api/admin/requests/get-request.ts`  | Return new fields in response                                            | 🟢 Low     |
| `REQUESTS_API_SPEC.md`                                | Update documentation                                                     | 🟢 Low     |

**Total Effort:** ~2-3 hours development + 1 hour testing

---

## 🧪 Testing Strategy

### Unit Tests

- [ ] Submit intent with `image/jpeg` content type
- [ ] Submit intent with `image/png` content type
- [ ] Submit intent with `image/webp` content type
- [ ] Reject invalid content types
- [ ] Enforce 10 MB limit for images
- [ ] Confirm submission detects uploaded image
- [ ] Verification processor correctly identifies image vs video

### Integration Tests

- [ ] Full flow: Submit intent → Upload image → Confirm → Verify malware scan → Admin review
- [ ] Full flow: Submit intent → Upload video → Confirm → Verify malware scan → Admin review
- [ ] Test with actual JPEG file
- [ ] Test with actual PNG file
- [ ] Test with actual WebP file
- [ ] Test backward compatibility: Fetch old LIVE_ID_CHECK with `videoUrl`

### Edge Cases

- [ ] Upload image with video extension (should be rejected by MIME validation)
- [ ] Upload video with image extension (should be rejected)
- [ ] Upload 11 MB image (should be rejected)
- [ ] Upload 50 MB video (should succeed)
- [ ] Malware-infected image (should quarantine)

---

## 🚀 Deployment Plan

### Phase 1: Backend Changes (Safe, No Breaking Changes)

1. Deploy updated types with new `verificationUrl` and `fileType` fields
2. Deploy verification processor with dynamic `isVideo` detection
3. Deploy submit-intent with image support
4. Deploy confirm-submission with extended file detection

**Impact:** Existing LIVE_ID_CHECK videos still work (use `videoUrl`), new requests can use images.

### Phase 2: Frontend Changes

1. Update host dashboard to show "Upload Video or Image" option
2. Update admin dashboard to display images vs videos correctly

### Phase 3: Documentation

1. Update `REQUESTS_API_SPEC.md`
2. Add example frontend code for image uploads

---

## 🤔 Open Questions

1. **Should we allow BOTH video AND image, or force users to choose one?**

   - Current proposal: One file per request (simpler)
   - Alternative: Allow multiple files (more complex)

2. **Should images be processed/resized?**

   - Current proposal: No processing, keep original
   - Alternative: Resize to 1920x1080 max, strip EXIF

3. **What should happen to old `videoUrl` field?**

   - Current proposal: Keep for PROPERTY_VIDEO_VERIFICATION, deprecate for LIVE_ID_CHECK
   - Alternative: Migrate all to `verificationUrl`

4. **Should we validate image dimensions (min/max resolution)?**

   - Current proposal: No validation
   - Alternative: Reject images < 640x480 (too small to verify ID)

5. **Do we need a separate `lstimg_` prefix for images (to route through image-processor)?**
   - Current proposal: No, keep all LIVE*ID_CHECK files with `veri*` prefix
   - Alternative: Route images through image-processor for WebP conversion

---

## ✅ Recommendation

**Proceed with Option 1: Single Field Approach**

**Rationale:**

- Minimal code changes
- No breaking changes for existing LIVE_ID_CHECK videos
- GuardDuty malware scanning already works for images
- Admin can easily view either video or image
- Keeps architecture simple (one file per request)

**Next Steps:**

1. Confirm design with stakeholders
2. Implement backend changes (Phase 1)
3. Test thoroughly in staging
4. Update frontend to support image uploads
5. Deploy to production

---

**Last Updated:** 2025-11-29




