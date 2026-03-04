import { pool } from '../db/postgres.js';

/**
 * Cleanup expired pending conversions
 * Runs periodically to delete conversions that have expired (older than 24 hours)
 */
export async function cleanupExpiredConversions(): Promise<void> {
  try {
    const result = await pool.query(
      'DELETE FROM pending_conversions WHERE expires_at < NOW() RETURNING id'
    );

    if (result.rowCount && result.rowCount > 0) {
      console.log(`[Cleanup] Deleted ${result.rowCount} expired pending conversion(s)`);
    }
  } catch (error) {
    console.error('[Cleanup] Error cleaning up expired conversions:', error);
  }
}

/**
 * Start the cleanup scheduler
 * Runs every hour to clean up expired pending conversions
 */
export function startCleanupScheduler(): void {
  console.log('[Cleanup] Starting pending conversions cleanup scheduler...');
  console.log('[Cleanup] Will run every hour');

  // Run immediately on startup
  cleanupExpiredConversions()
    .then(() => {
      console.log('[Cleanup] Initial cleanup completed');
    })
    .catch((error) => {
      console.error('[Cleanup] Error in initial cleanup run:', error);
    });

  // Then run every hour (60 * 60 * 1000 milliseconds)
  const interval = 60 * 60 * 1000;
  setInterval(() => {
    cleanupExpiredConversions().catch((error) => {
      console.error('[Cleanup] Error in scheduled cleanup run:', error);
    });
  }, interval);

  console.log('[Cleanup] Cleanup scheduler started successfully');
}

/**
 * Get statistics about pending conversions
 */
export async function getPendingConversionsStats(): Promise<{
  total: number;
  expired: number;
  active: number;
}> {
  try {
    const result = await pool.query(`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE expires_at < NOW()) as expired,
        COUNT(*) FILTER (WHERE expires_at >= NOW()) as active
      FROM pending_conversions
    `);

    const stats = result.rows[0];
    return {
      total: parseInt(stats.total) || 0,
      expired: parseInt(stats.expired) || 0,
      active: parseInt(stats.active) || 0,
    };
  } catch (error) {
    console.error('[Cleanup] Error fetching pending conversions stats:', error);
    return {
      total: 0,
      expired: 0,
      active: 0,
    };
  }
}
