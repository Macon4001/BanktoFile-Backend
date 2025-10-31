import { Request, Response } from "express";
import { PDFParser } from "../services/pdfParser.js";
import { CSVParser } from "../services/csvParser.js";
import { CSVGenerator } from "../services/csvGenerator.js";
import { XLSXGenerator } from "../services/xlsxGenerator.js";
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
      let parsedData: ParsedStatement & { rawText?: string };
      let rawContent = "";

      // Determine file type and parse accordingly
      if (file.mimetype === "application/pdf") {
        parsedData = await this.pdfParser.parsePDF(file.buffer);
        rawContent = parsedData.rawText || "";
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
