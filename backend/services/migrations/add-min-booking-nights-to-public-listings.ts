/**
 * Migration: Add minBookingNights to Existing PublicListingRecord Records
 * 
 * This script adds the minBookingNights field (default: 1) to all existing PublicListingRecord records.
 * 
 * Usage:
 *   ts-node backend/services/migrations/add-min-booking-nights-to-public-listings.ts
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

const client = new DynamoDBClient({ region: 'eu-north-1' });
const docClient = DynamoDBDocumentClient.from(client);

const PUBLIC_LISTINGS_TABLE_NAME = 'localstays-public-listings-staging'; // Change for production
const DEFAULT_MIN_BOOKING_NIGHTS = 1;

interface PublicListingRecord {
  pk: string;
  sk: string;
  listingId: string;
  minBookingNights?: number;
}

async function addMinBookingNightsToPublicListings() {
  console.log('🔍 Starting migration: Add minBookingNights to existing public listings...');
  console.log(`📊 Table: ${PUBLIC_LISTINGS_TABLE_NAME}`);
  console.log(`📌 Default value: ${DEFAULT_MIN_BOOKING_NIGHTS} nights\n`);

  let totalScanned = 0;
  let totalUpdated = 0;
  let totalSkipped = 0;
  let lastEvaluatedKey: Record<string, any> | undefined = undefined;

  do {
    // Scan for all LISTING records
    const scanResult: any = await docClient.send(
      new ScanCommand({
        TableName: PUBLIC_LISTINGS_TABLE_NAME,
        FilterExpression: 'begins_with(sk, :sk)',
        ExpressionAttributeValues: {
          ':sk': 'LISTING#',
        },
        ExclusiveStartKey: lastEvaluatedKey,
      })
    );

    const listings = (scanResult.Items || []) as PublicListingRecord[];
    totalScanned += listings.length;

    console.log(`📦 Scanned ${listings.length} public listings in this batch...`);

    // Process each listing
    for (const listing of listings) {
      // Skip if minBookingNights already exists
      if (listing.minBookingNights !== undefined) {
        console.log(`⏭️  Skipped ${listing.listingId} - minBookingNights already exists (${listing.minBookingNights})`);
        totalSkipped++;
        continue;
      }

      try {
        // Add minBookingNights to public listing
        await docClient.send(
          new UpdateCommand({
            TableName: PUBLIC_LISTINGS_TABLE_NAME,
            Key: {
              pk: listing.pk,
              sk: listing.sk,
            },
            UpdateExpression: 'SET minBookingNights = :minBookingNights, updatedAt = :now',
            ExpressionAttributeValues: {
              ':minBookingNights': DEFAULT_MIN_BOOKING_NIGHTS,
              ':now': new Date().toISOString(),
            },
          })
        );

        console.log(`✅ Updated ${listing.listingId} - added minBookingNights = ${DEFAULT_MIN_BOOKING_NIGHTS}`);
        totalUpdated++;
      } catch (error) {
        console.error(`❌ Failed to update ${listing.listingId}:`, error);
      }
    }

    lastEvaluatedKey = scanResult.LastEvaluatedKey;
  } while (lastEvaluatedKey);

  console.log('\n📊 Migration Summary:');
  console.log(`   Total Scanned:  ${totalScanned}`);
  console.log(`   Total Updated:  ${totalUpdated}`);
  console.log(`   Total Skipped:  ${totalSkipped}`);
  console.log('\n✅ Migration complete!');
}

// Run migration
addMinBookingNightsToPublicListings().catch((error) => {
  console.error('❌ Migration failed:', error);
  process.exit(1);
});

