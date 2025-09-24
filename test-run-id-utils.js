// test-run-id-utils.js
// Comprehensive test for runIdUtils functions

const runIdUtils = require('./utils/runIdUtils');

function runTests() {
    console.log('Testing runIdUtils functions...\n');
    
    // Test cases for getBaseRunId / stripClientSuffix
    const stripTests = [
        { input: 'SR-250924-001-T1899-S1-C123', expected: 'SR-250924-001-T1899-S1' },
        { input: 'SR-250924-001-T1899-S1-C123-456', expected: 'SR-250924-001-T1899-S1' }, // Complex client ID with dashes
        { input: 'SR-250924-001-T1899-S1', expected: 'SR-250924-001-T1899-S1' }, // No client suffix
        { input: 'SR-250924-001-C123-T1899-S1', expected: 'SR-250924-001-C123-T1899-S1' }, // C in middle (not a suffix)
        { input: null, expected: '' }, // Null input
        { input: '', expected: '' }, // Empty input
        { input: 'SR-250924-001-T1899-S1-Cabc', expected: 'SR-250924-001-T1899-S1' }, // Alphabetic client ID
    ];

    console.log('=== Testing getBaseRunId / stripClientSuffix ===');
    stripTests.forEach(test => {
        const result = runIdUtils.stripClientSuffix(test.input);
        const pass = result === test.expected;
        console.log(`Input: "${test.input}"\nExpected: "${test.expected}"\nActual: "${result}"\nTest: ${pass ? 'PASSED' : 'FAILED'}\n`);
    });
    
    // Test cases for addClientSuffix
    const addTests = [
        { runId: 'SR-250924-001-T1899-S1', clientId: '123', expected: 'SR-250924-001-T1899-S1-C123' }, // Add client suffix
        { runId: 'SR-250924-001-T1899-S1-C456', clientId: '123', expected: 'SR-250924-001-T1899-S1-C123' }, // Replace client suffix
        { runId: 'SR-250924-001-T1899-S1-C123', clientId: '123', expected: 'SR-250924-001-T1899-S1-C123' }, // Already has suffix
        { runId: null, clientId: '123', expected: null }, // Null runId
        { runId: 'SR-250924-001-T1899-S1', clientId: null, expected: 'SR-250924-001-T1899-S1' }, // Null clientId
        { runId: 'SR-250924-001-T1899-S1', clientId: '123-456', expected: 'SR-250924-001-T1899-S1-C123-456' }, // Complex client ID with dashes
    ];
    
    console.log('=== Testing addClientSuffix ===');
    addTests.forEach(test => {
        const result = runIdUtils.addClientSuffix(test.runId, test.clientId);
        const pass = result === test.expected;
        console.log(`RunId: "${test.runId}", ClientId: "${test.clientId}"\nExpected: "${test.expected}"\nActual: "${result}"\nTest: ${pass ? 'PASSED' : 'FAILED'}\n`);
    });
    
    // Test full workflow - strip and then add
    const workflowTests = [
        { 
            runId: 'SR-250924-001-T1899-S1-C456', 
            clientId: '123', 
            expectedAfterStrip: 'SR-250924-001-T1899-S1',
            expectedAfterAdd: 'SR-250924-001-T1899-S1-C123'
        },
        { 
            runId: 'SR-250924-001-T1899-S1-C123-456', 
            clientId: 'abc', 
            expectedAfterStrip: 'SR-250924-001-T1899-S1',
            expectedAfterAdd: 'SR-250924-001-T1899-S1-Cabc'
        }
    ];
    
    console.log('=== Testing Full Workflow (Strip then Add) ===');
    workflowTests.forEach(test => {
        const stripped = runIdUtils.stripClientSuffix(test.runId);
        const reAdded = runIdUtils.addClientSuffix(stripped, test.clientId);
        
        const stripPass = stripped === test.expectedAfterStrip;
        const addPass = reAdded === test.expectedAfterAdd;
        
        console.log(`Original: "${test.runId}", ClientId: "${test.clientId}"`);
        console.log(`After Strip - Expected: "${test.expectedAfterStrip}", Actual: "${stripped}", Test: ${stripPass ? 'PASSED' : 'FAILED'}`);
        console.log(`After Re-Add - Expected: "${test.expectedAfterAdd}", Actual: "${reAdded}", Test: ${addPass ? 'PASSED' : 'FAILED'}\n`);
    });
}

runTests();