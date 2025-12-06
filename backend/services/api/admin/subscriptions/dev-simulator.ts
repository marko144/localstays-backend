/**
 * Dev Subscription Simulator
 * 
 * Admin endpoints for simulating Stripe subscription events in staging/dev environments.
 * These endpoints allow testing the full subscription flow without Stripe integration.
 * 
 * IMPORTANT: These should only be deployed in non-production environments!
 * 
 * Endpoints:
 * - POST /admin/dev/subscriptions/{hostId}/simulate-signup
 * - POST /admin/dev/subscriptions/{hostId}/simulate-payment
 * - POST /admin/dev/subscriptions/{hostId}/simulate-payment-failed
 * - POST /admin/dev/subscriptions/{hostId}/simulate-plan-change
 * - POST /admin/dev/subscriptions/{hostId}/simulate-cancellation
 * - PUT  /admin/dev/subscriptions/{hostId}/update-dates
 */

import { APIGatewayProxyHandler, APIGatewayProxyResult } from 'aws-lambda';
import { requirePermission } from '../../lib/auth-middleware';
import {
  handleSubscriptionCreated,
  handleSubscriptionUpdated,
  handleSubscriptionCancelled,
  handlePaymentSucceeded,
  handlePaymentFailed,
  SubscriptionEventData,
  PaymentEventData,
  CancellationEventData,
} from '../../../lib/subscription-events';
import {
  getHostSubscription,
  getSubscriptionPlan,
  updateHostSubscription,
} from '../../../lib/subscription-service';

const STAGE = process.env.STAGE || 'dev';

/**
 * Check if we're in a dev/staging environment
 */
function isDevEnvironment(): boolean {
  return STAGE !== 'prod' && STAGE !== 'production';
}

/**
 * Standard response helper
 */
function jsonResponse(statusCode: number, body: any): APIGatewayProxyResult {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
    body: JSON.stringify(body),
  };
}

// ============================================================================
// SIMULATE SIGNUP
// ============================================================================

/**
 * POST /admin/dev/subscriptions/{hostId}/simulate-signup
 * 
 * Simulates a host signing up for a subscription plan.
 * 
 * Body:
 * {
 *   planId: string,
 *   withTrial?: boolean,
 *   trialDays?: number
 * }
 */
export const simulateSignup: APIGatewayProxyHandler = async (event) => {
  console.log('Dev Simulator: simulate-signup');

  // Check environment
  if (!isDevEnvironment()) {
    return jsonResponse(403, {
      success: false,
      error: { code: 'FORBIDDEN', message: 'Dev simulator only available in non-production environments' },
    });
  }

  // Check admin permission
  const authResult = requirePermission(event, 'ADMIN_SUBSCRIPTION_MANAGE');
  if ('error' in authResult) {
    return authResult.error;
  }

  const hostId = event.pathParameters?.hostId;
  if (!hostId) {
    return jsonResponse(400, {
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'hostId is required' },
    });
  }

  let body: any;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return jsonResponse(400, {
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'Invalid JSON body' },
    });
  }

  const { planId, withTrial = false, trialDays = 14 } = body;

  if (!planId) {
    return jsonResponse(400, {
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'planId is required' },
    });
  }

  // Verify plan exists
  const plan = await getSubscriptionPlan(planId);
  if (!plan) {
    return jsonResponse(404, {
      success: false,
      error: { code: 'NOT_FOUND', message: `Plan not found: ${planId}` },
    });
  }

  // Calculate dates
  const now = new Date();
  const periodStart = now.toISOString();
  
  let periodEnd: Date;
  let trialEnd: string | undefined;
  let status: string;

  if (withTrial) {
    // Trial period
    const trialEndDate = new Date(now);
    trialEndDate.setDate(trialEndDate.getDate() + trialDays);
    trialEnd = trialEndDate.toISOString();
    periodEnd = trialEndDate;
    status = 'TRIALING';
  } else {
    // Regular subscription - 30 days
    periodEnd = new Date(now);
    periodEnd.setDate(periodEnd.getDate() + 30);
    status = 'ACTIVE';
  }

  const eventData: SubscriptionEventData = {
    hostId,
    stripeCustomerId: `dev_cus_${hostId}`,
    stripeSubscriptionId: `dev_sub_${Date.now()}`,
    planId,
    priceId: plan.prices[0]?.priceId,
    status: status as any,
    currentPeriodStart: periodStart,
    currentPeriodEnd: periodEnd.toISOString(),
    cancelAtPeriodEnd: false,
    trialStart: withTrial ? periodStart : undefined,
    trialEnd,
  };

  const result = await handleSubscriptionCreated(eventData);

  return jsonResponse(result.success ? 200 : 500, {
    success: result.success,
    message: result.success 
      ? `Simulated signup for plan ${planId}${withTrial ? ' with trial' : ''}`
      : result.error,
    result,
  });
};

// ============================================================================
// SIMULATE PAYMENT SUCCESS
// ============================================================================

/**
 * POST /admin/dev/subscriptions/{hostId}/simulate-payment
 * 
 * Simulates a successful payment (subscription renewal).
 * 
 * Body:
 * {
 *   extendDays?: number  // Default 30
 * }
 */
export const simulatePayment: APIGatewayProxyHandler = async (event) => {
  console.log('Dev Simulator: simulate-payment');

  if (!isDevEnvironment()) {
    return jsonResponse(403, {
      success: false,
      error: { code: 'FORBIDDEN', message: 'Dev simulator only available in non-production environments' },
    });
  }

  const authResult = requirePermission(event, 'ADMIN_SUBSCRIPTION_MANAGE');
  if ('error' in authResult) {
    return authResult.error;
  }

  const hostId = event.pathParameters?.hostId;
  if (!hostId) {
    return jsonResponse(400, {
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'hostId is required' },
    });
  }

  // Check subscription exists
  const subscription = await getHostSubscription(hostId);
  if (!subscription) {
    return jsonResponse(404, {
      success: false,
      error: { code: 'NOT_FOUND', message: `No subscription found for host: ${hostId}` },
    });
  }

  let body: any;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    body = {};
  }

  const extendDays = body.extendDays || 30;

  // Calculate new period
  const now = new Date();
  const periodStart = now.toISOString();
  const periodEnd = new Date(now);
  periodEnd.setDate(periodEnd.getDate() + extendDays);

  const paymentData: PaymentEventData = {
    hostId,
    stripeSubscriptionId: subscription.stripeSubscriptionId || `dev_sub_${hostId}`,
    stripeInvoiceId: `dev_inv_${Date.now()}`,
    paid: true,
    amountPaid: 1299, // Simulated amount
    currency: 'eur',
    periodStart,
    periodEnd: periodEnd.toISOString(),
  };

  const result = await handlePaymentSucceeded(paymentData);

  return jsonResponse(result.success ? 200 : 500, {
    success: result.success,
    message: result.success 
      ? `Simulated successful payment - extended ${extendDays} days`
      : result.error,
    result,
  });
};

// ============================================================================
// SIMULATE PAYMENT FAILED
// ============================================================================

/**
 * POST /admin/dev/subscriptions/{hostId}/simulate-payment-failed
 * 
 * Simulates a failed payment (puts subscription in PAST_DUE).
 */
export const simulatePaymentFailed: APIGatewayProxyHandler = async (event) => {
  console.log('Dev Simulator: simulate-payment-failed');

  if (!isDevEnvironment()) {
    return jsonResponse(403, {
      success: false,
      error: { code: 'FORBIDDEN', message: 'Dev simulator only available in non-production environments' },
    });
  }

  const authResult = requirePermission(event, 'ADMIN_SUBSCRIPTION_MANAGE');
  if ('error' in authResult) {
    return authResult.error;
  }

  const hostId = event.pathParameters?.hostId;
  if (!hostId) {
    return jsonResponse(400, {
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'hostId is required' },
    });
  }

  // Check subscription exists
  const subscription = await getHostSubscription(hostId);
  if (!subscription) {
    return jsonResponse(404, {
      success: false,
      error: { code: 'NOT_FOUND', message: `No subscription found for host: ${hostId}` },
    });
  }

  const paymentData: PaymentEventData = {
    hostId,
    stripeSubscriptionId: subscription.stripeSubscriptionId || `dev_sub_${hostId}`,
    stripeInvoiceId: `dev_inv_${Date.now()}`,
    paid: false,
    periodStart: subscription.currentPeriodStart,
    periodEnd: subscription.currentPeriodEnd,
  };

  const result = await handlePaymentFailed(paymentData);

  return jsonResponse(result.success ? 200 : 500, {
    success: result.success,
    message: result.success 
      ? 'Simulated payment failure - subscription now PAST_DUE'
      : result.error,
    result,
  });
};

// ============================================================================
// SIMULATE PLAN CHANGE
// ============================================================================

/**
 * POST /admin/dev/subscriptions/{hostId}/simulate-plan-change
 * 
 * Simulates changing to a different plan.
 * 
 * Body:
 * {
 *   newPlanId: string
 * }
 */
export const simulatePlanChange: APIGatewayProxyHandler = async (event) => {
  console.log('Dev Simulator: simulate-plan-change');

  if (!isDevEnvironment()) {
    return jsonResponse(403, {
      success: false,
      error: { code: 'FORBIDDEN', message: 'Dev simulator only available in non-production environments' },
    });
  }

  const authResult = requirePermission(event, 'ADMIN_SUBSCRIPTION_MANAGE');
  if ('error' in authResult) {
    return authResult.error;
  }

  const hostId = event.pathParameters?.hostId;
  if (!hostId) {
    return jsonResponse(400, {
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'hostId is required' },
    });
  }

  let body: any;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return jsonResponse(400, {
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'Invalid JSON body' },
    });
  }

  const { newPlanId } = body;
  if (!newPlanId) {
    return jsonResponse(400, {
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'newPlanId is required' },
    });
  }

  // Check subscription exists
  const subscription = await getHostSubscription(hostId);
  if (!subscription) {
    return jsonResponse(404, {
      success: false,
      error: { code: 'NOT_FOUND', message: `No subscription found for host: ${hostId}` },
    });
  }

  // Verify new plan exists
  const newPlan = await getSubscriptionPlan(newPlanId);
  if (!newPlan) {
    return jsonResponse(404, {
      success: false,
      error: { code: 'NOT_FOUND', message: `Plan not found: ${newPlanId}` },
    });
  }

  // Get current plan for comparison
  const currentPlan = await getSubscriptionPlan(subscription.planId);

  const eventData: SubscriptionEventData = {
    hostId,
    stripeCustomerId: subscription.stripeCustomerId || `dev_cus_${hostId}`,
    stripeSubscriptionId: subscription.stripeSubscriptionId || `dev_sub_${hostId}`,
    planId: newPlanId,
    priceId: newPlan.prices[0]?.priceId,
    status: subscription.status,
    currentPeriodStart: subscription.currentPeriodStart,
    currentPeriodEnd: subscription.currentPeriodEnd,
    cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
    previousPlanId: subscription.planId,
    previousTokens: currentPlan?.adSlots || subscription.totalTokens,
  };

  const result = await handleSubscriptionUpdated(eventData);

  return jsonResponse(result.success ? 200 : 500, {
    success: result.success,
    message: result.success 
      ? `Simulated plan change from ${subscription.planId} to ${newPlanId}`
      : result.error,
    result,
  });
};

// ============================================================================
// SIMULATE CANCELLATION
// ============================================================================

/**
 * POST /admin/dev/subscriptions/{hostId}/simulate-cancellation
 * 
 * Simulates subscription cancellation.
 * 
 * Body:
 * {
 *   immediate?: boolean  // Default false (cancel at period end)
 * }
 */
export const simulateCancellation: APIGatewayProxyHandler = async (event) => {
  console.log('Dev Simulator: simulate-cancellation');

  if (!isDevEnvironment()) {
    return jsonResponse(403, {
      success: false,
      error: { code: 'FORBIDDEN', message: 'Dev simulator only available in non-production environments' },
    });
  }

  const authResult = requirePermission(event, 'ADMIN_SUBSCRIPTION_MANAGE');
  if ('error' in authResult) {
    return authResult.error;
  }

  const hostId = event.pathParameters?.hostId;
  if (!hostId) {
    return jsonResponse(400, {
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'hostId is required' },
    });
  }

  // Check subscription exists
  const subscription = await getHostSubscription(hostId);
  if (!subscription) {
    return jsonResponse(404, {
      success: false,
      error: { code: 'NOT_FOUND', message: `No subscription found for host: ${hostId}` },
    });
  }

  let body: any;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    body = {};
  }

  const immediate = body.immediate === true;

  const cancellationData: CancellationEventData = {
    hostId,
    stripeSubscriptionId: subscription.stripeSubscriptionId || `dev_sub_${hostId}`,
    cancelledImmediately: immediate,
    cancelledAt: new Date().toISOString(),
    periodEnd: immediate ? undefined : subscription.currentPeriodEnd,
  };

  const result = await handleSubscriptionCancelled(cancellationData);

  return jsonResponse(result.success ? 200 : 500, {
    success: result.success,
    message: result.success 
      ? immediate 
        ? 'Simulated immediate cancellation'
        : `Simulated cancellation at period end (${subscription.currentPeriodEnd})`
      : result.error,
    result,
  });
};

// ============================================================================
// UPDATE DATES (Manual date manipulation for testing)
// ============================================================================

/**
 * PUT /admin/dev/subscriptions/{hostId}/update-dates
 * 
 * Manually update subscription dates for testing scenarios.
 * 
 * Body:
 * {
 *   currentPeriodStart?: string,
 *   currentPeriodEnd?: string,
 *   trialEnd?: string
 * }
 */
export const updateDates: APIGatewayProxyHandler = async (event) => {
  console.log('Dev Simulator: update-dates');

  if (!isDevEnvironment()) {
    return jsonResponse(403, {
      success: false,
      error: { code: 'FORBIDDEN', message: 'Dev simulator only available in non-production environments' },
    });
  }

  const authResult = requirePermission(event, 'ADMIN_SUBSCRIPTION_MANAGE');
  if ('error' in authResult) {
    return authResult.error;
  }

  const hostId = event.pathParameters?.hostId;
  if (!hostId) {
    return jsonResponse(400, {
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'hostId is required' },
    });
  }

  // Check subscription exists
  const subscription = await getHostSubscription(hostId);
  if (!subscription) {
    return jsonResponse(404, {
      success: false,
      error: { code: 'NOT_FOUND', message: `No subscription found for host: ${hostId}` },
    });
  }

  let body: any;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return jsonResponse(400, {
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'Invalid JSON body' },
    });
  }

  const updates: Partial<any> = {};
  
  if (body.currentPeriodStart) {
    updates.currentPeriodStart = body.currentPeriodStart;
  }
  if (body.currentPeriodEnd) {
    updates.currentPeriodEnd = body.currentPeriodEnd;
  }
  if (body.trialEnd !== undefined) {
    updates.trialEnd = body.trialEnd;
  }
  if (body.status) {
    updates.status = body.status;
  }

  if (Object.keys(updates).length === 0) {
    return jsonResponse(400, {
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'No updates provided' },
    });
  }

  await updateHostSubscription(hostId, updates);

  return jsonResponse(200, {
    success: true,
    message: 'Subscription dates updated',
    updates,
  });
};

