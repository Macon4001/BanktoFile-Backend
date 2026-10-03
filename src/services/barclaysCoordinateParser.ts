import { Transaction } from "../types/index.js";
import { PDFCoordinateExtractor, TextElement } from "./pdfCoordinateExtractor.js";

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const DATE_REGEX = /^(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)$/i;
// Column amounts: "1,234.56", overdrawn balances may carry a trailing "-" or "OD"
const AMOUNT_REGEX = /^£?(\d{1,3}(?:,\d{3})*\.\d{2})\s*(-|OD)?$/i;

interface BarclaysColumns {
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
    const startBalance = this.extractSummaryAmount(parsedText, /Start balance\s*£?\s*([\d,]+\.\d{2})/i);

    const pageNumbers = Array.from(new Set(elements.map(e => e.pageNumber))).sort((a, b) => a - b);
    const anchors: Anchor[] = [];
    let currentDate = "";

    for (const pageNumber of pageNumbers) {
      const pageElements = elements.filter(e => e.pageNumber === pageNumber && e.text);
      const rows = this.extractor.groupIntoRows(pageElements, 2);

      const headerRow = rows.find(r =>
        r.elements.some(e => /^Money out$/i.test(e.text)) &&
        r.elements.some(e => /^Money in$/i.test(e.text)) &&
        r.elements.some(e => /^Balance$/i.test(e.text))
      );
      if (!headerRow) continue;

      const columns = this.detectColumns(headerRow.elements);
      if (debug) console.log(`[Page ${pageNumber}] Columns:`, columns);

      // Table ends at the first footer marker below the header
      const endRow = rows.find(r => r.y > headerRow.y &&
        r.elements.some(e => /^(End balance|Continued|Anything Wrong\?)/i.test(e.text) || /^Barclays Bank/i.test(e.text)));
      const tableEndY = endRow ? endRow.y : Infinity;

      const tableElements = pageElements
        .filter(e => e.y > headerRow.y + 2 && e.y < tableEndY - 2)
        .sort((a, b) => a.y - b.y || a.x - b.x);

      // Skip the "Start balance" row (and anything on its line)
      const startBalanceYs = tableElements.filter(e => /^Start balance$/i.test(e.text)).map(e => e.y);
      const isOnStartBalanceRow = (e: TextElement) => startBalanceYs.some(y => Math.abs(e.y - y) <= 4);

      const dates: { y: number; date: string }[] = [];
      const descriptions: { y: number; text: string }[] = [];
      const balances: { y: number; value: number }[] = [];
      const pageAnchors: Anchor[] = [];

      for (const el of tableElements) {
        if (isOnStartBalanceRow(el)) continue;

        const dateMatch = el.text.match(DATE_REGEX);
        if (dateMatch && el.x < columns.descriptionLeft) {
          dates.push({ y: el.y, date: this.formatDate(dateMatch[1], dateMatch[2], endYear, endMonthIdx) });
          continue;
        }

        const amountMatch = el.text.match(AMOUNT_REGEX);
        if (amountMatch && el.x >= columns.amountsLeft) {
          const value = parseFloat(amountMatch[1].replace(/,/g, ""));
          const right = el.x + el.width;
          const column = this.nearestColumn(right, columns);
          if (column === "balance") {
            balances.push({ y: el.y, value: amountMatch[2] ? -value : value });
          } else {
            pageAnchors.push({
              y: el.y,
              date: "",
              amount: value,
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
    let running = startBalance;

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
    const moneyOut = find(/^Money out$/i);
    const moneyIn = find(/^Money in$/i);
    const balance = find(/^Balance$/i);

    return {
      // Description text is indented past the header (icons like "STO" sit in between)
      descriptionLeft: description ? description.x + 10 : 100,
      moneyOutRight: moneyOut.x + moneyOut.width,
      moneyInRight: moneyIn.x + moneyIn.width,
      balanceRight: balance.x + balance.width,
      // Wide amounts ("5,000.00") start a little left of the "Money out" header
      amountsLeft: moneyOut.x - 15,
    };
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
    const period = text.match(/\d{1,2}\s+[A-Za-z]{3}(?:\s+\d{4})?\s*-\s*\d{1,2}\s+([A-Za-z]{3})\s+(\d{4})/);
    if (period) {
      return { endYear: parseInt(period[2], 10), endMonthIdx: MONTHS.indexOf(period[1].toLowerCase()) };
    }
    const statementDate = text.match(/Statement date\s+\d{1,2}\s+([A-Za-z]{3})\w*\s+(\d{4})/i);
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

  private extractSummaryAmount(text: string, regex: RegExp): number | undefined {
    const match = text.match(regex);
    return match ? parseFloat(match[1].replace(/,/g, "")) : undefined;
  }

  private logTotals(transactions: Transaction[], text: string): void {
    const moneyIn = transactions.filter(t => t.type === "credit").reduce((s, t) => s + t.amount, 0);
    const moneyOut = transactions.filter(t => t.type === "debit").reduce((s, t) => s + t.amount, 0);
    const expectedIn = this.extractSummaryAmount(text, /Money in\s*£\s*([\d,]+\.\d{2})/i);
    const expectedOut = this.extractSummaryAmount(text, /Money out\s*£\s*([\d,]+\.\d{2})/i);
    console.log(`[Barclays] Money in £${moneyIn.toFixed(2)} (statement says £${expectedIn?.toFixed(2) ?? "?"}), ` +
                `Money out £${moneyOut.toFixed(2)} (statement says £${expectedOut?.toFixed(2) ?? "?"})`);
  }
}
