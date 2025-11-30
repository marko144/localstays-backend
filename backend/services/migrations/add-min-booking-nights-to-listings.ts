/**
 * Migration: Add minBookingNights to Existing ListingMetadata Records
 * 
 * This script adds the minBookingNights field (default: 1) to all existing ListingMetadata records.
 * 
 * Usage:
 *   ts-node backend/services/migrations/add-min-booking-nights-to-listings.ts
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

const client = new DynamoDBClient({ region: 'eu-north-1' });
const docClient = DynamoDBDocumentClient.from(client);

const TABLE_NAME = 'localstays-staging'; // Change for production
const DEFAULT_MIN_BOOKING_NIGHTS = 1;

interface ListingMetadata {
  pk: string;
  sk: string;
  listingId: string;
  minBookingNights?: number;
}

async function addMinBookingNightsToListings() {
  console.log('🔍 Starting migration: Add minBookingNights to existing listings...');
  console.log(`📊 Table: ${TABLE_NAME}`);
  console.log(`📌 Default value: ${DEFAULT_MIN_BOOKING_NIGHTS} nights\n`);

  let totalScanned = 0;
  let totalUpdated = 0;
  let totalSkipped = 0;
  let lastEvaluatedKey: Record<string, any> | undefined = undefined;

  do {
    // Scan for all LISTING_META records
    const scanResult: any = await docClient.send(
      new ScanCommand({
        TableName: TABLE_NAME,
        FilterExpression: 'begins_with(sk, :sk)',
        ExpressionAttributeValues: {
          ':sk': 'LISTING_META#',
        },
        ExclusiveStartKey: lastEvaluatedKey,
      })
    );

    const listings = (scanResult.Items || []) as ListingMetadata[];
    totalScanned += listings.length;

    console.log(`📦 Scanned ${listings.length} listings in this batch...`);

    // Process each listing
    for (const listing of listings) {
      // Skip if minBookingNights already exists
      if (listing.minBookingNights !== undefined) {
        console.log(`⏭️  Skipped ${listing.listingId} - minBookingNights already exists (${listing.minBookingNights})`);
        totalSkipped++;
        continue;
      }

      try {
        // Add minBookingNights to listing
        await docClient.send(
          new UpdateCommand({
            TableName: TABLE_NAME,
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
addMinBookingNightsToListings().catch((error) => {
  console.error('❌ Migration failed:', error);
  process.exit(1);
});

