/**
 * Migration: Add .days and .nights metadata to advanceBooking and maxBookingDuration enums
 * 
 * Background:
 * - advanceBooking and maxBookingDuration enums were stored without the numeric metadata (.days, .nights)
 * - This causes issues in publish-listing.ts which expects listing.advanceBooking.days and listing.maxBookingDuration.nights
 * 
 * This migration:
 * 1. Scans all LISTING_META records
 * 2. For each listing with advanceBooking or maxBookingDuration
 * 3. Fetches the full enum with metadata
 * 4. Updates the listing to include the numeric values
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  ScanCommand,
  ScanCommandOutput,
  GetCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';

const client = new DynamoDBClient({ region: 'eu-north-1' });
const docClient = DynamoDBDocumentClient.from(client);
const TABLE_NAME = 'localstays-staging';

interface EnumRecord {
  enumValue: string;
  translations: {
    en: string;
    sr: string;
  };
  metadata?: {
    days?: number;
    nights?: number;
  };
}

async function fetchEnumWithMetadata(enumType: string, enumValue: string): Promise<EnumRecord | null> {
  try {
    const result = await docClient.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: {
          pk: `ENUM#${enumType}`,
          sk: `VALUE#${enumValue}`,
        },
      })
    );

    if (!result.Item) {
      console.warn(`❌ Enum not found: ${enumType}:${enumValue}`);
      return null;
    }

    return {
      enumValue: result.Item.enumValue,
      translations: result.Item.translations,
      metadata: result.Item.metadata,
    };
  } catch (error) {
    console.error(`Failed to fetch enum ${enumType}:${enumValue}:`, error);
    return null;
  }
}

async function migrateListingMetadata() {
  console.log('🔍 Starting migration: Add .days and .nights to booking duration enums...');
  console.log(`📊 Table: ${TABLE_NAME}\n`);

  let processedCount = 0;
  let updatedCount = 0;
  let errorCount = 0;
  let lastEvaluatedKey: Record<string, any> | undefined;

  do {
    const scanResult: ScanCommandOutput = await docClient.send(
      new ScanCommand({
        TableName: TABLE_NAME,
        FilterExpression: 'begins_with(sk, :sk)',
        ExpressionAttributeValues: {
          ':sk': 'LISTING_META#',
        },
        ExclusiveStartKey: lastEvaluatedKey,
      })
    );

    for (const item of scanResult.Items || []) {
      processedCount++;
      const listingId = item.listingId;

      try {
        let needsUpdate = false;
        const updateParts: string[] = [];
        const expressionAttributeValues: Record<string, any> = {
          ':now': new Date().toISOString(),
        };
        const expressionAttributeNames: Record<string, string> = {};

        // Check advanceBooking
        if (item.advanceBooking && !item.advanceBooking.days) {
          const advanceBookingEnum = await fetchEnumWithMetadata(
            'ADVANCE_BOOKING',
            item.advanceBooking.key
          );

          if (advanceBookingEnum && advanceBookingEnum.metadata?.days) {
            updateParts.push('#advanceBooking = :advanceBooking');
            expressionAttributeNames['#advanceBooking'] = 'advanceBooking';
            expressionAttributeValues[':advanceBooking'] = {
              key: advanceBookingEnum.enumValue,
              en: advanceBookingEnum.translations.en,
              sr: advanceBookingEnum.translations.sr,
              days: advanceBookingEnum.metadata.days,
            };
            needsUpdate = true;
            console.log(`  ✓ ${listingId}: advanceBooking.days = ${advanceBookingEnum.metadata.days}`);
          }
        }

        // Check maxBookingDuration
        if (item.maxBookingDuration && !item.maxBookingDuration.nights) {
          const maxBookingEnum = await fetchEnumWithMetadata(
            'MAX_BOOKING_DURATION',
            item.maxBookingDuration.key
          );

          if (maxBookingEnum && maxBookingEnum.metadata?.nights) {
            updateParts.push('#maxBookingDuration = :maxBookingDuration');
            expressionAttributeNames['#maxBookingDuration'] = 'maxBookingDuration';
            expressionAttributeValues[':maxBookingDuration'] = {
              key: maxBookingEnum.enumValue,
              en: maxBookingEnum.translations.en,
              sr: maxBookingEnum.translations.sr,
              nights: maxBookingEnum.metadata.nights,
            };
            needsUpdate = true;
            console.log(`  ✓ ${listingId}: maxBookingDuration.nights = ${maxBookingEnum.metadata.nights}`);
          }
        }

        // Update if needed
        if (needsUpdate) {
          updateParts.push('updatedAt = :now');
          
          await docClient.send(
            new UpdateCommand({
              TableName: TABLE_NAME,
              Key: {
                pk: item.pk,
                sk: item.sk,
              },
              UpdateExpression: `SET ${updateParts.join(', ')}`,
              ExpressionAttributeNames: Object.keys(expressionAttributeNames).length > 0 
                ? expressionAttributeNames 
                : undefined,
              ExpressionAttributeValues: expressionAttributeValues,
            })
          );

          updatedCount++;
        }
      } catch (error) {
        console.error(`❌ Failed to update ${listingId}:`, error);
        errorCount++;
      }
    }

    lastEvaluatedKey = scanResult.LastEvaluatedKey;
  } while (lastEvaluatedKey);

  console.log('\n✅ Migration complete!');
  console.log(`📊 Processed: ${processedCount} listings`);
  console.log(`✅ Updated: ${updatedCount} listings`);
  console.log(`❌ Errors: ${errorCount}`);
}

// Run migration
migrateListingMetadata()
  .then(() => {
    console.log('\n🎉 Migration successful!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Migration failed:', error);
    process.exit(1);
  });

