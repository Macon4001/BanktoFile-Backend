import { PDFCoordinateExtractor, TextElement } from './pdfCoordinateExtractor.js';
import { Transaction } from '../types/index.js';

/**
 * Column boundaries detected from headers
 */
interface ColumnBoundaries {
  description: { min: number; max: number };
  moneyOut: { min: number; max: number };
  moneyIn: { min: number; max: number };
  balance: { min: number; max: number };
}

/**
 * Wise (formerly TransferWise) specific PDF parser using coordinate-based extraction
 *
 * Wise statements have a unique structure:
 * - Multi-line transactions (description on line 1, date/ID on line 2)
 * - Three numeric columns: Money Out (negative), Money In (positive), Balance
 * - Supports multiple currencies: GBP, EUR, USD, and any other 3-letter currency code
 * - Transaction format:
 *   Line 1: "Sent money to NAME" or "Received money from NAME"
 *   Line 2: "DD Month YYYY | Wise ID: TRANSFER-XXXXXX"
 *   Columns: [-190.43 GBP] [5.57 GBP] [Balance] (or EUR, USD, etc.)
 */
export class WiseCoordinateParser {
  private extractor: PDFCoordinateExtractor;

  constructor() {
    this.extractor = new PDFCoordinateExtractor();
  }

  /**
   * Parse Wise statement PDF using coordinate-based extraction
   * @param buffer PDF file buffer
   * @param parsedText Parsed text from pdf-parse
   * @param debug Enable debug logging (default: false)
   * @returns Array of transactions
   */
  async parseWiseStatement(buffer: Buffer, parsedText: string, debug: boolean = false): Promise<Transaction[]> {
    console.log('\n========== WISE COORDINATE PARSER ==========');
    console.log('Strategy: Multi-line transactions with 3-column layout\n');

    // Extract all text elements with coordinates
    const elements = await this.extractor.extractTextWithCoordinates(buffer);

    if (debug) {
      console.log(`[Coordinate Extractor] Extracted ${elements.length} text elements`);
      this.extractor.debugPrintElements(elements, 100);
    }

    // Detect column boundaries
    const columnBoundaries = this.detectColumnBoundaries(elements, debug);

    if (!columnBoundaries) {
      console.error('⚠️  Failed to detect Wise column structure');
      throw new Error('Could not detect Wise table structure');
    }

    console.log('[Column Boundaries Detected]');
    console.log(`  DESCRIPTION: X ${columnBoundaries.description.min.toFixed(1)} - ${columnBoundaries.description.max.toFixed(1)}`);
    console.log(`  MONEY OUT: X ${columnBoundaries.moneyOut.min.toFixed(1)} - ${columnBoundaries.moneyOut.max.toFixed(1)}`);
    console.log(`  MONEY IN: X ${columnBoundaries.moneyIn.min.toFixed(1)} - ${columnBoundaries.moneyIn.max.toFixed(1)}`);
    console.log(`  BALANCE: X ${columnBoundaries.balance.min.toFixed(1)} - ${columnBoundaries.balance.max.toFixed(1)}\n`);

    // Extract transactions
    const transactions = this.extractTransactions(elements, columnBoundaries, debug);

    console.log(`\n✓ Extracted ${transactions.length} Wise transactions using coordinate parsing`);
    console.log('====================================================================\n');

    return transactions;
  }

  /**
   * Detect column boundaries using hardcoded values based on Wise statement layout
   * Wise statements have a consistent column layout across all statements
   *
   * Based on manual extraction coordinates:
   * - Description: X 54.29 to 358.10
   * - Amount In: X 358.10 to 431.03
   * - Amount Out: X 431.03 to 493.82
   * - Balance: X 493.82 to 585.39
   */
  private detectColumnBoundaries(elements: TextElement[], debug: boolean): ColumnBoundaries | null {
    if (debug) {
      console.log('[Column Detection] Using hardcoded Wise column boundaries based on manual extraction');
    }

    // Hardcoded column boundaries that work for both GBP and EUR statements
    // Widened to accommodate variations in both statement formats
    return {
      description: {
        min: 0,
        max: 350,  // Covers up to X:350 for descriptions
      },
      moneyIn: {
        min: 350,   // Starts at X:350 to catch X:353.2 (GBP) and X:358+ (EUR)
        max: 431,
      },
      moneyOut: {
        min: 410,   // Starts at X:410 to catch X:412.6 (GBP) and X:431+ (EUR)
        max: 494,
      },
      balance: {
        min: 470,   // Starts at X:470 to catch X:475.6 (GBP) and X:493+ (EUR)
        max: 600,
      },
    };
  }

  /**
   * Extract transactions from elements using column positions
   * Groups multi-line transactions by Y-proximity
   */
  private extractTransactions(
    elements: TextElement[],
    columns: ColumnBoundaries,
    debug: boolean
  ): Transaction[] {
    const transactions: Transaction[] = [];

    // Date patterns for Wise (full month names)
    const datePattern = /(\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4})/i;
    // Match both old format "Wise ID: TRANSFER-XXX" and new format "Transaction: TRANSFER-XXX"
    const wiseIdPattern = /(Wise ID|Transaction):\s*(TRANSFER-\d+|BALANCE-\d+|DIRECT_DEBIT-\d+)/;

    // Group elements by row (Y-coordinate)
    const rows = this.groupElementsByRow(elements);

    // Keep a reference to original rows for amount extraction (before splitting)
    const originalRows = rows;

    // IMPORTANT: Wise statements can have 2-column layouts where transactions appear side-by-side
    // We need to split each row into left and right sections to avoid mixing transactions
    // The description column ends at ~348.5, so anything beyond that is the right column

    if (debug) {
      console.log(`\n[Before Split] Total rows: ${rows.length}`);
      // Show transaction rows (Y:406-800)
      rows.filter(r => r.y >= 400 && r.y <= 450).forEach(row => {
        console.log(`  Y:${row.y.toFixed(1)} [${row.elements.length} elements]`);
        row.elements.forEach((el, idx) => {
          if (el.text && el.text.trim()) {  // Only show non-empty elements
            console.log(`    [${idx}] X:${el.x.toFixed(1)} "${el.text.substring(0, 50)}"`);
          }
        });
      });
    }

    // DON'T SPLIT - just use the original rows
    // Splitting was causing amounts to be lost
    const splitRows = rows; // Use original rows, no splitting

    if (debug) {
      console.log(`\n[Using rows WITHOUT splitting] Total rows: ${splitRows.length}`);
    }

    // Track current transaction being built
    let currentTransaction: Partial<Transaction & { wiseId?: string }> | null = null;
    let descriptionRow: { y: number; elements: TextElement[] } | null = null;

    for (const row of splitRows) {
      // Check if this row contains a date (second line of transaction)
      // Date and Wise ID may be in separate elements, so check ALL elements in the row
      const allRowText = row.elements.map(el => el.text).join(' ');
      const dateMatch = allRowText.match(datePattern);
      const wiseIdMatch = allRowText.match(wiseIdPattern);

      if (debug && (dateMatch || wiseIdMatch)) {
        console.log(`[Row Check] Y:${row.y.toFixed(1)} Text: "${allRowText.substring(0, 80)}"`);
        console.log(`  Date: ${!!dateMatch}, Wise ID: ${!!wiseIdMatch}, Has current: ${!!currentTransaction}`);
      }

      // Check if row has both date AND Wise ID (transaction line)
      if (dateMatch && wiseIdMatch) {
        const transactionId = wiseIdMatch[2]; // The actual ID (TRANSFER-XXX, BALANCE-XXX, etc.)
        const transactionDate = dateMatch[1];

        // Case 1: We have a pending transaction with description
        if (currentTransaction && descriptionRow) {
          // This is the second line of the transaction - extract date and Wise ID
          currentTransaction.date = transactionDate;
          currentTransaction.description = `${currentTransaction.description} (${transactionId})`;

          // Extract amounts and balance from the ORIGINAL UNSPLIT ROW
          // The split logic removes amounts, so we need to find the original row
          if (descriptionRow) {
            const descY = descriptionRow.y;
            const originalRow = originalRows.find(r => Math.abs(r.y - descY) < 0.05);

            if (originalRow && debug) {
              const rowElements = originalRow.elements.map(el => `X:${el.x.toFixed(1)} "${el.text.substring(0, 20)}"`).join(' | ');
              console.log(`  [Extract From ORIGINAL] Y:${originalRow.y.toFixed(1)} [${originalRow.elements.length} elements] ${rowElements}`);
            }

            if (originalRow) {
              this.extractAmountsAndBalance(originalRow, columns, currentTransaction, debug);
            }
          }

          // ALWAYS save the transaction - prioritize showing transactions over filtering
          if (currentTransaction.date && currentTransaction.description) {
            // Use amount 0 if not found
            const amount = currentTransaction.amount || 0;
            const type = currentTransaction.type || 'debit';

            transactions.push({
              date: currentTransaction.date,
              description: currentTransaction.description.trim(),
              amount: amount,
              balance: currentTransaction.balance,
              type: type,
            });

            if (debug) {
              console.log(`[Transaction Added] ${currentTransaction.date} | ${currentTransaction.description.substring(0, 40)} | ${type} £${amount} | Balance: ${currentTransaction.balance}`);
            }
          } else if (debug) {
            console.log(`[Transaction SKIPPED] Missing required fields - Date: ${!!currentTransaction.date}, Desc: ${!!currentTransaction.description}`);
          }

          currentTransaction = null;
          descriptionRow = null;
        }
        // Case 2: No pending transaction - this might be a standalone transaction line (e.g., direct debit)
        else {
          // Try to extract amounts directly from this row
          const standaloneTransaction: Partial<Transaction> = {
            date: transactionDate,
            description: transactionId, // Use transaction ID as description
          };

          this.extractAmountsAndBalance(row, columns, standaloneTransaction, debug);

          // ALWAYS add if we have date and description
          if (standaloneTransaction.date && standaloneTransaction.description) {
            const amount = standaloneTransaction.amount || 0;
            const type = standaloneTransaction.type || 'debit';

            transactions.push({
              date: standaloneTransaction.date,
              description: standaloneTransaction.description.trim(),
              amount: amount,
              balance: standaloneTransaction.balance,
              type: type,
            });

            if (debug) {
              console.log(`[Standalone Transaction Added] ${standaloneTransaction.date} | ${standaloneTransaction.description} | ${type} £${amount} | Balance: ${standaloneTransaction.balance}`);
            }
          } else if (debug) {
            console.log(`[Standalone SKIPPED] Missing fields - Date: ${!!standaloneTransaction.date}, Desc: ${!!standaloneTransaction.description}`);
          }
        }
      } else if (!dateMatch && !wiseIdMatch) {
        // Check if this row contains a description (first line of transaction)
        // Only consider elements in description column that aren't dates
        const descElements = row.elements.filter(el =>
          el.x >= columns.description.min && el.x <= columns.description.max &&
          !datePattern.test(el.text) &&
          !wiseIdPattern.test(el.text)
        );

        if (descElements.length > 0) {
          const description = descElements.map(el => el.text).join(' ').trim();

          // Must be a valid transaction description (starts with "Sent money" or "Received money")
          if (this.isValidDescription(description) && this.isTransactionDescription(description)) {
            // Start a new transaction and save the row for amount extraction
            currentTransaction = {
              description: description,
            };
            descriptionRow = row; // Save this row to extract amounts from later

            if (debug) {
              const rowSummary = row.elements.map(el => `X:${el.x.toFixed(1)} "${el.text.substring(0, 20)}"`).join(' | ');
              console.log(`[New Transaction] Y:${row.y.toFixed(1)} [${row.elements.length} elements] Description: "${description}"`);
              console.log(`  Full row: ${rowSummary}`);
            }
          }
        }
      }
    }

    // Sort by date (chronological order)
    return this.sortTransactionsByDate(transactions);
  }

  /**
   * Extract amounts and balance from a row
   */
  private extractAmountsAndBalance(
    row: { y: number; elements: TextElement[] },
    columns: ColumnBoundaries,
    transaction: Partial<Transaction>,
    debug: boolean
  ): void {
    // Match amounts with any 3-letter currency code: "-190.43 GBP" or "191.00 EUR" or "5.00 USD"
    const amountPattern = /^(-?)(\d+(?:,\d{3})*\.\d{2})\s*[A-Z]{3}$/;

    // Extract Money Out (negative amounts in Wise = debits)
    if (columns.moneyOut.min > 0) {
      const moneyOutElements = row.elements.filter(el =>
        el.x >= columns.moneyOut.min && el.x <= columns.moneyOut.max
      );
      for (const el of moneyOutElements) {
        const match = el.text.match(amountPattern);
        if (match) {
          const hasNegative = match[1] === '-';
          const amount = parseFloat(match[2].replace(/,/g, ''));
          // Wise Money Out column shows negative amounts like "-190.43 GBP"
          if (amount > 0 && hasNegative) {
            transaction.amount = amount;
            transaction.type = 'debit';
            if (debug) console.log(`  Money Out: -£${amount} (debit)`);
            break;
          }
        }
      }
    }

    // Extract Money In (if no Money Out found)
    if (!transaction.amount && columns.moneyIn.min > 0) {
      const moneyInElements = row.elements.filter(el =>
        el.x >= columns.moneyIn.min && el.x <= columns.moneyIn.max
      );
      for (const el of moneyInElements) {
        const match = el.text.match(amountPattern);
        if (match) {
          const hasNegative = match[1] === '-';
          const amount = parseFloat(match[2].replace(/,/g, ''));
          // Wise Money In column shows positive amounts like "191.00 GBP"
          if (amount > 0 && !hasNegative) {
            transaction.amount = amount;
            transaction.type = 'credit';
            if (debug) console.log(`  Money In: £${amount} (credit)`);
            break;
          }
        }
      }
    }

    // Extract Balance
    const balanceElements = row.elements.filter(el =>
      el.x >= columns.balance.min && el.x <= columns.balance.max
    );
    for (const el of balanceElements) {
      const match = el.text.match(amountPattern);
      if (match) {
        const sign = match[1] === '-' ? -1 : 1;
        const amount = parseFloat(match[2].replace(/,/g, ''));
        transaction.balance = sign * amount;
        if (debug) console.log(`  Balance: £${transaction.balance}`);
        break;
      }
    }
  }

  /**
   * Check if description is valid (not header/footer text)
   */
  private isValidDescription(text: string): boolean {
    const invalidPatterns = [
      /TransferWise Ltd/i,
      /Shoreditch High Street/i,
      /^London$/i,
      /^United Kingdom$/i,
      /Need any help/i,
      /wise\.com/i,
      /GBP statement/i,
      /Generated on/i,
      /Account Holder/i,
      /^IBAN$/i,
      /Account number/i,
      /UK sort code/i,
      /^\d{2}-\d{2}-\d{2}$/,  // Sort code
      /^GB\d{2}\s*[A-Z]{4}/i, // IBAN format
      /^\d{8}$/,               // Account number
      /^[\d\s]+$/,             // Only numbers and spaces (addresses, account numbers)
    ];

    for (const pattern of invalidPatterns) {
      if (pattern.test(text)) {
        return false;
      }
    }

    return text.length > 5; // Minimum length
  }

  /**
   * Check if text is a transaction description
   * Must match known Wise transaction patterns
   */
  private isTransactionDescription(text: string): boolean {
    // Known transaction patterns in Wise statements
    const transactionPatterns = /^(Sent money to|Received money from|Converted|Paid to)/i;
    return transactionPatterns.test(text);
  }

  /**
   * Split rows into separate columns to handle 2-column layouts
   * Some Wise statements display transactions side-by-side
   */
  private splitRowsIntoColumns(
    rows: Array<{ y: number; elements: TextElement[] }>,
    columnSplitX: number
  ): Array<{ y: number; elements: TextElement[] }> {
    const result: Array<{ y: number; elements: TextElement[] }> = [];

    for (const row of rows) {
      // Find description elements (non-empty text in description column)
      // Exclude amounts (anything matching currency pattern)
      const amountPattern = /^-?\d+(?:,\d{3})*\.\d{2}\s*[A-Z]{3}$/;
      const descriptions = row.elements.filter(el =>
        el.text &&
        el.text.trim() &&
        el.x >= 0 &&
        el.x <= 358.1 && // Description column
        !/^\d+\s+\w+\s+\d{4}$/.test(el.text) && // Not a date
        !/^Transaction:|^Wise ID:/.test(el.text) && // Not a transaction ID
        !amountPattern.test(el.text) // Not an amount
      );

      // If we have 2+ descriptions, this is a 2-column layout - split by text content
      if (descriptions.length >= 2) {
        console.log(`[Split Debug] Y:${row.y.toFixed(1)} has ${descriptions.length} descriptions:`);
        descriptions.forEach((d, i) => {
          console.log(`  [${i}] X:${d.x.toFixed(1)} "${d.text.substring(0, 40)}"`);
        });

        // Group elements by proximity to each description
        const leftDesc = descriptions[0];
        const rightDesc = descriptions[descriptions.length - 1];

        // Calculate midpoint between the two descriptions
        const midX = (leftDesc.x + rightDesc.x) / 2;
        console.log(`  Split at midpoint X:${midX.toFixed(1)}`);

        const leftElements = row.elements.filter(el => el.x < midX || Math.abs(el.x - leftDesc.x) < 10);
        const rightElements = row.elements.filter(el => el.x >= midX && Math.abs(el.x - leftDesc.x) >= 10);

        if (leftElements.length > 0 && rightElements.length > 0) {
          result.push({
            y: row.y,
            elements: leftElements.sort((a, b) => a.x - b.x),
          });
          result.push({
            y: row.y + 0.1,
            elements: rightElements.sort((a, b) => a.x - b.x),
          });
        } else {
          result.push(row);
        }
      } else {
        // Standard split by X coordinate for rows with amounts
        const leftElements = row.elements.filter(el => el.x <= columnSplitX + 50);
        const rightElements = row.elements.filter(el => el.x > columnSplitX + 50);

        if (leftElements.length > 0 && rightElements.length > 0) {
          result.push({
            y: row.y,
            elements: leftElements.sort((a, b) => a.x - b.x),
          });
          result.push({
            y: row.y + 0.1,
            elements: rightElements.sort((a, b) => a.x - b.x),
          });
        } else {
          result.push(row);
        }
      }
    }

    return result;
  }

  /**
   * Group text elements by row (Y-coordinate)
   * IMPORTANT: Groups by page AND Y-coordinate to avoid mixing elements from different pages
   */
  private groupElementsByRow(elements: TextElement[], yTolerance: number = 5): Array<{ y: number; elements: TextElement[] }> {
    // Use a composite key: "page:y" to group by both page and Y-coordinate
    const rows = new Map<string, { y: number; page: number; elements: TextElement[] }>();

    for (const element of elements) {
      // Find existing row on the SAME PAGE within Y tolerance
      let foundRow = false;
      for (const [, row] of rows.entries()) {
        if (row.page === element.pageNumber && Math.abs(element.y - row.y) <= yTolerance) {
          row.elements.push(element);
          foundRow = true;
          break;
        }
      }

      if (!foundRow) {
        const key = `${element.pageNumber}:${element.y}`;
        rows.set(key, {
          y: element.y,
          page: element.pageNumber,
          elements: [element],
        });
      }
    }

    // Convert to array and sort by page, then Y (top to bottom)
    return Array.from(rows.values())
      .map(row => ({
        y: row.y,
        elements: row.elements.sort((a, b) => a.x - b.x), // Sort by X within row
      }))
      .sort((a, b) => {
        // Sort by page first, then by Y
        const pageA = a.elements[0].pageNumber;
        const pageB = b.elements[0].pageNumber;
        if (pageA !== pageB) return pageA - pageB;
        return a.y - b.y;
      });
  }

  /**
   * Sort transactions by date in chronological order
   */
  private sortTransactionsByDate(transactions: Transaction[]): Transaction[] {
    // Wise statements show newest first (reverse chronological order)
    return transactions.sort((a, b) => {
      const dateA = this.parseWiseDate(a.date);
      const dateB = this.parseWiseDate(b.date);
      return dateB.getTime() - dateA.getTime(); // Reversed: newest first
    });
  }

  /**
   * Parse Wise date format: "DD Month YYYY" (e.g., "7 June 2021")
   */
  private parseWiseDate(dateStr: string): Date {
    const months: Record<string, number> = {
      january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
      july: 6, august: 7, september: 8, october: 9, november: 10, december: 11
    };

    const parts = dateStr.trim().split(/\s+/);
    if (parts.length !== 3) return new Date(0);

    const day = parseInt(parts[0], 10);
    const monthStr = parts[1].toLowerCase();
    const year = parseInt(parts[2], 10);

    const month = months[monthStr];
    if (month === undefined) return new Date(0);

    return new Date(year, month, day);
  }
}
