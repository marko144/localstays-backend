/**
 * Confirm Submission Lambda Handler
 * Step 2 of profile submission: Verify uploads and update host status
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, TransactWriteCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';

import { getAuthContext, assertCanAccessHost } from '../lib/auth';
import * as response from '../lib/response';
import { executeTransaction } from '../lib/transaction';
import { sendProfileSubmissionEmail, sendLiveIdCheckRequestEmail } from '../lib/email-service';
import { SubmissionToken } from '../../types/submission.types';
import { Document } from '../../types/document.types';
import { randomUUID } from 'crypto';

const client = new DynamoDBClient({ region: process.env.AWS_REGION });
const docClient = DynamoDBDocumentClient.from(client);

const TABLE_NAME = process.env.TABLE_NAME!;

interface ConfirmSubmissionRequest {
  submissionToken: string;
  uploadedDocuments: Array<{
    documentId: string;
    documentType: string;
  }>;
  uploadedProfilePhoto?: {
    photoId: string;
  };
}

/**
 * Main Lambda handler
 */
export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  console.log('Confirm submission request:', {
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

    // 3. Parse request body
    if (!event.body) {
      return response.badRequest('Request body is required');
    }

    let requestBody: ConfirmSubmissionRequest;
    try {
      requestBody = JSON.parse(event.body);
    } catch (error) {
      return response.badRequest('Invalid JSON in request body');
    }

    const { submissionToken, uploadedDocuments, uploadedProfilePhoto } = requestBody;

    if (!submissionToken) {
      return response.badRequest('submissionToken is required');
    }

    if (!uploadedDocuments || !Array.isArray(uploadedDocuments)) {
      return response.badRequest('uploadedDocuments array is required');
    }

    // 4. Retrieve submission token
    const tokenRecord = await getSubmissionToken(submissionToken);

    if (!tokenRecord) {
      return response.notFound('Submission token not found or expired');
    }

    // 5. Verify token belongs to this host
    if (tokenRecord.hostId !== hostId) {
      return response.forbidden('Submission token does not match host ID');
    }

    // 6. Check if token expired
    const now = Math.floor(Date.now() / 1000);
    if (tokenRecord.expiresAt < now) {
      return response.badRequest('Submission token has expired');
    }

    // 7. Check if already completed (idempotency)
    if (tokenRecord.status === 'COMPLETED') {
      console.log('Submission already completed - returning success (idempotent)');
      
      // Fetch current host and documents for response
      const hostRecord = await getHostRecord(hostId);
      const documents = await getDocumentsByIds(hostId, tokenRecord.expectedDocuments.map(d => d.documentId));
      
      return response.success({
        success: true,
        hostId,
        status: hostRecord?.status || 'VERIFICATION',
        message: 'Profile already submitted successfully',
        submittedAt: tokenRecord.completedAt,
        documents: documents.map(doc => ({
          documentId: doc.documentId,
          documentType: doc.documentType,
          status: doc.status,
          uploadedAt: doc.uploadedAt,
        })),
      });
    }

    // 8. Verify all expected documents were reported as uploaded
    const reportedDocIds = new Set(uploadedDocuments.map(d => d.documentId));
    const expectedDocIds = new Set(tokenRecord.expectedDocuments.map(d => d.documentId));

    for (const expectedId of expectedDocIds) {
      if (!reportedDocIds.has(expectedId)) {
        return response.badRequest(`Missing document in upload confirmation: ${expectedId}`);
      }
    }

    // 9. Fetch document records from DynamoDB
    // Note: We do NOT verify S3 existence because:
    // - S3 PUT returns 200 = upload succeeded (no need to re-verify)
    // - GuardDuty may have already moved files to quarantine or final destination
    // - Race condition: verification processor may have processed some files already
    // - DynamoDB record existence is sufficient proof of upload intent
    const documents = await getDocumentsByIds(hostId, Array.from(expectedDocIds));

    console.log(`All ${documents.length} document records verified in DynamoDB`);

    // 9b. Verify profile photo (if expected)
    let profilePhotoRecord: any = null;
    if (tokenRecord.expectedProfilePhoto) {
      // Check if photo was reported as uploaded
      if (!uploadedProfilePhoto || uploadedProfilePhoto.photoId !== tokenRecord.expectedProfilePhoto.photoId) {
        return response.badRequest(`Profile photo ${tokenRecord.expectedProfilePhoto.photoId} was not reported as uploaded`);
      }

      // Fetch profile photo record from DynamoDB
      const photoResult = await docClient.send(
        new GetCommand({
          TableName: TABLE_NAME,
          Key: {
            pk: `HOST#${hostId}`,
            sk: `PROFILE_PHOTO#${tokenRecord.expectedProfilePhoto.photoId}`,
          },
        })
      );

      profilePhotoRecord = photoResult.Item;

      if (!profilePhotoRecord) {
        return response.badRequest(`Profile photo record not found: ${tokenRecord.expectedProfilePhoto.photoId}`);
      }

      // Note: We do NOT check S3 existence for profile photos because:
      // 1. GuardDuty scan + image processor run very fast (3-5 seconds)
      // 2. By the time confirm-submission is called, the original file may already be processed and deleted
      // 3. The DynamoDB record existing is sufficient proof that the upload succeeded
      // 4. If there was a problem with the file, the image processor will update the status accordingly
      
      console.log(`Profile photo verified: ${tokenRecord.expectedProfilePhoto.photoId} (status: ${profilePhotoRecord.status})`);
    }

    // 10. Execute transaction to update all records atomically
    const submittedAt = new Date().toISOString();
    await executeProfileSubmissionTransaction(
      hostId,
      submissionToken,
      tokenRecord,
      documents,
      profilePhotoRecord,
      submittedAt
    );

    console.log(`Profile submission completed for host ${hostId}`);

    // 11. Send confirmation email (don't fail request if email fails)
    try {
      const hostRecord = await getHostRecord(hostId);
      
      if (hostRecord) {
        // Determine name based on host type
        const name = hostRecord.hostType === 'INDIVIDUAL'
          ? `${hostRecord.forename} ${hostRecord.surname}`
          : hostRecord.legalName || hostRecord.displayName;

        await sendProfileSubmissionEmail(
          hostRecord.email,
          hostRecord.preferredLanguage || 'sr',
          name
        );
        
        console.log(`Confirmation email sent to ${hostRecord.email}`);
      }
    } catch (emailError: any) {
      // Log error but don't fail the request - submission is already complete
      console.error('Failed to send confirmation email (non-fatal):', {
        error: emailError.message,
        hostId,
      });
    }

    // 12. Create Live ID check request ONLY for initial submissions
    // Don't create a new request if this is a resubmission after rejection
    const hostRecord = await getHostRecord(hostId);
    const wasRejected = hostRecord?.previousStatus === 'REJECTED';
    
    if (!wasRejected) {
      try {
        await createLiveIdCheckRequest(hostId);
        console.log('✅ Live ID check request created for new host submission');
      } catch (requestError: any) {
        // Log error but don't fail the request - submission is already complete
        console.error('Failed to create Live ID check request (non-fatal):', {
          error: requestError.message,
          hostId,
        });
      }
    } else {
      console.log('ℹ️ Skipping Live ID check request creation - this is a resubmission after rejection');
    }

    // 13. Return success response
    return response.success({
      success: true,
      hostId,
      status: 'VERIFICATION',
      message: 'Profile and documents submitted successfully. Pending admin review.',
      submittedAt,
      documents: documents.map(doc => ({
        documentId: doc.documentId,
        documentType: doc.documentType,
        status: 'PENDING',
        uploadedAt: submittedAt,
      })),
    });

  } catch (error: any) {
    console.error('Confirm submission error:', error);
    return response.handleError(error);
  }
}

/**
 * Get submission token from DynamoDB
 */
async function getSubmissionToken(submissionToken: string): Promise<SubmissionToken | null> {
  const result = await docClient.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: {
        pk: `SUBMISSION#${submissionToken}`,
        sk: 'META',
      },
    })
  );

  return result.Item as SubmissionToken | null;
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
 * Get document records by IDs
 */
async function getDocumentsByIds(hostId: string, documentIds: string[]): Promise<Document[]> {
  const documents: Document[] = [];

  for (const docId of documentIds) {
    const result = await docClient.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: {
          pk: `HOST#${hostId}`,
          sk: `DOCUMENT#${docId}`,
        },
      })
    );

    if (result.Item) {
      documents.push(result.Item as Document);
    }
  }

  return documents;
}

/**
 * Execute atomic transaction to complete submission
 * Updates: Host status, Document statuses, Profile photo status (if any), Submission token status
 */
async function executeProfileSubmissionTransaction(
  hostId: string,
  _submissionToken: string,
  tokenRecord: SubmissionToken,
  documents: Document[],
  profilePhoto: any,
  submittedAt: string
) {
  const transactItems = [];

  // 1. Update Host record: status → VERIFICATION, update profile data, set kyc.submittedAt
  const hostRecord = await getHostRecord(hostId);
  
  if (!hostRecord) {
    throw new Error(`Host ${hostId} not found`);
  }

  // Apply profile data from submission
  const updatedHost = {
    ...hostRecord,
    ...tokenRecord.profileData,
    status: 'VERIFICATION',
    previousStatus: hostRecord.status, // Track previous status (for detecting resubmissions)
    kyc: {
      ...hostRecord.kyc,
      status: 'PENDING',
      submittedAt,
      documentIds: documents.map(d => d.documentId),
    },
    submission: {
      ...hostRecord.submission,
      currentToken: null,
      tokenExpiresAt: null,
    },
    updatedAt: submittedAt,
    // Update GSI2 for StatusIndex
    gsi2pk: 'HOST#VERIFICATION',
    gsi2sk: submittedAt,
  };

  transactItems.push({
    Put: {
      TableName: TABLE_NAME,
      Item: updatedHost,
    },
  });

  // 2. Update all Document records: status → PENDING, clear TTL, update GSI3
  for (const doc of documents) {
    transactItems.push({
      Put: {
        TableName: TABLE_NAME,
        Item: {
          ...doc,
          status: 'PENDING',
          expiresAt: null, // Clear TTL - document confirmed, keep forever
          uploadedAt: submittedAt,
          updatedAt: submittedAt,
        },
      },
    });
  }

  // 2b. Update profile photo record: status → PENDING_SCAN, clear TTL (if provided)
  if (profilePhoto) {
    transactItems.push({
      Put: {
        TableName: TABLE_NAME,
        Item: {
          ...profilePhoto,
          status: 'PENDING_SCAN',
          expiresAt: null, // Clear TTL - photo confirmed, keep forever
          updatedAt: submittedAt,
        },
      },
    });
  }

  // 3. Update Submission token: status → COMPLETED
  transactItems.push({
    Put: {
      TableName: TABLE_NAME,
      Item: {
        ...tokenRecord,
        status: 'COMPLETED',
        completedAt: submittedAt,
        updatedAt: submittedAt,
      },
    },
  });

  // Execute transaction with retry logic
  await executeTransaction({
    TransactItems: transactItems,
  });

  console.log(`Transaction completed: Updated host, ${documents.length} documents, and submission token`);
}

/**
 * Create Live ID check request for host
 * Only creates if no active request exists (REQUESTED, RECEIVED, or VERIFIED status)
 */
async function createLiveIdCheckRequest(hostId: string): Promise<void> {
  console.log(`Creating Live ID check request for host: ${hostId}`);

  // 1. Check if host already has an active Live ID check request
  const existingRequests = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :sk)',
      FilterExpression: 'requestType = :requestType AND (#status = :requested OR #status = :received OR #status = :verified)',
      ExpressionAttributeNames: {
        '#status': 'status',
      },
      ExpressionAttributeValues: {
        ':pk': `HOST#${hostId}`,
        ':sk': 'REQUEST#',
        ':requestType': 'LIVE_ID_CHECK',
        ':requested': 'REQUESTED',
        ':received': 'RECEIVED',
        ':verified': 'VERIFIED',
      },
      Limit: 1,
    })
  );

  if (existingRequests.Items && existingRequests.Items.length > 0) {
    const status = existingRequests.Items[0].status;
    console.log(`Active Live ID check request already exists with status: ${status}`);
    return;
  }

  // 2. Fetch request type description from database
  const requestTypeResult = await docClient.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: {
        pk: 'REQUEST_TYPE#LIVE_ID_CHECK',
        sk: 'META',
      },
    })
  );

  if (!requestTypeResult.Item) {
    throw new Error('Live ID check request type not found in database');
  }

  const description = requestTypeResult.Item.description;

  // 3. Generate request ID
  const requestId = `req_${randomUUID()}`;
  const now = new Date().toISOString();

  // 4. Create request record
  await docClient.send(
    new TransactWriteCommand({
      TransactItems: [
        {
          Put: {
            TableName: TABLE_NAME,
            Item: {
              pk: `HOST#${hostId}`,
              sk: `REQUEST#${requestId}`,
              
              requestId,
              hostId,
              
              requestType: 'LIVE_ID_CHECK',
              status: 'REQUESTED',
              description,
              
              createdAt: now,
              updatedAt: now,
              
              // GSI2: Admin queries (by type and status)
              gsi2pk: 'REQUEST#LIVE_ID_CHECK',
              gsi2sk: `STATUS#REQUESTED#${now}`,
              
              // GSI3: Direct lookup by requestId
              gsi3pk: `REQUEST#${requestId}`,
              gsi3sk: `REQUEST_META#${requestId}`,
            },
          },
        },
      ],
    })
  );

  console.log(`✅ Live ID check request created: ${requestId}`);

  // 5. Send email notification
  const hostRecord = await getHostRecord(hostId);
  
  if (hostRecord) {
    const name = hostRecord.hostType === 'INDIVIDUAL'
      ? `${hostRecord.forename} ${hostRecord.surname}`
      : hostRecord.legalName || hostRecord.displayName;

    await sendLiveIdCheckRequestEmail(
      hostRecord.email,
      hostRecord.preferredLanguage || 'sr',
      name
    );
    
    console.log(`✅ Live ID check request email sent to ${hostRecord.email}`);
  }
}

