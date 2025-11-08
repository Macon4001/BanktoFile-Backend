import { Router, Request, Response } from 'express';
import { stripe, PRICING_TIERS, PlanType } from '../config/stripe.js';
import { db } from '../db/postgres.js';

const router = Router();

// Create Checkout Session
router.post('/create-checkout-session', async (req: Request, res: Response) => {
  try {
    const { plan, email, userId } = req.body;

    if (!plan || !email) {
      return res.status(400).json({ error: 'Plan and email are required' });
    }

    // Validate plan
    if (!['starter', 'professional', 'enterprise'].includes(plan)) {
      return res.status(400).json({ error: 'Invalid plan selected' });
    }

    const planDetails = PRICING_TIERS[plan as PlanType];

    // Create or get user
    let user = userId ? await db.getUserById(userId) : await db.getUserByEmail(email);
    if (!user) {
      user = await db.createUser(email);
    }

    // Create Stripe checkout session
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [
        {
          price: planDetails.priceId!,
          quantity: 1,
        },
      ],
      customer_email: email,
      client_reference_id: user.id,
      metadata: {
        userId: user.id,
        plan: plan,
      },
      success_url: `${process.env.FRONTEND_URL}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.FRONTEND_URL}/pricing?canceled=true`,
      subscription_data: {
        metadata: {
          userId: user.id,
          plan: plan,
        },
      },
    });

    res.json({ sessionId: session.id, url: session.url });
  } catch (error) {
    console.error('Error creating checkout session:', error);
    res.status(500).json({ error: 'Failed to create checkout session' });
  }
});

// Get Customer Portal
router.post('/create-portal-session', async (req: Request, res: Response) => {
  try {
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({ error: 'User ID is required' });
    }

    const user = await db.getUserById(userId);
    if (!user || !user.stripe_customer_id) {
      return res.status(404).json({ error: 'User or customer not found' });
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: user.stripe_customer_id,
      return_url: `${process.env.FRONTEND_URL}/dashboard`,
    });

    res.json({ url: session.url });
  } catch (error) {
    console.error('Error creating portal session:', error);
    res.status(500).json({ error: 'Failed to create portal session' });
  }
});

// Get user subscription status
router.get('/subscription-status/:userId', async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;

    const user = await db.getUserById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      plan: user.plan,
      pagesUsed: user.pagesUsed,
      pagesLimit: user.pagesLimit,
      subscriptionStatus: user.subscription_status,
      currentPeriodEnd: user.current_period_end,
    });
  } catch (error) {
    console.error('Error fetching subscription status:', error);
    res.status(500).json({ error: 'Failed to fetch subscription status' });
  }
});

export default router;
