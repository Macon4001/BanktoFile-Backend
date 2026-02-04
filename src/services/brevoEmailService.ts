import * as brevo from '@getbrevo/brevo';

// Initialize Brevo API client
const apiInstance = new brevo.TransactionalEmailsApi();
apiInstance.setApiKey(
  brevo.TransactionalEmailsApiApiKeys.apiKey,
  process.env.BREVO_API_KEY || ''
);

interface SendEmailOptions {
  to: string;
  toName?: string;
  subject: string;
  htmlContent: string;
  textContent?: string;
}

/**
 * Brevo Email Service
 * Handles all transactional emails via Brevo (formerly Sendinblue)
 */
export class BrevoEmailService {
  private senderEmail: string;
  private senderName: string;
  private frontendUrl: string;
  private adminEmail: string;

  constructor() {
    this.senderEmail = process.env.SENDER_EMAIL || 'noreply@banktofile.com';
    this.senderName = process.env.SENDER_NAME || 'BankToFile';
    this.frontendUrl = process.env.FRONTEND_URL || 'https://www.banktofile.com';
    this.adminEmail = process.env.ADMIN_NOTIFICATION_EMAIL || 'michael@banktofile.com';
  }

  /**
   * Send a transactional email via Brevo
   */
  private async sendEmail(options: SendEmailOptions): Promise<void> {
    try {
      const sendSmtpEmail = new brevo.SendSmtpEmail();

      sendSmtpEmail.sender = { email: this.senderEmail, name: this.senderName };
      sendSmtpEmail.to = [{ email: options.to, name: options.toName || options.to }];
      sendSmtpEmail.subject = options.subject;
      sendSmtpEmail.htmlContent = options.htmlContent;
      if (options.textContent) {
        sendSmtpEmail.textContent = options.textContent;
      }

      await apiInstance.sendTransacEmail(sendSmtpEmail);
      console.log(`✅ Email sent to ${options.to}: ${options.subject}`);
    } catch (error) {
      console.error(`❌ Failed to send email to ${options.to}:`, error);
      throw error;
    }
  }

  /**
   * PRIORITY 1: Welcome Email (Immediate on signup)
   * Subject: "Your first conversion is ready"
   * Trigger: User creates account
   */
  async sendWelcomeEmail(userEmail: string, userName?: string): Promise<void> {
    const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
    .logo { width: 120px; height: auto; margin-bottom: 15px; }
    .content { background: #fff; padding: 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 10px 10px; }
    .button { display: inline-block; background: #10b981; color: white; padding: 14px 28px; text-decoration: none; border-radius: 6px; font-weight: 600; margin: 20px 0; }
    .button:hover { background: #059669; }
    .feature { margin: 15px 0; padding-left: 25px; position: relative; }
    .feature:before { content: "✓"; position: absolute; left: 0; color: #10b981; font-weight: bold; }
    .footer { text-align: center; margin-top: 30px; font-size: 14px; color: #6b7280; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <img src="${this.frontendUrl}/logo.png" alt="BankToFile" class="logo" />
      <h1 style="margin: 0; font-size: 28px;">Welcome to BankToFile!</h1>
    </div>
    <div class="content">
      <p>Hi${userName ? ` ${userName}` : ''},</p>

      <p><strong>Your first conversion is ready!</strong></p>

      <p>You have <strong>3 free conversions</strong> to get started. Convert your bank statements to Excel or CSV in seconds.</p>

      <div style="text-align: center;">
        <a href="${this.frontendUrl}" class="button">Convert Your First Statement →</a>
      </div>

      <p><strong>What you can do:</strong></p>
      <div class="feature">Convert PDF bank statements to Excel/CSV</div>
      <div class="feature">Works with all major UK banks</div>
      <div class="feature">Fast, secure, and accurate</div>
      <div class="feature">No credit card required for free conversions</div>

      <p style="margin-top: 30px;">Need help? Just reply to this email and I'll personally assist you.</p>

      <p>Happy converting!</p>
      <p style="margin-top: 25px;"><strong>The BankToFile Team</strong></p>
    </div>
    <div class="footer">
      <p>© ${new Date().getFullYear()} BankToFile. All rights reserved.</p>
      <p><a href="${this.frontendUrl}/privacy" style="color: #6b7280;">Privacy</a> | <a href="${this.frontendUrl}/terms" style="color: #6b7280;">Terms</a></p>
    </div>
  </div>
</body>
</html>
    `;

    const textContent = `
Hi${userName ? ` ${userName}` : ''},

Your first conversion is ready!

You have 3 free conversions to get started. Convert your bank statements to Excel or CSV in seconds.

Get started: ${this.frontendUrl}

What you can do:
✓ Convert PDF bank statements to Excel/CSV
✓ Works with all major UK banks
✓ Fast, secure, and accurate
✓ No credit card required for free conversions

Need help? Just reply to this email and I'll personally assist you.

Happy converting!
The BankToFile Team

© ${new Date().getFullYear()} BankToFile. All rights reserved.
    `;

    await this.sendEmail({
      to: userEmail,
      toName: userName,
      subject: 'Your first conversion is ready!',
      htmlContent,
      textContent,
    });
  }

  /**
   * PRIORITY 3: Limit Hit Email (Immediate when free limit reached)
   * Subject: "You've used your free conversions"
   * Trigger: User hits 3 free conversion limit
   */
  async sendLimitHitEmail(userEmail: string, userName?: string): Promise<void> {
    const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
    .content { background: #fff; padding: 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 10px 10px; }
    .button { display: inline-block; background: #10b981; color: white; padding: 14px 28px; text-decoration: none; border-radius: 6px; font-weight: 600; margin: 15px 0; }
    .plan-card { border: 2px solid #e5e7eb; border-radius: 8px; padding: 20px; margin: 15px 0; background: #f9fafb; }
    .plan-card.popular { border-color: #10b981; position: relative; }
    .popular-badge { background: #10b981; color: white; padding: 4px 12px; border-radius: 12px; font-size: 12px; font-weight: 600; }
    .price { font-size: 32px; font-weight: bold; color: #10b981; }
    .footer { text-align: center; margin-top: 30px; font-size: 14px; color: #6b7280; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <img src="${this.frontendUrl}/logo.png" alt="BankToFile" class="logo" />
      <h1 style="margin: 0; font-size: 28px;">You've used all 3 free conversions!</h1>
    </div>
    <div class="content">
      <p>Hi${userName ? ` ${userName}` : ''},</p>

      <p><strong>Great news!</strong> You've successfully converted 3 bank statements.</p>

      <p>Want to keep converting? Upgrade to continue:</p>

      <div class="plan-card">
        <h3 style="margin-top: 0;">Basic - £20/month</h3>
        <div class="price">£20<span style="font-size: 16px; color: #6b7280;">/month</span></div>
        <ul style="padding-left: 20px;">
          <li>30 files per month</li>
          <li>Up to 20 pages per file</li>
          <li>CSV & XLSX formats</li>
          <li>Email support</li>
        </ul>
      </div>

      <div class="plan-card popular">
        <div style="text-align: right; margin-bottom: 10px;">
          <span class="popular-badge">⭐ Most Popular</span>
        </div>
        <h3 style="margin-top: 0;">Pro - £40/month</h3>
        <div class="price">£40<span style="font-size: 16px; color: #6b7280;">/month</span></div>
        <ul style="padding-left: 20px;">
          <li><strong>400 files per month</strong></li>
          <li>Up to 50 pages per file</li>
          <li>CSV & XLSX formats</li>
          <li>Priority email support</li>
        </ul>
      </div>

      <div style="text-align: center; margin-top: 30px;">
        <a href="${this.frontendUrl}/pricing" class="button">View All Plans →</a>
      </div>

      <p style="margin-top: 30px; font-size: 14px; color: #6b7280;">Questions? Just reply to this email.</p>
    </div>
    <div class="footer">
      <p>© ${new Date().getFullYear()} BankToFile. All rights reserved.</p>
      <p><a href="${this.frontendUrl}/privacy" style="color: #6b7280;">Privacy</a> | <a href="${this.frontendUrl}/terms" style="color: #6b7280;">Terms</a></p>
    </div>
  </div>
</body>
</html>
    `;

    const textContent = `
Hi${userName ? ` ${userName}` : ''},

You've used all 3 free conversions!

Great news! You've successfully converted 3 bank statements.

Want to keep converting? Upgrade to continue:

BASIC - £20/month
• 30 files per month
• Up to 20 pages per file
• CSV & XLSX formats
• Email support

PRO - £40/month (⭐ Most Popular)
• 400 files per month
• Up to 50 pages per file
• CSV & XLSX formats
• Priority email support

View all plans: ${this.frontendUrl}/pricing

Questions? Just reply to this email.

© ${new Date().getFullYear()} BankToFile. All rights reserved.
    `;

    await this.sendEmail({
      to: userEmail,
      toName: userName,
      subject: "You've used your free conversions",
      htmlContent,
      textContent,
    });
  }

  /**
   * PRIORITY 2: Nudge Email (Day 3, no conversions)
   * Subject: "Need help with your first conversion?"
   * Trigger: User signed up 3 days ago AND files_used = 0
   */
  async sendNudgeEmail(userEmail: string, userName?: string): Promise<void> {
    const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
    .content { background: #fff; padding: 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 10px 10px; }
    .button { display: inline-block; background: #10b981; color: white; padding: 14px 28px; text-decoration: none; border-radius: 6px; font-weight: 600; margin: 15px 0; }
    .help-box { background: #f0fdf4; border-left: 4px solid #10b981; padding: 15px; margin: 20px 0; }
    .footer { text-align: center; margin-top: 30px; font-size: 14px; color: #6b7280; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1 style="margin: 0; font-size: 28px;">Need help with your first conversion?</h1>
    </div>
    <div class="content">
      <p>Hi${userName ? ` ${userName}` : ''},</p>

      <p>I noticed you signed up for BankToFile a few days ago but haven't converted a statement yet.</p>

      <p><strong>Is everything okay?</strong> Sometimes people get stuck on:</p>

      <ul style="padding-left: 25px;">
        <li>Finding the right PDF file</li>
        <li>Understanding which formats we support</li>
        <li>Navigating the upload process</li>
      </ul>

      <div class="help-box">
        <strong>💡 Quick tip:</strong> We support all major UK banks including Barclays, HSBC, Lloyds, NatWest, and many more. Just upload your PDF bank statement and we'll handle the rest!
      </div>

      <div style="text-align: center;">
        <a href="${this.frontendUrl}" class="button">Try Converting Now →</a>
      </div>

      <p style="margin-top: 30px;"><strong>Need help?</strong> Just reply to this email and I'll personally assist you. I usually respond within a few hours.</p>

      <p>Your 3 free conversions are still waiting for you!</p>

      <p style="margin-top: 25px;">Best regards,<br><strong>The BankToFile Team</strong></p>
    </div>
    <div class="footer">
      <p>© ${new Date().getFullYear()} BankToFile. All rights reserved.</p>
      <p><a href="${this.frontendUrl}/privacy" style="color: #6b7280;">Privacy</a> | <a href="${this.frontendUrl}/terms" style="color: #6b7280;">Terms</a></p>
    </div>
  </div>
</body>
</html>
    `;

    const textContent = `
Hi${userName ? ` ${userName}` : ''},

Need help with your first conversion?

I noticed you signed up for BankToFile a few days ago but haven't converted a statement yet.

Is everything okay? Sometimes people get stuck on:
• Finding the right PDF file
• Understanding which formats we support
• Navigating the upload process

💡 Quick tip: We support all major UK banks including Barclays, HSBC, Lloyds, NatWest, and many more. Just upload your PDF bank statement and we'll handle the rest!

Try converting now: ${this.frontendUrl}

Need help? Just reply to this email and I'll personally assist you. I usually respond within a few hours.

Your 3 free conversions are still waiting for you!

Best regards,
The BankToFile Team

© ${new Date().getFullYear()} BankToFile. All rights reserved.
    `;

    await this.sendEmail({
      to: userEmail,
      toName: userName,
      subject: 'Need help with your first conversion?',
      htmlContent,
      textContent,
    });
  }

  /**
   * PRIORITY 4: Upgrade Reminder (Day 7, used all free, didn't pay)
   * Subject: "Still need to convert bank statements?"
   * Trigger: User used 3 free conversions AND plan = free AND 7 days since limit hit
   */
  async sendUpgradeReminderEmail(userEmail: string, userName?: string): Promise<void> {
    const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
    .content { background: #fff; padding: 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 10px 10px; }
    .button { display: inline-block; background: #10b981; color: white; padding: 14px 28px; text-decoration: none; border-radius: 6px; font-weight: 600; margin: 15px 0; }
    .highlight { background: #fef3c7; padding: 2px 6px; border-radius: 3px; }
    .footer { text-align: center; margin-top: 30px; font-size: 14px; color: #6b7280; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1 style="margin: 0; font-size: 28px;">Still need to convert bank statements?</h1>
    </div>
    <div class="content">
      <p>Hi${userName ? ` ${userName}` : ''},</p>

      <p>I noticed you used all 3 free conversions last week. Hope they were helpful!</p>

      <p>If you're still converting bank statements, our <span class="highlight"><strong>Basic plan at £20/month</strong></span> gives you 30 files per month - perfect for most users.</p>

      <p><strong>Why upgrade?</strong></p>
      <ul style="padding-left: 25px;">
        <li>Save hours of manual data entry</li>
        <li>Accurate transaction extraction</li>
        <li>Works with any UK bank</li>
        <li>Export to Excel or CSV</li>
        <li>Secure and private</li>
      </ul>

      <div style="text-align: center; margin-top: 30px;">
        <a href="${this.frontendUrl}/pricing" class="button">View Pricing Plans →</a>
      </div>

      <p style="margin-top: 30px; font-size: 14px;">No pressure! If you don't need more conversions right now, no worries. Your account will stay active and you can upgrade anytime.</p>

      <p style="margin-top: 25px;">Best regards,<br><strong>The BankToFile Team</strong></p>
    </div>
    <div class="footer">
      <p>© ${new Date().getFullYear()} BankToFile. All rights reserved.</p>
      <p><a href="${this.frontendUrl}/privacy" style="color: #6b7280;">Privacy</a> | <a href="${this.frontendUrl}/terms" style="color: #6b7280;">Terms</a></p>
    </div>
  </div>
</body>
</html>
    `;

    const textContent = `
Hi${userName ? ` ${userName}` : ''},

Still need to convert bank statements?

I noticed you used all 3 free conversions last week. Hope they were helpful!

If you're still converting bank statements, our Basic plan at £20/month gives you 30 files per month - perfect for most users.

Why upgrade?
• Save hours of manual data entry
• Accurate transaction extraction
• Works with any UK bank
• Export to Excel or CSV
• Secure and private

View pricing plans: ${this.frontendUrl}/pricing

No pressure! If you don't need more conversions right now, no worries. Your account will stay active and you can upgrade anytime.

Best regards,
The BankToFile Team

© ${new Date().getFullYear()} BankToFile. All rights reserved.
    `;

    await this.sendEmail({
      to: userEmail,
      toName: userName,
      subject: 'Still need to convert bank statements?',
      htmlContent,
      textContent,
    });
  }

  /**
   * ADMIN NOTIFICATION: User Feedback Received
   * Notify admin when user submits feedback (positive or negative)
   */
  async sendAdminFeedbackNotification(
    userEmail: string,
    userName: string | undefined,
    rating: 'positive' | 'negative',
    bankName: string | undefined,
    comment: string | undefined
  ): Promise<void> {
    const ratingEmoji = rating === 'positive' ? '👍' : '👎';
    const ratingText = rating === 'positive' ? 'POSITIVE' : 'NEGATIVE';
    const ratingColor = rating === 'positive' ? '#10b981' : '#ef4444';

    const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: #f8f9fa; padding: 20px; border-radius: 8px; margin-bottom: 20px; }
    .rating { font-size: 24px; font-weight: bold; color: ${ratingColor}; }
    .content { background: #fff; padding: 20px; border: 1px solid #e5e7eb; border-radius: 8px; }
    .field { margin: 15px 0; }
    .label { font-weight: 600; color: #6b7280; }
    .value { margin-top: 5px; }
    .comment { background: #f9fafb; padding: 15px; border-left: 4px solid ${ratingColor}; margin-top: 10px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h2 style="margin: 0;">New User Feedback ${ratingEmoji}</h2>
      <div class="rating">${ratingText} Rating</div>
    </div>
    <div class="content">
      <div class="field">
        <div class="label">User:</div>
        <div class="value">${userName || 'Unknown'} (${userEmail})</div>
      </div>
      <div class="field">
        <div class="label">Bank:</div>
        <div class="value">${bankName || 'Not specified'}</div>
      </div>
      <div class="field">
        <div class="label">Rating:</div>
        <div class="value">${ratingEmoji} ${ratingText}</div>
      </div>
      ${comment ? `
      <div class="field">
        <div class="label">Comment:</div>
        <div class="comment">${comment}</div>
      </div>
      ` : ''}
      <div class="field" style="margin-top: 20px;">
        <a href="${this.frontendUrl}/admin/feedback" style="display: inline-block; background: #10b981; color: white; padding: 10px 20px; text-decoration: none; border-radius: 6px;">
          View All Feedback →
        </a>
      </div>
    </div>
  </div>
</body>
</html>
    `;

    const textContent = `
New User Feedback ${ratingEmoji}

Rating: ${ratingText}
User: ${userName || 'Unknown'} (${userEmail})
Bank: ${bankName || 'Not specified'}
${comment ? `\nComment:\n${comment}` : ''}

View all feedback: ${this.frontendUrl}/admin/feedback
    `;

    await this.sendEmail({
      to: this.adminEmail,
      subject: `[BankToFile] New ${ratingText} Feedback from ${userEmail}`,
      htmlContent,
      textContent,
    });
  }

  /**
   * ADMIN NOTIFICATION: Support Request Received
   * Notify admin when user submits support request
   */
  async sendAdminSupportNotification(
    userEmail: string,
    userName: string | undefined,
    subject: string,
    message: string
  ): Promise<void> {
    const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: #fef3c7; padding: 20px; border-radius: 8px; margin-bottom: 20px; }
    .content { background: #fff; padding: 20px; border: 1px solid #e5e7eb; border-radius: 8px; }
    .field { margin: 15px 0; }
    .label { font-weight: 600; color: #6b7280; }
    .value { margin-top: 5px; }
    .message { background: #f9fafb; padding: 15px; border-left: 4px solid #f59e0b; margin-top: 10px; white-space: pre-wrap; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h2 style="margin: 0;">🎫 New Support Request</h2>
    </div>
    <div class="content">
      <div class="field">
        <div class="label">From:</div>
        <div class="value">${userName || 'Unknown'} (${userEmail})</div>
      </div>
      <div class="field">
        <div class="label">Subject:</div>
        <div class="value"><strong>${subject}</strong></div>
      </div>
      <div class="field">
        <div class="label">Message:</div>
        <div class="message">${message}</div>
      </div>
      <div class="field" style="margin-top: 20px;">
        <a href="${this.frontendUrl}/admin/support" style="display: inline-block; background: #f59e0b; color: white; padding: 10px 20px; text-decoration: none; border-radius: 6px;">
          View Support Requests →
        </a>
      </div>
      <div style="margin-top: 15px; padding-top: 15px; border-top: 1px solid #e5e7eb;">
        <p style="margin: 0; font-size: 14px; color: #6b7280;">
          <strong>Reply to:</strong> ${userEmail}
        </p>
      </div>
    </div>
  </div>
</body>
</html>
    `;

    const textContent = `
🎫 New Support Request

From: ${userName || 'Unknown'} (${userEmail})
Subject: ${subject}

Message:
${message}

Reply to: ${userEmail}
View all support requests: ${this.frontendUrl}/admin/support
    `;

    await this.sendEmail({
      to: this.adminEmail,
      subject: `[BankToFile Support] ${subject}`,
      htmlContent,
      textContent,
    });
  }

  /**
   * ADMIN NOTIFICATION: Contact Form Submission
   * Notify admin when someone submits contact form
   */
  async sendAdminContactNotification(
    name: string,
    email: string,
    message: string
  ): Promise<void> {
    const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: #dbeafe; padding: 20px; border-radius: 8px; margin-bottom: 20px; }
    .content { background: #fff; padding: 20px; border: 1px solid #e5e7eb; border-radius: 8px; }
    .field { margin: 15px 0; }
    .label { font-weight: 600; color: #6b7280; }
    .value { margin-top: 5px; }
    .message { background: #f9fafb; padding: 15px; border-left: 4px solid #3b82f6; margin-top: 10px; white-space: pre-wrap; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h2 style="margin: 0;">📧 New Contact Form Submission</h2>
    </div>
    <div class="content">
      <div class="field">
        <div class="label">Name:</div>
        <div class="value">${name}</div>
      </div>
      <div class="field">
        <div class="label">Email:</div>
        <div class="value">${email}</div>
      </div>
      <div class="field">
        <div class="label">Message:</div>
        <div class="message">${message}</div>
      </div>
      <div style="margin-top: 15px; padding-top: 15px; border-top: 1px solid #e5e7eb;">
        <p style="margin: 0; font-size: 14px; color: #6b7280;">
          <strong>Reply to:</strong> ${email}
        </p>
      </div>
    </div>
  </div>
</body>
</html>
    `;

    const textContent = `
📧 New Contact Form Submission

Name: ${name}
Email: ${email}

Message:
${message}

Reply to: ${email}
    `;

    await this.sendEmail({
      to: this.adminEmail,
      subject: `[BankToFile Contact] Message from ${name}`,
      htmlContent,
      textContent,
    });
  }

  /**
   * ADMIN NOTIFICATION: Bank Request
   * Notify admin when user requests support for a new bank
   */
  async sendAdminBankRequestNotification(
    userEmail: string,
    userName: string | undefined,
    bankName: string,
    additionalInfo: string | undefined
  ): Promise<void> {
    const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: #fce7f3; padding: 20px; border-radius: 8px; margin-bottom: 20px; }
    .content { background: #fff; padding: 20px; border: 1px solid #e5e7eb; border-radius: 8px; }
    .field { margin: 15px 0; }
    .label { font-weight: 600; color: #6b7280; }
    .value { margin-top: 5px; }
    .info { background: #f9fafb; padding: 15px; border-left: 4px solid #ec4899; margin-top: 10px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h2 style="margin: 0;">🏦 New Bank Support Request</h2>
    </div>
    <div class="content">
      <div class="field">
        <div class="label">Requested Bank:</div>
        <div class="value"><strong>${bankName}</strong></div>
      </div>
      <div class="field">
        <div class="label">Requested By:</div>
        <div class="value">${userName || 'Unknown'} (${userEmail})</div>
      </div>
      ${additionalInfo ? `
      <div class="field">
        <div class="label">Additional Information:</div>
        <div class="info">${additionalInfo}</div>
      </div>
      ` : ''}
      <div class="field" style="margin-top: 20px;">
        <p style="font-size: 14px; color: #6b7280;">
          Consider adding support for this bank if you see multiple requests.
        </p>
      </div>
    </div>
  </div>
</body>
</html>
    `;

    const textContent = `
🏦 New Bank Support Request

Bank: ${bankName}
Requested By: ${userName || 'Unknown'} (${userEmail})
${additionalInfo ? `\nAdditional Info:\n${additionalInfo}` : ''}

Consider adding support for this bank if you see multiple requests.
    `;

    await this.sendEmail({
      to: this.adminEmail,
      subject: `[BankToFile] Bank Request: ${bankName}`,
      htmlContent,
      textContent,
    });
  }
}

// Export singleton instance
export const brevoEmailService = new BrevoEmailService();
