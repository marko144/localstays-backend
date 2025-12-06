/**
 * Migration Script: Set firstReviewCompletedAt for existing ONLINE listings
 * 
 * This script sets firstReviewCompletedAt = approvedAt for listings that:
 * - Have status ONLINE
 * - Have approvedAt set
 * - Don't already have firstReviewCompletedAt
 * 
 * Run with: npx ts-node backend/scripts/migrate-first-review-completed-at.ts [--dry-run]
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

const client = new DynamoDBClient({ region: 'eu-north-1' });
const docClient = DynamoDBDocumentClient.from(client);

const TABLE_NAME = 'localstays-staging';

interface ListingRecord {
  pk: string;
  sk: string;
  listingId: string;
  status: string;
  approvedAt?: string;
  firstReviewCompletedAt?: string;
}

async function getOnlineListings(): Promise<ListingRecord[]> {
  const listings: ListingRecord[] = [];
  let lastEvaluatedKey: any = undefined;

  do {
    const result = await docClient.send(
      new ScanCommand({
        TableName: TABLE_NAME,
        FilterExpression: 'begins_with(sk, :sk) AND #status = :online',
        ExpressionAttributeNames: {
          '#status': 'status',
        },
        ExpressionAttributeValues: {
          ':sk': 'LISTING_META#',
          ':online': 'ONLINE',
        },
        ProjectionExpression: 'pk, sk, listingId, #status, approvedAt, firstReviewCompletedAt',
        ExclusiveStartKey: lastEvaluatedKey,
      })
    );

    if (result.Items) {
      listings.push(...(result.Items as ListingRecord[]));
    }

    lastEvaluatedKey = result.LastEvaluatedKey;
  } while (lastEvaluatedKey);

  return listings;
}

async function migrateListings(dryRun: boolean): Promise<void> {
  console.log('🔍 Fetching ONLINE listings...');
  const listings = await getOnlineListings();
  console.log(`Found ${listings.length} ONLINE listings`);

  // Filter to listings that need migration
  const needsMigration = listings.filter(
    (l) => l.approvedAt && !l.firstReviewCompletedAt
  );

  console.log(`\n📋 ${needsMigration.length} listings need migration:`);

  for (const listing of needsMigration) {
    console.log(`  - ${listing.listingId}: approvedAt=${listing.approvedAt}`);
  }

  if (dryRun) {
    console.log('\n🏃 DRY RUN - No changes made');
    return;
  }

  if (needsMigration.length === 0) {
    console.log('\n✅ No listings need migration');
    return;
  }

  console.log(`\n🚀 Migrating ${needsMigration.length} listings...`);

  let successCount = 0;
  let errorCount = 0;

  for (const listing of needsMigration) {
    try {
      await docClient.send(
        new UpdateCommand({
          TableName: TABLE_NAME,
          Key: {
            pk: listing.pk,
            sk: listing.sk,
          },
          UpdateExpression: 'SET firstReviewCompletedAt = :firstReviewCompletedAt',
          ConditionExpression: 'attribute_not_exists(firstReviewCompletedAt)',
          ExpressionAttributeValues: {
            ':firstReviewCompletedAt': listing.approvedAt,
          },
        })
      );
      console.log(`  ✅ ${listing.listingId}: firstReviewCompletedAt = ${listing.approvedAt}`);
      successCount++;
    } catch (error: any) {
      if (error.name === 'ConditionalCheckFailedException') {
        console.log(`  ⏭️ ${listing.listingId}: Already has firstReviewCompletedAt (skipped)`);
      } else {
        console.error(`  ❌ ${listing.listingId}: ${error.message}`);
        errorCount++;
      }
    }
  }

  console.log(`\n📊 Migration complete:`);
  console.log(`  - Success: ${successCount}`);
  console.log(`  - Errors: ${errorCount}`);
  console.log(`  - Skipped: ${needsMigration.length - successCount - errorCount}`);
}

// Main execution
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');

console.log('='.repeat(60));
console.log('Migration: Set firstReviewCompletedAt for ONLINE listings');
console.log(`Table: ${TABLE_NAME}`);
console.log(`Mode: ${dryRun ? 'DRY RUN' : 'LIVE'}`);
console.log('='.repeat(60));
console.log('');

migrateListings(dryRun)
  .then(() => {
    console.log('\n✅ Migration script completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Migration script failed:', error);
    process.exit(1);
  });

