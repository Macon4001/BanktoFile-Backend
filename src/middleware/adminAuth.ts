import { Request, Response, NextFunction } from 'express';
import { verify, JwtPayload } from 'jsonwebtoken';

// Extend Express Request to include user info
declare module 'express-serve-static-core' {
  interface Request {
    userEmail?: string;
    isAdmin?: boolean;
  }
}

/**
 * Middleware to verify if user is an admin
 * Uses environment variable ADMIN_EMAIL to check if user has admin access
 */
export async function requireAdmin(req: Request, res: Response, next: NextFunction) {
  try {
    console.log('🚀 [ADMIN AUTH] Middleware called for:', req.method, req.path);

    // Get token from Authorization header
    const authHeader = req.headers.authorization;
    console.log('🚀 [ADMIN AUTH] Authorization header present:', !!authHeader);

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      console.error('❌ [ADMIN AUTH] No Bearer token in header');
      return res.status(401).json({
        success: false,
        error: 'No authentication token provided',
        code: 'NO_TOKEN',
      });
    }

    const token = authHeader.substring(7); // Remove 'Bearer ' prefix

    // Verify JWT token
    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
      console.error('JWT_SECRET is not configured');
      return res.status(500).json({
        success: false,
        error: 'Server authentication configuration error',
      });
    }

    console.log('🔍 [ADMIN AUTH] JWT_SECRET configured:', !!jwtSecret);
    console.log('🔍 [ADMIN AUTH] Token (first 50 chars):', token.substring(0, 50));

    let decoded: JwtPayload | string;
    try {
      decoded = verify(token, jwtSecret);
      console.log('✅ [ADMIN AUTH] JWT verification successful');
    } catch (error) {
      console.error('❌ [ADMIN AUTH] JWT verification failed:', error);
      return res.status(401).json({
        success: false,
        error: 'Invalid or expired token',
        code: 'INVALID_TOKEN',
      });
    }

    // Get user email from token
    const userEmail = typeof decoded === 'object' ? decoded.email : undefined;
    console.log('🔍 Admin check - User email from token:', userEmail);

    if (!userEmail) {
      console.error('❌ No email found in token payload');
      return res.status(401).json({
        success: false,
        error: 'Invalid token payload',
        code: 'INVALID_TOKEN',
      });
    }

    // Check if user is admin
    const adminEmail = process.env.ADMIN_EMAIL;
    console.log('🔍 Admin check - Admin email from env:', adminEmail);

    if (!adminEmail) {
      console.error('❌ ADMIN_EMAIL is not configured');
      return res.status(500).json({
        success: false,
        error: 'Admin configuration error',
      });
    }

    // Check if user's email matches admin email
    const userEmailLower = userEmail.toLowerCase();
    const adminEmailLower = adminEmail.toLowerCase();
    console.log('🔍 Admin check - Comparing:', { userEmailLower, adminEmailLower });

    if (userEmailLower !== adminEmailLower) {
      console.error(`❌ Access denied for ${userEmail} - Admin is ${adminEmail}`);
      return res.status(403).json({
        success: false,
        error: 'Access denied. Admin privileges required.',
        code: 'FORBIDDEN',
      });
    }

    // Set user info on request for use in route handlers
    req.userEmail = userEmail;
    req.isAdmin = true;

    console.log(`Admin access granted for: ${userEmail}`);
    next();
  } catch (error) {
    console.error('Error in admin auth middleware:', error);
    res.status(500).json({
      success: false,
      error: 'Authentication error',
    });
  }
}

/**
 * Optional middleware to check admin status without requiring it
 * Sets req.isAdmin = true if user is admin, but doesn't block the request
 */
export async function checkAdmin(req: Request, res: Response, next: NextFunction) {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      req.isAdmin = false;
      return next();
    }

    const token = authHeader.substring(7);
    const jwtSecret = process.env.JWT_SECRET;

    if (!jwtSecret) {
      req.isAdmin = false;
      return next();
    }

    let decoded: JwtPayload | string;
    try {
      decoded = verify(token, jwtSecret);
    } catch {
      req.isAdmin = false;
      return next();
    }

    const userEmail = typeof decoded === 'object' ? decoded.email : undefined;
    const adminEmail = process.env.ADMIN_EMAIL;

    if (userEmail && adminEmail && userEmail.toLowerCase() === adminEmail.toLowerCase()) {
      req.userEmail = userEmail;
      req.isAdmin = true;
    } else {
      req.isAdmin = false;
    }

    next();
  } catch (error) {
    console.error('Error in check admin middleware:', error);
    req.isAdmin = false;
    next();
  }
}
