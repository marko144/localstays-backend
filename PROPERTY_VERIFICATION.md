# Property Verification API

Two new verification flows for property listings: **Video Verification** and **Address Verification**.

---

## 🎥 Property Video Verification

### Flow

1. Admin creates video request for a listing
2. Host receives email notification
3. Host uploads video (2-step: intent → upload → confirm)
4. Admin reviews and approves/rejects
5. Host receives outcome email

### Admin APIs

#### Create Video Verification Request

```
POST /api/v1/admin/listings/{listingId}/requests/property-video
Authorization: Bearer {admin_token}

Request Body (optional):
{
  "notes": "Please show all rooms and outdoor areas"
}

Response:
{
  "success": true,
  "requestId": "req_abc123",
  "requestType": "PROPERTY_VIDEO_VERIFICATION",
  "status": "REQUESTED",
  "listingId": "listing_xyz",
  "hostId": "host_123",
  "createdAt": "2025-10-28T21:00:00Z"
}
```

#### Get All Requests for a Listing

```
GET /api/v1/admin/listings/{listingId}/requests?page=1
Authorization: Bearer {admin_token}

Response:
{
  "success": true,
  "data": {
    "items": [
      {
        "requestId": "req_abc123",
        "requestType": "PROPERTY_VIDEO_VERIFICATION",
        "status": "RECEIVED",
        "hostId": "host_123",
        "hostName": "John Doe",
        "listingId": "listing_xyz",
        "description": { "en": "...", "sr": "..." },
        "createdAt": "2025-10-28T21:00:00Z",
        "videoUrl": "s3://...",
        "videoUploadedAt": "2025-10-28T22:00:00Z"
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 3,
      "totalPages": 1
    }
  }
}
```

Returns all requests (any status) for a specific listing, sorted by most recent first.

#### Approve/Reject Video (existing endpoints)

```
PUT /api/v1/admin/requests/{requestId}/approve
PUT /api/v1/admin/requests/{requestId}/reject
Body: { "rejectionReason": "Video quality too low" }
```

### Host APIs

#### Get Listing Requests

```
GET /api/v1/hosts/{hostId}/listings/{listingId}/requests
Authorization: Bearer {host_token}

Response:
{
  "success": true,
  "listingId": "listing_xyz",
  "requests": [
    {
      "requestId": "req_abc123",
      "requestType": "PROPERTY_VIDEO_VERIFICATION",
      "status": "REQUESTED",
      "description": { "en": "...", "sr": "..." },
      "createdAt": "2025-10-28T21:00:00Z"
    }
  ],
  "count": 1
}
```

#### Submit Video Intent

```
POST /api/v1/hosts/{hostId}/listings/{listingId}/requests/{requestId}/submit-video-intent
Authorization: Bearer {host_token}

Request Body:
{
  "videoFileName": "property-tour.mp4",
  "videoFileSize": 52428800,
  "videoContentType": "video/mp4"
}

Response:
{
  "requestId": "req_abc123",
  "submissionToken": "vid_sub_xyz",
  "uploadUrl": "https://s3.presigned.url...",
  "expiresAt": "2025-10-28T22:00:00Z",
  "maxFileSizeMB": 200
}
```

**Frontend**: Upload video to `uploadUrl` using PUT request with video file as body.

#### Confirm Video Upload

```
POST /api/v1/hosts/{hostId}/listings/{listingId}/requests/{requestId}/confirm-video
Authorization: Bearer {host_token}

Request Body:
{
  "submissionToken": "vid_sub_xyz"
}

Response:
{
  "success": true,
  "requestId": "req_abc123",
  "status": "RECEIVED",
  "message": "Property video uploaded successfully. Awaiting admin review."
}
```

---

## 📬 Address Verification

### Flow

1. Admin creates address verification request
2. Backend generates 6-character code and PDF letter
3. Admin downloads PDF and mails it to property address
4. Host receives letter and enters code in dashboard
5. Backend validates code (3 attempts max)
6. Host receives outcome email

### Admin APIs

#### Create Address Verification Request

```
POST /api/v1/admin/listings/{listingId}/requests/address-verification
Authorization: Bearer {admin_token}

Response:
{
  "success": true,
  "requestId": "req_def456",
  "requestType": "ADDRESS_VERIFICATION",
  "status": "REQUESTED",
  "listingId": "listing_xyz",
  "hostId": "host_123",
  "pdfLetterUrl": "https://s3.amazonaws.com/.../verification-letter.pdf",
  "createdAt": "2025-10-28T21:00:00Z",
  "message": "PDF letter is ready for download and postal mailing."
}
```

**Frontend**: Download PDF from `pdfLetterUrl` for printing and mailing.

### Host APIs

#### Submit Verification Code

```
POST /api/v1/hosts/{hostId}/listings/{listingId}/requests/{requestId}/submit-code
Authorization: Bearer {host_token}

Request Body:
{
  "code": "H3k9Pm"
}

Success Response:
{
  "success": true,
  "requestId": "req_def456",
  "status": "VERIFIED",
  "message": "Verification code accepted. Your address has been verified!"
}

Error Response (incorrect code):
{
  "success": false,
  "error": {
    "code": "BAD_REQUEST",
    "message": "Incorrect verification code. You have 2 attempt(s) remaining."
  }
}

Error Response (too many attempts):
{
  "success": false,
  "error": {
    "code": "BAD_REQUEST",
    "message": "Incorrect verification code. Maximum attempts exceeded. This request has been rejected."
  }
}
```

---

## 📊 Request Status Flow

### Live ID Check & Video Verification

Both use the same status flow:

```
REQUESTED → RECEIVED → VERIFIED (approved)
         ↘          ↘ REJECTED (rejected)
```

- `REQUESTED`: Admin creates request, host notified
- `RECEIVED`: Host uploads video, awaiting admin review
- `VERIFIED`: Admin approves
- `REJECTED`: Admin rejects (with optional reason)

### Address Verification

```
REQUESTED → VERIFIED (code correct)
         ↘ REJECTED (3 failed attempts or admin rejection)
```

- `REQUESTED`: Admin creates request, code generated & PDF created
- `VERIFIED`: Host enters correct code (auto-approved)
- `REJECTED`: 3 incorrect attempts (auto-rejected) or admin rejection

**Note:** Address verification requests do NOT go through `RECEIVED` status since there's no upload to review - the code validation is automatic.

---

## 🔑 Request Types

```typescript
type RequestType =
  | "LIVE_ID_CHECK"
  | "PROPERTY_VIDEO_VERIFICATION"
  | "ADDRESS_VERIFICATION";

type RequestStatus =
  | "REQUESTED" // Created, awaiting host action
  | "RECEIVED" // Host submitted, awaiting admin review
  | "PENDING_REVIEW" // Under admin review
  | "VERIFIED" // Approved
  | "REJECTED"; // Rejected
```

---

## 📧 Email Notifications

**Video Verification:**

- Host receives email when request is created
- Host receives email when video is approved
- Host receives email when video is rejected (with reason)

**Address Verification:**

- Host receives email when request is created (code is in mail, not email)
- Host receives email when code is verified
- Host receives email when verification fails (too many attempts)

All emails support English and Serbian based on host's `preferredLanguage`.

---

## 🎨 Frontend Implementation Tips

### Display Request Status

```typescript
const statusColors = {
  REQUESTED: "yellow",
  RECEIVED: "blue",
  PENDING_REVIEW: "blue",
  VERIFIED: "green",
  REJECTED: "red",
};
```

### Video Upload Progress

```typescript
// 1. Get pre-signed URL from submit-video-intent
// 2. Show file picker (max 200MB, mp4/mov/webm)
// 3. Upload with progress tracking:
const xhr = new XMLHttpRequest();
xhr.upload.addEventListener("progress", (e) => {
  const percent = (e.loaded / e.total) * 100;
  updateProgressBar(percent);
});
xhr.open("PUT", uploadUrl);
xhr.setRequestHeader("Content-Type", videoContentType);
xhr.send(videoFile);
// 4. On success, call confirm-video
```

### Code Input Validation

```typescript
// 6 characters, alphanumeric, case-sensitive
const codePattern = /^[A-Za-z0-9]{6}$/;
```

### Request Cards

```typescript
interface RequestCardProps {
  requestType: "PROPERTY_VIDEO_VERIFICATION" | "ADDRESS_VERIFICATION";
  status: RequestStatus;
  description: { en: string; sr: string };
  createdAt: string;
  rejectionReason?: string;
}
```

---

## 🚀 Deployment

Infrastructure and email templates are already deployed to `dev1` environment.

**Base URL**: `https://tqaq505m83.execute-api.eu-north-1.amazonaws.com/dev1`

---

## ✅ Testing Checklist

### Admin

- [ ] Create video verification request for a listing
- [ ] Create address verification request for a listing
- [ ] Download generated PDF letter
- [ ] Approve video submission
- [ ] Reject video submission with reason
- [ ] View all requests in admin panel

### Host

- [ ] View requests for a listing
- [ ] Upload video for video verification request
- [ ] Enter correct verification code (should succeed)
- [ ] Enter incorrect code 3 times (should auto-reject)
- [ ] Receive all email notifications

---

**Need help?** Check the Lambda logs in CloudWatch for detailed error messages.
