import { Router, Request, Response } from 'express';
import { requireAdmin } from '../middleware/adminAuth.js';
import { db } from '../db/postgres.js';

const router = Router();

/**
 * Get user analytics data
 * Query params:
 *   - includeAnonymous: boolean (default: false)
 *   - plan: string (optional filter by plan)
 *   - subscriptionStatus: string (optional filter by subscription status)
 *   - limit: number (default: 50)
 *   - offset: number (default: 0)
 */
router.get('/admin/analytics', requireAdmin, async (req: Request, res: Response) => {
  try {
    const includeAnonymous = req.query.includeAnonymous === 'true';
    const plan = req.query.plan as string | undefined;
    const subscriptionStatus = req.query.subscriptionStatus as string | undefined;
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;

    const result = await db.getUserAnalytics({
      includeAnonymous,
      plan,
      subscriptionStatus,
      limit,
      offset,
    });

    res.json({
      success: true,
      ...result,
    });
  } catch (error) {
    console.error('Error fetching user analytics:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch user analytics',
    });
  }
});

/**
 * Get user analytics summary stats
 */
router.get('/admin/analytics/summary', requireAdmin, async (req: Request, res: Response) => {
  try {
    const summary = await db.getUserAnalyticsSummary();

    res.json({
      success: true,
      summary,
    });
  } catch (error) {
    console.error('Error fetching user analytics summary:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch user analytics summary',
    });
  }
});

/**
 * Get plan distribution stats
 */
router.get('/admin/analytics/plan-distribution', requireAdmin, async (req: Request, res: Response) => {
  try {
    const distribution = await db.getPlanDistribution();

    res.json({
      success: true,
      distribution,
    });
  } catch (error) {
    console.error('Error fetching plan distribution:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch plan distribution',
    });
  }
});

/**
 * Get MRR over time
 * Query params:
 *   - days: number (default: 30)
 */
router.get('/admin/analytics/mrr-over-time', requireAdmin, async (req: Request, res: Response) => {
  try {
    const days = parseInt(req.query.days as string) || 30;
    const data = await db.getMrrOverTime(days);

    res.json({
      success: true,
      data,
    });
  } catch (error) {
    console.error('Error fetching MRR over time:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch MRR over time',
    });
  }
});

export default router;
