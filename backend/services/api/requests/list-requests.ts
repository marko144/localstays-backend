/**
 * List Requests Lambda Handler
 * GET /api/v1/hosts/{hostId}/requests
 * 
 * Returns all verification requests for a host (both host-level and listing-level)
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { getAuthContext, assertCanAccessHost } from '../lib/auth';
import * as response from '../lib/response';
import { ListRequestsResponse, RequestSummary, Request } from '../../types/request.types';

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

    // 2. Query GSI2 for all request types (NO SCAN - use Query on GSI2!)
    // GSI2 pattern: gsi2pk = "REQUEST#<type>", gsi2sk = "STATUS#<status>#<createdAt>"
    // We query each request type (partition key) and filter by hostId in memory
    const requestTypes = ['LIVE_ID_CHECK', 'PROPERTY_VIDEO_VERIFICATION', 'ADDRESS_VERIFICATION'];
    
    const queryPromises = requestTypes.map(requestType =>
      docClient.send(
        new QueryCommand({
          TableName: TABLE_NAME,
          IndexName: 'StatusIndex',
          KeyConditionExpression: 'gsi2pk = :gsi2pk',
          ExpressionAttributeValues: {
            ':gsi2pk': `REQUEST#${requestType}`,
          },
        })
      )
    );

    const results = await Promise.all(queryPromises);
    
    // Combine all requests from all types and filter by hostId
    const allRequests = results
      .flatMap(result => (result.Items || []))
      .filter(item => item.hostId === hostId) as Request[];

    console.log(`Found ${allRequests.length} requests for host ${hostId}`);

    // 3. Fetch listing names for listing-level requests
    const listingIds = [...new Set(allRequests.map(r => r.listingId).filter(Boolean))];
    const listingNames: Record<string, string> = {};
    
    if (listingIds.length > 0) {
      const listingPromises = listingIds.map(async (listingId) => {
        const listing = await getListingById(listingId!);
        if (listing) {
          listingNames[listingId!] = listing.listingName || 'Unnamed Listing';
        }
      });
      await Promise.all(listingPromises);
    }

    // 4. Transform to response format and filter out sensitive data
    const requests: RequestSummary[] = allRequests
      .map((item) => ({
        requestId: item.requestId,
        requestType: item.requestType,
        status: item.status,
        description: item.description,
        createdAt: item.createdAt,
        uploadedAt: item.uploadedAt || item.videoUploadedAt,
        reviewedAt: item.reviewedAt,
        listingId: item.listingId, // Include listingId for listing-level requests
        listingName: item.listingId ? listingNames[item.listingId] : undefined,
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

/**
 * Get listing by ID using GSI3
 */
async function getListingById(listingId: string): Promise<any> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: 'DocumentStatusIndex',
      KeyConditionExpression: 'gsi3pk = :gsi3pk AND begins_with(gsi3sk, :gsi3sk)',
      ExpressionAttributeValues: {
        ':gsi3pk': `LISTING#${listingId}`,
        ':gsi3sk': 'LISTING_META#',
      },
      Limit: 1,
    })
  );

  return result.Items?.[0] || null;
}




