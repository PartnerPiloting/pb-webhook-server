#!/usr/bin/env node
/**
 * Smart route error logging addition
 * Adds logRouteError to catch blocks with console.error/warn but no error logging
 */

const fs = require('fs');
const path = require('path');

function addRouteErrorLogging(filePath) {
  console.log(`Processing: ${filePath}`);
  
  let content = fs.readFileSync(filePath, 'utf8');
  const originalContent = content;
  let addedCount = 0;
  
  const lines = content.split('\n');
  const newLines = [];
  let i = 0;
  
  while (i < lines.length) {
    const line = lines[i];
    newLines.push(line);
    
    // Detect catch block start
    if (line.match(/}\s*catch\s*\((\w+)\)/)) {
      const catchMatch = line.match(/}\s*catch\s*\((\w+)\)/);
      const errorVar = catchMatch[1];
      const catchIndent = line.match(/^(\s*)/)[1];
      
      // Scan ahead to find if this catch has console.error and logRouteError
      let hasConsoleError = false;
      let hasLogError = false;
      let consoleErrorLine = -1;
      let j = i + 1;
      let braceCount = 1; // Start with 1 for the catch block opening brace
      
      while (j < lines.length && braceCount > 0) {
        const scanLine = lines[j];
        
        // Count braces to find end of catch block
        const openBraces = (scanLine.match(/{/g) || []).length;
        const closeBraces = (scanLine.match(/}/g) || []).length;
        braceCount += openBraces - closeBraces;
        
        if (scanLine.includes('console.error') || scanLine.includes('console.warn')) {
          hasConsoleError = true;
          if (consoleErrorLine === -1) consoleErrorLine = j;
        }
        if (scanLine.includes('logRouteError') || scanLine.includes('logCriticalError')) {
          hasLogError = true;
        }
        
        j++;
        if (braceCount <= 0) break;
      }
      
      // If has console.error but no logRouteError, add it
      if (hasConsoleError && !hasLogError && consoleErrorLine > 0) {
        // Add logRouteError right after the console.error line
        const insertAt = consoleErrorLine - i; // Relative position from current
        const consoleLineIndent = lines[consoleErrorLine].match(/^(\s*)/)[1];
        
        // Add the remaining lines up to console.error
        for (let k = i + 1; k <= consoleErrorLine; k++) {
          newLines.push(lines[k]);
        }
        
        // Add logRouteError
        newLines.push(`${consoleLineIndent}await logRouteError(${errorVar}, req).catch(() => {});`);
        addedCount++;
        
        // Skip to after console.error line
        i = consoleErrorLine + 1;
        continue;
      }
    }
    
    i++;
  }
  
  content = newLines.join('\n');
  
  if (content !== originalContent) {
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`✅ Added error logging to ${addedCount} catch blocks in ${path.basename(filePath)}`);
  } else {
    console.log(`⏭️  No changes needed for ${path.basename(filePath)}`);
  }
  
  console.log(`Total catch blocks updated: ${addedCount}\n`);
  return addedCount;
}

// Process file from command line argument
const filePath = process.argv[2];
if (!filePath) {
  console.error('Usage: node add-route-error-logging-smart.js <file-path>');
  process.exit(1);
}

try {
  const count = addRouteErrorLogging(filePath);
  process.exit(0);
} catch (error) {
  console.error('Error:', error.message);
  process.exit(1);
}
