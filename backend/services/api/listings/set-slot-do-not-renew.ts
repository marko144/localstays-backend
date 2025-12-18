/**
 * Set Slot Do Not Renew Lambda Handler
 * 
 * PUT /api/v1/hosts/{hostId}/listings/{listingId}/slot/do-not-renew
 * Body: { doNotRenew: boolean }
 * 
 * Allows hosts to toggle whether their listing's advertising slot
 * should be automatically renewed at subscription renewal.
 * 
 * When doNotRenew is true:
 * - The slot will NOT be extended at subscription renewal
 * - The ad will expire at its current expiry date
 * - The token will be freed when the slot expires
 * 
 * When doNotRenew is false:
 * - The slot WILL be extended at subscription renewal
 * - The ad will continue running as long as subscription is active
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

import { getAuthContext, assertCanAccessHost } from '../lib/auth';
import * as response from '../lib/response';
import { getSlotByListingId, setSlotDoNotRenew } from '../../lib/subscription-service';

const client = new DynamoDBClient({ region: process.env.AWS_REGION });
const docClient = DynamoDBDocumentClient.from(client);

const TABLE_NAME = process.env.TABLE_NAME!;

interface SetDoNotRenewRequest {
  doNotRenew: boolean;
}

interface SetDoNotRenewResponse {
  success: boolean;
  listingId: string;
  slotId: string;
  doNotRenew: boolean;
  expiresAt?: string;  // Undefined for commission-based slots
  message: string;
  message_sr: string;
}

/**
 * Main Lambda handler
 */
export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  console.log('Set slot do-not-renew request:', {
    path: event.path,
    method: event.httpMethod,
    pathParameters: event.pathParameters,
  });

  try {
    // 1. Extract authentication context
    const auth = getAuthContext(event);
    const hostId = event.pathParameters?.hostId;
    const listingId = event.pathParameters?.listingId;

    if (!hostId || !listingId) {
      return response.badRequest('hostId and listingId are required in path');
    }

    // 2. Verify authorization
    assertCanAccessHost(auth, hostId);

    // 3. Parse and validate request body
    let body: SetDoNotRenewRequest;
    try {
      body = JSON.parse(event.body || '{}');
    } catch {
      return response.badRequest('Invalid JSON in request body');
    }

    if (typeof body.doNotRenew !== 'boolean') {
      return response.badRequest('doNotRenew must be a boolean');
    }

    // 4. Verify listing exists and belongs to host
    const listingResult = await docClient.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: {
          pk: `HOST#${hostId}`,
          sk: `LISTING_META#${listingId}`,
        },
      })
    );

    if (!listingResult.Item) {
      return response.notFound('Listing not found');
    }

    // 5. Get the active slot for this listing
    const slot = await getSlotByListingId(listingId);

    if (!slot) {
      return response.badRequest(
        'No active advertising slot found for this listing',
        { message_sr: 'Nije pronađen aktivan oglasni slot za ovaj oglas' }
      );
    }

    // Verify slot belongs to this host
    if (slot.hostId !== hostId) {
      return response.forbidden('Slot does not belong to this host');
    }

    // 6. Update the slot
    await setSlotDoNotRenew(listingId, slot.slotId, body.doNotRenew);

    // 7. Also update the listing metadata to keep in sync
    const now = new Date().toISOString();
    await docClient.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: {
          pk: `HOST#${hostId}`,
          sk: `LISTING_META#${listingId}`,
        },
        UpdateExpression: 'SET slotDoNotRenew = :doNotRenew, updatedAt = :now',
        ExpressionAttributeValues: {
          ':doNotRenew': body.doNotRenew,
          ':now': now,
        },
      })
    );

    console.log(`✅ Set doNotRenew=${body.doNotRenew} for listing ${listingId}, slot ${slot.slotId}`);

    // 8. Build response
    const responseData: SetDoNotRenewResponse = {
      success: true,
      listingId,
      slotId: slot.slotId,
      doNotRenew: body.doNotRenew,
      expiresAt: slot.expiresAt,
      message: body.doNotRenew
        ? 'Ad will not be automatically renewed. It will expire on the shown date.'
        : 'Ad will be automatically renewed at your next subscription renewal.',
      message_sr: body.doNotRenew
        ? 'Oglas neće biti automatski obnovljen. Ističe na prikazani datum.'
        : 'Oglas će biti automatski obnovljen pri sledećem obnavljanju pretplate.',
    };

    return response.success(responseData);

  } catch (error: any) {
    console.error('Set slot do-not-renew error:', error);
    return response.handleError(error);
  }
}

