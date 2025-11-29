/**
 * Submit Request Intent Lambda Handler
 * POST /api/v1/hosts/{hostId}/requests/{requestId}/submit-intent
 * 
 * Step 1: Validates request and generates pre-signed S3 URL for video upload
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'crypto';
import { getAuthContext, assertCanAccessHost } from '../lib/auth';
import * as response from '../lib/response';
import { generateUploadUrl } from '../lib/s3-presigned';
import {
  SubmitRequestIntentRequest,
  SubmitRequestIntentResponse,
} from '../../types/request.types';

const client = new DynamoDBClient({ region: process.env.AWS_REGION });
const docClient = DynamoDBDocumentClient.from(client);
const TABLE_NAME = process.env.TABLE_NAME!;
// BUCKET_NAME is used in generateUploadUrl from lib/s3-presigned
// const BUCKET_NAME = process.env.BUCKET_NAME!;

// Constants
const SUBMISSION_TOKEN_EXPIRY_MINUTES = 30;
const MAX_VIDEO_SIZE_MB = 100;
const MAX_IMAGE_SIZE_MB = 10;
const ALLOWED_VIDEO_TYPES = ['video/mp4', 'video/mov', 'video/webm'];
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

/**
 * Main Lambda handler
 */
export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  console.log('Submit request intent:', {
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

    let requestBody: SubmitRequestIntentRequest;
    try {
      requestBody = JSON.parse(event.body);
    } catch (error) {
      return response.badRequest('Invalid JSON in request body');
    }

    const { files } = requestBody;

    // Validate files array
    if (!files || files.length !== 2) {
      return response.badRequest('Exactly 2 files required (1 video + 1 image)');
    }

    // Find video and image
    const videoFile = files.find((f) => f.fileType === 'VIDEO');
    const imageFile = files.find((f) => f.fileType === 'IMAGE');

    if (!videoFile || !imageFile) {
      return response.badRequest('Must include 1 VIDEO and 1 IMAGE file');
    }

    // Validate content types
    if (!ALLOWED_VIDEO_TYPES.includes(videoFile.contentType)) {
      return response.badRequest(
        `Invalid video content type. Allowed: ${ALLOWED_VIDEO_TYPES.join(', ')}`
      );
    }

    if (!ALLOWED_IMAGE_TYPES.includes(imageFile.contentType)) {
      return response.badRequest(
        `Invalid image content type. Allowed: ${ALLOWED_IMAGE_TYPES.join(', ')}`
      );
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

    // 4. Verify request belongs to this host
    if (result.Item.hostId !== hostId) {
      return response.forbidden('Request does not belong to this host');
    }

    // 5. Verify request status is REQUESTED (not already uploaded)
    if (result.Item.status !== 'REQUESTED') {
      return response.badRequest(
        `Request cannot be submitted. Current status: ${result.Item.status}`
      );
    }

    // 6. Generate submission token
    const submissionToken = `req_sub_${randomUUID()}`;
    const tokenExpiresAt = new Date(Date.now() + SUBMISSION_TOKEN_EXPIRY_MINUTES * 60 * 1000);
    const now = new Date().toISOString();

    // 7. Create file records and generate upload URLs (following listing pattern)
    const uploadUrls: SubmitRequestIntentResponse['uploadUrls'] = [];

    for (const file of files) {
      const extension = getFileExtension(file.contentType);
      const fileTypeLower = file.fileType.toLowerCase(); // 'video' or 'image'
      const s3Key = `veri_live-id-check-${fileTypeLower}_${requestId}_${file.fileId}.${extension}`;
      const finalS3Key = `${hostId}/requests/${requestId}/live-id-check-${fileTypeLower}.${extension}`;

      // Create placeholder file record (following listing image pattern)
      await docClient.send(
        new PutCommand({
          TableName: TABLE_NAME,
          Item: {
            pk: `REQUEST#${requestId}`,
            sk: `FILE#${file.fileId}`,

            requestId,
            hostId,
            fileId: file.fileId,
            fileType: file.fileType,

            s3Key, // Root location with veri_ prefix
            finalS3Key, // Final destination after scan

            contentType: file.contentType,
            fileSize: 0, // Will be updated after upload

            status: 'PENDING_UPLOAD',

            uploadedAt: now,
            isDeleted: false,
          },
        })
      );

      // Generate pre-signed URL with metadata
      const uploadUrl = await generateUploadUrl(
        s3Key,
        file.contentType,
        SUBMISSION_TOKEN_EXPIRY_MINUTES * 60,
        {
          hostId,
          requestId,
          fileId: file.fileId,
          fileType: file.fileType,
        }
      );

      uploadUrls.push({
        fileId: file.fileId,
        fileType: file.fileType,
        uploadUrl,
        expiresAt: tokenExpiresAt.toISOString(),
      });
    }

    console.log(`✅ Created ${files.length} file records and generated upload URLs for request ${requestId}`);

    // 8. Update request with submission token
    await docClient.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: {
          pk: `HOST#${hostId}`,
          sk: `REQUEST#${requestId}`,
        },
        UpdateExpression:
          'SET submissionToken = :token, submissionTokenExpiresAt = :expiresAt, updatedAt = :now',
        ExpressionAttributeValues: {
          ':token': submissionToken,
          ':expiresAt': tokenExpiresAt.toISOString(),
          ':now': now,
        },
      })
    );

    // 9. Build response
    const intentResponse: SubmitRequestIntentResponse = {
      requestId,
      submissionToken,
      uploadUrls,
      maxVideoSizeMB: MAX_VIDEO_SIZE_MB,
      maxImageSizeMB: MAX_IMAGE_SIZE_MB,
    };

    return response.success(intentResponse);
  } catch (error: any) {
    console.error('Submit request intent error:', error);
    return response.handleError(error);
  }
}

/**
 * Get file extension from content type
 */
function getFileExtension(contentType: string): string {
  const map: Record<string, string> = {
    'video/mp4': 'mp4',
    'video/mov': 'mov',
    'video/webm': 'webm',
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
  };

  return map[contentType.toLowerCase()] || 'mp4';
}


