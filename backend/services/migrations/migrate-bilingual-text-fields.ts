/**
 * Migration Script: Convert description fields to bilingual format
 * 
 * This script migrates existing listings from the old string-based description
 * format to the new BilingualTextField format.
 * 
 * For existing data (which is test data), we copy the same text to both
 * English and Serbian versions with source='HOST'.
 * 
 * Fields migrated:
 * - description: string -> BilingualTextField
 * - checkIn.description: string -> BilingualTextField (if exists)
 * - parking.description: string -> BilingualTextField (if exists)
 * 
 * Usage:
 *   npx ts-node backend/services/migrations/migrate-bilingual-text-fields.ts
 * 
 * Environment:
 *   TABLE_NAME - DynamoDB table name (default: localstays-staging)
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

const TABLE_NAME = process.env.TABLE_NAME || 'localstays-staging';

const dynamoClient = new DynamoDBClient({ region: 'eu-north-1' });
const docClient = DynamoDBDocumentClient.from(dynamoClient);

interface BilingualTextField {
  en: {
    text: string;
    source: 'HOST' | 'LOKALSTAYS';
    updatedAt: string;
  };
  sr: {
    text: string;
    source: 'HOST' | 'LOKALSTAYS';
    updatedAt: string;
  };
}

async function migrateListings() {
  console.log(`Starting bilingual text field migration on table: ${TABLE_NAME}`);
  console.log('='.repeat(60));

  let lastEvaluatedKey: any = undefined;
  let scannedCount = 0;
  let migratedCount = 0;
  let skippedCount = 0;
  let errorCount = 0;

  do {
    const scanResult = await docClient.send(
      new ScanCommand({
        TableName: TABLE_NAME,
        FilterExpression: 'begins_with(sk, :sk)',
        ExpressionAttributeValues: {
          ':sk': 'LISTING_META#',
        },
        ExclusiveStartKey: lastEvaluatedKey,
      })
    );

    const listings = scanResult.Items || [];
    console.log(`\nScanned ${listings.length} listings in this batch`);

    for (const listing of listings) {
      scannedCount++;
      const listingId = listing.listingId;
      const hostId = listing.hostId;

      try {
        // Check if description is already in new format
        if (
          listing.description &&
          typeof listing.description === 'object' &&
          listing.description.en &&
          listing.description.sr
        ) {
          console.log(`  ⏭️  Listing ${listingId}: Already migrated, skipping`);
          skippedCount++;
          continue;
        }

        const now = new Date().toISOString();
        const updateExpressionParts: string[] = [];
        const expressionAttributeNames: Record<string, string> = {};
        const expressionAttributeValues: Record<string, any> = {};

        // Migrate description field
        if (listing.description && typeof listing.description === 'string') {
          const oldDescription = listing.description;
          const newDescription: BilingualTextField = {
            en: {
              text: oldDescription,
              source: 'HOST',
              updatedAt: listing.updatedAt || listing.createdAt || now,
            },
            sr: {
              text: oldDescription, // Copy same text for test data
              source: 'HOST',
              updatedAt: listing.updatedAt || listing.createdAt || now,
            },
          };

          updateExpressionParts.push('#description = :description');
          expressionAttributeNames['#description'] = 'description';
          expressionAttributeValues[':description'] = newDescription;
        }

        // Migrate checkIn.description field
        if (
          listing.checkIn &&
          listing.checkIn.description &&
          typeof listing.checkIn.description === 'string'
        ) {
          const oldCheckInDesc = listing.checkIn.description;
          const newCheckIn = {
            ...listing.checkIn,
            description: {
              en: {
                text: oldCheckInDesc,
                source: 'HOST',
                updatedAt: listing.updatedAt || listing.createdAt || now,
              },
              sr: {
                text: oldCheckInDesc, // Copy same text for test data
                source: 'HOST',
                updatedAt: listing.updatedAt || listing.createdAt || now,
              },
            },
          };

          updateExpressionParts.push('#checkIn = :checkIn');
          expressionAttributeNames['#checkIn'] = 'checkIn';
          expressionAttributeValues[':checkIn'] = newCheckIn;
        }

        // Migrate parking.description field
        if (
          listing.parking &&
          listing.parking.description &&
          typeof listing.parking.description === 'string'
        ) {
          const oldParkingDesc = listing.parking.description;
          const newParking = {
            ...listing.parking,
            description: {
              en: {
                text: oldParkingDesc,
                source: 'HOST',
                updatedAt: listing.updatedAt || listing.createdAt || now,
              },
              sr: {
                text: oldParkingDesc, // Copy same text for test data
                source: 'HOST',
                updatedAt: listing.updatedAt || listing.createdAt || now,
              },
            },
          };

          updateExpressionParts.push('#parking = :parking');
          expressionAttributeNames['#parking'] = 'parking';
          expressionAttributeValues[':parking'] = newParking;
        }

        // Always update the updatedAt field
        updateExpressionParts.push('#updatedAt = :updatedAt');
        expressionAttributeNames['#updatedAt'] = 'updatedAt';
        expressionAttributeValues[':updatedAt'] = now;

        // Execute update if there are changes
        if (updateExpressionParts.length > 1) {
          // More than just updatedAt
          await docClient.send(
            new UpdateCommand({
              TableName: TABLE_NAME,
              Key: {
                pk: `HOST#${hostId}`,
                sk: `LISTING_META#${listingId}`,
              },
              UpdateExpression: `SET ${updateExpressionParts.join(', ')}`,
              ExpressionAttributeNames: expressionAttributeNames,
              ExpressionAttributeValues: expressionAttributeValues,
            })
          );

          console.log(`  ✅ Listing ${listingId}: Migrated successfully`);
          migratedCount++;
        } else {
          console.log(`  ⏭️  Listing ${listingId}: No text fields to migrate`);
          skippedCount++;
        }
      } catch (error: any) {
        console.error(`  ❌ Listing ${listingId}: Error - ${error.message}`);
        errorCount++;
      }
    }

    lastEvaluatedKey = scanResult.LastEvaluatedKey;
  } while (lastEvaluatedKey);

  console.log('\n' + '='.repeat(60));
  console.log('Migration Complete!');
  console.log(`  Total scanned: ${scannedCount}`);
  console.log(`  Migrated: ${migratedCount}`);
  console.log(`  Skipped (already migrated or no text): ${skippedCount}`);
  console.log(`  Errors: ${errorCount}`);
}

// Run migration
migrateListings()
  .then(() => {
    console.log('\n✅ Migration script finished');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Migration script failed:', error);
    process.exit(1);
  });




