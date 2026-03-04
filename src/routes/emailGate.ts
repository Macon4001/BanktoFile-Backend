import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { pool, db } from '../db/postgres.js';
import { brevoEmailService } from '../services/brevoEmailService.js';
import type { PendingConversion } from '../db/postgres.js';

const router = Router();

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this-in-production';
const JWT_EXPIRES_IN = '7d';

interface EmailGateRequest {
  email: string;
  sessionToken: string;
  utmParams?: {
    source?: string;
    medium?: string;
    campaign?: string;
  };
}

/**
 * POST /api/auth/email-gate
 *
 * Captures user email before allowing file download.
 * Creates new user account or links to existing account.
 * Triggers welcome email for new users.
 * Logs the conversion and triggers limit-hit email if applicable.
 */
router.post('/email-gate', async (req: Request, res: Response) => {
  try {
    const { email, sessionToken, utmParams }: EmailGateRequest = req.body;

    // Validate input
    if (!email || !sessionToken) {
      return res.status(400).json({
        error: 'Email and session token are required'
      });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        error: 'Invalid email format'
      });
    }

    // Look up the pending conversion
    const conversionResult = await pool.query<PendingConversion>(
      'SELECT * FROM pending_conversions WHERE session_token = $1',
      [sessionToken]
    );

    if (conversionResult.rows.length === 0) {
      return res.status(404).json({
        error: 'Conversion not found or expired. Please try uploading your file again.'
      });
    }

    const pendingConversion = conversionResult.rows[0];

    // Check if conversion has expired
    if (new Date(pendingConversion.expires_at) < new Date()) {
      // Delete expired conversion
      await pool.query('DELETE FROM pending_conversions WHERE id = $1', [pendingConversion.id]);
      return res.status(410).json({
        error: 'This conversion has expired. Please upload your file again.'
      });
    }

    // Check if user exists
    let user = await db.getUserByEmail(email);
    let isNewUser = false;

    if (!user) {
      // Create new user with email only (passwordless account)
      isNewUser = true;

      const createData: Record<string, unknown> = {
        name: email.split('@')[0], // Use email username as default name
      };

      // Add UTM params if provided
      if (utmParams?.source) createData.utm_source = utmParams.source;
      if (utmParams?.medium) createData.utm_medium = utmParams.medium;
      if (utmParams?.campaign) createData.utm_campaign = utmParams.campaign;

      user = await db.createUser(email, createData);
      console.log(`✅ Created new user via email gate: ${email}`);
    } else {
      console.log(`✅ Existing user found: ${email}`);

      // Update UTM params if this is their first conversion and UTM params are provided
      if (!user.first_conversion_at && utmParams) {
        const updateData: Record<string, unknown> = {};
        if (utmParams.source && !user.utm_source) updateData.utm_source = utmParams.source;
        if (utmParams.medium && !user.utm_medium) updateData.utm_medium = utmParams.medium;
        if (utmParams.campaign && !user.utm_campaign) updateData.utm_campaign = utmParams.campaign;

        if (Object.keys(updateData).length > 0) {
          await db.updateUser(user.id, updateData);
        }
      }
    }

    // Update user with email gate completion and first conversion timestamp
    const updateData: Record<string, unknown> = {
      email_gate_completed_at: new Date(),
      last_conversion_at: new Date(),
    };

    if (!user.first_conversion_at) {
      updateData.first_conversion_at = new Date();
    }

    await db.updateUser(user.id, updateData);

    // Log the conversion in conversion_logs table
    const metadata = pendingConversion.metadata as { transactionCount?: number; bankName?: string } | null;
    const transactionCount = metadata?.transactionCount || 0;

    await pool.query(
      `INSERT INTO conversion_logs
       (user_id, file_name, pages_converted, conversion_type, timestamp)
       VALUES ($1, $2, $3, $4, NOW())`,
      [user.id, pendingConversion.file_name, transactionCount, 'pdf_to_csv']
    );

    // Increment user's file usage counter
    const incrementResult = await pool.query(
      `UPDATE users
       SET files_used_monthly = files_used_monthly + 1,
           updated_at = NOW()
       WHERE id = $1
       RETURNING files_used_monthly, monthly_files_limit, plan`,
      [user.id]
    );

    const updatedUser = incrementResult.rows[0];
    const filesUsed = updatedUser.files_used_monthly;
    const filesLimit = updatedUser.monthly_files_limit;
    const plan = updatedUser.plan;

    console.log(`User ${email}: ${filesUsed}/${filesLimit} files used`);

    // Send welcome email for new users (Email 1)
    if (isNewUser) {
      const conversionData = {
        transactionCount,
        bankName: metadata?.bankName,
        conversionsRemaining: Math.max(0, filesLimit - filesUsed),
      };

      brevoEmailService.sendWelcomeEmail(user.email, user.name, conversionData).catch(error => {
        console.error('Failed to send welcome email:', error);
      });

      await db.updateUser(user.id, { welcome_email_sent: true }).catch(error => {
        console.error('Failed to update welcome_email_sent flag:', error);
      });

      console.log(`✅ Sent welcome email to ${user.email}`);
    }

    // Check if user hit their limit (Email 3 - Limit Hit)
    if (filesUsed >= filesLimit && plan === 'free' && !user.limit_hit_email_sent) {
      brevoEmailService.sendLimitHitEmail(user.email, user.name).catch(error => {
        console.error('Failed to send limit hit email:', error);
      });

      await db.updateUser(user.id, {
        limit_hit_email_sent: true,
        limit_hit_at: new Date()
      }).catch(error => {
        console.error('Failed to update limit_hit_email_sent flag:', error);
      });

      console.log(`✅ Sent limit hit email to ${user.email}`);
    }

    // Generate JWT token
    const token = jwt.sign(
      { userId: user.id, email: user.email },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    // Delete the pending conversion (it's been claimed)
    await pool.query('DELETE FROM pending_conversions WHERE id = $1', [pendingConversion.id]);

    // Return success with download data
    res.status(200).json({
      success: true,
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        plan: user.plan,
        filesUsed,
        filesLimit,
      },
      download: {
        csv: pendingConversion.csv_data,
        xlsx: pendingConversion.xlsx_data,
        fileName: pendingConversion.file_name,
      },
      isNewUser,
    });

  } catch (error) {
    console.error('Email gate error:', error);
    res.status(500).json({
      error: 'Failed to process email gate. Please try again.'
    });
  }
});

export default router;
