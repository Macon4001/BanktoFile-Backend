# Hybrid OCR Implementation Guide

## Overview

The Bank Statement Converter now features a **hybrid OCR approach** that intelligently falls back to Tesseract.js OCR when standard PDF text extraction fails.

## How It Works

### 1. **Primary Method: Standard PDF Text Extraction**
- Uses `pdf-parse` library (fast, accurate, free)
- Works for 80-90% of bank statements (digital PDFs)
- **Processing time**: <1 second per document
- **Accuracy**: 99%+ for text-based PDFs

### 2. **Fallback Method: Tesseract.js OCR**
- Automatically triggered when:
  - PDF has insufficient text (likely scanned/image-based)
  - No transactions found despite having text
  - Text appears to be gibberish
- Uses Tesseract.js (free, open-source OCR)
- **Processing time**: 5-15 seconds per page
- **Accuracy**: 60-80% depending on image quality

## Workflow

```
┌─────────────────┐
│  PDF Uploaded   │
└────────┬────────┘
         │
         ▼
┌─────────────────────────────┐
│  1. Try pdf-parse           │
│     (Standard Text Extract) │
└────────┬────────────────────┘
         │
         ▼
    ┌────────┐
    │ Success?│──Yes──►┌──────────────────┐
    └────┬───┘         │ Return Results   │
         │             │ (Fast & Accurate)│
        No             └──────────────────┘
         │
         ▼
┌─────────────────────────────┐
│  2. Detect Scanned PDF      │
│     - Low text volume?      │
│     - Gibberish text?       │
│     - No transactions?      │
└────────┬────────────────────┘
         │
         ▼
┌─────────────────────────────┐
│  3. Fallback to OCR         │
│     (Tesseract.js)          │
└────────┬────────────────────┘
         │
         ▼
┌─────────────────────────────┐
│  4. OCR Text Cleanup        │
│     - Fix common errors     │
│     - O → 0, I → 1, etc.    │
└────────┬────────────────────┘
         │
         ▼
┌─────────────────────────────┐
│  5. Parse Transactions      │
│     - Extract dates/amounts │
│     - Return with metadata  │
└─────────────────────────────┘
```

## Technical Implementation

### Files Modified

1. **`src/services/ocrService.ts`** (NEW)
   - Tesseract.js integration
   - OCR text cleanup
   - Transaction extraction from OCR text

2. **`src/services/pdfParser.ts`** (UPDATED)
   - Added `isLikelyScannedPDF()` detection
   - Returns `needsOCR` flag when appropriate
   - Heuristic-based detection of image-based PDFs

3. **`src/controllers/uploadController.ts`** (UPDATED)
   - Hybrid fallback logic
   - Try pdf-parse first
   - Fall back to OCR if needed
   - Return OCR metadata (confidence score, usedOCR flag)

4. **`src/server.ts`** (UPDATED)
   - Initialize OCR service at startup (commented out for faster boot)
   - Graceful shutdown of OCR workers

### Detection Heuristics

The system detects scanned PDFs using:

```typescript
// 1. Text volume check
if (textLength < (numPages * 1000 * 0.2)) {
  // Less than 20% of expected text → likely scanned
  return true;
}

// 2. Gibberish check
const alphanumericRatio = alphanumericCount / textLength;
if (alphanumericRatio < 0.5) {
  // Less than 50% alphanumeric → likely gibberish/scanned
  return true;
}
```

### OCR Text Cleanup

Common OCR errors are automatically corrected:

```typescript
const replacements = {
  'E' → '£',  // Currency symbol
  'O' → '0',  // Letter O to zero
  'I' → '1',  // Letter I to one
  'l' → '1',  // Lowercase L to one
  'S' → '5',  // S confused with 5
  'B' → '8',  // B confused with 8
};
```

Examples:
- `"E45.S7"` → `"£45.57"`
- `"O1/12/2024"` → `"01/12/2024"`
- `"TEScO STORES"` → `"TESCO STORES"`

## API Response

When OCR is used, the API response includes:

```json
{
  "success": true,
  "csv": "...",
  "transactionCount": 15,
  "usedOCR": true,
  "ocrConfidence": 78.5,
  "metadata": { ... }
}
```

- **`usedOCR`**: `true` if Tesseract.js was used, `false` for standard parsing
- **`ocrConfidence`**: OCR confidence score (0-100%)
  - `>90%`: Excellent
  - `70-90%`: Good
  - `50-70%`: Fair (may have errors)
  - `<50%`: Poor (likely inaccurate)

## Performance

### Standard PDF Parsing
- **Speed**: <1 second
- **Accuracy**: 99%+
- **Cost**: Free
- **Use case**: Digital bank statements (majority of uploads)

### OCR Fallback
- **Speed**: 5-15 seconds per page
- **Accuracy**: 60-80%
- **Cost**: Free (Tesseract.js)
- **Use case**: Scanned/photographed bank statements

## Cost Analysis

| Solution | Cost | Speed | Accuracy | Setup |
|----------|------|-------|----------|-------|
| **Tesseract.js** (Current) | $0 | Slow (5-15s/page) | 60-80% | Easy |
| Google Cloud Vision | $1.50/1000 pages* | Fast (<1s) | 95%+ | Medium |
| Azure Computer Vision | $1.00/1000 pages* | Fast (<1s) | 95%+ | Medium |
| AWS Textract | $1.50/1000 pages | Fast (<1s) | 95%+ | Medium |

\*After free tier (Google: 1,000/month, Azure: 5,000/month)

## Upgrading to Cloud OCR

If you want better accuracy/speed, you can upgrade to cloud OCR:

### Option 1: Azure Computer Vision (Recommended)

1. **Create Azure Account**
   - https://azure.microsoft.com/free
   - 5,000 free OCR calls/month

2. **Install SDK**
   ```bash
   npm install @azure/cognitiveservices-computervision @azure/ms-rest-js
   ```

3. **Add Environment Variables**
   ```bash
   AZURE_VISION_KEY=your-key-here
   AZURE_VISION_ENDPOINT=https://your-resource.cognitiveservices.azure.com/
   ```

4. **Update `ocrService.ts`**
   - Replace Tesseract.js calls with Azure SDK
   - Keep cleanup logic the same

### Option 2: Google Cloud Vision

1. **Create Google Cloud Project**
   - https://console.cloud.google.com
   - Enable Vision API
   - 1,000 free OCR calls/month

2. **Install SDK**
   ```bash
   npm install @google-cloud/vision
   ```

3. **Add Credentials**
   ```bash
   GOOGLE_APPLICATION_CREDENTIALS=path/to/credentials.json
   ```

4. **Update `ocrService.ts`**
   - Replace Tesseract.js with Google Vision client
   - Keep transaction parsing logic

## Testing OCR

### Test with Digital PDF (No OCR)
```bash
curl -X POST http://localhost:3001/api/upload \
  -F "file=@digital-statement.pdf" \
  -H "Content-Type: multipart/form-data"
```

Expected output:
```json
{
  "usedOCR": false,
  "transactionCount": 15
}
```

### Test with Scanned PDF (OCR Triggered)
```bash
curl -X POST http://localhost:3001/api/upload \
  -F "file=@scanned-statement.pdf" \
  -H "Content-Type: multipart/form-data"
```

Expected output:
```json
{
  "usedOCR": true,
  "ocrConfidence": 78.5,
  "transactionCount": 12
}
```

## Troubleshooting

### OCR Takes Too Long
- **Cause**: Large multi-page documents
- **Solution**:
  - Process pages in parallel (requires worker pool)
  - Or upgrade to cloud OCR (much faster)

### Low OCR Confidence
- **Cause**: Poor image quality, skewed scan, low resolution
- **Solution**:
  - Ask user to rescan with better quality
  - Upgrade to cloud OCR (better at handling poor quality)
  - Pre-process images (deskew, enhance contrast)

### OCR Not Triggering
- **Cause**: Detection heuristics too strict
- **Solution**: Adjust thresholds in `isLikelyScannedPDF()`:
  ```typescript
  // Change from 20% to 30%
  if (textLength < expectedTextLength * 0.3)
  ```

### OCR Errors in Amounts
- **Cause**: Tesseract.js confuses similar characters
- **Solution**:
  - Add more cleanup rules in `cleanOCRText()`
  - Upgrade to cloud OCR (more accurate)

## Future Enhancements

1. **Confidence Threshold UI**
   - Show warning to user if OCR confidence < 70%
   - Allow user to manually review/correct transactions

2. **Parallel Page Processing**
   - Process multi-page documents faster using worker pool

3. **Image Pre-processing**
   - Deskew images
   - Enhance contrast
   - Remove noise

4. **Hybrid Cloud Approach**
   - Use Tesseract.js for low-volume
   - Switch to Azure/Google for high-volume users

5. **OCR Analytics**
   - Track OCR usage vs standard parsing
   - Monitor confidence scores
   - Identify problem documents

## Conclusion

The hybrid OCR approach provides:
- ✅ **No cost** for OCR (Tesseract.js is free)
- ✅ **Automatic fallback** for scanned documents
- ✅ **Good coverage** (handles both digital and scanned PDFs)
- ⚠️ **Slower processing** for scanned documents (5-15s vs <1s)
- ⚠️ **Lower accuracy** than cloud OCR (60-80% vs 95%+)

For production, consider upgrading to **Azure Computer Vision** (5,000 free/month) for better speed and accuracy.
