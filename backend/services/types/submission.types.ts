/**
 * Submission Token Entity Type Definitions
 * For tracking profile submission workflow
 */

import { ProfileData } from './host.types';
import { DocumentType } from './document.types';

export type SubmissionStatus =
  | 'PENDING_UPLOAD'  // Waiting for document uploads
  | 'COMPLETED'       // All documents uploaded and confirmed
  | 'EXPIRED'         // Token expired (auto-deleted by TTL)
  | 'CANCELLED';      // Submission cancelled by user

/**
 * Expected document for submission
 */
export interface ExpectedDocument {
  documentId: string;
  documentType: DocumentType;
  uploaded: boolean;
}

/**
 * Expected profile photo for submission
 */
export interface ExpectedProfilePhoto {
  photoId: string;
  uploaded: boolean;
}

/**
 * Submission token entity in DynamoDB
 */
export interface SubmissionToken {
  pk: string;                    // SUBMISSION#<submissionToken>
  sk: 'META';
  
  submissionToken: string;       // sub_<uuid>
  hostId: string;                // Reference to host
  userId: string;                // Cognito sub of submitter
  status: SubmissionStatus;
  
  // Saved profile data (for idempotency)
  profileData: ProfileData;
  
  // Expected documents
  expectedDocuments: ExpectedDocument[];
  
  // Expected profile photo (optional)
  expectedProfilePhoto?: ExpectedProfilePhoto;
  
  // Metadata
  createdAt: string;
  expiresAt: number;             // Unix timestamp for DynamoDB TTL (15 min)
  completedAt: string | null;
  updatedAt: string;
}

/**
 * Helper to check if all documents uploaded
 */
export function allDocumentsUploaded(token: SubmissionToken): boolean {
  return token.expectedDocuments.every(doc => doc.uploaded);
}

/**
 * Helper to get missing documents
 */
export function getMissingDocuments(token: SubmissionToken): ExpectedDocument[] {
  return token.expectedDocuments.filter(doc => !doc.uploaded);
}

