/**
 * Admin API: Update Host Online Payment Status
 * 
 * PUT /api/v1/admin/hosts/{hostId}/online-payment
 * 
 * Updates a host's online payment handling status.
 * Transitions: REQUESTED → APPROVED or REQUESTED → REJECTED
 * Permission required: ADMIN_KYC_APPROVE
 */

import { APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { requirePermission, logAdminAction } from '../../lib/auth-middleware';
import { checkAndIncrementWriteOperationRateLimit, extractUserId } from '../../lib/write-operation-rate-limiter';
import { Host, OnlinePaymentStatus } from '../../../types/host.types';

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

const TABLE_NAME = process.env.TABLE_NAME!;

// Valid status transitions
const VALID_TRANSITIONS: Record<OnlinePaymentStatus, OnlinePaymentStatus[]> = {
  'NOT_REQUESTED': [], // Cannot be changed by admin (only by host request)
  'REQUESTED': ['APPROVED', 'REJECTED'],
  'APPROVED': ['REJECTED'], // Allow revoking approval
  'REJECTED': ['APPROVED'], // Allow reconsidering rejection
};

interface UpdateOnlinePaymentRequest {
  status: 'APPROVED' | 'REJECTED';
  reason?: string; // Required when rejecting
}

/**
 * Main handler
 */
export const handler: APIGatewayProxyHandler = async (event) => {
  console.log('Update online payment status request:', { pathParameters: event.pathParameters });

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
      console.warn('Rate limit exceeded for admin update-online-payment:', { userId, adminEmail: user.email });
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
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'hostId is required' },
        }),
      };
    }

    // 4. Parse request body
    if (!event.body) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Request body is required' },
        }),
      };
    }

    let requestBody: UpdateOnlinePaymentRequest;
    try {
      requestBody = JSON.parse(event.body);
    } catch {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Invalid JSON in request body' },
        }),
      };
    }

    const { status, reason } = requestBody;

    // 5. Validate new status
    if (!status || !['APPROVED', 'REJECTED'].includes(status)) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'status must be APPROVED or REJECTED' },
        }),
      };
    }

    // 6. Validate reason is provided when rejecting
    if (status === 'REJECTED' && (!reason || reason.trim().length === 0)) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'reason is required when rejecting' },
        }),
      };
    }

    // 7. Validate reason length
    if (reason && reason.length > 500) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'reason must be 500 characters or less' },
        }),
      };
    }

    console.log(`Admin ${user.email} updating online payment status for host: ${hostId} to ${status}`);

    // 8. Fetch current host record
    const getResult = await docClient.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: { pk: `HOST#${hostId}`, sk: 'META' },
      })
    );

    if (!getResult.Item) {
      return {
        statusCode: 404,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Host not found' },
        }),
      };
    }

    const host = getResult.Item as Host;
    const currentStatus = host.onlinePaymentStatus || 'NOT_REQUESTED';

    // 9. Validate status transition
    const allowedTransitions = VALID_TRANSITIONS[currentStatus] || [];
    if (!allowedTransitions.includes(status)) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({
          success: false,
          error: {
            code: 'INVALID_STATUS_TRANSITION',
            message: `Cannot transition from ${currentStatus} to ${status}. Allowed transitions: ${allowedTransitions.join(', ') || 'none'}`,
          },
        }),
      };
    }

    // 10. Update host record
    const now = new Date().toISOString();

    if (status === 'APPROVED') {
      await docClient.send(
        new UpdateCommand({
          TableName: TABLE_NAME,
          Key: { pk: `HOST#${hostId}`, sk: 'META' },
          UpdateExpression: `
            SET onlinePaymentStatus = :status,
                onlinePaymentDecidedAt = :decidedAt,
                onlinePaymentDecidedBy = :decidedBy,
                onlinePaymentRejectReason = :rejectReason,
                updatedAt = :updatedAt
          `,
          ExpressionAttributeValues: {
            ':status': 'APPROVED',
            ':decidedAt': now,
            ':decidedBy': user.sub,
            ':rejectReason': null, // Clear any previous rejection reason
            ':updatedAt': now,
          },
        })
      );
    } else {
      // REJECTED
      await docClient.send(
        new UpdateCommand({
          TableName: TABLE_NAME,
          Key: { pk: `HOST#${hostId}`, sk: 'META' },
          UpdateExpression: `
            SET onlinePaymentStatus = :status,
                onlinePaymentDecidedAt = :decidedAt,
                onlinePaymentDecidedBy = :decidedBy,
                onlinePaymentRejectReason = :rejectReason,
                updatedAt = :updatedAt
          `,
          ExpressionAttributeValues: {
            ':status': 'REJECTED',
            ':decidedAt': now,
            ':decidedBy': user.sub,
            ':rejectReason': reason!.trim(),
            ':updatedAt': now,
          },
        })
      );
    }

    console.log(`✅ Host ${hostId} online payment status updated: ${currentStatus} → ${status}`);

    // 11. Log admin action
    logAdminAction(user, 'UPDATE_ONLINE_PAYMENT_STATUS', 'HOST', hostId, {
      previousStatus: currentStatus,
      newStatus: status,
      reason: status === 'REJECTED' ? reason : undefined,
    });

    // 12. Return success response
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({
        success: true,
        message: `Online payment status updated to ${status}`,
        previousStatus: currentStatus,
        newStatus: status,
      }),
    };
  } catch (error) {
    console.error('❌ Update online payment status error:', error);

    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to update online payment status' },
      }),
    };
  }
};



