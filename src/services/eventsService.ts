import { pool } from '../db/postgres.js';

// Event interface
export interface Event {
  id: string;
  session_id: string;
  event_name: string;
  metadata?: Record<string, unknown>;
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
    metadata?: Record<string, unknown>
  ): Promise<Event> {
    const client = await pool.connect();
    try {
      const result = await client.query<Event>(
        `INSERT INTO events (session_id, event_name, metadata)
         VALUES ($1, $2, $3)
         RETURNING *`,
        [sessionId, eventName, metadata ? JSON.stringify(metadata) : null]
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
   * Get recent events (last 100)
   */
  async getRecentEvents(limit: number = 100): Promise<Event[]> {
    const client = await pool.connect();
    try {
      const result = await client.query<Event>(
        `SELECT *
         FROM events
         ORDER BY created_at DESC
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
      // Get total count from this week
      const totalResult = await client.query<{ total: string }>(
        'SELECT COUNT(*) as total FROM events WHERE created_at >= NOW() - INTERVAL \'7 days\''
      );
      const total = parseInt(totalResult.rows[0].total);

      if (total === 0) {
        return [];
      }

      // Get counts by event
      const result = await client.query<{ event_name: string; count: string }>(
        `SELECT
          event_name,
          COUNT(*) as count
         FROM events
         WHERE created_at >= NOW() - INTERVAL '7 days'
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
}

// Export singleton instance
export const eventsService = new EventsService();
