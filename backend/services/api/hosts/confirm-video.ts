/**
 * Confirm Property Video Lambda Handler
 * Host endpoint to confirm property video verification upload
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, HeadObjectCommand } from '@aws-sdk/client-s3';

import { getAuthContext, assertCanAccessHost } from '../lib/auth';
import * as response from '../lib/response';
import { Request } from '../../types/request.types';

const client = new DynamoDBClient({ region: process.env.AWS_REGION });
const docClient = DynamoDBDocumentClient.from(client);
const s3Client = new S3Client({ region: process.env.AWS_REGION });

const TABLE_NAME = process.env.TABLE_NAME!;
const BUCKET_NAME = process.env.BUCKET_NAME!;
const MAX_FILE_SIZE_MB = 200;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

interface ConfirmVideoRequest {
  submissionToken: string;
}

/**
 * Main Lambda handler
 */
export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  console.log('Confirm property video submission:', {
    path: event.path,
    method: event.httpMethod,
    pathParameters: event.pathParameters,
  });

  try {
    // 1. Extract authentication context
    const auth = getAuthContext(event);
    const hostId = event.pathParameters?.hostId;
    const listingId = event.pathParameters?.listingId;
    const requestId = event.pathParameters?.requestId;

    if (!hostId || !listingId || !requestId) {
      return response.badRequest('hostId, listingId, and requestId are required in path');
    }

    // 2. Verify authorization
    assertCanAccessHost(auth, hostId);

    // 3. Parse request body
    if (!event.body) {
      return response.badRequest('Request body is required');
    }

    let requestBody: ConfirmVideoRequest;
    try {
      requestBody = JSON.parse(event.body);
    } catch (error) {
      return response.badRequest('Invalid JSON in request body');
    }

    const { submissionToken } = requestBody;

    if (!submissionToken) {
      return response.badRequest('submissionToken is required');
    }

    // 4. Fetch request record
    const requestRecord = await getRequestById(requestId);

    if (!requestRecord) {
      return response.notFound('Request not found');
    }

    // 5. Validate request belongs to this listing and host
    if (requestRecord.listingId !== listingId || requestRecord.hostId !== hostId) {
      return response.forbidden('Request does not belong to this listing');
    }

    // 6. Validate request type
    if (requestRecord.requestType !== 'PROPERTY_VIDEO_VERIFICATION') {
      return response.badRequest('This endpoint is only for property video verification requests');
    }

    // 7. Validate submission token
    if (requestRecord.submissionToken !== submissionToken) {
      return response.badRequest('Invalid submission token');
    }

    // 8. Check if token expired
    const tokenExpiresAt = new Date(requestRecord.submissionTokenExpiresAt!);
    if (tokenExpiresAt < new Date()) {
      return response.badRequest('Submission token has expired');
    }

    // 9. Determine S3 key based on possible file extensions (using new path structure)
    const possibleExtensions = ['mp4', 'mov', 'webm'];
    let s3Key: string | null = null;
    let fileMetadata: any = null;

    for (const ext of possibleExtensions) {
      const testKey = `${hostId}/listings/${listingId}/verification/property-video-${requestId}.${ext}`;
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

    // 10. Verify file exists in S3
    if (!s3Key || !fileMetadata) {
      return response.badRequest('Video file not found in S3. Please upload the file first.');
    }

    // 11. Validate file size
    const fileSize = fileMetadata.ContentLength || 0;
    if (fileSize > MAX_FILE_SIZE_BYTES) {
      return response.badRequest(
        `File size (${Math.round(fileSize / 1024 / 1024)}MB) exceeds maximum allowed size (${MAX_FILE_SIZE_MB}MB)`
      );
    }

    if (fileSize === 0) {
      return response.badRequest('Uploaded file is empty');
    }

    // 12. Generate S3 URL for viewing
    const s3Url = `s3://${BUCKET_NAME}/${s3Key}`;

    // 13. Update request status to RECEIVED
    const now = new Date().toISOString();

    await docClient.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: {
          pk: `LISTING#${listingId}`,
          sk: `REQUEST#${requestId}`,
        },
        UpdateExpression:
          'SET #status = :status, videoUrl = :videoUrl, videoUploadedAt = :uploadedAt, s3Key = :s3Key, s3Url = :s3Url, fileSize = :fileSize, contentType = :contentType, uploadedAt = :uploadedAt, updatedAt = :now, submissionToken = :null, submissionTokenExpiresAt = :null, gsi2pk = :gsi2pk, gsi2sk = :gsi2sk',
        ExpressionAttributeNames: {
          '#status': 'status',
        },
        ExpressionAttributeValues: {
          ':status': 'RECEIVED',
          ':videoUrl': s3Url,
          ':uploadedAt': now,
          ':s3Key': s3Key,
          ':s3Url': s3Url,
          ':fileSize': fileSize,
          ':contentType': fileMetadata.ContentType || 'video/mp4',
          ':now': now,
          ':null': null,
          ':gsi2pk': `REQUEST#PROPERTY_VIDEO_VERIFICATION`,
          ':gsi2sk': `STATUS#RECEIVED#${now}`,
        },
      })
    );

    console.log(`✅ Property video confirmed for request ${requestId}`);

    // 14. Return success response
    return response.success({
      success: true,
      requestId,
      status: 'RECEIVED',
      message: 'Property video uploaded successfully. Awaiting admin review.',
      videoUrl: s3Url,
      fileSize,
      uploadedAt: now,
    });

  } catch (error: any) {
    console.error('Confirm property video error:', error);
    return response.handleError(error);
  }
}

/**
 * Get request by ID using GSI3
 */
async function getRequestById(requestId: string): Promise<Request | null> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: 'DocumentStatusIndex', // GSI3
      KeyConditionExpression: 'gsi3pk = :gsi3pk AND begins_with(gsi3sk, :gsi3sk)',
      ExpressionAttributeValues: {
        ':gsi3pk': `REQUEST#${requestId}`,
        ':gsi3sk': 'REQUEST_META#',
      },
      Limit: 1,
    })
  );

  if (!result.Items || result.Items.length === 0) {
    return null;
  }

  return result.Items[0] as Request;
}




