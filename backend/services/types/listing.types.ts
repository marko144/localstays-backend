/**
 * Property Listing Types
 * 
 * Defines all types related to property listings including metadata,
 * images, amenities, verification documents, and API payloads.
 */

// ============================================================================
// ENUMS
// ============================================================================

export type PropertyType = 'APARTMENT' | 'HOUSE' | 'VILLA' | 'STUDIO' | 'ROOM';
export type CheckInType = 'SELF_CHECKIN' | 'HOST_GREETING' | 'LOCKBOX' | 'DOORMAN';
export type ParkingType = 'NO_PARKING' | 'FREE' | 'PAID';
export type VerificationDocType = 
  | 'PROOF_OF_OWNERSHIP' 
  | 'PROOF_OF_RIGHT_TO_LIST' 
  | 'PROOF_OF_ADDRESS' 
  | 'EXISTING_PROFILE_PROOF';

export type ListingStatus = 
  | 'DRAFT'           // Being created by host
  | 'IN_REVIEW'       // Submitted, waiting for admin approval
  | 'APPROVED'        // Approved by admin, not yet live
  | 'REJECTED'        // Rejected by admin
  | 'ONLINE'          // Live and bookable
  | 'OFFLINE'         // Temporarily deactivated by host
  | 'LOCKED'          // Admin locked due to violation
  | 'ARCHIVED';       // Permanently removed (soft deleted)

export type AmenityCategory = 
  | 'BASICS'
  | 'KITCHEN'
  | 'LAUNDRY'
  | 'ENTERTAINMENT'
  | 'OUTDOOR'
  | 'BUILDING'
  | 'FAMILY'
  | 'ACCESSIBILITY'
  | 'SAFETY'
  | 'WORK';

export type AmenityKey = 
  // Basics
  | 'WIFI'
  | 'AIR_CONDITIONING'
  | 'HEATING'
  | 'HOT_WATER'
  // Kitchen
  | 'KITCHEN'
  | 'REFRIGERATOR'
  | 'MICROWAVE'
  | 'OVEN'
  | 'STOVE'
  | 'DISHWASHER'
  | 'COFFEE_MAKER'
  // Laundry
  | 'WASHING_MACHINE'
  | 'DRYER'
  | 'IRON'
  // Entertainment
  | 'TV'
  | 'CABLE_TV'
  | 'STREAMING_SERVICES'
  // Comfort
  | 'BED_LINENS'
  | 'TOWELS'
  | 'TOILETRIES'
  | 'HAIR_DRYER'
  // Outdoor
  | 'BALCONY'
  | 'TERRACE'
  | 'GARDEN'
  | 'BBQ_GRILL'
  // Building
  | 'ELEVATOR'
  | 'PARKING'
  | 'DOORMAN'
  | 'GYM'
  | 'POOL'
  // Family
  | 'CRIB'
  | 'HIGH_CHAIR'
  | 'CHILD_FRIENDLY'
  // Accessibility
  | 'WHEELCHAIR_ACCESSIBLE'
  | 'STEP_FREE_ACCESS'
  // Safety
  | 'SMOKE_DETECTOR'
  | 'CARBON_MONOXIDE_DETECTOR'
  | 'FIRE_EXTINGUISHER'
  | 'FIRST_AID_KIT'
  // Work
  | 'WORKSPACE'
  | 'DESK'
  | 'OFFICE_CHAIR';

export type ImageUploadStatus = 'PENDING_UPLOAD' | 'ACTIVE';
export type DocumentReviewStatus = 'PENDING_UPLOAD' | 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED';

// ============================================================================
// BILINGUAL TYPES
// ============================================================================

export interface BilingualText {
  en: string;
  sr: string;
}

export interface BilingualEnum {
  key: string;
  en: string;
  sr: string;
}

// ============================================================================
// LISTING METADATA (DynamoDB Record)
// ============================================================================

export interface ListingMetadata {
  // Keys
  pk: string;                      // HOST#<hostId>
  sk: string;                      // LISTING_META#<listingId>
  
  // Identifiers
  listingId: string;
  hostId: string;
  
  // Basic Info
  listingName: string;
  propertyType: BilingualEnum & { isEntirePlace: boolean };
  status: ListingStatus;
  description: string;
  
  // Address (Mapbox format)
  address: {
    fullAddress: string;
    street: string;
    streetNumber: string;
    city: string;
    municipality?: string;
    postalCode: string;
    country: string;
    countryCode: string;
    coordinates: {
      latitude: number;
      longitude: number;
    };
    mapboxPlaceId?: string;
  };
  
  // Capacity
  capacity: {
    beds: number;
    sleeps: number;
  };
  
  // Pricing
  pricing: {
    pricePerNight: number;
    currency: string;
  };
  
  // Pets
  pets: {
    allowed: boolean;
    policy?: string;
  };
  
  // Check-in/out
  checkIn: {
    type: BilingualEnum;
    description?: string;
    checkInFrom: string;      // HH:MM format
    checkOutBy: string;       // HH:MM format
  };
  
  // Parking
  parking: {
    type: BilingualEnum;
    description?: string;
  };
  
  // S3 references
  s3Prefix: string;
  
  // Submission tracking
  submissionToken?: string;
  submissionTokenExpiresAt?: string;
  
  // Metadata
  isDeleted: boolean;
  deletedAt?: string;
  deletedBy?: string;           // hostId or adminId
  createdAt: string;
  updatedAt: string;
  submittedAt?: string;
  approvedAt?: string;
  rejectedAt?: string;
  rejectionReason?: string;
  
  // Admin lock (for LOCKED status)
  lockedAt?: string;
  lockedBy?: string;            // Admin user ID
  lockReason?: string;
  
  // GSI2: Query by status (admin review queue)
  gsi2pk?: string;              // LISTING_STATUS#<status>
  gsi2sk?: string;              // <timestamp>
  
  // GSI3: Query by location (future)
  gsi3pk?: string;              // LOCATION#<countryCode>#<city>
  gsi3sk?: string;              // LISTING_META#<listingId>
}

// ============================================================================
// LISTING IMAGE (DynamoDB Record)
// ============================================================================

export interface ListingImage {
  // Keys
  pk: string;                      // HOST#<hostId>
  sk: string;                      // LISTING_IMAGE#<listingId>#<imageId>
  
  // Identifiers
  listingId: string;
  imageId: string;
  
  // S3 references
  s3Key: string;
  s3Url?: string;
  
  // Image properties
  displayOrder: number;            // 1-15
  isPrimary: boolean;
  caption?: string;
  
  // File metadata
  contentType: string;
  fileSize: number;
  width?: number;
  height?: number;
  
  // Status
  status: ImageUploadStatus;
  
  // Metadata
  uploadedAt: string;
  isDeleted: boolean;
  deletedAt?: string;
}

// ============================================================================
// LISTING AMENITIES (DynamoDB Record)
// ============================================================================

export interface ListingAmenities {
  // Keys
  pk: string;                      // HOST#<hostId>
  sk: string;                      // LISTING_AMENITIES#<listingId>
  
  // Identifiers
  listingId: string;
  
  // Amenities with bilingual data
  amenities: Array<BilingualEnum & { category: AmenityCategory }>;
  
  // Metadata
  updatedAt: string;
  isDeleted: boolean;
}

// ============================================================================
// LISTING VERIFICATION DOCUMENT (DynamoDB Record)
// ============================================================================

export interface ListingVerificationDocument {
  // Keys
  pk: string;                      // HOST#<hostId>
  sk: string;                      // LISTING_DOC#<listingId>#<documentType>
  
  // Identifiers
  listingId: string;
  documentType: VerificationDocType;
  
  // S3 references
  s3Key: string;
  s3Url?: string;
  
  // File metadata
  contentType: string;
  fileSize: number;
  
  // Review status
  status: DocumentReviewStatus;
  reviewedAt?: string;
  reviewNotes?: string;
  
  // Metadata
  uploadedAt: string;
  isDeleted: boolean;
  deletedAt?: string;
}

// ============================================================================
// API REQUEST/RESPONSE TYPES
// ============================================================================

/**
 * Submit Intent Request
 */
export interface SubmitListingIntentRequest {
  listingName: string;
  propertyType: PropertyType;
  description: string;
  address: {
    fullAddress: string;
    street: string;
    streetNumber: string;
    city: string;
    municipality?: string;
    postalCode: string;
    country: string;
    countryCode: string;
    coordinates: {
      latitude: number;
      longitude: number;
    };
    mapboxPlaceId?: string;
  };
  capacity: {
    beds: number;
    sleeps: number;
  };
  pricing: {
    pricePerNight: number;
    currency: string;
  };
  pets: {
    allowed: boolean;
    policy?: string;
  };
  checkIn: {
    type: CheckInType;
    description?: string;
    checkInFrom: string;
    checkOutBy: string;
  };
  parking: {
    type: ParkingType;
    description?: string;
  };
  amenities: AmenityKey[];
  images: Array<{
    imageId: string;
    contentType: string;
    isPrimary: boolean;
    displayOrder: number;
    caption?: string;
  }>;
  verificationDocuments?: Array<{
    documentType: VerificationDocType;
    contentType: string;
  }>;
}

/**
 * Submit Intent Response
 */
export interface SubmitListingIntentResponse {
  listingId: string;
  submissionToken: string;
  expiresAt: string;
  imageUploadUrls: Array<{
    imageId: string;
    uploadUrl: string;
    expiresAt: string;
  }>;
  documentUploadUrls?: Array<{
    documentType: VerificationDocType;
    uploadUrl: string;
    expiresAt: string;
  }>;
}

/**
 * Confirm Submission Request
 */
export interface ConfirmListingSubmissionRequest {
  submissionToken: string;
  uploadedImages: string[];        // Array of imageIds
  uploadedDocuments?: VerificationDocType[];
}

/**
 * Confirm Submission Response
 */
export interface ConfirmListingSubmissionResponse {
  success: boolean;
  listingId: string;
  status: ListingStatus;
  submittedAt: string;
  message: string;
}

/**
 * Get Listing Response
 */
export interface GetListingResponse {
  listing: {
    listingId: string;
    hostId: string;
    listingName: string;
    propertyType: BilingualEnum & { isEntirePlace: boolean };
    status: ListingStatus;
    description: string;
    address: ListingMetadata['address'];
    capacity: ListingMetadata['capacity'];
    pricing: ListingMetadata['pricing'];
    pets: ListingMetadata['pets'];
    checkIn: {
      type: BilingualEnum;
      description?: string;
      checkInFrom: string;
      checkOutBy: string;
    };
    parking: {
      type: BilingualEnum;
      description?: string;
    };
    createdAt: string;
    updatedAt: string;
    submittedAt?: string;
    approvedAt?: string;
    rejectedAt?: string;
    rejectionReason?: string;
  };
  images: Array<{
    imageId: string;
    s3Url: string;
    displayOrder: number;
    isPrimary: boolean;
    caption?: string;
    contentType: string;
  }>;
  amenities: Array<BilingualEnum & { category: AmenityCategory }>;
  verificationDocuments?: Array<{
    documentType: VerificationDocType;
    status: DocumentReviewStatus;
    contentType: string;
    uploadedAt: string;
  }>;
}

/**
 * List Listings Response
 */
export interface ListListingsResponse {
  listings: Array<{
    listingId: string;
    listingName: string;
    propertyType: BilingualEnum;
    status: ListingStatus;
    pricing: {
      pricePerNight: number;
      currency: string;
    };
    address: {
      city: string;
      country: string;
    };
    primaryImage?: {
      imageId: string;
      s3Url: string;
    };
    createdAt: string;
    updatedAt: string;
  }>;
  total: number;
}

/**
 * Update Listing Request (for draft listings)
 */
export interface UpdateListingRequest {
  listingName?: string;
  description?: string;
  capacity?: {
    beds: number;
    sleeps: number;
  };
  pricing?: {
    pricePerNight: number;
    currency: string;
  };
  pets?: {
    allowed: boolean;
    policy?: string;
  };
  checkIn?: {
    type: CheckInType;
    description?: string;
    checkInFrom: string;
    checkOutBy: string;
  };
  parking?: {
    type: ParkingType;
    description?: string;
  };
  amenities?: AmenityKey[];
}

// ============================================================================
// METADATA API TYPES
// ============================================================================

export interface ListingMetadataResponse {
  propertyTypes: Array<BilingualEnum & { isEntirePlace: boolean; sortOrder: number }>;
  amenities: Array<BilingualEnum & { category: AmenityCategory; sortOrder: number }>;
  checkInTypes: Array<BilingualEnum & { sortOrder: number }>;
  parkingTypes: Array<BilingualEnum & { sortOrder: number }>;
  verificationDocumentTypes: Array<BilingualEnum & { 
    description: BilingualText;
    sortOrder: number;
  }>;
  listingStatuses: Array<BilingualEnum & { description: BilingualText }>;
  amenityCategories: Array<BilingualEnum & { sortOrder: number }>;
}







