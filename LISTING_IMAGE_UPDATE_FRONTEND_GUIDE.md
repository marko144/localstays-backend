# Listing Image Update - Frontend Implementation Guide

## Overview

This feature allows hosts to request updates to their listing images after a listing has been approved or is online. Hosts can add new images and/or delete existing images. All changes require admin approval before they become visible.

---

## API Endpoints

### 1. Submit Image Update Request

**Endpoint:** `POST /api/v1/hosts/{hostId}/listings/{listingId}/image-update`

**Headers:**

```
Authorization: Bearer {cognito_token}
Content-Type: application/json
```

**Request Body:**

```typescript
{
  imagesToAdd?: Array<{
    imageId: string;          // Generate with crypto.randomUUID()
    contentType: string;      // 'image/jpeg', 'image/png', 'image/webp', 'image/heic'
    isPrimary: boolean;
    displayOrder: number;     // 1-15
    caption?: string;
  }>;
  imagesToDelete?: string[];  // Array of imageIds to delete
}
```

**Response (200 OK):**

```typescript
{
  requestId: string;
  submissionToken: string;
  expiresAt: string;         // ISO timestamp
  imageUploadUrls?: Array<{
    imageId: string;
    uploadUrl: string;       // Pre-signed S3 URL
    expiresAt: string;
  }>;
}
```

**Error Responses:**

- `400`: Invalid request (e.g., listing not APPROVED/ONLINE, no changes specified)
- `401`: Unauthorized
- `403`: Forbidden (not your listing)
- `404`: Listing not found

---

### 2. Upload Images to S3

For each `imageUploadUrl` returned:

```typescript
await fetch(uploadUrl, {
  method: "PUT",
  body: imageFile,
  headers: {
    "Content-Type": imageFile.type,
  },
});
```

**Important:**

- Upload directly to S3 (no Authorization header)
- Must complete within 10 minutes (URL expires)
- Use the exact content type specified in the request

---

### 3. Confirm Image Update

**Endpoint:** `POST /api/v1/hosts/{hostId}/listings/{listingId}/image-update/confirm`

**Headers:**

```
Authorization: Bearer {cognito_token}
Content-Type: application/json
```

**Request Body:**

```typescript
{
  submissionToken: string; // From step 1 response
}
```

**Response (200 OK):**

```typescript
{
  requestId: string;
  status: "RECEIVED";
  message: "Image update request submitted successfully. Your changes are now pending admin review.";
}
```

**Error Responses:**

- `400`: Invalid or expired token
- `401`: Unauthorized

---

## Frontend Implementation

### Step 1: UI for Image Management

```typescript
interface ImageUpdateForm {
  imagesToAdd: File[];
  imagesToDelete: string[]; // imageIds from current listing
}

// When host clicks "Update Images" on their listing
function ImageUpdateModal({ listing }: { listing: Listing }) {
  const [imagesToAdd, setImagesToAdd] = useState<File[]>([]);
  const [imagesToDelete, setImagesToDelete] = useState<string[]>([]);

  // Show current images with delete checkboxes
  // Show file picker for new images
  // Show preview of changes

  return (
    <div>
      <h2>Update Listing Images</h2>

      {/* Current Images */}
      <div>
        <h3>Current Images</h3>
        {listing.images.map((img) => (
          <div key={img.imageId}>
            <img src={img.thumbnailUrl} />
            <input
              type="checkbox"
              checked={imagesToDelete.includes(img.imageId)}
              onChange={(e) => {
                if (e.target.checked) {
                  setImagesToDelete([...imagesToDelete, img.imageId]);
                } else {
                  setImagesToDelete(
                    imagesToDelete.filter((id) => id !== img.imageId)
                  );
                }
              }}
            />
            <label>Delete this image</label>
          </div>
        ))}
      </div>

      {/* Add New Images */}
      <div>
        <h3>Add New Images</h3>
        <input
          type="file"
          multiple
          accept="image/jpeg,image/png,image/webp,image/heic"
          onChange={(e) => setImagesToAdd(Array.from(e.target.files || []))}
        />
      </div>

      <button onClick={handleSubmit}>Submit for Review</button>
    </div>
  );
}
```

---

### Step 2: Submit Request

```typescript
async function submitImageUpdate(
  hostId: string,
  listingId: string,
  imagesToAdd: File[],
  imagesToDelete: string[]
) {
  // 1. Prepare request body
  const requestBody = {
    imagesToAdd: imagesToAdd.map((file, index) => ({
      imageId: crypto.randomUUID(),
      contentType: file.type,
      isPrimary: false, // Or let user specify
      displayOrder: listing.images.length + index + 1, // Append after existing
      caption: undefined, // Or let user add captions
    })),
    imagesToDelete: imagesToDelete.length > 0 ? imagesToDelete : undefined,
  };

  // 2. Submit request
  const response = await fetch(
    `/api/v1/hosts/${hostId}/listings/${listingId}/image-update`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cognitoToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    }
  );

  if (!response.ok) {
    throw new Error("Failed to submit image update request");
  }

  const data = await response.json();
  return data; // { requestId, submissionToken, imageUploadUrls }
}
```

---

### Step 3: Upload Images to S3

```typescript
async function uploadImagesToS3(
  imageFiles: File[],
  uploadUrls: Array<{ imageId: string; uploadUrl: string }>
) {
  const uploadPromises = imageFiles.map(async (file, index) => {
    const { uploadUrl } = uploadUrls[index];

    const response = await fetch(uploadUrl, {
      method: "PUT",
      body: file,
      headers: {
        "Content-Type": file.type,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to upload image ${file.name}`);
    }
  });

  await Promise.all(uploadPromises);
}
```

---

### Step 4: Confirm Submission

```typescript
async function confirmImageUpdate(
  hostId: string,
  listingId: string,
  submissionToken: string
) {
  const response = await fetch(
    `/api/v1/hosts/${hostId}/listings/${listingId}/image-update/confirm`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cognitoToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ submissionToken }),
    }
  );

  if (!response.ok) {
    throw new Error("Failed to confirm image update");
  }

  const data = await response.json();
  return data; // { requestId, status, message }
}
```

---

### Complete Flow Example

```typescript
async function handleImageUpdate(
  hostId: string,
  listingId: string,
  imagesToAdd: File[],
  imagesToDelete: string[]
) {
  try {
    // Step 1: Submit request and get upload URLs
    const { requestId, submissionToken, imageUploadUrls } =
      await submitImageUpdate(hostId, listingId, imagesToAdd, imagesToDelete);

    // Step 2: Upload new images to S3 (if any)
    if (imageUploadUrls && imageUploadUrls.length > 0) {
      await uploadImagesToS3(imagesToAdd, imageUploadUrls);
    }

    // Step 3: Confirm submission
    const result = await confirmImageUpdate(hostId, listingId, submissionToken);

    // Step 4: Show success message
    alert(result.message);
    // "Image update request submitted successfully. Your changes are now pending admin review."
  } catch (error) {
    console.error("Image update failed:", error);
    alert("Failed to submit image update. Please try again.");
  }
}
```

---

## Important Notes

### Listing Status Requirements

- Listing must be in `APPROVED` or `ONLINE` status
- Cannot update images for `DRAFT`, `IN_REVIEW`, `REJECTED`, or `LOCKED` listings

### Image Constraints

- Maximum 15 images per listing (including existing + new)
- Supported formats: JPEG, PNG, WebP, HEIC
- Display orders must be unique
- Only one image can be marked as primary

### Pending Changes Visibility

- **Hosts**: Cannot see pending changes until admin approves
- **Admins**: Can see both current images and pending changes when reviewing

### Request Status Flow

1. `REQUESTED` - Request created, awaiting upload
2. `RECEIVED` - Images uploaded, awaiting admin review
3. `VERIFIED` - Admin approved (changes now visible)
4. `REJECTED` - Admin rejected (changes discarded, existing images preserved)

---

## Admin Review (For Reference)

When an admin reviews a listing with pending image changes, they will see:

```typescript
{
  listing: { /* ... */ },
  images: [ /* current approved images */ ],
  pendingImageChanges: {
    requestId: string;
    imagesToAdd: [ /* new images awaiting approval */ ],
    imagesToDelete: [ /* images marked for deletion */ ],
    createdAt: string;
  }
}
```

Admins can:

- **Approve**: New images become visible, marked images are deleted
- **Reject**: New images are discarded, existing images remain unchanged

---

## Error Handling

### Common Errors

**400 Bad Request:**

```typescript
{
  error: "BAD_REQUEST",
  message: "Cannot update images for listing with status: DRAFT. Listing must be APPROVED or ONLINE."
}
```

**400 Bad Request (No Changes):**

```typescript
{
  error: "BAD_REQUEST",
  message: "Must specify at least one image to add or delete"
}
```

**401 Unauthorized (Expired Token):**

```typescript
{
  error: "UNAUTHORIZED",
  message: "Invalid or expired submission token"
}
```

**404 Not Found:**

```typescript
{
  error: "NOT_FOUND",
  message: "Listing not found: listing_abc123"
}
```

---

## Testing Checklist

- [ ] Can submit request with only new images
- [ ] Can submit request with only deleted images
- [ ] Can submit request with both new and deleted images
- [ ] Cannot submit empty request (no changes)
- [ ] Cannot update DRAFT listing
- [ ] Cannot update IN_REVIEW listing
- [ ] S3 upload works for all supported image formats
- [ ] Confirm submission works after successful upload
- [ ] Error handling for expired submission token
- [ ] Error handling for failed S3 upload
- [ ] Success message displays correctly
- [ ] Pending changes not visible to host until approved

---

## UI/UX Recommendations

1. **Show Preview**: Display a preview of what the listing will look like after changes are approved
2. **Validation**: Warn if deleting all images or if total exceeds 15
3. **Progress Indicator**: Show upload progress for large images
4. **Confirmation**: Ask for confirmation before submitting
5. **Status Badge**: Show "Pending Review" badge on listings with pending image changes
6. **Disable Editing**: Prevent submitting new image updates while one is pending review

---

## Example UI Flow

```
1. Host views their APPROVED listing
   ↓
2. Clicks "Update Images" button
   ↓
3. Modal shows:
   - Current images (with delete checkboxes)
   - File picker for new images
   - Preview of changes
   ↓
4. Host selects changes and clicks "Submit for Review"
   ↓
5. Progress indicator shows:
   - "Preparing request..."
   - "Uploading images... (2/3)"
   - "Confirming submission..."
   ↓
6. Success message:
   "Your image update has been submitted for admin review.
    You'll receive an email once it's been reviewed."
   ↓
7. Listing shows "Pending Image Review" badge
   ↓
8. Admin reviews and approves/rejects
   ↓
9. Host receives email notification
   ↓
10. Changes are visible (if approved) or discarded (if rejected)
```

---

## Questions?

If you encounter any issues or have questions about implementation, please reach out to the backend team.
