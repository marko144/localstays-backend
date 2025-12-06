/**
 * Slot Expiry Processor
 * 
 * Scheduled Lambda that handles advertising slot lifecycle:
 * 
 * 1. EXPIRY WARNING (runs at 8:00 AM)
 *    - Find slots expiring in exactly 7 days
 *    - Group by host
 *    - Send warning email + push notification per host
 * 
 * 2. SLOT EXPIRY (runs at 1:00 AM)
 *    - Find expired slots (expiresAt <= now)
 *    - Skip slots in grace period (isPastDue = true, not marked for immediate expiry)
 *    - Unpublish listing, delete slot, update location counts
 *    - Group by host, send email + push notification per host
 * 
 * Triggered by EventBridge scheduled rules.
 */

// Note: Not using ScheduledEvent type because we pass custom detail-type
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, GetCommand, UpdateCommand, DeleteCommand, BatchWriteCommand } from '@aws-sdk/lib-dynamodb';

import {
  AdvertisingSlot,
  buildSlotGSI2PK,
} from '../../types/advertising-slot.types';

import {
  sendAdsExpiringSoonEmail,
  sendAdsExpiredEmail,
} from '../lib/email-service';

import {
  sendTemplatedNotification,
} from '../lib/notification-template-service';

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client, {
  marshallOptions: { removeUndefinedValues: true },
});

const TABLE_NAME = process.env.TABLE_NAME!;
const LOCATIONS_TABLE_NAME = process.env.LOCATIONS_TABLE_NAME!;
const PUBLIC_LISTINGS_TABLE_NAME = process.env.PUBLIC_LISTINGS_TABLE_NAME!;
const PUBLIC_LISTING_MEDIA_TABLE_NAME = process.env.PUBLIC_LISTING_MEDIA_TABLE_NAME!;
const ADVERTISING_SLOTS_TABLE_NAME = process.env.ADVERTISING_SLOTS_TABLE_NAME!;
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://app.localstays.rs';

// ============================================================================
// TYPES
// ============================================================================

interface Host {
  pk: string;
  sk: string;
  hostId: string;
  email: string;
  preferredLanguage: string;
  ownerUserSub: string;
  forename?: string;
  surname?: string;
  legalName?: string;
  displayName?: string;
  businessName?: string;
  hostType: 'INDIVIDUAL' | 'BUSINESS';
}

interface ListingMeta {
  pk: string;
  sk: string;
  listingId: string;
  hostId: string;
  listingName: string;
  status: string;
}

interface SlotWithListing extends AdvertisingSlot {
  listingName?: string;
}

// ============================================================================
// MAIN HANDLER
// ============================================================================

// Custom event type for our scheduled events
interface SlotExpiryEvent {
  'detail-type'?: string;
  source?: string;
  time?: string;
  detail?: Record<string, unknown>;
}

export const handler = async (event: SlotExpiryEvent): Promise<void> => {
  console.log('🕐 Slot expiry processor started:', {
    time: event.time,
    source: event.source,
    detailType: event['detail-type'],
  });

  const jobType = event['detail-type'] || 'SLOT_EXPIRY';
  
  try {
    if (jobType === 'EXPIRY_WARNING' || jobType.includes('warning')) {
      await processExpiryWarnings();
    } else {
      await processExpiredSlots();
    }
    
    console.log('✅ Slot expiry processor completed successfully');
  } catch (error) {
    console.error('❌ Slot expiry processor failed:', error);
    throw error; // Re-throw to mark Lambda as failed
  }
};

// ============================================================================
// EXPIRY WARNING PROCESSOR (7 days before)
// ============================================================================

async function processExpiryWarnings(): Promise<void> {
  console.log('📧 Processing expiry warnings (7 days before)...');

  // Calculate date 7 days from now
  const warningDate = new Date();
  warningDate.setDate(warningDate.getDate() + 7);
  const warningDateStart = new Date(warningDate);
  warningDateStart.setHours(0, 0, 0, 0);
  const warningDateEnd = new Date(warningDate);
  warningDateEnd.setHours(23, 59, 59, 999);

  // Query slots expiring on that day
  const slotsExpiring = await getSlotsExpiringBetween(
    warningDateStart.toISOString(),
    warningDateEnd.toISOString()
  );

  console.log(`Found ${slotsExpiring.length} slots expiring in 7 days`);

  if (slotsExpiring.length === 0) {
    return;
  }

  // Group slots by host
  const slotsByHost = await groupSlotsByHost(slotsExpiring);

  // Send notifications per host
  for (const [hostId, { host, slots }] of slotsByHost) {
    try {
      await sendExpiryWarningNotifications(host, slots);
      console.log(`✅ Expiry warning sent to host ${hostId} for ${slots.length} slots`);
    } catch (error) {
      console.error(`❌ Failed to send expiry warning to host ${hostId}:`, error);
      // Continue with other hosts
    }
  }
}

async function sendExpiryWarningNotifications(
  host: Host,
  slots: SlotWithListing[]
): Promise<void> {
  const hostName = getHostName(host);
  const language = normalizeLanguage(host.preferredLanguage);
  const subscriptionUrl = `${FRONTEND_URL}/${language}/subscription`;

  // Prepare listings data for email
  const listings = slots.map(slot => ({
    listingName: slot.listingName || 'Unknown Listing',
    expiresAt: slot.expiresAt,
  }));

  // Send email
  try {
    await sendAdsExpiringSoonEmail(
      host.email,
      language,
      hostName,
      listings,
      subscriptionUrl
    );
    console.log(`📧 Expiry warning email sent to ${host.email}`);
  } catch (emailError) {
    console.error(`Failed to send expiry warning email to ${host.email}:`, emailError);
  }

  // Send push notification
  if (host.ownerUserSub) {
    try {
      await sendTemplatedNotification(
        host.ownerUserSub,
        'ADS_EXPIRING_SOON',
        language,
        { count: slots.length.toString() }
      );
      console.log(`📱 Expiry warning push sent to user ${host.ownerUserSub}`);
    } catch (pushError) {
      console.error(`Failed to send expiry warning push to ${host.ownerUserSub}:`, pushError);
    }
  }
}

// ============================================================================
// SLOT EXPIRY PROCESSOR (expired slots)
// ============================================================================

async function processExpiredSlots(): Promise<void> {
  console.log('🗑️ Processing expired slots...');

  const now = new Date().toISOString();

  // Query all slots that have expired
  const expiredSlots = await getExpiredSlots(now);

  console.log(`Found ${expiredSlots.length} expired slots`);

  if (expiredSlots.length === 0) {
    return;
  }

  // Filter out slots in grace period (unless marked for immediate expiry)
  const slotsToProcess = expiredSlots.filter(slot => {
    // Process if marked for immediate expiry
    if (slot.markedForImmediateExpiry) {
      return true;
    }
    // Skip if in grace period (payment pending)
    if (slot.isPastDue) {
      console.log(`⏸️ Skipping slot ${slot.slotId} - in grace period`);
      return false;
    }
    // Process normally expired slots
    return true;
  });

  console.log(`Processing ${slotsToProcess.length} slots (${expiredSlots.length - slotsToProcess.length} in grace period)`);

  // Group by host for notifications
  const slotsByHost = await groupSlotsByHost(slotsToProcess);
  const processedSlots: SlotWithListing[] = [];

  // Process each slot
  for (const slot of slotsToProcess) {
    try {
      await processExpiredSlot(slot);
      processedSlots.push(slot);
      console.log(`✅ Processed expired slot ${slot.slotId} for listing ${slot.listingId}`);
    } catch (error) {
      console.error(`❌ Failed to process slot ${slot.slotId}:`, error);
      // Continue with other slots
    }
  }

  // Send notifications per host (only for successfully processed slots)
  for (const [hostId, { host, slots }] of slotsByHost) {
    const processedForHost = slots.filter(s => 
      processedSlots.some(p => p.slotId === s.slotId)
    );
    
    if (processedForHost.length > 0) {
      try {
        await sendExpiredNotifications(host, processedForHost);
        console.log(`✅ Expiry notification sent to host ${hostId} for ${processedForHost.length} slots`);
      } catch (error) {
        console.error(`❌ Failed to send expiry notification to host ${hostId}:`, error);
      }
    }
  }
}

async function processExpiredSlot(slot: AdvertisingSlot): Promise<void> {
  console.log(`Processing expired slot ${slot.slotId} for listing ${slot.listingId}`);

  // 1. Get listing metadata to find location IDs
  const listing = await getListing(slot.hostId, slot.listingId);
  
  if (!listing) {
    console.warn(`Listing ${slot.listingId} not found, just deleting slot`);
    await deleteSlot(slot);
    return;
  }

  // 2. Get location IDs from listing (mapbox or manual)
  const locationIds = await getListingLocationIds(listing);

  // 3. Delete public listing records and decrement location counts
  if (locationIds.length > 0) {
    await unpublishFromLocations(slot.listingId, locationIds);
  }

  // 4. Delete public listing media
  await deletePublicListingMedia(slot.listingId);

  // 5. Update master listing status to APPROVED
  await updateListingStatus(slot.hostId, slot.listingId, 'APPROVED');

  // 6. Delete the advertising slot
  await deleteSlot(slot);

  console.log(`✅ Slot ${slot.slotId} expired: listing ${slot.listingId} moved to APPROVED`);
}

async function sendExpiredNotifications(
  host: Host,
  slots: SlotWithListing[]
): Promise<void> {
  const hostName = getHostName(host);
  const language = normalizeLanguage(host.preferredLanguage);
  const subscriptionUrl = `${FRONTEND_URL}/${language}/subscription`;

  // Prepare listings data for email
  const listings = slots.map(slot => ({
    listingName: slot.listingName || 'Unknown Listing',
  }));

  // Send email
  try {
    await sendAdsExpiredEmail(
      host.email,
      language,
      hostName,
      listings,
      subscriptionUrl
    );
    console.log(`📧 Expiry notification email sent to ${host.email}`);
  } catch (emailError) {
    console.error(`Failed to send expiry notification email to ${host.email}:`, emailError);
  }

  // Send push notification
  if (host.ownerUserSub) {
    try {
      await sendTemplatedNotification(
        host.ownerUserSub,
        'ADS_EXPIRED',
        language,
        { count: slots.length.toString() }
      );
      console.log(`📱 Expiry push notification sent to user ${host.ownerUserSub}`);
    } catch (pushError) {
      console.error(`Failed to send expiry push to ${host.ownerUserSub}:`, pushError);
    }
  }
}

// ============================================================================
// DATABASE QUERIES
// ============================================================================

async function getSlotsExpiringBetween(
  startDate: string,
  endDate: string
): Promise<AdvertisingSlot[]> {
  // Query all active slots and filter by expiresAt date range
  // This is cleaner than relying on composite sort key string comparison
  const result = await docClient.send(
    new QueryCommand({
      TableName: ADVERTISING_SLOTS_TABLE_NAME,
      IndexName: 'ExpiryIndex',
      KeyConditionExpression: 'gsi2pk = :pk',
      FilterExpression: 'expiresAt BETWEEN :start AND :end',
      ExpressionAttributeValues: {
        ':pk': buildSlotGSI2PK(),
        ':start': startDate,
        ':end': endDate,
      },
    })
  );

  return (result.Items || []) as AdvertisingSlot[];
}

async function getExpiredSlots(beforeDate: string): Promise<AdvertisingSlot[]> {
  // Query all active slots and filter by expiresAt <= beforeDate
  // This is cleaner than relying on composite sort key string comparison
  const result = await docClient.send(
    new QueryCommand({
      TableName: ADVERTISING_SLOTS_TABLE_NAME,
      IndexName: 'ExpiryIndex',
      KeyConditionExpression: 'gsi2pk = :pk',
      FilterExpression: 'expiresAt <= :beforeDate',
      ExpressionAttributeValues: {
        ':pk': buildSlotGSI2PK(),
        ':beforeDate': beforeDate,
      },
    })
  );

  return (result.Items || []) as AdvertisingSlot[];
}

async function getHost(hostId: string): Promise<Host | null> {
  const result = await docClient.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: {
        pk: `HOST#${hostId}`,
        sk: 'META',
      },
    })
  );

  return (result.Item as Host) || null;
}

async function getListing(hostId: string, listingId: string): Promise<ListingMeta | null> {
  const result = await docClient.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: {
        pk: `HOST#${hostId}`,
        sk: `LISTING_META#${listingId}`,
      },
    })
  );

  return (result.Item as ListingMeta) || null;
}

async function getListingLocationIds(listing: any): Promise<string[]> {
  const locationIds: string[] = [];

  // Check for mapbox metadata
  if (listing.mapboxMetadata?.place?.mapbox_id) {
    locationIds.push(listing.mapboxMetadata.place.mapbox_id);
  }
  if (listing.mapboxMetadata?.locality?.mapbox_id) {
    locationIds.push(listing.mapboxMetadata.locality.mapbox_id);
  }
  if (listing.mapboxMetadata?.country?.mapbox_id) {
    locationIds.push(listing.mapboxMetadata.country.mapbox_id);
  }

  // Check for manual location IDs (fallback)
  if (listing.manualLocationIds && Array.isArray(listing.manualLocationIds)) {
    for (const id of listing.manualLocationIds) {
      if (!locationIds.includes(id)) {
        locationIds.push(id);
      }
    }
  }

  return locationIds;
}

// ============================================================================
// DATABASE UPDATES
// ============================================================================

async function unpublishFromLocations(listingId: string, locationIds: string[]): Promise<void> {
  // Delete public listing records for each location
  const deleteRequests = locationIds.map(locationId => ({
    DeleteRequest: {
      Key: {
        pk: `LOCATION#${locationId}`,
        sk: `LISTING#${listingId}`,
      },
    },
  }));

  if (deleteRequests.length > 0) {
    await docClient.send(
      new BatchWriteCommand({
        RequestItems: {
          [PUBLIC_LISTINGS_TABLE_NAME]: deleteRequests,
        },
      })
    );
  }

  // Decrement listing counts for each location
  for (const locationId of locationIds) {
    try {
      await docClient.send(
        new UpdateCommand({
          TableName: LOCATIONS_TABLE_NAME,
          Key: {
            pk: `LOCATION#${locationId}`,
            sk: 'META',
          },
          UpdateExpression: 'SET listingsCount = if_not_exists(listingsCount, :zero) - :one',
          ConditionExpression: 'attribute_exists(pk)',
          ExpressionAttributeValues: {
            ':zero': 0,
            ':one': 1,
          },
        })
      );
    } catch (error: any) {
      // Ignore condition check failures (location might not exist)
      if (error.name !== 'ConditionalCheckFailedException') {
        console.error(`Failed to decrement count for location ${locationId}:`, error);
      }
    }
  }

  console.log(`Deleted public listing records from ${locationIds.length} locations`);
}

async function deletePublicListingMedia(listingId: string): Promise<void> {
  // Query all media for this listing
  const result = await docClient.send(
    new QueryCommand({
      TableName: PUBLIC_LISTING_MEDIA_TABLE_NAME,
      KeyConditionExpression: 'pk = :pk',
      ExpressionAttributeValues: {
        ':pk': `LISTING_MEDIA_PUBLIC#${listingId}`,
      },
    })
  );

  const mediaItems = result.Items || [];
  
  if (mediaItems.length === 0) {
    return;
  }

  // Batch delete media items
  const deleteRequests = mediaItems.map(item => ({
    DeleteRequest: {
      Key: {
        pk: item.pk,
        sk: item.sk,
      },
    },
  }));

  // Process in batches of 25
  for (let i = 0; i < deleteRequests.length; i += 25) {
    const batch = deleteRequests.slice(i, i + 25);
    await docClient.send(
      new BatchWriteCommand({
        RequestItems: {
          [PUBLIC_LISTING_MEDIA_TABLE_NAME]: batch,
        },
      })
    );
  }

  console.log(`Deleted ${mediaItems.length} public media items for listing ${listingId}`);
}

async function updateListingStatus(
  hostId: string,
  listingId: string,
  status: string
): Promise<void> {
  const now = new Date().toISOString();

  await docClient.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: {
        pk: `HOST#${hostId}`,
        sk: `LISTING_META#${listingId}`,
      },
      UpdateExpression: `
        SET #status = :status,
            activeSlotId = :null,
            slotExpiresAt = :null,
            slotDoNotRenew = :null,
            slotIsPastDue = :null,
            updatedAt = :now
      `,
      ExpressionAttributeNames: {
        '#status': 'status',
      },
      ExpressionAttributeValues: {
        ':status': status,
        ':null': null,
        ':now': now,
      },
    })
  );
}

async function deleteSlot(slot: AdvertisingSlot): Promise<void> {
  await docClient.send(
    new DeleteCommand({
      TableName: ADVERTISING_SLOTS_TABLE_NAME,
      Key: {
        pk: slot.pk,
        sk: slot.sk,
      },
    })
  );
}

// ============================================================================
// HELPERS
// ============================================================================

async function groupSlotsByHost(
  slots: AdvertisingSlot[]
): Promise<Map<string, { host: Host; slots: SlotWithListing[] }>> {
  const slotsByHost = new Map<string, { host: Host; slots: SlotWithListing[] }>();

  for (const slot of slots) {
    if (!slotsByHost.has(slot.hostId)) {
      const host = await getHost(slot.hostId);
      if (host) {
        slotsByHost.set(slot.hostId, { host, slots: [] });
      }
    }

    const hostData = slotsByHost.get(slot.hostId);
    if (hostData) {
      // Get listing name for the slot
      const listing = await getListing(slot.hostId, slot.listingId);
      const slotWithListing: SlotWithListing = {
        ...slot,
        listingName: listing?.listingName,
      };
      hostData.slots.push(slotWithListing);
    }
  }

  return slotsByHost;
}

function getHostName(host: Host): string {
  if (host.hostType === 'INDIVIDUAL') {
    return `${host.forename || ''} ${host.surname || ''}`.trim() || 'Host';
  }
  return host.legalName || host.displayName || host.businessName || 'Host';
}

function normalizeLanguage(lang: string): string {
  const normalized = (lang || 'sr').split('-')[0].toLowerCase();
  return normalized === 'en' ? 'en' : 'sr';
}

