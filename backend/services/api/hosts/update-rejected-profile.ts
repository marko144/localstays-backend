/**
 * Update Rejected Profile Lambda Handler
 * Allows hosts to resubmit their profile data after rejection
 * Documents are OPTIONAL - hosts can update profile data without re-uploading documents
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'crypto';

import { getAuthContext, assertCanAccessHost } from '../lib/auth';
import * as response from '../lib/response';
import { generateUploadUrl, validateS3Key } from '../lib/s3-presigned';
import { validateDocumentTypes, validateAllDocumentIntents } from '../lib/document-validation';
import { validateProfileData, sanitizeProfileData } from '../lib/profile-validation';
import { ProfileData } from '../../types/host.types';
import { DocumentUploadIntent, DocumentUploadUrl } from '../../types/document.types';
import { SubmissionToken } from '../../types/submission.types';

const client = new DynamoDBClient({ region: process.env.AWS_REGION });
const docClient = DynamoDBDocumentClient.from(client);

const TABLE_NAME = process.env.TABLE_NAME!;
const BUCKET_NAME = process.env.BUCKET_NAME!;
const SUBMISSION_EXPIRY_MINUTES = 15;
const UPLOAD_URL_EXPIRY_SECONDS = 600; // 10 minutes

interface UpdateRejectedProfileRequest {
  profile: ProfileData;
  documents?: DocumentUploadIntent[]; // Optional for rejected profile updates
}

/**
 * Main Lambda handler
 */
export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  console.log('Update rejected profile request:', {
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

    // 3. Parse and validate request body
    if (!event.body) {
      console.error('❌ Request body is missing');
      return response.badRequest('Request body is required');
    }

    let requestBody: UpdateRejectedProfileRequest;
    try {
      requestBody = JSON.parse(event.body);
    } catch (error) {
      console.error('❌ Invalid JSON in request body:', error);
      return response.badRequest('Invalid JSON in request body');
    }

    const { profile, documents = [] } = requestBody;

    if (!profile) {
      console.error('❌ Missing required field: profile');
      return response.badRequest('Profile data is required');
    }

    console.log('📝 Request parsed successfully:', {
      hostId,
      hostType: profile?.hostType,
      documentCount: documents?.length,
      hasDocuments: documents && documents.length > 0,
      documents: documents?.map(d => ({
        type: d.documentType,
        fileName: d.fileName,
        mimeType: d.mimeType,
        fileSize: d.fileSize,
      })),
    });

    // 4. Verify host exists and is in REJECTED status
    const hostRecord = await getHostRecord(hostId);
    
    if (!hostRecord) {
      console.error('❌ Host not found:', { hostId });
      return response.notFound('Host profile not found');
    }

    if (hostRecord.status !== 'REJECTED') {
      console.error('❌ Host profile is not in REJECTED status:', {
        hostId,
        currentStatus: hostRecord.status,
      });
      return response.badRequest(
        `Profile cannot be updated. Current status: ${hostRecord.status}. Only REJECTED profiles can be resubmitted.`
      );
    }

    console.log('✅ Host profile is REJECTED and can be updated:', {
      hostId,
      rejectedAt: hostRecord.rejectedAt,
      rejectionReason: hostRecord.rejectionReason,
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

    // 6. If documents are provided, validate them
    let documentValidationResult: { valid: boolean; missing: string[]; errors: string[] } | null = null;
    
    if (documents && documents.length > 0) {
      // Validate document intents
      const documentIntentValidation = validateAllDocumentIntents(documents);
      if (!documentIntentValidation.valid) {
        console.error('❌ Document intent validation failed:', {
          hostId,
          errorCount: documentIntentValidation.errors.length,
          errors: documentIntentValidation.errors,
        });
        return response.unprocessableEntity('Document validation failed', {
          errors: documentIntentValidation.errors,
        });
      }
      
      console.log('✅ Document intent validation passed:', {
        hostId,
        documentCount: documents.length,
      });

      // Validate document types match host type requirements
      const vatRegistered = profile.hostType === 'BUSINESS' ? profile.vatRegistered : false;
      documentValidationResult = validateDocumentTypes(
        profile.hostType,
        documents,
        vatRegistered
      );

      if (!documentValidationResult.valid) {
        console.error('❌ Document type validation failed:', {
          hostId,
          hostType: profile.hostType,
          vatRegistered,
          missingDocuments: documentValidationResult.missing,
          errors: documentValidationResult.errors,
        });
        return response.unprocessableEntity('Required documents missing', {
          missing: documentValidationResult.missing,
          errors: documentValidationResult.errors,
        });
      }
      
      console.log('✅ Document type validation passed:', {
        hostId,
        documentCount: documents.length,
      });
    } else {
      console.log('ℹ️ No documents provided - profile data only update:', { hostId });
    }

    // 7. Generate submission token
    const submissionToken = `tok_${randomUUID()}`;
    const now = new Date().toISOString();
    const expiresAt = Math.floor(Date.now() / 1000) + (SUBMISSION_EXPIRY_MINUTES * 60);

    // 8. Create document records if documents are provided
    const documentRecords = documents && documents.length > 0 
      ? documents.map((doc) => ({
          documentId: `doc_${randomUUID()}`,
          documentType: doc.documentType,
          fileName: doc.fileName,
          fileSize: doc.fileSize,
          mimeType: doc.mimeType,
        }))
      : [];

    if (documentRecords.length > 0) {
      await createDocumentRecords(hostId, auth.userId, documentRecords);
      console.log('✅ Created document records:', {
        hostId,
        count: documentRecords.length,
      });
    }

    // 9. Generate pre-signed upload URLs for new documents
    const uploadUrls: DocumentUploadUrl[] = await Promise.all(
      documentRecords.map(async (doc) => {
        const s3Key = `${hostId}/verification/${doc.documentId}_${doc.fileName}`;
        validateS3Key(s3Key);
        
        const uploadUrl = await generateUploadUrl(
          s3Key,
          doc.mimeType,
          UPLOAD_URL_EXPIRY_SECONDS
        );

        return {
          documentId: doc.documentId,
          documentType: doc.documentType,
          uploadUrl,
          expiresAt: new Date(Date.now() + UPLOAD_URL_EXPIRY_SECONDS * 1000).toISOString(),
        };
      })
    );

    // 10. Create submission token record
    await createSubmissionToken({
      submissionToken,
      hostId,
      userId: auth.userId,
      profileData: sanitizedProfile,
      documentRecords,
      expiresAt,
      createdAt: now,
    });

    console.log('✅ Created submission token:', {
      hostId,
      submissionToken,
      hasDocuments: documentRecords.length > 0,
    });

    // 11. Update host record with submission tracking
    await updateHostSubmissionTracking(hostId, submissionToken, now, expiresAt);

    console.log('✅ Updated host submission tracking:', { hostId });

    // 12. Return success response
    return response.success({
      success: true,
      hostId,
      submissionToken,
      expiresAt: new Date(expiresAt * 1000).toISOString(),
      uploadUrls,
      message: documentRecords.length > 0 
        ? 'Profile and documents ready for upload. Upload documents then call confirm-submission.'
        : 'Profile data updated. Call confirm-submission to finalize changes.',
    });

  } catch (error: any) {
    console.error('Update rejected profile error:', error);
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
      Key: { pk: `HOST#${hostId}`, sk: 'META' },
    })
  );
  return result.Item;
}

/**
 * Create document records in DynamoDB
 */
async function createDocumentRecords(
  hostId: string,
  userId: string,
  documentRecords: Array<{
    documentId: string;
    documentType: string;
    fileName: string;
    fileSize: number;
    mimeType: string;
  }>
) {
  const now = new Date().toISOString();

  for (const doc of documentRecords) {
    await docClient.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: {
          pk: `HOST#${hostId}`,
          sk: `DOCUMENT#${doc.documentId}`,
          documentId: doc.documentId,
          hostId,
          documentType: doc.documentType,
          fileName: doc.fileName,
          fileSize: doc.fileSize,
          mimeType: doc.mimeType,
          status: 'PENDING_UPLOAD',
          s3Key: `${hostId}/verification/${doc.documentId}_${doc.fileName}`,
          s3Bucket: BUCKET_NAME,
          uploadedBy: userId,
          uploadedAt: now,
          reviewedAt: null,
          reviewedBy: null,
          rejectionReason: null,
          notes: null,
          expiresAt: null,
          isDeleted: false,
          deletedAt: null,
          createdAt: now,
          updatedAt: now,
        },
      })
    );
  }
}

/**
 * Create submission token record
 */
async function createSubmissionToken(params: {
  submissionToken: string;
  hostId: string;
  userId: string;
  profileData: ProfileData;
  documentRecords: Array<{
    documentId: string;
    documentType: string;
    fileName: string;
    fileSize: number;
    mimeType: string;
  }>;
  expiresAt: number;
  createdAt: string;
}) {
  const { submissionToken, hostId, userId, profileData, documentRecords, expiresAt, createdAt } = params;

  const tokenRecord: SubmissionToken = {
    pk: `SUBMISSION#${submissionToken}`,
    sk: 'META',
    submissionToken,
    hostId,
    userId,
    status: 'PENDING_UPLOAD',
    profileData,
    expectedDocuments: documentRecords.map((doc) => ({
      documentId: doc.documentId,
      documentType: doc.documentType as any, // Type assertion for flexible document types
      uploaded: false,
    })),
    expiresAt,
    createdAt,
    updatedAt: createdAt,
    completedAt: null,
  };

  await docClient.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: tokenRecord,
    })
  );
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
  await docClient.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: {
        pk: `HOST#${hostId}`,
        sk: 'META',
      },
      UpdateExpression: 'SET submission.currentToken = :token, submission.lastSubmissionAttempt = :now, submission.tokenExpiresAt = :expires, updatedAt = :now',
      ExpressionAttributeValues: {
        ':token': submissionToken,
        ':now': createdAt,
        ':expires': expiresAt,
      },
    })
  );

  console.log(`Updated submission tracking for host ${hostId}`);
}

