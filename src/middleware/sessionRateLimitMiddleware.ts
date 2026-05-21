/**
 * Session-based rate limiting middleware
 * Prevents abuse by limiting conversions per session per day
 *
 * This works alongside IP-based rate limiting to catch users who:
 * - Rotate IP addresses
 * - Use proxies/VPNs
 * - Game the system with automated scripts
 */

import { Request, Response, NextFunction } from 'express';
import { pool } from '../db/postgres.js';

// Maximum conversions allowed per session per day for anonymous users
const MAX_CONVERSIONS_PER_SESSION_ANONYMOUS = 5;

// Maximum conversions allowed per session per day for authenticated users (more lenient)
const MAX_CONVERSIONS_PER_SESSION_AUTHENTICATED = 20;

export const sessionRateLimitMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    // Get session ID from request headers or body
    const sessionId = req.headers['x-session-id'] as string || req.body?.session_id;

    if (!sessionId) {
      // No session ID provided - allow but log warning
      console.warn('⚠️  No session ID provided for rate limiting check');
      next();
      return;
    }

    // Check if user is authenticated (has valid auth token)
    const isAuthenticated = !!req.headers.authorization;
    const maxConversions = isAuthenticated
      ? MAX_CONVERSIONS_PER_SESSION_AUTHENTICATED
      : MAX_CONVERSIONS_PER_SESSION_ANONYMOUS;

    const client = await pool.connect();
    try {
      // Count conversions for this session today
      const result = await client.query<{ count: string }>(
        `SELECT COUNT(*) as count
         FROM events
         WHERE session_id = $1
         AND event_name = 'conversion_completed'
         AND created_at >= CURRENT_DATE`,
        [sessionId]
      );

      const conversionsToday = parseInt(result.rows[0].count);

      console.log(`📊 Session ${sessionId.substring(0, 20)}... has ${conversionsToday}/${maxConversions} conversions today`);

      if (conversionsToday >= maxConversions) {
        console.warn(`🚫 Session ${sessionId} blocked: ${conversionsToday} conversions (limit: ${maxConversions})`);

        res.status(429).json({
          error: 'Session conversion limit reached',
          message: `You have reached the maximum of ${maxConversions} conversions per day for ${isAuthenticated ? 'your account' : 'free users'}. Please upgrade to a paid plan for unlimited conversions.`,
          conversions_used: conversionsToday,
          conversions_limit: maxConversions,
          reset_time: 'Tomorrow at midnight UTC',
          upgrade_url: '/pricing'
        });
        return;
      }

      // Log if approaching limit
      if (conversionsToday >= maxConversions - 2) {
        console.warn(`⚠️  Session ${sessionId} approaching limit: ${conversionsToday}/${maxConversions} conversions`);
      }

      next();
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Error in session rate limit middleware:', error);
    // On error, allow the request to continue (fail open to avoid blocking legitimate users)
    next();
  }
};

/**
 * Get session conversion stats (for admin monitoring)
 */
export const getSessionConversionStats = async (sessionId: string): Promise<{
  conversions_today: number;
  conversions_this_week: number;
  first_conversion: Date | null;
  last_conversion: Date | null;
  is_suspicious: boolean;
}> => {
  const client = await pool.connect();
  try {
    const result = await client.query<{
      conversions_today: string;
      conversions_this_week: string;
      first_conversion: Date | null;
      last_conversion: Date | null;
    }>(
      `SELECT
        COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE AND event_name = 'conversion_completed') as conversions_today,
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days' AND event_name = 'conversion_completed') as conversions_this_week,
        MIN(created_at) FILTER (WHERE event_name = 'conversion_completed') as first_conversion,
        MAX(created_at) FILTER (WHERE event_name = 'conversion_completed') as last_conversion
       FROM events
       WHERE session_id = $1`,
      [sessionId]
    );

    const row = result.rows[0];
    const conversionsToday = parseInt(row.conversions_today);
    const conversionsThisWeek = parseInt(row.conversions_this_week);

    // Flag as suspicious if more than 5 conversions today or 20+ this week
    const isSuspicious = conversionsToday > 5 || conversionsThisWeek > 20;

    return {
      conversions_today: conversionsToday,
      conversions_this_week: conversionsThisWeek,
      first_conversion: row.first_conversion,
      last_conversion: row.last_conversion,
      is_suspicious: isSuspicious
    };
  } finally {
    client.release();
  }
};

/**
 * Find suspicious sessions (for admin monitoring)
 */
export const findSuspiciousSessions = async (): Promise<Array<{
  session_id: string;
  conversions_today: number;
  total_events: number;
  first_event: Date;
  last_event: Date;
  duration_minutes: number;
  ip_addresses: string[];
}>> => {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT
        session_id,
        COUNT(*) FILTER (WHERE event_name = 'conversion_completed') as conversions_today,
        COUNT(*) as total_events,
        MIN(created_at) as first_event,
        MAX(created_at) as last_event,
        EXTRACT(EPOCH FROM (MAX(created_at) - MIN(created_at)))/60 as duration_minutes,
        ARRAY_AGG(DISTINCT ip_address) FILTER (WHERE ip_address IS NOT NULL) as ip_addresses
       FROM events
       WHERE created_at >= CURRENT_DATE
       GROUP BY session_id
       HAVING COUNT(*) FILTER (WHERE event_name = 'conversion_completed') > 5
       ORDER BY conversions_today DESC`
    );

    return result.rows.map(row => ({
      session_id: row.session_id,
      conversions_today: parseInt(row.conversions_today),
      total_events: parseInt(row.total_events),
      first_event: row.first_event,
      last_event: row.last_event,
      duration_minutes: parseFloat(row.duration_minutes),
      ip_addresses: row.ip_addresses || []
    }));
  } finally {
    client.release();
  }
};
