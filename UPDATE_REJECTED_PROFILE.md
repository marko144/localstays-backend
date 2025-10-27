# Update Rejected Profile Endpoint

## Overview

This endpoint allows hosts to resubmit their profile data after it has been rejected by an admin. It provides flexibility by making document uploads **optional**, allowing hosts to update only their profile data or to also upload new documents.

## Endpoint Details

**URL**: `PUT https://tqaq505m83.execute-api.eu-north-1.amazonaws.com/dev1/api/v1/hosts/{hostId}/profile/update-rejected`

**Authentication**: Required (Cognito JWT token)

**Authorization**: Hosts can only update their own profiles

## Use Cases

### 1. Profile Data Only Update

If a host was rejected due to incorrect profile information (e.g., wrong address, phone number, business details), they can resubmit with corrected profile data **without** re-uploading documents.

### 2. Profile + New Documents

If a host was rejected due to document issues or needs to update both profile and documents, they can provide new documents along with the profile update.

### 3. Documents Only Update

While the endpoint requires profile data, hosts can submit the same profile data with new documents if only document changes are needed.

## Request Format

### Request Body

```json
{
  "profile": {
    "hostType": "INDIVIDUAL" | "BUSINESS",
    "firstName": "string",
    "lastName": "string",
    "email": "string",
    "phone": "string",
    "address": {
      "street": "string",
      "city": "string",
      "state": "string",
      "postalCode": "string",
      "country": "string"
    },
    // For BUSINESS hosts:
    "businessName": "string",
    "businessRegistrationNumber": "string",
    "vatRegistered": boolean,
    "vatNumber": "string" // Required if vatRegistered is true
  },
  "documents": [ // OPTIONAL
    {
      "documentType": "PASSPORT" | "ID_CARD" | "DRIVERS_LICENSE" | "PROOF_OF_ADDRESS" | "BUSINESS_REGISTRATION" | "VAT_CERTIFICATE",
      "fileName": "string",
      "fileSize": number,
      "mimeType": "application/pdf" | "image/jpeg" | "image/jpg" | "image/png"
    }
  ]
}
```

## Response Format

### Success Response (200 OK)

```json
{
  "success": true,
  "hostId": "host_uuid",
  "submissionToken": "tok_uuid",
  "expiresAt": "2025-01-27T12:45:00.000Z",
  "uploadUrls": [
    {
      "documentId": "doc_uuid",
      "documentType": "PASSPORT",
      "uploadUrl": "https://presigned-s3-url",
      "expiresAt": "2025-01-27T12:55:00.000Z"
    }
  ],
  "message": "Profile and documents ready for upload. Upload documents then call confirm-submission."
}
```

### Success Response (Profile Only - No Documents)

```json
{
  "success": true,
  "hostId": "host_uuid",
  "submissionToken": "tok_uuid",
  "expiresAt": "2025-01-27T12:45:00.000Z",
  "uploadUrls": [],
  "message": "Profile data updated. Call confirm-submission to finalize changes."
}
```

### Error Responses

#### 400 Bad Request - Not Rejected

```json
{
  "success": false,
  "error": {
    "code": "BAD_REQUEST",
    "message": "Profile cannot be updated. Current status: APPROVED. Only REJECTED profiles can be resubmitted."
  }
}
```

#### 404 Not Found

```json
{
  "success": false,
  "error": {
    "code": "NOT_FOUND",
    "message": "Host profile not found"
  }
}
```

#### 422 Unprocessable Entity - Profile Validation Failed

```json
{
  "success": false,
  "error": {
    "code": "UNPROCESSABLE_ENTITY",
    "message": "Profile validation failed",
    "details": {
      "errors": ["firstName is required", "Invalid email format"]
    }
  }
}
```

#### 422 Unprocessable Entity - Document Validation Failed

```json
{
  "success": false,
  "error": {
    "code": "UNPROCESSABLE_ENTITY",
    "message": "Required documents missing",
    "details": {
      "missing": ["One of: PASSPORT or ID_CARD or DRIVERS_LICENSE"],
      "errors": []
    }
  }
}
```

## Workflow

### Step 1: Update Rejected Profile

Call this endpoint to initiate the profile update:

```bash
curl -X PUT https://tqaq505m83.execute-api.eu-north-1.amazonaws.com/dev1/api/v1/hosts/{hostId}/profile/update-rejected \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "profile": {
      "hostType": "INDIVIDUAL",
      "firstName": "John",
      "lastName": "Doe",
      ...
    },
    "documents": [
      {
        "documentType": "PASSPORT",
        "fileName": "passport.pdf",
        "fileSize": 1024000,
        "mimeType": "application/pdf"
      }
    ]
  }'
```

### Step 2: Upload Documents (if provided)

If documents were included in step 1, upload each document to its presigned URL:

```bash
curl -X PUT "PRESIGNED_S3_URL" \
  -H "Content-Type: application/pdf" \
  --data-binary "@passport.pdf"
```

### Step 3: Confirm Submission

Call the confirm-submission endpoint to finalize:

```bash
curl -X POST https://tqaq505m83.execute-api.eu-north-1.amazonaws.com/dev1/api/v1/hosts/{hostId}/profile/confirm-submission \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "submissionToken": "tok_uuid",
    "uploads": [
      {
        "documentId": "doc_uuid",
        "uploadedAt": "2025-01-27T12:50:00.000Z"
      }
    ]
  }'
```

**Note**: If no documents were provided in step 1, still call confirm-submission with an empty `uploads` array.

## Important Notes

### 1. Profile Status Requirement

- This endpoint **only works** for profiles with status `REJECTED`
- Profiles with status `PENDING`, `APPROVED`, or `SUSPENDED` cannot use this endpoint
- Attempting to update a non-rejected profile will result in a 400 error

### 2. Document Requirements

- Documents are **OPTIONAL** for this endpoint
- If documents are provided, they **must still meet the requirements** for the host type:
  - **INDIVIDUAL**: At least one government ID + Proof of Address
  - **BUSINESS**: At least one government ID + Business Registration + Proof of Address + VAT Certificate (if VAT registered)
- If no documents are provided, existing documents remain unchanged

### 3. Submission Token

- The submission token expires in **15 minutes**
- Document upload URLs expire in **10 minutes**
- You must complete the entire workflow before expiration

### 4. Profile Data Replacement

- The profile data provided **completely replaces** the existing profile
- All fields must be provided (even if unchanged)
- Missing fields will result in validation errors

### 5. Document Replacement

- New documents **do not** automatically replace old documents
- Old documents remain in the system with their current status
- Admin will see both old and new documents during review
- Old documents can be marked as superseded by new ones during admin review

## Database Structure

### Submission Token Record

```
PK: SUBMISSION#{submissionToken}
SK: META
Attributes:
  - submissionToken: tok_{uuid}
  - hostId: host_{uuid}
  - userId: {cognito_sub}
  - status: PENDING_UPLOAD
  - profileData: {full profile object}
  - expectedDocuments: [{documentId, documentType, uploaded: false}]
  - expiresAt: {unix_timestamp}
  - createdAt: {iso_timestamp}
  - updatedAt: {iso_timestamp}
  - completedAt: null
```

### Host Profile Update

```
PK: HOST#{hostId}
SK: PROFILE
Updated Attributes:
  - currentSubmissionToken: tok_{uuid}
  - lastSubmissionAttempt: {iso_timestamp}
  - submissionExpiresAt: {unix_timestamp}
  - updatedAt: {iso_timestamp}
```

### Document Records (if provided)

```
PK: HOST#{hostId}
SK: DOCUMENT#{documentId}
Attributes:
  - documentId: doc_{uuid}
  - hostId: host_{uuid}
  - documentType: PASSPORT | ID_CARD | etc.
  - fileName: {original_filename}
  - fileSize: {bytes}
  - mimeType: {mime_type}
  - status: PENDING_UPLOAD
  - s3Key: {hostId}/verification/{documentId}_{fileName}
  - s3Bucket: {bucket_name}
  - uploadedBy: {cognito_sub}
  - uploadedAt: {iso_timestamp}
  - createdAt: {iso_timestamp}
  - updatedAt: {iso_timestamp}
```

## Integration with Existing Endpoints

### GET /api/v1/hosts/{hostId}/profile

- Returns the current profile status
- Shows rejection reason if status is REJECTED
- Useful for displaying rejection details to the user before they update

### POST /api/v1/hosts/{hostId}/profile/confirm-submission

- Used to finalize both initial submissions and rejected profile updates
- No changes needed - works with both workflows
- Validates that all expected documents are uploaded (if any were specified)

## Security & Permissions

### IAM Permissions

The Lambda function has:

- **DynamoDB**: `ReadWriteData` on main table
- **S3**: `PutObject` on host assets bucket (for presigned URL generation)

### Authorization

- User must be authenticated via Cognito
- User must match the `hostId` in the path (verified by `assertCanAccessHost`)
- Only the host owner can update their rejected profile

## Testing

### Test Scenario 1: Profile Only Update

```bash
# 1. Reject a host profile via admin endpoint
# 2. Update with profile data only
PUT /api/v1/hosts/{hostId}/profile/update-rejected
{
  "profile": {...},
  "documents": []  // or omit entirely
}
# 3. Confirm submission with empty uploads
POST /api/v1/hosts/{hostId}/profile/confirm-submission
{
  "submissionToken": "tok_...",
  "uploads": []
}
```

### Test Scenario 2: Profile + Documents Update

```bash
# 1. Reject a host profile via admin endpoint
# 2. Update with profile data and new documents
PUT /api/v1/hosts/{hostId}/profile/update-rejected
{
  "profile": {...},
  "documents": [...]
}
# 3. Upload all documents to presigned URLs
# 4. Confirm submission with upload details
POST /api/v1/hosts/{hostId}/profile/confirm-submission
{
  "submissionToken": "tok_...",
  "uploads": [...]
}
```

### Test Scenario 3: Non-Rejected Profile

```bash
# 1. Try to update an approved profile
PUT /api/v1/hosts/{hostId}/profile/update-rejected
# Expected: 400 Bad Request with status mismatch error
```

## Future Enhancements

1. **Partial Profile Updates**: Allow updating specific fields instead of requiring all fields
2. **Document Versioning**: Automatically mark old documents as superseded when new ones are uploaded
3. **Change History**: Track what changed between submissions for admin review
4. **Validation Feedback**: Return more detailed validation feedback based on rejection reason
5. **Auto-approve Minor Changes**: For hosts with good standing, auto-approve minor profile updates

## Lambda Function

**Name**: `localstays-dev1-update-rejected-profile`

**File**: `backend/services/api/hosts/update-rejected-profile.ts`

**Handler**: `handler`

**Memory**: 512 MB

**Timeout**: 30 seconds

## Deployment

Deployed automatically via CDK:

```bash
npx cdk deploy LocalstaysDev1ApiStack -c env=dev1
```
