# Property Listings Feature - Ready to Deploy! 🚀

## ✅ Implementation Complete

The property listings feature has been fully implemented and is ready for deployment to `dev1`.

---

## 📦 What's Been Built

### 1. Database Schema & Seeding

- ✅ **43 amenities** across 10 categories (bilingual EN/SR)
- ✅ **5 property types** (APARTMENT, HOUSE, VILLA, STUDIO, ROOM)
- ✅ **4 check-in types** (SELF_CHECKIN, HOST_GREETING, LOCKBOX, DOORMAN)
- ✅ **3 parking types** (NO_PARKING, FREE, PAID)
- ✅ **4 verification document types**
- ✅ **8 listing statuses** (DRAFT, IN_REVIEW, APPROVED, REJECTED, ONLINE, OFFLINE, LOCKED, ARCHIVED)
- ✅ **10 amenity categories**
- ✅ All seeded with bilingual translations

### 2. API Endpoints (6 endpoints)

#### Metadata Endpoint

- `GET /api/v1/listings/metadata` - Returns all configuration data for listing forms

#### Listing Management

- `POST /api/v1/hosts/{hostId}/listings/submit-intent` - Create listing + get upload URLs
- `POST /api/v1/hosts/{hostId}/listings/{listingId}/confirm-submission` - Finalize submission
- `GET /api/v1/hosts/{hostId}/listings` - List all host's listings (with status filter)
- `GET /api/v1/hosts/{hostId}/listings/{listingId}` - Get full listing details
- `DELETE /api/v1/hosts/{hostId}/listings/{listingId}` - Soft delete listing

### 3. Features Implemented

- ✅ **Two-step submission** (like profile submission)
- ✅ **Subscription limit enforcement** (checks maxListings before creation)
- ✅ **Bilingual data storage** (EN/SR stored directly in records)
- ✅ **S3 pre-signed URLs** for image and document uploads
- ✅ **Soft delete** with cascade to child records
- ✅ **Image management** (max 15 images, 1 primary required)
- ✅ **Status workflow** (DRAFT → IN_REVIEW → APPROVED → ONLINE)
- ✅ **Admin lock capability** (LOCKED status)

---

## 📂 Files Created/Modified

### New Files

```
backend/services/types/listing.types.ts
backend/services/api/listings/get-metadata.ts
backend/services/api/listings/submit-intent.ts
backend/services/api/listings/confirm-submission.ts
backend/services/api/listings/get-listing.ts
backend/services/api/listings/list-listings.ts
backend/services/api/listings/delete-listing.ts
LISTINGS_IMPLEMENTATION_PROGRESS.md
LISTINGS_READY_TO_DEPLOY.md
```

### Modified Files

```
backend/services/seed/seed-handler.ts (added seedListingEnums)
infra/lib/data-stack.ts (version 1.8.0)
infra/lib/api-lambda-stack.ts (added 6 Lambda functions + routes)
```

---

## 🗂️ Database Records

### Listing Records Structure

#### Listing Metadata

```
pk: HOST#<hostId>
sk: LISTING_META#<listingId>
```

- Stores all listing details (name, property type, address, capacity, pricing, etc.)
- Bilingual enum data embedded (no need for frontend to fetch separately)
- Status workflow tracking
- GSI2 for admin review queue (by status)
- GSI3 for location queries (by country/city)

#### Listing Images (max 15)

```
pk: HOST#<hostId>
sk: LISTING_IMAGE#<listingId>#<imageId>
```

- Stores S3 references and metadata
- Display order, primary flag, caption
- Status: PENDING_UPLOAD → ACTIVE

#### Listing Amenities

```
pk: HOST#<hostId>
sk: LISTING_AMENITIES#<listingId>
```

- Array of selected amenities with bilingual data
- Includes category for grouping

#### Listing Verification Documents

```
pk: HOST#<hostId>
sk: LISTING_DOC#<listingId>#<documentType>
```

- Optional verification documents
- Status: PENDING_UPLOAD → PENDING_REVIEW → APPROVED/REJECTED

---

## 🔄 Two-Step Submission Flow

### Step 1: Submit Intent

```
POST /api/v1/hosts/{hostId}/listings/submit-intent
```

**Frontend sends:**

- All listing metadata (name, property type, address, capacity, pricing, etc.)
- Array of image metadata (imageId, contentType, isPrimary, displayOrder)
- Optional: verification document types

**Backend returns:**

- `listingId`
- `submissionToken` (JWT, expires in 30 minutes)
- `imageUploadUrls[]` (pre-signed S3 URLs)
- `documentUploadUrls[]` (pre-signed S3 URLs)

**Backend creates:**

- Listing metadata record (status: DRAFT)
- Amenities record
- Placeholder image records (status: PENDING_UPLOAD)
- Placeholder document records (status: PENDING_UPLOAD)

### Step 2: Confirm Submission

```
POST /api/v1/hosts/{hostId}/listings/{listingId}/confirm-submission
```

**Frontend sends:**

- `submissionToken`
- `uploadedImages[]` (array of imageIds)
- `uploadedDocuments[]` (array of documentTypes)

**Backend verifies:**

- Token is valid and not expired
- All images uploaded to S3 (HeadObject check)
- All documents uploaded to S3 (if declared)
- At least 1 image exists
- Exactly 1 primary image exists

**Backend updates:**

- Listing: DRAFT → IN_REVIEW
- Images: PENDING_UPLOAD → ACTIVE
- Documents: PENDING_UPLOAD → PENDING_REVIEW
- Sets `submittedAt` timestamp
- Updates GSI2 for admin review queue

---

## 🎯 Subscription Enforcement

Before creating a listing, the backend checks:

```typescript
currentListingsCount < maxListings;
```

- Counts all non-deleted, non-archived listings
- Compares against subscription's `maxListings`
- Returns 403 Forbidden if limit reached

---

## 🗺️ S3 Structure

```
{hostId}/
├── verification/           (host-level docs)
│   ├── passport.jpg
│   └── business_license.pdf
│
└── listings/
    ├── {listingId}/
    │   ├── images/
    │   │   ├── img_001.jpg
    │   │   ├── img_002.jpg
    │   │   └── img_003.jpg  (max 15)
    │   │
    │   └── verification/
    │       ├── PROOF_OF_OWNERSHIP.pdf
    │       └── PROOF_OF_ADDRESS.jpg
    │
    └── {listingId2}/
        └── ...
```

---

## 🚀 Deployment Instructions

### 1. Deploy DataStack (to seed enums)

```bash
cd /Users/markobabic/LocalDev/localstays-backend
npm run cdk -- deploy LocalstaysDev1DataStack -c env=dev1 --require-approval never
```

This will:

- Trigger re-seeding (version 1.8.0)
- Seed all listing enums (property types, amenities, etc.)
- Takes ~30 seconds

### 2. Deploy ApiStack (to deploy Lambda functions)

```bash
npm run cdk -- deploy LocalstaysDev1ApiStack -c env=dev1 --require-approval never
```

This will:

- Create 6 new Lambda functions
- Add 6 new API routes
- Configure IAM permissions
- Takes ~2-3 minutes

### 3. Verify Deployment

Check CloudFormation outputs for new endpoints:

- `GetListingMetadataEndpoint`
- `SubmitListingIntentEndpoint`
- `ConfirmListingSubmissionEndpoint`
- `GetListingEndpoint`
- `ListListingsEndpoint`
- `DeleteListingEndpoint`

---

## 🧪 Testing Checklist

### 1. Get Metadata

```bash
GET /api/v1/listings/metadata
Authorization: Bearer <token>
```

**Expected:** Returns property types, amenities, check-in types, etc.

### 2. Create Listing (Submit Intent)

```bash
POST /api/v1/hosts/{hostId}/listings/submit-intent
Authorization: Bearer <token>
Body: {
  "listingName": "Test Apartment",
  "propertyType": "APARTMENT",
  "description": "A beautiful 2-bedroom apartment in the city center...",
  "address": { ... },
  "capacity": { "beds": 2, "sleeps": 4 },
  "pricing": { "pricePerNight": 75.00, "currency": "EUR" },
  "pets": { "allowed": false },
  "checkIn": { "type": "SELF_CHECKIN", "checkInFrom": "14:00", "checkOutBy": "11:00" },
  "parking": { "type": "FREE" },
  "amenities": ["WIFI", "AIR_CONDITIONING", "KITCHEN"],
  "images": [
    { "imageId": "img_001", "contentType": "image/jpeg", "isPrimary": true, "displayOrder": 1 }
  ]
}
```

**Expected:** Returns `listingId`, `submissionToken`, and pre-signed URLs

### 3. Upload Images to S3

Use the pre-signed URLs from step 2

### 4. Confirm Submission

```bash
POST /api/v1/hosts/{hostId}/listings/{listingId}/confirm-submission
Authorization: Bearer <token>
Body: {
  "submissionToken": "...",
  "uploadedImages": ["img_001"]
}
```

**Expected:** Returns success, status = IN_REVIEW

### 5. List Listings

```bash
GET /api/v1/hosts/{hostId}/listings
Authorization: Bearer <token>
```

**Expected:** Returns array of listings with primary images

### 6. Get Listing Details

```bash
GET /api/v1/hosts/{hostId}/listings/{listingId}
Authorization: Bearer <token>
```

**Expected:** Returns full listing details with images and amenities

### 7. Delete Listing

```bash
DELETE /api/v1/hosts/{hostId}/listings/{listingId}
Authorization: Bearer <token>
```

**Expected:** Returns success, listing soft deleted

---

## 📊 Database Queries to Verify

After deployment, check DynamoDB:

```bash
# Check if enums were seeded
pk = "ENUM#PROPERTY_TYPE" AND sk BEGINS_WITH "VALUE#"
# Should return 5 property types

pk = "ENUM#AMENITY" AND sk BEGINS_WITH "VALUE#"
# Should return 43 amenities

# Check if listing was created
pk = "HOST#<hostId>" AND sk BEGINS_WITH "LISTING_META#"
# Should return listing records

# Check if images were created
pk = "HOST#<hostId>" AND sk BEGINS_WITH "LISTING_IMAGE#<listingId>#"
# Should return image records
```

---

## 🔧 Troubleshooting

### Issue: Enums not seeded

**Solution:** Check CloudWatch logs for `SeedHandler` Lambda

```bash
aws logs tail /aws/lambda/localstays-dev1-seed --follow
```

### Issue: 403 Forbidden on listing creation

**Cause:** Subscription limit reached
**Solution:** Check subscription `maxListings` vs current listing count

### Issue: Images not uploading to S3

**Cause:** CORS or pre-signed URL expiry
**Solution:**

- Check S3 CORS configuration
- Ensure upload happens within 30 minutes
- Check pre-signed URL format

### Issue: Confirm submission fails

**Cause:** Images not found in S3
**Solution:** Verify images were uploaded successfully before confirming

---

## 📝 Next Steps (Future Enhancements)

- [ ] **Update listing endpoint** (PUT /listings/{listingId}) - Edit draft listings
- [ ] **Image management endpoints** (add, delete, reorder, set primary)
- [ ] **Admin endpoints** (approve, reject, lock listings)
- [ ] **Listing search/filter** (by location, property type, price range)
- [ ] **Listing analytics** (views, bookings, revenue)

---

## 📚 Documentation for Frontend

Pass these files to the frontend developer:

1. `LISTINGS_READY_TO_DEPLOY.md` (this file)
2. `backend/services/types/listing.types.ts` (TypeScript types)
3. API endpoint documentation (see above)

---

**Ready to deploy!** 🎉

Run the deployment commands above and the listings feature will be live in `dev1`.






