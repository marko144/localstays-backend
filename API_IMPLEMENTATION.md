# Host Profile Submission API - Implementation Complete ✅

## Overview

This document describes the implementation of the host profile submission API with document upload functionality.

## Architecture

### Three API Endpoints

1. **Submit Intent** (`POST /api/v1/hosts/{hostId}/profile/submit-intent`)

   - Validates profile data and document requirements
   - Creates submission token (15 min expiry)
   - Generates pre-signed S3 upload URLs (10 min expiry)
   - Creates document records in DynamoDB

2. **Confirm Submission** (`POST /api/v1/hosts/{hostId}/profile/confirm-submission`)

   - Verifies all files uploaded to S3
   - Atomic transaction updates:
     - Host status: `INCOMPLETE` → `VERIFICATION`
     - Document status: `PENDING_UPLOAD` → `PENDING`
     - Submission token: `PENDING_UPLOAD` → `COMPLETED`

3. **Get Profile** (`GET /api/v1/hosts/{hostId}/profile`)
   - Retrieves host profile and document metadata
   - Returns polymorphic profile data (INDIVIDUAL or BUSINESS)
   - Includes KYC status and document statuses
   - No S3 URLs returned (just metadata: filename, type, status)

### Key Features

✅ **Polymorphic Validation** - Different required fields for INDIVIDUAL vs BUSINESS hosts  
✅ **Document Requirements** - Dynamic based on host type and VAT registration  
✅ **Pre-Signed URLs** - Secure client-side S3 uploads without backend proxying  
✅ **Atomic Transactions** - DynamoDB transactions ensure data consistency  
✅ **Idempotency** - Duplicate confirm calls return success safely  
✅ **Rate Limiting** - API Gateway throttling prevents abuse  
✅ **Least Privilege IAM** - Lambda functions have minimal required permissions

## Infrastructure

### New AWS Resources

1. **API Gateway** (`localstays-{stage}-api-gateway`)

   - REST API with Cognito authorizer
   - Rate limiting: 10 req/sec (burst: 20)
   - Daily quota: 10,000 requests
   - CORS enabled
   - CloudWatch logging

2. **Lambda Functions** (Node.js 20.x):

   - `localstays-{stage}-submit-intent` (512 MB, 30s timeout)
   - `localstays-{stage}-confirm-submission` (512 MB, 30s timeout)
   - `localstays-{stage}-get-profile` (512 MB, 30s timeout)

3. **DynamoDB Updates**:
   - Renamed GSIs for clarity (HostIdIndex, StatusIndex, DocumentStatusIndex, CountryIndex)
   - TTL enabled on `expiresAt` attribute
   - New entities: Document, SubmissionToken

### Security

**API Gateway:**

- Cognito User Pool authorizer (JWT validation)
- HTTPS only
- Request/response validation
- CloudWatch audit logs

**Lambda IAM Roles (Least Privilege):**

- Submit Intent:
  - DynamoDB: GetItem, PutItem (host, document, token tables)
  - S3: PutObject (for pre-signed URL generation only)
- Confirm Submission:
  - DynamoDB: GetItem, TransactWriteItems
  - S3: HeadObject, GetObject (verification only)
- Get Profile:
  - DynamoDB: GetItem, Query (read-only access)

**Authorization:**

- Users can only access their own `hostId`
- Admins can access any `hostId`
- Enforced in Lambda handlers via JWT claims

## Database Schema

### Document Entity

```typescript
{
  pk: "HOST#<hostId>",
  sk: "DOCUMENT#<documentId>",
  documentId: string,
  hostId: string,
  documentType: "PASSPORT" | "ID_CARD" | ...,
  s3Key: string,  // "{hostId}/verification/{documentId}_{filename}"
  s3Bucket: string,
  fileName: string,
  fileSize: number,
  mimeType: string,
  status: "PENDING_UPLOAD" | "PENDING" | "APPROVED" | "REJECTED",
  reviewedAt: string | null,
  reviewedBy: string | null,
  rejectionReason: string | null,
  notes: string | null,
  uploadedAt: string,
  uploadedBy: string,
  // GSI3 for DocumentStatusIndex
  gsi3pk: "DOCUMENT_STATUS#{status}",
  gsi3sk: uploadedAt
}
```

### Submission Token Entity

```typescript
{
  pk: "SUBMISSION#<submissionToken>",
  sk: "META",
  submissionToken: string,
  hostId: string,
  userId: string,
  status: "PENDING_UPLOAD" | "COMPLETED" | "EXPIRED",
  profileData: ProfileData,
  expectedDocuments: Array<{documentId, documentType, uploaded}>,
  expiresAt: number,  // Unix timestamp (TTL)
  createdAt: string,
  completedAt: string | null
}
```

### Host Entity Updates

```typescript
{
  // ... existing fields ...
  submission: {
    currentToken: string | null,
    tokenExpiresAt: string | null,
    tokenCreatedAt: string | null,
    lastSubmissionAttempt: string | null,
    submissionCount: number
  },
  kyc: {
    status: "NOT_STARTED" | "PENDING" | "APPROVED" | "REJECTED",
    submittedAt: string | null,
    documentIds: string[],  // NEW
    // ... other kyc fields ...
  }
}
```

## Document Requirements

### INDIVIDUAL Host

- ✅ One of: PASSPORT, ID_CARD, or DRIVERS_LICENSE
- ✅ PROOF_OF_ADDRESS

### BUSINESS Host

- ✅ One of: PASSPORT, ID_CARD, or DRIVERS_LICENSE (for authorized person)
- ✅ BUSINESS_REGISTRATION
- ✅ PROOF_OF_ADDRESS
- ✅ VAT_CERTIFICATE (if `vatRegistered: true`)

### File Constraints

- **Allowed types:** PDF, JPEG, PNG
- **Max file size:** 10MB per file
- **Max total size:** 50MB per submission
- **Upload window:** 10 minutes (pre-signed URL expiry)
- **Submission window:** 15 minutes (token expiry)

## Deployment

### Prerequisites

```bash
# 1. Ensure backend is built
cd backend && npm run build

# 2. Ensure you're authenticated to AWS
aws sts get-caller-identity
```

### Deploy to Dev1

```bash
# Deploy all new stacks
npx cdk deploy localstays-dev1-api-gateway localstays-dev1-api-lambda -c env=dev1 --require-approval never

# Or deploy everything
npx cdk deploy --all -c env=dev1
```

### Stack Dependencies

```
ParamsStack → DataStack → StorageStack → KmsStack → CognitoStack
                 ↓           ↓                           ↓
                 └───────────┴──────────> ApiGatewayStack
                             ↓                  ↓
                         ApiLambdaStack ←───────┘
```

### Outputs

After deployment, note these values:

- **API Endpoint:** `https://{api-id}.execute-api.eu-north-1.amazonaws.com/dev1`
- **Submit Intent:** `{endpoint}/api/v1/hosts/{hostId}/profile/submit-intent`
- **Confirm Submission:** `{endpoint}/api/v1/hosts/{hostId}/profile/confirm-submission`

## Testing

See `test-requests/README.md` for:

- Example request payloads
- cURL commands
- Frontend integration code
- Error scenario testing

### Quick Test

```bash
# 1. Get JWT token (sign up or log in via frontend)
export JWT_TOKEN="your-jwt-token"
export HOST_ID="host_your-uuid"  # From JWT claims
export API_URL="https://your-api-id.execute-api.eu-north-1.amazonaws.com/dev1"

# 2. Submit intent
curl -X POST "${API_URL}/api/v1/hosts/${HOST_ID}/profile/submit-intent" \
  -H "Authorization: Bearer ${JWT_TOKEN}" \
  -H "Content-Type: application/json" \
  -d @test-requests/submit-intent-individual.json

# 3. Upload files (use URLs from step 2 response)

# 4. Confirm submission
curl -X POST "${API_URL}/api/v1/hosts/${HOST_ID}/profile/confirm-submission" \
  -H "Authorization: Bearer ${JWT_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{...}'
```

## Frontend Configuration

Update your frontend environment variables:

```typescript
// .env.dev1
NEXT_PUBLIC_API_URL=https://your-api-id.execute-api.eu-north-1.amazonaws.com/dev1
NEXT_PUBLIC_API_VERSION=v1
```

## Monitoring

### CloudWatch Logs

- **API Gateway:** `/aws/apigateway/localstays-dev1`
- **Submit Intent Lambda:** `/aws/lambda/localstays-dev1-submit-intent`
- **Confirm Submission Lambda:** `/aws/lambda/localstays-dev1-confirm-submission`

### Key Metrics

- API request count
- Lambda duration
- Lambda errors
- DynamoDB consumed capacity
- S3 upload success rate

### Alarms (Recommended)

- Lambda error rate > 5%
- API 4xx error rate > 20%
- API 5xx error rate > 1%
- Lambda duration > 25s

## Next Steps

### Phase 2: Admin Review

- GET /api/v1/admin/documents (list pending documents)
- PUT /api/v1/admin/documents/{documentId}/approve
- PUT /api/v1/admin/documents/{documentId}/reject

### Phase 3: Document Retrieval

- GET /api/v1/hosts/{hostId}/profile (retrieve profile)
- GET /api/v1/hosts/{hostId}/documents (list documents)
- GET /api/v1/hosts/{hostId}/documents/{documentId}/download-url

### Phase 4: Listing Management

- POST /api/v1/hosts/{hostId}/listings (create listing)
- PUT /api/v1/hosts/{hostId}/listings/{listingId} (update listing)
- POST /api/v1/hosts/{hostId}/listings/{listingId}/images (upload images)

## Troubleshooting

### "UNAUTHORIZED: No authentication claims found"

- Ensure JWT token is valid and not expired
- Check Authorization header format: `Bearer {token}`
- Verify Cognito User Pool ID matches API Gateway authorizer

### "FORBIDDEN: User cannot access host"

- Verify `hostId` in URL matches `hostId` in JWT claims
- Check user is not trying to access another user's profile

### "VALIDATION_ERROR: Missing required fields"

- Check profile data matches hostType (INDIVIDUAL vs BUSINESS)
- Ensure all required documents are included
- Verify file sizes and MIME types are valid

### "Submission token has expired"

- Submission window is 15 minutes
- Start fresh with new submit-intent call

### "Not all files have been uploaded to S3"

- Verify all pre-signed URLs were used for uploads
- Check S3 upload responses were successful (200 OK)
- Upload URLs expire after 10 minutes

## File Structure

```
backend/services/
├── api/
│   ├── hosts/
│   │   ├── submit-intent.ts
│   │   └── confirm-submission.ts
│   └── lib/
│       ├── auth.ts
│       ├── response.ts
│       ├── s3-presigned.ts
│       ├── document-validation.ts
│       ├── profile-validation.ts
│       └── transaction.ts
└── types/
    ├── host.types.ts
    ├── document.types.ts
    └── submission.types.ts

infra/lib/
├── api-gateway-stack.ts
└── api-lambda-stack.ts
```

## Support

For issues or questions:

1. Check CloudWatch logs for Lambda errors
2. Review API Gateway execution logs
3. Verify DynamoDB items were created correctly
4. Contact platform team with error details
