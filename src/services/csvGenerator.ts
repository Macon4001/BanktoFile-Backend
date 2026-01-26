import { stringify } from "csv-stringify/sync";
import { Transaction } from "../types/index.js";

export class CSVGenerator {
  generateCSV(transactions: Transaction[]): string {
    if (transactions.length === 0) {
      throw new Error("No transactions to convert");
    }

    console.log('=== CSV GENERATOR: Input Transactions ===');
    transactions.forEach((t, idx) => {
      console.log(`[${idx}] Date: "${t.date}" | Desc: "${t.description}" | Type: "${t.type}" | Amount: ${t.amount} | Balance: ${t.balance}`);
    });
    console.log('=== END CSV INPUT ===');

    // Define CSV columns
    const columns = ["Date", "Description", "Type", "Money In", "Money Out", "Balance"];

    // Convert transactions to rows
    const records = transactions.map((transaction, idx) => {
      console.log(`[CSV Record ${idx}] Creating row with type: "${transaction.type}"`);
      const isCredit = transaction.type?.toLowerCase() === 'credit';
      const isDebit = transaction.type?.toLowerCase() === 'debit';

      return {
        Date: transaction.date,
        Description: transaction.description,
        Type: transaction.type || "N/A",
        "Money In": isCredit ? transaction.amount.toFixed(2) : "",
        "Money Out": isDebit ? transaction.amount.toFixed(2) : "",
        Balance: transaction.balance ? transaction.balance.toFixed(2) : "N/A",
      };
    });

    // Generate CSV string
    const csv = stringify(records, {
      header: true,
      columns: columns,
    });

    console.log('=== GENERATED CSV (first 2000 chars) ===');
    console.log(csv.substring(0, 2000));
    console.log('=== END CSV ===');

    return csv;
  }
}
