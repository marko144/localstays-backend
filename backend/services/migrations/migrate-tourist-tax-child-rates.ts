/**
 * Migration: Convert Tourist Tax childAmount to childRates Array
 * 
 * Converts legacy single childAmount field to the new childRates array structure.
 * 
 * Conversion:
 * - Old: { childAmount: 1.50 }
 * - New: { childRates: [{ ageFrom: 0, ageTo: 17, amount: 1.50, ... }] }
 * 
 * Only updates PRICING_MATRIX records that have touristTax with childAmount.
 * 
 * Usage:
 *   TABLE_NAME=localstays-staging ts-node backend/services/migrations/migrate-tourist-tax-child-rates.ts
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';

const TABLE_NAME = process.env.TABLE_NAME || 'localstays-staging';
const client = new DynamoDBClient({ region: 'eu-north-1' });
const docClient = DynamoDBDocumentClient.from(client);

/**
 * Generate display labels for age range
 */
function generateDisplayLabels(ageFrom: number, ageTo: number) {
  // For inclusive range 0-17, display shows "0-17 years"
  return {
    en: `Children ${ageFrom}-${ageTo} years`,
    sr: `Deca ${ageFrom}-${ageTo} godina`,
  };
}

/**
 * Convert legacy childAmount to childRates array
 */
function convertToChildRates(childAmount: number) {
  return [
    {
      childRateId: `cr_${uuidv4()}`,
      ageFrom: 0,
      ageTo: 17,
      amount: childAmount,
      displayLabel: generateDisplayLabels(0, 17),
    },
  ];
}

async function migrateTouristTax() {
  console.log('🚀 Starting tourist tax migration...');
  console.log(`📊 Table: ${TABLE_NAME}`);
  console.log(`📍 Region: eu-north-1\n`);

  let updatedCount = 0;
  let skippedCount = 0;
  let noTouristTaxCount = 0;
  let alreadyMigratedCount = 0;
  let lastEvaluatedKey: any = undefined;

  do {
    // Scan for all PRICING_MATRIX records
    const scanResult = await docClient.send(
      new ScanCommand({
        TableName: TABLE_NAME,
        FilterExpression: 'contains(sk, :sk)',
        ExpressionAttributeValues: {
          ':sk': '#MATRIX',
        },
        ExclusiveStartKey: lastEvaluatedKey,
      })
    );

    const pricingRecords = scanResult.Items || [];
    console.log(`📦 Found ${pricingRecords.length} pricing matrix records in this batch\n`);

    for (const record of pricingRecords) {
      const listingId = record.listingId;

      // Skip if no tourist tax configured
      if (!record.touristTax) {
        noTouristTaxCount++;
        console.log(`⏭️  Listing ${listingId}: No tourist tax configured`);
        continue;
      }

      // Skip if already has childRates (already migrated)
      if (record.touristTax.childRates && Array.isArray(record.touristTax.childRates)) {
        alreadyMigratedCount++;
        console.log(`✓  Listing ${listingId}: Already has childRates`);
        continue;
      }

      // Skip if no childAmount (shouldn't happen, but safety check)
      if (typeof record.touristTax.childAmount !== 'number') {
        skippedCount++;
        console.log(`❌ Listing ${listingId}: Invalid childAmount, skipping`);
        continue;
      }

      try {
        const childAmount = record.touristTax.childAmount;
        const childRates = convertToChildRates(childAmount);

        // Update the record with new childRates structure
        await docClient.send(
          new UpdateCommand({
            TableName: TABLE_NAME,
            Key: {
              pk: record.pk,
              sk: record.sk,
            },
            UpdateExpression:
              'SET touristTax.childRates = :childRates, updatedAt = :now REMOVE touristTax.childAmount',
            ExpressionAttributeValues: {
              ':childRates': childRates,
              ':now': new Date().toISOString(),
            },
          })
        );

        updatedCount++;
        console.log(`✅ Listing ${listingId}: Migrated childAmount ${childAmount} → childRates (0-17 years)`);
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
  console.log(`✅ Migrated:          ${updatedCount} listings`);
  console.log(`✓  Already migrated:  ${alreadyMigratedCount} listings`);
  console.log(`⏭️  No tourist tax:    ${noTouristTaxCount} listings`);
  console.log(`❌ Failed:            ${skippedCount} listings`);
  console.log('='.repeat(60));
}

migrateTouristTax().catch((error) => {
  console.error('❌ Migration failed:', error);
  process.exit(1);
});


