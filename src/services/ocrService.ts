import Tesseract from 'tesseract.js';
import { Transaction, ParsedStatement } from '../types/index.js';
import { googleVisionOCRService, GoogleVisionConfig } from './googleVisionOCR.js';
import { convertPDFToImagesAuto } from '../utils/pdfToImage.js';
import { checkParsingAccuracy, logSanityCheckResult } from '../utils/parsingAccuracyCheck.js';

export type OCRProvider = 'tesseract' | 'google-vision' | 'auto';

export class OCRService {
  private scheduler: Tesseract.Scheduler | null = null;
  private preferredProvider: OCRProvider = 'auto';

  /**
   * Initialize OCR services (both Tesseract and Google Vision)
   * Call this once at server startup
   */
  async initialize(numWorkers: number = 2, googleVisionConfig?: GoogleVisionConfig): Promise<void> {
    console.log(`Initializing OCR services...`);

    // Initialize Tesseract
    console.log(`Setting up Tesseract with ${numWorkers} workers...`);
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

    console.log('✅ Tesseract OCR initialized successfully');

    // Initialize Google Vision (optional)
    await googleVisionOCRService.initialize(googleVisionConfig);

    // Set preferred provider based on availability
    if (googleVisionOCRService.isEnabled()) {
      this.preferredProvider = 'auto'; // Will use Google Vision as fallback
      console.log('OCR Strategy: Tesseract first, Google Vision fallback');
    } else {
      this.preferredProvider = 'tesseract';
      console.log('OCR Strategy: Tesseract only');
    }
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
   * Tries multiple providers with intelligent fallback
   */
  async extractTextFromPDF(
    pdfBuffer: Buffer,
    provider: OCRProvider = 'auto'
  ): Promise<{ text: string; confidence: number; provider: string; pageCount?: number }> {
    const effectiveProvider = provider === 'auto' ? this.preferredProvider : provider;

    // Strategy: Try Tesseract first (free), fall back to Google Vision if needed
    if (effectiveProvider === 'auto') {
      try {
        console.log('🔍 Trying Tesseract OCR first...');
        const result = await this.extractTextWithTesseract(pdfBuffer);

        // If Tesseract worked well (good confidence and reasonable text length)
        if (result.confidence > 60 && result.text.length > 100) {
          console.log('✅ Tesseract OCR successful');
          return { ...result, provider: 'tesseract' };
        }

        // If Tesseract had low confidence or poor results, try Google Vision
        if (googleVisionOCRService.isEnabled()) {
          console.log('⚠️  Tesseract confidence low, trying Google Vision...');
          return await this.extractTextWithGoogleVision(pdfBuffer);
        }

        // No fallback available, return Tesseract result
        console.log('⚠️  Tesseract confidence low but no fallback available');
        return { ...result, provider: 'tesseract' };
      } catch (tesseractError) {
        console.error('Tesseract OCR failed:', tesseractError);

        // Try Google Vision as fallback
        if (googleVisionOCRService.isEnabled()) {
          console.log('🔄 Falling back to Google Vision OCR...');
          return await this.extractTextWithGoogleVision(pdfBuffer);
        }

        throw tesseractError;
      }
    } else if (effectiveProvider === 'google-vision') {
      return await this.extractTextWithGoogleVision(pdfBuffer);
    } else {
      const result = await this.extractTextWithTesseract(pdfBuffer);
      return { ...result, provider: 'tesseract' };
    }
  }

  /**
   * Extract text using Tesseract OCR
   */
  private async extractTextWithTesseract(pdfBuffer: Buffer): Promise<{ text: string; confidence: number }> {
    try {
      console.log('Starting Tesseract OCR...');
      const startTime = Date.now();

      // Convert PDF to images first (Tesseract cannot read PDF buffers)
      console.log('Converting PDF to images for Tesseract...');
      const images = await convertPDFToImagesAuto(pdfBuffer);
      console.log(`Converted PDF to ${images.length} images`);

      // Process each page image with Tesseract
      const pageResults: Array<{ text: string; confidence: number }> = [];

      for (let i = 0; i < images.length; i++) {
        console.log(`Processing page ${i + 1}/${images.length} with Tesseract...`);

        const { data } = await Tesseract.recognize(images[i], 'eng', {
          logger: (m) => {
            if (m.status === 'recognizing text') {
              console.log(`  Page ${i + 1} Progress: ${Math.round(m.progress * 100)}%`);
            }
          },
        });

        pageResults.push({
          text: data.text,
          confidence: data.confidence,
        });

        console.log(`  Page ${i + 1} completed - Confidence: ${data.confidence.toFixed(1)}%`);
      }

      // Combine results from all pages
      const combinedText = pageResults.map(r => r.text).join('\n\n');
      const avgConfidence = pageResults.reduce((sum, r) => sum + r.confidence, 0) / pageResults.length;

      const endTime = Date.now();
      console.log(`Tesseract completed ${images.length} pages in ${(endTime - startTime) / 1000}s`);
      console.log(`Average Confidence: ${avgConfidence.toFixed(1)}%`);
      console.log(`Extracted text length: ${combinedText.length} characters`);

      return {
        text: combinedText,
        confidence: avgConfidence,
      };
    } catch (error) {
      console.error('Tesseract OCR error:', error);
      throw new Error('Failed to perform OCR with Tesseract');
    }
  }

  /**
   * Extract text using Google Vision OCR
   */
  private async extractTextWithGoogleVision(
    pdfBuffer: Buffer
  ): Promise<{ text: string; confidence: number; provider: string; pageCount: number }> {
    if (!googleVisionOCRService.isEnabled()) {
      throw new Error('Google Vision OCR is not enabled');
    }

    try {
      const result = await googleVisionOCRService.extractTextFromPDF(pdfBuffer);
      return {
        text: result.text,
        confidence: result.confidence,
        provider: 'google-vision',
        pageCount: result.pageCount,
      };
    } catch (error) {
      console.error('Google Vision OCR error:', error);
      throw new Error('Failed to perform OCR with Google Vision');
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
    cleaned = cleaned.replace(/(\d+\.)([SB])(\d)/g, (_match, p1, p2, p3) => {
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
      /\b(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})\b/,
      /\b(\d{4}[/-]\d{1,2}[/-]\d{1,2})\b/,
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
    const periodMatch = text.match(/(?:statement\s+period|period)\s*:?\s*([\w\s,\-/]+)/gi);
    if (periodMatch) {
      metadata.statementPeriod = periodMatch[0].split(':')[1]?.trim();
    }

    return metadata;
  }

  /**
   * Full OCR pipeline: extract text and parse transactions
   * Includes intelligent fallback - if Tesseract results are poor, tries Google Vision
   */
  async processScannedPDF(
    pdfBuffer: Buffer,
    provider: OCRProvider = 'auto',
    pageCount?: number
  ): Promise<ParsedStatement & { confidence: number; usedOCR: boolean; ocrProvider?: string; pageCount?: number }> {
    const ocrResult = await this.extractTextFromPDF(pdfBuffer, provider);
    const parsed = this.parseOCRText(ocrResult.text);

    // Log OCR usage for cost tracking
    this.logOCRUsage(ocrResult);

    // If using auto mode with Tesseract, check if results pass sanity check
    if (provider === 'auto' && ocrResult.provider === 'tesseract' && pageCount && pageCount > 0) {
      console.log('🔍 Checking Tesseract OCR results with sanity check...');

      const sanityCheck = checkParsingAccuracy({
        pageCount: pageCount,
        textLength: ocrResult.text.length,
        transactions: parsed.transactions,
      });

      logSanityCheckResult(sanityCheck);

      // If Tesseract results also fail sanity check, try Google Vision as final fallback
      if (!sanityCheck.passed && googleVisionOCRService.isEnabled()) {
        console.log('⚠️  Tesseract OCR results failed sanity check - trying Google Vision as final fallback...');

        try {
          const googleResult = await this.extractTextWithGoogleVision(pdfBuffer);
          const googleParsed = this.parseOCRText(googleResult.text);

          // Log Google Vision usage
          this.logOCRUsage(googleResult);

          console.log(`✅ Google Vision extracted ${googleParsed.transactions.length} transactions`);

          // Use Google Vision results if better
          if (googleParsed.transactions.length > parsed.transactions.length) {
            console.log(`✅ Google Vision results are better (${googleParsed.transactions.length} vs ${parsed.transactions.length})`);
            return {
              ...googleParsed,
              confidence: googleResult.confidence,
              usedOCR: true,
              ocrProvider: 'google-vision',
              pageCount: googleResult.pageCount,
            };
          } else {
            console.log(`⚠️  Google Vision didn't improve results, using Tesseract output`);
          }
        } catch (googleError) {
          console.error('❌ Google Vision fallback failed:', googleError);
          // Continue with Tesseract results
        }
      }
    }

    return {
      ...parsed,
      confidence: ocrResult.confidence,
      usedOCR: true,
      ocrProvider: ocrResult.provider,
      pageCount: ocrResult.pageCount,
    };
  }

  /**
   * Log OCR usage for monitoring and cost tracking
   */
  private logOCRUsage(result: { provider: string; confidence: number; pageCount?: number }): void {
    const timestamp = new Date().toISOString();
    const logMessage = {
      timestamp,
      provider: result.provider,
      confidence: result.confidence,
      pageCount: result.pageCount || 1,
      estimatedCost:
        result.provider === 'google-vision' && result.pageCount
          ? (result.pageCount * 0.0015).toFixed(4)
          : '0.0000',
    };

    console.log('📊 OCR Usage:', JSON.stringify(logMessage));

    // TODO: Store in database for cost tracking and analytics
    // This could be added later for production monitoring
  }
}

// Export singleton instance
export const ocrService = new OCRService();
