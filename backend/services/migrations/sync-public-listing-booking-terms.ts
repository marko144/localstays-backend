/**
 * Migration: Sync Booking Terms to Public Listings
 * 
 * Adds advanceBookingDays and maxBookingNights fields to all existing public listings.
 * 
 * Default values:
 * - advanceBookingDays: 180 (6 months)
 * - maxBookingNights: 30 (1 month)
 * 
 * Usage:
 *   PUBLIC_LISTINGS_TABLE_NAME=localstays-public-listings-staging ts-node backend/services/migrations/sync-public-listing-booking-terms.ts
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

const PUBLIC_LISTINGS_TABLE_NAME =
  process.env.PUBLIC_LISTINGS_TABLE_NAME || 'localstays-public-listings-staging';
const client = new DynamoDBClient({ region: 'eu-north-1' });
const docClient = DynamoDBDocumentClient.from(client);

async function migratePublicListings() {
  console.log('🚀 Starting public listings booking terms migration...');
  console.log(`📊 Table: ${PUBLIC_LISTINGS_TABLE_NAME}`);
  console.log(`📍 Region: eu-north-1\n`);

  let updatedCount = 0;
  let skippedCount = 0;
  let lastEvaluatedKey: any = undefined;

  do {
    const scanResult = await docClient.send(
      new ScanCommand({
        TableName: PUBLIC_LISTINGS_TABLE_NAME,
        FilterExpression: 'attribute_not_exists(advanceBookingDays)',
        ExclusiveStartKey: lastEvaluatedKey,
      })
    );

    const publicListings = scanResult.Items || [];
    console.log(`📦 Found ${publicListings.length} public listings to update in this batch`);

    for (const publicListing of publicListings) {
      try {
        await docClient.send(
          new UpdateCommand({
            TableName: PUBLIC_LISTINGS_TABLE_NAME,
            Key: {
              pk: publicListing.pk,
              sk: publicListing.sk,
            },
            UpdateExpression:
              'SET advanceBookingDays = :advanceBookingDays, maxBookingNights = :maxBookingNights, updatedAt = :now',
            ExpressionAttributeValues: {
              ':advanceBookingDays': 180, // Default: 6 months
              ':maxBookingNights': 30, // Default: 1 month
              ':now': new Date().toISOString(),
            },
          })
        );

        updatedCount++;
        console.log(`✅ Updated public listing: ${publicListing.listingId}`);
      } catch (error) {
        console.error(`❌ Failed to update public listing ${publicListing.listingId}:`, error);
        skippedCount++;
      }
    }

    lastEvaluatedKey = scanResult.LastEvaluatedKey;
  } while (lastEvaluatedKey);

  console.log('\n🎉 Migration complete!');
  console.log(`✅ Updated: ${updatedCount} public listings`);
  console.log(`⏭️  Skipped: ${skippedCount} public listings`);
}

migratePublicListings().catch((error) => {
  console.error('❌ Migration failed:', error);
  process.exit(1);
});



