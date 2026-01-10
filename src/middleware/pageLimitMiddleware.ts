import { Request, Response, NextFunction } from 'express';
import { db } from '../db/postgres.js';
import pdf from 'pdf-parse';
import { getMaxPagesPerFile, getPlanDetails, PlanType } from '../config/stripe.js';

// Extend Express Request to include user info
declare module 'express-serve-static-core' {
  interface Request {
    userId?: string;
    pagesInFile?: number;
  }
}

/**
 * Helper function to suggest the next tier based on page count
 */
function getSuggestedTierForPages(pages: number): PlanType | null {
  if (pages <= 5) return null; // Free tier is sufficient
  if (pages <= 20) return 'basic';
  if (pages <= 50) return 'starter';
  if (pages <= 100) return 'professional';
  return 'enterprise'; // Unlimited
}

/**
 * Middleware to count pages in uploaded PDF
 */
export async function countPagesMiddleware(req: Request, res: Response, next: NextFunction) {
  try {
    console.log('📊 [COUNT_PAGES] Starting page count middleware');

    if (!req.file) {
      console.log('📊 [COUNT_PAGES] No file found, skipping');
      return next();
    }

    console.log(`📊 [COUNT_PAGES] File details:`, {
      name: req.file.originalname,
      mimetype: req.file.mimetype,
      size: req.file.size,
    });

    // Count pages if it's a PDF
    if (req.file.mimetype === 'application/pdf') {
      const data = await pdf(req.file.buffer);
      req.pagesInFile = data.numpages;
      console.log(`📊 [COUNT_PAGES] ✅ PDF has ${req.pagesInFile} pages`);
    } else {
      // CSV files count as 1 page
      req.pagesInFile = 1;
      console.log('📊 [COUNT_PAGES] CSV file counts as 1 page');
    }

    next();
  } catch (error) {
    console.error('📊 [COUNT_PAGES] ❌ Error counting pages:', error);
    // If we can't count pages, assume 1 page to not block the user
    req.pagesInFile = 1;
    next();
  }
}

/**
 * Middleware to check if user has enough pages remaining
 */
export async function checkPageLimitMiddleware(req: Request, res: Response, next: NextFunction) {
  try {
    console.log('🔒 [PAGE_LIMIT] Starting page limit check middleware');
    console.log('🔒 [PAGE_LIMIT] Environment check:', {
      DISABLE_LIMITS: process.env.DISABLE_LIMITS,
      HAS_DATABASE_URL: !!process.env.DATABASE_URL,
      NODE_ENV: process.env.NODE_ENV,
    });

    // DEVELOPMENT MODE: Skip MONTHLY limits if explicitly disabled or DATABASE_URL is not set
    // BUT still enforce per-file page limits for testing
    const skipMonthlyLimits = process.env.DISABLE_LIMITS === 'true' || !process.env.DATABASE_URL;

    console.log(`🔒 [PAGE_LIMIT] Skip monthly limits: ${skipMonthlyLimits}`);

    if (skipMonthlyLimits) {
      console.log('⚠️  [PAGE_LIMIT] Monthly usage limits disabled (development mode)');
      req.userId = 'dev-user';

      // Still check per-file page limits even in dev mode
      const pagesInFile = req.pagesInFile || 1;
      const freeTierLimit = 5; // Free tier max pages per file

      console.log(`🔒 [PAGE_LIMIT] Checking per-file limit:`, {
        pagesInFile,
        freeTierLimit,
        willBlock: pagesInFile > freeTierLimit,
      });

      if (pagesInFile > freeTierLimit) {
        console.log(`🚫 [PAGE_LIMIT] BLOCKING: File has ${pagesInFile} pages, exceeds free tier limit of ${freeTierLimit}`);

        const suggestedTier = getSuggestedTierForPages(pagesInFile);
        const response = {
          error: 'File page limit exceeded',
          code: 'FILE_PAGE_LIMIT_EXCEEDED',
          pagesInFile,
          maxPagesPerFile: freeTierLimit,
          currentPlan: 'free',
          suggestedPlan: suggestedTier,
          suggestedPlanName: suggestedTier ? getPlanDetails(suggestedTier).name : undefined,
          suggestedPlanPrice: suggestedTier ? getPlanDetails(suggestedTier).price : undefined,
          suggestedMaxPages: suggestedTier ? getMaxPagesPerFile(suggestedTier) : undefined,
          message: `This file has ${pagesInFile} pages. Free accounts can convert files up to ${freeTierLimit} pages.`,
        };

        console.log(`🚫 [PAGE_LIMIT] Sending 403 response:`, response);
        return res.status(403).json(response);
      }

      console.log(`✅ [PAGE_LIMIT] File passed per-file limit check (${pagesInFile}/${freeTierLimit} pages)`);
      return next();
    }

    // Get user ID from request (could be from session, cookie, or header)
    const userId = req.headers['x-user-id'] as string || req.query.userId as string;

    console.log(`🔒 [PAGE_LIMIT] User ID from request: ${userId || 'none'}`);

    let user;

    if (!userId) {
      // No user ID provided - create anonymous user with free tier
      console.log(`🔒 [PAGE_LIMIT] No user ID found, creating anonymous user`);
      const email = `anonymous_${Date.now()}@temp.local`;
      user = await db.createUser(email);
      req.userId = user.id;
      console.log(`🔒 [PAGE_LIMIT] Created anonymous user: ${user.id} with plan: ${user.plan}`);
      // Don't return here! Continue to check page limits for anonymous users
    } else {
      req.userId = userId;
      user = await db.getUserById(userId);

      if (!user) {
        console.log(`🔒 [PAGE_LIMIT] ❌ User not found: ${userId}`);
        return res.status(404).json({
          error: 'User not found',
          code: 'USER_NOT_FOUND',
        });
      }
      console.log(`🔒 [PAGE_LIMIT] Found user: ${user.id} with plan: ${user.plan}`);
    }

    const pagesInFile = req.pagesInFile || 1;
    const maxPagesPerFile = getMaxPagesPerFile(user.plan as PlanType);

    console.log(`🔒 [PAGE_LIMIT] Per-file limit check:`, {
      userPlan: user.plan,
      pagesInFile,
      maxPagesPerFile,
      willBlock: maxPagesPerFile !== -1 && pagesInFile > maxPagesPerFile,
    });

    // Check per-file page limit first
    if (maxPagesPerFile !== -1 && pagesInFile > maxPagesPerFile) {
      console.log(`🚫 [PAGE_LIMIT] BLOCKING FILE: ${pagesInFile} pages exceeds ${maxPagesPerFile} page limit for ${user.plan} plan`);

      // File exceeds per-file page limit for this tier
      // Suggest next tier
      const suggestedTier = getSuggestedTierForPages(pagesInFile);
      const suggestedPlan = suggestedTier ? getPlanDetails(suggestedTier) : null;

      const response = {
        error: 'File page limit exceeded',
        code: 'FILE_PAGE_LIMIT_EXCEEDED',
        pagesInFile,
        maxPagesPerFile,
        currentPlan: user.plan,
        suggestedPlan: suggestedTier,
        suggestedPlanName: suggestedPlan?.name,
        suggestedPlanPrice: suggestedPlan?.price,
        suggestedMaxPages: suggestedPlan?.maxPagesPerFile,
        message: `This file has ${pagesInFile} pages. Your ${user.plan} plan supports files up to ${maxPagesPerFile} pages.`,
      };

      console.log(`🚫 [PAGE_LIMIT] Sending 403 response:`, response);
      return res.status(403).json(response);
    }

    console.log(`✅ [PAGE_LIMIT] File passed per-file page limit check`);


    // Check monthly usage limit
    const canConvert = await db.canConvert(userId, pagesInFile);

    if (!canConvert) {
      const pagesRemaining = Math.max(0, user.pagesLimit! - user.pagesUsed!);

      // Check if it's a subscription issue or limit issue
      if (user.plan !== 'free' && user.subscription_status !== 'active') {
        const statusMessages: Record<string, string> = {
          'past_due': 'Your subscription payment failed. Please update your payment method to continue.',
          'canceled': 'Your subscription has been canceled. Please renew to continue using paid features.',
          'incomplete': 'Your subscription setup is incomplete. Please complete the payment process.',
          'unpaid': 'Your subscription is unpaid. Please update your payment method to continue.',
        };

        return res.status(403).json({
          error: 'Subscription inactive',
          code: 'SUBSCRIPTION_INACTIVE',
          subscriptionStatus: user.subscription_status,
          plan: user.plan,
          message: statusMessages[user.subscription_status || ''] || 'Your subscription is not active. Please contact support.',
        });
      }

      return res.status(403).json({
        error: 'Monthly page limit exceeded',
        code: 'MONTHLY_PAGE_LIMIT_EXCEEDED',
        pagesUsed: user.pagesUsed,
        pagesLimit: user.pagesLimit,
        pagesRemaining,
        pagesNeeded: pagesInFile,
        plan: user.plan,
        message: `You've used ${user.pagesUsed} of your ${user.pagesLimit} monthly pages. This file requires ${pagesInFile} page(s). Please upgrade your plan to continue.`,
      });
    }

    console.log(`User ${userId} has ${user.pagesLimit! - user.pagesUsed!} pages remaining`);
    next();
  } catch (error) {
    console.error('Error in page limit middleware:', error);
    res.status(500).json({
      error: 'Failed to check page limit',
    });
  }
}

/**
 * Middleware to log conversion after successful processing
 * This should be called after the file is processed successfully
 */
export function logConversionMiddleware(req: Request, res: Response, next: NextFunction) {
  // Store original json function
  const originalJson = res.json.bind(res);

  // Override res.json to intercept successful responses
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  res.json = function (body: any): Response {
    // Only log if response was successful
    if (res.statusCode >= 200 && res.statusCode < 300 && body.success !== false) {
      const userId = req.userId;
      const pagesConverted = req.pagesInFile || 1;
      const fileName = req.file?.originalname || 'unknown';

      if (userId) {
        // Log conversion asynchronously
        db.logConversion(userId, fileName, pagesConverted).then(() => {
          console.log(`Logged conversion: ${fileName} (${pagesConverted} pages) for user ${userId}`);
        }).catch(err => {
          console.error('Error logging conversion:', err);
        });

        // Add usage info to response (fetch user asynchronously)
        db.getUserById(userId).then(user => {
          if (user) {
            body.usage = {
              pagesUsed: user.pagesUsed,
              pagesLimit: user.pagesLimit,
              pagesRemaining: user.pagesLimit! - user.pagesUsed!,
              plan: user.plan,
            };
          }
        }).catch(err => {
          console.error('Error fetching user for usage info:', err);
        });
      }
    }

    // Call original json function
    return originalJson(body);
  };

  next();
}
