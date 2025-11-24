/**
 * Admin API: Reject Host Profile
 * 
 * PUT /api/v1/admin/hosts/{hostId}/reject
 * Body: { rejectionReason: string }
 * 
 * Rejects a host profile (VERIFICATION → REJECTED).
 * Sends rejection email notification with reason.
 * Permission required: ADMIN_KYC_REJECT
 */

import { APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { requirePermission, logAdminAction } from '../../lib/auth-middleware';
import { Host, isIndividualHost } from '../../../types/host.types';
import { RejectHostRequest } from '../../../types/admin.types';
import { sendHostProfileRejectedEmail } from '../../lib/email-service';
import { syncHostVerificationStatus } from '../../../lib/host-verification-sync';

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
 * Main handler
 */
export const handler: APIGatewayProxyHandler = async (event) => {
  console.log('Reject host request:', { 
    pathParameters: event.pathParameters,
    body: event.body ? JSON.parse(event.body) : null,
  });

  try {
    // 1. Require admin permission
    const authResult = requirePermission(event, 'ADMIN_KYC_REJECT');
    if ('error' in authResult) {
      return authResult.error;
    }

    const { user } = authResult;

    // 2. Extract hostId from path
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

    // 3. Parse and validate request body
    let body: RejectHostRequest;
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

    console.log(`Admin ${user.email} rejecting host: ${hostId}`);

    // 4. Fetch current host record
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

    // 5. Validate current status
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
            message: `Cannot reject host with status ${host.status}. Expected VERIFICATION.`,
          },
        }),
      };
    }

    // 6. Update host status with rejection reason
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
              #rejectionReason = :rejectionReason,
              #updatedAt = :updatedAt,
              #gsi2pk = :gsi2pk,
              #gsi2sk = :gsi2sk
        `,
        ExpressionAttributeNames: {
          '#status': 'status',
          '#rejectionReason': 'rejectionReason',
          '#updatedAt': 'updatedAt',
          '#gsi2pk': 'gsi2pk',
          '#gsi2sk': 'gsi2sk',
        },
        ExpressionAttributeValues: {
          ':status': 'REJECTED',
          ':rejectionReason': rejectionReason,
          ':updatedAt': now,
          ':gsi2pk': 'HOST#REJECTED',
          ':gsi2sk': now,
        },
      })
    );

    console.log(`✅ Host ${hostId} rejected successfully`);

    // 7. Sync hostVerified flag for all ONLINE listings
    try {
      const syncCount = await syncHostVerificationStatus(hostId, 'REJECTED');
      console.log(`✅ Synced hostVerified flag for ${syncCount} public listing record(s)`);
    } catch (syncError) {
      console.error('Failed to sync host verification status:', syncError);
      // Don't fail the request if sync fails - listings will be updated on next publish/update
    }

    // 8. Send rejection email
    const hostName = isIndividualHost(host)
      ? `${host.forename} ${host.surname}`
      : host.legalName || host.displayName || host.businessName || 'Host';
    
    try {
      await sendHostProfileRejectedEmail(
        host.email,
        host.preferredLanguage || 'sr',
        hostName,
        rejectionReason
      );
      console.log(`📧 Rejection email sent to ${host.email}`);
    } catch (emailError) {
      console.error('Failed to send rejection email:', emailError);
      // Don't fail the request if email fails
    }

    // 9. Log admin action
    logAdminAction(user, 'REJECT_HOST', 'HOST', hostId, {
      rejectionReason,
    });

    // 10. Return success response
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        success: true,
        message: 'Host profile rejected successfully',
      }),
    };
  } catch (error) {
    console.error('❌ Reject host error:', error);

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
          message: 'Failed to reject host',
        },
      }),
    };
  }
};

