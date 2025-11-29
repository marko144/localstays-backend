/**
 * Migration: Add Booking Terms to Existing Listings
 * 
 * Adds advanceBooking and maxBookingDuration fields to all existing listings
 * that don't have these fields yet.
 * 
 * Default values:
 * - advanceBooking: DAYS_180 (6 months)
 * - maxBookingDuration: NIGHTS_30 (1 month)
 * 
 * Usage:
 *   TABLE_NAME=localstays-staging ts-node backend/services/migrations/add-booking-terms.ts
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

const TABLE_NAME = process.env.TABLE_NAME || 'localstays-staging';
const client = new DynamoDBClient({ region: 'eu-north-1' });
const docClient = DynamoDBDocumentClient.from(client);

// Default values
const DEFAULT_ADVANCE_BOOKING = {
  key: 'DAYS_180',
  en: '6 months',
  sr: '6 meseci',
  days: 180,
};

const DEFAULT_MAX_BOOKING_DURATION = {
  key: 'NIGHTS_30',
  en: '1 month',
  sr: '1 mesec',
  nights: 30,
};

async function migrateListings() {
  console.log('🚀 Starting booking terms migration...');
  console.log(`📊 Table: ${TABLE_NAME}`);
  console.log(`📍 Region: eu-north-1\n`);

  let updatedCount = 0;
  let skippedCount = 0;
  let lastEvaluatedKey: any = undefined;

  do {
    const scanResult = await docClient.send(
      new ScanCommand({
        TableName: TABLE_NAME,
        FilterExpression: 'begins_with(sk, :sk) AND attribute_not_exists(advanceBooking)',
        ExpressionAttributeValues: {
          ':sk': 'LISTING_META#',
        },
        ExclusiveStartKey: lastEvaluatedKey,
      })
    );

    const listings = scanResult.Items || [];
    console.log(`📦 Found ${listings.length} listings to update in this batch`);

    for (const listing of listings) {
      try {
        await docClient.send(
          new UpdateCommand({
            TableName: TABLE_NAME,
            Key: {
              pk: listing.pk,
              sk: listing.sk,
            },
            UpdateExpression:
              'SET advanceBooking = :advanceBooking, maxBookingDuration = :maxBookingDuration, updatedAt = :now',
            ExpressionAttributeValues: {
              ':advanceBooking': DEFAULT_ADVANCE_BOOKING,
              ':maxBookingDuration': DEFAULT_MAX_BOOKING_DURATION,
              ':now': new Date().toISOString(),
            },
          })
        );

        updatedCount++;
        console.log(`✅ Updated listing: ${listing.listingId}`);
      } catch (error) {
        console.error(`❌ Failed to update listing ${listing.listingId}:`, error);
        skippedCount++;
      }
    }

    lastEvaluatedKey = scanResult.LastEvaluatedKey;
  } while (lastEvaluatedKey);

  console.log('\n🎉 Migration complete!');
  console.log(`✅ Updated: ${updatedCount} listings`);
  console.log(`⏭️  Skipped: ${skippedCount} listings`);
}

migrateListings().catch((error) => {
  console.error('❌ Migration failed:', error);
  process.exit(1);
});



