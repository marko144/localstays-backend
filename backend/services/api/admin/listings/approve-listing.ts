/**
 * Admin API: Approve Listing
 * 
 * PUT /api/v1/admin/listings/{listingId}/approve
 * Body: { listingVerified: boolean }
 * 
 * Approves a listing (IN_REVIEW → APPROVED).
 * Admin explicitly sets whether the listing is verified.
 * Host can later manually set to ONLINE.
 * Sends approval email notification.
 * Permission required: ADMIN_LISTING_APPROVE
 */

import { APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { requirePermission, logAdminAction } from '../../lib/auth-middleware';
import { ListingMetadata } from '../../../types/listing.types';
import { Host, isIndividualHost } from '../../../types/host.types';
import { sendListingApprovedEmail } from '../../lib/email-service';
import { sendTemplatedNotification } from '../../lib/notification-template-service';

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

const TABLE_NAME = process.env.TABLE_NAME!;

/**
 * Validate request body
 */
function validateRequest(body: any): { valid: boolean; error?: string; listingVerified?: boolean } {
  if (!body) {
    return { valid: false, error: 'Request body is required' };
  }

  if (typeof body.listingVerified !== 'boolean') {
    return { valid: false, error: 'listingVerified is required and must be a boolean' };
  }

  return { valid: true, listingVerified: body.listingVerified };
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
  console.log('Approve listing request:', { pathParameters: event.pathParameters });

  try {
    // 1. Require admin permission
    const authResult = requirePermission(event, 'ADMIN_LISTING_APPROVE');
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

    console.log(`Admin ${user.email} approving listing: ${listingId}`);

    // 3. Validate request body
    const bodyValidation = validateRequest(event.body ? JSON.parse(event.body) : null);
    if (!bodyValidation.valid) {
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
            message: bodyValidation.error,
          },
        }),
      };
    }

    const listingVerified = bodyValidation.listingVerified!;
    console.log(`Setting listingVerified to: ${listingVerified}`);

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

    // 4. Validate current status (allow IN_REVIEW, REVIEWING, or LOCKED/SUSPENDED)
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
            message: `Cannot approve listing with status ${listing.status}. Expected one of: ${allowedStatuses.join(', ')}.`,
          },
        }),
      };
    }

    // 6. Update listing status and set listingVerified
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
              #listingVerified = :listingVerified,
              #approvedAt = :approvedAt,
              #updatedAt = :updatedAt,
              #gsi2pk = :gsi2pk,
              #gsi2sk = :gsi2sk
        `,
        ExpressionAttributeNames: {
          '#status': 'status',
          '#listingVerified': 'listingVerified',
          '#approvedAt': 'approvedAt',
          '#updatedAt': 'updatedAt',
          '#gsi2pk': 'gsi2pk',
          '#gsi2sk': 'gsi2sk',
        },
        ExpressionAttributeValues: {
          ':status': 'APPROVED',
          ':listingVerified': listingVerified,
          ':approvedAt': now,
          ':updatedAt': now,
          ':gsi2pk': 'LISTING_STATUS#APPROVED',
          ':gsi2sk': now,
        },
      })
    );

    console.log(`✅ Listing ${listingId} approved successfully (listingVerified=${listingVerified})`);

    // 7. Send approval email and push notification
    try {
      // Fetch host details for email and notification
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
          
        // Send email notification
        await sendListingApprovedEmail(
          host.email,
          host.preferredLanguage || 'sr',
          hostName,
          listing.listingName
        );
        console.log(`📧 Approval email sent to ${host.email}`);

        // Send push notification using template
        if (host.ownerUserSub) {
          try {
            const pushResult = await sendTemplatedNotification(
              host.ownerUserSub,
              'LISTING_APPROVED',
              host.preferredLanguage || 'sr',
              {
                listingName: listing.listingName,
                listingId: listingId,
              }
            );
            console.log(`📱 Push notification sent: ${pushResult.sent} sent, ${pushResult.failed} failed`);
          } catch (pushError) {
            console.error('Failed to send push notification:', pushError);
            // Don't fail the request if push notification fails
          }
        }
      }
    } catch (emailError) {
      console.error('Failed to send approval email:', emailError);
      // Don't fail the request if email fails
    }

    // 7. Log admin action
    logAdminAction(user, 'APPROVE_LISTING', 'LISTING', listingId, {
      hostId: listing.hostId,
    });

    // 8. Return success response
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        success: true,
        message: 'Listing approved successfully',
      }),
    };
  } catch (error) {
    console.error('❌ Approve listing error:', error);

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
          message: 'Failed to approve listing',
        },
      }),
    };
  }
};

