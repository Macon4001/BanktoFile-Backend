import * as XLSX from "xlsx";
import { Transaction } from "../types/index.js";

export class XLSXGenerator {
  generateXLSX(transactions: Transaction[]): Buffer {
    if (transactions.length === 0) {
      throw new Error("No transactions to convert");
    }

    // Convert transactions to worksheet data
    const worksheetData = [
      ["Date", "Description", "Type", "Money In", "Money Out", "Balance"], // Header row
      ...transactions.map((transaction) => {
        const isCredit = transaction.type?.toLowerCase() === 'credit';
        const isDebit = transaction.type?.toLowerCase() === 'debit';

        return [
          transaction.date,
          transaction.description,
          transaction.type || "N/A",
          isCredit ? transaction.amount.toFixed(2) : "",
          isDebit ? transaction.amount.toFixed(2) : "",
          transaction.balance !== undefined ? transaction.balance.toFixed(2) : "",
        ];
      }),
    ];

    // Create worksheet
    const worksheet = XLSX.utils.aoa_to_sheet(worksheetData);

    // Set column widths
    worksheet["!cols"] = [
      { wch: 12 }, // Date
      { wch: 50 }, // Description
      { wch: 15 }, // Type
      { wch: 12 }, // Money In
      { wch: 12 }, // Money Out
      { wch: 12 }, // Balance
    ];

    // Create workbook
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Transactions");

    // Generate buffer
    const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });

    return buffer;
  }
}
