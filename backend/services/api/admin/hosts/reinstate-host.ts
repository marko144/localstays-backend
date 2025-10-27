/**
 * Admin API: Reinstate Host Account
 * 
 * PUT /api/v1/admin/hosts/{hostId}/reinstate
 * 
 * Reinstates a suspended host account (SUSPENDED → VERIFIED).
 * Clears suspension fields.
 * Does NOT automatically set listings back to ONLINE (host must do this manually).
 * Permission required: ADMIN_HOST_REINSTATE
 */

import { APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { requirePermission, logAdminAction } from '../../lib/auth-middleware';
import { Host } from '../../../types/host.types';

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

const TABLE_NAME = process.env.TABLE_NAME!;

/**
 * Main handler
 */
export const handler: APIGatewayProxyHandler = async (event) => {
  console.log('Reinstate host request:', { pathParameters: event.pathParameters });

  try {
    // 1. Require admin permission
    const authResult = requirePermission(event, 'ADMIN_HOST_REINSTATE');
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

    console.log(`Admin ${user.email} reinstating host: ${hostId}`);

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
    if (host.status !== 'SUSPENDED') {
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
            message: `Cannot reinstate host with status ${host.status}. Expected SUSPENDED.`,
          },
        }),
      };
    }

    // 5. Update host status and clear suspension fields
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
              #gsi2sk = :gsi2sk,
              #suspendedAt = :null,
              #suspendedBy = :null,
              #suspendedReason = :null
        `,
        ExpressionAttributeNames: {
          '#status': 'status',
          '#updatedAt': 'updatedAt',
          '#gsi2pk': 'gsi2pk',
          '#gsi2sk': 'gsi2sk',
          '#suspendedAt': 'suspendedAt',
          '#suspendedBy': 'suspendedBy',
          '#suspendedReason': 'suspendedReason',
        },
        ExpressionAttributeValues: {
          ':status': 'VERIFIED',
          ':updatedAt': now,
          ':gsi2pk': 'HOST#VERIFIED',
          ':gsi2sk': now,
          ':null': null,
        },
      })
    );

    console.log(`✅ Host ${hostId} reinstated successfully`);

    // 6. Log admin action
    logAdminAction(user, 'REINSTATE_HOST', 'HOST', hostId);

    // 7. Return success response
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        success: true,
        message: 'Host account reinstated successfully',
      }),
    };
  } catch (error) {
    console.error('❌ Reinstate host error:', error);

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
          message: 'Failed to reinstate host',
        },
      }),
    };
  }
};















