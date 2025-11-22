/**
 * Fix searchName field in Locations table
 * Remove diacritics for easier searching
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { generateSearchName } from '../backend/services/types/location.types';

const client = new DynamoDBClient({ region: 'eu-north-1' });
const docClient = DynamoDBDocumentClient.from(client, {
  marshallOptions: { removeUndefinedValues: true },
});

const LOCATIONS_TABLE_NAME = 'localstays-locations-staging';

async function main() {
  console.log('🔧 Fixing searchName field in Locations table...\n');

  // Scan all location records
  const scanResult = await docClient.send(
    new ScanCommand({
      TableName: LOCATIONS_TABLE_NAME,
      FilterExpression: 'sk = :sk',
      ExpressionAttributeValues: {
        ':sk': 'META',
      },
    })
  );

  const locations = scanResult.Items || [];
  console.log(`Found ${locations.length} location records\n`);

  // Update each location
  for (const location of locations) {
    const oldSearchName = location.searchName;
    const newSearchName = generateSearchName(location.name, location.regionName);

    if (oldSearchName === newSearchName) {
      console.log(`✓ ${location.name}: searchName already correct ("${newSearchName}")`);
      continue;
    }

    console.log(`Updating ${location.name}:`);
    console.log(`  Old: "${oldSearchName}"`);
    console.log(`  New: "${newSearchName}"`);

    await docClient.send(
      new UpdateCommand({
        TableName: LOCATIONS_TABLE_NAME,
        Key: {
          pk: location.pk,
          sk: location.sk,
        },
        UpdateExpression: 'SET searchName = :newValue',
        ExpressionAttributeValues: {
          ':newValue': newSearchName,
        },
      })
    );
  }

  console.log(`\n✅ Updated ${locations.length} location records`);
}

main().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});



