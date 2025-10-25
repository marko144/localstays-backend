/**
 * Confirm Submission Lambda Handler
 * Step 2 of profile submission: Verify uploads and update host status
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';

import { getAuthContext, assertCanAccessHost } from '../lib/auth';
import * as response from '../lib/response';
import { objectExists } from '../lib/s3-presigned';
import { executeTransaction } from '../lib/transaction';
import { sendProfileSubmissionEmail } from '../lib/email-service';
import { SubmissionToken, allDocumentsUploaded, getMissingDocuments } from '../../types/submission.types';
import { Document } from '../../types/document.types';

const client = new DynamoDBClient({ region: process.env.AWS_REGION });
const docClient = DynamoDBDocumentClient.from(client);

const TABLE_NAME = process.env.TABLE_NAME!;

interface ConfirmSubmissionRequest {
  submissionToken: string;
  uploadedDocuments: Array<{
    documentId: string;
    documentType: string;
  }>;
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

    const { submissionToken, uploadedDocuments } = requestBody;

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

    // 9. Verify all documents exist in S3
    const documents = await getDocumentsByIds(hostId, Array.from(expectedDocIds));
    const verificationResults = await Promise.all(
      documents.map(async (doc) => {
        const exists = await objectExists(doc.s3Key);
        return { documentId: doc.documentId, exists, s3Key: doc.s3Key };
      })
    );

    const missingFiles = verificationResults.filter(v => !v.exists);
    if (missingFiles.length > 0) {
      return response.badRequest('Not all files have been uploaded to S3', {
        missingFiles: missingFiles.map(f => ({ documentId: f.documentId, s3Key: f.s3Key })),
      });
    }

    console.log('All documents verified in S3');

    // 10. Execute transaction to update all records atomically
    const submittedAt = new Date().toISOString();
    await executeProfileSubmissionTransaction(
      hostId,
      submissionToken,
      tokenRecord,
      documents,
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

    // 12. Return success response
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
 * Updates: Host status, Document statuses, Submission token status
 */
async function executeProfileSubmissionTransaction(
  hostId: string,
  submissionToken: string,
  tokenRecord: SubmissionToken,
  documents: Document[],
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

  // 2. Update all Document records: status → PENDING, update GSI3
  for (const doc of documents) {
    transactItems.push({
      Put: {
        TableName: TABLE_NAME,
        Item: {
          ...doc,
          status: 'PENDING',
          uploadedAt: submittedAt,
          updatedAt: submittedAt,
          // Update GSI3 for DocumentStatusIndex
          gsi3pk: 'DOCUMENT_STATUS#PENDING',
          gsi3sk: submittedAt,
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

