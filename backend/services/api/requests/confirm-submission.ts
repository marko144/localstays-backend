/**
 * Confirm Request Submission Lambda Handler
 * POST /api/v1/hosts/{hostId}/requests/{requestId}/confirm-submission
 * 
 * Step 2: Verifies video upload and updates request status
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { getAuthContext, assertCanAccessHost } from '../lib/auth';
import * as response from '../lib/response';
import {
  ConfirmRequestSubmissionRequest,
  ConfirmRequestSubmissionResponse,
} from '../../types/request.types';

const dynamoClient = new DynamoDBClient({ region: process.env.AWS_REGION });
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const TABLE_NAME = process.env.TABLE_NAME!;

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

    // 7. Fetch all file records (following listing confirm pattern)
    const filesResult = await docClient.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :sk)',
        ExpressionAttributeValues: {
          ':pk': `REQUEST#${requestId}`,
          ':sk': 'FILE#',
        },
      })
    );

    const fileRecords = filesResult.Items || [];

    if (fileRecords.length !== 2) {
      return response.badRequest('Expected 2 files (1 video + 1 image)');
    }

    // Note: Like listing submission, we DON'T check S3 existence
    // Because GuardDuty + verification processor are very fast (3-5 seconds)
    // By the time confirm is called, files may already be processed and moved
    // DynamoDB record existence is sufficient proof of upload

    // 8. Verify we have both video and image
    const hasVideo = fileRecords.some((f) => f.fileType === 'VIDEO');
    const hasImage = fileRecords.some((f) => f.fileType === 'IMAGE');

    if (!hasVideo || !hasImage) {
      return response.badRequest('Must upload both video and image files');
    }

    console.log(`✅ Verified ${fileRecords.length} files uploaded for request ${requestId}`);

    // 9. Update request status to RECEIVED
    const now = new Date().toISOString();

    await docClient.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: {
          pk: `HOST#${hostId}`,
          sk: `REQUEST#${requestId}`,
        },
        UpdateExpression:
          'SET #status = :status, uploadedAt = :uploadedAt, updatedAt = :updatedAt, gsi2sk = :gsi2sk ' +
          'REMOVE submissionToken, submissionTokenExpiresAt',
        ExpressionAttributeNames: {
          '#status': 'status',
        },
        ExpressionAttributeValues: {
          ':status': 'RECEIVED',
          ':uploadedAt': now,
          ':updatedAt': now,
          ':gsi2sk': `STATUS#RECEIVED#${now}`, // Update GSI2 for admin queries
        },
      })
    );

    console.log(`✅ Request ${requestId} marked as RECEIVED`);

    // 10. Build response
    const confirmResponse: ConfirmRequestSubmissionResponse = {
      requestId,
      status: 'RECEIVED',
      message: 'Live ID check files received successfully',
    };

    return response.success(confirmResponse);
  } catch (error: any) {
    console.error('Confirm request submission error:', error);
    return response.handleError(error);
  }
}


