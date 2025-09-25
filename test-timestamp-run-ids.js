// test-timestamp-run-ids.js
// Tests for timestamp format run IDs (no legacy SR-format)

const runIdUtils = require('./utils/runIdUtils');

console.log('=== Testing Timestamp Format Run ID Handling ===\n');

// Test cases for stripClientSuffix
console.log('Testing stripClientSuffix:');
const stripTestCases = [
  { input: '250925-112233-ClientName', expected: '250925-112233' },
  { input: '250925-112233', expected: '250925-112233' },
  { input: '250925-112233-Client-With-Dashes', expected: '250925-112233' },
  { input: null, expected: '' },
  { input: '', expected: '' }
];

stripTestCases.forEach((test, index) => {
  const result = runIdUtils.stripClientSuffix(test.input);
  const pass = result === test.expected;
  
  console.log(`${index + 1}. ${pass ? '✅' : '❌'} Input: "${test.input}"`);
  if (!pass) {
    console.log(`   Expected: "${test.expected}"`);
    console.log(`   Got:      "${result}"`);
  }
});

// Test cases for addClientSuffix
console.log('\nTesting addClientSuffix:');
const addTestCases = [
  { runId: '250925-112233', clientId: 'ClientName', expected: '250925-112233-ClientName' },
  { runId: '250925-112233-OldClient', clientId: 'NewClient', expected: '250925-112233-NewClient' },
  { runId: '250925-112233', clientId: 'Client-With-Dashes', expected: '250925-112233-Client-With-Dashes' },
  { runId: '250925-112233', clientId: 'CWithPrefix', expected: '250925-112233-WithPrefix' },
  { runId: null, clientId: 'ClientName', expected: null },
  { runId: '250925-112233', clientId: null, expected: '250925-112233' },
  { runId: '250925-112233', clientId: '', expected: '250925-112233' }
];

addTestCases.forEach((test, index) => {
  const result = runIdUtils.addClientSuffix(test.runId, test.clientId);
  const pass = result === test.expected;
  
  console.log(`${index + 1}. ${pass ? '✅' : '❌'} RunId: "${test.runId}", ClientId: "${test.clientId}"`);
  if (!pass) {
    console.log(`   Expected: "${test.expected}"`);
    console.log(`   Got:      "${result}"`);
  }
});

// Test cases for hasClientSuffix
console.log('\nTesting hasClientSuffix:');
const hasClientSuffixTestCases = [
  { input: '250925-112233-ClientName', expected: true },
  { input: '250925-112233', expected: false },
  { input: null, expected: false },
  { input: '', expected: false }
];

hasClientSuffixTestCases.forEach((test, index) => {
  const result = runIdUtils.hasClientSuffix(test.input);
  const pass = result === test.expected;
  
  console.log(`${index + 1}. ${pass ? '✅' : '❌'} Input: "${test.input}"`);
  if (!pass) {
    console.log(`   Expected: ${test.expected}`);
    console.log(`   Got:      ${result}`);
  }
});

// Test cases for hasSpecificClientSuffix
console.log('\nTesting hasSpecificClientSuffix:');
const hasSpecificClientSuffixTestCases = [
  { runId: '250925-112233-ClientName', clientId: 'ClientName', expected: true },
  { runId: '250925-112233-ClientName', clientId: 'OtherClient', expected: false },
  { runId: '250925-112233', clientId: 'ClientName', expected: false },
  { runId: null, clientId: 'ClientName', expected: false },
  { runId: '250925-112233-ClientName', clientId: null, expected: false }
];

hasSpecificClientSuffixTestCases.forEach((test, index) => {
  const result = runIdUtils.hasSpecificClientSuffix(test.runId, test.clientId);
  const pass = result === test.expected;
  
  console.log(`${index + 1}. ${pass ? '✅' : '❌'} RunId: "${test.runId}", ClientId: "${test.clientId}"`);
  if (!pass) {
    console.log(`   Expected: ${test.expected}`);
    console.log(`   Got:      ${result}`);
  }
});