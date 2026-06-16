import { stringify } from "csv-stringify/sync";
import { Transaction } from "../types/index.js";
import { CapitalOneSection } from "./capitalOneParser.js";

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
        Balance: transaction.balance !== undefined ? transaction.balance.toFixed(2) : "",
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

  /**
   * Generate a multi-table CSV for Capital One statements with sections
   */
  generateCapitalOneSectionedCSV(sections: CapitalOneSection[]): string {
    console.log('=== CSV GENERATOR: Generating Capital One sectioned CSV ===');
    console.log(`   Sections: ${sections.length}`);

    const csvParts: string[] = [];

    sections.forEach((section, sectionIdx) => {
      console.log(`   [Section ${sectionIdx + 1}] ${section.title}: ${section.transactions.length} transactions`);

      // Add section header
      csvParts.push(`\n=== ${section.title} ===\n`);

      // Determine columns based on section type
      let columns: string[];
      let records: Array<Record<string, string>>;

      if (section.title === 'Checks') {
        // Checks section: Date, Check No, Amount
        columns = ["Date", "Check No", "Amount"];
        records = section.transactions.map(t => {
          // Extract check number from description (e.g., "Check 314" -> "314")
          const checkNoMatch = t.description.match(/Check (\d+\*?)/);
          const checkNo = checkNoMatch ? checkNoMatch[1] : '';

          return {
            Date: t.date,
            "Check No": checkNo,
            Amount: t.amount.toFixed(2)
          };
        });
      } else {
        // Deposits, Withdrawals, Debit/ATM: Date, Description, Amount
        columns = ["Date", "Description", "Amount"];
        records = section.transactions.map(t => ({
          Date: t.date,
          Description: t.description,
          Amount: t.amount.toFixed(2)
        }));
      }

      // Generate CSV for this section
      const sectionCSV = stringify(records, {
        header: true,
        columns: columns,
      });

      csvParts.push(sectionCSV);
    });

    const finalCSV = csvParts.join('');

    console.log('=== GENERATED SECTIONED CSV (first 2000 chars) ===');
    console.log(finalCSV.substring(0, 2000));
    console.log('=== END SECTIONED CSV ===');

    return finalCSV;
  }
}
