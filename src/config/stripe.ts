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
      maxFileSizeMB: 10,
      price: 0,
      priceId: null, // No Stripe price ID for free tier
      features: [
        '3 files per day',
        'Up to 5 pages per file',
        'Max 10MB file size',
        'CSV & XLSX formats',
        'Basic support',
        'Secure processing',
      ],
    },
    basic: {
      name: 'Basic',
      filesPerMonth: 30, // New subscribers get 30 files/month (legacy users get 150 via is_grandfathered_basic)
      maxPagesPerFile: 20,
      maxFileSizeMB: 10,
      price: 20,
      yearlyPrice: 200, // £200/year (£16.67/month - 17% off)
      priceId: process.env.STRIPE_BASIC_PRICE_ID || 'price_basic',
      yearlyPriceId: process.env.STRIPE_BASIC_YEARLY_PRICE_ID || 'price_basic_yearly',
      features: [
        '30 files per month',
        'Up to 20 pages per file',
        'Max 10MB file size',
        'CSV & XLSX formats',
        'Email support',
        'Secure processing',
      ],
    },
    starter: {
      name: 'Starter',
      filesPerMonth: 400,
      maxPagesPerFile: 50,
      maxFileSizeMB: 10,
      price: 40,
      yearlyPrice: 400, // £400/year (£33.33/month - 17% off)
      priceId: process.env.STRIPE_STARTER_PRICE_ID || 'price_starter',
      yearlyPriceId: process.env.STRIPE_STARTER_YEARLY_PRICE_ID || 'price_starter_yearly',
      features: [
        '400 files per month',
        'Up to 50 pages per file',
        'Max 10MB file size',
        'CSV & XLSX formats',
        'Email support',
        'Secure processing',
      ],
    },
    professional: {
      name: 'Pro',
      filesPerMonth: 1000,
      maxPagesPerFile: 100,
      maxFileSizeMB: 25,
      price: 60,
      yearlyPrice: 600, // £600/year (£50/month - 17% off)
      priceId: process.env.STRIPE_PROFESSIONAL_PRICE_ID || 'price_professional',
      yearlyPriceId: process.env.STRIPE_PROFESSIONAL_YEARLY_PRICE_ID || 'price_professional_yearly',
      features: [
        '1,000 files per month',
        'Up to 100 pages per file',
        'Max 25MB file size',
        'CSV & XLSX formats',
        'Priority email support',
        'Secure processing',
      ],
    },
    enterprise: {
      name: 'Enterprise',
      filesPerMonth: 4000,
      maxPagesPerFile: -1, // -1 means unlimited
      maxFileSizeMB: 25,
      price: 99,
      yearlyPrice: 990, // £990/year (£82.50/month - 17% off)
      priceId: process.env.STRIPE_ENTERPRISE_PRICE_ID || 'price_enterprise',
      yearlyPriceId: process.env.STRIPE_ENTERPRISE_YEARLY_PRICE_ID || 'price_enterprise_yearly',
      features: [
        '4,000 files per month',
        'Unlimited pages per file',
        'Max 25MB file size',
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
// Note: This returns the default limit. Use getFilesLimitForUser() for grandfathered users
export function getFilesLimit(plan: PlanType): number {
  return getPricingTiers()[plan].filesPerMonth;
}

// Helper function to get files limit for a specific user (accounts for grandfathering)
export function getFilesLimitForUser(plan: PlanType, isGrandfatheredBasic?: boolean): number {
  // Legacy Basic users keep their 150 files/month
  if (plan === 'basic' && isGrandfatheredBasic === true) {
    return 150; // Legacy limit
  }
  // All other users get the default limit for their plan
  return getPricingTiers()[plan].filesPerMonth;
}

// Helper function to get max pages per file for a plan
export function getMaxPagesPerFile(plan: PlanType): number {
  return getPricingTiers()[plan].maxPagesPerFile;
}
