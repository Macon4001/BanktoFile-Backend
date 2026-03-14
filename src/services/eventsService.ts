import { pool } from '../db/postgres.js';

// Event interface
export interface Event {
  id: string;
  session_id: string;
  event_name: string;
  metadata?: Record<string, unknown>;
  user_id?: string;
  user_email?: string;
  created_at: Date;
}

// Event summary interface
export interface EventSummary {
  event_name: string;
  count: number;
}

// Time period event summary
export interface EventSummaryByPeriod {
  today: EventSummary[];
  this_week: EventSummary[];
  all_time: EventSummary[];
}

// Funnel data interface
export interface FunnelData {
  event_name: string;
  count: number;
  percentage: number;
}

export class EventsService {
  /**
   * Create a new event
   */
  async createEvent(
    sessionId: string,
    eventName: string,
    metadata?: Record<string, unknown>,
    userId?: string,
    userEmail?: string
  ): Promise<Event> {
    const client = await pool.connect();
    try {
      const result = await client.query<Event>(
        `INSERT INTO events (session_id, event_name, metadata, user_id, user_email)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [
          sessionId,
          eventName,
          metadata ? JSON.stringify(metadata) : null,
          userId || null,
          userEmail || null
        ]
      );
      return result.rows[0];
    } finally {
      client.release();
    }
  }

  /**
   * Get event summary grouped by event_name for different time periods
   */
  async getEventSummary(): Promise<EventSummaryByPeriod> {
    const client = await pool.connect();
    try {
      // Today's events
      const todayResult = await client.query<EventSummary>(
        `SELECT event_name, COUNT(*) as count
         FROM events
         WHERE created_at >= CURRENT_DATE
         GROUP BY event_name
         ORDER BY count DESC`
      );

      // This week's events (last 7 days)
      const weekResult = await client.query<EventSummary>(
        `SELECT event_name, COUNT(*) as count
         FROM events
         WHERE created_at >= NOW() - INTERVAL '7 days'
         GROUP BY event_name
         ORDER BY count DESC`
      );

      // All time events
      const allTimeResult = await client.query<EventSummary>(
        `SELECT event_name, COUNT(*) as count
         FROM events
         GROUP BY event_name
         ORDER BY count DESC`
      );

      return {
        today: todayResult.rows.map(row => ({
          event_name: row.event_name,
          count: parseInt(row.count as unknown as string)
        })),
        this_week: weekResult.rows.map(row => ({
          event_name: row.event_name,
          count: parseInt(row.count as unknown as string)
        })),
        all_time: allTimeResult.rows.map(row => ({
          event_name: row.event_name,
          count: parseInt(row.count as unknown as string)
        }))
      };
    } finally {
      client.release();
    }
  }

  /**
   * Get recent events (last 100) with user information
   */
  async getRecentEvents(limit: number = 100): Promise<Event[]> {
    const client = await pool.connect();
    try {
      const result = await client.query<Event>(
        `SELECT
          e.*,
          u.name as user_name
         FROM events e
         LEFT JOIN users u ON e.user_id = u.id
         ORDER BY e.created_at DESC
         LIMIT $1`,
        [limit]
      );
      return result.rows;
    } finally {
      client.release();
    }
  }

  /**
   * Get funnel data with percentages
   * Funnel: page_view → upload_started → conversion_started → conversion_completed → conversion_failed → payment_completed
   */
  async getFunnelData(): Promise<FunnelData[]> {
    const client = await pool.connect();
    try {
      // Get counts for each funnel stage
      const funnelEvents = ['page_view', 'upload_started', 'conversion_started', 'conversion_completed', 'conversion_failed', 'payment_completed'];

      const result = await client.query<{ event_name: string; count: string }>(
        `SELECT event_name, COUNT(*) as count
         FROM events
         WHERE event_name = ANY($1)
         GROUP BY event_name`,
        [funnelEvents]
      );

      // Create a map for easy lookup
      const eventCounts = new Map<string, number>();
      result.rows.forEach(row => {
        eventCounts.set(row.event_name, parseInt(row.count));
      });

      // Calculate percentages based on page_view as the baseline (100%)
      const baselineCount = eventCounts.get('page_view') || 0;

      const funnelData: FunnelData[] = funnelEvents.map(eventName => {
        const count = eventCounts.get(eventName) || 0;
        const percentage = baselineCount > 0 ? (count / baselineCount) * 100 : 0;

        return {
          event_name: eventName,
          count,
          percentage: Math.round(percentage * 100) / 100 // Round to 2 decimal places
        };
      });

      return funnelData;
    } finally {
      client.release();
    }
  }

  /**
   * Get events by session ID
   */
  async getEventsBySession(sessionId: string): Promise<Event[]> {
    const client = await pool.connect();
    try {
      const result = await client.query<Event>(
        `SELECT *
         FROM events
         WHERE session_id = $1
         ORDER BY created_at ASC`,
        [sessionId]
      );
      return result.rows;
    } finally {
      client.release();
    }
  }

  /**
   * Get unique session count for a time period
   */
  async getUniqueSessionCount(days?: number): Promise<number> {
    const client = await pool.connect();
    try {
      let query = 'SELECT COUNT(DISTINCT session_id) as count FROM events';
      const params: number[] = [];

      if (days) {
        query += ' WHERE created_at >= NOW() - INTERVAL \'$1 days\'';
        params.push(days);
      }

      const result = await client.query<{ count: string }>(query, params);
      return parseInt(result.rows[0].count);
    } finally {
      client.release();
    }
  }

  /**
   * Get time-series data for events (last 7 days)
   */
  async getTimeSeriesData(days: number = 7): Promise<Array<{ date: string; count: number; event_name?: string }>> {
    const client = await pool.connect();
    try {
      const result = await client.query<{ date: string; count: string }>(
        `SELECT
          DATE(created_at) as date,
          COUNT(*) as count
         FROM events
         WHERE created_at >= NOW() - INTERVAL '${days} days'
         GROUP BY DATE(created_at)
         ORDER BY date ASC`
      );

      return result.rows.map(row => ({
        date: row.date,
        count: parseInt(row.count)
      }));
    } finally {
      client.release();
    }
  }

  /**
   * Get event distribution (pie chart data)
   */
  async getEventDistribution(): Promise<Array<{ event_name: string; count: number; percentage: number }>> {
    const client = await pool.connect();
    try {
      // Try to get data from last 7 days first
      let totalResult = await client.query<{ total: string }>(
        'SELECT COUNT(*) as total FROM events WHERE created_at >= NOW() - INTERVAL \'7 days\''
      );
      let total = parseInt(totalResult.rows[0].total);
      let whereClause = "WHERE created_at >= NOW() - INTERVAL '7 days'";

      // If no data in last 7 days, get all-time data
      if (total === 0) {
        totalResult = await client.query<{ total: string }>(
          'SELECT COUNT(*) as total FROM events'
        );
        total = parseInt(totalResult.rows[0].total);
        whereClause = '';
      }

      if (total === 0) {
        return [];
      }

      // Get counts by event
      const result = await client.query<{ event_name: string; count: string }>(
        `SELECT
          event_name,
          COUNT(*) as count
         FROM events
         ${whereClause}
         GROUP BY event_name
         ORDER BY count DESC
         LIMIT 10`
      );

      return result.rows.map(row => {
        const count = parseInt(row.count);
        return {
          event_name: row.event_name,
          count,
          percentage: Math.round((count / total) * 100 * 100) / 100
        };
      });
    } finally {
      client.release();
    }
  }

  /**
   * Get unique sessions over time (time-series)
   */
  async getUniqueSessionsTimeSeries(days: number = 7): Promise<Array<{ date: string; unique_sessions: number }>> {
    const client = await pool.connect();
    try {
      const result = await client.query<{ date: string; unique_sessions: string }>(
        `SELECT
          DATE(created_at) as date,
          COUNT(DISTINCT session_id) as unique_sessions
         FROM events
         WHERE created_at >= NOW() - INTERVAL '${days} days'
         GROUP BY DATE(created_at)
         ORDER BY date ASC`
      );

      return result.rows.map(row => ({
        date: row.date,
        unique_sessions: parseInt(row.unique_sessions)
      }));
    } finally {
      client.release();
    }
  }

  /**
   * Get failed conversion events with detailed error information
   */
  async getFailedConversions(limit: number = 100, offset: number = 0): Promise<Array<{
    id: string;
    session_id: string;
    error_message: string;
    error_type: string;
    file_name?: string;
    file_size?: number;
    created_at: Date;
    metadata: Record<string, unknown>;
  }>> {
    const client = await pool.connect();
    try {
      const result = await client.query(
        `SELECT
          id,
          session_id,
          metadata->>'error_message' as error_message,
          metadata->>'error_type' as error_type,
          metadata->>'file_name' as file_name,
          metadata->>'file_size' as file_size,
          metadata,
          created_at
         FROM events
         WHERE event_name = 'conversion_failed'
         ORDER BY created_at DESC
         LIMIT $1 OFFSET $2`,
        [limit, offset]
      );

      return result.rows.map(row => ({
        id: row.id,
        session_id: row.session_id,
        error_message: row.error_message || 'Unknown error',
        error_type: row.error_type || 'Unknown',
        file_name: row.file_name,
        file_size: row.file_size ? parseInt(row.file_size) : undefined,
        created_at: row.created_at,
        metadata: row.metadata
      }));
    } finally {
      client.release();
    }
  }

  /**
   * Get failed conversion statistics
   */
  async getFailedConversionStats(): Promise<{
    total_failures: number;
    failures_today: number;
    failures_this_week: number;
    common_errors: Array<{ error_type: string; count: number }>;
    failure_rate: number;
  }> {
    const client = await pool.connect();
    try {
      // Total failures
      const totalResult = await client.query<{ count: string }>(
        `SELECT COUNT(*) as count FROM events WHERE event_name = 'conversion_failed'`
      );

      // Failures today
      const todayResult = await client.query<{ count: string }>(
        `SELECT COUNT(*) as count FROM events
         WHERE event_name = 'conversion_failed'
         AND created_at >= CURRENT_DATE`
      );

      // Failures this week
      const weekResult = await client.query<{ count: string }>(
        `SELECT COUNT(*) as count FROM events
         WHERE event_name = 'conversion_failed'
         AND created_at >= NOW() - INTERVAL '7 days'`
      );

      // Common errors
      const errorsResult = await client.query<{ error_type: string; count: string }>(
        `SELECT
          COALESCE(metadata->>'error_type', 'Unknown') as error_type,
          COUNT(*) as count
         FROM events
         WHERE event_name = 'conversion_failed'
         GROUP BY metadata->>'error_type'
         ORDER BY count DESC
         LIMIT 10`
      );

      // Calculate failure rate
      const totalConversionsResult = await client.query<{ count: string }>(
        `SELECT COUNT(*) as count FROM events
         WHERE event_name IN ('conversion_completed', 'conversion_failed')`
      );

      const totalConversions = parseInt(totalConversionsResult.rows[0].count);
      const totalFailures = parseInt(totalResult.rows[0].count);
      const failureRate = totalConversions > 0 ? (totalFailures / totalConversions) * 100 : 0;

      return {
        total_failures: totalFailures,
        failures_today: parseInt(todayResult.rows[0].count),
        failures_this_week: parseInt(weekResult.rows[0].count),
        common_errors: errorsResult.rows.map(row => ({
          error_type: row.error_type,
          count: parseInt(row.count)
        })),
        failure_rate: Math.round(failureRate * 100) / 100
      };
    } finally {
      client.release();
    }
  }

  /**
   * Get error distribution over time (success vs failure)
   */
  async getErrorTimeSeries(days: number = 7): Promise<Array<{
    date: string;
    failed_count: number;
    success_count: number;
  }>> {
    const client = await pool.connect();
    try {
      const result = await client.query<{ date: string; failed_count: string; success_count: string }>(
        `SELECT
          DATE(created_at) as date,
          COUNT(*) FILTER (WHERE event_name = 'conversion_failed') as failed_count,
          COUNT(*) FILTER (WHERE event_name = 'conversion_completed') as success_count
         FROM events
         WHERE event_name IN ('conversion_failed', 'conversion_completed')
         AND created_at >= NOW() - INTERVAL '${days} days'
         GROUP BY DATE(created_at)
         ORDER BY date ASC`
      );

      return result.rows.map(row => ({
        date: row.date,
        failed_count: parseInt(row.failed_count) || 0,
        success_count: parseInt(row.success_count) || 0
      }));
    } finally {
      client.release();
    }
  }

  /**
   * Get pricing page view counts
   */
  async getPricingPageViews(): Promise<{
    today: number;
    total: number;
  }> {
    const client = await pool.connect();
    try {
      // Count today's pricing page views
      // Look for page_view events with metadata.page = 'pricing_page'
      const todayResult = await client.query<{ count: string }>(
        `SELECT COUNT(*) as count
         FROM events
         WHERE event_name = 'page_view'
         AND metadata->>'page' = 'pricing_page'
         AND created_at >= CURRENT_DATE`
      );

      // Count total pricing page views
      const totalResult = await client.query<{ count: string }>(
        `SELECT COUNT(*) as count
         FROM events
         WHERE event_name = 'page_view'
         AND metadata->>'page' = 'pricing_page'`
      );

      return {
        today: parseInt(todayResult.rows[0].count),
        total: parseInt(totalResult.rows[0].count)
      };
    } finally {
      client.release();
    }
  }
}

// Export singleton instance
export const eventsService = new EventsService();
