/**
 * List Requests Lambda Handler
 * GET /api/v1/hosts/{hostId}/requests
 * 
 * Returns all verification requests for a host
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { getAuthContext, assertCanAccessHost } from '../lib/auth';
import * as response from '../lib/response';
import { ListRequestsResponse, RequestSummary } from '../../types/request.types';

const client = new DynamoDBClient({ region: process.env.AWS_REGION });
const docClient = DynamoDBDocumentClient.from(client);
const TABLE_NAME = process.env.TABLE_NAME!;

/**
 * Main Lambda handler
 */
export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  console.log('List requests:', {
    pathParameters: event.pathParameters,
  });

  try {
    // 1. Authentication & Authorization
    const auth = getAuthContext(event);
    const hostId = event.pathParameters?.hostId;

    if (!hostId) {
      return response.badRequest('hostId is required in path');
    }

    assertCanAccessHost(auth, hostId);

    // 2. Query all requests for this host
    const result = await docClient.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :sk)',
        ExpressionAttributeValues: {
          ':pk': `HOST#${hostId}`,
          ':sk': 'REQUEST#',
        },
      })
    );

    // 3. Transform to response format
    const requests: RequestSummary[] = (result.Items || [])
      .map((item) => ({
        requestId: item.requestId,
        requestType: item.requestType,
        status: item.status,
        description: item.description,
        createdAt: item.createdAt,
        uploadedAt: item.uploadedAt,
        reviewedAt: item.reviewedAt,
      }))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()); // Newest first

    const responseBody: ListRequestsResponse = {
      requests,
    };

    console.log(`Found ${requests.length} requests for host ${hostId}`);

    return response.success(responseBody);
  } catch (error: any) {
    console.error('List requests error:', error);
    return response.handleError(error);
  }
}




