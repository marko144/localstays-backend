/**
 * Migration Script: Remove Legacy FREE Subscriptions
 * 
 * This script removes all old-style FREE subscription records that were
 * auto-created when hosts signed up. After this migration, hosts will
 * show as having "No Subscription" and must purchase via Stripe to publish.
 * 
 * Usage:
 *   DRY RUN (default): npx ts-node scripts/migrate-remove-free-subscriptions.ts
 *   EXECUTE:           npx ts-node scripts/migrate-remove-free-subscriptions.ts --execute
 * 
 * Environment:
 *   TABLE_NAME: The main DynamoDB table name (e.g., localstays-staging)
 *   AWS_REGION: AWS region (defaults to eu-north-1)
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { 
  DynamoDBDocumentClient, 
  ScanCommand, 
  DeleteCommand,
  BatchWriteCommand,
} from '@aws-sdk/lib-dynamodb';

// Configuration
const TABLE_NAME = process.env.TABLE_NAME || 'localstays-staging';
const AWS_REGION = process.env.AWS_REGION || 'eu-north-1';
const DRY_RUN = !process.argv.includes('--execute');

// Initialize DynamoDB client
const client = new DynamoDBClient({ region: AWS_REGION });
const docClient = DynamoDBDocumentClient.from(client, {
  marshallOptions: { removeUndefinedValues: true },
});

interface LegacySubscription {
  pk: string;
  sk: string;
  hostId: string;
  planName?: string;
  maxListings?: number;
  status?: string;
  // New fields that would indicate a Stripe subscription
  planId?: string;
  stripeCustomerId?: string;
}

/**
 * Find all subscription records
 */
async function findAllSubscriptions(): Promise<LegacySubscription[]> {
  const subscriptions: LegacySubscription[] = [];
  let lastEvaluatedKey: Record<string, any> | undefined;

  console.log(`\n📡 Scanning table: ${TABLE_NAME}`);
  console.log(`   Looking for records with sk = 'SUBSCRIPTION'...\n`);

  do {
    const result = await docClient.send(
      new ScanCommand({
        TableName: TABLE_NAME,
        FilterExpression: 'sk = :sk',
        ExpressionAttributeValues: {
          ':sk': 'SUBSCRIPTION',
        },
        ExclusiveStartKey: lastEvaluatedKey,
      })
    );

    if (result.Items) {
      subscriptions.push(...(result.Items as LegacySubscription[]));
    }

    lastEvaluatedKey = result.LastEvaluatedKey;
    
    if (lastEvaluatedKey) {
      console.log(`   Scanned ${subscriptions.length} records so far...`);
    }
  } while (lastEvaluatedKey);

  return subscriptions;
}

/**
 * Identify legacy FREE subscriptions (old format without Stripe integration)
 */
function identifyLegacySubscriptions(subscriptions: LegacySubscription[]): LegacySubscription[] {
  return subscriptions.filter(sub => {
    // Legacy subscriptions have planName='FREE' but no planId or stripeCustomerId
    const isLegacy = sub.planName === 'FREE' && !sub.planId && !sub.stripeCustomerId;
    return isLegacy;
  });
}

/**
 * Identify Stripe subscriptions (new format)
 */
function identifyStripeSubscriptions(subscriptions: LegacySubscription[]): LegacySubscription[] {
  return subscriptions.filter(sub => {
    // Stripe subscriptions have planId or stripeCustomerId
    return sub.planId || sub.stripeCustomerId;
  });
}

/**
 * Delete legacy subscriptions in batches
 */
async function deleteLegacySubscriptions(subscriptions: LegacySubscription[]): Promise<number> {
  if (subscriptions.length === 0) {
    return 0;
  }

  let deletedCount = 0;
  const batchSize = 25; // DynamoDB batch write limit

  for (let i = 0; i < subscriptions.length; i += batchSize) {
    const batch = subscriptions.slice(i, i + batchSize);
    
    const deleteRequests = batch.map(sub => ({
      DeleteRequest: {
        Key: {
          pk: sub.pk,
          sk: sub.sk,
        },
      },
    }));

    try {
      await docClient.send(
        new BatchWriteCommand({
          RequestItems: {
            [TABLE_NAME]: deleteRequests,
          },
        })
      );

      deletedCount += batch.length;
      console.log(`   ✅ Deleted batch ${Math.floor(i / batchSize) + 1}: ${batch.length} records`);
    } catch (error: any) {
      console.error(`   ❌ Error deleting batch: ${error.message}`);
      
      // Fall back to individual deletes
      for (const sub of batch) {
        try {
          await docClient.send(
            new DeleteCommand({
              TableName: TABLE_NAME,
              Key: {
                pk: sub.pk,
                sk: sub.sk,
              },
            })
          );
          deletedCount++;
        } catch (individualError: any) {
          console.error(`   ❌ Failed to delete ${sub.pk}: ${individualError.message}`);
        }
      }
    }
  }

  return deletedCount;
}

/**
 * Main migration function
 */
async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  MIGRATION: Remove Legacy FREE Subscriptions');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`\n📋 Configuration:`);
  console.log(`   Table:     ${TABLE_NAME}`);
  console.log(`   Region:    ${AWS_REGION}`);
  console.log(`   Mode:      ${DRY_RUN ? '🔍 DRY RUN (no changes)' : '⚡ EXECUTE (will delete records)'}`);

  if (DRY_RUN) {
    console.log(`\n   ℹ️  To execute the migration, run with --execute flag`);
  }

  try {
    // Step 1: Find all subscriptions
    const allSubscriptions = await findAllSubscriptions();
    console.log(`\n📊 Found ${allSubscriptions.length} total subscription records`);

    // Step 2: Categorize subscriptions
    const legacySubscriptions = identifyLegacySubscriptions(allSubscriptions);
    const stripeSubscriptions = identifyStripeSubscriptions(allSubscriptions);
    const unknownSubscriptions = allSubscriptions.filter(
      sub => !legacySubscriptions.includes(sub) && !stripeSubscriptions.includes(sub)
    );

    console.log(`\n📈 Subscription Breakdown:`);
    console.log(`   Legacy FREE (to delete):  ${legacySubscriptions.length}`);
    console.log(`   Stripe (to keep):         ${stripeSubscriptions.length}`);
    console.log(`   Unknown (to review):      ${unknownSubscriptions.length}`);

    // Step 3: Show sample of legacy subscriptions
    if (legacySubscriptions.length > 0) {
      console.log(`\n📝 Sample Legacy Subscriptions (first 5):`);
      legacySubscriptions.slice(0, 5).forEach((sub, i) => {
        console.log(`   ${i + 1}. ${sub.pk}`);
        console.log(`      planName: ${sub.planName}, maxListings: ${sub.maxListings}, status: ${sub.status}`);
      });
    }

    // Step 4: Show unknown subscriptions (if any)
    if (unknownSubscriptions.length > 0) {
      console.log(`\n⚠️  Unknown Subscriptions (review manually):`);
      unknownSubscriptions.forEach((sub, i) => {
        console.log(`   ${i + 1}. ${sub.pk}`);
        console.log(`      Data: ${JSON.stringify(sub, null, 2)}`);
      });
    }

    // Step 5: Execute deletion (if not dry run)
    if (!DRY_RUN && legacySubscriptions.length > 0) {
      console.log(`\n🗑️  Deleting ${legacySubscriptions.length} legacy subscriptions...`);
      const deletedCount = await deleteLegacySubscriptions(legacySubscriptions);
      console.log(`\n✅ Migration Complete!`);
      console.log(`   Deleted: ${deletedCount} legacy FREE subscription records`);
      console.log(`   Kept:    ${stripeSubscriptions.length} Stripe subscription records`);
    } else if (DRY_RUN) {
      console.log(`\n🔍 DRY RUN Complete!`);
      console.log(`   Would delete: ${legacySubscriptions.length} legacy FREE subscription records`);
      console.log(`   Would keep:   ${stripeSubscriptions.length} Stripe subscription records`);
      console.log(`\n   Run with --execute to perform the migration.`);
    } else {
      console.log(`\n✅ No legacy subscriptions to delete!`);
    }

  } catch (error: any) {
    console.error(`\n❌ Migration failed: ${error.message}`);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run the migration
main();

