import { Transaction } from "../types/index.js";
import { PDFCoordinateExtractor, TextElement } from "./pdfCoordinateExtractor.js";

/**
 * Mettle (NatWest) specific coordinate-based PDF parser
 *
 * Mettle bank statements (provided by National Westminster Bank plc trading as Mettle)
 * have the following columns:
 * - DATE (format: DD MMM YYYY, e.g., "01 Jan 2026")
 * - DESCRIPTION (transaction details — words are often duplicated in the PDF stream)
 * - £ IN (money in / credit)
 * - £ OUT (money out / debit)
 * - £ BALANCE (running balance)
 *
 * Column X boundaries (PDF points, page width ~595):
 *   date:        33 –  96
 *   description: 96 – 350
 *   amountIn:   350 – 444
 *   amountOut:  444 – 501
 *   balance:    501 – 578
 *
 * Known quirks:
 *  - Description text elements are duplicated in the PDF stream (same word appears twice
 *    at the same or very similar X/Y). We deduplicate by normalising adjacent repeated words.
 *  - Some rows span a date that also matches the header row — skip header rows.
 *  - Page footer / legal boilerplate must be ignored (identified by being below the last
 *    transaction area or containing known footer strings).
 */
export class MettleNatwestCoordinateParser {
  private extractor: PDFCoordinateExtractor;

  // Column boundaries in PDF points (derived from the coordinate log in the statement sample)
  private static readonly COLUMNS = {
    date:        { min: 28,  max: 98  },
    description: { min: 98,  max: 355 },
    amountIn:    { min: 355, max: 445 },
    amountOut:   { min: 445, max: 505 },
    balance:     { min: 505, max: 585 },
  };

  // Y-threshold for grouping elements into the same row (PDF points)
  private static readonly ROW_Y_THRESHOLD = 4;

  // Strings that indicate a row belongs to the page footer / boilerplate
  private static readonly FOOTER_STRINGS = [
    "The Mettle bank account is provided",
    "National Westminster Bank plc",
    "Prudential Regulation Authority",
    "Financial Conduct Authority",
    "Financial Services Compensation Scheme",
    "www.mettle.co.uk",
    "www.fscs.org.uk",
    "firm reference number",
    "registered address is",
  ];

  // Column header texts to skip
  private static readonly HEADER_STRINGS = new Set([
    "DATE", "DESCRIPTION", "£ IN", "£ OUT", "£ BALANCE", "IN", "OUT", "BALANCE",
  ]);

  constructor() {
    this.extractor = new PDFCoordinateExtractor();
  }

  /**
   * Parse a Mettle (NatWest) statement PDF using coordinate-based extraction.
   * @param buffer  PDF file buffer
   * @param parsedText  Raw text from pdf-parse (used for metadata only)
   * @param debug   Enable verbose debug logging (default: false)
   */
  async parseMettleStatement(
    buffer: Buffer,
    parsedText: string,
    debug: boolean = false
  ): Promise<Transaction[]> {
    console.log("\n========== METTLE (NATWEST) COORDINATE PARSER ==========");

    const elements = await this.extractor.extractTextWithCoordinates(buffer);
    console.log(`Extracted ${elements.length} text elements from PDF`);

    if (debug) {
      this.extractor.debugPrintElements(elements, 60);
    }

    // Group all elements into rows across all pages
    const rows = this.groupByRows(elements);
    console.log(`Grouped into ${rows.length} rows`);

    // Extract transactions from rows
    const transactions = this.extractTransactions(rows, debug);

    console.log(`✓ Extracted ${transactions.length} Mettle transactions using coordinates`);
    console.log("=========================================================\n");

    return transactions;
  }

  // ---------------------------------------------------------------------------
  // Row grouping
  // ---------------------------------------------------------------------------

  /**
   * Group text elements into rows by (pageNumber, Y-coordinate) proximity.
   * Elements on different pages are never merged.
   * Rows are returned sorted page-first, then top-to-bottom within each page.
   */
  private groupByRows(elements: TextElement[]): TextElement[][] {
    const rowMap = new Map<string, TextElement[]>();

    for (const el of elements) {
      const page = el.pageNumber;
      let placed = false;

      for (const [key, row] of rowMap.entries()) {
        const [kPage, kY] = key.split(":").map(Number);
        if (kPage === page && Math.abs(el.y - kY) < MettleNatwestCoordinateParser.ROW_Y_THRESHOLD) {
          row.push(el);
          placed = true;
          break;
        }
      }

      if (!placed) {
        rowMap.set(`${page}:${el.y}`, [el]);
      }
    }

    // Sort rows: page ascending, then Y ascending (top to bottom)
    return Array.from(rowMap.entries())
      .sort((a, b) => {
        const [pageA, yA] = a[0].split(":").map(Number);
        const [pageB, yB] = b[0].split(":").map(Number);
        return pageA !== pageB ? pageA - pageB : yA - yB;
      })
      .map(([, row]) => row);
  }

  // ---------------------------------------------------------------------------
  // Transaction extraction
  // ---------------------------------------------------------------------------

  private extractTransactions(rows: TextElement[][], debug: boolean): Transaction[] {
    const COLS = MettleNatwestCoordinateParser.COLUMNS;
    const transactions: Transaction[] = [];

    // Date pattern: "DD MMM YYYY" (e.g., "01 Jan 2026")
    const datePattern = /^\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{4}$/i;

    // Identify rows that start a transaction (contain a valid date in the date column)
    const transactionStartIndices: number[] = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const dateText = this.extractColumnText(row, COLS.date);

      if (datePattern.test(dateText.trim())) {
        transactionStartIndices.push(i);
      }
    }

    console.log(`Found ${transactionStartIndices.length} rows with dates`);

    // Extract each transaction (may span multiple rows until the next date row)
    for (let ti = 0; ti < transactionStartIndices.length; ti++) {
      const startIdx = transactionStartIndices[ti];
      const endIdx = ti + 1 < transactionStartIndices.length
        ? transactionStartIndices[ti + 1]
        : rows.length;

      const transaction = this.parseTransactionRows(rows, startIdx, endIdx, debug);
      if (transaction) {
        transactions.push(transaction);
      }
    }

    return this.sortTransactionsByDate(transactions);
  }

  // ---------------------------------------------------------------------------
  // Row parsing
  // ---------------------------------------------------------------------------

  private parseTransactionRows(
    rows: TextElement[][],
    startIdx: number,
    endIdx: number,
    debug: boolean
  ): Transaction | null {
    const COLS = MettleNatwestCoordinateParser.COLUMNS;

    // --- Date ---
    const dateText = this.extractColumnText(rows[startIdx], COLS.date).trim();
    const date = this.parseMettleDate(dateText);
    if (!date) {
      if (debug) console.log(`  ⚠️  Could not parse date: "${dateText}"`);
      return null;
    }

    // --- Collect values across all rows in this transaction ---
    const descriptionParts: string[] = [];
    let amountIn: number | undefined;
    let amountOut: number | undefined;
    let balance: number | undefined;

    for (let i = startIdx; i < endIdx; i++) {
      const row = rows[i];

      // Skip footer rows
      if (this.isFooterRow(row)) continue;

      // Description
      const rawDesc = this.extractColumnText(row, COLS.description);
      if (rawDesc.trim()) {
        descriptionParts.push(rawDesc.trim());
      }

      // Amount In (credit)
      if (amountIn === undefined) {
        const inText = this.extractColumnText(row, COLS.amountIn).trim();
        const parsed = this.parseAmount(inText);
        if (parsed !== undefined) amountIn = parsed;
      }

      // Amount Out (debit)
      if (amountOut === undefined) {
        const outText = this.extractColumnText(row, COLS.amountOut).trim();
        const parsed = this.parseAmount(outText);
        if (parsed !== undefined) amountOut = parsed;
      }

      // Balance (prefer last value seen)
      const balText = this.extractColumnText(row, COLS.balance).trim();
      const parsedBal = this.parseAmount(balText);
      if (parsedBal !== undefined) balance = parsedBal;
    }

    // --- Build description ---
    // Join all parts, then deduplicate repeated consecutive words/phrases
    const rawDescription = descriptionParts.join(" ");
    const description = this.deduplicateDescription(rawDescription);

    if (!description) return null;

    // --- Determine type and amount ---
    let type: string;
    let amount: number;

    if (amountIn !== undefined && amountIn > 0 && (amountOut === undefined || amountOut === 0)) {
      type = "credit";
      amount = amountIn;
    } else if (amountOut !== undefined && amountOut > 0) {
      type = "debit";
      amount = amountOut;
    } else if (amountIn !== undefined && amountIn > 0) {
      // Both set — shouldn't happen often, but treat as credit
      type = "credit";
      amount = amountIn;
    } else {
      // No amount found — skip
      if (debug) console.log(`  ⚠️  No amount found for: "${description}" on ${date}`);
      return null;
    }

    if (debug) {
      console.log(`  ✓ ${date} | ${type} | £${amount} | bal £${balance} | ${description.substring(0, 60)}`);
    }

    return {
      date,
      description,
      amount,
      balance,
      type,
    };
  }

  // ---------------------------------------------------------------------------
  // Column text extraction
  // ---------------------------------------------------------------------------

  /**
   * Extract all text within a column boundary from a single row, joined by spaces.
   * Elements are sorted left-to-right before joining.
   */
  private extractColumnText(
    row: TextElement[],
    column: { min: number; max: number }
  ): string {
    return row
      .filter(el => el.x >= column.min && el.x <= column.max)
      .sort((a, b) => a.x - b.x)
      .map(el => el.text.trim())
      .filter(t => t.length > 0)
      .join(" ");
  }

  // ---------------------------------------------------------------------------
  // Description deduplication
  // ---------------------------------------------------------------------------

  /**
   * Mettle PDFs duplicate description text (the same words appear twice in the PDF
   * stream at nearly identical coordinates). This method removes those duplicates.
   *
   * Strategy: split into tokens and remove any token (or run of tokens) that is an
   * immediate repeat of the previous token(s).
   *
   * Examples:
   *   "Wickes Card purchase Card purchase" → "Wickes Card purchase"
   *   "Wagess Dean Clancey Clancey Bank transfer Bank transfer" → "Wagess Dean Clancey Bank transfer"
   *   "Transfer from Tax. Internal transfer in" → "Transfer from Tax. Internal transfer in"  (no dup)
   */
  private deduplicateDescription(raw: string): string {
    if (!raw) return "";

    // Skip known header strings
    if (MettleNatwestCoordinateParser.HEADER_STRINGS.has(raw.trim())) return "";

    const tokens = raw.trim().split(/\s+/);
    if (tokens.length === 0) return "";

    const deduped: string[] = [];

    let i = 0;
    while (i < tokens.length) {
      // Try to match a run of length N starting at i with the same run starting at i+N
      let matched = false;

      // Try runs from longest to shortest to prefer larger deduplication
      const maxRunLen = Math.floor((tokens.length - i) / 2);
      for (let runLen = maxRunLen; runLen >= 1; runLen--) {
        const run = tokens.slice(i, i + runLen);
        const nextRun = tokens.slice(i + runLen, i + runLen * 2);

        if (
          nextRun.length === runLen &&
          run.every((t, idx) => t.toLowerCase() === nextRun[idx].toLowerCase())
        ) {
          // Duplicate run found — keep only the first occurrence
          deduped.push(...run);
          i += runLen * 2;
          matched = true;
          break;
        }
      }

      if (!matched) {
        deduped.push(tokens[i]);
        i++;
      }
    }

    return deduped.join(" ").trim();
  }

  // ---------------------------------------------------------------------------
  // Footer detection
  // ---------------------------------------------------------------------------

  private isFooterRow(row: TextElement[]): boolean {
    const rowText = row.map(el => el.text).join(" ");
    return MettleNatwestCoordinateParser.FOOTER_STRINGS.some(footer =>
      rowText.includes(footer)
    );
  }

  // ---------------------------------------------------------------------------
  // Parsing helpers
  // ---------------------------------------------------------------------------

  /**
   * Parse Mettle date format: "DD MMM YYYY" (e.g. "01 Jan 2026")
   * Returns the date string normalised to "DD MMM YYYY" (zero-padded day, title-case month).
   */
  private parseMettleDate(dateText: string): string | null {
    const match = dateText.match(
      /^(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{4})$/i
    );
    if (!match) return null;

    const day = match[1].padStart(2, "0");
    const month = match[2].charAt(0).toUpperCase() + match[2].slice(1).toLowerCase();
    const year = match[3];

    return `${day} ${month} ${year}`;
  }

  /**
   * Parse a monetary amount string like "1,234.56" or "75.59".
   * Returns undefined if the string is not a valid amount.
   */
  private parseAmount(text: string): number | undefined {
    if (!text) return undefined;
    const cleaned = text.replace(/,/g, "").trim();
    if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return undefined;
    const value = parseFloat(cleaned);
    return isNaN(value) ? undefined : value;
  }

  // ---------------------------------------------------------------------------
  // Sorting
  // ---------------------------------------------------------------------------

  private sortTransactionsByDate(transactions: Transaction[]): Transaction[] {
    const MONTHS: Record<string, number> = {
      Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
      Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
    };

    return transactions.sort((a, b) => {
      const tsA = this.dateToTimestamp(a.date, MONTHS);
      const tsB = this.dateToTimestamp(b.date, MONTHS);
      return tsA - tsB;
    });
  }

  private dateToTimestamp(dateStr: string, months: Record<string, number>): number {
    const parts = dateStr.trim().split(/\s+/);
    if (parts.length !== 3) return 0;
    const day = parseInt(parts[0], 10);
    const month = months[parts[1]];
    const year = parseInt(parts[2], 10);
    if (month === undefined) return 0;
    return new Date(year, month, day).getTime();
  }
}
