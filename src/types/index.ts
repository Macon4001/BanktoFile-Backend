export interface Transaction {
  date: string;
  description: string;
  amount: number;
  balance?: number;
  type?: string;
  balanceMismatch?: boolean;
  expectedBalance?: number;
  isOpeningBalance?: boolean; // Mark opening balance / balance brought forward
  amountIn?: number; // For manual extraction with separate in/out columns
  amountOut?: number; // For manual extraction with separate in/out columns
  isTotal?: boolean; // Marks a summary/totals row (renders both Money In and Money Out)
}

export interface CapitalOneSection {
  title: string;
  transactions: Transaction[];
}

export interface ParsedStatement {
  transactions: Transaction[];
  metadata?: {
    accountNumber?: string;
    statementPeriod?: string;
    bankName?: string;
  };
  capitalOneSections?: CapitalOneSection[]; // For Capital One statements with multiple sections
  isCapitalOne?: boolean; // Flag to indicate Capital One statement
}
