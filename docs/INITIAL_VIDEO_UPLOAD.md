# Initial Property Video Upload (Optional)

Hosts can now optionally upload a property video during listing creation for faster verification.

## API Changes

### Submit Intent Request

Add optional `initialVideo` field:

```typescript
{
  // ... existing fields ...
  initialVideo?: {
    contentType: string;  // "video/mp4" | "video/mov" | "video/webm"
    fileSize: number;     // bytes (max 200MB)
  }
}
```

### Submit Intent Response

If `initialVideo` was provided, response includes:

```typescript
{
  // ... existing fields ...
  initialVideoUploadUrl?: {
    uploadUrl: string;   // Presigned S3 PUT URL
    expiresAt: string;   // ISO timestamp
  }
}
```

### Confirm Submission Request

Add optional flag:

```typescript
{
  submissionToken: string;
  uploadedImages: string[];
  uploadedDocuments?: string[];
  uploadedInitialVideo?: boolean;  // true if video was uploaded
}
```

## Frontend Implementation

```typescript
// 1. Include video in submit-intent if user provides one
const intentPayload = {
  // ... listing data ...
  initialVideo: videoFile ? {
    contentType: videoFile.type,
    fileSize: videoFile.size,
  } : undefined,
};

const intentResponse = await submitListingIntent(hostId, intentPayload);

// 2. Upload video to presigned URL (if provided)
if (intentResponse.initialVideoUploadUrl && videoFile) {
  await fetch(intentResponse.initialVideoUploadUrl.uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': videoFile.type,
      'Content-Length': videoFile.size.toString(),
    },
    body: videoFile,
  });
}

// 3. Confirm submission with video flag
await confirmSubmission(hostId, listingId, {
  submissionToken: intentResponse.submissionToken,
  uploadedImages: [...imageIds],
  uploadedDocuments: [...docTypes],
  uploadedInitialVideo: !!videoFile,
});
```

## Constraints

- **Max size**: 200MB
- **Allowed types**: `video/mp4`, `video/mov`, `video/webm`
- **Optional**: Listing can be created without video
- **Location**: Stored at `{hostId}/listings/{listingId}/initial_video/property-video.{ext}`

