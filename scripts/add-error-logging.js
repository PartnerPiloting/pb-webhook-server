#!/usr/bin/env node
/**
 * Script to add error logging to catch blocks in route files
 * Usage: node scripts/add-error-logging.js <file-path>
 */

const fs = require('fs');
const path = require('path');

function addErrorLogging(filePath) {
  console.log(`Processing: ${filePath}`);
  
  let content = fs.readFileSync(filePath, 'utf8');
  const originalContent = content;
  let addedCount = 0;
  
  // Pattern to match catch blocks with console.error followed by res.status
  // that don't already have logRouteError
  const lines = content.split('\n');
  const newLines = [];
  
  for (let i = 0; i < lines.length; i++) {
    newLines.push(lines[i]);
    
    // Check if this line has console.error in a catch block
    if (lines[i].includes('console.error') && i > 0 && 
        (lines[i-1].includes('} catch') || lines[i-2].includes('} catch'))) {
      
      // Check if next few lines have res.status but NOT logRouteError/logCriticalError
      const nextFewLines = lines.slice(i, i + 5).join('\n');
      if (nextFewLines.includes('res.status') && 
          !nextFewLines.includes('logRouteError') && 
          !nextFewLines.includes('logCriticalError')) {
        
        // Get the indentation from current line
        const indent = lines[i].match(/^(\s*)/)[1];
        
        // Add the logging line
        newLines.push(`${indent}await logRouteError(error, req).catch(() => {});`);
        addedCount++;
      }
    }
  }
  
  content = newLines.join('\n');
  
  if (content !== originalContent) {
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`✅ Added error logging to ${addedCount} catch blocks in ${path.basename(filePath)}`);
  } else {
    console.log(`⏭️  No changes needed for ${path.basename(filePath)}`);
  }
  
  return addedCount;
}

// Process file from command line argument
const filePath = process.argv[2];
if (!filePath) {
  console.error('Usage: node add-error-logging.js <file-path>');
  process.exit(1);
}

if (!fs.existsSync(filePath)) {
  console.error(`File not found: ${filePath}`);
  process.exit(1);
}

const count = addErrorLogging(filePath);
console.log(`\nTotal catch blocks updated: ${count}`);
