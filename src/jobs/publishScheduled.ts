import { Pool } from 'pg';

// Use the existing database pool from the environment
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

/**
 * Check for and publish posts that are scheduled to be published
 * Runs periodically to automatically publish posts when their scheduled time arrives
 */
export async function publishScheduledPosts(): Promise<void> {
  try {
    const query = `
      UPDATE blog_posts
      SET published = true,
          status = 'published',
          published_at = NOW(),
          auto_publish = false
      WHERE auto_publish = true
        AND scheduled_at <= NOW()
        AND published = false
      RETURNING id, title, slug, scheduled_at;
    `;

    const result = await pool.query(query);

    if (result.rows.length > 0) {
      console.log(
        `[Scheduler] Published ${result.rows.length} scheduled post(s):`
      );
      result.rows.forEach((post) => {
        console.log(
          `  - "${post.title}" (slug: ${post.slug}) - was scheduled for ${post.scheduled_at}`
        );
      });
    } else {
      // Only log when there are posts to publish to reduce noise
      // console.log('[Scheduler] No posts ready to publish');
    }
  } catch (error) {
    console.error('[Scheduler] Error publishing scheduled posts:', error);
  }
}

/**
 * Start the background job scheduler
 * Runs publishScheduledPosts immediately on startup, then every 15 minutes
 */
export function startPublishScheduler(): void {
  console.log('[Scheduler] Starting scheduled post publisher...');
  console.log('[Scheduler] Will check for posts to publish every 15 minutes');

  // Run immediately on startup
  publishScheduledPosts()
    .then(() => {
      console.log('[Scheduler] Initial check completed');
    })
    .catch((error) => {
      console.error('[Scheduler] Error in initial check:', error);
    });

  // Then run every 15 minutes (15 * 60 * 1000 milliseconds)
  const interval = 15 * 60 * 1000;
  setInterval(() => {
    publishScheduledPosts().catch((error) => {
      console.error('[Scheduler] Error in scheduled check:', error);
    });
  }, interval);

  console.log('[Scheduler] Scheduler started successfully');
}

/**
 * Get upcoming scheduled posts (for debugging/monitoring)
 */
export async function getUpcomingScheduledPosts(): Promise<Array<{
  id: string;
  title: string;
  slug: string;
  scheduled_at: Date;
}>> {
  try {
    const query = `
      SELECT id, title, slug, scheduled_at
      FROM blog_posts
      WHERE auto_publish = true
        AND published = false
        AND scheduled_at > NOW()
      ORDER BY scheduled_at ASC
      LIMIT 20;
    `;

    const result = await pool.query(query);
    return result.rows;
  } catch (error) {
    console.error('[Scheduler] Error fetching upcoming scheduled posts:', error);
    return [];
  }
}
