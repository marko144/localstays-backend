# Live ID Check: Add Image Upload (Video + Image)

**Date:** 2025-11-29  
**Status:** 🔍 **ASSESSMENT - NOT IMPLEMENTED**

---

## 📋 Requirement

**Current:** LIVE_ID_CHECK request accepts **1 video only**

**New:** LIVE_ID_CHECK request accepts **1 video + 1 image** (both required)

**Storage:** Both files stored under same REQUEST record, both tracked in DynamoDB

---

## 🎯 Design Pattern

Following the **existing profile document submission pattern** which handles multiple files per submission:

- Profile submission generates **multiple upload URLs** in a single `submit-intent` call
- Frontend uploads all files to their respective pre-signed URLs
- Each file goes through GuardDuty malware scanning
- `confirm-submission` validates all files are uploaded
- Verification processor moves each file to final destination

---

## 🔄 Proposed Flow

### Step 1: Submit Intent (Enhanced)

**Endpoint:** `POST /api/v1/hosts/{hostId}/requests/{requestId}/submit-intent`

**Current Request Body:**

```json
{
  "contentType": "video/mp4"
}
```

**New Request Body:**

```json
{
  "videoContentType": "video/mp4",
  "imageContentType": "image/jpeg"
}
```

**Current Response:**

```json
{
  "requestId": "req_123...",
  "submissionToken": "req_sub_456...",
  "uploadUrl": "https://s3.presigned.url/for/video",
  "expiresAt": "2025-11-29T12:00:00Z",
  "maxFileSizeMB": 100
}
```

**New Response:**

```json
{
  "requestId": "req_123...",
  "submissionToken": "req_sub_456...",
  "videoUploadUrl": "https://s3.presigned.url/for/video",
  "imageUploadUrl": "https://s3.presigned.url/for/image",
  "expiresAt": "2025-11-29T12:00:00Z",
  "maxVideoSizeMB": 100,
  "maxImageSizeMB": 10
}
```

---

### Step 2: Frontend Uploads Both Files

**Frontend code:**

```javascript
// 1. Get upload URLs
const { videoUploadUrl, imageUploadUrl } = await submitIntent({
  videoContentType: videoFile.type,
  imageContentType: imageFile.type,
});

// 2. Upload both files in parallel
await Promise.all([
  fetch(videoUploadUrl, {
    method: "PUT",
    headers: { "Content-Type": videoFile.type },
    body: videoFile,
  }),
  fetch(imageUploadUrl, {
    method: "PUT",
    headers: { "Content-Type": imageFile.type },
    body: imageFile,
  }),
]);

// 3. Confirm both uploads
await confirmSubmission({ submissionToken });
```

---

### Step 3: GuardDuty Scans Both Files

**S3 Keys at bucket root:**

- Video: `veri_live-id-check-video_{requestId}.mp4`
- Image: `veri_live-id-check-image_{requestId}.jpg`

**EventBridge** captures scan results for both files independently.

---

### Step 4: Confirm Submission (Enhanced)

**Endpoint:** `POST /api/v1/hosts/{hostId}/requests/{requestId}/confirm-submission`

**Current Behavior:**

- Checks for uploaded file by testing extensions: `['mp4', 'mov', 'webm']`
- Validates file size
- Updates DynamoDB with `s3Url` and `status: 'RECEIVED'`

**New Behavior:**

- Checks for **TWO files**:
  - Video: Tests `veri_live-id-check-video_{requestId}.{ext}` (mp4, mov, webm)
  - Image: Tests `veri_live-id-check-image_{requestId}.{ext}` (jpg, jpeg, png, webp)
- Validates both files exist
- Validates both file sizes
- Updates DynamoDB with `videoS3Url`, `imageS3Url`, and `status: 'RECEIVED'`

---

### Step 5: Verification Processor (Enhanced)

**Current S3 Key Pattern:**

- `veri_live-id-check_{requestId}.{ext}`

**New S3 Key Patterns:**

- `veri_live-id-check-video_{requestId}.{ext}` → Video file
- `veri_live-id-check-image_{requestId}.{ext}` → Image file

**Processor Logic:**

```javascript
// Detect file type by S3 key prefix
if (s3Key.startsWith("veri_live-id-check-video_")) {
  // Handle video
  const requestId = extractRequestIdFromKey(s3Key);
  return {
    pk: `HOST#${hostId}`,
    sk: `REQUEST#${requestId}`,
    finalS3Key: `${hostId}/requests/${requestId}/live-id-check-video.${extension}`,
    quarantineKey: `${hostId}/quarantine/${s3Key}`,
    isVideo: true,
    fileType: "VIDEO",
  };
}

if (s3Key.startsWith("veri_live-id-check-image_")) {
  // Handle image
  const requestId = extractRequestIdFromKey(s3Key);
  return {
    pk: `HOST#${hostId}`,
    sk: `REQUEST#${requestId}`,
    finalS3Key: `${hostId}/requests/${requestId}/live-id-check-image.${extension}`,
    quarantineKey: `${hostId}/quarantine/${s3Key}`,
    isVideo: false,
    fileType: "IMAGE",
  };
}
```

**DynamoDB Update:**

```javascript
// For video file
await docClient.send(
  new UpdateCommand({
    TableName: TABLE_NAME,
    Key: { pk, sk },
    UpdateExpression:
      "SET videoUrl = :url, videoFileSize = :size, videoUploadedAt = :now, updatedAt = :now",
    ExpressionAttributeValues: {
      ":url": `https://${bucket}.s3.${region}.amazonaws.com/${finalS3Key}`,
      ":size": fileSize,
      ":now": now,
    },
  })
);

// For image file
await docClient.send(
  new UpdateCommand({
    TableName: TABLE_NAME,
    Key: { pk, sk },
    UpdateExpression:
      "SET imageUrl = :url, imageFileSize = :size, imageUploadedAt = :now, #status = :status, updatedAt = :now",
    ExpressionAttributeNames: {
      "#status": "status",
    },
    ExpressionAttributeValues: {
      ":url": `https://${bucket}.s3.${region}.amazonaws.com/${finalS3Key}`,
      ":size": fileSize,
      ":status": "RECEIVED", // Only set to RECEIVED when image arrives (assumes image comes after video)
      ":now": now,
    },
  })
);
```

**Important:** We need to handle the case where files arrive in **any order** (video first or image first).

---

## 📊 DynamoDB Schema Changes

**File:** `backend/services/types/request.types.ts`

### Before:

```typescript
export interface Request {
  // ... existing fields ...

  // LIVE_ID_CHECK fields
  s3Key?: string;
  s3Url?: string;
  fileSize?: number;
  contentType?: string;
  uploadedAt?: string;

  // ... rest ...
}
```

### After:

```typescript
export interface Request {
  // ... existing fields ...

  // LIVE_ID_CHECK fields (NEW: separate video and image tracking)
  videoUrl?: string; // S3 URL of video file
  videoFileSize?: number; // Video file size in bytes
  videoContentType?: string; // video/mp4, video/mov, video/webm
  videoUploadedAt?: string; // ISO timestamp

  imageUrl?: string; // S3 URL of image file
  imageFileSize?: number; // Image file size in bytes
  imageContentType?: string; // image/jpeg, image/png, image/webp
  imageUploadedAt?: string; // ISO timestamp

  // Legacy fields (keep for backward compatibility with old LIVE_ID_CHECK requests)
  s3Key?: string; // DEPRECATED
  s3Url?: string; // DEPRECATED
  fileSize?: number; // DEPRECATED
  contentType?: string; // DEPRECATED
  uploadedAt?: string; // DEPRECATED

  // ... rest ...
}
```

**Backward Compatibility:**

- Old LIVE_ID_CHECK requests (video only) still use `s3Url`, `fileSize`, etc.
- New LIVE_ID_CHECK requests (video + image) use `videoUrl`, `imageUrl`, etc.
- Admin frontend checks both sets of fields

---

## 📝 Files to Modify

| File                                                  | Changes                                                                                                                                    | Complexity |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ---------- |
| `backend/services/types/request.types.ts`             | Add `videoUrl`, `imageUrl`, `videoFileSize`, `imageFileSize`, `videoContentType`, `imageContentType`, `videoUploadedAt`, `imageUploadedAt` | 🟢 Low     |
| `backend/services/api/requests/submit-intent.ts`      | Accept `videoContentType` + `imageContentType`, generate **2 upload URLs**                                                                 | 🟡 Medium  |
| `backend/services/api/requests/confirm-submission.ts` | Check for **2 files** (video + image), validate both exist                                                                                 | 🟡 Medium  |
| `backend/services/verification-processor/index.js`    | Handle **2 new S3 key patterns**: `veri_live-id-check-video_` and `veri_live-id-check-image_`                                              | 🟡 Medium  |
| `backend/services/api/admin/requests/get-request.ts`  | Return `videoUrl` + `imageUrl` in response                                                                                                 | 🟢 Low     |
| `REQUESTS_API_SPEC.md`                                | Update API documentation                                                                                                                   | 🟢 Low     |

**Total Effort:** ~3-4 hours development + 1-2 hours testing

---

## 🔍 Implementation Details

### 1. Update Submit Intent

**File:** `backend/services/api/requests/submit-intent.ts`

```typescript
// Constants
const SUBMISSION_TOKEN_EXPIRY_MINUTES = 30;
const MAX_VIDEO_SIZE_MB = 100;
const MAX_IMAGE_SIZE_MB = 10;

const ALLOWED_VIDEO_TYPES = ["video/mp4", "video/mov", "video/webm"];
const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

interface SubmitRequestIntentRequest {
  videoContentType: string; // NEW
  imageContentType: string; // NEW
}

interface SubmitRequestIntentResponse {
  requestId: string;
  submissionToken: string;
  videoUploadUrl: string; // NEW
  imageUploadUrl: string; // NEW
  expiresAt: string;
  maxVideoSizeMB: number; // NEW
  maxImageSizeMB: number; // NEW
}

export async function handler(
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> {
  // ... auth and validation ...

  const { videoContentType, imageContentType } = requestBody;

  // Validate content types
  if (!videoContentType || !ALLOWED_VIDEO_TYPES.includes(videoContentType)) {
    return response.badRequest(
      `Invalid video content type. Allowed: ${ALLOWED_VIDEO_TYPES.join(", ")}`
    );
  }

  if (!imageContentType || !ALLOWED_IMAGE_TYPES.includes(imageContentType)) {
    return response.badRequest(
      `Invalid image content type. Allowed: ${ALLOWED_IMAGE_TYPES.join(", ")}`
    );
  }

  // ... fetch request, validate status ...

  // Generate submission token
  const submissionToken = `req_sub_${randomUUID()}`;
  const tokenExpiresAt = new Date(
    Date.now() + SUBMISSION_TOKEN_EXPIRY_MINUTES * 60 * 1000
  );

  // Determine file extensions
  const videoExtension = getFileExtension(videoContentType);
  const imageExtension = getFileExtension(imageContentType);

  // Generate S3 keys at BUCKET ROOT with veri_ prefix
  const videoS3Key = `veri_live-id-check-video_${requestId}.${videoExtension}`;
  const imageS3Key = `veri_live-id-check-image_${requestId}.${imageExtension}`;

  const finalVideoS3Key = `${hostId}/requests/${requestId}/live-id-check-video.${videoExtension}`;
  const finalImageS3Key = `${hostId}/requests/${requestId}/live-id-check-image.${imageExtension}`;

  // Generate pre-signed URLs (expires in 30 minutes)
  const [videoUploadUrl, imageUploadUrl] = await Promise.all([
    generateUploadUrl(
      videoS3Key,
      videoContentType,
      SUBMISSION_TOKEN_EXPIRY_MINUTES * 60,
      {
        hostId,
        requestId,
        fileType: "VIDEO",
      }
    ),
    generateUploadUrl(
      imageS3Key,
      imageContentType,
      SUBMISSION_TOKEN_EXPIRY_MINUTES * 60,
      {
        hostId,
        requestId,
        fileType: "IMAGE",
      }
    ),
  ]);

  // Update request with submission token and S3 keys
  await docClient.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: {
        pk: `HOST#${hostId}`,
        sk: `REQUEST#${requestId}`,
      },
      UpdateExpression:
        "SET submissionToken = :token, submissionTokenExpiresAt = :expiresAt, " +
        "videoS3Key = :videoS3Key, finalVideoS3Key = :finalVideoS3Key, videoContentType = :videoContentType, " +
        "imageS3Key = :imageS3Key, finalImageS3Key = :finalImageS3Key, imageContentType = :imageContentType, " +
        "updatedAt = :now",
      ExpressionAttributeValues: {
        ":token": submissionToken,
        ":expiresAt": tokenExpiresAt.toISOString(),
        ":videoS3Key": videoS3Key,
        ":finalVideoS3Key": finalVideoS3Key,
        ":videoContentType": videoContentType,
        ":imageS3Key": imageS3Key,
        ":finalImageS3Key": finalImageS3Key,
        ":imageContentType": imageContentType,
        ":now": new Date().toISOString(),
      },
    })
  );

  // Build response
  const intentResponse: SubmitRequestIntentResponse = {
    requestId,
    submissionToken,
    videoUploadUrl,
    imageUploadUrl,
    expiresAt: tokenExpiresAt.toISOString(),
    maxVideoSizeMB: MAX_VIDEO_SIZE_MB,
    maxImageSizeMB: MAX_IMAGE_SIZE_MB,
  };

  return response.success(intentResponse);
}

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

  return map[contentType.toLowerCase()] || "mp4";
}
```

---

### 2. Update Confirm Submission

**File:** `backend/services/api/requests/confirm-submission.ts`

```typescript
export async function handler(
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> {
  // ... auth, validation, fetch request ...

  // Determine S3 keys based on content types stored during intent
  const videoExtensions = ["mp4", "mov", "webm"];
  const imageExtensions = ["jpg", "jpeg", "png", "webp"];

  let videoS3Key: string | null = null;
  let videoMetadata: any = null;

  let imageS3Key: string | null = null;
  let imageMetadata: any = null;

  // Find video file
  for (const ext of videoExtensions) {
    const testKey = `veri_live-id-check-video_${requestId}.${ext}`;
    try {
      const headResult = await s3Client.send(
        new HeadObjectCommand({ Bucket: BUCKET_NAME, Key: testKey })
      );
      videoS3Key = testKey;
      videoMetadata = headResult;
      break;
    } catch (error: any) {
      if (error.name !== "NotFound") throw error;
    }
  }

  // Find image file
  for (const ext of imageExtensions) {
    const testKey = `veri_live-id-check-image_${requestId}.${ext}`;
    try {
      const headResult = await s3Client.send(
        new HeadObjectCommand({ Bucket: BUCKET_NAME, Key: testKey })
      );
      imageS3Key = testKey;
      imageMetadata = headResult;
      break;
    } catch (error: any) {
      if (error.name !== "NotFound") throw error;
    }
  }

  // Verify BOTH files exist
  if (!videoS3Key || !videoMetadata) {
    return response.badRequest(
      "Video file not found in S3. Please upload the video file first."
    );
  }

  if (!imageS3Key || !imageMetadata) {
    return response.badRequest(
      "Image file not found in S3. Please upload the image file first."
    );
  }

  // Validate file sizes
  const videoFileSize = videoMetadata.ContentLength || 0;
  const imageFileSize = imageMetadata.ContentLength || 0;

  const maxVideoBytes = 100 * 1024 * 1024; // 100MB
  const maxImageBytes = 10 * 1024 * 1024; // 10MB

  if (videoFileSize > maxVideoBytes) {
    return response.badRequest(
      `Video file size (${Math.round(
        videoFileSize / 1024 / 1024
      )}MB) exceeds maximum (100MB)`
    );
  }

  if (videoFileSize === 0) {
    return response.badRequest("Uploaded video file is empty");
  }

  if (imageFileSize > maxImageBytes) {
    return response.badRequest(
      `Image file size (${Math.round(
        imageFileSize / 1024 / 1024
      )}MB) exceeds maximum (10MB)`
    );
  }

  if (imageFileSize === 0) {
    return response.badRequest("Uploaded image file is empty");
  }

  // Update request status to RECEIVED
  const now = new Date().toISOString();

  await docClient.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: {
        pk: `HOST#${hostId}`,
        sk: `REQUEST#${requestId}`,
      },
      UpdateExpression:
        "SET #status = :status, " +
        "videoS3Key = :videoS3Key, videoS3Url = :videoS3Url, videoFileSize = :videoFileSize, videoContentType = :videoContentType, videoUploadedAt = :uploadedAt, " +
        "imageS3Key = :imageS3Key, imageS3Url = :imageS3Url, imageFileSize = :imageFileSize, imageContentType = :imageContentType, imageUploadedAt = :uploadedAt, " +
        "updatedAt = :updatedAt, gsi2sk = :gsi2sk " +
        "REMOVE submissionToken, submissionTokenExpiresAt",
      ExpressionAttributeNames: {
        "#status": "status",
      },
      ExpressionAttributeValues: {
        ":status": "RECEIVED",
        ":videoS3Key": videoS3Key,
        ":videoS3Url": `s3://${BUCKET_NAME}/${videoS3Key}`,
        ":videoFileSize": videoFileSize,
        ":videoContentType": videoMetadata.ContentType,
        ":imageS3Key": imageS3Key,
        ":imageS3Url": `s3://${BUCKET_NAME}/${imageS3Key}`,
        ":imageFileSize": imageFileSize,
        ":imageContentType": imageMetadata.ContentType,
        ":uploadedAt": now,
        ":updatedAt": now,
        ":gsi2sk": `STATUS#RECEIVED#${now}`,
      },
    })
  );

  return response.success({
    requestId,
    status: "RECEIVED",
    message: "Live ID check video and image received successfully",
  });
}
```

---

### 3. Update Verification Processor

**File:** `backend/services/verification-processor/index.js`

```javascript
async function determineFileType(s3Key, metadata) {
  const hostId = metadata.hostid;
  const requestId = metadata.requestid;

  // ... existing handlers for profile-doc, listing-doc, property-video ...

  // LIVE_ID_CHECK Video: veri_live-id-check-video_{requestId}.ext
  if (s3Key.startsWith("veri_live-id-check-video_")) {
    const extension = s3Key.split(".").pop().toLowerCase();
    return {
      pk: `HOST#${hostId}`,
      sk: `REQUEST#${requestId}`,
      finalS3Key: `${hostId}/requests/${requestId}/live-id-check-video.${extension}`,
      quarantineKey: `${hostId}/quarantine/${s3Key}`,
      isVideo: true,
      fileType: "VIDEO",
    };
  }

  // LIVE_ID_CHECK Image: veri_live-id-check-image_{requestId}.ext
  if (s3Key.startsWith("veri_live-id-check-image_")) {
    const extension = s3Key.split(".").pop().toLowerCase();
    return {
      pk: `HOST#${hostId}`,
      sk: `REQUEST#${requestId}`,
      finalS3Key: `${hostId}/requests/${requestId}/live-id-check-image.${extension}`,
      quarantineKey: `${hostId}/quarantine/${s3Key}`,
      isVideo: false,
      fileType: "IMAGE",
    };
  }

  console.error(`Unknown verification file type: ${s3Key}`);
  return {};
}

async function handleCleanFile(bucket, key) {
  // ... existing logic ...

  const { pk, sk, finalS3Key, isVideo, fileType } = await determineFileType(
    key,
    metadata
  );

  // ... copy to final destination, delete from root ...

  // Update DynamoDB based on file type
  if (fileType === "VIDEO") {
    // Update video fields
    await docClient.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { pk, sk },
        UpdateExpression:
          "SET videoUrl = :url, videoFileSize = :size, videoProcessedAt = :now, updatedAt = :now",
        ConditionExpression: "attribute_exists(pk)",
        ExpressionAttributeValues: {
          ":url": `https://${bucket}.s3.${process.env.AWS_REGION}.amazonaws.com/${finalS3Key}`,
          ":size": fileSize,
          ":now": now,
        },
      })
    );
  } else if (fileType === "IMAGE") {
    // Update image fields AND set status to RECEIVED (assumes image arrives last)
    await docClient.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { pk, sk },
        UpdateExpression:
          "SET imageUrl = :url, imageFileSize = :size, imageProcessedAt = :now, #status = :status, updatedAt = :now",
        ConditionExpression: "attribute_exists(pk)",
        ExpressionAttributeNames: {
          "#status": "status",
        },
        ExpressionAttributeValues: {
          ":url": `https://${bucket}.s3.${process.env.AWS_REGION}.amazonaws.com/${finalS3Key}`,
          ":size": fileSize,
          ":status": "RECEIVED",
          ":now": now,
        },
      })
    );
  }

  console.log(`✅ Successfully moved ${key} to ${finalS3Key}`);
}
```

**Note:** The processor sets `status: 'RECEIVED'` when the **image** file is processed. This assumes the image arrives after the video, but we should handle both orders gracefully.

**Better approach:** Use a **conditional update** to only set status to `RECEIVED` if **both** `videoUrl` and `imageUrl` are present:

```javascript
UpdateExpression: 'SET imageUrl = :url, imageFileSize = :size, imageProcessedAt = :now, #status = if_not_exists(videoUrl, :pendingStatus, :receivedStatus), updatedAt = :now',
```

But DynamoDB doesn't support conditional expressions in `SET` clauses like this. Instead, we could:

1. **Option A (Simple):** Assume image always arrives second, set status when image is processed
2. **Option B (Robust):** Check if both files exist before setting status:

```javascript
// When processing video
if (fileType === "VIDEO") {
  // Check if image already exists
  const request = await getRequest(pk, sk);
  const status = request.imageUrl ? "RECEIVED" : "PENDING_UPLOAD";

  await docClient.send(
    new UpdateCommand({
      // ... update videoUrl and set status
    })
  );
}

// When processing image
if (fileType === "IMAGE") {
  // Check if video already exists
  const request = await getRequest(pk, sk);
  const status = request.videoUrl ? "RECEIVED" : "PENDING_UPLOAD";

  await docClient.send(
    new UpdateCommand({
      // ... update imageUrl and set status
    })
  );
}
```

**Recommendation:** Use **Option B** for robustness.

---

## 🧪 Testing Strategy

### Unit Tests

- [ ] Submit intent with valid video + image content types
- [ ] Submit intent with missing video content type (should fail)
- [ ] Submit intent with missing image content type (should fail)
- [ ] Submit intent with invalid video type (should fail)
- [ ] Submit intent with invalid image type (should fail)
- [ ] Confirm submission with both files uploaded (should succeed)
- [ ] Confirm submission with only video uploaded (should fail)
- [ ] Confirm submission with only image uploaded (should fail)
- [ ] Confirm submission with oversized video (should fail)
- [ ] Confirm submission with oversized image (should fail)
- [ ] Verification processor handles video file correctly
- [ ] Verification processor handles image file correctly
- [ ] Verification processor sets status to RECEIVED when both files processed

### Integration Tests

- [ ] Full flow: Submit intent → Upload video + image → Confirm → GuardDuty scan → Processor → Admin view
- [ ] Test video arrives first, then image
- [ ] Test image arrives first, then video
- [ ] Test malware-infected video (should quarantine, not affect image)
- [ ] Test malware-infected image (should quarantine, not affect video)
- [ ] Test both files infected (should quarantine both)

### Edge Cases

- [ ] Upload video only, don't upload image (confirm should fail)
- [ ] Upload image only, don't upload video (confirm should fail)
- [ ] Upload wrong file type to video URL (S3 will accept, but confirm will check Content-Type)
- [ ] Token expires before both files uploaded (should fail)
- [ ] Upload both files, but one gets quarantined (status should NOT be RECEIVED)

---

## 🚀 Deployment Plan

### Phase 1: Backend Changes

1. Deploy updated types with new fields (`videoUrl`, `imageUrl`, etc.)
2. Deploy `submit-intent` with dual upload URL generation
3. Deploy `confirm-submission` with dual file validation
4. Deploy `verification-processor` with dual file handling

**Impact:** No breaking changes. Old LIVE_ID_CHECK requests still work with legacy fields.

### Phase 2: Frontend Changes

1. Update request submission UI to collect both video + image
2. Update upload logic to handle 2 pre-signed URLs
3. Update progress indicators (show upload progress for both files)

### Phase 3: Admin Dashboard

1. Update admin request view to display both video + image
2. Add side-by-side or tabbed view for reviewing both files

---

## ✅ Recommendation

**Proceed with this design** because:

1. ✅ **Follows existing pattern** - Mirrors profile document multi-file upload
2. ✅ **Single API call** - Frontend gets both upload URLs at once
3. ✅ **Malware scanning** - Both files scanned independently by GuardDuty
4. ✅ **Backward compatible** - Old requests with video-only still work
5. ✅ **Atomic confirmation** - Both files must be uploaded before status changes to RECEIVED
6. ✅ **Robust error handling** - Each file tracked separately, can quarantine independently

**Estimated Effort:** 3-4 hours development + 1-2 hours testing = **~5-6 hours total**

---

**Last Updated:** 2025-11-29




