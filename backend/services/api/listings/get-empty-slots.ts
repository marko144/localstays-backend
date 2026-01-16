/**
 * Get Empty Slots
 * 
 * GET /api/v1/hosts/{hostId}/slots/empty
 * 
 * Returns available empty slots (token-based slots with no listing attached).
 * Used by frontend to show reusable slots when host has no available tokens.
 * 
 * Empty slots:
 * - Are created when a listing with a token-based slot is deleted
 * - Can be reused when publishing a new listing
 * - Retain their original expiry date
 * - Are deleted at subscription renewal
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getAuthContext, assertCanAccessHost } from '../lib/auth';
import * as response from '../lib/response';
import { getHostEmptySlots } from '../../lib/subscription-service';
import { calculateDaysRemaining } from '../../types/advertising-slot.types';

interface EmptySlotResponse {
  slotId: string;
  expiresAt: string;
  daysRemaining: number;
  activatedAt: string;
  createdAt: string;
}

interface GetEmptySlotsResponse {
  slots: EmptySlotResponse[];
  count: number;
}

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  console.log('Get empty slots request:', {
    requestId: event.requestContext.requestId,
    hostId: event.pathParameters?.hostId,
  });

  try {
    // 1. Authentication & Authorization
    const auth = getAuthContext(event);
    const hostId = event.pathParameters?.hostId;

    if (!hostId) {
      return response.badRequest('hostId is required in path');
    }

    assertCanAccessHost(auth, hostId);

    // 2. Get empty slots
    const emptySlots = await getHostEmptySlots(hostId);

    console.log(`Found ${emptySlots.length} empty slots for host ${hostId}`);

    // 3. Transform to response format
    const slots: EmptySlotResponse[] = emptySlots
      .filter(slot => slot.expiresAt) // Should always have expiresAt for token-based
      .map(slot => ({
        slotId: slot.slotId,
        expiresAt: slot.expiresAt!,
        daysRemaining: calculateDaysRemaining(slot.expiresAt) || 0,
        activatedAt: slot.activatedAt,
        createdAt: slot.createdAt,
      }))
      .sort((a, b) => b.daysRemaining - a.daysRemaining); // Longest expiry first

    const responseData: GetEmptySlotsResponse = {
      slots,
      count: slots.length,
    };

    return response.success(responseData);

  } catch (error: any) {
    console.error('Get empty slots error:', error);
    return response.handleError(error);
  }
}



