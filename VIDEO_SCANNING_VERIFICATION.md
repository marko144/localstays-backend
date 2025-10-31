# Video File Scanning & Processing Verification

**Date:** 2025-10-31  
**Status:** ✅ **FULLY IMPLEMENTED**

---

## Summary

**YES** - Both property verification videos and LIVE*ID_CHECK videos go through the complete `veri*` pipeline with GuardDuty malware scanning.

---

## 📋 Video File Types Covered

| Video Type         | Use Case                                | S3 Key Pattern                        | Status     |
| ------------------ | --------------------------------------- | ------------------------------------- | ---------- |
| **Property Video** | Admin-requested property verification   | `veri_property-video_{requestId}.ext` | ✅ Scanned |
| **LIVE_ID_CHECK**  | Host identity verification with ID card | `veri_live-id-check_{requestId}.ext`  | ✅ Scanned |

---

## 🔄 Complete Video Processing Flow

### 1. Property Video Verification

**Endpoint**: `POST /api/v1/hosts/{hostId}/listings/{listingId}/requests/{requestId}/submit-video-intent`

**File**: `backend/services/api/hosts/submit-video-intent.ts`

```typescript
// Line 130: Generate S3 key at BUCKET ROOT with veri_ prefix
const s3Key = `veri_property-video_${requestId}.${fileExtension}`;
const finalS3Key = `${hostId}/listings/${listingId}/verification/property-video-${requestId}.${fileExtension}`;

// Line 134: Generate pre-signed URL with metadata
const uploadUrl = await generateUploadUrl(
  s3Key,
  videoContentType,
  expirySeconds,
  {
    hostId,
    listingId,
    requestId,
  }
);
```

**Flow**:

1. ✅ Upload to: `veri_property-video_{requestId}.mp4` (bucket root)
2. ✅ GuardDuty scans automatically
3. ✅ EventBridge captures scan result
4. ✅ SQS queues message to verification processor
5. ✅ Lambda moves to: `{hostId}/listings/{listingId}/verification/property-video-{requestId}.mp4`
6. ✅ DynamoDB updated with `videoUrl` and status `RECEIVED`

---

### 2. LIVE_ID_CHECK Video

**Endpoint**: `POST /api/v1/hosts/{hostId}/requests/{requestId}/submit-intent`

**File**: `backend/services/api/requests/submit-intent.ts`

```typescript
// Line 114: Generate S3 key at BUCKET ROOT with veri_ prefix
const s3Key = `veri_live-id-check_${requestId}.${fileExtension}`;
const finalS3Key = `${hostId}/requests/${requestId}/live-id-check.${fileExtension}`;

// Line 118: Generate pre-signed URL with metadata
const uploadUrl = await generateUploadUrl(s3Key, contentType, expirySeconds, {
  hostId,
  requestId,
});
```

**Flow**:

1. ✅ Upload to: `veri_live-id-check_{requestId}.mp4` (bucket root)
2. ✅ GuardDuty scans automatically
3. ✅ EventBridge captures scan result
4. ✅ SQS queues message to verification processor
5. ✅ Lambda moves to: `{hostId}/requests/{requestId}/live-id-check.mp4`
6. ✅ DynamoDB updated with `videoUrl` and status `RECEIVED`

---

## 🛡️ EventBridge Rule Configuration

**File**: `infra/lib/api-lambda-stack.ts` (lines 444-462)

```typescript
const guardDutyRuleVerification = new events.Rule(
  this,
  "GuardDutyScanCompleteVerification",
  {
    ruleName: `${stage}-guardduty-scan-complete-verification`,
    description:
      "Capture GuardDuty malware scan completion events for verification files",
    eventPattern: {
      source: ["aws.guardduty"],
      detailType: ["GuardDuty Malware Protection Object Scan Result"],
      detail: {
        scanStatus: ["COMPLETED"],
        s3ObjectDetails: {
          bucketName: [bucket.bucketName],
          objectKey: [{ prefix: "veri_" }], // ✅ Catches ALL veri_ files
        },
      },
    },
  }
);
```

**Coverage**:

- ✅ `veri_profile-doc_*` (profile documents)
- ✅ `veri_listing-doc_*` (listing documents)
- ✅ `veri_property-video_*` (property videos)
- ✅ `veri_live-id-check_*` (LIVE_ID_CHECK videos)

---

## 🔧 Verification Processor Lambda

**File**: `backend/services/verification-processor/index.js`

### Property Video Handling (Lines 255-264)

```javascript
// Property video: veri_property-video_{requestId}.ext
if (s3Key.startsWith("veri_property-video_")) {
  return {
    pk: `LISTING#${listingId}`,
    sk: `REQUEST#${requestId}`,
    finalS3Key: `${hostId}/listings/${listingId}/verification/property-video-${requestId}.${ext}`,
    quarantineKey: `${hostId}/listings/${listingId}/quarantine/${s3Key}`,
    isVideo: true, // ✅ Recognized as video
  };
}
```

### LIVE_ID_CHECK Handling (Lines 266-275)

```javascript
// LIVE_ID_CHECK: veri_live-id-check_{requestId}.ext
if (s3Key.startsWith("veri_live-id-check_")) {
  return {
    pk: `HOST#${hostId}`,
    sk: `REQUEST#${requestId}`,
    finalS3Key: `${hostId}/requests/${requestId}/live-id-check.${ext}`,
    quarantineKey: `${hostId}/quarantine/${s3Key}`,
    isVideo: true, // ✅ Recognized as video
  };
}
```

### Video-Specific DynamoDB Update (Lines 182-196)

```javascript
if (isVideo) {
  // For videos, update videoUrl (not s3Key)
  await docClient.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { pk, sk },
      UpdateExpression:
        "SET videoUrl = :videoUrl, fileSize = :fileSize, #status = :status, updatedAt = :now",
      ExpressionAttributeNames: {
        "#status": "status",
      },
      ExpressionAttributeValues: {
        ":videoUrl": `https://${bucket}.s3.${region}.amazonaws.com/${finalS3Key}`,
        ":fileSize": fileSize,
        ":status": "RECEIVED", // ✅ Video status
        ":now": now,
      },
    })
  );
}
```

---

## 🦠 Malware Detection for Videos

Both video types are **fully protected** against malware:

### If Infected (THREATS_FOUND)

1. ✅ Video copied to quarantine:

   - Property video: `{hostId}/listings/{listingId}/quarantine/veri_property-video_{requestId}.mp4`
   - LIVE*ID_CHECK: `{hostId}/quarantine/veri_live-id-check*{requestId}.mp4`

2. ✅ Original file deleted from root

3. ✅ DynamoDB record updated:

   - Status: `QUARANTINED`
   - Malware log entry created with threat names

4. ✅ Video never reaches final destination

### If Clean (NO_THREATS_FOUND)

1. ✅ Video copied to final destination:

   - Property video: `{hostId}/listings/{listingId}/verification/property-video-{requestId}.mp4`
   - LIVE_ID_CHECK: `{hostId}/requests/{requestId}/live-id-check.mp4`

2. ✅ Original file deleted from root

3. ✅ DynamoDB record updated:
   - Status: `RECEIVED`
   - `videoUrl`: Full S3 URL for admin/host to view
   - `fileSize`: Video file size in bytes

---

## 📊 File Constraints

### Property Video Verification

| Setting       | Value                                               |
| ------------- | --------------------------------------------------- |
| Max File Size | 200 MB                                              |
| Allowed Types | `video/mp4`, `video/mov`, `video/webm`              |
| Upload Expiry | 60 minutes (1 hour)                                 |
| Source        | `backend/services/api/hosts/submit-video-intent.ts` |

### LIVE_ID_CHECK Video

| Setting       | Value                                            |
| ------------- | ------------------------------------------------ |
| Max File Size | 100 MB                                           |
| Allowed Types | `video/mp4`, `video/mov`, `video/webm`           |
| Upload Expiry | 30 minutes                                       |
| Source        | `backend/services/api/requests/submit-intent.ts` |

---

## 🔍 Verification Checklist

| Item                           | Property Video | LIVE_ID_CHECK | Evidence                              |
| ------------------------------ | -------------- | ------------- | ------------------------------------- |
| **Uses `veri_` prefix**        | ✅ Yes         | ✅ Yes        | Lines 130, 114                        |
| **Uploaded to bucket root**    | ✅ Yes         | ✅ Yes        | S3 key structure                      |
| **S3 metadata attached**       | ✅ Yes         | ✅ Yes        | Lines 134, 118                        |
| **GuardDuty scans**            | ✅ Yes         | ✅ Yes        | EventBridge rule                      |
| **EventBridge captures**       | ✅ Yes         | ✅ Yes        | `prefix: 'veri_'` filter              |
| **SQS queues message**         | ✅ Yes         | ✅ Yes        | Target: `verificationProcessingQueue` |
| **Lambda processes**           | ✅ Yes         | ✅ Yes        | Lines 255-264, 266-275                |
| **Moves to final destination** | ✅ Yes         | ✅ Yes        | Lines 164-178                         |
| **Updates DynamoDB**           | ✅ Yes         | ✅ Yes        | Lines 182-196                         |
| **Handles malware**            | ✅ Yes         | ✅ Yes        | Lines 76-137                          |
| **Quarantine on infection**    | ✅ Yes         | ✅ Yes        | Lines 100-104                         |

---

## 📁 File Structure Reference

### Before Scanning (Bucket Root)

```
s3://localstays-dev1-host-assets/
├── veri_property-video_req_abc123.mp4       ← Property video
├── veri_live-id-check_req_xyz789.mp4        ← LIVE_ID_CHECK video
├── veri_listing-doc_listing_..._.jpg        ← Listing document
└── veri_profile-doc_doc_..._.pdf            ← Profile document
```

### After Clean Scan (Final Destinations)

```
s3://localstays-dev1-host-assets/
└── host_821384cf.../
    ├── requests/
    │   └── req_xyz789/
    │       └── live-id-check.mp4            ← LIVE_ID_CHECK (moved)
    └── listings/
        └── listing_8a876174.../
            └── verification/
                ├── property-video-req_abc123.mp4  ← Property video (moved)
                ├── PROOF_OF_RIGHT_TO_LIST.jpg     ← Listing doc (moved)
                └── ...
```

### After Infected Scan (Quarantine)

```
s3://localstays-dev1-host-assets/
└── host_821384cf.../
    ├── quarantine/
    │   └── veri_live-id-check_req_xyz789.mp4   ← Quarantined LIVE_ID_CHECK
    └── listings/
        └── listing_8a876174.../
            └── quarantine/
                └── veri_property-video_req_abc123.mp4  ← Quarantined property video
```

---

## 🎯 Key Differences from Image Processing

| Feature              | Images (`lstimg_`)        | Videos (`veri_`)                    |
| -------------------- | ------------------------- | ----------------------------------- |
| **Prefix**           | `lstimg_`                 | `veri_`                             |
| **Processing**       | Resize + WebP conversion  | **No processing** (just move)       |
| **Lambda**           | Image Processor (2048 MB) | Verification Processor (512 MB)     |
| **EventBridge Rule** | `GuardDutyScanComplete`   | `GuardDutyScanCompleteVerification` |
| **SQS Queue**        | `image-processing-queue`  | `verification-processing-queue`     |
| **DynamoDB Field**   | `s3Key`, `thumbnailS3Key` | `videoUrl`                          |
| **Final Status**     | `READY`                   | `RECEIVED`                          |

---

## ✅ Conclusion

**All video files are protected:**

1. ✅ **Property Video Verification** - Full `veri_` pipeline with malware scanning
2. ✅ **LIVE_ID_CHECK Videos** - Full `veri_` pipeline with malware scanning
3. ✅ **EventBridge** - Captures all `veri_*` files (no exclusions)
4. ✅ **Verification Processor** - Explicitly handles both video types
5. ✅ **Quarantine** - Infected videos are quarantined, never reach final destination
6. ✅ **DynamoDB** - Proper status tracking and malware logging

**No gaps in coverage** - Every video uploaded to the system goes through GuardDuty malware protection.

---

**Last Updated**: 2025-10-31
