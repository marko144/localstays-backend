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
import { ProfileData } from '../../types/host.types';
import { DocumentUploadIntent, DocumentUploadUrl } from '../../types/document.types';
import { SubmissionToken } from '../../types/submission.types';

const client = new DynamoDBClient({ region: process.env.AWS_REGION });
const docClient = DynamoDBDocumentClient.from(client);

const TABLE_NAME = process.env.TABLE_NAME!;
const BUCKET_NAME = process.env.BUCKET_NAME!;
const SUBMISSION_EXPIRY_MINUTES = 15;
const UPLOAD_URL_EXPIRY_SECONDS = 600; // 10 minutes

interface SubmitIntentRequest {
  profile: ProfileData;
  documents: DocumentUploadIntent[];
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

    // 3. Parse and validate request body
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

    const { profile, documents } = requestBody;

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
      documents: documents?.map(d => ({
        type: d.documentType,
        fileName: d.fileName,
        mimeType: d.mimeType,
        fileSize: d.fileSize,
      })),
    });

    // 4. Sanitize and validate profile data
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

    // 5. Validate document intents
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

    // 6. Validate document types match host type requirements
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

    // 7. Fetch current host record to verify status
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

    // 8. Verify host status allows submission
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

    // 9. Generate submission token and document IDs
    const submissionToken = `sub_${randomUUID()}`;
    const now = new Date().toISOString();
    const expiresAt = Math.floor(Date.now() / 1000) + (SUBMISSION_EXPIRY_MINUTES * 60);

    const documentRecords = documents.map((doc) => ({
      documentId: `doc_${randomUUID()}`,
      documentType: doc.documentType,
      fileName: doc.fileName,
      fileSize: doc.fileSize,
      mimeType: doc.mimeType,
    }));

    // 10. Create document records in DynamoDB
    await createDocumentRecords(hostId, auth.userId, documentRecords);

    // 11. Generate pre-signed upload URLs
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

    // 12. Create submission token record
    await createSubmissionToken({
      submissionToken,
      hostId,
      userId: auth.userId,
      profileData: sanitizedProfile,
      documentRecords,
      expiresAt,
      createdAt: now,
    });

    // 13. Update host record with submission tracking
    await updateHostSubmissionTracking(hostId, submissionToken, now, expiresAt);

    // 14. Return success response
    return response.success({
      success: true,
      hostId,
      submissionToken,
      expiresAt: new Date(expiresAt * 1000).toISOString(),
      uploadUrls,
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
    fileName: string;
    fileSize: number;
    mimeType: string;
  }>
) {
  const now = new Date().toISOString();

  for (const doc of documents) {
    const s3Key = `${hostId}/verification/${doc.documentId}_${doc.fileName}`;
    
    await docClient.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: {
          pk: `HOST#${hostId}`,
          sk: `DOCUMENT#${doc.documentId}`,
          documentId: doc.documentId,
          hostId,
          documentType: doc.documentType,
          s3Key,
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
          expiresAt: null,
          isDeleted: false,
          deletedAt: null,
          createdAt: now,
          updatedAt: now,
          // GSI3 for DocumentStatusIndex
          gsi3pk: `DOCUMENT_STATUS#PENDING_UPLOAD`,
          gsi3sk: now,
        },
      })
    );
  }

  console.log(`Created ${documents.length} document records for host ${hostId}`);
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
      documentType: doc.documentType,
      uploaded: false,
    })),
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
 * Get display-friendly list of required documents
 */
function getRequiredDocumentsDisplay(hostType: string, vatRegistered: boolean): string[] {
  const docs: string[] = [];
  
  if (hostType === 'INDIVIDUAL') {
    docs.push('Government-issued ID (Passport, ID Card, or Driver\'s License)');
    docs.push('Proof of Address');
  } else if (hostType === 'BUSINESS') {
    docs.push('Government-issued ID of authorized person');
    docs.push('Business Registration');
    docs.push('Proof of Address');
    if (vatRegistered) {
      docs.push('VAT Certificate');
    }
  }
  
  return docs;
}

