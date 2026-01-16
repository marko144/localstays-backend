/**
 * Migration Script: Update beds capacity to new model (singleBeds + doubleBeds)
 * 
 * OLD FORMAT:
 * capacity: {
 *   beds: number,
 *   bedrooms: number,
 *   bathrooms: number,
 *   sleeps: number
 * }
 * 
 * NEW FORMAT:
 * capacity: {
 *   singleBeds: number,
 *   doubleBeds: number,
 *   bedrooms: number,
 *   bathrooms: number,
 *   sleeps: number
 * }
 * 
 * CONVERSION STRATEGY:
 * - If old format has "beds" field, convert to: singleBeds = 0, doubleBeds = beds
 *   (This assumes all beds are double beds, which is a reasonable default)
 * - Remove the old "beds" field
 * 
 * Usage: npx ts-node scripts/migrate-beds-capacity.ts <stage>
 * Example: npx ts-node scripts/migrate-beds-capacity.ts staging
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  ScanCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';

const stage = process.argv[2];

if (!stage) {
  console.error('Usage: npx ts-node scripts/migrate-beds-capacity.ts <stage>');
  console.error('Example: npx ts-node scripts/migrate-beds-capacity.ts staging');
  process.exit(1);
}

const TABLE_NAME = `localstays-${stage}`;
const PUBLIC_LISTINGS_TABLE = `localstays-public-listings-${stage}`;
const REGION = 'eu-north-1';

const client = new DynamoDBClient({ region: REGION });
const docClient = DynamoDBDocumentClient.from(client);

interface ListingCapacity {
  beds?: number;
  singleBeds?: number;
  doubleBeds?: number;
  bedrooms: number;
  bathrooms: number;
  sleeps: number;
}

interface ListingRecord {
  pk: string;
  sk: string;
  listingId: string;
  status?: string;
  capacity: ListingCapacity;
}

async function scanListings(): Promise<ListingRecord[]> {
  const listings: ListingRecord[] = [];
  let lastEvaluatedKey: Record<string, any> | undefined;

  do {
    const response = await docClient.send(
      new ScanCommand({
        TableName: TABLE_NAME,
        FilterExpression: 'begins_with(sk, :sk)',
        ExpressionAttributeValues: {
          ':sk': 'LISTING_META#',
        },
        ExclusiveStartKey: lastEvaluatedKey,
      })
    );

    if (response.Items) {
      listings.push(...(response.Items as ListingRecord[]));
    }
    lastEvaluatedKey = response.LastEvaluatedKey;
  } while (lastEvaluatedKey);

  return listings;
}

async function updateListingCapacity(listing: ListingRecord): Promise<boolean> {
  const oldBeds = listing.capacity.beds ?? 0;
  
  try {
    await docClient.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: {
          pk: listing.pk,
          sk: listing.sk,
        },
        UpdateExpression: 'SET #cap.singleBeds = :singleBeds, #cap.doubleBeds = :doubleBeds REMOVE #cap.#beds',
        ExpressionAttributeNames: {
          '#cap': 'capacity',
          '#beds': 'beds',
        },
        ExpressionAttributeValues: {
          ':singleBeds': 0,
          ':doubleBeds': oldBeds,
        },
      })
    );
    return true;
  } catch (error) {
    console.error(`   ❌ Error updating listing ${listing.listingId}:`, error);
    return false;
  }
}

async function updatePublicListing(listingId: string, doubleBeds: number): Promise<boolean> {
  // First, find the public listing by scanning with filter
  try {
    const response = await docClient.send(
      new ScanCommand({
        TableName: PUBLIC_LISTINGS_TABLE,
        FilterExpression: 'listingId = :listingId',
        ExpressionAttributeValues: {
          ':listingId': listingId,
        },
      })
    );

    if (!response.Items || response.Items.length === 0) {
      // No public listing found - listing might not be published
      return true;
    }

    const publicListing = response.Items[0];

    // Check if it needs migration (has old 'beds' field or missing singleBeds/doubleBeds)
    if (publicListing.singleBeds !== undefined && publicListing.doubleBeds !== undefined) {
      // Already migrated
      return true;
    }

    await docClient.send(
      new UpdateCommand({
        TableName: PUBLIC_LISTINGS_TABLE,
        Key: {
          pk: publicListing.pk,
          sk: publicListing.sk,
        },
        UpdateExpression: 'SET singleBeds = :singleBeds, doubleBeds = :doubleBeds',
        ExpressionAttributeValues: {
          ':singleBeds': 0,
          ':doubleBeds': doubleBeds,
        },
      })
    );
    return true;
  } catch (error) {
    console.error(`   ❌ Error updating public listing ${listingId}:`, error);
    return false;
  }
}

async function main() {
  console.log(`\n🚀 Starting beds capacity migration for ${TABLE_NAME}...\n`);

  // Scan all listings
  console.log('📊 Scanning listings...');
  const listings = await scanListings();
  console.log(`Found ${listings.length} total listings\n`);

  // Categorize listings
  const needsMigration = listings.filter(
    (l) => l.capacity && l.capacity.beds !== undefined && l.capacity.singleBeds === undefined
  );
  const alreadyMigrated = listings.filter(
    (l) => l.capacity && l.capacity.singleBeds !== undefined
  );
  const noCapacity = listings.filter((l) => !l.capacity);
  const invalid = listings.filter(
    (l) => l.capacity && l.capacity.beds === undefined && l.capacity.singleBeds === undefined
  );

  console.log('📈 Status:');
  console.log(`   - Already migrated: ${alreadyMigrated.length}`);
  console.log(`   - Need migration: ${needsMigration.length}`);
  console.log(`   - No capacity field: ${noCapacity.length}`);
  console.log(`   - Invalid (missing both beds fields): ${invalid.length}`);
  console.log('');

  if (needsMigration.length === 0) {
    console.log('✅ All listings already migrated! Nothing to do.\n');
    return;
  }

  // Migrate listings
  let successCount = 0;
  let errorCount = 0;
  let publicUpdatedCount = 0;

  for (const listing of needsMigration) {
    const oldBeds = listing.capacity.beds ?? 0;
    console.log(`🔄 Migrating ${listing.listingId}:`);
    console.log(`   Old beds: ${oldBeds}`);
    console.log(`   New: singleBeds=0, doubleBeds=${oldBeds}`);

    const success = await updateListingCapacity(listing);
    if (success) {
      console.log(`   ✅ Listing metadata updated`);
      successCount++;

      // Also update public listing if it exists
      if (listing.status === 'ONLINE') {
        const publicSuccess = await updatePublicListing(listing.listingId, oldBeds);
        if (publicSuccess) {
          console.log(`   ✅ Public listing updated`);
          publicUpdatedCount++;
        }
      }
    } else {
      errorCount++;
    }
    console.log('');
  }

  // Summary
  console.log('============================================================');
  console.log(`📊 Migration Summary for ${TABLE_NAME}:`);
  console.log(`   - Total listings: ${listings.length}`);
  console.log(`   - Already migrated: ${alreadyMigrated.length}`);
  console.log(`   - Successfully migrated: ${successCount}`);
  console.log(`   - Public listings updated: ${publicUpdatedCount}`);
  console.log(`   - Errors: ${errorCount}`);
  console.log('============================================================');
  console.log('\n🎉 Migration complete!\n');
}

main().catch(console.error);

