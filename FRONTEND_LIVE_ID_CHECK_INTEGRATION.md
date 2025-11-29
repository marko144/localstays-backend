# Frontend Integration: Live ID Check (Video + Image)

**Date:** 2025-11-29  
**Status:** Ready for Implementation

---

## 📋 Summary

The Live ID Check now requires **2 files**: **1 video + 1 image**.

**Frontend changes:** Minimal - follows existing listing image upload pattern.

---

## 🔄 What Changed

### Before (Single Video):

```typescript
// Step 1: Request upload URL
POST /api/v1/hosts/{hostId}/requests/{requestId}/submit-intent
Body: { contentType: "video/mp4" }

Response: {
  uploadUrl: "https://...",
  maxFileSizeMB: 100
}

// Step 2: Upload
PUT uploadUrl (video file)

// Step 3: Confirm
POST .../confirm-submission
Body: { submissionToken: "..." }
```

### After (Video + Image):

```typescript
// Step 1: Request upload URLs
POST /api/v1/hosts/{hostId}/requests/{requestId}/submit-intent
Body: {
  files: [
    { fileId: "uuid1", contentType: "video/mp4", fileType: "VIDEO" },
    { fileId: "uuid2", contentType: "image/jpeg", fileType: "IMAGE" }
  ]
}

Response: {
  uploadUrls: [
    { fileId: "uuid1", fileType: "VIDEO", uploadUrl: "https://..." },
    { fileId: "uuid2", fileType: "IMAGE", uploadUrl: "https://..." }
  ],
  maxVideoSizeMB: 100,
  maxImageSizeMB: 10
}

// Step 2: Upload both files (parallel)
PUT videoUploadUrl (video file)
PUT imageUploadUrl (image file)

// Step 3: Confirm
POST .../confirm-submission
Body: { submissionToken: "..." }
```

---

## 📝 Implementation Steps

### 1. Generate File IDs

```typescript
import { v4 as uuid } from "uuid";

const videoFileId = uuid();
const imageFileId = uuid();
```

### 2. Call Submit Intent with Files Array

```typescript
const response = await fetch(
  `/api/v1/hosts/${hostId}/requests/${requestId}/submit-intent`,
  {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      files: [
        {
          fileId: videoFileId,
          contentType: videoFile.type, // e.g., "video/mp4"
          fileType: "VIDEO",
        },
        {
          fileId: imageFileId,
          contentType: imageFile.type, // e.g., "image/jpeg"
          fileType: "IMAGE",
        },
      ],
    }),
  }
);

const { uploadUrls, submissionToken, maxVideoSizeMB, maxImageSizeMB } =
  await response.json();
```

### 3. Upload Both Files in Parallel

```typescript
// Find upload URLs
const videoUpload = uploadUrls.find((u) => u.fileType === "VIDEO");
const imageUpload = uploadUrls.find((u) => u.fileType === "IMAGE");

// Upload both files in parallel
await Promise.all([
  fetch(videoUpload.uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": videoFile.type },
    body: videoFile,
  }),
  fetch(imageUpload.uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": imageFile.type },
    body: imageFile,
  }),
]);
```

### 4. Confirm Submission (Same as Before)

```typescript
await fetch(
  `/api/v1/hosts/${hostId}/requests/${requestId}/confirm-submission`,
  {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ submissionToken }),
  }
);
```

---

## 📦 Complete React Example

```typescript
import { useState } from "react";
import { v4 as uuid } from "uuid";

interface UploadLiveIDCheckProps {
  hostId: string;
  requestId: string;
  token: string;
}

export function UploadLiveIDCheck({
  hostId,
  requestId,
  token,
}: UploadLiveIDCheckProps) {
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!videoFile || !imageFile) {
      setError("Please select both video and image files");
      return;
    }

    setUploading(true);
    setError(null);

    try {
      // Step 1: Request upload URLs
      const videoFileId = uuid();
      const imageFileId = uuid();

      const intentResponse = await fetch(
        `${API_URL}/api/v1/hosts/${hostId}/requests/${requestId}/submit-intent`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            files: [
              {
                fileId: videoFileId,
                contentType: videoFile.type,
                fileType: "VIDEO",
              },
              {
                fileId: imageFileId,
                contentType: imageFile.type,
                fileType: "IMAGE",
              },
            ],
          }),
        }
      );

      if (!intentResponse.ok) {
        throw new Error("Failed to get upload URLs");
      }

      const { uploadUrls, submissionToken } = await intentResponse.json();

      // Step 2: Upload both files
      const videoUpload = uploadUrls.find((u: any) => u.fileType === "VIDEO");
      const imageUpload = uploadUrls.find((u: any) => u.fileType === "IMAGE");

      await Promise.all([
        fetch(videoUpload.uploadUrl, {
          method: "PUT",
          headers: { "Content-Type": videoFile.type },
          body: videoFile,
        }),
        fetch(imageUpload.uploadUrl, {
          method: "PUT",
          headers: { "Content-Type": imageFile.type },
          body: imageFile,
        }),
      ]);

      // Step 3: Confirm submission
      const confirmResponse = await fetch(
        `${API_URL}/api/v1/hosts/${hostId}/requests/${requestId}/confirm-submission`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ submissionToken }),
        }
      );

      if (!confirmResponse.ok) {
        throw new Error("Failed to confirm submission");
      }

      alert("Live ID check submitted successfully!");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div>
      <h2>Live ID Check Submission</h2>

      <div>
        <label>
          Video File (max 100 MB):
          <input
            type="file"
            accept="video/mp4,video/mov,video/webm"
            onChange={(e) => setVideoFile(e.target.files?.[0] || null)}
            disabled={uploading}
          />
        </label>
      </div>

      <div>
        <label>
          ID Photo (max 10 MB):
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={(e) => setImageFile(e.target.files?.[0] || null)}
            disabled={uploading}
          />
        </label>
      </div>

      {error && <div style={{ color: "red" }}>{error}</div>}

      <button
        onClick={handleSubmit}
        disabled={uploading || !videoFile || !imageFile}
      >
        {uploading ? "Uploading..." : "Submit Live ID Check"}
      </button>
    </div>
  );
}
```

---

## 🔍 File Validation

### Allowed Types

**Video:**

- `video/mp4` (recommended)
- `video/mov`
- `video/webm`

**Image:**

- `image/jpeg` (recommended)
- `image/png`
- `image/webp`

### File Size Limits

| File Type | Maximum Size |
| --------- | ------------ |
| Video     | 100 MB       |
| Image     | 10 MB        |

### Frontend Validation

```typescript
function validateFiles(videoFile: File, imageFile: File): string | null {
  // Validate video
  const allowedVideoTypes = ["video/mp4", "video/mov", "video/webm"];
  if (!allowedVideoTypes.includes(videoFile.type)) {
    return "Video must be MP4, MOV, or WebM";
  }

  const maxVideoSize = 100 * 1024 * 1024; // 100 MB
  if (videoFile.size > maxVideoSize) {
    return "Video file too large (max 100 MB)";
  }

  // Validate image
  const allowedImageTypes = ["image/jpeg", "image/png", "image/webp"];
  if (!allowedImageTypes.includes(imageFile.type)) {
    return "Image must be JPEG, PNG, or WebP";
  }

  const maxImageSize = 10 * 1024 * 1024; // 10 MB
  if (imageFile.size > maxImageSize) {
    return "Image file too large (max 10 MB)";
  }

  return null; // Valid
}
```

---

## 📊 TypeScript Types

```typescript
// Request
interface SubmitRequestIntentRequest {
  files: Array<{
    fileId: string; // UUID generated by frontend
    contentType: string; // MIME type
    fileType: "VIDEO" | "IMAGE";
  }>;
}

// Response
interface SubmitRequestIntentResponse {
  requestId: string;
  submissionToken: string;
  uploadUrls: Array<{
    fileId: string;
    fileType: "VIDEO" | "IMAGE";
    uploadUrl: string;
    expiresAt: string;
  }>;
  maxVideoSizeMB: number;
  maxImageSizeMB: number;
}

// Confirm Request
interface ConfirmRequestSubmissionRequest {
  submissionToken: string;
}

// Confirm Response
interface ConfirmRequestSubmissionResponse {
  requestId: string;
  status: "RECEIVED";
  message: string;
}
```

---

## ⚠️ Important Notes

1. **File IDs must be UUIDs** - Use `uuid()` or equivalent
2. **Upload files in parallel** - Faster UX (both files upload simultaneously)
3. **Both files required** - Backend will reject if either is missing
4. **Handle upload errors** - Show clear error messages to user
5. **Progress indicators** - Show upload progress for both files
6. **Expiration handling** - Upload URLs expire in 30 minutes

---

## ❓ Is This a Significant Change?

**NO** - Very minimal frontend changes:

| Aspect           | Effort                                                     |
| ---------------- | ---------------------------------------------------------- |
| **API Changes**  | Low - Same 3-step flow, just array instead of single value |
| **Upload Logic** | Low - Already do parallel uploads for listing images       |
| **UI Changes**   | Low - Add second file input                                |
| **Validation**   | Low - Copy existing file validation logic                  |

**Estimate:** ~1-2 hours for an experienced developer familiar with the codebase.

---

## ✅ Testing Checklist

- [ ] Upload valid video + valid image → Success
- [ ] Upload video only (no image) → Error
- [ ] Upload image only (no video) → Error
- [ ] Upload oversized video (> 100 MB) → Error
- [ ] Upload oversized image (> 10 MB) → Error
- [ ] Upload invalid video type → Error
- [ ] Upload invalid image type → Error
- [ ] Test upload progress indicators
- [ ] Test parallel upload (both files upload simultaneously)
- [ ] Test error handling (one file fails to upload)

---

**Last Updated:** 2025-11-29




