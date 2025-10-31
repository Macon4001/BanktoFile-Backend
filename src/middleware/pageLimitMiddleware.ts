import { Request, Response, NextFunction } from 'express';
import { db } from '../db/memoryStore.js';
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
export function checkPageLimitMiddleware(req: Request, res: Response, next: NextFunction) {
  try {
    // Get user ID from request (could be from session, cookie, or header)
    const userId = req.headers['x-user-id'] as string || req.query.userId as string;

    if (!userId) {
      // No user ID provided - create anonymous user with free tier
      const email = `anonymous_${Date.now()}@temp.local`;
      const user = db.createUser(email);
      req.userId = user.id;
      console.log(`Created anonymous user: ${user.id}`);
      return next();
    }

    req.userId = userId;
    const user = db.getUserById(userId);

    if (!user) {
      return res.status(404).json({
        error: 'User not found',
        code: 'USER_NOT_FOUND',
      });
    }

    const pagesNeeded = req.pagesInFile || 1;
    const canConvert = db.canConvert(userId, pagesNeeded);

    if (!canConvert) {
      const pagesRemaining = Math.max(0, user.pagesLimit - user.pagesUsed);
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

    console.log(`User ${userId} has ${user.pagesLimit - user.pagesUsed} pages remaining`);
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
        db.logConversion(userId, fileName, pagesConverted);
        console.log(`Logged conversion: ${fileName} (${pagesConverted} pages) for user ${userId}`);

        // Add usage info to response
        const user = db.getUserById(userId);
        if (user) {
          body.usage = {
            pagesUsed: user.pagesUsed,
            pagesLimit: user.pagesLimit,
            pagesRemaining: user.pagesLimit - user.pagesUsed,
            plan: user.plan,
          };
        }
      }
    }

    // Call original json function
    return originalJson(body);
  };

  next();
}
