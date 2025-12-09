/**
 * Migration Script: Update GSI8 Sort Key to Composite Format
 * 
 * This script updates all existing listing metadata records to use the new
 * composite gsi8sk format that includes readyToApprove for efficient filtering:
 * 
 * Old format: LISTING#{listingId}
 * New format: READY#{true|false}#LISTING#{listingId}
 * 
 * This allows querying by location + readyToApprove status using begins_with
 * on the sort key, avoiding inefficient post-query filtering.
 * 
 * Run with:
 * AWS_REGION=eu-north-1 TABLE_NAME=localstays-staging npx ts-node backend/services/seed/migrate-gsi8-composite-key.ts
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

const region = process.env.AWS_REGION || 'eu-north-1';
const tableName = process.env.TABLE_NAME || 'localstays-staging';

const dynamoClient = new DynamoDBClient({ region });
const docClient = DynamoDBDocumentClient.from(dynamoClient);

interface ListingMetadata {
  pk: string;
  sk: string;
  listingId: string;
  hostId: string;
  locationId?: string;
  gsi8pk?: string;
  gsi8sk?: string;
  readyToApprove?: boolean;
}

/**
 * Scan all listing metadata records that have gsi8sk set
 */
async function scanListingsWithGsi8(): Promise<ListingMetadata[]> {
  const listings: ListingMetadata[] = [];
  let lastEvaluatedKey: Record<string, any> | undefined;

  do {
    const result = await docClient.send(
      new ScanCommand({
        TableName: tableName,
        FilterExpression: 'begins_with(sk, :sk) AND attribute_exists(gsi8sk)',
        ExpressionAttributeValues: {
          ':sk': 'LISTING_META#',
        },
        ExclusiveStartKey: lastEvaluatedKey,
      })
    );

    if (result.Items) {
      listings.push(...(result.Items as ListingMetadata[]));
    }

    lastEvaluatedKey = result.LastEvaluatedKey;
    console.log(`Scanned ${listings.length} listings so far...`);
  } while (lastEvaluatedKey);

  return listings;
}

/**
 * Update a listing's gsi8sk to the new composite format
 */
async function updateListingGsi8sk(listing: ListingMetadata): Promise<void> {
  const isReady = listing.readyToApprove === true;
  const newGsi8sk = `READY#${isReady}#LISTING#${listing.listingId}`;
  
  // Skip if already in new format
  if (listing.gsi8sk?.startsWith('READY#')) {
    console.log(`⏭️  Skipping ${listing.listingId} - already in new format`);
    return;
  }

  await docClient.send(
    new UpdateCommand({
      TableName: tableName,
      Key: {
        pk: listing.pk,
        sk: listing.sk,
      },
      UpdateExpression: 'SET gsi8sk = :gsi8sk',
      ExpressionAttributeValues: {
        ':gsi8sk': newGsi8sk,
      },
    })
  );

  console.log(`✅ Updated ${listing.listingId}: gsi8sk = ${newGsi8sk} (readyToApprove=${isReady})`);
}

/**
 * Main migration function
 */
async function migrate() {
  console.log('='.repeat(60));
  console.log('GSI8 Composite Key Migration');
  console.log(`Table: ${tableName}`);
  console.log(`Region: ${region}`);
  console.log('='.repeat(60));
  console.log('');

  // 1. Scan all listings with gsi8sk
  console.log('📊 Scanning listings with GSI8 keys...');
  const listings = await scanListingsWithGsi8();
  console.log(`Found ${listings.length} listings with GSI8 keys`);
  console.log('');

  if (listings.length === 0) {
    console.log('No listings to migrate.');
    return;
  }

  // 2. Update each listing
  console.log('🔄 Updating listings to new composite format...');
  let updatedCount = 0;
  let skippedCount = 0;
  let errorCount = 0;

  for (const listing of listings) {
    try {
      if (listing.gsi8sk?.startsWith('READY#')) {
        skippedCount++;
        continue;
      }
      await updateListingGsi8sk(listing);
      updatedCount++;
    } catch (error) {
      console.error(`❌ Failed to update ${listing.listingId}:`, error);
      errorCount++;
    }
  }

  console.log('');
  console.log('='.repeat(60));
  console.log('Migration Complete');
  console.log('='.repeat(60));
  console.log(`✅ Updated: ${updatedCount}`);
  console.log(`⏭️  Skipped (already migrated): ${skippedCount}`);
  console.log(`❌ Errors: ${errorCount}`);
  console.log(`📊 Total processed: ${listings.length}`);
}

// Run migration
migrate()
  .then(() => {
    console.log('');
    console.log('Done!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Migration failed:', error);
    process.exit(1);
  });

