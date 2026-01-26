/**
 * Migration: Convert BilingualTextField to TranslatableTextField
 * 
 * This migration converts the old bilingual format:
 * {
 *   en: { text: "...", source: "HOST", updatedAt: "..." },
 *   sr: { text: "...", source: "LOKALSTAYS", updatedAt: "...", updatedBy: "..." }
 * }
 * 
 * To the new translatable format:
 * {
 *   versions: {
 *     en: { text: "...", providedBy: "HOST", updatedAt: "..." },
 *     sr: { text: "...", providedBy: "ADMIN", updatedAt: "...", updatedBy: "..." }
 *   },
 *   originalLanguage: "en"  // Inferred from which field has source: "HOST"
 * }
 * 
 * Run:
 * TABLE_NAME=localstays-staging AWS_REGION=eu-north-1 npx ts-node backend/services/migrations/migrate-to-translatable-text-fields.ts
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

const client = new DynamoDBClient({ region: process.env.AWS_REGION || 'eu-north-1' });
const docClient = DynamoDBDocumentClient.from(client);

const TABLE_NAME = process.env.TABLE_NAME;
const DRY_RUN = process.env.DRY_RUN !== 'false'; // Default to dry run

if (!TABLE_NAME) {
  console.error('❌ TABLE_NAME environment variable is required');
  process.exit(1);
}

console.log(`🔄 Migration: Convert BilingualTextField to TranslatableTextField`);
console.log(`   Table: ${TABLE_NAME}`);
console.log(`   Mode: ${DRY_RUN ? 'DRY RUN (no changes will be made)' : 'LIVE'}`);
console.log('');

interface OldBilingualField {
  en?: {
    text: string;
    source: 'HOST' | 'LOKALSTAYS';
    updatedAt: string;
    updatedBy?: string;
  };
  sr?: {
    text: string;
    source: 'HOST' | 'LOKALSTAYS';
    updatedAt: string;
    updatedBy?: string;
  };
}

interface NewTranslatableField {
  versions: {
    [lang: string]: {
      text: string;
      providedBy: 'HOST' | 'ADMIN';
      updatedAt: string;
      updatedBy?: string;
    };
  };
  originalLanguage: string;
}

/**
 * Check if a field is in old format
 */
function isOldFormat(field: any): field is OldBilingualField {
  if (!field) return false;
  // Old format has 'en' and/or 'sr' directly, without 'versions'
  return (field.en !== undefined || field.sr !== undefined) && !field.versions;
}

/**
 * Convert old format to new format
 */
function convertToNewFormat(field: OldBilingualField): NewTranslatableField {
  const versions: NewTranslatableField['versions'] = {};
  let originalLanguage = 'en'; // Default

  if (field.en) {
    versions['en'] = {
      text: field.en.text,
      providedBy: field.en.source === 'HOST' ? 'HOST' : 'ADMIN',
      updatedAt: field.en.updatedAt,
      ...(field.en.updatedBy && { updatedBy: field.en.updatedBy }),
    };
    if (field.en.source === 'HOST') {
      originalLanguage = 'en';
    }
  }

  if (field.sr) {
    versions['sr'] = {
      text: field.sr.text,
      providedBy: field.sr.source === 'HOST' ? 'HOST' : 'ADMIN',
      updatedAt: field.sr.updatedAt,
      ...(field.sr.updatedBy && { updatedBy: field.sr.updatedBy }),
    };
    if (field.sr.source === 'HOST') {
      originalLanguage = 'sr';
    }
  }

  return {
    versions,
    originalLanguage,
  };
}

/**
 * Migrate a single listing
 */
async function migrateListing(listing: any): Promise<boolean> {
  const pk = listing.pk;
  const sk = listing.sk;
  const listingId = listing.listingId;

  let needsUpdate = false;
  const updateExpressionParts: string[] = [];
  const expressionAttributeNames: Record<string, string> = {};
  const expressionAttributeValues: Record<string, any> = {};

  // Check and convert description
  if (isOldFormat(listing.description)) {
    const newDescription = convertToNewFormat(listing.description);
    updateExpressionParts.push('#description = :description');
    expressionAttributeNames['#description'] = 'description';
    expressionAttributeValues[':description'] = newDescription;
    needsUpdate = true;
    console.log(`  📝 Converting description for ${listingId}`);
  }

  // Check and convert checkIn.description
  if (listing.checkIn?.description && isOldFormat(listing.checkIn.description)) {
    const newCheckInDesc = convertToNewFormat(listing.checkIn.description);
    const newCheckIn = {
      ...listing.checkIn,
      description: newCheckInDesc,
    };
    updateExpressionParts.push('#checkIn = :checkIn');
    expressionAttributeNames['#checkIn'] = 'checkIn';
    expressionAttributeValues[':checkIn'] = newCheckIn;
    needsUpdate = true;
    console.log(`  📝 Converting checkIn.description for ${listingId}`);
  }

  // Check and convert parking.description
  if (listing.parking?.description && isOldFormat(listing.parking.description)) {
    const newParkingDesc = convertToNewFormat(listing.parking.description);
    const newParking = {
      ...listing.parking,
      description: newParkingDesc,
    };
    updateExpressionParts.push('#parking = :parking');
    expressionAttributeNames['#parking'] = 'parking';
    expressionAttributeValues[':parking'] = newParking;
    needsUpdate = true;
    console.log(`  📝 Converting parking.description for ${listingId}`);
  }

  if (!needsUpdate) {
    return false;
  }

  if (DRY_RUN) {
    console.log(`  ⏭️  Would update ${listingId} (dry run)`);
    return true;
  }

  // Execute update
  await docClient.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { pk, sk },
      UpdateExpression: `SET ${updateExpressionParts.join(', ')}`,
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: expressionAttributeValues,
    })
  );

  console.log(`  ✅ Updated ${listingId}`);
  return true;
}

/**
 * Main migration function
 */
async function migrate(): Promise<void> {
  console.log('📊 Scanning for LISTING_META records...\n');

  let lastEvaluatedKey: any = undefined;
  let scannedCount = 0;
  let migratedCount = 0;
  let skippedCount = 0;

  do {
    const result = await docClient.send(
      new ScanCommand({
        TableName: TABLE_NAME,
        FilterExpression: 'begins_with(sk, :sk)',
        ExpressionAttributeValues: {
          ':sk': 'LISTING_META#',
        },
        ExclusiveStartKey: lastEvaluatedKey,
      })
    );

    const items = result.Items || [];
    scannedCount += items.length;

    for (const listing of items) {
      try {
        const wasUpdated = await migrateListing(listing);
        if (wasUpdated) {
          migratedCount++;
        } else {
          skippedCount++;
        }
      } catch (error) {
        console.error(`  ❌ Error migrating ${listing.listingId}:`, error);
      }
    }

    lastEvaluatedKey = result.LastEvaluatedKey;

    if (lastEvaluatedKey) {
      console.log(`  ... scanned ${scannedCount} listings so far ...`);
    }
  } while (lastEvaluatedKey);

  console.log('\n' + '='.repeat(60));
  console.log('📊 Migration Summary');
  console.log('='.repeat(60));
  console.log(`   Total scanned: ${scannedCount}`);
  console.log(`   Migrated: ${migratedCount}`);
  console.log(`   Skipped (already new format): ${skippedCount}`);
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


