// tests/test-runid-utils.js
// Simple test script to verify runIdUtils functionality

const runIdUtils = require('../utils/runIdUtils');
const assert = require('assert');

console.log('=== Starting runIdUtils tests ===');

// Test cases for getBaseRunId/stripClientSuffix
const testCases = [
  { 
    input: 'SR-230401-123-T1-S1', 
    expected: 'SR-230401-123-T1-S1',
    desc: 'No client suffix'
  },
  { 
    input: 'SR-230401-123-T1-S1-C123', 
    expected: 'SR-230401-123-T1-S1',
    desc: 'Simple client ID suffix'
  },
  { 
    input: 'SR-230401-123-T1-S1-CGuyWilson', 
    expected: 'SR-230401-123-T1-S1',
    desc: 'Text client ID suffix'
  },
  { 
    input: 'SR-230401-123-T1-S1-C123-456', 
    expected: 'SR-230401-123-T1-S1',
    desc: 'Complex client ID suffix'
  },
  {
    input: 'SR-230401-123-T1-S1-CClient-WithDash', 
    expected: 'SR-230401-123-T1-S1',
    desc: 'Client ID with dash'
  }
];

// Run test cases
testCases.forEach(test => {
  console.log(`\nTesting: ${test.desc}`);
  console.log(`Input: ${test.input}`);
  
  const result = runIdUtils.getBaseRunId(test.input);
  console.log(`Output: ${result}`);
  console.log(`Expected: ${test.expected}`);
  
  try {
    assert.strictEqual(result, test.expected);
    console.log('✅ PASS');
  } catch (e) {
    console.log('❌ FAIL');
    console.error(e.message);
  }
});

// Test addClientSuffix
console.log('\n=== Testing addClientSuffix ===');

const addClientCases = [
  {
    baseId: 'SR-230401-123-T1-S1',
    clientId: '456',
    expected: 'SR-230401-123-T1-S1-C456',
    desc: 'Add client ID to base run ID'
  },
  {
    baseId: 'SR-230401-123-T1-S1-C123',
    clientId: '456',
    expected: 'SR-230401-123-T1-S1-C456',
    desc: 'Replace existing client ID'
  },
  {
    baseId: 'SR-230401-123-T1-S1',
    clientId: 'GuyWilson',
    expected: 'SR-230401-123-T1-S1-CGuyWilson',
    desc: 'Add text client ID'
  }
];

addClientCases.forEach(test => {
  console.log(`\nTesting: ${test.desc}`);
  console.log(`Base ID: ${test.baseId}, Client ID: ${test.clientId}`);
  
  const result = runIdUtils.addClientSuffix(test.baseId, test.clientId);
  console.log(`Output: ${result}`);
  console.log(`Expected: ${test.expected}`);
  
  try {
    assert.strictEqual(result, test.expected);
    console.log('✅ PASS');
  } catch (e) {
    console.log('❌ FAIL');
    console.error(e.message);
  }
});

console.log('\n=== All tests completed ===');