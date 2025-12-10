import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { TextItem } from 'pdfjs-dist/types/src/display/api';

// Configure PDF.js worker for Node.js using legacy build
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(pdfjsLib as any).GlobalWorkerOptions.workerSrc = 'pdfjs-dist/legacy/build/pdf.worker.mjs';

/**
 * Represents a text element with its position in the PDF
 */
export interface TextElement {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  pageNumber: number;
}

/**
 * Represents a row of text elements (grouped by Y coordinate)
 */
export interface TextRow {
  y: number;
  elements: TextElement[];
}

/**
 * Extract text with coordinates from a PDF buffer using pdf.js
 */
export class PDFCoordinateExtractor {
  /**
   * Extract all text elements with their coordinates from a PDF
   * @param buffer PDF file buffer
   * @returns Array of text elements with position data
   */
  async extractTextWithCoordinates(buffer: Buffer): Promise<TextElement[]> {
    const allElements: TextElement[] = [];

    try {
      // Load the PDF document
      const data = new Uint8Array(buffer);
      const loadingTask = pdfjsLib.getDocument({ data });
      const pdfDocument = await loadingTask.promise;

      console.log(`[PDF Coordinate Extractor] Loaded PDF with ${pdfDocument.numPages} pages`);

      // Process each page
      for (let pageNum = 1; pageNum <= pdfDocument.numPages; pageNum++) {
        const page = await pdfDocument.getPage(pageNum);
        const textContent = await page.getTextContent();
        const viewport = page.getViewport({ scale: 1.0 });

        console.log(`[Page ${pageNum}] Processing ${textContent.items.length} text items`);

        // Extract text items with coordinates
        for (const item of textContent.items) {
          // Type guard to check if item is TextItem (not TextMarkedContent)
          if ('str' in item && 'transform' in item) {
            const textItem = item as TextItem;

            // transform[4] is X coordinate, transform[5] is Y coordinate
            // PDF coordinates are bottom-left origin, we'll keep them as-is for now
            const x = textItem.transform[4];
            const y = textItem.transform[5];

            // Calculate width and height approximation
            const width = textItem.width || 0;
            const height = textItem.height || 0;

            allElements.push({
              text: textItem.str.trim(),
              x,
              y: viewport.height - y, // Flip Y to top-down coordinates
              width,
              height,
              pageNumber: pageNum,
            });
          }
        }
      }

      console.log(`[PDF Coordinate Extractor] Extracted ${allElements.length} text elements total`);
      return allElements;
    } catch (error) {
      console.error('[PDF Coordinate Extractor] Error extracting coordinates:', error);
      throw new Error('Failed to extract PDF coordinates');
    }
  }

  /**
   * Group text elements into rows based on Y coordinate proximity
   * @param elements Array of text elements
   * @param yTolerance Maximum Y distance to consider elements in same row (default: 5)
   * @returns Array of rows, each containing elements sorted by X coordinate
   */
  groupIntoRows(elements: TextElement[], yTolerance: number = 5): TextRow[] {
    const rows = new Map<number, TextElement[]>();

    // Group elements by Y coordinate with tolerance
    for (const element of elements) {
      if (!element.text) continue; // Skip empty text

      // Find existing row within tolerance
      let foundRow = false;
      const rowEntries = Array.from(rows.entries());
      for (const [y, rowElements] of rowEntries) {
        if (Math.abs(element.y - y) <= yTolerance) {
          rowElements.push(element);
          foundRow = true;
          break;
        }
      }

      if (!foundRow) {
        rows.set(element.y, [element]);
      }
    }

    // Convert to array and sort rows by Y (top to bottom)
    const rowsArray = Array.from(rows.entries());
    const sortedRows: TextRow[] = rowsArray
      .map(([y, elements]) => ({
        y,
        elements: elements.sort((a, b) => a.x - b.x), // Sort elements within row by X (left to right)
      }))
      .sort((a, b) => a.y - b.y); // Sort rows by Y (top to bottom)

    console.log(`[PDF Coordinate Extractor] Grouped ${elements.length} elements into ${sortedRows.length} rows`);

    return sortedRows;
  }

  /**
   * Debug: Print text elements with coordinates for troubleshooting
   * @param elements Array of text elements
   * @param limit Maximum number of elements to print (default: 50)
   */
  debugPrintElements(elements: TextElement[], limit: number = 50): void {
    console.log('\n========== PDF COORDINATE DEBUG ==========');
    console.log(`Total elements: ${elements.length}`);
    console.log(`Showing first ${Math.min(limit, elements.length)} elements:\n`);

    elements.slice(0, limit).forEach((el, idx) => {
      console.log(
        `[${idx + 1}] Page ${el.pageNumber} | X:${el.x.toFixed(1)} Y:${el.y.toFixed(1)} | "${el.text.substring(0, 40)}${el.text.length > 40 ? '...' : ''}"`
      );
    });

    console.log('==========================================\n');
  }

  /**
   * Debug: Print rows with their elements for troubleshooting
   * @param rows Array of text rows
   * @param limit Maximum number of rows to print (default: 20)
   */
  debugPrintRows(rows: TextRow[], limit: number = 20): void {
    console.log('\n========== PDF ROWS DEBUG ==========');
    console.log(`Total rows: ${rows.length}`);
    console.log(`Showing first ${Math.min(limit, rows.length)} rows:\n`);

    rows.slice(0, limit).forEach((row, idx) => {
      const rowText = row.elements.map(el => el.text).join(' | ');
      console.log(`[Row ${idx + 1}] Y:${row.y.toFixed(1)} | ${rowText.substring(0, 100)}${rowText.length > 100 ? '...' : ''}`);
    });

    console.log('====================================\n');
  }
}
