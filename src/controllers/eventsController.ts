import { Request, Response } from 'express';
import { eventsService } from '../services/eventsService.js';

export class EventsController {
  /**
   * POST /api/events
   * Create a new event
   */
  async createEvent(req: Request, res: Response): Promise<void> {
    try {
      const { session_id, event_name, metadata } = req.body;

      // Validate required fields
      if (!session_id || !event_name) {
        res.status(400).json({
          success: false,
          error: 'session_id and event_name are required',
        });
        return;
      }

      // Validate event_name format (alphanumeric and underscore only)
      if (!/^[a-z0-9_]+$/.test(event_name)) {
        res.status(400).json({
          success: false,
          error: 'event_name must contain only lowercase letters, numbers, and underscores',
        });
        return;
      }

      const event = await eventsService.createEvent(
        session_id,
        event_name,
        metadata
      );

      res.status(201).json({
        success: true,
        event,
      });
    } catch (error) {
      console.error('Error creating event:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to create event',
      });
    }
  }

  /**
   * GET /api/admin/events/summary
   * Get event counts grouped by event_name for today, this week, and all time
   */
  async getEventSummary(req: Request, res: Response): Promise<void> {
    try {
      const summary = await eventsService.getEventSummary();

      res.status(200).json({
        success: true,
        summary,
      });
    } catch (error) {
      console.error('Error fetching event summary:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch event summary',
      });
    }
  }

  /**
   * GET /api/admin/events/recent
   * Get the last 100 events
   */
  async getRecentEvents(req: Request, res: Response): Promise<void> {
    try {
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 100;

      // Validate limit
      if (limit < 1 || limit > 1000) {
        res.status(400).json({
          success: false,
          error: 'limit must be between 1 and 1000',
        });
        return;
      }

      const events = await eventsService.getRecentEvents(limit);

      res.status(200).json({
        success: true,
        events,
        count: events.length,
      });
    } catch (error) {
      console.error('Error fetching recent events:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch recent events',
      });
    }
  }

  /**
   * GET /api/admin/events/funnel
   * Get funnel data with percentages
   * Funnel: page_view → upload_started → conversion_completed → payment_completed
   */
  async getFunnelData(req: Request, res: Response): Promise<void> {
    try {
      const funnelData = await eventsService.getFunnelData();

      res.status(200).json({
        success: true,
        funnel: funnelData,
      });
    } catch (error) {
      console.error('Error fetching funnel data:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch funnel data',
      });
    }
  }

  /**
   * GET /api/admin/events/session/:sessionId
   * Get all events for a specific session
   */
  async getEventsBySession(req: Request, res: Response): Promise<void> {
    try {
      const { sessionId } = req.params;

      if (!sessionId) {
        res.status(400).json({
          success: false,
          error: 'sessionId is required',
        });
        return;
      }

      const events = await eventsService.getEventsBySession(sessionId);

      res.status(200).json({
        success: true,
        events,
        count: events.length,
      });
    } catch (error) {
      console.error('Error fetching events by session:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch events by session',
      });
    }
  }

  /**
   * GET /api/admin/events/timeseries
   * Get time-series data for charts
   */
  async getTimeSeriesData(req: Request, res: Response): Promise<void> {
    try {
      const days = req.query.days ? parseInt(req.query.days as string) : 7;

      if (days < 1 || days > 90) {
        res.status(400).json({
          success: false,
          error: 'days must be between 1 and 90',
        });
        return;
      }

      const data = await eventsService.getTimeSeriesData(days);

      res.status(200).json({
        success: true,
        data,
      });
    } catch (error) {
      console.error('Error fetching time series data:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch time series data',
      });
    }
  }

  /**
   * GET /api/admin/events/distribution
   * Get event distribution for pie charts
   */
  async getEventDistribution(req: Request, res: Response): Promise<void> {
    try {
      const distribution = await eventsService.getEventDistribution();

      res.status(200).json({
        success: true,
        distribution,
      });
    } catch (error) {
      console.error('Error fetching event distribution:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch event distribution',
      });
    }
  }

  /**
   * GET /api/admin/events/unique-sessions
   * Get unique sessions time-series data
   */
  async getUniqueSessionsTimeSeries(req: Request, res: Response): Promise<void> {
    try {
      const days = req.query.days ? parseInt(req.query.days as string) : 7;

      if (days < 1 || days > 90) {
        res.status(400).json({
          success: false,
          error: 'days must be between 1 and 90',
        });
        return;
      }

      const data = await eventsService.getUniqueSessionsTimeSeries(days);

      res.status(200).json({
        success: true,
        data,
      });
    } catch (error) {
      console.error('Error fetching unique sessions data:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch unique sessions data',
      });
    }
  }

  /**
   * GET /api/admin/events/failed-conversions
   * Get paginated list of failed conversions
   */
  async getFailedConversions(req: Request, res: Response): Promise<void> {
    try {
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 100;
      const offset = req.query.offset ? parseInt(req.query.offset as string) : 0;

      if (limit < 1 || limit > 500) {
        res.status(400).json({
          success: false,
          error: 'limit must be between 1 and 500',
        });
        return;
      }

      const failures = await eventsService.getFailedConversions(limit, offset);

      res.status(200).json({
        success: true,
        data: failures,
        count: failures.length,
      });
    } catch (error) {
      console.error('Error fetching failed conversions:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch failed conversions',
      });
    }
  }

  /**
   * GET /api/admin/events/failed-conversions/stats
   * Get failed conversion statistics
   */
  async getFailedConversionStats(req: Request, res: Response): Promise<void> {
    try {
      const stats = await eventsService.getFailedConversionStats();

      res.status(200).json({
        success: true,
        stats,
      });
    } catch (error) {
      console.error('Error fetching failed conversion stats:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch failed conversion stats',
      });
    }
  }

  /**
   * GET /api/admin/events/failed-conversions/timeline
   * Get error distribution over time
   */
  async getErrorTimeSeries(req: Request, res: Response): Promise<void> {
    try {
      const days = req.query.days ? parseInt(req.query.days as string) : 7;

      if (days < 1 || days > 90) {
        res.status(400).json({
          success: false,
          error: 'days must be between 1 and 90',
        });
        return;
      }

      const data = await eventsService.getErrorTimeSeries(days);

      res.status(200).json({
        success: true,
        data,
      });
    } catch (error) {
      console.error('Error fetching error timeline:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch error timeline',
      });
    }
  }

  /**
   * GET /api/admin/events/pricing-views
   * Get pricing page view counts (today and total)
   */
  async getPricingPageViews(req: Request, res: Response): Promise<void> {
    try {
      const data = await eventsService.getPricingPageViews();

      res.status(200).json({
        success: true,
        data,
      });
    } catch (error) {
      console.error('Error fetching pricing page views:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch pricing page views',
      });
    }
  }
}

// Export controller instance
export const eventsController = new EventsController();
