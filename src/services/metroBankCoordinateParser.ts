import { PDFCoordinateExtractor, TextElement, TextRow } from './pdfCoordinateExtractor.js';
import { Transaction } from '../types/index.js';

/**
 * Column boundaries detected from headers
 */
interface ColumnBoundaries {
  date: { min: number; max: number };
  transaction: { min: number; max: number };
  moneyOut: { min: number; max: number };
  moneyIn: { min: number; max: number };
  balance: { min: number; max: number };
}

/**
 * Parsed row data with elements assigned to columns
 */
interface ParsedRow {
  date?: string;
  description?: string;
  moneyOut?: number;
  moneyIn?: number;
  balance?: number;
  y: number;
}

/**
 * Metro Bank specific PDF parser using coordinate-based extraction
 * Handles chaotic text ordering by using X,Y coordinates to reconstruct table
 */
export class MetroBankCoordinateParser {
  private extractor: PDFCoordinateExtractor;

  constructor() {
    this.extractor = new PDFCoordinateExtractor();
  }

  /**
   * Parse Metro Bank statement PDF using coordinate-based extraction
   * Uses hybrid anchor-based approach: dates+descriptions from text stream (chronological),
   * amounts/balances from coordinates by Y-proximity
   * @param buffer PDF file buffer
   * @param parsedText Parsed text from pdf-parse (dates and descriptions are chronological here)
   * @param debug Enable debug logging (default: false)
   * @returns Array of transactions
   */
  async parseMetroBankStatement(buffer: Buffer, parsedText: string, debug: boolean = false): Promise<Transaction[]> {
    console.log('\n========== METRO BANK COORDINATE PARSER (HYBRID) ==========');
    console.log('Strategy: Dates/Descriptions from text stream, Amounts/Balances from coordinates\n');

    // Step 1: Extract dates and descriptions from parsed text (already in chronological order!)
    const { dates: textDates, descriptions: textDescriptions } = this.extractDatesAndDescriptionsFromText(parsedText);

    console.log(`[Text Stream Extraction]`);
    console.log(`  Dates: ${textDates.length}`);
    console.log(`  Descriptions: ${textDescriptions.length}\n`);

    // Step 2: Extract all text with coordinates for amounts/balances
    const elements = await this.extractor.extractTextWithCoordinates(buffer);

    if (debug) {
      this.extractor.debugPrintElements(elements, 100);
    }

    // Step 3: Detect column boundaries by finding headers
    const columnBoundaries = this.detectColumnBoundaries(elements);

    if (!columnBoundaries) {
      console.error('⚠️  Failed to detect Metro Bank column headers');
      throw new Error('Could not detect Metro Bank table structure');
    }

    console.log('[Column Boundaries Detected]');
    console.log(`  MONEY OUT: X ${columnBoundaries.moneyOut.min.toFixed(1)} - ${columnBoundaries.moneyOut.max.toFixed(1)}`);
    console.log(`  MONEY IN: X ${columnBoundaries.moneyIn.min.toFixed(1)} - ${columnBoundaries.moneyIn.max.toFixed(1)}`);
    console.log(`  BALANCE: X ${columnBoundaries.balance.min.toFixed(1)} - ${columnBoundaries.balance.max.toFixed(1)}\n`);

    // Step 4: Get date coordinates for Y-proximity matching
    const dateCoordinates = this.extractColumnInOrder(elements, columnBoundaries.date, /^\d{1,2}\s+(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\s+\d{4}$/i);

    // Step 5: Extract amount/balance elements (in chaotic order)
    const moneyOutElements = this.extractColumnInOrder(elements, columnBoundaries.moneyOut, /^(\d+(?:,\d{3})*\.\d{2})$/);
    const moneyInElements = this.extractColumnInOrder(elements, columnBoundaries.moneyIn, /^(\d+(?:,\d{3})*\.\d{2})$/);
    const balanceElements = this.extractColumnInOrder(elements, columnBoundaries.balance, /^(\d+(?:,\d{3})*\.\d{2})$/);

    console.log(`[Amount/Balance Elements Extracted]`);
    console.log(`  Money Out: ${moneyOutElements.length}`);
    console.log(`  Money In: ${moneyInElements.length}`);
    console.log(`  Balances: ${balanceElements.length}\n`);

    // Step 6: Build transactions using hybrid matching
    // Use text stream dates/descriptions, match amounts/balances by Y-coordinate
    const transactions = this.buildTransactionsHybrid(
      textDates,
      textDescriptions,
      dateCoordinates,
      moneyOutElements,
      moneyInElements,
      balanceElements
    );

    console.log(`\n✓ Extracted ${transactions.length} Metro Bank transactions using hybrid parsing`);
    console.log('====================================================================\n');

    return transactions;
  }

  /**
   * Extract dates and descriptions from the parsed text stream
   * Metro Bank text stream: ALL dates first (under DATE column), then ALL descriptions (under TRANSACTION column)
   * @param text Parsed text from pdf-parse
   * @returns Object with dates and descriptions arrays
   */
  private extractDatesAndDescriptionsFromText(text: string): { dates: string[]; descriptions: string[] } {
    const lines = text.split('\n');
    const dates: string[] = [];
    const descriptions: string[] = [];
    const datePattern = /^\d{1,2}\s+(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\s+\d{4}$/i;

    let mode: 'date' | 'transaction' | 'none' = 'none';
    let currentDescription = '';

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      // Smart stop condition: Only stop if we've reached the FINAL summary section
      if (line === 'Account Summary' ||
          line.includes('Opening Balance') ||
          line.includes('Closing Balance') ||
          line.includes('Total Money In') ||
          line.includes('Total Money Out')) {

        // Look ahead to see if this is really the end or just a mid-document section
        // Need to check at least 50 lines ahead to catch next page headers
        let hasMoreTransactions = false;

        for (let j = i + 1; j < Math.min(i + 50, lines.length); j++) {
          const nextLine = lines[j].trim();

          // If we see DATE or TRANSACTION headers again, this is NOT the final summary
          if (nextLine === 'DATE' || nextLine === 'TRANSACTION') {
            hasMoreTransactions = true;
            break;
          }
        }

        if (hasMoreTransactions) {
          // Mid-document summary, skip all summary lines and continue
          continue;
        } else {
          // No more DATE/TRANSACTION headers found - this is the final summary
          if (currentDescription && mode === 'transaction') {
            descriptions.push(currentDescription.trim());
            currentDescription = '';
          }
          break;
        }
      }

      // Detect column headers (can appear on every page)
      if (line === 'DATE') {
        // Save any pending description before switching modes
        if (currentDescription && mode === 'transaction') {
          descriptions.push(currentDescription.trim());
          currentDescription = '';
        }
        mode = 'date';
        continue;
      }

      if (line === 'TRANSACTION') {
        mode = 'transaction';
        continue;
      }

      // Skip amount/balance columns (but don't break - next page might have more data)
      if (line === 'MONEY OUT' || line === 'MONEY IN' || line === 'BALANCE') {
        // Save any pending description before switching to none
        if (currentDescription && mode === 'transaction') {
          descriptions.push(currentDescription.trim());
          currentDescription = '';
        }
        mode = 'none';
        continue;
      }

      // Extract based on current mode
      if (mode === 'date') {
        // In DATE column - extract all dates
        if (datePattern.test(line)) {
          dates.push(line);
        }
      } else if (mode === 'transaction') {
        // In TRANSACTION column - extract descriptions

        // Skip "Balance brought forward"
        if (line.toLowerCase().includes('balance brought forward')) {
          continue;
        }

        // Skip empty lines
        if (!line) continue;

        // Detect start of new transaction (starts with known patterns)
        const isTransactionStart = /^(Card Purchase|Account to Account Transfer|Inward Payment|Outward Faster Payment|ATM Cash Withdrawal|Direct Debit|Interest Paid)/i.test(line);

        if (isTransactionStart) {
          // Save previous description
          if (currentDescription) {
            descriptions.push(currentDescription.trim());
          }
          // Start new description
          currentDescription = line;
        } else if (currentDescription) {
          // Continuation of current description (multi-line)
          currentDescription += ' ' + line;
        } else {
          // First line but doesn't match pattern - might be description without prefix
          currentDescription = line;
        }
      }
    }

    // Save last description
    if (currentDescription) {
      descriptions.push(currentDescription.trim());
    }

    console.log(`[Text Stream Debug] Extracted ${dates.length} dates and ${descriptions.length} descriptions`);
    if (dates.length > 0) {
      console.log(`  First date: ${dates[0]}`);
      console.log(`  Last date: ${dates[dates.length - 1]}`);
    }
    if (descriptions.length > 0) {
      console.log(`  First desc: ${descriptions[0].substring(0, 60)}...`);
      console.log(`  Last desc: ${descriptions[descriptions.length - 1].substring(0, 60)}...`);
    }

    return { dates, descriptions };
  }

  /**
   * Build transactions using hybrid approach
   * Dates and descriptions from text stream, amounts/balances from coordinates
   * @param textDates Dates from text stream (chronological)
   * @param textDescriptions Descriptions from text stream (chronological)
   * @param dateCoordinates Date coordinates for Y-proximity matching
   * @param moneyOutElements Money out elements from coordinates
   * @param moneyInElements Money in elements from coordinates
   * @param balanceElements Balance elements from coordinates
   * @returns Array of transactions
   */
  private buildTransactionsHybrid(
    textDates: string[],
    textDescriptions: string[],
    dateCoordinates: TextElement[],
    moneyOutElements: TextElement[],
    moneyInElements: TextElement[],
    balanceElements: TextElement[]
  ): Transaction[] {
    const transactions: Transaction[] = [];
    const usedMoneyOut = new Set<number>();
    const usedMoneyIn = new Set<number>();
    const usedBalances = new Set<number>();

    console.log(`[Building Hybrid Transactions]`);
    console.log(`  Processing ${textDates.length} dates with ${textDescriptions.length} descriptions...\n`);

    const minLength = Math.min(textDates.length, textDescriptions.length, dateCoordinates.length);

    for (let i = 0; i < minLength; i++) {
      const date = textDates[i];
      const description = textDescriptions[i];
      const dateCoord = dateCoordinates[i];

      // Use date's Y-coordinate AND page number to find matching amounts/balances
      const anchorY = dateCoord.y;
      const anchorPage = dateCoord.pageNumber;

      console.log(`\n[Transaction ${i + 1}]`);
      console.log(`  Date: ${date}`);
      console.log(`  Desc: ${description.substring(0, 50)}...`);
      console.log(`  Anchor: Page ${anchorPage}, Y: ${anchorY.toFixed(1)}`);

      // Find closest money out/in and balance within ±10px ON THE SAME PAGE
      const moneyOutResult = this.findValueByYProximity(moneyOutElements, anchorY, anchorPage, 10, usedMoneyOut);
      const moneyInResult = this.findValueByYProximity(moneyInElements, anchorY, anchorPage, 10, usedMoneyIn);
      const balanceResult = this.findValueByYProximity(balanceElements, anchorY, anchorPage, 10, usedBalances);

      console.log(`  Money Out: ${moneyOutResult ? `£${moneyOutResult.value} (Y:${moneyOutElements[moneyOutResult.index].y.toFixed(1)}, diff:${Math.abs(moneyOutElements[moneyOutResult.index].y - anchorY).toFixed(1)}px)` : 'none'}`);
      console.log(`  Money In: ${moneyInResult ? `£${moneyInResult.value} (Y:${moneyInElements[moneyInResult.index].y.toFixed(1)}, diff:${Math.abs(moneyInElements[moneyInResult.index].y - anchorY).toFixed(1)}px)` : 'none'}`);
      console.log(`  Balance: ${balanceResult ? `£${balanceResult.value} (Y:${balanceElements[balanceResult.index].y.toFixed(1)}, diff:${Math.abs(balanceElements[balanceResult.index].y - anchorY).toFixed(1)}px)` : 'none'}`);

      // Mark as used
      if (moneyOutResult) usedMoneyOut.add(moneyOutResult.index);
      if (moneyInResult) usedMoneyIn.add(moneyInResult.index);
      if (balanceResult) usedBalances.add(balanceResult.index);

      // Determine amount and type - use the CLOSEST match (smallest Y-distance)
      let amount = 0;
      let type: 'debit' | 'credit' = 'debit';

      if (moneyOutResult && moneyInResult) {
        // Both found - use the closest one
        const outDiff = Math.abs(moneyOutElements[moneyOutResult.index].y - anchorY);
        const inDiff = Math.abs(moneyInElements[moneyInResult.index].y - anchorY);

        if (outDiff <= inDiff) {
          amount = moneyOutResult.value;
          type = 'debit';
          console.log(`  → Choosing Money Out (closer: ${outDiff.toFixed(1)}px vs ${inDiff.toFixed(1)}px)`);
        } else {
          amount = moneyInResult.value;
          type = 'credit';
          console.log(`  → Choosing Money In (closer: ${inDiff.toFixed(1)}px vs ${outDiff.toFixed(1)}px)`);
        }
      } else if (moneyOutResult) {
        amount = moneyOutResult.value;
        type = 'debit';
      } else if (moneyInResult) {
        amount = moneyInResult.value;
        type = 'credit';
      }

      console.log(`  → Final: £${amount} (${type})`);

      transactions.push({
        date,
        description: description.trim(),
        amount,
        balance: balanceResult?.value,
        type,
      });
    }

    // Calculate amounts from balance changes for transactions without explicit amounts
    return this.calculateAmountsFromBalances(this.sortTransactionsByDate(transactions));
  }

  /**
   * Detect column boundaries by finding header elements
   * @param elements All text elements from PDF
   * @returns Column boundaries or null if not found
   */
  private detectColumnBoundaries(elements: TextElement[]): ColumnBoundaries | null {
    // Find header elements
    const dateHeader = elements.find(el => el.text === 'DATE');
    const transactionHeader = elements.find(el => el.text === 'TRANSACTION');
    const moneyOutHeader = elements.find(el => el.text === 'MONEY OUT');
    const moneyInHeader = elements.find(el => el.text === 'MONEY IN');
    const balanceHeader = elements.find(el => el.text === 'BALANCE');

    if (!dateHeader || !transactionHeader || !moneyOutHeader || !moneyInHeader || !balanceHeader) {
      console.error('⚠️  Could not find all required column headers');
      console.log('Found headers:', {
        date: !!dateHeader,
        transaction: !!transactionHeader,
        moneyOut: !!moneyOutHeader,
        moneyIn: !!moneyInHeader,
        balance: !!balanceHeader,
      });
      return null;
    }

    // Define column boundaries with some margin
    // Each column starts at header X and extends until next header X
    const columnMargin = 10; // pixels of overlap tolerance

    return {
      date: {
        min: dateHeader.x - columnMargin,
        max: transactionHeader.x - columnMargin,
      },
      transaction: {
        min: transactionHeader.x - columnMargin,
        max: moneyOutHeader.x - columnMargin,
      },
      moneyOut: {
        min: moneyOutHeader.x - columnMargin,
        max: moneyInHeader.x - columnMargin,
      },
      moneyIn: {
        min: moneyInHeader.x - columnMargin,
        max: balanceHeader.x - columnMargin,
      },
      balance: {
        min: balanceHeader.x - columnMargin,
        max: balanceHeader.x + 200, // Assume balance column extends 200px to the right
      },
    };
  }

  /**
   * Extract all elements from a specific column in chronological order
   * Elements are sorted by page number, then Y-coordinate to preserve order
   * @param elements All text elements
   * @param columnBounds Column X boundaries
   * @param pattern Optional regex pattern to filter elements (null = no filter)
   * @returns Elements from the column in chronological order
   */
  private extractColumnInOrder(
    elements: TextElement[],
    columnBounds: { min: number; max: number },
    pattern: RegExp | null
  ): TextElement[] {
    // Build a map of header Y coordinates per page
    const headerYPerPage = new Map<number, number>();
    elements.forEach(el => {
      if (el.text === 'DATE' && !headerYPerPage.has(el.pageNumber)) {
        headerYPerPage.set(el.pageNumber, el.y);
      }
    });

    return elements
      .filter(el => {
        // Must be in column X range
        if (el.x < columnBounds.min || el.x >= columnBounds.max) return false;

        // Must be after header on THIS page
        const headerY = headerYPerPage.get(el.pageNumber);
        if (headerY !== undefined && el.y <= headerY) return false;

        // Skip headers
        if (['DATE', 'TRANSACTION', 'MONEY OUT', 'MONEY IN', 'BALANCE'].includes(el.text)) return false;

        // Skip summary/footer text
        if (el.text.includes('Opening Balance') ||
            el.text.includes('Closing Balance') ||
            el.text.includes('Total Money In') ||
            el.text.includes('Total Money Out') ||
            el.text.includes('Account Summary') ||
            el.text.includes('metrobank') ||
            el.text.includes('MBS2C_') ||
            el.text.includes('Southampton Row') ||
            el.text.includes('Cash Account Statement') ||
            el.text.toLowerCase().includes('balance brought forward')) {
          return false;
        }

        // Apply pattern filter if provided
        if (pattern && !pattern.test(el.text)) return false;

        return true;
      })
      .sort((a, b) => {
        // Sort by page first, then Y-coordinate
        if (a.pageNumber !== b.pageNumber) {
          return a.pageNumber - b.pageNumber;
        }
        return a.y - b.y;
      });
  }

  /**
   * Group description lines sequentially to match date count
   * Uses Y-distance to detect line breaks within same transaction
   * @param elements Description text elements in extraction order (chronological)
   * @param expectedCount Number of dates (expected number of transaction groups)
   * @returns Grouped descriptions matching date count
   */
  private groupDescriptionsBySequence(elements: TextElement[], expectedCount: number): TextElement[] {
    if (elements.length === 0) return [];

    const grouped: TextElement[] = [];
    let current = { ...elements[0] };
    const lineBreakThreshold = 15; // Y-distance indicating new transaction

    for (let i = 1; i < elements.length; i++) {
      const el = elements[i];
      const yDiff = Math.abs(el.y - current.y);

      // Determine if this is a continuation of current description or new transaction
      // Small Y-distance (< 15px) = continuation line (multi-line description)
      // Large Y-distance OR different page = new transaction
      const isContinuation =
        yDiff < lineBreakThreshold &&
        el.pageNumber === current.pageNumber &&
        grouped.length < expectedCount; // Don't merge if we already have enough groups

      if (isContinuation) {
        // Continue current description
        current.text += ' ' + el.text;
        // Keep the Y of the first line for value matching later
      } else {
        // Start new description group
        grouped.push(current);
        current = { ...el };
      }
    }

    // Push last element
    grouped.push(current);

    console.log(`[Description Grouping] Grouped ${elements.length} description lines into ${grouped.length} transactions (expected ${expectedCount})`);

    return grouped;
  }

  /**
   * Find the closest value element by Y-coordinate proximity on the same page
   * @param elements Value elements to search
   * @param targetY Target Y-coordinate
   * @param targetPage Target page number
   * @param tolerance Maximum Y distance (pixels)
   * @param usedIndices Set of already-used element indices
   * @returns Object with value and index, or undefined
   */
  private findValueByYProximity(
    elements: TextElement[],
    targetY: number,
    targetPage: number,
    tolerance: number,
    usedIndices: Set<number>
  ): { value: number; index: number } | undefined {
    let closestIndex: number | undefined;
    let minDiff = Infinity;

    for (let i = 0; i < elements.length; i++) {
      // Skip already used elements
      if (usedIndices.has(i)) continue;

      const el = elements[i];

      // CRITICAL: Only match elements from the SAME page
      if (el.pageNumber !== targetPage) continue;

      const diff = Math.abs(el.y - targetY);
      if (diff <= tolerance && diff < minDiff) {
        minDiff = diff;
        closestIndex = i;
      }
    }

    if (closestIndex !== undefined) {
      const el = elements[closestIndex];
      const match = el.text.match(/^(\d+(?:,\d{3})*\.\d{2})$/);
      if (match) {
        return {
          value: parseFloat(match[1].replace(/,/g, '')),
          index: closestIndex
        };
      }
    }

    return undefined;
  }

  /**
   * Build transactions using anchor-based matching
   * Pairs dates with descriptions chronologically, then finds amounts/balances by Y-proximity
   * @param dateAnchors Date elements in chronological order
   * @param descriptionAnchors Description elements (merged) in chronological order
   * @param moneyOutElements Money out value elements
   * @param moneyInElements Money in value elements
   * @param balanceElements Balance value elements
   * @returns Array of transactions
   */
  private buildTransactionsWithAnchors(
    dateAnchors: TextElement[],
    descriptionAnchors: TextElement[],
    moneyOutElements: TextElement[],
    moneyInElements: TextElement[],
    balanceElements: TextElement[]
  ): Transaction[] {
    const transactions: Transaction[] = [];

    // Track which elements have been used to prevent re-matching
    const usedMoneyOut = new Set<number>();
    const usedMoneyIn = new Set<number>();
    const usedBalances = new Set<number>();

    console.log(`[Building Transactions with Anchors]`);
    console.log(`  Processing ${dateAnchors.length} dates with ${descriptionAnchors.length} descriptions...\n`);

    // Match dates with descriptions
    const minLength = Math.min(dateAnchors.length, descriptionAnchors.length);

    for (let i = 0; i < minLength; i++) {
      const dateAnchor = dateAnchors[i];
      const descAnchor = descriptionAnchors[i];

      // Use date's Y-coordinate and page number as primary anchor
      const anchorY = dateAnchor.y;
      const anchorPage = dateAnchor.pageNumber;

      // Find closest money out/in and balance within ±10px ON SAME PAGE, avoiding already-used values
      const moneyOutResult = this.findValueByYProximity(moneyOutElements, anchorY, anchorPage, 10, usedMoneyOut);
      const moneyInResult = this.findValueByYProximity(moneyInElements, anchorY, anchorPage, 10, usedMoneyIn);
      const balanceResult = this.findValueByYProximity(balanceElements, anchorY, anchorPage, 10, usedBalances);

      // Mark as used
      if (moneyOutResult) usedMoneyOut.add(moneyOutResult.index);
      if (moneyInResult) usedMoneyIn.add(moneyInResult.index);
      if (balanceResult) usedBalances.add(balanceResult.index);

      // Determine amount and type
      let amount = 0;
      let type: 'debit' | 'credit' = 'debit';

      if (moneyOutResult) {
        amount = moneyOutResult.value;
        type = 'debit';
      } else if (moneyInResult) {
        amount = moneyInResult.value;
        type = 'credit';
      }

      transactions.push({
        date: dateAnchor.text,
        description: descAnchor.text.trim(),
        amount,
        balance: balanceResult?.value,
        type,
      });
    }

    // Handle any extra dates without descriptions (shouldn't happen but be safe)
    if (dateAnchors.length > descriptionAnchors.length) {
      console.log(`  ⚠️  Warning: ${dateAnchors.length - descriptionAnchors.length} dates without descriptions`);
    }

    // Calculate amounts from balance changes for transactions without explicit amounts
    return this.calculateAmountsFromBalances(this.sortTransactionsByDate(transactions));
  }

  /**
   * Assign elements to their respective columns based on X coordinate
   * @param rows Rows of text elements
   * @param boundaries Column boundaries
   * @returns Parsed rows with data assigned to columns
   */
  private assignElementsToColumns(rows: TextRow[], boundaries: ColumnBoundaries): ParsedRow[] {
    const parsedRows: ParsedRow[] = [];
    const datePattern = /^\d{1,2}\s+(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\s+\d{4}$/i;
    const amountPattern = /^(\d+(?:,\d{3})*\.\d{2})$/;

    // Find first row with DATE header to know where data starts
    let dataStarted = false;
    const headerY = rows.find(r => r.elements.some(el => el.text === 'DATE'))?.y;

    // Process only rows after the header
    for (const row of rows) {
      // Skip rows before the header
      if (headerY && row.y < headerY) continue;

      // Check if this is the header row itself
      const isHeaderRow = row.elements.some(el =>
        ['DATE', 'TRANSACTION', 'MONEY OUT', 'MONEY IN', 'BALANCE'].includes(el.text)
      );

      if (isHeaderRow) {
        dataStarted = true;
        continue; // Skip header row
      }

      // Only process rows after header
      if (!dataStarted) continue;

      const parsedRow: ParsedRow = { y: row.y };

      // Track if this row has any transaction data
      let hasData = false;

      for (const element of row.elements) {
        const x = element.x;
        const text = element.text;

        // Skip summary/footer text
        if (text.includes('Opening Balance') ||
            text.includes('Closing Balance') ||
            text.includes('Total Money In') ||
            text.includes('Total Money Out') ||
            text.includes('Account Summary') ||
            text.includes('metrobank') ||
            text.includes('MBS2C_') ||
            text.includes('Southampton Row') ||
            text.includes('Cash Account Statement')) {
          continue;
        }

        // Determine which column this element belongs to
        if (x >= boundaries.date.min && x < boundaries.date.max) {
          // Date column
          if (datePattern.test(text)) {
            parsedRow.date = text;
            hasData = true;
          }
        } else if (x >= boundaries.transaction.min && x < boundaries.transaction.max) {
          // Transaction description column
          if (text && !['DATE', 'TRANSACTION', 'MONEY OUT', 'MONEY IN', 'BALANCE'].includes(text)) {
            // Skip "Balance brought forward"
            if (text.toLowerCase().includes('balance brought forward')) {
              continue;
            }
            // Append to description (multi-line descriptions)
            parsedRow.description = parsedRow.description ? `${parsedRow.description} ${text}` : text;
            hasData = true;
          }
        } else if (x >= boundaries.moneyOut.min && x < boundaries.moneyOut.max) {
          // Money Out column
          const amountMatch = text.match(amountPattern);
          if (amountMatch) {
            parsedRow.moneyOut = parseFloat(amountMatch[1].replace(/,/g, ''));
            hasData = true;
          }
        } else if (x >= boundaries.moneyIn.min && x < boundaries.moneyIn.max) {
          // Money In column
          const amountMatch = text.match(amountPattern);
          if (amountMatch) {
            parsedRow.moneyIn = parseFloat(amountMatch[1].replace(/,/g, ''));
            hasData = true;
          }
        } else if (x >= boundaries.balance.min && x < boundaries.balance.max) {
          // Balance column
          const amountMatch = text.match(amountPattern);
          if (amountMatch) {
            parsedRow.balance = parseFloat(amountMatch[1].replace(/,/g, ''));
            hasData = true;
          }
        }
      }

      // Only add rows that have actual transaction data (must have date or description)
      if (hasData && (parsedRow.date || parsedRow.description)) {
        parsedRows.push(parsedRow);
      }
    }

    return parsedRows;
  }

  /**
   * Build transactions from parsed rows
   * Handles multi-line descriptions and balance-based amount calculation
   * @param parsedRows Parsed row data
   * @returns Array of transactions
   */
  private buildTransactions(parsedRows: ParsedRow[]): Transaction[] {
    const transactions: Transaction[] = [];
    let pendingTransaction: Partial<Transaction> | null = null;
    let skippedCount = 0;

    console.log(`\n[Building Transactions] Processing ${parsedRows.length} parsed rows...`);

    for (let i = 0; i < parsedRows.length; i++) {
      const row = parsedRows[i];

      // Case 1: Row has a date - starts a new transaction
      if (row.date) {
        // Save previous pending transaction if exists
        if (pendingTransaction && pendingTransaction.date) {
          if (!pendingTransaction.description || pendingTransaction.description.trim() === '') {
            console.log(`  ⚠️  Skipping transaction with date "${pendingTransaction.date}" - no description found`);
            skippedCount++;
          } else {
            transactions.push(this.finalizeTransaction(pendingTransaction));
          }
        }

        // Start new transaction
        pendingTransaction = {
          date: row.date,
          description: row.description || '',
          balance: row.balance,
        };

        // Set amount from moneyOut or moneyIn
        if (row.moneyOut !== undefined) {
          pendingTransaction.amount = row.moneyOut;
          pendingTransaction.type = 'debit';
        } else if (row.moneyIn !== undefined) {
          pendingTransaction.amount = row.moneyIn;
          pendingTransaction.type = 'credit';
        }
      }
      // Case 2: Row has description but no date - continuation line
      else if (row.description && pendingTransaction) {
        // Append or set description
        if (pendingTransaction.description && pendingTransaction.description.trim()) {
          pendingTransaction.description += ' ' + row.description;
        } else {
          pendingTransaction.description = row.description;
        }

        // Update balance/amount if present on continuation line
        if (row.balance !== undefined) {
          pendingTransaction.balance = row.balance;
        }
        if (row.moneyOut !== undefined) {
          pendingTransaction.amount = row.moneyOut;
          pendingTransaction.type = 'debit';
        } else if (row.moneyIn !== undefined) {
          pendingTransaction.amount = row.moneyIn;
          pendingTransaction.type = 'credit';
        }
      }
      // Case 3: Row has balance or amount but no description - update current transaction
      else if ((row.balance !== undefined || row.moneyOut !== undefined || row.moneyIn !== undefined) && pendingTransaction) {
        if (row.balance !== undefined) {
          pendingTransaction.balance = row.balance;
        }
        if (row.moneyOut !== undefined) {
          pendingTransaction.amount = row.moneyOut;
          pendingTransaction.type = 'debit';
        } else if (row.moneyIn !== undefined) {
          pendingTransaction.amount = row.moneyIn;
          pendingTransaction.type = 'credit';
        }
      }
      // Case 4: Row doesn't match any case - log it
      else {
        console.log(`  ⚠️  Row ${i + 1} doesn't match any pattern:`, {
          hasDate: !!row.date,
          hasDesc: !!row.description,
          hasBalance: row.balance !== undefined,
          hasMoneyOut: row.moneyOut !== undefined,
          hasMoneyIn: row.moneyIn !== undefined,
          hasPending: !!pendingTransaction
        });
      }
    }

    // Save last pending transaction
    if (pendingTransaction && pendingTransaction.date) {
      if (!pendingTransaction.description || pendingTransaction.description.trim() === '') {
        console.log(`  ⚠️  Skipping last transaction with date "${pendingTransaction.date}" - no description found`);
        skippedCount++;
      } else {
        transactions.push(this.finalizeTransaction(pendingTransaction));
      }
    }

    console.log(`[Building Transactions] Created ${transactions.length} transactions, skipped ${skippedCount} due to missing description\n`);

    // Calculate amounts from balance changes if not explicitly provided
    const transactionsWithAmounts = this.calculateAmountsFromBalances(transactions);

    // Sort transactions by date (chronological order)
    return this.sortTransactionsByDate(transactionsWithAmounts);
  }

  /**
   * Finalize a transaction by cleaning up description and ensuring required fields
   * @param partial Partial transaction data
   * @returns Complete transaction
   */
  private finalizeTransaction(partial: Partial<Transaction>): Transaction {
    return {
      date: partial.date || '',
      description: (partial.description || 'Transaction').trim(),
      amount: partial.amount || 0,
      balance: partial.balance,
      type: partial.type || 'debit',
    };
  }

  /**
   * Calculate transaction amounts from balance changes for transactions without explicit amounts
   * @param transactions Array of transactions (may have missing amounts)
   * @returns Transactions with calculated amounts
   */
  private calculateAmountsFromBalances(transactions: Transaction[]): Transaction[] {
    for (let i = 0; i < transactions.length; i++) {
      const current = transactions[i];

      // If amount is missing or zero, try to calculate from balance change
      if ((!current.amount || current.amount === 0) && current.balance !== undefined) {
        if (i > 0 && transactions[i - 1].balance !== undefined) {
          const prevBalance = transactions[i - 1].balance!;
          const currentBalance = current.balance;
          const balanceChange = currentBalance - prevBalance;

          current.amount = Math.abs(balanceChange);
          current.type = balanceChange >= 0 ? 'credit' : 'debit';

          console.log(`  → Calculated amount for "${current.description.substring(0, 30)}..." from balance change: £${current.amount.toFixed(2)} (${current.type})`);
        }
      }
    }

    return transactions;
  }

  /**
   * Sort transactions by date in chronological order
   * @param transactions Array of transactions
   * @returns Sorted transactions
   */
  private sortTransactionsByDate(transactions: Transaction[]): Transaction[] {
    return transactions.sort((a, b) => {
      // Parse Metro Bank date format: "DD MMM YYYY" (e.g., "17 SEP 2025")
      const parseDate = (dateStr: string): Date => {
        const months: Record<string, number> = {
          JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5,
          JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11
        };

        const parts = dateStr.trim().split(/\s+/);
        if (parts.length !== 3) return new Date(0); // Invalid date goes to start

        const day = parseInt(parts[0], 10);
        const monthStr = parts[1].toUpperCase();
        const year = parseInt(parts[2], 10);

        const month = months[monthStr];
        if (month === undefined) return new Date(0);

        return new Date(year, month, day);
      };

      const dateA = parseDate(a.date);
      const dateB = parseDate(b.date);

      return dateA.getTime() - dateB.getTime();
    });
  }

  /**
   * Debug: Print parsed rows for troubleshooting
   * @param parsedRows Array of parsed rows
   * @param limit Maximum number to print
   */
  private debugPrintParsedRows(parsedRows: ParsedRow[], limit: number = 20): void {
    console.log('\n========== PARSED ROWS DEBUG ==========');
    console.log(`Total parsed rows: ${parsedRows.length}`);
    console.log(`Showing first ${Math.min(limit, parsedRows.length)} rows:\n`);

    parsedRows.slice(0, limit).forEach((row, idx) => {
      console.log(`[Row ${idx + 1}]`);
      console.log(`  Date: ${row.date || '(none)'}`);
      console.log(`  Description: ${row.description?.substring(0, 60) || '(none)'}${row.description && row.description.length > 60 ? '...' : ''}`);
      console.log(`  Money Out: ${row.moneyOut !== undefined ? `£${row.moneyOut.toFixed(2)}` : '(none)'}`);
      console.log(`  Money In: ${row.moneyIn !== undefined ? `£${row.moneyIn.toFixed(2)}` : '(none)'}`);
      console.log(`  Balance: ${row.balance !== undefined ? `£${row.balance.toFixed(2)}` : '(none)'}`);
      console.log('');
    });

    console.log('=======================================\n');
  }
}
