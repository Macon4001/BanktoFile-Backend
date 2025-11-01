import Tesseract from 'tesseract.js';
import { Transaction, ParsedStatement } from '../types/index.js';

export class OCRService {
  private scheduler: Tesseract.Scheduler | null = null;

  /**
   * Initialize the Tesseract scheduler with workers for better performance
   * Call this once at server startup
   */
  async initialize(numWorkers: number = 2): Promise<void> {
    console.log(`Initializing OCR service with ${numWorkers} workers...`);
    this.scheduler = await Tesseract.createScheduler();

    for (let i = 0; i < numWorkers; i++) {
      const worker = await Tesseract.createWorker('eng', 1, {
        logger: (m) => {
          if (m.status === 'recognizing text') {
            console.log(`OCR Worker ${i}: ${Math.round(m.progress * 100)}%`);
          }
        },
      });
      this.scheduler.addWorker(worker);
    }

    console.log('OCR service initialized successfully');
  }

  /**
   * Cleanup workers on shutdown
   */
  async terminate(): Promise<void> {
    if (this.scheduler) {
      await this.scheduler.terminate();
      this.scheduler = null;
      console.log('OCR service terminated');
    }
  }

  /**
   * Perform OCR on a PDF buffer and extract text
   * Returns the extracted text and confidence score
   */
  async extractTextFromPDF(pdfBuffer: Buffer): Promise<{ text: string; confidence: number }> {
    try {
      console.log('Starting OCR on PDF...');
      const startTime = Date.now();

      // Convert PDF buffer to image using pdf-poppler or similar
      // For now, we'll assume the PDF is actually an image-based PDF
      // and process it directly with Tesseract

      // Note: Tesseract.js can work with PDF buffers directly
      const { data } = await Tesseract.recognize(pdfBuffer, 'eng', {
        logger: (m) => {
          if (m.status === 'recognizing text') {
            console.log(`OCR Progress: ${Math.round(m.progress * 100)}%`);
          }
        },
      });

      const endTime = Date.now();
      console.log(`OCR completed in ${(endTime - startTime) / 1000}s`);
      console.log(`OCR Confidence: ${data.confidence}%`);
      console.log(`Extracted text length: ${data.text.length} characters`);

      return {
        text: data.text,
        confidence: data.confidence,
      };
    } catch (error) {
      console.error('OCR error:', error);
      throw new Error('Failed to perform OCR on PDF');
    }
  }

  /**
   * Process OCR text and extract transactions
   * Uses the same parsing logic as PDFParser
   */
  parseOCRText(text: string): ParsedStatement {
    console.log('Parsing OCR text for transactions...');

    // Clean up common OCR errors
    const cleanedText = this.cleanOCRText(text);

    const transactions = this.extractTransactions(cleanedText);
    const metadata = this.extractMetadata(cleanedText);

    return {
      transactions,
      metadata,
    };
  }

  /**
   * Clean up common OCR errors in text
   */
  private cleanOCRText(text: string): string {
    let cleaned = text;

    // Common OCR mistakes for bank statements
    const replacements: Record<string, string> = {
      // Currency symbols
      'E': '£',
      '€': '£',

      // Numbers
      'O': '0',  // Letter O to zero
      'o': '0',  // Lowercase o to zero
      'I': '1',  // Letter I to one
      'l': '1',  // Lowercase L to one
      'S': '5',  // Sometimes S is confused with 5
      'B': '8',  // Sometimes B is confused with 8
      'Z': '2',  // Sometimes Z is confused with 2
    };

    // Apply replacements in number contexts only
    // Match patterns like "E123.45" or "O1/12/2024"
    cleaned = cleaned.replace(/([£$])\s*[EÃ¢â€š¬]/g, '$1'); // Fix currency symbols
    cleaned = cleaned.replace(/\b[O](\d)/g, '0$1'); // O followed by digit
    cleaned = cleaned.replace(/(\d)[O]\b/g, '$10'); // Digit followed by O
    cleaned = cleaned.replace(/\b[Il](\d)/g, '1$1'); // I or l followed by digit
    cleaned = cleaned.replace(/(\d)[Il]\b/g, '$11'); // Digit followed by I or l

    // Fix common date patterns: "O1/12/2024" -> "01/12/2024"
    cleaned = cleaned.replace(/\b[O](\d{1})\/(\d{2})\/(\d{4})/g, '0$1/$2/$3');

    // Fix decimal points: "45.S7" -> "45.57"
    cleaned = cleaned.replace(/(\d+\.)([SB])(\d)/g, (match, p1, p2, p3) => {
      const num = p2 === 'S' ? '5' : '8';
      return p1 + num + p3;
    });

    return cleaned;
  }

  /**
   * Extract transactions from OCR text
   * Similar to PDFParser logic but more lenient
   */
  private extractTransactions(text: string): Transaction[] {
    const transactions: Transaction[] = [];
    const lines = text.split('\n');

    // Date patterns
    const datePatterns = [
      /\b(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})\b/,
      /\b(\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2})\b/,
      /\b(\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{2,4})\b/i,
    ];

    for (const line of lines) {
      const trimmedLine = line.trim();
      if (!trimmedLine || trimmedLine.length < 10) continue;

      // Try to find date
      let dateMatch: RegExpMatchArray | null = null;
      for (const pattern of datePatterns) {
        dateMatch = trimmedLine.match(pattern);
        if (dateMatch) break;
      }

      if (!dateMatch) continue;

      // Extract amounts (more lenient for OCR)
      const amountMatches = trimmedLine.match(/(?:£|GBP)?\s*(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/g);
      if (!amountMatches || amountMatches.length === 0) continue;

      // Get description (text between date and amount)
      const dateIndex = trimmedLine.indexOf(dateMatch[0]);
      const firstAmountIndex = trimmedLine.indexOf(amountMatches[0]);

      let description = trimmedLine
        .substring(dateIndex + dateMatch[0].length, firstAmountIndex)
        .trim();

      description = description.replace(/\s+/g, ' ').trim();
      if (!description) description = 'Transaction';

      // Parse amount
      const amountStr = amountMatches[0].replace(/[£GBP,\s]/g, '');
      const amount = parseFloat(amountStr);

      if (isNaN(amount) || amount === 0) continue;

      // Determine type (debit/credit)
      const hasDebit = trimmedLine.match(/\bdebit\b/i) || trimmedLine.includes('-');
      const type = hasDebit ? 'debit' : 'credit';

      // Get balance if available
      let balance: number | undefined;
      if (amountMatches.length > 1) {
        const balanceStr = amountMatches[amountMatches.length - 1].replace(/[£GBP,\s]/g, '');
        const parsedBalance = parseFloat(balanceStr);
        if (!isNaN(parsedBalance) && parsedBalance !== amount) {
          balance = parsedBalance;
        }
      }

      transactions.push({
        date: dateMatch[0],
        description,
        amount,
        balance,
        type,
      });
    }

    console.log(`Extracted ${transactions.length} transactions from OCR text`);
    return transactions;
  }

  /**
   * Extract metadata from OCR text
   */
  private extractMetadata(text: string): ParsedStatement['metadata'] {
    const metadata: ParsedStatement['metadata'] = {};

    // Extract account number
    const accountMatch = text.match(/account\s*(?:number|#)?\s*:?\s*(\d+)/gi);
    if (accountMatch) {
      metadata.accountNumber = accountMatch[0].replace(/\D/g, '');
    }

    // Extract statement period
    const periodMatch = text.match(/(?:statement\s+period|period)\s*:?\s*([\w\s,\-\/]+)/gi);
    if (periodMatch) {
      metadata.statementPeriod = periodMatch[0].split(':')[1]?.trim();
    }

    return metadata;
  }

  /**
   * Full OCR pipeline: extract text and parse transactions
   */
  async processScannedPDF(pdfBuffer: Buffer): Promise<ParsedStatement & { confidence: number; usedOCR: boolean }> {
    const { text, confidence } = await this.extractTextFromPDF(pdfBuffer);
    const parsed = this.parseOCRText(text);

    return {
      ...parsed,
      confidence,
      usedOCR: true,
    };
  }
}

// Export singleton instance
export const ocrService = new OCRService();
