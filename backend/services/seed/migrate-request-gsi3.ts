/**
 * Migration Script: Backfill GSI3 for Existing Requests
 *
 * This script updates all existing request records to populate gsi3pk and gsi3sk
 * for the repurposed DocumentStatusIndex (GSI3).
 *
 * New pattern:
 * - gsi3pk: REQUEST#{requestId}
 * - gsi3sk: REQUEST_META#{requestId}
 *
 * Run with:
 * AWS_REGION=eu-north-1 TABLE_NAME=localstays-dev1 npx ts-node backend/services/seed/migrate-request-gsi3.ts
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

const region = process.env.AWS_REGION || 'eu-north-1';
const tableName = process.env.TABLE_NAME || 'localstays-dev1';

const dynamoClient = new DynamoDBClient({ region });
const docClient = DynamoDBDocumentClient.from(dynamoClient);

interface Request {
  pk: string;
  sk: string;
  requestId: string;
  hostId: string;
  gsi3pk?: string;
  gsi3sk?: string;
}

/**
 * Scan for all request records
 */
async function scanRequests(): Promise<Request[]> {
  const requests: Request[] = [];
  let lastEvaluatedKey: Record<string, any> | undefined = undefined;

  do {
    const result: any = await docClient.send(
      new ScanCommand({
        TableName: tableName,
        FilterExpression: '(begins_with(pk, :hostPrefix) OR begins_with(pk, :listingPrefix)) AND begins_with(sk, :skPrefix) AND attribute_exists(requestId)',
        ExpressionAttributeValues: {
          ':hostPrefix': 'HOST#',
          ':listingPrefix': 'LISTING#',
          ':skPrefix': 'REQUEST#',
        },
        ExclusiveStartKey: lastEvaluatedKey,
      })
    );

    if (result.Items) {
      requests.push(...(result.Items as Request[]));
    }
    lastEvaluatedKey = result.LastEvaluatedKey;
  } while (lastEvaluatedKey);

  return requests;
}

/**
 * Update a request's GSI3 attributes
 */
async function updateRequestGSI3(request: Request): Promise<void> {
  const newGsi3pk = `REQUEST#${request.requestId}`;
  const newGsi3sk = `REQUEST_META#${request.requestId}`;

  // Check if already has correct values
  if (request.gsi3pk === newGsi3pk && request.gsi3sk === newGsi3sk) {
    console.log(`✓ Request ${request.requestId} already has correct GSI3 values`);
    return;
  }

  await docClient.send(
    new UpdateCommand({
      TableName: tableName,
      Key: {
        pk: request.pk,
        sk: request.sk,
      },
      UpdateExpression: 'SET gsi3pk = :gsi3pk, gsi3sk = :gsi3sk, updatedAt = :updatedAt',
      ExpressionAttributeValues: {
        ':gsi3pk': newGsi3pk,
        ':gsi3sk': newGsi3sk,
        ':updatedAt': new Date().toISOString(),
      },
    })
  );

  console.log(`✅ Updated request ${request.requestId}: gsi3pk=${newGsi3pk}`);
}

/**
 * Main migration function
 */
async function migrate() {
  console.log('='.repeat(80));
  console.log('GSI3 Migration Script for Request Records');
  console.log('='.repeat(80));
  console.log(`Region: ${region}`);
  console.log(`Table: ${tableName}\n`);

  try {
    console.log('Step 1: Scanning for request records...');
    const requests = await scanRequests();
    console.log(`Found ${requests.length} request(s)\n`);

    if (requests.length === 0) {
      console.log('No requests found to migrate. Exiting.');
      return;
    }

    console.log('Step 2: Updating GSI3 attributes...');
    let updatedCount = 0;
    for (const request of requests) {
      if (request.gsi3pk !== `REQUEST#${request.requestId}` || request.gsi3sk !== `REQUEST_META#${request.requestId}`) {
        await updateRequestGSI3(request);
        updatedCount++;
      } else {
        console.log(`✓ Request ${request.requestId} already has correct GSI3 values. Skipping.`);
      }
    }

    console.log('\n' + '='.repeat(80));
    console.log('Migration Summary');
    console.log('='.repeat(80));
    console.log(`Total requests found: ${requests.length}`);
    console.log(`Updated: ${updatedCount}`);
    console.log(`Skipped (already correct): ${requests.length - updatedCount}\n`);
    console.log('✅ Migration completed successfully!');
    console.log('='.repeat(80));

  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

// Execute the migration
migrate().then(() => console.log('\n✅ Script completed successfully')).catch(() => process.exit(1));


