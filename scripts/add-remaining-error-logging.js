// scripts/add-remaining-error-logging.js
/**
 * Intelligently add error logging to remaining catch blocks
 * with rich context based on the surrounding code
 */

const fs = require('fs');
const path = require('path');

const FILES_TO_PROCESS = [
  // Routes with highest unlogged counts
  'routes/topScoringLeadsRoutes.js',
  'routes/apiAndJobRoutes.js',
  'routes/apifyWebhookRoutes.js',
  'routes/webhookHandlers.js',
  'routes/apifyProcessRoutes.js',
  'routes/apifyControlRoutes.js',
  'routes/diagnosticRoutes.js',
  'routes/wpAuthBridge.js',
  'routes/wpIdAuth.js',
  // Services with unlogged catches
  'services/costGovernanceService.js',
  'services/emailNotificationService.js',
  'services/emailReportingService.js',
  'services/leadService.js',
  'services/apifyRunsService.js',
  'services/jobTracking.js',
  'services/postScoringMetricsHandler.js',
  'services/renderLogService.js',
  'services/runIdSystem.js'
];

function extractContext(lines, catchIndex) {
  // Look at surrounding code to extract context
  const beforeLines = lines.slice(Math.max(0, catchIndex - 30), catchIndex);
  const afterLines = lines.slice(catchIndex, Math.min(lines.length, catchIndex + 10));
  
  const context = {
    operation: 'unknown',
    isExpected: false,
    clientId: null,
    leadId: null,
    postId: null,
    runId: null,
    isSearch: false,
    isAsync: false
  };
  
  // Check if function is async
  const functionLine = beforeLines.slice().reverse().find(l => l.match(/(?:async\s+)?function|router\.(get|post|put|delete)/));
  if (functionLine && functionLine.includes('async')) {
    context.isAsync = true;
  }
  
  // Detect operation from endpoint or function name
  const endpointMatch = functionLine?.match(/router\.(get|post|put|delete)\(['"]([^'"]+)['"]/);
  if (endpointMatch) {
    context.operation = endpointMatch[2].replace(/[\/:-]/g, '_').replace(/^_/, '');
  }
  
  // Check if it's an empty catch (expected behavior)
  const catchBlock = afterLines.slice(0, 5).join('\n');
  if (catchBlock.match(/}\s*catch[^{]*{\s*(\/\/[^\n]*)?\s*}/)) {
    context.isExpected = true;
  }
  
  // Look for search/find operations
  if (beforeLines.some(l => l.match(/\.find|\.select|search|query/i))) {
    context.isSearch = true;
  }
  
  // Extract variable names for context
  const allCode = beforeLines.join('\n');
  
  if (allCode.match(/clientId\s*=|req\.headers\['x-client-id'\]/)) {
    context.clientId = 'clientId';
  }
  if (allCode.match(/leadId\s*=|lead\.id/)) {
    context.leadId = 'leadId';
  }
  if (allCode.match(/postId\s*=|post\.id/)) {
    context.postId = 'postId';
  }
  if (allCode.match(/runId\s*=|run\.id/)) {
    context.runId = 'runId';
  }
  
  return context;
}

function generateLogStatement(context, errorVar, isRoute) {
  const logFunc = isRoute ? 'logRouteError' : 'logCriticalError';
  
  const contextObj = {
    operation: `'${context.operation}'`,
  };
  
  if (context.isExpected) {
    contextObj.expectedBehavior = 'true';
  }
  if (context.isSearch) {
    contextObj.isSearch = 'true';
  }
  if (context.clientId) {
    contextObj.clientId = context.clientId;
  }
  if (context.leadId) {
    contextObj.leadId = context.leadId;
  }
  if (context.postId) {
    contextObj.postId = context.postId;
  }
  if (context.runId) {
    contextObj.runId = context.runId;
  }
  
  const contextStr = Object.entries(contextObj)
    .map(([k, v]) => `${k}: ${v}`)
    .join(', ');
  
  const awaitPrefix = context.isAsync ? 'await ' : '';
  const reqParam = isRoute ? `${errorVar}, req, ` : `${errorVar}, `;
  
  return `${awaitPrefix}${logFunc}(${reqParam}{ ${contextStr} }).catch(() => {});`;
}

function processFile(filePath) {
  console.log(`\nProcessing: ${filePath}`);
  
  if (!fs.existsSync(filePath)) {
    console.log(`  SKIP: File not found`);
    return { added: 0, skipped: 0 };
  }
  
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  
  const isRoute = filePath.includes('routes/');
  let added = 0;
  let skipped = 0;
  
  // Find catch blocks
  const modifications = [];
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    if (line.match(/}\s*catch\s*\(/)) {
      // Extract error variable name
      const errorVarMatch = line.match(/catch\s*\(\s*(\w+)\s*\)/);
      const errorVar = errorVarMatch ? errorVarMatch[1] : 'error';
      
      // Check if already logged (look ahead 10 lines)
      const nextLines = lines.slice(i, i + 10).join('\n');
      if (nextLines.match(/logCriticalError|logRouteError/)) {
        skipped++;
        continue;
      }
      
      // Extract context
      const context = extractContext(lines, i);
      
      // Generate log statement
      const logStatement = generateLogStatement(context, errorVar, isRoute);
      
      // Find the line after the catch opening brace
      let insertIndex = i + 1;
      while (insertIndex < lines.length && !lines[insertIndex].includes('{')) {
        insertIndex++;
      }
      insertIndex++; // After the opening brace
      
      // Skip comments at the start of catch block
      while (insertIndex < lines.length && lines[insertIndex].trim().startsWith('//')) {
        insertIndex++;
      }
      
      modifications.push({
        index: insertIndex,
        line: `    ${logStatement}`
      });
      
      added++;
    }
  }
  
  // Apply modifications in reverse order to preserve line numbers
  modifications.reverse().forEach(mod => {
    lines.splice(mod.index, 0, mod.line);
  });
  
  if (added > 0) {
    fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
    console.log(`  ✅ Added ${added} log statements`);
  } else {
    console.log(`  ✓ All catches already logged`);
  }
  
  return { added, skipped };
}

// Main execution
console.log('=== ADDING ERROR LOGGING TO REMAINING CATCH BLOCKS ===\n');

let totalAdded = 0;
let totalSkipped = 0;

FILES_TO_PROCESS.forEach(file => {
  const filePath = path.join(__dirname, '..', file);
  const result = processFile(filePath);
  totalAdded += result.added;
  totalSkipped += result.skipped;
});

console.log(`\n=== SUMMARY ===`);
console.log(`Total added: ${totalAdded}`);
console.log(`Total skipped (already logged): ${totalSkipped}`);
console.log(`\nIMPORTANT: Review the changes and fix any async/await issues manually!`);
