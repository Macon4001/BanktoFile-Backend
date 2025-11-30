import { Router, Request, Response } from 'express';
import { db } from '../db/postgres.js';

const router = Router();

// Generate XML sitemap
router.get('/sitemap.xml', async (req: Request, res: Response) => {
  try {
    const baseUrl = process.env.FRONTEND_URL || 'https://banktofile.com';

    // Get all published blog posts
    const posts = await db.getPublishedBlogPosts();

    // Static pages
    const staticPages = [
      { url: '', changefreq: 'daily', priority: 1.0 },
      { url: '/pricing', changefreq: 'weekly', priority: 0.8 },
      { url: '/blog', changefreq: 'daily', priority: 0.9 },
      { url: '/contact', changefreq: 'monthly', priority: 0.6 },
      { url: '/privacy', changefreq: 'monthly', priority: 0.3 },
      { url: '/terms', changefreq: 'monthly', priority: 0.3 },
    ];

    // Build XML
    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
    xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';

    // Add static pages
    for (const page of staticPages) {
      xml += '  <url>\n';
      xml += `    <loc>${baseUrl}${page.url}</loc>\n`;
      xml += `    <changefreq>${page.changefreq}</changefreq>\n`;
      xml += `    <priority>${page.priority}</priority>\n`;
      xml += '  </url>\n';
    }

    // Add blog posts
    for (const post of posts) {
      xml += '  <url>\n';
      xml += `    <loc>${baseUrl}/blog/${post.slug}</loc>\n`;
      if (post.published_at) {
        xml += `    <lastmod>${new Date(post.published_at).toISOString().split('T')[0]}</lastmod>\n`;
      }
      xml += '    <changefreq>weekly</changefreq>\n';
      xml += '    <priority>0.7</priority>\n';
      xml += '  </url>\n';
    }

    xml += '</urlset>';

    // Set headers
    res.header('Content-Type', 'application/xml');
    res.header('Cache-Control', 'public, max-age=3600'); // Cache for 1 hour
    res.send(xml);
  } catch (error) {
    console.error('Error generating sitemap:', error);
    res.status(500).send('Error generating sitemap');
  }
});

// Generate robots.txt
router.get('/robots.txt', (req: Request, res: Response) => {
  const baseUrl = process.env.FRONTEND_URL || 'https://banktofile.com';

  const robotsTxt = `# BankToFile robots.txt
User-agent: *
Allow: /
Disallow: /api/
Disallow: /admin/

Sitemap: ${baseUrl}/sitemap.xml
`;

  res.header('Content-Type', 'text/plain');
  res.send(robotsTxt);
});

export default router;
