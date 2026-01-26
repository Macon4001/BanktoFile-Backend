import { Transaction } from "../types/index.js";
import { PDFCoordinateExtractor, TextElement } from "./pdfCoordinateExtractor.js";

/**
 * Generic coordinate-based PDF parser for bank statements
 *
 * This parser uses PDF coordinates to extract transactions from tabular statements.
 * It's designed as a fallback when text-based parsing fails.
 *
 * How it works:
 * 1. Extract all text with coordinates from PDF
 * 2. Detect column headers (Date, Description, Type, Amount, Balance)
 * 3. Use header positions to identify column boundaries
 * 4. Extract transactions row by row using Y-coordinates
 * 5. Match values in each column using X-coordinates
 */
export class GenericCoordinateParser {
  private extractor: PDFCoordinateExtractor;

  constructor() {
    this.extractor = new PDFCoordinateExtractor();
  }

  /**
   * Parse a bank statement PDF using coordinate-based extraction
   */
  async parseStatement(buffer: Buffer, debug: boolean = false): Promise<Transaction[]> {
    console.log("\n========== GENERIC COORDINATE PARSER ==========");
    console.log("Strategy: Detect columns and extract transactions using coordinates\n");

    // Extract all text elements with coordinates
    const elements = await this.extractor.extractTextWithCoordinates(buffer);

    if (debug) {
      console.log(`[Coordinate Extractor] Extracted ${elements.length} text elements`);
    }

    // Detect column headers
    const columns = this.detectColumns(elements);

    if (debug) {
      console.log("[Detected Columns]");
      Object.entries(columns).forEach(([name, bounds]) => {
        if (bounds) {
          console.log(`  ${name}: X ${bounds.min.toFixed(1)} - ${bounds.max.toFixed(1)}`);
        }
      });
    }

    // Extract transactions
    const transactions = this.extractTransactions(elements, columns, debug);

    console.log(`\n✓ Extracted ${transactions.length} transactions using coordinate parsing`);
    console.log("====================================================================\n");

    return transactions;
  }

  /**
   * Detect column headers and their positions
   */
  private detectColumns(elements: TextElement[]): {
    date?: { min: number; max: number };
    reference?: { min: number; max: number };
    description?: { min: number; max: number };
    type?: { min: number; max: number };
    debit?: { min: number; max: number };
    credit?: { min: number; max: number };
    amount?: { min: number; max: number };
    balance?: { min: number; max: number };
  } {
    const columns: Record<string, { min: number; max: number } | undefined> = {};

    // Find column headers - look for any text element that matches these patterns
    const headerPatterns = {
      date: /^date$/i,
      reference: /^reference$/i,
      description: /^(description|details|transaction|particulars|transaction details)$/i,
      type: /^(type|dr\/cr|d\/c)$/i,
      debit: /^(debit|out|money out|paid out)(\s*\([£€$]\))?$/i,  // Match "Debit", "Debit (£)", "Out", "Money Out", etc.
      credit: /^(credit|in|money in|paid in)(\s*\([£€$]\))?$/i, // Match "Credit", "Credit (£)", "In", "Money In", etc.
      amount: /^(amount|value)(\s*\([£€$]\))?$/i,
      balance: /^balance/i,  // Match "Balance", "Balance (£)", etc.
    };

    // Find elements that match header patterns
    const foundHeaders: Array<{ columnName: string; text: string; x: number; width: number }> = [];

    for (const [columnName, pattern] of Object.entries(headerPatterns)) {
      for (const el of elements) {
        if (pattern.test(el.text.trim())) {
          // Store all potential headers
          foundHeaders.push({
            columnName,
            text: el.text,
            x: el.x,
            width: el.width
          });
          console.log(`[Header Match] "${el.text}" matched ${columnName} pattern at x=${el.x.toFixed(1)}`);
        }
      }
    }

    // Filter out duplicate columns (e.g., "Money Out" and "Out" both match debit pattern)
    // Strategy: Find headers that are in the same row (same Y coordinate, within tolerance)
    // These are likely the actual table headers, not summary text

    // Group headers by Y coordinate to find which ones are in the same row
    const headersByY = new Map<number, Array<{ columnName: string; text: string; x: number; width: number; y: number }>>();

    for (const header of foundHeaders) {
      const headerEl = elements.find(el => el.text === header.text && el.x === header.x);
      if (!headerEl) continue;

      // Find or create Y group (within 5px tolerance)
      let foundY = false;
      for (const [y, group] of headersByY.entries()) {
        if (Math.abs(y - headerEl.y) < 5) {
          group.push({ ...header, y: headerEl.y });
          foundY = true;
          break;
        }
      }
      if (!foundY) {
        headersByY.set(headerEl.y, [{ ...header, y: headerEl.y }]);
      }
    }

    // IMPORTANT: Bank statements are ALWAYS organized by date chronologically
    // Find the row with the most header columns that also appears ABOVE transaction dates
    // This filters out summary sections that might have similar headers but appear after transactions start

    let maxHeaders = 0;
    let tableHeaderRow: Array<{ columnName: string; text: string; x: number; width: number; y: number }> = [];

    console.log(`[Row Grouping] Found ${headersByY.size} header rows:`);
    for (const [y, group] of headersByY.entries()) {
      // Count unique column names (not total headers, since there may be duplicates)
      const uniqueColumns = new Set(group.map(h => h.columnName)).size;
      console.log(`  Row at y=${y.toFixed(1)}: ${group.length} headers (${uniqueColumns} unique) - ${group.map(h => `"${h.text}"`).join(', ')}`);
      if (uniqueColumns > maxHeaders) {
        maxHeaders = uniqueColumns;
        tableHeaderRow = group;
      }
    }
    console.log(`[Row Grouping] Selected row with ${maxHeaders} unique column types as table header row`);

    // Use headers from the table header row, but deduplicate by column name
    // For duplicate column names (e.g., both "Money In" and "In"), prefer the one with larger X
    const columnMap = new Map<string, { text: string; x: number; width: number }>();
    for (const header of tableHeaderRow) {
      const existing = columnMap.get(header.columnName);
      if (!existing || header.x > existing.x) {
        // Prefer headers further to the right (table headers, not summary text on left)
        columnMap.set(header.columnName, header);
        if (existing) {
          console.log(`  [Dedup] Replaced "${existing.text}" (x=${existing.x}) with "${header.text}" (x=${header.x}) for ${header.columnName}`);
        }
      }
    }

    // Set columns from filtered headers
    for (const [columnName, header] of columnMap.entries()) {
      columns[columnName] = {
        min: header.x,
        max: header.x + header.width,
      };
      console.log(`[Column Detection] Found "${columnName}" header: "${header.text}" at x=${header.x.toFixed(1)}, width=${header.width.toFixed(1)}`);
    }

    // Expand column boundaries to be more inclusive
    // Add padding to catch values that might be slightly offset
    const padding = 20;
    Object.keys(columns).forEach((key) => {
      if (columns[key]) {
        columns[key]!.min -= padding;
        columns[key]!.max += padding;
      }
    });

    return columns;
  }

  /**
   * Extract transactions from elements using column positions
   */
  private extractTransactions(
    elements: TextElement[],
    columns: Record<string, { min: number; max: number } | undefined>,
    debug: boolean
  ): Transaction[] {
    const transactions: Transaction[] = [];

    // Group elements by Y coordinate (rows)
    const rows = this.groupElementsByRow(elements);

    // Multiple date patterns to identify transaction rows from different banks
    const datePatterns = [
      /^\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i,  // "01 Jan 2024" or "1 Jan"
      /^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}$/,  // "01/01/2024" or "01-01-24"
      /^\d{4}[/-]\d{1,2}[/-]\d{1,2}$/,    // "2024-01-01"
      /^(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}/i,  // "Jan 01"
    ];

    // Sort code pattern to avoid - match formats like "20-45-67"
    const sortCodePattern = /^\d{2}-\d{2}-\d{2}$/;

    let debugCount = 0;
    for (const row of rows) {
      // Extract date - combine all elements in the date column
      let date = "";
      if (columns.date) {
        const dateElements = row.elements.filter(
          (el) => el.x >= columns.date!.min && el.x <= columns.date!.max
        );
        date = dateElements.map((el) => el.text).join(" ").trim();

        // Debug: Show date attempts from actual transaction pages
        if (debug && date) {
          const matchesAnyPattern = datePatterns.some(pattern => pattern.test(date));
          // Only log if it looks like it might be a transaction (has date-like content)
          if (matchesAnyPattern || /\d{1,2}/.test(date)) {
            console.log(`[Date Check] Candidate: "${date.substring(0, 100)}", Pattern match: ${matchesAnyPattern}, Is sort code: ${sortCodePattern.test(date)}`);
            debugCount++;
            if (debugCount >= 50) {
              console.log(`[Date Check] Stopping debug output after 50 candidates...`);
              debug = false; // Stop flooding logs
            }
          }
        }
      }

      // Check if this row contains a valid date (and not a sort code)
      // Date must match at least one of the patterns
      const matchesDatePattern = datePatterns.some(pattern => pattern.test(date));
      if (!date || !matchesDatePattern || sortCodePattern.test(date)) continue; // Not a transaction row

      // Skip rows that contain multiple dates (summary pages with multi-column layout)
      // Count how many date-like patterns appear in the date field
      const dateMatches = date.match(/\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/gi);
      if (dateMatches && dateMatches.length > 1) {
        if (debug) console.log(`[Skip] Row has multiple dates (${dateMatches.length}), likely a summary row: "${date.substring(0, 80)}"`);
        continue; // This is a summary row with multiple transactions side-by-side
      }

      // Skip rows where the date field contains full sentences (mixed content from different PDF columns)
      // Real transaction dates should be short: just date + maybe reference code
      // If date text is very long or contains common sentence words, it's contaminated
      const sentenceWords = /\b(the|and|you|your|will|may|with|from|have|this|that|are|for|not|but|can|all|should|must|been|has|was|were|statement|account|transaction|interest|balance|credit|debit)\b/i;
      if (date.length > 100 || sentenceWords.test(date)) {
        if (debug) console.log(`[Skip] Row has contaminated date field (likely mixed columns): "${date.substring(0, 80)}"`);
        continue; // Date field contains text from other columns
      }

      // Extract reference code if present
      let reference = "";
      if (columns.reference) {
        const refElements = row.elements.filter(
          (el) => el.x >= columns.reference!.min && el.x <= columns.reference!.max
        );
        reference = refElements.map((el) => el.text).join(" ").trim();
      }

      // Extract description from the area between reference/date and debit/credit columns
      let description = "";
      const descStart = columns.reference ? columns.reference.max : (columns.date ? columns.date.max : 0);
      const descEnd = columns.debit ? columns.debit.min : (columns.credit ? columns.credit.min : 999999);

      const descElements = row.elements.filter(
        (el) => el.x > descStart && el.x < descEnd && !/^[+\-]?[\d,£$.]+$/.test(el.text.trim())
      );
      description = descElements.map((el) => el.text).join(" ").trim();

      // If we have both reference and description, combine them
      if (reference && description) {
        description = `${reference} ${description}`;
      } else if (reference && !description) {
        description = reference;
      }

      // Check if this is an opening balance / balance brought forward
      const isOpeningBalance = /opening balance|balance brought forward|brought forward/i.test(description);

      // Extract amount and type - try different strategies based on what columns exist
      let amount = 0;
      let type: "debit" | "credit" = "debit";
      let typeDetected = false;

      // STRATEGY 1: Statement has explicit TYPE column (e.g., Greenfield: CR/DR)
      if (columns.type && columns.amount) {
        const typeElement = row.elements.find(
          (el) => el.x >= columns.type!.min && el.x <= columns.type!.max
        );
        const amountElement = row.elements.find(
          (el) => el.x >= columns.amount!.min && el.x <= columns.amount!.max && this.isAmount(el.text)
        );

        if (typeElement && amountElement) {
          const typeText = typeElement.text.toUpperCase();
          type = typeText.includes("CR") ? "credit" : "debit";
          amount = this.parseAmount(amountElement.text);
          typeDetected = true;
          if (debug) console.log(`[DEBUG] Strategy 1 (TYPE+AMOUNT): type=${type}, amount=${amount}`);
        }
      }

      // STRATEGY 2: Statement has AMOUNT column with +/- signs (e.g., Northgate)
      if (!typeDetected && columns.amount) {
        const amountElement = row.elements.find(
          (el) => el.x >= columns.amount!.min && el.x <= columns.amount!.max && this.isAmount(el.text)
        );
        if (amountElement) {
          const amountText = amountElement.text.trim();
          // Check if amount has +/- sign prefix
          if (amountText.startsWith('+')) {
            type = "credit";
            amount = this.parseAmount(amountText.substring(1));
            typeDetected = true;
            if (debug) console.log(`[DEBUG] Strategy 2 (AMOUNT with +): type=credit, amount=${amount}`);
          } else if (amountText.startsWith('-')) {
            type = "debit";
            amount = this.parseAmount(amountText.substring(1));
            typeDetected = true;
            if (debug) console.log(`[DEBUG] Strategy 2 (AMOUNT with -): type=debit, amount=${amount}`);
          }
        }
      }

      // STRATEGY 3: Statement has separate DEBIT/CREDIT columns (e.g., Riverside: OUT/IN, Crimson: Out/In)
      // This works even if column headers weren't detected - we infer from X positions
      if (!typeDetected) {
        const descEnd = columns.description ? columns.description.max : 0;
        const balanceStart = columns.balance ? columns.balance.min : 999999;

        const amountCandidates = row.elements.filter(
          (el) => el.x > descEnd && el.x < balanceStart && this.isAmount(el.text)
        );

        if (debug && date && amountCandidates.length > 0) {
          console.log(`[DEBUG] Strategy 3 amount candidates for "${date}":`, amountCandidates.map(el => `"${el.text}" (x:${el.x})`));
        }

        if (amountCandidates.length === 1) {
          const amountEl = amountCandidates[0];
          amount = this.parseAmount(amountEl.text);

          // Check if in credit or debit column boundaries (if detected)
          if (columns.credit || columns.debit) {
            const isInCreditColumn = columns.credit &&
              amountEl.x >= columns.credit.min &&
              amountEl.x <= columns.credit.max;

            const isInDebitColumn = columns.debit &&
              amountEl.x >= columns.debit.min &&
              amountEl.x <= columns.debit.max;

            if (isInCreditColumn) {
              type = "credit";
              typeDetected = true;
              if (debug) console.log(`[DEBUG] Strategy 3a (single amount in credit column): x=${amountEl.x}, creditCol=[${columns.credit?.min}-${columns.credit?.max}], type=credit`);
            } else if (isInDebitColumn) {
              type = "debit";
              typeDetected = true;
              if (debug) console.log(`[DEBUG] Strategy 3a (single amount in debit column): x=${amountEl.x}, debitCol=[${columns.debit?.min}-${columns.debit?.max}], type=debit`);
            } else {
              // Amount is not clearly in either column - defer to balance comparison
              if (debug) console.log(`[DEBUG] Strategy 3b (single amount, unclear column): x=${amountEl.x}, debitCol=[${columns.debit?.min}-${columns.debit?.max}], creditCol=[${columns.credit?.min}-${columns.credit?.max}], deferring to balance comparison`);
            }
          } else {
            // No column headers detected - we'll use Strategy 4 (balance comparison) instead
            if (debug) console.log(`[DEBUG] Strategy 3b (single amount, no columns): x=${amountEl.x}, deferring to balance comparison`);
          }
        } else if (amountCandidates.length === 2) {
          // Two amounts found - likely separate Out/In columns
          // Check if they're in the debit/credit column boundaries
          if (columns.debit && columns.credit) {
            const debitAmount = amountCandidates.find(el =>
              el.x >= columns.debit!.min && el.x <= columns.debit!.max
            );
            const creditAmount = amountCandidates.find(el =>
              el.x >= columns.credit!.min && el.x <= columns.credit!.max
            );

            const debitValue = debitAmount ? this.parseAmount(debitAmount.text) : 0;
            const creditValue = creditAmount ? this.parseAmount(creditAmount.text) : 0;

            if (debug) console.log(`[DEBUG] Strategy 3c (two amounts with columns): debit=${debitValue}, credit=${creditValue}`);

            if (debitValue > 0 && creditValue === 0) {
              amount = debitValue;
              type = "debit";
              typeDetected = true;
              if (debug) console.log(`[DEBUG] Strategy 3c result: using debit amount`);
            } else if (creditValue > 0 && debitValue === 0) {
              amount = creditValue;
              type = "credit";
              typeDetected = true;
              if (debug) console.log(`[DEBUG] Strategy 3c result: using credit amount`);
            } else if (debitValue > 0 && creditValue > 0) {
              // Both have values - this shouldn't happen normally, use balance comparison
              if (debug) console.log(`[DEBUG] Strategy 3c: both columns have values, deferring to balance comparison`);
            }
          } else {
            // No column headers detected - fall back to position-based logic
            // The leftmost is typically "Out" (debit), rightmost is "In" (credit)
            const sortedCandidates = amountCandidates.sort((a, b) => a.x - b.x);
            const leftAmount = this.parseAmount(sortedCandidates[0].text);
            const rightAmount = this.parseAmount(sortedCandidates[1].text);

            if (debug) console.log(`[DEBUG] Strategy 3d (two amounts by position): left=${leftAmount}, right=${rightAmount}`);

            if (leftAmount > 0 && rightAmount === 0) {
              amount = leftAmount;
              type = "debit";
              typeDetected = true;
              if (debug) console.log(`[DEBUG] Strategy 3d result: left amount is debit`);
            } else if (rightAmount > 0 && leftAmount === 0) {
              amount = rightAmount;
              type = "credit";
              typeDetected = true;
              if (debug) console.log(`[DEBUG] Strategy 3d result: right amount is credit`);
            } else if (leftAmount > 0 && rightAmount > 0) {
              // Both have values - use balance comparison (Strategy 4) to determine which is correct
              if (debug) console.log(`[DEBUG] Strategy 3d: both amounts >0, deferring to balance comparison`);
            }
          }
        }
      }

      // Extract balance (optional)
      let balance: number | undefined;
      if (columns.balance) {
        const balanceElement = row.elements.find(
          (el) => el.x >= columns.balance!.min && el.x <= columns.balance!.max && this.isAmount(el.text)
        );
        if (balanceElement) {
          // Use parseBalance to preserve negative sign
          balance = this.parseBalance(balanceElement.text);
        }
      }

      // STRATEGY 4: Determine debit/credit by comparing balance changes
      // If type not yet detected and we have both balance and amount, calculate from balance change
      if (!typeDetected && balance !== undefined && amount > 0 && transactions.length > 0) {
        const previousTransaction = transactions[transactions.length - 1];
        if (previousTransaction.balance !== undefined) {
          const balanceChange = balance - previousTransaction.balance;

          // If balance increased, it's a credit (money in)
          // If balance decreased, it's a debit (money out)
          if (Math.abs(balanceChange - amount) < 0.01) {
            // Balance increased by the amount = credit
            type = "credit";
            typeDetected = true;
            if (debug) console.log(`[DEBUG] Strategy 4 (balance comparison): balance increased by ${amount}, type=credit`);
          } else if (Math.abs(balanceChange + amount) < 0.01) {
            // Balance decreased by the amount = debit
            type = "debit";
            typeDetected = true;
            if (debug) console.log(`[DEBUG] Strategy 4 (balance comparison): balance decreased by ${amount}, type=debit`);
          }
        }
      }

      // Only add transaction if we have required fields (or if it's an opening balance)
      if ((date && description && amount > 0) || isOpeningBalance) {
        const transaction: Transaction = {
          date,
          description,
          amount: amount || 0,
          type: isOpeningBalance ? 'brought_forward' : type, // Mark opening balance as brought_forward
          balance,
        };

        // Mark opening balance transactions
        if (isOpeningBalance) {
          transaction.isOpeningBalance = true;
        }

        transactions.push(transaction);

        if (debug) {
          const label = isOpeningBalance ? '[Opening Balance]' : '[Transaction]';
          console.log(`${label} ${date} | ${description.substring(0, 30)} | ${type} | £${amount} | Balance: £${balance || "N/A"}`);
        }
      }
    }

    // IMPORTANT: Sort transactions by date chronologically
    // All bank statements are organized by date, so we enforce this
    transactions.sort((a, b) => {
      const dateA = this.parseTransactionDate(a.date);
      const dateB = this.parseTransactionDate(b.date);
      if (dateA && dateB) {
        return dateA.getTime() - dateB.getTime();
      }
      return 0;
    });

    if (debug && transactions.length > 0) {
      console.log(`[Sorted Transactions] First: ${transactions[0].date}, Last: ${transactions[transactions.length - 1].date}`);
    }

    return transactions;
  }

  /**
   * Parse transaction date string to Date object
   */
  private parseTransactionDate(dateStr: string): Date | null {
    try {
      // Handle various date formats
      // DD/MM/YYYY or DD-MM-YYYY
      const ddmmyyyyMatch = dateStr.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
      if (ddmmyyyyMatch) {
        const day = parseInt(ddmmyyyyMatch[1]);
        const month = parseInt(ddmmyyyyMatch[2]) - 1; // JS months are 0-indexed
        const year = parseInt(ddmmyyyyMatch[3]);
        const fullYear = year < 100 ? 2000 + year : year;
        return new Date(fullYear, month, day);
      }

      // DD MMM YYYY (e.g., "01 Jan 2024")
      const ddmmmyyyyMatch = dateStr.match(/^(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{4})$/i);
      if (ddmmmyyyyMatch) {
        const day = parseInt(ddmmmyyyyMatch[1]);
        const monthStr = ddmmmyyyyMatch[2];
        const year = parseInt(ddmmmyyyyMatch[3]);
        const monthMap: Record<string, number> = {
          jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
          jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11
        };
        const month = monthMap[monthStr.toLowerCase()];
        return new Date(year, month, day);
      }

      return null;
    } catch {
      return null;
    }
  }

  /**
   * Group text elements by row (Y-coordinate)
   */
  private groupElementsByRow(elements: TextElement[], yTolerance: number = 5): Array<{ y: number; elements: TextElement[] }> {
    const rows = new Map<number, TextElement[]>();

    for (const element of elements) {
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

    // Convert to array and sort by Y (top to bottom)
    const rowsArray = Array.from(rows.entries());
    return rowsArray
      .map(([y, elements]) => ({
        y,
        elements: elements.sort((a, b) => a.x - b.x), // Sort by X within row
      }))
      .sort((a, b) => a.y - b.y); // Sort rows by Y
  }

  /**
   * Check if text looks like a monetary amount
   */
  private isAmount(text: string): boolean {
    // Remove currency symbols and whitespace
    const cleaned = text.replace(/[£$€\s,]/g, "");

    // Check if it's a valid number with optional decimal and optional +/- sign
    return /^[+-]?\d+(\.\d{1,2})?$/.test(cleaned);
  }

  /**
   * Parse amount string to number (removes +/- signs)
   */
  private parseAmount(text: string): number {
    const cleaned = text.replace(/[£$€\s,]/g, "").replace(/^[+-]/, "");
    const amount = parseFloat(cleaned);
    return isNaN(amount) ? 0 : amount;
  }

  /**
   * Parse balance string to number (preserves negative sign)
   */
  private parseBalance(text: string): number {
    // Remove currency symbols and commas, but KEEP the minus sign
    const cleaned = text.replace(/[£$€\s,]/g, "").replace(/^\+/, "");
    const balance = parseFloat(cleaned);
    return isNaN(balance) ? 0 : balance;
  }
}
