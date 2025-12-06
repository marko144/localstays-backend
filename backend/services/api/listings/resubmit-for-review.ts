/**
 * Resubmit Rejected Listing for Review
 * 
 * POST /api/v1/hosts/{hostId}/listings/{listingId}/resubmit
 * 
 * Allows hosts to resubmit a REJECTED listing back to admin for review.
 * Changes listing status from REJECTED to IN_REVIEW.
 * 
 * Authorization:
 * - HOST: Can resubmit their own listings
 * - ADMIN: Can resubmit any listing
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { getAuthContext, assertCanAccessHost } from '../lib/auth';
import * as response from '../lib/response';

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

const TABLE_NAME = process.env.TABLE_NAME!;

/**
 * Main Lambda handler
 */
export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  console.log('Resubmit rejected listing for review:', {
    path: event.path,
    method: event.httpMethod,
    pathParameters: event.pathParameters,
  });

  try {
    // 1. Authentication & Authorization
    const auth = getAuthContext(event);
    const hostId = event.pathParameters?.hostId;
    const listingId = event.pathParameters?.listingId;

    if (!hostId || !listingId) {
      return response.badRequest('hostId and listingId are required in path');
    }

    // Check authorization (HOST can access own, ADMIN can access any)
    assertCanAccessHost(auth, hostId);

    // 2. Fetch listing metadata
    const listingResult = await docClient.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: {
          pk: `HOST#${hostId}`,
          sk: `LISTING_META#${listingId}`,
        },
      })
    );

    if (!listingResult.Item) {
      return response.notFound('Listing not found');
    }

    const listing = listingResult.Item;

    // 3. Validate current status is REJECTED
    if (listing.status !== 'REJECTED') {
      return response.badRequest(
        `Listing cannot be resubmitted in current status: ${listing.status}. Only REJECTED listings can be resubmitted.`,
        'INVALID_STATUS'
      );
    }

    // 4. Update listing status to IN_REVIEW
    const now = new Date().toISOString();

    await docClient.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: {
          pk: `HOST#${hostId}`,
          sk: `LISTING_META#${listingId}`,
        },
        UpdateExpression: 'SET #status = :status, #updatedAt = :updatedAt, submittedForReviewAt = :now, #gsi2sk = :gsi2sk',
        ExpressionAttributeNames: {
          '#status': 'status',
          '#updatedAt': 'updatedAt',
          '#gsi2sk': 'gsi2sk',
        },
        ExpressionAttributeValues: {
          ':status': 'IN_REVIEW',
          ':updatedAt': now,
          ':now': now,
          ':gsi2sk': `LISTING_STATUS#IN_REVIEW#${now}`,
        },
      })
    );

    console.log(`✅ Listing ${listingId} resubmitted for review (REJECTED → IN_REVIEW)`);

    // 5. Return success response
    return response.success({
      listingId,
      previousStatus: 'REJECTED',
      newStatus: 'IN_REVIEW',
      message: 'Listing successfully resubmitted for review',
    });
  } catch (error: any) {
    console.error('❌ Resubmit listing error:', error);
    return response.handleError(error);
  }
}

