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
router.get('/admin/session/:sessionId', requireAdmin, eventsController.getEventsBySession.bind(eventsController));

export default router;
