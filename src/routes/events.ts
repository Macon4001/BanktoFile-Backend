import { Router } from 'express';
import { eventsController } from '../controllers/eventsController.js';
import { requireAdmin } from '../middleware/adminAuth.js';

const router = Router();

// Public route - Create event (no authentication required for tracking)
router.post('/', eventsController.createEvent.bind(eventsController));

// Admin routes - Protected with authentication
router.get('/admin/summary', requireAdmin, eventsController.getEventSummary.bind(eventsController));
router.get('/admin/recent', requireAdmin, eventsController.getRecentEvents.bind(eventsController));
router.get('/admin/funnel', requireAdmin, eventsController.getFunnelData.bind(eventsController));
router.get('/admin/timeseries', requireAdmin, eventsController.getTimeSeriesData.bind(eventsController));
router.get('/admin/distribution', requireAdmin, eventsController.getEventDistribution.bind(eventsController));
router.get('/admin/unique-sessions', requireAdmin, eventsController.getUniqueSessionsTimeSeries.bind(eventsController));
router.get('/admin/failed-conversions', requireAdmin, eventsController.getFailedConversions.bind(eventsController));
router.get('/admin/failed-conversions/stats', requireAdmin, eventsController.getFailedConversionStats.bind(eventsController));
router.get('/admin/failed-conversions/timeline', requireAdmin, eventsController.getErrorTimeSeries.bind(eventsController));
router.get('/admin/pricing-views', requireAdmin, eventsController.getPricingPageViews.bind(eventsController));
router.get('/admin/session/:sessionId', requireAdmin, eventsController.getEventsBySession.bind(eventsController));

export default router;
