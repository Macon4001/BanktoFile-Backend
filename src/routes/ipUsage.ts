import { Router, Request, Response } from 'express';
import { db } from '../db/postgres.js';

const router = Router();

/**
 * Helper function to extract the real client IP address
 * Checks for proxy headers first, then falls back to socket IP
 */
function getClientIp(req: Request): string {
  // Check various proxy headers (in order of priority)
  const forwardedFor = req.headers['x-forwarded-for'];
  if (forwardedFor) {
    const ips = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor;
    return ips.split(',')[0].trim();
  }

  const realIp = req.headers['x-real-ip'];
  if (realIp) {
    return Array.isArray(realIp) ? realIp[0] : realIp;
  }

  const cfConnectingIp = req.headers['cf-connecting-ip'];
  if (cfConnectingIp) {
    return Array.isArray(cfConnectingIp) ? cfConnectingIp[0] : cfConnectingIp;
  }

  return req.socket.remoteAddress || 'unknown';
}

/**
 * GET /api/ip-usage - Check current IP-based usage for anonymous users
 * Returns the number of conversions used today for this IP
 */
router.get('/ip-usage', async (req: Request, res: Response) => {
  try {
    console.log('📊 [IP_USAGE] Checking IP usage');

    // Development mode: Skip IP usage check if disabled
    const skipIpLimits =
      process.env.DISABLE_LIMITS === 'true' || !process.env.DATABASE_URL;

    if (skipIpLimits) {
      console.log('⚠️  [IP_USAGE] IP tracking disabled (development mode)');
      return res.json({
        conversionsUsed: 0,
        dailyLimit: 3,
        conversionsRemaining: 3,
      });
    }

    // Get client IP
    const clientIp = getClientIp(req);
    console.log(`📊 [IP_USAGE] Checking usage for IP: ${clientIp}`);

    // Get current conversion count
    const conversionsUsed = await db.getIpConversionCount(clientIp);
    const dailyLimit = 3;
    const conversionsRemaining = Math.max(0, dailyLimit - conversionsUsed);

    console.log(`📊 [IP_USAGE] IP ${clientIp}: ${conversionsUsed}/${dailyLimit} conversions today`);

    res.json({
      conversionsUsed,
      dailyLimit,
      conversionsRemaining,
    });
  } catch (error) {
    console.error('❌ [IP_USAGE] Error checking IP usage:', error);

    // Return default values on error (fail open)
    res.json({
      conversionsUsed: 0,
      dailyLimit: 3,
      conversionsRemaining: 3,
    });
  }
});

export default router;
