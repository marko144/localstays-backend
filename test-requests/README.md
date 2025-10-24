# API Test Requests

Example requests for testing the Localstays API endpoints.

## Prerequisites

1. **Get JWT Token**: Sign up or log in to get an ID token
2. **Get HostId**: Extract `hostId` from the JWT token claims
3. **Set Environment Variables**:
   ```bash
   export API_URL="https://your-api-id.execute-api.eu-north-1.amazonaws.com/dev1"
   export JWT_TOKEN="your-jwt-id-token"
   export HOST_ID="host_your-uuid"
   ```

## Workflow

### Step 1: Submit Profile Intent

This creates a submission and generates pre-signed upload URLs.

**Individual Host:**

```bash
curl -X POST "${API_URL}/api/v1/hosts/${HOST_ID}/profile/submit-intent" \
  -H "Authorization: Bearer ${JWT_TOKEN}" \
  -H "Content-Type: application/json" \
  -d @test-requests/submit-intent-individual.json
```

**Business Host:**

```bash
curl -X POST "${API_URL}/api/v1/hosts/${HOST_ID}/profile/submit-intent" \
  -H "Authorization: Bearer ${JWT_TOKEN}" \
  -H "Content-Type: application/json" \
  -d @test-requests/submit-intent-business.json
```

**Expected Response:**

```json
{
  "success": true,
  "hostId": "host_uuid",
  "submissionToken": "sub_uuid",
  "expiresAt": "2025-10-24T12:15:00Z",
  "uploadUrls": [
    {
      "documentId": "doc_uuid_1",
      "documentType": "PASSPORT",
      "uploadUrl": "https://s3.amazonaws.com/...",
      "expiresAt": "2025-10-24T12:10:00Z"
    },
    {
      "documentId": "doc_uuid_2",
      "documentType": "PROOF_OF_ADDRESS",
      "uploadUrl": "https://s3.amazonaws.com/...",
      "expiresAt": "2025-10-24T12:10:00Z"
    }
  ],
  "requiredDocuments": [
    "Government-issued ID (Passport, ID Card, or Driver's License)",
    "Proof of Address"
  ]
}
```

### Step 2: Upload Files to S3

Upload each file using the pre-signed URLs from Step 1:

```bash
# Upload passport
curl -X PUT "${UPLOAD_URL_1}" \
  -H "Content-Type: application/pdf" \
  --data-binary @documents/passport.pdf

# Upload proof of address
curl -X PUT "${UPLOAD_URL_2}" \
  -H "Content-Type: image/jpeg" \
  --data-binary @documents/utility_bill.jpg
```

### Step 3: Confirm Submission

After all files are uploaded, confirm the submission:

```bash
curl -X POST "${API_URL}/api/v1/hosts/${HOST_ID}/profile/confirm-submission" \
  -H "Authorization: Bearer ${JWT_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "submissionToken": "sub_uuid",
    "uploadedDocuments": [
      {
        "documentId": "doc_uuid_1",
        "documentType": "PASSPORT"
      },
      {
        "documentId": "doc_uuid_2",
        "documentType": "PROOF_OF_ADDRESS"
      }
    ]
  }'
```

**Expected Response:**

```json
{
  "success": true,
  "hostId": "host_uuid",
  "status": "VERIFICATION",
  "message": "Profile and documents submitted successfully. Pending admin review.",
  "submittedAt": "2025-10-24T12:05:00Z",
  "documents": [
    {
      "documentId": "doc_uuid_1",
      "documentType": "PASSPORT",
      "status": "PENDING",
      "uploadedAt": "2025-10-24T12:05:00Z"
    },
    {
      "documentId": "doc_uuid_2",
      "documentType": "PROOF_OF_ADDRESS",
      "status": "PENDING",
      "uploadedAt": "2025-10-24T12:05:00Z"
    }
  ]
}
```

### Step 4: Get Profile

Retrieve the submitted profile to display back to the user:

```bash
curl -X GET "${API_URL}/api/v1/hosts/${HOST_ID}/profile" \
  -H "Authorization: Bearer ${JWT_TOKEN}"
```

Or use the helper script:

```bash
# Set environment variables first
export API_URL="https://your-api-id.execute-api.eu-north-1.amazonaws.com/dev1"
export ID_TOKEN="your-jwt-token"
export HOST_ID="host_your-uuid"

# Run the script
./test-requests/get-profile.sh
```

**Expected Response:**

```json
{
  "hostId": "host_uuid",
  "hostType": "INDIVIDUAL",
  "status": "VERIFICATION",
  "email": "marko@example.com",
  "phone": "+381601234567",
  "preferredLanguage": "sr-RS",
  "countryCode": "RS",
  "address": {
    "addressLine1": "Kneza Miloša 10",
    "addressLine2": "Stan 5",
    "locality": "Beograd",
    "administrativeArea": "Grad Beograd",
    "postalCode": "11000",
    "countryCode": "RS"
  },
  "forename": "Marko",
  "surname": "Babić",
  "kyc": {
    "status": "PENDING",
    "submittedAt": "2025-10-24T12:05:00Z",
    "approvedAt": null,
    "rejectedAt": null,
    "rejectReason": null,
    "notes": null
  },
  "documents": [
    {
      "documentId": "doc_uuid_1",
      "documentType": "PASSPORT",
      "fileName": "my_passport.pdf",
      "fileSize": 1234567,
      "mimeType": "application/pdf",
      "status": "PENDING",
      "uploadedAt": "2025-10-24T12:03:00Z",
      "reviewedAt": null,
      "rejectionReason": null
    },
    {
      "documentId": "doc_uuid_2",
      "documentType": "PROOF_OF_ADDRESS",
      "fileName": "utility_bill.pdf",
      "fileSize": 987654,
      "mimeType": "application/pdf",
      "status": "PENDING",
      "uploadedAt": "2025-10-24T12:03:30Z",
      "reviewedAt": null,
      "rejectionReason": null
    }
  ],
  "createdAt": "2025-10-20T10:00:00Z",
  "updatedAt": "2025-10-24T12:05:00Z"
}
```

## Error Scenarios

### Invalid Profile Data

```bash
# Missing required fields
curl -X POST "${API_URL}/api/v1/hosts/${HOST_ID}/profile/submit-intent" \
  -H "Authorization: Bearer ${JWT_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"profile": {"hostType": "INDIVIDUAL"}, "documents": []}'
```

**Expected: 422 Unprocessable Entity**

### Missing Documents

```bash
# INDIVIDUAL without proof of address
curl -X POST "${API_URL}/api/v1/hosts/${HOST_ID}/profile/submit-intent" \
  -H "Authorization: Bearer ${JWT_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "profile": {...},
    "documents": [{"documentType": "PASSPORT", ...}]
  }'
```

**Expected: 422 Unprocessable Entity**

### Expired Token

```bash
# Try to confirm after 15 minutes
curl -X POST "${API_URL}/api/v1/hosts/${HOST_ID}/profile/confirm-submission" \
  -H "Authorization: Bearer ${JWT_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"submissionToken": "expired_token", ...}'
```

**Expected: 400 Bad Request - "Submission token has expired"**

### Files Not Uploaded

```bash
# Confirm without uploading files
curl -X POST "${API_URL}/api/v1/hosts/${HOST_ID}/profile/confirm-submission" \
  -H "Authorization: Bearer ${JWT_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"submissionToken": "sub_uuid", "uploadedDocuments": [...]}'
```

**Expected: 400 Bad Request - "Not all files have been uploaded to S3"**

## Frontend Integration Example

```typescript
// Step 1: Submit intent
const intentResponse = await fetch(
  `${apiUrl}/api/v1/hosts/${hostId}/profile/submit-intent`,
  {
    method: "POST",
    headers: {
      Authorization: `Bearer ${idToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ profile, documents }),
  }
);

const { submissionToken, uploadUrls } = await intentResponse.json();

// Step 2: Upload files
await Promise.all(
  uploadUrls.map(async (urlData) => {
    const file = files.find((f) => f.type === urlData.documentType);
    await fetch(urlData.uploadUrl, {
      method: "PUT",
      body: file,
      headers: { "Content-Type": file.type },
    });
  })
);

// Step 3: Confirm
const confirmResponse = await fetch(
  `${apiUrl}/api/v1/hosts/${hostId}/profile/confirm-submission`,
  {
    method: "POST",
    headers: {
      Authorization: `Bearer ${idToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      submissionToken,
      uploadedDocuments: uploadUrls.map((u) => ({
        documentId: u.documentId,
        documentType: u.documentType,
      })),
    }),
  }
);
```
