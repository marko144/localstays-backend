/**
 * Confirm Request Submission Lambda Handler
 * POST /api/v1/hosts/{hostId}/requests/{requestId}/confirm-submission
 * 
 * Step 2: Verifies video upload and updates request status
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getAuthContext, assertCanAccessHost } from '../lib/auth';
import * as response from '../lib/response';
import {
  ConfirmRequestSubmissionRequest,
  ConfirmRequestSubmissionResponse,
} from '../../types/request.types';

const dynamoClient = new DynamoDBClient({ region: process.env.AWS_REGION });
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const s3Client = new S3Client({ region: process.env.AWS_REGION });

const TABLE_NAME = process.env.TABLE_NAME!;
const BUCKET_NAME = process.env.BUCKET_NAME!;

// Constants
const MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024; // 100MB

/**
 * Main Lambda handler
 */
export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  console.log('Confirm request submission:', {
    pathParameters: event.pathParameters,
  });

  try {
    // 1. Authentication & Authorization
    const auth = getAuthContext(event);
    const hostId = event.pathParameters?.hostId;
    const requestId = event.pathParameters?.requestId;

    if (!hostId) {
      return response.badRequest('hostId is required in path');
    }

    if (!requestId) {
      return response.badRequest('requestId is required in path');
    }

    assertCanAccessHost(auth, hostId);

    // 2. Parse and validate request body
    if (!event.body) {
      return response.badRequest('Request body is required');
    }

    let requestBody: ConfirmRequestSubmissionRequest;
    try {
      requestBody = JSON.parse(event.body);
    } catch (error) {
      return response.badRequest('Invalid JSON in request body');
    }

    const { submissionToken } = requestBody;

    if (!submissionToken) {
      return response.badRequest('submissionToken is required');
    }

    // 3. Fetch request from DynamoDB
    const result = await docClient.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: {
          pk: `HOST#${hostId}`,
          sk: `REQUEST#${requestId}`,
        },
      })
    );

    if (!result.Item) {
      return response.notFound('Request not found');
    }

    const requestRecord = result.Item;

    // 4. Verify request belongs to this host
    if (requestRecord.hostId !== hostId) {
      return response.forbidden('Request does not belong to this host');
    }

    // 5. Verify submission token
    if (requestRecord.submissionToken !== submissionToken) {
      return response.badRequest('Invalid submission token');
    }

    // 6. Check if token expired
    const tokenExpiresAt = new Date(requestRecord.submissionTokenExpiresAt);
    if (tokenExpiresAt < new Date()) {
      return response.badRequest('Submission token has expired');
    }

    // 7. Determine S3 key based on content type stored during intent
    // We need to check which file was uploaded
    const possibleExtensions = ['mp4', 'mov', 'webm'];
    let s3Key: string | null = null;
    let fileMetadata: any = null;

    for (const ext of possibleExtensions) {
      const testKey = `${hostId}/requests/${requestId}/live-id-check.${ext}`;
      try {
        const headResult = await s3Client.send(
          new HeadObjectCommand({
            Bucket: BUCKET_NAME,
            Key: testKey,
          })
        );

        // File found!
        s3Key = testKey;
        fileMetadata = headResult;
        break;
      } catch (error: any) {
        // File not found, try next extension
        if (error.name !== 'NotFound') {
          throw error; // Re-throw if it's not a "not found" error
        }
      }
    }

    // 8. Verify file exists in S3
    if (!s3Key || !fileMetadata) {
      return response.badRequest('Video file not found in S3. Please upload the file first.');
    }

    // 9. Validate file size
    const fileSize = fileMetadata.ContentLength || 0;
    if (fileSize > MAX_FILE_SIZE_BYTES) {
      return response.badRequest(
        `File size (${Math.round(fileSize / 1024 / 1024)}MB) exceeds maximum allowed size (200MB)`
      );
    }

    if (fileSize === 0) {
      return response.badRequest('Uploaded file is empty');
    }

    // 10. Generate S3 URL for viewing (not pre-signed, just the path)
    const s3Url = `s3://${BUCKET_NAME}/${s3Key}`;

    // 11. Update request status to RECEIVED
    const now = new Date().toISOString();

    await docClient.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: {
          pk: `HOST#${hostId}`,
          sk: `REQUEST#${requestId}`,
        },
        UpdateExpression:
          'SET #status = :status, s3Key = :s3Key, s3Url = :s3Url, fileSize = :fileSize, ' +
          'contentType = :contentType, uploadedAt = :uploadedAt, updatedAt = :updatedAt, ' +
          'gsi2sk = :gsi2sk ' +
          'REMOVE submissionToken, submissionTokenExpiresAt',
        ExpressionAttributeNames: {
          '#status': 'status',
        },
        ExpressionAttributeValues: {
          ':status': 'RECEIVED',
          ':s3Key': s3Key,
          ':s3Url': s3Url,
          ':fileSize': fileSize,
          ':contentType': fileMetadata.ContentType,
          ':uploadedAt': now,
          ':updatedAt': now,
          ':gsi2sk': `STATUS#RECEIVED#${now}`, // Update GSI2 for admin queries
        },
      })
    );

    console.log(`✅ Request ${requestId} marked as RECEIVED`);

    // 12. Build response
    const confirmResponse: ConfirmRequestSubmissionResponse = {
      requestId,
      status: 'RECEIVED',
      message: 'Live ID check video received successfully',
    };

    return response.success(confirmResponse);
  } catch (error: any) {
    console.error('Confirm request submission error:', error);
    return response.handleError(error);
  }
}


