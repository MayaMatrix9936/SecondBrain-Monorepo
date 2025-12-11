/**
 * Script to convert SYSTEM_DESIGN_COMPREHENSIVE.md to PDF
 * 
 * Usage:
 *   npm install markdown-pdf
 *   node convert-to-pdf.js
 * 
 * Or use pandoc if available:
 *   pandoc SYSTEM_DESIGN_COMPREHENSIVE.md -o SYSTEM_DESIGN_COMPREHENSIVE.pdf
 */

const fs = require('fs');
const path = require('path');

console.log('PDF Conversion Script');
console.log('====================\n');

const markdownFile = path.join(__dirname, 'SYSTEM_DESIGN_COMPREHENSIVE.md');
const pdfFile = path.join(__dirname, 'SYSTEM_DESIGN_COMPREHENSIVE.pdf');

// Check if markdown file exists
if (!fs.existsSync(markdownFile)) {
  console.error('Error: SYSTEM_DESIGN_COMPREHENSIVE.md not found!');
  process.exit(1);
}

console.log('Markdown file found:', markdownFile);

// Try to use markdown-pdf if available
try {
  const markdownpdf = require('markdown-pdf');
  console.log('Using markdown-pdf library...');
  
  markdownpdf()
    .from(markdownFile)
    .to(pdfFile, () => {
      console.log('✅ PDF created successfully:', pdfFile);
    });
} catch (e) {
  console.log('markdown-pdf not installed. Trying alternative methods...\n');
  
  // Alternative: Provide instructions
  console.log('To convert to PDF, use one of these methods:\n');
  console.log('Method 1: Install markdown-pdf');
  console.log('  npm install markdown-pdf');
  console.log('  node convert-to-pdf.js\n');
  
  console.log('Method 2: Use pandoc (if installed)');
  console.log('  pandoc SYSTEM_DESIGN_COMPREHENSIVE.md -o SYSTEM_DESIGN_COMPREHENSIVE.pdf\n');
  
  console.log('Method 3: Use online converter');
  console.log('  1. Go to https://www.markdowntopdf.com/');
  console.log('  2. Upload SYSTEM_DESIGN_COMPREHENSIVE.md');
  console.log('  3. Download the PDF\n');
  
  console.log('Method 4: Use VS Code extension');
  console.log('  1. Install "Markdown PDF" extension in VS Code');
  console.log('  2. Open SYSTEM_DESIGN_COMPREHENSIVE.md');
  console.log('  3. Right-click -> "Markdown PDF: Export (pdf)"\n');
  
  process.exit(1);
}

