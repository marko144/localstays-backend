/**
 * Migration Script: Set default onlinePaymentStatus for existing hosts
 * 
 * This script sets onlinePaymentStatus to 'NOT_REQUESTED' for all hosts
 * that don't have this field set yet.
 * 
 * Usage:
 *   npx ts-node scripts/migrate-host-online-payment-defaults.ts staging
 *   npx ts-node scripts/migrate-host-online-payment-defaults.ts prod
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

const stage = process.argv[2];

if (!stage || !['staging', 'prod', 'production'].includes(stage)) {
  console.error('Usage: npx ts-node scripts/migrate-host-online-payment-defaults.ts <staging|prod>');
  process.exit(1);
}

const TABLE_NAME = `localstays-${stage === 'production' ? 'prod' : stage}`;

const client = new DynamoDBClient({ region: 'eu-north-1' });
const docClient = DynamoDBDocumentClient.from(client);

async function migrateHostOnlinePaymentDefaults() {
  console.log('========================================');
  console.log('Set Host Online Payment Defaults Migration');
  console.log('========================================');
  console.log(`Environment: ${stage}`);
  console.log(`Table: ${TABLE_NAME}`);
  console.log('========================================\n');

  try {
    // 1. Scan for all host META records that don't have onlinePaymentStatus set
    console.log('Step 1: Scanning for host records without onlinePaymentStatus...');
    
    const hosts: any[] = [];
    let lastEvaluatedKey: any = undefined;
    let totalScanned = 0;
    
    do {
      const scanResult = await docClient.send(
        new ScanCommand({
          TableName: TABLE_NAME,
          ExclusiveStartKey: lastEvaluatedKey,
        })
      );
      
      totalScanned += scanResult.ScannedCount || 0;
      
      // Filter in code - find HOST META items without onlinePaymentStatus or with null value
      for (const item of scanResult.Items || []) {
        if (item.pk && 
            typeof item.pk === 'string' && 
            item.pk.startsWith('HOST#') && 
            item.sk === 'META' &&
            (!item.onlinePaymentStatus || item.onlinePaymentStatus === null)) {
          hosts.push(item);
        }
      }
      
      lastEvaluatedKey = scanResult.LastEvaluatedKey;
    } while (lastEvaluatedKey);
    
    console.log(`Scanned ${totalScanned} total items`);
    console.log(`Found ${hosts.length} hosts without onlinePaymentStatus\n`);

    if (hosts.length === 0) {
      console.log('✅ No hosts need migration. All hosts already have onlinePaymentStatus set.');
      return;
    }

    // 2. Update each host - set onlinePaymentStatus to NOT_REQUESTED
    console.log('Step 2: Setting onlinePaymentStatus to NOT_REQUESTED...\n');
    
    let successCount = 0;
    let errorCount = 0;

    for (const host of hosts) {
      try {
        await docClient.send(
          new UpdateCommand({
            TableName: TABLE_NAME,
            Key: {
              pk: host.pk,
              sk: host.sk,
            },
            UpdateExpression: 'SET onlinePaymentStatus = :status, onlinePaymentRequestedAt = :null, onlinePaymentDecidedAt = :null, onlinePaymentDecidedBy = :null, onlinePaymentRejectReason = :null, updatedAt = :updatedAt',
            ExpressionAttributeValues: {
              ':status': 'NOT_REQUESTED',
              ':null': null,
              ':updatedAt': new Date().toISOString(),
            },
          })
        );

        successCount++;
        console.log(`✅ Updated host: ${host.hostId}`);
      } catch (error: any) {
        errorCount++;
        console.error(`❌ Failed to update host: ${host.hostId}`, error.message);
      }
    }

    // 3. Summary
    console.log('\n========================================');
    console.log('Migration Summary');
    console.log('========================================');
    console.log(`Total hosts found: ${hosts.length}`);
    console.log(`Successfully updated: ${successCount}`);
    console.log(`Failed: ${errorCount}`);
    console.log('========================================\n');

    if (errorCount === 0) {
      console.log('✅ Migration completed successfully!');
    } else {
      console.log('⚠️  Migration completed with errors. Please review the failed hosts.');
      process.exit(1);
    }
  } catch (error: any) {
    console.error('\n❌ Migration failed:', error);
    process.exit(1);
  }
}

// Run migration
migrateHostOnlinePaymentDefaults();

