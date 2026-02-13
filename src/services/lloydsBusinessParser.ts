import { Transaction } from "../types/index.js";

/**
 * Dedicated parser for Lloyds Bank Business Account statements
 *
 * Format structure:
 * - Each transaction uses a columnar format with labels and values on separate lines
 * - Pattern: Date\n01 Dec 25\nDescription\n...\nType\nCPT\nMoney In (£)\nblank.\nMoney Out (£)\n500.00\nBalance (£)\n41,904.22
 */
export class LloydsBusinessParser {
  /**
   * Parse Lloyds Business Account statement text
   * @param text - The extracted text from the PDF (either standard or OCR)
   * @returns Array of parsed transactions
   */
  public parseStatement(text: string): Transaction[] {
    console.log('🏦 [Lloyds Business] Starting Lloyds Business Account parser...');

    // Check if this is a Lloyds Business Account
    if (!this.isLloydsBusinessAccount(text)) {
      console.log('⚠️  [Lloyds Business] Not a Lloyds Business Account - skipping');
      return [];
    }

    console.log('✅ [Lloyds Business] Detected Lloyds Business Account format');

    const transactions: Transaction[] = [];
    const lines = text.split('\n').map(line => line.trim());

    // Find the start of transactions section
    let startIndex = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].toLowerCase() === 'your transactions' ||
          lines[i].toLowerCase() === 'yourtransactions') {
        startIndex = i;
        console.log(`📍 [Lloyds Business] Found transaction section at line ${i}`);
        break;
      }
    }

    if (startIndex === -1) {
      console.log('⚠️  [Lloyds Business] Could not find "Your Transactions" header');
      return [];
    }

    // Skip past column headers (Column, Date, Description, Type, Money In, Money Out, Balance)
    let i = startIndex + 1;
    while (i < lines.length && (
      lines[i].toLowerCase() === 'column' ||
      lines[i].toLowerCase().startsWith('date') && lines[i].toLowerCase().includes('.') ||
      lines[i].toLowerCase().startsWith('description') ||
      lines[i].toLowerCase().startsWith('type') ||
      lines[i].toLowerCase().includes('money in') ||
      lines[i].toLowerCase().includes('money out') ||
      lines[i].toLowerCase().includes('balance')
    )) {
      i++;
    }

    console.log(`🔍 [Lloyds Business] Starting transaction parsing at line ${i}`);

    // Parse transactions
    while (i < lines.length - 10) { // Need at least 10 lines for a transaction
      const currentLine = lines[i].toLowerCase();

      // Check if this is the start of a transaction (Date label)
      if (currentLine === 'date') {
        const transaction = this.parseTransaction(lines, i);
        if (transaction) {
          transactions.push(transaction);
          if (transactions.length <= 3) {
            console.log(`✅ [Lloyds Business] Transaction ${transactions.length}:`, transaction);
          }
        }
        i++;
      } else if (currentLine.includes('continued on next page') ||
                 currentLine.includes('page') && currentLine.match(/\d+\s+of\s+\d+/)) {
        // Skip page footer
        i++;
      } else if (currentLine === '' ||
                 currentLine.includes('logo,') ||
                 currentLine.includes('lloyds bank') ||
                 currentLine.includes('business account') ||
                 currentLine.includes('sort code') ||
                 currentLine.includes('account number')) {
        // Skip header/footer lines
        i++;
      } else {
        i++;
      }
    }

    console.log(`✅ [Lloyds Business] Extracted ${transactions.length} transactions`);
    return transactions;
  }

  /**
   * Parse a single transaction starting from the "Date" label
   */
  private parseTransaction(lines: string[], startIndex: number): Transaction | null {
    const i = startIndex;

    // Expect format:
    // Date
    // 01 Dec 25
    // Description
    // LNK NWB LUTON MKT CD 0447 29NOV25
    // Type
    // CPT
    // Money In (£)
    // blank.
    // Money Out (£)
    // 500.00
    // Balance (£)
    // 41,904.22

    if (lines[i].toLowerCase() !== 'date') {
      return null;
    }

    const dateValue = lines[i + 1]?.trim();
    if (!dateValue || !this.isValidDate(dateValue)) {
      return null;
    }

    const descLabel = lines[i + 2]?.toLowerCase().trim();
    if (descLabel !== 'description') {
      return null;
    }

    const description = lines[i + 3]?.trim();
    if (!description) {
      return null;
    }

    // Find Money In, Money Out, and Balance
    let moneyIn = 0;
    let moneyOut = 0;
    let balance: number | undefined;

    // Scan ahead for Money In/Out/Balance (they should be within next 15 lines)
    for (let j = i + 4; j < Math.min(i + 20, lines.length - 1); j++) {
      const label = lines[j].toLowerCase().trim();
      const value = lines[j + 1]?.trim() || '';

      if (label === 'money in (£)' || label === 'money in' || label.includes('moneyin')) {
        if (value.toLowerCase() !== 'blank' && value.toLowerCase() !== 'blank.' && value !== '') {
          const amount = this.parseAmount(value);
          if (!isNaN(amount) && amount > 0) {
            moneyIn = amount;
          }
        }
      } else if (label === 'money out (£)' || label === 'money out' || label.includes('moneyout')) {
        if (value.toLowerCase() !== 'blank' && value.toLowerCase() !== 'blank.' && value !== '') {
          const amount = this.parseAmount(value);
          if (!isNaN(amount) && amount > 0) {
            moneyOut = amount;
          }
        }
      } else if (label === 'balance (£)' || label === 'balance' || label.includes('balance')) {
        if (value.toLowerCase() !== 'blank' && value.toLowerCase() !== 'blank.' && value !== '') {
          const amount = this.parseAmount(value);
          if (!isNaN(amount)) {
            balance = amount;
          }
        }
        // Balance is typically the last field, so we can break here
        break;
      }
    }

    // Determine transaction type and amount
    let amount = 0;
    let type: 'credit' | 'debit' = 'debit';

    if (moneyIn > 0 && moneyOut === 0) {
      amount = moneyIn;
      type = 'credit';
    } else if (moneyOut > 0 && moneyIn === 0) {
      amount = moneyOut;
      type = 'debit';
    } else if (moneyIn > 0) {
      // If both are present (shouldn't happen), prefer money in
      amount = moneyIn;
      type = 'credit';
    } else if (moneyOut > 0) {
      amount = moneyOut;
      type = 'debit';
    }

    if (amount === 0) {
      console.log(`⚠️  [Lloyds Business] Skipping transaction with zero amount: ${description}`);
      return null;
    }

    const transaction: Transaction = {
      date: this.normalizeDate(dateValue),
      description: description,
      amount: amount,
      type: type,
      balance: balance
    };

    return transaction;
  }

  /**
   * Check if the text is from a Lloyds Business Account
   */
  private isLloydsBusinessAccount(text: string): boolean {
    const lowerText = text.toLowerCase();

    // Must contain Lloyds branding
    const hasLloyds = lowerText.includes('lloyds bank') ||
                      lowerText.includes('lloyds') && lowerText.includes('gresham street');

    // Must be business account
    const isBusiness = lowerText.includes('business account');

    // Should have the characteristic columnar format
    const hasColumnarFormat = lowerText.includes('your transactions') &&
                              lowerText.includes('money in') &&
                              lowerText.includes('money out');

    return hasLloyds && isBusiness && hasColumnarFormat;
  }

  /**
   * Check if a string looks like a valid date
   */
  private isValidDate(dateStr: string): boolean {
    // Lloyds format: "01 Dec 25" or "DD MMM YY"
    const pattern = /\d{1,2}\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{2,4}/i;
    return pattern.test(dateStr);
  }

  /**
   * Normalize date from "01 Dec 25" to "1/12/25"
   */
  private normalizeDate(dateStr: string): string {
    const months: Record<string, string> = {
      'jan': '1', 'feb': '2', 'mar': '3', 'apr': '4',
      'may': '5', 'jun': '6', 'jul': '7', 'aug': '8',
      'sep': '9', 'oct': '10', 'nov': '11', 'dec': '12'
    };

    const match = dateStr.match(/(\d{1,2})\s+([a-z]{3})\s+(\d{2,4})/i);
    if (match) {
      const day = parseInt(match[1]);
      const month = months[match[2].toLowerCase()];
      const year = match[3];
      return `${day}/${month}/${year}`;
    }

    return dateStr; // Return original if parsing fails
  }

  /**
   * Parse amount string to number
   */
  private parseAmount(amountStr: string): number {
    // Remove £, commas, and whitespace
    const cleaned = amountStr.replace(/[£,\s]/g, '');
    return parseFloat(cleaned);
  }
}
