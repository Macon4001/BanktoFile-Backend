import { Router, Request, Response } from 'express';
import { stripe, getFilesLimit, PlanType } from '../config/stripe.js';
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
  const userId = session.metadata?.userId || session.client_reference_id;
  const plan = session.metadata?.plan as PlanType;

  if (!userId || !plan) {
    console.error('Missing userId or plan in checkout session');
    return;
  }

  const user = await db.getUserById(userId);
  if (!user) {
    console.error('User not found:', userId);
    return;
  }

  // Fetch the subscription to get period dates
  let periodStart: Date | undefined;
  let periodEnd: Date | undefined;

  if (session.subscription) {
    try {
      const subscription = await stripe.subscriptions.retrieve(session.subscription as string) as unknown as StripeSubscriptionWithPeriod;
      periodStart = new Date(subscription.current_period_start * 1000);
      periodEnd = new Date(subscription.current_period_end * 1000);
      console.log(`Retrieved subscription periods: ${periodStart.toISOString()} to ${periodEnd.toISOString()}`);
    } catch (error) {
      console.error('Error fetching subscription from checkout session:', error);
      // Continue anyway - subscription.created webhook will set these later
    }
  }

  // Update user with customer ID and reset usage
  await db.updateUser(userId, {
    stripe_customer_id: session.customer as string,
    subscription_id: session.subscription as string,
    plan: plan,
    monthly_pages_limit: getFilesLimit(plan),
    pages_used_monthly: 0, // Reset usage on new purchase
    subscription_status: 'active',
    ...(periodStart && { current_period_start: periodStart }),
    ...(periodEnd && { current_period_end: periodEnd }),
  });

  console.log(`Checkout completed for user ${userId}, plan: ${plan}, limit: ${getFilesLimit(plan)} files, period: ${periodStart?.toISOString()} to ${periodEnd?.toISOString()}`);
}

// Handle subscription updates
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleSubscriptionUpdate(subscription: any) {
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

  const plan = subscription.metadata?.plan as PlanType;
  const subWithPeriod = subscription as unknown as StripeSubscriptionWithPeriod;

  await db.updateUser(userId, {
    subscription_id: subscription.id,
    subscription_status: subscription.status as 'active' | 'canceled' | 'past_due' | 'trialing' | 'incomplete' | 'incomplete_expired' | 'unpaid',
    current_period_start: new Date(subWithPeriod.current_period_start * 1000),
    current_period_end: new Date(subWithPeriod.current_period_end * 1000),
    ...(plan && {
      plan: plan,
      monthly_pages_limit: getFilesLimit(plan),
    }),
  });

  console.log(`Subscription updated for user ${userId}`);
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
      monthly_pages_limit: getFilesLimit('free'),
      pages_used_monthly: 0,
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
