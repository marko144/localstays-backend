/**
 * Get Listing Requests Lambda Handler
 * Host endpoint to get all requests for a specific listing
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';

import { getAuthContext, assertCanAccessHost } from '../lib/auth';
import * as response from '../lib/response';
import { Request } from '../../types/request.types';

const client = new DynamoDBClient({ region: process.env.AWS_REGION });
const docClient = DynamoDBDocumentClient.from(client);

const TABLE_NAME = process.env.TABLE_NAME!;

/**
 * Main Lambda handler
 */
export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  console.log('Get listing requests:', {
    path: event.path,
    method: event.httpMethod,
    pathParameters: event.pathParameters,
    queryStringParameters: event.queryStringParameters,
  });

  try {
    // 1. Extract authentication context
    const auth = getAuthContext(event);
    const hostId = event.pathParameters?.hostId;
    const listingId = event.pathParameters?.listingId;

    if (!hostId || !listingId) {
      return response.badRequest('hostId and listingId are required in path');
    }

    // 2. Verify authorization
    assertCanAccessHost(auth, hostId);

    // 3. Verify listing belongs to host
    const listing = await getListingById(listingId);

    if (!listing) {
      return response.notFound('Listing not found');
    }

    if (listing.hostId !== hostId) {
      return response.forbidden('Listing does not belong to this host');
    }

    // 4. Query requests for this listing
    const result = await docClient.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :sk)',
        ExpressionAttributeValues: {
          ':pk': `LISTING#${listingId}`,
          ':sk': 'REQUEST#',
        },
      })
    );

    const requests = (result.Items || []) as Request[];

    // 5. Filter out soft-deleted requests and sensitive fields (verificationCode)
    const sanitizedRequests = requests
      .filter((req) => !req.isDeleted)
      .map((req) => {
        const { verificationCode, ...safeRequest } = req;
        return safeRequest;
      });

    // 6. Sort by createdAt (newest first)
    sanitizedRequests.sort((a, b) => {
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

    // 7. Return response
    return response.success({
      success: true,
      listingId,
      requests: sanitizedRequests,
      count: sanitizedRequests.length,
    });

  } catch (error: any) {
    console.error('Get listing requests error:', error);
    return response.handleError(error);
  }
}

/**
 * Get listing by ID using GSI3
 */
async function getListingById(listingId: string): Promise<any> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: 'DocumentStatusIndex', // GSI3
      KeyConditionExpression: 'gsi3pk = :gsi3pk AND begins_with(gsi3sk, :gsi3sk)',
      ExpressionAttributeValues: {
        ':gsi3pk': `LISTING#${listingId}`,
        ':gsi3sk': 'LISTING_META#',
      },
      Limit: 1,
    })
  );

  if (!result.Items || result.Items.length === 0) {
    return null;
  }

  return result.Items[0];
}

