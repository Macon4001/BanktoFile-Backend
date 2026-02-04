import { Router, Request, Response } from 'express';
import { brevoEmailService } from '../services/brevoEmailService.js';

const router = Router();

interface ContactFormData {
  name: string;
  email: string;
  subject?: string;
  message: string;
}

// POST /api/contact - Handle contact form submissions
router.post('/', async (req: Request, res: Response) => {
  try {
    const { name, email, subject, message }: ContactFormData = req.body;

    // Validate required fields
    if (!name || !email || !message) {
      res.status(400).json({
        success: false,
        error: 'Name, email, and message are required',
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

    // Log the contact form data
    console.log('Contact form submission:', {
      name,
      email,
      subject: subject || 'No subject',
      message,
      timestamp: new Date().toISOString(),
    });

    // Send admin notification email (non-blocking)
    if (!email.includes('@anonymous.local')) {
      brevoEmailService.sendAdminContactNotification(
        name,
        email,
        message
      ).catch(error => {
        console.error('Failed to send admin contact notification:', error);
        // Don't fail the user operation if notification fails
      });
    }

    res.status(200).json({
      success: true,
      message: 'Your message has been received. We will get back to you soon!',
    });
  } catch (error) {
    console.error('Error processing contact form:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to send message. Please try again later.',
    });
  }
});

export default router;
