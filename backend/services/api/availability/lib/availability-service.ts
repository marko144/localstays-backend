/**
 * Availability Service
 * 
 * Business logic for listing availability operations
 */

import { DynamoDBDocumentClient, QueryCommand, BatchWriteCommand } from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'crypto';
import {
  AvailabilityRecord,
  buildAvailabilityPK,
  buildAvailabilitySK,
  buildHostAvailabilityGSI1PK,
  buildHostAvailabilityGSI1SK,
  buildBlockEventId,
  generateDatesInclusive,
  isValidDateFormat,
} from '../../../types/availability.types';

const AVAILABILITY_TABLE_NAME = process.env.AVAILABILITY_TABLE_NAME!;
const MAX_FUTURE_MONTHS = 18;

/**
 * Validate date is in valid format and within allowed range
 */
export function validateDate(date: string): { valid: boolean; error?: string } {
  if (!isValidDateFormat(date)) {
    return { valid: false, error: `Invalid date format: ${date}. Expected YYYY-MM-DD` };
  }

  const dateObj = new Date(date);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Check if date is in the past
  if (dateObj < today) {
    return { valid: false, error: `Date cannot be in the past: ${date}` };
  }

  // Check if date is more than 18 months in the future
  const maxFutureDate = new Date(today);
  maxFutureDate.setMonth(maxFutureDate.getMonth() + MAX_FUTURE_MONTHS);

  if (dateObj > maxFutureDate) {
    return { valid: false, error: `Date cannot be more than 18 months in the future: ${date}` };
  }

  return { valid: true };
}

/**
 * Validate date range
 */
export function validateDateRange(startDate: string, endDate: string): { valid: boolean; error?: string } {
  // Validate individual dates
  const startValidation = validateDate(startDate);
  if (!startValidation.valid) {
    return startValidation;
  }

  const endValidation = validateDate(endDate);
  if (!endValidation.valid) {
    return endValidation;
  }

  // Check start is before end
  const start = new Date(startDate);
  const end = new Date(endDate);

  if (start >= end) {
    return { valid: false, error: 'Start date must be before end date' };
  }

  return { valid: true };
}

/**
 * Check if any dates in the range are already blocked/booked
 */
export async function checkAvailability(
  docClient: DynamoDBDocumentClient,
  listingId: string,
  dates: string[]
): Promise<{ available: boolean; conflicts: AvailabilityRecord[] }> {
  const conflicts: AvailabilityRecord[] = [];

  // Query for each date
  for (const date of dates) {
    const result = await docClient.send(
      new QueryCommand({
        TableName: AVAILABILITY_TABLE_NAME,
        KeyConditionExpression: 'pk = :pk AND sk = :sk',
        ExpressionAttributeValues: {
          ':pk': buildAvailabilityPK(listingId),
          ':sk': buildAvailabilitySK(date),
        },
      })
    );

    if (result.Items && result.Items.length > 0) {
      conflicts.push(...(result.Items as AvailabilityRecord[]));
    }
  }

  return {
    available: conflicts.length === 0,
    conflicts,
  };
}

/**
 * Get availability for a specific listing
 */
export async function getListingAvailability(
  docClient: DynamoDBDocumentClient,
  listingId: string,
  startDate?: string,
  endDate?: string
): Promise<AvailabilityRecord[]> {
  let keyConditionExpression = 'pk = :pk';
  const expressionAttributeValues: any = {
    ':pk': buildAvailabilityPK(listingId),
  };

  // Add date range filter if provided
  if (startDate && endDate) {
    keyConditionExpression += ' AND sk BETWEEN :startDate AND :endDate';
    expressionAttributeValues[':startDate'] = buildAvailabilitySK(startDate);
    
    // Calculate last night (endDate - 1 day)
    const end = new Date(endDate);
    end.setDate(end.getDate() - 1);
    const lastNight = end.toISOString().split('T')[0];
    expressionAttributeValues[':endDate'] = buildAvailabilitySK(lastNight);
  } else if (startDate) {
    keyConditionExpression += ' AND sk >= :startDate';
    expressionAttributeValues[':startDate'] = buildAvailabilitySK(startDate);
  } else if (endDate) {
    const end = new Date(endDate);
    end.setDate(end.getDate() - 1);
    const lastNight = end.toISOString().split('T')[0];
    keyConditionExpression += ' AND sk <= :endDate';
    expressionAttributeValues[':endDate'] = buildAvailabilitySK(lastNight);
  }

  const result = await docClient.send(
    new QueryCommand({
      TableName: AVAILABILITY_TABLE_NAME,
      KeyConditionExpression: keyConditionExpression,
      ExpressionAttributeValues: expressionAttributeValues,
    })
  );

  return (result.Items || []) as AvailabilityRecord[];
}

/**
 * Get availability for all listings owned by a host
 */
export async function getHostAvailability(
  docClient: DynamoDBDocumentClient,
  hostId: string,
  startDate?: string,
  endDate?: string
): Promise<AvailabilityRecord[]> {
  let keyConditionExpression = 'gsi1pk = :hostPk';
  const expressionAttributeValues: any = {
    ':hostPk': buildHostAvailabilityGSI1PK(hostId),
  };

  // Add date range filter if provided
  if (startDate && endDate) {
    keyConditionExpression += ' AND gsi1sk BETWEEN :startDate AND :endDate';
    // GSI1SK format: DATE#YYYY-MM-DD#LISTING#<listingId>
    // We can filter by date prefix since it's the first part of the SK
    expressionAttributeValues[':startDate'] = `DATE#${startDate}`;
    
    // Calculate last night (endDate - 1 day)
    const end = new Date(endDate);
    end.setDate(end.getDate() - 1);
    const lastNight = end.toISOString().split('T')[0];
    expressionAttributeValues[':endDate'] = `DATE#${lastNight}#LISTING#~`; // ~ is after all alphanumeric chars
  } else if (startDate) {
    keyConditionExpression += ' AND gsi1sk >= :startDate';
    expressionAttributeValues[':startDate'] = `DATE#${startDate}`;
  } else if (endDate) {
    const end = new Date(endDate);
    end.setDate(end.getDate() - 1);
    const lastNight = end.toISOString().split('T')[0];
    keyConditionExpression += ' AND gsi1sk <= :endDate';
    expressionAttributeValues[':endDate'] = `DATE#${lastNight}#LISTING#~`;
  }

  const result = await docClient.send(
    new QueryCommand({
      TableName: AVAILABILITY_TABLE_NAME,
      IndexName: 'HostAvailabilityIndex',
      KeyConditionExpression: keyConditionExpression,
      ExpressionAttributeValues: expressionAttributeValues,
    })
  );

  return (result.Items || []) as AvailabilityRecord[];
}

/**
 * Block dates for a listing
 */
export async function blockDates(
  docClient: DynamoDBDocumentClient,
  listingId: string,
  hostId: string,
  startDate: string,
  endDate: string
): Promise<{ blockId: string; nightsBlocked: string[] }> {
  // Validate date range
  const validation = validateDateRange(startDate, endDate);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  // Generate dates (INCLUSIVE for host blocks - all selected dates should be blocked)
  const nights = generateDatesInclusive(startDate, endDate);

  // Check for conflicts
  const { available, conflicts } = await checkAvailability(docClient, listingId, nights);
  if (!available) {
    const conflictDates = conflicts.map(c => c.date).join(', ');
    throw new Error(`Cannot block dates - following dates are already unavailable: ${conflictDates}`);
  }

  // Generate block ID
  const blockId = randomUUID();
  const eventId = buildBlockEventId(blockId);
  const now = new Date().toISOString();

  // Create records (batch write for efficiency)
  const writeRequests = nights.map(date => ({
    PutRequest: {
      Item: {
        pk: buildAvailabilityPK(listingId),
        sk: buildAvailabilitySK(date),

        listingId,
        hostId,
        date,

        kind: 'BLOCK',
        eventSource: 'HOST_CLOSED',
        eventId,

        bookingId: null,
        externalReservationId: null,

        createdAt: now,

        // GSI1 for querying by host
        gsi1pk: buildHostAvailabilityGSI1PK(hostId),
        gsi1sk: buildHostAvailabilityGSI1SK(date, listingId),
      } as AvailabilityRecord,
    },
  }));

  // DynamoDB batch write limit is 25 items
  const batchSize = 25;
  for (let i = 0; i < writeRequests.length; i += batchSize) {
    const batch = writeRequests.slice(i, i + batchSize);
    await docClient.send(
      new BatchWriteCommand({
        RequestItems: {
          [AVAILABILITY_TABLE_NAME]: batch,
        },
      })
    );
  }

  return {
    blockId,
    nightsBlocked: nights,
  };
}

/**
 * Unblock a date range for a listing
 */
export async function unblockDateRange(
  docClient: DynamoDBDocumentClient,
  listingId: string,
  hostId: string,
  startDate: string,
  endDate: string
): Promise<{ nightsUnblocked: string[] }> {
  // Validate date range
  const validation = validateDateRange(startDate, endDate);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  // Generate dates to unblock (INCLUSIVE for host blocks)
  const nights = generateDatesInclusive(startDate, endDate);

  // Query existing records for these dates to verify they're HOST_CLOSED blocks
  const pk = buildAvailabilityPK(listingId);
  const existingRecords: AvailabilityRecord[] = [];

  // Query in small batches to check existence and ownership
  for (const date of nights) {
    const result = await docClient.send(
      new QueryCommand({
        TableName: AVAILABILITY_TABLE_NAME,
        KeyConditionExpression: 'pk = :pk AND sk = :sk',
        ExpressionAttributeValues: {
          ':pk': pk,
          ':sk': buildAvailabilitySK(date),
        },
      })
    );

    if (result.Items && result.Items.length > 0) {
      existingRecords.push(...(result.Items as AvailabilityRecord[]));
    }
  }

  if (existingRecords.length === 0) {
    throw new Error('No blocked dates found in the specified range');
  }

  // Security checks: Verify all records are HOST_CLOSED blocks owned by this host
  const nonHostBlocks = existingRecords.filter(r => r.eventSource !== 'HOST_CLOSED');
  if (nonHostBlocks.length > 0) {
    const bookedDates = nonHostBlocks.map(r => r.date).join(', ');
    throw new Error(`Cannot unblock: Following dates are booked (not host-blocked): ${bookedDates}`);
  }

  const wrongHost = existingRecords.filter(r => r.hostId !== hostId);
  if (wrongHost.length > 0) {
    throw new Error('Cannot unblock: Some dates do not belong to this host');
  }

  // Delete all records (batch delete)
  const deleteRequests = existingRecords.map(record => ({
    DeleteRequest: {
      Key: {
        pk: record.pk,
        sk: record.sk,
      },
    },
  }));

  // DynamoDB batch write limit is 25 items
  const batchSize = 25;
  for (let i = 0; i < deleteRequests.length; i += batchSize) {
    const batch = deleteRequests.slice(i, i + batchSize);
    await docClient.send(
      new BatchWriteCommand({
        RequestItems: {
          [AVAILABILITY_TABLE_NAME]: batch,
        },
      })
    );
  }

  return {
    nightsUnblocked: existingRecords.map(r => r.date).sort(),
  };
}

