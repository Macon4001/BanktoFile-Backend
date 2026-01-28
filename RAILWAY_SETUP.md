# Railway Railpack Configuration Guide

## Problem
Railway deprecated Nixpacks and switched to Railpack. The `nixpacks.toml` file is no longer being used, which is why poppler-utils isn't being installed.

## Solution: Environment Variables

Railpack uses environment variables for configuration instead of config files.

### Step 1: Add Environment Variable in Railway

Go to your Railway project:
1. Click on your **backend service**
2. Go to **Variables** tab
3. Click **New Variable**
4. Add the following:

```
Variable Name: RAILPACK_DEPLOY_APT_PACKAGES
Value: poppler-utils tesseract-ocr
```

**Important:** Use `RAILPACK_DEPLOY_APT_PACKAGES` (not `RAILPACK_BUILD_APT_PACKAGES`) so the packages are available at runtime, not just during build.

### Step 2: Redeploy

After adding the variable:
1. Click **Deploy** or push a new commit
2. Railway will rebuild with the apt packages

### Step 3: Verify

Check the build logs for:
```
Installing apt packages: poppler-utils tesseract-ocr
```

And in runtime logs you should see:
```
✅ Found pdftoppm in PATH: /usr/bin/pdftoppm
```

## What This Does

- Installs `poppler-utils` (provides pdftoppm for PDF to image conversion)
- Installs `tesseract-ocr` (for OCR functionality)
- Makes these available in the runtime container at standard paths like `/usr/bin/`

## Files to Clean Up (Optional)

These files are no longer needed with Railpack:
- `nixpacks.toml` - Can be deleted (Nixpacks deprecated)
- `Aptfile` - Not used by Railpack (uses env vars instead)

## Reference
- [Railpack Installing Packages Guide](https://railpack.com/guides/installing-packages/)
- [Railway Build Configuration](https://docs.railway.com/guides/build-configuration)
