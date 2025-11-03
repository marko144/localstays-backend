# Host Profile Photo - Frontend Integration Guide

**Last Updated:** 2025-10-31  
**Environment:** dev1

---

## Overview

Hosts can now upload a profile photo when creating their profile. The photo is processed through the existing image pipeline (malware scanning, WebP conversion, thumbnail generation) and stored in the host's S3 folder.

---

## 1. Submit Intent Endpoint

### Request

**Endpoint:** `POST /api/v1/hosts/{hostId}/profile/submit-intent`

**New Field in Request Body:**

```typescript
{
  "profile": {
    // ... existing profile fields ...
  },
  "documents": [
    // ... existing documents ...
  ],
  "profilePhoto": {  // NEW - Optional
    "photoId": "uuid-v4",           // Generate client-side
    "contentType": "image/jpeg",    // Must be: image/jpeg, image/jpg, image/png, or image/webp
    "fileSize": 1234567             // In bytes, max 10MB
  }
}
```

### Response

**New Field in Response:**

```typescript
{
  "success": true,
  "data": {
    "submissionToken": "uuid",
    "expiresAt": "ISO-8601",
    "profilePhotoUploadUrl": "https://s3.presigned.url...",  // NEW - Only present if profilePhoto was in request
    "documentUploadUrls": [
      // ... existing document upload URLs ...
    ]
  }
}
```

---

## 2. Confirm Submission Endpoint

### Request

**Endpoint:** `POST /api/v1/hosts/{hostId}/profile/confirm-submission`

**New Field in Request Body:**

```typescript
{
  "submissionToken": "uuid",
  "uploadedDocuments": [
    // ... existing documents ...
  ],
  "uploadedProfilePhoto": {  // NEW - Optional (required if profilePhoto was in submit-intent)
    "photoId": "uuid"
  }
}
```

---

## 3. Get Profile Endpoint

### Response

**Endpoint:** `GET /api/v1/hosts/{hostId}/profile`

**New Field in Response:**

```typescript
{
  "success": true,
  "data": {
    "hostId": "uuid",
    "hostType": "INDIVIDUAL" | "BUSINESS",
    "status": "DRAFT" | "VERIFICATION" | "ACTIVE" | ...,

    "profilePhoto": {  // NEW - Optional (null if not uploaded or not yet processed)
      "photoId": "uuid",
      "thumbnailUrl": "https://s3.url/hostId/profile/photo_thumbnail.webp",
      "fullUrl": "https://s3.url/hostId/profile/photo_full.webp",
      "width": 1920,
      "height": 1080,
      "status": "PENDING_UPLOAD" | "PENDING_SCAN" | "READY" | "QUARANTINED"
    },

    // ... rest of profile data ...
  }
}
```

---

## 4. Admin Get Host Endpoint

### Response

**Endpoint:** `GET /api/v1/admin/hosts/{hostId}`

**New Field in Response:**

The admin endpoint returns the full host object, which now includes the `profilePhoto` field with the same structure as the host get-profile endpoint.

---

## 5. Frontend Implementation Flow

### Step 1: Profile Creation Form

```typescript
interface ProfilePhotoInput {
  photoId: string;
  contentType: string;
  fileSize: number;
  file: File;
}

// When user selects a photo
function handlePhotoSelect(file: File): ProfilePhotoInput | null {
  // Validate file type
  const allowedTypes = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
  if (!allowedTypes.includes(file.type)) {
    alert("Invalid file type. Please upload JPEG, PNG, or WebP");
    return null;
  }

  // Validate file size (max 10MB)
  const maxSize = 10 * 1024 * 1024;
  if (file.size > maxSize) {
    alert("File too large. Maximum size is 10MB");
    return null;
  }

  // Generate UUID for photoId
  const photoId = crypto.randomUUID();

  return {
    photoId,
    contentType: file.type,
    fileSize: file.size,
    file,
  };
}
```

### Step 2: Submit Intent

```typescript
async function submitProfileIntent(
  hostId: string,
  profileData: ProfileData,
  documents: DocumentInput[],
  profilePhoto: ProfilePhotoInput | null
) {
  const requestBody: any = {
    profile: profileData,
    documents: documents.map((doc) => ({
      documentId: doc.documentId,
      documentType: doc.documentType,
      mimeType: doc.mimeType,
      fileSize: doc.fileSize,
    })),
  };

  // Add profile photo if provided
  if (profilePhoto) {
    requestBody.profilePhoto = {
      photoId: profilePhoto.photoId,
      contentType: profilePhoto.contentType,
      fileSize: profilePhoto.fileSize,
    };
  }

  const response = await fetch(
    `/api/v1/hosts/${hostId}/profile/submit-intent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(requestBody),
    }
  );

  const data = await response.json();
  return data.data;
}
```

### Step 3: Upload Files

```typescript
async function uploadFiles(
  documents: DocumentInput[],
  documentUploadUrls: Array<{ documentId: string; uploadUrl: string }>,
  profilePhoto: ProfilePhotoInput | null,
  profilePhotoUploadUrl: string | undefined
) {
  const uploads: Promise<void>[] = [];

  // Upload documents
  for (const doc of documents) {
    const uploadUrl = documentUploadUrls.find(
      (u) => u.documentId === doc.documentId
    )?.uploadUrl;
    if (uploadUrl) {
      uploads.push(
        fetch(uploadUrl, {
          method: "PUT",
          body: doc.file,
          headers: {
            "Content-Type": doc.mimeType,
          },
        }).then((res) => {
          if (!res.ok)
            throw new Error(`Failed to upload document ${doc.documentId}`);
        })
      );
    }
  }

  // Upload profile photo
  if (profilePhoto && profilePhotoUploadUrl) {
    uploads.push(
      fetch(profilePhotoUploadUrl, {
        method: "PUT",
        body: profilePhoto.file,
        headers: {
          "Content-Type": profilePhoto.contentType,
        },
      }).then((res) => {
        if (!res.ok) throw new Error("Failed to upload profile photo");
      })
    );
  }

  await Promise.all(uploads);
}
```

### Step 4: Confirm Submission

```typescript
async function confirmProfileSubmission(
  hostId: string,
  submissionToken: string,
  documents: DocumentInput[],
  profilePhoto: ProfilePhotoInput | null
) {
  const requestBody: any = {
    submissionToken,
    uploadedDocuments: documents.map((doc) => ({
      documentId: doc.documentId,
      documentType: doc.documentType,
    })),
  };

  // Add profile photo if it was uploaded
  if (profilePhoto) {
    requestBody.uploadedProfilePhoto = {
      photoId: profilePhoto.photoId,
    };
  }

  const response = await fetch(
    `/api/v1/hosts/${hostId}/profile/confirm-submission`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(requestBody),
    }
  );

  return await response.json();
}
```

### Step 5: Display Profile Photo

```typescript
function ProfilePhotoDisplay({
  profilePhoto,
}: {
  profilePhoto: ProfilePhoto | null;
}) {
  if (!profilePhoto) {
    return <div>No profile photo uploaded</div>;
  }

  if (profilePhoto.status === "PENDING_SCAN") {
    return <div>Profile photo is being scanned for malware...</div>;
  }

  if (profilePhoto.status === "QUARANTINED") {
    return <div className="error">Profile photo failed malware scan</div>;
  }

  if (profilePhoto.status === "READY") {
    return (
      <img
        src={profilePhoto.thumbnailUrl}
        alt="Profile"
        width={profilePhoto.width}
        height={profilePhoto.height}
        onClick={() => window.open(profilePhoto.fullUrl, "_blank")}
        style={{ cursor: "pointer" }}
      />
    );
  }

  return <div>Profile photo processing...</div>;
}
```

---

## 6. Complete Example

```typescript
async function handleProfileSubmission(
  hostId: string,
  profileData: ProfileData,
  documents: DocumentInput[],
  profilePhoto: ProfilePhotoInput | null
) {
  try {
    // Step 1: Submit intent
    const intentResponse = await submitProfileIntent(
      hostId,
      profileData,
      documents,
      profilePhoto
    );

    const { submissionToken, documentUploadUrls, profilePhotoUploadUrl } =
      intentResponse;

    // Step 2: Upload all files
    await uploadFiles(
      documents,
      documentUploadUrls,
      profilePhoto,
      profilePhotoUploadUrl
    );

    // Step 3: Confirm submission
    const confirmResponse = await confirmProfileSubmission(
      hostId,
      submissionToken,
      documents,
      profilePhoto
    );

    if (confirmResponse.success) {
      alert("Profile submitted successfully!");
      // Redirect or update UI
    }
  } catch (error) {
    console.error("Profile submission failed:", error);
    alert("Failed to submit profile. Please try again.");
  }
}
```

---

## 7. Important Notes

### File Validation

- **Allowed types:** `image/jpeg`, `image/jpg`, `image/png`, `image/webp`
- **Maximum size:** 10MB
- **Photo ID:** Must be a valid UUID v4 (generate client-side)

### Processing Pipeline

1. Photo is uploaded to S3 root with `lstimg_` prefix
2. GuardDuty scans for malware
3. If clean, image processor Lambda converts to WebP and generates thumbnail
4. Processed images are moved to `{hostId}/profile/` folder
5. Original file is deleted
6. DynamoDB is updated with URLs and status

### Photo Status Values

- `PENDING_UPLOAD`: Photo record created, awaiting upload
- `PENDING_SCAN`: Photo uploaded, awaiting malware scan
- `READY`: Photo processed and available
- `QUARANTINED`: Photo failed malware scan

### Photo Storage Locations

- **Original (temporary):** `lstimg_{photoId}.jpg` (deleted after processing)
- **Thumbnail:** `{hostId}/profile/photo_thumbnail.webp`
- **Full size:** `{hostId}/profile/photo_full.webp`

### Optional Field

The profile photo is **completely optional**. If not provided:

- Submit intent works without `profilePhoto` field
- Confirm submission works without `uploadedProfilePhoto` field
- Get profile returns `profilePhoto: null`

---

## 8. Error Handling

### Common Errors

**Invalid file type:**

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "contentType must be one of: image/jpeg, image/jpg, image/png, image/webp"
  }
}
```

**File too large:**

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "fileSize must be between 1 byte and 10485760 bytes (10MB)"
  }
}
```

**Photo not uploaded:**

```json
{
  "success": false,
  "error": {
    "code": "BAD_REQUEST",
    "message": "Profile photo {photoId} was not reported as uploaded"
  }
}
```

---

## 9. Testing Checklist

- [ ] Can submit profile without photo (optional field works)
- [ ] Can submit profile with photo
- [ ] Photo validation works (type and size)
- [ ] Pre-signed URL upload works
- [ ] Photo appears in get-profile after processing
- [ ] Thumbnail and full-size images display correctly
- [ ] Malware-infected photo is quarantined
- [ ] Photo status updates correctly during processing
- [ ] Admin can view host profile photo

---

## 10. Environment Configuration

**API Base URL (dev1):**

```
https://tqaq505m83.execute-api.eu-north-1.amazonaws.com/dev1
```

**S3 Bucket:**

```
localstays-dev1-host-assets
```

**Expected Processing Time:**

- Malware scan: 30-60 seconds
- Image processing: 5-15 seconds
- Total: ~1-2 minutes from upload to READY status


