import { Transaction } from "../types/index.js";
import { PDFCoordinateExtractor, TextElement } from "./pdfCoordinateExtractor.js";

/**
 * Dedicated coordinate-based parser for Citibank statements
 * (Checking Activity table).
 *
 * Like the other US banks, Citibank's PDF text layer is emitted out of visual
 * order, so rows are rebuilt from (x, y) coordinates. The table has columns:
 *
 *   Date | Description | Amount Subtracted | Amount Added | Balance
 *
 * - "Amount Subtracted" is money out (debit); "Amount Added" is money in (credit).
 * - Dates are MM/DD; each row carries a running balance in the last column.
 * - Descriptions frequently wrap onto extra lines (address, category, times).
 * - A "Beginning Balance:" is shown above the table; a "Total Subtracted/Added"
 *   row closes it.
 *
 * Each money token is assigned to the subtracted / added / balance column by
 * whichever column centre it sits closest to (the columns are well separated).
 */
export class CitibankCoordinateParser {
  private extractor: PDFCoordinateExtractor;

  private readonly TOL = 12; // X tolerance (points) for the description boundary

  private readonly DATE_RE = /^\d{1,2}\/\d{1,2}$/;
  private readonly MONEY_TOKEN_RE = /^\$?-?[\d,]+\.\d{2}$/;
  private readonly MONEY_RE = /[\d,]+\.\d{2}/;

  constructor() {
    this.extractor = new PDFCoordinateExtractor();
  }

  /**
   * Quick text-layer check so callers can decide whether to route here.
   */
  isCitibankStatement(text: string): boolean {
    const lower = text.toLowerCase();
    return (
      lower.includes("citibank") &&
      (lower.includes("checking activity") || lower.includes("amount subtracted"))
    );
  }

  /**
   * Parse a Citibank statement PDF using coordinate-based extraction.
   * @param buffer PDF file buffer
   * @param parsedText Text from pdf-parse (used only for the detection guard)
   * @param debug Enable verbose logging
   */
  async parseCitibankStatement(
    buffer: Buffer,
    parsedText: string,
    debug: boolean = false
  ): Promise<Transaction[]> {
    console.log("\n========== CITIBANK COORDINATE PARSER ==========");

    const elements = await this.extractor.extractTextWithCoordinates(buffer);
    console.log(`🏦 [Citibank] Extracted ${elements.length} text elements`);

    const rows = this.groupIntoRowsByPage(elements);

    const cols = this.detectColumns(rows);
    if (!cols) {
      console.error("⚠️  [Citibank] Could not detect column headers - skipping");
      return [];
    }
    console.log(
      `🏦 [Citibank] Column boundaries: desc|out=${cols.descOutBound.toFixed(1)} ` +
        `out|in=${cols.outInBound.toFixed(1)} in|bal=${cols.inBalBound.toFixed(1)}`
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

      if (!inTable) {
        // Opening balance is shown above the table ("Beginning Balance: $10,361.13").
        if (/Beginning Balance/i.test(rowText)) {
          const opening = this.captureBalanceRow(row, "Beginning Balance");
          if (opening) {
            transactions.push(opening);
            console.log(`   [Citibank] Beginning Balance: ${opening.balance}`);
          }
          continue;
        }
        // Enter the table at the column header ("Date Description Amount Subtracted ...").
        if (/Description/i.test(rowText) && /Subtracted/i.test(rowText)) inTable = true;
        continue;
      }

      // Totals row closes the table ("Total Subtracted/Added 3,646.07 25,160.67").
      if (/Total Subtracted/i.test(rowText)) {
        const totalsRow = this.parseTotalsRow(row, cols);
        if (totalsRow) transactions.push(totalsRow);
        break;
      }

      const tx = this.parseTransactionRow(row, cols);
      if (tx) {
        transactions.push(tx);
        last = tx;
      } else {
        this.tryAppendContinuation(row, rowText, cols, last);
      }
    }

    console.log(`✅ [Citibank] Extracted ${transactions.length} rows`);
    console.log("================================================\n");

    return transactions;
  }

  /**
   * Locate the column X-boundaries from the table header row. Rather than classify
   * each token by nearest centre (which loses fragmented amounts like "4"+"0.75"),
   * we compute the vertical boundaries between columns and bucket every element in a
   * row into a cell by its X. Boundaries are derived from the header label centres.
   */
  private detectColumns(
    rows: Array<{ elements: TextElement[] }>
  ): { descX: number; descOutBound: number; outInBound: number; inBalBound: number } | null {
    const headerIdx = rows.findIndex(r => {
      const t = r.elements.map(e => e.text).join(" ");
      return /Subtracted/i.test(t) && /Description/i.test(t);
    });

    if (headerIdx === -1) {
      console.log("[Citibank] Could not find the 'Amount Subtracted' header row");
      return null;
    }

    const headerEls = rows[headerIdx].elements;
    // pdf.js may emit "Amount Subtracted" / "Amount Added" as single combined
    // elements, so match the distinctive word by `contains`, not exact-equals.
    const findEl = (re: RegExp): TextElement | undefined => headerEls.find(e => re.test(e.text));
    const centerOf = (el: TextElement): number => el.x + (el.width || 0) / 2;

    const descEl = findEl(/Description/i);
    const subEl = findEl(/Subtracted/i);
    const addEl = findEl(/Added/i);
    const balEl = findEl(/Balance/i);

    if (!descEl || !subEl || !addEl || !balEl || subEl === addEl) {
      console.log("[Citibank] Missing/ambiguous headers:", {
        description: !!descEl,
        subtracted: !!subEl,
        added: !!addEl,
        balance: !!balEl,
      });
      console.log("[Citibank] Header row elements:", headerEls.map(e => e.text));
      return null;
    }

    const subC = centerOf(subEl);
    const addC = centerOf(addEl);
    const balC = centerOf(balEl);
    if (!(subC < addC && addC < balC)) {
      console.log(`[Citibank] Header centres out of order: sub=${subC} add=${addC} bal=${balC}`);
      return null;
    }

    // Boundaries = midpoints between adjacent column centres.
    const spacing = addC - subC;
    return {
      descX: descEl.x,
      descOutBound: subC - spacing / 2, // description | Amount Subtracted
      outInBound: (subC + addC) / 2, // Amount Subtracted | Amount Added
      inBalBound: (addC + balC) / 2, // Amount Added | Balance
    };
  }

  /**
   * Extract the money value(s) from a concatenated cell string. Fragments of one
   * amount join into a single number ("4"+"0.75" → "40.75"); multiple distinct
   * amounts (rare, from a merged row) yield multiple values.
   */
  private moneyValues(text: string): number[] {
    const matches = text.match(/-?\d[\d,]*\.\d{2}/g);
    return matches ? matches.map(m => parseFloat(m.replace(/,/g, ""))) : [];
  }

  /** Concatenate (no separator) the text of elements whose centre X is in [lo, hi). */
  private cellText(els: TextElement[], lo: number, hi: number): string {
    return els
      .filter(e => {
        const c = e.x + (e.width || 0) / 2;
        return c >= lo && c < hi;
      })
      .map(e => e.text)
      .join("");
  }

  /**
   * Parse one visual row into a transaction by bucketing every element into a
   * column cell by X, so amounts split across several elements are reassembled.
   */
  private parseTransactionRow(
    row: { elements: TextElement[] },
    cols: NonNullable<ReturnType<CitibankCoordinateParser["detectColumns"]>>
  ): Transaction | null {
    const els = row.elements;

    const dateEl = els.find(e => this.DATE_RE.test(e.text));
    if (!dateEl) return null;

    const outVals = this.moneyValues(this.cellText(els, cols.descOutBound, cols.outInBound));
    const inVals = this.moneyValues(this.cellText(els, cols.outInBound, cols.inBalBound));
    const balVals = this.moneyValues(this.cellText(els, cols.inBalBound, Infinity));

    const amountOut = outVals.length ? Math.abs(outVals[0]) : undefined;
    const amountIn = inVals.length ? Math.abs(inVals[0]) : undefined;
    // A merged row can carry two balances; the current row's is the last (lowest) one.
    const balance = balVals.length ? balVals[balVals.length - 1] : undefined;

    if (amountOut === undefined && amountIn === undefined) return null; // lone balance / continuation

    // Description: text left of the Amount Subtracted column, minus the date.
    const description = els
      .filter(e => e !== dateEl && e.x + (e.width || 0) / 2 < cols.descOutBound)
      .map(e => e.text)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();

    const isCredit = amountIn !== undefined;
    return {
      date: dateEl.text,
      description: description || (isCredit ? "Credit" : "Debit"),
      amount: isCredit ? amountIn! : amountOut!,
      type: isCredit ? "credit" : "debit",
      balance,
    };
  }

  /**
   * Parse the "Total Subtracted/Added 3,646.07 25,160.67" row into a summary
   * transaction rendering the added total under Money In and the subtracted total
   * under Money Out.
   */
  private parseTotalsRow(
    row: { elements: TextElement[] },
    cols: NonNullable<ReturnType<CitibankCoordinateParser["detectColumns"]>>
  ): Transaction | null {
    const els = row.elements;
    const subtracted = this.moneyValues(this.cellText(els, cols.descOutBound, cols.outInBound))[0];
    const added = this.moneyValues(this.cellText(els, cols.outInBound, cols.inBalBound))[0];

    if (subtracted === undefined && added === undefined) return null;

    console.log(`   [Citibank] Totals — subtracted: ${subtracted ?? 0}, added: ${added ?? 0}`);

    return {
      date: "",
      description: "Total Subtracted/Added",
      amount: 0,
      type: "total",
      amountIn: added,
      amountOut: subtracted,
      isTotal: true,
    };
  }

  /**
   * Capture a labelled balance row (e.g. "Beginning Balance: $10,361.13") as an
   * opening-balance transaction.
   */
  private captureBalanceRow(row: { elements: TextElement[] }, label: string): Transaction | null {
    const moneyEl = row.elements.find(e => this.MONEY_TOKEN_RE.test(e.text));
    if (!moneyEl) return null;
    const balance = parseFloat(moneyEl.text.replace(/[$,]/g, ""));
    if (!Number.isFinite(balance)) return null;
    return { date: "", description: label, amount: 0, balance, isOpeningBalance: true };
  }

  /**
   * Append a wrapped description line (no date, no amount) to the previous transaction.
   */
  private tryAppendContinuation(
    row: { elements: TextElement[] },
    rowText: string,
    cols: NonNullable<ReturnType<CitibankCoordinateParser["detectColumns"]>>,
    last: Transaction | null
  ): void {
    if (!last) return;
    if (this.MONEY_RE.test(rowText)) return;
    if (row.elements.some(e => this.DATE_RE.test(e.text))) return;

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
export const citibankCoordinateParser = new CitibankCoordinateParser();
