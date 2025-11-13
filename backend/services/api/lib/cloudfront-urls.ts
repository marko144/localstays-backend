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
 * @param s3Key - The S3 object key (e.g., "host_xxx/listings/listing_xxx/images/xxx-full.webp")
 * @param updatedAt - Optional timestamp for cache busting (ISO string or Date)
 * @returns CloudFront URL with optional versioning parameter
 */
export function buildCloudFrontUrl(
  s3Key: string | undefined | null,
  updatedAt?: string | Date
): string {
  if (!s3Key) return '';
  
  // Remove leading slash if present
  const cleanKey = s3Key.startsWith('/') ? s3Key.substring(1) : s3Key;
  
  // Build base CloudFront URL
  const baseUrl = `https://${CLOUDFRONT_DOMAIN}/${cleanKey}`;
  
  // Add version parameter for cache busting if updatedAt is provided
  if (updatedAt) {
    const timestamp = typeof updatedAt === 'string' 
      ? new Date(updatedAt).getTime() 
      : updatedAt.getTime();
    return `${baseUrl}?v=${timestamp}`;
  }
  
  return baseUrl;
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


