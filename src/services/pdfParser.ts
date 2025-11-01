import pdfParse from "pdf-parse";
import { Transaction, ParsedStatement } from "../types/index.js";

export class PDFParser {
  async parsePDF(buffer: Buffer): Promise<ParsedStatement & { rawText: string; needsOCR?: boolean }> {
    try {
      const data = await pdfParse(buffer);
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

      // Extract transactions from the PDF text
      const transactions = this.extractTransactions(text);

      console.log(`Extracted ${transactions.length} transactions`); // Debug log
      if (transactions.length > 0) {
        console.log("First transaction:", transactions[0]);
      }

      // If no transactions found despite having text, might still need OCR
      const needsOCR = transactions.length === 0 && text.length > 0;
      if (needsOCR) {
        console.log("⚠️  No transactions found in text - might need OCR fallback");
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

    // Common date patterns (non-global for better matching)
    const datePatterns = [
      /\b(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})\b/, // MM/DD/YYYY or DD/MM/YYYY
      /\b(\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2})\b/, // YYYY-MM-DD
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
      const dateMatch = line.match(/\b(\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{2,4}|\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})\b/i);
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
      const line3 = lines[i + 2]?.trim().toLowerCase() || '';
      const line4 = lines[i + 3]?.trim() || '';
      const line5 = lines[i + 4]?.trim().toLowerCase() || '';
      const line6 = lines[i + 5]?.trim() || '';

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
          // Find where the last two numbers start in the string
          const lastTwoNumbers = amountStr + balanceStr;
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
        let description = dateMatch[2].trim();

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

    // Extract year from "Statement DD Month YYYY" header
    let statementYear = '2025'; // Default
    const yearMatch = text.match(/Statement\s+\d{1,2}\s+\w+\s+(\d{4})/i);
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
        let description = dateMatch[2].trim();

        console.log(`Found dated transaction: ${currentDate} - ${line.substring(0, 60)}...`);

        // Nationwide format: "DD MMM Description Out In Balance"
        // Extract all numbers (Out, In, Balance)
        const numbers = description.match(/[\d,]+\.?\d{0,2}/g);

        if (numbers && numbers.length >= 1) {
          const amounts = numbers.map(n => parseFloat(n.replace(/,/g, '')));

          // Find where the first number appears
          const firstNumberIndex = description.indexOf(numbers[0]);
          let desc = description.substring(0, firstNumberIndex).trim();

          // Determine transaction type based on number count and position
          let out = 0;
          let inAmount = 0;
          let balance = 0;
          let amount = 0;
          let type: 'credit' | 'debit' = 'debit';

          if (amounts.length === 1) {
            // Only balance (no transaction amount)
            balance = amounts[0];
            continue; // Skip lines with only balance
          } else if (amounts.length === 2) {
            // Either Out+Balance or In+Balance
            amount = amounts[0];
            balance = amounts[1];

            // Check if description suggests credit
            const lower = desc.toLowerCase();
            if (lower.includes('bank credit') ||
                lower.includes('automated credit') ||
                lower.includes('credit transfer') ||
                lower.includes('paid in')) {
              inAmount = amount;
              type = 'credit';
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

            if (transactions.length <= 5) {
              console.log(`✓ ${currentDate} | ${desc.substring(0, 30)} | ${type} £${amount} | Bal: £${balance}`);
            }
          }
        }
      }
    }

    console.log(`Extracted ${transactions.length} Nationwide transactions`);
    return transactions;
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
        let description = dateMatch[2].trim();

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

  private extractMetadata(text: string): ParsedStatement["metadata"] {
    const metadata: ParsedStatement["metadata"] = {};

    // Try to extract account number
    const accountPattern = /account\s*(?:number|#)?\s*:?\s*(\d+)/gi;
    const accountMatch = text.match(accountPattern);
    if (accountMatch) {
      metadata.accountNumber = accountMatch[0].replace(/\D/g, "");
    }

    // Try to extract statement period
    const periodPattern = /(?:statement\s+period|period)\s*:?\s*([\w\s,\-\/]+)/gi;
    const periodMatch = text.match(periodPattern);
    if (periodMatch) {
      metadata.statementPeriod = periodMatch[0].split(":")[1]?.trim();
    }

    return metadata;
  }
}
