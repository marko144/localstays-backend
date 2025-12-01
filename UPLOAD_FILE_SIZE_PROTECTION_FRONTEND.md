# Upload File Size Protection - Frontend Changes

This document outlines all frontend changes required to support S3-enforced file size validation across all upload endpoints.

---

## Overview

All upload endpoints now require the frontend to send the **exact file size** in bytes. The backend will:

1. Validate the file size against maximum limits
2. Generate an S3 pre-signed URL with the exact size embedded
3. S3 will reject uploads if the actual file size doesn't match

**Result:** Users get immediate feedback during upload if their file is too large or doesn't match the declared size.

---

## 1. Listing Images (Creation)

**Endpoint:** `POST /api/v1/hosts/{hostId}/listings/submit-intent`

**Max Size:** 10MB per image

**Allowed Types:** `image/jpeg`, `image/jpg`, `image/png`, `image/webp`, `image/heic`, `image/heif`

### Required Changes:

```typescript
// OLD - Missing fileSize
{
  listingName: "...",
  images: [
    {
      imageId: uuid(),
      contentType: file.type,
      isPrimary: true,
      displayOrder: 1,
      caption: "..."
    }
  ]
}

// NEW - Include fileSize
{
  listingName: "...",
  images: [
    {
      imageId: uuid(),
      contentType: file.type,
      fileSize: file.size,  // ← ADD THIS
      isPrimary: true,
      displayOrder: 1,
      caption: "..."
    }
  ]
}
```

### Frontend Validation:

```typescript
const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_IMAGE_TYPES = [
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
];

function validateListingImage(file: File): string | null {
  if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
    return `Invalid image type. Allowed: ${ALLOWED_IMAGE_TYPES.join(", ")}`;
  }

  if (file.size > MAX_IMAGE_SIZE) {
    return `Image size ${(file.size / 1024 / 1024).toFixed(
      2
    )}MB exceeds maximum of 10MB`;
  }

  return null; // Valid
}
```

---

## 2. Listing Verification Documents (Creation)

**Endpoint:** `POST /api/v1/hosts/{hostId}/listings/submit-intent`

**Max Size:** 50MB per document

**Allowed Types:** `image/jpeg`, `image/jpg`, `image/png`, `image/webp`, `application/pdf`

### Required Changes:

```typescript
// OLD - Missing fileSize
{
  listingName: "...",
  verificationDocuments: [
    {
      documentType: "PROPERTY_REGISTRATION",
      contentType: "application/pdf"
    }
  ]
}

// NEW - Include fileSize
{
  listingName: "...",
  verificationDocuments: [
    {
      documentType: "PROPERTY_REGISTRATION",
      contentType: "application/pdf",
      fileSize: file.size  // ← ADD THIS
    }
  ]
}
```

### Frontend Validation:

```typescript
const MAX_DOCUMENT_SIZE = 50 * 1024 * 1024; // 50MB
const ALLOWED_DOCUMENT_TYPES = [
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "application/pdf",
];

function validateListingDocument(file: File): string | null {
  if (!ALLOWED_DOCUMENT_TYPES.includes(file.type)) {
    return `Invalid document type. Allowed: ${ALLOWED_DOCUMENT_TYPES.join(
      ", "
    )}`;
  }

  if (file.size > MAX_DOCUMENT_SIZE) {
    return `Document size ${(file.size / 1024 / 1024).toFixed(
      2
    )}MB exceeds maximum of 50MB`;
  }

  return null; // Valid
}
```

---

## 3. Listing Images (Update)

**Endpoint:** `POST /api/v1/hosts/{hostId}/listings/{listingId}/image-update`

**Max Size:** 10MB per image

**Allowed Types:** `image/jpeg`, `image/jpg`, `image/png`, `image/webp`, `image/heic`, `image/heif`

### Required Changes:

```typescript
// OLD - Missing fileSize
{
  imagesToAdd: [
    {
      imageId: uuid(),
      contentType: file.type,
      isPrimary: false,
      displayOrder: 2,
      caption: "..."
    }
  ],
  imagesToDelete: ["image-id-1", "image-id-2"],
  newPrimaryImageId: "image-id-3"
}

// NEW - Include fileSize
{
  imagesToAdd: [
    {
      imageId: uuid(),
      contentType: file.type,
      fileSize: file.size,  // ← ADD THIS
      isPrimary: false,
      displayOrder: 2,
      caption: "..."
    }
  ],
  imagesToDelete: ["image-id-1", "image-id-2"],
  newPrimaryImageId: "image-id-3"
}
```

### Frontend Validation:

Same as Listing Images (Creation) - 10MB limit, same allowed types.

---

## 4. Host Profile Photo

**Endpoint:** `POST /api/v1/hosts/{hostId}/submit-intent`

**Max Size:** 20MB

**Allowed Types:** `image/jpeg`, `image/jpg`, `image/png`, `image/webp`

### Required Changes:

```typescript
// The profilePhoto field already requires fileSize
// Just ensure it's included:

{
  profile: { /* ... */ },
  documents: [ /* ... */ ],
  profilePhoto: {
    photoId: uuid(),
    contentType: file.type,
    fileSize: file.size  // ← Ensure this is included
  }
}
```

### Frontend Validation:

```typescript
const MAX_PROFILE_PHOTO_SIZE = 20 * 1024 * 1024; // 20MB
const ALLOWED_PROFILE_PHOTO_TYPES = [
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
];

function validateProfilePhoto(file: File): string | null {
  if (!ALLOWED_PROFILE_PHOTO_TYPES.includes(file.type)) {
    return `Invalid photo type. Allowed: ${ALLOWED_PROFILE_PHOTO_TYPES.join(
      ", "
    )}`;
  }

  if (file.size > MAX_PROFILE_PHOTO_SIZE) {
    return `Photo size ${(file.size / 1024 / 1024).toFixed(
      2
    )}MB exceeds maximum of 20MB`;
  }

  return null; // Valid
}
```

---

## 5. Host Verification Documents

**Endpoint:** `POST /api/v1/hosts/{hostId}/submit-intent`

**Max Size:** 20MB per file, 100MB total

**Allowed Types:** `image/jpeg`, `image/jpg`, `image/png`, `application/pdf`

### Required Changes:

```typescript
// The documents field already requires fileSize
// Just ensure it's included for both single and two-sided documents:

// Single file document
{
  profile: { /* ... */ },
  documents: [
    {
      documentType: "PASSPORT",
      fileName: file.name,
      fileSize: file.size,  // ← Ensure this is included
      mimeType: file.type
    }
  ]
}

// Two-sided document (ID card, driver's license)
{
  profile: { /* ... */ },
  documents: [
    {
      documentType: "ID_CARD",
      frontFile: {
        fileName: frontFile.name,
        fileSize: frontFile.size,  // ← Ensure this is included
        mimeType: frontFile.type
      },
      backFile: {
        fileName: backFile.name,
        fileSize: backFile.size,  // ← Ensure this is included
        mimeType: backFile.type
      }
    }
  ]
}
```

### Frontend Validation:

```typescript
const MAX_DOCUMENT_SIZE = 20 * 1024 * 1024; // 20MB per file
const MAX_TOTAL_SIZE = 100 * 1024 * 1024; // 100MB total
const ALLOWED_DOCUMENT_TYPES = [
  "image/jpeg",
  "image/jpg",
  "image/png",
  "application/pdf",
];

function validateHostDocuments(
  documents: DocumentUploadIntent[]
): string | null {
  let totalSize = 0;

  for (const doc of documents) {
    // Single file document
    if (doc.fileName && doc.fileSize && doc.mimeType) {
      if (!ALLOWED_DOCUMENT_TYPES.includes(doc.mimeType)) {
        return `Invalid document type: ${doc.mimeType}`;
      }

      if (doc.fileSize > MAX_DOCUMENT_SIZE) {
        return `Document ${doc.fileName} exceeds 20MB limit`;
      }

      totalSize += doc.fileSize;
    }

    // Two-sided document
    if (doc.frontFile && doc.backFile) {
      if (!ALLOWED_DOCUMENT_TYPES.includes(doc.frontFile.mimeType)) {
        return `Invalid front file type: ${doc.frontFile.mimeType}`;
      }

      if (!ALLOWED_DOCUMENT_TYPES.includes(doc.backFile.mimeType)) {
        return `Invalid back file type: ${doc.backFile.mimeType}`;
      }

      if (doc.frontFile.fileSize > MAX_DOCUMENT_SIZE) {
        return `Front file ${doc.frontFile.fileName} exceeds 20MB limit`;
      }

      if (doc.backFile.fileSize > MAX_DOCUMENT_SIZE) {
        return `Back file ${doc.backFile.fileName} exceeds 20MB limit`;
      }

      totalSize += doc.frontFile.fileSize + doc.backFile.fileSize;
    }
  }

  if (totalSize > MAX_TOTAL_SIZE) {
    return `Total document size ${(totalSize / 1024 / 1024).toFixed(
      2
    )}MB exceeds maximum of 100MB`;
  }

  return null; // Valid
}
```

---

## 6. Live ID Check Files (Video + Image)

**Endpoint:** `POST /api/v1/hosts/{hostId}/requests/{requestId}/submit-intent`

**Max Size:** 200MB for video, 10MB for image

**Allowed Types:**

- Video: `video/mp4`, `video/mov`, `video/webm`
- Image: `image/jpeg`, `image/png`, `image/webp`

### Required Changes:

```typescript
// OLD - Missing fileSize
{
  files: [
    {
      fileId: uuid(),
      contentType: "video/mp4",
      fileType: "VIDEO",
    },
    {
      fileId: uuid(),
      contentType: "image/jpeg",
      fileType: "IMAGE",
    },
  ];
}

// NEW - Include fileSize
{
  files: [
    {
      fileId: uuid(),
      contentType: "video/mp4",
      fileType: "VIDEO",
      fileSize: videoFile.size, // ← ADD THIS
    },
    {
      fileId: uuid(),
      contentType: "image/jpeg",
      fileType: "IMAGE",
      fileSize: imageFile.size, // ← ADD THIS
    },
  ];
}
```

### Frontend Validation:

```typescript
const MAX_VIDEO_SIZE = 200 * 1024 * 1024; // 200MB
const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_VIDEO_TYPES = ["video/mp4", "video/mov", "video/webm"];
const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

function validateLiveIDCheckFiles(
  videoFile: File,
  imageFile: File
): string | null {
  // Validate video
  if (!ALLOWED_VIDEO_TYPES.includes(videoFile.type)) {
    return `Invalid video type. Allowed: ${ALLOWED_VIDEO_TYPES.join(", ")}`;
  }

  if (videoFile.size > MAX_VIDEO_SIZE) {
    return `Video size ${(videoFile.size / 1024 / 1024).toFixed(
      2
    )}MB exceeds maximum of 200MB`;
  }

  // Validate image
  if (!ALLOWED_IMAGE_TYPES.includes(imageFile.type)) {
    return `Invalid image type. Allowed: ${ALLOWED_IMAGE_TYPES.join(", ")}`;
  }

  if (imageFile.size > MAX_IMAGE_SIZE) {
    return `Image size ${(imageFile.size / 1024 / 1024).toFixed(
      2
    )}MB exceeds maximum of 10MB`;
  }

  return null; // Valid
}
```

---

## 7. Host Video Intent (Property Video Verification)

**Endpoint:** `POST /api/v1/hosts/{hostId}/listings/{listingId}/requests/{requestId}/submit-video-intent`

**Max Size:** 200MB

**Allowed Types:** `video/mp4`, `video/mov`, `video/webm`

### Required Changes:

```typescript
// The request already requires videoFileSize
// Just ensure it's included:

{
  videoFileName: file.name,
  videoFileSize: file.size,  // ← Ensure this is included
  videoContentType: file.type
}
```

### Frontend Validation:

```typescript
const MAX_VIDEO_SIZE = 200 * 1024 * 1024; // 200MB
const ALLOWED_VIDEO_TYPES = ["video/mp4", "video/mov", "video/webm"];

function validatePropertyVideo(file: File): string | null {
  if (!ALLOWED_VIDEO_TYPES.includes(file.type)) {
    return `Invalid video type. Allowed: ${ALLOWED_VIDEO_TYPES.join(", ")}`;
  }

  if (file.size > MAX_VIDEO_SIZE) {
    return `Video size ${(file.size / 1024 / 1024).toFixed(
      2
    )}MB exceeds maximum of 200MB`;
  }

  return null; // Valid
}
```

---

## 8. Update Rejected Profile Documents

**Endpoint:** `PUT /api/v1/hosts/{hostId}/update-rejected-profile`

**Max Size:** 20MB per file, 100MB total

**Allowed Types:** `image/jpeg`, `image/jpg`, `image/png`, `application/pdf`

### Required Changes:

Same as Host Verification Documents (#5) - the structure is identical.

```typescript
{
  profile: { /* ... */ },
  documents: [
    {
      documentType: "PASSPORT",
      fileName: file.name,
      fileSize: file.size,  // ← Ensure this is included
      mimeType: file.type
    }
  ]
}
```

### Frontend Validation:

Same validation logic as Host Verification Documents (#5).

---

## Common Error Handling

### Backend Validation Errors (400 Bad Request)

```typescript
// Example error responses from backend
{
  "error": "Image abc-123: file size 15.50MB exceeds maximum allowed size of 10MB"
}

{
  "error": "Invalid image content type: image/bmp. Allowed types: image/jpeg, image/jpg, image/png, image/webp, image/heic, image/heif"
}

{
  "error": "Document PROPERTY_REGISTRATION: fileSize is required and must be greater than 0"
}
```

### S3 Upload Errors (403 Forbidden or 400 Bad Request)

When the actual file size doesn't match what was declared:

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

### Handling Upload Errors:

```typescript
async function uploadFile(file: File, uploadUrl: string): Promise<void> {
  try {
    const response = await fetch(uploadUrl, {
      method: "PUT",
      body: file,
      headers: {
        "Content-Type": file.type,
      },
    });

    if (!response.ok) {
      if (response.status === 403 || response.status === 400) {
        throw new Error(
          "Upload rejected by S3. File size may not match declared size."
        );
      }
      throw new Error(`Upload failed: ${response.statusText}`);
    }
  } catch (error) {
    console.error("Upload failed:", error);
    throw error;
  }
}
```

---

## Summary of Changes by Endpoint

| Endpoint                  | Field to Add                                                                     | Max Size                | Status            |
| ------------------------- | -------------------------------------------------------------------------------- | ----------------------- | ----------------- |
| Listing Images (Creation) | `images[].fileSize`                                                              | 10MB                    | ⚠️ **Required**   |
| Listing Docs (Creation)   | `verificationDocuments[].fileSize`                                               | 50MB                    | ⚠️ **Required**   |
| Listing Images (Update)   | `imagesToAdd[].fileSize`                                                         | 10MB                    | ⚠️ **Required**   |
| Host Profile Photo        | `profilePhoto.fileSize`                                                          | 20MB                    | ✅ Already exists |
| Host Verification Docs    | `documents[].fileSize` or `documents[].frontFile.fileSize` + `backFile.fileSize` | 20MB per file           | ✅ Already exists |
| Live ID Check Files       | `files[].fileSize`                                                               | 200MB video, 10MB image | ⚠️ **Required**   |
| Host Video Intent         | `videoFileSize`                                                                  | 200MB                   | ✅ Already exists |
| Update Rejected Docs      | `documents[].fileSize`                                                           | 20MB per file           | ✅ Already exists |

---

## Testing Checklist

For each endpoint, test:

- [ ] **Valid file within limit** - Should upload successfully
- [ ] **File exceeding limit** - Should be rejected by backend with clear error
- [ ] **Incorrect file size declared** - Should be rejected by S3
- [ ] **Invalid file type** - Should be rejected by backend
- [ ] **Missing fileSize field** - Should be rejected by backend
- [ ] **Zero or negative fileSize** - Should be rejected by backend

---

## Migration Notes

### Breaking Changes:

The following endpoints now **require** the `fileSize` field (previously optional or missing):

1. Listing Images (Creation)
2. Listing Verification Documents (Creation)
3. Listing Images (Update)
4. Live ID Check Files

### Non-Breaking Changes:

The following endpoints already required `fileSize`, so no frontend changes needed:

1. Host Profile Photo
2. Host Verification Documents
3. Host Video Intent
4. Update Rejected Profile Documents

---

## Best Practices

1. **Always validate on frontend first** - Provide immediate feedback to users
2. **Use File.size property** - Don't calculate manually
3. **Show progress indicators** - Especially for large files (videos)
4. **Handle S3 errors gracefully** - Provide clear error messages
5. **Test with edge cases** - Files exactly at limit, just over limit, etc.
6. **Consider compression** - Offer to compress oversized images before upload

---

## Example: Complete Upload Flow

```typescript
async function uploadListingImages(files: File[]): Promise<void> {
  // 1. Frontend validation
  for (const file of files) {
    const error = validateListingImage(file);
    if (error) {
      alert(error);
      return;
    }
  }

  // 2. Request upload URLs from backend
  const response = await fetch(
    "/api/v1/hosts/{hostId}/listings/submit-intent",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        listingName: "...",
        images: files.map((file, index) => ({
          imageId: uuid(),
          contentType: file.type,
          fileSize: file.size, // ← Include this
          isPrimary: index === 0,
          displayOrder: index + 1,
        })),
      }),
    }
  );

  if (!response.ok) {
    const error = await response.json();
    alert(error.error);
    return;
  }

  const { imageUploadUrls } = await response.json();

  // 3. Upload files to S3
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const { uploadUrl } = imageUploadUrls[i];

    try {
      await uploadFile(file, uploadUrl);
    } catch (error) {
      alert(`Failed to upload ${file.name}: ${error.message}`);
      return;
    }
  }

  // 4. Confirm submission
  // ... (existing confirmation logic)
}
```

---

## Questions?

If you encounter any issues or have questions about implementing these changes, please refer to:

- `IMAGE_UPLOAD_SIZE_VALIDATION.md` - Technical implementation details
- `UPLOAD_PROTECTION_STATUS.md` - Status of all endpoints

---

**Last Updated:** December 2024


