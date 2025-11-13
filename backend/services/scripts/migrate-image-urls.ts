/**
 * Migration Script: Convert Full S3 URLs to S3 Keys in Image Records
 * 
 * This script updates existing image records in DynamoDB that have full S3 URLs
 * in their webpUrls field to store just the S3 keys instead.
 * 
 * Usage:
 *   AWS_REGION=eu-north-1 TABLE_NAME=localstays-staging npx ts-node migrate-image-urls.ts
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

const TABLE_NAME = process.env.TABLE_NAME || 'localstays-staging';
const AWS_REGION = process.env.AWS_REGION || 'eu-north-1';
const DRY_RUN = process.env.DRY_RUN === 'true';

interface ImageRecord {
  pk: string;
  sk: string;
  webpUrls?: {
    full?: string;
    thumbnail?: string;
  };
  updatedAt?: string;
}

/**
 * Extract S3 key from full S3 URL
 * Example: https://bucket.s3.region.amazonaws.com/path/to/file.webp -> path/to/file.webp
 */
function extractS3Key(url: string): string {
  if (!url) return url;
  
  // If it's already just a key (doesn't start with http), return as-is
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    return url;
  }
  
  // Extract key from URL
  const urlParts = url.split('.amazonaws.com/');
  if (urlParts.length > 1) {
    return urlParts[1];
  }
  
  // Fallback: return original if parsing fails
  console.warn(`⚠️  Could not parse URL: ${url}`);
  return url;
}

/**
 * Check if a URL needs migration (is it a full URL?)
 */
function needsMigration(url: string | undefined): boolean {
  if (!url) return false;
  return url.startsWith('http://') || url.startsWith('https://');
}

async function migrateImageUrls() {
  console.log('🚀 Starting Image URL Migration');
  console.log(`📊 Table: ${TABLE_NAME}`);
  console.log(`🌍 Region: ${AWS_REGION}`);
  console.log(`🔍 Dry Run: ${DRY_RUN ? 'YES (no changes will be made)' : 'NO (changes will be applied)'}`);
  console.log('');

  let migratedCount = 0;
  let skippedCount = 0;
  let errorCount = 0;
  let lastEvaluatedKey: any = undefined;

  do {
    // Scan for all IMAGE# records
    const scanResult = await docClient.send(new ScanCommand({
      TableName: TABLE_NAME,
      FilterExpression: 'begins_with(sk, :sk)',
      ExpressionAttributeValues: {
        ':sk': 'IMAGE#',
      },
      ExclusiveStartKey: lastEvaluatedKey,
    }));

    const images = (scanResult.Items || []) as ImageRecord[];
    console.log(`📦 Found ${images.length} image records in this batch`);

    for (const image of images) {
      const { pk, sk, webpUrls } = image;
      
      // Check if migration is needed
      const fullNeedsMigration = needsMigration(webpUrls?.full);
      const thumbnailNeedsMigration = needsMigration(webpUrls?.thumbnail);
      
      if (!fullNeedsMigration && !thumbnailNeedsMigration) {
        console.log(`✅ ${pk} / ${sk} - Already migrated (S3 keys only)`);
        skippedCount++;
        continue;
      }

      // Extract S3 keys
      const newFullKey = webpUrls?.full ? extractS3Key(webpUrls.full) : undefined;
      const newThumbnailKey = webpUrls?.thumbnail ? extractS3Key(webpUrls.thumbnail) : undefined;

      console.log(`🔄 ${pk} / ${sk}`);
      if (fullNeedsMigration) {
        console.log(`   Full: ${webpUrls?.full}`);
        console.log(`   ->    ${newFullKey}`);
      }
      if (thumbnailNeedsMigration) {
        console.log(`   Thumb: ${webpUrls?.thumbnail}`);
        console.log(`   ->     ${newThumbnailKey}`);
      }

      if (!DRY_RUN) {
        try {
          // Update the record
          await docClient.send(new UpdateCommand({
            TableName: TABLE_NAME,
            Key: { pk, sk },
            UpdateExpression: 'SET webpUrls = :webpUrls, updatedAt = :now',
            ExpressionAttributeValues: {
              ':webpUrls': {
                full: newFullKey || webpUrls?.full,
                thumbnail: newThumbnailKey || webpUrls?.thumbnail,
              },
              ':now': new Date().toISOString(),
            },
          }));
          console.log(`   ✅ Updated successfully`);
          migratedCount++;
        } catch (error) {
          console.error(`   ❌ Error updating: ${error}`);
          errorCount++;
        }
      } else {
        console.log(`   🔍 DRY RUN - No changes made`);
        migratedCount++;
      }
      console.log('');
    }

    lastEvaluatedKey = scanResult.LastEvaluatedKey;
  } while (lastEvaluatedKey);

  console.log('');
  console.log('📊 Migration Summary:');
  console.log(`   ✅ Migrated: ${migratedCount}`);
  console.log(`   ⏭️  Skipped: ${skippedCount}`);
  console.log(`   ❌ Errors: ${errorCount}`);
  console.log('');
  
  if (DRY_RUN) {
    console.log('🔍 This was a DRY RUN - no changes were made');
    console.log('   Run with DRY_RUN=false to apply changes');
  } else {
    console.log('✅ Migration complete!');
  }
}

// Also migrate profile photos
async function migrateProfilePhotos() {
  console.log('');
  console.log('🚀 Starting Profile Photo URL Migration');
  console.log('');

  let migratedCount = 0;
  let skippedCount = 0;
  let errorCount = 0;
  let lastEvaluatedKey: any = undefined;

  do {
    // Scan for all PROFILE_PHOTO# records
    const scanResult = await docClient.send(new ScanCommand({
      TableName: TABLE_NAME,
      FilterExpression: 'begins_with(sk, :sk)',
      ExpressionAttributeValues: {
        ':sk': 'PROFILE_PHOTO#',
      },
      ExclusiveStartKey: lastEvaluatedKey,
    }));

    const photos = (scanResult.Items || []) as ImageRecord[];
    console.log(`📦 Found ${photos.length} profile photo records in this batch`);

    for (const photo of photos) {
      const { pk, sk, webpUrls } = photo;
      
      // Check if migration is needed
      const fullNeedsMigration = needsMigration(webpUrls?.full);
      const thumbnailNeedsMigration = needsMigration(webpUrls?.thumbnail);
      
      if (!fullNeedsMigration && !thumbnailNeedsMigration) {
        console.log(`✅ ${pk} / ${sk} - Already migrated (S3 keys only)`);
        skippedCount++;
        continue;
      }

      // Extract S3 keys
      const newFullKey = webpUrls?.full ? extractS3Key(webpUrls.full) : undefined;
      const newThumbnailKey = webpUrls?.thumbnail ? extractS3Key(webpUrls.thumbnail) : undefined;

      console.log(`🔄 ${pk} / ${sk}`);
      if (fullNeedsMigration) {
        console.log(`   Full: ${webpUrls?.full}`);
        console.log(`   ->    ${newFullKey}`);
      }
      if (thumbnailNeedsMigration) {
        console.log(`   Thumb: ${webpUrls?.thumbnail}`);
        console.log(`   ->     ${newThumbnailKey}`);
      }

      if (!DRY_RUN) {
        try {
          // Update the PROFILE_PHOTO# record
          await docClient.send(new UpdateCommand({
            TableName: TABLE_NAME,
            Key: { pk, sk },
            UpdateExpression: 'SET webpUrls = :webpUrls, updatedAt = :now',
            ExpressionAttributeValues: {
              ':webpUrls': {
                full: newFullKey || webpUrls?.full,
                thumbnail: newThumbnailKey || webpUrls?.thumbnail,
              },
              ':now': new Date().toISOString(),
            },
          }));
          
          // Also update the HOST#xxx / META record if it exists
          const hostId = pk; // pk is already "HOST#xxx"
          try {
            await docClient.send(new UpdateCommand({
              TableName: TABLE_NAME,
              Key: { pk: hostId, sk: 'META' },
              UpdateExpression: 'SET profilePhoto.webpUrls = :webpUrls, profilePhoto.updatedAt = :now, updatedAt = :now',
              ExpressionAttributeValues: {
                ':webpUrls': {
                  full: newFullKey || webpUrls?.full,
                  thumbnail: newThumbnailKey || webpUrls?.thumbnail,
                },
                ':now': new Date().toISOString(),
              },
              ConditionExpression: 'attribute_exists(pk)',
            }));
            console.log(`   ✅ Updated PROFILE_PHOTO# and HOST META successfully`);
          } catch (metaError: any) {
            if (metaError.name === 'ConditionalCheckFailedException') {
              console.log(`   ✅ Updated PROFILE_PHOTO# (META record not found)`);
            } else {
              throw metaError;
            }
          }
          
          migratedCount++;
        } catch (error) {
          console.error(`   ❌ Error updating: ${error}`);
          errorCount++;
        }
      } else {
        console.log(`   🔍 DRY RUN - No changes made`);
        migratedCount++;
      }
      console.log('');
    }

    lastEvaluatedKey = scanResult.LastEvaluatedKey;
  } while (lastEvaluatedKey);

  console.log('');
  console.log('📊 Profile Photo Migration Summary:');
  console.log(`   ✅ Migrated: ${migratedCount}`);
  console.log(`   ⏭️  Skipped: ${skippedCount}`);
  console.log(`   ❌ Errors: ${errorCount}`);
  console.log('');
}

// Run migrations
(async () => {
  try {
    await migrateImageUrls();
    await migrateProfilePhotos();
    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
})();



