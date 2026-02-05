import { Router } from "express";
import multer from "multer";
import { UploadController } from "../controllers/uploadController.js";
import {
  countPagesMiddleware,
  checkPageLimitMiddleware,
  logConversionMiddleware,
} from "../middleware/pageLimitMiddleware.js";
import {
  checkIpRateLimitMiddleware,
  logIpConversionMiddleware,
} from "../middleware/ipRateLimitMiddleware.js";
import { checkFileSizeLimitMiddleware } from "../middleware/fileSizeLimitMiddleware.js";

const router = Router();
const uploadController = new UploadController();

// Configure multer for memory storage
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: {
    fileSize: process.env.NODE_ENV === 'development' ? Infinity : 25 * 1024 * 1024, // Unlimited in dev, 25MB in production
  },
  fileFilter: (_req, file, cb) => {
    const allowedMimeTypes = [
      "application/pdf",
      "text/csv",
      "application/vnd.ms-excel",
    ];

    if (
      allowedMimeTypes.includes(file.mimetype) ||
      file.originalname.endsWith(".csv")
    ) {
      cb(null, true);
    } else {
      cb(new Error("Invalid file type. Only PDF and CSV files are allowed."));
    }
  },
});

// POST /api/upload - Upload and convert bank statement
router.post(
  "/upload",
  upload.single("file"),
  checkFileSizeLimitMiddleware, // Check file size limit based on user tier
  checkIpRateLimitMiddleware,  // Check IP-based rate limiting first (for anonymous users)
  countPagesMiddleware,
  checkPageLimitMiddleware,
  logIpConversionMiddleware,   // Log IP-based conversions (for anonymous users)
  logConversionMiddleware,      // Log user-based conversions (for authenticated users)
  (req, res) => {
    uploadController.handleUpload(req, res);
  }
);

// Error handling middleware for multer errors
router.use((err: Error, _req: unknown, res: unknown, next: unknown) => {
  console.error("Upload route error:", err);
  const response = res as { status: (code: number) => { json: (data: unknown) => void } };
  const nextFn = next as () => void;

  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      return response.status(413).json({
        error: "File size exceeds 25MB limit",
        message: "This file is too large. Maximum file size is 25MB.",
      });
    }
    return response.status(400).json({
      error: `Upload error: ${err.message}`,
    });
  } else if (err) {
    return response.status(400).json({
      error: err.message || "File upload failed",
    });
  }
  nextFn();
});

export default router;
