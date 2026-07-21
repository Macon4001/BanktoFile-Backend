import { Transaction } from "../types/index.js";
import { PDFCoordinateExtractor, TextElement } from "./pdfCoordinateExtractor.js";

/**
 * Dedicated coordinate-based parser for Wells Fargo statements
 * (Business/Consumer Checking "Transaction history" table).
 *
 * Like the other US banks, Wells Fargo's PDF text layer is emitted out of visual
 * order, so rows are rebuilt from (x, y) coordinates. The table has six columns:
 *
 *   Date | Check Number | Description | Deposits/Credits | Withdrawals/Debits | Ending daily balance
 *
 * - Dates are M/D (e.g. "2/1", "2/10") — no year.
 * - A row is a credit (Deposits/Credits) OR a debit (Withdrawals/Debits), plus an
 *   optional running balance in the last column.
 * - Descriptions frequently wrap onto a second visual line.
 * - The table opens with a "Beginning Balance" row and closes with a "Totals" row.
 *
 * Each money token is assigned to the credit / debit / balance column by whichever
 * column centre it sits closest to (the three columns are well separated on the page).
 */
export class WellsFargoCoordinateParser {
  private extractor: PDFCoordinateExtractor;

  private readonly TOL = 12; // X tolerance (points) for description boundaries

  private readonly DATE_RE = /^\d{1,2}\/\d{1,2}$/;
  private readonly MONEY_TOKEN_RE = /^\$?-?[\d,]+\.\d{2}$/;
  private readonly MONEY_RE = /[\d,]+\.\d{2}/;

  // Text that repeats as page furniture inside a multi-page table.
  private readonly FURNITURE_RE =
    /Account Number|Page \d+ of|Wells Fargo|Sheet |wellsfargo\.com|Transaction history|IMPORTANT ACCOUNT/i;

  // The two-line column header, which repeats on every page of a multi-page table.
  // Covers both the Business ("Credits"/"Debits") and Everyday ("Additions"/"Subtractions") layouts.
  private readonly HEADER_RE =
    /Ending daily|Deposits\/|Withdrawals\/|Additions|Subtractions|^Date\b|Check\s+Number/i;

  constructor() {
    this.extractor = new PDFCoordinateExtractor();
  }

  /**
   * Quick text-layer check so callers can decide whether to route here.
   */
  isWellsFargoStatement(text: string): boolean {
    const lower = text.toLowerCase();
    return (
      lower.includes("wells fargo") &&
      (lower.includes("transaction history") || lower.includes("statement period activity summary"))
    );
  }

  /**
   * Parse a Wells Fargo statement PDF using coordinate-based extraction.
   * @param buffer PDF file buffer
   * @param parsedText Text from pdf-parse (used only for the detection guard)
   * @param debug Enable verbose logging
   */
  async parseWellsFargoStatement(
    buffer: Buffer,
    parsedText: string,
    debug: boolean = false
  ): Promise<Transaction[]> {
    console.log("\n========== WELLS FARGO COORDINATE PARSER ==========");

    const elements = await this.extractor.extractTextWithCoordinates(buffer);
    console.log(`🏦 [Wells Fargo] Extracted ${elements.length} text elements`);

    const rows = this.groupIntoRowsByPage(elements);

    // Detect columns from the transaction-table header (the two rows around
    // "Ending daily") rather than globally, so the page-1 summary can't interfere.
    const cols = this.detectColumns(rows);
    if (!cols) {
      console.error("⚠️  [Wells Fargo] Could not detect column headers - skipping");
      return [];
    }
    console.log(
      `🏦 [Wells Fargo] Columns: date=${cols.dateX.toFixed(1)} desc=${cols.descX.toFixed(1)} ` +
        `credit=${cols.creditCenter.toFixed(1)} debit=${cols.debitCenter.toFixed(1)} balance=${cols.balanceCenter.toFixed(1)}`
    );

    if (debug) {
      rows.slice(0, 80).forEach((r, i) =>
        console.log(`[Row ${i}] p${r.pageNumber} y=${r.y.toFixed(1)} | ${r.elements.map(e => e.text).join(" | ")}`)
      );
    }

    const transactions: Transaction[] = [];
    let last: Transaction | null = null;
    let inTable = false;

    for (const row of rows) {
      const rowText = row.elements.map(e => e.text).join(" ").replace(/\s+/g, " ").trim();
      if (!rowText) continue;

      // Enter the table at the "Ending daily [balance]" header (unique to the
      // transaction table; the page-1 summary says "Ending balance on ..." instead).
      if (!inTable) {
        if (/Ending daily/i.test(rowText)) inTable = true;
        continue;
      }

      // Totals row closes the table (captured as a summary row).
      if (/^Totals\b/i.test(rowText)) {
        const totalsRow = this.parseTotalsRow(row, cols);
        if (totalsRow) transactions.push(totalsRow);
        break;
      }

      // "Ending balance on ..." duplicates the last running balance — skip it.
      if (/^Ending balance on/i.test(rowText)) continue;

      // Skip the column header (both lines) where it repeats on later pages, and page furniture.
      if (this.HEADER_RE.test(rowText)) continue;
      if (this.FURNITURE_RE.test(rowText)) continue;

      const tx = this.parseTransactionRow(row, cols);
      if (tx) {
        transactions.push(tx);
        last = tx;
      } else {
        this.tryAppendContinuation(row, rowText, cols, last);
      }
    }

    console.log(`✅ [Wells Fargo] Extracted ${transactions.length} rows`);
    console.log("===================================================\n");

    return transactions;
  }

  /**
   * Locate each column from the transaction-table header. The header is two visual
   * lines ("Check / Deposits/ / Withdrawals/ / Ending daily" over "Date / Number /
   * Description / Credits|Additions / Debits|Subtractions / balance"); we union those
   * two rows and read each column's X from them. Preferring the single bottom-row
   * words (Credits/Additions, Debits/Subtractions, balance) keeps the centre X aligned
   * with the right-aligned amounts below.
   */
  private detectColumns(
    rows: Array<{ elements: TextElement[] }>
  ): {
    dateX: number;
    descX: number;
    creditCenter: number;
    debitCenter: number;
    balanceCenter: number;
  } | null {
    const headerIdx = rows.findIndex(r =>
      /Ending daily/i.test(r.elements.map(e => e.text).join(" "))
    );

    if (headerIdx === -1) {
      console.log("[Wells Fargo] Could not find the 'Ending daily' header row");
      return null;
    }

    // Union this header line with the next one (the two-line header).
    const headerEls = [
      ...rows[headerIdx].elements,
      ...(rows[headerIdx + 1]?.elements || []),
    ];

    const findEl = (re: RegExp): TextElement | undefined => headerEls.find(e => re.test(e.text.trim()));
    const centerOf = (el: TextElement): number => el.x + (el.width || 0) / 2;

    const dateEl = findEl(/^Date$/i);
    const descEl = findEl(/^Description$/i);
    const creditEl = findEl(/^Credits$/i) ?? findEl(/^Additions$/i) ?? findEl(/^Deposits\/?$/i);
    const debitEl = findEl(/^Debits$/i) ?? findEl(/^Subtractions$/i) ?? findEl(/^Withdrawals\/?$/i);
    const balanceEl = findEl(/^balance$/i);

    if (!dateEl || !descEl || !creditEl || !debitEl || !balanceEl) {
      console.log("[Wells Fargo] Missing headers:", {
        date: !!dateEl,
        description: !!descEl,
        credit: !!creditEl,
        debit: !!debitEl,
        balance: !!balanceEl,
      });
      return null;
    }

    return {
      dateX: dateEl.x,
      descX: descEl.x,
      creditCenter: centerOf(creditEl),
      debitCenter: centerOf(debitEl),
      balanceCenter: centerOf(balanceEl),
    };
  }

  /**
   * Parse one visual row into a transaction (or a Beginning Balance row).
   */
  private parseTransactionRow(
    row: { elements: TextElement[] },
    cols: NonNullable<ReturnType<WellsFargoCoordinateParser["detectColumns"]>>
  ): Transaction | null {
    const els = row.elements;

    const dateEl = els.find(e => this.DATE_RE.test(e.text));
    // Note: the row's leftmost element is the date, so test with `includes`, not `^`.
    const isBeginningBalance = /Beginning Balance/i.test(els.map(e => e.text).join(" "));
    if (!dateEl && !isBeginningBalance) return null;

    // Bucket each money token into credit / debit / balance by nearest column centre.
    let credit: number | undefined;
    let debit: number | undefined;
    let balance: number | undefined;
    let firstMoneyX = Infinity;

    for (const el of els) {
      if (!this.MONEY_TOKEN_RE.test(el.text)) continue;
      const raw = parseFloat(el.text.replace(/[$,]/g, "")); // keeps sign
      if (!Number.isFinite(raw)) continue;
      firstMoneyX = Math.min(firstMoneyX, el.x);

      const center = el.x + (el.width || 0) / 2;
      const col = this.nearestColumn(center, cols);
      // Credits/debits are always positive; the balance can be negative (overdraft).
      if (col === "credit") credit = Math.abs(raw);
      else if (col === "debit") debit = Math.abs(raw);
      else balance = raw;
    }

    // Description: non-money text from the Description column up to the first amount.
    const description = els
      .filter(e => !this.MONEY_TOKEN_RE.test(e.text) && e.x >= cols.descX - this.TOL && e.x < firstMoneyX)
      .map(e => e.text)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();

    if (isBeginningBalance) {
      return {
        date: dateEl?.text || "",
        description: "Beginning Balance",
        amount: 0,
        balance,
        isOpeningBalance: true,
      };
    }

    // A transaction needs a credit or a debit; a lone balance is skipped.
    if (credit === undefined && debit === undefined) return null;

    const isCredit = credit !== undefined;
    return {
      date: dateEl!.text,
      description: description || (isCredit ? "Deposit" : "Withdrawal"),
      amount: isCredit ? credit! : debit!,
      type: isCredit ? "credit" : "debit",
      balance,
    };
  }

  /**
   * Parse the "Totals $21,678.00 $13,463.97" row into a summary transaction that
   * renders the credit total under Money In and the debit total under Money Out.
   */
  private parseTotalsRow(
    row: { elements: TextElement[] },
    cols: NonNullable<ReturnType<WellsFargoCoordinateParser["detectColumns"]>>
  ): Transaction | null {
    let creditTotal: number | undefined;
    let debitTotal: number | undefined;

    for (const el of row.elements) {
      if (!this.MONEY_TOKEN_RE.test(el.text)) continue;
      const value = Math.abs(parseFloat(el.text.replace(/[$,]/g, "")));
      if (!Number.isFinite(value)) continue;

      const center = el.x + (el.width || 0) / 2;
      const col = this.nearestColumn(center, cols);
      if (col === "credit") creditTotal = value;
      else if (col === "debit") debitTotal = value;
    }

    if (creditTotal === undefined && debitTotal === undefined) return null;

    console.log(`   [Wells Fargo] Totals — credits: ${creditTotal ?? 0}, debits: ${debitTotal ?? 0}`);

    return {
      date: "",
      description: "Totals",
      amount: 0,
      type: "total",
      amountIn: creditTotal,
      amountOut: debitTotal,
      isTotal: true,
    };
  }

  /**
   * Assign a money token (by its centre X) to the nearest of the three money columns.
   */
  private nearestColumn(
    center: number,
    cols: NonNullable<ReturnType<WellsFargoCoordinateParser["detectColumns"]>>
  ): "credit" | "debit" | "balance" {
    const dc = Math.abs(center - cols.creditCenter);
    const dd = Math.abs(center - cols.debitCenter);
    const db = Math.abs(center - cols.balanceCenter);
    if (dc <= dd && dc <= db) return "credit";
    if (dd <= db) return "debit";
    return "balance";
  }

  /**
   * Append a wrapped description line (no date, no amount) to the previous transaction.
   */
  private tryAppendContinuation(
    row: { elements: TextElement[] },
    rowText: string,
    cols: NonNullable<ReturnType<WellsFargoCoordinateParser["detectColumns"]>>,
    last: Transaction | null
  ): void {
    if (!last) return;
    if (this.MONEY_RE.test(rowText)) return;
    if (row.elements.some(e => this.DATE_RE.test(e.text))) return;
    if (this.FURNITURE_RE.test(rowText)) return;

    const cont = row.elements
      .filter(e => e.x >= cols.descX - this.TOL)
      .map(e => e.text)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    if (!cont) return;

    last.description = `${last.description} ${cont}`.replace(/\s+/g, " ").trim();
  }

  /**
   * Group text elements into visual rows, keeping pages separate so identical
   * Y positions on different pages are never merged.
   */
  private groupIntoRowsByPage(
    elements: TextElement[],
    yTolerance: number = 4
  ): Array<{ pageNumber: number; y: number; elements: TextElement[] }> {
    const byPage = new Map<number, TextElement[]>();
    for (const el of elements) {
      if (!el.text) continue;
      const list = byPage.get(el.pageNumber) || [];
      list.push(el);
      byPage.set(el.pageNumber, list);
    }

    const rows: Array<{ pageNumber: number; y: number; elements: TextElement[] }> = [];

    const pages = Array.from(byPage.keys()).sort((a, b) => a - b);
    for (const page of pages) {
      const pageEls = byPage.get(page)!.slice().sort((a, b) => a.y - b.y);
      let bucket: TextElement[] = [];
      let bucketY = Number.NaN;

      const flush = () => {
        if (bucket.length === 0) return;
        rows.push({ pageNumber: page, y: bucketY, elements: bucket.slice().sort((a, b) => a.x - b.x) });
        bucket = [];
      };

      for (const el of pageEls) {
        if (Number.isNaN(bucketY) || Math.abs(el.y - bucketY) <= yTolerance) {
          if (Number.isNaN(bucketY)) bucketY = el.y;
          bucket.push(el);
        } else {
          flush();
          bucketY = el.y;
          bucket.push(el);
        }
      }
      flush();
    }

    return rows;
  }
}

// Export singleton instance
export const wellsFargoCoordinateParser = new WellsFargoCoordinateParser();
