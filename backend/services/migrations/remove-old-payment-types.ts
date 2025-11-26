/**
 * Migration Script: Remove Old Payment Types from Metadata
 * 
 * This script removes PAY_ONLINE and PAY_DEPOSIT_ONLINE from the metadata table
 * 
 * Usage:
 *   npx ts-node backend/services/migrations/remove-old-payment-types.ts --env=staging
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, DeleteCommand } from '@aws-sdk/lib-dynamodb';

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

// Get environment from command line args
const args = process.argv.slice(2);
const envArg = args.find(arg => arg.startsWith('--env='));
const environment = envArg ? envArg.split('=')[1] : 'staging';

const TABLE_NAME = `localstays-${environment}`;

// Payment types to remove
const PAYMENT_TYPES_TO_REMOVE = ['PAY_ONLINE', 'PAY_DEPOSIT_ONLINE'];

/**
 * Main migration function
 */
async function removeOldPaymentTypes() {
  console.log('========================================');
  console.log('Remove Old Payment Types Migration');
  console.log('========================================');
  console.log(`Environment: ${environment}`);
  console.log(`Table: ${TABLE_NAME}`);
  console.log(`Removing: ${PAYMENT_TYPES_TO_REMOVE.join(', ')}`);
  console.log('========================================\n');

  try {
    let successCount = 0;
    let errorCount = 0;

    for (const paymentType of PAYMENT_TYPES_TO_REMOVE) {
      try {
        await docClient.send(
          new DeleteCommand({
            TableName: TABLE_NAME,
            Key: {
              pk: 'METADATA#PAYMENT_TYPE',
              sk: `PAYMENT_TYPE#${paymentType}`,
            },
          })
        );

        successCount++;
        console.log(`✅ Deleted payment type: ${paymentType}`);
      } catch (error: any) {
        errorCount++;
        console.error(`❌ Failed to delete payment type: ${paymentType}`, error.message);
      }
    }

    // Summary
    console.log('\n========================================');
    console.log('Migration Summary');
    console.log('========================================');
    console.log(`Total payment types to remove: ${PAYMENT_TYPES_TO_REMOVE.length}`);
    console.log(`Successfully deleted: ${successCount}`);
    console.log(`Failed: ${errorCount}`);
    console.log('========================================\n');

    if (errorCount === 0) {
      console.log('✅ Migration completed successfully!');
    } else {
      console.log('⚠️  Migration completed with errors. Please review the failed deletions.');
      process.exit(1);
    }
  } catch (error: any) {
    console.error('\n❌ Migration failed:', error);
    process.exit(1);
  }
}

// Run migration
removeOldPaymentTypes();

