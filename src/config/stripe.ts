import Stripe from 'stripe';

// Lazy-load Stripe instance to ensure env vars are loaded
let stripeInstance: Stripe | null = null;

export function getStripe(): Stripe {
  if (!stripeInstance) {
    if (!process.env.STRIPE_SECRET_KEY) {
      throw new Error('STRIPE_SECRET_KEY is not set in environment variables');
    }
    stripeInstance = new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: '2025-10-29.clover',
      typescript: true,
    });
  }
  return stripeInstance;
}

// For backwards compatibility
export const stripe = new Proxy({} as Stripe, {
  get(target, prop) {
    return (getStripe() as any)[prop];
  }
});

// Pricing Tiers Configuration - using getter function to ensure env vars are loaded
export function getPricingTiers() {
  return {
    free: {
      name: 'Free',
      pages: 50,
      price: 0,
      priceId: null, // No Stripe price ID for free tier
      features: [
        '50 pages per month',
        'PDF to CSV conversion',
        'PDF to XLSX conversion',
        'Basic support',
        'No credit card required',
      ],
    },
    starter: {
      name: 'Starter',
      pages: 500,
      price: 9.99,
      priceId: process.env.STRIPE_STARTER_PRICE_ID || 'price_starter',
      features: [
        '500 pages per month',
        'PDF to CSV conversion',
        'PDF to XLSX conversion',
        'Priority email support',
        'Bulk conversion',
        'No watermarks',
      ],
    },
    professional: {
      name: 'Professional',
      pages: 2000,
      price: 29.99,
      priceId: process.env.STRIPE_PROFESSIONAL_PRICE_ID || 'price_professional',
      features: [
        '2,000 pages per month',
        'PDF to CSV conversion',
        'PDF to XLSX conversion',
        'Priority support',
        'Bulk conversion',
        'API access',
        'Custom formatting',
        'Advanced analytics',
      ],
    },
    enterprise: {
      name: 'Enterprise',
      pages: 10000,
      price: 99.99,
      priceId: process.env.STRIPE_ENTERPRISE_PRICE_ID || 'price_enterprise',
      features: [
        '10,000 pages per month',
        'Everything in Professional',
        'Dedicated support',
        'Custom integrations',
        'SLA guarantee',
        'Team collaboration',
        'White-label options',
        'Unlimited file size',
      ],
    },
  } as const;
}

export type PlanType = 'free' | 'starter' | 'professional' | 'enterprise';

// Export as getter to ensure it reads env vars at runtime
export const PRICING_TIERS = new Proxy({} as ReturnType<typeof getPricingTiers>, {
  get(target, prop: string) {
    return getPricingTiers()[prop as PlanType];
  }
});

// Helper function to get plan details
export function getPlanDetails(plan: PlanType) {
  return getPricingTiers()[plan];
}

// Helper function to get pages limit for a plan
export function getPagesLimit(plan: PlanType): number {
  return getPricingTiers()[plan].pages;
}
