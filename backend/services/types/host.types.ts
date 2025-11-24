/**
 * Host Entity Type Definitions
 * Polymorphic design: INDIVIDUAL vs BUSINESS hosts
 */

export type HostType = 'INDIVIDUAL' | 'BUSINESS';

export type HostStatus = 
  | 'NOT_SUBMITTED'   // Initial status - profile never submitted
  | 'INCOMPLETE'      // Profile started but not complete
  | 'VERIFICATION'    // Submitted, awaiting admin verification
  | 'VERIFIED'        // Verified and active
  | 'REJECTED'        // Rejected during verification
  | 'SUSPENDED';      // Suspended by admin

export type KycStatus = 
  | 'NOT_STARTED'
  | 'PENDING'
  | 'APPROVED'
  | 'REJECTED';

/**
 * Address structure (ISO-3166 compliant)
 */
export interface Address {
  addressLine1: string;
  addressLine2: string | null;
  locality: string;           // City
  administrativeArea: string; // State/Province
  postalCode: string;
  countryCode: string;        // ISO-3166-1 alpha-2 (e.g., "RS", "GB")
}

/**
 * KYC verification details
 */
export interface KycDetails {
  status: KycStatus;
  submittedAt: string | null;
  approvedAt: string | null;
  rejectedAt: string | null;
  rejectReason: string | null;
  approvedBy: string | null;  // Admin user sub
  rejectedBy: string | null;
  documentIds: string[];       // References to Document entities
  notes: string | null;
}

/**
 * Host statistics (denormalized for performance)
 */
export interface HostStats {
  totalListings: number;
  activeListings: number;
  totalBookings: number;
  averageRating: number;
}

/**
 * Submission tracking for profile completion
 */
export interface SubmissionTracking {
  currentToken: string | null;
  tokenExpiresAt: string | null;
  tokenCreatedAt: string | null;
  lastSubmissionAttempt: string | null;
  submissionCount: number;
}

/**
 * Profile photo details
 */
export interface ProfilePhoto {
  photoId: string;
  s3Key: string; // Original location (root): lstimg_{photoId}.jpg
  webpUrls?: {
    thumbnail: string; // {hostId}/profile/photo_thumbnail.webp
    full: string; // {hostId}/profile/photo_full.webp
  };
  dimensions?: {
    width: number;
    height: number;
  };
  contentType: string;
  fileSize: number;
  status: 'PENDING_UPLOAD' | 'PENDING_SCAN' | 'READY' | 'QUARANTINED';
  uploadedAt: string;
  updatedAt: string; // For CloudFront cache versioning
  isDeleted: boolean;
}

/**
 * Base Host entity (common fields)
 */
export interface BaseHost {
  pk: string;                  // HOST#<hostId>
  sk: 'META';
  hostId: string;
  hostType: HostType;
  status: HostStatus;
  ownerUserSub: string;        // Cognito sub of owner
  
  // S3 storage
  s3Prefix: string;            // e.g., "host_uuid/"
  
  // KYC
  kyc: KycDetails;
  
  // Contact information
  email: string;
  phone: string;
  preferredLanguage: string;   // BCP-47 (e.g., "sr-RS", "en-GB")
  countryCode: string;         // ISO-3166-1 alpha-2
  address: Address;
  
  // Submission tracking
  submission: SubmissionTracking;
  
  // Statistics
  stats: HostStats;
  
  // Profile photo (optional)
  profilePhoto?: ProfilePhoto;
  
  // GSI attributes
  gsi1pk?: string;             // For HostIdIndex
  gsi1sk?: string;
  gsi2pk?: string;             // For StatusIndex: "HOST#{status}"
  gsi2sk?: string;             // createdAt
  gsi4pk?: string;             // For CountryIndex: countryCode
  gsi4sk?: string;             // createdAt
  gsi6pk?: string;             // For EmailIndex: lowercase email
  gsi6sk?: string;             // "HOST#{hostId}"
  
  // Metadata
  isDeleted: boolean;
  deletedAt: string | null;
  deletedBy: string | null;
  createdAt: string;
  updatedAt: string;
  
  // Rejection tracking
  rejectionReason: string | null;  // Max 500 chars, set when status = REJECTED
  
  // Suspension tracking
  suspendedAt: string | null;
  suspendedBy: string | null;
  suspendedReason: string | null;  // Max 500 chars
}

/**
 * Individual host (person)
 */
export interface IndividualHost extends BaseHost {
  hostType: 'INDIVIDUAL';
  forename: string;
  surname: string;
  businessName?: never;
  legalName?: never;
  registrationNumber?: never;
  vatRegistered?: never;
  vatNumber?: never;
  displayName?: never;
}

/**
 * Business host (company)
 */
export interface BusinessHost extends BaseHost {
  hostType: 'BUSINESS';
  businessName: string | null;
  legalName: string;
  registrationNumber: string;
  vatRegistered: boolean;
  vatNumber: string | null;
  displayName: string | null;
  forename?: never;
  surname?: never;
}

/**
 * Union type for Host entities
 */
export type Host = IndividualHost | BusinessHost;

/**
 * Profile data for submission (before saving to DB)
 */
export interface IndividualProfileData {
  hostType: 'INDIVIDUAL';
  email: string;
  phone: string;
  preferredLanguage: string;
  countryCode: string;
  address: Address;
  forename: string;
  surname: string;
}

export interface BusinessProfileData {
  hostType: 'BUSINESS';
  email: string;
  phone: string;
  preferredLanguage: string;
  countryCode: string;
  address: Address;
  legalName: string;
  registrationNumber: string;
  vatRegistered: boolean;
  vatNumber?: string | null;
  displayName?: string | null;
}

export type ProfileData = IndividualProfileData | BusinessProfileData;

/**
 * Type guards
 */
export function isIndividualHost(host: Host): host is IndividualHost {
  return host.hostType === 'INDIVIDUAL';
}

export function isBusinessHost(host: Host): host is BusinessHost {
  return host.hostType === 'BUSINESS';
}

export function isIndividualProfile(profile: ProfileData): profile is IndividualProfileData {
  return profile.hostType === 'INDIVIDUAL';
}

export function isBusinessProfile(profile: ProfileData): profile is BusinessProfileData {
  return profile.hostType === 'BUSINESS';
}

