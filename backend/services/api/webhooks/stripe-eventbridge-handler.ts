/**
 * Stripe EventBridge Handler
 * 
 * Processes Stripe events received via AWS EventBridge through SQS.
 * 
 * Architecture: EventBridge → SQS Queue → This Lambda
 * 
 * The SQS queue provides:
 * - Buffering for burst traffic (e.g., 500 renewals on the same day)
 * - Dead Letter Queue for failed events
 * - Automatic retries with visibility timeout
 * 
 * Subscription Events:
 * - checkout.session.completed → Link Stripe customer to host
 * - customer.subscription.created → Create/update subscription record
 * - customer.subscription.updated → Handle plan changes
 * - customer.subscription.deleted → Handle cancellation
 * - invoice.paid → Handle successful renewal payment
 * - invoice.payment_failed → Handle failed payment (grace period)
 * 
 * Catalog Events (for keeping local data in sync):
 * - product.created → Add new product to local table
 * - product.updated → Update product in local table
 * - product.deleted → Mark product as inactive
 * - price.created → Add new price to local table
 * - price.updated → Update price in local table
 * - price.deleted → Mark price as inactive
 * 
 * @see https://stripe.com/docs/stripe-apps/build-backend#eventbridge
 */

import { SQSEvent, SQSBatchResponse, SQSBatchItemFailure } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import Stripe from 'stripe';

import {
  handleCheckoutCompleted,
  handleSubscriptionCreated,
  handleSubscriptionUpdated,
  handleSubscriptionCancelled,
  handlePaymentSucceeded,
  handlePaymentFailed,
  handleCustomerDeleted,
  SubscriptionEventData,
  PaymentEventData,
  CancellationEventData,
  CheckoutSessionData,
} from '../../lib/subscription-events';

import { SubscriptionStatus } from '../../types/subscription.types';
import {
  StripeProductRecord,
  StripePriceRecord,
  buildStripeProductPK,
  buildStripePricePK,
  buildPriceGSI1Keys,
  stripeToBillingPeriod,
} from '../../types/subscription-plan.types';

import {
  getHostSubscriptionByStripeCustomerId,
  getPlanInfoByStripePriceId,
} from '../../lib/subscription-service';


import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';

// ============================================================================
// STRIPE CLIENT INITIALIZATION
// ============================================================================

const ssmClient = new SSMClient({});
const STAGE = process.env.STAGE || 'staging';

let stripeClient: Stripe | null = null;

/**
 * Get or initialize Stripe client with secret key from SSM
 */
async function getStripeClient(): Promise<Stripe> {
  if (stripeClient) {
    return stripeClient;
  }

  const parameterName = `/localstays/${STAGE}/stripe/secret-key`;
  
  try {
    const response = await ssmClient.send(
      new GetParameterCommand({
        Name: parameterName,
        WithDecryption: true,
      })
    );
    
    const secretKey = response.Parameter?.Value;
    if (!secretKey) {
      throw new Error(`Stripe secret key not found in SSM: ${parameterName}`);
    }
    
    stripeClient = new Stripe(secretKey);
    
    return stripeClient;
  } catch (error) {
    console.error('Failed to get Stripe secret key from SSM:', error);
    throw error;
  }
}


// Initialize DynamoDB client for product/price sync
const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const SUBSCRIPTION_PLANS_TABLE = process.env.SUBSCRIPTION_PLANS_TABLE_NAME!;

// ============================================================================
// TYPES
// ============================================================================

/**
 * Stripe event payload structure from EventBridge
 * The detail field contains the Stripe event object
 */
interface StripeEventBridgeDetail {
  id: string;
  object: 'event';
  api_version: string;
  created: number;
  data: {
    object: Stripe.Checkout.Session | Stripe.Subscription | Stripe.Invoice | Stripe.Product | Stripe.Price | Stripe.Customer;
    previous_attributes?: Record<string, unknown>;
  };
  livemode: boolean;
  pending_webhooks: number;
  request: {
    id: string | null;
    idempotency_key: string | null;
  };
  type: string;
}

// ============================================================================
// MAIN HANDLER (SQS Event Source)
// ============================================================================

/**
 * Main Lambda handler - processes SQS messages containing EventBridge events
 * 
 * With reportBatchItemFailures enabled, we return failed message IDs
 * so only those messages get retried (not the whole batch).
 */
export const handler = async (event: SQSEvent): Promise<SQSBatchResponse> => {
  console.log(`📥 Processing ${event.Records.length} Stripe event(s) from SQS`);
  
  const batchItemFailures: SQSBatchItemFailure[] = [];
  
  for (const record of event.Records) {
    try {
      // Parse the EventBridge event from SQS message body
      const eventBridgeEvent = JSON.parse(record.body);
      const stripeEvent: StripeEventBridgeDetail = eventBridgeEvent.detail;
      
      console.log('📥 Stripe event received:', {
        messageId: record.messageId,
        detailType: eventBridgeEvent['detail-type'],
        eventType: stripeEvent?.type,
        eventId: stripeEvent?.id,
      });

      if (!stripeEvent || !stripeEvent.type) {
        console.error('❌ Invalid event structure - missing type', { messageId: record.messageId });
        // Don't retry malformed events - they'll never succeed
        continue;
      }

      await processStripeEvent(stripeEvent);
      
    } catch (error) {
      console.error(`❌ Error processing message ${record.messageId}:`, error);
      // Add to failures - this message will be retried
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }
  
  if (batchItemFailures.length > 0) {
    console.log(`⚠️ ${batchItemFailures.length}/${event.Records.length} messages failed, will be retried`);
  } else {
    console.log(`✅ All ${event.Records.length} messages processed successfully`);
  }
  
  return { batchItemFailures };
};

/**
 * Process a single Stripe event
 */
async function processStripeEvent(stripeEvent: StripeEventBridgeDetail): Promise<void> {
  switch (stripeEvent.type) {
    case 'checkout.session.completed':
      await processCheckoutSessionCompleted(stripeEvent.data.object as Stripe.Checkout.Session);
      break;

    case 'customer.subscription.created':
      await processSubscriptionCreated(stripeEvent.data.object as Stripe.Subscription);
      break;

    case 'customer.subscription.updated':
      await processSubscriptionUpdated(
        stripeEvent.data.object as Stripe.Subscription,
        stripeEvent.data.previous_attributes
      );
      break;

    case 'customer.subscription.deleted':
      await processSubscriptionDeleted(stripeEvent.data.object as Stripe.Subscription);
      break;

    case 'invoice.paid':
      await processInvoicePaid(stripeEvent.data.object as Stripe.Invoice);
      break;

    case 'invoice.payment_failed':
      await processInvoicePaymentFailed(stripeEvent.data.object as Stripe.Invoice);
      break;

    // Product/Price catalog events
    case 'product.created':
    case 'product.updated':
      await processProductUpsert(stripeEvent.data.object as Stripe.Product);
      break;

    case 'product.deleted':
      await processProductDeleted(stripeEvent.data.object as Stripe.Product);
      break;

    case 'price.created':
    case 'price.updated':
      await processPriceUpsert(stripeEvent.data.object as Stripe.Price);
      break;

    case 'price.deleted':
      await processPriceDeleted(stripeEvent.data.object as Stripe.Price);
      break;

    case 'customer.deleted':
      await processCustomerDeleted(stripeEvent.data.object as Stripe.Customer);
      break;

    default:
      console.log(`ℹ️ Unhandled event type: ${stripeEvent.type}`);
  }
}

// ============================================================================
// EVENT PROCESSORS
// ============================================================================

/**
 * Process checkout.session.completed
 * This is the AUTHORITATIVE handler for new subscriptions.
 * 
 * It fetches the full subscription details from Stripe API and creates
 * a complete subscription record, eliminating the race condition with
 * customer.subscription.created event.
 */
async function processCheckoutSessionCompleted(
  session: Stripe.Checkout.Session
): Promise<void> {
  console.log('🛒 Processing checkout.session.completed:', {
    sessionId: session.id,
    customerId: session.customer,
    subscriptionId: session.subscription,
    clientReferenceId: session.client_reference_id,
  });

  // client_reference_id should contain the hostId (set in Pricing Table embed)
  const hostId = session.client_reference_id;
  
  if (!hostId) {
    console.error('❌ No client_reference_id (hostId) in checkout session');
    return;
  }

  const stripeCustomerId = typeof session.customer === 'string' 
    ? session.customer 
    : session.customer?.id;
    
  const stripeSubscriptionId = typeof session.subscription === 'string'
    ? session.subscription
    : session.subscription?.id;

  if (!stripeCustomerId || !stripeSubscriptionId) {
    console.error('❌ Missing customer or subscription ID in checkout session');
    return;
  }

  // Fetch full subscription details from Stripe API
  // This eliminates the race condition with customer.subscription.created
  let subscriptionDetails: CheckoutSessionData['subscriptionDetails'] = undefined;
  
  try {
    const stripe = await getStripeClient();
    const subscription = await stripe.subscriptions.retrieve(stripeSubscriptionId);
    
    console.log('📋 Fetched subscription from Stripe:', {
      subscriptionId: subscription.id,
      status: subscription.status,
      priceId: subscription.items.data[0]?.price?.id,
      trialStart: subscription.trial_start,
      trialEnd: subscription.trial_end,
    });
    
    // Get plan info from our database using the Stripe price ID
    const priceId = subscription.items.data[0]?.price?.id;
    let adSlots = 0;
    let planName = 'Unknown Plan';
    
    if (priceId) {
      const planInfo = await getPlanInfoByStripePriceId(priceId);
      if (planInfo) {
        adSlots = planInfo.adSlots;
        planName = planInfo.name;
        console.log('✅ Found plan info:', { planName, adSlots, priceId });
      } else {
        console.warn(`⚠️ No plan info found for price ${priceId} - subscription will have 0 tokens`);
      }
    }
    
    // Get period dates from subscription items
    const periodStart = subscription.items.data[0]?.current_period_start;
    const periodEnd = subscription.items.data[0]?.current_period_end;
    
    subscriptionDetails = {
      planId: planName,
      priceId: priceId || '',
      status: mapStripeStatus(subscription.status),
      currentPeriodStart: periodStart ? new Date(periodStart * 1000).toISOString() : new Date().toISOString(),
      currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000).toISOString() : new Date().toISOString(),
      adSlots,
      // Trial period info (if subscription has a trial)
      trialStart: subscription.trial_start ? new Date(subscription.trial_start * 1000).toISOString() : undefined,
      trialEnd: subscription.trial_end ? new Date(subscription.trial_end * 1000).toISOString() : undefined,
    };
  } catch (error) {
    console.error('⚠️ Failed to fetch subscription details from Stripe:', error);
    // Continue without subscription details - will be updated by subscription.created event
  }

  const data: CheckoutSessionData = {
    hostId,
    stripeCustomerId,
    stripeSubscriptionId,
    sessionId: session.id,
    customerEmail: session.customer_details?.email || undefined,
    subscriptionDetails,
  };

  const result = await handleCheckoutCompleted(data);
  
  if (!result.success) {
    throw new Error(`Failed to process checkout: ${result.error}`);
  }
  
  console.log('✅ Checkout session processed:', result.details);
}

/**
 * Process customer.subscription.created
 * Updates the subscription record with full plan details.
 * 
 * NOTE: This event fires for NEW subscriptions only. The host-to-customer link
 * is created by checkout.session.completed, which may arrive before or after this event.
 * 
 * If host link doesn't exist yet, we skip processing - checkout.session.completed
 * will create the subscription record and fetch details from Stripe API.
 */
async function processSubscriptionCreated(
  subscription: Stripe.Subscription
): Promise<void> {
  console.log('📋 Processing customer.subscription.created:', {
    subscriptionId: subscription.id,
    customerId: subscription.customer,
    status: subscription.status,
  });

  // Look up host by Stripe customer ID
  const stripeCustomerId = typeof subscription.customer === 'string'
    ? subscription.customer
    : subscription.customer?.id;

  if (!stripeCustomerId) {
    console.error('❌ No customer ID in subscription');
    return;
  }

  // Check if host link exists (created by checkout.session.completed)
  // Don't retry - if it doesn't exist, checkout.session.completed will handle it
  const hostSubscription = await getHostSubscriptionByStripeCustomerId(stripeCustomerId);
  
  if (!hostSubscription) {
    // This is expected if checkout.session.completed hasn't processed yet
    // That handler will create the full subscription record
    console.log(`ℹ️ No host link found for customer ${stripeCustomerId} - checkout.session.completed will handle subscription creation`);
    return;
  }

  // Extract plan ID from subscription metadata or product
  // The plan ID should be stored in the product metadata in Stripe
  const planId = extractPlanId(subscription);
  
  // Get billing period dates from subscription items
  const periodStart = subscription.items.data[0]?.current_period_start;
  const periodEnd = subscription.items.data[0]?.current_period_end;

  const data: SubscriptionEventData = {
    hostId: hostSubscription.hostId,
    stripeCustomerId,
    stripeSubscriptionId: subscription.id,
    planId,
    priceId: subscription.items.data[0]?.price?.id,
    status: mapStripeStatus(subscription.status),
    currentPeriodStart: periodStart ? new Date(periodStart * 1000).toISOString() : new Date().toISOString(),
    currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000).toISOString() : new Date().toISOString(),
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
    trialStart: subscription.trial_start ? new Date(subscription.trial_start * 1000).toISOString() : undefined,
    trialEnd: subscription.trial_end ? new Date(subscription.trial_end * 1000).toISOString() : undefined,
  };

  const result = await handleSubscriptionCreated(data);
  
  if (!result.success) {
    throw new Error(`Failed to create subscription: ${result.error}`);
  }
  
  console.log('✅ Subscription created:', result.details);
}

/**
 * Process customer.subscription.updated
 * Handles plan changes, cancellations, reactivations.
 */
async function processSubscriptionUpdated(
  subscription: Stripe.Subscription,
  previousAttributes?: Record<string, unknown>
): Promise<void> {
  // Stripe uses either cancel_at_period_end (boolean) OR cancel_at (timestamp) for scheduled cancellations
  // We need to check both to determine if the subscription is scheduled to cancel
  const cancelAt = (subscription as any).cancel_at;
  const isScheduledToCancel = subscription.cancel_at_period_end || !!cancelAt;
  
  console.log('📝 Processing customer.subscription.updated:', {
    subscriptionId: subscription.id,
    status: subscription.status,
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
    cancelAt: cancelAt ? new Date(cancelAt * 1000).toISOString() : null,
    isScheduledToCancel,
    cancellationDetails: (subscription as any).cancellation_details,
    previousAttributes,
  });

  const stripeCustomerId = typeof subscription.customer === 'string'
    ? subscription.customer
    : subscription.customer?.id;

  if (!stripeCustomerId) {
    console.error('❌ No customer ID in subscription');
    return;
  }

  // For subscription updates, the host link MUST exist (created at initial checkout)
  const hostSubscription = await getHostSubscriptionByStripeCustomerId(stripeCustomerId);
  
  if (!hostSubscription) {
    console.error(`❌ No host found for Stripe customer ${stripeCustomerId} - this should not happen for updates`);
    throw new Error(`Host not found for Stripe customer ${stripeCustomerId}`);
  }

  const planId = extractPlanId(subscription);
  
  // Get period dates - prefer subscription level, fall back to item level
  // Note: In EventBridge events, subscription-level dates may be undefined
  const periodStart = (subscription as any).current_period_start || subscription.items.data[0]?.current_period_start;
  const periodEnd = (subscription as any).current_period_end || subscription.items.data[0]?.current_period_end;
  
  console.log('📅 Subscription period dates:', {
    subscriptionLevelStart: (subscription as any).current_period_start,
    subscriptionLevelEnd: (subscription as any).current_period_end,
    itemLevelStart: subscription.items.data[0]?.current_period_start,
    itemLevelEnd: subscription.items.data[0]?.current_period_end,
    usingStart: periodStart,
    usingEnd: periodEnd,
    startDate: periodStart ? new Date(periodStart * 1000).toISOString() : null,
    endDate: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
  });
  
  // Get cancellation timestamp if scheduled
  const cancelledAt = cancelAt 
    ? new Date(cancelAt * 1000).toISOString() 
    : (subscription.canceled_at ? new Date(subscription.canceled_at * 1000).toISOString() : undefined);

  const data: SubscriptionEventData = {
    hostId: hostSubscription.hostId,
    stripeCustomerId,
    stripeSubscriptionId: subscription.id,
    planId,
    priceId: subscription.items.data[0]?.price?.id,
    status: mapStripeStatus(subscription.status),
    currentPeriodStart: periodStart ? new Date(periodStart * 1000).toISOString() : new Date().toISOString(),
    currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000).toISOString() : new Date().toISOString(),
    cancelAtPeriodEnd: isScheduledToCancel,
    cancelledAt,
    previousPlanId: hostSubscription.planId,
    previousTokens: hostSubscription.totalTokens,
  };

  const result = await handleSubscriptionUpdated(data);
  
  if (!result.success) {
    throw new Error(`Failed to update subscription: ${result.error}`);
  }
  
  console.log('✅ Subscription updated:', result.details);
}

/**
 * Process customer.subscription.deleted
 * Handles subscription cancellation (immediate or at period end).
 */
async function processSubscriptionDeleted(
  subscription: Stripe.Subscription
): Promise<void> {
  console.log('🗑️ Processing customer.subscription.deleted:', {
    subscriptionId: subscription.id,
    canceledAt: subscription.canceled_at,
  });

  const stripeCustomerId = typeof subscription.customer === 'string'
    ? subscription.customer
    : subscription.customer?.id;

  if (!stripeCustomerId) {
    console.error('❌ No customer ID in subscription');
    return;
  }

  // For cancellations, the host link MUST exist (created at initial checkout)
  const hostSubscription = await getHostSubscriptionByStripeCustomerId(stripeCustomerId);
  
  if (!hostSubscription) {
    console.error(`❌ No host found for Stripe customer ${stripeCustomerId} - this should not happen for cancellations`);
    throw new Error(`Host not found for Stripe customer ${stripeCustomerId}`);
  }

  const periodEnd = subscription.items.data[0]?.current_period_end;

  const data: CancellationEventData = {
    hostId: hostSubscription.hostId,
    stripeSubscriptionId: subscription.id,
    cancelledImmediately: subscription.status === 'canceled',
    cancelledAt: subscription.canceled_at 
      ? new Date(subscription.canceled_at * 1000).toISOString()
      : new Date().toISOString(),
    periodEnd: periodEnd ? new Date(periodEnd * 1000).toISOString() : undefined,
  };

  const result = await handleSubscriptionCancelled(data);
  
  if (!result.success) {
    throw new Error(`Failed to cancel subscription: ${result.error}`);
  }
  
  console.log('✅ Subscription cancelled:', result.details);
}

/**
 * Process invoice.paid
 * Handles successful payment (renewal).
 * 
 * IMPORTANT: We only extend slots for renewal invoices (subscription_cycle).
 * Plan change invoices (subscription_update) are handled by subscription.updated event.
 */
async function processInvoicePaid(invoice: Stripe.Invoice): Promise<void> {
  const billingReason = invoice.billing_reason;
  
  console.log('💰 Processing invoice.paid:', {
    invoiceId: invoice.id,
    subscriptionId: invoice.parent?.subscription_details?.subscription,
    amountPaid: invoice.amount_paid,
    billingReason,
  });

  // Only process subscription invoices
  const subscriptionId = invoice.parent?.subscription_details?.subscription;
  if (!subscriptionId) {
    console.log('ℹ️ Not a subscription invoice, skipping');
    return;
  }

  // Skip initial subscription invoices - checkout.session.completed handles new subscriptions
  // This avoids the race condition where invoice.paid arrives before checkout links the host
  if (billingReason === 'subscription_create') {
    console.log('ℹ️ Initial subscription invoice - skipping (handled by checkout.session.completed)');
    return;
  }

  // Skip plan change invoices - subscription.updated handles slot updates for those
  if (billingReason === 'subscription_update') {
    console.log('ℹ️ Plan change invoice - skipping slot extension (handled by subscription.updated)');
    return;
  }

  const stripeCustomerId = typeof invoice.customer === 'string'
    ? invoice.customer
    : invoice.customer?.id;

  if (!stripeCustomerId) {
    console.error('❌ No customer ID in invoice');
    return;
  }

  // For renewal payments, the host link MUST exist (created at initial checkout)
  const hostSubscription = await getHostSubscriptionByStripeCustomerId(stripeCustomerId);
  
  if (!hostSubscription) {
    console.error(`❌ No host found for Stripe customer ${stripeCustomerId} - this should not happen for renewals`);
    throw new Error(`Host not found for Stripe customer ${stripeCustomerId}`);
  }

  // Get period from invoice lines (subscription line item)
  // Note: In newer Stripe API versions, use subscription property to identify subscription lines
  const subscriptionLine = invoice.lines?.data?.find(
    (line) => line.subscription !== null && line.subscription !== undefined
  );
  
  const periodStart = subscriptionLine?.period?.start || invoice.period_start;
  const periodEnd = subscriptionLine?.period?.end || invoice.period_end;

  // Extract subscription ID as string
  const subscriptionIdStr = typeof subscriptionId === 'string' 
    ? subscriptionId 
    : (subscriptionId as Stripe.Subscription)?.id;

  const data: PaymentEventData = {
    hostId: hostSubscription.hostId,
    stripeSubscriptionId: subscriptionIdStr,
    stripeInvoiceId: invoice.id,
    paid: true,
    amountPaid: invoice.amount_paid,
    currency: invoice.currency,
    periodStart: periodStart ? new Date(periodStart * 1000).toISOString() : new Date().toISOString(),
    periodEnd: periodEnd ? new Date(periodEnd * 1000).toISOString() : new Date().toISOString(),
  };

  const result = await handlePaymentSucceeded(data);
  
  if (!result.success) {
    throw new Error(`Failed to process payment: ${result.error}`);
  }
  
  console.log('✅ Invoice paid processed:', result.details);
}

/**
 * Process invoice.payment_failed
 * Handles failed payment (triggers grace period).
 */
async function processInvoicePaymentFailed(invoice: Stripe.Invoice): Promise<void> {
  console.log('❌ Processing invoice.payment_failed:', {
    invoiceId: invoice.id,
    subscriptionId: invoice.parent?.subscription_details?.subscription,
  });

  // Only process subscription invoices
  const subscriptionId = invoice.parent?.subscription_details?.subscription;
  if (!subscriptionId) {
    console.log('ℹ️ Not a subscription invoice, skipping');
    return;
  }

  const stripeCustomerId = typeof invoice.customer === 'string'
    ? invoice.customer
    : invoice.customer?.id;

  if (!stripeCustomerId) {
    console.error('❌ No customer ID in invoice');
    return;
  }

  // For payment failures, the host link MUST exist (created at initial checkout)
  const hostSubscription = await getHostSubscriptionByStripeCustomerId(stripeCustomerId);
  
  if (!hostSubscription) {
    console.error(`❌ No host found for Stripe customer ${stripeCustomerId} - this should not happen for payment failures`);
    throw new Error(`Host not found for Stripe customer ${stripeCustomerId}`);
  }

  // Note: In newer Stripe API versions, use subscription property to identify subscription lines
  const subscriptionLine = invoice.lines?.data?.find(
    (line) => line.subscription !== null && line.subscription !== undefined
  );
  
  const periodStart = subscriptionLine?.period?.start || invoice.period_start;
  const periodEnd = subscriptionLine?.period?.end || invoice.period_end;

  // Extract subscription ID as string
  const subscriptionIdStr = typeof subscriptionId === 'string' 
    ? subscriptionId 
    : (subscriptionId as Stripe.Subscription)?.id;

  const data: PaymentEventData = {
    hostId: hostSubscription.hostId,
    stripeSubscriptionId: subscriptionIdStr,
    stripeInvoiceId: invoice.id,
    paid: false,
    periodStart: periodStart ? new Date(periodStart * 1000).toISOString() : new Date().toISOString(),
    periodEnd: periodEnd ? new Date(periodEnd * 1000).toISOString() : new Date().toISOString(),
  };

  const result = await handlePaymentFailed(data);
  
  if (!result.success) {
    throw new Error(`Failed to process payment failure: ${result.error}`);
  }
  
  console.log('✅ Payment failure processed:', result.details);
}

/**
 * Process customer.deleted
 * When a Stripe customer is deleted, we remove their subscription record entirely.
 * This is a hard delete - the subscription is gone as if it never existed.
 */
async function processCustomerDeleted(customer: Stripe.Customer): Promise<void> {
  console.log('🗑️ Processing customer.deleted:', {
    customerId: customer.id,
    email: customer.email,
  });

  // Look up host subscription by Stripe customer ID
  const hostSubscription = await getHostSubscriptionByStripeCustomerId(customer.id);
  
  if (!hostSubscription) {
    console.log(`ℹ️ No subscription found for deleted customer ${customer.id} - nothing to delete`);
    return;
  }

  const result = await handleCustomerDeleted({
    hostId: hostSubscription.hostId,
    stripeCustomerId: customer.id,
  });
  
  if (!result.success) {
    throw new Error(`Failed to process customer deletion: ${result.error}`);
  }
  
  console.log('✅ Customer deleted, subscription removed:', result.details);
}

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Extract plan ID from Stripe subscription
 * The plan ID should be stored in product metadata
 */
function extractPlanId(subscription: Stripe.Subscription): string {
  // Try to get from product metadata first
  const product = subscription.items.data[0]?.price?.product;
  
  if (typeof product === 'object' && product !== null) {
    const metadata = (product as Stripe.Product).metadata;
    if (metadata?.planId) {
      return metadata.planId;
    }
  }
  
  // Fallback: try to extract from price metadata
  const priceMetadata = subscription.items.data[0]?.price?.metadata;
  if (priceMetadata?.planId) {
    return priceMetadata.planId;
  }
  
  // Last resort: use price ID as plan identifier
  console.warn('⚠️ Could not extract planId from subscription, using price ID');
  return subscription.items.data[0]?.price?.id || 'unknown';
}

/**
 * Map Stripe subscription status to our internal status
 */
function mapStripeStatus(stripeStatus: Stripe.Subscription.Status): SubscriptionStatus {
  switch (stripeStatus) {
    case 'active':
      return 'ACTIVE';
    case 'trialing':
      return 'TRIALING';
    case 'past_due':
      return 'PAST_DUE';
    case 'canceled':
      return 'CANCELLED';
    case 'incomplete':
    case 'incomplete_expired':
      return 'INCOMPLETE';
    case 'unpaid':
      return 'EXPIRED';
    case 'paused':
      return 'ACTIVE'; // We don't have a PAUSED status, treat as ACTIVE
    default:
      console.warn(`⚠️ Unknown Stripe status: ${stripeStatus}, defaulting to INCOMPLETE`);
      return 'INCOMPLETE';
  }
}

// ============================================================================
// PRODUCT/PRICE CATALOG SYNC
// ============================================================================

/**
 * Process product.created or product.updated
 * Syncs product data to local DynamoDB table
 */
async function processProductUpsert(product: Stripe.Product): Promise<void> {
  console.log('📦 Processing product upsert:', {
    productId: product.id,
    name: product.name,
    active: product.active,
  });

  const metadata = product.metadata || {};
  const adSlots = parseInt(metadata.adSlots || '0', 10);

  if (adSlots === 0) {
    console.warn(`⚠️ Product ${product.name} (${product.id}) missing adSlots metadata - skipping sync`);
    return;
  }

  let features: string[] = [];
  let features_sr: string[] = [];

  try {
    if (metadata.features) {
      features = JSON.parse(metadata.features);
    }
  } catch {
    console.warn(`⚠️ Product ${product.id} has invalid features JSON`);
  }

  try {
    if (metadata.features_sr) {
      features_sr = JSON.parse(metadata.features_sr);
    }
  } catch {
    console.warn(`⚠️ Product ${product.id} has invalid features_sr JSON`);
  }

  const now = new Date().toISOString();

  const productRecord: StripeProductRecord = {
    pk: buildStripeProductPK(product.id),
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

  await docClient.send(
    new PutCommand({
      TableName: SUBSCRIPTION_PLANS_TABLE,
      Item: productRecord,
    })
  );

  console.log(`✅ Product synced: ${product.name} (${product.id}) - ${adSlots} slots`);
}

/**
 * Process product.deleted
 * Marks product as inactive in local table
 */
async function processProductDeleted(product: Stripe.Product): Promise<void> {
  console.log('🗑️ Processing product deleted:', {
    productId: product.id,
  });

  const now = new Date().toISOString();

  await docClient.send(
    new UpdateCommand({
      TableName: SUBSCRIPTION_PLANS_TABLE,
      Key: {
        pk: buildStripeProductPK(product.id),
        sk: 'PRODUCT',
      },
      UpdateExpression: 'SET isActive = :inactive, updatedAt = :now, syncedAt = :now',
      ExpressionAttributeValues: {
        ':inactive': false,
        ':now': now,
      },
    })
  );

  console.log(`✅ Product marked inactive: ${product.id}`);
}

/**
 * Process price.created or price.updated
 * Syncs price data to local DynamoDB table
 */
async function processPriceUpsert(price: Stripe.Price): Promise<void> {
  console.log('💰 Processing price upsert:', {
    priceId: price.id,
    productId: price.product,
    amount: price.unit_amount,
    active: price.active,
  });

  // Only sync recurring prices
  if (!price.recurring) {
    console.log('ℹ️ Not a recurring price, skipping');
    return;
  }

  const productId = typeof price.product === 'string' ? price.product : price.product?.id;

  if (!productId) {
    console.error('❌ Price has no product ID');
    return;
  }

  const billingPeriod = stripeToBillingPeriod(
    price.recurring.interval,
    price.recurring.interval_count
  );

  const gsiKeys = buildPriceGSI1Keys(productId, billingPeriod);
  const now = new Date().toISOString();

  const priceRecord: StripePriceRecord = {
    pk: buildStripePricePK(price.id),
    sk: 'PRICE',
    stripePriceId: price.id,
    stripeProductId: productId,
    amount: price.unit_amount || 0,
    currency: price.currency,
    billingPeriod,
    interval: price.recurring.interval,
    intervalCount: price.recurring.interval_count,
    isActive: price.active,
    gsi1pk: gsiKeys.gsi1pk,
    gsi1sk: gsiKeys.gsi1sk,
    createdAt: now,
    updatedAt: now,
    syncedAt: now,
  };

  await docClient.send(
    new PutCommand({
      TableName: SUBSCRIPTION_PLANS_TABLE,
      Item: priceRecord,
    })
  );

  const amountFormatted = ((price.unit_amount || 0) / 100).toFixed(2);
  console.log(`✅ Price synced: ${price.id} - €${amountFormatted} (${billingPeriod})`);
}

/**
 * Process price.deleted
 * Marks price as inactive in local table
 */
async function processPriceDeleted(price: Stripe.Price): Promise<void> {
  console.log('🗑️ Processing price deleted:', {
    priceId: price.id,
  });

  const now = new Date().toISOString();

  await docClient.send(
    new UpdateCommand({
      TableName: SUBSCRIPTION_PLANS_TABLE,
      Key: {
        pk: buildStripePricePK(price.id),
        sk: 'PRICE',
      },
      UpdateExpression: 'SET isActive = :inactive, updatedAt = :now, syncedAt = :now',
      ExpressionAttributeValues: {
        ':inactive': false,
        ':now': now,
      },
    })
  );

  console.log(`✅ Price marked inactive: ${price.id}`);
}

