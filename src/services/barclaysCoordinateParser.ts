import { Transaction } from "../types/index.js";
import { PDFCoordinateExtractor, TextElement } from "./pdfCoordinateExtractor.js";

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
// Header labels - business statements add a currency suffix ("Money out £")
const MONEY_OUT_HEADER = /^Money out(\s*£)?$/i;
const MONEY_IN_HEADER = /^Money in(\s*£)?$/i;
const BALANCE_HEADER = /^Balance(\s*£)?$/i;
// Rows carrying a balance but no transaction
const OPENING_ROW = /\b(Start balance|Balance brought forward)\b/i;
const TABLE_END_ROW = /^(End balance|Continued|Anything Wrong\?|Barclays Bank)|Balance carried forward|Total Payments\/Receipts/i;
const DATE_REGEX = /^(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)$/i;
// Column amounts: "1,234.56", overdrawn balances may carry a trailing "-" or "OD".
// Also accepts a mistyped decimal comma ("21,18") - a thousands group always has 3 digits.
const AMOUNT_REGEX = /^£?(\d{1,3}(?:,\d{3})*\.\d{2}|\d{1,3},\d{2})\s*(-|OD)?$/i;

interface BarclaysColumns {
  dateRight: number;
  descriptionLeft: number;
  moneyOutRight: number;
  moneyInRight: number;
  balanceRight: number;
  amountsLeft: number; // Anything starting at/after this x is in an amount column
}

interface Anchor {
  y: number;
  date: string;
  amount: number;
  type: "credit" | "debit";
  balance?: number;
  descriptionLines: { y: number; text: string }[];
}

/**
 * Barclays coordinate-based PDF parser
 *
 * Barclays statements have a table with columns:
 *   Date | Description | Money out | Money in | Balance
 *
 * - Amounts are right-aligned under their column header, so the column an amount sits in
 *   decides whether it's money in or money out (no keyword guessing).
 * - A date is only printed on the first transaction of each day.
 * - A balance is only printed on the last transaction of each day.
 * - Descriptions wrap over several lines (Ref: ..., Sutton 47, ...) below the amount row,
 *   and the first description line can sit a few points above or below its amount.
 */
export class BarclaysCoordinateParser {
  private extractor: PDFCoordinateExtractor;

  constructor() {
    this.extractor = new PDFCoordinateExtractor();
  }

  async parseBarclaysStatement(buffer: Buffer, parsedText: string, debug: boolean = false): Promise<Transaction[]> {
    console.log("\n========== BARCLAYS COORDINATE PARSER ==========");

    const elements = await this.extractor.extractTextWithCoordinates(buffer);
    console.log(`Extracted ${elements.length} text elements from PDF`);

    const { endYear, endMonthIdx } = this.detectStatementPeriod(parsedText);
    // Opening balance: from the table's "Start balance" row, falling back to "At a glance"
    let openingBalance: { date: string; balance?: number } | undefined;

    const pageNumbers = Array.from(new Set(elements.map(e => e.pageNumber))).sort((a, b) => a - b);
    const anchors: Anchor[] = [];
    let currentDate = "";

    for (const pageNumber of pageNumbers) {
      const pageElements = elements.filter(e => e.pageNumber === pageNumber && e.text);
      const rows = this.extractor.groupIntoRows(pageElements, 2);

      const headerRow = rows.find(r =>
        r.elements.some(e => MONEY_OUT_HEADER.test(e.text)) &&
        r.elements.some(e => MONEY_IN_HEADER.test(e.text)) &&
        r.elements.some(e => BALANCE_HEADER.test(e.text))
      );
      if (!headerRow) continue;

      const columns = this.detectColumns(headerRow.elements);
      if (debug) console.log(`[Page ${pageNumber}] Columns:`, columns);

      // Table ends at the first footer marker below the header
      const endRow = rows.find(r => r.y > headerRow.y &&
        r.elements.some(e => TABLE_END_ROW.test(e.text)));
      const tableEndY = endRow ? endRow.y : Infinity;

      // Right bound: business statements print the "At a glance" box beside the table
      const tableElements = pageElements.filter(e =>
        e.y > headerRow.y + 2 && e.y < tableEndY - 2 && e.x < columns.balanceRight + 10);
      // Some PDFs split text into touching fragments ("22" "," "267.05", "0" "9" "Dec"),
      // so stitch each row back together before classifying anything
      const tableRows = this.extractor.groupIntoRows(tableElements, 2)
        .map(r => ({ y: r.y, elements: this.mergeFragments(r.elements) }));

      const dates: { y: number; date: string }[] = [];
      const descriptions: { y: number; text: string }[] = [];
      const balances: { y: number; value: number }[] = [];
      const pageAnchors: Anchor[] = [];

      for (const row of tableRows) {
        // "Start balance" / "Balance brought forward" rows: the first becomes the opening balance
        if (row.elements.some(e => OPENING_ROW.test(e.text))) {
          if (!openingBalance) {
            const dateMatch = row.elements.filter(e => e.x < columns.dateRight).map(e => e.text).join(" ").match(DATE_REGEX);
            const balanceEl = row.elements.find(e => e.x >= columns.amountsLeft && this.parseAmount(e.text) !== null);
            openingBalance = {
              date: dateMatch ? this.formatDate(dateMatch[1], dateMatch[2], endYear, endMonthIdx) : "",
              balance: balanceEl ? this.parseAmount(balanceEl.text)! : undefined,
            };
          }
          continue;
        }

        // Date cell: everything left of the Description header, e.g. "09" + "Dec"
        const dateText = row.elements.filter(e => e.x < columns.dateRight).map(e => e.text).join(" ");
        const dateMatch = dateText.match(DATE_REGEX);
        if (dateMatch) {
          dates.push({ y: row.y, date: this.formatDate(dateMatch[1], dateMatch[2], endYear, endMonthIdx) });
        }

        for (const el of row.elements) {
          if (el.x < columns.dateRight) continue;

          const value = el.x >= columns.amountsLeft ? this.parseAmount(el.text) : null;
          if (value !== null) {
            const column = this.nearestColumn(el.x + el.width, columns);
            if (column === "balance") {
              balances.push({ y: el.y, value });
            } else {
              pageAnchors.push({
                y: el.y,
                date: "",
                amount: Math.abs(value),
                type: column === "in" ? "credit" : "debit",
                descriptionLines: [],
              });
            }
            continue;
          }

          // Description column text (ignores transaction-type icons like "STO"/"Giro" left of it)
          if (el.x >= columns.descriptionLeft && el.x < columns.amountsLeft) {
            descriptions.push({ y: el.y, text: el.text });
          }
        }
      }

      // Date: most recent date at or above the anchor (dates carry over between pages)
      for (const anchor of pageAnchors) {
        const date = [...dates].reverse().find(d => d.y <= anchor.y + 4);
        if (date) currentDate = date.date;
        anchor.date = currentDate;

        const balance = balances.find(b => Math.abs(b.y - anchor.y) <= 4);
        if (balance) anchor.balance = balance.value;
      }

      // Description lines belong to the nearest anchor at or above them
      // (the first line can sit a few points below or above its amount)
      for (const desc of descriptions) {
        const owner = [...pageAnchors].reverse().find(a => a.y <= desc.y + 5);
        if (owner) {
          owner.descriptionLines.push(desc);
        } else if (anchors.length > 0) {
          // Wrapped description continuing from the previous page
          anchors[anchors.length - 1].descriptionLines.push(desc);
        }
      }

      anchors.push(...pageAnchors);
    }

    // Build transactions, filling in balances Barclays doesn't print (it only shows end-of-day)
    const transactions: Transaction[] = [];
    const startBalance = openingBalance?.balance ??
      this.extractSummaryAmount(parsedText, /Start balance\s*£\s*([\d,]+\.\d{2})/i);
    let running = startBalance;

    if (startBalance !== undefined) {
      transactions.push({
        date: openingBalance?.date || anchors[0]?.date || "",
        description: "Start balance",
        amount: 0,
        balance: startBalance,
        type: "balance",
        isOpeningBalance: true,
      });
    }

    for (const anchor of anchors) {
      const description = anchor.descriptionLines
        .sort((a, b) => a.y - b.y)
        .map(d => d.text)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();

      if (running !== undefined) {
        running = Math.round((running + (anchor.type === "credit" ? anchor.amount : -anchor.amount)) * 100) / 100;
      }

      let balance = anchor.balance;
      if (balance !== undefined) {
        if (running !== undefined && Math.abs(running - balance) > 0.005) {
          console.log(`⚠️  [Barclays] Balance mismatch on ${anchor.date} "${description}": computed £${running.toFixed(2)}, printed £${balance.toFixed(2)}`);
        }
        running = balance;
      } else {
        balance = running;
      }

      transactions.push({
        date: anchor.date,
        description,
        amount: anchor.amount,
        balance: balance ?? 0,
        type: anchor.type,
      });

      if (debug) {
        console.log(`✓ ${anchor.date} | ${description.substring(0, 50)} | ${anchor.type} £${anchor.amount.toFixed(2)} | Bal: ${balance?.toFixed(2)}`);
      }
    }

    this.logTotals(transactions, parsedText);
    console.log(`✓ Extracted ${transactions.length} Barclays transactions using coordinates`);
    console.log("=================================================\n");

    return transactions;
  }

  /**
   * Column positions from the header row. Amounts are right-aligned, so we use each
   * header's right edge and match amounts to the nearest one.
   */
  private detectColumns(header: TextElement[]): BarclaysColumns {
    const find = (re: RegExp) => header.find(e => re.test(e.text))!;
    const description = header.find(e => /^Description$/i.test(e.text));
    const moneyOut = find(MONEY_OUT_HEADER);
    const moneyIn = find(MONEY_IN_HEADER);
    const balance = find(BALANCE_HEADER);

    return {
      // Small margin: unindented text (e.g. "Start balance") can sit exactly at the header's x
      dateRight: description ? description.x - 2 : 88,
      // Description text is indented past the header (icons like "STO" sit in between)
      descriptionLeft: description ? description.x + 10 : 100,
      moneyOutRight: moneyOut.x + moneyOut.width,
      moneyInRight: moneyIn.x + moneyIn.width,
      balanceRight: balance.x + balance.width,
      // Wide amounts ("5,000.00") start a little left of the "Money out" header
      amountsLeft: moneyOut.x - 15,
    };
  }

  /** Signed amount from a column cell, or null if the text isn't an amount */
  private parseAmount(text: string): number | null {
    const match = text.match(AMOUNT_REGEX);
    if (!match) return null;
    const raw = /^\d{1,3},\d{2}$/.test(match[1]) ? match[1].replace(",", ".") : match[1].replace(/,/g, "");
    const value = parseFloat(raw);
    return match[2] ? -value : value;
  }

  /**
   * Join fragments on the same row that touch horizontally (no visible gap between them).
   * Fragments starting inside the previous one are dropped - bold text is sometimes drawn
   * as overlapping copies of the same glyphs ("N" "N" "No" "o" "ov" ...).
   */
  private mergeFragments(elements: TextElement[]): TextElement[] {
    const merged: TextElement[] = [];
    let lastRight = -Infinity; // Right edge of the last fragment kept
    for (const el of [...elements].sort((a, b) => a.x - b.x)) {
      if (el.x < lastRight - 1) continue;
      lastRight = el.x + el.width;

      const prev = merged[merged.length - 1];
      const prevRight = prev ? prev.x + prev.width : -Infinity;
      if (prev && el.x - prevRight <= 1 && el.x - prevRight >= -1) {
        merged[merged.length - 1] = { ...prev, text: prev.text + el.text, width: el.x + el.width - prev.x };
      } else {
        merged.push({ ...el });
      }
    }
    return merged;
  }

  private nearestColumn(right: number, columns: BarclaysColumns): "out" | "in" | "balance" {
    const distances: [("out" | "in" | "balance"), number][] = [
      ["out", Math.abs(right - columns.moneyOutRight)],
      ["in", Math.abs(right - columns.moneyInRight)],
      ["balance", Math.abs(right - columns.balanceRight)],
    ];
    distances.sort((a, b) => a[1] - b[1]);
    return distances[0][0];
  }

  /**
   * Statement period, e.g. "01 Feb - 15 Mar 2026" or "18 Jun - 17 Sep 2025".
   * Transactions in months after the end month belong to the previous year (Dec→Jan statements).
   */
  private detectStatementPeriod(text: string): { endYear: number; endMonthIdx: number } {
    // "01 Feb - 15 Mar 2026", "28 Nov 2024 - 15 Feb 2025", "04 - 31 Mar 2022"
    const period = text.match(/\d{1,2}(?:\s+[A-Za-z]{3,9})?(?:\s+\d{4})?\s*-\s*\d{1,2}\s+([A-Za-z]{3})[a-z]*\s+(\d{4})/);
    if (period) {
      return { endYear: parseInt(period[2], 10), endMonthIdx: MONTHS.indexOf(period[1].toLowerCase()) };
    }
    const statementDate = text.match(/(?:Statement date|Issued on)\s+\d{1,2}\s+([A-Za-z]{3})\w*\s+(\d{4})/i);
    if (statementDate) {
      return { endYear: parseInt(statementDate[2], 10), endMonthIdx: MONTHS.indexOf(statementDate[1].toLowerCase()) };
    }
    return { endYear: new Date().getFullYear(), endMonthIdx: 11 };
  }

  private formatDate(day: string, month: string, endYear: number, endMonthIdx: number): string {
    const monthIdx = MONTHS.indexOf(month.toLowerCase());
    const year = endMonthIdx >= 0 && monthIdx > endMonthIdx ? endYear - 1 : endYear;
    const monthName = month.charAt(0).toUpperCase() + month.slice(1).toLowerCase();
    return `${day.padStart(2, "0")} ${monthName} ${year}`;
  }

  /** "At a glance" figure; some statements print the amount before its label ("£430.00Money in") */
  private extractGlanceAmount(text: string, label: string): number | undefined {
    return this.extractSummaryAmount(text, new RegExp(`${label}\\s*£\\s*([\\d,]+\\.\\d{2})`, "i")) ??
      this.extractSummaryAmount(text, new RegExp(`£([\\d,]+\\.\\d{2})\\s*${label}`, "i"));
  }

  private extractSummaryAmount(text: string, regex: RegExp): number | undefined {
    const match = text.match(regex);
    return match ? parseFloat(match[1].replace(/,/g, "")) : undefined;
  }

  private logTotals(allTransactions: Transaction[], text: string): void {
    const transactions = allTransactions.filter(t => !t.isOpeningBalance);
    const moneyIn = transactions.filter(t => t.type === "credit").reduce((s, t) => s + t.amount, 0);
    const moneyOut = transactions.filter(t => t.type === "debit").reduce((s, t) => s + t.amount, 0);
    const expectedIn = this.extractGlanceAmount(text, "Money in");
    const expectedOut = this.extractGlanceAmount(text, "Money out");
    console.log(`[Barclays] Money in £${moneyIn.toFixed(2)} (statement says £${expectedIn?.toFixed(2) ?? "?"}), ` +
                `Money out £${moneyOut.toFixed(2)} (statement says £${expectedOut?.toFixed(2) ?? "?"})`);
  }
}
