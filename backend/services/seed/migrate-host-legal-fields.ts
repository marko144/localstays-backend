/**
 * Migration Script: Add legal acceptance fields to existing hosts
 * 
 * This script adds the new legal acceptance fields to all existing HOST records:
 * - acceptedTosVersion: null
 * - acceptedTosAt: null
 * - acceptedPrivacyVersion: null
 * - acceptedPrivacyAt: null
 * 
 * Run with: npx ts-node backend/services/seed/migrate-host-legal-fields.ts
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

// Configuration
const TABLE_NAME = process.env.TABLE_NAME || 'localstays-staging';
const BATCH_SIZE = 25; // Process in batches to avoid throttling

const dynamoClient = new DynamoDBClient({ region: 'eu-north-1' });
const docClient = DynamoDBDocumentClient.from(dynamoClient);

interface HostRecord {
  pk: string;
  sk: string;
  hostId: string;
  acceptedTosVersion?: string | null;
  acceptedPrivacyVersion?: string | null;
}

async function getAllHosts(): Promise<HostRecord[]> {
  const hosts: HostRecord[] = [];
  let lastEvaluatedKey: Record<string, any> | undefined;

  do {
    const result = await docClient.send(
      new ScanCommand({
        TableName: TABLE_NAME,
        FilterExpression: 'begins_with(pk, :hostPrefix) AND sk = :meta',
        ExpressionAttributeValues: {
          ':hostPrefix': 'HOST#',
          ':meta': 'META',
        },
        ExclusiveStartKey: lastEvaluatedKey,
      })
    );

    if (result.Items) {
      hosts.push(...(result.Items as HostRecord[]));
    }

    lastEvaluatedKey = result.LastEvaluatedKey;
  } while (lastEvaluatedKey);

  return hosts;
}

async function updateHost(host: HostRecord): Promise<boolean> {
  // Skip if already has legal fields
  if (host.acceptedTosVersion !== undefined || host.acceptedPrivacyVersion !== undefined) {
    console.log(`⏭️  Skipping ${host.hostId} - already has legal fields`);
    return false;
  }

  try {
    await docClient.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: {
          pk: host.pk,
          sk: host.sk,
        },
        UpdateExpression: 'SET acceptedTosVersion = :null, acceptedTosAt = :null, acceptedPrivacyVersion = :null, acceptedPrivacyAt = :null',
        ExpressionAttributeValues: {
          ':null': null,
        },
        // Only update if the fields don't exist
        ConditionExpression: 'attribute_not_exists(acceptedTosVersion)',
      })
    );
    console.log(`✅ Updated ${host.hostId}`);
    return true;
  } catch (error: any) {
    if (error.name === 'ConditionalCheckFailedException') {
      console.log(`⏭️  Skipping ${host.hostId} - already has legal fields`);
      return false;
    }
    console.error(`❌ Failed to update ${host.hostId}:`, error.message);
    return false;
  }
}

async function migrate(): Promise<void> {
  console.log('🚀 Starting migration: Add legal acceptance fields to hosts');
  console.log(`📊 Table: ${TABLE_NAME}`);
  console.log('');

  // Get all hosts
  console.log('📥 Fetching all hosts...');
  const hosts = await getAllHosts();
  console.log(`📊 Found ${hosts.length} hosts`);
  console.log('');

  // Process in batches
  let updated = 0;
  let skipped = 0;

  for (let i = 0; i < hosts.length; i += BATCH_SIZE) {
    const batch = hosts.slice(i, i + BATCH_SIZE);
    console.log(`📦 Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(hosts.length / BATCH_SIZE)}`);

    const results = await Promise.all(batch.map(updateHost));
    updated += results.filter(Boolean).length;
    skipped += results.filter(r => !r).length;

    // Small delay to avoid throttling
    if (i + BATCH_SIZE < hosts.length) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  console.log('');
  console.log('✅ Migration complete!');
  console.log(`📊 Updated: ${updated}`);
  console.log(`⏭️  Skipped: ${skipped}`);
  console.log(`📊 Total: ${hosts.length}`);
}

// Run migration
migrate().catch(console.error);

