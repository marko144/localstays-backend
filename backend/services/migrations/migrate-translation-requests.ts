/**
 * Migration: Convert TranslationRequest.fieldsRequested to fieldsToTranslate
 * 
 * This migration converts the old format:
 * {
 *   fieldsRequested: {
 *     description: 'en',  // language that needs translation
 *     checkInDescription: 'sr'
 *   }
 * }
 * 
 * To the new format:
 * {
 *   fieldsToTranslate: {
 *     description: 'sr',  // originalLanguage the host wrote in
 *     checkInDescription: 'en'  // opposite of what was in fieldsRequested
 *   }
 * }
 * 
 * Run:
 * TABLE_NAME=localstays-staging AWS_REGION=eu-north-1 npx ts-node backend/services/migrations/migrate-translation-requests.ts
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, PutCommand } from '@aws-sdk/lib-dynamodb';

const client = new DynamoDBClient({ region: process.env.AWS_REGION || 'eu-north-1' });
const docClient = DynamoDBDocumentClient.from(client);

const TABLE_NAME = process.env.TABLE_NAME;
const DRY_RUN = process.env.DRY_RUN !== 'false'; // Default to dry run

if (!TABLE_NAME) {
  console.error('❌ TABLE_NAME environment variable is required');
  process.exit(1);
}

console.log(`🔄 Migration: Convert TranslationRequest format`);
console.log(`   Table: ${TABLE_NAME}`);
console.log(`   Mode: ${DRY_RUN ? 'DRY RUN (no changes will be made)' : 'LIVE'}`);
console.log('');

/**
 * Invert the language (if was 'en', now 'sr' and vice versa)
 */
function invertLanguage(lang: 'en' | 'sr'): 'en' | 'sr' {
  return lang === 'en' ? 'sr' : 'en';
}

/**
 * Migrate a single translation request
 */
async function migrateTranslationRequest(request: any): Promise<boolean> {
  // Check if already in new format
  if (request.fieldsToTranslate !== undefined) {
    console.log(`  ⏭️  Skipping ${request.listingId} (already new format)`);
    return false;
  }

  // Check if in old format
  if (!request.fieldsRequested) {
    console.log(`  ⏭️  Skipping ${request.listingId} (no fieldsRequested)`);
    return false;
  }

  // Convert fieldsRequested to fieldsToTranslate
  const fieldsToTranslate: any = {};

  if (request.fieldsRequested.description) {
    // Old format: 'en' means we need English translation (host wrote in Serbian)
    fieldsToTranslate.description = invertLanguage(request.fieldsRequested.description);
  }
  if (request.fieldsRequested.checkInDescription) {
    fieldsToTranslate.checkInDescription = invertLanguage(request.fieldsRequested.checkInDescription);
  }
  if (request.fieldsRequested.parkingDescription) {
    fieldsToTranslate.parkingDescription = invertLanguage(request.fieldsRequested.parkingDescription);
  }

  // If no fields were converted, skip
  if (Object.keys(fieldsToTranslate).length === 0) {
    console.log(`  ⏭️  Skipping ${request.listingId} (empty fieldsRequested)`);
    return false;
  }

  // Ensure description is always present (it's required in new format)
  if (!fieldsToTranslate.description) {
    fieldsToTranslate.description = 'sr'; // Default to Serbian as original
  }

  if (DRY_RUN) {
    console.log(`  ⏭️  Would update ${request.listingId} (dry run)`);
    console.log(`      Old: ${JSON.stringify(request.fieldsRequested)}`);
    console.log(`      New: ${JSON.stringify(fieldsToTranslate)}`);
    return true;
  }

  // Create new record with fieldsToTranslate (replacing old one)
  const newRequest = {
    pk: request.pk,
    sk: request.sk,
    listingId: request.listingId,
    hostId: request.hostId,
    listingName: request.listingName,
    fieldsToTranslate,
    status: request.status,
    requestedAt: request.requestedAt,
    ...(request.completedAt && { completedAt: request.completedAt }),
    ...(request.completedBy && { completedBy: request.completedBy }),
    gsi3pk: request.gsi3pk,
    gsi3sk: request.gsi3sk,
  };

  await docClient.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: newRequest,
    })
  );

  console.log(`  ✅ Updated ${request.listingId}`);
  return true;
}

/**
 * Main migration function
 */
async function migrate(): Promise<void> {
  console.log('📊 Querying TRANSLATION_REQUEST#PENDING records...\n');

  let migratedCount = 0;
  let skippedCount = 0;

  // Query pending translation requests
  const pendingResult = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk',
      ExpressionAttributeValues: {
        ':pk': 'TRANSLATION_REQUEST#PENDING',
      },
    })
  );

  const pendingItems = pendingResult.Items || [];
  console.log(`Found ${pendingItems.length} pending translation requests\n`);

  for (const request of pendingItems) {
    try {
      const wasUpdated = await migrateTranslationRequest(request);
      if (wasUpdated) {
        migratedCount++;
      } else {
        skippedCount++;
      }
    } catch (error) {
      console.error(`  ❌ Error migrating ${request.listingId}:`, error);
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('📊 Migration Summary');
  console.log('='.repeat(60));
  console.log(`   Total scanned: ${pendingItems.length}`);
  console.log(`   Migrated: ${migratedCount}`);
  console.log(`   Skipped: ${skippedCount}`);
  console.log(`   Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`);
  
  if (DRY_RUN && migratedCount > 0) {
    console.log('\n⚠️  This was a dry run. To apply changes, run with DRY_RUN=false');
  }
}

// Run migration
migrate()
  .then(() => {
    console.log('\n✨ Migration complete!\n');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Migration failed:', error);
    process.exit(1);
  });

