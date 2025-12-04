# Blog Images - Static File Storage

This folder is for storing blog post images as static files.

## How to Use

1. **Upload your image** to this folder (via FTP, Railway CLI, or git commit)
   - Supported formats: JPG, PNG, GIF, WebP, SVG
   - Recommended: Optimize images before uploading (compress, resize)

2. **Access the image** at:
   ```
   https://your-backend-url.com/blog-images/your-image.jpg
   ```

3. **Use in blog posts**:
   - In the blog post form, paste the image URL into the "Featured Image URL" field:
   ```
   /blog-images/hero-image.jpg
   ```
   - Or use the full URL:
   ```
   https://banktofile-backend-production.up.railway.app/blog-images/hero-image.jpg
   ```

## File Naming Best Practices

- Use lowercase and hyphens: `my-blog-post-image.jpg`
- Be descriptive: `csv-conversion-guide-hero.png`
- Include dimensions if relevant: `pricing-table-1200x600.jpg`
- Avoid spaces and special characters

## Examples

```
/blog-images/barclays-statement-example.png
/blog-images/excel-import-screenshot.jpg
/blog-images/csv-format-comparison.png
/blog-images/bank-logo-lloyds.svg
```

## Important Notes

- Images are cached for 1 year (immutable)
- Keep file sizes reasonable (< 500KB recommended)
- Consider using WebP format for better compression
- This folder is committed to git, so large files will bloat the repository
- For production at scale, consider moving to a CDN or cloud storage

## Deployment on Railway

Files in this folder will be deployed with your application.

To add images after deployment:
1. Via Railway CLI: `railway run cp image.jpg public/blog-images/`
2. Via git: Commit and push changes to this folder
