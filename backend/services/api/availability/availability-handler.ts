/**
 * Host API: Availability Management
 * 
 * Handles all availability-related operations for hosts:
 * - GET    /api/v1/hosts/{hostId}/availability
 * - GET    /api/v1/hosts/{hostId}/listings/{listingId}/availability
 * - POST   /api/v1/hosts/{hostId}/listings/{listingId}/availability/block
 * - DELETE /api/v1/hosts/{hostId}/listings/{listingId}/availability/unblock
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { getAuthContext, assertCanAccessHost } from '../lib/auth';
import * as response from '../lib/response';
import { ListingMetadata } from '../../types/listing.types';
import { AvailabilityRecord } from '../../types/availability.types';
import {
  getHostAvailability,
  getListingAvailability,
  blockDates,
  unblockDateRange,
} from './lib/availability-service';

const client = new DynamoDBClient({ region: process.env.AWS_REGION });
const docClient = DynamoDBDocumentClient.from(client);
const TABLE_NAME = process.env.TABLE_NAME!;

/**
 * Verify host owns the listing
 */
async function verifyListingOwnership(hostId: string, listingId: string): Promise<ListingMetadata> {
  const result = await docClient.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: {
        pk: `HOST#${hostId}`,
        sk: `LISTING_META#${listingId}`,
      },
    })
  );

  if (!result.Item) {
    throw new Error('LISTING_NOT_FOUND');
  }

  const listing = result.Item as ListingMetadata;

  if (listing.isDeleted) {
    throw new Error('LISTING_DELETED');
  }

  return listing;
}

/**
 * Group availability records by listing
 */
function groupByListing(records: AvailabilityRecord[]): Record<string, AvailabilityRecord[]> {
  const grouped: Record<string, AvailabilityRecord[]> = {};

  for (const record of records) {
    if (!grouped[record.listingId]) {
      grouped[record.listingId] = [];
    }
    grouped[record.listingId].push(record);
  }

  return grouped;
}

/**
 * Handler: Get all availability for host
 * GET /api/v1/hosts/{hostId}/availability?startDate=2025-01-10&endDate=2025-01-31
 */
async function handleGetHostAvailability(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  try {
    // 1. Authentication & Authorization
    const auth = getAuthContext(event);
    const hostId = event.pathParameters?.hostId;

    if (!hostId) {
      return response.badRequest('hostId is required');
    }

    assertCanAccessHost(auth, hostId);

    // 2. Get query parameters
    const startDate = event.queryStringParameters?.startDate;
    const endDate = event.queryStringParameters?.endDate;

    console.log(`Getting availability for host ${hostId}`, { startDate, endDate });

    // 3. Query availability
    const records = await getHostAvailability(docClient, hostId, startDate, endDate);

    // 4. Group by listing
    const groupedRecords = groupByListing(records);

    return response.success({
      hostId,
      dateRange: {
        startDate: startDate || null,
        endDate: endDate || null,
      },
      listings: Object.keys(groupedRecords).map(listingId => ({
        listingId,
        unavailableDates: groupedRecords[listingId],
      })),
      totalRecords: records.length,
    });
  } catch (error: any) {
    console.error('Get host availability error:', error);
    return response.internalError(error.message || 'Failed to get availability');
  }
}

/**
 * Handler: Get availability for specific listing
 * GET /api/v1/hosts/{hostId}/listings/{listingId}/availability?startDate=2025-01-10&endDate=2025-01-31
 */
async function handleGetListingAvailability(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  try {
    // 1. Authentication & Authorization
    const auth = getAuthContext(event);
    const hostId = event.pathParameters?.hostId;
    const listingId = event.pathParameters?.listingId;

    if (!hostId || !listingId) {
      return response.badRequest('hostId and listingId are required');
    }

    assertCanAccessHost(auth, hostId);

    // 2. Verify listing ownership
    await verifyListingOwnership(hostId, listingId);

    // 3. Get query parameters
    const startDate = event.queryStringParameters?.startDate;
    const endDate = event.queryStringParameters?.endDate;

    console.log(`Getting availability for listing ${listingId}`, { startDate, endDate });

    // 4. Query availability
    const records = await getListingAvailability(docClient, listingId, startDate, endDate);

    return response.success({
      listingId,
      dateRange: {
        startDate: startDate || null,
        endDate: endDate || null,
      },
      unavailableDates: records,
      totalRecords: records.length,
    });
  } catch (error: any) {
    console.error('Get listing availability error:', error);

    if (error.message === 'LISTING_NOT_FOUND') {
      return response.notFound('Listing not found');
    }

    if (error.message === 'LISTING_DELETED') {
      return response.badRequest('Listing has been deleted');
    }

    return response.internalError(error.message || 'Failed to get availability');
  }
}

/**
 * Handler: Block dates for listing
 * POST /api/v1/hosts/{hostId}/listings/{listingId}/availability/block
 * Body: { startDate: "2025-01-10", endDate?: "2025-01-15" }
 * 
 * endDate is optional - if not provided, only startDate will be blocked (single day)
 */
async function handleBlockDates(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  try {
    // 1. Authentication & Authorization
    const auth = getAuthContext(event);
    const hostId = event.pathParameters?.hostId;
    const listingId = event.pathParameters?.listingId;

    if (!hostId || !listingId) {
      return response.badRequest('hostId and listingId are required');
    }

    assertCanAccessHost(auth, hostId);

    // 2. Verify listing ownership
    await verifyListingOwnership(hostId, listingId);

    // 3. Parse request body
    if (!event.body) {
      return response.badRequest('Request body is required');
    }

    const body = JSON.parse(event.body);
    const { startDate, endDate } = body;

    if (!startDate) {
      return response.badRequest('startDate is required');
    }

    console.log(`Blocking dates for listing ${listingId}`, { 
      startDate, 
      endDate: endDate || startDate,
      isSingleDay: !endDate 
    });

    // 4. Block dates (endDate is optional, defaults to startDate in service)
    const result = await blockDates(docClient, listingId, hostId, startDate, endDate);

    return response.success({
      message: endDate ? 'Date range blocked successfully' : 'Date blocked successfully',
      blockId: result.blockId,
      listingId,
      dateRange: {
        startDate,
        endDate: endDate || startDate,
      },
      nightsBlocked: result.nightsBlocked,
      totalNights: result.nightsBlocked.length,
    });
  } catch (error: any) {
    console.error('Block dates error:', error);

    if (error.message === 'LISTING_NOT_FOUND') {
      return response.notFound('Listing not found');
    }

    if (error.message === 'LISTING_DELETED') {
      return response.badRequest('Listing has been deleted');
    }

    // Validation errors
    if (error.message.includes('Invalid date') || 
        error.message.includes('cannot be in the past') ||
        error.message.includes('cannot be more than') ||
        error.message.includes('must be before') ||
        error.message.includes('already unavailable')) {
      return response.badRequest(error.message);
    }

    return response.internalError(error.message || 'Failed to block dates');
  }
}

/**
 * Handler: Unblock date range for listing
 * DELETE /api/v1/hosts/{hostId}/listings/{listingId}/availability/unblock
 * Body: { startDate: "2025-01-10", endDate?: "2025-01-15" }
 * 
 * endDate is optional - if not provided, only startDate will be unblocked (single day)
 */
async function handleUnblockDates(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  try {
    // 1. Authentication & Authorization
    const auth = getAuthContext(event);
    const hostId = event.pathParameters?.hostId;
    const listingId = event.pathParameters?.listingId;

    if (!hostId || !listingId) {
      return response.badRequest('hostId and listingId are required');
    }

    assertCanAccessHost(auth, hostId);

    // 2. Verify listing ownership
    await verifyListingOwnership(hostId, listingId);

    // 3. Parse request body
    if (!event.body) {
      return response.badRequest('Request body is required');
    }

    const body = JSON.parse(event.body);
    const { startDate, endDate } = body;

    if (!startDate) {
      return response.badRequest('startDate is required');
    }

    console.log(`Unblocking dates for listing ${listingId}`, { 
      startDate, 
      endDate: endDate || startDate,
      isSingleDay: !endDate 
    });

    // 4. Unblock date range (endDate is optional, defaults to startDate in service)
    const result = await unblockDateRange(docClient, listingId, hostId, startDate, endDate);

    return response.success({
      message: endDate ? 'Date range unblocked successfully' : 'Date unblocked successfully',
      listingId,
      dateRange: {
        startDate,
        endDate: endDate || startDate,
      },
      nightsUnblocked: result.nightsUnblocked,
      totalNights: result.nightsUnblocked.length,
    });
  } catch (error: any) {
    console.error('Unblock dates error:', error);

    if (error.message === 'LISTING_NOT_FOUND') {
      return response.notFound('Listing not found');
    }

    if (error.message === 'LISTING_DELETED') {
      return response.badRequest('Listing has been deleted');
    }

    // Validation errors
    if (error.message.includes('Invalid date') || 
        error.message.includes('cannot be in the past') ||
        error.message.includes('cannot be more than') ||
        error.message.includes('must be before') ||
        error.message.includes('No blocked dates found') ||
        error.message.includes('are booked')) {
      return response.badRequest(error.message);
    }

    if (error.message.includes('does not belong to this host')) {
      return response.forbidden(error.message);
    }

    return response.internalError(error.message || 'Failed to unblock dates');
  }
}

/**
 * Main router
 */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  console.log('Availability handler:', {
    method: event.httpMethod,
    resource: event.resource,
    pathParameters: event.pathParameters,
    queryParameters: event.queryStringParameters,
  });

  const { httpMethod, resource } = event;

  try {
    // Route: GET /api/v1/hosts/{hostId}/availability
    if (httpMethod === 'GET' && resource === '/api/v1/hosts/{hostId}/availability') {
      return await handleGetHostAvailability(event);
    }

    // Route: GET /api/v1/hosts/{hostId}/listings/{listingId}/availability
    if (httpMethod === 'GET' && resource === '/api/v1/hosts/{hostId}/listings/{listingId}/availability') {
      return await handleGetListingAvailability(event);
    }

    // Route: POST /api/v1/hosts/{hostId}/listings/{listingId}/availability/block
    if (httpMethod === 'POST' && resource === '/api/v1/hosts/{hostId}/listings/{listingId}/availability/block') {
      return await handleBlockDates(event);
    }

    // Route: DELETE /api/v1/hosts/{hostId}/listings/{listingId}/availability/unblock
    if (httpMethod === 'DELETE' && resource === '/api/v1/hosts/{hostId}/listings/{listingId}/availability/unblock') {
      return await handleUnblockDates(event);
    }

    return response.notFound('Route not found');
  } catch (error: any) {
    console.error('Availability handler error:', error);
    return response.internalError(error.message || 'Internal server error');
  }
};

