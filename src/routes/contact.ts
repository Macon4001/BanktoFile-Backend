import { Router, Request, Response } from 'express';

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

    // TODO: Implement email sending functionality
    // Options:
    // 1. SendGrid
    // 2. AWS SES
    // 3. Nodemailer with SMTP
    // 4. Resend
    // 5. Store in database for review

    // For now, just log the contact form data
    console.log('Contact form submission:', {
      name,
      email,
      subject: subject || 'No subject',
      message,
      timestamp: new Date().toISOString(),
    });

    // TODO: Store in database (optional)
    // await db.createContactMessage({ name, email, subject, message });

    // TODO: Send email notification to support team
    // await sendEmail({
    //   to: 'Michael@banktofile.com',
    //   subject: `New Contact Form: ${subject || 'No Subject'}`,
    //   html: `
    //     <h2>New Contact Form Submission</h2>
    //     <p><strong>Name:</strong> ${name}</p>
    //     <p><strong>Email:</strong> ${email}</p>
    //     <p><strong>Subject:</strong> ${subject || 'No subject'}</p>
    //     <p><strong>Message:</strong></p>
    //     <p>${message}</p>
    //   `
    // });

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
