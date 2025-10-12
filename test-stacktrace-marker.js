/**
 * Test script to verify STACKTRACE markers appear in console output
 * Run this locally WITHOUT env vars - just tests the console.log output
 */

// Mock the StackTraceService to avoid needing Airtable
const mockTimestamp = '2025-10-12T10:30:45.123456789Z';

// Create mock StackTraceService
class MockStackTraceService {
  static generateUniqueTimestamp() {
    return mockTimestamp;
  }
  
  async saveStackTrace(data) {
    console.log('[MOCK] Would save to Airtable:', {
      timestamp: data.timestamp,
      runId: data.runId,
      clientId: data.clientId,
      errorMessage: data.errorMessage.substring(0, 50) + '...'
    });
    return true;
  }
}

// Mock the require for stackTraceService
const path = require('path');
const stackTraceServicePath = path.resolve(__dirname, 'services/stackTraceService.js');
require.cache[stackTraceServicePath] = {
  exports: MockStackTraceService
};

// Now require errorHandler (will use our mock)
const { logErrorWithStackTrace } = require('./utils/errorHandler');

async function testStackTraceMarker() {
  console.log('\n=== Testing STACKTRACE Marker Output (No Env Vars Needed) ===\n');
  
  try {
    // Create a test error
    const testError = new Error('Test error for STACKTRACE marker verification');
    
    // Log it with stack trace
    const timestamp = await logErrorWithStackTrace(testError, {
      runId: '251012-TEST',
      clientId: 'TEST-CLIENT',
      context: '[TEST] Testing STACKTRACE marker',
      loggerName: 'TEST',
      operation: 'testStackTrace'
    });
    
    console.log('\n=== Test Complete ===');
    console.log(`Timestamp returned: ${timestamp}`);
    console.log('\n✅ SUCCESS CRITERIA - Look for these 3 markers above:');
    console.log('1. [DEBUG-STACKTRACE] About to log STACKTRACE marker');
    console.log('2. [ERROR] [251012-TEST] [Client: TEST-CLIENT] ... STACKTRACE:' + mockTimestamp);
    console.log('3. [DEBUG-STACKTRACE] STACKTRACE marker logged successfully');
    console.log('\nIf you see all three markers, the fix is working! ✅\n');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
    console.error('Stack:', error.stack);
    process.exit(1);
  }
}

// Run the test
testStackTraceMarker()
  .then(() => {
    console.log('✅ Test completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Test failed with error:', error);
    process.exit(1);
  });
