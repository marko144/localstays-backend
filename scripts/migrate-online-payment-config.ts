/**
 * Migration Script: Add onlinePaymentConfig to listings with LOKALSTAYS_ONLINE payment type
 * 
 * This script finds all listings that have LOKALSTAYS_ONLINE in their paymentTypes
 * and adds the default onlinePaymentConfig:
 * - allowFullPayment: true
 * - allowDeposit: true
 * - depositPercentage: 50
 * 
 * Usage:
 *   npx ts-node scripts/migrate-online-payment-config.ts [--dry-run] [--env staging|production]
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const envIndex = args.indexOf('--env');
const env = envIndex !== -1 ? args[envIndex + 1] : 'staging';

const TABLE_NAME = `localstays-${env}`;

const client = new DynamoDBClient({ region: 'eu-north-1' });
const docClient = DynamoDBDocumentClient.from(client);

const DEFAULT_ONLINE_PAYMENT_CONFIG = {
  allowFullPayment: true,
  allowDeposit: true,
  depositPercentage: 50,
};

interface ListingMetadata {
  pk: string;
  sk: string;
  listingId: string;
  hostId: string;
  paymentTypes?: Array<{ key: string; en: string; sr: string }>;
  onlinePaymentConfig?: {
    allowFullPayment: boolean;
    allowDeposit: boolean;
    depositPercentage?: number;
  };
  isDeleted?: boolean;
}

async function migrateOnlinePaymentConfig(): Promise<void> {
  console.log('='.repeat(60));
  console.log('Migration: Add onlinePaymentConfig to LOKALSTAYS_ONLINE listings');
  console.log('='.repeat(60));
  console.log(`Environment: ${env}`);
  console.log(`Table: ${TABLE_NAME}`);
  console.log(`Mode: ${isDryRun ? 'DRY RUN (no changes will be made)' : 'LIVE'}`);
  console.log('='.repeat(60));

  let lastEvaluatedKey: Record<string, any> | undefined;
  let scannedCount = 0;
  let needsUpdateCount = 0;
  let updatedCount = 0;
  let skippedCount = 0;
  let errorCount = 0;

  do {
    // Scan for listing metadata records
    const scanResult = await docClient.send(
      new ScanCommand({
        TableName: TABLE_NAME,
        FilterExpression: 'begins_with(sk, :sk) AND isDeleted = :notDeleted',
        ExpressionAttributeValues: {
          ':sk': 'LISTING_META#',
          ':notDeleted': false,
        },
        ExclusiveStartKey: lastEvaluatedKey,
      })
    );

    const items = (scanResult.Items || []) as ListingMetadata[];
    scannedCount += items.length;

    for (const listing of items) {
      // Check if listing has LOKALSTAYS_ONLINE in paymentTypes
      const hasOnlinePayment = listing.paymentTypes?.some(
        (pt) => pt.key === 'LOKALSTAYS_ONLINE'
      );

      if (!hasOnlinePayment) {
        // No online payment, skip
        continue;
      }

      // Check if already has onlinePaymentConfig
      if (listing.onlinePaymentConfig) {
        console.log(`⏭️  Skipping ${listing.listingId} - already has onlinePaymentConfig`);
        skippedCount++;
        continue;
      }

      needsUpdateCount++;

      if (isDryRun) {
        console.log(`[DRY RUN] Would update ${listing.listingId} with default onlinePaymentConfig`);
        continue;
      }

      // Update the listing with default config
      try {
        await docClient.send(
          new UpdateCommand({
            TableName: TABLE_NAME,
            Key: {
              pk: listing.pk,
              sk: listing.sk,
            },
            UpdateExpression: 'SET #config = :config, #updatedAt = :updatedAt',
            ExpressionAttributeNames: {
              '#config': 'onlinePaymentConfig',
              '#updatedAt': 'updatedAt',
            },
            ExpressionAttributeValues: {
              ':config': DEFAULT_ONLINE_PAYMENT_CONFIG,
              ':updatedAt': new Date().toISOString(),
            },
          })
        );

        console.log(`✅ Updated ${listing.listingId}`);
        updatedCount++;
      } catch (error) {
        console.error(`❌ Failed to update ${listing.listingId}:`, error);
        errorCount++;
      }
    }

    lastEvaluatedKey = scanResult.LastEvaluatedKey;
  } while (lastEvaluatedKey);

  console.log('');
  console.log('='.repeat(60));
  console.log('Migration Summary');
  console.log('='.repeat(60));
  console.log(`Total listings scanned: ${scannedCount}`);
  console.log(`Listings with LOKALSTAYS_ONLINE needing update: ${needsUpdateCount}`);
  console.log(`Already had config (skipped): ${skippedCount}`);
  if (isDryRun) {
    console.log(`Would update: ${needsUpdateCount}`);
  } else {
    console.log(`Successfully updated: ${updatedCount}`);
    console.log(`Errors: ${errorCount}`);
  }
  console.log('='.repeat(60));
}

// Run migration
migrateOnlinePaymentConfig()
  .then(() => {
    console.log('Migration complete.');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Migration failed:', error);
    process.exit(1);
  });

