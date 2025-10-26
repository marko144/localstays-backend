/**
 * Get Request Lambda Handler
 * GET /api/v1/hosts/{hostId}/requests/{requestId}
 * 
 * Returns detailed information about a specific request
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { getAuthContext, assertCanAccessHost } from '../lib/auth';
import * as response from '../lib/response';
import { GetRequestResponse } from '../../types/request.types';

const client = new DynamoDBClient({ region: process.env.AWS_REGION });
const docClient = DynamoDBDocumentClient.from(client);
const TABLE_NAME = process.env.TABLE_NAME!;

/**
 * Main Lambda handler
 */
export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  console.log('Get request:', {
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

    // 2. Fetch request from DynamoDB
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

    // 3. Verify request belongs to this host
    if (result.Item.hostId !== hostId) {
      return response.forbidden('Request does not belong to this host');
    }

    // 4. Transform to response format
    const requestData: GetRequestResponse = {
      requestId: result.Item.requestId,
      requestType: result.Item.requestType,
      status: result.Item.status,
      description: result.Item.description,
      s3Url: result.Item.s3Url,
      fileSize: result.Item.fileSize,
      contentType: result.Item.contentType,
      createdAt: result.Item.createdAt,
      uploadedAt: result.Item.uploadedAt,
      updatedAt: result.Item.updatedAt,
      reviewedAt: result.Item.reviewedAt,
      rejectionReason: result.Item.rejectionReason,
    };

    console.log(`Request found: ${requestId}`);

    return response.success(requestData);
  } catch (error: any) {
    console.error('Get request error:', error);
    return response.handleError(error);
  }
}




