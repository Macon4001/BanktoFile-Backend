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
    description?: { min: number; max: number };
    type?: { min: number; max: number };
    debit?: { min: number; max: number };
    credit?: { min: number; max: number };
    amount?: { min: number; max: number };
    balance?: { min: number; max: number };
  } {
    const columns: Record<string, { min: number; max: number } | undefined> = {};

    // Find column headers
    const headerPatterns = {
      date: /^date$/i,
      description: /^(description|details|transaction|particulars)$/i,
      type: /^(type|dr\/cr|d\/c)$/i,
      debit: /^(debit|money\s*out|payments?|debits?|out\s*\()/i,
      credit: /^(credit|money\s*in|receipts?|credits?|in\s*\()/i,
      amount: /^(amount|value)$/i,
      balance: /^balance$/i,
    };

    // Find elements that match header patterns
    for (const [columnName, pattern] of Object.entries(headerPatterns)) {
      for (const el of elements) {
        if (pattern.test(el.text.trim())) {
          // Found a header - use its X position to define column boundaries
          columns[columnName] = {
            min: el.x,
            max: el.x + el.width,
          };
          break;
        }
      }
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

    // Date pattern to identify transaction rows
    const datePattern = /^\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/i;

    for (const row of rows) {
      // Extract date - combine all elements in the date column
      let date = "";
      if (columns.date) {
        const dateElements = row.elements.filter(
          (el) => el.x >= columns.date!.min && el.x <= columns.date!.max
        );
        date = dateElements.map((el) => el.text).join(" ").trim();
      }

      // Check if this row contains a valid date
      if (!date || !datePattern.test(date)) continue; // Not a transaction row

      // Extract description
      let description = "";
      if (columns.description) {
        const descElements = row.elements.filter(
          (el) => el.x >= columns.description!.min && el.x <= columns.description!.max
        );
        description = descElements.map((el) => el.text).join(" ").trim();
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

      // STRATEGY 3: Statement has separate DEBIT/CREDIT columns (e.g., Riverside: OUT/IN)
      if (!typeDetected && (columns.debit || columns.credit)) {
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

          // Check if in credit column boundaries
          const isInCreditColumn = columns.credit &&
            amountEl.x >= columns.credit.min &&
            amountEl.x <= columns.credit.max;

          type = isInCreditColumn ? "credit" : "debit";
          typeDetected = true;
          if (debug) console.log(`[DEBUG] Strategy 3 (single amount): x=${amountEl.x}, isInCreditColumn=${isInCreditColumn}, type=${type}`);
        } else if (amountCandidates.length >= 2) {
          const firstAmount = this.parseAmount(amountCandidates[0].text);
          const secondAmount = this.parseAmount(amountCandidates[1].text);

          if (firstAmount > 0) {
            amount = firstAmount;
            type = "debit";
            typeDetected = true;
            if (debug) console.log(`[DEBUG] Strategy 3 (two amounts): using first (debit)=${amount}`);
          } else if (secondAmount > 0) {
            amount = secondAmount;
            type = "credit";
            typeDetected = true;
            if (debug) console.log(`[DEBUG] Strategy 3 (two amounts): using second (credit)=${amount}`);
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
          balance = this.parseAmount(balanceElement.text);
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

    return transactions;
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
   * Parse amount string to number
   */
  private parseAmount(text: string): number {
    const cleaned = text.replace(/[£$€\s,]/g, "").replace(/^[+-]/, "");
    const amount = parseFloat(cleaned);
    return isNaN(amount) ? 0 : amount;
  }
}
