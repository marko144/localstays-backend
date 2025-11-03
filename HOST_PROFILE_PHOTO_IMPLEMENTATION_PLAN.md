# Host Profile Photo Implementation Plan

## Overview

Add support for hosts to upload a profile photo during profile submission. The photo will be processed through the existing image processing pipeline (malware scanning + WebP conversion) and stored in the host's S3 folder.

---

## Current System Understanding

### Listing Image Flow

1. **Upload**: Client uploads to S3 root with `lstimg_{imageId}.jpg` prefix
2. **Metadata**: S3 object has metadata (`hostId`, `listingId`, `imageId`)
3. **DynamoDB**: Record created with `pk: HOST#{hostId}`, `sk: LISTING_IMAGE#{listingId}#{imageId}`
4. **GuardDuty**: Scans file at root
5. **Image Processor Lambda**:
   - Reads S3 metadata to get `hostId`, `listingId`, `imageId`
   - Queries DynamoDB using `pk` and `sk`
   - Converts to WebP (full + thumbnail)
   - Uploads to `{hostId}/listings/{listingId}/images/`
   - Deletes original from root
   - Updates DynamoDB record status to `READY`

### Host Profile Flow

1. **Submit Intent**: Host submits profile data + document intents
2. **Documents**: Upload verification documents (ID, proof of address, etc.) with `veri_profile-doc_` prefix
3. **Confirm Submission**: Verifies all documents uploaded, updates status to `VERIFICATION`
4. **Get Profile**: Returns host data + document metadata (no image currently)

---

## Implementation Plan

### 1. TypeScript Type Updates

**File: `backend/services/types/host.types.ts`**

Add profile photo types:

```typescript
export interface ProfilePhoto {
  photoId: string;
  s3Key: string; // Original location (root): lstimg_{photoId}.jpg
  webpUrls?: {
    thumbnail: string; // {hostId}/profile/photo_thumbnail.webp
    full: string; // {hostId}/profile/photo_full.webp
  };
  dimensions?: {
    width: number;
    height: number;
  };
  contentType: string;
  fileSize: number;
  status: "PENDING_UPLOAD" | "PENDING_SCAN" | "READY" | "QUARANTINED";
  uploadedAt: string;
  isDeleted: boolean;
}
```

Update `SubmitIntentRequest` interface:

```typescript
interface SubmitIntentRequest {
  profile: ProfileData;
  documents: DocumentUploadIntent[];
  profilePhoto?: {
    photoId: string;
    contentType: string; // image/jpeg, image/png, etc.
    fileSize: number; // In bytes
  };
}
```

Update response interface:

```typescript
interface SubmitIntentResponse {
  success: true;
  hostId: string;
  submissionToken: string;
  expiresAt: string;
  uploadUrls: DocumentUploadUrl[];
  profilePhotoUploadUrl?: {
    photoId: string;
    uploadUrl: string;
    expiresAt: string;
  };
}
```

Add to `BaseHost` interface:

```typescript
export interface BaseHost {
  // ... existing fields ...
  profilePhoto?: ProfilePhoto; // Optional
}
```

---

### 2. Submit Intent Lambda (`hosts/submit-intent.ts`)

**Changes**:

1. **Validation**: Add optional profile photo validation

   - Validate `photoId` is UUID format
   - Validate `contentType` is image (jpeg, png, webp)
   - Validate `fileSize` (max 10MB)

2. **S3 Key Generation**:

   ```typescript
   const s3Key = `lstimg_${profilePhoto.photoId}.${getFileExtension(
     profilePhoto.contentType
   )}`;
   ```

3. **DynamoDB Record**: Create profile photo placeholder

   ```typescript
   await docClient.send(
     new PutCommand({
       TableName: TABLE_NAME,
       Item: {
         pk: `HOST#${hostId}`,
         sk: `PROFILE_PHOTO#${profilePhoto.photoId}`,

         hostId,
         photoId: profilePhoto.photoId,

         s3Key, // Root location: lstimg_{photoId}.jpg
         finalS3Prefix: `${hostId}/profile/`, // Final destination after processing

         contentType: profilePhoto.contentType,
         fileSize: profilePhoto.fileSize,

         status: "PENDING_UPLOAD",

         uploadedAt: now,
         isDeleted: false,
       },
     })
   );
   ```

4. **Pre-signed URL**: Generate upload URL with metadata

   ```typescript
   const uploadUrl = await generateUploadUrl(
     s3Key,
     profilePhoto.contentType,
     UPLOAD_URL_EXPIRY_SECONDS,
     {
       hostId,
       photoId: profilePhoto.photoId,
       entityType: "PROFILE_PHOTO", // New metadata to distinguish from listing images
     }
   );
   ```

5. **Response**: Include profile photo upload URL

---

### 3. Confirm Submission Lambda (`hosts/confirm-submission.ts`)

**Changes**:

1. **Verification**: Add profile photo verification (if provided)

   - Check if photo exists in S3 (or already processed with status `READY`)
   - Similar logic to listing image verification

2. **Transaction Update**: Add profile photo status update
   ```typescript
   if (profilePhoto) {
     transactItems.push({
       Update: {
         TableName: TABLE_NAME,
         Key: {
           pk: `HOST#${hostId}`,
           sk: `PROFILE_PHOTO#${profilePhoto.photoId}`,
         },
         UpdateExpression: "SET #status = :status",
         ExpressionAttributeNames: {
           "#status": "status",
         },
         ExpressionAttributeValues: {
           ":status": "PENDING_SCAN",
         },
       },
     });
   }
   ```

---

### 4. Image Processor Lambda (`image-processor/index.js`)

**Changes**:

1. **Detect Entity Type**: Check S3 metadata for `entityType`

   ```javascript
   const headResult = await s3Client.send(
     new HeadObjectCommand({
       Bucket: bucket,
       Key: key,
     })
   );

   const hostId = headResult.Metadata?.hostid;
   const entityType = headResult.Metadata?.entitytype || "LISTING_IMAGE"; // Default for backwards compatibility
   ```

2. **Route Based on Entity Type**:

   ```javascript
   if (entityType === "PROFILE_PHOTO") {
     await handleCleanProfilePhoto(bucket, key, hostId, photoId);
   } else {
     await handleCleanFile(bucket, key, imageId); // Existing listing image logic
   }
   ```

3. **New Handler: `handleCleanProfilePhoto`**:

   ```javascript
   async function handleCleanProfilePhoto(bucket, key, hostId, photoId) {
     // 1. Query DynamoDB for profile photo record
     const photoRecord = await docClient.send(
       new QueryCommand({
         TableName: TABLE_NAME,
         KeyConditionExpression: "pk = :pk AND sk = :sk",
         ExpressionAttributeValues: {
           ":pk": `HOST#${hostId}`,
           ":sk": `PROFILE_PHOTO#${photoId}`,
         },
         Limit: 1,
       })
     );

     // 2. Download and process image (same as listing images)
     // 3. Upload WebP versions to: {hostId}/profile/photo_full.webp and photo_thumbnail.webp
     // 4. Update DynamoDB with webpUrls and dimensions
     // 5. Delete original from root
     // 6. Update host META record with profilePhoto reference
   }
   ```

4. **Host META Update**: After processing, update the host's main record

   ```javascript
   await docClient.send(
     new UpdateCommand({
       TableName: TABLE_NAME,
       Key: {
         pk: `HOST#${hostId}`,
         sk: "META",
       },
       UpdateExpression: "SET profilePhoto = :photo",
       ExpressionAttributeValues: {
         ":photo": {
           photoId,
           webpUrls: {
             thumbnail: `https://${bucket}.s3.amazonaws.com/${hostId}/profile/photo_thumbnail.webp`,
             full: `https://${bucket}.s3.amazonaws.com/${hostId}/profile/photo_full.webp`,
           },
           dimensions: { width, height },
           status: "READY",
         },
       },
     })
   );
   ```

5. **Infected File Handling**: Similar quarantine logic for profile photos
   - Move to `{hostId}/profile/quarantine/`
   - Update status to `QUARANTINED`

---

### 5. Get Profile Lambda (`hosts/get-profile.ts`)

**Changes**:

1. **Include Profile Photo in Response**:
   ```typescript
   const baseResponse = {
     hostId: host.hostId,
     // ... existing fields ...

     profilePhoto: host.profilePhoto
       ? {
           photoId: host.profilePhoto.photoId,
           thumbnailUrl: host.profilePhoto.webpUrls?.thumbnail || "",
           fullUrl: host.profilePhoto.webpUrls?.full || "",
           width: host.profilePhoto.dimensions?.width || 0,
           height: host.profilePhoto.dimensions?.height || 0,
           status: host.profilePhoto.status,
         }
       : null,

     // ... rest of response
   };
   ```

---

### 6. Update Rejected Profile Lambda (`hosts/update-rejected-profile.ts`)

**Changes**:

1. **Support Profile Photo Replacement**: Allow hosts to upload a new profile photo if rejected
2. **Same validation and flow as submit-intent**
3. **Soft delete old photo** (set `isDeleted: true`) if uploading new one

---

### 7. Admin Get Host Endpoint

**File: `backend/services/api/admin/hosts/get-host.ts`**

**Changes**:

- Include `profilePhoto` in the admin response
- Same structure as host get-profile endpoint

---

### 8. Database Considerations

**DynamoDB Structure**:

- **PK**: `HOST#{hostId}`
- **SK**: `PROFILE_PHOTO#{photoId}`
- **Attributes**: `photoId`, `s3Key`, `finalS3Prefix`, `webpUrls`, `dimensions`, `contentType`, `fileSize`, `status`, `uploadedAt`, `isDeleted`

**Access Patterns**:

- Get profile photo: Query by `pk: HOST#{hostId}` and `sk: PROFILE_PHOTO#{photoId}`
- No additional GSI needed (single photo per host)

---

### 9. S3 Structure

**Before Processing** (Bucket Root):

```
lstimg_{photoId}.jpg
```

**After Processing** (Host Folder):

```
{hostId}/
  profile/
    photo_full.webp
    photo_thumbnail.webp
    quarantine/
      lstimg_{photoId}.jpg  (if infected)
```

**Note**: Unlike listing images which go to `{hostId}/listings/{listingId}/images/`, profile photos go to `{hostId}/profile/`

---

### 10. Frontend Integration Notes

**Submit Intent Request**:

```json
{
  "profile": { ... },
  "documents": [ ... ],
  "profilePhoto": {
    "photoId": "uuid-generated-by-frontend",
    "contentType": "image/jpeg",
    "fileSize": 2048576
  }
}
```

**Submit Intent Response**:

```json
{
  "success": true,
  "hostId": "host_...",
  "submissionToken": "...",
  "expiresAt": "...",
  "uploadUrls": [ ... ],
  "profilePhotoUploadUrl": {
    "photoId": "...",
    "uploadUrl": "https://...",
    "expiresAt": "..."
  }
}
```

**Get Profile Response**:

```json
{
  "hostId": "host_...",
  "profilePhoto": {
    "photoId": "...",
    "thumbnailUrl": "https://...",
    "fullUrl": "https://...",
    "width": 1920,
    "height": 1080,
    "status": "READY"
  },
  ...
}
```

---

## Implementation Order

1. **Types** (`host.types.ts`) - Define interfaces
2. **Submit Intent** - Add photo upload support
3. **Image Processor** - Add profile photo processing logic
4. **Confirm Submission** - Add photo verification
5. **Get Profile** - Return photo URLs
6. **Update Rejected Profile** - Support photo replacement
7. **Admin Endpoints** - Include photo in admin views
8. **Testing** - End-to-end test with real photo upload

---

## Security & Validation

- **Max file size**: 10MB
- **Allowed formats**: JPEG, PNG, WebP
- **Malware scanning**: Same GuardDuty pipeline
- **Authorization**: Only host owner can upload/view their profile photo
- **Quarantine**: Infected photos moved to quarantine, host notified (via status)

---

## Backwards Compatibility

- Profile photo is **optional** - existing hosts without photos continue to work
- If `profilePhoto` field is missing/null, frontend shows placeholder avatar
- No database migration needed (just start accepting new records)

---

## Error Scenarios

1. **Upload fails**: Photo stays `PENDING_UPLOAD`, host can retry via update-rejected-profile
2. **Malware detected**: Photo quarantined, status becomes `QUARANTINED`, host must upload new photo
3. **Processing fails**: Lambda retries via SQS DLQ, admin notified if persistent failure
4. **Large file**: Validation rejects at submit-intent (before upload)

---

## Testing Checklist

- [ ] Upload photo during initial profile submission
- [ ] Upload photo when updating rejected profile
- [ ] Get profile returns photo URLs correctly
- [ ] Admin can view host profile photo
- [ ] Infected photo is quarantined
- [ ] Large file rejected (>10MB)
- [ ] Invalid content type rejected
- [ ] Photo optional (submission works without it)
- [ ] Host can replace photo after rejection
- [ ] S3 permissions correct (public read for processed images)

---

## Open Questions

1. **Photo replacement**: Should verified hosts be able to replace their profile photo? Or only during verification?
2. **Photo deletion**: Should hosts be able to delete their profile photo?
3. **Crop/resize**: Should frontend handle cropping, or should we accept any aspect ratio?
4. **Public access**: Should profile photos be publicly accessible or require auth?

**Recommendations**:

1. Allow photo replacement only during rejection/update flow (not after verification)
2. No deletion - they can replace with a different photo
3. Accept any aspect ratio, display as needed in frontend (circular crop, etc.)
4. Public read access (like listing images) - needed for public-facing host profiles


