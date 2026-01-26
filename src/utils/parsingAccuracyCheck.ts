/**
 * Parsing Accuracy Sanity Check
 *
 * Detects when PDF parsing is likely inaccurate and should trigger OCR fallback.
 * This prevents bad parses from reaching the user.
 */

import { Transaction } from '../types/index.js';

export interface SanityCheckResult {
  passed: boolean;
  reason: string | null;
  confidence: 'high' | 'medium' | 'low';
  metrics?: {
    pageCount: number;
    textLength: number;
    transactionCount: number;
    expectedMinTransactions: number;
    missingAmounts: number;
  };
}

export interface SanityCheckInput {
  pageCount: number;
  textLength: number;
  transactions: Transaction[];
}

/**
 * Check if parsing results are accurate enough to return to user
 *
 * Rules:
 * 1. TOO_FEW_TRANSACTIONS - If pages > 2 AND transactions < (pages * 3)
 * 2. TRANSACTION_DENSITY_LOW - If textLength > 10000 AND transactions < 5 AND pages >= 3
 * 3. MISSING_AMOUNTS - If > 20% of transactions have no amount
 * 4. SUSPICIOUS_PATTERN - Single transaction per page on multi-page docs
 *
 * Special cases:
 * - 1-2 page documents: Always pass if any transactions found
 * - Small statements: Don't penalize for low transaction counts
 */
export function checkParsingAccuracy({
  pageCount,
  textLength,
  transactions
}: SanityCheckInput): SanityCheckResult {

  const txCount = transactions.length;

  // SKIP sanity check for small documents
  // 1-2 pages with any transactions = probably fine
  if (pageCount <= 2 && txCount > 0) {
    return {
      passed: true,
      reason: null,
      confidence: txCount >= 5 ? 'high' : 'medium',
      metrics: {
        pageCount,
        textLength,
        transactionCount: txCount,
        expectedMinTransactions: 0,
        missingAmounts: 0,
      },
    };
  }

  // Calculate expected minimum transactions
  // More lenient: at least 3 transactions per page for multi-page docs
  const minExpectedTx = Math.max(pageCount * 3, 5);

  // Rule 1: Too few transactions for page count
  // Only apply to documents with 3+ pages
  if (pageCount >= 3 && txCount < minExpectedTx) {
    return {
      passed: false,
      reason: `TOO_FEW_TRANSACTIONS: Found ${txCount} transactions for ${pageCount} pages (expected at least ${minExpectedTx}). This suggests parsing may have failed to extract all transactions.`,
      confidence: 'low',
      metrics: {
        pageCount,
        textLength,
        transactionCount: txCount,
        expectedMinTransactions: minExpectedTx,
        missingAmounts: 0,
      },
    };
  }

  // Rule 2: Lots of text but few transactions
  // Only flag if significant text AND multi-page
  if (textLength > 10000 && txCount < 5 && pageCount >= 3) {
    return {
      passed: false,
      reason: `TRANSACTION_DENSITY_LOW: Document contains ${textLength} characters but only ${txCount} transactions. This suggests the parser is not extracting transaction data correctly.`,
      confidence: 'low',
      metrics: {
        pageCount,
        textLength,
        transactionCount: txCount,
        expectedMinTransactions: minExpectedTx,
        missingAmounts: 0,
      },
    };
  }

  // Rule 3: Missing amounts
  const missingAmounts = transactions.filter(tx => !tx.amount || tx.amount === 0).length;
  if (txCount > 5 && missingAmounts / txCount > 0.2) {
    return {
      passed: false,
      reason: `MISSING_AMOUNTS: ${missingAmounts} out of ${txCount} transactions (${Math.round((missingAmounts / txCount) * 100)}%) have no amount. Parser likely grabbed wrong data.`,
      confidence: 'low',
      metrics: {
        pageCount,
        textLength,
        transactionCount: txCount,
        expectedMinTransactions: minExpectedTx,
        missingAmounts,
      },
    };
  }

  // Rule 4: Single transaction per page (suspicious pattern)
  // This often means we're only grabbing headers, not actual transactions
  if (pageCount > 3 && txCount === pageCount) {
    return {
      passed: false,
      reason: `SUSPICIOUS_PATTERN: Exactly 1 transaction per page (${txCount} transactions, ${pageCount} pages). This suggests header-only parsing instead of actual transaction data.`,
      confidence: 'low',
      metrics: {
        pageCount,
        textLength,
        transactionCount: txCount,
        expectedMinTransactions: minExpectedTx,
        missingAmounts,
      },
    };
  }

  // All checks passed - determine confidence level
  let confidence: 'high' | 'medium' | 'low' = 'low';
  if (txCount > 20) {
    confidence = 'high';
  } else if (txCount > 5) {
    confidence = 'medium';
  }

  return {
    passed: true,
    reason: null,
    confidence,
    metrics: {
      pageCount,
      textLength,
      transactionCount: txCount,
      expectedMinTransactions: minExpectedTx,
      missingAmounts,
    },
  };
}

/**
 * Log sanity check results in a user-friendly format
 */
export function logSanityCheckResult(result: SanityCheckResult): void {
  if (result.passed) {
    console.log(`✅ Sanity check PASSED: ${result.metrics?.transactionCount} transactions from ${result.metrics?.pageCount} pages (confidence: ${result.confidence})`);
  } else {
    console.log('⚠️  Sanity check FAILED:');
    console.log(`   Reason: ${result.reason}`);
    if (result.metrics) {
      console.log(`   Details:`);
      console.log(`   - Pages: ${result.metrics.pageCount}`);
      console.log(`   - Transactions found: ${result.metrics.transactionCount}`);
      console.log(`   - Expected minimum: ${result.metrics.expectedMinTransactions}`);
      console.log(`   - Text length: ${result.metrics.textLength} chars`);
      if (result.metrics.missingAmounts > 0) {
        console.log(`   - Missing amounts: ${result.metrics.missingAmounts}`);
      }
    }
    console.log('   Action: Triggering OCR fallback...');
  }
}
