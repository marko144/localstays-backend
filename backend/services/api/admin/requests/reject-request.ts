/**
 * Admin API: Reject Request
 * 
 * PUT /api/v1/admin/requests/{requestId}/reject
 * Body: { rejectionReason: string }
 * 
 * Rejects a request (RECEIVED → REJECTED).
 * Sends rejection email notification with reason.
 * Permission required: ADMIN_REQUEST_REJECT
 */

import { APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { requirePermission, logAdminAction } from '../../lib/auth-middleware';
import { Request } from '../../../types/request.types';
import { RejectRequestRequest } from '../../../types/admin.types';
import { Host, isIndividualHost } from '../../../types/host.types';
import { sendRequestRejectedEmail } from '../../lib/email-service';

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
 * Find request by requestId
 */
async function findRequest(requestId: string): Promise<Request | null> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: 'DocumentStatusIndex',  // GSI3
      KeyConditionExpression: 'gsi3pk = :gsi3pk AND begins_with(gsi3sk, :gsi3sk)',
      ExpressionAttributeValues: {
        ':gsi3pk': `REQUEST#${requestId}`,
        ':gsi3sk': 'REQUEST_META#',
      },
      Limit: 1,
    })
  );

  if (!result.Items || result.Items.length === 0) {
    return null;
  }

  return result.Items[0] as Request;
}

/**
 * Main handler
 */
export const handler: APIGatewayProxyHandler = async (event) => {
  console.log('Reject request request:', { 
    pathParameters: event.pathParameters,
    body: event.body ? JSON.parse(event.body) : null,
  });

  try {
    // 1. Require admin permission
    const authResult = requirePermission(event, 'ADMIN_REQUEST_REJECT');
    if ('error' in authResult) {
      return authResult.error;
    }

    const { user } = authResult;

    // 2. Extract requestId from path
    const requestId = event.pathParameters?.requestId;

    if (!requestId) {
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
            message: 'requestId is required',
          },
        }),
      };
    }

    // 3. Parse and validate request body
    let body: RejectRequestRequest;
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

    console.log(`Admin ${user.email} rejecting request: ${requestId}`);

    // 4. Find request
    const request = await findRequest(requestId);

    if (!request) {
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
            message: 'Request not found',
          },
        }),
      };
    }

    // 5. Validate current status
    if (request.status !== 'RECEIVED' && request.status !== 'PENDING_REVIEW') {
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
            message: `Cannot reject request with status ${request.status}. Expected RECEIVED or PENDING_REVIEW.`,
          },
        }),
      };
    }

    // 6. Update request status with rejection reason
    const now = new Date().toISOString();

    await docClient.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: {
          pk: `HOST#${request.hostId}`,
          sk: `REQUEST#${requestId}`,
        },
        UpdateExpression: `
          SET #status = :status,
              #reviewedAt = :reviewedAt,
              #reviewedBy = :reviewedBy,
              #rejectionReason = :rejectionReason,
              #updatedAt = :updatedAt,
              #gsi2sk = :gsi2sk
        `,
        ExpressionAttributeNames: {
          '#status': 'status',
          '#reviewedAt': 'reviewedAt',
          '#reviewedBy': 'reviewedBy',
          '#rejectionReason': 'rejectionReason',
          '#updatedAt': 'updatedAt',
          '#gsi2sk': 'gsi2sk',
        },
        ExpressionAttributeValues: {
          ':status': 'REJECTED',
          ':reviewedAt': now,
          ':reviewedBy': user.sub,
          ':rejectionReason': rejectionReason,
          ':updatedAt': now,
          ':gsi2sk': `STATUS#REJECTED#${now}`,
        },
      })
    );

    console.log(`✅ Request ${requestId} rejected successfully`);

    // 7. Send rejection email
    try {
      // Fetch host details for email
      const hostResult = await docClient.send(
        new QueryCommand({
          TableName: TABLE_NAME,
          KeyConditionExpression: 'pk = :pk AND sk = :sk',
          ExpressionAttributeValues: {
            ':pk': `HOST#${request.hostId}`,
            ':sk': 'META',
          },
        })
      );
      
      const host = hostResult.Items?.[0] as Host;
      if (host) {
        const hostName = isIndividualHost(host)
          ? `${host.forename} ${host.surname}`
          : host.legalName || host.displayName || host.businessName || 'Host';
          
        await sendRequestRejectedEmail(
          host.email,
          host.preferredLanguage || 'sr',
          hostName,
          rejectionReason
        );
        console.log(`📧 Rejection email sent to ${host.email}`);
      }
    } catch (emailError) {
      console.error('Failed to send rejection email:', emailError);
      // Don't fail the request if email fails
    }

    // 8. Log admin action
    logAdminAction(user, 'REJECT_REQUEST', 'REQUEST', requestId, {
      hostId: request.hostId,
      requestType: request.requestType,
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
        message: 'Request rejected successfully',
      }),
    };
  } catch (error) {
    console.error('❌ Reject request error:', error);

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
          message: 'Failed to reject request',
        },
      }),
    };
  }
};

