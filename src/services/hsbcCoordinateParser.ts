import { Transaction } from "../types/index.js";
import { PDFCoordinateExtractor, TextElement } from "./pdfCoordinateExtractor.js";

/**
 * HSBC-specific coordinate-based PDF parser
 * 
 * HSBC PDFs have chaotic text extraction where text order is scrambled.
 * This parser uses X,Y coordinates to properly extract transactions.
 */
export class HSBCCoordinateParser {
  private extractor: PDFCoordinateExtractor;

  constructor() {
    this.extractor = new PDFCoordinateExtractor();
  }

  async parseHSBCStatement(buffer: Buffer, parsedText: string, debug: boolean = false): Promise<Transaction[]> {
    console.log("\n========== HSBC COORDINATE PARSER ==========");
    
    // Extract all text elements with coordinates
    const elements = await this.extractor.extractTextWithCoordinates(buffer);
    console.log(`Extracted ${elements.length} text elements from PDF`);

    // Detect column boundaries from headers
    const columns = this.detectHSBCColumns(elements);
    
    // Extract transactions using coordinates
    const transactions = this.extractTransactions(elements, columns, parsedText, debug);
    
    console.log(`✓ Extracted ${transactions.length} HSBC transactions using coordinates`);
    console.log("============================================\n");
    
    return transactions;
  }

  /**
   * Detect HSBC column positions
   * Headers: "Date", "Payment Type and details", "Paid out", "Paid in", "Balance"
   */
  private detectHSBCColumns(elements: TextElement[]): {
    date: { min: number; max: number };
    description: { min: number; max: number };
    paidOut: { min: number; max: number };
    paidIn: { min: number; max: number };
    balance: { min: number; max: number };
  } {
    // Find column headers by text content
    let dateHeader: TextElement | undefined;
    let descHeader: TextElement | undefined;
    let paidOutHeader: TextElement | undefined;
    let paidInHeader: TextElement | undefined;
    let balanceHeader: TextElement | undefined;

    for (const el of elements) {
      const text = el.text.trim().toLowerCase();
      
      if (text === 'date' || text.startsWith('date')) {
        dateHeader = el;
      } else if (text.includes('payment') && text.includes('type')) {
        descHeader = el;
      } else if (text === 'paid out' || text.includes('paid') && text.includes('out')) {
        paidOutHeader = el;
      } else if (text === 'paid in' || text.includes('paid') && text.includes('in')) {
        paidInHeader = el;
      } else if (text === 'balance') {
        balanceHeader = el;
      }
    }

    // Define column boundaries based on headers
    // Use approximate positions if headers not found
    const pageWidth = 600; // Typical A4 width in points
    
    return {
      date: dateHeader 
        ? { min: dateHeader.x - 10, max: dateHeader.x + 60 }
        : { min: 40, max: 100 },
      description: descHeader
        ? { min: descHeader.x - 10, max: descHeader.x + 200 }
        : { min: 100, max: 350 },
      paidOut: paidOutHeader
        ? { min: paidOutHeader.x - 10, max: paidOutHeader.x + 60 }
        : { min: 350, max: 420 },
      paidIn: paidInHeader
        ? { min: paidInHeader.x - 10, max: paidInHeader.x + 60 }
        : { min: 420, max: 490 },
      balance: balanceHeader
        ? { min: balanceHeader.x - 10, max: balanceHeader.x + 70 }
        : { min: 490, max: pageWidth },
    };
  }

  /**
   * Extract transactions from text elements using column positions
   */
  private extractTransactions(
    elements: TextElement[],
    columns: ReturnType<typeof this.detectHSBCColumns>,
    parsedText: string,
    debug: boolean
  ): Transaction[] {
    const transactions: Transaction[] = [];

    // Group elements by Y position (same row)
    const rows = this.groupByRows(elements);
    
    // Filter to transaction rows (skip headers, footers)
    const transactionRows = rows.filter(row => {
      const rowText = row.map(el => el.text).join(' ').toLowerCase();
      
      // Skip header rows
      if (rowText.includes('date') && rowText.includes('payment')) return false;
      if (rowText.includes('paid out') && rowText.includes('paid in')) return false;
      if (rowText.includes('opening balance') && !rowText.includes('brought')) return false;
      if (rowText.includes('closing balance')) return false;
      if (rowText.includes('statement')) return false;
      
      // Must have either a date or transaction type prefix
      return /\d{1,2}\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i.test(rowText) ||
             /^(cr|bp|vis|dd|\)\)\))/.test(rowText.trim());
    });

    // Process each transaction row
    for (const row of transactionRows) {
      const transaction = this.parseRow(row, columns);
      if (transaction) {
        transactions.push(transaction);
      }
    }

    return transactions;
  }

  /**
   * Group text elements into rows based on Y position
   */
  private groupByRows(elements: TextElement[]): TextElement[][] {
    const rows: Map<number, TextElement[]> = new Map();
    const Y_THRESHOLD = 5; // Elements within 5 units are same row

    for (const el of elements) {
      let foundRow = false;
      
      for (const [y, row] of rows.entries()) {
        if (Math.abs(el.y - y) < Y_THRESHOLD) {
          row.push(el);
          foundRow = true;
          break;
        }
      }
      
      if (!foundRow) {
        rows.set(el.y, [el]);
      }
    }

    // Sort rows by Y position (top to bottom)
    return Array.from(rows.values()).sort((a, b) => a[0].y - b[0].y);
  }

  /**
   * Parse a single transaction row
   */
  private parseRow(
    row: TextElement[],
    columns: ReturnType<typeof this.detectHSBCColumns>
  ): Transaction | null {
    // Extract values from each column
    const dateEls = row.filter(el => this.inColumn(el, columns.date));
    const descEls = row.filter(el => this.inColumn(el, columns.description));
    const paidOutEls = row.filter(el => this.inColumn(el, columns.paidOut));
    const paidInEls = row.filter(el => this.inColumn(el, columns.paidIn));
    const balanceEls = row.filter(el => this.inColumn(el, columns.balance));

    // Extract date
    const dateText = dateEls.map(el => el.text).join(' ').trim();
    if (!dateText) return null;

    // Parse date (format: "DD Mmm YY" or "DD Mmm YYYY")
    const dateMatch = dateText.match(/(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{2,4})/i);
    if (!dateMatch) return null;

    const day = dateMatch[1].padStart(2, '0');
    const month = dateMatch[2];
    let year = dateMatch[3];
    if (year.length === 2) {
      year = '20' + year;
    }
    const date = `${day} ${month} ${year}`;

    // Extract description
    let description = descEls.map(el => el.text).join(' ').trim();
    
    // Determine transaction type from description prefix
    let type: 'credit' | 'debit' = 'debit';
    if (description.match(/^CR\s/i)) {
      type = 'credit';
      description = description.substring(3).trim();
    } else if (description.match(/^BP\s/i)) {
      type = 'debit';
      description = description.substring(3).trim();
    } else if (description.match(/^VIS\s/i)) {
      type = 'debit';
      description = description.substring(4).trim();
    } else if (description.match(/^DD\s/i)) {
      type = 'debit';
      description = description.substring(3).trim();
    } else if (description.match(/^\)\)\)\s/)) {
      type = 'debit';
      description = description.substring(4).trim();
    }

    // Handle BROUGHT FORWARD specially
    if (description.includes('BROUGHT FORWARD') || description.includes('BALANCE BROUGHT')) {
      const balanceText = balanceEls.map(el => el.text).join('').replace(/[^0-9.]/g, '');
      const balance = parseFloat(balanceText) || 0;
      
      return {
        date,
        description: 'BROUGHT FORWARD',
        amount: 0,
        balance,
        type: 'brought_forward',
      };
    }

    // Extract amounts
    const paidOutText = paidOutEls.map(el => el.text).join('').replace(/[^0-9.]/g, '');
    const paidInText = paidInEls.map(el => el.text).join('').replace(/[^0-9.]/g, '');
    const balanceText = balanceEls.map(el => el.text).join('').replace(/[^0-9.]/g, '');

    const paidOut = parseFloat(paidOutText) || 0;
    const paidIn = parseFloat(paidInText) || 0;
    const balance = parseFloat(balanceText) || 0;

    // Determine amount and type
    let amount = 0;
    if (paidOut > 0) {
      amount = paidOut;
      type = 'debit';
    } else if (paidIn > 0) {
      amount = paidIn;
      type = 'credit';
    }

    if (amount === 0 && !description) {
      return null; // Skip empty rows
    }

    return {
      date,
      description: description || 'HSBC Transaction',
      amount,
      balance,
      type,
    };
  }

  /**
   * Check if element is within a column's X boundaries
   */
  private inColumn(el: TextElement, column: { min: number; max: number }): boolean {
    return el.x >= column.min && el.x <= column.max;
  }
}
