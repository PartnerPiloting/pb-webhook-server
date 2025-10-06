// scripts/analyze-unlogged-catches.js
/**
 * Analyze catch blocks to find unlogged ones
 * Categorize them by file and show line numbers
 */

const fs = require('fs');
const path = require('path');

const ROUTES_DIR = path.join(__dirname, '../routes');
const SERVICES_DIR = path.join(__dirname, '../services');

function analyzeFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  
  const catches = [];
  const logged = [];
  
  lines.forEach((line, index) => {
    if (line.match(/}\s*catch/)) {
      catches.push(index + 1);
    }
    if (line.match(/logCriticalError|logRouteError/)) {
      logged.push(index + 1);
    }
  });
  
  // Find catches without nearby logging (within 5 lines)
  const unlogged = catches.filter(catchLine => {
    return !logged.some(logLine => Math.abs(logLine - catchLine) <= 5);
  });
  
  return {
    total: catches.length,
    logged: catches.length - unlogged.length,
    unlogged: unlogged.length,
    unloggedLines: unlogged
  };
}

function analyzeDirectory(dir) {
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.js'));
  const results = [];
  
  files.forEach(file => {
    const filePath = path.join(dir, file);
    const analysis = analyzeFile(filePath);
    
    if (analysis.unlogged > 0) {
      results.push({
        file,
        ...analysis
      });
    }
  });
  
  return results.sort((a, b) => b.unlogged - a.unlogged);
}

console.log('=== ROUTES WITH UNLOGGED CATCHES ===\n');
const routeResults = analyzeDirectory(ROUTES_DIR);
routeResults.forEach(r => {
  console.log(`${r.file}: ${r.unlogged} unlogged (${r.logged}/${r.total} logged)`);
  console.log(`  Lines: ${r.unloggedLines.join(', ')}`);
});

console.log('\n=== SERVICES WITH UNLOGGED CATCHES ===\n');
const serviceResults = analyzeDirectory(SERVICES_DIR);
serviceResults.forEach(r => {
  console.log(`${r.file}: ${r.unlogged} unlogged (${r.logged}/${r.total} logged)`);
  console.log(`  Lines: ${r.unloggedLines.join(', ')}`);
});

const totalUnlogged = [...routeResults, ...serviceResults]
  .reduce((sum, r) => sum + r.unlogged, 0);
const totalCatches = [...routeResults, ...serviceResults]
  .reduce((sum, r) => sum + r.total, 0);
const totalLogged = totalCatches - totalUnlogged;

console.log(`\n=== SUMMARY ===`);
console.log(`Total catches: ${totalCatches}`);
console.log(`Logged: ${totalLogged}`);
console.log(`Unlogged: ${totalUnlogged}`);
console.log(`Coverage: ${Math.round((totalLogged / totalCatches) * 100)}%`);
