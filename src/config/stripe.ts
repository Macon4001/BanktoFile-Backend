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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (getStripe() as any)[prop];
  }
});

// Pricing Tiers Configuration - using getter function to ensure env vars are loaded
export function getPricingTiers() {
  return {
    free: {
      name: 'Free',
      filesPerMonth: 90, // 3 per day * 30 days
      filesPerDay: 3,
      maxPagesPerFile: 5,
      price: 0,
      priceId: null, // No Stripe price ID for free tier
      features: [
        '3 files per day',
        'Up to 5 pages per file',
        'CSV & XLSX formats',
        'Basic support',
        'Secure processing',
      ],
    },
    basic: {
      name: 'Basic',
      filesPerMonth: 150,
      maxPagesPerFile: 20,
      price: 20,
      priceId: process.env.STRIPE_BASIC_PRICE_ID || 'price_basic',
      features: [
        '150 files per month',
        'Up to 20 pages per file',
        'CSV & XLSX formats',
        'Email support',
        'Secure processing',
      ],
    },
    starter: {
      name: 'Starter',
      filesPerMonth: 400,
      maxPagesPerFile: 50,
      price: 40,
      priceId: process.env.STRIPE_STARTER_PRICE_ID || 'price_starter',
      features: [
        '400 files per month',
        'Up to 50 pages per file',
        'CSV & XLSX formats',
        'Email support',
        'Secure processing',
      ],
    },
    professional: {
      name: 'Pro',
      filesPerMonth: 1000,
      maxPagesPerFile: 100,
      price: 60,
      priceId: process.env.STRIPE_PROFESSIONAL_PRICE_ID || 'price_professional',
      features: [
        '1,000 files per month',
        'Up to 100 pages per file',
        'CSV & XLSX formats',
        'Priority email support',
        'Secure processing',
      ],
    },
    enterprise: {
      name: 'Enterprise',
      filesPerMonth: 4000,
      maxPagesPerFile: -1, // -1 means unlimited
      price: 99,
      priceId: process.env.STRIPE_ENTERPRISE_PRICE_ID || 'price_enterprise',
      features: [
        '4,000 files per month',
        'Unlimited pages per file',
        'CSV & XLSX formats',
        'Priority email support',
        'Secure processing',
        'Bulk processing',
      ],
    },
  } as const;
}

export type PlanType = 'free' | 'basic' | 'starter' | 'professional' | 'enterprise';

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

// Helper function to get files limit for a plan (monthly)
export function getFilesLimit(plan: PlanType): number {
  return getPricingTiers()[plan].filesPerMonth;
}

// Helper function to get max pages per file for a plan
export function getMaxPagesPerFile(plan: PlanType): number {
  return getPricingTiers()[plan].maxPagesPerFile;
}
