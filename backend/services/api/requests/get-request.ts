/**
 * Get Request Lambda Handler
 * GET /api/v1/hosts/{hostId}/requests/{requestId}
 * 
 * Returns detailed information about a specific request
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
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

    // 2. Fetch request from DynamoDB using GSI3
    // This works for all request types (host-level and listing-level)
    const result = await docClient.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        IndexName: 'DocumentStatusIndex',  // GSI3
        KeyConditionExpression: 'gsi3pk = :gsi3pk AND begins_with(gsi3sk, :gsi3sk)',
        ExpressionAttributeValues: {
          ':gsi3pk': `REQUEST#${requestId}`,
          ':gsi3sk': 'REQUEST_META#',
        },
        Limit: 1,
      })
    );

    if (!result.Items || result.Items.length === 0) {
      return response.notFound('Request not found');
    }

    const request = result.Items[0];

    // 3. Verify request belongs to this host
    if (request.hostId !== hostId) {
      return response.forbidden('Request does not belong to this host');
    }

    // 4. Fetch listing name if this is a listing-level request
    let listingName: string | undefined;
    if (request.listingId) {
      const listingResult = await docClient.send(
        new QueryCommand({
          TableName: TABLE_NAME,
          IndexName: 'DocumentStatusIndex',  // GSI3
          KeyConditionExpression: 'gsi3pk = :gsi3pk AND begins_with(gsi3sk, :gsi3sk)',
          ExpressionAttributeValues: {
            ':gsi3pk': `LISTING#${request.listingId}`,
            ':gsi3sk': 'LISTING_META#',
          },
          Limit: 1,
        })
      );

      if (listingResult.Items && listingResult.Items[0]) {
        listingName = listingResult.Items[0].listingName || 'Unnamed Listing';
      }
    }

    // 5. Transform to response format (filter out sensitive data)
    const requestData: GetRequestResponse = {
      requestId: request.requestId,
      requestType: request.requestType,
      status: request.status,
      description: request.description,
      s3Url: request.s3Url,
      fileSize: request.fileSize,
      contentType: request.contentType,
      createdAt: request.createdAt,
      uploadedAt: request.uploadedAt || request.videoUploadedAt,
      updatedAt: request.updatedAt,
      reviewedAt: request.reviewedAt,
      rejectionReason: request.rejectionReason,
      videoUrl: request.videoUrl,
      listingId: request.listingId,
      listingName: listingName,
      // DO NOT include pdfLetterUrl - this is admin-only and should never be exposed to hosts
      codeAttempts: request.codeAttempts,
    };

    console.log(`Request found: ${requestId} (type: ${request.requestType})`);

    return response.success(requestData);
  } catch (error: any) {
    console.error('Get request error:', error);
    return response.handleError(error);
  }
}




