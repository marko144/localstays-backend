/**
 * Fix isSearchable field in Locations table
 * Convert from boolean to string for GSI compatibility
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

const client = new DynamoDBClient({ region: 'eu-north-1' });
const docClient = DynamoDBDocumentClient.from(client, {
  marshallOptions: { removeUndefinedValues: true },
});

const LOCATIONS_TABLE_NAME = 'localstays-locations-staging';

async function main() {
  console.log('🔧 Fixing isSearchable field in Locations table...\n');

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
    const currentValue = location.isSearchable;
    const newValue = currentValue === true ? 'true' : 'false';

    console.log(`Updating ${location.name}: isSearchable ${currentValue} -> "${newValue}"`);

    await docClient.send(
      new UpdateCommand({
        TableName: LOCATIONS_TABLE_NAME,
        Key: {
          pk: location.pk,
          sk: location.sk,
        },
        UpdateExpression: 'SET isSearchable = :newValue',
        ExpressionAttributeValues: {
          ':newValue': newValue,
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



