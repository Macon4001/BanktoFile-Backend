/**
 * Manual Extract Route
 * API endpoints for manual table extraction
 */

import { Router, Request, Response } from 'express';
import multer from 'multer';
import { RegionExtractor, ColumnDefinition } from '../services/regionExtractor.js';
import { convertPDFToImagesAuto } from '../utils/pdfToImage.js';
import {
  countPagesMiddleware,
  checkPageLimitMiddleware,
  logConversionMiddleware,
} from '../middleware/pageLimitMiddleware.js';
import {
  checkIpRateLimitMiddleware,
  logIpConversionMiddleware,
} from '../middleware/ipRateLimitMiddleware.js';

const router = Router();
const regionExtractor = new RegionExtractor();

// Configure multer for memory storage
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: {
    fileSize: process.env.NODE_ENV === 'development' ? Infinity : 10 * 1024 * 1024, // 10MB
  },
});

/**
 * GET /api/pdf-to-image?page=1
 * Convert a specific PDF page to image for display
 */
router.post('/pdf-to-image', upload.single('file'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'No file uploaded' });
      return;
    }

    const pageNumber = parseInt(req.query.page as string) || 1;
    const dpi = parseInt(req.query.dpi as string) || 150; // Lower DPI for faster rendering

    console.log(`🖼️  Converting PDF page ${pageNumber} to image (${dpi} DPI)...`);

    // Convert PDF to images
    const imageBuffers = await convertPDFToImagesAuto(req.file.buffer, {
      dpi,
      maxPages: pageNumber,
    });

    if (pageNumber > imageBuffers.length) {
      res.status(400).json({ error: `Page ${pageNumber} not found. PDF has ${imageBuffers.length} pages.` });
      return;
    }

    const imageBuffer = imageBuffers[pageNumber - 1];

    // Get image dimensions (from buffer metadata or estimate)
    // For now, we'll return the buffer and let the frontend handle dimensions
    res.set('Content-Type', 'image/png');
    res.send(imageBuffer);
  } catch (error) {
    console.error('PDF to image conversion error:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to convert PDF to image',
    });
  }
});

/**
 * POST /api/pdf-page-count
 * Get the number of pages in a PDF
 */
router.post('/pdf-page-count', upload.single('file'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'No file uploaded' });
      return;
    }

    // Get page count using pdfjs
    const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const data = new Uint8Array(req.file.buffer);
    const loadingTask = pdfjsLib.getDocument({ data });
    const pdfDocument = await loadingTask.promise;

    // Get page dimensions for each page
    const pages = [];
    for (let pageNum = 1; pageNum <= pdfDocument.numPages; pageNum++) {
      const page = await pdfDocument.getPage(pageNum);
      const viewport = page.getViewport({ scale: 1.0 });
      pages.push({
        page: pageNum,
        width: viewport.width,
        height: viewport.height,
      });
    }

    res.status(200).json({
      pageCount: pdfDocument.numPages,
      pages,
    });
  } catch (error) {
    console.error('PDF page count error:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to get PDF page count',
    });
  }
});

/**
 * POST /api/manual-extract
 * Extract transactions using user-defined column regions
 */
router.post(
  '/manual-extract',
  upload.single('file'),
  checkIpRateLimitMiddleware,  // Check IP-based rate limiting first (for anonymous users)
  countPagesMiddleware,         // Count pages in PDF
  checkPageLimitMiddleware,     // Check if user has enough quota
  logIpConversionMiddleware,    // Log IP-based conversions (for anonymous users)
  logConversionMiddleware,      // Log user-based conversions (for authenticated users)
  async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'No file uploaded' });
      return;
    }

    // Parse request body
    const { columns, rows, pages, skipHeaderRows, region, pageGrids } = req.body;

    // Check if using new multi-page grid format or legacy single-grid format
    if (!pageGrids && !columns) {
      res.status(400).json({ error: 'Either columns or pageGrids definition is required' });
      return;
    }

    // Handle multi-page grid extraction (new format)
    if (pageGrids) {
      let parsedPageGrids;
      try {
        parsedPageGrids = typeof pageGrids === 'string' ? JSON.parse(pageGrids) : pageGrids;
      } catch (error) {
        res.status(400).json({ error: 'Invalid pageGrids JSON format' });
        return;
      }

      if (!Array.isArray(parsedPageGrids)) {
        res.status(400).json({ error: 'pageGrids must be an array' });
        return;
      }

      console.log('📋 Multi-page extraction request:');
      console.log(`   Total page grids: ${parsedPageGrids.length}`);
      console.log(`   Pages: ${parsedPageGrids.map((pg: any) => pg.page).join(', ')}`);

      // Validate each page grid
      for (const pageGrid of parsedPageGrids) {
        if (typeof pageGrid.page !== 'number') {
          res.status(400).json({ error: `Invalid page number: ${pageGrid.page}` });
          return;
        }
        if (!Array.isArray(pageGrid.columns)) {
          res.status(400).json({ error: `Invalid columns for page ${pageGrid.page}` });
          return;
        }
      }

      // Extract using multi-page grids
      const result = await regionExtractor.extractFromMultiplePageGrids({
        pdfBuffer: req.file.buffer,
        pageGrids: parsedPageGrids,
      });

      res.status(200).json({
        success: true,
        transactions: result.transactions,
        pageResults: result.pageResults,
        totalRows: result.totalRows,
        skippedRows: result.skippedRows,
        transactionCount: result.transactions.length,
      });
      return;
    }

    // Legacy single-grid extraction
    // Parse columns (they may be sent as JSON string)
    let parsedColumns: ColumnDefinition[];
    try {
      parsedColumns = typeof columns === 'string' ? JSON.parse(columns) : columns;
    } catch (error) {
      res.status(400).json({ error: 'Invalid columns JSON format' });
      return;
    }

    if (!Array.isArray(parsedColumns)) {
      res.status(400).json({ error: 'Columns must be an array' });
      return;
    }

    const parsedPages = pages === 'all' || !pages ? 'all' : JSON.parse(pages);
    const parsedSkipHeaderRows = skipHeaderRows ? parseInt(skipHeaderRows) : 1;

    // Parse region if provided
    let parsedRegion;
    if (region) {
      try {
        parsedRegion = typeof region === 'string' ? JSON.parse(region) : region;
      } catch (error) {
        res.status(400).json({ error: 'Invalid region JSON format' });
        return;
      }
    }

    // Parse rows if provided
    let parsedRows;
    if (rows) {
      try {
        parsedRows = typeof rows === 'string' ? JSON.parse(rows) : rows;
      } catch (error) {
        res.status(400).json({ error: 'Invalid rows JSON format' });
        return;
      }
    }

    console.log('📋 Manual extraction request (legacy):');
    console.log(`   Columns: ${parsedColumns.length}`);
    console.log(`   Rows: ${parsedRows ? parsedRows.length : 'auto-detect'}`);
    console.log(`   Pages: ${parsedPages === 'all' ? 'all' : parsedPages.length}`);
    console.log(`   Skip header rows: ${parsedSkipHeaderRows}`);
    console.log(`   Region: ${parsedRegion ? JSON.stringify(parsedRegion) : 'none'}`);
    console.log('   Column details:', JSON.stringify(parsedColumns, null, 2));

    // Validate columns
    for (let i = 0; i < parsedColumns.length; i++) {
      const column = parsedColumns[i];
      console.log(`   Validating column ${i}:`, column);

      if (typeof column.xStart !== 'number' || typeof column.xEnd !== 'number') {
        const error = `Invalid column definition at index ${i}: xStart and xEnd must be numbers. Got xStart=${typeof column.xStart}, xEnd=${typeof column.xEnd}`;
        console.error('❌', error);
        res.status(400).json({ error });
        return;
      }
      if (!column.label) {
        const error = `Invalid column definition at index ${i}: label is required. Got label=${column.label}`;
        console.error('❌', error);
        res.status(400).json({ error });
        return;
      }
    }

    // Extract transactions
    const result = await regionExtractor.extractFromRegions({
      pdfBuffer: req.file.buffer,
      columns: parsedColumns,
      rows: parsedRows,
      pages: parsedPages,
      skipHeaderRows: parsedSkipHeaderRows,
      region: parsedRegion,
    });

    res.status(200).json({
      success: true,
      transactions: result.transactions,
      pageResults: result.pageResults,
      totalRows: result.totalRows,
      skippedRows: result.skippedRows,
      transactionCount: result.transactions.length,
    });
  } catch (error) {
    console.error('Manual extraction error:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to extract transactions',
    });
  }
});

/**
 * POST /api/pdf-dimensions
 * Get PDF page dimensions for coordinate normalization
 */
router.post('/pdf-dimensions', upload.single('file'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'No file uploaded' });
      return;
    }

    const dimensions = await regionExtractor.getPageDimensions(req.file.buffer);

    res.status(200).json({
      success: true,
      dimensions,
    });
  } catch (error) {
    console.error('PDF dimensions error:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to get PDF dimensions',
    });
  }
});

/**
 * POST /api/pdf-text-positions
 * Get text element positions for intelligent line adjustment
 */
router.post('/pdf-text-positions', upload.single('file'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'No file uploaded' });
      return;
    }

    const pageNumber = parseInt(req.body.page as string) || 1;

    console.log(`📍 Extracting text positions for page ${pageNumber}...`);

    const textPositions = await regionExtractor.getTextPositions(req.file.buffer, pageNumber);

    res.status(200).json({
      success: true,
      elements: textPositions,
    });
  } catch (error) {
    console.error('PDF text positions error:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to get PDF text positions',
    });
  }
});

export default router;
