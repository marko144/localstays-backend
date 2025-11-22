/**
 * Migration Script: Add entityType field to existing Location records
 * 
 * This script:
 * 1. Scans all location records in the Locations table
 * 2. Adds entityType = "LOCATION" to each record
 * 3. Removes the old isSearchable field
 * 
 * Run with: npx ts-node scripts/migrate-location-entity-type.ts
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

const client = new DynamoDBClient({ region: 'eu-north-1' });
const docClient = DynamoDBDocumentClient.from(client);

const LOCATIONS_TABLE_NAME = 'localstays-locations-staging';

async function migrateLocations() {
  console.log('Starting migration: Add entityType to Location records...\n');

  let processedCount = 0;
  let updatedCount = 0;
  let lastEvaluatedKey: any = undefined;

  do {
    // Scan locations table
    const scanResult = await docClient.send(
      new ScanCommand({
        TableName: LOCATIONS_TABLE_NAME,
        ExclusiveStartKey: lastEvaluatedKey,
      })
    );

    const locations = scanResult.Items || [];
    console.log(`Processing batch of ${locations.length} locations...`);

    for (const location of locations) {
      processedCount++;

      // Check if already has entityType
      if (location.entityType === 'LOCATION') {
        console.log(`  ✓ ${location.name} - already has entityType`);
        continue;
      }

      // Update the record
      try {
        await docClient.send(
          new UpdateCommand({
            TableName: LOCATIONS_TABLE_NAME,
            Key: {
              pk: location.pk,
              sk: location.sk,
            },
            UpdateExpression: 'SET entityType = :entityType REMOVE isSearchable',
            ExpressionAttributeValues: {
              ':entityType': 'LOCATION',
            },
          })
        );

        updatedCount++;
        console.log(`  ✓ ${location.name} - added entityType, removed isSearchable`);
      } catch (error) {
        console.error(`  ✗ ${location.name} - error:`, error);
      }
    }

    lastEvaluatedKey = scanResult.LastEvaluatedKey;
  } while (lastEvaluatedKey);

  console.log('\n=== Migration Complete ===');
  console.log(`Processed: ${processedCount} locations`);
  console.log(`Updated: ${updatedCount} locations`);
}

// Run migration
migrateLocations()
  .then(() => {
    console.log('\n✅ Migration completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Migration failed:', error);
    process.exit(1);
  });


