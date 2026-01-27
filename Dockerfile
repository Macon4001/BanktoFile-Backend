# Use Node.js LTS Alpine image for smaller size
FROM node:20-alpine

# Install system dependencies required for PDF processing and OCR
RUN apk add --no-cache \
    poppler-utils \
    tesseract-ocr \
    ghostscript \
    cairo \
    pango \
    bash

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install Node.js dependencies
RUN npm ci --only=production

# Copy source code
COPY . .

# Build TypeScript
RUN npm run build

# Verify poppler installation
RUN which pdftoppm && pdftoppm -v || echo "WARNING: pdftoppm not available"

# Expose port (Railway will override this)
EXPOSE 3001

# Start the application
CMD ["npm", "start"]
