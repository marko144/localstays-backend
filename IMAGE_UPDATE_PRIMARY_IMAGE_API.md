# Image Update API - Setting Primary Image

## Overview

When a host submits an image update request, they can specify which image should be the primary (cover) image using the `isPrimary` field. Only **one** image should have `isPrimary: true`.

---

## API Endpoint

**POST** `/api/v1/hosts/{hostId}/listings/{listingId}/image-update`

### Headers

```
Authorization: Bearer {cognito_token}
Content-Type: application/json
```

---

## Request Structure

### TypeScript Interface

```typescript
interface SubmitImageUpdateRequest {
  imagesToAdd?: Array<{
    imageId: string; // Generate with crypto.randomUUID()
    contentType: string; // 'image/jpeg', 'image/png', 'image/webp', 'image/heic'
    isPrimary: boolean; // TRUE for cover image, FALSE for all others
    displayOrder: number; // 1-15 (ordering for gallery display)
    caption?: string; // Optional image description
  }>;
  imagesToDelete?: string[]; // Array of imageIds to delete
  newPrimaryImageId?: string; // Change which existing image is primary (without adding/deleting)
}
```

---

## Important Rules

### Setting Primary Image

1. **Exactly one image must have `isPrimary: true`**

   - If adding new images: one of the new images should have `isPrimary: true`, OR
   - If keeping existing images: ensure one existing image remains as primary

2. **If deleting the current primary image:**

   - You **must** specify a new primary image in `imagesToAdd`, OR
   - Ensure at least one existing image (not being deleted) remains to become primary

3. **The primary image will become `imageIndex: 0` in the published listing**
   - This is the thumbnail shown in search results
   - All other images will be ordered by `displayOrder`

---

## Example Scenarios

### Scenario 1: Change Primary Image (Existing Images Only)

**Use Case**: Host wants to change which existing image is the cover, without adding or deleting any images

```json
{
  "newPrimaryImageId": "existing-image-id-456"
}
```

**Backend Behavior**:

- Old primary image: `isPrimary` set to `false`
- New primary image (`existing-image-id-456`): `isPrimary` set to `true`
- All changes propagate to `PublicListings` and `PublicListingMedia` if listing is ONLINE

---

### Scenario 2: Adding New Images (Including New Primary)

**IMPORTANT**: When adding a new image with `isPrimary: true`, the backend will **automatically** clear the `isPrimary` flag from the old primary image. You don't need to handle this manually.

**Use Case**: Host wants to replace the cover image with a new photo

```json
{
  "imagesToAdd": [
    {
      "imageId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "contentType": "image/webp",
      "isPrimary": true, // ← NEW PRIMARY IMAGE
      "displayOrder": 1,
      "caption": "Beautiful sunset view"
    },
    {
      "imageId": "b2c3d4e5-f6a7-8901-bcde-f12345678901",
      "contentType": "image/jpeg",
      "isPrimary": false, // ← Not primary
      "displayOrder": 2,
      "caption": "Living room"
    }
  ]
}
```

---

### Scenario 2: Adding Images Without Changing Primary

**Use Case**: Host wants to add more photos but keep the existing cover image

```json
{
  "imagesToAdd": [
    {
      "imageId": "c3d4e5f6-a7b8-9012-cdef-123456789012",
      "contentType": "image/png",
      "isPrimary": false, // ← Keep existing primary
      "displayOrder": 3
    }
  ]
}
```

**Note**: In this case, the existing primary image remains as `imageIndex: 0`

---

### Scenario 3: Deleting Images (Including Current Primary)

**Use Case**: Host wants to delete the current cover image and set a new one

```json
{
  "imagesToDelete": [
    "old-primary-image-id" // ← Deleting current primary
  ],
  "imagesToAdd": [
    {
      "imageId": "d4e5f6a7-b8c9-0123-def1-234567890123",
      "contentType": "image/webp",
      "isPrimary": true, // ← NEW PRIMARY IMAGE
      "displayOrder": 1,
      "caption": "New cover photo"
    }
  ]
}
```

---

### Scenario 4: Only Deleting Images (No New Primary Needed)

**Use Case**: Host wants to delete some images but NOT the primary

```json
{
  "imagesToDelete": ["image-id-2", "image-id-3"]
}
```

**Note**: The existing primary image remains unchanged

---

## Validation Rules

### Backend Validation (Automatic)

1. ✅ At least one change must be specified (`imagesToAdd`, `imagesToDelete`, or `newPrimaryImageId`)
2. ✅ `displayOrder` must be between 1 and 15
3. ✅ Content type must be valid image MIME type
4. ✅ Listing must be in `APPROVED` or `ONLINE` status
5. ✅ Cannot specify both `isPrimary: true` in `imagesToAdd` AND `newPrimaryImageId` (use one method)
6. ✅ If `newPrimaryImageId` is provided, the image must exist, not be deleted, and be in `READY` status
7. ✅ **Automatic**: When a new primary is set (via either method), the old primary image's `isPrimary` flag is automatically cleared

### Frontend Should Validate

1. ⚠️ **Exactly one image must have `isPrimary: true` across all remaining images**

   - Count existing images (not being deleted)
   - Add new images being added
   - Ensure exactly one has `isPrimary: true`

2. ⚠️ **If deleting the current primary image, a new primary must be specified**

3. ⚠️ **All `isPrimary: false` except for exactly one image with `isPrimary: true`**

---

## Response Structure

### Success Response (200 OK)

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

### Error Responses

- `400`: Invalid request
  - Missing `hostId` or `listingId`
  - No changes specified
  - Listing not in `APPROVED` or `ONLINE` status
  - Invalid `displayOrder` or `contentType`
- `401`: Unauthorized (invalid or missing token)

- `403`: Forbidden (listing doesn't belong to this host)

- `404`: Listing not found

---

## Complete Workflow

1. **Host selects images to add/delete in UI**
2. **Frontend validates:**
   - Exactly one image is marked as primary
   - If deleting primary, a new primary is selected
3. **Frontend submits request** with `isPrimary` correctly set
4. **Backend creates request** and returns pre-signed URLs
5. **Frontend uploads images** to S3 using returned URLs
6. **Frontend confirms submission**
7. **Admin reviews and approves** request
8. **Backend processes approval:**
   - Updates main listing images
   - Sets image with `isPrimary: true` as `imageIndex: 0` in `PublicListingMedia`
   - Updates thumbnail in `PublicListings` table
9. **Changes go live** ✅

---

## Notes for Frontend Developer

### Primary Image Selection UI

Consider implementing one of these patterns:

**Option A: Radio Button**

```
○ Image 1 (Current: Cover Image)
● Image 2 (New Cover Image)  ← Selected as primary
○ Image 3
```

**Option B: Star/Badge Icon**

```
Image 1  [☆ Set as Cover]
Image 2  [★ Cover Image]  ← Marked as primary
Image 3  [☆ Set as Cover]
```

**Option C: Drag to Reorder**

```
First image in order is automatically primary
(Simplest UX, but less explicit)
```

### Recommended: Radio Button + Visual Indicator

- Show a radio button or toggle for each image
- Visually highlight the primary image (border, badge, etc.)
- When user selects a new primary, automatically unset the previous one
- Show warning if trying to delete primary without selecting a new one

---

## Example Frontend Code

### React/TypeScript Example

```typescript
interface ImageToAdd {
  imageId: string;
  file: File;
  contentType: string;
  isPrimary: boolean;
  displayOrder: number;
  caption?: string;
}

const [imagesToAdd, setImagesToAdd] = useState<ImageToAdd[]>([]);
const [imagesToDelete, setImagesToDelete] = useState<string[]>([]);
const [currentPrimaryImageId, setCurrentPrimaryImageId] = useState<
  string | null
>(null);

// Handle setting new primary image
const handleSetPrimary = (imageId: string) => {
  setImagesToAdd((prev) =>
    prev.map((img) => ({
      ...img,
      isPrimary: img.imageId === imageId,
    }))
  );
};

// Validate before submit
const validateImageUpdate = (): boolean => {
  // Get all remaining images (existing + new - deleted)
  const remainingExisting = existingImages.filter(
    (img) => !imagesToDelete.includes(img.imageId)
  );

  const allImages = [...remainingExisting, ...imagesToAdd];

  // Check exactly one primary
  const primaryCount = allImages.filter((img) => img.isPrimary).length;

  if (primaryCount !== 1) {
    alert("Exactly one image must be set as the cover image");
    return false;
  }

  return true;
};

// Submit request
const submitImageUpdate = async () => {
  if (!validateImageUpdate()) return;

  const response = await fetch(
    `/api/v1/hosts/${hostId}/listings/${listingId}/image-update`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        imagesToAdd: imagesToAdd.map((img) => ({
          imageId: img.imageId,
          contentType: img.contentType,
          isPrimary: img.isPrimary,
          displayOrder: img.displayOrder,
          caption: img.caption,
        })),
        imagesToDelete: imagesToDelete,
      }),
    }
  );

  // ... handle response, upload to S3, confirm submission
};
```

---

## Summary

- Use `isPrimary: true` on exactly **one** image to set the cover image
- The image with `isPrimary: true` will become `imageIndex: 0` in published listings
- This image's thumbnail will be shown in search results
- All other images should have `isPrimary: false`
- Frontend should validate that exactly one primary image exists before submitting
