import { Router, Request, Response } from 'express';
import { stripe, PlanType } from '../config/stripe.js';
import { db } from '../db/postgres.js';
import jwt from 'jsonwebtoken';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this-in-production';

/**
 * Get the correct Stripe Price ID based on plan, billing interval, and currency
 * Returns the appropriate price ID from environment variables
 */
function getPriceIdForCurrency(plan: PlanType, billingInterval: string, currency: string): string | null {
  // Map currency to environment variable suffix
  const currencySuffix = currency === 'GBP' ? '' : `_${currency}`;

  // Build the environment variable name
  // Examples:
  // - STRIPE_BASIC_PRICE_ID (GBP monthly - default)
  // - STRIPE_BASIC_YEARLY_PRICE_ID (GBP yearly)
  // - STRIPE_BASIC_PRICE_ID_USD (USD monthly)
  // - STRIPE_BASIC_YEARLY_PRICE_ID_USD (USD yearly)

  const planUpper = plan.toUpperCase();
  let envVarName: string;

  if (billingInterval === 'yearly') {
    envVarName = `STRIPE_${planUpper}_YEARLY_PRICE_ID${currencySuffix}`;
  } else {
    envVarName = `STRIPE_${planUpper}_PRICE_ID${currencySuffix}`;
  }

  const priceId = process.env[envVarName];

  // Fallback: if specific currency not found, try GBP as default
  if (!priceId && currency !== 'GBP') {
    console.warn(`Price ID not found for ${envVarName}, falling back to GBP`);
    const gbpEnvVarName = billingInterval === 'yearly'
      ? `STRIPE_${planUpper}_YEARLY_PRICE_ID`
      : `STRIPE_${planUpper}_PRICE_ID`;
    return process.env[gbpEnvVarName] || null;
  }

  return priceId || null;
}

// Create Checkout Session
router.post('/create-checkout-session', async (req: Request, res: Response) => {
  try {
    const { plan, email, userId, billingInterval = 'monthly', currency = 'GBP' } = req.body;

    if (!plan || !email) {
      return res.status(400).json({ error: 'Plan and email are required' });
    }

    // Validate plan
    if (!['basic', 'starter', 'professional', 'enterprise'].includes(plan)) {
      return res.status(400).json({ error: 'Invalid plan selected' });
    }

    // Validate billing interval
    if (!['monthly', 'yearly'].includes(billingInterval)) {
      return res.status(400).json({ error: 'Invalid billing interval' });
    }

    // Validate currency
    const supportedCurrencies = ['GBP', 'USD', 'CAD', 'EUR', 'AUD'];
    if (!supportedCurrencies.includes(currency)) {
      return res.status(400).json({ error: 'Unsupported currency' });
    }

    // Select the correct price ID based on billing interval and currency
    const priceId = getPriceIdForCurrency(plan as PlanType, billingInterval, currency);

    if (!priceId) {
      return res.status(400).json({
        error: 'Price ID not configured for selected plan, billing interval, and currency',
        fallback: 'GBP' // Suggest fallback to GBP
      });
    }

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
          price: priceId,
          quantity: 1,
        },
      ],
      customer_email: email,
      client_reference_id: user.id,
      metadata: {
        userId: user.id,
        plan: plan,
        billingInterval: billingInterval,
        currency: currency,
      },
      success_url: `${process.env.FRONTEND_URL}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.FRONTEND_URL}/pricing?canceled=true`,
      subscription_data: {
        metadata: {
          userId: user.id,
          plan: plan,
          billingInterval: billingInterval,
          currency: currency,
        },
      },
    });

    res.json({ sessionId: session.id, url: session.url });
  } catch (error) {
    console.error('Error creating checkout session:', error);
    res.status(500).json({ error: 'Failed to create checkout session' });
  }
});

// Get Customer Portal - Protected route
router.post('/create-portal-session', async (req: Request, res: Response) => {
  try {
    // Authenticate user from JWT token
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const token = authHeader.substring(7);
    let decoded: { userId: string; email: string };

    try {
      decoded = jwt.verify(token, JWT_SECRET) as { userId: string; email: string };
    } catch {
      return res.status(401).json({ error: 'Invalid token' });
    }

    // Get user from token (not from request body for security)
    const user = await db.getUserById(decoded.userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (!user.stripe_customer_id) {
      return res.status(400).json({
        error: 'No active subscription',
        message: 'You need to subscribe to a plan first to manage billing.'
      });
    }

    console.log(`Creating portal session for customer: ${user.stripe_customer_id}`);
    console.log(`Return URL: ${process.env.FRONTEND_URL}/dashboard`);

    try {
      const session = await stripe.billingPortal.sessions.create({
        customer: user.stripe_customer_id,
        return_url: `${process.env.FRONTEND_URL}/dashboard`,
      });

      console.log(`Portal session created successfully: ${session.id}`);
      return res.json({ url: session.url });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (stripeError: any) {
      // Stripe-specific error handling
      if (stripeError.type === 'StripeInvalidRequestError') {
        console.error('Stripe configuration error:', stripeError.message);

        // Check if it's the common "billing portal not activated" error
        if (stripeError.message?.includes('customer portal') || stripeError.message?.includes('not activated')) {
          return res.status(500).json({
            error: 'Billing portal not configured',
            message: 'The billing portal is not yet activated in Stripe. Please activate it in your Stripe Dashboard under Settings → Billing → Customer portal.',
          });
        }
      }
      throw stripeError; // Re-throw to be caught by outer catch
    }
  } catch (error) {
    // Enhanced error logging
    console.error('Error creating portal session:');
    console.error('Error type:', error instanceof Error ? error.constructor.name : typeof error);
    console.error('Error message:', error instanceof Error ? error.message : String(error));
    console.error('Full error:', JSON.stringify(error, null, 2));

    // Return more specific error message
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({
      error: 'Failed to create portal session',
      message: errorMessage,
      details: process.env.NODE_ENV === 'development' ? error : undefined,
    });
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
