/**
 * Migration: Add Billing Address Fields to Existing Hosts
 * 
 * This script adds billingAddressSameAsPhysical and billingAddress fields
 * to all existing host records that don't have them.
 * 
 * Default values:
 * - billingAddressSameAsPhysical: true
 * - billingAddress: null
 * 
 * Usage:
 *   npx ts-node backend/services/migrations/add-billing-address-fields.ts <environment>
 * 
 * Example:
 *   npx ts-node backend/services/migrations/add-billing-address-fields.ts staging
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

const client = new DynamoDBClient({ region: 'eu-north-1' });
const docClient = DynamoDBDocumentClient.from(client);

interface MigrationStats {
  totalHosts: number;
  alreadyMigrated: number;
  migrated: number;
  failed: number;
  errors: Array<{ hostId: string; error: string }>;
}

/**
 * Get table name based on environment
 */
function getTableName(env: string): string {
  const tableNames: Record<string, string> = {
    'dev': 'localstays-dev',
    'staging': 'localstays-staging',
    'prod': 'localstays-prod',
  };

  const tableName = tableNames[env];
  if (!tableName) {
    throw new Error(`Unknown environment: ${env}. Valid options: dev, staging, prod`);
  }

  return tableName;
}

/**
 * Scan all host records
 */
async function getAllHosts(tableName: string): Promise<any[]> {
  const hosts: any[] = [];
  let lastEvaluatedKey: Record<string, any> | undefined;

  console.log('📊 Scanning for host records...');

  do {
    const result = await docClient.send(
      new ScanCommand({
        TableName: tableName,
        FilterExpression: 'begins_with(pk, :hostPrefix) AND sk = :sk',
        ExpressionAttributeValues: {
          ':hostPrefix': 'HOST#',
          ':sk': 'META',
        },
        ExclusiveStartKey: lastEvaluatedKey,
      })
    );

    if (result.Items) {
      hosts.push(...result.Items);
    }

    lastEvaluatedKey = result.LastEvaluatedKey;
    
    if (lastEvaluatedKey) {
      console.log(`   Found ${hosts.length} hosts so far...`);
    }
  } while (lastEvaluatedKey);

  console.log(`✅ Found ${hosts.length} total host records\n`);
  return hosts;
}

/**
 * Check if host needs migration
 */
function needsMigration(host: any): boolean {
  return host.billingAddressSameAsPhysical === undefined || host.billingAddressSameAsPhysical === null;
}

/**
 * Migrate a single host record
 */
async function migrateHost(tableName: string, host: any): Promise<void> {
  await docClient.send(
    new UpdateCommand({
      TableName: tableName,
      Key: {
        pk: host.pk,
        sk: host.sk,
      },
      UpdateExpression: 'SET billingAddressSameAsPhysical = :flag, billingAddress = :addr, updatedAt = :now',
      ExpressionAttributeValues: {
        ':flag': true,
        ':addr': null,
        ':now': new Date().toISOString(),
      },
    })
  );
}

/**
 * Main migration function
 */
async function runMigration(env: string): Promise<MigrationStats> {
  const tableName = getTableName(env);
  const stats: MigrationStats = {
    totalHosts: 0,
    alreadyMigrated: 0,
    migrated: 0,
    failed: 0,
    errors: [],
  };

  console.log('🚀 Starting Billing Address Migration');
  console.log(`📍 Environment: ${env}`);
  console.log(`📍 Table: ${tableName}\n`);

  // Get all hosts
  const hosts = await getAllHosts(tableName);
  stats.totalHosts = hosts.length;

  if (hosts.length === 0) {
    console.log('⚠️  No hosts found. Nothing to migrate.\n');
    return stats;
  }

  // Filter hosts that need migration
  const hostsToMigrate = hosts.filter(needsMigration);
  stats.alreadyMigrated = hosts.length - hostsToMigrate.length;

  console.log(`📋 Migration Summary:`);
  console.log(`   Total hosts: ${stats.totalHosts}`);
  console.log(`   Already migrated: ${stats.alreadyMigrated}`);
  console.log(`   Need migration: ${hostsToMigrate.length}\n`);

  if (hostsToMigrate.length === 0) {
    console.log('✅ All hosts already have billing address fields. Nothing to do!\n');
    return stats;
  }

  // Migrate hosts
  console.log('🔄 Starting migration...\n');

  for (let i = 0; i < hostsToMigrate.length; i++) {
    const host = hostsToMigrate[i];
    const hostId = host.hostId || host.pk.replace('HOST#', '');

    try {
      await migrateHost(tableName, host);
      stats.migrated++;
      
      // Log progress every 10 hosts
      if ((i + 1) % 10 === 0 || i === hostsToMigrate.length - 1) {
        console.log(`   Migrated ${i + 1}/${hostsToMigrate.length} hosts...`);
      }
    } catch (error: any) {
      stats.failed++;
      stats.errors.push({
        hostId,
        error: error.message || String(error),
      });
      console.error(`   ❌ Failed to migrate host ${hostId}: ${error.message}`);
    }
  }

  console.log('\n✅ Migration complete!\n');
  return stats;
}

/**
 * Print final statistics
 */
function printStats(stats: MigrationStats): void {
  console.log('📊 Final Statistics:');
  console.log(`   Total hosts: ${stats.totalHosts}`);
  console.log(`   Already migrated: ${stats.alreadyMigrated}`);
  console.log(`   Successfully migrated: ${stats.migrated}`);
  console.log(`   Failed: ${stats.failed}`);

  if (stats.errors.length > 0) {
    console.log('\n❌ Errors:');
    stats.errors.forEach(({ hostId, error }) => {
      console.log(`   - Host ${hostId}: ${error}`);
    });
  }

  console.log('');
}

/**
 * Main entry point
 */
async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error('❌ Error: Environment argument required\n');
    console.log('Usage: npx ts-node backend/services/migrations/add-billing-address-fields.ts <environment>');
    console.log('Example: npx ts-node backend/services/migrations/add-billing-address-fields.ts staging\n');
    process.exit(1);
  }

  const env = args[0];

  try {
    const stats = await runMigration(env);
    printStats(stats);

    if (stats.failed > 0) {
      process.exit(1);
    }
  } catch (error: any) {
    console.error('\n❌ Migration failed:', error.message);
    console.error(error);
    process.exit(1);
  }
}

// Run migration
main();





