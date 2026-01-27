# Deployment Guide

## Railway Deployment

This backend requires system dependencies for PDF processing:
- **poppler-utils** - Provides `pdftoppm` for PDF to image conversion
- **tesseract-ocr** - OCR capabilities
- **ghostscript** - Additional PDF support

### Option 1: Nixpacks (Default)

Railway will automatically use `nixpacks.toml` configuration which installs the required packages.

### Option 2: Docker (Fallback)

If nixpacks has issues, Railway will auto-detect and use the `Dockerfile`.

To force Docker deployment in Railway:
1. Go to your Railway project settings
2. Under "Build & Deploy" → "Builder"
3. Select "Dockerfile"

### Verification

After deployment, check the build logs for:
```
✓ pdftoppm found in PATH
```

If you see "WARNING: pdftoppm not found in PATH", the PDF to image conversion will fall back to PDF.js (which may have font rendering issues).

## Environment Variables

Required:
- `DATABASE_URL` - PostgreSQL connection string
- `STRIPE_SECRET_KEY` - Stripe API key
- `NEXTAUTH_SECRET` - NextAuth secret
- `GOOGLE_VISION_API_KEY` - Google Vision OCR API key (optional)

Optional:
- `NODE_ENV` - Set to "production"
- `PORT` - Port number (Railway sets this automatically)
- `DISABLE_LIMITS` - Set to "true" to disable usage limits (development only)

## Troubleshooting

### PDF shows boxes instead of text

This happens when poppler-utils isn't installed. Check:

1. **Verify poppler is installed**: Look for the verification message in build logs
2. **Check Railway builder**: Make sure it's using Dockerfile or nixpacks correctly
3. **Rebuild**: Sometimes a fresh deployment helps Railway pick up the config

### PDF.js fallback issues

If PDF.js fallback is being used (check server logs for "Falling back to PDF.js"):
- Ensure the font rendering fix is deployed (commit dcdf095)
- The CDN for standard fonts should be accessible from Railway
