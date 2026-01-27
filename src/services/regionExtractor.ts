/**
 * Region Extractor Service
 * Extracts text from user-defined column regions in PDF
 */

import { PDFCoordinateExtractor, TextElement, TextRow } from './pdfCoordinateExtractor.js';
import { Transaction } from '../types/index.js';

export interface ColumnDefinition {
  xStart: number;
  xEnd: number;
  label: 'date' | 'description' | 'type' | 'amount' | 'amountIn' | 'amountOut' | 'balance' | 'ignore';
  pageWidth?: number; // For coordinate normalization
}

export interface RowDefinition {
  yStart: number;
  yEnd: number;
}

export interface TableRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ManualExtractionRequest {
  pdfBuffer: Buffer;
  columns: ColumnDefinition[];
  rows?: RowDefinition[]; // Optional explicit row boundaries for grid extraction
  pages?: number[] | 'all'; // Which pages to extract from
  skipHeaderRows?: number; // Number of header rows to skip (only used if rows not provided)
  yTolerance?: number; // Tolerance for grouping rows (default: 5, only used if rows not provided)
  region?: TableRegion; // Optional rectangular region to extract from
}

export interface ManualExtractionResult {
  transactions: Transaction[];
  pageResults: {
    page: number;
    rowCount: number;
    transactionCount: number;
  }[];
  totalRows: number;
  skippedRows: number;
}

export interface PageGridDefinition {
  page: number;
  columns: ColumnDefinition[];
  rows?: RowDefinition[];
  region?: TableRegion;
  skipHeaderRows?: number;
}

export interface MultiPageGridRequest {
  pdfBuffer: Buffer;
  pageGrids: PageGridDefinition[];
  yTolerance?: number;
}

export class RegionExtractor {
  private coordinateExtractor: PDFCoordinateExtractor;

  constructor() {
    this.coordinateExtractor = new PDFCoordinateExtractor();
  }

  /**
   * Extract transactions from user-defined column regions
   */
  async extractFromRegions(
    request: ManualExtractionRequest
  ): Promise<ManualExtractionResult> {
    const {
      pdfBuffer,
      columns,
      rows: rowDefs,
      pages = 'all',
      skipHeaderRows = 1,
      yTolerance = 5,
      region,
    } = request;

    console.log('🔍 Starting manual region extraction...');
    console.log(`   Columns: ${columns.length}`);
    if (rowDefs) {
      console.log(`   Rows: ${rowDefs.length} (grid-based extraction)`);
    } else {
      console.log(`   Skip header rows: ${skipHeaderRows}`);
    }
    if (region) {
      console.log(`   Region (image coords): x=${region.x}, y=${region.y}, w=${region.width}, h=${region.height}`);
    }

    // Extract all text elements with coordinates
    const allElements = await this.coordinateExtractor.extractTextWithCoordinates(pdfBuffer);

    // Get actual PDF dimensions to calculate scale factor
    const pdfDimensions = await this.getPageDimensions(pdfBuffer);
    const firstPageDims = pdfDimensions[0];

    // The frontend renders images at 150 DPI, but PDF coordinates are in points (72 DPI)
    // We need to scale the image coordinates to PDF coordinates
    // Scale factor = PDF native size / Image rendered size
    // For 150 DPI rendering: image is 150/72 = 2.083x larger than PDF
    const imageToPointsScale = 72 / 150; // = 0.48

    console.log(`   PDF page dimensions: ${firstPageDims.width} x ${firstPageDims.height} points`);
    console.log(`   Image-to-PDF scale factor: ${imageToPointsScale.toFixed(4)}`);

    // Scale region coordinates from image space to PDF point space
    let scaledRegion = region
      ? {
          x: region.x * imageToPointsScale,
          y: region.y * imageToPointsScale,
          width: region.width * imageToPointsScale,
          height: region.height * imageToPointsScale,
        }
      : null;

    if (scaledRegion) {
      console.log(`   Region (PDF coords): x=${scaledRegion.x.toFixed(2)}, y=${scaledRegion.y.toFixed(2)}, w=${scaledRegion.width.toFixed(2)}, h=${scaledRegion.height.toFixed(2)}`);
    }

    // Scale row definitions from image space to PDF point space
    const scaledRowDefs = rowDefs
      ? rowDefs.map((row) => ({
          yStart: row.yStart * imageToPointsScale,
          yEnd: row.yEnd * imageToPointsScale,
        }))
      : undefined;

    // Scale column definitions from image space to PDF point space
    const scaledColumns = columns.map((col) => ({
      ...col,
      xStart: col.xStart * imageToPointsScale,
      xEnd: col.xEnd * imageToPointsScale,
    }));

    // Color codes for visual debugging
    const colors = ['🔴', '🟠', '🟡', '🟢', '🔵', '🟣', '🟤', '⚫'];

    console.log(`\n📏 Column coordinate scaling (image → PDF):`);
    columns.forEach((col, i) => {
      const color = colors[i % colors.length];
      console.log(`   ${color} Column ${i} "${col.label}":`);
      console.log(`      Image coords: X ${col.xStart.toFixed(2)} to ${col.xEnd.toFixed(2)}`);
      console.log(`      PDF coords:   X ${scaledColumns[i].xStart.toFixed(2)} to ${scaledColumns[i].xEnd.toFixed(2)}`);
    });

    // Filter by requested pages
    let filteredElements =
      pages === 'all'
        ? allElements
        : allElements.filter((el) => pages.includes(el.pageNumber));

    // Filter by region if specified
    if (scaledRegion) {
      const beforeCount = filteredElements.length;

      // Log some sample elements before filtering
      console.log(`\n📊 Sample elements before region filter (first 5):`);
      filteredElements.slice(0, 5).forEach((el, i) => {
        console.log(`   [${i}] "${el.text}" at X:${el.x.toFixed(2)}, Y:${el.y.toFixed(2)}`);
      });

      console.log(`\n📦 Region boundaries (PDF coords):`);
      console.log(`   X: ${scaledRegion.x.toFixed(2)} to ${(scaledRegion.x + scaledRegion.width).toFixed(2)}`);
      console.log(`   Y: ${scaledRegion.y.toFixed(2)} to ${(scaledRegion.y + scaledRegion.height).toFixed(2)}`);

      filteredElements = filteredElements.filter((el) => {
        const inXRange = el.x >= scaledRegion!.x && el.x <= scaledRegion!.x + scaledRegion!.width;
        const inYRange = el.y >= scaledRegion!.y && el.y <= scaledRegion!.y + scaledRegion!.height;
        return inXRange && inYRange;
      });
      console.log(`\n   Filtered by region: ${beforeCount} → ${filteredElements.length} elements`);

      // Log surviving elements
      if (filteredElements.length > 0 && filteredElements.length <= 10) {
        console.log(`\n📝 Elements that survived region filter:`);
        filteredElements.forEach((el, i) => {
          console.log(`   [${i}] "${el.text}" at X:${el.x.toFixed(2)}, Y:${el.y.toFixed(2)}`);
        });
      }
    }

    console.log(`\n   Total elements to process: ${filteredElements.length}`);

    // Group elements by page
    const elementsByPage = this.groupByPage(filteredElements);
    const pageResults: ManualExtractionResult['pageResults'] = [];
    const allTransactions: Transaction[] = [];
    let totalRows = 0;
    let skippedRows = 0;

    // Process each page
    for (const [pageNumber, pageElements] of elementsByPage.entries()) {
      console.log(`\n📄 Processing page ${pageNumber} (${pageElements.length} elements)`);

      let dataRows: TextRow[];

      if (scaledRowDefs && scaledRowDefs.length > 0) {
        // Grid-based extraction: use explicit row boundaries
        console.log(`   Using ${scaledRowDefs.length} explicit row boundaries`);
        dataRows = this.groupByExplicitRows(pageElements, scaledRowDefs);
        totalRows += scaledRowDefs.length;
      } else {
        // Auto-grouping: group by Y-coordinate proximity
        const rows = this.coordinateExtractor.groupIntoRows(pageElements, yTolerance);
        totalRows += rows.length;

        // Skip header rows
        dataRows = rows.slice(skipHeaderRows);
        skippedRows += skipHeaderRows;

        console.log(`   Total rows: ${rows.length}`);
        console.log(`   Data rows (after skipping ${skipHeaderRows} header rows): ${dataRows.length}`);
      }

      // Extract transactions from rows
      const pageTransactions = this.extractTransactionsFromRows(dataRows, scaledColumns);

      allTransactions.push(...pageTransactions);

      pageResults.push({
        page: pageNumber,
        rowCount: dataRows.length,
        transactionCount: pageTransactions.length,
      });

      console.log(`   ✅ Extracted ${pageTransactions.length} transactions from page ${pageNumber}`);
    }

    console.log(`\n✅ Manual extraction complete:`);
    console.log(`   Total transactions: ${allTransactions.length}`);
    console.log(`   Total rows: ${totalRows}`);
    console.log(`   Skipped rows: ${skippedRows}`);

    return {
      transactions: allTransactions,
      pageResults,
      totalRows,
      skippedRows,
    };
  }

  /**
   * Extract transactions from multiple pages with different grid definitions
   * Each page can have its own column/row layout
   */
  async extractFromMultiplePageGrids(
    request: MultiPageGridRequest
  ): Promise<ManualExtractionResult> {
    const { pdfBuffer, pageGrids, yTolerance = 5 } = request;

    console.log('\n========== MULTI-PAGE GRID EXTRACTION ==========');
    console.log(`Processing ${pageGrids.length} page grids`);

    const allTransactions: Transaction[] = [];
    const pageResults: ManualExtractionResult['pageResults'] = [];
    let totalRows = 0;
    let totalSkippedRows = 0;

    // Extract from each page with its specific grid
    for (const pageGrid of pageGrids) {
      console.log(`\n📄 Processing page ${pageGrid.page} with custom grid`);
      console.log(`   Columns: ${pageGrid.columns.length}`);
      console.log(`   Rows: ${pageGrid.rows ? pageGrid.rows.length : 'auto-detect'}`);
      console.log(`   Region: ${pageGrid.region ? 'defined' : 'none'}`);

      try {
        // Extract from this specific page using its grid
        const result = await this.extractFromRegions({
          pdfBuffer,
          columns: pageGrid.columns,
          rows: pageGrid.rows,
          pages: [pageGrid.page],
          skipHeaderRows: pageGrid.skipHeaderRows || 0,
          yTolerance,
          region: pageGrid.region,
        });

        allTransactions.push(...result.transactions);
        totalRows += result.totalRows;
        totalSkippedRows += result.skippedRows;

        // Add page result
        const pageResult = result.pageResults.find(pr => pr.page === pageGrid.page);
        if (pageResult) {
          pageResults.push(pageResult);
        }

        console.log(`   ✅ Page ${pageGrid.page}: Extracted ${result.transactions.length} transactions`);
      } catch (error) {
        console.error(`   ❌ Page ${pageGrid.page}: Extraction failed`, error);
        // Continue with other pages even if one fails
        pageResults.push({
          page: pageGrid.page,
          rowCount: 0,
          transactionCount: 0,
        });
      }
    }

    console.log(`\n✅ Multi-page extraction complete:`);
    console.log(`   Total pages processed: ${pageGrids.length}`);
    console.log(`   Total transactions: ${allTransactions.length}`);
    console.log(`   Total rows: ${totalRows}`);
    console.log(`   Skipped rows: ${totalSkippedRows}`);
    console.log('====================================================================\n');

    return {
      transactions: allTransactions,
      pageResults,
      totalRows,
      skippedRows: totalSkippedRows,
    };
  }

  /**
   * Extract transactions from rows based on column definitions
   */
  private extractTransactionsFromRows(
    rows: TextRow[],
    columns: ColumnDefinition[]
  ): Transaction[] {
    const transactions: Transaction[] = [];

    for (let i = 0; i < rows.length; i++) {
      const transaction = this.extractTransactionFromRow(rows[i], columns, i);
      if (transaction) {
        transactions.push(transaction);
      }
    }

    return transactions;
  }

  /**
   * Extract a single transaction from a row
   */
  private extractTransactionFromRow(
    row: TextRow,
    columns: ColumnDefinition[],
    rowIndex = -1
  ): Transaction | null {
    // Use column-based extraction when user has defined explicit columns
    const cellValues: Record<string, string> = {};
    const debug = rowIndex === 0; // Debug first row only

    if (debug) {
      console.log(`\n    🔍 Extracting first transaction (row Y=${row.y.toFixed(2)}):`);
      console.log(`       Row has ${row.elements.length} text elements:`);
      row.elements.slice(0, 10).forEach((el, i) => {
        console.log(`         [${i}] X=${el.x.toFixed(2)}: "${el.text}"`);
      });
    }

    // Extract cell value for each column
    const colors = ['🔴', '🟠', '🟡', '🟢', '🔵', '🟣', '🟤', '⚫'];

    for (let i = 0; i < columns.length; i++) {
      const column = columns[i];
      if (column.label === 'ignore') continue;

      const color = colors[i % colors.length];
      const cellText = this.extractCellText(row.elements, column, debug, color);
      cellValues[column.label] = cellText;
    }

    // Map to transaction object
    try {
      const transaction = this.mapToTransaction(cellValues);
      return transaction;
    } catch (error) {
      console.warn(`⚠️  Failed to map row to transaction:`, error);
      return null;
    }
  }

  /**
   * Smart parser - extracts labeled fields from row text
   * Handles format: "Date", "", "01 Aug 25", ".", "Description", "", "SUNDA STORES", ...
   */
  private smartParseRow(rowText: string): Transaction | null {
    try {
      // Join all elements into a single string and split by spaces
      const elements = rowText.split(' ').filter(s => s);

      console.log(`\n    🧠 Smart Parser - Processing row with ${elements.length} tokens:`);
      console.log(`       First 20 tokens: ${elements.slice(0, 20).join(' | ')}`);

      // Find indices of field labels
      let date = '';
      let description = '';
      let type = '';
      let moneyIn = '';
      let moneyOut = '';
      let balance = '';

      // Single pass through elements to find all fields
      for (let i = 0; i < elements.length; i++) {
        // Find "Date" and extract the value after it (e.g., "01 Aug 25")
        if (elements[i] === 'Date' && !date) {
          // Collect the next 3 non-empty tokens (e.g., "01", "Aug", "25")
          let dateParts = [];
          for (let j = i + 1; j < elements.length && dateParts.length < 3; j++) {
            const val = elements[j].replace(/[,."]/g, '');
            if (val && val !== 'Description' && !val.includes('(£)')) {
              dateParts.push(val);
            }
          }
          date = dateParts.join(' ');
        }

        // Find "Description" and extract until "Type"
        else if (elements[i] === 'Description' && !description) {
          let desc = [];
          for (let j = i + 1; j < elements.length; j++) {
            if (elements[j] === 'Type' || elements[j].includes('(£)')) break;
            const val = elements[j].replace(/[,."]/g, '');
            if (val && val !== '') desc.push(val);
          }
          description = desc.join(' ').trim();
        }

        // Find "Type" and extract value
        else if (elements[i] === 'Type' && !type) {
          for (let j = i + 1; j < elements.length && j < i + 5; j++) {
            const val = elements[j].replace(/[,."]/g, '');
            if (val && val !== 'Money' && val !== 'In' && val !== 'Out' && !val.includes('(£)')) {
              type = val;
              break;
            }
          }
        }

        // Find "Money In (£)" and extract value
        else if (elements[i] === 'Money' && elements[i + 1] === 'In' && !moneyIn) {
          // Skip "(£)" at i+2, then look for value starting at i+3
          // Look in a LIMITED window after "Money In (£)" to avoid grabbing Balance
          for (let j = i + 3; j < Math.min(i + 10, elements.length); j++) {
            // Stop if we hit "Money" (which might be "Money Out") or "Balance"
            if (elements[j] === 'Money' || elements[j] === 'Balance') break;

            const val = elements[j].replace(/[,."]/g, '');
            if (val && val !== 'blank' && /^\d+\.?\d*$/.test(val)) {
              moneyIn = val;
              break;
            }
          }
        }

        // Find "Money Out (£)" and extract value
        else if (elements[i] === 'Money' && elements[i + 1] === 'Out' && !moneyOut) {
          // Skip "(£)" at i+2, then look for value starting at i+3
          // Look in a LIMITED window after "Money Out (£)" to avoid grabbing Balance
          for (let j = i + 3; j < Math.min(i + 10, elements.length); j++) {
            // Stop if we hit "Balance"
            if (elements[j] === 'Balance') break;

            const val = elements[j].replace(/[,."]/g, '');
            if (val && val !== 'blank' && /^\d+\.?\d*$/.test(val)) {
              moneyOut = val;
              break;
            }
          }
        }

        // Find "Balance (£)" and extract value
        else if (elements[i] === 'Balance' && !balance) {
          // Skip "(£)" at i+1, then look for value starting at i+2
          for (let j = i + 2; j < elements.length && j < i + 8; j++) {
            const val = elements[j].replace(/[,."]/g, '');
            if (val && val !== 'blank' && /^\d+\.?\d*$/.test(val)) {
              balance = val;
              break;
            }
          }
        }
      }

      // Only return if we have at least date or description
      if (!date && !description) {
        console.log(`       ❌ Smart parser failed - no date or description found`);
        return null;
      }

      // Calculate amount
      const amountInVal = this.parseAmount(moneyIn);
      const amountOutVal = this.parseAmount(moneyOut);
      const amount = amountInVal > 0 ? amountInVal : -amountOutVal;

      console.log(`       ✅ Smart parser extracted:`);
      console.log(`          Date: "${date}"`);
      console.log(`          Description: "${description}"`);
      console.log(`          Type: "${type}"`);
      console.log(`          Money In: "${moneyIn}" (${amountInVal})`);
      console.log(`          Money Out: "${moneyOut}" (${amountOutVal})`);
      console.log(`          Balance: "${balance}"`);
      console.log(`          Final Amount: ${amount}`);

      return {
        date,
        description,
        amount,
        balance: balance ? this.parseAmount(balance) : undefined,
        type: type || undefined,
      };
    } catch (error) {
      console.log(`       ❌ Smart parser error: ${error}`);
      return null;
    }
  }

  /**
   * Extract text from a cell (column region)
   */
  private extractCellText(elements: TextElement[], column: ColumnDefinition, debug = false, color = ''): string {
    // Find all text elements within the column's X range
    const cellElements = elements.filter(
      (el) => el.x >= column.xStart && el.x <= column.xEnd
    );

    if (debug && cellElements.length > 0) {
      console.log(`      ${color} Column "${column.label}" [X: ${column.xStart.toFixed(2)}-${column.xEnd.toFixed(2)}]:`);
      cellElements.forEach((el) => {
        console.log(`        X=${el.x.toFixed(2)}: "${el.text}"`);
      });
    }

    // Filter out column headers and labels for amount columns
    const filteredElements = cellElements.filter((el) => {
      const text = el.text.trim();

      // For amount columns, exclude column headers and label text
      if (column.label === 'amountIn' || column.label === 'amountOut' || column.label === 'amount' || column.label === 'balance') {
        // Exclude common header text patterns
        if (text.match(/^(Money\s+(In|Out)|Amount|Balance|Debit|Credit|Paid\s+(In|Out)|Withdrawn)(\s*\([£€$]\))?$/i)) {
          return false;
        }
        // Exclude standalone periods
        if (text === '.') {
          return false;
        }
        // Keep only numeric values or "blank" indicators
        // Handle formats: -£45.94, +£45.94, £45.94, -45.94, 45.94
        return text === 'blank.' || text === '' || /^[+-]?[£$€]?[\d,.\s-]+$/.test(text);
      }

      return true;
    });

    // Combine text with spaces, then clean up
    let cellText = filteredElements
      .map((el) => el.text)
      .join(' ')
      .trim();

    // For amount columns, remove trailing periods
    if (column.label === 'amountIn' || column.label === 'amountOut' || column.label === 'amount' || column.label === 'balance') {
      cellText = cellText.replace(/\.\s*$/, '').trim();
    }

    return cellText;
  }

  /**
   * Map cell values to transaction object
   */
  private mapToTransaction(cellValues: Record<string, string>): Transaction | null {
    const date = cellValues.date || '';
    const description = cellValues.description || '';
    const rawType = cellValues.type || undefined;
    let amount = 0;
    const balanceStr = cellValues.balance || '';
    const balance = balanceStr ? this.parseAmount(balanceStr) : undefined;

    // Handle amount - could be single column or split into in/out
    let amountIn: number | undefined;
    let amountOut: number | undefined;
    let normalizedType: 'credit' | 'debit' | undefined;

    if (cellValues.amount) {
      console.log(`[Transaction Mapping] amount: "${cellValues.amount}" -> parsing...`);
      amount = this.parseAmount(cellValues.amount);
      console.log(`[Transaction Mapping] parsed amount: ${amount}`);
      // If we have a raw type, try to normalize it
      if (rawType) {
        normalizedType = this.normalizeTransactionType(rawType);
      }
    } else if (cellValues.amountIn || cellValues.amountOut) {
      amountIn = this.parseAmount(cellValues.amountIn || '0');
      amountOut = this.parseAmount(cellValues.amountOut || '0');

      console.log(`[Transaction Mapping] amountIn: "${cellValues.amountIn}" -> ${amountIn}, amountOut: "${cellValues.amountOut}" -> ${amountOut}`);

      // Determine type based on which column has a value
      if (amountIn > 0 && amountOut === 0) {
        amount = amountIn;
        normalizedType = 'credit';
        console.log(`[Transaction Type] Money IN detected -> credit, amount: ${amount}`);
      } else if (amountOut > 0 && amountIn === 0) {
        amount = amountOut;
        normalizedType = 'debit';
        console.log(`[Transaction Type] Money OUT detected -> debit, amount: ${amount}`);
      } else if (amountIn > 0) {
        // Both have values - prefer amountIn
        amount = amountIn;
        normalizedType = 'credit';
        console.log(`[Transaction Type] Both have values, using amountIn -> credit, amount: ${amount}`);
      }
    }

    console.log(`[Final Transaction] date: "${date}", type: "${normalizedType || rawType}", amount: ${amount}`);

    // Skip rows with no date or description
    if (!date && !description) {
      return null;
    }

    return {
      date,
      description,
      amount,
      balance,
      type: normalizedType || rawType,
      amountIn: amountIn !== undefined ? amountIn : undefined,
      amountOut: amountOut !== undefined ? amountOut : undefined,
    };
  }

  /**
   * Normalize bank-specific transaction types to 'credit' or 'debit'
   * Common codes: TFR = Transfer, DEB = Debit, FPO = Faster Payment Out, etc.
   */
  private normalizeTransactionType(rawType: string): 'credit' | 'debit' | undefined {
    const upperType = rawType.toUpperCase().trim();

    // Credit indicators (money in)
    const creditPatterns = ['CR', 'CREDIT', 'IN', 'FPI', 'BGC', 'CHQ', 'DEP', 'DEPOSIT'];
    if (creditPatterns.some(pattern => upperType.includes(pattern))) {
      return 'credit';
    }

    // Debit indicators (money out)
    const debitPatterns = ['DR', 'DEB', 'DEBIT', 'OUT', 'FPO', 'DD', 'SO', 'ATM', 'POS', 'WITHDRAWAL'];
    if (debitPatterns.some(pattern => upperType.includes(pattern))) {
      return 'debit';
    }

    // Transfer could be either - return undefined and let amount columns determine
    return undefined;
  }

  /**
   * Parse amount string to number
   * Handles various formats:
   * - English: 1,234.56 (comma as thousand separator, period as decimal)
   * - Spanish: 1.234,56 (period as thousand separator, comma as decimal)
   * - Simple: 123.45 or 123,45
   * - Parentheses for negative: (123.45)
   * - With currency symbols: £123.45, $123.45, €78,90
   */
  private parseAmount(amountStr: string): number {
    if (!amountStr) return 0;

    // Remove currency symbols and whitespace
    let cleaned = amountStr.replace(/[£$€\s]/g, '');

    // Check for parentheses (negative amount)
    const isNegative = cleaned.includes('(') || cleaned.includes(')');
    cleaned = cleaned.replace(/[()]/g, '');

    // Detect format based on the position of comma and period
    // Spanish format: comma followed by exactly 2 digits at the end (78,90)
    // English format: period followed by exactly 2 digits at the end (78.90)

    const hasCommaDecimal = /,\d{2}$/.test(cleaned); // ends with ,XX
    const hasPeriodDecimal = /\.\d{2}$/.test(cleaned); // ends with .XX

    if (hasCommaDecimal) {
      // Spanish format: 1.234,56 or 78,90
      // Replace period (thousand separator) with nothing, then replace comma with period
      cleaned = cleaned.replace(/\./g, '').replace(',', '.');
    } else if (hasPeriodDecimal) {
      // English format: 1,234.56 or 78.90
      // Remove commas (thousand separators)
      cleaned = cleaned.replace(/,/g, '');
    } else {
      // Ambiguous or no decimals - assume commas are thousand separators
      // Examples: 1,234 or 1234
      cleaned = cleaned.replace(/,/g, '');
    }

    // Parse as number
    const value = parseFloat(cleaned) || 0;

    return isNegative ? -Math.abs(value) : value;
  }

  /**
   * Group text elements by page number
   */
  private groupByPage(elements: TextElement[]): Map<number, TextElement[]> {
    const pageMap = new Map<number, TextElement[]>();

    for (const element of elements) {
      const pageElements = pageMap.get(element.pageNumber) || [];
      pageElements.push(element);
      pageMap.set(element.pageNumber, pageElements);
    }

    return pageMap;
  }

  /**
   * Group text elements into rows using explicit row boundaries
   */
  private groupByExplicitRows(
    elements: TextElement[],
    rowDefs: RowDefinition[]
  ): TextRow[] {
    const rows: TextRow[] = [];

    console.log(`\n🔍 Grouping ${elements.length} elements into ${rowDefs.length} rows`);

    // Log element Y-coordinate range
    if (elements.length > 0) {
      const yCoords = elements.map(el => el.y).sort((a, b) => a - b);
      console.log(`   Element Y range: ${yCoords[0].toFixed(2)} to ${yCoords[yCoords.length - 1].toFixed(2)}`);

      // Show sample elements at different Y positions to help diagnose coordinate issues
      const sampleCount = Math.min(5, elements.length);
      console.log(`   Sample elements (first ${sampleCount}):`);
      elements.slice(0, sampleCount).forEach((el, i) => {
        console.log(`     [${i}] Y=${el.y.toFixed(2)}, X=${el.x.toFixed(2)}, text="${el.text.substring(0, 20)}"`);
      });
    }

    // Log row definition ranges
    console.log(`   Row definitions:`);
    rowDefs.forEach((def, i) => {
      console.log(`     Row ${i}: Y ${def.yStart.toFixed(2)} to ${def.yEnd.toFixed(2)}`);
    });

    for (const rowDef of rowDefs) {
      // Find all elements within this row's Y range
      // Using <= for yEnd to include elements on the boundary
      const rowElements = elements.filter((el) => {
        return el.y >= rowDef.yStart && el.y <= rowDef.yEnd;
      });

      console.log(`   Row ${rowDef.yStart.toFixed(2)}-${rowDef.yEnd.toFixed(2)}: found ${rowElements.length} elements`);

      // Log what's in this row if it has elements
      if (rowElements.length > 0) {
        const texts = rowElements.map(el => `"${el.text}"`).join(', ');
        console.log(`      → ${texts}`);
      } else {
        console.log(`      → (empty row)`);
      }

      // Sort elements by X position (left to right)
      rowElements.sort((a, b) => a.x - b.x);

      // Create TextRow object
      if (rowElements.length > 0) {
        rows.push({
          y: rowDef.yStart,
          elements: rowElements,
        });
      }
    }

    console.log(`   ✅ Created ${rows.length} non-empty rows out of ${rowDefs.length} row definitions`);

    // Warn if we have elements that didn't match any row
    const matchedElements = rows.reduce((sum, row) => sum + row.elements.length, 0);
    if (matchedElements < elements.length) {
      console.log(`   ⚠️  Warning: ${elements.length - matchedElements} elements didn't match any row`);
    }
    console.log();

    return rows;
  }

  /**
   * Get PDF page dimensions for coordinate normalization
   */
  async getPageDimensions(pdfBuffer: Buffer): Promise<{ width: number; height: number }[]> {
    // Use pdfjs to get page dimensions
    const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const data = new Uint8Array(pdfBuffer);
    const loadingTask = pdfjsLib.getDocument({ data });
    const pdfDocument = await loadingTask.promise;

    const dimensions: { width: number; height: number }[] = [];

    for (let pageNum = 1; pageNum <= pdfDocument.numPages; pageNum++) {
      const page = await pdfDocument.getPage(pageNum);
      const viewport = page.getViewport({ scale: 1.0 });
      dimensions.push({
        width: viewport.width,
        height: viewport.height,
      });
    }

    return dimensions;
  }

  /**
   * Get text element positions for a specific page
   * Used by Smart Adjust to find gaps between words/lines
   */
  async getTextPositions(
    pdfBuffer: Buffer,
    pageNumber: number
  ): Promise<Array<{ x: number; y: number; width: number; height: number; text: string }>> {
    // Extract all text elements with coordinates
    const allElements = await this.coordinateExtractor.extractTextWithCoordinates(pdfBuffer);

    // Filter to requested page
    const pageElements = allElements.filter((el) => el.pageNumber === pageNumber);

    // Scale from PDF points (72 DPI) to image coordinates (150 DPI)
    // This is the inverse of the scaling we do for extraction
    const pointsToImageScale = 150 / 72; // = 2.083...

    console.log(`📍 Returning ${pageElements.length} text elements for page ${pageNumber}`);
    console.log(`   Scale factor (PDF → Image): ${pointsToImageScale.toFixed(4)}`);

    // Return elements in image coordinate space for frontend use
    return pageElements.map((el) => ({
      x: el.x * pointsToImageScale,
      y: el.y * pointsToImageScale,
      width: el.width * pointsToImageScale,
      height: el.height * pointsToImageScale,
      text: el.text,
    }));
  }
}
