/**
 * Submit Request Intent Lambda Handler
 * POST /api/v1/hosts/{hostId}/requests/{requestId}/submit-intent
 * 
 * Step 1: Validates request and generates pre-signed S3 URL for video upload
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
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
const MAX_FILE_SIZE_MB = 100;
const ALLOWED_VIDEO_TYPES = ['video/mp4', 'video/mov', 'video/webm'];

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

    const { contentType } = requestBody;

    if (!contentType) {
      return response.badRequest('contentType is required');
    }

    if (!ALLOWED_VIDEO_TYPES.includes(contentType)) {
      return response.badRequest(
        `Invalid content type. Allowed types: ${ALLOWED_VIDEO_TYPES.join(', ')}`
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

    // 7. Determine file extension
    const fileExtension = getFileExtension(contentType);

    // 8. Generate S3 key
    const s3Key = `${hostId}/requests/${requestId}/live-id-check.${fileExtension}`;

    // 9. Generate pre-signed URL for upload (expires in 30 minutes)
    const uploadUrl = await generateUploadUrl(s3Key, contentType, SUBMISSION_TOKEN_EXPIRY_MINUTES * 60);

    // 10. Update request with submission token
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
          ':now': new Date().toISOString(),
        },
      })
    );

    console.log(`✅ Generated upload URL for request ${requestId}`);

    // 11. Build response
    const intentResponse: SubmitRequestIntentResponse = {
      requestId,
      submissionToken,
      uploadUrl,
      expiresAt: tokenExpiresAt.toISOString(),
      maxFileSizeMB: MAX_FILE_SIZE_MB,
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
  };

  return map[contentType.toLowerCase()] || 'mp4';
}


