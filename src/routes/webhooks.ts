import { Router, Request, Response } from 'express';
import { stripe, getPagesLimit, PlanType } from '../config/stripe.js';
import { db } from '../db/memoryStore.js';
import Stripe from 'stripe';

const router = Router();

// Webhook endpoint - must use raw body
router.post('/stripe', async (req: Request, res: Response) => {
  const sig = req.headers['stripe-signature'] as string;

  if (!sig) {
    return res.status(400).json({ error: 'No signature provided' });
  }

  let event: Stripe.Event;

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
        const session = event.data.object as Stripe.Checkout.Session;
        await handleCheckoutComplete(session);
        break;
      }

      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription;
        await handleSubscriptionUpdate(subscription);
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        await handleSubscriptionDeleted(subscription);
        break;
      }

      case 'invoice.payment_succeeded': {
        const invoice = event.data.object as Stripe.Invoice;
        await handlePaymentSucceeded(invoice);
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;
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
async function handleCheckoutComplete(session: Stripe.Checkout.Session) {
  const userId = session.metadata?.userId || session.client_reference_id;
  const plan = session.metadata?.plan as PlanType;

  if (!userId || !plan) {
    console.error('Missing userId or plan in checkout session');
    return;
  }

  const user = db.getUserById(userId);
  if (!user) {
    console.error('User not found:', userId);
    return;
  }

  // Update user with customer ID
  db.updateUser(userId, {
    stripeCustomerId: session.customer as string,
    subscriptionId: session.subscription as string,
    plan: plan,
    pagesLimit: getPagesLimit(plan),
    subscriptionStatus: 'active',
  });

  console.log(`Checkout completed for user ${userId}, plan: ${plan}`);
}

// Handle subscription updates
async function handleSubscriptionUpdate(subscription: Stripe.Subscription) {
  const userId = subscription.metadata?.userId;

  if (!userId) {
    console.error('Missing userId in subscription metadata');
    return;
  }

  const user = db.getUserById(userId);
  if (!user) {
    console.error('User not found:', userId);
    return;
  }

  const plan = subscription.metadata?.plan as PlanType;

  db.updateUser(userId, {
    subscriptionId: subscription.id,
    subscriptionStatus: subscription.status as any,
    currentPeriodStart: new Date((subscription as any).current_period_start * 1000),
    currentPeriodEnd: new Date((subscription as any).current_period_end * 1000),
    ...(plan && {
      plan: plan,
      pagesLimit: getPagesLimit(plan),
    }),
  });

  console.log(`Subscription updated for user ${userId}`);
}

// Handle subscription deleted/canceled
async function handleSubscriptionDeleted(subscription: Stripe.Subscription) {
  const userId = subscription.metadata?.userId;

  if (!userId) {
    console.error('Missing userId in subscription metadata');
    return;
  }

  const user = db.getUserById(userId);
  if (!user) {
    console.error('User not found:', userId);
    return;
  }

  // Downgrade to free plan
  db.updateUser(userId, {
    plan: 'free',
    pagesLimit: getPagesLimit('free'),
    subscriptionStatus: 'canceled',
    subscriptionId: undefined,
  });

  console.log(`Subscription canceled for user ${userId}`);
}

// Handle successful payment (subscription renewal)
async function handlePaymentSucceeded(invoice: Stripe.Invoice) {
  const subscriptionId = (invoice as any).subscription as string;

  if (!subscriptionId) {
    return;
  }

  // Find user by subscription ID
  const allUsers = db.getAllUsers();
  const user = allUsers.find(u => u.subscriptionId === subscriptionId);

  if (user) {
    // Reset usage on successful payment (new billing period)
    db.resetUsage(user.id);
    console.log(`Payment succeeded, usage reset for user ${user.id}`);
  }
}

// Handle failed payment
async function handlePaymentFailed(invoice: Stripe.Invoice) {
  const subscriptionId = (invoice as any).subscription as string;

  if (!subscriptionId) {
    return;
  }

  // Find user by subscription ID
  const allUsers = db.getAllUsers();
  const user = allUsers.find(u => u.subscriptionId === subscriptionId);

  if (user) {
    db.updateUser(user.id, {
      subscriptionStatus: 'past_due',
    });
    console.log(`Payment failed for user ${user.id}`);
  }
}

export default router;
