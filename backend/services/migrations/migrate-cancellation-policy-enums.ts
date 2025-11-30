/**
 * Migration: Convert Cancellation Policy to Bilingual Enum Format
 * 
 * This script updates all existing ListingMetadata records to convert
 * cancellationPolicy.type from a plain string to a full bilingual enum object.
 * 
 * BEFORE: { type: "2_DAYS", customText?: "..." }
 * AFTER:  { type: { key: "2_DAYS", en: "2 days", sr: "2 dana" }, customText?: "..." }
 * 
 * Usage:
 *   ts-node backend/services/migrations/migrate-cancellation-policy-enums.ts
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, UpdateCommand, GetCommand } from '@aws-sdk/lib-dynamodb';

const client = new DynamoDBClient({ region: 'eu-north-1' });
const docClient = DynamoDBDocumentClient.from(client);

const TABLE_NAME = 'localstays-staging'; // Change for production

interface ListingMetadata {
  pk: string;
  sk: string;
  listingId: string;
  cancellationPolicy?: {
    type: any; // Can be string or object
    customText?: string;
  };
}

/**
 * Fetch enum translation from database
 */
async function fetchEnumTranslation(enumType: string, enumValue: string): Promise<any | null> {
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
      return null;
    }

    return {
      key: result.Item.enumValue,
      en: result.Item.translations.en,
      sr: result.Item.translations.sr,
    };
  } catch (error) {
    console.error(`Failed to fetch enum translation for ${enumType}:${enumValue}:`, error);
    return null;
  }
}

async function migrateCancellationPolicyEnums() {
  console.log('🔍 Starting migration: Convert cancellation policy to bilingual enum format...');
  console.log(`📊 Table: ${TABLE_NAME}\n`);

  let totalScanned = 0;
  let totalUpdated = 0;
  let totalSkipped = 0;
  let totalErrors = 0;
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
      // Skip if no cancellationPolicy
      if (!listing.cancellationPolicy) {
        console.log(`⏭️  Skipped ${listing.listingId} - no cancellationPolicy`);
        totalSkipped++;
        continue;
      }

      // Skip if already migrated (type is an object with key, en, sr)
      if (
        typeof listing.cancellationPolicy.type === 'object' &&
        listing.cancellationPolicy.type.key &&
        listing.cancellationPolicy.type.en &&
        listing.cancellationPolicy.type.sr
      ) {
        console.log(`⏭️  Skipped ${listing.listingId} - already migrated`);
        totalSkipped++;
        continue;
      }

      // Get the enum value (either string or object with just key)
      const enumValue = typeof listing.cancellationPolicy.type === 'string'
        ? listing.cancellationPolicy.type
        : listing.cancellationPolicy.type?.key;

      if (!enumValue) {
        console.error(`❌ ${listing.listingId} - invalid cancellationPolicy.type format:`, listing.cancellationPolicy.type);
        totalErrors++;
        continue;
      }

      try {
        // Fetch bilingual enum translation
        const cancellationPolicyEnum = await fetchEnumTranslation('CANCELLATION_POLICY', enumValue);

        if (!cancellationPolicyEnum) {
          console.error(`❌ ${listing.listingId} - enum translation not found for: ${enumValue}`);
          totalErrors++;
          continue;
        }

        // Build updated cancellationPolicy object
        const updatedCancellationPolicy: any = {
          type: cancellationPolicyEnum,
        };

        // Preserve customText if it exists
        if (listing.cancellationPolicy.customText) {
          updatedCancellationPolicy.customText = listing.cancellationPolicy.customText;
        }

        // Update the listing
        await docClient.send(
          new UpdateCommand({
            TableName: TABLE_NAME,
            Key: {
              pk: listing.pk,
              sk: listing.sk,
            },
            UpdateExpression: 'SET cancellationPolicy = :cancellationPolicy, updatedAt = :now',
            ExpressionAttributeValues: {
              ':cancellationPolicy': updatedCancellationPolicy,
              ':now': new Date().toISOString(),
            },
          })
        );

        console.log(`✅ Updated ${listing.listingId} - ${enumValue} -> {key: "${cancellationPolicyEnum.key}", en: "${cancellationPolicyEnum.en}", sr: "${cancellationPolicyEnum.sr}"}`);
        totalUpdated++;
      } catch (error) {
        console.error(`❌ Failed to update ${listing.listingId}:`, error);
        totalErrors++;
      }
    }

    lastEvaluatedKey = scanResult.LastEvaluatedKey;
  } while (lastEvaluatedKey);

  console.log('\n📊 Migration Summary:');
  console.log(`   Total Scanned:  ${totalScanned}`);
  console.log(`   Total Updated:  ${totalUpdated}`);
  console.log(`   Total Skipped:  ${totalSkipped}`);
  console.log(`   Total Errors:   ${totalErrors}`);
  console.log('\n✅ Migration complete!');
}

// Run migration
migrateCancellationPolicyEnums().catch((error) => {
  console.error('❌ Migration failed:', error);
  process.exit(1);
});

