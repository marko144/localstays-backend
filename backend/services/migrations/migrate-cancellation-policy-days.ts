/**
 * Migration: Add days metadata to cancellationPolicy enums
 * 
 * Background:
 * - Cancellation policy enums were stored without the numeric metadata (.days)
 * - This migration adds the days value to existing listings
 * - Also handles conversion of deprecated enum values:
 *   - ONE_WEEK → 7_DAYS
 *   - OTHER → removed (will be set to 7_DAYS as fallback)
 * 
 * This migration:
 * 1. Scans all LISTING_META records
 * 2. For each listing with cancellationPolicy
 * 3. Fetches the full enum with metadata
 * 4. Updates the listing to include the days value
 * 5. Converts deprecated enum values to new ones
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, UpdateCommand, GetCommand } from '@aws-sdk/lib-dynamodb';

// Set region explicitly
const client = new DynamoDBClient({ region: 'eu-north-1' });
const docClient = DynamoDBDocumentClient.from(client);

// Get table name from environment or default to staging
const TABLE_NAME = process.env.TABLE_NAME || 'localstays-staging';

// Mapping for deprecated enum values
const DEPRECATED_ENUM_MAPPING: Record<string, string> = {
  'ONE_WEEK': '7_DAYS',
  'OTHER': '7_DAYS',  // Fallback for OTHER since we're removing it
};

interface EnumRecord {
  enumValue: string;
  translations: {
    en: string;
    sr: string;
  };
  metadata?: {
    days?: number;
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

async function migrateCancellationPolicyDays() {
  console.log('🔍 Starting migration: Add days metadata to cancellationPolicy enums...');
  console.log(`📊 Table: ${TABLE_NAME}\n`);

  let processedCount = 0;
  let updatedCount = 0;
  let skippedCount = 0;
  let errorCount = 0;
  let deprecatedConversions = 0;
  let lastEvaluatedKey: Record<string, any> | undefined;

  do {
    // Scan for listing metadata records
    const scanResult = await docClient.send(
      new ScanCommand({
        TableName: TABLE_NAME,
        FilterExpression: 'begins_with(pk, :pkPrefix) AND begins_with(sk, :skPrefix)',
        ExpressionAttributeValues: {
          ':pkPrefix': 'HOST#',
          ':skPrefix': 'LISTING_META#',
        },
        ExclusiveStartKey: lastEvaluatedKey,
      })
    );

    const items = scanResult.Items || [];
    console.log(`📦 Processing batch of ${items.length} listings...`);

    for (const item of items) {
      processedCount++;
      const listingId = item.listingId;

      // Check if cancellationPolicy exists
      if (!item.cancellationPolicy) {
        console.log(`⏭️  [${listingId}] No cancellationPolicy - skipping`);
        skippedCount++;
        continue;
      }

      const cancellationPolicy = item.cancellationPolicy;
      let currentTypeKey: string;

      // Handle both object format and string format (shouldn't happen but just in case)
      if (typeof cancellationPolicy.type === 'string') {
        currentTypeKey = cancellationPolicy.type;
      } else if (cancellationPolicy.type?.key) {
        currentTypeKey = cancellationPolicy.type.key;
      } else {
        console.log(`⏭️  [${listingId}] Unknown cancellationPolicy format - skipping`);
        skippedCount++;
        continue;
      }

      // Check if days already exists
      if (cancellationPolicy.type?.days !== undefined) {
        console.log(`⏭️  [${listingId}] Already has days (${cancellationPolicy.type.days}) - skipping`);
        skippedCount++;
        continue;
      }

      // Check if we need to convert deprecated enum value
      let targetTypeKey = currentTypeKey;
      let isDeprecated = false;
      if (DEPRECATED_ENUM_MAPPING[currentTypeKey]) {
        targetTypeKey = DEPRECATED_ENUM_MAPPING[currentTypeKey];
        isDeprecated = true;
        console.log(`🔄 [${listingId}] Converting deprecated ${currentTypeKey} → ${targetTypeKey}`);
      }

      // Fetch the enum with metadata
      const enumRecord = await fetchEnumWithMetadata('CANCELLATION_POLICY', targetTypeKey);

      if (!enumRecord) {
        console.error(`❌ [${listingId}] Could not find enum for ${targetTypeKey}`);
        errorCount++;
        continue;
      }

      const days = enumRecord.metadata?.days ?? 0;

      try {
        // Build the updated cancellation policy
        const updatedCancellationPolicy: any = {
          type: {
            key: enumRecord.enumValue,
            en: enumRecord.translations.en,
            sr: enumRecord.translations.sr,
            days: days,
          },
        };

        // Update the listing
        await docClient.send(
          new UpdateCommand({
            TableName: TABLE_NAME,
            Key: {
              pk: item.pk,
              sk: item.sk,
            },
            UpdateExpression: 'SET #cancellationPolicy = :cancellationPolicy, #updatedAt = :now',
            ExpressionAttributeNames: {
              '#cancellationPolicy': 'cancellationPolicy',
              '#updatedAt': 'updatedAt',
            },
            ExpressionAttributeValues: {
              ':cancellationPolicy': updatedCancellationPolicy,
              ':now': new Date().toISOString(),
            },
          })
        );

        updatedCount++;
        if (isDeprecated) {
          deprecatedConversions++;
        }
        console.log(`✅ [${listingId}] Updated: ${currentTypeKey} → ${targetTypeKey} (days: ${days})`);
      } catch (error) {
        console.error(`❌ [${listingId}] Failed to update:`, error);
        errorCount++;
      }
    }

    lastEvaluatedKey = scanResult.LastEvaluatedKey;
  } while (lastEvaluatedKey);

  console.log('\n========================================');
  console.log('📊 Migration Summary:');
  console.log(`   Total processed: ${processedCount}`);
  console.log(`   Updated: ${updatedCount}`);
  console.log(`   Deprecated conversions: ${deprecatedConversions}`);
  console.log(`   Skipped (already migrated or no policy): ${skippedCount}`);
  console.log(`   Errors: ${errorCount}`);
  console.log('========================================\n');
}

// Run migration
migrateCancellationPolicyDays().catch((error) => {
  console.error('❌ Migration failed:', error);
  process.exit(1);
});


