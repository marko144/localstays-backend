/**
 * Legal Document Types
 * 
 * Types for managing Terms of Service and Privacy Policy documents,
 * including versioning and acceptance tracking.
 * 
 * Schema: Single record per version containing BOTH language versions (en + sr)
 */

// ========================================
// Document Types
// ========================================

export type LegalDocumentType = 'tos' | 'privacy';
export type LegalDocumentLanguage = 'en' | 'sr';

export const SUPPORTED_LANGUAGES: LegalDocumentLanguage[] = ['en', 'sr'];
export const DEFAULT_LANGUAGE: LegalDocumentLanguage = 'en';

/**
 * Content for a single language version
 */
export interface LegalDocumentContent {
  s3Key: string;                 // e.g., "legal/tos/en/v1.0.html"
  sha256Hash: string;            // Hash of document content for integrity
}

/**
 * Legal document record stored in legal-documents table
 * 
 * Key structure:
 * - PK: DOCUMENT#<documentType>  (e.g., DOCUMENT#tos)
 * - SK: VERSION#<version>        (e.g., VERSION#1.0)
 * 
 * Each record contains BOTH English and Serbian versions
 */
export interface LegalDocument {
  pk: string;                    // DOCUMENT#<documentType>
  sk: string;                    // VERSION#<version>
  
  documentType: LegalDocumentType;
  version: string;               // Semantic version: "0.1", "1.0", "2.0"
  
  // Content for each language
  content: {
    en: LegalDocumentContent;
    sr: LegalDocumentContent;
  };
  
  // Metadata
  uploadedAt: string;            // ISO timestamp
  uploadedBy: string;            // Admin user ID who uploaded
  
  // Status
  isLatest: boolean;             // true for current active version
  
  // GSI1 attributes (only set when isLatest=true)
  gsi1pk?: string;               // LATEST#<documentType>
  gsi1sk?: string;               // DOCUMENT
}

/**
 * Response for document list/get operations
 */
export interface LegalDocumentResponse {
  documentType: LegalDocumentType;
  version: string;
  content: {
    en: {
      s3Key: string;
      cloudFrontUrl: string;
      sha256Hash: string;
    };
    sr: {
      s3Key: string;
      cloudFrontUrl: string;
      sha256Hash: string;
    };
  };
  latestUrls: {
    en: string;
    sr: string;
  };
  uploadedAt: string;
  uploadedBy: string;
  isLatest: boolean;
}

// ========================================
// Acceptance Types
// ========================================

/**
 * Audit data captured during acceptance
 */
export interface AcceptanceAuditData {
  // Network
  ipAddress: string | null;      // X-Forwarded-For (null at signup due to Cognito limitation)
  
  // Browser/device info
  userAgent: string;             // Full User-Agent string
  browserName: string;           // Parsed: Chrome, Safari, Firefox, Edge, etc.
  browserVersion: string;        // e.g., "120.0.0"
  osName: string;                // Windows, macOS, iOS, Android, Linux
  osVersion: string;             // e.g., "14.2"
  deviceType: string;            // desktop, mobile, tablet
  
  // Locale
  acceptLanguage: string;        // Accept-Language header or navigator.language
}

/**
 * Legal acceptance record stored in legal-acceptances table
 */
export interface LegalAcceptance {
  pk: string;                    // HOST#<hostId>
  sk: string;                    // ACCEPTANCE#<documentType>#<version>#<timestamp>
  
  // Entity info
  hostId: string;
  acceptedByUserSub: string;     // Cognito sub of user who accepted
  
  // Document info
  documentType: LegalDocumentType;
  documentVersion: string;
  documentHash: string;          // Hash at time of acceptance (English version used as canonical)
  
  // Timestamp
  acceptedAt: string;            // ISO timestamp
  
  // Audit data
  ipAddress: string | null;
  userAgent: string;
  browserName: string;
  browserVersion: string;
  osName: string;
  osVersion: string;
  deviceType: string;
  acceptLanguage: string;
  
  // Source of acceptance
  acceptanceSource: 'signup' | 'api';  // Where acceptance was recorded
  
  // GSI1 attributes
  gsi1pk: string;                // DOCUMENT#<documentType>#<version>
  gsi1sk: string;                // ACCEPTED#<timestamp>
}

// ========================================
// API Request/Response Types
// ========================================

/**
 * Request to upload a new document version (Admin API)
 * Both English and Serbian content are required
 */
export interface UploadLegalDocumentRequest {
  documentType: LegalDocumentType;
  version: string;               // e.g., "1.0"
  contentEn: string;             // Base64 encoded HTML content (English)
  contentSr: string;             // Base64 encoded HTML content (Serbian)
}

/**
 * Response after uploading a document
 */
export interface UploadLegalDocumentResponse {
  documentType: LegalDocumentType;
  version: string;
  content: {
    en: {
      s3Key: string;
      cloudFrontUrl: string;
      sha256Hash: string;
    };
    sr: {
      s3Key: string;
      cloudFrontUrl: string;
      sha256Hash: string;
    };
  };
  latestUrls: {
    en: string;
    sr: string;
  };
  uploadedAt: string;
  isLatest: boolean;
}

/**
 * Request to get legal status (Host API)
 */
export interface GetLegalStatusRequest {
  hostId: string;
}

/**
 * Response for legal status check
 */
export interface LegalStatusResponse {
  tos: {
    currentVersion: string | null;     // null if no ToS uploaded yet
    urls: {
      en: { versioned: string | null; latest: string | null };
      sr: { versioned: string | null; latest: string | null };
    };
    hostAcceptedVersion: string | null;
    hostAcceptedAt: string | null;
    needsAcceptance: boolean;
  };
  privacy: {
    currentVersion: string | null;
    urls: {
      en: { versioned: string | null; latest: string | null };
      sr: { versioned: string | null; latest: string | null };
    };
    hostAcceptedVersion: string | null;
    hostAcceptedAt: string | null;
    needsAcceptance: boolean;
  };
}

/**
 * Request to accept legal documents (Host API)
 */
export interface AcceptLegalDocumentsRequest {
  acceptTos?: boolean;
  tosVersion?: string;           // Version being accepted
  acceptPrivacy?: boolean;
  privacyVersion?: string;       // Version being accepted
}

/**
 * Response after accepting documents
 */
export interface AcceptLegalDocumentsResponse {
  success: boolean;
  accepted: {
    tos?: {
      version: string;
      acceptedAt: string;
    };
    privacy?: {
      version: string;
      acceptedAt: string;
    };
  };
}

/**
 * Query parameters for listing acceptances (Admin API)
 */
export interface ListAcceptancesQuery {
  hostId?: string;               // Filter by specific host
  documentType?: LegalDocumentType;
  documentVersion?: string;
  startDate?: string;            // ISO date
  endDate?: string;              // ISO date
  limit?: number;
  nextToken?: string;
}

/**
 * Response for listing acceptances
 */
export interface ListAcceptancesResponse {
  items: Array<{
    hostId: string;
    acceptedByUserSub: string;
    documentType: LegalDocumentType;
    documentVersion: string;
    acceptedAt: string;
    ipAddress: string | null;
    userAgent: string;
    acceptanceSource: 'signup' | 'api';
  }>;
  nextToken?: string;
  total?: number;
}

// ========================================
// Helper Functions
// ========================================

export function buildLegalDocumentPK(documentType: LegalDocumentType): string {
  return `DOCUMENT#${documentType}`;
}

export function buildLegalDocumentSK(version: string): string {
  return `VERSION#${version}`;
}

export function buildLatestDocumentGSI1PK(documentType: LegalDocumentType): string {
  return `LATEST#${documentType}`;
}

/**
 * Check if a language code is valid
 */
export function isValidLanguage(lang: string): lang is LegalDocumentLanguage {
  return SUPPORTED_LANGUAGES.includes(lang as LegalDocumentLanguage);
}

export function buildAcceptancePK(hostId: string): string {
  return `HOST#${hostId}`;
}

export function buildAcceptanceSK(
  documentType: LegalDocumentType,
  version: string,
  timestamp: string
): string {
  return `ACCEPTANCE#${documentType}#${version}#${timestamp}`;
}

export function buildAcceptanceGSI1PK(
  documentType: LegalDocumentType,
  version: string
): string {
  return `DOCUMENT#${documentType}#${version}`;
}

export function buildAcceptanceGSI1SK(timestamp: string): string {
  return `ACCEPTED#${timestamp}`;
}
