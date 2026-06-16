import { Transaction } from "../types/index.js";

export interface CapitalOneSection {
  title: string;
  transactions: Transaction[];
}

export interface CapitalOneParsedData {
  sections: CapitalOneSection[];
  allTransactions: Transaction[]; // For backward compatibility
}

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
   * @returns Array of parsed transactions (for backward compatibility)
   */
  public parseStatement(text: string): Transaction[] {
    const result = this.parseStatementWithSections(text);
    return result.allTransactions;
  }

  /**
   * Parse Capital One statement text and return section-grouped data
   * @param text - The extracted text from the PDF
   * @returns Section-grouped transactions
   */
  public parseStatementWithSections(text: string): CapitalOneParsedData {
    console.log('🏦 [Capital One] Starting Capital One parser...');

    // Check if this is a Capital One statement
    if (!this.isCapitalOneStatement(text)) {
      console.log('⚠️  [Capital One] Not a Capital One statement - skipping');
      return { sections: [], allTransactions: [] };
    }

    console.log('✅ [Capital One] Detected Capital One statement format');

    const sections: CapitalOneSection[] = [];
    const allTransactions: Transaction[] = [];

    // Parse different sections
    const deposits = this.parseDeposits(text);
    const checks = this.parseChecks(text);
    const debitATM = this.parseDebitATM(text);
    const withdrawals = this.parseWithdrawals(text);

    // Add non-empty sections
    if (deposits.length > 0) {
      sections.push({ title: 'Deposits and Other Credits', transactions: deposits });
      allTransactions.push(...deposits);
    }

    if (checks.length > 0) {
      sections.push({ title: 'Checks', transactions: checks });
      allTransactions.push(...checks);
    }

    if (withdrawals.length > 0) {
      sections.push({ title: 'Withdrawals and Other Debits', transactions: withdrawals });
      allTransactions.push(...withdrawals);
    }

    if (debitATM.length > 0) {
      sections.push({ title: 'Debit/ATM Transactions', transactions: debitATM });
      allTransactions.push(...debitATM);
    }

    // Sort all transactions by date for backward compatibility
    allTransactions.sort((a, b) => {
      const dateA = this.parseDate(a.date);
      const dateB = this.parseDate(b.date);
      return dateA.getTime() - dateB.getTime();
    });

    console.log(`✅ [Capital One] Extracted ${allTransactions.length} transactions across ${sections.length} sections`);
    console.log(`   Sections: ${sections.map(s => `${s.title} (${s.transactions.length})`).join(', ')}`);

    return { sections, allTransactions };
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
   * Note: PDF may contain multiple months, so we parse ALL "Checks" sections
   */
  private parseChecks(text: string): Transaction[] {
    const transactions: Transaction[] = [];
    const lines = text.split('\n');

    // Find ALL checks sections (multi-month statements)
    let i = 0;
    let sectionCount = 0;

    while (i < lines.length) {
      // Look for "Checks" section header
      if (lines[i].match(/^Checks\s*$/i)) {
        sectionCount++;
        console.log(`📍 [Capital One] Found checks section #${sectionCount} at line ${i}`);

        // Skip header lines
        i++;
        while (i < lines.length && lines[i].match(/^(Date|Check No\.|Amount)/i)) {
          i++;
        }

        // Parse checks until we hit the next section
        while (i < lines.length) {
          const line = lines[i].trim();

          // Stop at next major section
          if (line.match(/^(Checks|Deposits|Withdrawals|Electronic|Service Charges|Interest|Account Summary|Platinum Business)/i)) {
            break;
          }

          // Skip empty lines
          if (!line) {
            i++;
            continue;
          }

          // Parse multi-column check format
          const checkTransactions = this.parseCheckLine(line);
          transactions.push(...checkTransactions);

          i++;
        }
      } else {
        i++;
      }
    }

    console.log(`✅ [Capital One Checks] Found ${sectionCount} check sections, total extracted: ${transactions.length} checks`);
    if (transactions.length > 0 && transactions.length <= 3) {
      console.log(`✅ [Capital One Checks] Sample transactions:`, transactions.slice(0, 3));
    }

    return transactions;
  }

  /**
   * Parse a check line with multiple columns
   * Supports two formats:
   * - Spaced: 02/02 488 $252.00 02/23 495 $84.00 (OCR/manual extraction)
   * - Condensed: 02/02488$252.00 02/23495$84.00 (PDF text extraction)
   * Note: Check number may have asterisk (490*) for checks not on statement
   */
  private parseCheckLine(line: string): Transaction[] {
    const transactions: Transaction[] = [];

    // Try spaced format first: MM/DD space checkNumber space $amount
    const spacedPattern = /(\d{2}\/\d{2})\s+(\d+\*?)\s+\$([0-9,]+\.\d{2})/g;
    let match;

    while ((match = spacedPattern.exec(line)) !== null) {
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

    // If no matches with spaced format, try condensed format
    if (transactions.length === 0) {
      console.log(`[Capital One Checks] Trying condensed pattern on: "${line.substring(0, 100)}"`);
      const condensedPattern = /(\d{2}\/\d{2})(\d+\*?)\$([0-9,]+\.\d{2})/g;

      while ((match = condensedPattern.exec(line)) !== null) {
        console.log(`[Capital One Checks] Condensed match: date=${match[1]}, checkNo=${match[2]}, amount=${match[3]}`);
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

      if (transactions.length === 0) {
        console.log(`[Capital One Checks] No matches found with condensed pattern`);
      }
    }

    return transactions;
  }

  /**
   * Parse "Platinum Business Debit/ATM" section
   * Format: Date | Amount | Description | Card No.
   * Example: 02/01 $515.00 FRANCO-POST POSTAGE 06308274998 IL 7955
   */
  private parseDebitATM(text: string): Transaction[] {
    const transactions: Transaction[] = [];
    const lines = text.split('\n');

    // Find the Debit/ATM section
    let startIndex = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].match(/Platinum Business Debit\/ATM/i)) {
        startIndex = i;
        console.log(`📍 [Capital One] Found Debit/ATM section at line ${i}`);
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

    // Parse debit/ATM transactions
    while (i < lines.length) {
      const line = lines[i].trim();

      // Stop at next major section
      if (line.match(/^(Checks|Deposits|Withdrawals|Service Charges|Interest|Account Summary)/i)) {
        break;
      }

      const dateMatch = line.match(/^(\d{2}\/\d{2})/);
      if (dateMatch) {
        const transaction = this.parseDebitATMLine(line, lines, i);
        if (transaction) {
          transactions.push(transaction);
        }
      }

      i++;
    }

    return transactions;
  }

  /**
   * Parse a single Debit/ATM line
   * Format: 02/01 $515.00 FRANCO-POST POSTAGE 06308274998 IL 7955
   */
  private parseDebitATMLine(line: string, lines: string[], index: number): Transaction | null {
    // Extract date (MM/DD)
    const dateMatch = line.match(/^(\d{2}\/\d{2})/);
    if (!dateMatch) return null;

    const date = dateMatch[1];

    // Extract amount - look for $XX,XXX.XX or $XXX.XX pattern
    const amountMatch = line.match(/\$([0-9,]+\.\d{2})/);
    if (!amountMatch) return null;

    const amount = parseFloat(amountMatch[1].replace(/,/g, ''));

    // Extract description - everything after the amount up to the card number
    let description = line.substring(line.indexOf(amountMatch[0]) + amountMatch[0].length).trim();

    // Remove card number if present (last 4 digits)
    description = description.replace(/\s+\d{4}$/, '').trim();

    // Clean up description
    description = description.replace(/Card No\./gi, '').trim();

    // Check if description continues on next line
    if (index + 1 < lines.length) {
      const nextLine = lines[index + 1].trim();
      if (nextLine && !nextLine.match(/^\d{2}\/\d{2}/) && !nextLine.match(/^(Checks|Withdrawals|Service|Deposits)/i)) {
        description += ' ' + nextLine;
      }
    }

    return {
      date,
      description: description || 'Debit/ATM',
      amount,
      type: 'debit',
      balance: 0
    };
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
      if (line.match(/^(Checks|Deposits|Service Charges|Interest|Account Summary|Platinum Business)/i)) {
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
