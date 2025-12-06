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
export type PaymentType = 
  | 'PAY_LATER'
  | 'PAY_LATER_CASH_ONLY';
export type CancellationPolicyType = 
  | 'NO_CANCELLATION'
  | '24_HOURS'
  | '2_DAYS'
  | '3_DAYS'
  | '4_DAYS'
  | 'ONE_WEEK'
  | 'OTHER';
export type VerificationDocType = 
  | 'PROOF_OF_RIGHT_TO_LIST' 
  | 'EXISTING_PROFILE_PROOF';

export type AdvanceBookingType = 
  | 'DAYS_30'
  | 'DAYS_60'
  | 'DAYS_90'
  | 'DAYS_180'
  | 'DAYS_240'
  | 'DAYS_300'
  | 'DAYS_365';

export type MaxBookingDurationType =
  | 'NIGHTS_7'
  | 'NIGHTS_14'
  | 'NIGHTS_30'
  | 'NIGHTS_60'
  | 'NIGHTS_90';

export type ListingStatus = 
  | 'DRAFT'           // Being created by host
  | 'IN_REVIEW'       // Submitted, waiting for admin approval
  | 'REVIEWING'       // Admin is actively reviewing the listing
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

export type ImageUploadStatus = 
  | 'PENDING_UPLOAD'  // Waiting for upload to S3
  | 'UPLOADED'        // Uploaded to staging, awaiting scan
  | 'SCANNING'        // Being scanned by GuardDuty
  | 'READY'           // Processed and ready for display
  | 'QUARANTINED';    // Infected with malware
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
    apartmentNumber?: string;
    city: string;
    municipality?: string;
    postalCode: string;
    country: string;
    countryCode: string;
    coordinates?: {
      latitude: number;
      longitude: number;
    };
    mapboxPlaceId?: string;
    googleMapsLink?: string;
  };
  
  // Mapbox Location Metadata (optional, for internal use)
  mapboxMetadata?: {
    country?: {
      mapbox_id: string;
      name: string;
    };
    region?: {
      mapbox_id: string;
      name: string;
    };
    place?: {
      mapbox_id: string;
      name: string;
    };
    locality?: {
      mapbox_id: string;
      name: string;
    };
  };

  // Manual Location IDs (set by admin when host uses manual address entry)
  // Used as fallback when mapboxMetadata is not available
  manualLocationIds?: string[];  // Array of location IDs (PLACE and optionally LOCALITY)
  
  // Denormalized location ID for efficient querying (GSI8)
  // Derived from: mapboxMetadata.place.mapbox_id || manualLocationIds[0]
  locationId?: string;
  
  // Capacity
  capacity: {
    beds: number;
    bedrooms: number;
    bathrooms: number;
    sleeps: number;
  };
  
  // Pricing (Optional - can be set later via pricing endpoint)
  pricing?: {
    pricePerNight: number;
    currency: string;
  };
  
  // Pricing Configuration Flag
  hasPricing: boolean;              // True if detailed pricing has been configured
  
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
  
  // Payment Type
  paymentType: BilingualEnum;
  
  // Smoking Policy
  smokingAllowed: boolean;
  
  // Booking Terms
  advanceBooking: BilingualEnum & { days: number };        // How far in advance guests can book
  maxBookingDuration: BilingualEnum & { nights: number };  // Maximum nights per booking
  minBookingNights: number;                                 // Minimum nights per booking (1-6)
  
  // Cancellation Policy
  cancellationPolicy: {
    type: BilingualEnum;           // Selected preset (NO_CANCELLATION, 24_HOURS, etc.)
    customText?: string;           // Free text if type.key === 'OTHER'
  };
  
  // S3 references
  s3Prefix: string;
  
  // Verification Document Details
  rightToListDocumentNumber?: string;  // Optional document reference number (max 30 chars)
  officialStarRating?: number;         // Optional official star rating (1-5) from local authority
  
  // Submission tracking
  submissionToken?: string;
  submissionTokenExpiresAt?: string;
  
  // Verification flags
  listingVerified: boolean;     // True if admin explicitly verified the listing during approval
  
  // Internal admin flag for staged approval (not visible to hosts)
  // When true, listing is ready to be approved but waiting for bulk launch
  readyToApprove?: boolean;
  readyToApproveAt?: string;    // ISO timestamp when marked ready
  readyToApproveBy?: string;    // Admin email who marked it ready
  
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
  
  // Review tracking
  reviewStartedAt?: string;     // When admin started reviewing
  reviewedBy?: string;          // Admin email who is reviewing
  
  // Submission for review tracking (for subscription slot compensation)
  submittedForReviewAt?: string;   // ISO timestamp when host submitted for review (IN_REVIEW)
  firstReviewCompletedAt?: string; // ISO timestamp when admin first approved OR rejected (set once, never updated)
  reviewDurationDays?: number;     // Days in review (calculated at approval)
  
  // Advertising Slot Association (denormalized from AdvertisingSlots table for display)
  activeSlotId?: string;           // Current slot ID (if ONLINE)
  slotExpiresAt?: string;          // From slot.expiresAt
  slotDoNotRenew?: boolean;        // From slot.doNotRenew
  slotIsPastDue?: boolean;         // From slot.isPastDue
  
  // Admin lock (for LOCKED status)
  lockedAt?: string;
  lockedBy?: string;            // Admin user ID
  lockReason?: string;
  
  // GSI2: Query by status (admin review queue)
  gsi2pk?: string;              // LISTING_STATUS#<status>
  gsi2sk?: string;              // <timestamp>
  
  // GSI3: Direct lookup by listingId
  gsi3pk?: string;              // LISTING#<listingId>
  gsi3sk?: string;              // LISTING_META#<listingId>
  
  // GSI8: Query listings by location
  gsi8pk?: string;              // LOCATION#<locationId>
  gsi8sk?: string;              // LISTING#<listingId>
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
  
  // S3 references (original upload)
  s3Key: string;                   // Original file in staging/
  s3Url?: string;                  // Legacy field for backward compatibility
  
  // Image properties
  displayOrder: number;            // 1-15
  isPrimary: boolean;
  caption?: string;
  
  // File metadata (original)
  contentType: string;
  fileSize: number;
  width?: number;
  height?: number;
  
  // Status
  status: ImageUploadStatus;
  pendingApproval?: boolean;       // True for images awaiting admin approval (image update requests)
  
  // Processed images (WebP)
  processedAt?: string;            // When image processing completed
  webpUrls?: {
    full: string;                  // Full-size WebP (85% quality)
    thumbnail: string;             // 400px thumbnail WebP (85% quality)
  };
  dimensions?: {
    width: number;                 // Actual image dimensions
    height: number;
  };
  
  // Metadata
  uploadedAt: string;
  updatedAt: string;               // For CloudFront cache versioning
  isDeleted: boolean;
  deletedAt?: string;
}

// ============================================================================
// MALWARE DETECTION (DynamoDB Record)
// ============================================================================

export interface MalwareDetection {
  // Keys
  pk: string;                      // LISTING#<listingId>
  sk: string;                      // MALWARE#<timestamp>#<imageId>
  
  // Identifiers
  listingId: string;
  imageId: string;
  
  // Quarantine details
  s3Key: string;                   // Path to quarantined file
  detectedAt: string;              // ISO timestamp
  malwareNames: string[];          // Virus/malware signatures detected
  
  // Context
  hostId?: string;
  originalS3Key?: string;          // Original staging path
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
  amenities: Array<BilingualEnum & { category: AmenityCategory; isFilter: boolean }>;
  
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
    coordinates?: {
      latitude: number;
      longitude: number;
    };
    mapboxPlaceId?: string;
    googleMapsLink?: string;
  };
  mapboxMetadata?: {
    country?: {
      mapbox_id: string;
      name: string;
    };
    region?: {
      mapbox_id: string;
      name: string;
    };
    place?: {
      mapbox_id: string;
      name: string;
    };
    locality?: {
      mapbox_id: string;
      name: string;
    };
  };
  capacity: {
    beds: number;
    bedrooms: number;
    bathrooms: number;
    sleeps: number;
  };
  pricing?: {
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
  paymentType: PaymentType;
  smokingAllowed: boolean;
  advanceBooking: AdvanceBookingType;
  maxBookingDuration: MaxBookingDurationType;
  minBookingNights?: number;        // Minimum nights per booking (1-6), defaults to 1
  cancellationPolicy: {
    type: CancellationPolicyType;
    customText?: string;           // Required if type === 'OTHER'
  };
  amenities: AmenityKey[];
  images: Array<{
    imageId: string;
    contentType: string;
    fileSize: number;           // File size in bytes (enforced by S3)
    isPrimary: boolean;
    displayOrder: number;
    caption?: string;
  }>;
  rightToListDocumentNumber?: string;  // Optional document reference number (max 30 chars)
  officialStarRating?: number;         // Optional official star rating (1-5) from local authority
  verificationDocuments?: Array<{
    documentType: VerificationDocType;
    contentType: string;
    fileSize: number;           // File size in bytes (enforced by S3)
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
    mapboxMetadata?: ListingMetadata['mapboxMetadata'];
    capacity: ListingMetadata['capacity'];
    pricing?: ListingMetadata['pricing'];
    hasPricing: boolean;              // Flag indicating if detailed pricing has been configured
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
    paymentType: BilingualEnum;
    smokingAllowed: boolean;
    advanceBooking: BilingualEnum & { days: number };
    maxBookingDuration: BilingualEnum & { nights: number };
    minBookingNights: number;
    cancellationPolicy: {
      type: BilingualEnum;
      customText?: string;
    };
    createdAt: string;
    updatedAt: string;
    submittedAt?: string;
    approvedAt?: string;
    rejectedAt?: string;
    rejectionReason?: string;
    rightToListDocumentNumber?: string;
    officialStarRating?: number;
    // Slot info (quick access from listing metadata)
    activeSlotId?: string;
    slotExpiresAt?: string;
    slotDoNotRenew?: boolean;
  };
  images: Array<{
    imageId: string;
    thumbnailUrl: string;        // Thumbnail WebP (400px) for gallery
    fullUrl: string;             // Full-size WebP for detail view
    displayOrder: number;
    isPrimary: boolean;
    caption?: string;
    width: number;               // Image dimensions
    height: number;
  }>;
  amenities: Array<BilingualEnum & { category: AmenityCategory; isFilter: boolean }>;
  verificationDocuments?: Array<{
    documentType: VerificationDocType;
    status: DocumentReviewStatus;
    contentType: string;
    uploadedAt: string;
  }>;
  // Detailed slot information (for ONLINE/OFFLINE listings with active slots)
  slot?: {
    slotId: string;
    activatedAt: string;
    expiresAt: string;
    daysRemaining: number;
    doNotRenew: boolean;
    isPastDue: boolean;
    reviewCompensationDays: number;
    displayStatus: string;
    displayLabel: string;
    displayLabel_sr: string;
  };
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
    hasPricing: boolean;          // Flag indicating if detailed pricing has been configured
    address: {
      city: string;
      country: string;
    };
    primaryImage?: {
      imageId: string;
      thumbnailUrl: string;      // Thumbnail WebP for listing cards
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
    bedrooms: number;
    bathrooms: number;
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
  paymentType?: PaymentType;
  amenities?: AmenityKey[];
}

/**
 * Update Listing Metadata Request (for submitted/approved/rejected listings)
 * Allows partial updates - only send fields you want to update
 * Note: address can only be updated if listing status is REJECTED
 */
export interface UpdateListingMetadataRequest {
  updates: {
    listingName?: string;
    propertyType?: PropertyType;
    description?: string;
    address?: {
      fullAddress: string;
      street: string;
      streetNumber: string;
      apartmentNumber?: string;
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
      googleMapsLink?: string;
    };
    mapboxMetadata?: {
      country?: {
        mapbox_id: string;
        name: string;
      };
      region?: {
        mapbox_id: string;
        name: string;
      };
      place?: {
        mapbox_id: string;
        name: string;
      };
      locality?: {
        mapbox_id: string;
        name: string;
      };
    };
    capacity?: {
      beds: number;
      bedrooms: number;
      bathrooms: number;
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
    paymentType?: PaymentType;
    smokingAllowed?: boolean;
    advanceBooking?: AdvanceBookingType;
    maxBookingDuration?: MaxBookingDurationType;
    minBookingNights?: number;      // Minimum nights per booking (1-6)
    cancellationPolicy?: {
      type: CancellationPolicyType;
      customText?: string;
    };
    amenities?: AmenityKey[];
    rightToListDocumentNumber?: string;
  };
}

/**
 * Update Listing Metadata Response
 */
export interface UpdateListingMetadataResponse {
  listingId: string;
  updatedFields: string[];
  message: string;
}

// ============================================================================
// METADATA API TYPES
// ============================================================================

export interface ListingMetadataResponse {
  propertyTypes: Array<BilingualEnum & { isEntirePlace: boolean; sortOrder: number }>;
  amenities: Array<BilingualEnum & { category: AmenityCategory; sortOrder: number; isFilter: boolean }>;
  checkInTypes: Array<BilingualEnum & { sortOrder: number }>;
  parkingTypes: Array<BilingualEnum & { sortOrder: number }>;
  paymentTypes: Array<BilingualEnum & { sortOrder: number }>;
  advanceBookingOptions: Array<BilingualEnum & { days: number; sortOrder: number }>;
  maxBookingDurationOptions: Array<BilingualEnum & { nights: number; sortOrder: number }>;
  cancellationPolicyTypes: Array<BilingualEnum & { sortOrder: number }>;
  verificationDocumentTypes: Array<BilingualEnum & { 
    description: BilingualText;
    sortOrder: number;
  }>;
  listingStatuses: Array<BilingualEnum & { description: BilingualText }>;
  amenityCategories: Array<BilingualEnum & { sortOrder: number }>;
}







