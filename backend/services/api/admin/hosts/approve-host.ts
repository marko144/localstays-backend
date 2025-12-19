/**
 * Admin API: Approve Host Profile
 * 
 * PUT /api/v1/admin/hosts/{hostId}/approve
 * 
 * Approves a host profile (VERIFICATION → VERIFIED).
 * Sends approval email notification.
 * Permission required: ADMIN_KYC_APPROVE
 */

import { APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { requirePermission, logAdminAction } from '../../lib/auth-middleware';
import { checkAndIncrementWriteOperationRateLimit, extractUserId } from '../../lib/write-operation-rate-limiter';
import { Host, isIndividualHost } from '../../../types/host.types';
import { sendHostProfileApprovedEmail } from '../../lib/email-service';
import { syncHostVerificationStatus } from '../../../lib/host-verification-sync';
import { sendTemplatedNotification } from '../../lib/notification-template-service';

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

const TABLE_NAME = process.env.TABLE_NAME!;

/**
 * Main handler
 */
export const handler: APIGatewayProxyHandler = async (event) => {
  console.log('Approve host request:', { pathParameters: event.pathParameters });

  try {
    // 1. Require admin permission
    const authResult = requirePermission(event, 'ADMIN_KYC_APPROVE');
    if ('error' in authResult) {
      return authResult.error;
    }

    const { user } = authResult;

    // 2. Check rate limit
    const userId = extractUserId(event);
    if (!userId) {
      return {
        statusCode: 401,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ success: false, error: { code: 'UNAUTHORIZED', message: 'User ID not found' } }),
      };
    }

    const rateLimitCheck = await checkAndIncrementWriteOperationRateLimit(userId, 'admin-approve-host');
    if (!rateLimitCheck.allowed) {
      console.warn('Rate limit exceeded for admin approve-host:', { userId, adminEmail: user.email });
      return {
        statusCode: 429,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ success: false, error: { code: 'RATE_LIMIT_EXCEEDED', message: rateLimitCheck.message || 'Rate limit exceeded' } }),
      };
    }

    // 3. Extract hostId from path
    const hostId = event.pathParameters?.hostId;

    if (!hostId) {
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
            message: 'hostId is required',
          },
        }),
      };
    }

    console.log(`Admin ${user.email} approving host: ${hostId}`);

    // 3. Fetch current host record
    const getResult = await docClient.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: {
          pk: `HOST#${hostId}`,
          sk: 'META',
        },
      })
    );

    if (!getResult.Item) {
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
            message: 'Host not found',
          },
        }),
      };
    }

    const host = getResult.Item as Host;

    // 4. Validate current status
    if (host.status !== 'VERIFICATION') {
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
            message: `Cannot approve host with status ${host.status}. Expected VERIFICATION.`,
          },
        }),
      };
    }

    // 5. Update host status
    const now = new Date().toISOString();

    await docClient.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: {
          pk: `HOST#${hostId}`,
          sk: 'META',
        },
        UpdateExpression: `
          SET #status = :status,
              #updatedAt = :updatedAt,
              #gsi2pk = :gsi2pk,
              #gsi2sk = :gsi2sk
        `,
        ExpressionAttributeNames: {
          '#status': 'status',
          '#updatedAt': 'updatedAt',
          '#gsi2pk': 'gsi2pk',
          '#gsi2sk': 'gsi2sk',
        },
        ExpressionAttributeValues: {
          ':status': 'VERIFIED',
          ':updatedAt': now,
          ':gsi2pk': 'HOST#VERIFIED',
          ':gsi2sk': now,
        },
      })
    );

    console.log(`✅ Host ${hostId} approved successfully`);

    // 6. Sync hostVerified flag for all ONLINE listings
    try {
      const syncCount = await syncHostVerificationStatus(hostId, 'VERIFIED');
      console.log(`✅ Synced hostVerified flag for ${syncCount} public listing record(s)`);
    } catch (syncError) {
      console.error('Failed to sync host verification status:', syncError);
      // Don't fail the request if sync fails - listings will be updated on next publish/update
    }

    // 7. Send approval email
    const hostName = isIndividualHost(host)
      ? `${host.forename} ${host.surname}`
      : host.legalName || host.displayName || host.businessName || 'Host';
    
    try {
      await sendHostProfileApprovedEmail(
        host.email,
        host.preferredLanguage || 'sr',
        hostName
      );
      console.log(`📧 Approval email sent to ${host.email}`);
    } catch (emailError) {
      console.error('Failed to send approval email:', emailError);
      // Don't fail the request if email fails
    }

    // 8. Send push notification
    if (host.ownerUserSub) {
      try {
        const pushResult = await sendTemplatedNotification(
          host.ownerUserSub,
          'HOST_APPROVED',
          host.preferredLanguage || 'sr',
          {}
        );
        console.log(`📱 Push notification sent: ${pushResult.sent} sent, ${pushResult.failed} failed`);
      } catch (pushError) {
        console.error('Failed to send push notification:', pushError);
        // Don't fail the request if push fails
      }
    }

    // 9. Log admin action
    logAdminAction(user, 'APPROVE_HOST', 'HOST', hostId);

    // 10. Return success response
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        success: true,
        message: 'Host profile approved successfully',
      }),
    };
  } catch (error) {
    console.error('❌ Approve host error:', error);

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
          message: 'Failed to approve host',
        },
      }),
    };
  }
};

