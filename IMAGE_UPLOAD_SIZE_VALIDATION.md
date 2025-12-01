# Image Upload Size Validation

## Overview

This document explains how we enforce image size limits at the S3 level, ensuring users get immediate feedback during upload if their file exceeds the maximum allowed size.

## How It Works

### 1. **Frontend Sends File Metadata**

When creating a listing, the frontend sends image metadata including the **exact file size**:

```typescript
POST /api/v1/hosts/{hostId}/listings/submit-intent

{
  "images": [
    {
      "imageId": "abc-123",
      "contentType": "image/jpeg",
      "fileSize": 5242880,  // 5MB in bytes
      "isPrimary": true,
      "displayOrder": 1
    }
  ]
}
```

### 2. **Backend Validates**

The backend performs **two levels of validation**:

#### **Level 1: Content Type Validation**

```typescript
const ALLOWED_IMAGE_TYPES = [
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
];
```

If the content type is not in this list, the request is rejected with a `400 Bad Request`.

#### **Level 2: File Size Validation**

```typescript
const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10MB

if (img.fileSize > MAX_IMAGE_SIZE) {
  return response.badRequest(
    `Image ${img.imageId}: file size ${(img.fileSize / 1024 / 1024).toFixed(
      2
    )}MB ` + `exceeds maximum allowed size of 10MB`
  );
}
```

If the file size exceeds 10MB, the request is rejected **before** generating any S3 URLs.

### 3. **S3 Pre-signed URL with ContentLength**

If validation passes, the backend generates a pre-signed S3 URL with the **exact file size** embedded:

```typescript
const uploadUrl = await generateUploadUrl(
  s3Key,
  img.contentType,
  600, // 10 minute expiry
  metadata,
  img.fileSize, // ← EXACT size S3 will enforce
  MAX_IMAGE_SIZE // ← Maximum allowed
);
```

The `generateUploadUrl` function creates a `PutObjectCommand` with `ContentLength`:

```typescript
const command = new PutObjectCommand({
  Bucket: BUCKET_NAME,
  Key: key,
  ContentType: contentType,
  ContentLength: contentLength, // ← S3 enforces this
  Metadata: metadata,
});
```

### 4. **S3 Enforces the Size**

When the frontend uploads the file to S3:

```typescript
await fetch(uploadUrl, {
  method: "PUT",
  body: imageFile,
  headers: {
    "Content-Type": "image/jpeg",
  },
});
```

**S3 will reject the upload if:**

- The file size doesn't **exactly match** the `ContentLength` specified in the pre-signed URL
- The upload is too large or too small

The frontend receives an **immediate error** (typically `400 Bad Request` or `403 Forbidden`) from S3.

## Security Benefits

### ✅ **Cannot Be Bypassed**

Unlike frontend-only validation, this approach is **enforced by AWS S3** itself:

1. ❌ User cannot lie about file size - S3 checks the actual upload
2. ❌ User cannot upload a different file - S3 validates the size matches
3. ❌ User cannot modify the pre-signed URL - it's cryptographically signed

### ✅ **Immediate Feedback**

The user gets feedback **during the upload**, not after:

- **Bad UX**: Upload completes → Lambda rejects → User finds out later
- **Good UX**: Upload fails immediately → User sees error → Can retry with smaller file

### ✅ **No Wasted Processing**

By rejecting oversized files at upload time:

- No Lambda invocations for invalid files
- No storage costs for rejected files
- No cleanup required

## Validation Layers

| Layer                 | Type                  | Enforced By | Can Be Bypassed?      |
| --------------------- | --------------------- | ----------- | --------------------- |
| **Frontend**          | File size check       | Browser     | ✅ Yes (dev tools)    |
| **Backend API**       | Validate claimed size | Lambda      | ✅ Yes (fake request) |
| **S3 Pre-signed URL** | ContentLength match   | AWS S3      | ❌ **No**             |

## Configuration

### Maximum Image Size

```typescript
// backend/services/api/listings/submit-intent.ts
const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10MB
```

### Allowed Image Types

```typescript
// backend/services/api/listings/submit-intent.ts
const ALLOWED_IMAGE_TYPES = [
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
];
```

## Error Messages

### Backend Validation Errors (400 Bad Request)

```json
{
  "error": "Image abc-123: file size 15.50MB exceeds maximum allowed size of 10MB"
}
```

```json
{
  "error": "Invalid image content type: image/bmp. Allowed types: image/jpeg, image/jpg, image/png, image/webp, image/heic, image/heif"
}
```

### S3 Upload Errors (403 Forbidden or 400 Bad Request)

When the actual upload size doesn't match:

```xml
<Error>
  <Code>SignatureDoesNotMatch</Code>
  <Message>The request signature we calculated does not match the signature you provided.</Message>
</Error>
```

Or:

```xml
<Error>
  <Code>InvalidRequest</Code>
  <Message>Content-Length does not match expected value</Message>
</Error>
```

## Frontend Integration

### 1. Get File Size Before Upload

```typescript
const file = event.target.files[0];
const fileSize = file.size; // bytes

// Validate on frontend (optional but good UX)
const MAX_SIZE = 10 * 1024 * 1024;
if (fileSize > MAX_SIZE) {
  alert("Image must be less than 10MB");
  return;
}
```

### 2. Send File Size in Intent Request

```typescript
const response = await fetch("/api/v1/hosts/{hostId}/listings/submit-intent", {
  method: "POST",
  body: JSON.stringify({
    // ... other fields
    images: [
      {
        imageId: uuid(),
        contentType: file.type,
        fileSize: file.size, // ← Include this
        isPrimary: true,
        displayOrder: 1,
      },
    ],
  }),
});
```

### 3. Upload File to S3

```typescript
const { imageUploadUrls } = await response.json();

for (const { imageId, uploadUrl } of imageUploadUrls) {
  const file = filesMap[imageId];

  try {
    await fetch(uploadUrl, {
      method: "PUT",
      body: file,
      headers: {
        "Content-Type": file.type,
      },
    });
  } catch (error) {
    // S3 rejected the upload - likely size mismatch
    console.error("Upload failed:", error);
    alert("Upload failed. Please try again with a smaller file.");
  }
}
```

## Testing

### Test Case 1: Valid Upload

```bash
# Create a 5MB test image
dd if=/dev/urandom of=test-5mb.jpg bs=1024 count=5120

# Upload should succeed
```

### Test Case 2: Oversized File (Backend Rejects)

```bash
# Create a 15MB test image
dd if=/dev/urandom of=test-15mb.jpg bs=1024 count=15360

# Backend should reject with 400 Bad Request
```

### Test Case 3: Size Mismatch (S3 Rejects)

```bash
# Frontend claims 5MB but uploads 6MB
# S3 should reject with 403 Forbidden
```

## Future Enhancements

### 1. **Content-Type Validation in S3**

Currently, we only validate content type in the backend. S3 doesn't verify the actual file content matches the declared MIME type.

**Enhancement**: Add magic byte validation in the image processor Lambda.

### 2. **Progressive Upload Feedback**

For large files, show upload progress:

```typescript
const xhr = new XMLHttpRequest();
xhr.upload.addEventListener("progress", (e) => {
  const percent = (e.loaded / e.total) * 100;
  console.log(`Upload progress: ${percent}%`);
});
```

### 3. **Automatic Image Compression**

If a user selects an oversized image, offer to compress it client-side before upload:

```typescript
import imageCompression from "browser-image-compression";

if (file.size > MAX_SIZE) {
  const compressed = await imageCompression(file, {
    maxSizeMB: 10,
    maxWidthOrHeight: 4096,
  });
  // Use compressed file
}
```

## Summary

✅ **S3-enforced size limits** prevent oversized uploads  
✅ **Immediate feedback** during upload, not after  
✅ **Cannot be bypassed** by malicious users  
✅ **No wasted resources** on invalid files  
✅ **Clear error messages** for debugging

This approach provides **defense in depth** with validation at multiple layers, but the final enforcement happens at the S3 level where it cannot be circumvented.


