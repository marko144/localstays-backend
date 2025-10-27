/**
 * Admin API: Suspend Host Account
 * 
 * PUT /api/v1/admin/hosts/{hostId}/suspend
 * Body: { suspendedReason: string }
 * 
 * Suspends a host account (Any status → SUSPENDED).
 * Sets all ONLINE listings to OFFLINE.
 * Sends suspension email notification with reason.
 * Permission required: ADMIN_HOST_SUSPEND
 */

import { APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand, QueryCommand, BatchWriteCommand } from '@aws-sdk/lib-dynamodb';
import { requirePermission, logAdminAction } from '../../lib/auth-middleware';
import { Host, isIndividualHost } from '../../../types/host.types';
import { ListingMetadata } from '../../../types/listing.types';
import { SuspendHostRequest } from '../../../types/admin.types';
import { sendHostSuspendedEmail } from '../../lib/email-service';

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

  if (!body.suspendedReason || typeof body.suspendedReason !== 'string') {
    return { valid: false, error: 'suspendedReason is required and must be a string' };
  }

  const trimmedReason = body.suspendedReason.trim();

  if (trimmedReason.length === 0) {
    return { valid: false, error: 'suspendedReason cannot be empty' };
  }

  if (trimmedReason.length > MAX_REASON_LENGTH) {
    return { 
      valid: false, 
      error: `suspendedReason must be ${MAX_REASON_LENGTH} characters or less` 
    };
  }

  return { valid: true };
}

/**
 * Get all ONLINE listings for a host
 */
async function getOnlineListings(hostId: string): Promise<ListingMetadata[]> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :sk)',
      FilterExpression: '#status = :status AND isDeleted = :isDeleted',
      ExpressionAttributeNames: {
        '#status': 'status',
      },
      ExpressionAttributeValues: {
        ':pk': `HOST#${hostId}`,
        ':sk': 'LISTING_META#',
        ':status': 'ONLINE',
        ':isDeleted': false,
      },
    })
  );

  return (result.Items || []) as ListingMetadata[];
}

/**
 * Set all ONLINE listings to OFFLINE
 */
async function setListingsOffline(listings: ListingMetadata[], now: string): Promise<number> {
  if (listings.length === 0) {
    return 0;
  }

  // DynamoDB BatchWrite can handle max 25 items at a time
  const batchSize = 25;
  let updatedCount = 0;

  for (let i = 0; i < listings.length; i += batchSize) {
    const batch = listings.slice(i, i + batchSize);
    
    const writeRequests = batch.map(listing => ({
      PutRequest: {
        Item: {
          ...listing,
          status: 'OFFLINE',
          updatedAt: now,
          // Update GSI2 for status queries
          gsi2pk: 'LISTING_STATUS#OFFLINE',
          gsi2sk: now,
        },
      },
    }));

    await docClient.send(
      new BatchWriteCommand({
        RequestItems: {
          [TABLE_NAME]: writeRequests,
        },
      })
    );

    updatedCount += batch.length;
  }

  return updatedCount;
}

/**
 * Main handler
 */
export const handler: APIGatewayProxyHandler = async (event) => {
  console.log('Suspend host request:', { 
    pathParameters: event.pathParameters,
    body: event.body ? JSON.parse(event.body) : null,
  });

  try {
    // 1. Require admin permission
    const authResult = requirePermission(event, 'ADMIN_HOST_SUSPEND');
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
    let body: SuspendHostRequest;
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

    const suspendedReason = body.suspendedReason.trim();

    console.log(`Admin ${user.email} suspending host: ${hostId}`);

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

    // 5. Check if already suspended
    if (host.status === 'SUSPENDED') {
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
            message: 'Host is already suspended',
          },
        }),
      };
    }

    const now = new Date().toISOString();

    // 6. Get all ONLINE listings
    console.log('Fetching ONLINE listings...');
    const onlineListings = await getOnlineListings(hostId);
    console.log(`Found ${onlineListings.length} ONLINE listings`);

    // 7. Set all ONLINE listings to OFFLINE
    let listingsUpdatedCount = 0;
    if (onlineListings.length > 0) {
      console.log('Setting listings to OFFLINE...');
      listingsUpdatedCount = await setListingsOffline(onlineListings, now);
      console.log(`✅ Set ${listingsUpdatedCount} listings to OFFLINE`);
    }

    // 8. Update host status
    await docClient.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: {
          pk: `HOST#${hostId}`,
          sk: 'META',
        },
        UpdateExpression: `
          SET #status = :status,
              #suspendedAt = :suspendedAt,
              #suspendedBy = :suspendedBy,
              #suspendedReason = :suspendedReason,
              #updatedAt = :updatedAt,
              #gsi2pk = :gsi2pk,
              #gsi2sk = :gsi2sk
        `,
        ExpressionAttributeNames: {
          '#status': 'status',
          '#suspendedAt': 'suspendedAt',
          '#suspendedBy': 'suspendedBy',
          '#suspendedReason': 'suspendedReason',
          '#updatedAt': 'updatedAt',
          '#gsi2pk': 'gsi2pk',
          '#gsi2sk': 'gsi2sk',
        },
        ExpressionAttributeValues: {
          ':status': 'SUSPENDED',
          ':suspendedAt': now,
          ':suspendedBy': user.sub,
          ':suspendedReason': suspendedReason,
          ':updatedAt': now,
          ':gsi2pk': 'HOST#SUSPENDED',
          ':gsi2sk': now,
        },
      })
    );

    console.log(`✅ Host ${hostId} suspended successfully`);

    // 9. Send suspension email
    const hostName = isIndividualHost(host)
      ? `${host.forename} ${host.surname}`
      : host.legalName || host.displayName || host.businessName || 'Host';
    
    try {
      await sendHostSuspendedEmail(
        host.email,
        host.preferredLanguage || 'sr',
        hostName,
        suspendedReason
      );
      console.log(`📧 Suspension email sent to ${host.email}`);
    } catch (emailError) {
      console.error('Failed to send suspension email:', emailError);
      // Don't fail the request if email fails
    }

    // 10. Log admin action
    logAdminAction(user, 'SUSPEND_HOST', 'HOST', hostId, {
      suspendedReason,
      listingsSetOffline: listingsUpdatedCount,
    });

    // 11. Return success response
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        success: true,
        message: 'Host account suspended successfully',
        data: {
          listingsSetOffline: listingsUpdatedCount,
        },
      }),
    };
  } catch (error) {
    console.error('❌ Suspend host error:', error);

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
          message: 'Failed to suspend host',
        },
      }),
    };
  }
};

