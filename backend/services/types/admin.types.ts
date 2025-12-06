/**
 * Admin API Types
 * 
 * Defines all request/response types for admin endpoints.
 */

import { Host } from './host.types';
import { ListingMetadata, ListingImage } from './listing.types';
import { Request } from './request.types';

// ============================================================================
// PAGINATION
// ============================================================================

export interface PaginationParams {
  page?: number;        // Default: 1
  limit?: number;       // Default: 20, Max: 20
}

export interface PaginationMeta {
  total: number;        // Total count of all items
  page: number;         // Current page (1-indexed)
  pageSize: number;     // Items per page
  totalPages: number;   // Total number of pages
}

export interface PaginatedResponse<T> {
  items: T[];
  pagination: PaginationMeta;
}

// ============================================================================
// HOST ADMIN TYPES
// ============================================================================

/**
 * Host headline data for list views
 */
export interface HostSummary {
  hostId: string;
  hostType: 'INDIVIDUAL' | 'BUSINESS';
  name: string;                    // Formatted name (forename + surname or legalName)
  email: string;
  countryCode: string;
  status: string;
  createdAt: string;
  submittedAt?: string;
}

/**
 * Full host details for admin review (same as Host from host.types.ts)
 */
export type AdminHostDetails = Host;

/**
 * KYC document for admin review
 */
export interface AdminKycDocument {
  documentId: string;
  documentType: string;
  fileName: string;
  contentType: string;
  fileSize: number;
  s3Url: string;                   // Pre-signed URL for download (15-min expiry)
  uploadedAt: string;
  status: string;
}

/**
 * Approve host request (no body)
 */
export interface ApproveHostRequest {}

/**
 * Reject host request
 */
export interface RejectHostRequest {
  rejectionReason: string;         // Max 500 chars, required
}

/**
 * Suspend host request
 */
export interface SuspendHostRequest {
  suspendedReason: string;         // Max 500 chars, required
}

/**
 * Reinstate host request (no body)
 */
export interface ReinstateHostRequest {}

// ============================================================================
// LISTING ADMIN TYPES
// ============================================================================

/**
 * Listing headline data for list views
 */
export interface ListingSummary {
  listingId: string;
  listingName: string;
  propertyType: {
    key: string;
    en: string;
    sr: string;
  };
  status: string;
  hostId: string;
  hostName: string;                // Formatted host name
  createdAt: string;
  submittedAt?: string;
  primaryImageUrl?: string;
}

/**
 * Full listing details for admin review
 */
export interface AdminListingDetails {
  listing: ListingMetadata;
  images: Array<{
    imageId: string;
    s3Url: string;                 // Pre-signed URL
    displayOrder: number;
    isPrimary: boolean;
    caption?: string;
    contentType: string;
  }>;
  amenities: Array<{
    key: string;
    en: string;
    sr: string;
    category: string;
  }>;
  verificationDocuments: Array<{
    documentType: string;
    fileName: string;
    contentType: string;
    fileSize: number;
    s3Url: string;                 // Pre-signed URL for download
    uploadedAt: string;
    status: string;
  }>;
  hasMapboxLocationData: boolean;  // true if address was entered via Mapbox autocomplete
}

/**
 * Approve listing request (no body)
 */
export interface ApproveListingRequest {}

/**
 * Reject listing request
 */
export interface RejectListingRequest {
  rejectionReason: string;         // Max 500 chars, required
}

/**
 * Suspend listing request
 */
export interface SuspendListingRequest {
  lockReason: string;              // Max 500 chars, required
}

// ============================================================================
// REQUEST ADMIN TYPES
// ============================================================================

/**
 * Request headline data for list views
 */
export interface RequestSummary {
  requestId: string;
  requestType: string;
  status: string;
  hostId: string;
  hostName: string;                // Formatted host name
  createdAt: string;
  uploadedAt?: string;
  listingId?: string;              // Present for listing-level requests
  listingName?: string;            // Listing name for listing-level requests
}

/**
 * Full request details for admin review
 */
export interface AdminRequestDetails extends Request {
  hostName: string;                // Formatted host name
  s3DownloadUrl: string;           // Pre-signed URL for video download
  imagesToAddDetails?: Array<ListingImage & { url: string; thumbnailUrl: string }>;  // For LISTING_IMAGE_UPDATE
  imagesToDeleteDetails?: Array<ListingImage & { url: string; thumbnailUrl: string }>; // For LISTING_IMAGE_UPDATE
}

/**
 * Approve request (no body)
 */
export interface ApproveRequestRequest {}

/**
 * Reject request
 */
export interface RejectRequestRequest {
  rejectionReason: string;         // Max 500 chars, required
}

// ============================================================================
// SEARCH
// ============================================================================

/**
 * Host search query params
 */
export interface HostSearchParams extends PaginationParams {
  q: string;                       // Search query (name or email)
}

// ============================================================================
// COMMON RESPONSE
// ============================================================================

/**
 * Standard success response
 */
export interface AdminSuccessResponse {
  success: true;
  message: string;
}

/**
 * Standard error response
 */
export interface AdminErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
  };
}

