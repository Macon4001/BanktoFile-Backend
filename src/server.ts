// Load environment variables FIRST before any other imports
import dotenv from "dotenv";
dotenv.config();

import express, { Express, Request, Response } from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import uploadRoutes from "./routes/upload.js";
import stripeRoutes from "./routes/stripe.js";
import webhookRoutes from "./routes/webhooks.js";
import authRoutes from "./routes/auth.js";
import blogRoutes from "./routes/blog.js";
import contactRoutes from "./routes/contact.js";
import bankRequestRoutes from "./routes/bankRequest.js";
import sitemapRoutes from "./routes/sitemap.js";
import { ocrService } from "./services/ocrService.js";

// Get __dirname equivalent in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app: Express = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors({
  origin: (process.env.FRONTEND_URL || "http://localhost:3000").replace(/\/$/, ''), // Remove trailing slash
  credentials: true,
  optionsSuccessStatus: 200,
  exposedHeaders: ['Content-Type', 'Content-Length'],
}));

// Webhook routes need raw body, so they come BEFORE express.json()
app.use("/webhooks", express.raw({ type: 'application/json' }), webhookRoutes);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static blog images from public/blog-images folder
// Images can be accessed at: /blog-images/your-image.jpg
const publicPath = path.join(__dirname, '..', 'public');
app.use('/blog-images', express.static(path.join(publicPath, 'blog-images'), {
  maxAge: '1y', // Cache for 1 year
  immutable: true, // Images never change
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  }
}));

// Add response headers middleware (for API routes)
app.use((_req: Request, res: Response, next) => {
  // Only set JSON content-type for API routes
  if (_req.path.startsWith('/api') || _req.path.startsWith('/webhooks')) {
    res.setHeader('Content-Type', 'application/json');
  }
  next();
});

// Health check endpoint
app.get("/health", (_req: Request, res: Response) => {
  res.status(200).json({ status: "ok", message: "Server is running" });
});

// API routes
app.use("/api/auth", authRoutes);
app.use("/api", uploadRoutes);
app.use("/api/stripe", stripeRoutes);
app.use("/api/blog", blogRoutes);
app.use("/api/contact", contactRoutes);
app.use("/api/bank-request", bankRequestRoutes);

// Sitemap and SEO routes
app.use("/", sitemapRoutes);

// Error handling middleware
app.use((err: Error, _req: Request, res: Response, _next: unknown) => {
  console.error("Error:", err);
  res.status(500).json({
    error: err.message || "Internal server error",
  });
});

// 404 handler
app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: "Route not found" });
});

// Initialize OCR service (optional - can be lazy-loaded on first use)
// Comment this out if you want faster server startup
async function initializeServices() {
  try {
    console.log('🔧 Initializing OCR service...');
    // await ocrService.initialize(2); // Initialize with 2 workers
    // Disabled for now - OCR will be initialized on first use for faster startup
    console.log('✅ OCR service ready (lazy initialization enabled)');
  } catch (error) {
    console.error('⚠️  Failed to initialize OCR service:', error);
    console.error('OCR functionality may not work properly');
  }
}

// Start server
app.listen(PORT, async () => {
  console.log(`🚀 Server is running on port ${PORT}`);
  console.log(`📝 Environment: ${process.env.NODE_ENV || "development"}`);
  console.log(`🔗 Health check: http://localhost:${PORT}/health`);

  // Initialize services in background
  await initializeServices();
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM signal received: closing HTTP server');
  await ocrService.terminate();
  process.exit(0);
});

export default app;
