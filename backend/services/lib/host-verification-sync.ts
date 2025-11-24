/**
 * Host Verification Sync Service
 * 
 * Synchronizes hostVerified flag across all ONLINE listings when a host's verification status changes.
 * This ensures that public listings always reflect the current host verification state.
 * 
 * Usage:
 * - Call syncHostVerificationStatus() after any host status change (approve, reject, suspend, reinstate)
 * - The function will query all ONLINE listings for the host
 * - Update all corresponding PublicListingRecords (both PLACE and LOCALITY variants)
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, UpdateCommand, BatchWriteCommand } from '@aws-sdk/lib-dynamodb';

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

const TABLE_NAME = process.env.TABLE_NAME!;
const PUBLIC_LISTINGS_TABLE_NAME = process.env.PUBLIC_LISTINGS_TABLE_NAME!;

interface ListingLocation {
  listingId: string;
  placeId: string;
  localityId?: string;
}

/**
 * Sync hostVerified flag for all ONLINE listings belonging to a host
 * 
 * @param hostId - The host ID whose listings need to be synced
 * @param hostStatus - The current host status (VERIFIED, REJECTED, SUSPENDED, etc.)
 * @returns Number of public listing records updated
 */
export async function syncHostVerificationStatus(
  hostId: string,
  hostStatus: string
): Promise<number> {
  console.log(`🔄 Starting host verification sync for host ${hostId} (status: ${hostStatus})`);

  try {
    // Step 1: Determine hostVerified boolean
    const hostVerified = hostStatus === 'VERIFIED';
    console.log(`   hostVerified will be set to: ${hostVerified}`);

    // Step 2: Query all ONLINE listings for this host
    const onlineListings = await fetchOnlineListings(hostId);
    
    if (onlineListings.length === 0) {
      console.log(`   No ONLINE listings found for host ${hostId}`);
      return 0;
    }

    console.log(`   Found ${onlineListings.length} ONLINE listing(s) to sync`);

    // Step 3: Update all PublicListingRecords
    const updateCount = await updatePublicListings(onlineListings, hostVerified);

    console.log(`✅ Host verification sync completed: ${updateCount} public listing record(s) updated`);
    return updateCount;

  } catch (error) {
    console.error(`❌ Error syncing host verification status for ${hostId}:`, error);
    throw error;
  }
}

/**
 * Fetch all ONLINE listings for a host
 */
async function fetchOnlineListings(hostId: string): Promise<ListingLocation[]> {
  const listings: ListingLocation[] = [];

  try {
    const result = await docClient.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :sk)',
        FilterExpression: '#status = :status',
        ExpressionAttributeNames: {
          '#status': 'status',
        },
        ExpressionAttributeValues: {
          ':pk': `HOST#${hostId}`,
          ':sk': 'LISTING_META#',
          ':status': 'ONLINE',
        },
      })
    );

    if (!result.Items || result.Items.length === 0) {
      return [];
    }

    // Extract location IDs from each listing
    for (const item of result.Items) {
      const placeId = item.mapboxMetadata?.place?.mapbox_id;
      const localityId = item.mapboxMetadata?.locality?.mapbox_id;

      if (placeId) {
        listings.push({
          listingId: item.listingId,
          placeId: placeId,
          localityId: localityId || undefined,
        });
      } else {
        console.warn(`   ⚠️  Listing ${item.listingId} is ONLINE but missing place ID, skipping`);
      }
    }

    return listings;

  } catch (error) {
    console.error('Error fetching ONLINE listings:', error);
    throw error;
  }
}

/**
 * Update hostVerified flag for all public listing records
 * Handles both PLACE and LOCALITY variants
 */
async function updatePublicListings(
  listings: ListingLocation[],
  hostVerified: boolean
): Promise<number> {
  const now = new Date().toISOString();
  let updateCount = 0;

  // Process listings in batches to avoid throttling
  const BATCH_SIZE = 10; // Conservative batch size for updates

  for (let i = 0; i < listings.length; i += BATCH_SIZE) {
    const batch = listings.slice(i, i + BATCH_SIZE);

    // Create update promises for this batch
    const updatePromises = batch.flatMap((listing) => {
      const updates: Promise<void>[] = [];

      // Update PLACE record (always exists)
      updates.push(
        updatePublicListingRecord(
          `LOCATION#${listing.placeId}`,
          `LISTING#${listing.listingId}`,
          hostVerified,
          now
        )
      );

      // Update LOCALITY record (if exists)
      if (listing.localityId) {
        updates.push(
          updatePublicListingRecord(
            `LOCATION#${listing.localityId}`,
            `LISTING#${listing.listingId}`,
            hostVerified,
            now
          )
        );
      }

      return updates;
    });

    // Execute batch updates in parallel
    await Promise.all(updatePromises);
    updateCount += updatePromises.length;

    console.log(`   Updated batch ${Math.floor(i / BATCH_SIZE) + 1}: ${updatePromises.length} record(s)`);
  }

  return updateCount;
}

/**
 * Update a single PublicListingRecord
 */
async function updatePublicListingRecord(
  pk: string,
  sk: string,
  hostVerified: boolean,
  timestamp: string
): Promise<void> {
  try {
    await docClient.send(
      new UpdateCommand({
        TableName: PUBLIC_LISTINGS_TABLE_NAME,
        Key: { pk, sk },
        UpdateExpression: 'SET hostVerified = :hostVerified, updatedAt = :now',
        ExpressionAttributeValues: {
          ':hostVerified': hostVerified,
          ':now': timestamp,
        },
      })
    );
  } catch (error) {
    console.error(`Error updating public listing ${pk}/${sk}:`, error);
    throw error;
  }
}


