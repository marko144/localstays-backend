/**
 * Migration Script: Slot Key Migration
 * 
 * Migrates advertising slots from LISTING#<listingId> PK structure to HOST#<hostId> PK structure.
 * This enables slot reusability - when a listing is deleted, the slot can be reused.
 * 
 * What this script does:
 * 1. Scans all existing slots in the AdvertisingSlots table
 * 2. For each slot with old PK structure (LISTING#...):
 *    - Creates a new record with HOST#<hostId> as PK
 *    - Updates gsi2sk to use hostId instead of listingId
 *    - Deletes the old record
 * 3. Skips slots that are already migrated (have HOST# prefix)
 * 
 * Safety:
 * - Uses conditional writes to prevent duplicates
 * - Logs all operations for audit trail
 * - Safe to run multiple times (idempotent)
 * 
 * Usage:
 *   npx ts-node scripts/migrate-slot-keys.ts staging
 *   npx ts-node scripts/migrate-slot-keys.ts prod
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { 
  DynamoDBDocumentClient, 
  ScanCommand, 
  PutCommand, 
  DeleteCommand 
} from '@aws-sdk/lib-dynamodb';

// Validate command line arguments
const stage = process.argv[2];
if (!stage || !['staging', 'prod'].includes(stage)) {
  console.error('❌ Usage: npx ts-node scripts/migrate-slot-keys.ts <staging|prod>');
  process.exit(1);
}

const REGION = 'eu-north-1';
const TABLE_NAME = `localstays-advertising-slots-${stage}`;

const client = new DynamoDBClient({ region: REGION });
const docClient = DynamoDBDocumentClient.from(client, {
  marshallOptions: { removeUndefinedValues: true },
});

interface SlotRecord {
  pk: string;
  sk: string;
  slotId: string;
  listingId: string;
  hostId: string;
  isCommissionBased: boolean;
  gsi2pk?: string;
  gsi2sk?: string;
  expiresAt?: string;
  [key: string]: any;
}

/**
 * Build GSI2 sort key with new format (uses hostId instead of listingId)
 */
function buildNewGsi2SK(expiresAt: string, hostId: string, slotId: string): string {
  return `${expiresAt}#${hostId}#${slotId}`;
}

async function migrate() {
  console.log(`\n🚀 Starting slot key migration for ${TABLE_NAME}...\n`);
  
  // Step 1: Scan all existing slots
  console.log('📊 Scanning existing slots...');
  
  const allSlots: SlotRecord[] = [];
  let lastEvaluatedKey: any = undefined;
  
  do {
    const result = await docClient.send(
      new ScanCommand({
        TableName: TABLE_NAME,
        ExclusiveStartKey: lastEvaluatedKey,
      })
    );
    
    if (result.Items) {
      allSlots.push(...(result.Items as SlotRecord[]));
    }
    
    lastEvaluatedKey = result.LastEvaluatedKey;
  } while (lastEvaluatedKey);
  
  console.log(`Found ${allSlots.length} total slots\n`);
  
  if (allSlots.length === 0) {
    console.log('✅ No slots to migrate. Done!');
    return;
  }
  
  // Step 2: Categorize slots
  const alreadyMigrated: SlotRecord[] = [];
  const toMigrate: SlotRecord[] = [];
  
  for (const slot of allSlots) {
    if (slot.pk.startsWith('HOST#')) {
      alreadyMigrated.push(slot);
    } else if (slot.pk.startsWith('LISTING#')) {
      toMigrate.push(slot);
    } else {
      console.warn(`⚠️ Unknown PK format for slot ${slot.slotId}: ${slot.pk}`);
    }
  }
  
  console.log(`📈 Status:`);
  console.log(`   - Already migrated: ${alreadyMigrated.length}`);
  console.log(`   - Need migration: ${toMigrate.length}\n`);
  
  if (toMigrate.length === 0) {
    console.log('✅ All slots already migrated. Done!');
    return;
  }
  
  // Step 3: Migrate each slot
  let successCount = 0;
  let errorCount = 0;
  
  for (const slot of toMigrate) {
    const oldPK = slot.pk;
    const newPK = `HOST#${slot.hostId}`;
    
    console.log(`\n🔄 Migrating slot ${slot.slotId}:`);
    console.log(`   Old PK: ${oldPK}`);
    console.log(`   New PK: ${newPK}`);
    console.log(`   ListingId: ${slot.listingId}`);
    console.log(`   HostId: ${slot.hostId}`);
    console.log(`   IsCommissionBased: ${slot.isCommissionBased}`);
    
    try {
      // Build new slot record
      const newSlot: SlotRecord = {
        ...slot,
        pk: newPK,
        // sk stays the same: SLOT#<slotId>
      };
      
      // Update gsi2sk if it exists (subscription-based slots have expiry index)
      if (slot.gsi2sk && slot.expiresAt) {
        const newGsi2sk = buildNewGsi2SK(slot.expiresAt, slot.hostId, slot.slotId);
        console.log(`   Old gsi2sk: ${slot.gsi2sk}`);
        console.log(`   New gsi2sk: ${newGsi2sk}`);
        newSlot.gsi2sk = newGsi2sk;
      }
      
      // Step 3a: Create new record with new PK
      await docClient.send(
        new PutCommand({
          TableName: TABLE_NAME,
          Item: newSlot,
          // Prevent accidental overwrites
          ConditionExpression: 'attribute_not_exists(pk)',
        })
      );
      
      console.log(`   ✅ Created new record with HOST# PK`);
      
      // Step 3b: Delete old record
      await docClient.send(
        new DeleteCommand({
          TableName: TABLE_NAME,
          Key: {
            pk: oldPK,
            sk: slot.sk,
          },
        })
      );
      
      console.log(`   ✅ Deleted old record with LISTING# PK`);
      
      successCount++;
    } catch (error: any) {
      console.error(`   ❌ Error migrating slot ${slot.slotId}:`, error.message);
      
      // If the new record already exists, just delete the old one
      if (error.name === 'ConditionalCheckFailedException') {
        console.log(`   ℹ️ New record already exists, deleting old record only...`);
        
        try {
          await docClient.send(
            new DeleteCommand({
              TableName: TABLE_NAME,
              Key: {
                pk: oldPK,
                sk: slot.sk,
              },
            })
          );
          console.log(`   ✅ Deleted old record`);
          successCount++;
        } catch (deleteError: any) {
          console.error(`   ❌ Failed to delete old record:`, deleteError.message);
          errorCount++;
        }
      } else {
        errorCount++;
      }
    }
  }
  
  // Summary
  console.log(`\n${'='.repeat(60)}`);
  console.log(`📊 Migration Summary for ${TABLE_NAME}:`);
  console.log(`   - Total slots: ${allSlots.length}`);
  console.log(`   - Already migrated: ${alreadyMigrated.length}`);
  console.log(`   - Successfully migrated: ${successCount}`);
  console.log(`   - Errors: ${errorCount}`);
  console.log(`${'='.repeat(60)}\n`);
  
  if (errorCount > 0) {
    console.error('⚠️ Some slots failed to migrate. Please review the errors above.');
    process.exit(1);
  }
  
  console.log('🎉 Migration complete!\n');
}

// Run migration
migrate().catch((error) => {
  console.error('❌ Migration failed:', error);
  process.exit(1);
});



