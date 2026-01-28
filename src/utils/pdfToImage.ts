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
    // Import canvas module first
    let canvasModule: typeof import('canvas');
    try {
      canvasModule = await import('canvas');
    } catch {
      throw new Error('Canvas package not installed. Please install with: npm install canvas');
    }

    const { createCanvas, registerFont, Image: CanvasImage } = canvasModule;

    // Set up Image for canvas BEFORE importing pdfjs-dist
    // PDF.js needs a global Image constructor for rendering inline images
    if (typeof (globalThis as { Image?: unknown }).Image === 'undefined') {
      (globalThis as unknown as { Image: typeof CanvasImage }).Image = CanvasImage;
      console.log('✅ Set up globalThis.Image for PDF.js canvas rendering');
    }

    // Dynamic import of pdfjs-dist after setting up global Image
    // Use legacy build for Node.js environments
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');

    // Disable worker to avoid compatibility issues in Node.js
    pdfjs.GlobalWorkerOptions.workerSrc = '';

    // Register system fonts for better text rendering
    // This helps prevent □□□ (missing glyph) characters
    try {
      if (process.platform === 'darwin') {
        // macOS system fonts
        try {
          registerFont('/System/Library/Fonts/Helvetica.ttc', { family: 'Helvetica' });
          console.log('✅ Registered Helvetica font');
        } catch {
          // Font not available, skip
        }
        try {
          registerFont('/System/Library/Fonts/SFNSText.ttf', { family: 'SF Pro Text' });
          console.log('✅ Registered SF Pro Text font');
        } catch {
          // Font not available, skip
        }
      } else if (process.platform === 'linux') {
        // Linux system fonts (multiple possible locations)
        const linuxFontPaths = [
          // Standard Linux paths
          '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
          '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf',
          // Alternative Debian/Ubuntu paths
          '/usr/share/fonts/dejavu/DejaVuSans.ttf',
          '/usr/share/fonts/liberation/LiberationSans-Regular.ttf',
        ];

        let registeredCount = 0;

        // Try standard paths first
        for (const fontPath of linuxFontPaths) {
          try {
            if (fs.existsSync(fontPath)) {
              const family = fontPath.includes('DejaVu') ? 'DejaVu Sans' : 'Liberation Sans';
              registerFont(fontPath, { family });
              console.log(`✅ Registered ${family} font from ${fontPath}`);
              registeredCount++;
            }
          } catch {
            // Font not available or registration failed, skip
          }
        }

        // If no fonts found, search in /nix/store (NixOS/Railway environment)
        if (registeredCount === 0) {
          console.log('🔍 Searching for fonts in /nix/store...');
          try {
            if (fs.existsSync('/nix/store')) {
              const nixStoreDirs = fs.readdirSync('/nix/store');

              // Look for dejavu_fonts or liberation packages
              for (const dir of nixStoreDirs) {
                if (dir.includes('dejavu-fonts') || dir.includes('liberation-fonts')) {
                  const possibleFontPaths = [
                    `/nix/store/${dir}/share/fonts/truetype/DejaVuSans.ttf`,
                    `/nix/store/${dir}/share/fonts/truetype/dejavu/DejaVuSans.ttf`,
                    `/nix/store/${dir}/share/fonts/truetype/LiberationSans-Regular.ttf`,
                    `/nix/store/${dir}/share/fonts/truetype/liberation/LiberationSans-Regular.ttf`,
                  ];

                  for (const fontPath of possibleFontPaths) {
                    try {
                      if (fs.existsSync(fontPath)) {
                        const family = fontPath.includes('DejaVu') ? 'DejaVu Sans' : 'Liberation Sans';
                        registerFont(fontPath, { family });
                        console.log(`✅ Registered ${family} font from ${fontPath}`);
                        registeredCount++;
                      }
                    } catch {
                      // Font registration failed, skip
                    }
                  }
                }
              }
            }
          } catch (nixError) {
            console.warn('⚠️  Could not search /nix/store:', nixError);
          }
        }

        if (registeredCount === 0) {
          console.warn('⚠️  No Linux fonts could be registered. Unicode characters may not display correctly.');
          console.warn('    Ensure dejavu_fonts or liberation_ttf packages are installed.');
        } else {
          console.log(`✅ Successfully registered ${registeredCount} font(s)`);
        }
      } else if (process.platform === 'win32') {
        // Windows system fonts
        try {
          registerFont('C:\\Windows\\Fonts\\arial.ttf', { family: 'Arial' });
          console.log('✅ Registered Arial font');
        } catch {
          // Font not available, skip
        }
      }
    } catch (fontError) {
      console.warn('⚠️  Could not register system fonts:', fontError);
      // Continue anyway - canvas will use default fonts
    }

    // Configure PDF.js for Node.js environment
    // Convert Buffer to Uint8Array (PDF.js requirement)
    const uint8Array = new Uint8Array(pdfBuffer);

    // Configure font paths - DISABLED for now as they cause issues in production
    // PDF.js will use its built-in font rendering instead
    // This may result in some Unicode characters not displaying perfectly,
    // but it's better than crashing with "require is not defined"
    console.log('ℹ️  Using PDF.js built-in font rendering (external fonts disabled)');

    const loadingTask = pdfjs.getDocument({
      data: uint8Array,
      // Enable font rendering for proper text display
      disableFontFace: false,
      // Ensure fonts are properly embedded
      useSystemFonts: true,
    });
    const pdf = await loadingTask.promise;

    const numPages = maxPages ? Math.min(maxPages, pdf.numPages) : pdf.numPages;
    const imageBuffers: Buffer[] = [];

    console.log(`🖼️  Converting ${numPages} PDF page(s) to images using PDF.js...`);

    for (let pageNum = 1; pageNum <= numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const viewport = page.getViewport({ scale: dpi / 72 }); // 72 DPI is default

      const canvas = createCanvas(viewport.width, viewport.height);
      const context = canvas.getContext('2d');

      // Configure canvas context for better text rendering
      context.imageSmoothingEnabled = true;
      // Type assertion needed as imageSmoothingQuality is not in Node canvas types
      (context as { imageSmoothingQuality?: string }).imageSmoothingQuality = 'high';

      // Create a canvas factory for PDF.js to use for inline images
      const canvasFactory = {
        create: (width: number, height: number) => {
          const imgCanvas = createCanvas(width, height);
          return {
            canvas: imgCanvas,
            context: imgCanvas.getContext('2d'),
          };
        },
        reset: (canvasAndContext: { canvas: unknown; context: unknown }, width: number, height: number) => {
          const { canvas: c } = canvasAndContext as { canvas: { width: number; height: number } };
          c.width = width;
          c.height = height;
        },
        destroy: () => {
          // No cleanup needed for node-canvas
        },
      };

      await page.render({
        canvasContext: context,
        viewport: viewport,
        // Enable text rendering improvements
        intent: 'display',
        // Provide canvas factory for inline images
        canvasFactory,
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
