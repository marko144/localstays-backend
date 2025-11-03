# Profile Photo Upload - Frontend Implementation Guide

## API Endpoints

**Base URL:** `https://tqaq505m83.execute-api.eu-north-1.amazonaws.com/dev1`

---

## 1. Submit Intent (Create Upload URL)

**POST** `/api/v1/hosts/{hostId}/profile/submit-intent`

### Request Body (Add Optional Field)

```typescript
{
  "profile": { /* profile data */ },
  "documents": [ /* documents */ ],
  "profilePhoto": {                    // OPTIONAL - Add only if user selected photo
    "photoId": "uuid-v4",              // Generate: crypto.randomUUID()
    "contentType": "image/jpeg",       // File type: image/jpeg, image/jpg, image/png, image/webp
    "fileSize": 1234567                // File size in bytes (max 10MB)
  }
}
```

### Response

```typescript
{
  "success": true,
  "data": {
    "submissionToken": "uuid",
    "expiresAt": "ISO-8601",
    "profilePhotoUploadUrl": {               // Present only if profilePhoto was sent
      "photoId": "uuid",
      "uploadUrl": "https://...",
      "expiresAt": "ISO-8601"
    },
    "documentUploadUrls": [...]
  }
}
```

---

## 2. Upload Photo to S3

**PUT** to `profilePhotoUploadUrl.uploadUrl` from response

```typescript
await fetch(profilePhotoUploadUrl.uploadUrl, {
  // Use .uploadUrl property
  method: "PUT",
  body: file, // Raw File object
  headers: {
    "Content-Type": file.type, // Must match contentType from request
  },
});
```

---

## 3. Confirm Submission

**POST** `/api/v1/hosts/{hostId}/profile/confirm-submission`

### Request Body (Add Optional Field)

```typescript
{
  "submissionToken": "uuid",
  "uploadedDocuments": [...]
  "uploadedProfilePhoto": {            // OPTIONAL - Add only if photo was uploaded
    "photoId": "uuid"                  // Same UUID from submit-intent
  }
}
```

---

## 4. Get Profile (Retrieve Photo URLs)

**GET** `/api/v1/hosts/{hostId}/profile`

### Response

```typescript
{
  "success": true,
  "data": {
    "hostId": "uuid",
    "profilePhoto": {                       // null if not uploaded
      "photoId": "uuid",
      "thumbnailUrl": "https://s3.../photo_thumbnail.webp",
      "fullUrl": "https://s3.../photo_full.webp",
      "width": 1920,
      "height": 1080,
      "status": "READY"                     // PENDING_UPLOAD | PENDING_SCAN | READY | QUARANTINED
    },
    // ... rest of profile data
  }
}
```

---

## Complete Implementation Example

```typescript
// 1. When user selects photo file
const photoFile = event.target.files[0];
const photoId = crypto.randomUUID();

// Validate
const allowedTypes = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
if (!allowedTypes.includes(photoFile.type)) {
  throw new Error("Invalid file type");
}
if (photoFile.size > 10 * 1024 * 1024) {
  throw new Error("File too large (max 10MB)");
}

// 2. Submit intent with photo metadata
const intentResponse = await fetch(
  `/api/v1/hosts/${hostId}/profile/submit-intent`,
  {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      profile: profileData,
      documents: documentsMetadata,
      profilePhoto: {
        // Add this object
        photoId: photoId,
        contentType: photoFile.type,
        fileSize: photoFile.size,
      },
    }),
  }
);

const { submissionToken, profilePhotoUploadUrl, documentUploadUrls } = (
  await intentResponse.json()
).data;

// 3. Upload photo to S3
if (profilePhotoUploadUrl) {
  await fetch(profilePhotoUploadUrl.uploadUrl, {
    // Use .uploadUrl property
    method: "PUT",
    body: photoFile,
    headers: { "Content-Type": photoFile.type },
  });
}

// 4. Upload documents (existing logic)
// ... upload documents to their URLs ...

// 5. Confirm submission
await fetch(`/api/v1/hosts/${hostId}/profile/confirm-submission`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  },
  body: JSON.stringify({
    submissionToken: submissionToken,
    uploadedDocuments: documentsMetadata.map((d) => ({
      documentId: d.documentId,
      documentType: d.documentType,
    })),
    uploadedProfilePhoto: {
      // Add this object
      photoId: photoId,
    },
  }),
});

// 6. Retrieve and display photo
const profileResponse = await fetch(`/api/v1/hosts/${hostId}/profile`, {
  headers: { Authorization: `Bearer ${token}` },
});

const { profilePhoto } = (await profileResponse.json()).data;

// Display photo
if (profilePhoto?.status === "READY") {
  return (
    <img
      src={profilePhoto.thumbnailUrl}
      onClick={() => window.open(profilePhoto.fullUrl, "_blank")}
    />
  );
}
```

---

## Important Notes

### Validation Rules

- **File types:** `image/jpeg`, `image/jpg`, `image/png`, `image/webp`
- **Max size:** 10MB
- **PhotoId:** Generate with `crypto.randomUUID()`

### Photo Status

- `PENDING_UPLOAD`: Record created, waiting for upload
- `PENDING_SCAN`: Uploaded, scanning for malware (~30-60 sec)
- `READY`: Processed and available
- `QUARANTINED`: Failed malware scan

### Processing Time

- **Total:** 1-2 minutes from upload to `READY` status
- Poll `GET /profile` or use websocket to check status updates

### Optional Field

If user doesn't upload photo:

- Omit `profilePhoto` from submit-intent request
- Omit `uploadedProfilePhoto` from confirm-submission request
- API returns `profilePhoto: null` in get-profile response
