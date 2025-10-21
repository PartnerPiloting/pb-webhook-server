/**
 * Run ID Consistency Test
 * 
 * This script tests the run ID handling system to ensure consistency throughout the application flow.
 * It verifies that run IDs are preserved correctly when passed between different parts of the system.
 */

const unifiedRunIdService = require('./services/unifiedRunIdService');
const jobTracking = require('./services/jobTracking');
const { structuredLogger } = require('./utils/structuredLogger');

const log = structuredLogger('test-run-id-consistency');

async function runTests() {
  let errors = 0;
  let passes = 0;
  
  // Test 1: Basic run ID generation and normalization
  try {
    log.info("Test 1: Basic run ID generation and normalization");
    
    const runId = unifiedRunIdService.generateTimestampRunId();
    log.debug(`Generated run ID: ${runId}`);
    
    const normalizedRunId = unifiedRunIdService.normalizeRunId(runId);
    log.debug(`Normalized run ID: ${normalizedRunId}`);
    
    if (runId !== normalizedRunId) {
      throw new Error(`Run ID changed during normalization: ${runId} -> ${normalizedRunId}`);
    }
    
    log.info("✅ Test 1 passed: Run ID preserved during normalization");
    passes++;
  } catch (error) {
    log.error(`❌ Test 1 failed: ${error.message}`);
    errors++;
  }
  
  // Test 2: Compound run ID handling
  try {
    log.info("Test 2: Compound run ID handling");
    
    const baseRunId = unifiedRunIdService.generateTimestampRunId();
    const clientId = "client123";
    const compoundRunId = `${baseRunId}-${clientId}`;
    log.debug(`Generated compound run ID: ${compoundRunId}`);
    
    const normalizedRunId = unifiedRunIdService.normalizeRunId(compoundRunId);
    log.debug(`Normalized compound run ID: ${normalizedRunId}`);
    
    if (compoundRunId !== normalizedRunId) {
      throw new Error(`Compound run ID changed during normalization: ${compoundRunId} -> ${normalizedRunId}`);
    }
    
    log.info("✅ Test 2 passed: Compound run ID preserved");
    passes++;
  } catch (error) {
    log.error(`❌ Test 2 failed: ${error.message}`);
    errors++;
  }
  
  // Test 3: Job tracking standardization
  try {
    log.info("Test 3: Job tracking standardization");
    
    const runId = unifiedRunIdService.generateTimestampRunId();
    log.debug(`Generated run ID: ${runId}`);
    
    const standardizedRunId = jobTracking.standardizeRunId(runId, { enforceStandard: true });
    log.debug(`Standardized run ID: ${standardizedRunId}`);
    
    if (runId !== standardizedRunId) {
      throw new Error(`Run ID changed during job tracking standardization: ${runId} -> ${standardizedRunId}`);
    }
    
    log.info("✅ Test 3 passed: Run ID preserved during job tracking standardization");
    passes++;
  } catch (error) {
    log.error(`❌ Test 3 failed: ${error.message}`);
    errors++;
  }
  
  // Test 4: Compound ID job tracking standardization
  try {
    log.info("Test 4: Compound ID job tracking standardization");
    
    const baseRunId = unifiedRunIdService.generateTimestampRunId();
    const clientId = "client456";
    const compoundRunId = `${baseRunId}-${clientId}`;
    log.debug(`Generated compound run ID: ${compoundRunId}`);
    
    const standardizedRunId = jobTracking.standardizeRunId(compoundRunId, { enforceStandard: true });
    log.debug(`Standardized compound run ID: ${standardizedRunId}`);
    
    if (compoundRunId !== standardizedRunId) {
      throw new Error(`Compound run ID changed during job tracking standardization: ${compoundRunId} -> ${standardizedRunId}`);
    }
    
    log.info("✅ Test 4 passed: Compound run ID preserved during job tracking standardization");
    passes++;
  } catch (error) {
    log.error(`❌ Test 4 failed: ${error.message}`);
    errors++;
  }
  
  // Test 5: Error handling for invalid run IDs
  try {
    log.info("Test 5: Error handling for invalid run IDs");
    
    const invalidRunId = null;
    const normalizedRunId = unifiedRunIdService.normalizeRunId(invalidRunId);
    
    if (normalizedRunId !== null) {
      throw new Error(`Invalid run ID didn't return null: ${invalidRunId} -> ${normalizedRunId}`);
    }
    
    const emptyRunId = '';
    const normalizedEmptyRunId = unifiedRunIdService.normalizeRunId(emptyRunId);
    
    if (normalizedEmptyRunId !== null) {
      throw new Error(`Empty run ID didn't return null: ${emptyRunId} -> ${normalizedEmptyRunId}`);
    }
    
    log.info("✅ Test 5 passed: Error handling for invalid run IDs");
    passes++;
  } catch (error) {
    log.error(`❌ Test 5 failed: ${error.message}`);
    errors++;
  }
  
  // Test 6: Legacy function throws error
  try {
    log.info("Test 6: Legacy function throws error");
    
    try {
      const runId = unifiedRunIdService.generateRunId();
      throw new Error(`Legacy function didn't throw an error: ${runId}`);
    } catch (legacyError) {
      if (!legacyError.message.includes('DEPRECATED')) {
        throw new Error(`Wrong error message from legacy function: ${legacyError.message}`);
      }
      log.debug("Legacy function correctly threw deprecation error");
    }
    
    log.info("✅ Test 6 passed: Legacy function throws error");
    passes++;
  } catch (error) {
    log.error(`❌ Test 6 failed: ${error.message}`);
    errors++;
  }
  
  // Results summary
  if (errors === 0) {
    log.info(`🎉 ALL TESTS PASSED (${passes}/${passes + errors})`);
  } else {
    log.error(`❌ TESTS FAILED: ${errors} errors, ${passes} passed`);
  }
}

// Run the tests
runTests().catch(error => {
  log.error(`Error running tests: ${error.message}`);
  process.exit(1);
});