#!/usr/bin/env node

// Test script for runIdUtils to ensure client suffixes are correctly handled

const runIdUtils = require('./utils/runIdUtils');

console.log('TESTING IMPROVED RUN ID UTILS');
console.log('==============================\n');

// Test cases
const testCases = [
  {
    desc: 'Simple ID without client suffix',
    id: 'SR-250924-001-T1899-S1',
    expected: 'SR-250924-001-T1899-S1',
    clientId: 'Dean-Hobin'
  },
  {
    desc: 'ID with one client suffix',
    id: 'SR-250924-001-T1899-S1-CGuy-Wilson',
    expected: 'SR-250924-001-T1899-S1',
    clientId: 'Dean-Hobin'
  },
  {
    desc: 'Adding client suffix to ID that already has one',
    id: 'SR-250924-001-T1899-S1-CGuy-Wilson',
    expected: 'SR-250924-001-T1899-S1-CDean-Hobin',
    clientId: 'Dean-Hobin',
    testAddSuffix: true
  },
  {
    desc: 'Adding the same client suffix',
    id: 'SR-250924-001-T1899-S1-CDean-Hobin',
    expected: 'SR-250924-001-T1899-S1-CDean-Hobin',
    clientId: 'Dean-Hobin',
    testAddSuffix: true
  },
  {
    desc: 'Complex case with multiple dash segments in clientId',
    id: 'SR-250924-001-T1899-S1-CComplex-Client-ID-123',
    expected: 'SR-250924-001-T1899-S1',
    clientId: 'New-Client'
  },
  {
    desc: 'Edge case with no suffix separator',
    id: 'SR250924001T1899S1',
    expected: 'SR250924001T1899S1',
    clientId: 'Client'
  }
];

let allPassed = true;

console.log('Testing stripClientSuffix:');
console.log('------------------------');

for (const test of testCases) {
  const result = runIdUtils.stripClientSuffix(test.id);
  const passed = result === test.expected;
  if (!test.testAddSuffix) {
    console.log(`${passed ? '✅' : '❌'} ${test.desc}`);
    console.log(`   Input:    ${test.id}`);
    console.log(`   Result:   ${result}`);
    console.log(`   Expected: ${test.expected}`);
    console.log();
    
    if (!passed) allPassed = false;
  }
}

console.log('\nTesting addClientSuffix:');
console.log('------------------------');

for (const test of testCases) {
  if (test.testAddSuffix) {
    const baseId = runIdUtils.stripClientSuffix(test.id);
    const result = runIdUtils.addClientSuffix(baseId, test.clientId);
    const passed = result === test.expected;
    
    console.log(`${passed ? '✅' : '❌'} ${test.desc}`);
    console.log(`   Input:    ${test.id}`);
    console.log(`   Base ID:  ${baseId}`);
    console.log(`   ClientID: ${test.clientId}`);
    console.log(`   Result:   ${result}`);
    console.log(`   Expected: ${test.expected}`);
    console.log();
    
    if (!passed) allPassed = false;
    
    // Also test the "replace one client suffix with another" case
    const directResult = runIdUtils.addClientSuffix(test.id, test.clientId);
    const directPassed = directResult === test.expected;
    
    console.log(`${directPassed ? '✅' : '❌'} Direct replacement: ${test.id} → ${test.expected}`);
    console.log(`   Result:   ${directResult}`);
    console.log();
    
    if (!directPassed) allPassed = false;
  }
}

console.log(allPassed ? '✅ ALL TESTS PASSED!' : '❌ SOME TESTS FAILED!');