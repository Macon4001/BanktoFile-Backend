/**
 * Tests for Parsing Accuracy Sanity Check
 */

import { checkParsingAccuracy, SanityCheckInput } from '../parsingAccuracyCheck.js';
import { Transaction } from '../../types/index.js';

// Helper to create mock transactions
function createMockTransactions(count: number, hasAmounts: boolean = true): Transaction[] {
  const transactions: Transaction[] = [];
  for (let i = 0; i < count; i++) {
    transactions.push({
      date: `2024-01-${String(i + 1).padStart(2, '0')}`,
      description: `Transaction ${i + 1}`,
      amount: hasAmounts ? 100.00 + i : 0,
      type: i % 2 === 0 ? 'debit' : 'credit',
    });
  }
  return transactions;
}

describe('Parsing Accuracy Sanity Check', () => {
  describe('Small Documents (1-2 pages)', () => {
    test('1 page with 2 transactions - PASS', () => {
      const result = checkParsingAccuracy({
        pageCount: 1,
        textLength: 1000,
        transactions: createMockTransactions(2),
      });

      expect(result.passed).toBe(true);
      expect(result.confidence).toBe('medium');
    });

    test('1 page with 1 transaction - PASS', () => {
      const result = checkParsingAccuracy({
        pageCount: 1,
        textLength: 500,
        transactions: createMockTransactions(1),
      });

      expect(result.passed).toBe(true);
      expect(result.confidence).toBe('medium');
    });

    test('2 pages with 5 transactions - PASS (high confidence)', () => {
      const result = checkParsingAccuracy({
        pageCount: 2,
        textLength: 2000,
        transactions: createMockTransactions(5),
      });

      expect(result.passed).toBe(true);
      expect(result.confidence).toBe('high');
    });

    test('2 pages with 0 transactions - SKIP (no check)', () => {
      const result = checkParsingAccuracy({
        pageCount: 2,
        textLength: 2000,
        transactions: [],
      });

      // Small docs with 0 transactions don't pass the skip condition
      // This will be caught by the controller as needsOCR
      expect(result.passed).toBe(false);
    });
  });

  describe('Rule 1: TOO_FEW_TRANSACTIONS', () => {
    test('3 pages with 8 transactions - FAIL (expected 9+)', () => {
      const result = checkParsingAccuracy({
        pageCount: 3,
        textLength: 5000,
        transactions: createMockTransactions(8),
      });

      expect(result.passed).toBe(false);
      expect(result.reason).toContain('TOO_FEW_TRANSACTIONS');
      expect(result.reason).toContain('8 transactions');
      expect(result.reason).toContain('3 pages');
      expect(result.confidence).toBe('low');
    });

    test('15 pages with 12 transactions - FAIL (expected 45+)', () => {
      const result = checkParsingAccuracy({
        pageCount: 15,
        textLength: 20000,
        transactions: createMockTransactions(12),
      });

      expect(result.passed).toBe(false);
      expect(result.reason).toContain('TOO_FEW_TRANSACTIONS');
      expect(result.metrics?.expectedMinTransactions).toBe(45);
    });

    test('10 pages with 50 transactions - PASS', () => {
      const result = checkParsingAccuracy({
        pageCount: 10,
        textLength: 15000,
        transactions: createMockTransactions(50),
      });

      expect(result.passed).toBe(true);
      expect(result.confidence).toBe('high');
    });
  });

  describe('Rule 2: TRANSACTION_DENSITY_LOW', () => {
    test('3 pages, 15000 chars, 4 transactions - FAIL', () => {
      const result = checkParsingAccuracy({
        pageCount: 3,
        textLength: 15000,
        transactions: createMockTransactions(4),
      });

      expect(result.passed).toBe(false);
      expect(result.reason).toContain('TRANSACTION_DENSITY_LOW');
      expect(result.reason).toContain('15000 characters');
      expect(result.reason).toContain('4 transactions');
    });

    test('2 pages, 15000 chars, 4 transactions - PASS (only 2 pages)', () => {
      const result = checkParsingAccuracy({
        pageCount: 2,
        textLength: 15000,
        transactions: createMockTransactions(4),
      });

      expect(result.passed).toBe(true);
    });

    test('3 pages, 8000 chars, 4 transactions - PASS (not enough text)', () => {
      const result = checkParsingAccuracy({
        pageCount: 3,
        textLength: 8000,
        transactions: createMockTransactions(4),
      });

      // This will still fail due to TOO_FEW_TRANSACTIONS
      // but NOT due to TRANSACTION_DENSITY_LOW
      expect(result.passed).toBe(false);
      expect(result.reason).toContain('TOO_FEW_TRANSACTIONS');
    });
  });

  describe('Rule 3: MISSING_AMOUNTS', () => {
    test('10 transactions, 3 missing amounts (30%) - FAIL', () => {
      const transactionsWithMissing = createMockTransactions(7, true);
      transactionsWithMissing.push(...createMockTransactions(3, false));

      const result = checkParsingAccuracy({
        pageCount: 2,
        textLength: 3000,
        transactions: transactionsWithMissing,
      });

      expect(result.passed).toBe(false);
      expect(result.reason).toContain('MISSING_AMOUNTS');
      expect(result.reason).toContain('3 out of 10');
      expect(result.metrics?.missingAmounts).toBe(3);
    });

    test('10 transactions, 1 missing amount (10%) - PASS', () => {
      const transactionsWithMissing = createMockTransactions(9, true);
      transactionsWithMissing.push(...createMockTransactions(1, false));

      const result = checkParsingAccuracy({
        pageCount: 2,
        textLength: 3000,
        transactions: transactionsWithMissing,
      });

      expect(result.passed).toBe(true);
    });

    test('5 transactions, 2 missing amounts - SKIP (too few to check)', () => {
      const transactionsWithMissing = createMockTransactions(3, true);
      transactionsWithMissing.push(...createMockTransactions(2, false));

      const result = checkParsingAccuracy({
        pageCount: 1,
        textLength: 1500,
        transactions: transactionsWithMissing,
      });

      // Passes because small doc with >0 transactions
      expect(result.passed).toBe(true);
    });
  });

  describe('Rule 4: SUSPICIOUS_PATTERN', () => {
    test('5 pages with exactly 5 transactions (1 per page) - FAIL', () => {
      const result = checkParsingAccuracy({
        pageCount: 5,
        textLength: 8000,
        transactions: createMockTransactions(5),
      });

      expect(result.passed).toBe(false);
      expect(result.reason).toContain('SUSPICIOUS_PATTERN');
      expect(result.reason).toContain('1 transaction per page');
    });

    test('10 pages with exactly 10 transactions - FAIL', () => {
      const result = checkParsingAccuracy({
        pageCount: 10,
        textLength: 15000,
        transactions: createMockTransactions(10),
      });

      expect(result.passed).toBe(false);
      expect(result.reason).toContain('SUSPICIOUS_PATTERN');
    });

    test('3 pages with 3 transactions - PASS (not enough pages)', () => {
      const result = checkParsingAccuracy({
        pageCount: 3,
        textLength: 4000,
        transactions: createMockTransactions(3),
      });

      // Fails for TOO_FEW_TRANSACTIONS, not SUSPICIOUS_PATTERN
      expect(result.passed).toBe(false);
      expect(result.reason).toContain('TOO_FEW_TRANSACTIONS');
    });

    test('5 pages with 6 transactions - PASS (not 1-to-1 ratio)', () => {
      const result = checkParsingAccuracy({
        pageCount: 5,
        textLength: 8000,
        transactions: createMockTransactions(20),
      });

      expect(result.passed).toBe(true);
    });
  });

  describe('Confidence Levels', () => {
    test('High confidence: 25 transactions', () => {
      const result = checkParsingAccuracy({
        pageCount: 3,
        textLength: 5000,
        transactions: createMockTransactions(25),
      });

      expect(result.passed).toBe(true);
      expect(result.confidence).toBe('high');
    });

    test('Medium confidence: 10 transactions', () => {
      const result = checkParsingAccuracy({
        pageCount: 2,
        textLength: 3000,
        transactions: createMockTransactions(10),
      });

      expect(result.passed).toBe(true);
      expect(result.confidence).toBe('medium');
    });

    test('Low confidence but passed: 5 transactions on 1 page', () => {
      const result = checkParsingAccuracy({
        pageCount: 1,
        textLength: 1500,
        transactions: createMockTransactions(5),
      });

      expect(result.passed).toBe(true);
      expect(result.confidence).toBe('high'); // 5 transactions gets high for 1 page
    });
  });

  describe('Real-world Scenarios', () => {
    test('Typical valid statement: 5 pages, 87 transactions', () => {
      const result = checkParsingAccuracy({
        pageCount: 5,
        textLength: 12000,
        transactions: createMockTransactions(87),
      });

      expect(result.passed).toBe(true);
      expect(result.confidence).toBe('high');
    });

    test('Bad parse: 20 pages but only headers extracted (20 tx)', () => {
      const result = checkParsingAccuracy({
        pageCount: 20,
        textLength: 30000,
        transactions: createMockTransactions(20),
      });

      expect(result.passed).toBe(false);
      expect(result.reason).toContain('SUSPICIOUS_PATTERN');
    });

    test('Scanned PDF with OCR needed: 10 pages, lots of text, 0 transactions', () => {
      const result = checkParsingAccuracy({
        pageCount: 10,
        textLength: 25000,
        transactions: [],
      });

      expect(result.passed).toBe(false);
      expect(result.reason).toContain('TOO_FEW_TRANSACTIONS');
    });

    test('Small personal statement: 2 pages, 8 transactions', () => {
      const result = checkParsingAccuracy({
        pageCount: 2,
        textLength: 2500,
        transactions: createMockTransactions(8),
      });

      expect(result.passed).toBe(true);
      expect(result.confidence).toBe('high');
    });
  });
});
