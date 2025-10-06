#!/usr/bin/env node
/**
 * Add error logging to service layer catch blocks
 * Handles both "swallowed" errors (return null/false) and throwing errors
 */

const fs = require('fs');
const path = require('path');

function addServiceErrorLogging(filePath) {
  console.log(`Processing: ${filePath}`);
  
  let content = fs.readFileSync(filePath, 'utf8');
  const originalContent = content;
  let addedCount = 0;
  
  const lines = content.split('\n');
  const newLines = [];
  
  for (let i = 0; i < lines.length; i++) {
    newLines.push(lines[i]);
    
    // Check if this line has log.error or logger.error in a catch block
    if ((lines[i].includes('log.error') || lines[i].includes('logger.error') || lines[i].includes('console.error')) && 
        i > 0 && (lines[i-1].includes('} catch') || lines[i-2].includes('} catch'))) {
      
      // Check if next few lines already have logCriticalError
      const nextFewLines = lines.slice(i, i + 5).join('\n');
      if (nextFewLines.includes('logCriticalError')) {
        continue; // Already has logging
      }
      
      // Check if there's a return/throw in next few lines (swallowed error pattern)
      const hasReturn = nextFewLines.match(/return (null|false|\[\]|\{\})/);
      const hasThrow = nextFewLines.includes('throw');
      
      if (hasReturn || hasThrow) {
        // Get the indentation from current line
        const indent = lines[i].match(/^(\s*)/)[1];
        
        // Extract the error variable name from the catch statement
        let errorVar = 'error';
        for (let j = Math.max(0, i - 3); j < i; j++) {
          const catchMatch = lines[j].match(/} catch \(([^)]+)\)/);
          if (catchMatch) {
            errorVar = catchMatch[1];
            break;
          }
        }
        
        // Add the logging line
        const context = hasReturn ? 'Service error (swallowed)' : 'Service error (before throw)';
        newLines.push(`${indent}await logCriticalError(${errorVar}, { context: '${context}', service: '${path.basename(filePath)}' }).catch(() => {});`);
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
  console.error('Usage: node add-service-error-logging.js <file-path>');
  process.exit(1);
}

if (!fs.existsSync(filePath)) {
  console.error(`File not found: ${filePath}`);
  process.exit(1);
}

const count = addServiceErrorLogging(filePath);
console.log(`\nTotal catch blocks updated: ${count}`);
