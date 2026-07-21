import { Transaction } from "../types/index.js";
import { PDFCoordinateExtractor, TextElement } from "./pdfCoordinateExtractor.js";

/**
 * Dedicated coordinate-based parser for Bank of America statements.
 *
 * Like Chase, BoA's PDF text layer is emitted out of visual order, so rows are
 * rebuilt from (x, y) coordinates. Unlike Chase, BoA uses a single transaction
 * table with the following columns:
 *
 *   Merchant Name | Posted Date | Reference Number | Transaction Details | Credit | Debit
 *
 * - Dates are MM/DD/YYYY and sit in the middle of the row (not the start).
 * - Credits are positive ("$ 100.00"); debits are negative ("$ -10.77").
 * - Merchant / detail cells can wrap onto a second visual line.
 *
 * The table lives between the "Account Transaction Activity" heading and the
 * "Totals" row (followed by "Summary of Fees").
 */
export class BankOfAmericaCoordinateParser {
  private extractor: PDFCoordinateExtractor;

  private readonly TOL = 12; // X tolerance (points) when assigning elements to columns

  // Header/footer text that repeats inside the table and must never be treated
  // as a transaction or a wrapped continuation line.
  private readonly FURNITURE_RE =
    /Merchant Name|Posted|Reference|Transaction Details|^Credit$|^Debit$|Bank of America|Page \d|Customer Service|Summary of|Statement for|Period (Start|End)|Previous Balance|New Balance|^Totals\b|www\.|PRIVACY/i;

  private readonly DATE_RE = /^\d{2}\/\d{2}\/\d{4}$/;
  private readonly MONEY_RE = /-?\$?\s*-?[\d,]+\.\d{2}/;

  constructor() {
    this.extractor = new PDFCoordinateExtractor();
  }

  /**
   * Quick text-layer check so callers can decide whether to route here.
   */
  isBankOfAmericaStatement(text: string): boolean {
    const lower = text.toLowerCase();
    return (
      lower.includes("bank of america") &&
      (lower.includes("account transaction activity") || lower.includes("summary of transactions"))
    );
  }

  /**
   * Parse a Bank of America statement PDF using coordinate-based extraction.
   * @param buffer PDF file buffer
   * @param parsedText Text from pdf-parse (used only for the detection guard)
   * @param debug Enable verbose logging
   */
  async parseBankOfAmericaStatement(
    buffer: Buffer,
    parsedText: string,
    debug: boolean = false
  ): Promise<Transaction[]> {
    console.log("\n========== BANK OF AMERICA COORDINATE PARSER ==========");

    const elements = await this.extractor.extractTextWithCoordinates(buffer);
    console.log(`🏦 [BoA] Extracted ${elements.length} text elements`);

    const columns = this.detectColumns(elements);
    if (!columns) {
      console.error("⚠️  [BoA] Could not detect column headers - skipping");
      return [];
    }
    console.log(
      `🏦 [BoA] Columns: merchant=${columns.merchant.toFixed(1)} posted=${columns.posted.toFixed(1)} ` +
        `reference=${columns.reference.toFixed(1)} details=${columns.details.toFixed(1)} ` +
        `credit=${columns.credit.toFixed(1)} debit=${columns.debit.toFixed(1)}`
    );

    const rows = this.groupIntoRowsByPage(elements);

    if (debug) {
      rows.slice(0, 60).forEach((r, i) =>
        console.log(`[Row ${i}] p${r.pageNumber} y=${r.y.toFixed(1)} | ${r.elements.map(e => e.text).join(" | ")}`)
      );
    }

    const transactions: Transaction[] = [];
    // Track the last transaction's merchant/details so wrapped lines rebuild cleanly.
    let last: { tx: Transaction; merchant: string; details: string } | null = null;
    let inTable = false;

    for (const row of rows) {
      const rowText = row.elements.map(e => e.text).join(" ").replace(/\s+/g, " ").trim();
      if (!rowText) continue;

      // Enter the table at the header row; exit at the totals/fees.
      if (!inTable) {
        if (/Merchant Name/i.test(rowText) && /(Credit|Debit)/i.test(rowText)) {
          inTable = true;
        }
        continue;
      }
      if (/^Totals\b/i.test(rowText)) {
        const totalsRow = this.parseTotalsRow(row, columns);
        if (totalsRow) transactions.push(totalsRow);
        break;
      }
      if (/Summary of Fees/i.test(rowText)) {
        break;
      }

      const parsed = this.parseTransactionRow(row, columns);
      if (parsed) {
        transactions.push(parsed.tx);
        last = parsed;
      } else {
        this.tryAppendContinuation(row, rowText, columns, last);
      }
    }

    console.log(`✅ [BoA] Extracted ${transactions.length} transactions`);
    console.log("=======================================================\n");

    return transactions;
  }

  /**
   * Locate each column's left X by finding its header element.
   */
  private detectColumns(elements: TextElement[]): {
    merchant: number;
    posted: number;
    reference: number;
    details: number;
    credit: number;
    debit: number;
  } | null {
    const find = (re: RegExp): number | undefined => elements.find(e => re.test(e.text.trim()))?.x;

    const merchant = find(/^Merchant/i);
    const posted = find(/^Posted$/i) ?? find(/^Date$/i);
    const reference = find(/^Reference$/i) ?? find(/^Number$/i);
    const details = find(/Transaction Details/i) ?? find(/^Transaction$/i);
    const credit = find(/^Credit$/i);
    const debit = find(/^Debit$/i);

    if (
      merchant === undefined ||
      posted === undefined ||
      reference === undefined ||
      details === undefined ||
      credit === undefined ||
      debit === undefined
    ) {
      console.log("[BoA] Missing headers:", { merchant, posted, reference, details, credit, debit });
      return null;
    }

    return { merchant, posted, reference, details, credit, debit };
  }

  /**
   * Parse one visual row into a transaction. A transaction row has a MM/DD/YYYY
   * date in the Posted Date column and a money value in the Credit/Debit columns.
   */
  private parseTransactionRow(
    row: { elements: TextElement[] },
    cols: ReturnType<BankOfAmericaCoordinateParser["detectColumns"]>
  ): { tx: Transaction; merchant: string; details: string } | null {
    if (!cols) return null;
    const els = row.elements;

    const dateEl = els.find(e => this.DATE_RE.test(e.text));
    if (!dateEl) return null;

    // Amount comes from the Credit/Debit columns (right of Details). Debits carry a
    // minus sign, credits don't — which is exactly BoA's own column split.
    const amountText = els
      .filter(e => e.x >= cols.credit - 25)
      .map(e => e.text)
      .join(" ");
    const moneyMatch = amountText.match(/(-?)\s*\$?\s*(-?)([\d,]+\.\d{2})/);
    if (!moneyMatch) return null;

    const isDebit = amountText.includes("-");
    const amount = parseFloat(moneyMatch[3].replace(/,/g, ""));
    if (!Number.isFinite(amount)) return null;

    const merchant = this.textInRange(els, -Infinity, cols.posted - this.TOL);
    const details = this.textInRange(els, cols.details - this.TOL, cols.credit - this.TOL);

    const tx: Transaction = {
      date: dateEl.text,
      description: this.buildDescription(merchant, details),
      amount: Math.abs(amount),
      type: isDebit ? "debit" : "credit",
      // BoA statements carry no running balance per transaction.
    };

    return { tx, merchant, details };
  }

  /**
   * Append a wrapped merchant/detail line (no date, no amount) to the previous
   * transaction, routing the text into the correct column so it reads cleanly.
   */
  private tryAppendContinuation(
    row: { elements: TextElement[] },
    rowText: string,
    cols: ReturnType<BankOfAmericaCoordinateParser["detectColumns"]>,
    last: { tx: Transaction; merchant: string; details: string } | null
  ): void {
    if (!last || !cols) return;
    if (this.FURNITURE_RE.test(rowText)) return;
    if (this.MONEY_RE.test(rowText)) return;
    if (row.elements.some(e => this.DATE_RE.test(e.text))) return;

    const contMerchant = this.textInRange(row.elements, -Infinity, cols.posted - this.TOL);
    const contDetails = this.textInRange(row.elements, cols.details - this.TOL, cols.credit - this.TOL);

    if (contMerchant) last.merchant = `${last.merchant} ${contMerchant}`.trim();
    if (contDetails) last.details = `${last.details} ${contDetails}`.trim();
    if (!contMerchant && !contDetails) last.merchant = `${last.merchant} ${rowText}`.trim();

    last.tx.description = this.buildDescription(last.merchant, last.details);
  }

  /**
   * Parse the "Totals $ 730.00 $ -737.23" row into a summary transaction that
   * renders the credit total under Money In and the debit total under Money Out.
   * The credit/debit totals are told apart by which column (X) they sit in.
   */
  private parseTotalsRow(
    row: { elements: TextElement[] },
    cols: ReturnType<BankOfAmericaCoordinateParser["detectColumns"]>
  ): Transaction | null {
    if (!cols) return null;
    const mid = (cols.credit + cols.debit) / 2;

    let creditTotal: number | undefined;
    let debitTotal: number | undefined;

    for (const el of row.elements) {
      const m = el.text.match(/-?[\d,]+\.\d{2}/);
      if (!m) continue;
      const val = Math.abs(parseFloat(m[0].replace(/,/g, "")));
      if (!Number.isFinite(val)) continue;
      if (el.x < mid) creditTotal = val;
      else debitTotal = val;
    }

    if (creditTotal === undefined && debitTotal === undefined) return null;

    console.log(`   [BoA] Totals — credits: ${creditTotal ?? 0}, debits: ${debitTotal ?? 0}`);

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

  private buildDescription(merchant: string, details: string): string {
    const m = merchant.replace(/\s+/g, " ").trim();
    const d = details.replace(/\s+/g, " ").trim();
    if (m && d) return `${m} - ${d}`;
    return m || d || "Transaction";
  }

  /**
   * Join the text of elements whose X falls within [min, max).
   */
  private textInRange(els: TextElement[], min: number, max: number): string {
    return els
      .filter(e => e.x >= min && e.x < max)
      .map(e => e.text)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
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
export const bankOfAmericaCoordinateParser = new BankOfAmericaCoordinateParser();
