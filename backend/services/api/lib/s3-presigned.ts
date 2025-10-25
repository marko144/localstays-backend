/**
 * S3 Pre-signed URL Generation
 * Secure temporary URLs for client-side uploads
 */

import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const s3Client = new S3Client({ region: process.env.AWS_REGION || 'eu-north-1' });
const BUCKET_NAME = process.env.BUCKET_NAME!;

/**
 * Generate pre-signed URL for uploading a file
 * 
 * @param key - S3 object key
 * @param contentType - MIME type of the file
 * @param expiresIn - URL expiration time in seconds (default: 600 = 10 minutes)
 * @returns Pre-signed upload URL
 */
export async function generateUploadUrl(
  key: string,
  contentType: string,
  expiresIn: number = 600
): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
    ContentType: contentType,
    // Note: ServerSideEncryption is NOT included here because it would require
    // the frontend to send the x-amz-server-side-encryption header.
    // The bucket has default encryption enabled, so objects will still be encrypted.
  });
  
  const uploadUrl = await getSignedUrl(s3Client, command, { expiresIn });
  
  console.log('Generated upload URL:', {
    key,
    contentType,
    expiresIn,
    bucket: BUCKET_NAME,
  });
  
  return uploadUrl;
}

/**
 * Generate pre-signed URL for downloading a file
 * 
 * @param key - S3 object key
 * @param expiresIn - URL expiration time in seconds (default: 300 = 5 minutes)
 * @returns Pre-signed download URL
 */
export async function generateDownloadUrl(
  key: string,
  expiresIn: number = 300
): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
  });
  
  const downloadUrl = await getSignedUrl(s3Client, command, { expiresIn });
  
  console.log('Generated download URL:', {
    key,
    expiresIn,
    bucket: BUCKET_NAME,
  });
  
  return downloadUrl;
}

/**
 * Check if an object exists in S3
 * 
 * @param key - S3 object key
 * @returns true if object exists, false otherwise
 */
export async function objectExists(key: string): Promise<boolean> {
  try {
    await s3Client.send(new HeadObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
    }));
    return true;
  } catch (error: any) {
    if (error.name === 'NotFound' || error.name === 'NoSuchKey') {
      return false;
    }
    // Re-throw other errors (permissions, network, etc.)
    throw error;
  }
}

/**
 * Get object metadata (size, content type, etc.)
 * 
 * @param key - S3 object key
 * @returns Object metadata or null if not found
 */
export async function getObjectMetadata(key: string): Promise<{
  size: number;
  contentType: string;
  lastModified: Date;
} | null> {
  try {
    const response = await s3Client.send(new HeadObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
    }));
    
    return {
      size: response.ContentLength || 0,
      contentType: response.ContentType || 'application/octet-stream',
      lastModified: response.LastModified || new Date(),
    };
  } catch (error: any) {
    if (error.name === 'NotFound' || error.name === 'NoSuchKey') {
      return null;
    }
    throw error;
  }
}

/**
 * Validate S3 key format (prevent directory traversal)
 * 
 * @param key - S3 object key to validate
 * @throws Error if key contains invalid patterns
 */
export function validateS3Key(key: string): void {
  // Prevent directory traversal
  if (key.includes('..')) {
    throw new Error('VALIDATION_ERROR: S3 key cannot contain ".."');
  }
  
  // Prevent absolute paths
  if (key.startsWith('/')) {
    throw new Error('VALIDATION_ERROR: S3 key cannot start with "/"');
  }
  
  // Prevent empty segments
  if (key.includes('//')) {
    throw new Error('VALIDATION_ERROR: S3 key cannot contain empty segments');
  }
  
  // Basic length check
  if (key.length === 0 || key.length > 1024) {
    throw new Error('VALIDATION_ERROR: S3 key length must be between 1 and 1024 characters');
  }
}

