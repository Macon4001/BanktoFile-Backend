import { Request, Response } from "express";
import { PDFParser } from "../services/pdfParser.js";
import { CSVParser } from "../services/csvParser.js";
import { CSVGenerator } from "../services/csvGenerator.js";
import { XLSXGenerator } from "../services/xlsxGenerator.js";
import { ocrService } from "../services/ocrService.js";
import { ParsedStatement } from "../types/index.js";

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

      // Always generate CSV for preview
      const csv = this.csvGenerator.generateCSV(parsedData.transactions);

      // If we successfully extracted transactions, don't send non-UK bank warning
      // The parser successfully handled it, so no need to warn the user
      const shouldIncludeBankDetection = parsedData.bankDetection &&
        parsedData.transactions.length === 0;

      if (format === 'xlsx') {
        // Also generate XLSX
        const xlsxBuffer = this.xlsxGenerator.generateXLSX(parsedData.transactions);

        res.status(200).json({
          success: true,
          csv, // For preview
          xlsx: xlsxBuffer.toString('base64'), // For download
          transactions: parsedData.transactions, // Include structured transaction data
          rawContent,
          transactionCount: parsedData.transactions.length,
          metadata: parsedData.metadata,
          format: 'xlsx',
          usedOCR: parsedData.usedOCR || false,
          ocrConfidence: parsedData.confidence,
          bankDetection: shouldIncludeBankDetection ? parsedData.bankDetection : undefined,
        });
      } else {
        // CSV only
        res.status(200).json({
          success: true,
          csv,
          transactions: parsedData.transactions, // Include structured transaction data
          rawContent,
          transactionCount: parsedData.transactions.length,
          metadata: parsedData.metadata,
          format: 'csv',
          usedOCR: parsedData.usedOCR || false,
          ocrConfidence: parsedData.confidence,
          bankDetection: shouldIncludeBankDetection ? parsedData.bankDetection : undefined,
        });
      }
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
