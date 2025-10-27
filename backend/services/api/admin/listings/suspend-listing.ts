/**
 * Admin API: Suspend Listing
 * 
 * PUT /api/v1/admin/listings/{listingId}/suspend
 * Body: { lockReason: string }
 * 
 * Suspends/locks a listing (ONLINE or APPROVED → LOCKED).
 * Sends suspension email notification with reason.
 * Permission required: ADMIN_LISTING_SUSPEND
 */

import { APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { requirePermission, logAdminAction } from '../../lib/auth-middleware';
import { ListingMetadata } from '../../../types/listing.types';
import { SuspendListingRequest } from '../../../types/admin.types';
import { Host, isIndividualHost } from '../../../types/host.types';
import { sendListingSuspendedEmail } from '../../lib/email-service';

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

const TABLE_NAME = process.env.TABLE_NAME!;
const MAX_REASON_LENGTH = 500;

/**
 * Validate request body
 */
function validateRequest(body: any): { valid: boolean; error?: string } {
  if (!body) {
    return { valid: false, error: 'Request body is required' };
  }

  if (!body.lockReason || typeof body.lockReason !== 'string') {
    return { valid: false, error: 'lockReason is required and must be a string' };
  }

  const trimmedReason = body.lockReason.trim();

  if (trimmedReason.length === 0) {
    return { valid: false, error: 'lockReason cannot be empty' };
  }

  if (trimmedReason.length > MAX_REASON_LENGTH) {
    return { 
      valid: false, 
      error: `lockReason must be ${MAX_REASON_LENGTH} characters or less` 
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
  console.log('Suspend listing request:', { 
    pathParameters: event.pathParameters,
    body: event.body ? JSON.parse(event.body) : null,
  });

  try {
    // 1. Require admin permission
    const authResult = requirePermission(event, 'ADMIN_LISTING_SUSPEND');
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
    let body: SuspendListingRequest;
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

    const lockReason = body.lockReason.trim();

    console.log(`Admin ${user.email} suspending listing: ${listingId}`);

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

    // 5. Validate current status (can only suspend ONLINE or APPROVED listings)
    if (listing.status !== 'ONLINE' && listing.status !== 'APPROVED') {
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
            message: `Cannot suspend listing with status ${listing.status}. Expected ONLINE or APPROVED.`,
          },
        }),
      };
    }

    // 6. Update listing status with lock reason
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
              #lockedAt = :lockedAt,
              #lockedBy = :lockedBy,
              #lockReason = :lockReason,
              #updatedAt = :updatedAt,
              #gsi2pk = :gsi2pk,
              #gsi2sk = :gsi2sk
        `,
        ExpressionAttributeNames: {
          '#status': 'status',
          '#lockedAt': 'lockedAt',
          '#lockedBy': 'lockedBy',
          '#lockReason': 'lockReason',
          '#updatedAt': 'updatedAt',
          '#gsi2pk': 'gsi2pk',
          '#gsi2sk': 'gsi2sk',
        },
        ExpressionAttributeValues: {
          ':status': 'LOCKED',
          ':lockedAt': now,
          ':lockedBy': user.sub,
          ':lockReason': lockReason,
          ':updatedAt': now,
          ':gsi2pk': 'LISTING_STATUS#LOCKED',
          ':gsi2sk': now,
        },
      })
    );

    console.log(`✅ Listing ${listingId} suspended successfully`);

    // 7. Send suspension email
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
          
        await sendListingSuspendedEmail(
          host.email,
          host.preferredLanguage || 'sr',
          hostName,
          listing.listingName,
          lockReason
        );
        console.log(`📧 Suspension email sent to ${host.email}`);
      }
    } catch (emailError) {
      console.error('Failed to send suspension email:', emailError);
      // Don't fail the request if email fails
    }

    // 8. Log admin action
    logAdminAction(user, 'SUSPEND_LISTING', 'LISTING', listingId, {
      hostId: listing.hostId,
      lockReason,
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
        message: 'Listing suspended successfully',
      }),
    };
  } catch (error) {
    console.error('❌ Suspend listing error:', error);

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
          message: 'Failed to suspend listing',
        },
      }),
    };
  }
};

