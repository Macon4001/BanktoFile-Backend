import { Request, Response, NextFunction } from 'express';
import { db } from '../db/postgres.js';
import pdf from 'pdf-parse';

// Extend Express Request to include user info
declare global {
  namespace Express {
    interface Request {
      userId?: string;
      pagesInFile?: number;
    }
  }
}

/**
 * Middleware to count pages in uploaded PDF
 */
export async function countPagesMiddleware(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.file) {
      return next();
    }

    // Count pages if it's a PDF
    if (req.file.mimetype === 'application/pdf') {
      const data = await pdf(req.file.buffer);
      req.pagesInFile = data.numpages;
      console.log(`PDF has ${req.pagesInFile} pages`);
    } else {
      // CSV files count as 1 page
      req.pagesInFile = 1;
      console.log('CSV file counts as 1 page');
    }

    next();
  } catch (error) {
    console.error('Error counting pages:', error);
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
    // Get user ID from request (could be from session, cookie, or header)
    const userId = req.headers['x-user-id'] as string || req.query.userId as string;

    if (!userId) {
      // No user ID provided - create anonymous user with free tier
      const email = `anonymous_${Date.now()}@temp.local`;
      const user = await db.createUser(email);
      req.userId = user.id;
      console.log(`Created anonymous user: ${user.id}`);
      return next();
    }

    req.userId = userId;
    const user = await db.getUserById(userId);

    if (!user) {
      return res.status(404).json({
        error: 'User not found',
        code: 'USER_NOT_FOUND',
      });
    }

    const pagesNeeded = req.pagesInFile || 1;
    const canConvert = await db.canConvert(userId, pagesNeeded);

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
        error: 'Page limit exceeded',
        code: 'PAGE_LIMIT_EXCEEDED',
        pagesUsed: user.pagesUsed,
        pagesLimit: user.pagesLimit,
        pagesRemaining,
        pagesNeeded,
        plan: user.plan,
        message: `You've used ${user.pagesUsed} of your ${user.pagesLimit} monthly pages. This file requires ${pagesNeeded} page(s). Please upgrade your plan to continue.`,
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
