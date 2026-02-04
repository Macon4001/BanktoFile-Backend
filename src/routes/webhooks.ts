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
    // Get the first subscription item's period
    const periodStart = subscription.current_period_start || subscription.billing_cycle_anchor;
    const periodEnd = subscription.current_period_end;

    console.log('[WEBHOOK] Period timestamps:', { periodStart, periodEnd });

    // Check if user is grandfathered to preserve their legacy limits
    const isGrandfathered = user.is_grandfathered_basic || false;
    const filesLimit = getFilesLimitForUser(plan, isGrandfathered);

    // Build update object - only include dates if they're valid
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updateData: any = {
      stripe_customer_id: subscription.customer,
      subscription_id: subscription.id,
      subscription_status: subscription.status as 'active' | 'canceled' | 'past_due' | 'trialing' | 'incomplete' | 'incomplete_expired' | 'unpaid',
      plan: plan,
      monthly_files_limit: filesLimit, // Respects grandfathering
      billing_interval: billingInterval as 'monthly' | 'yearly',
    };

    // Only add dates if they exist and are valid numbers
    if (periodStart && typeof periodStart === 'number' && !isNaN(periodStart)) {
      updateData.current_period_start = new Date(periodStart * 1000);
    }
    if (periodEnd && typeof periodEnd === 'number' && !isNaN(periodEnd)) {
      updateData.current_period_end = new Date(periodEnd * 1000);
    }

    console.log('[WEBHOOK] Updating user with:', updateData);

    await db.updateUser(userId, updateData);

    console.log(`[WEBHOOK] ✅ Subscription updated for user ${userId}, plan: ${plan}, billing: ${billingInterval}`);
  } catch (error) {
    console.error('[WEBHOOK] ❌ Error in handleSubscriptionUpdate:', error);
    throw error;
  }
}

// Handle subscription deleted/canceled
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleSubscriptionDeleted(subscription: any) {
  const userId = subscription.metadata?.userId;

  if (!userId) {
    console.error('Missing userId in subscription metadata');
    return;
  }

  const user = await db.getUserById(userId);
  if (!user) {
    console.error('User not found:', userId);
    return;
  }

  // Check if subscription is canceled_at_period_end (user keeps access until period ends)
  // vs immediately canceled (cancel_at_period_end = false)
  const subWithPeriod = subscription as unknown as StripeSubscriptionWithPeriod;
  const periodEnd = new Date(subWithPeriod.current_period_end * 1000);
  const now = new Date();

  // Only downgrade if we're past the period end
  // If canceled but still within paid period, keep their access
  if (periodEnd > now) {
    // User canceled but still has time left - mark as canceled but keep plan
    await db.updateUser(userId, {
      subscription_status: 'canceled',
    });
    console.log(`Subscription marked as canceled for user ${userId}, but access retained until ${periodEnd}`);
  } else {
    // Period has ended, downgrade to free plan
    await db.updateUser(userId, {
      plan: 'free',
      monthly_files_limit: getFilesLimit('free'),
      files_used_monthly: 0,
      subscription_status: 'canceled',
      subscription_id: undefined,
    });
    console.log(`Subscription expired, user ${userId} downgraded to free plan`);
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
