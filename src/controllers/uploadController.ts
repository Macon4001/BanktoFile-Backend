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
      let parsedData: ParsedStatement & { rawText?: string; usedOCR?: boolean; confidence?: number };
      let rawContent = "";

      // Determine file type and parse accordingly
      if (file.mimetype === "application/pdf") {
        // Try standard PDF text extraction first
        console.log("🔍 Attempting standard PDF text extraction...");
        const pdfResult = await this.pdfParser.parsePDF(file.buffer);
        rawContent = pdfResult.rawText || "";

        // Check if OCR is needed (scanned PDF or no transactions found)
        if (pdfResult.needsOCR) {
          console.log("⚠️  PDF parsing found no transactions");
          console.log("🔧 OCR is disabled - fix the parser instead!");
          // For now, return the result even if empty so we can see what's wrong
          parsedData = pdfResult;

          // TODO: Re-enable OCR only for truly scanned documents
          // if (pdfResult.rawText && pdfResult.rawText.length < 100) {
          //   console.log("📸 PDF is scanned - would use OCR here");
          // }
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

      if (format === 'xlsx') {
        // Also generate XLSX
        const xlsxBuffer = this.xlsxGenerator.generateXLSX(parsedData.transactions);

        res.status(200).json({
          success: true,
          csv, // For preview
          xlsx: xlsxBuffer.toString('base64'), // For download
          rawContent,
          transactionCount: parsedData.transactions.length,
          metadata: parsedData.metadata,
          format: 'xlsx',
          usedOCR: parsedData.usedOCR || false,
          ocrConfidence: parsedData.confidence,
        });
      } else {
        // CSV only
        res.status(200).json({
          success: true,
          csv,
          rawContent,
          transactionCount: parsedData.transactions.length,
          metadata: parsedData.metadata,
          format: 'csv',
          usedOCR: parsedData.usedOCR || false,
          ocrConfidence: parsedData.confidence,
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
