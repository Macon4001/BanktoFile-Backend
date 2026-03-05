import { Request, Response } from "express";
import { PDFParser } from "../services/pdfParser.js";
import { CSVParser } from "../services/csvParser.js";
import { CSVGenerator } from "../services/csvGenerator.js";
import { XLSXGenerator } from "../services/xlsxGenerator.js";
import { ocrService } from "../services/ocrService.js";
import { ParsedStatement } from "../types/index.js";
import { pool } from "../db/postgres.js";
import crypto from "crypto";

export class UploadController {
  private pdfParser: PDFParser;
  private csvParser: CSVParser;
  private csvGenerator: CSVGenerator;
  private xlsxGenerator: XLSXGenerator;

  constructor() {
    this.pdfParser = new PDFParser();
    this.csvParser = new CSVParser();
    this.csvGenerator = new CSVGenerator();
    this.xlsxGenerator = new XLSXGenerator();
  }

  async handleUpload(req: Request, res: Response): Promise<void> {
    try {
      console.log("=== Upload Request Received ===");
      console.log("File present:", !!req.file);
      console.log("File mimetype:", req.file?.mimetype);
      console.log("File size:", req.file?.size);

      if (!req.file) {
        console.log("ERROR: No file uploaded");
        res.status(400).json({ error: "No file uploaded" });
        return;
      }

      const file = req.file;
      let parsedData: ParsedStatement & {
        rawText?: string;
        usedOCR?: boolean;
        confidence?: number;
        bankDetection?: { isNonUK: boolean; indicators: string[]; confidence: 'low' | 'medium' | 'high' };
      };
      let rawContent = "";

      // Determine file type and parse accordingly
      if (file.mimetype === "application/pdf") {
        // Try standard PDF text extraction first
        console.log("🔍 Attempting standard PDF text extraction...");
        const pdfResult = await this.pdfParser.parsePDF(file.buffer);
        rawContent = pdfResult.rawText || "";

        // Check if OCR is needed (scanned PDF, no transactions found, or sanity check failed)
        if (pdfResult.needsOCR) {
          if (pdfResult.transactions && pdfResult.transactions.length > 0) {
            console.log("⚠️  Sanity check failed - parsing may be inaccurate, triggering OCR fallback");
          } else {
            console.log("⚠️  Standard PDF parsing found no transactions - trying OCR fallback");
          }

          try {
            // Try OCR with automatic provider selection (Tesseract first, Google Vision fallback)
            // Pass page count for sanity checking (extract from pdfResult's internal data if available)
            console.log("🔍 OCR Fallback triggered");

            // Get page count from PDF (try to extract it again if needed)
            let pageCount: number | undefined;
            try {
              const pdfParse = await import('pdf-parse');
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const pdfData = await (pdfParse as any).default(file.buffer);
              pageCount = pdfData.numpages;
            } catch {
              // If extraction fails, we'll pass undefined and skip sanity check in OCR
              pageCount = undefined;
            }

            const ocrResult = await ocrService.processScannedPDF(file.buffer, 'auto', pageCount);

            console.log(`✅ OCR extracted ${ocrResult.transactions.length} transactions using ${ocrResult.ocrProvider}`);

            // Check if OCR results are actually better than original parsing
            const ocrImproved = ocrResult.transactions.length > pdfResult.transactions.length;

            if (!ocrImproved && pdfResult.transactions.length > 0) {
              console.log(`⚠️  OCR didn't improve results (${ocrResult.transactions.length} vs ${pdfResult.transactions.length}), using original parsing`);
              parsedData = pdfResult;
            } else {
              parsedData = {
                ...pdfResult,
                ...ocrResult,
              };
            }
          } catch (ocrError: unknown) {
            const err = ocrError as Error;
            console.error("❌ OCR fallback failed:", err.message);
            console.error("Full error:", err);

            // If still no transactions, return helpful error to user
            if (pdfResult.transactions.length === 0) {
              console.log("ERROR: OCR failed and no transactions found - returning error to user");
              res.status(400).json({
                error: "Unable to extract transactions from this PDF. The file may be scanned or image-based, and OCR processing is not available. Please try a different file format or contact support.",
                details: "OCR_NOT_AVAILABLE"
              });
              return;
            }

            // If we have some transactions from standard parsing, return those with a warning
            parsedData = pdfResult;
          }
        } else {
          // Standard PDF parsing worked
          console.log("✅ Standard PDF parsing successful");
          parsedData = pdfResult;
        }
      } else if (
        file.mimetype === "text/csv" ||
        file.mimetype === "application/vnd.ms-excel" ||
        file.originalname.endsWith(".csv")
      ) {
        parsedData = await this.csvParser.parseCSV(file.buffer);
        rawContent = file.buffer.toString("utf-8");
      } else {
        res.status(400).json({ error: "Unsupported file type" });
        return;
      }

      // Check if we got any transactions
      if (!parsedData.transactions || parsedData.transactions.length === 0) {
        // Check if it's a Monzo statement with no transactions
        const isEmptyMonzoStatement = rawContent.toLowerCase().includes("there were no transactions during this period");

        const errorMessage = isEmptyMonzoStatement
          ? "This statement has no transactions. The statement period shows '£0.00 Total deposits' and '£0.00 Total outgoings'. Please upload a statement with transactions."
          : "No transactions found in the file. Please check the file format or try a different statement.";

        console.log("ERROR: No transactions found:", errorMessage);
        console.log("Sending 400 response with error message");

        const errorResponse = {
          error: errorMessage,
          rawContent: rawContent.substring(0, 500), // Return first 500 chars for debugging
        };

        console.log("Error response:", JSON.stringify(errorResponse));
        res.setHeader('Content-Type', 'application/json');
        res.status(400).json(errorResponse);
        return;
      }

      // Get requested format from query parameter (default to CSV)
      const format = (req.query.format as string)?.toLowerCase() || 'csv';

      // Always generate CSV
      const csv = this.csvGenerator.generateCSV(parsedData.transactions);

      // Generate XLSX if requested
      let xlsxBase64: string | null = null;
      if (format === 'xlsx') {
        const xlsxBuffer = this.xlsxGenerator.generateXLSX(parsedData.transactions);
        xlsxBase64 = xlsxBuffer.toString('base64');
      }

      // Get client IP (for anonymous user tracking)
      const getClientIp = (req: Request): string => {
        const forwardedFor = req.headers['x-forwarded-for'];
        if (forwardedFor) {
          const ips = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor;
          return ips.split(',')[0].trim();
        }
        const realIp = req.headers['x-real-ip'];
        if (realIp) {
          return Array.isArray(realIp) ? realIp[0] : realIp;
        }
        const cfConnectingIp = req.headers['cf-connecting-ip'];
        if (cfConnectingIp) {
          return Array.isArray(cfConnectingIp) ? cfConnectingIp[0] : cfConnectingIp;
        }
        return req.socket.remoteAddress || 'unknown';
      };

      const clientIp = getClientIp(req);
      console.log(`📍 Client IP: ${clientIp}`);

      // Check if this IP already has a pending conversion (to prevent refresh abuse)
      const existingPending = await pool.query(
        `SELECT session_token, created_at FROM pending_conversions
         WHERE client_ip = $1 AND expires_at > NOW()
         ORDER BY created_at DESC LIMIT 1`,
        [clientIp]
      );

      if (existingPending.rows.length > 0) {
        const existing = existingPending.rows[0];
        const ageMinutes = Math.floor((Date.now() - new Date(existing.created_at).getTime()) / 60000);

        console.log(`⚠️  IP ${clientIp} already has a pending conversion (${ageMinutes} minutes old)`);
        console.log(`   Returning existing session token: ${existing.session_token}`);

        // Return existing session token (don't create duplicate)
        res.status(400).json({
          error: 'You already have a conversion in progress. Please complete the email step to download your file, or wait a few minutes and try again.',
          code: 'PENDING_CONVERSION_EXISTS',
          existingSessionToken: existing.session_token,
        });
        return;
      }

      // Generate unique session token for this conversion
      const sessionToken = crypto.randomUUID();

      // Extract metadata for preview
      // Determine date range from transactions
      const sortedTransactions = [...parsedData.transactions].sort((a, b) =>
        new Date(a.date).getTime() - new Date(b.date).getTime()
      );
      const startDate = sortedTransactions.length > 0 ? sortedTransactions[0].date : undefined;
      const endDate = sortedTransactions.length > 0 ? sortedTransactions[sortedTransactions.length - 1].date : undefined;

      const metadata = {
        transactionCount: parsedData.transactions.length,
        bankName: parsedData.metadata?.bankName || 'Unknown Bank',
        startDate,
        endDate,
        accountNumber: parsedData.metadata?.accountNumber,
        usedOCR: parsedData.usedOCR || false,
        ocrConfidence: parsedData.confidence,
      };

      // Store the conversion in pending_conversions table with client IP
      await pool.query(
        `INSERT INTO pending_conversions
         (session_token, file_name, csv_data, xlsx_data, transactions, metadata, client_ip, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW() + INTERVAL '24 hours')`,
        [
          sessionToken,
          file.originalname,
          csv,
          xlsxBase64,
          JSON.stringify(parsedData.transactions),
          JSON.stringify(metadata),
          clientIp
        ]
      );

      console.log(`✅ Stored pending conversion with session token: ${sessionToken}`);

      // If we successfully extracted transactions, don't send non-UK bank warning
      const shouldIncludeBankDetection = parsedData.bankDetection &&
        parsedData.transactions.length === 0;

      // Return preview data (NOT the full CSV/XLSX)
      res.status(200).json({
        success: true,
        sessionToken,
        requiresEmailGate: true,
        preview: {
          transactionCount: parsedData.transactions.length,
          bankName: metadata.bankName,
          dateRange: {
            start: metadata.startDate,
            end: metadata.endDate,
          },
          accountNumber: metadata.accountNumber,
          // Include first 5 transactions as a sample
          sampleTransactions: parsedData.transactions.slice(0, 5),
          usedOCR: parsedData.usedOCR || false,
          ocrConfidence: parsedData.confidence,
        },
        format,
        bankDetection: shouldIncludeBankDetection ? parsedData.bankDetection : undefined,
      });
    } catch (error) {
      console.error("=== UPLOAD ERROR ===");
      console.error("Error:", error);
      console.error("Error type:", error instanceof Error ? "Error" : typeof error);
      console.error("Error message:", error instanceof Error ? error.message : String(error));

      const errorResponse = {
        error: error instanceof Error ? error.message : "Failed to process file",
      };

      console.log("Sending 500 response:", JSON.stringify(errorResponse));
      res.status(500).json(errorResponse);
    }
  }
}
