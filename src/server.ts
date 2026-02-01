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
import eventsRoutes from "./routes/events.js";
import feedbackRoutes from "./routes/feedback.js";
import supportRoutes from "./routes/support.js";
import dashboardRoutes from "./routes/dashboard.js";
import usersRoutes from "./routes/users.js";
import ipUsageRoutes from "./routes/ipUsage.js";
import manualExtractRoutes from "./routes/manualExtract.js";
import { ocrService } from "./services/ocrService.js";
import { startPublishScheduler } from "./jobs/publishScheduled.js";

// Get __dirname equivalent in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app: Express = express();
const PORT = process.env.PORT || 3001;

// Middleware - CORS configuration
const allowedOrigins = [
  'http://localhost:3000',
  'https://www.banktofile.com',
  'https://banktofile.com',
  process.env.FRONTEND_URL,
].filter(Boolean).map(url => url?.replace(/\/$/, '')); // Remove trailing slashes

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps, Postman, etc.)
    if (!origin) return callback(null, true);

    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.log('⚠️  CORS blocked origin:', origin);
      callback(new Error('Not allowed by CORS'));
    }
  },
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

// Serve tutorial videos from public/Videos folder
// Videos can be accessed at: /Videos/video-name.mp4
app.use('/Videos', express.static(path.join(publicPath, 'Videos'), {
  maxAge: '1y', // Cache for 1 year
  immutable: true, // Videos never change
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
app.use("/api", ipUsageRoutes);
app.use("/api", manualExtractRoutes);
app.use("/api/stripe", stripeRoutes);
app.use("/api/blog", blogRoutes);
app.use("/api/contact", contactRoutes);
app.use("/api/bank-request", bankRequestRoutes);
app.use("/api/events", eventsRoutes);
app.use("/api", feedbackRoutes);
app.use("/api/support", supportRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/users", usersRoutes);

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

// Initialize OCR service (Tesseract + Google Vision)
// This enables automatic OCR fallback for scanned PDFs
async function initializeServices() {
  try {
    console.log('🔧 Initializing OCR service...');

    // Initialize with 2 Tesseract workers + Google Vision (if credentials provided)
    await ocrService.initialize(2);

    console.log('✅ OCR service initialized successfully');
  } catch (error) {
    console.error('⚠️  Failed to initialize OCR service:', error);
    console.error('OCR functionality may not work properly');
    console.error('Tip: Ensure Tesseract is available or Google Vision credentials are configured');
  }
}

// Start server
app.listen(PORT, async () => {
  console.log(`🚀 Server is running on port ${PORT}`);
  console.log(`📝 Environment: ${process.env.NODE_ENV || "development"}`);
  console.log(`🔗 Health check: http://localhost:${PORT}/health`);

  // Debug: Check for pdftoppm in PATH
  if (process.env.NODE_ENV === 'production') {
    console.log(`🔍 Checking for pdftoppm in PATH...`);
    console.log(`   PATH: ${process.env.PATH?.split(':').slice(0, 5).join(', ')}...`);

    const { exec } = await import('child_process');
    exec('which pdftoppm', (error, stdout) => {
      if (error) {
        console.log(`❌ pdftoppm not found in PATH`);
        console.log(`   Will use PDF.js fallback (may fail on some PDFs)`);
      } else {
        console.log(`✅ pdftoppm found at: ${stdout.trim()}`);
      }
    });
  }

  // Initialize services in background
  await initializeServices();

  // Start scheduled post publisher
  startPublishScheduler();
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM signal received: closing HTTP server');
  await ocrService.terminate();
  process.exit(0);
});

export default app;
