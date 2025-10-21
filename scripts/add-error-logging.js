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
  
  // Pattern to match catch blocks with console.error/log.error
  // that don't already have logRouteError
  const lines = content.split('\n');
  const newLines = [];
  let inCatchBlock = false;
  let catchBlockIndent = '';
  let catchErrorVar = 'error';
  let foundConsoleError = false;
  let alreadyHasLogging = false;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // Detect start of catch block
    if (line.match(/}\s*catch\s*\((\w+)\)/)) {
      const match = line.match(/}\s*catch\s*\((\w+)\)/);
      catchErrorVar = match[1];
      inCatchBlock = true;
      catchBlockIndent = line.match(/^(\s*)/)[1];
      foundConsoleError = false;
      alreadyHasLogging = false;
    }
    
    // Check for console.error/log.error in catch block
    if (inCatchBlock && (line.includes('console.error') || line.includes('log.error'))) {
      foundConsoleError = true;
    }
    
    // Check if already has logRouteError/logCriticalError
    if (inCatchBlock && (line.includes('logRouteError') || line.includes('logCriticalError'))) {
      alreadyHasLogging = true;
    }
    
    // Detect end of catch block (closing brace at same indentation level)
    if (inCatchBlock && line.trim().startsWith('}') && 
        line.match(/^(\s*)/)[1].length === catchBlockIndent.length) {
      
      // If we found console.error but no logging, add it before the closing brace
      if (foundConsoleError && !alreadyHasLogging) {
        const indent = catchBlockIndent + '  ';
        newLines.push(`${indent}await logRouteError(${catchErrorVar}, req).catch(() => {});`);
        addedCount++;
      }
      
      inCatchBlock = false;
    }
    
    newLines.push(line);
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
