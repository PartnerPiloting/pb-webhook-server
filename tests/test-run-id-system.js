/**
 * Comprehensive test script for the Run ID System implementation
 * This script tests all the key components and integration points
 */

// Updated to use unified run ID service
const runIdService = require('./services/unifiedRunIdService');
const recordCache = require('./services/recordCache');

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function logTest(name, passed, details = '') {
  totalTests++;
  if (passed) {
    passedTests++;
    console.log(`${colors.green}✓${colors.reset} ${name}`);
    if (details) console.log(`  ${colors.cyan}${details}${colors.reset}`);
  } else {
    failedTests++;
    console.log(`${colors.red}✗${colors.reset} ${name}`);
    if (details) console.log(`  ${colors.red}${details}${colors.reset}`);
  }
}

function logSection(name) {
  console.log(`\n${colors.blue}━━━ ${name} ━━━${colors.reset}`);
}

async function testRunIdService() {
  logSection('Testing runIdService Core Functions');
  
  // Test 1: Generate Run ID
  const runId1 = runIdService.generateRunId('CGuy-Wilson');
  logTest(
    'Generate Run ID with client suffix', 
    runId1.includes('-CGuy-Wilson'),
    `Generated: ${runId1}`
  );
  
  // Test 2: Generate with task and step
  const runId2 = runIdService.generateRunId('CGuy-Wilson', '123', '456');
  logTest(
    'Generate Run ID with task and step', 
    runId2.includes('-T123') && runId2.includes('-S456'),
    `Generated: ${runId2}`
  );
  
  // Test 3: Normalize run ID
  const baseRunId = 'SR-250924-001-T123-S1';
  const clientId = 'CGuy-Wilson';
  const normalizedId = runIdService.normalizeRunId(baseRunId, clientId);
  logTest(
    'Normalize run ID with client suffix', 
    normalizedId === `${baseRunId}-${clientId}`,
    `${baseRunId} → ${normalizedId}`
  );
  
  // Test 4: Normalize double suffix
  const doubleId = 'SR-250924-001-T001-S1-CGuy-Wilson-CGuy-Wilson';
  const normalized = runIdService.normalizeRunId(doubleId, 'CGuy-Wilson');
  logTest(
    'Normalize double client suffix', 
    normalized === 'SR-250924-001-T001-S1-CGuy-Wilson',
    `${doubleId} → ${normalized}`
  );
  
  // Test 5: Register and retrieve
  const testRunId = 'SR-250924-002-T001-S1';
  const testClientId = 'TestClient';
  const testRecordId = 'rec123456';
  
  runIdService.registerRunRecord(testRunId, testClientId, testRecordId);
  const retrieved = runIdService.getRunRecordId(testRunId, testClientId);
  logTest(
    'Register and retrieve run record',
    retrieved === testRecordId,
    `Stored and retrieved: ${testRecordId}`
  );
  
  // Test 6: Clear specific cache
  runIdService.clearCache(testRunId, testClientId);
  const afterClear = runIdService.getRunRecordId(testRunId, testClientId);
  logTest(
    'Clear specific cache entry',
    afterClear === null,
    'Cache entry cleared successfully'
  );
}

async function testRecordCacheCompatibility() {
  logSection('Testing recordCache Backwards Compatibility');
  
  // Test delegation to runIdService
  const testRunId = 'SR-250924-003-T001-S1';
  const testClientId = 'TestClient2';
  const testRecordId = 'rec789012';
  
  // Store via recordCache (should delegate to runIdService)
  recordCache.storeClientRunRecordId(testRunId, testClientId, testRecordId);
  
  // Retrieve via recordCache
  const retrieved1 = recordCache.getClientRunRecordId(testRunId, testClientId);
  logTest(
    'recordCache stores via delegation',
    retrieved1 === testRecordId,
    `Stored and retrieved: ${testRecordId}`
  );
  
  // Verify it's also available via runIdService directly
  const retrieved2 = runIdService.getRunRecordId(testRunId, testClientId);
  logTest(
    'Data accessible via runIdService',
    retrieved2 === testRecordId,
    'Cross-service compatibility confirmed'
  );
  
  // Clear via recordCache
  recordCache.clearClientRunCache(testRunId, testClientId);
  const afterClear = runIdService.getRunRecordId(testRunId, testClientId);
  logTest(
    'recordCache clears via delegation',
    afterClear === null,
    'Cache cleared successfully'
  );
}

async function testEdgeCases() {
  logSection('Testing Edge Cases');
  
  // Test various malformed IDs
  const testCases = [
    {
      input: null,
      expected: null,
      name: 'Null input'
    },
    {
      input: undefined,
      expected: null, 
      name: 'Undefined input'
    },
    {
      input: 'SR-250924-001-T001-S1',
      clientId: null,
      expected: 'SR-250924-001-T001-S1',
      name: 'Null client ID'
    },
    {
      input: 'apify-MJPZZeJ7yghyvcmRB',
      clientId: 'CGuy-Wilson',
      expected: 'apify-MJPZZeJ7yghyvcmRB-CGuy-Wilson',
      name: 'Non-standard run ID'
    }
  ];
  
  for (const testCase of testCases) {
    const result = runIdService.normalizeRunId(testCase.input, testCase.clientId);
    logTest(
      testCase.name,
      result === testCase.expected,
      `${testCase.input || 'null'} → ${result || 'null'}`
    );
  }
  
  // Test registerApifyRunId
  const apifyRunId = 'apify-MJPZZeJ7yghyvcmRB';
  const clientId = 'CGuy-Wilson';
  const normalizedApifyId = runIdService.registerApifyRunId(apifyRunId, clientId);
  logTest(
    'Register Apify run ID',
    normalizedApifyId === `${apifyRunId}-${clientId}`,
    `${apifyRunId} → ${normalizedApifyId}`
  );
}

async function runAllTests() {
  console.log(`${colors.yellow}═══════════════════════════════════════`);
  console.log(`    Run ID System Comprehensive Test`);
  console.log(`═══════════════════════════════════════${colors.reset}`);
  
  try {
    await testRunIdService();
    await testRecordCacheCompatibility();
    await testEdgeCases();
    
    // Summary
    console.log(`\n${colors.yellow}═══════════════════════════════════════${colors.reset}`);
    console.log(`${colors.blue}Test Summary:${colors.reset}`);
    console.log(`Total Tests: ${totalTests}`);
    console.log(`${colors.green}Passed: ${passedTests}${colors.reset}`);
    console.log(`${colors.red}Failed: ${failedTests}${colors.reset}`);
    
    if (failedTests === 0) {
      console.log(`\n${colors.green}✅ ALL TESTS PASSED! Safe to commit.${colors.reset}`);
      process.exit(0);
    } else {
      console.log(`\n${colors.red}❌ SOME TESTS FAILED! Review before committing.${colors.reset}`);
      process.exit(1);
    }
  } catch (error) {
    console.error(`\n${colors.red}Fatal error during testing:${colors.reset}`, error);
    process.exit(1);
  }
}

// Run the tests
runAllTests();