import { Router, Request, Response } from 'express';
import { sendBankRequestAdminEmail, sendBankRequestUserEmail } from '../services/emailService.js';
import { PostgresStore } from '../db/postgres.js';
import { brevoEmailService } from '../services/brevoEmailService.js';

const router = Router();

interface BankRequestData {
  bankName: string;
  email: string;
  notes?: string;
  userId?: string; // Optional: if user is logged in
}

// POST /api/bank-request - Handle bank support requests
router.post('/', async (req: Request, res: Response) => {
  try {
    const { bankName, email, notes, userId }: BankRequestData = req.body;

    // Validate required fields
    if (!bankName || !email) {
      res.status(400).json({
        success: false,
        error: 'Bank name and email are required',
      });
      return;
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      res.status(400).json({
        success: false,
        error: 'Invalid email format',
      });
      return;
    }

    // Validate bank name (basic check)
    if (bankName.trim().length < 2) {
      res.status(400).json({
        success: false,
        error: 'Please provide a valid bank name',
      });
      return;
    }

    // Sanitize inputs
    const sanitizedBankName = bankName.trim();
    const sanitizedEmail = email.trim().toLowerCase();
    const sanitizedNotes = notes?.trim();

    // Store in database
    let requestId: string | undefined;
    try {
      const db = PostgresStore.getInstance();
      requestId = await db.createBankRequest({
        bankName: sanitizedBankName,
        userEmail: sanitizedEmail,
        notes: sanitizedNotes,
        userId: userId || null,
      });

      console.log(`✅ Bank request stored in database: ${requestId}`);
    } catch (dbError) {
      console.error('Failed to store bank request in database:', dbError);
      // Continue even if database fails - we'll still send emails
    }

    // Send emails in parallel (don't wait for completion)
    const emailPromises = [
      sendBankRequestAdminEmail({
        bankName: sanitizedBankName,
        userEmail: sanitizedEmail,
        notes: sanitizedNotes,
      }),
      sendBankRequestUserEmail({
        bankName: sanitizedBankName,
        userEmail: sanitizedEmail,
      }),
    ];

    // Send emails without blocking the response
    Promise.allSettled(emailPromises).then((results) => {
      results.forEach((result, index) => {
        if (result.status === 'rejected') {
          console.error(`Email ${index} failed:`, result.reason);
        }
      });
    });

    // Also send admin notification via Brevo (non-blocking)
    if (!sanitizedEmail.includes('@anonymous.local')) {
      brevoEmailService.sendAdminBankRequestNotification(
        sanitizedEmail,
        undefined, // userName not available in bank request form
        sanitizedBankName,
        sanitizedNotes
      ).catch(error => {
        console.error('Failed to send admin bank request notification via Brevo:', error);
      });
    }

    // Return success immediately
    res.status(200).json({
      success: true,
      message: `Thank you! We've received your request for ${sanitizedBankName} support. You'll receive a confirmation email shortly.`,
      requestId,
    });

  } catch (error) {
    console.error('Error processing bank request:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to submit bank request. Please try again later.',
    });
  }
});

// GET /api/bank-request/stats - Get bank request statistics (admin only)
router.get('/stats', async (req: Request, res: Response) => {
  try {
    // TODO: Add admin authentication middleware
    // For now, anyone can see stats (you might want to restrict this)

    const db = PostgresStore.getInstance();
    const stats = await db.getBankRequestStats();

    res.status(200).json({
      success: true,
      stats,
    });
  } catch (error) {
    console.error('Error fetching bank request stats:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch statistics',
    });
  }
});

// GET /api/bank-request - Get all bank requests (admin only)
router.get('/', async (req: Request, res: Response) => {
  try {
    // TODO: Add admin authentication middleware
    const status = req.query.status as string | undefined;

    const db = PostgresStore.getInstance();
    const requests = await db.getBankRequests(status);

    res.status(200).json({
      success: true,
      count: requests.length,
      requests,
    });
  } catch (error) {
    console.error('Error fetching bank requests:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch bank requests',
    });
  }
});

// PATCH /api/bank-request/:id - Update bank request status (admin only)
router.patch('/:id', async (req: Request, res: Response) => {
  try {
    // TODO: Add admin authentication middleware
    const { id } = req.params;
    const { status, adminNotes } = req.body;

    if (!status) {
      res.status(400).json({
        success: false,
        error: 'Status is required',
      });
      return;
    }

    const validStatuses = ['pending', 'in_progress', 'completed', 'rejected'];
    if (!validStatuses.includes(status)) {
      res.status(400).json({
        success: false,
        error: 'Invalid status. Must be one of: ' + validStatuses.join(', '),
      });
      return;
    }

    const db = PostgresStore.getInstance();
    await db.updateBankRequestStatus(id, status, adminNotes);

    res.status(200).json({
      success: true,
      message: 'Bank request updated successfully',
    });
  } catch (error) {
    console.error('Error updating bank request:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update bank request',
    });
  }
});

export default router;
