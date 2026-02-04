import { Router, Request, Response } from 'express';
import { requireAdmin } from '../middleware/adminAuth.js';
import { supportService } from '../services/supportService.js';
import { db } from '../db/postgres.js';
import { getEmailCampaignStats } from '../jobs/emailCampaigns.js';

const router = Router();

/**
 * Get dashboard stats for admin overview
 * Returns quick stats for each card (feedback, support, blog)
 */
router.get('/admin/stats', requireAdmin, async (req: Request, res: Response) => {
  try {
    // Fetch all stats in parallel
    const [supportStats, feedbackSummary, blogPosts, userSummary, emailStats] = await Promise.all([
      supportService.getSummaryStats(),
      db.getFeedbackSummary('week'),
      db.getAllBlogPosts(undefined, undefined, 'draft'),
      db.getUserAnalyticsSummary(),
      getEmailCampaignStats(),
    ]);

    res.json({
      success: true,
      stats: {
        // Support requests - show count of new/unresolved messages
        support: {
          newRequests: supportStats.new,
          inProgress: supportStats.in_progress,
          total: supportStats.total,
        },
        // Feedback - show count of negative reviews this week
        feedback: {
          negativeCount: feedbackSummary.negative_count,
          positiveCount: feedbackSummary.positive_count,
          totalCount: feedbackSummary.total_count,
        },
        // Blog - show count of draft posts
        blog: {
          draftCount: blogPosts.length,
        },
        // User analytics - show MRR and user counts
        users: {
          totalMrr: userSummary.total_mrr,
          subscribedUsers: userSummary.subscribed_users,
          activeSubscriptions: userSummary.active_subscriptions,
        },
        // Email campaigns - show sent/pending emails
        emailCampaigns: {
          welcomeSent: emailStats.welcomeEmailsSent,
          totalSent: emailStats.welcomeEmailsSent + emailStats.nudgeEmailsSent +
                     emailStats.limitHitEmailsSent + emailStats.upgradeRemindersSent,
          pendingToSend: emailStats.pendingNudgeEmails + emailStats.pendingUpgradeReminders,
        },
      },
    });
  } catch (error) {
    console.error('Error fetching dashboard stats:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch dashboard stats',
    });
  }
});

export default router;
