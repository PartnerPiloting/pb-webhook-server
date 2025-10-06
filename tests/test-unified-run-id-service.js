/**
 * test-unified-run-id-service.js
 * 
 * Tests for the unified run ID service to verify correct handling of
 * all run ID formats and conversions.
 */

const unifiedRunIdService = require('./services/unifiedRunIdService');

/**
 * Test the detection and conversion of different run ID formats
 */
function testRunIdFormats() {
  console.log('\n=== Testing Run ID Format Detection and Conversion ===');
  
  // Test cases with different formats
  const testCases = [
    {
      id: 'Standard timestamp',
      runId: '250930-123045',
      expectedFormat: 'STANDARD',
      expectedStandardForm: '250930-123045'
    },
    {
      id: 'Client-suffixed',
      runId: '250930-123045-Guy-Wilson',
      expectedFormat: 'CLIENT_SUFFIX',
      expectedStandardForm: '250930-123045'
    },
    {
      id: 'Job process format',
      runId: 'job_post_scoring_stream1_20250929094802',
      expectedFormat: 'JOB_PROCESS',
      expectedStandardForm: '250929-094802'
    },
    {
      id: 'Invalid format',
      runId: 'invalid-run-id-123456',
      expectedFormat: null,
      expectedStandardForm: null
    }
  ];
  
  let passCount = 0;
  let failCount = 0;
  
  testCases.forEach(testCase => {
    try {
      console.log(`\nTesting: ${testCase.id} - "${testCase.runId}"`);
      
      // Test format detection
      const formatInfo = unifiedRunIdService.detectRunIdFormat(testCase.runId);
      const detectedFormat = formatInfo ? formatInfo.format.name : null;
      
      console.log(`Detected format: ${detectedFormat || 'None'}`);
      console.log(`Expected format: ${testCase.expectedFormat || 'None'}`);
      
      if (detectedFormat === testCase.expectedFormat) {
        console.log('✅ Format detection: PASS');
      } else {
        console.log('❌ Format detection: FAIL');
        failCount++;
      }
      
      // Test conversion to standard format
      const standardForm = unifiedRunIdService.convertToStandardFormat(testCase.runId);
      
      console.log(`Converted to standard: ${standardForm || 'None'}`);
      console.log(`Expected standard form: ${testCase.expectedStandardForm || 'None'}`);
      
      if (standardForm === testCase.expectedStandardForm) {
        console.log('✅ Standard conversion: PASS');
        passCount++;
      } else {
        console.log('❌ Standard conversion: FAIL');
        failCount++;
      }
    } catch (error) {
      console.error(`❌ Test case failed with error: ${error.message}`);
      failCount++;
    }
  });
  
  console.log(`\n=== Format Tests Summary: ${passCount} passed, ${failCount} failed ===`);
}

/**
 * Test client suffix operations (adding, stripping, extracting)
 */
function testClientSuffixOperations() {
  console.log('\n=== Testing Client Suffix Operations ===');
  
  // Test cases for client suffix operations
  const testCases = [
    {
      id: 'Add client suffix to standard run ID',
      baseRunId: '250930-123045',
      clientId: 'Guy-Wilson',
      expectedResult: '250930-123045-Guy-Wilson'
    },
    {
      id: 'Add client suffix to already suffixed run ID',
      baseRunId: '250930-123045-Existing-Client',
      clientId: 'Guy-Wilson',
      expectedResult: '250930-123045-Guy-Wilson'
    },
    {
      id: 'Add client suffix to job process format',
      baseRunId: 'job_post_scoring_stream1_20250929094802',
      clientId: 'Guy-Wilson',
      expectedResult: '250929-094802-Guy-Wilson'
    },
    {
      id: 'Strip client suffix',
      runId: '250930-123045-Guy-Wilson',
      expectedResult: '250930-123045'
    },
    {
      id: 'Strip from already standard format',
      runId: '250930-123045',
      expectedResult: '250930-123045'
    },
    {
      id: 'Extract client ID',
      runId: '250930-123045-Guy-Wilson',
      expectedExtract: 'Guy-Wilson'
    }
  ];
  
  let passCount = 0;
  let failCount = 0;
  
  testCases.forEach(testCase => {
    try {
      console.log(`\nTesting: ${testCase.id}`);
      
      if ('clientId' in testCase) {
        // Test adding client suffix
        const result = unifiedRunIdService.addClientSuffix(testCase.baseRunId, testCase.clientId);
        console.log(`Adding "${testCase.clientId}" to "${testCase.baseRunId}" -> "${result}"`);
        console.log(`Expected: "${testCase.expectedResult}"`);
        
        if (result === testCase.expectedResult) {
          console.log('✅ Add client suffix: PASS');
          passCount++;
        } else {
          console.log('❌ Add client suffix: FAIL');
          failCount++;
        }
      } else if ('expectedExtract' in testCase) {
        // Test extracting client ID
        const result = unifiedRunIdService.extractClientId(testCase.runId);
        console.log(`Extracting client ID from "${testCase.runId}" -> "${result}"`);
        console.log(`Expected: "${testCase.expectedExtract}"`);
        
        if (result === testCase.expectedExtract) {
          console.log('✅ Extract client ID: PASS');
          passCount++;
        } else {
          console.log('❌ Extract client ID: FAIL');
          failCount++;
        }
      } else {
        // Test stripping client suffix
        const result = unifiedRunIdService.stripClientSuffix(testCase.runId);
        console.log(`Stripping client suffix from "${testCase.runId}" -> "${result}"`);
        console.log(`Expected: "${testCase.expectedResult}"`);
        
        if (result === testCase.expectedResult) {
          console.log('✅ Strip client suffix: PASS');
          passCount++;
        } else {
          console.log('❌ Strip client suffix: FAIL');
          failCount++;
        }
      }
    } catch (error) {
      console.error(`❌ Test case failed with error: ${error.message}`);
      failCount++;
    }
  });
  
  console.log(`\n=== Client Suffix Tests Summary: ${passCount} passed, ${failCount} failed ===`);
}

/**
 * Test job ID to timestamp conversion
 */
function testJobIdConversion() {
  console.log('\n=== Testing Job ID Conversion ===');
  
  // Test cases for job ID conversion
  const testCases = [
    {
      id: 'Convert valid job ID',
      jobId: 'job_post_scoring_stream1_20250929094802',
      expectedTimestamp: '250929-094802'
    },
    {
      id: 'Convert invalid job ID',
      jobId: 'invalid_job_id',
      expectedTimestamp: null
    }
  ];
  
  let passCount = 0;
  let failCount = 0;
  
  testCases.forEach(testCase => {
    try {
      console.log(`\nTesting: ${testCase.id}`);
      
      const result = unifiedRunIdService.jobIdToTimestamp(testCase.jobId);
      console.log(`Converting "${testCase.jobId}" -> "${result || 'null'}"`);
      console.log(`Expected: "${testCase.expectedTimestamp || 'null'}"`);
      
      if (result === testCase.expectedTimestamp) {
        console.log('✅ Job ID conversion: PASS');
        passCount++;
      } else {
        console.log('❌ Job ID conversion: FAIL');
        failCount++;
      }
    } catch (error) {
      console.error(`❌ Test case failed with error: ${error.message}`);
      failCount++;
    }
  });
  
  console.log(`\n=== Job ID Conversion Tests Summary: ${passCount} passed, ${failCount} failed ===`);
}

/**
 * Test record ID caching functionality
 */
function testRecordIdCaching() {
  console.log('\n=== Testing Record ID Caching ===');
  
  // Test cases for record ID caching
  const testCases = [
    {
      id: 'Cache and retrieve record ID with standard run ID',
      runId: '250930-123045',
      recordId: 'rec123456',
      lookupId: '250930-123045',
      expectedResult: 'rec123456'
    },
    {
      id: 'Cache with standard but lookup with client suffix',
      runId: '250930-123045',
      recordId: 'rec123456',
      lookupId: '250930-123045-Guy-Wilson',
      expectedResult: undefined
    },
    {
      id: 'Cache with job format and lookup with standard',
      runId: 'job_post_scoring_stream1_20250929094802',
      recordId: 'rec654321',
      lookupId: '250929-094802',
      expectedResult: 'rec654321'
    }
  ];
  
  let passCount = 0;
  let failCount = 0;
  
  // Clear any existing cache before testing
  unifiedRunIdService.recordIdCache = new Map();
  
  testCases.forEach(testCase => {
    try {
      console.log(`\nTesting: ${testCase.id}`);
      
      // Cache the record ID
      unifiedRunIdService.cacheRecordId(testCase.runId, testCase.recordId);
      console.log(`Cached record ID "${testCase.recordId}" for run ID "${testCase.runId}"`);
      
      // Look up with potentially different ID
      const result = unifiedRunIdService.getCachedRecordId(testCase.lookupId);
      console.log(`Looking up with "${testCase.lookupId}" -> "${result || 'undefined'}"`);
      console.log(`Expected: "${testCase.expectedResult || 'undefined'}"`);
      
      if ((result === testCase.expectedResult) || 
          (result === undefined && testCase.expectedResult === undefined)) {
        console.log('✅ Record ID caching: PASS');
        passCount++;
      } else {
        console.log('❌ Record ID caching: FAIL');
        failCount++;
      }
    } catch (error) {
      console.error(`❌ Test case failed with error: ${error.message}`);
      failCount++;
    }
  });
  
  console.log(`\n=== Record ID Caching Tests Summary: ${passCount} passed, ${failCount} failed ===`);
}

/**
 * Run all tests
 */
function runAllTests() {
  console.log('===== UNIFIED RUN ID SERVICE TESTS =====');
  testRunIdFormats();
  testClientSuffixOperations();
  testJobIdConversion();
  testRecordIdCaching();
  console.log('\n===== ALL TESTS COMPLETED =====');
}

// Execute tests when run directly
if (require.main === module) {
  runAllTests();
}

module.exports = {
  runAllTests,
  testRunIdFormats,
  testClientSuffixOperations,
  testJobIdConversion,
  testRecordIdCaching
};