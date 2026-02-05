import { Request, Response, NextFunction } from 'express';
import { PRICING_TIERS } from '../config/stripe.js';
import { pool } from '../db/postgres.js';

/**
 * Middleware to check file size limit based on user's subscription tier
 * Free and Basic/Starter users: 10MB
 * Professional and Enterprise users: 25MB
 */
export async function checkFileSizeLimitMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    console.log('\n=== FILE SIZE LIMIT CHECK ===');

    // Get file size
    if (!req.file) {
      console.log('❌ No file found in request');
      return next();
    }

    const fileSizeBytes = req.file.size;
    const fileSizeMB = fileSizeBytes / (1024 * 1024);

    console.log(`📊 File size: ${fileSizeMB.toFixed(2)} MB`);

    // Get user plan
    let userPlan: 'free' | 'basic' | 'starter' | 'professional' | 'enterprise' = 'free';
    let userEmail: string | undefined;

    // Check if user is authenticated
    const userId = req.headers['x-user-id'] as string | undefined;

    if (userId) {
      // User is authenticated - get their plan from database
      const client = await pool.connect();
      try {
        const result = await client.query(
          'SELECT plan, email FROM users WHERE id = $1',
          [userId]
        );

        if (result.rows.length > 0) {
          userPlan = result.rows[0].plan || 'free';
          userEmail = result.rows[0].email;
          console.log(`👤 Authenticated user: ${userEmail}`);
          console.log(`📦 Plan: ${userPlan}`);
        }
      } finally {
        client.release();
      }
    } else {
      console.log('👤 Anonymous user (free tier)');
    }

    // Get file size limit for user's plan
    const planDetails = PRICING_TIERS[userPlan];
    const maxFileSizeMB = planDetails.maxFileSizeMB || 10;

    console.log(`📏 Max file size for ${userPlan} plan: ${maxFileSizeMB} MB`);

    // Check if file size exceeds limit
    if (fileSizeMB > maxFileSizeMB) {
      console.log(`❌ File size (${fileSizeMB.toFixed(2)} MB) exceeds ${userPlan} plan limit (${maxFileSizeMB} MB)`);

      // Determine suggested plan
      let suggestedPlan: 'professional' | 'enterprise' | null = null;
      let suggestedPlanName: string | undefined;
      let suggestedPlanPrice: number | undefined;
      let suggestedMaxFileSize: number | undefined;

      if (userPlan === 'free' || userPlan === 'basic' || userPlan === 'starter') {
        // Suggest Professional plan (25MB limit)
        suggestedPlan = 'professional';
        const professionalDetails = PRICING_TIERS.professional;
        suggestedPlanName = professionalDetails.name;
        suggestedPlanPrice = professionalDetails.price;
        suggestedMaxFileSize = professionalDetails.maxFileSizeMB;
      }

      res.status(413).json({
        error: 'File size limit exceeded',
        fileSizeMB: parseFloat(fileSizeMB.toFixed(2)),
        maxFileSizeMB,
        currentPlan: userPlan,
        suggestedPlan,
        suggestedPlanName,
        suggestedPlanPrice,
        suggestedMaxFileSize,
        message: `This file is ${fileSizeMB.toFixed(2)} MB. ${userPlan === 'free' ? 'Free' : userPlan.charAt(0).toUpperCase() + userPlan.slice(1)} accounts can upload files up to ${maxFileSizeMB} MB.${suggestedPlan ? ` Upgrade to ${suggestedPlanName} for ${suggestedMaxFileSize} MB files.` : ''}`,
      });
      return;
    }

    console.log(`✅ File size OK (${fileSizeMB.toFixed(2)} MB <= ${maxFileSizeMB} MB)`);
    next();
  } catch (error) {
    console.error('❌ Error in file size limit middleware:', error);
    // Don't block upload on middleware error
    next();
  }
}
