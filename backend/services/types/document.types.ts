/**
 * Document Entity Type Definitions
 * For tracking host verification documents
 */

export type DocumentType =
  | 'PASSPORT'
  | 'ID_CARD'
  | 'DRIVERS_LICENSE'
  | 'PROOF_OF_ADDRESS'
  | 'BUSINESS_REGISTRATION'
  | 'VAT_CERTIFICATE'
  | 'OTHER';

export type DocumentStatus =
  | 'PENDING_UPLOAD'  // Document record created, waiting for file upload
  | 'PENDING'         // Uploaded, awaiting admin review
  | 'APPROVED'        // Approved by admin
  | 'REJECTED'        // Rejected by admin
  | 'EXPIRED';        // Document expired (e.g., passport expiry date passed)

/**
 * Document entity in DynamoDB
 */
export interface Document {
  pk: string;                  // HOST#<hostId>
  sk: string;                  // DOCUMENT#<documentId>
  
  documentId: string;          // doc_<uuid>
  hostId: string;              // Reference to host
  documentType: DocumentType;
  
  // S3 reference
  s3Key: string;               // Full S3 key: "{hostId}/verification/{documentId}_{filename}"
  s3Bucket: string;            // Bucket name
  fileName: string;            // Original filename from user
  fileSize: number;            // Bytes
  mimeType: string;            // e.g., "application/pdf", "image/jpeg"
  
  // Verification status
  status: DocumentStatus;
  
  // Admin review
  reviewedAt: string | null;
  reviewedBy: string | null;   // Admin Cognito sub
  rejectionReason: string | null;
  notes: string | null;
  
  // GSI attributes (not used for documents currently)
  
  // Metadata
  uploadedAt: string;
  uploadedBy: string;          // User Cognito sub
  expiresAt: string | null;    // For ID documents that expire (also used for TTL)
  isDeleted: boolean;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Document upload intent (from frontend)
 */
export interface DocumentUploadIntent {
  documentType: DocumentType;
  fileName: string;
  fileSize: number;
  mimeType: string;
}

/**
 * Document upload URL response
 */
export interface DocumentUploadUrl {
  documentId: string;
  documentType: DocumentType;
  uploadUrl: string;
  expiresAt: string;
}

/**
 * Document requirements by host type
 */
export interface DocumentRequirements {
  required: {
    anyOf?: DocumentType[][];  // At least one from each group
    all?: DocumentType[];      // All required
  };
  optional?: DocumentType[];
  conditional?: {              // Required if certain conditions met
    condition: string;         // e.g., "vatRegistered"
    documents: DocumentType[];
  }[];
}

/**
 * Validation result for document types
 */
export interface DocumentValidationResult {
  valid: boolean;
  missing: string[];
  errors: string[];
}

/**
 * Document requirements configuration
 */
export const DOCUMENT_REQUIREMENTS: Record<string, DocumentRequirements> = {
  INDIVIDUAL: {
    required: {
      anyOf: [
        ['PASSPORT', 'ID_CARD', 'DRIVERS_LICENSE'],  // At least one government ID
      ],
      all: ['PROOF_OF_ADDRESS'],
    },
  },
  BUSINESS: {
    required: {
      anyOf: [
        ['PASSPORT', 'ID_CARD', 'DRIVERS_LICENSE'],  // At least one ID for authorized person
      ],
      all: ['BUSINESS_REGISTRATION', 'PROOF_OF_ADDRESS'],
    },
    conditional: [
      {
        condition: 'vatRegistered',
        documents: ['VAT_CERTIFICATE'],
      },
    ],
  },
};

/**
 * Allowed MIME types for document uploads
 */
export const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/jpg',
  'image/png',
] as const;

/**
 * Maximum file sizes
 */
export const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB per file
export const MAX_TOTAL_SIZE = 50 * 1024 * 1024; // 50MB total per submission

