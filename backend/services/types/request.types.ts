/**
 * Request Types
 * 
 * Defines all types related to host verification requests including
 * Live ID checks, document verification, and other request types.
 */

// ============================================================================
// ENUMS
// ============================================================================

export type RequestType = 'LIVE_ID_CHECK';

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
  pk: string;                      // HOST#<hostId>
  sk: string;                      // REQUEST#<requestId>
  
  // Identifiers
  requestId: string;               // req_<uuid>
  hostId: string;
  
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
  
  // Submission Tracking (for 2-step upload)
  submissionToken?: string;        // Temporary token for upload
  submissionTokenExpiresAt?: string; // ISO timestamp
  
  // Audit Trail
  createdAt: string;               // ISO timestamp
  updatedAt: string;               // ISO timestamp
  reviewedAt?: string;             // ISO timestamp
  reviewedBy?: string;             // adminId
  rejectionReason?: string;        // If status is REJECTED
  
  // GSI2: Admin queries (all requests by type/status)
  gsi2pk?: string;                 // REQUEST#<requestType>
  gsi2sk?: string;                 // STATUS#<status>#<createdAt>
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
}

// Get Request Response
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
}

// Submit Intent Request
export interface SubmitRequestIntentRequest {
  contentType: 'video/mp4' | 'video/mov' | 'video/webm';
}

// Submit Intent Response
export interface SubmitRequestIntentResponse {
  requestId: string;
  submissionToken: string;
  uploadUrl: string;
  expiresAt: string;
  maxFileSizeMB: number;
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




