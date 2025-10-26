# Live ID Check Requests API Specification

## Overview

The Live ID Check system allows hosts to submit video verification as part of their profile verification process. A Live ID check request is automatically created when a host submits their profile for verification.

**Base URL**: `https://tqaq505m83.execute-api.eu-north-1.amazonaws.com/dev1`

---

## Authentication

All endpoints require a valid Cognito JWT token in the `Authorization` header:

```
Authorization: Bearer <cognito-jwt-token>
```

---

## Request States

| Status      | Description                                |
| ----------- | ------------------------------------------ |
| `REQUESTED` | Request created, awaiting host action      |
| `RECEIVED`  | Host uploaded video, awaiting admin review |
| `VERIFIED`  | Approved by admin                          |
| `REJECTED`  | Rejected by admin                          |

---

## API Endpoints

### 1. List Requests

Get all verification requests for a host.

**Endpoint**: `GET /api/v1/hosts/{hostId}/requests`

**Response**:

```json
{
  "requests": [
    {
      "requestId": "req_123e4567-e89b-12d3-a456-426614174000",
      "requestType": "LIVE_ID_CHECK",
      "status": "REQUESTED",
      "description": {
        "en": "Please complete the live ID check to help us verify your identity",
        "sr": "Molimo vas da završite proveru identiteta uživo kako bismo potvrdili vaš identitet"
      },
      "createdAt": "2025-01-15T10:30:00.000Z",
      "uploadedAt": "2025-01-15T11:00:00.000Z" // Only present if video uploaded
    }
  ]
}
```

---

### 2. Get Request Details

Get details for a specific request.

**Endpoint**: `GET /api/v1/hosts/{hostId}/requests/{requestId}`

**Response**:

```json
{
  "requestId": "req_123e4567-e89b-12d3-a456-426614174000",
  "hostId": "host_123e4567-e89b-12d3-a456-426614174000",
  "requestType": "LIVE_ID_CHECK",
  "status": "REQUESTED",
  "description": {
    "en": "Please complete the live ID check to help us verify your identity",
    "sr": "Molimo vas da završite proveru identiteta uživo kako bismo potvrdili vaš identitet"
  },
  "createdAt": "2025-01-15T10:30:00.000Z",
  "updatedAt": "2025-01-15T10:30:00.000Z"
}
```

---

### 3. Submit Video Intent (Step 1)

Request a pre-signed URL to upload a Live ID check video.

**Endpoint**: `POST /api/v1/hosts/{hostId}/requests/{requestId}/submit-intent`

**Request Body**:

```json
{
  "contentType": "video/mp4" // or "video/mov", "video/webm"
}
```

**Response**:

```json
{
  "submissionToken": "req_sub_123e4567-e89b-12d3-a456-426614174000",
  "uploadUrl": "https://s3.amazonaws.com/...",
  "expiresAt": "2025-01-15T11:00:00.000Z",
  "maxFileSizeMB": 100
}
```

**Supported Video Formats**:

- `video/mp4` (recommended)
- `video/mov`
- `video/webm`

**Max File Size**: 100 MB

---

### 4. Confirm Video Upload (Step 2)

Confirm that the video has been uploaded to S3.

**Endpoint**: `POST /api/v1/hosts/{hostId}/requests/{requestId}/confirm-submission`

**Request Body**:

```json
{
  "submissionToken": "req_sub_123e4567-e89b-12d3-a456-426614174000"
}
```

**Response**:

```json
{
  "requestId": "req_123e4567-e89b-12d3-a456-426614174000",
  "status": "RECEIVED",
  "message": "Live ID check video received successfully"
}
```

---

## Video Upload Workflow

### Complete 2-Step Process

```javascript
// Step 1: Get upload URL
const intentResponse = await fetch(
  `${API_BASE}/api/v1/hosts/${hostId}/requests/${requestId}/submit-intent`,
  {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      contentType: "video/mp4",
    }),
  }
);

const { submissionToken, uploadUrl, maxFileSizeMB } =
  await intentResponse.json();

// Step 2: Upload video to S3
await fetch(uploadUrl, {
  method: "PUT",
  headers: {
    "Content-Type": "video/mp4",
  },
  body: videoFile, // File object from input
});

// Step 3: Confirm upload
const confirmResponse = await fetch(
  `${API_BASE}/api/v1/hosts/${hostId}/requests/${requestId}/confirm-submission`,
  {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      submissionToken,
    }),
  }
);

const { status } = await confirmResponse.json();
// status will be "RECEIVED"
```

---

## Error Responses

All endpoints return standard error responses:

```json
{
  "error": "ERROR_CODE",
  "message": "Human-readable error message"
}
```

### Common Error Codes

| Status Code | Error Code              | Description                                 |
| ----------- | ----------------------- | ------------------------------------------- |
| 400         | `BAD_REQUEST`           | Invalid request body or parameters          |
| 401         | `UNAUTHORIZED`          | Missing or invalid authentication token     |
| 403         | `FORBIDDEN`             | User not authorized to access this resource |
| 404         | `NOT_FOUND`             | Request not found                           |
| 500         | `INTERNAL_SERVER_ERROR` | Server error                                |

### Specific Error Cases

**Submit Intent Errors**:

- Request status must be `REQUESTED` or `REJECTED`
- Invalid content type (must be mp4, mov, or webm)

**Confirm Submission Errors**:

- Invalid or expired submission token
- Video file not found in S3
- File size exceeds 100 MB

---

## Dashboard Integration

### Displaying Requests

1. **Fetch requests** on dashboard load using `GET /api/v1/hosts/{hostId}/requests`
2. **Filter by status** to show pending actions (status = `REQUESTED` or `REJECTED`)
3. **Display bilingual descriptions** based on user's preferred language
4. **Show upload status** using `uploadedAt` field presence

### Request Card Example

```jsx
{
  requests.map((request) => (
    <RequestCard key={request.requestId}>
      <h3>{request.description[userLanguage]}</h3>
      <StatusBadge status={request.status} />
      {request.status === "REQUESTED" && (
        <Button onClick={() => handleUploadVideo(request.requestId)}>
          Upload Video
        </Button>
      )}
    </RequestCard>
  ));
}
```

---

## Important Notes

1. **Automatic Creation**: Live ID check requests are automatically created when a host submits their profile
2. **One Active Request**: A host can only have one active Live ID check at a time (statuses: `REQUESTED`, `RECEIVED`, or `VERIFIED`)
3. **Token Expiry**: Upload URLs expire after 30 minutes
4. **File Validation**: The backend validates file size and existence before confirming submission
5. **Email Notifications**: Hosts receive an email when a Live ID check request is created
6. **No Direct Links**: Emails do not contain direct upload links; users must log in to the portal

---

## TypeScript Types

```typescript
// Request Types
export type RequestType = "LIVE_ID_CHECK";

export type RequestStatus = "REQUESTED" | "RECEIVED" | "VERIFIED" | "REJECTED";

// Bilingual Text
export interface BilingualText {
  en: string;
  sr: string;
}

// Request Summary (List View)
export interface RequestSummary {
  requestId: string;
  requestType: RequestType;
  status: RequestStatus;
  description: BilingualText;
  createdAt: string;
  uploadedAt?: string;
}

// List Requests Response
export interface ListRequestsResponse {
  requests: RequestSummary[];
}

// Submit Intent Request
export interface SubmitIntentRequest {
  contentType: "video/mp4" | "video/mov" | "video/webm";
}

// Submit Intent Response
export interface SubmitIntentResponse {
  submissionToken: string;
  uploadUrl: string;
  expiresAt: string;
  maxFileSizeMB: number;
}

// Confirm Submission Request
export interface ConfirmSubmissionRequest {
  submissionToken: string;
}

// Confirm Submission Response
export interface ConfirmSubmissionResponse {
  requestId: string;
  status: RequestStatus;
  message: string;
}
```

---

## Testing Checklist

- [ ] List requests after profile submission
- [ ] Verify request appears with status `REQUESTED`
- [ ] Upload video file (< 200 MB)
- [ ] Verify status changes to `RECEIVED` after confirmation
- [ ] Test with different video formats (mp4, mov, webm)
- [ ] Handle expired upload URLs (30 min timeout)
- [ ] Display bilingual descriptions correctly
- [ ] Handle error cases (file too large, invalid token, etc.)
