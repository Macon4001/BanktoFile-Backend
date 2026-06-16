import { Transaction } from "../types/index.js";

/**
 * Dedicated parser for Capital One bank statements
 *
 * Format structure:
 * - Account Summary section with previous balance, credits, debits
 * - "Deposits and Other Credits" section: Date | Amount | Description | Card No.
 * - "Checks" section: Multi-column layout with Date | Check No. | Amount (3 columns across)
 * - "Withdrawals and Other Debits" section: Similar to deposits
 */
export class CapitalOneParser {
  /**
   * Parse Capital One statement text
   * @param text - The extracted text from the PDF
   * @returns Array of parsed transactions
   */
  public parseStatement(text: string): Transaction[] {
    console.log('🏦 [Capital One] Starting Capital One parser...');

    // Check if this is a Capital One statement
    if (!this.isCapitalOneStatement(text)) {
      console.log('⚠️  [Capital One] Not a Capital One statement - skipping');
      return [];
    }

    console.log('✅ [Capital One] Detected Capital One statement format');

    const transactions: Transaction[] = [];

    // Parse different sections
    const deposits = this.parseDeposits(text);
    const checks = this.parseChecks(text);
    const withdrawals = this.parseWithdrawals(text);

    transactions.push(...deposits, ...checks, ...withdrawals);

    // Sort by date
    transactions.sort((a, b) => {
      const dateA = this.parseDate(a.date);
      const dateB = this.parseDate(b.date);
      return dateA.getTime() - dateB.getTime();
    });

    console.log(`✅ [Capital One] Extracted ${transactions.length} transactions (${deposits.length} deposits, ${checks.length} checks, ${withdrawals.length} withdrawals)`);
    return transactions;
  }

  /**
   * Check if text is from a Capital One statement
   */
  private isCapitalOneStatement(text: string): boolean {
    const lowerText = text.toLowerCase();
    return (
      (lowerText.includes('capital one') || lowerText.includes('capitalone')) &&
      (lowerText.includes('account summary') || lowerText.includes('deposits and other credits'))
    );
  }

  /**
   * Parse "Deposits and Other Credits" section
   */
  private parseDeposits(text: string): Transaction[] {
    const transactions: Transaction[] = [];
    const lines = text.split('\n');

    // Find the deposits section
    let startIndex = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].match(/Deposits and Other Credits/i)) {
        startIndex = i;
        console.log(`📍 [Capital One] Found deposits section at line ${i}`);
        break;
      }
    }

    if (startIndex === -1) {
      return transactions;
    }

    // Skip header lines (Date, Amount, Description, Card No.)
    let i = startIndex + 1;
    while (i < lines.length && lines[i].match(/^(Date|Amount|Description|Card No\.)/i)) {
      i++;
    }

    // Parse deposits until we hit the next section
    while (i < lines.length) {
      const line = lines[i].trim();

      // Stop at next major section
      if (line.match(/^(Checks|Withdrawals|Electronic Withdrawals|Service Charges|Interest)/i)) {
        break;
      }

      // Match date pattern at start of line (MM/DD format)
      const dateMatch = line.match(/^(\d{2}\/\d{2})/);
      if (dateMatch) {
        const transaction = this.parseDepositLine(line, lines, i);
        if (transaction) {
          transactions.push(transaction);
          if (transactions.length <= 3) {
            console.log(`✅ [Capital One Deposit] Transaction ${transactions.length}:`, transaction);
          }
        }
      }

      i++;
    }

    return transactions;
  }

  /**
   * Parse a single deposit line
   * Format: 07/13$19,185.12ACH deposit PAY MGT SYSTEM...
   */
  private parseDepositLine(line: string, lines: string[], index: number): Transaction | null {
    // Extract date (MM/DD)
    const dateMatch = line.match(/^(\d{2}\/\d{2})/);
    if (!dateMatch) return null;

    const date = dateMatch[1];

    // Extract amount - look for $XX,XXX.XX or $XXX.XX pattern
    const amountMatch = line.match(/\$([0-9,]+\.\d{2})/);
    if (!amountMatch) return null;

    const amount = parseFloat(amountMatch[1].replace(/,/g, ''));

    // Extract description - everything after the amount
    let description = line.substring(line.indexOf(amountMatch[0]) + amountMatch[0].length).trim();

    // Clean up description
    description = description.replace(/Card No\./gi, '').trim();

    // Check if description continues on next line (if next line doesn't start with date)
    if (index + 1 < lines.length) {
      const nextLine = lines[index + 1].trim();
      if (nextLine && !nextLine.match(/^\d{2}\/\d{2}/) && !nextLine.match(/^(Checks|Withdrawals|Service)/i)) {
        description += ' ' + nextLine;
      }
    }

    return {
      date,
      description: description || 'Deposit',
      amount,
      type: 'credit',
      balance: 0 // Capital One doesn't show running balance per transaction
    };
  }

  /**
   * Parse "Checks" section
   * Format: Three columns of Date | Check No. | Amount
   */
  private parseChecks(text: string): Transaction[] {
    const transactions: Transaction[] = [];
    const lines = text.split('\n');

    // Find the checks section
    let startIndex = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].match(/^Checks\s*$/i)) {
        startIndex = i;
        console.log(`📍 [Capital One] Found checks section at line ${i}`);
        break;
      }
    }

    if (startIndex === -1) {
      return transactions;
    }

    // Skip header lines
    let i = startIndex + 1;
    while (i < lines.length && lines[i].match(/^(Date|Check No\.|Amount)/i)) {
      i++;
    }

    // Parse checks until we hit the next section
    while (i < lines.length) {
      const line = lines[i].trim();

      // Stop at next major section
      if (line.match(/^(Deposits|Withdrawals|Electronic|Service Charges|Interest|Account Summary)/i)) {
        break;
      }

      // Parse multi-column check format
      // Example: 07/10314$2,436.0007/132391$279.0607/232401$669.22
      const checkTransactions = this.parseCheckLine(line);
      transactions.push(...checkTransactions);

      i++;
    }

    if (transactions.length <= 3) {
      console.log(`✅ [Capital One Checks] Sample transactions:`, transactions.slice(0, 3));
    }

    return transactions;
  }

  /**
   * Parse a check line with multiple columns
   * Format: 07/10314$2,436.0007/132391$279.0607/232401$669.22
   */
  private parseCheckLine(line: string): Transaction[] {
    const transactions: Transaction[] = [];

    // Match pattern: MM/DD followed by check number, then $amount
    const checkPattern = /(\d{2}\/\d{2})(\d+)\$([0-9,]+\.\d{2})/g;
    let match;

    while ((match = checkPattern.exec(line)) !== null) {
      const date = match[1];
      const checkNumber = match[2];
      const amount = parseFloat(match[3].replace(/,/g, ''));

      transactions.push({
        date,
        description: `Check ${checkNumber}`,
        amount,
        type: 'debit',
        balance: 0
      });
    }

    return transactions;
  }

  /**
   * Parse "Withdrawals and Other Debits" or "Electronic Withdrawals" section
   */
  private parseWithdrawals(text: string): Transaction[] {
    const transactions: Transaction[] = [];
    const lines = text.split('\n');

    // Find withdrawals section
    let startIndex = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].match(/(Withdrawals and Other Debits|Electronic Withdrawals)/i)) {
        startIndex = i;
        console.log(`📍 [Capital One] Found withdrawals section at line ${i}`);
        break;
      }
    }

    if (startIndex === -1) {
      return transactions;
    }

    // Skip header lines
    let i = startIndex + 1;
    while (i < lines.length && lines[i].match(/^(Date|Amount|Description|Card No\.)/i)) {
      i++;
    }

    // Parse withdrawals (same format as deposits)
    while (i < lines.length) {
      const line = lines[i].trim();

      // Stop at next major section
      if (line.match(/^(Checks|Deposits|Service Charges|Interest|Account Summary)/i)) {
        break;
      }

      const dateMatch = line.match(/^(\d{2}\/\d{2})/);
      if (dateMatch) {
        const transaction = this.parseWithdrawalLine(line, lines, i);
        if (transaction) {
          transactions.push(transaction);
        }
      }

      i++;
    }

    return transactions;
  }

  /**
   * Parse a single withdrawal line (same format as deposits but debit type)
   */
  private parseWithdrawalLine(line: string, lines: string[], index: number): Transaction | null {
    const depositTx = this.parseDepositLine(line, lines, index);
    if (depositTx) {
      return {
        ...depositTx,
        type: 'debit'
      };
    }
    return null;
  }

  /**
   * Parse MM/DD date to a Date object (assume current year)
   */
  private parseDate(dateStr: string): Date {
    const [month, day] = dateStr.split('/').map(Number);
    const currentYear = new Date().getFullYear();
    return new Date(currentYear, month - 1, day);
  }
}

// Export singleton instance
export const capitalOneParser = new CapitalOneParser();
