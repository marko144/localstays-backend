/**
 * Type definitions for PublicListingMedia table
 * 
 * This table stores image metadata for published listings.
 * Populated atomically with PublicListings table during publish operation.
 * 
 * Images are stored in display order (0-based index), with imageIndex 0 being the cover image.
 */

/**
 * Public listing media record in DynamoDB
 * PK: LISTING_MEDIA_PUBLIC#<listingId>
 * SK: IMAGE#<imageIndex>
 */
export interface PublicListingMediaRecord {
  // Keys
  pk: string; // LISTING_MEDIA_PUBLIC#<listingId>
  sk: string; // IMAGE#<imageIndex> (0-based, padded to 2 digits: IMAGE#00, IMAGE#01, etc.)

  // IDs
  listingId: string;
  imageIndex: number; // 0-based (0 = cover image)

  // Public-facing URLs (CloudFront-served)
  url: string; // Full-size WebP URL
  thumbnailUrl: string; // Thumbnail WebP URL (400px)

  // Optional metadata
  caption?: string; // Short text description

  // Cover image flag
  isCoverImage: boolean; // true only for imageIndex = 0

  // Timestamps
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
}

/**
 * Helper function to build PK for public listing media
 */
export function buildPublicListingMediaPK(listingId: string): string {
  return `LISTING_MEDIA_PUBLIC#${listingId}`;
}

/**
 * Helper function to build SK for public listing media
 * Pads imageIndex to 2 digits for proper sorting (00, 01, 02, etc.)
 */
export function buildPublicListingMediaSK(imageIndex: number): string {
  return `IMAGE#${imageIndex.toString().padStart(2, '0')}`;
}




