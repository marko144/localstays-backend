/**
 * Submit Profile Intent Lambda Handler
 * Step 1 of profile submission: Validate data and generate upload URLs
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'crypto';

import { getAuthContext, assertCanAccessHost } from '../lib/auth';
import * as response from '../lib/response';
import { generateUploadUrl, validateS3Key } from '../lib/s3-presigned';
import { validateDocumentTypes, validateAllDocumentIntents } from '../lib/document-validation';
import { validateProfileData, sanitizeProfileData } from '../lib/profile-validation';
import { checkAndIncrementWriteOperationRateLimit, extractUserId } from '../lib/write-operation-rate-limiter';
import { ProfileData } from '../../types/host.types';
import { DocumentUploadIntent, DocumentUploadUrl, DocumentType, MAX_FILE_SIZE } from '../../types/document.types';
import { SubmissionToken } from '../../types/submission.types';

const client = new DynamoDBClient({ region: process.env.AWS_REGION });
const docClient = DynamoDBDocumentClient.from(client);

const TABLE_NAME = process.env.TABLE_NAME!;
const BUCKET_NAME = process.env.BUCKET_NAME!;
const SUBMISSION_EXPIRY_MINUTES = 15;
const UPLOAD_URL_EXPIRY_SECONDS = 600; // 10 minutes
const MAX_PROFILE_PHOTO_SIZE = 20 * 1024 * 1024; // 20MB
const ALLOWED_PROFILE_PHOTO_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];

interface ProfilePhotoIntent {
  photoId: string;
  contentType: string;
  fileSize: number;
}

interface SubmitIntentRequest {
  profile: ProfileData;
  documents: DocumentUploadIntent[];
  profilePhoto?: ProfilePhotoIntent;
}

/**
 * Main Lambda handler
 */
export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  console.log('Submit intent request:', {
    path: event.path,
    method: event.httpMethod,
    pathParameters: event.pathParameters,
  });

  try {
    // 1. Extract authentication context
    const auth = getAuthContext(event);
    const hostId = event.pathParameters?.hostId;

    if (!hostId) {
      return response.badRequest('hostId is required in path');
    }

    // 2. Verify authorization
    assertCanAccessHost(auth, hostId);

    // 3. Check rate limit
    const userId = extractUserId(event);
    if (!userId) {
      return response.unauthorized('User ID not found');
    }

    const rateLimitCheck = await checkAndIncrementWriteOperationRateLimit(userId, 'profile-submit-intent');
    if (!rateLimitCheck.allowed) {
      console.warn('Rate limit exceeded for profile submit-intent:', { userId, hostId });
      return response.tooManyRequests(rateLimitCheck.message || 'Rate limit exceeded');
    }

    console.log('Rate limit check passed:', {
      userId,
      hostId,
      hourlyRemaining: rateLimitCheck.hourlyRemaining,
      dailyRemaining: rateLimitCheck.dailyRemaining,
    });

    // 4. Parse and validate request body
    if (!event.body) {
      console.error('❌ Request body is missing');
      return response.badRequest('Request body is required');
    }

    let requestBody: SubmitIntentRequest;
    try {
      requestBody = JSON.parse(event.body);
    } catch (error) {
      console.error('❌ Invalid JSON in request body:', error);
      return response.badRequest('Invalid JSON in request body');
    }

    const { profile, documents, profilePhoto } = requestBody;

    if (!profile || !documents) {
      console.error('❌ Missing required fields:', {
        hasProfile: !!profile,
        hasDocuments: !!documents,
      });
      return response.badRequest('Both profile and documents are required');
    }

    console.log('📝 Request parsed successfully:', {
      hostId,
      hostType: profile?.hostType,
      documentCount: documents?.length,
      hasProfilePhoto: !!profilePhoto,
      documents: documents?.map(d => ({
        type: d.documentType,
        fileName: d.fileName,
        mimeType: d.mimeType,
        fileSize: d.fileSize,
      })),
    });

    // 5. Sanitize and validate profile data
    const sanitizedProfile = sanitizeProfileData(profile);
    const profileValidation = validateProfileData(sanitizedProfile);

    if (!profileValidation.valid) {
      console.error('❌ Profile validation failed:', {
        hostId,
        hostType: profile.hostType,
        errorCount: profileValidation.errors.length,
        errors: profileValidation.errors,
      });
      return response.unprocessableEntity('Profile validation failed', {
        errors: profileValidation.errors,
      });
    }
    
    console.log('✅ Profile validation passed:', {
      hostId,
      hostType: sanitizedProfile.hostType,
    });

    // 6. Validate document intents
    const documentValidation = validateAllDocumentIntents(documents);
    if (!documentValidation.valid) {
      console.error('❌ Document intent validation failed:', {
        hostId,
        errorCount: documentValidation.errors.length,
        errors: documentValidation.errors,
      });
      return response.unprocessableEntity('Document validation failed', {
        errors: documentValidation.errors,
      });
    }
    
    console.log('✅ Document intent validation passed:', {
      hostId,
      documentCount: documents.length,
    });

    // 7. Validate document types match host type requirements
    const vatRegistered = profile.hostType === 'BUSINESS' ? profile.vatRegistered : false;
    const documentTypeValidation = validateDocumentTypes(
      profile.hostType,
      documents,
      vatRegistered
    );

    if (!documentTypeValidation.valid) {
      console.error('❌ Document type validation failed:', {
        hostId,
        hostType: profile.hostType,
        vatRegistered,
        missingDocuments: documentTypeValidation.missing,
        errors: documentTypeValidation.errors,
      });
      return response.unprocessableEntity('Required documents missing', {
        missing: documentTypeValidation.missing,
        errors: documentTypeValidation.errors,
      });
    }
    
    console.log('✅ Document type validation passed:', {
      hostId,
      hostType: profile.hostType,
      documentTypes: documents.map(d => d.documentType),
    });

    // 6b. Validate profile photo (if provided)
    if (profilePhoto) {
      const photoValidation = validateProfilePhoto(profilePhoto);
      if (photoValidation) {
        console.error('❌ Profile photo validation failed:', {
          hostId,
          error: photoValidation,
        });
        return response.badRequest(photoValidation);
      }
      
      console.log('✅ Profile photo validation passed:', {
        hostId,
        photoId: profilePhoto.photoId,
        contentType: profilePhoto.contentType,
        fileSize: profilePhoto.fileSize,
      });
    }

    // 8. Fetch current host record to verify status
    const hostRecord = await getHostRecord(hostId);
    
    if (!hostRecord) {
      console.error('❌ Host record not found:', { hostId });
      return response.notFound(`Host ${hostId} not found`);
    }

    console.log('📋 Host record fetched:', {
      hostId,
      currentStatus: hostRecord.status,
      hostType: hostRecord.hostType,
    });

    // 9. Verify host status allows submission
    const allowedStatuses = ['NOT_SUBMITTED', 'INCOMPLETE', 'INFO_REQUIRED'];
    if (!allowedStatuses.includes(hostRecord.status)) {
      console.error('❌ Host status does not allow submission:', {
        hostId,
        currentStatus: hostRecord.status,
        allowedStatuses,
      });
      return response.conflict(
        `Cannot submit profile when status is ${hostRecord.status}. Allowed statuses: ${allowedStatuses.join(', ')}`
      );
    }

    // 8b. Clean up any previous incomplete submissions
    // If there's an active submission token, invalidate it
    if (hostRecord.submission?.currentToken) {
      console.log('⚠️  Found existing submission token, will invalidate:', {
        oldToken: hostRecord.submission.currentToken,
        tokenExpiresAt: hostRecord.submission.tokenExpiresAt,
      });
      // The old token will be overwritten when we update the host record
      // Old document records with PENDING_UPLOAD status will remain but won't be used
      // (They could be cleaned up by a TTL or background job in the future)
    }

    // 10. Generate submission token and document IDs
    const submissionToken = `sub_${randomUUID()}`;
    const now = new Date().toISOString();
    const expiresAt = Math.floor(Date.now() / 1000) + (SUBMISSION_EXPIRY_MINUTES * 60);

    // Generate document records (handle multi-file documents)
    const documentRecords: Array<{
      documentId: string;
      documentType: DocumentType;
      documentSide: 'FRONT' | 'BACK' | 'SINGLE';
      relatedDocumentId: string | null;
      fileName: string;
      fileSize: number;
      mimeType: string;
    }> = [];

    for (const doc of documents) {
      const requiresTwoSides = ['ID_CARD', 'DRIVERS_LICENSE'].includes(doc.documentType);
      
      if (requiresTwoSides && doc.frontFile && doc.backFile) {
        // Create TWO records with shared group ID
        const groupId = `doc_${randomUUID()}`;
        
        documentRecords.push({
          documentId: `${groupId}_FRONT`,
          documentType: doc.documentType,
          documentSide: 'FRONT',
          relatedDocumentId: `${groupId}_BACK`,
          fileName: doc.frontFile.fileName,
          fileSize: doc.frontFile.fileSize,
          mimeType: doc.frontFile.mimeType,
        });
        
        documentRecords.push({
          documentId: `${groupId}_BACK`,
          documentType: doc.documentType,
          documentSide: 'BACK',
          relatedDocumentId: `${groupId}_FRONT`,
          fileName: doc.backFile.fileName,
          fileSize: doc.backFile.fileSize,
          mimeType: doc.backFile.mimeType,
        });
      } else {
        // Single file document (no doc_ prefix needed - it's added in the S3 key template)
        documentRecords.push({
          documentId: randomUUID(),
          documentType: doc.documentType,
          documentSide: 'SINGLE',
          relatedDocumentId: null,
          fileName: doc.fileName!,
          fileSize: doc.fileSize!,
          mimeType: doc.mimeType!,
        });
      }
    }

    // 11. Create document records in DynamoDB
    await createDocumentRecords(hostId, auth.userId, documentRecords);

    // 12. Generate pre-signed upload URLs (upload to BUCKET ROOT with veri_ prefix)
    const uploadUrls: DocumentUploadUrl[] = await Promise.all(
      documentRecords.map(async (doc) => {
        // Add side prefix for front/back documents
        const sidePrefix = doc.documentSide === 'SINGLE' ? '' : `${doc.documentSide.toLowerCase()}_`;
        const s3Key = `veri_profile-doc_${doc.documentId}_${sidePrefix}${doc.fileName}`;
        validateS3Key(s3Key);
        
        // Generate pre-signed URL with S3 size enforcement
        const uploadUrl = await generateUploadUrl(
          s3Key,
          doc.mimeType,
          UPLOAD_URL_EXPIRY_SECONDS,
          {
            hostId,
            documentId: doc.documentId,
          },
          doc.fileSize,      // Exact size required by S3
          MAX_FILE_SIZE      // Maximum allowed size (20MB)
        );

        return {
          documentId: doc.documentId,
          documentType: doc.documentType,
          uploadUrl,
          expiresAt: new Date(Date.now() + UPLOAD_URL_EXPIRY_SECONDS * 1000).toISOString(),
        };
      })
    );

    // 11b. Handle profile photo (if provided)
    let profilePhotoUploadUrl: {
      photoId: string;
      uploadUrl: string;
      expiresAt: string;
    } | undefined;

    if (profilePhoto) {
      // Create profile photo record in DynamoDB
      await createProfilePhotoRecord(hostId, profilePhoto);

      // Generate pre-signed upload URL (upload to BUCKET ROOT with lstimg_ prefix)
      const photoExtension = getFileExtension(profilePhoto.contentType);
      const s3Key = `lstimg_${profilePhoto.photoId}.${photoExtension}`;
      validateS3Key(s3Key);

      // Generate pre-signed URL with S3 size enforcement
      const uploadUrl = await generateUploadUrl(
        s3Key,
        profilePhoto.contentType,
        UPLOAD_URL_EXPIRY_SECONDS,
        {
          hostId,
          photoId: profilePhoto.photoId,
          entityType: 'PROFILE_PHOTO',
        },
        profilePhoto.fileSize,      // Exact size required by S3
        MAX_PROFILE_PHOTO_SIZE      // Maximum allowed size (20MB)
      );

      profilePhotoUploadUrl = {
        photoId: profilePhoto.photoId,
        uploadUrl,
        expiresAt: new Date(Date.now() + UPLOAD_URL_EXPIRY_SECONDS * 1000).toISOString(),
      };

      console.log('✅ Generated profile photo upload URL:', {
        hostId,
        photoId: profilePhoto.photoId,
      });
    }

    // 13. Create submission token record
    await createSubmissionToken({
      submissionToken,
      hostId,
      userId: auth.userId,
      profileData: sanitizedProfile,
      documentRecords,
      profilePhoto: profilePhoto ? { photoId: profilePhoto.photoId, uploaded: false } : undefined,
      expiresAt,
      createdAt: now,
    });

    // 14. Update host record with submission tracking
    await updateHostSubmissionTracking(hostId, submissionToken, now, expiresAt);

    // 15. Return success response
    return response.success({
      success: true,
      hostId,
      submissionToken,
      expiresAt: new Date(expiresAt * 1000).toISOString(),
      uploadUrls,
      profilePhotoUploadUrl,
      requiredDocuments: documentTypeValidation.missing.length > 0 
        ? [] 
        : getRequiredDocumentsDisplay(profile.hostType, vatRegistered),
    });

  } catch (error: any) {
    console.error('Submit intent error:', error);
    return response.handleError(error);
  }
}

/**
 * Get host record from DynamoDB
 */
async function getHostRecord(hostId: string) {
  const result = await docClient.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: {
        pk: `HOST#${hostId}`,
        sk: 'META',
      },
    })
  );

  return result.Item as any;
}

/**
 * Create document records in DynamoDB (status: PENDING_UPLOAD)
 */
async function createDocumentRecords(
  hostId: string,
  userId: string,
  documents: Array<{
    documentId: string;
    documentType: string;
    documentSide: 'FRONT' | 'BACK' | 'SINGLE';
    relatedDocumentId: string | null;
    fileName: string;
    fileSize: number;
    mimeType: string;
  }>
) {
  const now = new Date().toISOString();
  const expiresAtTimestamp = Math.floor(Date.now() / 1000) + (24 * 60 * 60); // 24 hours from now

  for (const doc of documents) {
    // Add side prefix for front/back documents
    const sidePrefix = doc.documentSide === 'SINGLE' ? '' : `${doc.documentSide.toLowerCase()}_`;
    const s3Key = `veri_profile-doc_${doc.documentId}_${sidePrefix}${doc.fileName}`;
    const finalS3Key = `${hostId}/verification/${doc.documentId}_${sidePrefix}${doc.fileName}`;
    
    await docClient.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: {
          pk: `HOST#${hostId}`,
          sk: `DOCUMENT#${doc.documentId}`,
          documentId: doc.documentId,
          hostId,
          documentType: doc.documentType,
          documentSide: doc.documentSide,           // NEW
          relatedDocumentId: doc.relatedDocumentId, // NEW
          s3Key, // Root location with prefix
          finalS3Key, // Final destination after scan
          s3Bucket: BUCKET_NAME,
          fileName: doc.fileName,
          fileSize: doc.fileSize,
          mimeType: doc.mimeType,
          status: 'PENDING_UPLOAD',
          reviewedAt: null,
          reviewedBy: null,
          rejectionReason: null,
          notes: null,
          uploadedAt: now,
          uploadedBy: userId,
          expiresAt: expiresAtTimestamp, // TTL: Auto-delete after 24h if not confirmed
          isDeleted: false,
          deletedAt: null,
          createdAt: now,
          updatedAt: now,
        },
      })
    );
  }

  console.log(`Created ${documents.length} document records for host ${hostId} (expires in 24h if not confirmed)`);
}

/**
 * Create submission token record
 */
async function createSubmissionToken(params: {
  submissionToken: string;
  hostId: string;
  userId: string;
  profileData: ProfileData;
  documentRecords: Array<{ documentId: string; documentType: string }>;
  profilePhoto?: { photoId: string; uploaded: boolean };
  expiresAt: number;
  createdAt: string;
}) {
  const token: SubmissionToken = {
    pk: `SUBMISSION#${params.submissionToken}`,
    sk: 'META',
    submissionToken: params.submissionToken,
    hostId: params.hostId,
    userId: params.userId,
    status: 'PENDING_UPLOAD',
    profileData: params.profileData,
    expectedDocuments: params.documentRecords.map((doc) => ({
      documentId: doc.documentId,
      documentType: doc.documentType as DocumentType,
      uploaded: false,
    })),
    expectedProfilePhoto: params.profilePhoto,
    createdAt: params.createdAt,
    expiresAt: params.expiresAt,
    completedAt: null,
    updatedAt: params.createdAt,
  };

  await docClient.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: token,
    })
  );

  console.log(`Created submission token: ${params.submissionToken}`);
}

/**
 * Update host record with submission tracking
 */
async function updateHostSubmissionTracking(
  hostId: string,
  submissionToken: string,
  createdAt: string,
  expiresAt: number
) {
  // Note: In a production system, you'd want to use UpdateCommand with expressions
  // For simplicity, we're doing a Get + Put pattern here
  const hostRecord = await getHostRecord(hostId);
  
  if (!hostRecord) {
    throw new Error(`Host ${hostId} not found for submission tracking update`);
  }

  hostRecord.submission = {
    currentToken: submissionToken,
    tokenExpiresAt: new Date(expiresAt * 1000).toISOString(),
    tokenCreatedAt: createdAt,
    lastSubmissionAttempt: createdAt,
    submissionCount: (hostRecord.submission?.submissionCount || 0) + 1,
  };
  hostRecord.updatedAt = createdAt;

  await docClient.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: hostRecord,
    })
  );

  console.log(`Updated submission tracking for host ${hostId}`);
}

/**
 * Validate profile photo intent
 */
function validateProfilePhoto(photo: ProfilePhotoIntent): string | null {
  // Validate photoId is UUID format
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(photo.photoId)) {
    return 'photoId must be a valid UUID';
  }

  // Validate contentType is image
  if (!ALLOWED_PROFILE_PHOTO_TYPES.includes(photo.contentType.toLowerCase())) {
    return `contentType must be one of: ${ALLOWED_PROFILE_PHOTO_TYPES.join(', ')}`;
  }

  // Validate fileSize (max 20MB)
  if (!photo.fileSize || photo.fileSize <= 0) {
    return 'fileSize is required and must be greater than 0';
  }

  if (photo.fileSize > MAX_PROFILE_PHOTO_SIZE) {
    return `fileSize ${(photo.fileSize / 1024 / 1024).toFixed(2)}MB exceeds maximum allowed size of ${MAX_PROFILE_PHOTO_SIZE / 1024 / 1024}MB`;
  }

  return null; // Valid
}

/**
 * Create profile photo record in DynamoDB
 */
async function createProfilePhotoRecord(hostId: string, photo: ProfilePhotoIntent) {
  const now = new Date().toISOString();
  const expiresAtTimestamp = Math.floor(Date.now() / 1000) + (24 * 60 * 60); // 24 hours from now
  const photoExtension = getFileExtension(photo.contentType);
  const s3Key = `lstimg_${photo.photoId}.${photoExtension}`;

  await docClient.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        pk: `HOST#${hostId}`,
        sk: `PROFILE_PHOTO#${photo.photoId}`,
        
        hostId,
        photoId: photo.photoId,
        
        s3Key, // Root location: lstimg_{photoId}.jpg
        finalS3Prefix: `${hostId}/profile/`, // Final destination after processing
        
        contentType: photo.contentType,
        fileSize: photo.fileSize,
        
        status: 'PENDING_UPLOAD',
        expiresAt: expiresAtTimestamp, // TTL: Auto-delete after 24h if not confirmed
        
        uploadedAt: now,
        updatedAt: now, // For CloudFront cache versioning
        isDeleted: false,
      },
    })
  );

  console.log(`Created profile photo record for host ${hostId}, photoId ${photo.photoId} (expires in 24h if not confirmed)`);
}

/**
 * Get file extension from content type
 */
function getFileExtension(contentType: string): string {
  const map: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
  };
  return map[contentType.toLowerCase()] || 'jpg';
}

/**
 * Get display-friendly list of required documents
 */
function getRequiredDocumentsDisplay(hostType: string, vatRegistered: boolean): string[] {
  const docs: string[] = [];
  
  if (hostType === 'INDIVIDUAL') {
    docs.push('Government-issued ID (Passport, ID Card, or Driver\'s License)');
    docs.push('Proof of Address (optional)');
  } else if (hostType === 'BUSINESS') {
    docs.push('Government-issued ID of authorized person');
    docs.push('Business Registration');
    if (vatRegistered) {
      docs.push('VAT Certificate');
    }
  }
  
  return docs;
}

