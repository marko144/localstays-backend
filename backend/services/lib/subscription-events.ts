/**
 * Subscription Events Handler
 * 
 * Core business logic for handling subscription lifecycle events.
 * Used by both Stripe webhooks (production) and dev simulator (staging).
 * 
 * This module is the single source of truth for subscription event handling.
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';

import {
  HostSubscription,
  SubscriptionStatus,
  buildHostSubscriptionPK,
  buildHostSubscriptionSK,
} from '../types/subscription.types';

import {
  getHostSubscription,
  getSubscriptionPlan,
  getPlanInfoByStripePriceId,
  getHostSlots,
  extendSlotsAtRenewal,
  updateSlotsToNewPeriod,
  markHostSlotsPastDue,
  markSlotsForImmediateExpiry,
  saveHostSubscription,
} from './subscription-service';

import { GetCommand } from '@aws-sdk/lib-dynamodb';

import {
  sendSubscriptionWelcomeEmail,
  sendSubscriptionCancelledEmail,
  sendPaymentFailedEmail,
  sendTrialConvertedEmail,
  sendSubscriptionRenewedEmail,
} from '../api/lib/email-service';

// ============================================================================
// HOST PROFILE HELPERS
// ============================================================================

interface HostProfile {
  hostId: string;
  email: string;
  firstName?: string;
  lastName?: string;
  preferredLanguage?: string;
}

async function getHostProfile(hostId: string): Promise<HostProfile | null> {
  const result = await docClient.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: {
        pk: `HOST#${hostId}`,
        sk: 'META',
      },
    })
  );

  return (result.Item as HostProfile) || null;
}

function getHostName(host: HostProfile): string {
  if (host.firstName && host.lastName) {
    return `${host.firstName} ${host.lastName}`;
  }
  if (host.firstName) {
    return host.firstName;
  }
  return 'Host';
}

function normalizeLanguage(lang?: string): 'en' | 'sr' {
  if (!lang) return 'sr';
  const normalized = lang.toLowerCase();
  return normalized === 'en' ? 'en' : 'sr';
}

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client, {
  marshallOptions: { removeUndefinedValues: true },
});

const TABLE_NAME = process.env.TABLE_NAME!;

// ============================================================================
// EVENT DATA TYPES
// ============================================================================

/**
 * Common data structure for subscription events
 * Both Stripe webhooks and dev simulator map their data to this format
 */
export interface SubscriptionEventData {
  // Identifiers
  hostId: string;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  
  // Plan info
  planId: string;
  priceId?: string;
  
  // Status
  status: SubscriptionStatus;
  
  // Billing period
  currentPeriodStart: string;  // ISO date
  currentPeriodEnd: string;    // ISO date
  
  // Cancellation
  cancelAtPeriodEnd: boolean;
  cancelledAt?: string;
  
  // Trial
  trialStart?: string;
  trialEnd?: string;
  
  // For plan changes
  previousPlanId?: string;
  previousTokens?: number;
}

export interface PaymentEventData {
  hostId: string;
  stripeSubscriptionId?: string;
  stripeInvoiceId?: string;
  
  // Payment result
  paid: boolean;
  amountPaid?: number;
  currency?: string;
  
  // Period this payment covers
  periodStart: string;
  periodEnd: string;
}

export interface CancellationEventData {
  hostId: string;
  stripeSubscriptionId?: string;
  
  // Was this an immediate cancellation or at period end?
  cancelledImmediately: boolean;
  cancelledAt: string;
  
  // If not immediate, when does it end?
  periodEnd?: string;
}

// ============================================================================
// CHECKOUT SESSION DATA (from Stripe Pricing Table)
// ============================================================================

export interface CheckoutSessionData {
  // From client_reference_id (set in Pricing Table embed)
  hostId: string;
  
  // Stripe IDs
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  
  // Session details
  sessionId: string;
  customerEmail?: string;
  
  // Optional: Full subscription details fetched from Stripe API
  // If provided, we create the complete subscription record immediately
  // rather than waiting for customer.subscription.created event
  subscriptionDetails?: {
    planId: string;
    priceId: string;
    status: SubscriptionStatus;
    currentPeriodStart: string;
    currentPeriodEnd: string;
    adSlots: number;
    // Trial period info (if applicable)
    trialStart?: string;
    trialEnd?: string;
  };
}

// ============================================================================
// CUSTOMER DELETED DATA
// ============================================================================

export interface CustomerDeletedEventData {
  hostId: string;
  stripeCustomerId: string;
}

// ============================================================================
// EVENT RESULT TYPES
// ============================================================================

export interface EventResult {
  success: boolean;
  action: string;
  details?: Record<string, any>;
  error?: string;
}

// ============================================================================
// CHECKOUT SESSION COMPLETED (Stripe Pricing Table)
// ============================================================================

/**
 * Handle checkout session completed
 * Called when:
 * - Stripe: checkout.session.completed
 * 
 * This is the AUTHORITATIVE handler for new subscriptions.
 * It creates the complete subscription record with details fetched from Stripe API.
 * 
 * The customer.subscription.created event may arrive before or after this,
 * but this handler ensures we have a complete record regardless of event ordering.
 */
export async function handleCheckoutCompleted(
  data: CheckoutSessionData
): Promise<EventResult> {
  console.log('📥 handleCheckoutCompleted:', { 
    hostId: data.hostId, 
    stripeCustomerId: data.stripeCustomerId,
    sessionId: data.sessionId,
    hasSubscriptionDetails: !!data.subscriptionDetails,
  });

  try {
    // Check if host already has a subscription record
    const existingSubscription = await getHostSubscription(data.hostId);
    const now = new Date().toISOString();

    if (existingSubscription && existingSubscription.status !== 'INCOMPLETE') {
      // Update existing ACTIVE subscription with Stripe customer ID (re-subscription case)
      await docClient.send(
        new UpdateCommand({
          TableName: TABLE_NAME,
          Key: {
            pk: buildHostSubscriptionPK(data.hostId),
            sk: buildHostSubscriptionSK(),
          },
          UpdateExpression: `
            SET stripeCustomerId = :customerId,
                stripeSubscriptionId = :subscriptionId,
                gsi7pk = :gsi7pk,
                gsi7sk = :gsi7sk,
                updatedAt = :now
          `,
          ExpressionAttributeValues: {
            ':customerId': data.stripeCustomerId,
            ':subscriptionId': data.stripeSubscriptionId,
            ':gsi7pk': `STRIPE_CUSTOMER#${data.stripeCustomerId}`,
            ':gsi7sk': 'SUBSCRIPTION',
            ':now': now,
          },
        })
      );

      console.log(`✅ Linked Stripe customer ${data.stripeCustomerId} to existing subscription for host ${data.hostId}`);
      
      return {
        success: true,
        action: 'CHECKOUT_COMPLETED',
        details: {
          hostId: data.hostId,
          stripeCustomerId: data.stripeCustomerId,
          stripeSubscriptionId: data.stripeSubscriptionId,
          sessionId: data.sessionId,
          hadExistingSubscription: true,
        },
      };
    }

    // Create full subscription record with details from Stripe API (if provided)
    // This eliminates the race condition with customer.subscription.created
    const subDetails = data.subscriptionDetails;
    
    const subscription: HostSubscription = {
      pk: buildHostSubscriptionPK(data.hostId),
      sk: buildHostSubscriptionSK(),
      
      hostId: data.hostId,
      planId: subDetails?.planId || 'pending',
      priceId: subDetails?.priceId || '',
      
      status: subDetails?.status || 'INCOMPLETE',
      totalTokens: subDetails?.adSlots || 0,
      
      stripeCustomerId: data.stripeCustomerId,
      stripeSubscriptionId: data.stripeSubscriptionId,
      
      currentPeriodStart: subDetails?.currentPeriodStart || now,
      currentPeriodEnd: subDetails?.currentPeriodEnd || now,
      
      cancelAtPeriodEnd: false,
      cancelledAt: null,
      
      // Trial period info (from Stripe subscription if applicable)
      trialStart: subDetails?.trialStart || null,
      trialEnd: subDetails?.trialEnd || null,
      
      startedAt: existingSubscription?.startedAt || now,
      
      gsi4pk: `SUBSCRIPTION_STATUS#${subDetails?.status || 'INCOMPLETE'}`,
      gsi4sk: subDetails?.currentPeriodEnd || now,
      
      gsi7pk: `STRIPE_CUSTOMER#${data.stripeCustomerId}`,
      gsi7sk: 'SUBSCRIPTION',
      
      createdAt: existingSubscription?.createdAt || now,
      updatedAt: now,
    };

    await saveHostSubscription(subscription);

    const logMessage = subDetails 
      ? `✅ Created COMPLETE subscription record for host ${data.hostId} (${subDetails.planId}, ${subDetails.adSlots} slots)`
      : `✅ Created initial subscription record for host ${data.hostId} (waiting for subscription details)`;
    console.log(logMessage);

    // Send welcome email if we have complete subscription details
    if (subDetails) {
      try {
        const host = await getHostProfile(data.hostId);
        if (host?.email) {
          const language = normalizeLanguage(host.preferredLanguage);
          const hostName = getHostName(host);
          
          const billingPeriodEnd = new Date(subDetails.currentPeriodEnd);
          const billingPeriodFormatted = billingPeriodEnd.toLocaleDateString(language === 'sr' ? 'sr-Latn' : 'en-GB', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
          });
          
          const baseUrl = process.env.FRONTEND_URL || 'https://localstays.rs';
          const subscriptionUrl = `${baseUrl}/host/subscription`;
          
          await sendSubscriptionWelcomeEmail(
            host.email,
            language,
            hostName,
            subDetails.planId,
            subDetails.adSlots,
            'MONTHLY',
            billingPeriodFormatted,
            subscriptionUrl
          );
          console.log(`📧 Welcome email sent to ${host.email}`);
        }
      } catch (emailError) {
        console.error('Failed to send welcome email:', emailError);
      }
    }

    return {
      success: true,
      action: 'CHECKOUT_COMPLETED',
      details: {
        hostId: data.hostId,
        stripeCustomerId: data.stripeCustomerId,
        stripeSubscriptionId: data.stripeSubscriptionId,
        sessionId: data.sessionId,
        hadExistingSubscription: !!existingSubscription,
        subscriptionComplete: !!subDetails,
        planId: subDetails?.planId,
        adSlots: subDetails?.adSlots,
      },
    };
  } catch (error) {
    console.error('❌ handleCheckoutCompleted error:', error);
    return {
      success: false,
      action: 'CHECKOUT_COMPLETED',
      error: (error as Error).message,
    };
  }
}

// ============================================================================
// SUBSCRIPTION CREATED
// ============================================================================

/**
 * Handle new subscription creation
 * Called when:
 * - Stripe: customer.subscription.created
 * - Dev: simulate-signup
 */
export async function handleSubscriptionCreated(
  data: SubscriptionEventData
): Promise<EventResult> {
  console.log('📥 handleSubscriptionCreated:', { hostId: data.hostId, planId: data.planId, priceId: data.priceId });

  try {
    // Try to get plan info - first by Stripe price ID, then by legacy planId
    let adSlots = 0;
    let planName = data.planId;

    // If planId looks like a Stripe price ID (starts with 'price_'), look it up
    if (data.planId.startsWith('price_') || data.priceId?.startsWith('price_')) {
      const stripePriceId = data.priceId || data.planId;
      const planInfo = await getPlanInfoByStripePriceId(stripePriceId);
      
      if (planInfo) {
        adSlots = planInfo.adSlots;
        planName = planInfo.name;
        console.log('✅ Found plan info by Stripe price ID:', planInfo);
      } else {
        console.warn(`⚠️ No plan info found for Stripe price ${stripePriceId} - subscription will have 0 tokens until synced`);
        // Don't fail - allow subscription to be created, admin can sync plans later
      }
    } else {
      // Try legacy plan lookup
      const plan = await getSubscriptionPlan(data.planId);
      if (plan) {
        adSlots = plan.adSlots;
        planName = plan.displayName;
      } else {
        console.warn(`⚠️ No plan found for ${data.planId} - subscription will have 0 tokens until synced`);
      }
    }

    // Check for existing subscription
    const existingSubscription = await getHostSubscription(data.hostId);
    
    // Check for existing active slots (from free trial or previous subscription)
    const existingSlots = await getHostSlots(data.hostId);
    const activeSlotCount = existingSlots.length;

    // Create the subscription record
    const now = new Date().toISOString();
    const stripeCustomerId = data.stripeCustomerId || null;
    
    const subscription: HostSubscription = {
      pk: buildHostSubscriptionPK(data.hostId),
      sk: buildHostSubscriptionSK(),
      
      hostId: data.hostId,
      planId: planName, // Use resolved plan name
      priceId: data.priceId || data.planId,
      
      status: data.status,
      totalTokens: adSlots,
      
      stripeCustomerId: stripeCustomerId,
      stripeSubscriptionId: data.stripeSubscriptionId || null,
      
      currentPeriodStart: data.currentPeriodStart,
      currentPeriodEnd: data.currentPeriodEnd,
      
      cancelAtPeriodEnd: data.cancelAtPeriodEnd,
      cancelledAt: data.cancelledAt || null,
      
      trialStart: data.trialStart || null,
      trialEnd: data.trialEnd || null,
      
      startedAt: existingSubscription?.startedAt || now,
      
      // GSI4: Query by subscription status
      gsi4pk: `SUBSCRIPTION_STATUS#${data.status}`,
      gsi4sk: data.currentPeriodEnd,
      
      // GSI7: Query by Stripe Customer ID (for EventBridge handler lookups)
      gsi7pk: stripeCustomerId ? `STRIPE_CUSTOMER#${stripeCustomerId}` : null,
      gsi7sk: stripeCustomerId ? 'SUBSCRIPTION' : null,
      
      createdAt: existingSubscription?.createdAt || now,
      updatedAt: now,
    };

    await saveHostSubscription(subscription);

    // If there are existing slots, extend them to the new period end
    if (activeSlotCount > 0) {
      const extendedCount = await extendSlotsAtRenewal(data.hostId, data.currentPeriodEnd);
      console.log(`Extended ${extendedCount} existing slots to new period end`);
    }

    console.log(`✅ Subscription created for host ${data.hostId}`, {
      planId: planName,
      priceId: data.priceId,
      tokens: adSlots,
      status: data.status,
      existingSlotsExtended: activeSlotCount,
    });

    // Send welcome email
    try {
      const host = await getHostProfile(data.hostId);
      if (host?.email) {
        const language = normalizeLanguage(host.preferredLanguage);
        const hostName = getHostName(host);
        
        // Format billing period for email
        const billingPeriodEnd = new Date(data.currentPeriodEnd);
        const billingPeriodFormatted = billingPeriodEnd.toLocaleDateString(language === 'sr' ? 'sr-Latn' : 'en-GB', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        });
        
        // Build subscription URL for the email
        const baseUrl = process.env.FRONTEND_URL || 'https://localstays.rs';
        const subscriptionUrl = `${baseUrl}/host/subscription`;
        
        await sendSubscriptionWelcomeEmail(
          host.email,
          language,
          hostName,
          planName,
          adSlots,
          'MONTHLY', // TODO: Get actual billing period from plan
          billingPeriodFormatted,
          subscriptionUrl
        );
        console.log(`📧 Welcome email sent to ${host.email}`);
      }
    } catch (emailError) {
      console.error('Failed to send welcome email:', emailError);
      // Don't fail the whole operation if email fails
    }

    return {
      success: true,
      action: 'SUBSCRIPTION_CREATED',
      details: {
        hostId: data.hostId,
        planId: planName,
        priceId: data.priceId,
        tokens: adSlots,
        status: data.status,
        periodEnd: data.currentPeriodEnd,
        existingSlotsExtended: activeSlotCount,
      },
    };
  } catch (error) {
    console.error('❌ handleSubscriptionCreated error:', error);
    return {
      success: false,
      action: 'SUBSCRIPTION_CREATED',
      error: (error as Error).message,
    };
  }
}

// ============================================================================
// PAYMENT SUCCEEDED (RENEWAL)
// ============================================================================

/**
 * Handle successful payment / subscription renewal
 * Called when:
 * - Stripe: invoice.paid (for subscription invoices)
 * - Dev: simulate-payment
 */
export async function handlePaymentSucceeded(
  data: PaymentEventData
): Promise<EventResult> {
  console.log('📥 handlePaymentSucceeded:', { hostId: data.hostId });

  try {
    // Get current subscription
    const subscription = await getHostSubscription(data.hostId);
    if (!subscription) {
      return {
        success: false,
        action: 'PAYMENT_SUCCEEDED',
        error: `No subscription found for host: ${data.hostId}`,
      };
    }

    const now = new Date().toISOString();

    // Update subscription with new period dates
    await docClient.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: {
          pk: buildHostSubscriptionPK(data.hostId),
          sk: buildHostSubscriptionSK(),
        },
        UpdateExpression: `
          SET #status = :status,
              currentPeriodStart = :periodStart,
              currentPeriodEnd = :periodEnd,
              updatedAt = :now
        `,
        ExpressionAttributeNames: {
          '#status': 'status',
        },
        ExpressionAttributeValues: {
          ':status': 'ACTIVE' as SubscriptionStatus,
          ':periodStart': data.periodStart,
          ':periodEnd': data.periodEnd,
          ':now': now,
        },
      })
    );

    // Extend all active slots (that aren't marked doNotRenew) to new period end
    const extendedCount = await extendSlotsAtRenewal(data.hostId, data.periodEnd);

    // Clear any past_due flags on slots
    if (subscription.status === 'PAST_DUE') {
      await markHostSlotsPastDue(data.hostId, false);
    }

    console.log(`✅ Payment succeeded for host ${data.hostId}`, {
      newPeriodEnd: data.periodEnd,
      slotsExtended: extendedCount,
    });

    // Send renewal email (only for actual renewals, not initial payments)
    // This function is only called for subscription_cycle billing reason
    try {
      const host = await getHostProfile(data.hostId);
      if (host) {
        const hostName = getHostName(host);
        const language = host.preferredLanguage || 'sr';
        const baseUrl = process.env.FRONTEND_URL || 'https://localstays.rs';
        const subscriptionUrl = `${baseUrl}/host/subscription`;
        
        await sendSubscriptionRenewedEmail(
          host.email,
          language,
          hostName,
          subscription.planId,
          subscription.totalTokens,
          data.periodEnd,
          subscriptionUrl
        );
        console.log(`📧 Subscription renewed email sent to ${host.email}`);
      }
    } catch (emailError) {
      console.error('Failed to send subscription renewed email:', emailError);
    }

    return {
      success: true,
      action: 'PAYMENT_SUCCEEDED',
      details: {
        hostId: data.hostId,
        periodStart: data.periodStart,
        periodEnd: data.periodEnd,
        slotsExtended: extendedCount,
      },
    };
  } catch (error) {
    console.error('❌ handlePaymentSucceeded error:', error);
    return {
      success: false,
      action: 'PAYMENT_SUCCEEDED',
      error: (error as Error).message,
    };
  }
}

// ============================================================================
// PAYMENT FAILED
// ============================================================================

/**
 * Handle failed payment
 * Called when:
 * - Stripe: invoice.payment_failed
 * - Dev: simulate-payment-failed
 */
export async function handlePaymentFailed(
  data: PaymentEventData
): Promise<EventResult> {
  console.log('📥 handlePaymentFailed:', { hostId: data.hostId });

  try {
    // Get current subscription
    const subscription = await getHostSubscription(data.hostId);
    if (!subscription) {
      return {
        success: false,
        action: 'PAYMENT_FAILED',
        error: `No subscription found for host: ${data.hostId}`,
      };
    }

    const now = new Date().toISOString();

    // Update subscription status to PAST_DUE
    await docClient.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: {
          pk: buildHostSubscriptionPK(data.hostId),
          sk: buildHostSubscriptionSK(),
        },
        UpdateExpression: 'SET #status = :status, updatedAt = :now',
        ExpressionAttributeNames: {
          '#status': 'status',
        },
        ExpressionAttributeValues: {
          ':status': 'PAST_DUE' as SubscriptionStatus,
          ':now': now,
        },
      })
    );

    // Mark all slots as past_due (they stay live during grace period but can't publish new ones)
    await markHostSlotsPastDue(data.hostId, true);

    console.log(`⚠️ Payment failed for host ${data.hostId} - subscription now PAST_DUE`);

    // Send payment failed email
    try {
      const host = await getHostProfile(data.hostId);
      if (host?.email) {
        const language = normalizeLanguage(host.preferredLanguage);
        const hostName = getHostName(host);
        
        // Build customer portal URL for the email
        const customerPortalUrl = 'https://billing.stripe.com/p/login/test_cN2eUC8KR2iVcJa8ww'; // TODO: Get from config
        
        await sendPaymentFailedEmail(
          host.email,
          language,
          hostName,
          customerPortalUrl
        );
        console.log(`📧 Payment failed email sent to ${host.email}`);
      }
    } catch (emailError) {
      console.error('Failed to send payment failed email:', emailError);
    }

    return {
      success: true,
      action: 'PAYMENT_FAILED',
      details: {
        hostId: data.hostId,
        newStatus: 'PAST_DUE',
      },
    };
  } catch (error) {
    console.error('❌ handlePaymentFailed error:', error);
    return {
      success: false,
      action: 'PAYMENT_FAILED',
      error: (error as Error).message,
    };
  }
}

// ============================================================================
// SUBSCRIPTION UPDATED (PLAN CHANGE)
// ============================================================================

/**
 * Handle subscription update (plan change, etc.)
 * Called when:
 * - Stripe: customer.subscription.updated
 * - Dev: simulate-plan-change
 */
export async function handleSubscriptionUpdated(
  data: SubscriptionEventData
): Promise<EventResult> {
  console.log('📥 handleSubscriptionUpdated:', { hostId: data.hostId, planId: data.planId, priceId: data.priceId });

  try {
    // Try to get plan info - first by Stripe price ID, then by legacy planId
    let adSlots = 0;
    let planName = data.planId;

    if (data.planId.startsWith('price_') || data.priceId?.startsWith('price_')) {
      const stripePriceId = data.priceId || data.planId;
      const planInfo = await getPlanInfoByStripePriceId(stripePriceId);
      
      if (planInfo) {
        adSlots = planInfo.adSlots;
        planName = planInfo.name;
      } else {
        console.warn(`⚠️ No plan info found for Stripe price ${stripePriceId}`);
      }
    } else {
      const plan = await getSubscriptionPlan(data.planId);
      if (plan) {
        adSlots = plan.adSlots;
        planName = plan.displayName;
      }
    }

    // Get current subscription
    const subscription = await getHostSubscription(data.hostId);
    if (!subscription) {
      return {
        success: false,
        action: 'SUBSCRIPTION_UPDATED',
        error: `No subscription found for host: ${data.hostId}`,
      };
    }

    const now = new Date().toISOString();
    const isUpgrade = adSlots > (data.previousTokens || subscription.totalTokens);
    const isDowngrade = adSlots < (data.previousTokens || subscription.totalTokens);

    // Check if period end has changed (plan change resets billing cycle)
    const periodEndChanged = subscription.currentPeriodEnd !== data.currentPeriodEnd;
    
    // Check if this is a trial-to-paid conversion
    const wasTrialing = subscription.status === 'TRIALING';
    const isNowActive = data.status === 'ACTIVE';
    const trialConverted = wasTrialing && isNowActive;
    
    if (trialConverted) {
      console.log(`🎉 Trial converted to paid subscription for host ${data.hostId}`);
    }

    // Update subscription
    // Clear trial dates when trial converts to paid (status changes from TRIALING to ACTIVE)
    await docClient.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: {
          pk: buildHostSubscriptionPK(data.hostId),
          sk: buildHostSubscriptionSK(),
        },
        UpdateExpression: `
          SET planId = :planId,
              priceId = :priceId,
              #status = :status,
              totalTokens = :tokens,
              currentPeriodStart = :periodStart,
              currentPeriodEnd = :periodEnd,
              cancelAtPeriodEnd = :cancelAtPeriodEnd,
              cancelledAt = :cancelledAt,
              trialStart = :trialStart,
              trialEnd = :trialEnd,
              updatedAt = :now
        `,
        ExpressionAttributeNames: {
          '#status': 'status',
        },
        ExpressionAttributeValues: {
          ':planId': planName,
          ':priceId': data.priceId || subscription.priceId,
          ':status': data.status,
          ':tokens': adSlots,
          ':periodStart': data.currentPeriodStart,
          ':periodEnd': data.currentPeriodEnd,
          ':cancelAtPeriodEnd': data.cancelAtPeriodEnd,
          ':cancelledAt': data.cancelledAt || null,
          // Clear trial dates when trial converts to paid, otherwise preserve them
          ':trialStart': trialConverted ? null : (subscription.trialStart || null),
          ':trialEnd': trialConverted ? null : (subscription.trialEnd || null),
          ':now': now,
        },
      })
    );

    // If period end changed (plan change), update active slots to the new period end
    // This handles both upgrades (longer period) AND downgrades (shorter period)
    // because with pro-rata billing, the host has paid for the new billing cycle
    let slotsUpdated = 0;
    if (periodEndChanged && data.currentPeriodEnd) {
      slotsUpdated = await updateSlotsToNewPeriod(data.hostId, data.currentPeriodEnd);
      console.log(`📅 Updated ${slotsUpdated} slots to new period end: ${data.currentPeriodEnd}`);
    }

    // For upgrades with more tokens, they're available immediately
    // For downgrades, the reduced token count takes effect at next renewal
    // (handled by the slot expiry process)

    console.log(`✅ Subscription updated for host ${data.hostId}`, {
      planId: planName,
      tokens: adSlots,
      isUpgrade,
      isDowngrade,
      periodEndChanged,
      slotsUpdated,
      newPeriodEnd: data.currentPeriodEnd,
      cancelAtPeriodEnd: data.cancelAtPeriodEnd,
      cancelledAt: data.cancelledAt,
      trialConverted,
    });

    // Send trial converted email if applicable
    if (trialConverted) {
      try {
        const host = await getHostProfile(data.hostId);
        if (host) {
          const hostName = getHostName(host);
          const language = host.preferredLanguage || 'sr';
          const baseUrl = process.env.FRONTEND_URL || 'https://localstays.rs';
          const subscriptionUrl = `${baseUrl}/host/subscription`;
          
          await sendTrialConvertedEmail(
            host.email,
            language,
            hostName,
            planName,
            adSlots,
            data.currentPeriodEnd,
            subscriptionUrl
          );
          console.log(`📧 Trial converted email sent to ${host.email}`);
        }
      } catch (emailError) {
        console.error('Failed to send trial converted email:', emailError);
      }
    }

    return {
      success: true,
      action: 'SUBSCRIPTION_UPDATED',
      details: {
        hostId: data.hostId,
        planId: planName,
        tokens: adSlots,
        isUpgrade,
        isDowngrade,
        periodEndChanged,
        slotsUpdated,
        newPeriodEnd: data.currentPeriodEnd,
        previousPlanId: data.previousPlanId,
        previousTokens: data.previousTokens,
        trialConverted,
      },
    };
  } catch (error) {
    console.error('❌ handleSubscriptionUpdated error:', error);
    return {
      success: false,
      action: 'SUBSCRIPTION_UPDATED',
      error: (error as Error).message,
    };
  }
}

// ============================================================================
// SUBSCRIPTION CANCELLED
// ============================================================================

/**
 * Handle subscription cancellation
 * Called when:
 * - Stripe: customer.subscription.deleted
 * - Dev: simulate-cancellation
 */
export async function handleSubscriptionCancelled(
  data: CancellationEventData
): Promise<EventResult> {
  console.log('📥 handleSubscriptionCancelled:', { 
    hostId: data.hostId, 
    immediate: data.cancelledImmediately 
  });

  try {
    // Get current subscription
    const subscription = await getHostSubscription(data.hostId);
    if (!subscription) {
      return {
        success: false,
        action: 'SUBSCRIPTION_CANCELLED',
        error: `No subscription found for host: ${data.hostId}`,
      };
    }

    const now = new Date().toISOString();

    if (data.cancelledImmediately) {
      // Immediate cancellation - subscription ends now
      // Use ConditionExpression to prevent creating a new record if it was deleted
      try {
        await docClient.send(
          new UpdateCommand({
            TableName: TABLE_NAME,
            Key: {
              pk: buildHostSubscriptionPK(data.hostId),
              sk: buildHostSubscriptionSK(),
            },
            UpdateExpression: `
              SET #status = :status,
                  cancelledAt = :cancelledAt,
                  cancelAtPeriodEnd = :cancelAtPeriodEnd,
                  updatedAt = :now
            `,
            ConditionExpression: 'attribute_exists(pk)', // Only update if record exists
            ExpressionAttributeNames: {
              '#status': 'status',
            },
            ExpressionAttributeValues: {
              ':status': 'CANCELLED' as SubscriptionStatus,
              ':cancelledAt': data.cancelledAt,
              ':cancelAtPeriodEnd': false,
              ':now': now,
            },
          })
        );
      } catch (conditionError: any) {
        if (conditionError.name === 'ConditionalCheckFailedException') {
          // Record was deleted (likely by customer.deleted event) - this is fine
          console.log(`ℹ️ Subscription record no longer exists for host ${data.hostId} - likely deleted by customer.deleted event`);
          return {
            success: true,
            action: 'SUBSCRIPTION_CANCELLED',
            details: {
              hostId: data.hostId,
              note: 'Record already deleted',
            },
          };
        }
        throw conditionError;
      }

      // Mark all slots for immediate expiry
      await markSlotsForImmediateExpiry(data.hostId);

      console.log(`🛑 Subscription immediately cancelled for host ${data.hostId}`);
    } else {
      // Cancel at period end - subscription stays active until period end
      // Use ConditionExpression to prevent creating a new record if it was deleted
      try {
        await docClient.send(
          new UpdateCommand({
            TableName: TABLE_NAME,
            Key: {
              pk: buildHostSubscriptionPK(data.hostId),
              sk: buildHostSubscriptionSK(),
            },
            UpdateExpression: `
              SET cancelAtPeriodEnd = :cancelAtPeriodEnd,
                  cancelledAt = :cancelledAt,
                  updatedAt = :now
            `,
            ConditionExpression: 'attribute_exists(pk)', // Only update if record exists
            ExpressionAttributeValues: {
              ':cancelAtPeriodEnd': true,
              ':cancelledAt': data.cancelledAt,
              ':now': now,
            },
          })
        );

        console.log(`⏳ Subscription will cancel at period end for host ${data.hostId}`, {
          periodEnd: data.periodEnd,
        });
      } catch (conditionError: any) {
        if (conditionError.name === 'ConditionalCheckFailedException') {
          // Record was deleted (likely by customer.deleted event) - this is fine
          console.log(`ℹ️ Subscription record no longer exists for host ${data.hostId} - likely deleted by customer.deleted event`);
          return {
            success: true,
            action: 'SUBSCRIPTION_CANCELLED',
            details: {
              hostId: data.hostId,
              note: 'Record already deleted',
            },
          };
        }
        throw conditionError;
      }
    }

    // Send cancellation email
    try {
      const host = await getHostProfile(data.hostId);
      if (host?.email) {
        const language = normalizeLanguage(host.preferredLanguage);
        const hostName = getHostName(host);
        
        // Format period end date for email
        const periodEndDate = data.periodEnd 
          ? new Date(data.periodEnd).toLocaleDateString(language === 'sr' ? 'sr-Latn' : 'en-GB', {
              year: 'numeric',
              month: 'long',
              day: 'numeric',
            })
          : 'N/A';
        
        await sendSubscriptionCancelledEmail(
          host.email,
          language,
          hostName,
          periodEndDate
        );
        console.log(`📧 Subscription cancelled email sent to ${host.email}`);
      }
    } catch (emailError) {
      console.error('Failed to send cancellation email:', emailError);
    }

    return {
      success: true,
      action: 'SUBSCRIPTION_CANCELLED',
      details: {
        hostId: data.hostId,
        immediate: data.cancelledImmediately,
        cancelledAt: data.cancelledAt,
        periodEnd: data.periodEnd,
      },
    };
  } catch (error) {
    console.error('❌ handleSubscriptionCancelled error:', error);
    return {
      success: false,
      action: 'SUBSCRIPTION_CANCELLED',
      error: (error as Error).message,
    };
  }
}

// ============================================================================
// SUBSCRIPTION REACTIVATED
// ============================================================================

/**
 * Handle subscription reactivation (user uncancels before period end)
 * Called when:
 * - Stripe: customer.subscription.updated (cancel_at_period_end: false)
 * - Dev: Could be part of simulate-plan-change
 */
export async function handleSubscriptionReactivated(
  data: SubscriptionEventData
): Promise<EventResult> {
  console.log('📥 handleSubscriptionReactivated:', { hostId: data.hostId });

  try {
    const now = new Date().toISOString();

    await docClient.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: {
          pk: buildHostSubscriptionPK(data.hostId),
          sk: buildHostSubscriptionSK(),
        },
        UpdateExpression: `
          SET #status = :status,
              cancelAtPeriodEnd = :cancelAtPeriodEnd,
              cancelledAt = :cancelledAt,
              updatedAt = :now
        `,
        ExpressionAttributeNames: {
          '#status': 'status',
        },
        ExpressionAttributeValues: {
          ':status': 'ACTIVE' as SubscriptionStatus,
          ':cancelAtPeriodEnd': false,
          ':cancelledAt': null,
          ':now': now,
        },
      })
    );

    console.log(`✅ Subscription reactivated for host ${data.hostId}`);

    return {
      success: true,
      action: 'SUBSCRIPTION_REACTIVATED',
      details: {
        hostId: data.hostId,
      },
    };
  } catch (error) {
    console.error('❌ handleSubscriptionReactivated error:', error);
    return {
      success: false,
      action: 'SUBSCRIPTION_REACTIVATED',
      error: (error as Error).message,
    };
  }
}

// ============================================================================
// TRIAL ENDING SOON
// ============================================================================

/**
 * Handle trial ending notification
 * Called when:
 * - Stripe: customer.subscription.trial_will_end
 * - Dev: Not typically simulated, but could be
 */
export async function handleTrialEndingSoon(
  data: SubscriptionEventData
): Promise<EventResult> {
  console.log('📥 handleTrialEndingSoon:', { hostId: data.hostId, trialEnd: data.trialEnd });

  // This is mainly for sending notifications - the actual trial end
  // is handled by the subscription update when it transitions to active
  
  // TODO: Send email/push notification about trial ending

  return {
    success: true,
    action: 'TRIAL_ENDING_SOON',
    details: {
      hostId: data.hostId,
      trialEnd: data.trialEnd,
    },
  };
}

// ============================================================================
// CUSTOMER DELETED
// ============================================================================

/**
 * Handle Stripe customer deletion
 * Called when:
 * - Stripe: customer.deleted
 * 
 * This completely removes the subscription record as if it never existed.
 * Use case: Customer requests data deletion, or admin cleanup.
 */
export async function handleCustomerDeleted(
  data: CustomerDeletedEventData
): Promise<EventResult> {
  console.log('📥 handleCustomerDeleted:', { 
    hostId: data.hostId, 
    stripeCustomerId: data.stripeCustomerId,
  });

  try {
    // Delete the subscription record entirely
    await docClient.send(
      new DeleteCommand({
        TableName: TABLE_NAME,
        Key: {
          pk: buildHostSubscriptionPK(data.hostId),
          sk: buildHostSubscriptionSK(),
        },
      })
    );

    console.log(`🗑️ Subscription record deleted for host ${data.hostId}`);

    return {
      success: true,
      action: 'CUSTOMER_DELETED',
      details: {
        hostId: data.hostId,
        stripeCustomerId: data.stripeCustomerId,
      },
    };
  } catch (error) {
    console.error('❌ handleCustomerDeleted error:', error);
    return {
      success: false,
      action: 'CUSTOMER_DELETED',
      error: (error as Error).message,
    };
  }
}

