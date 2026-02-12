import { Transaction } from "../types/index.js";
import { PDFCoordinateExtractor, TextElement } from "./pdfCoordinateExtractor.js";

/**
 * Co-op Bank specific coordinate-based PDF parser
 *
 * Co-op Bank PDFs have the following columns:
 * - Date (format: DD MMM YY, e.g., "22 APR 24")
 * - Description (transaction details)
 * - Withdrawals (money out)
 * - Deposits (money in)
 * - Balance
 *
 * Note: Some transactions may have multiple lines (e.g., exchange rate info)
 * but withdrawals/deposits appear on separate rows from their amounts.
 */
export class CoopBankCoordinateParser {
  private extractor: PDFCoordinateExtractor;

  constructor() {
    this.extractor = new PDFCoordinateExtractor();
  }

  /**
   * Parse Co-op Bank statement PDF using coordinate-based extraction
   * @param buffer PDF file buffer
   * @param parsedText Parsed text from pdf-parse (for metadata extraction)
   * @param debug Enable debug logging (default: false)
   * @returns Array of transactions
   */
  async parseCoopBankStatement(
    buffer: Buffer,
    parsedText: string,
    debug: boolean = false
  ): Promise<Transaction[]> {
    console.log("\n========== CO-OP BANK COORDINATE PARSER ==========");

    // Extract all text elements with coordinates
    const elements = await this.extractor.extractTextWithCoordinates(buffer);
    console.log(`Extracted ${elements.length} text elements from PDF`);

    if (debug) {
      this.extractor.debugPrintElements(elements, 50);
    }

    // Detect column boundaries from headers
    const columns = this.detectCoopColumns(elements);

    if (!columns) {
      console.error("⚠️  Failed to detect Co-op Bank column headers");
      throw new Error("Could not detect Co-op Bank table structure");
    }

    console.log("Column boundaries detected:");
    console.log(`  Date: ${columns.date.min.toFixed(1)} - ${columns.date.max.toFixed(1)}`);
    console.log(`  Description: ${columns.description.min.toFixed(1)} - ${columns.description.max.toFixed(1)}`);
    console.log(`  Withdrawals: ${columns.withdrawals.min.toFixed(1)} - ${columns.withdrawals.max.toFixed(1)}`);
    console.log(`  Deposits: ${columns.deposits.min.toFixed(1)} - ${columns.deposits.max.toFixed(1)}`);
    console.log(`  Balance: ${columns.balance.min.toFixed(1)} - ${columns.balance.max.toFixed(1)}`);

    // Extract transactions using coordinates
    const transactions = this.extractTransactions(elements, columns, debug);

    console.log(`✓ Extracted ${transactions.length} Co-op Bank transactions using coordinates`);
    console.log("=================================================\n");

    return transactions;
  }

  /**
   * Detect Co-op Bank column positions by finding headers
   * Headers: "Date", "Description", "Withdrawals", "Deposits", "Balance"
   */
  private detectCoopColumns(elements: TextElement[]): {
    date: { min: number; max: number };
    description: { min: number; max: number };
    withdrawals: { min: number; max: number };
    deposits: { min: number; max: number };
    balance: { min: number; max: number };
  } | null {
    // Find column headers by text content
    let dateHeader: TextElement | undefined;
    let descHeader: TextElement | undefined;
    let withdrawalsHeader: TextElement | undefined;
    let depositsHeader: TextElement | undefined;
    let balanceHeader: TextElement | undefined;

    for (const el of elements) {
      const text = el.text.trim();

      if (text === "Date") {
        dateHeader = el;
      } else if (text === "Description") {
        descHeader = el;
      } else if (text === "Withdrawals") {
        withdrawalsHeader = el;
      } else if (text === "Deposits") {
        depositsHeader = el;
      } else if (text === "Balance") {
        balanceHeader = el;
      }
    }

    // Check if all headers were found
    if (!dateHeader || !descHeader || !withdrawalsHeader || !depositsHeader || !balanceHeader) {
      console.error("⚠️  Could not find all required column headers");
      console.log("Found headers:", {
        date: !!dateHeader,
        description: !!descHeader,
        withdrawals: !!withdrawalsHeader,
        deposits: !!depositsHeader,
        balance: !!balanceHeader,
      });
      return null;
    }

    // Define column boundaries with some margin
    // Each column starts at header X and extends until next header X
    const columnMargin = 5;

    return {
      date: {
        min: dateHeader.x - columnMargin,
        max: descHeader.x - columnMargin,
      },
      description: {
        min: descHeader.x - columnMargin,
        max: withdrawalsHeader.x - columnMargin,
      },
      withdrawals: {
        min: withdrawalsHeader.x - columnMargin,
        max: depositsHeader.x - columnMargin,
      },
      deposits: {
        min: depositsHeader.x - columnMargin,
        max: balanceHeader.x - columnMargin,
      },
      balance: {
        min: balanceHeader.x - columnMargin,
        max: balanceHeader.x + 100, // Assume balance column extends 100px to the right
      },
    };
  }

  /**
   * Extract transactions from text elements using column positions
   */
  private extractTransactions(
    elements: TextElement[],
    columns: ReturnType<typeof this.detectCoopColumns>,
    debug: boolean
  ): Transaction[] {
    if (!columns) return [];

    const transactions: Transaction[] = [];

    // Group elements by Y position (rows) and page
    const rows = this.groupByRows(elements);
    console.log(`Grouped into ${rows.length} rows`);

    if (debug) {
      console.log('\n[DEBUG] First 5 rows:');
      rows.slice(0, 5).forEach((row, idx) => {
        console.log(`  Row ${idx}: ${row.length} elements`);
        row.forEach((el, i) => {
          console.log(`    [${i}] X=${el.x.toFixed(1)}, Y=${el.y.toFixed(1)}, text="${el.text}"`);
        });
      });
      console.log('');
    }

    // Track which row indices have been processed to avoid duplicates
    const processedRows = new Set<number>();

    // Date pattern for Co-op Bank: "DD MMM YY" (e.g., "22 APR 24")
    // Support both spaced and non-spaced formats from PDF extraction
    const datePattern = /^\d{1,2}\s*[A-Z]{3}\s*\d{2}$/;

    // First pass: identify transaction start rows (rows with dates)
    const transactionStartIndices: number[] = [];

    rows.forEach((row, idx) => {
      const dateElements = row.filter(el => this.inColumn(el, columns.date));
      // Join and trim to remove leading/trailing spaces, then normalize internal spaces
      const dateText = dateElements
        .map(el => el.text.trim())
        .filter(text => text.length > 0) // Remove empty strings
        .join(" ")
        .trim();

      if (debug && idx < 20) {
        console.log(`  Row ${idx}:`);
        console.log(`    Elements in date column: ${dateElements.length}`);
        dateElements.forEach((el, i) => {
          console.log(`      [${i}] X=${el.x.toFixed(1)}, text="${el.text}"`);
        });
        console.log(`    Combined date text: "${dateText}"`);
        console.log(`    Matches pattern: ${datePattern.test(dateText)}`);
      }

      if (datePattern.test(dateText)) {
        transactionStartIndices.push(idx);
      }
    });

    console.log(`Found ${transactionStartIndices.length} transaction rows with dates`);

    // Second pass: extract each transaction (may span multiple rows)
    for (let i = 0; i < transactionStartIndices.length; i++) {
      const startIdx = transactionStartIndices[i];
      const nextStartIdx = i + 1 < transactionStartIndices.length
        ? transactionStartIndices[i + 1]
        : rows.length;

      // Process this transaction and all its continuation rows
      const transaction = this.parseTransactionRows(
        rows,
        startIdx,
        nextStartIdx,
        columns,
        debug
      );

      if (transaction) {
        transactions.push(transaction);

        // Mark all rows as processed
        for (let j = startIdx; j < nextStartIdx; j++) {
          processedRows.add(j);
        }
      }
    }

    return this.sortTransactionsByDate(transactions);
  }

  /**
   * Parse a transaction that may span multiple rows
   * @param rows All rows
   * @param startIdx Index of the row with the date
   * @param endIdx Index of the next transaction (or end of rows)
   * @param columns Column definitions
   * @param debug Debug mode
   */
  private parseTransactionRows(
    rows: TextElement[][],
    startIdx: number,
    endIdx: number,
    columns: ReturnType<typeof this.detectCoopColumns>,
    debug: boolean
  ): Transaction | null {
    if (!columns) return null;

    // Extract date from first row
    const dateRow = rows[startIdx];
    const dateElements = dateRow.filter(el => this.inColumn(el, columns.date));
    const dateText = dateElements
      .map(el => el.text.trim())
      .filter(text => text.length > 0) // Remove empty strings
      .join(" ")
      .trim();

    if (!dateText) return null;

    // Parse date to standard format
    const date = this.parseCoopDate(dateText);
    if (!date) {
      if (debug) {
        console.log(`  ⚠️  Could not parse date: "${dateText}"`);
      }
      return null;
    }

    // Collect description from all rows in this transaction
    let description = "";
    let withdrawal: number | undefined;
    let deposit: number | undefined;
    let balance: number | undefined;
    let isBroughtForward = false;

    for (let i = startIdx; i < endIdx; i++) {
      const row = rows[i];

      // Extract description elements
      const descElements = row.filter(el => this.inColumn(el, columns.description));
      const descText = descElements.map(el => el.text.trim()).join(" ");

      // Check if this is a BROUGHT FORWARD transaction
      if (descText && descText.includes("BROUGHT FORWARD")) {
        description = "BROUGHT FORWARD";
        isBroughtForward = true;
      } else if (descText && !isBroughtForward) {
        // Only add to description if not BROUGHT FORWARD
        if (description) {
          description += " " + descText;
        } else {
          description = descText;
        }
      }

      // Extract withdrawal amount (only take the first valid one)
      if (withdrawal === undefined) {
        const withdrawalElements = row.filter(el => this.inColumn(el, columns.withdrawals));
        const withdrawalText = withdrawalElements.map(el => el.text.trim()).join("");
        if (withdrawalText && /^[\d,]+\.\d{2}$/.test(withdrawalText)) {
          withdrawal = parseFloat(withdrawalText.replace(/,/g, ""));
        }
      }

      // Extract deposit amount (only take the first valid one)
      if (deposit === undefined) {
        const depositElements = row.filter(el => this.inColumn(el, columns.deposits));
        const depositText = depositElements.map(el => el.text.trim()).join("");
        if (depositText && /^[\d,]+\.\d{2}$/.test(depositText)) {
          deposit = parseFloat(depositText.replace(/,/g, ""));
        }
      }

      // Extract balance (prefer the last valid balance in the transaction)
      const balanceElements = row.filter(el => this.inColumn(el, columns.balance));
      const balanceText = balanceElements.map(el => el.text.trim()).join("");
      if (balanceText && /^[\d,]+\.\d{2}$/.test(balanceText)) {
        balance = parseFloat(balanceText.replace(/,/g, ""));
      }
    }

    // Skip if no valid description
    if (!description.trim()) {
      return null;
    }

    // Determine amount and type
    let amount = 0;
    let type: string = "debit";

    if (isBroughtForward) {
      // BROUGHT FORWARD has no amount, just a balance
      // Use the specific brought_forward type
      amount = 0;
      type = "brought_forward";
    } else if (withdrawal !== undefined && withdrawal > 0) {
      amount = withdrawal;
      type = "debit";
    } else if (deposit !== undefined && deposit > 0) {
      amount = deposit;
      type = "credit";
    }

    if (debug) {
      console.log(`  ✓ Parsed: ${date} | ${description.substring(0, 40)}... | ${type} £${amount} | Balance: £${balance}`);
    }

    return {
      date,
      description: description.trim(),
      amount,
      balance,
      type,
    };
  }

  /**
   * Parse Co-op Bank date format: "DD MMM YY" to "DD MMM 20YY"
   * Example: "22 APR 24" -> "22 APR 2024"
   * Handles both spaced and non-spaced formats
   */
  private parseCoopDate(dateText: string): string | null {
    // Try to match date with optional spaces
    const match = dateText.match(/^(\d{1,2})\s*([A-Z]{3})\s*(\d{2})$/);

    if (!match) return null;

    const day = match[1].padStart(2, "0");
    const month = match[2].toUpperCase();
    const year = "20" + match[3]; // Convert 2-digit year to 4-digit

    return `${day} ${month} ${year}`;
  }

  /**
   * Group text elements into rows based on Y position and page
   */
  private groupByRows(elements: TextElement[]): TextElement[][] {
    const rows: Map<string, TextElement[]> = new Map();
    const Y_THRESHOLD = 3; // Elements within 3 units are same row

    for (const el of elements) {
      // Create a key combining page and approximate Y position
      const pageKey = el.pageNumber;

      let foundRow = false;

      for (const [key, row] of rows.entries()) {
        const [existingPage, existingY] = key.split(":");
        const rowPage = parseInt(existingPage);
        const rowY = parseFloat(existingY);

        // Must be on same page and within Y threshold
        if (rowPage === pageKey && Math.abs(el.y - rowY) < Y_THRESHOLD) {
          row.push(el);
          foundRow = true;
          break;
        }
      }

      if (!foundRow) {
        const rowKey = `${pageKey}:${el.y}`;
        rows.set(rowKey, [el]);
      }
    }

    // Sort rows by page number, then Y position (top to bottom)
    return Array.from(rows.entries())
      .sort((a, b) => {
        const [pageA, yA] = a[0].split(":");
        const [pageB, yB] = b[0].split(":");

        // Compare pages first
        const pageDiff = parseInt(pageA) - parseInt(pageB);
        if (pageDiff !== 0) return pageDiff;

        // Then compare Y positions
        return parseFloat(yA) - parseFloat(yB);
      })
      .map(([_, row]) => row);
  }

  /**
   * Check if element is within a column's X boundaries
   */
  private inColumn(
    el: TextElement,
    column: { min: number; max: number }
  ): boolean {
    return el.x >= column.min && el.x <= column.max;
  }

  /**
   * Sort transactions by date in chronological order
   */
  private sortTransactionsByDate(transactions: Transaction[]): Transaction[] {
    return transactions.sort((a, b) => {
      const dateA = this.parseCoopDateToTimestamp(a.date);
      const dateB = this.parseCoopDateToTimestamp(b.date);
      return dateA - dateB;
    });
  }

  /**
   * Parse Co-op date to timestamp for sorting
   * Format: "DD MMM YYYY"
   */
  private parseCoopDateToTimestamp(dateStr: string): number {
    const months: Record<string, number> = {
      JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5,
      JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11,
    };

    const parts = dateStr.trim().split(/\s+/);
    if (parts.length !== 3) return 0;

    const day = parseInt(parts[0], 10);
    const monthStr = parts[1].toUpperCase();
    const year = parseInt(parts[2], 10);

    const month = months[monthStr];
    if (month === undefined) return 0;

    return new Date(year, month, day).getTime();
  }
}
