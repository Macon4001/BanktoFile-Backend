/**
 * Bank Format Detection Service
 * Detects bank statement formats to optimize parsing strategy
 */

export interface BankDetectionResult {
  isNonUK: boolean; // Legacy field - now indicates "non-standard format"
  indicators: string[];
  confidence: 'low' | 'medium' | 'high';
}

export class BankDetectionService {
  // Standard format indicators (well-supported formats)
  private readonly STANDARD_INDICATORS = {
    // UK format indicators
    uk: ['£', 'GBP', 'sort code', 'Sort Code', 'SORT CODE', 'building society', 'Building Society'],

    // US format indicators
    us: ['USD', 'routing number', 'federal credit union', 'checking account', 'savings account'],

    // Canadian format indicators
    canadian: ['CAD', 'Canadian dollar', 'transit number', 'institution number'],

    // European format indicators
    european: ['€', 'EUR', 'IBAN:', 'SEPA'],
  };

  // Non-standard format indicators (may require manual extraction)
  private readonly NON_STANDARD_INDICATORS = {
    // Indian indicators
    indian: ['₹', 'INR', 'UPI/', 'IFSC:', 'NEFT', 'RTGS', 'rupees', 'rupee'],

    // Mexican indicators
    mexican: ['estado de cuenta', 'banco santander méxico', 'ciudad de mexico', 'moneda nacional', 'MXN'],

    // Other less common formats
    other: ['BRL', 'JPY', 'CNY', 'SGD', 'HKD', 'NZD'],
  };

  /**
   * Detect bank statement format
   * Returns whether format may require manual extraction
   * Only performs quick scan of first ~2000 chars for performance
   */
  detectNonUKBank(text: string, quickScanOnly = true): BankDetectionResult {
    const scanText = quickScanOnly ? text.substring(0, 2000) : text;

    const foundIndicators: string[] = [];

    // Check for standard format indicators first (UK, US, Canada, EU)
    const hasStandardIndicator = Object.values(this.STANDARD_INDICATORS)
      .flat()
      .some(indicator => scanText.includes(indicator));

    // If standard format indicators found, automatic parsing should work
    if (hasStandardIndicator) {
      return {
        isNonUK: false, // Legacy field: false means standard format
        indicators: [],
        confidence: 'high',
      };
    }

    // Check for non-standard format indicators
    for (const [region, indicators] of Object.entries(this.NON_STANDARD_INDICATORS)) {
      for (const indicator of indicators) {
        if (scanText.includes(indicator)) {
          foundIndicators.push(`${region}: ${indicator}`);
        }
      }
    }

    // Determine confidence based on number of indicators found
    let confidence: 'low' | 'medium' | 'high' = 'low';

    if (foundIndicators.length === 0) {
      // No indicators found - assume standard format
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
      isNonUK: foundIndicators.length > 0, // Legacy field: true means non-standard format
      indicators: foundIndicators,
      confidence,
    };
  }

  /**
   * Generate user-friendly message for non-standard format detection
   */
  generateWarningMessage(result: BankDetectionResult): string {
    if (!result.isNonUK) {
      return '';
    }

    return 'This statement format may require manual extraction for best results. We continuously improve support for all bank statement formats worldwide.';
  }
}

// Export singleton instance
export const bankDetectionService = new BankDetectionService();
