/**
 * Migration Script: Add Payment Type to Existing Listings
 * 
 * This script adds the default paymentType (PAY_ONLINE) to all existing listings
 * that don't have a paymentType field.
 * 
 * Usage:
 *   npx ts-node backend/services/migrations/add-payment-type-to-listings.ts --env=staging
 *   npx ts-node backend/services/migrations/add-payment-type-to-listings.ts --env=production
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

// Get environment from command line args
const args = process.argv.slice(2);
const envArg = args.find(arg => arg.startsWith('--env='));
const environment = envArg ? envArg.split('=')[1] : 'staging';

const TABLE_NAME = `localstays-${environment}`;

// Default payment type enum (bilingual)
const DEFAULT_PAYMENT_TYPE = {
  key: 'PAY_ONLINE',
  en: 'Pay Online',
  sr: 'Plaćanje online',
};

/**
 * Main migration function
 */
async function migrateListings() {
  console.log('========================================');
  console.log('Payment Type Migration');
  console.log('========================================');
  console.log(`Environment: ${environment}`);
  console.log(`Table: ${TABLE_NAME}`);
  console.log(`Default Payment Type: ${DEFAULT_PAYMENT_TYPE.key}`);
  console.log('========================================\n');

  try {
    // 1. Scan for all listing metadata records
    console.log('Step 1: Scanning for listing metadata records...');
    
    const scanResult = await docClient.send(
      new ScanCommand({
        TableName: TABLE_NAME,
        FilterExpression: 'begins_with(sk, :skPrefix) AND attribute_not_exists(paymentType)',
        ExpressionAttributeValues: {
          ':skPrefix': 'LISTING_META#',
        },
      })
    );

    const listings = scanResult.Items || [];
    console.log(`Found ${listings.length} listings without paymentType\n`);

    if (listings.length === 0) {
      console.log('✅ No listings need migration. All listings already have paymentType.');
      return;
    }

    // 2. Update each listing
    console.log('Step 2: Updating listings...\n');
    
    let successCount = 0;
    let errorCount = 0;

    for (const listing of listings) {
      try {
        await docClient.send(
          new UpdateCommand({
            TableName: TABLE_NAME,
            Key: {
              pk: listing.pk,
              sk: listing.sk,
            },
            UpdateExpression: 'SET paymentType = :paymentType, updatedAt = :updatedAt',
            ExpressionAttributeValues: {
              ':paymentType': DEFAULT_PAYMENT_TYPE,
              ':updatedAt': new Date().toISOString(),
            },
          })
        );

        successCount++;
        console.log(`✅ Updated listing: ${listing.listingId} (${listing.listingName})`);
      } catch (error: any) {
        errorCount++;
        console.error(`❌ Failed to update listing: ${listing.listingId}`, error.message);
      }
    }

    // 3. Summary
    console.log('\n========================================');
    console.log('Migration Summary');
    console.log('========================================');
    console.log(`Total listings found: ${listings.length}`);
    console.log(`Successfully updated: ${successCount}`);
    console.log(`Failed: ${errorCount}`);
    console.log('========================================\n');

    if (errorCount === 0) {
      console.log('✅ Migration completed successfully!');
    } else {
      console.log('⚠️  Migration completed with errors. Please review the failed listings.');
      process.exit(1);
    }
  } catch (error: any) {
    console.error('\n❌ Migration failed:', error);
    process.exit(1);
  }
}

// Run migration
migrateListings();

