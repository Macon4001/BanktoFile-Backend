import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { pool, db } from '../db/postgres.js';
import { brevoEmailService } from '../services/brevoEmailService.js';

const router = Router();

/**
 * POST /api/auth/forgot-password
 *
 * Initiates password reset flow by generating a reset token and sending email.
 */
router.post('/forgot-password', async (req: Request, res: Response) => {
  try {
    const { email } = req.body;

    // Validate email
    if (!email) {
      return res.status(400).json({
        error: 'Email is required',
      });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        error: 'Invalid email format',
      });
    }

    // Check if user exists
    const user = await db.getUserByEmail(email);

    // SECURITY: Always return success even if user doesn't exist
    // This prevents email enumeration attacks
    if (!user) {
      console.log(`[PASSWORD_RESET] User not found: ${email} (returning success anyway)`);
      return res.status(200).json({
        success: true,
        message: 'If an account exists with this email, you will receive password reset instructions.',
      });
    }

    // Check if user has a password (Google OAuth users don't)
    if (!user.password_hash) {
      console.log(`[PASSWORD_RESET] User ${email} uses Google OAuth (no password to reset)`);
      // Send email explaining they use Google OAuth
      await brevoEmailService.sendPasswordResetOAuthEmail(user.email, user.name || 'there');

      return res.status(200).json({
        success: true,
        message: 'If an account exists with this email, you will receive password reset instructions.',
      });
    }

    // Generate reset token (32 bytes = 64 hex characters)
    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetTokenHash = crypto.createHash('sha256').update(resetToken).digest('hex');
    const resetTokenExpiry = new Date(Date.now() + 3600000); // 1 hour from now

    // Store reset token in database
    await pool.query(
      `UPDATE users
       SET password_reset_token = $1,
           password_reset_expires = $2,
           updated_at = NOW()
       WHERE id = $3`,
      [resetTokenHash, resetTokenExpiry, user.id]
    );

    // Generate reset URL
    const resetUrl = `${process.env.FRONTEND_URL || 'https://www.banktofile.com'}/reset-password?token=${resetToken}`;

    // Send password reset email
    await brevoEmailService.sendPasswordResetEmail(user.email, user.name || 'there', resetUrl);

    console.log(`[PASSWORD_RESET] Reset token generated for ${email}`);

    res.status(200).json({
      success: true,
      message: 'If an account exists with this email, you will receive password reset instructions.',
    });
  } catch (error) {
    console.error('[PASSWORD_RESET] Error in forgot-password:', error);
    res.status(500).json({
      error: 'Failed to process password reset request. Please try again.',
    });
  }
});

/**
 * POST /api/auth/reset-password
 *
 * Resets password using the token from email link.
 */
router.post('/reset-password', async (req: Request, res: Response) => {
  try {
    const { token, password } = req.body;

    // Validate input
    if (!token || !password) {
      return res.status(400).json({
        error: 'Token and password are required',
      });
    }

    // Validate password strength
    if (password.length < 8) {
      return res.status(400).json({
        error: 'Password must be at least 8 characters long',
      });
    }

    // Hash the token to match what's stored in database
    const resetTokenHash = crypto.createHash('sha256').update(token).digest('hex');

    // Find user with this token that hasn't expired
    const result = await pool.query(
      `SELECT id, email, name
       FROM users
       WHERE password_reset_token = $1
         AND password_reset_expires > NOW()`,
      [resetTokenHash]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({
        error: 'Invalid or expired reset token',
        code: 'INVALID_TOKEN',
      });
    }

    const user = result.rows[0];

    // Hash new password using bcryptjs
    const bcrypt = await import('bcryptjs');
    const hashedPassword = await bcrypt.hash(password, 10);

    // Update password and clear reset token
    await pool.query(
      `UPDATE users
       SET password_hash = $1,
           password_reset_token = NULL,
           password_reset_expires = NULL,
           updated_at = NOW()
       WHERE id = $2`,
      [hashedPassword, user.id]
    );

    console.log(`[PASSWORD_RESET] Password reset successful for ${user.email}`);

    // Send confirmation email
    await brevoEmailService.sendPasswordResetConfirmationEmail(user.email, user.name || 'there');

    res.status(200).json({
      success: true,
      message: 'Password reset successful. You can now log in with your new password.',
    });
  } catch (error) {
    console.error('[PASSWORD_RESET] Error in reset-password:', error);
    res.status(500).json({
      error: 'Failed to reset password. Please try again.',
    });
  }
});

/**
 * POST /api/auth/verify-reset-token
 *
 * Verifies if a reset token is valid (used by frontend before showing reset form).
 */
router.post('/verify-reset-token', async (req: Request, res: Response) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({
        error: 'Token is required',
      });
    }

    // Hash the token
    const resetTokenHash = crypto.createHash('sha256').update(token).digest('hex');

    // Check if token exists and hasn't expired
    const result = await pool.query(
      `SELECT email
       FROM users
       WHERE password_reset_token = $1
         AND password_reset_expires > NOW()`,
      [resetTokenHash]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({
        valid: false,
        error: 'Invalid or expired reset token',
      });
    }

    res.status(200).json({
      valid: true,
      email: result.rows[0].email,
    });
  } catch (error) {
    console.error('[PASSWORD_RESET] Error in verify-reset-token:', error);
    res.status(500).json({
      error: 'Failed to verify token',
    });
  }
});

export default router;
