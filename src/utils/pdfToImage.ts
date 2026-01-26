/**
 * PDF to Image Converter
 * Converts PDF pages to images for OCR processing
 */

import { promisify } from 'util';
import { exec } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const execPromise = promisify(exec);

export interface PdfToImageOptions {
  /**
   * Resolution in DPI (dots per inch)
   * Higher = better OCR accuracy but larger file size
   * @default 300
   */
  dpi?: number;

  /**
   * Output format
   * @default 'png'
   */
  format?: 'png' | 'jpeg' | 'jpg';

  /**
   * Maximum number of pages to convert
   * @default undefined (all pages)
   */
  maxPages?: number;
}

/**
 * Convert PDF to images using pdf-poppler
 * Returns array of image buffers, one per page
 */
export async function convertPDFToImages(
  pdfBuffer: Buffer,
  options: PdfToImageOptions = {}
): Promise<Buffer[]> {
  const { dpi = 300, format = 'png', maxPages } = options;

  // Create temporary directory
  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'pdf-to-img-'));
  const pdfPath = path.join(tempDir, 'input.pdf');
  const outputPrefix = path.join(tempDir, 'page');

  try {
    // Write PDF buffer to temp file
    await fs.promises.writeFile(pdfPath, pdfBuffer);

    // Build pdftoppm command
    const formatFlag = format === 'jpeg' || format === 'jpg' ? '-jpeg' : '-png';
    const lastPageFlag = maxPages ? `-l ${maxPages}` : '';

    const command = `pdftoppm ${formatFlag} -r ${dpi} ${lastPageFlag} "${pdfPath}" "${outputPrefix}"`;

    console.log(`🖼️  Converting PDF to images at ${dpi} DPI...`);

    try {
      await execPromise(command);
    } catch (error: unknown) {
      const err = error as Error & { message: string };
      // Check if pdftoppm is not installed
      if (err.message.includes('command not found') || err.message.includes('not recognized')) {
        console.error('⚠️  pdftoppm not found. Please install poppler-utils:');
        console.error('   macOS: brew install poppler');
        console.error('   Ubuntu/Debian: apt-get install poppler-utils');
        console.error('   Windows: Download from https://github.com/oschwartz10612/poppler-windows/releases');
        throw new Error('pdftoppm command not found. Please install poppler-utils.');
      }
      throw err;
    }

    // Read generated image files
    const files = await fs.promises.readdir(tempDir);
    const imageFiles = files
      .filter(f => f.startsWith('page') && (f.endsWith('.png') || f.endsWith('.jpg') || f.endsWith('.jpeg')))
      .sort(); // Ensure correct page order

    if (imageFiles.length === 0) {
      throw new Error('No images were generated from PDF');
    }

    console.log(`✅ Generated ${imageFiles.length} image(s) from PDF`);

    // Read all image files into buffers
    const imageBuffers: Buffer[] = [];
    for (const file of imageFiles) {
      const imagePath = path.join(tempDir, file);
      const buffer = await fs.promises.readFile(imagePath);
      imageBuffers.push(buffer);
    }

    return imageBuffers;
  } finally {
    // Cleanup temp directory
    try {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    } catch (cleanupError) {
      console.error('Failed to cleanup temp directory:', cleanupError);
    }
  }
}

/**
 * Alternative implementation using pdfjs-dist (no external dependencies required)
 * This is a fallback if poppler-utils is not available
 * Note: Requires 'canvas' npm package to be installed
 */
export async function convertPDFToImagesWithPDFJS(
  pdfBuffer: Buffer,
  options: PdfToImageOptions = {}
): Promise<Buffer[]> {
  const { dpi = 300, maxPages } = options;

  try {
    // Dynamic import to avoid loading pdfjs-dist unless needed
    const pdfjs = await import('pdfjs-dist');
    let createCanvas: typeof import('canvas').createCanvas;

    try {
      const canvasModule = await import('canvas');
      createCanvas = canvasModule.createCanvas;
    } catch {
      throw new Error('Canvas package not installed. Please install with: npm install canvas');
    }

    // Load PDF
    const loadingTask = pdfjs.getDocument({ data: pdfBuffer });
    const pdf = await loadingTask.promise;

    const numPages = maxPages ? Math.min(maxPages, pdf.numPages) : pdf.numPages;
    const imageBuffers: Buffer[] = [];

    console.log(`🖼️  Converting ${numPages} PDF page(s) to images using PDF.js...`);

    for (let pageNum = 1; pageNum <= numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const viewport = page.getViewport({ scale: dpi / 72 }); // 72 DPI is default

      const canvas = createCanvas(viewport.width, viewport.height);
      const context = canvas.getContext('2d');

      await page.render({
        canvasContext: context,
        viewport: viewport,
        canvas: canvas,
      } as never).promise;

      // Convert canvas to buffer
      const buffer = canvas.toBuffer('image/png');
      imageBuffers.push(buffer);
    }

    console.log(`✅ Generated ${imageBuffers.length} image(s) from PDF using PDF.js`);
    return imageBuffers;
  } catch (error) {
    console.error('PDF.js conversion failed:', error);
    throw new Error('Failed to convert PDF to images using PDF.js. Ensure poppler-utils is installed instead.');
  }
}

/**
 * Smart converter that tries pdf-poppler first, then falls back to PDF.js
 */
export async function convertPDFToImagesAuto(
  pdfBuffer: Buffer,
  options: PdfToImageOptions = {}
): Promise<Buffer[]> {
  try {
    // Try pdf-poppler first (faster and better quality)
    return await convertPDFToImages(pdfBuffer, options);
  } catch (error: unknown) {
    const err = error as Error & { message: string };
    if (err.message.includes('pdftoppm')) {
      console.log('⚠️  Falling back to PDF.js for image conversion...');
      // Fall back to PDF.js if poppler is not available
      return await convertPDFToImagesWithPDFJS(pdfBuffer, options);
    }
    throw err;
  }
}
