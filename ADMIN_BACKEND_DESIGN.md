# Admin Backend Design Decisions

## Overview

This document captures all design decisions for the admin backend functionality, including API endpoints, data models, permissions, and workflows.

**Date Created**: October 27, 2025  
**Environment**: dev1  
**Version**: 1.0.0

---

## 1. Authentication & Authorization

### 1.1 Admin Role Permissions

Admins must have the `ADMIN` role in Cognito to access admin endpoints.

**New Admin Permissions to Add**:

- `ADMIN_HOST_VIEW_ALL` ✅ (already exists)
- `ADMIN_HOST_SEARCH` (new)
- `ADMIN_HOST_SUSPEND` ✅ (already exists)
- `ADMIN_HOST_REINSTATE` ✅ (already exists)
- `ADMIN_KYC_VIEW_ALL` ✅ (already exists)
- `ADMIN_KYC_APPROVE` ✅ (already exists)
- `ADMIN_KYC_REJECT` ✅ (already exists)
- `ADMIN_LISTING_VIEW_ALL` ✅ (already exists)
- `ADMIN_LISTING_APPROVE` ✅ (already exists)
- `ADMIN_LISTING_REJECT` ✅ (already exists)
- `ADMIN_LISTING_SUSPEND` ✅ (already exists)
- `ADMIN_REQUEST_VIEW_ALL` (new)
- `ADMIN_REQUEST_APPROVE` (new)
- `ADMIN_REQUEST_REJECT` (new)

**New Host Permissions to Add**:

- `HOST_REQUEST_VIEW_OWN` (new)
- `HOST_REQUEST_SUBMIT` (new)

### 1.2 JWT Token Injection

When an admin user logs in via Cognito, the PreTokenGeneration Lambda trigger must inject the admin's permissions from DynamoDB into the JWT token's custom claims. This allows the API Gateway authorizer to enforce permissions without additional database lookups.

### 1.3 Permission Enforcement

All admin endpoints will use a middleware/decorator pattern to check that the requesting user has the required permission(s) before executing the handler logic.

---

## 2. Data Model Changes

### 2.1 Host Entity

**New Field**:

- `rejectionReason?: string` - Free-text reason (max 500 chars) when host profile status is set to `REJECTED`

**Existing Fields** (no changes needed):

- `suspendedAt`, `suspendedBy`, `suspendedReason` - Already exist for `SUSPENDED` status

### 2.2 Listing Entity

**No changes needed** - Already has:

- `rejectionReason?: string` - For `REJECTED` status
- `lockedAt`, `lockedBy`, `lockReason` - For `LOCKED` status

### 2.3 Request Entity

**No changes needed** - Already has:

- `rejectionReason?: string` - For `REJECTED` status

---

## 3. Status Workflows

### 3.1 Host Profile Status

**Current Statuses**: `NOT_SUBMITTED`, `INCOMPLETE`, `VERIFICATION`, `VERIFIED`, `REJECTED`, `SUSPENDED`

**Admin Review Workflow**:

- Admin queries hosts with status = `VERIFICATION`
- **Approve**: `VERIFICATION` → `VERIFIED`
  - Update `status = 'VERIFIED'`
  - Set `updatedAt = now()`
- **Reject**: `VERIFICATION` → `REJECTED`
  - Update `status = 'REJECTED'`
  - Set `rejectionReason` (max 500 chars, required)
  - Set `updatedAt = now()`
- **Suspend**: Any status → `SUSPENDED`
  - Update `status = 'SUSPENDED'`
  - Set `suspendedAt = now()`, `suspendedBy = adminSub`, `suspendedReason` (max 500 chars)
  - Set all host's `ONLINE` listings to `OFFLINE`
  - Set `updatedAt = now()`

### 3.2 Listing Status

**Current Statuses**: `DRAFT`, `IN_REVIEW`, `APPROVED`, `REJECTED`, `ONLINE`, `OFFLINE`, `LOCKED`, `ARCHIVED`

**Admin Review Workflow**:

- Admin queries listings with status = `IN_REVIEW`
- **Approve**: `IN_REVIEW` → `APPROVED`
  - Update `status = 'APPROVED'`
  - Set `approvedAt = now()`
  - Set `updatedAt = now()`
  - Host can later manually set to `ONLINE`
- **Reject**: `IN_REVIEW` → `REJECTED`
  - Update `status = 'REJECTED'`
  - Set `rejectionReason` (max 500 chars, required)
  - Set `rejectedAt = now()`
  - Set `updatedAt = now()`
- **Suspend**: `ONLINE` or `APPROVED` → `LOCKED`
  - Update `status = 'LOCKED'`
  - Set `lockedAt = now()`, `lockedBy = adminSub`, `lockReason` (max 500 chars)
  - Set `updatedAt = now()`

### 3.3 Live ID Request Status

**Current Statuses**: `REQUESTED`, `RECEIVED`, `PENDING_REVIEW`, `VERIFIED`, `REJECTED`

**Admin Review Workflow**:

- Admin queries requests with status = `RECEIVED`
- **Approve**: `RECEIVED` → `VERIFIED`
  - Update `status = 'VERIFIED'`
  - Set `reviewedAt = now()`, `reviewedBy = adminSub`
  - Set `updatedAt = now()`
- **Reject**: `RECEIVED` → `REJECTED`
  - Update `status = 'REJECTED'`
  - Set `rejectionReason` (max 500 chars, required)
  - Set `reviewedAt = now()`, `reviewedBy = adminSub`
  - Set `updatedAt = now()`

---

## 4. Search & Filtering

### 4.1 Host Search

**Search Fields**:

- Email address (partial match, case-insensitive)
- Host name (partial match, case-insensitive):
  - For `INDIVIDUAL`: Search in `forename` and `surname`
  - For `BUSINESS`: Search in `legalName`, `businessName`, and `displayName`

**Implementation**: DynamoDB Scan with FilterExpression (acceptable for admin use, not public-facing)

### 4.2 Pagination

**Default Page Size**: 20 items per page  
**No admin configuration**: Page size is fixed at 20  
**Response includes**:

- `items: T[]` - Array of results for current page
- `total: number` - Total count of matching items
- `page: number` - Current page number (1-indexed)
- `pageSize: number` - Items per page (always 20)
- `totalPages: number` - Total number of pages

**Query Parameters**:

- `page` (optional, default: 1)
- `limit` (optional, default: 20, max: 20) - for future flexibility

---

## 5. Email Notifications

### 5.1 Email Templates Required

All emails must be bilingual (English & Serbian) and stored in the `email-templates` DynamoDB table.

**New Email Templates**:

1. `HOST_PROFILE_APPROVED` - Sent when host profile is approved
2. `HOST_PROFILE_REJECTED` - Sent when host profile is rejected (includes reason)
3. `HOST_SUSPENDED` - Sent when host account is suspended (includes reason)
4. `LISTING_APPROVED` - Sent when listing is approved
5. `LISTING_REJECTED` - Sent when listing is rejected (includes reason)
6. `LISTING_SUSPENDED` - Sent when listing is locked/suspended (includes reason)
7. `REQUEST_APPROVED` - Sent when Live ID request is approved
8. `REQUEST_REJECTED` - Sent when Live ID request is rejected (includes reason)

### 5.2 Email Variables

Each template will receive:

- `name` - Host name (forename + surname or legalName)
- `reason` - Rejection/suspension reason (if applicable)
- `listingName` - Listing name (for listing-related emails)

**Note**: English templates will be provided by the user and translated to Serbian.

---

## 6. API Endpoints Structure

### 6.1 Admin Namespace

All admin endpoints will be under: `/api/v1/admin/`

**Authentication**: All endpoints require:

- Valid Cognito JWT token
- User must have `ADMIN` role
- User must have specific permission for the action

### 6.2 Response Format

All responses follow the standard format:

```json
{
  "success": true,
  "data": { ... },
  "message": "Optional message"
}
```

Error responses:

```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable error message"
  }
}
```

### 6.3 Pagination Response Format

```json
{
  "success": true,
  "data": {
    "items": [...],
    "pagination": {
      "total": 156,
      "page": 1,
      "pageSize": 20,
      "totalPages": 8
    }
  }
}
```

---

## 7. API Endpoints List

### 7.1 Host Management

#### GET `/api/v1/admin/hosts`

**Purpose**: List all hosts with pagination  
**Permission**: `ADMIN_HOST_VIEW_ALL`  
**Query Params**: `page` (optional, default: 1)  
**Returns**: Paginated list with headline data:

- `hostId`, `hostType`, `name`, `email`, `countryCode`, `status`, `createdAt`

#### GET `/api/v1/admin/hosts/search`

**Purpose**: Search hosts by name or email  
**Permission**: `ADMIN_HOST_SEARCH`  
**Query Params**: `q` (search query), `page` (optional)  
**Returns**: Paginated list with headline data (same as above)

#### GET `/api/v1/admin/hosts/{hostId}`

**Purpose**: Get full host details  
**Permission**: `ADMIN_HOST_VIEW_ALL`  
**Returns**: Complete host record including address, phone, KYC details, stats

#### GET `/api/v1/admin/hosts/{hostId}/documents`

**Purpose**: List all KYC documents for a host  
**Permission**: `ADMIN_KYC_VIEW_ALL`  
**Returns**: Array of documents with:

- `documentId`, `documentType`, `fileName`, `s3Url` (pre-signed URL with 15-min expiry, `Content-Disposition: attachment` for force download), `uploadedAt`, `status`, `contentType`, `fileSize`

#### GET `/api/v1/admin/hosts/pending-review`

**Purpose**: Get all hosts awaiting verification  
**Permission**: `ADMIN_KYC_VIEW_ALL`  
**Query Params**: `page` (optional)  
**Returns**: Paginated list of hosts with status = `VERIFICATION` (oldest first)

#### PUT `/api/v1/admin/hosts/{hostId}/approve`

**Purpose**: Approve host profile  
**Permission**: `ADMIN_KYC_APPROVE`  
**Body**: None  
**Action**: `VERIFICATION` → `VERIFIED`, send approval email

#### PUT `/api/v1/admin/hosts/{hostId}/reject`

**Purpose**: Reject host profile  
**Permission**: `ADMIN_KYC_REJECT`  
**Body**: `{ rejectionReason: string }` (max 500 chars, required)  
**Action**: `VERIFICATION` → `REJECTED`, send rejection email

#### PUT `/api/v1/admin/hosts/{hostId}/suspend`

**Purpose**: Suspend host account  
**Permission**: `ADMIN_HOST_SUSPEND`  
**Body**: `{ suspendedReason: string }` (max 500 chars, required)  
**Action**: Any status → `SUSPENDED`, set all `ONLINE` listings to `OFFLINE`, send suspension email

#### PUT `/api/v1/admin/hosts/{hostId}/reinstate`

**Purpose**: Reinstate suspended host  
**Permission**: `ADMIN_HOST_REINSTATE`  
**Body**: None  
**Action**: `SUSPENDED` → `VERIFIED`, clear suspension fields

---

### 7.2 Listing Management

#### GET `/api/v1/admin/listings`

**Purpose**: List all listings with pagination  
**Permission**: `ADMIN_LISTING_VIEW_ALL`  
**Query Params**: `page` (optional), `status` (optional filter)  
**Returns**: Paginated list with headline data:

- `listingId`, `listingName`, `propertyType`, `status`, `hostId`, `hostName`, `createdAt`, `submittedAt`

#### GET `/api/v1/admin/listings/pending-review`

**Purpose**: Get all listings awaiting approval  
**Permission**: `ADMIN_LISTING_VIEW_ALL`  
**Query Params**: `page` (optional)  
**Returns**: Paginated list of listings with status = `IN_REVIEW` (oldest submitted first)

#### GET `/api/v1/admin/listings/{listingId}`

**Purpose**: Get full listing details  
**Permission**: `ADMIN_LISTING_VIEW_ALL`  
**Returns**: Complete listing record including images, amenities, verification documents

#### GET `/api/v1/admin/hosts/{hostId}/listings`

**Purpose**: Get all listings for a specific host  
**Permission**: `ADMIN_LISTING_VIEW_ALL`  
**Query Params**: `page` (optional)  
**Returns**: Paginated list with headline data (oldest submitted first)

#### PUT `/api/v1/admin/listings/{listingId}/approve`

**Purpose**: Approve listing  
**Permission**: `ADMIN_LISTING_APPROVE`  
**Body**: None  
**Action**: `IN_REVIEW` → `APPROVED`, send approval email

#### PUT `/api/v1/admin/listings/{listingId}/reject`

**Purpose**: Reject listing  
**Permission**: `ADMIN_LISTING_REJECT`  
**Body**: `{ rejectionReason: string }` (max 500 chars, required)  
**Action**: `IN_REVIEW` → `REJECTED`, send rejection email

#### PUT `/api/v1/admin/listings/{listingId}/suspend`

**Purpose**: Suspend/lock listing  
**Permission**: `ADMIN_LISTING_SUSPEND`  
**Body**: `{ lockReason: string }` (max 500 chars, required)  
**Action**: `ONLINE` or `APPROVED` → `LOCKED`, send suspension email

---

### 7.3 Request Management

#### GET `/api/v1/admin/requests`

**Purpose**: List all requests (all types, all hosts)  
**Permission**: `ADMIN_REQUEST_VIEW_ALL`  
**Query Params**: `page` (optional), `status` (optional filter), `type` (optional filter)  
**Returns**: Paginated list with headline data:

- `requestId`, `requestType`, `status`, `hostId`, `hostName`, `createdAt`, `uploadedAt`

#### GET `/api/v1/admin/requests/pending-review`

**Purpose**: Get all requests awaiting review  
**Permission**: `ADMIN_REQUEST_VIEW_ALL`  
**Query Params**: `page` (optional)  
**Returns**: Paginated list of requests with status = `RECEIVED` (oldest first)

#### GET `/api/v1/admin/hosts/{hostId}/requests`

**Purpose**: Get all requests for a specific host  
**Permission**: `ADMIN_REQUEST_VIEW_ALL`  
**Query Params**: `page` (optional)  
**Returns**: Paginated list with headline data

#### GET `/api/v1/admin/requests/{requestId}`

**Purpose**: Get full request details  
**Permission**: `ADMIN_REQUEST_VIEW_ALL`  
**Returns**: Complete request record including:

- Request metadata, status, timestamps
- `s3Url` (pre-signed URL with 15-min expiry, `Content-Disposition: attachment` for force download)
- File metadata (size, type, contentType)

#### PUT `/api/v1/admin/requests/{requestId}/approve`

**Purpose**: Approve Live ID request  
**Permission**: `ADMIN_REQUEST_APPROVE`  
**Body**: None  
**Action**: `RECEIVED` → `VERIFIED`, send approval email

#### PUT `/api/v1/admin/requests/{requestId}/reject`

**Purpose**: Reject Live ID request  
**Permission**: `ADMIN_REQUEST_REJECT`  
**Body**: `{ rejectionReason: string }` (max 500 chars, required)  
**Action**: `RECEIVED` → `REJECTED`, send rejection email

---

## 8. Document & Video Access Strategy

### 8.1 S3 Pre-signed URLs

All document and video access for admin review uses **S3 pre-signed URLs** with the following configuration:

**URL Configuration**:

- **Expiry**: 15 minutes (900 seconds)
- **HTTP Method**: GET
- **Response Headers**: `Content-Disposition: attachment` (forces browser download)
- **No authentication required**: Pre-signed URL includes temporary credentials

### 8.2 Document Types

**KYC Documents** (Host Profile Verification):

- Stored at: `s3://<bucket>/{hostId}/verification/{documentType}.{ext}`
- Supported types: PDF, images (JPEG, PNG), other document formats
- Endpoint: `GET /api/v1/admin/hosts/{hostId}/documents`

**Listing Verification Documents**:

- Stored at: `s3://<bucket>/{hostId}/listings/{listingId}/documents/{documentType}.{ext}`
- Same document types as KYC documents
- Included in: `GET /api/v1/admin/listings/{listingId}` response

**Live ID Videos**:

- Stored at: `s3://<bucket>/{hostId}/requests/{requestId}/live-id-check.{ext}`
- Supported types: MP4, MOV, WebM
- Max size: 100 MB
- Endpoint: `GET /api/v1/admin/requests/{requestId}`

### 8.3 Frontend Implementation

The frontend will:

1. Display document/video list with metadata (name, type, size, upload date)
2. Provide **"Download"** button for each file
3. Open pre-signed URL in new browser tab/window
4. Browser will download the file (due to `Content-Disposition: attachment`)
5. If URL expires, admin must re-fetch the resource (new API call generates new URL)

### 8.4 Security Considerations

- Pre-signed URLs are time-limited (15 min) - no persistent access
- URLs are generated on-demand per admin request
- Only admins with proper permissions can generate these URLs
- CloudWatch logs track all URL generation for audit purposes

---

## 9. Database Indexing Strategy

### 9.1 Existing GSIs (Global Secondary Indexes)

- **GSI2**: Used for querying by status
  - Hosts: `gsi2pk = "HOST#<status>"`, `gsi2sk = <createdAt>`
  - Listings: `gsi2pk = "LISTING_STATUS#<status>"`, `gsi2sk = <timestamp>`
  - Requests: `gsi2pk = "REQUEST#<requestType>"`, `gsi2sk = "STATUS#<status>#<createdAt>"`

### 9.2 Query Patterns

All admin "pending review" queries will use GSI2 for efficient status-based filtering:

- Hosts in `VERIFICATION`: Query GSI2 where `gsi2pk = "HOST#VERIFICATION"`
- Listings in `IN_REVIEW`: Query GSI2 where `gsi2pk = "LISTING_STATUS#IN_REVIEW"`
- Requests in `RECEIVED`: Query GSI2 where `gsi2pk = "REQUEST#LIVE_ID_CHECK"` and filter by status

---

## 9. Security & Audit

### 9.1 Audit Trail

All admin actions that modify data will be logged:

- Action type (approve, reject, suspend, etc.)
- Admin user ID (from Cognito sub)
- Timestamp
- Target entity (hostId, listingId, requestId)
- Reason (for rejections/suspensions)

**Implementation**: CloudWatch Logs (structured JSON format)

### 9.2 Data Retention

- Host suspension: Retain `suspendedBy`, `suspendedAt`, `suspendedReason`
- Listing lock: Retain `lockedBy`, `lockedAt`, `lockReason`
- Request review: Retain `reviewedBy`, `reviewedAt`, `rejectionReason`

---

## 10. Implementation Order

### Phase 1: Foundation

1. Update type definitions (add `rejectionReason` to Host)
2. Update role permissions in seed handler
3. Create admin auth middleware/decorator
4. Deploy and test authentication

### Phase 2: Host Management APIs

1. List all hosts (with pagination)
2. Search hosts
3. Get host details
4. Get host documents
5. Approve/reject/suspend host
6. Create email templates (to be provided by user)

### Phase 3: Listing Management APIs

1. List all listings (with pagination)
2. Get pending listings for review
3. Get listings by host
4. Get listing details
5. Approve/reject/suspend listing

### Phase 4: Request Management APIs

1. List all requests
2. Get pending requests for review
3. Get requests by host
4. Get request details (with video playback URL)
5. Approve/reject request

### Phase 5: Testing & Documentation

1. Integration testing
2. Create API documentation for frontend
3. Deploy to dev1

---

## 11. Error Handling

### 11.1 Common Error Codes

- `UNAUTHORIZED` - Missing or invalid JWT token
- `FORBIDDEN` - Valid token but insufficient permissions
- `NOT_FOUND` - Resource does not exist
- `INVALID_STATUS_TRANSITION` - Attempted invalid status change
- `VALIDATION_ERROR` - Request body validation failed
- `INTERNAL_ERROR` - Unexpected server error

### 11.2 Status Transition Validation

Each endpoint will validate that the current status allows the requested transition:

- Approve host: Must be in `VERIFICATION` status
- Approve listing: Must be in `IN_REVIEW` status
- Approve request: Must be in `RECEIVED` status
- Suspend host: Cannot suspend if already `SUSPENDED`
- Etc.

---

## 12. Frontend Considerations

### 12.1 Admin Dashboard Views

The frontend will need:

1. **Hosts Table** - Paginated list of all hosts
2. **Host Details Modal/Page** - Full host information + actions
3. **Listings Table** - Paginated list of all listings
4. **Listing Details Modal/Page** - Full listing + images + documents + actions
5. **Requests Table** - Paginated list of all requests
6. **Request Details Modal/Page** - Video player + metadata + actions
7. **Review Queues** - Separate views for pending hosts, listings, requests

### 12.2 Admin Permissions Display

The frontend should conditionally show/hide action buttons based on the admin's permissions (extracted from JWT token).

---

## Document History

- **v1.0.0** (2025-10-27): Initial design decisions document
- **v1.1.0** (2025-10-27): Added Section 8: Document & Video Access Strategy
  - Clarified S3 pre-signed URL configuration (15-min expiry, force download)
  - Documented all document types and storage locations
  - Added security considerations and frontend implementation notes
