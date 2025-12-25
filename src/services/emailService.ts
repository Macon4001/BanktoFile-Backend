import nodemailer from 'nodemailer';

// Configure Brevo (formerly Sendinblue) SMTP transporter
const createTransporter = () => {
  // Check if email is configured
  if (!process.env.BREVO_SMTP_USER || !process.env.BREVO_SMTP_KEY) {
    console.warn('⚠️  Email service not configured. Set BREVO_SMTP_USER and BREVO_SMTP_KEY in .env');
    return null;
  }

  return nodemailer.createTransport({
    host: 'smtp-relay.brevo.com',
    port: 587,
    secure: false, // Use TLS
    auth: {
      user: process.env.BREVO_SMTP_USER, // Your Brevo login email
      pass: process.env.BREVO_SMTP_KEY    // Your Brevo SMTP key (not password)
    }
  });
};

interface BankRequestEmailData {
  bankName: string;
  userEmail: string;
  notes?: string;
}

/**
 * Send email notification to admin about new bank request
 */
export async function sendBankRequestAdminEmail(data: BankRequestEmailData): Promise<void> {
  const transporter = createTransporter();

  if (!transporter) {
    console.warn('Skipping admin email - email service not configured');
    return;
  }

  const adminEmail = process.env.ADMIN_EMAIL || process.env.BREVO_SMTP_USER;

  if (!adminEmail) {
    console.error('ADMIN_EMAIL not configured in environment variables');
    return;
  }

  const emailHtml = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
          line-height: 1.6;
          color: #333;
          max-width: 600px;
          margin: 0 auto;
          padding: 20px;
        }
        .header {
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
          padding: 30px 20px;
          border-radius: 10px 10px 0 0;
          text-align: center;
        }
        .content {
          background: #f9fafb;
          padding: 30px 20px;
          border-radius: 0 0 10px 10px;
        }
        .info-row {
          background: white;
          padding: 15px;
          margin: 10px 0;
          border-radius: 5px;
          border-left: 4px solid #667eea;
        }
        .label {
          font-weight: 600;
          color: #667eea;
          margin-bottom: 5px;
        }
        .value {
          color: #333;
        }
        .footer {
          margin-top: 20px;
          padding-top: 20px;
          border-top: 1px solid #e5e7eb;
          color: #6b7280;
          font-size: 14px;
        }
      </style>
    </head>
    <body>
      <div class="header">
        <h1 style="margin: 0;">🏦 New Bank Request</h1>
      </div>
      <div class="content">
        <p>You've received a new bank support request:</p>

        <div class="info-row">
          <div class="label">Bank Name</div>
          <div class="value">${data.bankName}</div>
        </div>

        <div class="info-row">
          <div class="label">User Email</div>
          <div class="value"><a href="mailto:${data.userEmail}">${data.userEmail}</a></div>
        </div>

        ${data.notes ? `
        <div class="info-row">
          <div class="label">Additional Notes</div>
          <div class="value">${data.notes}</div>
        </div>
        ` : ''}

        <div class="info-row">
          <div class="label">Date</div>
          <div class="value">${new Date().toLocaleString('en-GB', {
            dateStyle: 'full',
            timeStyle: 'short'
          })}</div>
        </div>

        <div class="footer">
          <p><strong>Next Steps:</strong></p>
          <ol>
            <li>Review the request and check if this bank is already supported</li>
            <li>If needed, obtain a sample statement from the bank</li>
            <li>Implement parser for ${data.bankName}</li>
            <li>Reply to <strong>${data.userEmail}</strong> when support is added</li>
          </ol>
        </div>
      </div>
    </body>
    </html>
  `;

  try {
    await transporter.sendMail({
      from: `"Bank to File" <${process.env.BREVO_SMTP_USER}>`,
      to: adminEmail,
      subject: `🏦 New Bank Request: ${data.bankName}`,
      html: emailHtml,
      text: `
New Bank Support Request

Bank: ${data.bankName}
User Email: ${data.userEmail}
${data.notes ? `Notes: ${data.notes}` : ''}
Date: ${new Date().toLocaleString()}

Reply to ${data.userEmail} when you add support for ${data.bankName}
      `.trim()
    });

    console.log(`✅ Admin email sent for bank request: ${data.bankName}`);
  } catch (error) {
    console.error('❌ Failed to send admin email:', error);
    throw error;
  }
}

/**
 * Send confirmation email to user about their bank request
 */
export async function sendBankRequestUserEmail(data: BankRequestEmailData): Promise<void> {
  const transporter = createTransporter();

  if (!transporter) {
    console.warn('Skipping user confirmation email - email service not configured');
    return;
  }

  const emailHtml = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
          line-height: 1.6;
          color: #333;
          max-width: 600px;
          margin: 0 auto;
          padding: 20px;
        }
        .header {
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
          padding: 40px 20px;
          border-radius: 10px 10px 0 0;
          text-align: center;
        }
        .content {
          background: #f9fafb;
          padding: 30px 20px;
          border-radius: 0 0 10px 10px;
        }
        .highlight {
          background: white;
          padding: 20px;
          border-radius: 8px;
          border-left: 4px solid #10b981;
          margin: 20px 0;
        }
        .bank-name {
          color: #667eea;
          font-weight: 600;
          font-size: 18px;
        }
        .footer {
          margin-top: 30px;
          padding-top: 20px;
          border-top: 1px solid #e5e7eb;
          color: #6b7280;
          font-size: 14px;
          text-align: center;
        }
        .cta {
          background: #667eea;
          color: white;
          padding: 12px 30px;
          text-decoration: none;
          border-radius: 6px;
          display: inline-block;
          margin-top: 20px;
        }
      </style>
    </head>
    <body>
      <div class="header">
        <h1 style="margin: 0;">✅ Request Received!</h1>
      </div>
      <div class="content">
        <p>Hi there! 👋</p>

        <p>Thanks for your request to add support for <span class="bank-name">${data.bankName}</span>.</p>

        <div class="highlight">
          <h3 style="margin-top: 0;">What happens next?</h3>
          <ul style="margin-bottom: 0;">
            <li>We'll review your request and prioritize based on demand</li>
            <li>We typically add new banks within <strong>1-2 weeks</strong></li>
            <li>You'll receive an email at <strong>${data.userEmail}</strong> when support is ready</li>
          </ul>
        </div>

        <p>In the meantime, you can continue using Bank to File with our currently supported banks.</p>

        <div style="text-align: center;">
          <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}" class="cta">
            Back to Bank to File
          </a>
        </div>

        <div class="footer">
          <p>Need help? Reply to this email and we'll get back to you.</p>
          <p style="margin-top: 10px;">— The Bank to File Team</p>
        </div>
      </div>
    </body>
    </html>
  `;

  try {
    await transporter.sendMail({
      from: `"Bank to File" <${process.env.BREVO_SMTP_USER}>`,
      to: data.userEmail,
      replyTo: process.env.ADMIN_EMAIL || process.env.BREVO_SMTP_USER,
      subject: `We'll add ${data.bankName} support soon!`,
      html: emailHtml,
      text: `
Hi there!

Thanks for your request to add support for ${data.bankName}.

What happens next?
- We'll review your request and prioritize based on demand
- We typically add new banks within 1-2 weeks
- You'll receive an email at ${data.userEmail} when support is ready

In the meantime, you can continue using Bank to File with our currently supported banks.

Need help? Reply to this email and we'll get back to you.

— The Bank to File Team
      `.trim()
    });

    console.log(`✅ Confirmation email sent to user: ${data.userEmail}`);
  } catch (error) {
    console.error('❌ Failed to send user confirmation email:', error);
    throw error;
  }
}

interface SupportRequestEmailData {
  id: number;
  issueType: string;
  errorType?: string;
  errorMessage?: string;
  description: string;
  userEmail: string;
  sessionId?: string;
  contextData?: Record<string, unknown>;
}

/**
 * Send email notification to admin about new support request
 */
export async function sendSupportRequestEmail(data: SupportRequestEmailData): Promise<void> {
  const transporter = createTransporter();

  if (!transporter) {
    console.warn('Skipping admin email - email service not configured');
    return;
  }

  const adminEmail = 'michael@banktofile.com';

  const issueTypeLabels: Record<string, string> = {
    general: '💬 General Question',
    upload_error: '📤 Upload Error',
    conversion_error: '⚙️ Conversion Error',
    download_error: '📥 Download Error',
    payment_error: '💳 Payment Error',
    other: '❓ Other Issue',
  };

  const issueLabel = issueTypeLabels[data.issueType] || data.issueType;

  const emailHtml = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
          line-height: 1.6;
          color: #333;
          max-width: 600px;
          margin: 0 auto;
          padding: 20px;
        }
        .header {
          background: linear-gradient(135deg, #dc2626 0%, #991b1b 100%);
          color: white;
          padding: 30px 20px;
          border-radius: 10px 10px 0 0;
          text-align: center;
        }
        .content {
          background: #f9fafb;
          padding: 30px 20px;
          border-radius: 0 0 10px 10px;
        }
        .info-row {
          background: white;
          padding: 15px;
          margin: 10px 0;
          border-radius: 5px;
          border-left: 4px solid #dc2626;
        }
        .error-box {
          background: #fef2f2;
          padding: 15px;
          margin: 10px 0;
          border-radius: 5px;
          border-left: 4px solid #dc2626;
          font-family: monospace;
          font-size: 12px;
        }
        .label {
          font-weight: 600;
          color: #dc2626;
          margin-bottom: 5px;
        }
        .value {
          color: #333;
        }
        .description {
          background: #fffbeb;
          padding: 15px;
          margin: 15px 0;
          border-radius: 5px;
          border-left: 4px solid #f59e0b;
        }
        .footer {
          margin-top: 20px;
          padding-top: 20px;
          border-top: 1px solid #e5e7eb;
          color: #6b7280;
          font-size: 14px;
        }
        .button {
          display: inline-block;
          background: #16a34a;
          color: white;
          padding: 12px 24px;
          text-decoration: none;
          border-radius: 6px;
          margin: 10px 5px;
        }
      </style>
    </head>
    <body>
      <div class="header">
        <h1 style="margin: 0;">🚨 New Support Request</h1>
        <p style="margin: 10px 0 0 0; opacity: 0.9;">Request #${data.id}</p>
      </div>
      <div class="content">
        <div class="info-row">
          <div class="label">Issue Type</div>
          <div class="value">${issueLabel}</div>
        </div>

        <div class="info-row">
          <div class="label">User Email</div>
          <div class="value"><a href="mailto:${data.userEmail}">${data.userEmail}</a></div>
        </div>

        ${data.sessionId ? `
        <div class="info-row">
          <div class="label">Session ID</div>
          <div class="value">${data.sessionId}</div>
        </div>
        ` : ''}

        <div class="description">
          <div class="label">User Description</div>
          <div class="value">${data.description.replace(/\n/g, '<br>')}</div>
        </div>

        ${data.errorType ? `
        <div class="error-box">
          <div class="label">Error Type</div>
          <div class="value">${data.errorType}</div>
        </div>
        ` : ''}

        ${data.errorMessage ? `
        <div class="error-box">
          <div class="label">Error Message</div>
          <div class="value">${data.errorMessage}</div>
        </div>
        ` : ''}

        ${data.contextData && Object.keys(data.contextData).length > 0 ? `
        <div class="info-row">
          <div class="label">Additional Context</div>
          <div class="value">
            <pre style="margin: 0; font-size: 11px; overflow-x: auto;">${JSON.stringify(data.contextData, null, 2)}</pre>
          </div>
        </div>
        ` : ''}

        <div class="info-row">
          <div class="label">Submitted</div>
          <div class="value">${new Date().toLocaleString('en-GB', {
            dateStyle: 'full',
            timeStyle: 'short'
          })}</div>
        </div>

        <div style="text-align: center; margin-top: 20px;">
          <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}/admin/support" class="button">
            View in Dashboard
          </a>
          <a href="mailto:${data.userEmail}" class="button" style="background: #2563eb;">
            Reply to User
          </a>
        </div>

        <div class="footer">
          <p><strong>Next Steps:</strong></p>
          <ol>
            <li>Review the error details and context</li>
            <li>Check analytics for session ID: <code>${data.sessionId || 'N/A'}</code></li>
            <li>Investigate and resolve the issue</li>
            <li>Reply to <strong>${data.userEmail}</strong> with solution</li>
            <li>Update status in admin dashboard</li>
          </ol>
        </div>
      </div>
    </body>
    </html>
  `;

  try {
    await transporter.sendMail({
      from: `"Bank to File Support" <${process.env.BREVO_SMTP_USER}>`,
      to: adminEmail,
      subject: `🚨 Support Request #${data.id}: ${issueLabel}`,
      html: emailHtml,
      text: `
New Support Request #${data.id}

Issue Type: ${issueLabel}
User Email: ${data.userEmail}
${data.sessionId ? `Session ID: ${data.sessionId}` : ''}

User Description:
${data.description}

${data.errorType ? `Error Type: ${data.errorType}` : ''}
${data.errorMessage ? `Error Message: ${data.errorMessage}` : ''}

${data.contextData ? `Context: ${JSON.stringify(data.contextData, null, 2)}` : ''}

Submitted: ${new Date().toLocaleString()}

Reply to: ${data.userEmail}
      `.trim()
    });

    console.log(`✅ Support request email sent to admin for request #${data.id}`);
  } catch (error) {
    console.error('❌ Failed to send support request email:', error);
    throw error;
  }
}
