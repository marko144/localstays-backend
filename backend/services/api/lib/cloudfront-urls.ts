/**
 * CloudFront URL Builder
 * 
 * This module provides utilities for building CloudFront URLs for images and profile photos.
 * It includes a feature flag (USE_CLOUDFRONT) to toggle between CloudFront URLs and presigned S3 URLs.
 */

const CLOUDFRONT_DOMAIN = process.env.CLOUDFRONT_DOMAIN || '';
const USE_CLOUDFRONT = process.env.USE_CLOUDFRONT === 'true';

/**
 * Build a CloudFront URL for a given S3 key
 * 
 * Note: Images are content-addressed by UUID and immutable. Each image has a unique
 * imageId that never changes. When an image needs to be updated, a new image with a
 * new imageId is created instead. Therefore, query string versioning is unnecessary
 * and has been removed for better caching and security.
 * 
 * @param s3Key - The S3 object key (e.g., "host_xxx/listings/listing_xxx/images/xxx-full.webp")
 * @param updatedAt - Deprecated parameter, kept for backward compatibility but ignored
 * @returns CloudFront URL without query string parameters
 */
export function buildCloudFrontUrl(
  s3Key: string | undefined | null,
  _updatedAt?: string | Date
): string {
  if (!s3Key) return '';
  
  // Remove leading slash if present
  const cleanKey = s3Key.startsWith('/') ? s3Key.substring(1) : s3Key;
  
  // Return CloudFront URL without query strings
  // Images are immutable and content-addressed by UUID, so no versioning needed
  return `https://${CLOUDFRONT_DOMAIN}/${cleanKey}`;
}

/**
 * Build URLs for listing images (thumbnail, medium, full)
 * @param webpUrls - Object containing S3 keys for different image sizes
 * @param updatedAt - Optional timestamp for cache busting
 * @returns Object with CloudFront or presigned URLs for each size
 */
export function buildListingImageUrls(
  webpUrls: { thumbnail?: string; medium?: string; full?: string } | undefined,
  updatedAt?: string | Date
): { thumbnailUrl: string; mediumUrl: string; fullUrl: string } {
  if (USE_CLOUDFRONT) {
    return {
      thumbnailUrl: buildCloudFrontUrl(webpUrls?.thumbnail, updatedAt),
      mediumUrl: buildCloudFrontUrl(webpUrls?.medium, updatedAt),
      fullUrl: buildCloudFrontUrl(webpUrls?.full, updatedAt),
    };
  } else {
    // Fallback to presigned URLs
    const { generateDownloadUrl } = require('./s3-presigned');
    return {
      thumbnailUrl: generateDownloadUrl(webpUrls?.thumbnail || ''),
      mediumUrl: generateDownloadUrl(webpUrls?.medium || ''),
      fullUrl: generateDownloadUrl(webpUrls?.full || ''),
    };
  }
}

/**
 * Build URLs for profile photos (thumbnail, medium, full)
 * @param webpUrls - Object containing S3 keys for different photo sizes
 * @param updatedAt - Optional timestamp for cache busting
 * @returns Object with CloudFront or presigned URLs for each size
 */
export function buildProfilePhotoUrls(
  webpUrls: { thumbnail?: string; medium?: string; full?: string } | undefined,
  updatedAt?: string | Date
): { thumbnailUrl: string; mediumUrl: string; fullUrl: string } {
  if (USE_CLOUDFRONT) {
    return {
      thumbnailUrl: buildCloudFrontUrl(webpUrls?.thumbnail, updatedAt),
      mediumUrl: buildCloudFrontUrl(webpUrls?.medium, updatedAt),
      fullUrl: buildCloudFrontUrl(webpUrls?.full, updatedAt),
    };
  } else {
    // Fallback to presigned URLs
    const { generateDownloadUrl } = require('./s3-presigned');
    return {
      thumbnailUrl: generateDownloadUrl(webpUrls?.thumbnail || ''),
      mediumUrl: generateDownloadUrl(webpUrls?.medium || ''),
      fullUrl: generateDownloadUrl(webpUrls?.full || ''),
    };
  }
}

/**
 * Build a single image URL (CloudFront or presigned based on feature flag)
 * @param s3Key - The S3 object key
 * @param updatedAt - Optional timestamp for cache busting
 * @returns CloudFront URL or presigned URL
 */
export function buildImageUrl(
  s3Key: string | undefined | null,
  updatedAt?: string | Date
): string {
  if (USE_CLOUDFRONT) {
    return buildCloudFrontUrl(s3Key, updatedAt);
  } else {
    const { generateDownloadUrl } = require('./s3-presigned');
    return generateDownloadUrl(s3Key || '');
  }
}


