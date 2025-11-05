/**
 * Admin API: Reject Listing
 * 
 * PUT /api/v1/admin/listings/{listingId}/reject
 * Body: { rejectionReason: string }
 * 
 * Rejects a listing (IN_REVIEW → REJECTED).
 * Sends rejection email notification with reason.
 * Permission required: ADMIN_LISTING_REJECT
 */

import { APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { requirePermission, logAdminAction } from '../../lib/auth-middleware';
import { ListingMetadata } from '../../../types/listing.types';
import { RejectListingRequest } from '../../../types/admin.types';
import { Host, isIndividualHost } from '../../../types/host.types';
import { sendListingRejectedEmail } from '../../lib/email-service';

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

const TABLE_NAME = process.env.TABLE_NAME!;
const MAX_REJECTION_REASON_LENGTH = 500;

/**
 * Validate request body
 */
function validateRequest(body: any): { valid: boolean; error?: string } {
  if (!body) {
    return { valid: false, error: 'Request body is required' };
  }

  if (!body.rejectionReason || typeof body.rejectionReason !== 'string') {
    return { valid: false, error: 'rejectionReason is required and must be a string' };
  }

  const trimmedReason = body.rejectionReason.trim();

  if (trimmedReason.length === 0) {
    return { valid: false, error: 'rejectionReason cannot be empty' };
  }

  if (trimmedReason.length > MAX_REJECTION_REASON_LENGTH) {
    return { 
      valid: false, 
      error: `rejectionReason must be ${MAX_REJECTION_REASON_LENGTH} characters or less` 
    };
  }

  return { valid: true };
}

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
  console.log('Reject listing request:', { 
    pathParameters: event.pathParameters,
    body: event.body ? JSON.parse(event.body) : null,
  });

  try {
    // 1. Require admin permission
    const authResult = requirePermission(event, 'ADMIN_LISTING_REJECT');
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

    // 3. Parse and validate request body
    let body: RejectListingRequest;
    try {
      body = JSON.parse(event.body || '{}');
    } catch (error) {
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
            message: 'Invalid JSON in request body',
          },
        }),
      };
    }

    const validation = validateRequest(body);
    if (!validation.valid) {
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
            message: validation.error,
          },
        }),
      };
    }

    const rejectionReason = body.rejectionReason.trim();

    console.log(`Admin ${user.email} rejecting listing: ${listingId}`);

    // 4. Find listing
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

    // 5. Validate current status (allow IN_REVIEW, REVIEWING, or LOCKED)
    const allowedStatuses = ['IN_REVIEW', 'REVIEWING', 'LOCKED'];
    if (!allowedStatuses.includes(listing.status)) {
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
            message: `Cannot reject listing with status ${listing.status}. Expected one of: ${allowedStatuses.join(', ')}.`,
          },
        }),
      };
    }

    // 6. Update listing status with rejection reason
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
              #rejectedAt = :rejectedAt,
              #rejectionReason = :rejectionReason,
              #updatedAt = :updatedAt,
              #gsi2pk = :gsi2pk,
              #gsi2sk = :gsi2sk
        `,
        ExpressionAttributeNames: {
          '#status': 'status',
          '#rejectedAt': 'rejectedAt',
          '#rejectionReason': 'rejectionReason',
          '#updatedAt': 'updatedAt',
          '#gsi2pk': 'gsi2pk',
          '#gsi2sk': 'gsi2sk',
        },
        ExpressionAttributeValues: {
          ':status': 'REJECTED',
          ':rejectedAt': now,
          ':rejectionReason': rejectionReason,
          ':updatedAt': now,
          ':gsi2pk': 'LISTING_STATUS#REJECTED',
          ':gsi2sk': now,
        },
      })
    );

    console.log(`✅ Listing ${listingId} rejected successfully`);

    // 7. Send rejection email
    try {
      // Fetch host details for email
      const hostResult = await docClient.send(
        new QueryCommand({
          TableName: TABLE_NAME,
          KeyConditionExpression: 'pk = :pk AND sk = :sk',
          ExpressionAttributeValues: {
            ':pk': `HOST#${listing.hostId}`,
            ':sk': 'META',
          },
        })
      );
      
      const host = hostResult.Items?.[0] as Host;
      if (host) {
        const hostName = isIndividualHost(host)
          ? `${host.forename} ${host.surname}`
          : host.legalName || host.displayName || host.businessName || 'Host';
          
        await sendListingRejectedEmail(
          host.email,
          host.preferredLanguage || 'sr',
          hostName,
          listing.listingName,
          rejectionReason
        );
        console.log(`📧 Rejection email sent to ${host.email}`);
      }
    } catch (emailError) {
      console.error('Failed to send rejection email:', emailError);
      // Don't fail the request if email fails
    }

    // 8. Log admin action
    logAdminAction(user, 'REJECT_LISTING', 'LISTING', listingId, {
      hostId: listing.hostId,
      rejectionReason,
    });

    // 9. Return success response
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        success: true,
        message: 'Listing rejected successfully',
      }),
    };
  } catch (error) {
    console.error('❌ Reject listing error:', error);

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
          message: 'Failed to reject listing',
        },
      }),
    };
  }
};

