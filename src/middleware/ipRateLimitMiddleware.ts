import { Request, Response, NextFunction } from 'express';
import { db } from '../db/postgres.js';

// Extend Express Request to include IP info
declare module 'express-serve-static-core' {
  interface Request {
    clientIp?: string;
  }
}

/**
 * Helper function to extract the real client IP address
 * Checks for proxy headers first, then falls back to socket IP
 */
function getClientIp(req: Request): string {
  // Check various proxy headers (in order of priority)
  const forwardedFor = req.headers['x-forwarded-for'];
  if (forwardedFor) {
    // x-forwarded-for can contain multiple IPs, take the first one
    const ips = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor;
    return ips.split(',')[0].trim();
  }

  const realIp = req.headers['x-real-ip'];
  if (realIp) {
    return Array.isArray(realIp) ? realIp[0] : realIp;
  }

  const cfConnectingIp = req.headers['cf-connecting-ip']; // Cloudflare
  if (cfConnectingIp) {
    return Array.isArray(cfConnectingIp) ? cfConnectingIp[0] : cfConnectingIp;
  }

  // Fallback to socket IP
  return req.socket.remoteAddress || 'unknown';
}

/**
 * Middleware to check IP-based rate limiting for anonymous users
 * Blocks requests if an IP has exceeded the daily conversion limit (default: 3)
 * Authenticated users bypass this check
 */
export async function checkIpRateLimitMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    console.log('🔒 [IP_RATE_LIMIT] Starting IP rate limit check middleware');

    // DEVELOPMENT MODE: Skip IP rate limiting if explicitly disabled or DATABASE_URL is not set
    const skipIpLimits =
      process.env.DISABLE_LIMITS === 'true' || !process.env.DATABASE_URL;

    if (skipIpLimits) {
      console.log('⚠️  [IP_RATE_LIMIT] IP rate limiting disabled (development mode)');
      return next();
    }

    // Get user ID from request (if authenticated)
    const userId = (req.headers['x-user-id'] as string) || (req.query.userId as string);

    // If user is authenticated, skip IP-based rate limiting
    // (they have their own usage limits)
    if (userId) {
      console.log(`✅ [IP_RATE_LIMIT] Authenticated user ${userId} - skipping IP check`);
      return next();
    }

    // Get client IP address
    const clientIp = getClientIp(req);
    req.clientIp = clientIp;

    console.log(`🔒 [IP_RATE_LIMIT] Checking IP: ${clientIp}`);

    // Check if IP can convert
    const dailyLimit = 3; // Free tier gets 3 conversions per day per IP
    const canConvert = await db.canConvertByIp(clientIp, dailyLimit);
    const currentCount = await db.getIpConversionCount(clientIp);

    console.log(`🔒 [IP_RATE_LIMIT] IP ${clientIp}: ${currentCount}/${dailyLimit} conversions today`);

    if (!canConvert) {
      console.log(`🚫 [IP_RATE_LIMIT] BLOCKING: IP ${clientIp} has exceeded daily limit (${currentCount}/${dailyLimit})`);

      return res.status(403).json({
        error: 'Daily conversion limit exceeded',
        code: 'IP_RATE_LIMIT_EXCEEDED',
        conversionsUsed: currentCount,
        dailyLimit: dailyLimit,
        message: `You've used all ${dailyLimit} free conversions for today. Create an account or upgrade to continue converting unlimited files.`,
        resetTime: 'midnight UTC',
      });
    }

    console.log(`✅ [IP_RATE_LIMIT] IP ${clientIp} passed rate limit check (${currentCount}/${dailyLimit})`);
    next();
  } catch (error) {
    console.error('❌ [IP_RATE_LIMIT] Error in IP rate limit middleware:', error);
    // On error, allow the request to proceed (fail open)
    // This prevents rate limiting issues from breaking the entire service
    console.warn('⚠️  [IP_RATE_LIMIT] Allowing request due to error (fail open)');
    next();
  }
}

/**
 * Middleware to log IP-based conversions after successful processing
 * This should be called after the file is processed successfully
 * Only logs for anonymous users (authenticated users are tracked separately)
 */
export function logIpConversionMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
) {
  // Store original json function
  const originalJson = res.json.bind(res);

  // Override res.json to intercept successful responses
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  res.json = function (body: any): Response {
    // Only log if response was successful and user is anonymous
    if (res.statusCode >= 200 && res.statusCode < 300 && body.success !== false) {
      const userId = req.userId;
      const clientIp = req.clientIp || getClientIp(req);

      // Only track IP conversions for anonymous users
      if (!userId && clientIp) {
        console.log(`📊 [IP_RATE_LIMIT] Logging conversion for IP: ${clientIp}`);

        // Increment IP conversion count asynchronously
        db.incrementIpConversionCount(clientIp)
          .then(async () => {
            const newCount = await db.getIpConversionCount(clientIp);
            console.log(`✅ [IP_RATE_LIMIT] IP ${clientIp} now has ${newCount} conversions today`);
          })
          .catch((err) => {
            console.error('❌ [IP_RATE_LIMIT] Error logging IP conversion:', err);
          });
      }
    }

    // Call original json function
    return originalJson(body);
  };

  next();
}
