/**
 * Migration Script: Backfill GSI3 for Existing Listings
 * 
 * This script updates all existing listing metadata records to populate gsi3pk and gsi3sk
 * for the new ListingLookupIndex (GSI3).
 * 
 * New pattern:
 * - gsi3pk: LISTING#{listingId}
 * - gsi3sk: LISTING_META#{listingId}
 * 
 * Run with:
 * AWS_REGION=eu-north-1 TABLE_NAME=localstays-dev1 npx ts-node backend/services/seed/migrate-listing-gsi3.ts
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

const region = process.env.AWS_REGION || 'eu-north-1';
const tableName = process.env.TABLE_NAME || 'localstays-dev1';

const dynamoClient = new DynamoDBClient({ region });
const docClient = DynamoDBDocumentClient.from(dynamoClient);

interface ListingMetadata {
  pk: string;
  sk: string;
  listingId: string;
  hostId: string;
  gsi3pk?: string;
  gsi3sk?: string;
}

/**
 * Scan for all listing metadata records
 */
async function scanListings(): Promise<ListingMetadata[]> {
  const listings: ListingMetadata[] = [];
  let lastEvaluatedKey: Record<string, any> | undefined = undefined;

  do {
    const result: any = await docClient.send(
      new ScanCommand({
        TableName: tableName,
        FilterExpression: 'begins_with(sk, :skPrefix) AND attribute_exists(listingId)',
        ExpressionAttributeValues: {
          ':skPrefix': 'LISTING_META#',
        },
        ExclusiveStartKey: lastEvaluatedKey,
      })
    );

    if (result.Items) {
      listings.push(...(result.Items as ListingMetadata[]));
    }

    lastEvaluatedKey = result.LastEvaluatedKey;
  } while (lastEvaluatedKey);

  return listings;
}

/**
 * Update a listing's GSI3 attributes
 */
async function updateListingGSI3(listing: ListingMetadata): Promise<void> {
  const newGsi3pk = `LISTING#${listing.listingId}`;
  const newGsi3sk = `LISTING_META#${listing.listingId}`;

  // Check if already has correct values
  if (listing.gsi3pk === newGsi3pk && listing.gsi3sk === newGsi3sk) {
    console.log(`✓ Listing ${listing.listingId} already has correct GSI3 values`);
    return;
  }

  await docClient.send(
    new UpdateCommand({
      TableName: tableName,
      Key: {
        pk: listing.pk,
        sk: listing.sk,
      },
      UpdateExpression: 'SET gsi3pk = :gsi3pk, gsi3sk = :gsi3sk, updatedAt = :updatedAt',
      ExpressionAttributeValues: {
        ':gsi3pk': newGsi3pk,
        ':gsi3sk': newGsi3sk,
        ':updatedAt': new Date().toISOString(),
      },
    })
  );

  console.log(`✅ Updated listing ${listing.listingId}: gsi3pk=${newGsi3pk}`);
}

/**
 * Main migration function
 */
async function migrate() {
  console.log('='.repeat(80));
  console.log('GSI3 Migration Script for Listing Metadata Records');
  console.log('='.repeat(80));
  console.log(`Region: ${region}`);
  console.log(`Table: ${tableName}`);
  console.log('');

  try {
    // Step 1: Scan for all listings
    console.log('Step 1: Scanning for listing metadata records...');
    const listings = await scanListings();
    console.log(`Found ${listings.length} listing(s)\n`);

    if (listings.length === 0) {
      console.log('No listings found. Migration complete.');
      return;
    }

    // Step 2: Update each listing
    console.log('Step 2: Updating GSI3 attributes...');
    let updatedCount = 0;
    let skippedCount = 0;

    for (const listing of listings) {
      const needsUpdate =
        listing.gsi3pk !== `LISTING#${listing.listingId}` ||
        listing.gsi3sk !== `LISTING_META#${listing.listingId}`;

      if (needsUpdate) {
        await updateListingGSI3(listing);
        updatedCount++;
      } else {
        console.log(`✓ Listing ${listing.listingId} already correct`);
        skippedCount++;
      }
    }

    // Summary
    console.log('');
    console.log('='.repeat(80));
    console.log('Migration Summary');
    console.log('='.repeat(80));
    console.log(`Total listings found: ${listings.length}`);
    console.log(`Updated: ${updatedCount}`);
    console.log(`Skipped (already correct): ${skippedCount}`);
    console.log('');
    console.log('✅ Migration completed successfully!');
    console.log('='.repeat(80));
  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  }
}

// Run migration
migrate()
  .then(() => {
    console.log('\n✅ Script completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Script failed:', error);
    process.exit(1);
  });

