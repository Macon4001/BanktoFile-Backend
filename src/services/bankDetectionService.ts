/**
 * Bank Detection Service
 * Detects if a bank statement is from a non-UK bank
 */

export interface BankDetectionResult {
  isNonUK: boolean;
  indicators: string[];
  confidence: 'low' | 'medium' | 'high';
}

export class BankDetectionService {
  // Non-UK currency symbols and keywords
  private readonly NON_UK_INDICATORS = {
    // Indian indicators
    indian: ['₹', 'INR', 'UPI/', 'IFSC:', 'NEFT', 'RTGS', 'rupees', 'rupee'],

    // Mexican indicators
    mexican: ['estado de cuenta', 'banco santander méxico', 'ciudad de mexico', 'moneda nacional', 'MXN'],

    // European indicators
    european: ['€', 'EUR', 'IBAN:', 'SEPA'],

    // US/Canadian/Australian indicators
    northAmerican: ['USD', 'CAD', 'AUD', 'routing number', 'federal credit union'],
  };

  // UK indicators (presence of these suggests UK bank)
  private readonly UK_INDICATORS = [
    '£', 'GBP', 'sort code', 'Sort Code', 'SORT CODE',
    'building society', 'Building Society',
  ];

  /**
   * Detect if text is from a non-UK bank statement
   * Only performs quick scan of first ~2000 chars for performance
   */
  detectNonUKBank(text: string, quickScanOnly = true): BankDetectionResult {
    const scanText = quickScanOnly ? text.substring(0, 2000) : text;

    const foundIndicators: string[] = [];

    // Check for UK indicators first
    const hasUKIndicator = this.UK_INDICATORS.some(indicator =>
      scanText.includes(indicator)
    );

    // If UK indicators found, it's likely a UK bank
    if (hasUKIndicator) {
      return {
        isNonUK: false,
        indicators: [],
        confidence: 'high',
      };
    }

    // Check for non-UK indicators
    for (const [region, indicators] of Object.entries(this.NON_UK_INDICATORS)) {
      for (const indicator of indicators) {
        if (scanText.includes(indicator)) {
          foundIndicators.push(`${region}: ${indicator}`);
        }
      }
    }

    // Determine confidence based on number of indicators found
    let confidence: 'low' | 'medium' | 'high' = 'low';

    if (foundIndicators.length === 0) {
      return {
        isNonUK: false,
        indicators: [],
        confidence: 'high',
      };
    } else if (foundIndicators.length === 1) {
      confidence = 'low';
    } else if (foundIndicators.length === 2) {
      confidence = 'medium';
    } else {
      confidence = 'high';
    }

    return {
      isNonUK: foundIndicators.length > 0,
      indicators: foundIndicators,
      confidence,
    };
  }

  /**
   * Generate user-friendly message for non-UK bank detection
   */
  generateWarningMessage(result: BankDetectionResult): string {
    if (!result.isNonUK) {
      return '';
    }

    return 'This statement appears to be from an international bank. BankToFile is optimised for UK banks and we cannot guarantee accuracy for other formats.';
  }
}

// Export singleton instance
export const bankDetectionService = new BankDetectionService();
