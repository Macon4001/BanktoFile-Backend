import { Transaction } from "../types/index.js";
import { PDFCoordinateExtractor, TextElement } from "./pdfCoordinateExtractor.js";

/**
 * A group of transactions under one Chase statement heading
 * (e.g. "Deposits and Additions", "Withdrawals").
 * Structurally identical to CapitalOneSection so it reuses the
 * existing sectioned-CSV output pathway.
 */
export interface ChaseSection {
  title: string;
  transactions: Transaction[];
  total?: number; // Section total from the "Total ..." row (e.g. 10302.70)
  totalLabel?: string; // The total row's own label (e.g. "Total Deposits and Additions")
}

export interface ChaseParsedData {
  sections: ChaseSection[];
  allTransactions: Transaction[]; // Flattened, for backward compatibility
}

/**
 * Dedicated coordinate-based parser for Chase (JPMorgan Chase) statements.
 *
 * Why coordinate-based? Chase's PDF text layer is emitted out of visual order —
 * pdf-parse returns all amounts as one block, all descriptions as another, and
 * all dates as a third block, so rows cannot be reconstructed from the raw text.
 * We instead read each text element's (x, y) position and rebuild rows by their
 * vertical position, then split each row into Date / Description / Amount by the
 * horizontal position of the tokens.
 *
 * Statement structure (personal checking):
 * - CHECKING SUMMARY (balances — skipped, not transactional)
 * - "DEPOSITS AND ADDITIONS": DATE | DESCRIPTION | AMOUNT  (money in)
 * - "WITHDRAWALS" / "ELECTRONIC WITHDRAWALS" / "ATM & DEBIT CARD WITHDRAWALS": money out
 * - "CHECKS PAID": CHECK NO. | ... | DATE PAID | AMOUNT    (money out)
 * - "FEES": money out
 * Each section ends with a "Total ..." row.
 */
export class ChaseCoordinateParser {
  private extractor: PDFCoordinateExtractor;

  // Section headings, most-specific first so "ELECTRONIC WITHDRAWALS" and
  // "ATM & DEBIT CARD WITHDRAWALS" are matched before the bare "WITHDRAWALS".
  // `key` is the space-stripped, upper-cased title — some Chase PDFs have no space
  // glyphs at all (words separated only by positioning), so we match on the normalized row.
  private readonly SECTION_DEFS: Array<{ key: string; title: string; type: "credit" | "debit" }> = [
    { key: "DEPOSITSANDADDITIONS", title: "Deposits and Additions", type: "credit" },
    { key: "ELECTRONICWITHDRAWALS", title: "Electronic Withdrawals", type: "debit" },
    { key: "ATM&DEBITCARDWITHDRAWALS", title: "ATM & Debit Card Withdrawals", type: "debit" },
    { key: "CHECKSPAID", title: "Checks Paid", type: "debit" },
    { key: "WITHDRAWALS", title: "Withdrawals", type: "debit" },
    { key: "FEES", title: "Fees", type: "debit" },
  ];

  // Rows that repeat as page furniture inside a section (tested against the
  // space-stripped, upper-cased row text).
  private readonly FURNITURE_RE = /ACCOUNTNUMBER|PAGE\d+OF|THROUGH|JPMORGAN|CHASE\.COM|MEMBERFDIC|CUSTOMERSERVICE|CHECKINGSUMMARY|^CHASE$/i;

  constructor() {
    this.extractor = new PDFCoordinateExtractor();
  }

  /**
   * Quick text-layer check so callers can decide whether to route here.
   */
  isChaseStatement(text: string): boolean {
    const lower = text.toLowerCase();
    return (
      lower.includes("jpmorgan chase bank") ||
      lower.includes("chase.com") ||
      (lower.includes("chase") && lower.includes("checking summary"))
    );
  }

  /**
   * Parse a Chase statement PDF using coordinate-based extraction.
   * @param buffer PDF file buffer
   * @param parsedText Text from pdf-parse (used only for the detection guard)
   * @param debug Enable verbose logging
   */
  async parseChaseStatement(
    buffer: Buffer,
    parsedText: string,
    debug: boolean = false
  ): Promise<ChaseParsedData> {
    console.log("\n========== CHASE COORDINATE PARSER ==========");

    const elements = await this.extractor.extractTextWithCoordinates(buffer);
    console.log(`🏦 [Chase] Extracted ${elements.length} text elements`);

    const rows = this.groupIntoRowsByPage(elements);
    console.log(`🏦 [Chase] Grouped into ${rows.length} rows`);

    if (debug) {
      rows.slice(0, 60).forEach((r, i) => {
        console.log(`[Row ${i}] p${r.pageNumber} y=${r.y.toFixed(1)} | ${r.elements.map(e => e.text).join(" | ")}`);
      });
    }

    const sections: ChaseSection[] = [];
    let current: ChaseSection | null = null;
    let currentType: "credit" | "debit" = "debit";

    for (const row of rows) {
      const rowText = row.elements.map(e => e.text).join(" ").replace(/\s+/g, " ").trim();
      if (!rowText) continue;
      const normalized = rowText.replace(/\s+/g, "").toUpperCase();

      // Start of a new section?
      const def = this.SECTION_DEFS.find(d => normalized.startsWith(d.key));
      if (def && this.isSectionHeading(normalized, rowText, def.key)) {
        current = { title: def.title, transactions: [] };
        currentType = def.type;
        sections.push(current);
        console.log(`📍 [Chase] Section: ${def.title}`);
        continue;
      }

      if (!current) continue;

      // End of the current section — capture its total (e.g. "Total Deposits and Additions $13,059.57").
      if (normalized.startsWith("TOTAL")) {
        const amt = this.extractAmountFromRight(row.elements);
        if (amt) {
          current.total = Math.abs(amt.value);
          current.totalLabel = row.elements
            .filter(e => e.x < amt.leftX)
            .map(e => e.text)
            .join(" ")
            .replace(/\s+/g, " ")
            .trim();
          console.log(`   [Chase] ${current.title} total: ${current.total}`);
        }
        current = null;
        continue;
      }

      // Skip the column-header row ("DATE DESCRIPTION AMOUNT").
      if (normalized.startsWith("DATE") && normalized.includes("AMOUNT")) continue;

      const tx = this.parseTransactionRow(row, currentType);
      if (tx) {
        current.transactions.push(tx);
      } else {
        // Wrapped description line: no date, no amount → append to previous txn.
        this.tryAppendContinuation(row, rowText, normalized, current);
      }
    }

    // Drop any sections that ended up empty (heading with no rows).
    const nonEmpty = sections.filter(s => s.transactions.length > 0);

    const allTransactions: Transaction[] = [];
    for (const s of nonEmpty) allTransactions.push(...s.transactions);

    console.log(
      `✅ [Chase] Extracted ${allTransactions.length} transactions across ${nonEmpty.length} sections: ` +
        nonEmpty.map(s => `${s.title} (${s.transactions.length})`).join(", ")
    );
    console.log("=============================================\n");

    return { sections: nonEmpty, allTransactions };
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
        rows.push({
          pageNumber: page,
          y: bucketY,
          elements: bucket.slice().sort((a, b) => a.x - b.x),
        });
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

  /**
   * A section heading row is essentially just the title — guard against matching
   * a summary line (e.g. "Deposits and Additions 13,059.57") or a transaction whose
   * description starts with the same words.
   */
  private isSectionHeading(normalized: string, rowText: string, key: string): boolean {
    // No money on a heading row, and the row isn't much longer than the title.
    if (this.MONEY_RE.test(rowText)) return false;
    return normalized.length <= key.length + 6;
  }

  private readonly DATE_RE = /^\d{1,2}\/\d{1,2}$/;
  // Loose "contains money" test for the heading guard.
  private readonly MONEY_RE = /[\d,]+\.\d{2}/;
  // A fragment of an amount: only $, digits, commas, dots, minus (e.g. "$1,780", ".65", "1").
  private readonly AMOUNT_FRAG_RE = /^\$?-?[\d.,]+$/;
  // Max horizontal gap (points) between adjacent fragments of the SAME amount.
  private readonly AMOUNT_FRAG_GAP = 15;

  /**
   * Parse one visual row into a transaction. Requires a leading date token and a
   * trailing amount; everything in between is the description.
   */
  private parseTransactionRow(
    row: { elements: TextElement[] },
    type: "credit" | "debit"
  ): Transaction | null {
    const els = row.elements;
    if (els.length < 2) return null;

    // Date: the first element must be a MM/DD token (the DATE column).
    const dateEl = els[0];
    if (!this.DATE_RE.test(dateEl.text)) return null;

    // Amount: the right-most contiguous numeric cluster (tolerates pdf.js splitting
    // "$1,780.65" into "$1,780" + ".65", or "13,059.57" into "1" + "3,059" + ".57").
    const amt = this.extractAmountFromRight(els);
    if (!amt) return null;

    // Description: everything between the date and the amount cluster.
    const description = els
      .filter(el => el !== dateEl && el.x < amt.leftX)
      .map(el => el.text)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();

    return {
      date: dateEl.text,
      description: description || (type === "credit" ? "Deposit" : "Withdrawal"),
      amount: Math.abs(amt.value),
      type,
      balance: 0, // Chase transaction tables don't carry a running balance.
    };
  }

  /**
   * Collect the right-most run of numeric fragments that together form a single
   * money value, tolerating amounts that pdf.js has split across several elements.
   * Returns the parsed value and the left X of the cluster (for the description cut).
   */
  private extractAmountFromRight(els: TextElement[]): { value: number; leftX: number } | null {
    const frags: TextElement[] = [];

    for (let i = els.length - 1; i >= 0; i--) {
      const el = els[i];
      if (!this.AMOUNT_FRAG_RE.test(el.text)) break;

      if (frags.length === 0) {
        frags.unshift(el);
      } else {
        const leftmost = frags[0];
        const gap = leftmost.x - (el.x + (el.width || 0));
        if (gap <= this.AMOUNT_FRAG_GAP) frags.unshift(el);
        else break; // large gap → a separate token (e.g. a footnote marker), stop
      }
    }

    if (frags.length === 0) return null;

    const cleaned = frags.map(f => f.text).join("").replace(/[$,\s]/g, "");
    if (!/^-?\d+\.\d{2}$/.test(cleaned)) return null; // must be a real amount with cents

    const value = parseFloat(cleaned);
    if (!Number.isFinite(value)) return null;

    return { value, leftX: frags[0].x };
  }

  /**
   * Append a wrapped description line (no date, no amount) to the last
   * transaction in the current section, skipping repeated page furniture.
   */
  private tryAppendContinuation(
    row: { elements: TextElement[] },
    rowText: string,
    normalized: string,
    section: ChaseSection
  ): void {
    if (section.transactions.length === 0) return;
    if (this.MONEY_RE.test(rowText)) return; // has a number that looks like money
    if (row.elements.some(e => this.DATE_RE.test(e.text))) return; // has its own date
    if (this.FURNITURE_RE.test(normalized)) return; // page header/footer text
    if (rowText.length < 3) return;

    const last = section.transactions[section.transactions.length - 1];
    last.description = `${last.description} ${rowText}`.replace(/\s+/g, " ").trim();
  }
}

// Export singleton instance
export const chaseCoordinateParser = new ChaseCoordinateParser();
