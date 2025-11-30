/**
 * Migration: Add taxesIncludedInPrice Flag to Existing Pricing Records
 * 
 * Adds taxesIncludedInPrice field to all existing PRICING_MATRIX records
 * that don't have this field yet.
 * 
 * Default value: false (taxes NOT included in price)
 * 
 * Usage:
 *   TABLE_NAME=localstays-staging ts-node backend/services/migrations/add-taxes-included-flag.ts
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

const TABLE_NAME = process.env.TABLE_NAME || 'localstays-staging';
const client = new DynamoDBClient({ region: 'eu-north-1' });
const docClient = DynamoDBDocumentClient.from(client);

async function migratePricingRecords() {
  console.log('🚀 Starting taxesIncludedInPrice flag migration...');
  console.log(`📊 Table: ${TABLE_NAME}`);
  console.log(`📍 Region: eu-north-1\n`);

  let updatedCount = 0;
  let skippedCount = 0;
  let alreadyHasFlagCount = 0;
  let lastEvaluatedKey: any = undefined;

  do {
    const scanResult = await docClient.send(
      new ScanCommand({
        TableName: TABLE_NAME,
        FilterExpression: 'contains(sk, :sk) AND attribute_not_exists(taxesIncludedInPrice)',
        ExpressionAttributeValues: {
          ':sk': '#MATRIX',
        },
        ExclusiveStartKey: lastEvaluatedKey,
      })
    );

    const pricingRecords = scanResult.Items || [];
    console.log(`📦 Found ${pricingRecords.length} pricing matrix records without flag in this batch\n`);

    for (const record of pricingRecords) {
      const listingId = record.listingId;

      try {
        await docClient.send(
          new UpdateCommand({
            TableName: TABLE_NAME,
            Key: {
              pk: record.pk,
              sk: record.sk,
            },
            UpdateExpression: 'SET taxesIncludedInPrice = :flag, updatedAt = :now',
            ExpressionAttributeValues: {
              ':flag': false,  // Default to false (taxes NOT included)
              ':now': new Date().toISOString(),
            },
          })
        );

        updatedCount++;
        console.log(`✅ Listing ${listingId}: Added taxesIncludedInPrice = false`);
      } catch (error) {
        console.error(`❌ Failed to update listing ${listingId}:`, error);
        skippedCount++;
      }
    }

    lastEvaluatedKey = scanResult.LastEvaluatedKey;

    if (lastEvaluatedKey) {
      console.log('\n📄 Fetching next page...\n');
    }
  } while (lastEvaluatedKey);

  console.log('\n' + '='.repeat(60));
  console.log('🎉 Migration complete!');
  console.log('='.repeat(60));
  console.log(`✅ Updated:           ${updatedCount} pricing records`);
  console.log(`✓  Already had flag:  ${alreadyHasFlagCount} pricing records`);
  console.log(`❌ Failed:            ${skippedCount} pricing records`);
  console.log('='.repeat(60));
}

migratePricingRecords().catch((error) => {
  console.error('❌ Migration failed:', error);
  process.exit(1);
});




