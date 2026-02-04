import { pool } from '../db/postgres.js';
import { brevoEmailService } from '../services/brevoEmailService.js';

/**
 * PRIORITY 2: Send Day 3 Nudge Emails
 * Find users who signed up 3 days ago and haven't converted any files yet
 */
export async function sendDay3NudgeEmails(): Promise<void> {
  try {
    const query = `
      SELECT id, email, name, created_at
      FROM users
      WHERE nudge_email_sent = false
        AND welcome_email_sent = true
        AND created_at >= NOW() - INTERVAL '4 days'
        AND created_at <= NOW() - INTERVAL '3 days'
        AND files_used_monthly = 0
        AND email NOT LIKE '%@anonymous.local'
      LIMIT 50;
    `;

    const result = await pool.query(query);

    if (result.rows.length > 0) {
      console.log(`[Email Campaign] Found ${result.rows.length} user(s) for day 3 nudge email`);

      for (const user of result.rows) {
        try {
          await brevoEmailService.sendNudgeEmail(user.email, user.name);
          console.log(`[Email Campaign] ✅ Sent nudge email to ${user.email}`);

          // Mark as sent
          await pool.query(
            'UPDATE users SET nudge_email_sent = true WHERE id = $1',
            [user.id]
          );
        } catch (error) {
          console.error(`[Email Campaign] ❌ Failed to send nudge email to ${user.email}:`, error);
        }
      }
    }
  } catch (error) {
    console.error('[Email Campaign] Error sending day 3 nudge emails:', error);
  }
}

/**
 * PRIORITY 4: Send Day 7 Upgrade Reminder Emails
 * Find users who hit their limit 7 days ago, still on free plan, haven't upgraded
 */
export async function sendDay7UpgradeReminderEmails(): Promise<void> {
  try {
    const query = `
      SELECT id, email, name, limit_hit_at
      FROM users
      WHERE upgrade_reminder_sent = false
        AND limit_hit_email_sent = true
        AND plan = 'free'
        AND limit_hit_at IS NOT NULL
        AND limit_hit_at >= NOW() - INTERVAL '8 days'
        AND limit_hit_at <= NOW() - INTERVAL '7 days'
        AND email NOT LIKE '%@anonymous.local'
      LIMIT 50;
    `;

    const result = await pool.query(query);

    if (result.rows.length > 0) {
      console.log(`[Email Campaign] Found ${result.rows.length} user(s) for day 7 upgrade reminder`);

      for (const user of result.rows) {
        try {
          await brevoEmailService.sendUpgradeReminderEmail(user.email, user.name);
          console.log(`[Email Campaign] ✅ Sent upgrade reminder to ${user.email}`);

          // Mark as sent
          await pool.query(
            'UPDATE users SET upgrade_reminder_sent = true WHERE id = $1',
            [user.id]
          );
        } catch (error) {
          console.error(`[Email Campaign] ❌ Failed to send upgrade reminder to ${user.email}:`, error);
        }
      }
    }
  } catch (error) {
    console.error('[Email Campaign] Error sending day 7 upgrade reminders:', error);
  }
}

/**
 * Run all email campaigns
 * This function is called by the scheduler
 */
export async function runEmailCampaigns(): Promise<void> {
  console.log('[Email Campaign] Running email campaigns...');

  try {
    // Run both campaigns in parallel
    await Promise.all([
      sendDay3NudgeEmails(),
      sendDay7UpgradeReminderEmails(),
    ]);

    console.log('[Email Campaign] Email campaigns completed');
  } catch (error) {
    console.error('[Email Campaign] Error running email campaigns:', error);
  }
}

/**
 * Start the email campaign scheduler
 * Runs every 6 hours to send automated emails
 */
export function startEmailCampaignScheduler(): void {
  console.log('[Email Campaign] Starting email campaign scheduler...');
  console.log('[Email Campaign] Will run every 6 hours');

  // Run immediately on startup
  runEmailCampaigns()
    .then(() => {
      console.log('[Email Campaign] Initial campaign run completed');
    })
    .catch((error) => {
      console.error('[Email Campaign] Error in initial campaign run:', error);
    });

  // Then run every 6 hours (6 * 60 * 60 * 1000 milliseconds)
  const interval = 6 * 60 * 60 * 1000;
  setInterval(() => {
    runEmailCampaigns().catch((error) => {
      console.error('[Email Campaign] Error in scheduled campaign run:', error);
    });
  }, interval);

  console.log('[Email Campaign] Email campaign scheduler started successfully');
}

/**
 * Get email campaign statistics
 */
export async function getEmailCampaignStats(): Promise<{
  welcomeEmailsSent: number;
  nudgeEmailsSent: number;
  limitHitEmailsSent: number;
  upgradeRemindersSent: number;
  pendingNudgeEmails: number;
  pendingUpgradeReminders: number;
}> {
  try {
    const statsQuery = `
      SELECT
        COUNT(*) FILTER (WHERE welcome_email_sent = true) as welcome_emails_sent,
        COUNT(*) FILTER (WHERE nudge_email_sent = true) as nudge_emails_sent,
        COUNT(*) FILTER (WHERE limit_hit_email_sent = true) as limit_hit_emails_sent,
        COUNT(*) FILTER (WHERE upgrade_reminder_sent = true) as upgrade_reminders_sent,
        COUNT(*) FILTER (
          WHERE nudge_email_sent = false
            AND created_at <= NOW() - INTERVAL '3 days'
            AND files_used_monthly = 0
            AND email NOT LIKE '%@anonymous.local'
        ) as pending_nudge_emails,
        COUNT(*) FILTER (
          WHERE upgrade_reminder_sent = false
            AND limit_hit_at IS NOT NULL
            AND limit_hit_at <= NOW() - INTERVAL '7 days'
            AND plan = 'free'
            AND email NOT LIKE '%@anonymous.local'
        ) as pending_upgrade_reminders
      FROM users;
    `;

    const result = await pool.query(statsQuery);
    const stats = result.rows[0];

    return {
      welcomeEmailsSent: parseInt(stats.welcome_emails_sent) || 0,
      nudgeEmailsSent: parseInt(stats.nudge_emails_sent) || 0,
      limitHitEmailsSent: parseInt(stats.limit_hit_emails_sent) || 0,
      upgradeRemindersSent: parseInt(stats.upgrade_reminders_sent) || 0,
      pendingNudgeEmails: parseInt(stats.pending_nudge_emails) || 0,
      pendingUpgradeReminders: parseInt(stats.pending_upgrade_reminders) || 0,
    };
  } catch (error) {
    console.error('[Email Campaign] Error fetching campaign stats:', error);
    return {
      welcomeEmailsSent: 0,
      nudgeEmailsSent: 0,
      limitHitEmailsSent: 0,
      upgradeRemindersSent: 0,
      pendingNudgeEmails: 0,
      pendingUpgradeReminders: 0,
    };
  }
}
