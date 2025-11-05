/**
 * Admin API: Set Listing to Reviewing
 * 
 * PUT /api/v1/admin/listings/{listingId}/reviewing
 * 
 * Sets a listing to REVIEWING status (IN_REVIEW → REVIEWING).
 * Indicates an admin is actively reviewing this listing.
 * Permission required: ADMIN_LISTING_REVIEW
 */

import { APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { requirePermission, logAdminAction } from '../../lib/auth-middleware';
import { ListingMetadata } from '../../../types/listing.types';

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

const TABLE_NAME = process.env.TABLE_NAME!;

/**
 * Find listing by listingId using GSI3 (DocumentStatusIndex)
 */
async function findListing(listingId: string): Promise<ListingMetadata | null> {
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

  if (!result.Items || result.Items.length === 0) {
    return null;
  }

  return result.Items[0] as ListingMetadata;
}

/**
 * Main handler
 */
export const handler: APIGatewayProxyHandler = async (event) => {
  console.log('Set listing to reviewing request:', { pathParameters: event.pathParameters });

  try {
    // 1. Require admin permission
    const authResult = requirePermission(event, 'ADMIN_LISTING_REVIEW');
    if ('error' in authResult) {
      return authResult.error;
    }

    const { user } = authResult;

    // 2. Extract listingId from path
    const listingId = event.pathParameters?.listingId;

    if (!listingId) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'listingId is required',
          },
        }),
      };
    }

    console.log(`Admin ${user.email} setting listing to reviewing: ${listingId}`);

    // 3. Find listing
    const listing = await findListing(listingId);

    if (!listing) {
      return {
        statusCode: 404,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: 'Listing not found',
          },
        }),
      };
    }

    // 4. Validate current status (only IN_REVIEW can transition to REVIEWING)
    if (listing.status !== 'IN_REVIEW') {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({
          success: false,
          error: {
            code: 'INVALID_STATUS_TRANSITION',
            message: `Cannot set listing to REVIEWING with current status ${listing.status}. Expected IN_REVIEW.`,
          },
        }),
      };
    }

    // 5. Update listing status
    const now = new Date().toISOString();

    await docClient.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: {
          pk: `HOST#${listing.hostId}`,
          sk: `LISTING_META#${listingId}`,
        },
        UpdateExpression: `
          SET #status = :status,
              #reviewStartedAt = :reviewStartedAt,
              #reviewedBy = :reviewedBy,
              #updatedAt = :updatedAt,
              #gsi2pk = :gsi2pk,
              #gsi2sk = :gsi2sk
        `,
        ExpressionAttributeNames: {
          '#status': 'status',
          '#reviewStartedAt': 'reviewStartedAt',
          '#reviewedBy': 'reviewedBy',
          '#updatedAt': 'updatedAt',
          '#gsi2pk': 'gsi2pk',
          '#gsi2sk': 'gsi2sk',
        },
        ExpressionAttributeValues: {
          ':status': 'REVIEWING',
          ':reviewStartedAt': now,
          ':reviewedBy': user.email,
          ':updatedAt': now,
          ':gsi2pk': 'LISTING_STATUS#REVIEWING',
          ':gsi2sk': now,
        },
      })
    );

    console.log(`✅ Listing ${listingId} set to REVIEWING by ${user.email}`);

    // 6. Log admin action
    logAdminAction(user, 'SET_LISTING_REVIEWING', 'LISTING', listingId, {
      hostId: listing.hostId,
      reviewedBy: user.email,
    });

    // 7. Return success response
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        success: true,
        message: 'Listing set to reviewing status',
        data: {
          listingId,
          status: 'REVIEWING',
          reviewedBy: user.email,
          reviewStartedAt: now,
        },
      }),
    };
  } catch (error) {
    console.error('❌ Set listing reviewing error:', error);

    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to set listing to reviewing status',
        },
      }),
    };
  }
};

