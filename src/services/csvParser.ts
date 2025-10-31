import { Readable } from "stream";
import csvParser from "csv-parser";
import { Transaction, ParsedStatement } from "../types/index.js";

export class CSVParser {
  async parseCSV(buffer: Buffer): Promise<ParsedStatement> {
    return new Promise((resolve, reject) => {
      const transactions: Transaction[] = [];
      const stream = Readable.from(buffer);

      stream
        .pipe(csvParser())
        .on("data", (row: Record<string, string>) => {
          try {
            // Try to map common CSV column names to our transaction structure
            const transaction = this.mapRowToTransaction(row);
            if (transaction) {
              transactions.push(transaction);
            }
          } catch (error) {
            console.error("Error parsing CSV row:", error);
          }
        })
        .on("end", () => {
          resolve({
            transactions,
            metadata: {},
          });
        })
        .on("error", (error: Error) => {
          reject(new Error(`Failed to parse CSV: ${error.message}`));
        });
    });
  }

  private mapRowToTransaction(row: Record<string, string>): Transaction | null {
    // Common column name variations
    const dateKeys = ["date", "transaction date", "posting date", "Date", "Transaction Date"];
    const descriptionKeys = ["description", "details", "memo", "Description", "Details", "Memo"];
    const amountKeys = ["amount", "debit", "credit", "Amount", "Debit", "Credit"];
    const balanceKeys = ["balance", "Balance", "running balance", "Running Balance"];
    const typeKeys = ["type", "Type", "transaction type", "Transaction Type"];

    // Find date
    const dateKey = dateKeys.find((key) => row[key] !== undefined);
    const date = dateKey ? row[dateKey] : "";

    // Find description
    const descriptionKey = descriptionKeys.find((key) => row[key] !== undefined);
    const description = descriptionKey ? row[descriptionKey] : "Unknown transaction";

    // Find amount (try debit/credit first, then amount)
    let amount = 0;
    let type: string | undefined;

    if (row["debit"] || row["Debit"]) {
      const debitStr = (row["debit"] || row["Debit"]).replace(/[$,\s]/g, "");
      amount = parseFloat(debitStr);
      type = "debit";
    } else if (row["credit"] || row["Credit"]) {
      const creditStr = (row["credit"] || row["Credit"]).replace(/[$,\s]/g, "");
      amount = parseFloat(creditStr);
      type = "credit";
    } else {
      const amountKey = amountKeys.find((key) => row[key] !== undefined);
      if (amountKey) {
        const amountStr = row[amountKey].replace(/[$,\s]/g, "");
        amount = parseFloat(amountStr);
        type = amount < 0 ? "debit" : "credit";
        amount = Math.abs(amount);
      }
    }

    // Find balance
    const balanceKey = balanceKeys.find((key) => row[key] !== undefined);
    const balance = balanceKey
      ? parseFloat(row[balanceKey].replace(/[$,\s]/g, ""))
      : undefined;

    // Find type if not already determined
    if (!type) {
      const typeKey = typeKeys.find((key) => row[key] !== undefined);
      type = typeKey ? row[typeKey].toLowerCase() : undefined;
    }

    // Validate required fields
    if (!date || isNaN(amount)) {
      return null;
    }

    return {
      date,
      description,
      amount,
      balance: balance && !isNaN(balance) ? balance : undefined,
      type,
    };
  }
}
