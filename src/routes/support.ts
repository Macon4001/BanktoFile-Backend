import express from 'express';
import {
  createSupportRequest,
  getAllSupportRequests,
  getSupportRequestsByStatus,
  getSupportRequestById,
  updateSupportRequestStatus,
  getSummaryStats,
  deleteSupportRequest,
} from '../controllers/supportController.js';
import { requireAdmin } from '../middleware/adminAuth.js';

const router = express.Router();

// Public route - anyone can submit a support request
router.post('/', createSupportRequest);

// Admin routes - require authentication and admin privileges
router.get('/admin/all', requireAdmin, getAllSupportRequests);
router.get('/admin/status/:status', requireAdmin, getSupportRequestsByStatus);
router.get('/admin/stats', requireAdmin, getSummaryStats);
router.get('/admin/:id', requireAdmin, getSupportRequestById);
router.patch('/admin/:id/status', requireAdmin, updateSupportRequestStatus);
router.delete('/admin/:id', requireAdmin, deleteSupportRequest);

export default router;
