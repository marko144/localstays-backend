/**
 * Request Types
 * 
 * Defines all types related to host verification requests including
 * Live ID checks, document verification, and other request types.
 */

// ============================================================================
// ENUMS
// ============================================================================

export type RequestType = 
  | 'LIVE_ID_CHECK'
  | 'PROPERTY_VIDEO_VERIFICATION'
  | 'ADDRESS_VERIFICATION'
  | 'LISTING_IMAGE_UPDATE';

export type RequestStatus = 
  | 'REQUESTED'       // Request created, awaiting host action
  | 'RECEIVED'        // Host uploaded file, awaiting review
  | 'PENDING_REVIEW'  // Under admin review
  | 'VERIFIED'        // Approved by admin
  | 'REJECTED';       // Rejected by admin

// ============================================================================
// REQUEST RECORD (DynamoDB)
// ============================================================================

export interface Request {
  // Keys
  pk: string;                      // HOST#<hostId> OR LISTING#<listingId>
  sk: string;                      // REQUEST#<requestId>
  
  // Identifiers
  requestId: string;               // req_<uuid>
  hostId: string;
  listingId?: string;              // Present for listing-specific requests
  
  // Request Details
  requestType: RequestType;
  status: RequestStatus;
  description: {
    en: string;
    sr: string;
  };
  
  // File Tracking (populated after upload)
  s3Key?: string;                  // Path in S3
  s3Url?: string;                  // CloudFront/S3 URL for viewing
  fileSize?: number;               // In bytes
  contentType?: string;            // video/mp4, video/mov, video/webm
  uploadedAt?: string;             // ISO timestamp
  
  // Property Video Verification fields
  videoUrl?: string;               // S3 URL of uploaded verification video
  videoUploadedAt?: string;        // ISO timestamp
  
  // Address Verification fields
  verificationCode?: string;       // Encrypted 6-char code (NEVER exposed to host)
  codeAttempts?: number;           // Number of failed code submission attempts (max 3)
  pdfLetterUrl?: string;           // S3 URL of generated PDF verification letter
  pdfLetterGeneratedAt?: string;   // ISO timestamp
  
  // Listing Image Update fields
  imagesToAdd?: string[];          // Array of imageIds being added (for LISTING_IMAGE_UPDATE)
  imagesToDelete?: string[];       // Array of imageIds to delete (for LISTING_IMAGE_UPDATE)
  newPrimaryImageId?: string;      // Change which existing image is primary (for LISTING_IMAGE_UPDATE)
  
  // Submission Tracking (for 2-step upload)
  submissionToken?: string;        // Temporary token for upload
  submissionTokenExpiresAt?: string; // ISO timestamp
  
  // Audit Trail
  createdAt: string;               // ISO timestamp
  updatedAt: string;               // ISO timestamp
  reviewedAt?: string;             // ISO timestamp
  reviewedBy?: string;             // adminId
  rejectionReason?: string;        // If status is REJECTED
  
  // Soft Deletion
  isDeleted?: boolean;             // True if request is soft-deleted (e.g., listing was archived)
  
  // GSI2: Admin queries (all requests by type/status)
  gsi2pk?: string;                 // REQUEST#<requestType>
  gsi2sk?: string;                 // STATUS#<status>#<createdAt>
  
  // GSI3: Direct lookup by requestId
  gsi3pk?: string;                 // REQUEST#<requestId>
  gsi3sk?: string;                 // REQUEST_META#<requestId>
}

// ============================================================================
// BILINGUAL TYPES
// ============================================================================

export interface RequestTypeEnum {
  requestType: RequestType;
  description: {
    en: string;
    sr: string;
  };
  displayOrder: number;
}

// ============================================================================
// API REQUEST/RESPONSE TYPES
// ============================================================================

// List Requests Response
export interface ListRequestsResponse {
  requests: RequestSummary[];
}

export interface RequestSummary {
  requestId: string;
  requestType: RequestType;
  status: RequestStatus;
  description: {
    en: string;
    sr: string;
  };
  createdAt: string;
  uploadedAt?: string;
  reviewedAt?: string;
  listingId?: string; // Present for listing-level requests (video/address verification)
  listingName?: string; // Listing name for listing-level requests
}

// Get Request Response (Host-facing - no sensitive admin data)
export interface GetRequestResponse {
  requestId: string;
  requestType: RequestType;
  status: RequestStatus;
  description: {
    en: string;
    sr: string;
  };
  s3Url?: string;
  fileSize?: number;
  contentType?: string;
  createdAt: string;
  uploadedAt?: string;
  updatedAt: string;
  reviewedAt?: string;
  rejectionReason?: string;
  videoUrl?: string;              // For video verification requests
  listingId?: string;             // For listing-level requests
  listingName?: string;           // Listing name for listing-level requests
  codeAttempts?: number;          // For address verification requests (remaining attempts)
  // NOTE: pdfLetterUrl is NOT included - admin-only field
}

// Submit Intent Request (LIVE_ID_CHECK - video + image)
export interface SubmitRequestIntentRequest {
  files: Array<{
    fileId: string;                    // UUID generated by frontend
    contentType: string;               // video/mp4, video/mov, video/webm, image/jpeg, image/png, image/webp
    fileType: 'VIDEO' | 'IMAGE';
    fileSize: number;                  // File size in bytes (enforced by S3)
  }>;
}

// Submit Intent Response (LIVE_ID_CHECK - video + image)
export interface SubmitRequestIntentResponse {
  requestId: string;
  submissionToken: string;
  uploadUrls: Array<{
    fileId: string;
    fileType: 'VIDEO' | 'IMAGE';
    uploadUrl: string;
    expiresAt: string;
  }>;
  maxVideoSizeMB: number;
  maxImageSizeMB: number;
}

// Confirm Submission Request
export interface ConfirmRequestSubmissionRequest {
  submissionToken: string;
}

// Confirm Submission Response
export interface ConfirmRequestSubmissionResponse {
  requestId: string;
  status: RequestStatus;
  message: string;
}

// ============================================================================
// LISTING IMAGE UPDATE TYPES
// ============================================================================

// Submit Image Update Request
export interface SubmitImageUpdateRequest {
  imagesToAdd?: Array<{
    imageId: string;
    contentType: string;
    fileSize: number;           // File size in bytes (enforced by S3)
    isPrimary: boolean;
    displayOrder: number;
    caption?: string;
  }>;
  imagesToDelete?: string[];  // Array of imageIds to delete
  newPrimaryImageId?: string;  // Change which existing image is primary (without adding/deleting)
}

// Submit Image Update Response
export interface SubmitImageUpdateResponse {
  requestId: string;
  submissionToken?: string; // Optional: only present if there are images to upload
  expiresAt?: string; // Optional: only present if there are images to upload
  imageUploadUrls?: Array<{
    imageId: string;
    uploadUrl: string;
    expiresAt: string;
  }>;
}

// Confirm Image Update Request
export interface ConfirmImageUpdateRequest {
  submissionToken: string;
}

// Confirm Image Update Response
export interface ConfirmImageUpdateResponse {
  requestId: string;
  status: RequestStatus;
  message: string;
}




