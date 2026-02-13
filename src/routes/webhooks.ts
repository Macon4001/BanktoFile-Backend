import { Router, Request, Response } from 'express';
import { stripe, getFilesLimit, getFilesLimitForUser, PlanType } from '../config/stripe.js';
import { db } from '../db/postgres.js';

const router = Router();

// Type helper for Stripe subscription with period dates
interface StripeSubscriptionWithPeriod {
  current_period_start: number;
  current_period_end: number;
}

// Type helper for Stripe invoice with subscription
interface StripeInvoiceWithSubscription {
  subscription: string | { id: string };
}

// Webhook endpoint - must use raw body
router.post('/stripe', async (req: Request, res: Response) => {
  const sig = req.headers['stripe-signature'] as string;

  if (!sig) {
    return res.status(400).json({ error: 'No signature provided' });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let event: any;

  try {
    // Verify webhook signature
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET!
    );
  } catch (err) {
    console.error('Webhook signature verification failed:', err);
    return res.status(400).json({ error: 'Webhook signature verification failed' });
  }

  // Handle the event
  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const session = event.data.object as any;
        await handleCheckoutComplete(session);
        break;
      }

      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        // Handles both creation and updates (including cancel_at_period_end changes)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const subscription = event.data.object as any;
        await handleSubscriptionUpdate(subscription);
        break;
      }

      case 'customer.subscription.deleted': {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const subscription = event.data.object as any;
        await handleSubscriptionDeleted(subscription);
        break;
      }

      case 'invoice.payment_succeeded': {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const invoice = event.data.object as any;
        await handlePaymentSucceeded(invoice);
        break;
      }

      case 'invoice.payment_failed': {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const invoice = event.data.object as any;
        await handlePaymentFailed(invoice);
        break;
      }

      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    res.json({ received: true });
  } catch (error) {
    console.error('Error handling webhook:', error);
    res.status(500).json({ error: 'Webhook handler failed' });
  }
});

// Handle checkout session completed
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleCheckoutComplete(session: any) {
  try {
    console.log('[WEBHOOK] handleCheckoutComplete - session ID:', session.id);

    const userId = session.metadata?.userId || session.client_reference_id;
    const plan = session.metadata?.plan as PlanType;
    const billingInterval = session.metadata?.billingInterval || 'monthly';

    if (!userId || !plan) {
      console.error('[WEBHOOK] Missing userId or plan in checkout session');
      return;
    }

    const user = await db.getUserById(userId);
    if (!user) {
      console.error('[WEBHOOK] User not found:', userId);
      return;
    }

    console.log('[WEBHOOK] Found user:', user.email, 'plan:', plan, 'billing:', billingInterval);

    // Fetch the subscription to get period dates
    let periodStart: Date | undefined;
    let periodEnd: Date | undefined;

    if (session.subscription) {
      try {
        const subscription = await stripe.subscriptions.retrieve(session.subscription as string) as unknown as StripeSubscriptionWithPeriod;

        // Validate timestamps before creating dates
        if (subscription.current_period_start && typeof subscription.current_period_start === 'number') {
          periodStart = new Date(subscription.current_period_start * 1000);
        }
        if (subscription.current_period_end && typeof subscription.current_period_end === 'number') {
          periodEnd = new Date(subscription.current_period_end * 1000);
        }

        console.log(`[WEBHOOK] Retrieved subscription periods: ${periodStart?.toISOString()} to ${periodEnd?.toISOString()}`);
      } catch (error) {
        console.error('[WEBHOOK] Error fetching subscription from checkout session:', error);
        // Continue anyway - subscription.created webhook will set these later
      }
    }

    // Update user with customer ID and reset usage
    // New subscriptions are NOT grandfathered (is_grandfathered_basic = false by default)
    const filesLimit = getFilesLimitForUser(plan, false);
    await db.updateUser(userId, {
      stripe_customer_id: session.customer as string,
      subscription_id: session.subscription as string,
      plan: plan,
      monthly_files_limit: filesLimit, // New subscribers get current limits (30 files for basic)
      files_used_monthly: 0, // Reset file usage on new purchase
      subscription_status: 'active',
      is_grandfathered_basic: false, // New subscribers are not grandfathered
      billing_interval: billingInterval as 'monthly' | 'yearly',
      ...(periodStart && { current_period_start: periodStart }),
      ...(periodEnd && { current_period_end: periodEnd }),
    });

    console.log(`[WEBHOOK] ✅ Checkout completed for user ${userId}, plan: ${plan}, billing: ${billingInterval}, limit: ${filesLimit} files`);
  } catch (error) {
    console.error('[WEBHOOK] ❌ Error in handleCheckoutComplete:', error);
    throw error;
  }
}

// Handle subscription updates
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleSubscriptionUpdate(subscription: any) {
  try {
    console.log('[WEBHOOK] handleSubscriptionUpdate - subscription ID:', subscription.id);
    console.log('[WEBHOOK] Subscription status:', subscription.status);
    console.log('[WEBHOOK] Cancel at period end:', subscription.cancel_at_period_end);

    const userId = subscription.metadata?.userId;
    const plan = subscription.metadata?.plan as PlanType;
    const billingInterval = subscription.metadata?.billingInterval || 'monthly';

    if (!userId) {
      console.error('[WEBHOOK] Missing userId in subscription metadata');
      return;
    }

    if (!plan) {
      console.error('[WEBHOOK] Missing plan in subscription metadata');
      return;
    }

    const user = await db.getUserById(userId);
    if (!user) {
      console.error('[WEBHOOK] User not found:', userId);
      return;
    }

    console.log('[WEBHOOK] Found user:', user.email, 'plan:', plan, 'billing:', billingInterval);

    // Extract period dates - Stripe uses unix timestamps (seconds)
    const periodStart = subscription.current_period_start || subscription.billing_cycle_anchor;
    const periodEnd = subscription.current_period_end;

    console.log('[WEBHOOK] Period timestamps:', { periodStart, periodEnd });

    // Validate that we have period dates - this is critical!
    if (!periodEnd || typeof periodEnd !== 'number' || isNaN(periodEnd)) {
      console.error('[WEBHOOK] ⚠️  WARNING: Missing or invalid current_period_end!');
      console.error('[WEBHOOK] This will cause issues with cancellation handling!');
    }

    // Check if user is grandfathered to preserve their legacy limits
    const isGrandfathered = user.is_grandfathered_basic || false;
    const filesLimit = getFilesLimitForUser(plan, isGrandfathered);

    // Determine subscription status
    // If cancel_at_period_end is true, the subscription is still active but scheduled to cancel
    let subscriptionStatus = subscription.status;

    // Important: If subscription is scheduled to cancel (cancel_at_period_end = true),
    // we keep it as "active" in our DB but we track the end date
    // The actual cancellation happens when customer.subscription.deleted fires
    if (subscription.cancel_at_period_end && subscription.status === 'active') {
      console.log('[WEBHOOK] 📅 Subscription is scheduled to cancel at period end');
      subscriptionStatus = 'active'; // Keep as active until period ends
    }

    // Build update object - only include dates if they're valid
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updateData: any = {
      stripe_customer_id: subscription.customer,
      subscription_id: subscription.id,
      subscription_status: subscriptionStatus as 'active' | 'canceled' | 'past_due' | 'trialing' | 'incomplete' | 'incomplete_expired' | 'unpaid',
      plan: plan,
      monthly_files_limit: filesLimit, // Respects grandfathering
      billing_interval: billingInterval as 'monthly' | 'yearly',
    };

    // Only add dates if they exist and are valid numbers
    if (periodStart && typeof periodStart === 'number' && !isNaN(periodStart)) {
      updateData.current_period_start = new Date(periodStart * 1000);
      console.log('[WEBHOOK] ✅ Set current_period_start:', updateData.current_period_start.toISOString());
    } else {
      console.error('[WEBHOOK] ⚠️  Missing current_period_start!');
    }

    if (periodEnd && typeof periodEnd === 'number' && !isNaN(periodEnd)) {
      updateData.current_period_end = new Date(periodEnd * 1000);
      console.log('[WEBHOOK] ✅ Set current_period_end:', updateData.current_period_end.toISOString());
    } else {
      console.error('[WEBHOOK] ⚠️  Missing current_period_end!');
    }

    console.log('[WEBHOOK] Updating user with:', JSON.stringify(updateData, null, 2));

    await db.updateUser(userId, updateData);

    console.log(`[WEBHOOK] ✅ Subscription updated for user ${userId}, plan: ${plan}, billing: ${billingInterval}`);

    if (subscription.cancel_at_period_end) {
      console.log(`[WEBHOOK] 📅 User will be downgraded to free plan on: ${updateData.current_period_end?.toISOString()}`);
    }
  } catch (error) {
    console.error('[WEBHOOK] ❌ Error in handleSubscriptionUpdate:', error);
    throw error;
  }
}

// Handle subscription deleted/canceled
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleSubscriptionDeleted(subscription: any) {
  try {
    console.log('[WEBHOOK] handleSubscriptionDeleted - subscription ID:', subscription.id);

    const userId = subscription.metadata?.userId;

    if (!userId) {
      console.error('[WEBHOOK] Missing userId in subscription metadata');
      return;
    }

    const user = await db.getUserById(userId);
    if (!user) {
      console.error('[WEBHOOK] User not found:', userId);
      return;
    }

    console.log(`[WEBHOOK] Processing cancellation for user: ${user.email} (${user.plan})`);

    // Get period end from subscription or fall back to database
    const subWithPeriod = subscription as unknown as StripeSubscriptionWithPeriod;
    let periodEnd: Date;

    if (subWithPeriod.current_period_end) {
      periodEnd = new Date(subWithPeriod.current_period_end * 1000);
      console.log(`[WEBHOOK] Period end from Stripe: ${periodEnd.toISOString()}`);
    } else if (user.current_period_end) {
      periodEnd = new Date(user.current_period_end);
      console.log(`[WEBHOOK] Period end from database: ${periodEnd.toISOString()}`);
    } else {
      // No period end available - immediately downgrade
      console.error('[WEBHOOK] ⚠️  No period end date available! Downgrading immediately.');
      await db.updateUser(userId, {
        plan: 'free',
        monthly_files_limit: getFilesLimit('free'),
        files_used_monthly: 0,
        subscription_status: 'canceled',
        subscription_id: undefined,
        current_period_end: undefined,
        current_period_start: undefined,
      });
      console.log(`[WEBHOOK] ✅ User ${userId} downgraded to free plan immediately (no period end date)`);
      return;
    }

    const now = new Date();
    console.log(`[WEBHOOK] Current time: ${now.toISOString()}`);
    console.log(`[WEBHOOK] Period end: ${periodEnd.toISOString()}`);
    console.log(`[WEBHOOK] Time until period end: ${Math.round((periodEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))} days`);

    // Check if we're past the period end
    if (periodEnd > now) {
      // User canceled but still has time left - mark as canceled but keep plan access
      // This handles the grace period for users who cancel mid-billing cycle
      await db.updateUser(userId, {
        subscription_status: 'canceled',
      });
      console.log(`[WEBHOOK] ✅ Subscription marked as canceled for user ${userId}`);
      console.log(`[WEBHOOK] 📅 User retains ${user.plan} access until ${periodEnd.toISOString()}`);
      console.log(`[WEBHOOK] ⏰ Automatic downgrade will occur on ${periodEnd.toISOString()}`);
    } else {
      // Period has ended, downgrade to free plan immediately
      await db.updateUser(userId, {
        plan: 'free',
        daily_pages_limit: 3,
        pages_used_today: 0,
        monthly_files_limit: getFilesLimit('free'), // 90 files for free (3/day * 30 days)
        files_used_monthly: 0,
        subscription_status: 'canceled',
        subscription_id: undefined,
        current_period_end: undefined,
        current_period_start: undefined,
      });
      console.log(`[WEBHOOK] ✅ Subscription period expired, user ${userId} downgraded to free plan`);
      console.log(`[WEBHOOK] 📊 New limits: 3 pages/day, 90 files/month`);
    }
  } catch (error) {
    console.error('[WEBHOOK] ❌ Error in handleSubscriptionDeleted:', error);
    throw error;
  }
}

// Handle successful payment (subscription renewal)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handlePaymentSucceeded(invoice: any) {
  const invoiceWithSub = invoice as unknown as StripeInvoiceWithSubscription;
  const subscriptionId = typeof invoiceWithSub.subscription === 'string'
    ? invoiceWithSub.subscription
    : invoiceWithSub.subscription?.id;

  if (!subscriptionId) {
    return;
  }

  // Find user by subscription ID
  const allUsers = await db.getAllUsers();
  const user = allUsers.find(u => u.subscription_id === subscriptionId);

  if (user) {
    // Reset usage on successful payment (new billing period)
    await db.resetUsage(user.id);
    console.log(`Payment succeeded, usage reset for user ${user.id}`);
  }
}

// Handle failed payment
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handlePaymentFailed(invoice: any) {
  const invoiceWithSub = invoice as unknown as StripeInvoiceWithSubscription;
  const subscriptionId = typeof invoiceWithSub.subscription === 'string'
    ? invoiceWithSub.subscription
    : invoiceWithSub.subscription?.id;

  if (!subscriptionId) {
    return;
  }

  // Find user by subscription ID
  const allUsers = await db.getAllUsers();
  const user = allUsers.find(u => u.subscription_id === subscriptionId);

  if (user) {
    // Mark subscription as past_due
    await db.updateUser(user.id, {
      subscription_status: 'past_due',
    });
    console.log(`Payment failed for user ${user.id}, subscription marked as past_due`);

    // Note: Stripe will automatically retry payment and eventually cancel
    // the subscription if payment continues to fail. We rely on the
    // 'customer.subscription.deleted' webhook to downgrade the user.
    // In the meantime, user keeps their paid access (Stripe best practice).
  }
}

export default router;
