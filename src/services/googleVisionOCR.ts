/**
 * Google Vision OCR Service
 * High-accuracy OCR using Google Cloud Vision API
 * Used as a premium fallback when Tesseract fails
 */

import vision from '@google-cloud/vision';
import { convertPDFToImagesAuto } from '../utils/pdfToImage.js';

export interface GoogleVisionConfig {
  /**
   * Path to service account JSON file
   * OR set GOOGLE_APPLICATION_CREDENTIALS env var
   */
  keyFilename?: string;

  /**
   * API Key (alternative to service account)
   * Set GOOGLE_VISION_API_KEY env var
   */
  apiKey?: string;
}

export interface OCRResult {
  text: string;
  confidence: number;
  pageCount: number;
}

export interface OCRTextElement {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  confidence: number;
}

export interface OCRPageResult {
  pageNumber: number;
  elements: OCRTextElement[];
  width: number;
  height: number;
  imageWidth: number;
  imageHeight: number;
}

export class GoogleVisionOCRService {
  private client: InstanceType<typeof vision.ImageAnnotatorClient> | null = null;
  private enabled: boolean = false;

  /**
   * Initialize Google Vision client
   */
  async initialize(config?: GoogleVisionConfig): Promise<void> {
    try {
      // Check if credentials are provided
      const hasCredentials =
        config?.keyFilename ||
        config?.apiKey ||
        process.env.GOOGLE_APPLICATION_CREDENTIALS ||
        process.env.GOOGLE_VISION_API_KEY;

      if (!hasCredentials) {
        console.log('⚠️  Google Vision OCR not configured - will use Tesseract only');
        this.enabled = false;
        return;
      }

      // Initialize client
      const clientConfig: { keyFilename?: string; apiKey?: string } = {};

      if (config?.keyFilename) {
        clientConfig.keyFilename = config.keyFilename;
      } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
        clientConfig.keyFilename = process.env.GOOGLE_APPLICATION_CREDENTIALS;
      }

      if (config?.apiKey) {
        clientConfig.apiKey = config.apiKey;
      } else if (process.env.GOOGLE_VISION_API_KEY) {
        clientConfig.apiKey = process.env.GOOGLE_VISION_API_KEY;
      }

      this.client = new vision.ImageAnnotatorClient(clientConfig);
      this.enabled = true;

      console.log('✅ Google Vision OCR initialized successfully');
    } catch (error) {
      console.error('Failed to initialize Google Vision OCR:', error);
      this.enabled = false;
      console.log('⚠️  Falling back to Tesseract OCR only');
    }
  }

  /**
   * Check if Google Vision is available
   */
  isEnabled(): boolean {
    return this.enabled && this.client !== null;
  }

  /**
   * Extract text from a single image using Google Vision
   */
  async extractTextFromImage(imageBuffer: Buffer): Promise<string> {
    if (!this.client) {
      throw new Error('Google Vision client not initialized');
    }

    try {
      // Use document text detection (optimized for dense text like bank statements)
      const [result] = await this.client.documentTextDetection({
        image: { content: imageBuffer },
      });

      const fullTextAnnotation = result.fullTextAnnotation;
      if (!fullTextAnnotation || !fullTextAnnotation.text) {
        console.log('⚠️  Google Vision returned no text for image');
        return '';
      }

      return fullTextAnnotation.text;
    } catch (error) {
      console.error('Google Vision API error:', error);
      // Don't crash - return empty string so fallback can handle it
      return '';
    }
  }

  /**
   * Extract text WITH coordinates from a single image using Google Vision
   * Returns word-level bounding boxes for use in manual extraction
   */
  async extractTextWithCoordinates(imageBuffer: Buffer, pageNumber: number = 1): Promise<OCRPageResult> {
    if (!this.client) {
      throw new Error('Google Vision client not initialized');
    }

    try {
      console.log(`🔍 Running Google Vision OCR with coordinate extraction...`);

      // Use document text detection (optimized for dense text like bank statements)
      const [result] = await this.client.documentTextDetection({
        image: { content: imageBuffer },
      });

      const fullTextAnnotation = result.fullTextAnnotation;
      if (!fullTextAnnotation || !fullTextAnnotation.pages || fullTextAnnotation.pages.length === 0) {
        console.log('⚠️  Google Vision returned no text for image');
        return {
          pageNumber,
          elements: [],
          width: 0,
          height: 0,
          imageWidth: 0,
          imageHeight: 0,
        };
      }

      const elements: OCRTextElement[] = [];
      const page = fullTextAnnotation.pages[0]; // Single image = single page
      const pageWidth = page.width || 0;
      const pageHeight = page.height || 0;

      // Parse word-level bounding boxes
      for (const block of page.blocks || []) {
        for (const paragraph of block.paragraphs || []) {
          for (const word of paragraph.words || []) {
            // Get the word text from symbols
            const wordText = (word.symbols || []).map(s => s.text).join('');

            if (!wordText.trim()) continue;

            // Get bounding box vertices
            const vertices = word.boundingBox?.vertices || [];
            if (vertices.length < 4) continue;

            // Calculate bounding box dimensions
            // vertices[0] = top-left, vertices[1] = top-right, vertices[2] = bottom-right, vertices[3] = bottom-left
            const x = vertices[0].x || 0;
            const y = vertices[0].y || 0;
            const x2 = vertices[1].x || vertices[2].x || 0;
            const y2 = vertices[2].y || vertices[3].y || 0;
            const width = x2 - x;
            const height = y2 - y;

            // Get confidence (0-1 scale, convert to 0-100)
            const confidence = (word.confidence || 0) * 100;

            elements.push({
              text: wordText,
              x,
              y,
              width: Math.max(width, 1), // Ensure positive width
              height: Math.max(height, 1), // Ensure positive height
              confidence,
            });
          }
        }
      }

      console.log(`✅ Google Vision OCR found ${elements.length} text elements`);
      console.log(`   Image dimensions: ${pageWidth}x${pageHeight} pixels`);

      return {
        pageNumber,
        elements,
        width: pageWidth,
        height: pageHeight,
        imageWidth: pageWidth,
        imageHeight: pageHeight,
      };
    } catch (error) {
      console.error('Google Vision API error:', error);
      // Return empty result on error
      return {
        pageNumber,
        elements: [],
        width: 0,
        height: 0,
        imageWidth: 0,
        imageHeight: 0,
      };
    }
  }

  /**
   * Extract text from PDF by converting to images and running OCR
   * This is the main method used by the parsing pipeline
   */
  async extractTextFromPDF(pdfBuffer: Buffer): Promise<OCRResult> {
    if (!this.isEnabled()) {
      throw new Error('Google Vision OCR not enabled');
    }

    console.log('🔍 OCR Fallback triggered - Using Google Vision');

    const startTime = Date.now();

    try {
      // Convert PDF to images
      const imageBuffers = await convertPDFToImagesAuto(pdfBuffer, {
        dpi: 300, // Good balance between quality and size
        format: 'png',
      });

      const pageCount = imageBuffers.length;
      console.log(`📄 Processing ${pageCount} page(s) with Google Vision`);

      // Process each page with OCR
      const pageTexts: string[] = [];
      let totalConfidence = 0;

      for (let i = 0; i < imageBuffers.length; i++) {
        console.log(`   Processing page ${i + 1}/${pageCount}...`);

        const text = await this.extractTextFromImage(imageBuffers[i]);
        pageTexts.push(text);

        // Calculate rough confidence based on text length
        // (Google Vision doesn't provide overall confidence easily)
        if (text.length > 0) {
          totalConfidence += 1;
        }
      }

      // Combine all pages
      const fullText = pageTexts.join('\n\n');
      const confidence = (totalConfidence / pageCount) * 100;

      const endTime = Date.now();
      const duration = ((endTime - startTime) / 1000).toFixed(2);

      console.log(`✅ OCR extracted ${fullText.length} characters in ${duration}s`);
      console.log(`💰 OCR cost estimate: ${pageCount} units used (approx $${(pageCount * 0.0015).toFixed(4)})`);

      return {
        text: fullText,
        confidence,
        pageCount,
      };
    } catch (error) {
      console.error('Failed to extract text from PDF with Google Vision:', error);
      throw error;
    }
  }

  /**
   * Batch process multiple images (more efficient for multi-page PDFs)
   */
  async extractTextFromImages(imageBuffers: Buffer[]): Promise<OCRResult> {
    if (!this.isEnabled()) {
      throw new Error('Google Vision OCR not enabled');
    }

    console.log(`📄 Processing ${imageBuffers.length} images with Google Vision`);

    const startTime = Date.now();
    const pageTexts: string[] = [];
    let successfulPages = 0;

    // Process images sequentially (parallel can hit rate limits)
    for (let i = 0; i < imageBuffers.length; i++) {
      console.log(`   Processing image ${i + 1}/${imageBuffers.length}...`);

      try {
        const text = await this.extractTextFromImage(imageBuffers[i]);
        pageTexts.push(text);

        if (text.length > 0) {
          successfulPages++;
        }
      } catch (error) {
        console.error(`Failed to process image ${i + 1}:`, error);
        pageTexts.push(''); // Add empty string to maintain page order
      }
    }

    const fullText = pageTexts.join('\n\n');
    const confidence = (successfulPages / imageBuffers.length) * 100;

    const endTime = Date.now();
    const duration = ((endTime - startTime) / 1000).toFixed(2);

    console.log(`✅ OCR extracted ${fullText.length} characters in ${duration}s`);
    console.log(`💰 OCR cost estimate: ${imageBuffers.length} units used (approx $${(imageBuffers.length * 0.0015).toFixed(4)})`);

    return {
      text: fullText,
      confidence,
      pageCount: imageBuffers.length,
    };
  }

  /**
   * Get OCR usage cost estimate
   * Google Vision pricing: ~$1.50 per 1000 images
   * First 1000 images per month are free
   */
  static estimateCost(pageCount: number): number {
    return pageCount * 0.0015; // $0.0015 per page
  }
}

// Export singleton instance
export const googleVisionOCRService = new GoogleVisionOCRService();
