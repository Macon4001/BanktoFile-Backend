import pdfParse from "pdf-parse";
import { Transaction, ParsedStatement } from "../types/index.js";

export class PDFParser {
  async parsePDF(buffer: Buffer): Promise<ParsedStatement & { rawText: string }> {
    try {
      const data = await pdfParse(buffer);
      const text = data.text;

      console.log("PDF Text extracted (first 1000 chars):", text.substring(0, 1000)); // Debug log
      console.log("PDF Text length:", text.length); // Debug log
      console.log("PDF Number of pages:", data.numpages); // Debug log

      // Extract transactions from the PDF text
      const transactions = this.extractTransactions(text);

      console.log(`Extracted ${transactions.length} transactions`); // Debug log
      if (transactions.length > 0) {
        console.log("First transaction:", transactions[0]);
      }

      return {
        transactions,
        metadata: this.extractMetadata(text),
        rawText: text,
      };
    } catch (error) {
      console.error("Error parsing PDF:", error);
      throw new Error("Failed to parse PDF file");
    }
  }

  private extractTransactions(text: string): Transaction[] {
    const transactions: Transaction[] = [];
    const lines = text.split("\n");

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
