# Requests System Design

## Overview

The Requests system provides a flexible framework for managing various types of requests from hosts and listings (e.g., identity verification, listing inspections, compliance checks). The system uses a single `Request` entity type with optional fields that are populated based on the request type.

---

## Database Schema

### Request Entity

**Storage Pattern:**
- Host-level requests: `pk = HOST#{hostId}`, `sk = REQUEST#{requestId}`
- Listing-level requests: `pk = LISTING#{listingId}`, `sk = REQUEST#{requestId}`

**DynamoDB Record:**

```typescript
{
  // Primary Keys
  pk: string;                      // HOST#{hostId} OR LISTING#{listingId}
  sk: string;                      // REQUEST#{requestId}
  
  // Core Identifiers (always present)
  requestId: string;               // req_<uuid>
  hostId: string;                  // Owner host (always required)
  listingId?: string;              // Present for listing-specific requests
  requestType: RequestType;        // LIVE_ID_CHECK, LISTING_INSPECTION, etc.
  status: RequestStatus;           // REQUESTED, RECEIVED, VERIFIED, REJECTED
  
  // Description (bilingual)
  description: {
    en: string;
    sr: string;
  };
  
  // File Upload Fields (optional - for file-based requests)
  s3Key?: string;                  // S3 path to uploaded file(s)
  s3Url?: string;                  // Pre-signed or CloudFront URL
  fileSize?: number;               // In bytes
  contentType?: string;            // MIME type (video/mp4, image/jpeg, etc.)
  uploadedAt?: string;             // ISO timestamp
  submissionToken?: string;        // Temporary token for 2-step upload
  submissionTokenExpiresAt?: string;
  
  // Verification Code Fields (optional - for code-based requests)
  verificationCode?: string;       // System-generated code
  codeExpiresAt?: string;          // Code expiration timestamp
  codeVerifiedAt?: string;         // When code was successfully verified
  attemptsRemaining?: number;      // Failed verification attempts allowed
  
  // Text Response Fields (optional - for text input requests)
  responseText?: string;           // Free-form text response from host
  
  // Numeric Value Fields (optional - for numeric responses)
  numericValue?: number;           // Numeric response value
  
  // Custom Fields (optional - for type-specific data)
  customData?: Record<string, any>; // Flexible JSON for type-specific needs
  
  // Audit Trail
  createdAt: string;               // ISO timestamp
  updatedAt: string;               // ISO timestamp
  reviewedAt?: string;             // When admin reviewed
  reviewedBy?: string;             // Admin Cognito sub
  rejectionReason?: string;        // If status is REJECTED
  
  // GSI Attributes
  gsi2pk: string;                  // REQUEST#{requestType}
  gsi2sk: string;                  // STATUS#{status}#{createdAt}
  gsi3pk: string;                  // REQUEST#{requestId}
  gsi3sk: string;                  // REQUEST_META#{requestId}
}
```

---

## Request Types

### Enum: `RequestType`

```typescript
export type RequestType = 
  | 'LIVE_ID_CHECK'           // Video-based identity verification
  | 'PHONE_VERIFICATION'      // SMS/code verification
  | 'EMAIL_VERIFICATION'      // Email verification code
  | 'LISTING_INSPECTION'      // Property inspection photos/video
  | 'COMPLIANCE_DOCUMENT'     // Additional compliance documents
  | 'ADDRESS_VERIFICATION';   // Address verification (utility bill, etc.)
```

### Status Flow

```typescript
export type RequestStatus = 
  | 'REQUESTED'       // Created by system, awaiting host action
  | 'RECEIVED'        // Host completed, awaiting admin review
  | 'VERIFIED'        // Approved by admin
  | 'REJECTED';       // Rejected by admin
```

**Typical Flow:**
```
REQUESTED → RECEIVED → VERIFIED
                    ↘ REJECTED
```

---

## Access Patterns & Queries

### 1. List All Requests for a Host

**Use Case:** Host views their requests  
**Query:**
```typescript
QueryCommand({
  TableName: TABLE_NAME,
  KeyConditionExpression: 'pk = :pk AND begins_with(sk, :sk)',
  ExpressionAttributeValues: {
    ':pk': `HOST#${hostId}`,
    ':sk': 'REQUEST#',
  }
})
```

**Endpoint:** `GET /api/v1/hosts/{hostId}/requests`

---

### 2. List All Requests for a Listing

**Use Case:** Host views requests for a specific listing  
**Query:**
```typescript
QueryCommand({
  TableName: TABLE_NAME,
  KeyConditionExpression: 'pk = :pk AND begins_with(sk, :sk)',
  ExpressionAttributeValues: {
    ':pk': `LISTING#${listingId}`,
    ':sk': 'REQUEST#',
  }
})
```

**Endpoint:** `GET /api/v1/listings/{listingId}/requests` (future)

---

### 3. Get Specific Request by ID

**Use Case:** Admin or host views single request details  
**Query:** Use GSI3 (DocumentStatusIndex) for direct lookup
```typescript
QueryCommand({
  TableName: TABLE_NAME,
  IndexName: 'DocumentStatusIndex',  // GSI3
  KeyConditionExpression: 'gsi3pk = :gsi3pk AND begins_with(gsi3sk, :gsi3sk)',
  ExpressionAttributeValues: {
    ':gsi3pk': `REQUEST#${requestId}`,
    ':gsi3sk': 'REQUEST_META#',
  },
  Limit: 1
})
```

**Endpoint:** 
- Host: `GET /api/v1/hosts/{hostId}/requests/{requestId}`
- Admin: `GET /api/v1/admin/requests/{requestId}`

---

### 4. List All Requests by Type & Status (Admin)

**Use Case:** Admin views all pending requests of a specific type  
**Query:** Use GSI2 (StatusIndex)
```typescript
QueryCommand({
  TableName: TABLE_NAME,
  IndexName: 'StatusIndex',  // GSI2
  KeyConditionExpression: 'gsi2pk = :gsi2pk AND begins_with(gsi2sk, :statusPrefix)',
  ExpressionAttributeValues: {
    ':gsi2pk': `REQUEST#${requestType}`,
    ':statusPrefix': `STATUS#${status}#`,
  }
})
```

**Endpoint:** `GET /api/v1/admin/requests/pending`

---

### 5. List ALL Requests (All Types, Admin)

**Use Case:** Admin views all requests across system  
**Query:** Use GSI2 with multiple queries or scan
```typescript
// Option A: Query each type separately and merge
const types = ['LIVE_ID_CHECK', 'LISTING_INSPECTION', ...];
const allRequests = await Promise.all(
  types.map(type => 
    docClient.send(new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: 'StatusIndex',
      KeyConditionExpression: 'gsi2pk = :gsi2pk',
      ExpressionAttributeValues: {
        ':gsi2pk': `REQUEST#${type}`,
      }
    }))
  )
);

// Option B: Scan with filter (for small datasets)
ScanCommand({
  TableName: TABLE_NAME,
  FilterExpression: '(begins_with(pk, :hostPrefix) OR begins_with(pk, :listingPrefix)) AND begins_with(sk, :sk)',
  ExpressionAttributeValues: {
    ':hostPrefix': 'HOST#',
    ':listingPrefix': 'LISTING#',
    ':sk': 'REQUEST#',
  }
})
```

**Endpoint:** `GET /api/v1/admin/requests?type=X&status=Y`

---

## Creating New Request Types

### Step 1: Define Request Type

Add to `RequestType` enum in `request.types.ts`:

```typescript
export type RequestType = 
  | 'LIVE_ID_CHECK'
  | 'YOUR_NEW_TYPE'  // ← Add here
  | ...;
```

### Step 2: Seed Request Type Configuration

Add to seed handler (`seed-handler.ts`):

```typescript
async function seedRequestTypes() {
  const requestTypes = [
    {
      pk: 'REQUEST_TYPE#YOUR_NEW_TYPE',
      sk: 'META',
      requestType: 'YOUR_NEW_TYPE',
      description: {
        en: 'English description shown to hosts',
        sr: 'Serbian description shown to hosts',
      },
      displayOrder: 2,
      isActive: true,
      createdAt: new Date().toISOString(),
    },
  ];
  // ... seed logic
}
```

### Step 3: Create Request Record

When creating a new request:

```typescript
const now = new Date().toISOString();
const requestId = `req_${uuidv4()}`;

// Decide if host-level or listing-level
const pk = listingId ? `LISTING#${listingId}` : `HOST#${hostId}`;

const request: Request = {
  // Primary keys
  pk,
  sk: `REQUEST#${requestId}`,
  
  // Core fields
  requestId,
  hostId,
  listingId: listingId || undefined,  // Only if listing-level
  requestType: 'YOUR_NEW_TYPE',
  status: 'REQUESTED',
  description: {
    en: 'Request description',
    sr: 'Opis zahteva',
  },
  
  // Type-specific fields (populate as needed)
  s3Key: undefined,           // If file upload required
  verificationCode: undefined, // If code verification
  responseText: undefined,     // If text response
  customData: {},             // Any custom fields
  
  // Audit
  createdAt: now,
  updatedAt: now,
  
  // GSI attributes (ALWAYS populate these)
  gsi2pk: `REQUEST#YOUR_NEW_TYPE`,
  gsi2sk: `STATUS#REQUESTED#${now}`,
  gsi3pk: `REQUEST#${requestId}`,
  gsi3sk: `REQUEST_META#${requestId}`,
};

await docClient.send(new PutCommand({
  TableName: TABLE_NAME,
  Item: request,
}));
```

### Step 4: Update GSI Attributes on Status Change

When updating request status:

```typescript
await docClient.send(new UpdateCommand({
  TableName: TABLE_NAME,
  Key: {
    pk: request.pk,
    sk: request.sk,
  },
  UpdateExpression: 'SET #status = :status, gsi2sk = :gsi2sk, updatedAt = :now',
  ExpressionAttributeNames: {
    '#status': 'status',
  },
  ExpressionAttributeValues: {
    ':status': 'RECEIVED',
    ':gsi2sk': `STATUS#RECEIVED#${now}`,  // ← Update GSI2 sort key
    ':now': now,
  },
}));
```

---

## Request Type Examples

### Example 1: File Upload Request (LIVE_ID_CHECK)

**Workflow:**
1. System creates request with `status = REQUESTED`
2. Host calls `POST /submit-intent` → receives pre-signed S3 URL + submission token
3. Host uploads file to S3
4. Host calls `POST /confirm-submission` with token
5. System validates upload, updates `status = RECEIVED`, populates `s3Key`, `fileSize`, `uploadedAt`
6. Admin reviews and approves/rejects

**Required Fields:**
- `s3Key`, `s3Url`, `fileSize`, `contentType`, `uploadedAt`
- `submissionToken`, `submissionTokenExpiresAt` (temporary, during upload)

**API Endpoints:**
- `POST /hosts/{hostId}/requests/{requestId}/submit-intent`
- `POST /hosts/{hostId}/requests/{requestId}/confirm-submission`

---

### Example 2: Verification Code Request (PHONE_VERIFICATION)

**Workflow:**
1. System creates request with `status = REQUESTED` and generates `verificationCode`
2. System sends code via SMS to host
3. Host calls `POST /verify-code` with code
4. System validates code, updates `status = VERIFIED`

**Required Fields:**
- `verificationCode`, `codeExpiresAt`, `attemptsRemaining`
- `codeVerifiedAt` (set when verified)

**API Endpoints:**
- `POST /hosts/{hostId}/requests/{requestId}/verify-code`

**Implementation:**
```typescript
// Create request
const request = {
  // ... base fields
  requestType: 'PHONE_VERIFICATION',
  verificationCode: generateSixDigitCode(),
  codeExpiresAt: addMinutes(new Date(), 15).toISOString(),
  attemptsRemaining: 3,
  // ... GSI fields
};

// Verify code endpoint
if (request.verificationCode !== providedCode) {
  // Decrement attempts
  await updateAttemptsRemaining(request.requestId, request.attemptsRemaining - 1);
  
  if (request.attemptsRemaining <= 1) {
    // Lock request, require new code
    await updateRequestStatus(request.requestId, 'REJECTED');
  }
  return response.badRequest('Invalid verification code');
}

// Success
await docClient.send(new UpdateCommand({
  Key: { pk: request.pk, sk: request.sk },
  UpdateExpression: 'SET #status = :status, codeVerifiedAt = :now, gsi2sk = :gsi2sk',
  ExpressionAttributeNames: { '#status': 'status' },
  ExpressionAttributeValues: {
    ':status': 'VERIFIED',
    ':now': new Date().toISOString(),
    ':gsi2sk': `STATUS#VERIFIED#${new Date().toISOString()}`,
  },
}));
```

---

### Example 3: Listing Inspection Request (Multiple Photos)

**Workflow:**
1. Admin creates request for listing with `status = REQUESTED`
2. Host calls `POST /submit-intent` → receives pre-signed URLs for multiple photos
3. Host uploads photos to S3
4. Host calls `POST /confirm-submission`
5. System validates uploads, updates `status = RECEIVED`
6. Admin reviews photos and approves/rejects

**Required Fields:**
- Store array of photo details in `customData`:
  ```typescript
  customData: {
    photos: [
      { s3Key: 'path/photo1.jpg', uploadedAt: '...' },
      { s3Key: 'path/photo2.jpg', uploadedAt: '...' }
    ]
  }
  ```
- Or use separate records (like listing images):
  ```typescript
  pk: LISTING#{listingId}
  sk: REQUEST_PHOTO#{requestId}#{photoId}
  ```

**Storage Pattern:**
```typescript
// Option A: Store in customData (simple, good for <10 photos)
{
  pk: `LISTING#${listingId}`,
  sk: `REQUEST#${requestId}`,
  requestType: 'LISTING_INSPECTION',
  customData: {
    photos: [
      { photoId: 'photo_1', s3Key: '...', uploadedAt: '...' },
      { photoId: 'photo_2', s3Key: '...', uploadedAt: '...' }
    ]
  },
  // ... other fields
}

// Option B: Separate records (better for many photos)
// Main request record
{
  pk: `LISTING#${listingId}`,
  sk: `REQUEST#${requestId}`,
  requestType: 'LISTING_INSPECTION',
  status: 'RECEIVED',
  // ...
}

// Photo records
{
  pk: `LISTING#${listingId}`,
  sk: `REQUEST_PHOTO#${requestId}#${photoId}`,
  photoId,
  requestId,
  s3Key: '...',
  displayOrder: 1,
  uploadedAt: '...',
}
```

---

## Best Practices

### 1. Always Populate GSI Attributes

**Required for every request:**
```typescript
gsi2pk: `REQUEST#${requestType}`
gsi2sk: `STATUS#${status}#${timestamp}`
gsi3pk: `REQUEST#${requestId}`
gsi3sk: `REQUEST_META#${requestId}`
```

### 2. Update GSI2 Sort Key on Status Change

When status changes, update `gsi2sk`:
```typescript
UpdateExpression: 'SET #status = :newStatus, gsi2sk = :newGsi2sk, ...'
ExpressionAttributeValues: {
  ':newStatus': 'VERIFIED',
  ':newGsi2sk': `STATUS#VERIFIED#${newTimestamp}`,
}
```

### 3. Use Optional Fields Appropriately

Only populate fields relevant to the request type:
- File upload? → `s3Key`, `fileSize`, `contentType`
- Code verification? → `verificationCode`, `codeExpiresAt`
- Text response? → `responseText`

### 4. Choose Correct Parent Entity

**Host-level** (identity, contact verification):
```typescript
pk: `HOST#${hostId}`
listingId: undefined
```

**Listing-level** (property-specific):
```typescript
pk: `LISTING#${listingId}`
listingId: listingId  // Also store for easy reference
hostId: hostId        // Still include owner
```

### 5. Handle Multiple Files

For requests with multiple files:
- **Few files (<5):** Store array in `customData`
- **Many files (5+):** Create separate records with `REQUEST_PHOTO#` pattern

### 6. Expiration & Cleanup

Use DynamoDB TTL for temporary data:
```typescript
{
  submissionToken: 'temp_token_123',
  expiresAt: Math.floor(Date.now() / 1000) + (30 * 60),  // 30 min TTL
}
```

### 7. Audit Trail

Always log admin actions:
```typescript
logAdminAction(user, 'APPROVE_REQUEST', 'REQUEST', requestId, {
  requestType: request.requestType,
  hostId: request.hostId,
});
```

---

## Email Notifications

Create email templates for each request type:

```typescript
// In seed-email-templates.ts
{
  templateId: 'request_created_YOUR_NEW_TYPE',
  subject: {
    en: 'Action Required: ...',
    sr: 'Potrebna radnja: ...',
  },
  body: {
    en: 'Please complete ...',
    sr: 'Molimo vas da završite ...',
  }
}
```

Send notifications on:
- Request created (`REQUESTED`)
- Request submitted (`RECEIVED`)
- Request approved (`VERIFIED`)
- Request rejected (`REJECTED`)

---

## Testing Checklist

When adding a new request type:

- [ ] Add `RequestType` enum value
- [ ] Seed request type configuration
- [ ] Create request with correct GSI attributes
- [ ] Test host list requests (`GET /hosts/{hostId}/requests`)
- [ ] Test host get single request (`GET /hosts/{hostId}/requests/{requestId}`)
- [ ] Test admin pending queue (`GET /admin/requests/pending`)
- [ ] Test admin get by ID (`GET /admin/requests/{requestId}`)
- [ ] Test admin approve/reject
- [ ] Verify GSI2 updates on status change
- [ ] Test email notifications
- [ ] Verify audit logging

---

## Migration Notes

### Backfilling GSI3 for Existing Requests

If requests exist without `gsi3pk`/`gsi3sk`:

```typescript
// Migration script
const requests = await scanAllRequests();

for (const request of requests) {
  await docClient.send(new UpdateCommand({
    TableName: TABLE_NAME,
    Key: { pk: request.pk, sk: request.sk },
    UpdateExpression: 'SET gsi3pk = :gsi3pk, gsi3sk = :gsi3sk',
    ExpressionAttributeValues: {
      ':gsi3pk': `REQUEST#${request.requestId}`,
      ':gsi3sk': `REQUEST_META#${request.requestId}`,
    },
  }));
}
```

---

## Summary

- **Single Request entity** with optional fields
- **Two storage patterns:** `HOST#` or `LISTING#` based on context
- **Three query patterns:** Direct key, GSI2 (type/status), GSI3 (requestId)
- **Flexible schema:** Add type-specific fields as needed
- **Always populate:** `gsi2pk`, `gsi2sk`, `gsi3pk`, `gsi3sk`
- **Update GSI2 on status change** to maintain queryability

This design allows infinite extensibility while maintaining simple, efficient queries! 🚀



