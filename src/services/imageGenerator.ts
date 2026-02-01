import sharp from 'sharp';

interface ImageOptions {
  title: string;
  category?: string;
}

/**
 * Generate a branded featured image for blog posts
 * Creates a 1200x630 image with dark navy gradient background
 */
export async function generateFeaturedImage(options: ImageOptions): Promise<Buffer> {
  const { title, category = 'BLOG' } = options;

  // Split title into lines (max 3 lines, ~25 chars per line)
  const lines = wrapText(title, 25);
  const fontSize = lines.length > 2 ? 44 : 52;

  // Calculate vertical position for title
  const titleStartY = 280;
  const lineHeight = fontSize + 10;

  // Build title text elements
  const titleElements = lines
    .map((line, i) => {
      const y = titleStartY + i * lineHeight;
      return `<text x="80" y="${y}"
         font-family="Arial, Helvetica, sans-serif"
         font-size="${fontSize}" font-weight="bold"
         fill="white">${escapeXml(line)}</text>`;
    })
    .join('\n        ');

  // Calculate position for divider and category
  const dividerY = titleStartY + lines.length * lineHeight + 15;
  const categoryY = dividerY + 35;

  const svg = `
  <svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg">
      <defs>
          <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" style="stop-color:#0A1628"/>
              <stop offset="100%" style="stop-color:#162A4A"/>
          </linearGradient>
      </defs>

      <!-- Background -->
      <rect width="1200" height="630" fill="url(#bg)"/>

      <!-- Brand name -->
      <text x="80" y="100" font-family="Arial, Helvetica, sans-serif"
            font-size="24" font-weight="bold" fill="#16a34a"
            letter-spacing="3">BANKTOFILE</text>

      <!-- Title -->
      ${titleElements}

      <!-- Divider -->
      <line x1="80" y1="${dividerY}"
            x2="400" y2="${dividerY}"
            stroke="#16a34a" stroke-width="2"/>

      <!-- Category -->
      <text x="80" y="${categoryY}"
            font-family="Arial, Helvetica, sans-serif"
            font-size="20" fill="#16a34a"
            letter-spacing="2">${escapeXml(category.toUpperCase())}</text>

      <!-- Decorative dots (subtle) -->
      <circle cx="1100" cy="100" r="3" fill="#16a34a" opacity="0.3"/>
      <circle cx="1130" cy="100" r="3" fill="#16a34a" opacity="0.2"/>
      <circle cx="1100" cy="130" r="3" fill="#16a34a" opacity="0.2"/>
      <circle cx="1130" cy="130" r="3" fill="#16a34a" opacity="0.1"/>

      <!-- Additional decorative elements at bottom -->
      <circle cx="1000" cy="550" r="2" fill="#16a34a" opacity="0.15"/>
      <circle cx="1050" cy="570" r="2" fill="#16a34a" opacity="0.15"/>
      <circle cx="1100" cy="550" r="2" fill="#16a34a" opacity="0.15"/>
  </svg>`;

  // Convert SVG to PNG buffer
  const imageBuffer = await sharp(Buffer.from(svg)).png().toBuffer();

  return imageBuffer;
}

/**
 * Wrap text into multiple lines based on max characters per line
 * @param text - The text to wrap
 * @param maxCharsPerLine - Maximum characters per line
 * @returns Array of text lines (max 3 lines)
 */
function wrapText(text: string, maxCharsPerLine: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let currentLine = '';

  for (const word of words) {
    const testLine = currentLine ? `${currentLine} ${word}` : word;

    if (testLine.length > maxCharsPerLine && currentLine) {
      // Current line is full, push it and start new line
      lines.push(currentLine.trim());
      currentLine = word;

      // Stop at 3 lines
      if (lines.length >= 3) {
        // If there are more words, add ellipsis
        const remainingWords = words.slice(words.indexOf(word) + 1);
        if (remainingWords.length > 0) {
          currentLine += '...';
        }
        break;
      }
    } else {
      currentLine = testLine;
    }
  }

  // Add the last line if it exists and we haven't reached max lines
  if (currentLine.trim() && lines.length < 3) {
    lines.push(currentLine.trim());
  }

  return lines;
}

/**
 * Escape XML special characters for safe SVG rendering
 * @param text - Text to escape
 * @returns Escaped text
 */
function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
