// Load environment variables FIRST before any other imports
import dotenv from "dotenv";
dotenv.config();

import express, { Express, Request, Response } from "express";
import cors from "cors";
import uploadRoutes from "./routes/upload.js";
import stripeRoutes from "./routes/stripe.js";
import webhookRoutes from "./routes/webhooks.js";
import authRoutes from "./routes/auth.js";
import { ocrService } from "./services/ocrService.js";

const app: Express = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors({
  origin: process.env.FRONTEND_URL || "http://localhost:3000",
  credentials: true,
  optionsSuccessStatus: 200,
  exposedHeaders: ['Content-Type', 'Content-Length'],
}));

// Webhook routes need raw body, so they come BEFORE express.json()
app.use("/webhooks", express.raw({ type: 'application/json' }), webhookRoutes);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Add response headers middleware
app.use((_req: Request, res: Response, next) => {
  res.setHeader('Content-Type', 'application/json');
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
