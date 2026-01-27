# Build stage
FROM node:20-alpine AS builder

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

# Install ALL dependencies (including devDependencies for build)
# Skip prepare script (husky) which isn't needed in Docker
RUN npm ci --ignore-scripts && npm rebuild

# Copy source code
COPY . .

# Build TypeScript
RUN npm run build

# Production stage
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

# Install only production dependencies
# Skip prepare script (husky) which isn't needed in Docker
RUN npm ci --only=production --ignore-scripts

# Copy built files from builder stage
COPY --from=builder /app/dist ./dist

# Verify poppler installation
RUN which pdftoppm && pdftoppm -v || echo "WARNING: pdftoppm not available"

# Expose port (Railway will override this)
EXPOSE 3001

# Start the application
CMD ["npm", "start"]
