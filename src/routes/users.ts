import { Router, Request, Response } from 'express';
import { requireAdmin } from '../middleware/adminAuth.js';
import { db, pool } from '../db/postgres.js';
import { getEmailCampaignStats } from '../jobs/emailCampaigns.js';

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

/**
 * Export all database data to markdown
 * Downloads a comprehensive markdown file with all data and figures
 */
router.get('/admin/export-database', requireAdmin, async (_req: Request, res: Response) => {
  try {
    const client = await pool.connect();

    try {
      // Generate markdown content
      let markdown = '# BankToFile Database Export\n\n';
      markdown += `**Export Date:** ${new Date().toISOString()}\n\n`;
      markdown += '---\n\n';

      // 1. Summary Statistics
      markdown += '## 📊 Summary Statistics\n\n';
      const summary = await db.getUserAnalyticsSummary();
      markdown += `- **Total Users:** ${summary.total_users}\n`;
      markdown += `- **Subscribed Users:** ${summary.subscribed_users}\n`;
      markdown += `- **Free Users:** ${summary.free_users}\n`;
      markdown += `- **Anonymous Users:** ${summary.anonymous_users}\n`;
      markdown += `- **Active Subscriptions:** ${summary.active_subscriptions}\n`;
      markdown += `- **New Users Today:** ${summary.new_users_today}\n`;
      markdown += `- **New Users This Week:** ${summary.new_users_this_week}\n`;
      markdown += `- **Total Conversions:** ${summary.total_conversions}\n`;
      markdown += `- **Total Pages Converted:** ${summary.total_pages_converted}\n`;
      markdown += `- **Monthly Recurring Revenue (MRR):** £${summary.total_mrr}\n\n`;

      // 2. Plan Distribution
      markdown += '## 💳 Plan Distribution\n\n';
      const planDist = await db.getPlanDistribution();
      markdown += '| Plan | Users | Percentage | MRR |\n';
      markdown += '|------|-------|------------|-----|\n';
      planDist.forEach(plan => {
        markdown += `| ${plan.plan} | ${plan.count} | ${plan.percentage}% | £${plan.mrr} |\n`;
      });
      markdown += '\n';

      // 3. All Users
      markdown += '## 👥 All Users\n\n';
      const allUsers = await db.getAllUsers();
      markdown += `**Total:** ${allUsers.length} users\n\n`;
      markdown += '| Email | Name | Plan | Status | Files Used | Files Limit | Created At |\n';
      markdown += '|-------|------|------|--------|------------|-------------|------------|\n';
      allUsers.forEach(user => {
        const email = user.email.includes('@anonymous.local') ? '[Anonymous]' : user.email;
        const name = user.name || '-';
        const status = user.subscription_status || 'N/A';
        const filesUsed = user.plan === 'free' ? user.pages_used_today : user.files_used_monthly;
        const filesLimit = user.plan === 'free' ? user.daily_pages_limit : user.monthly_files_limit;
        markdown += `| ${email} | ${name} | ${user.plan} | ${status} | ${filesUsed} | ${filesLimit} | ${new Date(user.created_at).toLocaleDateString()} |\n`;
      });
      markdown += '\n';

      // 4. Blog Posts
      markdown += '## 📝 Blog Posts\n\n';
      const blogPosts = await db.getAllBlogPosts();
      markdown += `**Total:** ${blogPosts.length} posts\n\n`;
      markdown += '| Title | Slug | Status | Category | Published At | Views |\n';
      markdown += '|-------|------|--------|----------|--------------|-------|\n';
      for (const post of blogPosts) {
        const publishedAt = post.published_at ? new Date(post.published_at).toLocaleDateString() : 'N/A';
        // Get view count (handle if table doesn't exist)
        let views = 0;
        try {
          const viewResult = await client.query(
            'SELECT view_count FROM blog_post_views WHERE blog_post_id = $1',
            [post.id]
          );
          views = viewResult.rows[0]?.view_count || 0;
        } catch {
          // Table doesn't exist, skip view count
          views = 0;
        }
        markdown += `| ${post.title} | ${post.slug} | ${post.status} | ${post.category || 'N/A'} | ${publishedAt} | ${views} |\n`;
      }
      markdown += '\n';

      // 5. Bank Requests
      markdown += '## 🏦 Bank Requests\n\n';
      const bankRequests = await db.getBankRequests();
      markdown += `**Total:** ${bankRequests.length} requests\n\n`;

      const bankStats = await db.getBankRequestStats();
      markdown += '### Top Requested Banks\n\n';
      markdown += '| Bank Name | Total Requests | Unique Users | Pending | Completed |\n';
      markdown += '|-----------|----------------|--------------|---------|----------|\n';
      bankStats.forEach(stat => {
        markdown += `| ${stat.bank_name} | ${stat.request_count} | ${stat.unique_users} | ${stat.pending_count} | ${stat.completed_count} |\n`;
      });
      markdown += '\n';

      // 6. Feedback Summary
      markdown += '## 💬 Feedback Summary\n\n';
      const feedbackAll = await db.getFeedbackSummary('all');
      const feedbackWeek = await db.getFeedbackSummary('week');
      const feedbackToday = await db.getFeedbackSummary('today');

      markdown += '| Period | Positive | Negative | Total | Satisfaction Rate |\n';
      markdown += '|--------|----------|----------|-------|-------------------|\n';
      const allSat = feedbackAll.total_count > 0 ? ((feedbackAll.positive_count / feedbackAll.total_count) * 100).toFixed(1) : '0';
      const weekSat = feedbackWeek.total_count > 0 ? ((feedbackWeek.positive_count / feedbackWeek.total_count) * 100).toFixed(1) : '0';
      const todaySat = feedbackToday.total_count > 0 ? ((feedbackToday.positive_count / feedbackToday.total_count) * 100).toFixed(1) : '0';
      markdown += `| All Time | ${feedbackAll.positive_count} | ${feedbackAll.negative_count} | ${feedbackAll.total_count} | ${allSat}% |\n`;
      markdown += `| Last 7 Days | ${feedbackWeek.positive_count} | ${feedbackWeek.negative_count} | ${feedbackWeek.total_count} | ${weekSat}% |\n`;
      markdown += `| Today | ${feedbackToday.positive_count} | ${feedbackToday.negative_count} | ${feedbackToday.total_count} | ${todaySat}% |\n`;
      markdown += '\n';

      // 7. Recent Feedback Comments
      markdown += '### Recent Feedback Comments\n\n';
      const recentFeedback = await db.getRecentFeedback(20);
      markdown += '| Date | Rating | Bank | Comment | Email |\n';
      markdown += '|------|--------|------|---------|-------|\n';
      recentFeedback.forEach(fb => {
        const comment = fb.comment ? fb.comment.substring(0, 50) + (fb.comment.length > 50 ? '...' : '') : '-';
        const email = fb.email || '-';
        const bank = fb.bank_name || '-';
        markdown += `| ${new Date(fb.created_at).toLocaleDateString()} | ${fb.rating === 'positive' ? '👍' : '👎'} | ${bank} | ${comment} | ${email} |\n`;
      });
      markdown += '\n';

      // 8. Newsletter Subscribers
      markdown += '## 📧 Newsletter Subscribers\n\n';
      const subscribers = await db.getNewsletterSubscribers();
      markdown += `**Total Active Subscribers:** ${subscribers.length}\n\n`;

      // 9. Conversion Logs Summary
      markdown += '## 📈 Conversion Activity\n\n';
      const conversionStats = await client.query(`
        SELECT
          DATE(timestamp) as date,
          COUNT(*)::integer as conversions,
          SUM(pages_converted)::integer as pages,
          COUNT(DISTINCT user_id)::integer as unique_users
        FROM conversion_logs
        WHERE timestamp >= CURRENT_DATE - INTERVAL '30 days'
        GROUP BY DATE(timestamp)
        ORDER BY date DESC
        LIMIT 30
      `);
      markdown += '### Last 30 Days Activity\n\n';
      markdown += '| Date | Conversions | Pages Converted | Unique Users |\n';
      markdown += '|------|-------------|-----------------|-------------|\n';
      conversionStats.rows.forEach(stat => {
        markdown += `| ${new Date(stat.date).toLocaleDateString()} | ${stat.conversions} | ${stat.pages} | ${stat.unique_users} |\n`;
      });
      markdown += '\n';

      // 10. Support Tickets Summary
      markdown += '## 🎫 Support Tickets\n\n';
      try {
        const supportStats = await client.query(`
          SELECT
            status,
            COUNT(*)::integer as count
          FROM support_tickets
          GROUP BY status
          ORDER BY count DESC
        `);
        if (supportStats.rows.length > 0) {
          markdown += '| Status | Count |\n';
          markdown += '|--------|-------|\n';
          supportStats.rows.forEach(stat => {
            markdown += `| ${stat.status} | ${stat.count} |\n`;
          });
          markdown += '\n';
        } else {
          markdown += '*No support tickets found*\n\n';
        }
      } catch {
        // Table doesn't exist
        markdown += '*Support tickets table not found*\n\n';
      }

      // Footer
      markdown += '---\n\n';
      markdown += `*Export generated on ${new Date().toLocaleString()}*\n`;

      // Set response headers for file download
      const filename = `banktofile-db-export-${new Date().toISOString().split('T')[0]}.md`;
      res.setHeader('Content-Type', 'text/markdown');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(markdown);

    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Error exporting database:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to export database data',
    });
  }
});

/**
 * Get email campaign statistics
 * Returns summary stats for all email campaigns
 */
router.get('/admin/email-campaigns/stats', requireAdmin, async (_req: Request, res: Response) => {
  try {
    const stats = await getEmailCampaignStats();

    res.json({
      success: true,
      stats,
    });
  } catch (error) {
    console.error('Error fetching email campaign stats:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch email campaign stats',
    });
  }
});

/**
 * Get users with email campaign status
 * Query params:
 *   - emailType: 'all' | 'welcome' | 'nudge' | 'limitHit' | 'upgradeReminder'
 *   - search: string (email search)
 *   - limit: number (default: 50)
 *   - offset: number (default: 0)
 */
router.get('/admin/email-campaigns/users', requireAdmin, async (req: Request, res: Response) => {
  try {
    const emailType = (req.query.emailType as string) || 'all';
    const search = req.query.search as string;
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;

    let whereClause = "email NOT LIKE '%@anonymous.local'";

    // Filter by email type
    if (emailType === 'welcome') {
      whereClause += ' AND welcome_email_sent = true';
    } else if (emailType === 'nudge') {
      whereClause += ' AND nudge_email_sent = true';
    } else if (emailType === 'limitHit') {
      whereClause += ' AND limit_hit_email_sent = true';
    } else if (emailType === 'upgradeReminder') {
      whereClause += ' AND upgrade_reminder_sent = true';
    }

    // Search by email
    if (search) {
      whereClause += ` AND email ILIKE '%${search}%'`;
    }

    const query = `
      SELECT
        id, email, name, plan,
        welcome_email_sent, nudge_email_sent,
        limit_hit_email_sent, upgrade_reminder_sent,
        limit_hit_at, last_conversion_at, created_at,
        files_used_monthly
      FROM users
      WHERE ${whereClause}
      ORDER BY created_at DESC
      LIMIT $1 OFFSET $2
    `;

    const countQuery = `
      SELECT COUNT(*)::integer as total
      FROM users
      WHERE ${whereClause}
    `;

    const [usersResult, countResult] = await Promise.all([
      pool.query(query, [limit, offset]),
      pool.query(countQuery),
    ]);

    res.json({
      success: true,
      users: usersResult.rows,
      total: countResult.rows[0].total,
      limit,
      offset,
    });
  } catch (error) {
    console.error('Error fetching email campaign users:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch email campaign users',
    });
  }
});

/**
 * Get recent email activity
 * Returns chronological log of sent emails
 */
router.get('/admin/email-campaigns/recent', requireAdmin, async (_req: Request, res: Response) => {
  try {
    const query = `
      WITH email_events AS (
        SELECT
          id, email, name, created_at,
          'welcome' as email_type,
          created_at as sent_at,
          welcome_email_sent as was_sent
        FROM users
        WHERE welcome_email_sent = true

        UNION ALL

        SELECT
          id, email, name, created_at,
          'nudge' as email_type,
          created_at + INTERVAL '3 days' as sent_at,
          nudge_email_sent as was_sent
        FROM users
        WHERE nudge_email_sent = true

        UNION ALL

        SELECT
          id, email, name, created_at,
          'limit_hit' as email_type,
          limit_hit_at as sent_at,
          limit_hit_email_sent as was_sent
        FROM users
        WHERE limit_hit_email_sent = true AND limit_hit_at IS NOT NULL

        UNION ALL

        SELECT
          id, email, name, created_at,
          'upgrade_reminder' as email_type,
          limit_hit_at + INTERVAL '7 days' as sent_at,
          upgrade_reminder_sent as was_sent
        FROM users
        WHERE upgrade_reminder_sent = true
      )
      SELECT * FROM email_events
      WHERE email NOT LIKE '%@anonymous.local'
      ORDER BY sent_at DESC
      LIMIT 100
    `;

    const result = await pool.query(query);

    res.json({
      success: true,
      recent: result.rows,
    });
  } catch (error) {
    console.error('Error fetching recent email activity:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch recent email activity',
    });
  }
});

export default router;
