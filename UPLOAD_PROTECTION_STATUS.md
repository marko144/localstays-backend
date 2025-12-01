# Upload Protection Status

This document tracks which upload endpoints have S3-enforced size validation.

## ✅ Protected Endpoints

### 1. Listing Images (Creation)

**File:** `backend/services/api/listings/submit-intent.ts`  
**Max Size:** 10MB per image  
**Allowed Types:** `image/jpeg`, `image/jpg`, `image/png`, `image/webp`, `image/heic`, `image/heif`  
**Protection:** ✅ Backend validation + S3 size enforcement  
**Status:** 🟢 **Fully Protected**

### 2. Listing Verification Documents (Creation)

**File:** `backend/services/api/listings/submit-intent.ts`  
**Max Size:** 50MB per document  
**Allowed Types:** `image/jpeg`, `image/jpg`, `image/png`, `image/webp`, `application/pdf`  
**Protection:** ✅ Backend validation + S3 size enforcement  
**Status:** 🟢 **Fully Protected**

### 3. Listing Images (Update)

**File:** `backend/services/api/listings/submit-image-update.ts`  
**Max Size:** 10MB per image  
**Allowed Types:** `image/jpeg`, `image/jpg`, `image/png`, `image/webp`, `image/heic`, `image/heif`  
**Protection:** ✅ Backend validation + S3 size enforcement  
**Status:** 🟢 **Fully Protected**

### 4. Host Profile Photo

**File:** `backend/services/api/hosts/submit-intent.ts`  
**Max Size:** 20MB  
**Allowed Types:** `image/jpeg`, `image/jpg`, `image/png`, `image/webp`  
**Protection:** ✅ Backend validation + S3 size enforcement  
**Status:** 🟢 **Fully Protected**

### 5. Host Verification Documents

**File:** `backend/services/api/hosts/submit-intent.ts`  
**Max Size:** 20MB per file, 100MB total  
**Allowed Types:** `image/jpeg`, `image/jpg`, `image/png`, `application/pdf`  
**Protection:** ✅ Backend validation + S3 size enforcement  
**Status:** 🟢 **Fully Protected**

### 6. Live ID Check Files (Video/Image)

**File:** `backend/services/api/requests/submit-intent.ts`  
**Max Size:** 200MB for video, 10MB for image  
**Allowed Types:** Video: `video/mp4`, `video/mov`, `video/webm` | Image: `image/jpeg`, `image/png`, `image/webp`  
**Protection:** ✅ Backend validation + S3 size enforcement  
**Status:** 🟢 **Fully Protected**

### 7. Host Video Intent (Property Video Verification)

**File:** `backend/services/api/hosts/submit-video-intent.ts`  
**Max Size:** 200MB  
**Allowed Types:** `video/mp4`, `video/mov`, `video/webm`  
**Protection:** ✅ Backend validation + S3 size enforcement  
**Status:** 🟢 **Fully Protected**

### 8. Update Rejected Profile Documents

**File:** `backend/services/api/hosts/update-rejected-profile.ts`  
**Max Size:** 20MB per file, 100MB total  
**Allowed Types:** `image/jpeg`, `image/jpg`, `image/png`, `application/pdf`  
**Protection:** ✅ Backend validation + S3 size enforcement  
**Status:** 🟢 **Fully Protected**

---

## 🎉 All Endpoints Protected!

---

## Implementation Checklist

- [x] Listing Images (Creation) - 10MB
- [x] Listing Verification Documents (Creation) - 50MB
- [x] Listing Images (Update) - 10MB
- [x] Host Profile Photo - 20MB
- [x] Host Verification Documents - 20MB per file, 100MB total
- [x] Live ID Check Files - 200MB video, 10MB image
- [x] Host Video Intent (Property Video Verification) - 200MB
- [x] Update Rejected Profile Documents - 20MB per file, 100MB total

---

## How Protection Works

### Backend Validation

1. Frontend sends file metadata including `fileSize`
2. Backend validates:
   - Content type is in allowed list
   - File size is within limit
3. If invalid, returns `400 Bad Request` (no S3 URL generated)

### S3 Enforcement

1. Backend generates pre-signed URL with `ContentLength` set to exact file size
2. Frontend uploads file to S3
3. S3 validates actual upload size matches the signed `ContentLength`
4. If mismatch, S3 returns `403 Forbidden` or `400 Bad Request`

### Security Benefits

- ✅ Cannot bypass by lying about file size (S3 checks actual upload)
- ✅ Cannot modify pre-signed URL (cryptographically signed)
- ✅ Immediate feedback during upload (not after processing)
- ✅ No wasted Lambda invocations or storage costs

---

## Next Steps

Work through remaining endpoints one by one, applying appropriate limits for each use case.
