export interface Transaction {
  date: string;
  description: string;
  amount: number;
  balance?: number;
  type?: string;
  balanceMismatch?: boolean;
  expectedBalance?: number;
  isOpeningBalance?: boolean; // Mark opening balance / balance brought forward
}

export interface ParsedStatement {
  transactions: Transaction[];
  metadata?: {
    accountNumber?: string;
    statementPeriod?: string;
    bankName?: string;
  };
}
