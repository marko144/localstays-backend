/**
 * Convert Slot Handler
 * 
 * POST /api/v1/hosts/{hostId}/listings/{listingId}/slot/convert
 * 
 * Converts a listing's advertising slot between subscription-based and commission-based models.
 * 
 * Request body:
 * {
 *   "toCommissionBased": boolean  // true = convert to commission, false = convert to subscription
 * }
 * 
 * Converting to subscription-based:
 * - Requires active subscription with available token
 * - Sets expiry based on billing period (full period from now)
 * 
 * Converting to commission-based:
 * - Removes expiry (slot runs indefinitely)
 * - Frees up a subscription token
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import * as response from '../lib/response';
import { getAuthContext, assertCanAccessHost } from '../lib/auth';
import {
  getSlotByHostAndListingId,
  getHostSubscription,
  getTokenAvailability,
  convertSlotToSubscriptionBased,
  convertSlotToCommissionBased,
  countCommissionBasedSlots,
} from '../../lib/subscription-service';
import { canPublishAds } from '../../types/subscription.types';

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client, {
  marshallOptions: { removeUndefinedValues: true },
});

const TABLE_NAME = process.env.TABLE_NAME!;
const MAX_COMMISSION_BASED_SLOTS = 100;

interface ConvertSlotRequest {
  toCommissionBased: boolean;
}

interface ConvertSlotResponse {
  success: boolean;
  message: string;
  slot: {
    slotId: string;
    listingId: string;
    isCommissionBased: boolean;
    expiresAt?: string;
  };
}

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  console.log('Convert slot request:', {
    hostId: event.pathParameters?.hostId,
    listingId: event.pathParameters?.listingId,
  });

  try {
    // 1. Authentication & Authorization
    const auth = getAuthContext(event);
    const hostId = event.pathParameters?.hostId;
    const listingId = event.pathParameters?.listingId;

    if (!hostId || !listingId) {
      return response.badRequest('hostId and listingId are required');
    }

    assertCanAccessHost(auth, hostId);

    // 2. Parse request body
    const body: ConvertSlotRequest = JSON.parse(event.body || '{}');
    
    if (typeof body.toCommissionBased !== 'boolean') {
      return response.badRequest('toCommissionBased (boolean) is required');
    }

    // 3. Get the current slot
    const slot = await getSlotByHostAndListingId(hostId, listingId);
    
    if (!slot) {
      return response.notFound('No active slot found for this listing');
    }

    // Verify the slot belongs to this host
    if (slot.hostId !== hostId) {
      return response.forbidden('Slot does not belong to this host');
    }

    const now = new Date().toISOString();

    // 4. Handle conversion
    if (body.toCommissionBased) {
      // Convert to commission-based
      if (slot.isCommissionBased) {
        return response.badRequest('Slot is already commission-based');
      }

      // Check commission slot limit
      const commissionSlotCount = await countCommissionBasedSlots(hostId);
      if (commissionSlotCount >= MAX_COMMISSION_BASED_SLOTS) {
        return response.badRequest(
          `Cannot convert to commission-based: maximum limit of ${MAX_COMMISSION_BASED_SLOTS} commission-based slots reached`,
          { message_sr: `Nije moguće konvertovati u besplatni oglas: dostignut maksimum od ${MAX_COMMISSION_BASED_SLOTS} besplatnih oglasa` }
        );
      }

      const updatedSlot = await convertSlotToCommissionBased(slot);

      // Update listing metadata
      await docClient.send(
        new UpdateCommand({
          TableName: TABLE_NAME,
          Key: {
            pk: `HOST#${hostId}`,
            sk: `LISTING_META#${listingId}`,
          },
          UpdateExpression: 'SET isCommissionBased = :isCommissionBased, updatedAt = :now REMOVE slotExpiresAt',
          ExpressionAttributeValues: {
            ':isCommissionBased': true,
            ':now': now,
          },
        })
      );

      console.log(`✅ Converted slot ${slot.slotId} to commission-based`);

      const responseData: ConvertSlotResponse = {
        success: true,
        message: 'Slot converted to commission-based successfully',
        slot: {
          slotId: updatedSlot.slotId,
          listingId: updatedSlot.listingId,
          isCommissionBased: true,
        },
      };

      return response.success(responseData);

    } else {
      // Convert to subscription-based
      if (!slot.isCommissionBased) {
        return response.badRequest('Slot is already subscription-based');
      }

      // Check subscription availability
      const subscription = await getHostSubscription(hostId);
      
      if (!subscription) {
        return response.badRequest(
          'No active subscription found. Please subscribe to convert to subscription-based.',
          { message_sr: 'Nije pronađena aktivna pretplata. Pretplatite se da biste konvertovali u pretplatni oglas.' }
        );
      }

      if (!canPublishAds(subscription)) {
        return response.badRequest(
          'Your subscription is not active. Please check your subscription status.',
          { message_sr: 'Vaša pretplata nije aktivna. Proverite status pretplate.' }
        );
      }

      // Check token availability
      const tokenAvailability = await getTokenAvailability(hostId);
      if (!tokenAvailability.canPublish) {
        return response.badRequest(
          'No tokens available. Please upgrade your plan or free up tokens.',
          { message_sr: 'Nema dostupnih tokena. Nadogradite plan ili oslobodite tokene.' }
        );
      }

      const updatedSlot = await convertSlotToSubscriptionBased(slot, subscription, subscription.planId);

      // Update listing metadata
      await docClient.send(
        new UpdateCommand({
          TableName: TABLE_NAME,
          Key: {
            pk: `HOST#${hostId}`,
            sk: `LISTING_META#${listingId}`,
          },
          UpdateExpression: 'SET isCommissionBased = :isCommissionBased, slotExpiresAt = :expiresAt, updatedAt = :now',
          ExpressionAttributeValues: {
            ':isCommissionBased': false,
            ':expiresAt': updatedSlot.expiresAt,
            ':now': now,
          },
        })
      );

      console.log(`✅ Converted slot ${slot.slotId} to subscription-based, expires: ${updatedSlot.expiresAt}`);

      const responseData: ConvertSlotResponse = {
        success: true,
        message: 'Slot converted to subscription-based successfully',
        slot: {
          slotId: updatedSlot.slotId,
          listingId: updatedSlot.listingId,
          isCommissionBased: false,
          expiresAt: updatedSlot.expiresAt,
        },
      };

      return response.success(responseData);
    }

  } catch (error) {
    console.error('Error converting slot:', error);
    
    if ((error as Error).message?.includes('already')) {
      return response.badRequest((error as Error).message);
    }
    
    return response.internalError('Failed to convert slot', error as Error);
  }
}

