import express, { Request, Response } from 'express';
import { db } from '../db/postgres.js';
import { requireAdmin } from '../middleware/adminAuth.js';

const router = express.Router();

// POST /api/feedback - Submit user feedback (public endpoint)
router.post('/feedback', async (req: Request, res: Response) => {
  try {
    const { session_id, rating, comment, email, bank_name } = req.body;

    // Validate required fields
    if (!rating || !['positive', 'negative'].includes(rating)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid rating. Must be "positive" or "negative"',
      });
    }

    // Validate email is provided
    if (!email || !email.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Email is required',
      });
    }

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
      return res.status(400).json({
        success: false,
        error: 'Invalid email address',
      });
    }

    // Create feedback
    const feedback = await db.createFeedback({
      sessionId: session_id || null,
      rating: rating as 'positive' | 'negative',
      comment: comment || null,
      email: email.trim(),
      bankName: bank_name || null,
    });

    res.json({
      success: true,
      message: 'Feedback submitted successfully',
      feedback: {
        id: feedback.id,
        rating: feedback.rating,
        created_at: feedback.created_at,
      },
    });
  } catch (error) {
    console.error('Error submitting feedback:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to submit feedback',
    });
  }
});

// GET /api/admin/feedback - Get all feedback with stats (admin only)
router.get('/admin/feedback', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { filter } = req.query;
    const dateFilter = filter as 'today' | 'week' | 'all' | undefined;

    // Get all feedback
    const allFeedback = await db.getAllFeedback(dateFilter || 'all');

    // Get summary stats
    const summary = await db.getFeedbackSummary(dateFilter || 'all');

    // Get recent comments (last 20)
    const recentComments = allFeedback
      .filter(f => f.comment && f.comment.trim() !== '')
      .slice(0, 20);

    res.json({
      success: true,
      data: {
        feedback: allFeedback,
        summary: {
          positive_count: summary.positive_count,
          negative_count: summary.negative_count,
          total_count: summary.total_count,
        },
        recent_comments: recentComments,
      },
    });
  } catch (error) {
    console.error('Error fetching feedback:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch feedback',
    });
  }
});

// GET /api/admin/feedback/summary - Get feedback summary stats (admin only)
router.get('/admin/feedback/summary', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { filter } = req.query;
    const dateFilter = filter as 'today' | 'week' | 'all' | undefined;

    const summary = await db.getFeedbackSummary(dateFilter || 'week');

    res.json({
      success: true,
      data: {
        positive_count: summary.positive_count,
        negative_count: summary.negative_count,
        total_count: summary.total_count,
        filter: dateFilter || 'week',
      },
    });
  } catch (error) {
    console.error('Error fetching feedback summary:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch feedback summary',
    });
  }
});

export default router;
