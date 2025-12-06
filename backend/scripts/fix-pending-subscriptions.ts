/**
 * Fix Pending Subscriptions Script
 * 
 * This script fixes subscriptions that were created before the plans table was synced.
 * It looks up the Stripe subscription to get the actual price ID, then updates the
 * subscription record with the correct plan info.
 * 
 * Usage:
 *   DRY_RUN=true npx ts-node scripts/fix-pending-subscriptions.ts
 *   npx ts-node scripts/fix-pending-subscriptions.ts
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, UpdateCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import Stripe from 'stripe';

const REGION = 'eu-north-1';
const ENV = process.env.ENV || 'staging';
const DRY_RUN = process.env.DRY_RUN === 'true';

const TABLE_NAME = `localstays-${ENV}`;
const PLANS_TABLE_NAME = `localstays-subscription-plans-${ENV}`;
const SSM_STRIPE_KEY = `/localstays/${ENV}/stripe/secret-key`;

const dynamoClient = new DynamoDBClient({ region: REGION });
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const ssmClient = new SSMClient({ region: REGION });

interface SubscriptionRecord {
  pk: string;
  sk: string;
  hostId: string;
  planId: string;
  priceId: string;
  status: string;
  totalTokens: number;
  stripeSubscriptionId?: string;
  stripeCustomerId?: string;
}

interface ProductRecord {
  stripeProductId: string;
  name: string;
  displayName_sr?: string;
  adSlots: number;
}

interface PriceRecord {
  stripePriceId: string;
  stripeProductId: string;
  billingPeriod: string;
}

async function getStripeSecretKey(): Promise<string> {
  const result = await ssmClient.send(
    new GetParameterCommand({
      Name: SSM_STRIPE_KEY,
      WithDecryption: true,
    })
  );
  return result.Parameter?.Value || '';
}

async function getPriceRecord(stripePriceId: string): Promise<PriceRecord | null> {
  const result = await docClient.send(
    new GetCommand({
      TableName: PLANS_TABLE_NAME,
      Key: {
        pk: `STRIPE_PRICE#${stripePriceId}`,
        sk: 'PRICE',
      },
    })
  );
  return result.Item as PriceRecord | null;
}

async function getProductRecord(stripeProductId: string): Promise<ProductRecord | null> {
  const result = await docClient.send(
    new GetCommand({
      TableName: PLANS_TABLE_NAME,
      Key: {
        pk: `STRIPE_PRODUCT#${stripeProductId}`,
        sk: 'PRODUCT',
      },
    })
  );
  return result.Item as ProductRecord | null;
}

async function findPendingSubscriptions(): Promise<SubscriptionRecord[]> {
  const result = await docClient.send(
    new ScanCommand({
      TableName: TABLE_NAME,
      FilterExpression: 'sk = :sk AND planId = :pending',
      ExpressionAttributeValues: {
        ':sk': 'SUBSCRIPTION',
        ':pending': 'pending',
      },
    })
  );
  
  return (result.Items || []) as SubscriptionRecord[];
}

async function fixSubscription(
  stripe: Stripe,
  subscription: SubscriptionRecord
): Promise<boolean> {
  console.log(`\n📋 Processing subscription for host: ${subscription.hostId}`);
  console.log(`   Stripe Subscription ID: ${subscription.stripeSubscriptionId}`);
  
  if (!subscription.stripeSubscriptionId) {
    console.log('   ❌ No Stripe subscription ID - cannot fix');
    return false;
  }
  
  try {
    // Get subscription from Stripe
    const stripeSub = await stripe.subscriptions.retrieve(subscription.stripeSubscriptionId);
    console.log(`   Stripe Status: ${stripeSub.status}`);
    
    // Get the price ID from the subscription items
    const priceId = stripeSub.items.data[0]?.price?.id;
    if (!priceId) {
      console.log('   ❌ No price ID found in Stripe subscription');
      return false;
    }
    console.log(`   Stripe Price ID: ${priceId}`);
    
    // Look up price in our table
    const priceRecord = await getPriceRecord(priceId);
    if (!priceRecord) {
      console.log(`   ❌ Price ${priceId} not found in our plans table`);
      return false;
    }
    console.log(`   Product ID: ${priceRecord.stripeProductId}`);
    
    // Look up product to get adSlots
    const productRecord = await getProductRecord(priceRecord.stripeProductId);
    if (!productRecord) {
      console.log(`   ❌ Product ${priceRecord.stripeProductId} not found in our plans table`);
      return false;
    }
    console.log(`   Product Name: ${productRecord.name}`);
    console.log(`   Ad Slots: ${productRecord.adSlots}`);
    
    // Get period dates from Stripe - they're in the items array
    const subData = stripeSub as any;
    const firstItem = subData.items?.data?.[0];
    
    const periodStartRaw = firstItem?.current_period_start || subData.start_date;
    const periodEndRaw = firstItem?.current_period_end || subData.billing_cycle_anchor;
    
    console.log(`   Period start (raw): ${periodStartRaw}`);
    console.log(`   Period end (raw): ${periodEndRaw}`);
    
    const currentPeriodStart = periodStartRaw 
      ? new Date(periodStartRaw * 1000).toISOString()
      : new Date().toISOString();
    const currentPeriodEnd = periodEndRaw 
      ? new Date(periodEndRaw * 1000).toISOString()
      : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(); // 30 days from now
    
    // Map Stripe status to our status
    let status = subscription.status;
    if (stripeSub.status === 'active') status = 'ACTIVE';
    else if (stripeSub.status === 'trialing') status = 'TRIALING';
    else if (stripeSub.status === 'past_due') status = 'PAST_DUE';
    else if (stripeSub.status === 'canceled') status = 'CANCELLED';
    
    console.log(`   New Status: ${status}`);
    console.log(`   Period: ${currentPeriodStart} to ${currentPeriodEnd}`);
    
    if (DRY_RUN) {
      console.log('   🔶 DRY RUN - Would update with:');
      console.log(`      planId: ${productRecord.name}`);
      console.log(`      priceId: ${priceId}`);
      console.log(`      totalTokens: ${productRecord.adSlots}`);
      console.log(`      status: ${status}`);
      return true;
    }
    
    // Update the subscription
    await docClient.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: {
          pk: subscription.pk,
          sk: subscription.sk,
        },
        UpdateExpression: `
          SET planId = :planId,
              priceId = :priceId,
              totalTokens = :totalTokens,
              #status = :status,
              currentPeriodStart = :periodStart,
              currentPeriodEnd = :periodEnd,
              gsi4pk = :gsi4pk,
              gsi4sk = :gsi4sk,
              updatedAt = :now
        `,
        ExpressionAttributeNames: {
          '#status': 'status',
        },
        ExpressionAttributeValues: {
          ':planId': productRecord.name,
          ':priceId': priceId,
          ':totalTokens': productRecord.adSlots,
          ':status': status,
          ':periodStart': currentPeriodStart,
          ':periodEnd': currentPeriodEnd,
          ':gsi4pk': `SUBSCRIPTION_STATUS#${status}`,
          ':gsi4sk': currentPeriodEnd,
          ':now': new Date().toISOString(),
        },
      })
    );
    
    console.log('   ✅ Subscription fixed successfully');
    return true;
    
  } catch (error: any) {
    console.error(`   ❌ Error: ${error.message}`);
    return false;
  }
}

async function main() {
  console.log('🔧 Fix Pending Subscriptions Script');
  console.log('====================================');
  console.log(`Environment: ${ENV}`);
  console.log(`Table: ${TABLE_NAME}`);
  console.log(`Plans Table: ${PLANS_TABLE_NAME}`);
  console.log(`Dry Run: ${DRY_RUN}`);
  console.log('');
  
  // Get Stripe API key
  console.log('🔑 Fetching Stripe API key from SSM...');
  const stripeKey = await getStripeSecretKey();
  if (!stripeKey) {
    console.error('❌ Failed to get Stripe API key');
    process.exit(1);
  }
  console.log('✅ Got Stripe API key');
  
  const stripe = new Stripe(stripeKey);
  
  // Find pending subscriptions
  console.log('\n🔍 Scanning for pending subscriptions...');
  const pendingSubscriptions = await findPendingSubscriptions();
  console.log(`Found ${pendingSubscriptions.length} pending subscription(s)`);
  
  if (pendingSubscriptions.length === 0) {
    console.log('\n✅ No pending subscriptions to fix');
    return;
  }
  
  // Fix each subscription
  let fixed = 0;
  let failed = 0;
  
  for (const subscription of pendingSubscriptions) {
    const success = await fixSubscription(stripe, subscription);
    if (success) fixed++;
    else failed++;
  }
  
  console.log('\n====================================');
  console.log('📊 Summary');
  console.log(`   Total: ${pendingSubscriptions.length}`);
  console.log(`   Fixed: ${fixed}`);
  console.log(`   Failed: ${failed}`);
  
  if (DRY_RUN && fixed > 0) {
    console.log('\n⚠️  This was a dry run. Run without DRY_RUN=true to apply changes.');
  }
}

main().catch(console.error);

