import * as XLSX from "xlsx";
import { Transaction } from "../types/index.js";

export class XLSXGenerator {
  generateXLSX(transactions: Transaction[]): Buffer {
    if (transactions.length === 0) {
      throw new Error("No transactions to convert");
    }

    // Convert transactions to worksheet data
    const worksheetData = [
      ["Date", "Description", "Type", "Amount", "Balance"], // Header row
      ...transactions.map((transaction) => [
        transaction.date,
        transaction.description,
        transaction.type || "N/A",
        transaction.amount.toFixed(2),
        transaction.balance ? transaction.balance.toFixed(2) : "N/A",
      ]),
    ];

    // Create worksheet
    const worksheet = XLSX.utils.aoa_to_sheet(worksheetData);

    // Set column widths
    worksheet["!cols"] = [
      { wch: 12 }, // Date
      { wch: 50 }, // Description
      { wch: 10 }, // Type
      { wch: 12 }, // Amount
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
