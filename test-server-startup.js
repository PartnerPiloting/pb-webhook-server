/**
 * Test script to verify server can start with Run ID System changes
 * This simulates the server startup and checks all critical modules load correctly
 */

const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m'
};

console.log(`${colors.yellow}Testing server startup with Run ID System...${colors.reset}\n`);

const modules = [
  { name: 'runIdService', path: './services/runIdService' },
  { name: 'recordCache', path: './services/recordCache' },
  { name: 'airtableService', path: './services/airtableService' },
  { name: 'leadService', path: './services/leadService' },
  { name: 'apifyRunsService', path: './services/apifyRunsService' },
  { name: 'batchScorer', path: './batchScorer' },
  { name: 'apifyProcessRoutes', path: './routes/apifyProcessRoutes' },
  { name: 'apifyWebhookRoutes', path: './routes/apifyWebhookRoutes' }
];

let allLoaded = true;

for (const module of modules) {
  try {
    require(module.path);
    console.log(`${colors.green}✓${colors.reset} ${module.name} loaded successfully`);
  } catch (error) {
    console.log(`${colors.red}✗${colors.reset} ${module.name} failed to load`);
    console.error(`  ${colors.red}${error.message}${colors.reset}`);
    allLoaded = false;
  }
}

console.log(`\n${colors.blue}Testing circular dependencies...${colors.reset}`);

// Test for circular dependencies
try {
  // Updated to use unified run ID service
  const runIdService = require('./services/unifiedRunIdService');
  const recordCache = require('./services/recordCache');
  
  // Test basic interaction
  const testId = runIdService.generateRunId('TestClient');
  recordCache.storeClientRunRecordId(testId, 'TestClient', 'recTEST');
  const retrieved = recordCache.getClientRunRecordId(testId, 'TestClient');
  
  if (retrieved === 'recTEST') {
    console.log(`${colors.green}✓${colors.reset} No circular dependency issues detected`);
  } else {
    console.log(`${colors.red}✗${colors.reset} Functionality test failed`);
    allLoaded = false;
  }
} catch (error) {
  console.log(`${colors.red}✗${colors.reset} Circular dependency detected`);
  console.error(`  ${colors.red}${error.message}${colors.reset}`);
  allLoaded = false;
}

// Summary
console.log(`\n${colors.yellow}════════════════════════════${colors.reset}`);
if (allLoaded) {
  console.log(`${colors.green}✅ All modules load successfully!${colors.reset}`);
  console.log(`${colors.green}Server should start without issues.${colors.reset}`);
  process.exit(0);
} else {
  console.log(`${colors.red}❌ Some modules failed to load!${colors.reset}`);
  console.log(`${colors.red}Fix issues before starting server.${colors.reset}`);
  process.exit(1);
}