import { Router } from "express";
import multer from "multer";
import { UploadController } from "../controllers/uploadController.js";
import {
  countPagesMiddleware,
  checkPageLimitMiddleware,
  logConversionMiddleware,
} from "../middleware/pageLimitMiddleware.js";

const router = Router();
const uploadController = new UploadController();

// Configure multer for memory storage
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
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
  countPagesMiddleware,
  checkPageLimitMiddleware,
  logConversionMiddleware,
  (req, res) => {
    uploadController.handleUpload(req, res);
  }
);

// Error handling middleware for multer errors
router.use((err: Error, req: any, res: any, next: any) => {
  console.error("Upload route error:", err);
  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({
        error: "File size exceeds 10MB limit",
      });
    }
    return res.status(400).json({
      error: `Upload error: ${err.message}`,
    });
  } else if (err) {
    return res.status(400).json({
      error: err.message || "File upload failed",
    });
  }
  next();
});

export default router;
