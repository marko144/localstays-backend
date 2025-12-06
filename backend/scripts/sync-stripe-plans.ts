/**
 * One-off Script: Sync Stripe Products and Prices to DynamoDB
 * 
 * This script pulls all active products and prices from Stripe and stores them
 * in our SubscriptionPlans table for quick lookup during subscription events.
 * 
 * Usage:
 *   npx ts-node scripts/sync-stripe-plans.ts [--dry-run]
 * 
 * Environment variables required:
 *   - AWS_REGION (default: eu-north-1)
 *   - STAGE (default: staging)
 *   - STRIPE_SECRET_KEY or fetched from SSM
 * 
 * Stripe Product Metadata Expected:
 *   - adSlots: number (required) - Number of ad slots/tokens for this plan
 *   - displayName_sr: string - Serbian display name
 *   - description_sr: string - Serbian description  
 *   - features: string - JSON array of features in English
 *   - features_sr: string - JSON array of features in Serbian
 *   - sortOrder: number - Display order on pricing page
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import Stripe from 'stripe';

// Configuration
const REGION = process.env.AWS_REGION || 'eu-north-1';
const STAGE = process.env.STAGE || 'staging';
const DRY_RUN = process.argv.includes('--dry-run');

const SUBSCRIPTION_PLANS_TABLE = `localstays-subscription-plans-${STAGE}`;

// Initialize clients
const dynamoClient = new DynamoDBClient({ region: REGION });
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const ssmClient = new SSMClient({ region: REGION });

// Types (matching subscription-plan.types.ts)
type BillingPeriod = 'MONTHLY' | 'QUARTERLY' | 'SEMI_ANNUAL' | 'YEARLY';

interface StripeProductRecord {
  pk: string;
  sk: string;
  stripeProductId: string;
  name: string;
  description: string | null;
  adSlots: number;
  displayName_sr: string | null;
  description_sr: string | null;
  features: string[];
  features_sr: string[];
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  syncedAt: string;
}

interface StripePriceRecord {
  pk: string;
  sk: string;
  stripePriceId: string;
  stripeProductId: string;
  amount: number;
  currency: string;
  billingPeriod: BillingPeriod;
  interval: string;
  intervalCount: number;
  isActive: boolean;
  gsi1pk: string;
  gsi1sk: string;
  createdAt: string;
  updatedAt: string;
  syncedAt: string;
}

function stripeToBillingPeriod(interval: string, intervalCount: number): BillingPeriod {
  if (interval === 'month' && intervalCount === 1) return 'MONTHLY';
  if (interval === 'month' && intervalCount === 3) return 'QUARTERLY';
  if (interval === 'month' && intervalCount === 6) return 'SEMI_ANNUAL';
  if (interval === 'year' && intervalCount === 1) return 'YEARLY';
  return 'MONTHLY';
}

async function getStripeSecretKey(): Promise<string> {
  // Check env var first
  if (process.env.STRIPE_SECRET_KEY) {
    return process.env.STRIPE_SECRET_KEY;
  }

  // Fetch from SSM
  const parameterName = `/localstays/${STAGE}/stripe/secret-key`;
  console.log(`Fetching Stripe secret key from SSM: ${parameterName}`);
  
  const result = await ssmClient.send(
    new GetParameterCommand({
      Name: parameterName,
      WithDecryption: true,
    })
  );

  const secretKey = result.Parameter?.Value;
  if (!secretKey) {
    throw new Error(`Stripe secret key not found at ${parameterName}`);
  }

  return secretKey;
}

async function main() {
  console.log('='.repeat(60));
  console.log('Stripe Plans Sync Script');
  console.log('='.repeat(60));
  console.log(`Stage: ${STAGE}`);
  console.log(`Table: ${SUBSCRIPTION_PLANS_TABLE}`);
  console.log(`Dry Run: ${DRY_RUN}`);
  console.log('');

  // Get Stripe client
  const secretKey = await getStripeSecretKey();
  const stripe = new Stripe(secretKey);

  const now = new Date().toISOString();
  let productsCreated = 0;
  let productsUpdated = 0;
  let pricesCreated = 0;
  let pricesUpdated = 0;
  const errors: string[] = [];

  // Fetch all active products from Stripe
  console.log('Fetching products from Stripe...');
  const products = await stripe.products.list({
    active: true,
    limit: 100,
  });
  console.log(`Found ${products.data.length} active products`);

  // Fetch all active recurring prices from Stripe
  console.log('Fetching prices from Stripe...');
  const prices = await stripe.prices.list({
    active: true,
    type: 'recurring',
    limit: 100,
  });
  console.log(`Found ${prices.data.length} active recurring prices`);
  console.log('');

  // Process each product
  console.log('Processing products...');
  for (const product of products.data) {
    const metadata = product.metadata || {};
    const adSlots = parseInt(metadata.adSlots || '0', 10);

    if (adSlots === 0) {
      console.warn(`  ⚠️  Product "${product.name}" (${product.id}) missing adSlots metadata - SKIPPING`);
      errors.push(`Product ${product.name} missing adSlots metadata`);
      continue;
    }

    let features: string[] = [];
    let features_sr: string[] = [];

    try {
      if (metadata.features) {
        features = JSON.parse(metadata.features);
      }
    } catch {
      console.warn(`  ⚠️  Product "${product.name}" has invalid features JSON`);
    }

    try {
      if (metadata.features_sr) {
        features_sr = JSON.parse(metadata.features_sr);
      }
    } catch {
      console.warn(`  ⚠️  Product "${product.name}" has invalid features_sr JSON`);
    }

    const productRecord: StripeProductRecord = {
      pk: `STRIPE_PRODUCT#${product.id}`,
      sk: 'PRODUCT',
      stripeProductId: product.id,
      name: product.name,
      description: product.description,
      adSlots,
      displayName_sr: metadata.displayName_sr || null,
      description_sr: metadata.description_sr || null,
      features,
      features_sr,
      sortOrder: parseInt(metadata.sortOrder || '99', 10),
      isActive: product.active,
      createdAt: now,
      updatedAt: now,
      syncedAt: now,
    };

    // Check if exists
    const existingResult = await docClient.send(
      new ScanCommand({
        TableName: SUBSCRIPTION_PLANS_TABLE,
        FilterExpression: 'pk = :pk AND sk = :sk',
        ExpressionAttributeValues: {
          ':pk': productRecord.pk,
          ':sk': 'PRODUCT',
        },
        Limit: 1,
      })
    );

    const isUpdate = existingResult.Items && existingResult.Items.length > 0;
    if (isUpdate) {
      productRecord.createdAt = existingResult.Items![0].createdAt;
      productsUpdated++;
    } else {
      productsCreated++;
    }

    console.log(`  ${isUpdate ? '📝' : '✨'} ${product.name} (${product.id}) - ${adSlots} slots`);

    if (!DRY_RUN) {
      await docClient.send(
        new PutCommand({
          TableName: SUBSCRIPTION_PLANS_TABLE,
          Item: productRecord,
        })
      );
    }
  }

  console.log('');
  console.log('Processing prices...');

  // Process each price
  for (const price of prices.data) {
    const productId = typeof price.product === 'string' ? price.product : price.product?.id;

    if (!productId) {
      console.warn(`  ⚠️  Price ${price.id} has no product - SKIPPING`);
      continue;
    }

    if (!price.recurring) {
      continue;
    }

    const billingPeriod = stripeToBillingPeriod(
      price.recurring.interval,
      price.recurring.interval_count
    );

    const priceRecord: StripePriceRecord = {
      pk: `STRIPE_PRICE#${price.id}`,
      sk: 'PRICE',
      stripePriceId: price.id,
      stripeProductId: productId,
      amount: price.unit_amount || 0,
      currency: price.currency,
      billingPeriod,
      interval: price.recurring.interval,
      intervalCount: price.recurring.interval_count,
      isActive: price.active,
      gsi1pk: `STRIPE_PRODUCT#${productId}`,
      gsi1sk: `PRICE#${billingPeriod}`,
      createdAt: now,
      updatedAt: now,
      syncedAt: now,
    };

    // Check if exists
    const existingResult = await docClient.send(
      new ScanCommand({
        TableName: SUBSCRIPTION_PLANS_TABLE,
        FilterExpression: 'pk = :pk AND sk = :sk',
        ExpressionAttributeValues: {
          ':pk': priceRecord.pk,
          ':sk': 'PRICE',
        },
        Limit: 1,
      })
    );

    const isUpdate = existingResult.Items && existingResult.Items.length > 0;
    if (isUpdate) {
      priceRecord.createdAt = existingResult.Items![0].createdAt;
      pricesUpdated++;
    } else {
      pricesCreated++;
    }

    const amountFormatted = (price.unit_amount! / 100).toFixed(2);
    console.log(`  ${isUpdate ? '📝' : '✨'} ${price.id} - €${amountFormatted} (${billingPeriod})`);

    if (!DRY_RUN) {
      await docClient.send(
        new PutCommand({
          TableName: SUBSCRIPTION_PLANS_TABLE,
          Item: priceRecord,
        })
      );
    }
  }

  // Summary
  console.log('');
  console.log('='.repeat(60));
  console.log('SUMMARY');
  console.log('='.repeat(60));
  console.log(`Products created: ${productsCreated}`);
  console.log(`Products updated: ${productsUpdated}`);
  console.log(`Prices created: ${pricesCreated}`);
  console.log(`Prices updated: ${pricesUpdated}`);
  
  if (errors.length > 0) {
    console.log('');
    console.log('Errors:');
    errors.forEach(e => console.log(`  - ${e}`));
  }

  if (DRY_RUN) {
    console.log('');
    console.log('⚠️  DRY RUN - No changes were made to the database');
    console.log('   Run without --dry-run to apply changes');
  } else {
    console.log('');
    console.log('✅ Sync complete!');
  }
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});

