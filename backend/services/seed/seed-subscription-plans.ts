/**
 * CDK CustomResource Handler for Subscription Plans Seeding
 * Seeds subscription plans to the SubscriptionPlans table on stack deployment
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, BatchWriteCommand } from '@aws-sdk/lib-dynamodb';
import { 
  DEFAULT_SUBSCRIPTION_PLANS, 
  buildSubscriptionPlanPK, 
  buildSubscriptionPlanSK 
} from '../types/subscription-plan.types';

const client = new DynamoDBClient({ region: process.env.AWS_REGION });
const docClient = DynamoDBDocumentClient.from(client);

const SUBSCRIPTION_PLANS_TABLE_NAME = process.env.SUBSCRIPTION_PLANS_TABLE_NAME!;

interface CustomResourceEvent {
  RequestType: 'Create' | 'Update' | 'Delete';
  ResourceProperties: {
    SubscriptionPlansTableName: string;
    Version?: string;
  };
}

/**
 * Lambda handler for CDK CustomResource
 */
export async function handler(event: CustomResourceEvent) {
  console.log('Subscription Plans Seed handler invoked:', JSON.stringify(event, null, 2));

  try {
    // Seed on both Create and Update (allows re-seeding when needed)
    if (event.RequestType === 'Create' || event.RequestType === 'Update') {
      console.log(`${event.RequestType} detected - seeding subscription plans...`);
      
      await seedSubscriptionPlans();
      
      console.log('✅ Subscription plans seeding completed successfully');
      
      return {
        PhysicalResourceId: 'localstays-subscription-plans-seed',
        Data: {
          Message: 'Subscription plans seeded successfully',
        },
      };
    } else {
      console.log('Delete detected - no cleanup needed');
      return {
        PhysicalResourceId: 'localstays-subscription-plans-seed',
        Data: {
          Message: 'Seed cleanup skipped',
        },
      };
    }
  } catch (error) {
    console.error('Subscription Plans Seed handler error:', error);
    throw error;
  }
}

/**
 * Seed subscription plans to the SubscriptionPlans table
 */
async function seedSubscriptionPlans() {
  console.log('Seeding subscription plans to SubscriptionPlans table...');

  const now = new Date().toISOString();

  // Build full plan records from the default plans
  const planRecords = DEFAULT_SUBSCRIPTION_PLANS.map((plan) => ({
    pk: buildSubscriptionPlanPK(plan.planId),
    sk: buildSubscriptionPlanSK(),
    ...plan,
    createdAt: now,
    updatedAt: now,
  }));

  // DynamoDB BatchWrite can only handle 25 items at a time
  const chunkSize = 25;
  for (let i = 0; i < planRecords.length; i += chunkSize) {
    const chunk = planRecords.slice(i, i + chunkSize);
    
    await docClient.send(
      new BatchWriteCommand({
        RequestItems: {
          [SUBSCRIPTION_PLANS_TABLE_NAME]: chunk.map((plan) => ({
            PutRequest: { Item: plan },
          })),
        },
      })
    );
    
    console.log(`  Seeded ${chunk.length} subscription plans (${i + chunk.length}/${planRecords.length})`);
  }

  console.log(`✅ Subscription plans seeded: ${planRecords.length} plans`);
  
  // Log the plans for debugging
  planRecords.forEach((plan) => {
    console.log(`  - ${plan.planId}: ${plan.displayName} (${plan.adSlots} slots, ${plan.prices.length} price options)`);
  });
}

