import * as pdfParse from "pdf-parse";
import { Transaction, ParsedStatement } from "../types/index.js";
import { MetroBankCoordinateParser } from "./metroBankCoordinateParser.js";
import { GenericCoordinateParser } from "./genericCoordinateParser.js";

export class PDFParser {
  private metroBankParser: MetroBankCoordinateParser;
  private genericCoordinateParser: GenericCoordinateParser;

  constructor() {
    this.metroBankParser = new MetroBankCoordinateParser();
    this.genericCoordinateParser = new GenericCoordinateParser();
  }
  async parsePDF(buffer: Buffer): Promise<ParsedStatement & { rawText: string; needsOCR?: boolean }> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = await (pdfParse as any).default(buffer);
      const text = data.text;

      console.log("PDF Text extracted (first 1000 chars):", text.substring(0, 1000)); // Debug log
      console.log("PDF Text length:", text.length); // Debug log
      console.log("PDF Number of pages:", data.numpages); // Debug log

      // Check if the PDF is likely image-based (scanned)
      const isScanned = this.isLikelyScannedPDF(text, data.numpages);

      if (isScanned) {
        console.log("⚠️  PDF appears to be scanned/image-based - will need OCR fallback");
        return {
          transactions: [],
          metadata: {},
          rawText: text,
          needsOCR: true,
        };
      }

      // Check if this is a Metro Bank statement - use coordinate-based parser
      // Metro Bank PDFs have chaotic text ordering that breaks text-based parsing
      if (text.includes("Metro Bank") || text.includes("MYMBGB2L") || (text.includes("MYMB") && text.includes("Cash Account Statement"))) {
        console.log("Detected Metro Bank statement - using coordinate-based parser");
        const transactions = await this.extractMetroBankTransactionsCoordinate(buffer, text);
        return {
          transactions,
          metadata: this.extractMetadata(text),
          rawText: text,
        };
      }

      // Extract transactions from the PDF text (for other banks)
      let transactions = this.extractTransactions(text);

      console.log(`Extracted ${transactions.length} transactions using text-based parsing`); // Debug log
      if (transactions.length > 0) {
        console.log("First transaction:", transactions[0]);
      }

      // Check if transactions look valid (proper date format)
      const hasValidTransactions = transactions.some(t => {
        // Valid date should have month name (most reliable)
        const hasMonthName = /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/i.test(t.date);

        // OR a numeric date with reasonable day/month values (not sort codes like 12-34-56)
        let isValidNumericDate = false;
        const numericMatch = t.date.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})$/);
        if (numericMatch) {
          const day = parseInt(numericMatch[1]);
          const month = parseInt(numericMatch[2]);
          // Reasonable ranges: day 1-31, month 1-12 (not 34, 56, etc.)
          isValidNumericDate = (day >= 1 && day <= 31) && (month >= 1 && month <= 12);
        }

        return hasMonthName || isValidNumericDate;
      });

      // If text-based parsing failed or produced invalid results, try coordinate-based fallback
      if ((transactions.length === 0 || !hasValidTransactions) && text.length > 100) {
        console.log("⚠️  Text-based parsing failed or produced invalid transactions - trying coordinate-based fallback");
        try {
          const coordinateTransactions = await this.genericCoordinateParser.parseStatement(buffer, false);
          if (coordinateTransactions.length > 0) {
            transactions = coordinateTransactions;
            console.log(`✓ Coordinate-based fallback extracted ${transactions.length} transactions`);
          }
        } catch (error) {
          console.error("Coordinate-based fallback also failed:", error);
        }
      }

      // If still no transactions found despite having text, might need OCR
      const needsOCR = transactions.length === 0 && text.length > 0;
      if (needsOCR) {
        console.log("⚠️  No transactions found - might need OCR fallback");
      }

      return {
        transactions,
        metadata: this.extractMetadata(text),
        rawText: text,
        needsOCR,
      };
    } catch (error) {
      console.error("Error parsing PDF:", error);
      throw new Error("Failed to parse PDF file");
    }
  }

  /**
   * Detect if a PDF is likely scanned/image-based
   * Heuristics:
   * - Very little text extracted relative to page count
   * - Text is mostly gibberish or random characters
   * - Text length is suspiciously short
   */
  private isLikelyScannedPDF(text: string, numPages: number): boolean {
    const textLength = text.trim().length;

    // Average characters per page for a typical text-based bank statement
    const avgCharsPerPage = 1000;
    const expectedTextLength = numPages * avgCharsPerPage;

    // If we got less than 20% of expected text, likely scanned
    if (textLength < expectedTextLength * 0.2) {
      console.log(`Text too short: ${textLength} chars for ${numPages} pages (expected ~${expectedTextLength})`);
      return true;
    }

    // Check for gibberish - too many non-alphanumeric characters
    const alphanumericCount = (text.match(/[a-zA-Z0-9]/g) || []).length;
    const alphanumericRatio = alphanumericCount / textLength;

    if (alphanumericRatio < 0.5) {
      console.log(`Too much gibberish: only ${(alphanumericRatio * 100).toFixed(1)}% alphanumeric`);
      return true;
    }

    return false;
  }

  private extractTransactions(text: string): Transaction[] {
    const transactions: Transaction[] = [];
    const lines = text.split("\n");

    // Check if this is a NatWest statement
    if (text.includes("National Westminster Bank") || text.includes("NATWEST") || text.includes("NatWest")) {
      console.log("Detected NatWest bank statement");
      return this.extractNatWestTransactions(text);
    }

    // Check if this is a Nationwide statement
    if (text.includes("Nationwide Building Society") || text.includes("FlexDirect") || text.includes("NAIAGB21")) {
      console.log("Detected Nationwide bank statement");
      return this.extractNationwideTransactions(text);
    }

    // Check if this is a Santander statement
    if (text.includes("Santander") || text.includes("ABBYGB2L")) {
      console.log("Detected Santander bank statement");
      return this.extractSantanderTransactions(text);
    }

    // Check if this is a Monzo statement
    if (text.includes("Monzo Bank Limited") || text.includes("monzo.com")) {
      console.log("Detected Monzo bank statement");
      return this.extractMonzoTransactions(text);
    }

    // Note: Metro Bank detection moved to parsePDF() method to use coordinate-based parser

    // Check if this is a Barclays statement
    if (text.includes("Barclays Bank") || text.includes("BARCLAYS") || text.includes("BUKBGB22")) {
      console.log("Detected Barclays bank statement");
      return this.extractBarclaysTransactions(text);
    }

    // Check if this is a Revolut statement
    if (text.includes("Revolut") || text.includes("REVOGB21") || text.includes("REVO009")) {
      console.log("Detected Revolut bank statement");
      return this.extractRevolutTransactions(text);
    }

    // Common date patterns (non-global for better matching)
    const datePatterns = [
      /\b(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})\b/, // MM/DD/YYYY or DD/MM/YYYY
      /\b(\d{4}[/-]\d{1,2}[/-]\d{1,2})\b/, // YYYY-MM-DD
      /\b(\w{3}\s+\d{1,2},?\s+\d{4})\b/i, // Jan 15, 2024
      /\b(\d{2}\/\d{2}\/\d{4})\b/, // DD/MM/YYYY strict
      /\b(\d{1,2}-\w{3}-\d{2,4})\b/i, // 15-Jan-2024
    ];

    // Amount pattern - improved to handle various formats
    const amountPattern = /(?:[-+]?\s*)?(?:\$|USD)?\s*([\d,]+\.?\d{0,2})/g;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line || line.length < 10) continue; // Skip very short lines

      // Skip header-like lines
      if (
        line.toLowerCase().includes("date") &&
        line.toLowerCase().includes("description") &&
        line.toLowerCase().includes("amount")
      ) {
        continue;
      }

      // Try to find date in the line
      let dateMatch: RegExpMatchArray | null = null;

      for (const pattern of datePatterns) {
        dateMatch = line.match(pattern);
        if (dateMatch) {
          break;
        }
      }

      if (!dateMatch) continue;

      // Extract amounts from the line
      const amounts: string[] = [];
      let amountMatch;
      const amountRegex = new RegExp(amountPattern.source, "g");

      while ((amountMatch = amountRegex.exec(line)) !== null) {
        amounts.push(amountMatch[0]);
      }

      if (amounts.length === 0) continue;

      // Extract description (text between date and first amount)
      const dateIndex = line.indexOf(dateMatch[0]);
      const firstAmountIndex = line.indexOf(amounts[0]);

      let description = line
        .substring(dateIndex + dateMatch[0].length, firstAmountIndex)
        .trim();

      // Clean up description
      description = description.replace(/\s+/g, " ").trim();

      // If description is empty, try to get it from the line
      if (!description && line.length > dateMatch[0].length + 10) {
        const parts = line.split(/\s{2,}/); // Split by multiple spaces
        if (parts.length >= 2) {
          description = parts[1];
        }
      }

      // Parse amount - look for debit/credit indicators
      let amount = 0;
      let type: string = "credit";

      // Check if line contains debit/credit or -/+ indicators
      const hasDebit = line.match(/\bdebit\b/i) || line.match(/\bdr\b/i);
      const hasCredit = line.match(/\bcredit\b/i) || line.match(/\bcr\b/i);

      // Find the main transaction amount (usually first significant amount)
      for (const amt of amounts) {
        const cleanAmt = amt.replace(/[$,\s]/g, "").trim();
        const parsedAmt = parseFloat(cleanAmt);

        if (!isNaN(parsedAmt) && parsedAmt > 0) {
          amount = parsedAmt;
          break;
        }
      }

      if (isNaN(amount) || amount === 0) continue;

      // Determine transaction type
      if (hasDebit || line.includes("-")) {
        type = "debit";
      } else if (hasCredit || line.includes("+")) {
        type = "credit";
      } else {
        // Heuristic: smaller amounts might be debits, larger might be credits
        type = amount < 1000 ? "debit" : "credit";
      }

      // Check for balance (last number is often the balance)
      let balance: number | undefined;
      if (amounts.length > 1) {
        const balanceStr = amounts[amounts.length - 1]
          .replace(/[$,\s]/g, "")
          .trim();
        const parsedBalance = parseFloat(balanceStr);
        if (!isNaN(parsedBalance) && parsedBalance !== amount) {
          balance = parsedBalance;
        }
      }

      transactions.push({
        date: dateMatch[0],
        description: description || "Transaction",
        amount: amount,
        balance,
        type,
      });
    }

    // If no transactions found, try a more lenient approach
    if (transactions.length === 0) {
      console.log("No transactions found with strict parsing, trying lenient mode...");
      return this.extractTransactionsLenient(text);
    }

    console.log(`Sample transaction:`, transactions[0]); // Debug first transaction

    return transactions;
  }

  // More lenient transaction extraction for various bank formats
  private extractTransactionsLenient(text: string): Transaction[] {
    const transactions: Transaction[] = [];
    const lines = text.split("\n");

    console.log(`Total lines in PDF: ${lines.length}`);

    // Find where transactions start (look for "Your Transactions" or similar headers)
    let transactionSectionStart = 0;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].toLowerCase();
      if (
        line.includes("your transactions") ||
        line.includes("transaction") && line.includes("date") ||
        line.includes("date") && line.includes("description")
      ) {
        transactionSectionStart = i;
        console.log(`Found transaction section at line ${i}: ${lines[i]}`);
        break;
      }
    }

    // Check if this is a columnar format (labels on separate lines)
    // Look for pattern: "Date\n01 Aug 25\nDescription\n..."
    const sampleLines = lines.slice(transactionSectionStart, transactionSectionStart + 20).join('\n').toLowerCase();
    const isColumnarFormat = sampleLines.includes('date\n') ||
                            sampleLines.includes('date.') ||
                            (sampleLines.includes('description') && sampleLines.includes('type'));

    if (isColumnarFormat) {
      console.log('Detected columnar format, using columnar parser');
      return this.extractTransactionsColumnar(lines, transactionSectionStart);
    }

    // Skip header lines after finding transaction section
    const startLine = transactionSectionStart + 5; // Skip a few header lines

    for (let i = startLine; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      // Skip lines that look like headers or footers
      if (
        line.toLowerCase().includes("page") ||
        line.toLowerCase().includes("column") ||
        line.toLowerCase().includes("sort code") ||
        line.toLowerCase().includes("balance on") ||
        line.toLowerCase().includes("money in") && line.toLowerCase().includes("money out")
      ) {
        continue;
      }

      // Look for dates in format like "01 Aug 25" or "01/08/2025"
      const dateMatch = line.match(/\b(\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{2,4}|\d{1,2}[/-]\d{1,2}[/-]\d{2,4})\b/i);
      if (!dateMatch) continue;

      // Get the rest of the line after the date
      const dateIndex = line.indexOf(dateMatch[0]);
      const afterDate = line.substring(dateIndex + dateMatch[0].length).trim();

      // Look for amounts with optional commas and decimals
      const amountMatches = afterDate.match(/\b(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)\b/g);
      if (!amountMatches || amountMatches.length === 0) continue;

      // Extract description (text before first amount)
      const firstAmountIndex = afterDate.indexOf(amountMatches[0]);
      let description = afterDate.substring(0, firstAmountIndex).trim();

      // Clean up description - remove common noise
      description = description
        .replace(/\b(TFR|DDR|DEB|CR|SO|BP|FPI|CHQ)\b/gi, '') // Remove transaction type codes
        .replace(/\s+/g, ' ')
        .trim();

      if (!description || description.length < 2) {
        description = "Transaction";
      }

      // Parse amounts
      let moneyIn = 0;
      let moneyOut = 0;
      let balance = 0;

      // Try to identify which number is which based on position
      if (amountMatches.length >= 1) {
        const amount1 = parseFloat(amountMatches[0].replace(/,/g, ''));

        if (amountMatches.length === 1) {
          // Only one amount - could be money in, out, or balance
          // Check if line contains "blank" which indicates no value
          if (line.toLowerCase().includes("blank")) {
            moneyOut = amount1;
          } else {
            moneyIn = amount1;
          }
        } else if (amountMatches.length === 2) {
          // Two amounts - likely amount and balance, or money in/out
          const amount2 = parseFloat(amountMatches[1].replace(/,/g, ''));
          moneyIn = amount1;
          balance = amount2;
        } else if (amountMatches.length >= 3) {
          // Three or more amounts - money in, money out, balance
          const amount2 = parseFloat(amountMatches[1].replace(/,/g, ''));
          const amount3 = parseFloat(amountMatches[2].replace(/,/g, ''));
          moneyIn = amount1;
          moneyOut = amount2;
          balance = amount3;
        }
      }

      // Determine transaction type and amount
      let amount = 0;
      let type: string = "debit";

      if (moneyIn > 0 && moneyOut === 0) {
        amount = moneyIn;
        type = "credit";
      } else if (moneyOut > 0 && moneyIn === 0) {
        amount = moneyOut;
        type = "debit";
      } else if (moneyIn > 0) {
        amount = moneyIn;
        type = "credit";
      }

      if (amount > 0 && description) {
        transactions.push({
          date: dateMatch[0],
          description: description,
          amount: amount,
          balance: balance > 0 ? balance : undefined,
          type: type,
        });
      }
    }

    console.log(`Lenient mode extracted ${transactions.length} transactions`);
    if (transactions.length > 0) {
      console.log("Sample transactions:", transactions.slice(0, 3));
    }
    return transactions;
  }

  // Extract transactions from columnar format (labels and values on separate lines)
  private extractTransactionsColumnar(lines: string[], startIndex: number): Transaction[] {
    const transactions: Transaction[] = [];
    let i = startIndex;

    // Skip header rows (Column, Date., Description., etc.)
    while (i < lines.length && (
      lines[i].toLowerCase().includes('column') ||
      lines[i].toLowerCase().includes('date.') ||
      lines[i].toLowerCase().includes('description.') ||
      lines[i].toLowerCase().includes('type.') ||
      lines[i].toLowerCase().includes('money in') ||
      lines[i].toLowerCase().includes('money out') ||
      lines[i].toLowerCase().includes('balance')
    )) {
      i++;
    }

    console.log(`Starting columnar parse at line ${i}`);

    // Now parse transactions - each transaction has 6 lines:
    // Date, 01 Aug 25, Description, M MUNIU, Type, TFR, Money In, 20.00, Money Out, blank, Balance, 68.64
    while (i < lines.length - 5) {
      const line1 = lines[i].trim().toLowerCase();
      const line2 = lines[i + 1]?.trim() || '';

      // Check if this looks like a transaction start
      if (line1 === 'date' || line1 === 'date.') {
        // line2 should be the date value
        const dateMatch = line2.match(/\b(\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{2,4})\b/i);

        if (dateMatch) {
          const date = dateMatch[0];
          let description = '';
          let moneyIn = 0;
          let moneyOut = 0;
          let balance = 0;

          // Parse the next fields
          let j = i + 2;
          while (j < i + 20 && j < lines.length) { // Look ahead up to 20 lines
            const label = lines[j].trim().toLowerCase();
            const value = lines[j + 1]?.trim() || '';

            if (label === 'description' || label === 'description.') {
              description = value;
              j += 2;
            } else if (label === 'type' || label === 'type.') {
              // Skip type for now
              j += 2;
            } else if (label.includes('money in')) {
              const amount = parseFloat(value.replace(/,/g, ''));
              if (!isNaN(amount)) moneyIn = amount;
              j += 2;
            } else if (label.includes('money out')) {
              if (value.toLowerCase() !== 'blank') {
                const amount = parseFloat(value.replace(/,/g, ''));
                if (!isNaN(amount)) moneyOut = amount;
              }
              j += 2;
            } else if (label.includes('balance')) {
              console.log(`Balance label found: "${label}", value: "${value}"`);
              if (value.toLowerCase() !== 'blank' && value.toLowerCase() !== '') {
                const cleanValue = value.replace(/[£,]/g, '').trim();
                const amount = parseFloat(cleanValue);
                console.log(`Parsed balance: cleanValue="${cleanValue}", amount=${amount}`);
                if (!isNaN(amount) && amount > 0) {
                  balance = amount;
                }
              }
              j += 2;
              break; // Balance is usually the last field
            } else if (label === 'date' || label === 'date.') {
              // Next transaction starting
              break;
            } else {
              j++;
            }
          }

          // Determine amount and type
          let amount = 0;
          let type: string = 'debit';

          if (moneyIn > 0 && moneyOut === 0) {
            amount = moneyIn;
            type = 'credit';
          } else if (moneyOut > 0 && moneyIn === 0) {
            amount = moneyOut;
            type = 'debit';
          } else if (moneyIn > 0) {
            amount = moneyIn;
            type = 'credit';
          } else if (moneyOut > 0) {
            amount = moneyOut;
            type = 'debit';
          }

          if (amount > 0 && description) {
            const transaction = {
              date: date,
              description: description,
              amount: amount,
              balance: balance > 0 ? balance : undefined,
              type: type,
            };

            // Debug log for first few transactions
            if (transactions.length < 3) {
              console.log(`Transaction ${transactions.length + 1}:`, {
                date,
                description,
                moneyIn,
                moneyOut,
                balance,
                type
              });
            }

            transactions.push(transaction);
          }

          // Move to next transaction
          i = j;
        } else {
          i++;
        }
      } else {
        i++;
      }
    }

    console.log(`Columnar mode extracted ${transactions.length} transactions`);
    if (transactions.length > 0) {
      console.log("Sample columnar transactions:", transactions.slice(0, 3));
    }
    return transactions;
  }

  // Extract transactions from Monzo bank statements
  private extractMonzoTransactions(text: string): Transaction[] {
    const transactions: Transaction[] = [];
    const lines = text.split("\n");

    console.log("Parsing Monzo statement...");

    // Find the transaction table section
    // Monzo format: Date Description (GBP) Amount (GBP) Balance
    let inTransactionSection = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      // Start of transaction section - look for header with Date and Description
      if ((line.includes("Date") || line.includes("DateDescription")) &&
          (line.includes("Amount") || line.includes("Balance"))) {
        inTransactionSection = true;
        console.log(`Found Monzo transaction section at line ${i}: "${line}"`);
        continue;
      }

      // End of transaction section (footer)
      if (inTransactionSection && (
        line.includes("Monzo Bank Limited") ||
        line.includes("Registered Office") ||
        line.includes("Financial Services Register") ||
        line.includes("Sort code:")
      )) {
        inTransactionSection = false;
        console.log("Reached end of transaction section");
        break;
      }

      // Skip non-transaction lines
      if (!inTransactionSection || !line) continue;

      // Monzo transaction line format: DD/MM/YYYY Description +/-Amount Balance
      // Pattern 1: Date at start with or without space: "12/01/2025PUMPGYMS..."
      // Pattern 2: Multi-line transactions where description continues
      const dateMatch = line.match(/^(\d{2}\/\d{2}\/\d{4})(.*)$/);

      if (dateMatch) {
        const date = dateMatch[1];
        let restOfLine = dateMatch[2];

        // Check if next lines are part of this transaction (continuation lines)
        let j = i + 1;
        while (j < lines.length && lines[j].trim() && !lines[j].match(/^\d{2}\/\d{2}\/\d{4}/)) {
          restOfLine += " " + lines[j].trim();
          j++;
        }

        console.log(`Processing transaction line: "${date}${restOfLine.substring(0, 100)}..."`);

        // Extract amounts - look for pattern like "-20.99" or "0.30" followed by balance
        // The pattern is: [amount][balance] at the end
        const numberMatches = restOfLine.match(/[-+]?\d+\.\d{2}/g);

        if (numberMatches && numberMatches.length >= 2) {
          console.log(`Found ${numberMatches.length} numbers:`, numberMatches);

          // Get transaction amount and balance (last two numbers)
          const amountStr = numberMatches[numberMatches.length - 2];
          const balanceStr = numberMatches[numberMatches.length - 1];

          const amount = Math.abs(parseFloat(amountStr));
          const balance = parseFloat(balanceStr);

          // Determine if it's debit or credit based on the sign
          const isDebit = amountStr.startsWith('-');
          const type = isDebit ? 'debit' : 'credit';

          // Extract description (everything between date and the last two numbers)
          // Find where the amount starts in the string
          const amountIndex = restOfLine.lastIndexOf(amountStr);

          let description = restOfLine.substring(0, amountIndex).trim();

          // Clean up description - remove "GBR" and extra spaces
          description = description
            .replace(/\s*GBR\s*/gi, ' ')
            .replace(/\s+/g, ' ')
            .trim();

          if (description && amount >= 0) {
            transactions.push({
              date,
              description,
              amount,
              balance,
              type,
            });

            console.log(`✓ Extracted: ${date} | ${description} | ${type} £${amount} | Balance: £${balance}`);
          }

          // Skip the continuation lines we already processed
          i = j - 1;
        } else {
          console.log(`Skipping line - not enough numbers found`);
        }
      }
    }

    console.log(`Extracted ${transactions.length} Monzo transactions`);
    return transactions;
  }

  // Extract transactions from NatWest bank statements
  private extractNatWestTransactions(text: string): Transaction[] {
    const transactions: Transaction[] = [];
    const lines = text.split('\n');

    console.log('Parsing NatWest statement...');

    // NatWest date pattern: "DD MMM" (year is NOT on transaction lines, only on period header)
    // Examples: "08 SEP", "10 SEP", "11 SEP"
    const natWestDatePattern = /^(\d{1,2}\s+(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC))\s+(.+)/i;

    // Extract year from the statement period
    let statementYear = '2025'; // Default
    const yearMatch = text.match(/Period Covered.*?(\d{4})/i);
    if (yearMatch) {
      statementYear = yearMatch[1];
      console.log(`Found statement year: ${statementYear}`);
    }

    // Track the current date for transactions without date prefix
    let currentDate = '';

    // Parse line by line looking for dates
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      // Skip empty lines and headers/footers
      if (!line ||
          line.includes('National Westminster Bank') ||
          line.includes('Account Name') ||
          line.includes('Date Description Paid In') ||
          line.includes('RETSTMT') ||
          line.includes('Sort Code') ||
          line.includes('Statement Date') ||
          line.includes('Period Covered') ||
          line.includes('Previous Balance') ||
          line.includes('Paid In(£)') ||
          line.includes('Withdrawn(£)') ||
          line.includes('New Balance') ||
          line.includes('BIC NWBKGB') ||
          line.includes('IBAN GB') ||
          line.includes('Overdraft Limit') ||
          line.includes('Overdraft Rate') ||
          line.includes('Debit interest details') ||
          line.includes('Credit interest details') ||
          line.includes('Interest Rate') ||
          line.includes('AER') ||
          line.includes('Welcome to your') ||
          line.includes('www.natwest.com') ||
          line.includes('Over £') || // Skip overdraft usage lines like "Over £0"
          line.match(/^\d+ of \d+$/) ||
          line.match(/^Page No$/i) ||
          line.match(/^\d{6,}\s+\d{2}-\d{2}-\d{2}/) || // Skip lines like "62089331 60-02-13"
          line.match(/\d+\.\d+%$/)) { // Skip lines ending with percentages like "33.75%"
        continue;
      }

      // Handle BROUGHT FORWARD separately
      if (line.includes('BROUGHT FORWARD')) {
        const broughtForwardMatch = line.match(/(\d{1,2}\s+(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC))\s+.*?BROUGHT FORWARD.*?([\d,]+\.?\d{0,2})/i);
        if (broughtForwardMatch) {
          const dateWithoutYear = broughtForwardMatch[1];
          currentDate = `${dateWithoutYear} ${statementYear}`;
          const balance = parseFloat(broughtForwardMatch[2].replace(/,/g, ''));

          transactions.push({
            date: currentDate,
            description: 'BROUGHT FORWARD',
            amount: 0,
            balance,
            type: 'brought_forward',
          });

          console.log(`✓ ${currentDate} | BROUGHT FORWARD | Opening Balance: £${balance}`);
        }
        continue;
      }

      const dateMatch = line.match(natWestDatePattern);

      if (dateMatch) {
        // This line has a date - update current date
        currentDate = `${dateMatch[1]} ${statementYear}`;
        console.log(`Found dated transaction: ${currentDate} - ${line.substring(0, 60)}...`);
        const dateWithoutYear = dateMatch[1];
        const fullDate = `${dateWithoutYear} ${statementYear}`;
        const description = dateMatch[2].trim();

        // Collect continuation lines for this transaction
        let j = i + 1;
        let fullText = description;

        while (j < lines.length) {
          const nextLine = lines[j].trim();

          // Stop if we hit another date or footer
          if (!nextLine ||
              nextLine.match(natWestDatePattern) ||
              nextLine.includes('National Westminster Bank') ||
              nextLine.includes('Account Name') ||
              nextLine.match(/^\d+ of \d+$/)) {
            break;
          }

          // Stop if this line looks like a new transaction (has transaction keywords at start)
          if (nextLine.match(/^(Card Transaction|Direct Debit|OnLine Transaction|Standing Order|Cash Withdrawal|Automated Credit|Charges)/i)) {
            break;
          }

          fullText += ' ' + nextLine;
          j++;
        }

        // Extract all numbers (amounts and balances)
        const numbers = fullText.match(/\d{1,3}(?:,\d{3})*(?:\.\d{2})/g);

        if (numbers && numbers.length >= 1) {
          const amounts = numbers.map(n => parseFloat(n.replace(/,/g, '')));

          // Find the description (everything before first number)
          const firstNumberIndex = fullText.indexOf(numbers[0]);
          let desc = fullText.substring(0, firstNumberIndex).trim();

          // NatWest format has 3 columns: Paid In(£), Withdrawn(£), Balance(£)
          // Last number is ALWAYS the balance
          let paidIn = 0;
          let withdrawn = 0;
          let balance = amounts[amounts.length - 1];
          let amount = 0;
          let type: 'credit' | 'debit' = 'debit';

          if (amounts.length === 2) {
            // Format: [amount] [balance]
            // Determine if it's paid in or withdrawn from keywords
            amount = amounts[0];
            const lower = desc.toLowerCase();
            if (lower.includes('automated credit') ||
                lower.includes('online transaction from') ||
                lower.includes('paid in')) {
              paidIn = amount;
              type = 'credit';
            } else {
              withdrawn = amount;
              type = 'debit';
            }
          } else if (amounts.length === 3) {
            // Format: [paidIn] [withdrawn] [balance]
            paidIn = amounts[0];
            withdrawn = amounts[1];
            balance = amounts[2];

            // Use whichever is non-zero as the transaction amount
            if (paidIn > 0) {
              amount = paidIn;
              type = 'credit';
            } else if (withdrawn > 0) {
              amount = withdrawn;
              type = 'debit';
            }
          } else if (amounts.length === 1) {
            // Just a balance - skip this line
            continue;
          }

          // Clean description
          desc = desc
            .replace(/\s+/g, ' ')
            .replace(/FP\s+\d{2}\/\d{2}\/\d{2}\s+\d+\s+\w+/g, '')
            .replace(/\b\d{10,}\b/g, '')
            .trim();

          if (amount > 0 && desc) {
            transactions.push({
              date: fullDate,
              description: desc,
              amount,
              balance,
              type,
            });

            if (transactions.length <= 5) {
              console.log(`✓ ${fullDate} | ${desc.substring(0, 30)} | ${type} £${amount} | Bal: £${balance}`);
            }
          }
        }

        // Skip to the line after this transaction
        i = j - 1;
      } else if (currentDate) {
        // This line has NO date prefix - it's a continuation transaction on the same date
        // Example: "Direct Debit BLACK HORSE  226.47 371.36"
        let fullText = line;

        // Collect continuation lines
        let j = i + 1;
        while (j < lines.length) {
          const nextLine = lines[j].trim();

          // Stop if we hit a new date or footer
          if (!nextLine ||
              nextLine.match(natWestDatePattern) ||
              nextLine.includes('National Westminster Bank') ||
              nextLine.includes('Account Name') ||
              nextLine.match(/^\d+ of \d+$/)) {
            break;
          }

          // Stop if this line looks like a new transaction
          if (nextLine.match(/^(Card Transaction|Direct Debit|OnLine Transaction|Standing Order|Cash Withdrawal|Automated Credit|Charges)/i)) {
            break;
          }

          fullText += ' ' + nextLine;
          j++;
        }

        // Extract numbers
        const numbers = fullText.match(/\d{1,3}(?:,\d{3})*(?:\.\d{2})/g);

        if (numbers && numbers.length >= 2) {
          const amounts = numbers.map(n => parseFloat(n.replace(/,/g, '')));

          // Find description
          const firstNumberIndex = fullText.indexOf(numbers[0]);
          let desc = fullText.substring(0, firstNumberIndex).trim();

          // Parse amounts
          let paidIn = 0;
          let withdrawn = 0;
          let balance = amounts[amounts.length - 1];
          let amount = 0;
          let type: 'credit' | 'debit' = 'debit';

          if (amounts.length === 2) {
            amount = amounts[0];
            const lower = desc.toLowerCase();
            if (lower.includes('automated credit') ||
                lower.includes('online transaction from') ||
                lower.includes('paid in')) {
              paidIn = amount;
              type = 'credit';
            } else {
              withdrawn = amount;
              type = 'debit';
            }
          } else if (amounts.length === 3) {
            paidIn = amounts[0];
            withdrawn = amounts[1];
            balance = amounts[2];

            if (paidIn > 0) {
              amount = paidIn;
              type = 'credit';
            } else if (withdrawn > 0) {
              amount = withdrawn;
              type = 'debit';
            }
          }

          // Clean description
          desc = desc
            .replace(/\s+/g, ' ')
            .replace(/FP\s+\d{2}\/\d{2}\/\d{2}\s+\d+\s+\w+/g, '')
            .replace(/\b\d{10,}\b/g, '')
            .trim();

          if (amount > 0 && desc) {
            transactions.push({
              date: currentDate,
              description: desc,
              amount,
              balance,
              type,
            });

            if (transactions.length <= 5) {
              console.log(`✓ ${currentDate} | ${desc.substring(0, 30)} | ${type} £${amount} | Bal: £${balance}`);
            }
          }
        }

        i = j - 1;
      }
    }

    console.log(`Extracted ${transactions.length} NatWest transactions`);
    return transactions;
  }

  private extractNationwideTransactions(text: string): Transaction[] {
    const transactions: Transaction[] = [];
    const lines = text.split('\n');

    console.log('Parsing Nationwide statement...');

    // Nationwide date pattern: "DD MMM" (e.g., "07 Feb" or "07Feb" with no space)
    const nationwideDatePattern = /^(\d{1,2}\s*(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec))\s*(.+)/i;

    // Extract year from statement - try multiple patterns
    let statementYear = new Date().getFullYear().toString(); // Default to current year

    // Try different patterns to find the year
    const yearPatterns = [
      /Statement\s+date\s+(\d{2})\/(\d{2})\/(\d{4})/i,  // "Statement date DD/MM/YYYY"
      /dated\s+(\d{2})\/(\d{2})\/(\d{4})/i,             // "dated DD/MM/YYYY"
      /\b(\d{4})\s*Balance from statement/i,            // "2020 Balance from statement"
      /Statement\s+\d{1,2}\s+\w+\s+(\d{4})/i            // "Statement DD Month YYYY"
    ];

    for (const pattern of yearPatterns) {
      const match = text.match(pattern);
      if (match) {
        // Get the year - it's the last capture group in all patterns
        statementYear = match[match.length - 1];
        console.log(`Found statement year: ${statementYear} using pattern: ${pattern}`);
        break;
      }
    }

    // Track current date for multi-line descriptions
    let currentDate = '';

    // Parse line by line
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      // Skip empty lines and headers/footers
      if (!line ||
          line.includes('Nationwide Building Society') ||
          line.includes('FlexDirect') ||
          line.includes('Statement no') ||
          line.includes('Sort code') ||
          line.includes('Account no') ||
          line.includes('Start balance') ||
          line.includes('End balance') ||
          line.includes('£ Out') ||
          line.includes('£ In') ||
          line.includes('£ Balance') ||
          line.includes('Average credit') ||
          line.includes('Average debit') ||
          line.includes('BIC') ||
          line.includes('IBAN') ||
          line.includes('Swift') ||
          line.includes('Intermediary Bank') ||
          line.includes('NAIAGB') ||
          line.includes('MIDLGB') ||
          line.includes('Prudential Regulation') ||
          line.includes('Financial Conduct') ||
          line.includes('Head Office') ||
          line.includes('DC83') ||
          line.includes('DC85') ||
          line.includes('Interest, Rates and Fees') ||
          line.includes('Summary box') ||
          line.includes('AER') ||
          line.includes('Gross p.a') ||
          line.includes('arranged overdraft') ||
          line.includes('overdraft interest') ||
          line.includes('SEPA') ||
          line.includes('CHAPS') ||
          line.includes('SWIFT') ||
          line.includes('visa.co.uk') ||
          line.includes('nationwide.co.uk') ||
          line.includes('Receiving money') ||
          line.includes('Sending money') ||
          line.match(/^\d{4}$/) || // Skip year-only lines
          line.match(/^Balance$/i)) {
        continue;
      }

      // Handle opening balance specially
      // Format: "2025Balance from statement 47 dated 05/02/2025313.41" (may have no spaces)
      if (line.includes('Balance from statement') && line.includes('dated')) {
        // Match the date pattern first: dated DD/MM/YYYY
        const dateMatch = line.match(/dated\s*(\d{2})\/(\d{2})\/(\d{4})/i);

        if (dateMatch) {
          // Everything after the year in the date is the balance
          const afterDateMatch = line.match(/dated\s*\d{2}\/\d{2}\/\d{4}([\d,]+\.?\d{0,2})/i);

          if (afterDateMatch) {
            const balance = parseFloat(afterDateMatch[1].replace(/,/g, ''));
            const day = dateMatch[1];
            const month = dateMatch[2];
            const year = dateMatch[3];
            const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
            const monthName = monthNames[parseInt(month) - 1];
            currentDate = `${day} ${monthName} ${year}`;

            transactions.push({
              date: currentDate,
              description: 'BROUGHT FORWARD',
              amount: 0,
              balance,
              type: 'brought_forward',
            });

            console.log(`✓ Opening Balance: £${balance} on ${currentDate}`);
          }
        }
        continue;
      }

      // Check if this line starts with a date
      const dateMatch = line.match(nationwideDatePattern);

      if (dateMatch) {
        // This line has a date - it's a transaction
        const dateWithoutYear = dateMatch[1];
        currentDate = `${dateWithoutYear} ${statementYear}`;
        const restOfLine = dateMatch[2].trim();

        console.log(`Found dated line: ${currentDate} - ${line.substring(0, 60)}...`);

        // Process this line as a transaction
        this.processNationwideLine(restOfLine, currentDate, transactions);
      } else if (currentDate && line.match(/^[A-Z]/)) {
        // No date prefix, but line starts with uppercase letter
        // This is likely a same-day transaction (shares date with previous line)
        // Example: "ADIDAS FELTHAM GB 72.70 20,210.80"
        console.log(`Found same-day transaction: ${line.substring(0, 60)}...`);
        this.processNationwideLine(line, currentDate, transactions);
      }
    }

    console.log(`Extracted ${transactions.length} Nationwide transactions`);
    return transactions;
  }

  private processNationwideLine(line: string, currentDate: string, transactions: Transaction[]): void {
    // Nationwide format: "Description Out In Balance" or "Description Amount Balance"
    // Extract all numbers - but filter out account numbers and reference numbers
    const allNumbers = line.match(/[\d,]+\.?\d{0,2}/g);

    if (!allNumbers || allNumbers.length === 0) return;

    // Filter to get only monetary amounts (have decimal points OR are reasonable transaction amounts)
    // Account numbers are typically 8 digits, sort codes are 6 digits (shown as XX-XX-XX)
    // Reference numbers can be very long (e.g., 33212269001)
    const numbers = allNumbers.filter(num => {
      const value = parseFloat(num.replace(/,/g, ''));
      // Keep if it has decimal point OR is a reasonable transaction/balance amount (< 1,000,000)
      // This filters out account numbers like 60408617 and refs like 33212269001
      return num.includes('.') || value < 1000000;
    });

    if (numbers.length === 0) return;

    const amounts = numbers.map(n => parseFloat(n.replace(/,/g, '')));

    // Find where the first monetary amount appears (not account number)
    const firstNumberIndex = line.indexOf(numbers[0]);
    let desc = line.substring(0, firstNumberIndex).trim();

    // Determine transaction type based on number count and position
    let out = 0;
    let inAmount = 0;
    let balance = 0;
    let amount = 0;
    let type: 'credit' | 'debit' = 'debit';

    if (amounts.length === 1) {
      // Only balance (no transaction amount)
      balance = amounts[0];
      return; // Skip lines with only balance
    } else if (amounts.length === 2) {
      // Either Out+Balance or In+Balance
      amount = amounts[0];
      balance = amounts[1];

      // Check if description suggests credit
      const lower = desc.toLowerCase();
      if (lower.includes('bank credit') ||
          lower.includes('automated credit') ||
          lower.includes('credit transfer') ||
          lower.includes('transfer from') ||
          lower.includes('paid in')) {
        inAmount = amount;
        type = 'credit';
      } else if (lower.includes('transfer to')) {
        out = amount;
        type = 'debit';
      } else {
        out = amount;
        type = 'debit';
      }
    } else if (amounts.length === 3) {
      // Out, In, Balance
      out = amounts[0];
      inAmount = amounts[1];
      balance = amounts[2];

      if (inAmount > 0) {
        amount = inAmount;
        type = 'credit';
      } else if (out > 0) {
        amount = out;
        type = 'debit';
      }
    }

    // Clean description
    desc = desc
      .replace(/\s+/g, ' ')
      .replace(/\bJT bal VW\b/gi, '') // Remove Nationwide-specific codes
      .trim();

    if (amount > 0 && desc) {
      transactions.push({
        date: currentDate,
        description: desc,
        amount,
        balance,
        type,
      });

      if (transactions.length <= 10) {
        console.log(`✓ ${currentDate} | ${desc.substring(0, 30)} | ${type} £${amount} | Bal: £${balance}`);
      }
    }
  }

  private extractSantanderTransactions(text: string): Transaction[] {
    const transactions: Transaction[] = [];
    const lines = text.split('\n');

    console.log('Parsing Santander statement...');

    // Santander date pattern: "16th Sep", "1st Oct" (ordinal + month, may have no space after month)
    const santanderDatePattern = /^(\d{1,2}(?:st|nd|rd|th)\s*(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec))(.+)/i;

    // Extract year from "Your account summary for DDth MMM YYYY to DDth MMM YYYY"
    let statementYear = '2025'; // Default
    const yearMatch = text.match(/Your account summary for.*?(\d{4})/i);
    if (yearMatch) {
      statementYear = yearMatch[1];
      console.log(`Found statement year: ${statementYear}`);
    }

    // Track current date for multi-line descriptions
    let currentDate = '';

    // Parse line by line
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      // Skip empty lines and headers/footers
      if (!line ||
          line.includes('Santander UK plc') ||
          line.includes('Santander Banking') ||
          line.includes('Everyday Current Account') ||
          line.includes('Telephone Banking') ||
          line.includes('www.santander.co.uk') ||
          line.includes('Your account summary for') ||
          line.includes('Account name') ||
          line.includes('Account number') ||
          line.includes('Sort Code') ||
          line.includes('Statement number') ||
          line.includes('BIC:') ||
          line.includes('IBAN:') ||
          line.includes('ABBY') ||
          line.includes('Total money in') ||
          line.includes('Total money out') ||
          line.includes('Your balance at close') ||
          line.includes('Credit interest rate') ||
          line.includes('Online, Mobile and Telephone') ||
          line.includes('News and information') ||
          line.includes('Keeping your money safe') ||
          line.includes('Interest and refunds') ||
          line.includes('Important messages') ||
          line.includes('compensation arrangements') ||
          line.includes('Financial Services Compensation') ||
          line.includes('Financial Ombudsman') ||
          line.includes('Prudential Regulation') ||
          line.includes('Financial Conduct') ||
          line.includes('Registered Office') ||
          line.includes('Registered Number') ||
          line.includes('flame logo') ||
          line.includes('AER') ||
          line.includes('EAR') ||
          line.includes('gross rate') ||
          line.includes('Average balance') ||
          line.includes('Money in') && line.includes('Money out') ||
          line.includes('Money in Money out') ||
          line.includes('Date Description Money') ||
          line.includes('Your transactions') ||
          line.includes('Continued on reverse') ||
          line.includes('Why we are paying you') ||
          line.match(/^Page number/i) ||
          line.match(/^\d{15,}$/) || // Skip long number sequences
          line.match(/^BX\d+/) || // Skip Santander document IDs
          line.match(/^%%SSC/)) {
        continue;
      }

      // Handle opening balance specially
      // Format: "Balance brought forward from 15th Sep Statement£128.19" (may have no space before £)
      // or "16th Sep Balance brought forward from previous statement 128.19"
      if (line.includes('Balance brought forward')) {
        // Try to extract date from start of line OR from "from DDth MMM" pattern
        let balanceDate = '';
        const startDateMatch = line.match(/^(\d{1,2}(?:st|nd|rd|th)\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec))/i);
        if (startDateMatch) {
          balanceDate = `${startDateMatch[1].replace(/(\d+)(?:st|nd|rd|th)/, '$1')} ${statementYear}`;
        } else {
          // Try to extract from "from DDth MMM" pattern
          const fromDateMatch = line.match(/from\s+(\d{1,2}(?:st|nd|rd|th))\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i);
          if (fromDateMatch) {
            const day = fromDateMatch[1].replace(/(?:st|nd|rd|th)/, '');
            const month = fromDateMatch[2];
            balanceDate = `${day} ${month} ${statementYear}`;
          }
        }

        // Balance is the last number on the line (may be preceded by £ or have no space)
        // Handle formats: "Statement 128.19" or "Statement£128.19"
        const balanceMatch = line.match(/[£]?([\d,]+\.?\d{0,2})$/);
        if (balanceMatch) {
          const balance = parseFloat(balanceMatch[1].replace(/,/g, ''));

          transactions.push({
            date: balanceDate || statementYear,
            description: 'BROUGHT FORWARD',
            amount: 0,
            balance,
            type: 'brought_forward',
          });

          console.log(`✓ Opening Balance: £${balance} on ${balanceDate || statementYear}`);
        }
        continue;
      }

      // Handle "Balance carried forward" at the end
      if (line.includes('Balance carried forward')) {
        continue;
      }

      // Check if this line starts with a date
      const dateMatch = line.match(santanderDatePattern);

      if (dateMatch) {
        // Skip lines that are part of the date range header (e.g., "16th Sep 2025 to 15th Oct 2025")
        if (line.includes(' to ') && line.includes(statementYear)) {
          console.log(`Skipping date range header: ${line}`);
          continue;
        }

        // This line has a date - it's a transaction
        const dateWithoutYear = dateMatch[1];
        // Normalize the date by removing ordinal suffixes
        const normalizedDate = dateWithoutYear.replace(/(\d+)(?:st|nd|rd|th)/, '$1');
        currentDate = `${normalizedDate} ${statementYear}`;
        const description = dateMatch[2].trim();

        console.log(`Found dated transaction: ${currentDate} - ${description.substring(0, 60)}...`);

        // Collect continuation lines for multi-line transactions
        let j = i + 1;
        let fullText = description;

        while (j < lines.length) {
          const nextLine = lines[j].trim();

          // Stop if we hit another date or end of transactions
          if (!nextLine ||
              nextLine.match(santanderDatePattern) ||
              nextLine.includes('Balance carried forward') ||
              nextLine.includes('Average balance')) {
            break;
          }

          fullText += ' ' + nextLine;
          j++;
        }

        // Santander format: "DDth MMM Description MoneyIn MoneyOut Balance"
        console.log(`\n=== PROCESSING TRANSACTION ===`);
        console.log(`Date: ${currentDate}`);
        console.log(`Original fullText: "${fullText}"`);

        // First, split concatenated decimal numbers BEFORE removing anything
        // This handles cases like "00262.97125.22" -> "00262.97 125.22"
        // Look for pattern: digit.XX followed by 1-4 digits and a decimal point
        let cleanedText = fullText.replace(/(\.\d{2})(\d{1,4}\.\d{2})/g, '$1 $2');
        console.log(`After splitting concatenated numbers: "${cleanedText}"`);

        // Now clean up the text - remove MANDATE NO and REF codes
        // IMPORTANT: Use word boundaries to avoid removing parts of decimal numbers
        cleanedText = cleanedText
          .replace(/MANDATE NO\s+\d+(?!\.\d)/gi, ' ') // Remove mandate number but not if followed by decimal
          .replace(/REF\s+[A-Z0-9]+/gi, ' ') // Replace with space
          .replace(/\d{2}-\d{2}-\d{4}/g, ' ') // Replace dates with space
          .replace(/ON\s+\d{2}-\d{2}-\d{4}/gi, ' '); // Replace date references

        console.log(`After cleaning text: "${cleanedText}"`);

        // Extract ALL numbers with 2 decimal places
        const numbers = cleanedText.match(/\d{1,4}\.\d{2}/g) || [];

        console.log(`Found ${numbers.length} numbers:`, numbers);

        if (numbers && numbers.length >= 1) {
          const amounts = numbers.map(n => parseFloat(n.replace(/,/g, '')));

          // Find where the first number appears in the ORIGINAL fullText (for description)
          const firstNumberMatch = fullText.match(/[\d,]+\.?\d{0,2}/);
          const firstNumberIndex = firstNumberMatch ? fullText.indexOf(firstNumberMatch[0]) : fullText.length;
          let desc = fullText.substring(0, firstNumberIndex).trim();

          // Determine transaction type based on number count
          let moneyIn = 0;
          let moneyOut = 0;
          let balance = 0;
          let amount = 0;
          let type: 'credit' | 'debit' = 'debit';

          if (amounts.length === 1) {
            // Only one number found - try alternative extraction from original text
            // Remove MANDATE NO patterns first to avoid extracting mandate numbers
            let cleanForExtraction = fullText
              .replace(/MANDATE NO\s+\d+/gi, ' ')
              .replace(/REF\s+[A-Z0-9]+/gi, ' ');

            // Split concatenated numbers like "2.97125.22" -> "2.97 125.22"
            cleanForExtraction = cleanForExtraction.replace(/(\.\d{2})(\d{1,4}\.\d{2})/g, '$1 $2');

            // Extract ALL decimal numbers (with proper decimal format)
            const allNumbers = cleanForExtraction.match(/\d+\.\d{2}/g) || [];
            console.log(`Only 1 number after cleaning. Trying raw extraction (after removing MANDATE NO and splitting), found:`, allNumbers);

            if (allNumbers.length >= 2) {
              // Use the last 2 numbers (amount and balance)
              const rawAmounts = allNumbers.map(n => parseFloat(n));
              amount = rawAmounts[rawAmounts.length - 2];
              balance = rawAmounts[rawAmounts.length - 1];

              // Determine type from description
              const lower = desc.toLowerCase();
              if (lower.includes('faster payments receipt') || lower.includes('receipt') || lower.includes('credit')) {
                type = 'credit';
              } else {
                type = 'debit';
              }

              console.log(`✓ Extracted from raw: amount=${amount}, balance=${balance}, type=${type}`);
            } else {
              console.log(`Skipping line - couldn't extract enough numbers: "${fullText.substring(0, 100)}"`);
              continue;
            }
          } else if (amounts.length === 2) {
            // Either MoneyIn+Balance or MoneyOut+Balance
            amount = amounts[0];
            balance = amounts[1];

            // Check if description suggests credit
            const lower = desc.toLowerCase();
            if (lower.includes('faster payments receipt') ||
                lower.includes('credit') ||
                lower.includes('payment receipt') ||
                lower.includes('receipt ref')) {
              moneyIn = amount;
              type = 'credit';
            } else {
              moneyOut = amount;
              type = 'debit';
            }
          } else if (amounts.length === 3) {
            // MoneyIn, MoneyOut, Balance
            moneyIn = amounts[0];
            moneyOut = amounts[1];
            balance = amounts[2];

            if (moneyIn > 0) {
              amount = moneyIn;
              type = 'credit';
            } else if (moneyOut > 0) {
              amount = moneyOut;
              type = 'debit';
            }
          }

          // Clean description
          desc = desc
            .replace(/\s+/g, ' ')
            .replace(/MANDATE NO \d+/gi, '') // Remove mandate numbers
            .replace(/REF\s+[A-Z0-9]+/gi, '') // Remove reference codes
            .trim();

          if (amount > 0 && desc) {
            transactions.push({
              date: currentDate,
              description: desc,
              amount,
              balance,
              type,
            });

            if (transactions.length <= 5) {
              console.log(`✓ ${currentDate} | ${desc.substring(0, 30)} | ${type} £${amount} | Bal: £${balance}`);
            }
          }
        }

        // Skip to the line after this transaction
        i = j - 1;
      }
    }

    console.log(`Extracted ${transactions.length} Santander transactions`);
    return transactions;
  }

  // Extract transactions from Barclays bank statements
  // NEW APPROACH: Handle multiple transactions per date properly
  // Format: Each date block contains N transactions, each with description + amounts
  private extractBarclaysTransactions(text: string): Transaction[] {
    const transactions: Transaction[] = [];
    const lines = text.split('\n');

    console.log('Parsing Barclays statement (NEW PARSER)...');

    // Extract year
    let statementYear = '2025';
    const yearMatch = text.match(/Statement date\s+(\d{1,2})\s+(\w+)\s+(\d{4})/i);
    if (yearMatch) {
      statementYear = yearMatch[3];
      console.log(`Found statement year: ${statementYear}`);
    }

    // Helper: Extract amounts from text
    const extractAmounts = (text: string): number[] => {
      const regex = /\d{1,3}(?:,\d{3})*\.\d{2}/g;
      const matches = text.match(regex);
      if (!matches) return [];
      return matches.map(m => parseFloat(m.replace(/,/g, '')));
    };

    // Find transaction section start
    let transactionStartIdx = 0;
    for (let i = 0; i < lines.length; i++) {
      if (/Your transactions|DateDescription/i.test(lines[i])) {
        transactionStartIdx = i + 1;
        console.log(`Transactions start at line ${transactionStartIdx}`);
        break;
      }
    }

    // Date patterns
    const datePattern = /^(\d{1,2})\s*(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s*([A-Z].*)/i;
    const dateOnlyPattern = /^(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s*$/i;

    let currentDate = '';
    let i = transactionStartIdx;

    while (i < lines.length) {
      const line = lines[i].trim();

      // Debug: show all lines that might be the 25 Jun transaction
      if (line.includes('25 Jun') || line.includes('25Jun')) {
        console.log(`\n📍 Line ${i} contains '25 Jun': "${line}"`);
        console.log(`   Matches datePattern? ${datePattern.test(line)}`);
        console.log(`   Matches dateOnlyPattern? ${dateOnlyPattern.test(line)}`);
      }

      // Skip noise and informational sections
      // IMPORTANT: Don't skip lines that are transactions mentioning sort codes!
      // Only skip if it's a header line (e.g., "Sort code 20-05-74 • Account number 53539997")
      const isAccountInfoHeader = /•.*Sort code.*Account number/i.test(line) ||
                                  (/Sort code.*Account number/i.test(line) && !datePattern.test(line));

      if (!line ||
          isAccountInfoHeader ||
          /Barclays Bank|Authorised by|Registered in England/i.test(line) ||
          /Financial Services|Page \d+|Continued/i.test(line) ||
          /Bank Giro.*Cash machine|SWIFTBIC|IBAN/i.test(line) ||
          /^Money out\s+Money in\s+Balance/i.test(line) ||
          /^Date\s*Description/i.test(line) ||
          /How it works|Dispute Resolution|Financial Ombudsman/i.test(line) ||
          /compensation arrangements|FSCS|depositors/i.test(line) ||
          /Using your.*debit card|Non-Sterling Transaction Fee/i.test(line) ||
          /exchange rate|Visa card scheme|European Central Bank/i.test(line) ||
          /Anything Wrong|incorrect or unusual transactions/i.test(line) ||
          /next page for how to get in touch/i.test(line)) {
        i++;
        continue;
      }

      // Check for date line with description
      const dateMatch = line.match(datePattern);

      // Check for standalone date (used in page headers - update current date but don't create transaction)
      const dateOnlyMatch = line.match(dateOnlyPattern);

      if (dateMatch) {
        const day = dateMatch[1];
        const month = dateMatch[2];
        const restOfLine = dateMatch[3];
        currentDate = `${day} ${month} ${statementYear}`;

        // Debug 25 Jun and transfers
        if ((day === '25' && month === 'Jun') || restOfLine.toLowerCase().includes('transfer')) {
          console.log(`\n🔍 DEBUG DATE MATCH at line ${i}: ${day} ${month}`);
          console.log(`   Full line: "${line}"`);
          console.log(`   restOfLine: "${restOfLine}"`);

          // Check if it would be skipped
          const wouldSkip = /Start balance|End balance/i.test(restOfLine) ||
                           /^Money (in|out) Balance/i.test(restOfLine) ||
                           /^Money out\s*Money in/i.test(restOfLine) ||
                           /^Balance$/i.test(restOfLine) ||
                           /^Description$/i.test(restOfLine);
          console.log(`   Would be skipped? ${wouldSkip}`);
        }

        // Debug 17 Sep
        if (day === '17' && month === 'Sep') {
          console.log(`\n🔍 DEBUG 17 Sep at line ${i}: restOfLine="${restOfLine}"`);
          console.log(`🔍 Will skip? ${/Start balance|End balance/i.test(restOfLine)}`);
          console.log(`🔍 Next 10 lines:`, lines.slice(i + 1, i + 11));
        }

        // Skip start/end balance and column headers
        if (/Start balance|End balance/i.test(restOfLine) ||
            /^Money (in|out) Balance/i.test(restOfLine) ||
            /^Money out\s*Money in/i.test(restOfLine) ||
            /^Balance$/i.test(restOfLine) ||
            /^Description$/i.test(restOfLine)) {
          i++;
          continue;
        }

        // This line has a description - it's a transaction
        // Collect description and amounts for THIS transaction only
        let description = '';
        let amounts: number[] = [];

        // Extract description and amounts from first line
        const lineAmounts = extractAmounts(restOfLine);
        if (lineAmounts.length > 0) {
          amounts = lineAmounts;
          const firstAmountMatch = restOfLine.match(/\d{1,3}(?:,\d{3})*\.\d{2}/);
          if (firstAmountMatch) {
            const idx = restOfLine.indexOf(firstAmountMatch[0]);
            description = restOfLine.substring(0, idx).trim();
          }
        } else {
          description = restOfLine;
        }

        // Look at next line(s) for continuation (Ref, amounts)
        let j = i + 1;
        let fullTextWithAmounts = restOfLine; // Track the full text including amount lines
        while (j < lines.length && j < i + 8) {
          const nextLine = lines[j].trim();

          // Stop if we hit another transaction date or standalone date
          if (datePattern.test(nextLine) || dateOnlyMatch) break;

          // Stop if we hit informational sections
          if (/How it works|Dispute Resolution|compensation arrangements|Anything Wrong/i.test(nextLine)) {
            break;
          }

          // Skip noise
          if (!nextLine ||
              /Sort code|Account number|20-05-74|53539997/i.test(nextLine) ||
              /Barclays Bank|Authorised by|Registered in England/i.test(nextLine) ||
              /Financial Services|Page \d+|Continued/i.test(nextLine) ||
              /Bank Giro.*Cash machine|SWIFTBIC|IBAN/i.test(nextLine) ||
              /^Money out\s+Money in\s+Balance/i.test(nextLine) ||
              /^Date\s*Description/i.test(nextLine)) {
            j++;
            continue;
          }

          // Check if this line has amounts
          const nextAmounts = extractAmounts(nextLine);
          if (nextAmounts.length > 0) {
            amounts = amounts.concat(nextAmounts);
            fullTextWithAmounts += ' ' + nextLine; // Keep the full line with amounts
            // Get description before amounts (but skip column headers)
            const firstAmountMatch = nextLine.match(/\d{1,3}(?:,\d{3})*\.\d{2}/);
            if (firstAmountMatch) {
              const idx = nextLine.indexOf(firstAmountMatch[0]);
              const desc = nextLine.substring(0, idx).trim();
              // Only add if it's not a column header
              if (desc && desc.length > 2 && !/^(Money (in|out)( Balance)?|Balance)$/i.test(desc)) {
                description += ' ' + desc;
              }
            }
            // Found amounts - this transaction is complete
            break;
          } else {
            // Line is continuation of description (like "Ref: xxx")
            fullTextWithAmounts += ' ' + nextLine;
            // Skip column header text and standalone "Money in"/"Money out" labels
            if (!/^(Money (in|out)( Balance)?|Balance|Description)$/i.test(nextLine)) {
              description += ' ' + nextLine;
            }
          }

          j++;
        }

        // Create transaction if we have data
        description = description.trim();
        if (description && amounts.length > 0) {
          let amount = 0;
          let balance = 0;
          let type: 'credit' | 'debit' = 'debit';

          const lower = description.toLowerCase();
          // Enhanced credit detection with more keywords
          const isCredit = lower.includes('received from') ||
                           lower.includes('received') ||
                           lower.includes('transfer from') ||
                           lower.includes('giro credit') ||
                           lower.includes('credit transfer') ||
                           lower.includes('bank giro') ||
                           lower.includes('faster payment') && lower.includes('from') ||
                           /received\s+(from|£)/i.test(description) ||
                           /transfer\s+from/i.test(description);

          // Debug logging for problematic transactions
          if (currentDate.includes('25 Jun') || lower.includes('account 80131024') || lower.includes('transfer') || lower.includes('rashid')) {
            console.log(`\n🔍 DEBUG Transaction: ${currentDate}`);
            console.log(`   Description: "${description}"`);
            console.log(`   Full text with amounts: "${fullTextWithAmounts}"`);
            console.log(`   Lower: "${lower}"`);
            console.log(`   Amounts: [${amounts.join(', ')}]`);
            console.log(`   isCredit check: ${isCredit}`);
          }

          if (amounts.length === 1) {
            amount = amounts[0];
            balance = amounts[0];
            type = isCredit ? 'credit' : 'debit';
          } else if (amounts.length === 2) {
            // Two amounts in Barclays format could be:
            // 1. [MoneyOut, Balance] - debit transaction (Money In column is blank)
            // 2. [MoneyIn, Balance] - credit transaction (Money Out column is blank)
            //
            // Strategy: Use description keywords to determine which column
            amount = amounts[0];
            balance = amounts[1];

            // For Barclays, use enhanced detection
            type = isCredit ? 'credit' : 'debit';

            // Additional check: if balance decreased, it's likely a debit; if increased, likely credit
            // But only use this as a fallback if keywords are ambiguous
            if (!isCredit) {
              // Check if description has any debit keywords
              const isDefinitelyDebit = lower.includes('payment to') ||
                                       lower.includes('card payment') ||
                                       lower.includes('card purchase') ||
                                       lower.includes('direct debit') ||
                                       lower.includes('bill payment');
              if (!isDefinitelyDebit) {
                // No clear debit keywords, might be a credit that we missed
                // Keep as debit for now but log it
                console.log(`⚠️  Ambiguous 2-amount transaction: "${description}" - defaulting to debit`);
              }
            }
          } else if (amounts.length >= 3) {
            // Format: moneyOut, moneyIn, balance
            const moneyOut = amounts[amounts.length - 3];
            const moneyIn = amounts[amounts.length - 2];
            balance = amounts[amounts.length - 1];

            if (moneyIn > 0 && moneyOut === 0) {
              // Only money in - it's a credit
              amount = moneyIn;
              type = 'credit';
            } else if (moneyOut > 0 && moneyIn === 0) {
              // Only money out - it's a debit
              amount = moneyOut;
              type = 'debit';
            } else if (moneyIn > 0 && moneyOut > 0) {
              // Both present - shouldn't happen, but use description as tiebreaker
              if (isCredit) {
                amount = moneyIn;
                type = 'credit';
              } else {
                amount = moneyOut;
                type = 'debit';
              }
            } else {
              // Fallback - use non-zero amount
              amount = moneyIn > 0 ? moneyIn : moneyOut;
              type = moneyIn > 0 ? 'credit' : 'debit';
            }
          }

          // Validate transaction before adding
          const isValidTransaction = amount > 0 &&
                                      description.length > 10 &&
                                      !/^(Money (in|out) Balance|Balance|Description|Ref: Bills?)$/i.test(description) &&
                                      !/If you use your debit card abroad/i.test(description);

          // Debug: log rejected transactions
          if (!isValidTransaction && amount > 0) {
            console.log(`❌ REJECTED: ${currentDate} | "${description}" | £${amount} | len:${description.length} | valid:${isValidTransaction}`);
          }

          if (isValidTransaction) {
            transactions.push({
              date: currentDate,
              description: description,
              amount: amount,
              balance: balance,
              type: type,
            });

            if (transactions.length <= 5) {
              console.log(`✓ ${currentDate} | ${description.substring(0, 50)} | ${type} £${amount.toFixed(2)} | Bal: £${balance.toFixed(2)}`);
            }
          }
        }

        i = j;
      } else if (dateOnlyMatch) {
        // Update current date but don't create transaction
        const day = dateOnlyMatch[1];
        const month = dateOnlyMatch[2];
        currentDate = `${day} ${month} ${statementYear}`;
        i++;
      } else {
        // Not a date line - check if it's a description line (starts transaction without date)
        // This handles cases where description appears on its own line after a standalone date
        if (currentDate && line.length > 5 && !extractAmounts(line).length) {
          // Debug for 17 Sep transactions
          if (currentDate.includes('17 Sep')) {
            console.log(`\n🔍 DEBUG Description line for ${currentDate}: "${line}"`);
          }

          // EDGE CASE: Check if this is a multi-transaction block with amounts at the end
          // Collect ALL transaction descriptions first, then ALL amounts
          const transactionDescriptions: string[] = [];
          const allAmountsInBlock: number[] = [];
          let currentDesc = line;
          let j = i + 1;
          let collectingDescriptions = true;

          while (j < lines.length && j < i + 20) {
            const nextLine = lines[j].trim();

            if (datePattern.test(nextLine) || dateOnlyPattern.test(nextLine)) break;
            if (/How it works|Dispute Resolution|compensation arrangements|Anything Wrong/i.test(nextLine)) break;
            if (!nextLine ||
                /^Sort code.*Account number/i.test(nextLine) ||  // Only skip header lines with both
                /Barclays Bank|Authorised by|Registered in England/i.test(nextLine) ||
                /Financial Services|Page \d+|Continued/i.test(nextLine) ||
                /Bank Giro.*Cash machine|SWIFTBIC|IBAN/i.test(nextLine) ||
                /^Money out\s+Money in\s+Balance/i.test(nextLine) ||
                /^Date\s*Description/i.test(nextLine)) {
              j++;
              continue;
            }

            // Check if this line starts a NEW transaction
            const startsNewTransaction = /^(Bill Payment to|Card Payment to|Card Purchase|Direct Debit to|Transfer From|Transfer to|Received From|Cash Machine|Standing Order)/i.test(nextLine);

            const nextAmounts = extractAmounts(nextLine);

            if (startsNewTransaction) {
              // Save previous description if we have one
              if (currentDesc.trim()) {
                transactionDescriptions.push(currentDesc.trim());
              }
              currentDesc = nextLine;
              collectingDescriptions = true; // Reset for new transaction
            } else if (nextAmounts.length > 0) {
              // Found amounts - save current description if collecting
              if (currentDesc.trim() && collectingDescriptions) {
                transactionDescriptions.push(currentDesc.trim());
                currentDesc = '';
              }
              // Collect all amounts (don't stop description collection yet - there might be more transactions)
              allAmountsInBlock.push(...nextAmounts);
            } else if (collectingDescriptions) {
              // Continuation of description
              if (!/^(Money (in|out)( Balance)?|Balance|Description)$/i.test(nextLine)) {
                currentDesc += ' ' + nextLine;
              }
            }

            j++;
          }

          // Save any remaining description that wasn't saved yet
          if (currentDesc.trim() && !transactionDescriptions.includes(currentDesc.trim())) {
            transactionDescriptions.push(currentDesc.trim());
          }

          // If we collected multiple descriptions and multiple amounts, match them up
          if (transactionDescriptions.length >= 2 && allAmountsInBlock.length >= 2) {
            console.log(`\n🔥 EDGE CASE: ${currentDate} - ${transactionDescriptions.length} descriptions, ${allAmountsInBlock.length} amounts`);

            // Create a transaction for each description+amount pair
            const numTransactions = Math.min(transactionDescriptions.length, allAmountsInBlock.length - 1); // Last amount is usually balance
            const finalBalance = allAmountsInBlock[allAmountsInBlock.length - 1];

            for (let k = 0; k < numTransactions; k++) {
              const desc = transactionDescriptions[k];
              const amount = allAmountsInBlock[k];
              const balance = (k === numTransactions - 1) ? finalBalance : 0;

              const lower = desc.toLowerCase();
              const isCredit = lower.includes('received from') ||
                               lower.includes('received ') ||
                               lower.includes('transfer from') ||
                               /received\s+from/i.test(desc);
              const type: 'credit' | 'debit' = isCredit ? 'credit' : 'debit';

              if (amount > 0 && desc.length >= 10) {
                transactions.push({
                  date: currentDate,
                  description: desc,
                  amount: amount,
                  balance: balance,
                  type: type,
                });
                console.log(`✓ ${currentDate} | ${desc.substring(0, 50)} | ${type} £${amount.toFixed(2)} | Bal: £${balance.toFixed(2)}`);
              }
            }

            i = j;
            continue;
          }

          // FALLBACK: Original single-transaction logic
          let description = line;
          let amounts: number[] = [];
          j = i + 1;

          while (j < lines.length && j < i + 8) {
            const nextLine = lines[j].trim();

            if (datePattern.test(nextLine) || dateOnlyPattern.test(nextLine)) break;
            if (/How it works|Dispute Resolution|compensation arrangements|Anything Wrong/i.test(nextLine)) break;
            if (!nextLine ||
                /Sort code|Account number|20-05-74|53539997/i.test(nextLine) ||
                /Barclays Bank|Authorised by|Registered in England/i.test(nextLine) ||
                /Financial Services|Page \d+|Continued/i.test(nextLine) ||
                /Bank Giro.*Cash machine|SWIFTBIC|IBAN/i.test(nextLine) ||
                /^Money out\s+Money in\s+Balance/i.test(nextLine) ||
                /^Date\s*Description/i.test(nextLine)) {
              j++;
              continue;
            }

            const startsNewTransaction = /^(Bill Payment to|Card Payment to|Card Purchase|Direct Debit to|Transfer From|Transfer to|Received From|Cash Machine|Standing Order)/i.test(nextLine);
            if (startsNewTransaction) {
              break;
            }

            const nextAmounts = extractAmounts(nextLine);
            if (nextAmounts.length > 0) {
              amounts = nextAmounts;
              const firstAmountMatch = nextLine.match(/\d{1,3}(?:,\d{3})*\.\d{2}/);
              if (firstAmountMatch) {
                const idx = nextLine.indexOf(firstAmountMatch[0]);
                const desc = nextLine.substring(0, idx).trim();
                if (desc && desc.length > 2 && !/^(Money (in|out)( Balance)?|Balance)$/i.test(desc)) {
                  description += ' ' + desc;
                }
              }
              break;
            } else {
              if (!/^(Money (in|out)( Balance)?|Balance|Description)$/i.test(nextLine)) {
                description += ' ' + nextLine;
              }
            }

            j++;
          }

          description = description.trim();
          if (description && amounts.length > 0) {
            let amount = 0;
            let balance = 0;
            let type: 'credit' | 'debit' = 'debit';

            const lower = description.toLowerCase();
            // Enhanced credit detection with more keywords
            const isCredit = lower.includes('received from') ||
                             lower.includes('received') ||
                             lower.includes('transfer from') ||
                             lower.includes('giro credit') ||
                             lower.includes('credit transfer') ||
                             lower.includes('bank giro') ||
                             lower.includes('faster payment') && lower.includes('from') ||
                             /received\s+(from|£)/i.test(description) ||
                             /transfer\s+from/i.test(description);

            // Debug logging for problematic transactions
            if (currentDate.includes('25 Jun') || lower.includes('account 80131024') || lower.includes('transfer')) {
              console.log(`\n🔍 DEBUG Transaction (no-date path): ${currentDate}`);
              console.log(`   Description: "${description}"`);
              console.log(`   Lower: "${lower}"`);
              console.log(`   Amounts: [${amounts.join(', ')}]`);
              console.log(`   isCredit check: ${isCredit}`);
              console.log(`   Contains 'transfer from': ${lower.includes('transfer from')}`);
              console.log(`   Regex test: ${/transfer\s+from/i.test(description)}`);
            }

            if (amounts.length === 1) {
              amount = amounts[0];
              balance = amounts[0];
              type = isCredit ? 'credit' : 'debit';
            } else if (amounts.length === 2) {
              // Two amounts could be:
              // 1. MoneyOut + Balance (debit transaction)
              // 2. MoneyIn + Balance (credit transaction)
              // Use description keywords to determine which
              amount = amounts[0];
              balance = amounts[1];
              type = isCredit ? 'credit' : 'debit';
            } else if (amounts.length >= 3) {
              // Format: moneyOut, moneyIn, balance
              const moneyOut = amounts[amounts.length - 3];
              const moneyIn = amounts[amounts.length - 2];
              balance = amounts[amounts.length - 1];

              if (moneyIn > 0 && moneyOut === 0) {
                // Only money in - it's a credit
                amount = moneyIn;
                type = 'credit';
              } else if (moneyOut > 0 && moneyIn === 0) {
                // Only money out - it's a debit
                amount = moneyOut;
                type = 'debit';
              } else if (moneyIn > 0 && moneyOut > 0) {
                // Both present - shouldn't happen, but use description as tiebreaker
                if (isCredit) {
                  amount = moneyIn;
                  type = 'credit';
                } else {
                  amount = moneyOut;
                  type = 'debit';
                }
              } else {
                // Fallback - use non-zero amount
                amount = moneyIn > 0 ? moneyIn : moneyOut;
                type = moneyIn > 0 ? 'credit' : 'debit';
              }
            }

            // Validate transaction before adding
            const isValidTransaction = amount > 0 &&
                                        description.length > 10 &&
                                        !/^(Money (in|out) Balance|Balance|Description|Ref: Bills?)$/i.test(description) &&
                                        !/If you use your debit card abroad/i.test(description);

            // Debug: log rejected transactions
            if (!isValidTransaction && amount > 0) {
              console.log(`❌ REJECTED: ${currentDate} | "${description}" | £${amount} | len:${description.length} | valid:${isValidTransaction}`);
            }

            if (isValidTransaction) {
              transactions.push({
                date: currentDate,
                description: description,
                amount: amount,
                balance: balance,
                type: type,
              });

              if (transactions.length <= 5) {
                console.log(`✓ ${currentDate} | ${description.substring(0, 50)} | ${type} £${amount.toFixed(2)} | Bal: £${balance.toFixed(2)}`);
              }
            }
          }

          i = j;
        } else {
          i++;
        }
      }
    }

    console.log(`Extracted ${transactions.length} Barclays transactions`);
    return transactions;
  }

  // Extract transactions from Metro Bank statements
  // Metro Bank uses a COLUMNAR format where dates, transactions, and amounts are in separate columns
  // IMPORTANT: This is a TABLE format where row positions must align across columns
  private extractMetroBankTransactions(text: string): Transaction[] {
    const transactions: Transaction[] = [];
    const lines = text.split('\n');

    console.log('Parsing Metro Bank statement (columnar format)...');
    console.log('Total lines in document:', lines.length);

    // Arrays to hold ALL parsed data from all pages
    const allDates: string[] = [];
    const allDescriptions: string[] = [];
    const allMoneyOut: (number | null)[] = [];
    const allMoneyIn: (number | null)[] = [];
    const allBalances: number[] = [];

    // Combined array to preserve order of Money Out/In as they appear in text
    const allMoneyValues: Array<{ amount: number; type: 'debit' | 'credit' }> = [];

    // Find ALL occurrences of column headers throughout the document
    const datePattern = /^\d{1,2}\s+(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\s+\d{4}$/i;

    let i = 0;
    while (i < lines.length) {
      const line = lines[i].trim();

      // Look for DATE column header
      if (line === 'DATE') {
        console.log(`\n[Column Scan] Found DATE column at line ${i}`);
        i++;

        const tempDates: string[] = [];
        // Extract dates until we hit another column header or end
        while (i < lines.length) {
          const dateLine = lines[i].trim();

          // Stop if we hit another column header
          if (dateLine === 'TRANSACTION' || dateLine === 'MONEY OUT' || dateLine === 'MONEY IN' || dateLine === 'BALANCE') break;
          // Stop if we hit page break indicators
          if (dateLine.includes('metrobank') || dateLine.includes('MBS2C_') || dateLine.includes('Cash Account Statement')) break;
          // Stop on empty lines that might indicate end of column
          if (!dateLine) {
            i++;
            continue;
          }

          if (datePattern.test(dateLine)) {
            tempDates.push(dateLine);
            console.log(`  → Date ${tempDates.length}: ${dateLine}`);
          }
          i++;
        }
        allDates.push(...tempDates);
        console.log(`  ✓ Total dates collected: ${allDates.length}`);
        continue;
      }

      // Look for TRANSACTION column header
      else if (line === 'TRANSACTION') {
        console.log(`\n[Column Scan] Found TRANSACTION column at line ${i}`);
        i++;

        const tempDescriptions: string[] = [];
        let currentDesc = '';
        let lineNumber = 0;

        // Log first 10 lines after TRANSACTION header for debugging
        console.log(`  [DEBUG] First 10 lines after TRANSACTION header:`);
        for (let debugIdx = 0; debugIdx < Math.min(10, lines.length - i); debugIdx++) {
          console.log(`    ${debugIdx + 1}: "${lines[i + debugIdx].trim()}"`);
        }
        console.log(`  [DEBUG] Starting line-by-line parsing...\n`);

        while (i < lines.length) {
          const transLine = lines[i].trim();
          lineNumber++;

          // Stop if we hit another column header
          if (transLine === 'DATE' || transLine === 'MONEY OUT' || transLine === 'MONEY IN' || transLine === 'BALANCE') break;
          // Stop if we hit page break indicators
          if (transLine.includes('metrobank') || transLine.includes('MBS2C_') || transLine.includes('Cash Account Statement')) break;

          // Skip balance brought forward (we'll track this separately)
          // Use case-insensitive match with trimming to handle variations
          if (transLine.toLowerCase().trim() === 'balance brought forward') {
            if (currentDesc) {
              tempDescriptions.push(currentDesc.trim());
              console.log(`  → Desc ${tempDescriptions.length}: ${currentDesc.trim().substring(0, 50)}...`);
              currentDesc = '';
            }
            console.log(`  → Skipping "Balance brought forward" line`);
            i++;
            continue;
          }

          // Check if this starts a new transaction
          const isTransactionStart = /^(Card Purchase|Account to Account Transfer|Inward Payment|Outward Faster Payment|ATM Cash Withdrawal|Direct Debit|Closing Balance|Interest Paid)/i.test(transLine);

          if (isTransactionStart) {
            console.log(`  [Line ${lineNumber}] Transaction start detected: "${transLine.substring(0, 40)}..."`);

            // Save previous description if it exists
            if (currentDesc && !currentDesc.includes('Closing Balance')) {
              tempDescriptions.push(currentDesc.trim());
              console.log(`  → Desc ${tempDescriptions.length}: ${currentDesc.trim().substring(0, 50)}...`);
            }

            // Skip "Closing Balance" as it's not a transaction
            if (transLine.includes('Closing Balance')) {
              currentDesc = '';
              i++;
              break;
            }

            currentDesc = transLine;
          } else if (transLine && currentDesc) {
            // Continuation of current description
            console.log(`  [Line ${lineNumber}] Appending to current desc: "${transLine.substring(0, 30)}..."`);
            currentDesc += ' ' + transLine;
          } else if (!transLine && currentDesc) {
            // Empty line might signal end of description
            // But don't finalize yet, keep going
            console.log(`  [Line ${lineNumber}] Empty line (keeping current desc active)`);
          } else if (!transLine) {
            console.log(`  [Line ${lineNumber}] Empty line (no current desc)`);
          } else {
            console.log(`  [Line ${lineNumber}] ⚠️  Unhandled line: "${transLine.substring(0, 40)}..."`);
          }

          i++;
        }

        // Save last description if it exists
        if (currentDesc && !currentDesc.includes('Closing Balance')) {
          tempDescriptions.push(currentDesc.trim());
          console.log(`  → Desc ${tempDescriptions.length}: ${currentDesc.trim().substring(0, 50)}...`);
        }

        allDescriptions.push(...tempDescriptions);
        console.log(`  ✓ Total descriptions collected: ${allDescriptions.length}`);
        continue;
      }

      // Look for MONEY OUT column header
      else if (line === 'MONEY OUT') {
        console.log(`\n[Column Scan] Found MONEY OUT column at line ${i}`);
        i++;

        // We need to collect values but they're sparse - not every transaction has money out
        // We'll collect all the values we find and use them to verify balance-based calculations
        const tempMoneyOutValues: number[] = [];

        while (i < lines.length) {
          const amountLine = lines[i].trim();

          // Stop if we hit another column header
          if (amountLine === 'DATE' || amountLine === 'TRANSACTION' || amountLine === 'MONEY IN' || amountLine === 'BALANCE') break;
          // Stop if we hit page break indicators
          if (amountLine.includes('MBS2C_') || amountLine.includes('Cash Account Statement')) break;

          // Skip summary/header lines that appear between MONEY OUT header and actual values
          if (amountLine.includes('BIC:') ||
              amountLine.includes('IBAN:') ||
              amountLine.includes('Account No:') ||
              amountLine.includes('Sort Code:') ||
              amountLine === 'Statement' ||
              amountLine === 'Account Summary' ||
              amountLine.includes('Opening Balance') ||
              amountLine.includes('Total Money In') ||
              amountLine.includes('Total Money Out') ||
              amountLine.includes('Closing Balance') ||
              amountLine.includes('No:') ||
              amountLine.match(/^\d{1,2}\s+(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\s+\d{4}$/i) || // Date
              amountLine.match(/^-\s+\d{1,2}\s+(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\s+\d{4}$/i)) { // Date range
            i++;
            continue; // Skip these lines
          }

          // Match amounts (must be pure number format: digits.digits)
          const amountMatch = amountLine.match(/^(\d+(?:,\d{3})*\.\d{2})$/);
          if (amountMatch) {
            const amount = parseFloat(amountMatch[1].replace(/,/g, ''));
            tempMoneyOutValues.push(amount);
            console.log(`  → Found money out value: £${amount.toFixed(2)}`);
          }

          i++;
        }

        console.log(`  ✓ Total money out values found: ${tempMoneyOutValues.length}`);
        // Store as sparse array - we'll use these to verify balance-based calculations
        allMoneyOut.push(...tempMoneyOutValues.map(v => v as number | null));
        // Also add to combined array preserving order
        tempMoneyOutValues.forEach(amount => {
          allMoneyValues.push({ amount, type: 'debit' });
        });
        continue;
      }

      // Look for MONEY IN column header
      else if (line === 'MONEY IN') {
        console.log(`\n[Column Scan] Found MONEY IN column at line ${i}`);
        i++;

        // Collect all money in values (also sparse)
        // We'll collect all the values we find and use them to verify balance-based calculations
        const tempMoneyInValues: number[] = [];

        while (i < lines.length) {
          const amountLine = lines[i].trim();

          // Stop if we hit another column header
          if (amountLine === 'DATE' || amountLine === 'TRANSACTION' || amountLine === 'MONEY OUT' || amountLine === 'BALANCE') break;
          // Stop if we hit page break indicators
          if (amountLine.includes('MBS2C_') || amountLine.includes('Cash Account Statement')) break;

          // Skip summary/header lines that appear between MONEY IN header and actual values
          if (amountLine.includes('BIC:') ||
              amountLine.includes('IBAN:') ||
              amountLine.includes('Account No:') ||
              amountLine.includes('Sort Code:') ||
              amountLine.includes('MYMBGB') ||
              amountLine.includes('GB98MYMB') ||
              amountLine.match(/^\d{8}$/) || // Account number
              amountLine.match(/^\d{2}-\d{2}-\d{2}$/)) { // Sort code
            i++;
            continue; // Skip these lines
          }

          // Match amounts (must be pure number format: digits.digits)
          const amountMatch = amountLine.match(/^(\d+(?:,\d{3})*\.\d{2})$/);
          if (amountMatch) {
            const amount = parseFloat(amountMatch[1].replace(/,/g, ''));
            tempMoneyInValues.push(amount);
            console.log(`  → Found money in value: £${amount.toFixed(2)}`);
          }

          i++;
        }

        console.log(`  ✓ Total money in values found: ${tempMoneyInValues.length}`);
        // Store as sparse array - we'll use these to verify balance-based calculations
        allMoneyIn.push(...tempMoneyInValues.map(v => v as number | null));
        // Also add to combined array preserving order
        tempMoneyInValues.forEach(amount => {
          allMoneyValues.push({ amount, type: 'credit' });
        });
        continue;
      }

      // Look for BALANCE column header
      else if (line === 'BALANCE') {
        console.log(`\n[Column Scan] Found BALANCE column at line ${i}`);
        i++;

        const tempBalances: number[] = [];

        while (i < lines.length) {
          const balanceLine = lines[i].trim();

          // Stop if we hit another column header
          if (balanceLine === 'DATE' || balanceLine === 'TRANSACTION' || balanceLine === 'MONEY OUT' || balanceLine === 'MONEY IN') break;
          // Stop if we hit page break indicators
          if (balanceLine.includes('MBS2C_') || balanceLine.includes('Cash Account Statement')) break;
          // Stop if we see the document footer
          if (balanceLine.includes('metrobank') || balanceLine.includes('MBS2C_') || balanceLine.includes('Southampton Row')) break;

          // Skip lines with £ symbol (these are summary values like "£73.88" or "£95.89")
          if (balanceLine.includes('£')) {
            console.log(`  → Skipping summary value: ${balanceLine}`);
            i++;
            continue;
          }

          // Match pure number balances: digits.digits format
          const balanceMatch = balanceLine.match(/^(\d+(?:,\d{3})*\.\d{2})$/);
          if (balanceMatch) {
            const balance = parseFloat(balanceMatch[1].replace(/,/g, ''));
            tempBalances.push(balance);
            console.log(`  → Balance ${tempBalances.length}: £${balance.toFixed(2)}`);
          }

          i++;
        }

        allBalances.push(...tempBalances);
        console.log(`  ✓ Total balances collected: ${allBalances.length}`);
        continue;
      }

      else {
        i++;
      }
    }

    console.log(`\n========== FINAL COLUMN COUNTS ==========`);
    console.log(`  Dates: ${allDates.length}`);
    console.log(`  Descriptions: ${allDescriptions.length}`);
    console.log(`  Money Out values: ${allMoneyOut.length}`);
    console.log(`  Money In values: ${allMoneyIn.length}`);
    console.log(`  Balances: ${allBalances.length}`);
    console.log(`==========================================`);

    // Fix Money Out/In ordering issue: Use POSITIONAL logic instead of value-based logic
    // Pattern discovered: For Metro Bank PDFs, the combined array has this structure:
    // [MoneyOut[0], MoneyOut[1], ..., MoneyOut[N-2], MoneyOut[N-1], MoneyIn[0], MoneyIn[1], ...]
    // But chronologically it should be:
    // [MoneyOut[N-1], MoneyOut[0], MoneyOut[1], ..., MoneyOut[N-3], MoneyIn[0], MoneyIn[1], ..., MoneyOut[N-2]]
    //
    // Translation:
    // - LAST Money Out → Position 0 (first chronologically)
    // - SECOND-TO-LAST Money Out → After all credits (last chronologically)
    console.log(`\n[MONEY VALUE REORDERING] Applying positional reordering algorithm...`);
    console.log(`Original combined order (first 10): ${allMoneyValues.slice(0, 10).map(v => `${v.amount}${v.type === 'debit' ? 'D' : 'C'}`).join(', ')}`);

    // Find where credits start and end
    const firstCreditIndex = allMoneyValues.findIndex(v => v.type === 'credit');

    if (firstCreditIndex > 1) { // Need at least 2 debits before credits to apply pattern
      // Count total debits before credits
      const debitsBeforeCredits = firstCreditIndex;

      console.log(`  Found ${debitsBeforeCredits} debits before credits start at position ${firstCreditIndex}`);

      // Step 1: Move LAST debit (position N-1) before credits to position 0
      const lastDebitBeforeCreditsPos = firstCreditIndex - 1;
      console.log(`  Step 1: Moving debit at position ${lastDebitBeforeCreditsPos} (last before credits) to position 0`);
      const [lastDebit] = allMoneyValues.splice(lastDebitBeforeCreditsPos, 1);
      allMoneyValues.unshift(lastDebit);
      console.log(`  After step 1: ${allMoneyValues.slice(0, 10).map(v => `${v.amount}${v.type === 'debit' ? 'D' : 'C'}`).join(', ')}`);

      // Step 2: Find second-to-last debit and move it to after all credits
      // After step 1, the second-to-last is now at position (debitsBeforeCredits - 2) + 1 = debitsBeforeCredits - 1
      if (debitsBeforeCredits >= 2) {
        // Find where credits end
        let lastCreditIndex = -1;
        for (let i = allMoneyValues.length - 1; i >= 0; i--) {
          if (allMoneyValues[i].type === 'credit') {
            lastCreditIndex = i;
            break;
          }
        }

        if (lastCreditIndex !== -1) {
          // The second-to-last debit is now at position (firstCreditIndex - 1) after the first move
          const secondToLastDebitPos = firstCreditIndex - 1;
          const targetPos = lastCreditIndex + 1; // After last credit

          if (secondToLastDebitPos < targetPos) {
            console.log(`  Step 2: Moving debit at position ${secondToLastDebitPos} (second-to-last) to position ${targetPos} (after credits)`);
            const [secondToLastDebit] = allMoneyValues.splice(secondToLastDebitPos, 1);
            allMoneyValues.splice(targetPos - 1, 0, secondToLastDebit); // -1 because we removed one element
            console.log(`  After step 2: ${allMoneyValues.slice(0, 10).map(v => `${v.amount}${v.type === 'debit' ? 'D' : 'C'}`).join(', ')}`);
          } else {
            console.log(`  Step 2: Second-to-last debit already after credits, no move needed`);
          }
        }
      }

      console.log(`  ✓ Positional reordering complete`);
      console.log(`  Final order (first 10): ${allMoneyValues.slice(0, 10).map(v => `${v.amount}${v.type === 'debit' ? 'D' : 'C'}`).join(', ')}`);
    } else {
      console.log(`  ✓ No credits found or insufficient debits, no reordering needed`);
    }

    // Fix balance ordering issue: MUST happen AFTER money value reordering
    // Algorithm: Use the now-reordered money values to simulate balances and find misplaced balance values
    console.log(`\n[BALANCE REORDERING] Checking for misplaced balance values using reordered money values...`);
    console.log(`Original balance order (first 10): ${allBalances.slice(0, 10).map(b => b.toFixed(2)).join(', ')}`);

    // Calculate expected balance positions by simulating transactions with money values
    const balancesWithExpectedPos: Array<{value: number, currentPos: number, expectedPos: number}> = [];
    const usedBalanceIndices = new Set<number>();

    // Start from opening balance
    let simulatedBalance = allBalances[0]; // Opening balance (brought forward)
    usedBalanceIndices.add(0);

    for (let i = 0; i < allMoneyValues.length; i++) {
      const moneyValue = allMoneyValues[i];

      // Calculate what the balance should be after this transaction
      if (moneyValue.type === 'credit') {
        simulatedBalance += moneyValue.amount;
      } else {
        simulatedBalance -= moneyValue.amount;
      }

      // Find which balance in the array is closest to this expected value
      let closestBalanceIdx = -1;
      let closestDiff = Infinity;
      for (let j = 1; j < allBalances.length; j++) {
        if (usedBalanceIndices.has(j)) continue; // Skip already matched balances

        const diff = Math.abs(allBalances[j] - simulatedBalance);
        if (diff < closestDiff) {
          closestDiff = diff;
          closestBalanceIdx = j;
        }
      }

      if (closestBalanceIdx !== -1 && closestDiff < 0.01) {
        // Found a matching balance
        const expectedPos = i + 1; // +1 because position 0 is opening balance
        usedBalanceIndices.add(closestBalanceIdx);

        if (closestBalanceIdx !== expectedPos) {
          // Balance is in wrong position
          balancesWithExpectedPos.push({
            value: allBalances[closestBalanceIdx],
            currentPos: closestBalanceIdx,
            expectedPos: expectedPos
          });
          console.log(`  Detected: Balance ${allBalances[closestBalanceIdx].toFixed(2)} at position ${closestBalanceIdx} should be at position ${expectedPos}`);
        }
      }
    }

    // Apply balance corrections (reverse order to maintain indices)
    for (const correction of balancesWithExpectedPos.reverse()) {
      if (correction.currentPos > correction.expectedPos) {
        console.log(`  Moving balance ${correction.value.toFixed(2)} from position ${correction.currentPos} to ${correction.expectedPos}`);
        const [removed] = allBalances.splice(correction.currentPos, 1);
        allBalances.splice(correction.expectedPos, 0, removed);
      }
    }

    if (balancesWithExpectedPos.length > 0) {
      console.log(`  ✓ Fixed ${balancesWithExpectedPos.length} balance position(s)`);
      console.log(`New balance order (first 10): ${allBalances.slice(0, 10).map(b => b.toFixed(2)).join(', ')}`);
    } else {
      console.log(`  ✓ All balances appear to be in correct positions`);
    }

    // Note: Money Out/In values appear in the PDF in a specific visual order that may not
    // match chronological order. We now have a combined array that preserves this order.
    console.log(`\n[DEBUG] Money Out values: ${allMoneyOut.slice(0, 10).map(v => v !== null ? v : 'null').join(', ')}`);
    console.log(`[DEBUG] Money In values: ${allMoneyIn.slice(0, 10).map(v => v !== null ? v : 'null').join(', ')}`);
    console.log(`[DEBUG] Combined Money values (in text order): ${allMoneyValues.slice(0, 10).map(v => `${v.amount}${v.type === 'debit' ? 'D' : 'C'}`).join(', ')}\n`);

    // Debug: Show first few items of each array
    console.log(`\n[DEBUG] First 5 dates: ${allDates.slice(0, 5).join(', ')}`);
    console.log(`[DEBUG] First 10 balances (RAW): ${allBalances.slice(0, 10).join(', ')}`);

    // Check for out-of-sequence balances and try to detect issues
    console.log(`\n[VALIDATION] Checking balance sequence for anomalies...`);
    let anomalyDetected = false;
    for (let i = 1; i < Math.min(10, allBalances.length); i++) {
      const prev = allBalances[i - 1];
      const curr = allBalances[i];
      const diff = curr - prev;

      // Check if this looks like a wrong order (e.g., goes down then up when it should be sequential)
      if (Math.abs(diff) > prev * 0.5) { // Large jump
        console.log(`  ⚠️  Position ${i}: ${prev} → ${curr} (change: ${diff.toFixed(2)}) - Large jump detected`);
        anomalyDetected = true;
      }
    }

    if (anomalyDetected) {
      console.log(`\n⚠️  WARNING: Balance sequence appears to have anomalies!`);
      console.log(`   This likely means the PDF columns are not aligned correctly.`);
      console.log(`   Transaction amounts will be calculated from these (possibly incorrect) balances.\n`);
    }

    console.log(`\n[DEBUG] ALL ${allDescriptions.length} descriptions:`);
    allDescriptions.slice(0, 10).forEach((desc, idx) => {
      console.log(`  ${idx + 1}. "${desc.substring(0, 80)}..."`);
    });
    console.log(`  ... (${allDescriptions.length - 10} more)\n`);

    // STRATEGY: Use balance sequence as the source of truth
    // Metro Bank format: Date | Description | Money Out | Money In | Balance
    // - Dates and Descriptions should match 1:1
    // - Money Out/In are SPARSE (only show when there's a value)
    // - Balances show for every transaction
    // - Use balance changes to calculate amounts

    const numTransactions = Math.min(allDates.length, allDescriptions.length, allBalances.length);
    console.log(`Will process ${numTransactions} transactions based on Date/Description/Balance alignment\n`);

    // Check if there's a "Balance brought forward" opening balance
    let openingBalance: number | undefined;
    let balanceOffset = 0;
    let dateOffset = 0;

    if (allBalances.length > allDescriptions.length) {
      // First balance is the opening balance (Balance brought forward)
      // Descriptions array has "Balance brought forward" removed (it's skipped in parsing)
      // Dates array might include a date for "Balance brought forward" or might not
      // Balances array includes the opening balance

      openingBalance = allBalances[0];
      balanceOffset = 1;
      console.log(`📊 Opening balance detected: £${openingBalance.toFixed(2)}\n`);

      // Check if dates array also has an extra entry for brought forward
      if (allDates.length > allDescriptions.length) {
        dateOffset = 1;
        console.log(`   Dates array includes date for brought forward (will use dateOffset=1)\n`);

        // Add opening balance transaction using the dedicated date
        transactions.push({
          date: allDates[0],
          description: 'Balance brought forward',
          amount: 0,
          balance: openingBalance,
          type: 'brought_forward',
        });
      } else {
        console.log(`   Dates array does NOT include extra date for brought forward (dateOffset=0)\n`);
        console.log(`   Will use first transaction date for brought forward\n`);

        // Dates don't have an extra entry, so use the first transaction's date
        // This means brought forward shares the same date as the first transaction
        if (allDates.length > 0) {
          transactions.push({
            date: allDates[0],
            description: 'Balance brought forward',
            amount: 0,
            balance: openingBalance,
            type: 'brought_forward',
          });
        }
      }
    }

    // Use Money Out/In values directly since balance columns may be misaligned across pages
    console.log(`========== ASSEMBLING TRANSACTIONS ==========`);
    console.log(`Strategy: Use combined Money values array (preserves text order with interleaved debits/credits)\n`);
    console.log(`Available: ${allMoneyValues.length} combined money values\n`);

    let moneyValueIndex = 0;

    for (let i = 0; i < numTransactions; i++) {
      const date = allDates[i + dateOffset];
      const description = allDescriptions[i];
      const balance = allBalances[i + balanceOffset];

      // Determine transaction type from description
      let type: 'credit' | 'debit' = 'debit';
      let amount = 0;
      let amountSource = 'unknown';

      const lower = description?.toLowerCase() || '';

      // Determine if this is a credit or debit from description
      if (lower.includes('inward payment') || lower.includes('inward faster payment')) {
        type = 'credit';
      } else if (lower.includes('account to account transfer') && lower.includes('newman')) {
        // For Account to Account Transfer, check balance change to determine direction
        const prevBalance = i === 0 ? openingBalance : allBalances[(i - 1) + balanceOffset];
        if (prevBalance !== undefined && balance !== undefined) {
          type = (balance > prevBalance) ? 'credit' : 'debit';
        } else {
          type = 'credit'; // Default to credit for Newman transfers
        }
      } else if (lower.includes('outward') ||
                 lower.includes('card purchase') ||
                 lower.includes('atm cash withdrawal') ||
                 lower.includes('direct debit')) {
        type = 'debit';
      } else {
        // Unknown - use balance change if available
        const prevBalance = i === 0 ? openingBalance : allBalances[(i - 1) + balanceOffset];
        if (prevBalance !== undefined && balance !== undefined) {
          type = (balance >= prevBalance) ? 'credit' : 'debit';
        }
      }

      // Get amount from combined money values array
      // This preserves the order as values appear in PDF (with interleaved debits/credits)
      if (moneyValueIndex < allMoneyValues.length) {
        const moneyValue = allMoneyValues[moneyValueIndex];

        // Check if the type matches what we determined from the description
        if (moneyValue.type === type) {
          // Type matches - use this value
          amount = moneyValue.amount;
          amountSource = 'combined_array_matched';
          moneyValueIndex++;
        } else {
          // Type mismatch - look ahead for a matching type (within next 2 values)
          let found = false;
          for (let lookAhead = 0; lookAhead < Math.min(2, allMoneyValues.length - moneyValueIndex); lookAhead++) {
            const candidateValue = allMoneyValues[moneyValueIndex + lookAhead];
            if (candidateValue.type === type) {
              amount = candidateValue.amount;
              amountSource = 'combined_array_lookahead';
              moneyValueIndex++;
              found = true;
              break;
            }
          }
          if (!found) {
            // Use the value anyway but log the mismatch
            amount = moneyValue.amount;
            amountSource = 'combined_array_type_mismatch';
            moneyValueIndex++;
          }
        }
      } else {
        // No more money values - fallback to balance calculation
        const prevBalance = i === 0 ? openingBalance : allBalances[(i - 1) + balanceOffset];
        if (prevBalance !== undefined && balance !== undefined) {
          amount = Math.abs(balance - prevBalance);
          amountSource = 'balance_change_fallback';
        } else {
          amount = 0;
          amountSource = 'no_data';
        }
      }

      // Calculate expected balance by tracking running total
      let expectedBalance: number;
      if (transactions.length === 0) {
        // First transaction after brought forward
        expectedBalance = openingBalance !== undefined ? openingBalance : 0;
      } else {
        // Get previous transaction's balance
        const prevTransaction = transactions[transactions.length - 1];
        expectedBalance = prevTransaction.balance !== undefined ? prevTransaction.balance : 0;
      }

      // Apply this transaction's amount to get expected balance
      if (type === 'credit') {
        expectedBalance += amount;
      } else {
        expectedBalance -= amount;
      }

      // Use the balance from PDF, but mark if it doesn't match expected
      const pdfBalance = balance;
      const balanceMismatch = pdfBalance !== undefined && Math.abs(pdfBalance - expectedBalance) > 0.01;

      // Only add transaction if we have valid data
      if (date && description && amount > 0) {
        transactions.push({
          date,
          description,
          amount,
          balance: pdfBalance !== undefined ? pdfBalance : expectedBalance, // Use PDF balance if available
          type,
          balanceMismatch,
          expectedBalance,
        });

        // Log first 10 transactions for debugging
        if (transactions.length <= 10) {
          const typeSymbol = type === 'credit' ? '▲' : '▼';
          const mismatchWarning = balanceMismatch ? '⚠️ MISMATCH' : '✓';
          console.log(`[${String(i + 1).padStart(2)}] ${typeSymbol} ${date.padEnd(12)} | ${description.substring(0, 30).padEnd(30)} | ${type.toUpperCase().padEnd(6)} £${amount.toFixed(2).padStart(8)} | PDF: £${pdfBalance?.toFixed(2).padStart(8) || 'N/A    '} | Expected: £${expectedBalance.toFixed(2).padStart(8)} ${mismatchWarning} [${amountSource}]`);
        }
      } else {
        console.log(`[${String(i + 1).padStart(2)}] ⚠️  SKIPPED - date=${date ? '✓' : '✗'} desc=${description ? '✓' : '✗'} amount=${amount.toFixed(2)}`);
      }
    }

    console.log(`=================================================\n`);

    console.log(`\nExtracted ${transactions.length} Metro Bank transactions`);
    return transactions;
  }

  /**
   * Extract Metro Bank transactions using coordinate-based parsing
   * This method uses X,Y coordinates to reconstruct the table structure
   * and handles chaotic text ordering in Metro Bank PDFs
   */
  private async extractMetroBankTransactionsCoordinate(buffer: Buffer, parsedText: string): Promise<Transaction[]> {
    try {
      // Use the coordinate-based parser which handles chaotic text ordering
      // Pass parsed text for dates/descriptions, use coordinates for amounts/balances
      const transactions = await this.metroBankParser.parseMetroBankStatement(buffer, parsedText, false);
      return transactions;
    } catch (error) {
      console.error('⚠️  Coordinate-based Metro Bank parser failed, falling back to text-based parser:', error);
      // Fallback to old text-based parser if coordinate parsing fails
      return this.extractMetroBankTransactions(parsedText);
    }
  }

  // Extract transactions from Revolut bank statements
  private extractRevolutTransactions(text: string): Transaction[] {
    const transactions: Transaction[] = [];
    const lines = text.split('\n');

    console.log('Parsing Revolut statement...');

    // Revolut date pattern: "DD MMM YYYY" (e.g., "19 Jun 2025" or "19Jun2025" without spaces)
    // Also handle concatenated format like "19 Jun 2025Transfer from..."
    const revolutDatePattern = /(\d{1,2}\s*(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s*\d{4})/i;

    // Track whether we're in the transaction section
    let inTransactionSection = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      // Skip empty lines
      if (!line) continue;

      // Start of transaction section - look for "Account transactions from"
      if (line.includes('Account transactions from')) {
        inTransactionSection = true;
        console.log(`Found Revolut transaction section at line ${i}: "${line}"`);
        continue;
      }

      // Skip the header line with "DateDescriptionMoney"
      if (line.includes('DateDescription') || line.includes('Date Description')) {
        console.log(`Skipping header line: "${line}"`);
        continue;
      }

      // End of transaction section
      if (inTransactionSection && (
        line.includes('Report lost or stolen card') ||
        line.includes('Revolut Ltd') && line.includes('08804411') ||
        line.includes('authorised by the Financial Conduct Authority') ||
        line.includes('Registered address')
      )) {
        inTransactionSection = false;
        console.log('Reached end of transaction section');
        break;
      }

      // Skip header lines and non-transaction content
      if (!inTransactionSection ||
          line.includes('IBAN') ||
          line.includes('BIC') ||
          line.includes('Sort Code') ||
          line.includes('Account Number') ||
          line.includes('Balance summary') ||
          line.includes('Product') ||
          line.includes('Opening balance') ||
          line.includes('Money out') && line.includes('Money in') && line.includes('Closing') ||
          line.includes('Account (E-Money)') ||
          line.includes('The balance on your statement') ||
          line.match(/^Total\s+£/i)) {
        continue;
      }

      // Check if this line contains a date
      const dateMatch = line.match(revolutDatePattern);

      if (dateMatch) {
        const date = dateMatch[1].replace(/\s+/g, ' ').trim(); // Normalize spaces in date
        const dateIndex = line.indexOf(dateMatch[1]);
        const restOfLine = line.substring(dateIndex + dateMatch[1].length).trim();

        console.log(`Found transaction: ${date} - ${restOfLine.substring(0, 60)}...`);

        // Revolut format: "DD MMM YYYY Description MoneyOut MoneyIn Balance"
        // Extract all numbers (amounts with 2 decimal places)
        const numbers = restOfLine.match(/\d+\.\d{2}/g);

        if (numbers && numbers.length >= 1) {
          const amounts = numbers.map(n => parseFloat(n));

          // Find where the first number appears
          const firstNumberIndex = restOfLine.indexOf(numbers[0]);
          let description = restOfLine.substring(0, firstNumberIndex).trim();

          // If description is empty or very short, it might be on the next line(s)
          if (description.length < 3 && i + 1 < lines.length) {
            let j = i + 1;
            while (j < lines.length && j < i + 3) {
              const nextLine = lines[j].trim();
              // Stop if we hit another date or section marker
              if (revolutDatePattern.test(nextLine) ||
                  nextLine.includes('Report lost or stolen card') ||
                  nextLine.includes('Revolut Ltd')) {
                break;
              }
              // Skip if it's just numbers
              if (/^\d+\.\d{2}$/.test(nextLine)) {
                j++;
                continue;
              }
              // Add to description
              description += ' ' + nextLine;
              j++;
            }
            description = description.trim();
          }

          // Clean up description - remove extra spaces and metadata
          description = description
            .replace(/\s+/g, ' ')
            .replace(/£\s*$/g, '') // Remove trailing £ symbol
            .replace(/\s*£\s*$/g, '') // Remove £ with surrounding spaces at end
            .replace(/Reference:\s*/gi, '')
            .replace(/Sent from Revolut/gi, '')
            .replace(/From:\s*/gi, 'From ')
            .replace(/To:\s*/gi, 'To ')
            .trim();

          // Determine transaction type and amounts
          let moneyOut = 0;
          let moneyIn = 0;
          let balance = 0;
          let amount = 0;
          let type: 'credit' | 'debit' = 'debit';

          if (amounts.length === 1) {
            // Only one amount - could be money in/out with no balance
            // Check description for clues
            const lower = description.toLowerCase();
            if (lower.includes('transfer from') || lower.includes('from ')) {
              moneyIn = amounts[0];
              amount = moneyIn;
              type = 'credit';
            } else if (lower.includes('to ')) {
              moneyOut = amounts[0];
              amount = moneyOut;
              type = 'debit';
            } else {
              // Assume it's money in by default
              moneyIn = amounts[0];
              amount = moneyIn;
              type = 'credit';
            }
          } else if (amounts.length === 2) {
            // Two amounts - likely amount and balance
            amount = amounts[0];
            balance = amounts[1];

            // Determine type from description
            const lower = description.toLowerCase();
            if (lower.includes('transfer from') || lower.includes('from ')) {
              moneyIn = amount;
              type = 'credit';
            } else if (lower.includes('to ')) {
              moneyOut = amount;
              type = 'debit';
            } else {
              // Default to credit if unclear
              moneyIn = amount;
              type = 'credit';
            }
          } else if (amounts.length >= 3) {
            // Three amounts - money out, money in, balance
            moneyOut = amounts[amounts.length - 3];
            moneyIn = amounts[amounts.length - 2];
            balance = amounts[amounts.length - 1];

            // Determine which is the actual transaction
            if (moneyIn > 0 && (moneyOut === 0 || moneyOut < 0.01)) {
              amount = moneyIn;
              type = 'credit';
            } else if (moneyOut > 0 && (moneyIn === 0 || moneyIn < 0.01)) {
              amount = moneyOut;
              type = 'debit';
            } else if (moneyIn > 0) {
              // Both present - use description to decide
              const lower = description.toLowerCase();
              if (lower.includes('from')) {
                amount = moneyIn;
                type = 'credit';
              } else {
                amount = moneyOut;
                type = 'debit';
              }
            } else if (moneyOut > 0) {
              amount = moneyOut;
              type = 'debit';
            }
          }

          // Validate and add transaction
          if (amount > 0 && description && description.length > 2) {
            transactions.push({
              date,
              description,
              amount,
              balance: balance > 0 ? balance : undefined,
              type,
            });

            if (transactions.length <= 5) {
              console.log(`✓ ${date} | ${description.substring(0, 40)} | ${type} £${amount} | Bal: £${balance}`);
            }
          }
        }
      }
    }

    console.log(`Extracted ${transactions.length} Revolut transactions`);
    return transactions;
  }

  private extractMetadata(text: string): ParsedStatement["metadata"] {
    const metadata: ParsedStatement["metadata"] = {};

    // Try to extract account number
    const accountPattern = /account\s*(?:number|#)?\s*:?\s*(\d+)/gi;
    const accountMatch = text.match(accountPattern);
    if (accountMatch) {
      metadata.accountNumber = accountMatch[0].replace(/\D/g, "");
    }

    // Try to extract statement period
    const periodPattern = /(?:statement\s+period|period)\s*:?\s*([\w\s,\-/]+)/gi;
    const periodMatch = text.match(periodPattern);
    if (periodMatch) {
      metadata.statementPeriod = periodMatch[0].split(":")[1]?.trim();
    }

    return metadata;
  }
}
