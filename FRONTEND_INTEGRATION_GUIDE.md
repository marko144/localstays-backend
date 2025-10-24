# Frontend Integration Guide - Host Profile Submission

## Overview

This guide explains how to integrate the host profile submission API into the frontend. From the user's perspective, this is a **single-click submission**, but behind the scenes, it's a three-step process for reliability and performance.

---

## User Experience

### What the User Sees:

1. User fills in profile form ✍️
2. User selects documents (PDF/JPEG/PNG files) 📎
3. User clicks **"Submit Profile"** button once 🖱️
4. Progress indicator shows: "Uploading documents..." ⏳
5. Success message: "Profile submitted for review" ✅
6. Redirect to dashboard

**Total time: ~10 seconds** (depending on file sizes)

---

## Technical Flow

### The Three-Step Process (Handled Automatically):

```
Step 1: Submit Intent
  ↓
  Frontend gets: submission token + pre-signed upload URLs
  ↓
Step 2: Upload Files
  ↓
  Frontend uploads files directly to S3 (parallel)
  ↓
Step 3: Confirm Submission
  ↓
  Frontend confirms all files uploaded
  ↓
SUCCESS: Profile status → VERIFICATION (pending admin review)
```

---

## API Endpoints

### Base URL

```
Development: https://{api-id}.execute-api.eu-north-1.amazonaws.com/dev1
Staging: https://{api-id}.execute-api.eu-north-1.amazonaws.com/staging
Production: https://{api-id}.execute-api.eu-north-1.amazonaws.com/prod
```

### Endpoints

```
POST /api/v1/hosts/{hostId}/profile/submit-intent
POST /api/v1/hosts/{hostId}/profile/confirm-submission
GET  /api/v1/hosts/{hostId}/profile
```

### Authentication

All requests require JWT token in header:

```
Authorization: Bearer {idToken}
```

The `hostId` is available in the JWT token claims after user signs up.

---

## Data Structures

### Profile Data Types

#### Individual Host

```typescript
interface IndividualProfile {
  hostType: "INDIVIDUAL";
  email: string; // Valid email format
  phone: string; // E.164 format (e.g., "+381601234567")
  preferredLanguage: string; // BCP-47 (e.g., "sr-RS", "en-GB")
  countryCode: string; // ISO-3166-1 alpha-2 (e.g., "RS", "GB")
  address: Address;
  forename: string; // First name (max 100 chars)
  surname: string; // Last name (max 100 chars)
}
```

#### Business Host

```typescript
interface BusinessProfile {
  hostType: "BUSINESS";
  email: string;
  phone: string;
  preferredLanguage: string;
  countryCode: string;
  address: Address;
  legalName: string; // Company legal name (max 200 chars)
  registrationNumber: string; // Business registration number (max 50 chars)
  vatRegistered: boolean; // Is VAT registered?
  vatNumber?: string; // Required if vatRegistered is true (max 50 chars)
  displayName?: string; // Public display name (optional, max 200 chars)
}
```

#### Address Structure

```typescript
interface Address {
  addressLine1: string; // Required (max 200 chars)
  addressLine2: string | null; // Optional (max 200 chars)
  locality: string; // City (max 100 chars)
  administrativeArea: string; // State/Province (max 100 chars)
  postalCode: string; // Postal code (max 20 chars)
  countryCode: string; // ISO-3166-1 alpha-2
}
```

### Document Types

```typescript
type DocumentType =
  | "PASSPORT"
  | "ID_CARD"
  | "DRIVERS_LICENSE"
  | "PROOF_OF_ADDRESS"
  | "BUSINESS_REGISTRATION"
  | "VAT_CERTIFICATE"
  | "OTHER";
```

### Document Requirements

#### For Individual Hosts:

- ✅ **One of:** Passport, ID Card, or Driver's License
- ✅ **Required:** Proof of Address

#### For Business Hosts:

- ✅ **One of:** Passport, ID Card, or Driver's License (for authorized person)
- ✅ **Required:** Business Registration
- ✅ **Required:** Proof of Address
- ✅ **Required (if VAT registered):** VAT Certificate

### File Constraints

- **Allowed types:** PDF, JPEG, PNG
- **Max file size:** 10MB per file
- **Max total size:** 50MB per submission
- **Accepted MIME types:**
  - `application/pdf`
  - `image/jpeg`
  - `image/jpg`
  - `image/png`

---

## Implementation

### Complete Submission Function

```typescript
import { useState } from "react";

interface File {
  file: File; // The actual file object
  documentType: DocumentType; // Document type
}

interface SubmissionProgress {
  status:
    | "idle"
    | "preparing"
    | "uploading"
    | "confirming"
    | "success"
    | "error";
  message: string;
  uploadProgress?: number; // 0-100
}

/**
 * Submit host profile with documents
 *
 * @param hostId - Host ID from JWT claims
 * @param profile - Profile data (Individual or Business)
 * @param files - Array of files with their types
 * @param idToken - JWT ID token from Cognito
 */
async function submitHostProfile(
  hostId: string,
  profile: IndividualProfile | BusinessProfile,
  files: File[],
  idToken: string,
  onProgress?: (progress: SubmissionProgress) => void
): Promise<void> {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL;

  try {
    // ========================================
    // STEP 1: Submit Intent
    // ========================================
    onProgress?.({
      status: "preparing",
      message: "Preparing submission...",
    });

    const intentResponse = await fetch(
      `${apiUrl}/api/v1/hosts/${hostId}/profile/submit-intent`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${idToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          profile,
          documents: files.map((f) => ({
            documentType: f.documentType,
            fileName: f.file.name,
            fileSize: f.file.size,
            mimeType: f.file.type,
          })),
        }),
      }
    );

    if (!intentResponse.ok) {
      const error = await intentResponse.json();
      throw new Error(error.message || "Failed to submit intent");
    }

    const { submissionToken, uploadUrls } = await intentResponse.json();

    // ========================================
    // STEP 2: Upload Files to S3 (Parallel)
    // ========================================
    onProgress?.({
      status: "uploading",
      message: `Uploading documents (0/${files.length})...`,
      uploadProgress: 0,
    });

    let uploadedCount = 0;
    const uploadPromises = uploadUrls.map(async (urlData: any) => {
      const fileToUpload = files.find(
        (f) => f.documentType === urlData.documentType
      );

      if (!fileToUpload) {
        throw new Error(
          `File not found for document type: ${urlData.documentType}`
        );
      }

      // Direct upload to S3 using pre-signed URL
      const uploadResponse = await fetch(urlData.uploadUrl, {
        method: "PUT",
        body: fileToUpload.file,
        headers: {
          "Content-Type": fileToUpload.file.type,
        },
      });

      if (!uploadResponse.ok) {
        throw new Error(`Failed to upload ${urlData.documentType}`);
      }

      // Update progress
      uploadedCount++;
      onProgress?.({
        status: "uploading",
        message: `Uploading documents (${uploadedCount}/${files.length})...`,
        uploadProgress: Math.round((uploadedCount / files.length) * 100),
      });

      return {
        documentId: urlData.documentId,
        documentType: urlData.documentType,
      };
    });

    const uploadedDocuments = await Promise.all(uploadPromises);

    // ========================================
    // STEP 3: Confirm Submission
    // ========================================
    onProgress?.({
      status: "confirming",
      message: "Finalizing submission...",
      uploadProgress: 100,
    });

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
          uploadedDocuments,
        }),
      }
    );

    if (!confirmResponse.ok) {
      const error = await confirmResponse.json();
      throw new Error(error.message || "Failed to confirm submission");
    }

    // ========================================
    // SUCCESS!
    // ========================================
    onProgress?.({
      status: "success",
      message: "Profile submitted successfully! Pending admin review.",
    });
  } catch (error) {
    onProgress?.({
      status: "error",
      message:
        error instanceof Error
          ? error.message
          : "Submission failed. Please try again.",
    });
    throw error;
  }
}

export default submitHostProfile;
```

---

## React Component Example

```typescript
import { useState } from "react";
import { useRouter } from "next/router";
import submitHostProfile from "./submitHostProfile";

export function ProfileSubmissionForm() {
  const router = useRouter();
  const [profile, setProfile] = useState<IndividualProfile | BusinessProfile>();
  const [files, setFiles] = useState<File[]>([]);
  const [progress, setProgress] = useState<SubmissionProgress>({
    status: "idle",
    message: "",
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Get from auth context (example - adjust to your auth implementation)
  const { idToken, hostId } = useAuth();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!profile || files.length === 0) {
      alert("Please fill in all fields and upload required documents");
      return;
    }

    setIsSubmitting(true);

    try {
      await submitHostProfile(
        hostId,
        profile,
        files,
        idToken,
        setProgress // Progress callback
      );

      // Success - redirect to dashboard
      router.push("/dashboard?status=pending-verification");
    } catch (error) {
      console.error("Submission error:", error);
      // Error state is already set by progress callback
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      {/* Profile form fields */}

      {/* File upload component */}

      {/* Progress indicator */}
      {isSubmitting && (
        <div className="progress-container">
          <div
            className="progress-bar"
            style={{ width: `${progress.uploadProgress || 0}%` }}
          />
          <p>{progress.message}</p>
        </div>
      )}

      {/* Submit button */}
      <button type="submit" disabled={isSubmitting}>
        {isSubmitting ? "Submitting..." : "Submit Profile"}
      </button>

      {/* Error display */}
      {progress.status === "error" && (
        <div className="error-message">{progress.message}</div>
      )}
    </form>
  );
}
```

---

## Error Handling

### Common Errors and How to Handle Them

#### 400 Bad Request - Validation Error

```json
{
  "error": "VALIDATION_ERROR",
  "message": "Profile validation failed",
  "validationErrors": {
    "errors": [
      { "field": "email", "message": "Valid email address is required" },
      {
        "field": "forename",
        "message": "First name is required for individual hosts"
      }
    ]
  }
}
```

**Frontend Action:** Display field-specific errors in the form

#### 422 Unprocessable Entity - Missing Documents

```json
{
  "error": "VALIDATION_ERROR",
  "message": "Required documents missing",
  "details": {
    "missing": ["PROOF_OF_ADDRESS"],
    "errors": []
  }
}
```

**Frontend Action:** Highlight missing document types in file upload UI

#### 403 Forbidden - Wrong Host

```json
{
  "error": "FORBIDDEN",
  "message": "User cannot access host host_xyz"
}
```

**Frontend Action:** This shouldn't happen if using correct `hostId` from JWT. Show generic error and log to monitoring.

#### 409 Conflict - Already Submitted

```json
{
  "error": "CONFLICT",
  "message": "Cannot submit profile when status is VERIFICATION. Allowed statuses: INCOMPLETE, INFO_REQUIRED"
}
```

**Frontend Action:** Redirect to dashboard with message "Your profile is already under review"

#### 400 Bad Request - Expired Token

```json
{
  "error": "BAD_REQUEST",
  "message": "Submission token has expired"
}
```

**Frontend Action:** Show "Session expired. Please try again" and allow user to resubmit

#### 400 Bad Request - Upload Failed

```json
{
  "error": "BAD_REQUEST",
  "message": "Not all files have been uploaded to S3",
  "details": {
    "missingFiles": [
      {
        "documentId": "doc_123",
        "s3Key": "host_xyz/verification/doc_123_passport.pdf"
      }
    ]
  }
}
```

**Frontend Action:** This means Step 2 (S3 upload) failed. Retry the submission or show specific file that failed.

---

## Form Validation (Frontend)

### Before Submitting

```typescript
function validateProfile(
  profile: IndividualProfile | BusinessProfile
): string[] {
  const errors: string[] = [];

  // Email validation
  if (!profile.email.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) {
    errors.push("Invalid email format");
  }

  // Phone validation (E.164 format)
  if (!profile.phone.match(/^\+[1-9]\d{1,14}$/)) {
    errors.push("Phone must be in international format (e.g., +381601234567)");
  }

  // Country code validation
  if (!profile.countryCode.match(/^[A-Z]{2}$/)) {
    errors.push("Invalid country code");
  }

  // Type-specific validation
  if (profile.hostType === "INDIVIDUAL") {
    if (!profile.forename || profile.forename.trim().length === 0) {
      errors.push("First name is required");
    }
    if (!profile.surname || profile.surname.trim().length === 0) {
      errors.push("Last name is required");
    }
  } else if (profile.hostType === "BUSINESS") {
    if (!profile.legalName || profile.legalName.trim().length === 0) {
      errors.push("Legal name is required");
    }
    if (
      !profile.registrationNumber ||
      profile.registrationNumber.trim().length === 0
    ) {
      errors.push("Registration number is required");
    }
    if (
      profile.vatRegistered &&
      (!profile.vatNumber || profile.vatNumber.trim().length === 0)
    ) {
      errors.push("VAT number is required when VAT registered");
    }
  }

  return errors;
}

function validateDocuments(
  hostType: "INDIVIDUAL" | "BUSINESS",
  documents: File[],
  vatRegistered: boolean
): string[] {
  const errors: string[] = [];
  const types = documents.map((d) => d.documentType);

  // Check file sizes
  documents.forEach((doc) => {
    if (doc.file.size > 10 * 1024 * 1024) {
      errors.push(`${doc.file.name} exceeds 10MB limit`);
    }
  });

  // Check total size
  const totalSize = documents.reduce((sum, doc) => sum + doc.file.size, 0);
  if (totalSize > 50 * 1024 * 1024) {
    errors.push("Total file size exceeds 50MB limit");
  }

  // Check required documents
  const hasGovernmentId = types.some((t) =>
    ["PASSPORT", "ID_CARD", "DRIVERS_LICENSE"].includes(t)
  );
  if (!hasGovernmentId) {
    errors.push(
      "Government-issued ID required (Passport, ID Card, or Driver's License)"
    );
  }

  if (!types.includes("PROOF_OF_ADDRESS")) {
    errors.push("Proof of Address is required");
  }

  if (hostType === "BUSINESS") {
    if (!types.includes("BUSINESS_REGISTRATION")) {
      errors.push("Business Registration is required");
    }
    if (vatRegistered && !types.includes("VAT_CERTIFICATE")) {
      errors.push("VAT Certificate is required for VAT-registered businesses");
    }
  }

  return errors;
}
```

---

## Fetching Profile Data (After Submission)

Once a profile has been submitted, you can retrieve it to display back to the user.

### Endpoint

**`GET /api/v1/hosts/{hostId}/profile`**

### Use Cases

- Display profile summary after submission
- Show profile during onboarding progress
- Allow users to review their submitted information
- Display document upload status

### Request

```typescript
const response = await fetch(`${apiUrl}/api/v1/hosts/${hostId}/profile`, {
  method: "GET",
  headers: {
    Authorization: `Bearer ${idToken}`,
  },
});

const profileData = await response.json();
```

### Response (Success 200 OK)

The response includes all profile data, KYC status, and document metadata (filenames and status, but NOT S3 URLs).

#### Key Fields

- `hostType`: `"INDIVIDUAL"` or `"BUSINESS"` (determines which fields are present)
- `status`: Overall host profile status (`NOT_SUBMITTED`, `INCOMPLETE`, `VERIFICATION`, `VERIFIED`, `REJECTED`, `SUSPENDED`)
- `kyc.status`: KYC verification status (`PENDING`, `APPROVED`, `REJECTED`)
- `documents`: Array of document metadata (no S3 URLs, just filenames, types, and statuses)

#### Individual Host Example

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

#### Business Host Example

For business hosts, individual-specific fields (`forename`, `surname`) are replaced with business-specific fields (`legalName`, `registrationNumber`, etc.):

```json
{
  "hostType": "BUSINESS",
  "legalName": "Babić Properties DOO",
  "registrationNumber": "12345678",
  "vatRegistered": true,
  "vatNumber": "RS123456789",
  "displayName": "Babić Rentals"
  // ... all other fields same as Individual
}
```

### Frontend Implementation Example

```typescript
interface ProfileDisplayProps {
  hostId: string;
}

export function ProfileDisplay({ hostId }: ProfileDisplayProps) {
  const [profile, setProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchProfile() {
      try {
        const idToken = await getIdToken();
        const apiUrl = process.env.NEXT_PUBLIC_API_URL;

        const response = await fetch(
          `${apiUrl}/api/v1/hosts/${hostId}/profile`,
          {
            headers: {
              Authorization: `Bearer ${idToken}`,
            },
          }
        );

        if (!response.ok) {
          throw new Error("Failed to fetch profile");
        }

        const data = await response.json();
        setProfile(data);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }

    fetchProfile();
  }, [hostId]);

  if (loading) return <div>Loading profile...</div>;
  if (error) return <div>Error: {error}</div>;
  if (!profile) return <div>Profile not found</div>;

  return (
    <div className="profile-display">
      <h2>Profile Summary</h2>

      <div className="status-badge">Status: {profile.status}</div>

      <div className="profile-info">
        <h3>Personal Information</h3>
        {profile.hostType === "INDIVIDUAL" ? (
          <>
            <p>
              Name: {profile.forename} {profile.surname}
            </p>
          </>
        ) : (
          <>
            <p>Company: {profile.legalName}</p>
            <p>Display Name: {profile.displayName || "N/A"}</p>
            <p>Registration: {profile.registrationNumber}</p>
            {profile.vatRegistered && <p>VAT Number: {profile.vatNumber}</p>}
          </>
        )}

        <p>Email: {profile.email}</p>
        <p>Phone: {profile.phone}</p>
      </div>

      <div className="kyc-info">
        <h3>Verification Status</h3>
        <p>KYC Status: {profile.kyc.status}</p>
        {profile.kyc.submittedAt && (
          <p>Submitted: {new Date(profile.kyc.submittedAt).toLocaleString()}</p>
        )}
        {profile.kyc.rejectedAt && (
          <>
            <p>Rejected: {new Date(profile.kyc.rejectedAt).toLocaleString()}</p>
            <p className="error">Reason: {profile.kyc.rejectReason}</p>
          </>
        )}
      </div>

      <div className="documents-info">
        <h3>Documents ({profile.documents.length})</h3>
        <ul>
          {profile.documents.map((doc: any) => (
            <li key={doc.documentId}>
              <strong>{doc.documentType}:</strong> {doc.fileName}
              <span className={`status-${doc.status.toLowerCase()}`}>
                {doc.status}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
```

### Error Responses

#### 404 Not Found

```json
{
  "error": "NOT_FOUND",
  "message": "Host profile not found: host_uuid"
}
```

#### 403 Forbidden

```json
{
  "error": "FORBIDDEN",
  "message": "User xyz cannot access host abc"
}
```

---

## Host Status Flow & Frontend Routing

The `status` field in the host profile determines where the user should be redirected in the app.

### Status Definitions

| Status          | Description                                        | When Set                            | Frontend Action                            |
| --------------- | -------------------------------------------------- | ----------------------------------- | ------------------------------------------ |
| `NOT_SUBMITTED` | User just created account, never submitted profile | PostConfirmation Lambda (on signup) | **Redirect to Profile Form**               |
| `INCOMPLETE`    | User started filling profile but hasn't submitted  | (Future: Draft save feature)        | Redirect to Profile Form (with saved data) |
| `VERIFICATION`  | Profile submitted, awaiting admin review           | After confirm-submission API call   | Show "Under Review" status page            |
| `VERIFIED`      | Admin approved profile                             | Admin action                        | Allow access to dashboard/listings         |
| `REJECTED`      | Admin rejected profile                             | Admin action                        | Show rejection reason, allow resubmission  |
| `SUSPENDED`     | Account suspended                                  | Admin action                        | Show suspension notice, block access       |

### Frontend Routing Logic

After user login, fetch the profile and route based on status:

```typescript
import { useEffect } from "react";
import { useRouter } from "next/router";
import { useAuth } from "./hooks/useAuth";

export function useProfileRedirect() {
  const router = useRouter();
  const { user, hostId } = useAuth();

  useEffect(() => {
    async function checkProfileStatus() {
      if (!user || !hostId) return;

      try {
        const response = await fetch(
          `${process.env.NEXT_PUBLIC_API_URL}/api/v1/hosts/${hostId}/profile`,
          {
            headers: {
              Authorization: `Bearer ${await user.getIdToken()}`,
            },
          }
        );

        if (!response.ok) {
          // Profile doesn't exist yet - redirect to create profile
          router.push("/profile/create");
          return;
        }

        const profile = await response.json();

        // Route based on status
        switch (profile.status) {
          case "NOT_SUBMITTED":
          case "INCOMPLETE":
            // User needs to complete/submit profile
            router.push("/profile/create");
            break;

          case "VERIFICATION":
            // Show "under review" page
            router.push("/profile/pending");
            break;

          case "VERIFIED":
            // Normal dashboard access
            router.push("/dashboard");
            break;

          case "REJECTED":
            // Show rejection reason and allow resubmission
            router.push("/profile/rejected");
            break;

          case "SUSPENDED":
            // Show suspension notice
            router.push("/account/suspended");
            break;

          default:
            // Unknown status - redirect to support
            router.push("/support");
        }
      } catch (error) {
        console.error("Failed to check profile status:", error);
        // Handle error - maybe redirect to error page
      }
    }

    checkProfileStatus();
  }, [user, hostId, router]);
}
```

### Using in Your App

```typescript
// In your main app layout or protected route wrapper
export function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  useProfileRedirect(); // Automatically redirects based on status

  if (loading) return <LoadingSpinner />;
  if (!user) return <LoginPage />;

  return <>{children}</>;
}
```

### JWT Token Includes Status

The JWT token already includes `hostStatus` claim, so you can check it immediately after login without an API call:

```typescript
import { useAuth } from "./hooks/useAuth";

export function QuickStatusCheck() {
  const { user } = useAuth();

  // Get status from JWT claims
  const hostStatus = user?.claims?.hostStatus;

  if (hostStatus === "NOT_SUBMITTED" || hostStatus === "INCOMPLETE") {
    return <ProfileIncompleteNotice />;
  }

  return <DashboardContent />;
}
```

---

## Environment Variables

Add to your `.env.local` or environment config:

```bash
# API Configuration
NEXT_PUBLIC_API_URL=https://your-api-id.execute-api.eu-north-1.amazonaws.com/dev1
NEXT_PUBLIC_API_VERSION=v1

# Cognito Configuration (for auth)
NEXT_PUBLIC_COGNITO_USER_POOL_ID=eu-north-1_rC7TXg63d
NEXT_PUBLIC_COGNITO_CLIENT_ID=6eh33a9iet85bqg5gatp0s1sj8
NEXT_PUBLIC_COGNITO_REGION=eu-north-1
```

---

## Testing Checklist

### Profile Submission (Happy Path)

- [ ] Individual host with Passport + Proof of Address
- [ ] Business host (non-VAT) with all required docs
- [ ] Business host (VAT registered) with VAT certificate
- [ ] Upload progress shows correctly
- [ ] Redirect to dashboard after success

### Profile Fetching

- [ ] Fetch profile after submission → Display correctly
- [ ] Individual profile shows forename/surname
- [ ] Business profile shows legalName/registrationNumber
- [ ] Document list shows correct filenames and types (no S3 URLs)
- [ ] KYC status displays correctly
- [ ] Profile not found (404) handled gracefully

### Error Scenarios

- [ ] Missing required profile fields → Show validation errors
- [ ] Missing required documents → Show document errors
- [ ] File too large (>10MB) → Show size error
- [ ] Wrong file type (.txt, .doc) → Show type error
- [ ] Network failure during upload → Show retry option
- [ ] Already submitted profile → Redirect with message
- [ ] Unauthorized access to another host's profile (403) → Show error

### Edge Cases

- [ ] User refreshes during upload → Handle gracefully
- [ ] User goes back/forward → Don't lose form data
- [ ] Multiple rapid clicks on submit → Prevent duplicate submissions
- [ ] Slow network → Show appropriate loading state
- [ ] Fetch profile before submission (status: INCOMPLETE) → Handle gracefully

---

## Getting Help

- **Backend API Issues:** Check CloudWatch logs (Lambda functions)
- **Authentication Issues:** Verify JWT token is valid and contains `hostId`
- **S3 Upload Issues:** Check pre-signed URL hasn't expired (10 min)
- **Validation Errors:** Check API response for specific field errors

For questions, contact the backend team with:

1. Request/response payloads
2. Error messages
3. User's `hostId`
4. Timestamp of attempt
