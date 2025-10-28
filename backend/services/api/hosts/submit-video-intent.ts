/**
 * Submit Property Video Intent Lambda Handler
 * Host endpoint to initiate property video verification upload
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'crypto';

import { getAuthContext, assertCanAccessHost } from '../lib/auth';
import * as response from '../lib/response';
import { generateUploadUrl } from '../lib/s3-presigned';
import { Request } from '../../types/request.types';

const client = new DynamoDBClient({ region: process.env.AWS_REGION });
const docClient = DynamoDBDocumentClient.from(client);

const TABLE_NAME = process.env.TABLE_NAME!;
const MAX_FILE_SIZE_MB = 200;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;
const ALLOWED_VIDEO_TYPES = ['video/mp4', 'video/mov', 'video/webm'];
const SUBMISSION_TOKEN_EXPIRY_MINUTES = 60; // 1 hour

interface SubmitVideoIntentRequest {
  videoFileName: string;
  videoFileSize: number;
  videoContentType: string;
}

interface SubmitVideoIntentResponse {
  requestId: string;
  submissionToken: string;
  uploadUrl: string;
  expiresAt: string;
  maxFileSizeMB: number;
}

/**
 * Main Lambda handler
 */
export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  console.log('Submit property video intent:', {
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

    let requestBody: SubmitVideoIntentRequest;
    try {
      requestBody = JSON.parse(event.body);
    } catch (error) {
      return response.badRequest('Invalid JSON in request body');
    }

    const { videoFileName, videoFileSize, videoContentType } = requestBody;

    // 4. Validate input
    if (!videoFileName || !videoFileSize || !videoContentType) {
      return response.badRequest('videoFileName, videoFileSize, and videoContentType are required');
    }

    if (!ALLOWED_VIDEO_TYPES.includes(videoContentType)) {
      return response.badRequest(
        `Invalid video content type. Allowed types: ${ALLOWED_VIDEO_TYPES.join(', ')}`
      );
    }

    if (videoFileSize > MAX_FILE_SIZE_BYTES) {
      return response.badRequest(
        `File size (${Math.round(videoFileSize / 1024 / 1024)}MB) exceeds maximum allowed size (${MAX_FILE_SIZE_MB}MB)`
      );
    }

    if (videoFileSize <= 0) {
      return response.badRequest('File size must be greater than 0');
    }

    // 5. Fetch request record
    const requestRecord = await getRequestById(requestId);

    if (!requestRecord) {
      return response.notFound('Request not found');
    }

    // 6. Validate request belongs to this listing and host
    if (requestRecord.listingId !== listingId || requestRecord.hostId !== hostId) {
      return response.forbidden('Request does not belong to this listing');
    }

    // 7. Validate request type
    if (requestRecord.requestType !== 'PROPERTY_VIDEO_VERIFICATION') {
      return response.badRequest('This endpoint is only for property video verification requests');
    }

    // 8. Verify request status is REQUESTED (not already uploaded)
    if (requestRecord.status !== 'REQUESTED') {
      return response.badRequest(
        `Request cannot be submitted. Current status: ${requestRecord.status}`
      );
    }

    // 9. Generate submission token
    const submissionToken = `vid_sub_${randomUUID()}`;
    const tokenExpiresAt = new Date(Date.now() + SUBMISSION_TOKEN_EXPIRY_MINUTES * 60 * 1000);

    // 10. Determine file extension
    const fileExtension = getFileExtension(videoContentType);

    // 11. Generate S3 key following structure: {hostId}/listings/{listingId}/verification/
    const s3Key = `${hostId}/listings/${listingId}/verification/property-video-${requestId}.${fileExtension}`;

    // 12. Generate pre-signed URL for upload (expires in 1 hour)
    const uploadUrl = await generateUploadUrl(s3Key, videoContentType, SUBMISSION_TOKEN_EXPIRY_MINUTES * 60);

    // 13. Update request with submission token
    await docClient.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: {
          pk: `LISTING#${listingId}`,
          sk: `REQUEST#${requestId}`,
        },
        UpdateExpression:
          'SET submissionToken = :token, submissionTokenExpiresAt = :expiresAt, updatedAt = :now',
        ExpressionAttributeValues: {
          ':token': submissionToken,
          ':expiresAt': tokenExpiresAt.toISOString(),
          ':now': new Date().toISOString(),
        },
      })
    );

    console.log(`✅ Generated upload URL for property video request ${requestId}`);

    // 14. Build response
    const intentResponse: SubmitVideoIntentResponse = {
      requestId,
      submissionToken,
      uploadUrl,
      expiresAt: tokenExpiresAt.toISOString(),
      maxFileSizeMB: MAX_FILE_SIZE_MB,
    };

    return response.success(intentResponse);

  } catch (error: any) {
    console.error('Submit property video intent error:', error);
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

/**
 * Get file extension from content type
 */
function getFileExtension(contentType: string): string {
  const map: Record<string, string> = {
    'video/mp4': 'mp4',
    'video/mov': 'mov',
    'video/webm': 'webm',
  };

  return map[contentType] || 'mp4';
}




