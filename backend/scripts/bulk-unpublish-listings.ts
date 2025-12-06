/**
 * Bulk Unpublish Listings Script
 *
 * This script performs a bulk "unpublish" of all ONLINE listings:
 * 1. Updates all ONLINE listings in main table to APPROVED status
 * 2. Deletes all records from public-listings table
 * 3. Deletes all records from public-listing-media table
 * 4. Resets listingsCount to 0 on all locations
 *
 * Usage:
 *   npx ts-node backend/scripts/bulk-unpublish-listings.ts [--dry-run]
 *
 * Options:
 *   --dry-run    Show what would be done without making changes
 */

import {
  DynamoDBClient,
  ScanCommand,
  BatchWriteItemCommand,
} from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';

// Configuration
const REGION = process.env.AWS_REGION || 'eu-north-1';
const STAGE = process.env.STAGE || 'staging';

const MAIN_TABLE = `localstays-${STAGE}`;
const PUBLIC_LISTINGS_TABLE = `localstays-public-listings-${STAGE}`;
const PUBLIC_LISTING_MEDIA_TABLE = `localstays-public-listing-media-${STAGE}`;
const LOCATIONS_TABLE = `localstays-locations-${STAGE}`;

// Initialize DynamoDB client
const client = new DynamoDBClient({ region: REGION });
const docClient = DynamoDBDocumentClient.from(client);

// Check for dry run mode
const DRY_RUN = process.argv.includes('--dry-run');

interface ListingMeta {
  pk: string;
  sk: string;
  listingId: string;
  status: string;
}

interface LocationRecord {
  pk: string;
  sk: string;
  locationId: string;
  name: string;
  listingsCount: number;
}

async function getOnlineListings(): Promise<ListingMeta[]> {
  console.log('\n📋 Scanning for ONLINE listings...');

  const listings: ListingMeta[] = [];
  let scanKey: Record<string, any> | undefined;

  do {
    const scanResult = await client.send(
      new ScanCommand({
        TableName: MAIN_TABLE,
        FilterExpression: '#status = :online AND begins_with(sk, :skPrefix)',
        ExpressionAttributeNames: {
          '#status': 'status',
        },
        ExpressionAttributeValues: {
          ':online': { S: 'ONLINE' },
          ':skPrefix': { S: 'LISTING_META#' },
        },
        ExclusiveStartKey: scanKey,
      })
    );

    if (scanResult.Items) {
      for (const item of scanResult.Items) {
        listings.push({
          pk: item.pk?.S || '',
          sk: item.sk?.S || '',
          listingId: item.listingId?.S || '',
          status: item.status?.S || '',
        });
      }
    }
    scanKey = scanResult.LastEvaluatedKey;
  } while (scanKey);

  console.log(`   Found ${listings.length} ONLINE listings`);
  return listings;
}

async function updateListingsToApproved(listings: ListingMeta[]): Promise<number> {
  console.log('\n🔄 Updating ONLINE listings to APPROVED...');

  let updated = 0;
  const now = new Date().toISOString();

  for (const listing of listings) {
    if (DRY_RUN) {
      console.log(`   [DRY RUN] Would update: ${listing.listingId}`);
      updated++;
      continue;
    }

    try {
      await docClient.send(
        new UpdateCommand({
          TableName: MAIN_TABLE,
          Key: {
            pk: listing.pk,
            sk: listing.sk,
          },
          UpdateExpression: 'SET #status = :approved, updatedAt = :now',
          ExpressionAttributeNames: {
            '#status': 'status',
          },
          ExpressionAttributeValues: {
            ':approved': 'APPROVED',
            ':now': now,
          },
        })
      );
      updated++;
      if (updated % 10 === 0) {
        console.log(`   Updated ${updated}/${listings.length} listings...`);
      }
    } catch (error) {
      console.error(`   ❌ Failed to update ${listing.listingId}:`, error);
    }
  }

  console.log(`   ✅ Updated ${updated} listings to APPROVED`);
  return updated;
}

async function deleteAllFromTable(tableName: string): Promise<number> {
  console.log(`\n🗑️  Deleting all records from ${tableName}...`);

  let deleted = 0;
  let scanKey: Record<string, any> | undefined;

  do {
    // Scan for items to delete
    const scanResult = await client.send(
      new ScanCommand({
        TableName: tableName,
        ProjectionExpression: 'pk, sk',
        ExclusiveStartKey: scanKey,
        Limit: 25, // BatchWriteItem can handle max 25 items
      })
    );

    if (!scanResult.Items || scanResult.Items.length === 0) {
      break;
    }

    if (DRY_RUN) {
      console.log(`   [DRY RUN] Would delete ${scanResult.Items.length} items`);
      deleted += scanResult.Items.length;
      scanKey = scanResult.LastEvaluatedKey;
      continue;
    }

    // Batch delete
    const deleteRequests = scanResult.Items.map((item) => ({
      DeleteRequest: {
        Key: {
          pk: item.pk,
          sk: item.sk,
        },
      },
    }));

    try {
      await client.send(
        new BatchWriteItemCommand({
          RequestItems: {
            [tableName]: deleteRequests,
          },
        })
      );
      deleted += deleteRequests.length;
      console.log(`   Deleted ${deleted} items...`);
    } catch (error) {
      console.error(`   ❌ Batch delete failed:`, error);
    }

    scanKey = scanResult.LastEvaluatedKey;
  } while (scanKey);

  // Do another scan to catch any remaining items
  if (!DRY_RUN) {
    let remainingScan: Record<string, any> | undefined;
    do {
      const remainingResult = await client.send(
        new ScanCommand({
          TableName: tableName,
          ProjectionExpression: 'pk, sk',
          ExclusiveStartKey: remainingScan,
          Limit: 25,
        })
      );

      if (!remainingResult.Items || remainingResult.Items.length === 0) {
        break;
      }

      const deleteRequests = remainingResult.Items.map((item) => ({
        DeleteRequest: {
          Key: {
            pk: item.pk,
            sk: item.sk,
          },
        },
      }));

      try {
        await client.send(
          new BatchWriteItemCommand({
            RequestItems: {
              [tableName]: deleteRequests,
            },
          })
        );
        deleted += deleteRequests.length;
        console.log(`   Deleted ${deleted} items (cleanup pass)...`);
      } catch (error) {
        console.error(`   ❌ Batch delete failed:`, error);
      }

      remainingScan = remainingResult.LastEvaluatedKey;
    } while (remainingScan);
  }

  console.log(`   ✅ Deleted ${deleted} records from ${tableName}`);
  return deleted;
}

async function resetLocationCounts(): Promise<number> {
  console.log('\n📍 Resetting location listing counts to 0...');

  // Scan all locations
  const scanResult = await client.send(
    new ScanCommand({
      TableName: LOCATIONS_TABLE,
    })
  );

  if (!scanResult.Items || scanResult.Items.length === 0) {
    console.log('   No locations found');
    return 0;
  }

  const locations: LocationRecord[] = scanResult.Items.map((item) => ({
    pk: item.pk?.S || '',
    sk: item.sk?.S || '',
    locationId: item.locationId?.S || '',
    name: item.name?.S || '',
    listingsCount: parseInt(item.listingsCount?.N || '0', 10),
  }));

  console.log(`   Found ${locations.length} locations`);

  let updated = 0;
  const now = new Date().toISOString();

  for (const location of locations) {
    if (location.listingsCount === 0) {
      console.log(`   Skipping ${location.name} (already 0)`);
      continue;
    }

    if (DRY_RUN) {
      console.log(
        `   [DRY RUN] Would reset ${location.name}: ${location.listingsCount} → 0`
      );
      updated++;
      continue;
    }

    try {
      await docClient.send(
        new UpdateCommand({
          TableName: LOCATIONS_TABLE,
          Key: {
            pk: location.pk,
            sk: location.sk,
          },
          UpdateExpression: 'SET listingsCount = :zero, updatedAt = :now',
          ExpressionAttributeValues: {
            ':zero': 0,
            ':now': now,
          },
        })
      );
      console.log(`   Reset ${location.name}: ${location.listingsCount} → 0`);
      updated++;
    } catch (error) {
      console.error(`   ❌ Failed to reset ${location.name}:`, error);
    }
  }

  console.log(`   ✅ Reset ${updated} location counts`);
  return updated;
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('           BULK UNPUBLISH LISTINGS SCRIPT');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`Stage: ${STAGE}`);
  console.log(`Region: ${REGION}`);
  console.log(`Mode: ${DRY_RUN ? '🔍 DRY RUN (no changes will be made)' : '⚡ LIVE'}`);
  console.log('═══════════════════════════════════════════════════════════');

  try {
    // Step 1: Get all ONLINE listings
    const onlineListings = await getOnlineListings();

    if (onlineListings.length === 0) {
      console.log('\n✅ No ONLINE listings found. Nothing to do!');
      return;
    }

    // Step 2: Update ONLINE listings to APPROVED
    const updatedCount = await updateListingsToApproved(onlineListings);

    // Step 3: Delete all public listings
    const publicListingsDeleted = await deleteAllFromTable(PUBLIC_LISTINGS_TABLE);

    // Step 4: Delete all public listing media
    const publicMediaDeleted = await deleteAllFromTable(PUBLIC_LISTING_MEDIA_TABLE);

    // Step 5: Reset location counts
    const locationsReset = await resetLocationCounts();

    // Summary
    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('                        SUMMARY');
    console.log('═══════════════════════════════════════════════════════════');
    console.log(`Listings updated (ONLINE → APPROVED): ${updatedCount}`);
    console.log(`Public listings deleted: ${publicListingsDeleted}`);
    console.log(`Public listing media deleted: ${publicMediaDeleted}`);
    console.log(`Location counts reset: ${locationsReset}`);
    console.log('═══════════════════════════════════════════════════════════');

    if (DRY_RUN) {
      console.log('\n🔍 This was a DRY RUN. No changes were made.');
      console.log('   Run without --dry-run to apply changes.');
    } else {
      console.log('\n✅ Bulk unpublish complete!');
    }
  } catch (error) {
    console.error('\n❌ Script failed:', error);
    process.exit(1);
  }
}

main();

