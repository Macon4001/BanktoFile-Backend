import { Request, Response, NextFunction } from 'express';

// Extend Express Request to include API key info
declare module 'express-serve-static-core' {
  interface Request {
    apiKeyAuthenticated?: boolean;
  }
}

/**
 * Middleware to verify API key authentication
 * Allows external services to authenticate using X-API-Key header
 *
 * Usage in routes:
 *   router.post('/endpoint', requireApiKey, handler)
 *
 * Client usage:
 *   curl -H "X-API-Key: your-api-key" https://api.example.com/endpoint
 */
export function requireApiKey(req: Request, res: Response, next: NextFunction) {
  try {
    console.log('🔑 [API KEY AUTH] Middleware called for:', req.method, req.path);

    // Get API key from X-API-Key header
    const apiKey = req.headers['x-api-key'] as string | undefined;
    console.log('🔑 [API KEY AUTH] API key present:', !!apiKey);

    if (!apiKey) {
      console.error('❌ [API KEY AUTH] No API key in header');
      return res.status(401).json({
        success: false,
        error: 'API key required. Please provide X-API-Key header',
        code: 'NO_API_KEY',
      });
    }

    // Get configured API key from environment
    const validApiKey = process.env.BLOG_API_KEY;

    if (!validApiKey) {
      console.error('❌ [API KEY AUTH] BLOG_API_KEY not configured in environment');
      return res.status(500).json({
        success: false,
        error: 'Server API key configuration error',
      });
    }

    // Validate API key
    if (apiKey !== validApiKey) {
      console.error('❌ [API KEY AUTH] Invalid API key provided');
      return res.status(401).json({
        success: false,
        error: 'Invalid API key',
        code: 'INVALID_API_KEY',
      });
    }

    // Set flag on request
    req.apiKeyAuthenticated = true;
    console.log('✅ [API KEY AUTH] API key authenticated successfully');

    next();
  } catch (error) {
    console.error('❌ [API KEY AUTH] Error in API key auth middleware:', error);
    res.status(500).json({
      success: false,
      error: 'Authentication error',
    });
  }
}

/**
 * Middleware that accepts EITHER admin JWT OR API key authentication
 * Useful for endpoints that should be accessible by both admin users and external services
 *
 * Usage in routes:
 *   router.post('/endpoint', requireAdminOrApiKey, handler)
 */
export function requireAdminOrApiKey(req: Request, res: Response, next: NextFunction) {
  console.log('🔐 [ADMIN OR API KEY] Checking authentication...');

  // Check for API key first (simpler)
  const apiKey = req.headers['x-api-key'] as string | undefined;
  const validApiKey = process.env.BLOG_API_KEY;

  if (apiKey && validApiKey && apiKey === validApiKey) {
    console.log('✅ [ADMIN OR API KEY] Authenticated via API key');
    req.apiKeyAuthenticated = true;
    return next();
  }

  // Check for JWT admin token
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    console.log('🔐 [ADMIN OR API KEY] Trying JWT authentication...');
    // Import requireAdmin dynamically to avoid circular dependencies
    import('./adminAuth.js').then(({ requireAdmin }) => {
      requireAdmin(req, res, next);
    }).catch((error) => {
      console.error('❌ [ADMIN OR API KEY] Error loading admin auth:', error);
      res.status(500).json({
        success: false,
        error: 'Authentication error',
      });
    });
    return;
  }

  // No valid authentication found
  console.error('❌ [ADMIN OR API KEY] No valid authentication found');
  res.status(401).json({
    success: false,
    error: 'Authentication required. Provide either X-API-Key header or Bearer token',
    code: 'NO_AUTH',
  });
}
