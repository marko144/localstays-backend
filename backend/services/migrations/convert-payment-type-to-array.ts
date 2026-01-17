/**
 * Migration Script: Convert paymentType (single) to paymentTypes (array)
 * 
 * This script converts existing listings from the old single paymentType field
 * to the new paymentTypes array field.
 * 
 * Usage:
 *   npx ts-node backend/services/migrations/convert-payment-type-to-array.ts --env=staging
 *   npx ts-node backend/services/migrations/convert-payment-type-to-array.ts --env=production
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

/**
 * Main migration function
 */
async function migratePaymentTypes() {
  console.log('========================================');
  console.log('Convert paymentType to paymentTypes Migration');
  console.log('========================================');
  console.log(`Environment: ${environment}`);
  console.log(`Table: ${TABLE_NAME}`);
  console.log('========================================\n');

  try {
    // 1. Scan for all listing metadata records that have old paymentType (single)
    console.log('Step 1: Scanning for listing metadata records with old paymentType...');
    
    const scanResult = await docClient.send(
      new ScanCommand({
        TableName: TABLE_NAME,
        FilterExpression: 'begins_with(sk, :skPrefix) AND attribute_exists(paymentType) AND attribute_not_exists(paymentTypes)',
        ExpressionAttributeValues: {
          ':skPrefix': 'LISTING_META#',
        },
      })
    );

    const listings = scanResult.Items || [];
    console.log(`Found ${listings.length} listings with old paymentType\n`);

    if (listings.length === 0) {
      console.log('✅ No listings need migration. All listings already have paymentTypes array.');
      return;
    }

    // 2. Update each listing - convert single paymentType to paymentTypes array
    console.log('Step 2: Converting paymentType to paymentTypes array...\n');
    
    let successCount = 0;
    let errorCount = 0;

    for (const listing of listings) {
      try {
        const oldPaymentType = listing.paymentType;
        
        // Convert single object to array with one element
        const newPaymentTypes = [oldPaymentType];

        await docClient.send(
          new UpdateCommand({
            TableName: TABLE_NAME,
            Key: {
              pk: listing.pk,
              sk: listing.sk,
            },
            UpdateExpression: 'SET paymentTypes = :paymentTypes, updatedAt = :updatedAt REMOVE paymentType',
            ExpressionAttributeValues: {
              ':paymentTypes': newPaymentTypes,
              ':updatedAt': new Date().toISOString(),
            },
          })
        );

        successCount++;
        console.log(`✅ Updated listing: ${listing.listingId} - converted ${oldPaymentType?.key || 'unknown'} to array`);
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
migratePaymentTypes();


