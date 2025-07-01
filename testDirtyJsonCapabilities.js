const dirtyJSON = require('dirty-json');
const { repairAndParseJson } = require('./utils/jsonRepair');

console.log('=== Testing dirty-json capabilities ===\n');

const testCases = [
    {
        name: 'Standard valid JSON',
        json: '{"name": "John", "age": 30}'
    },
    {
        name: 'Unescaped quotes in string',
        json: '{"content": "He said "hello" to me"}'
    },
    {
        name: 'Trailing comma',
        json: '{"name": "John", "age": 30,}'
    },
    {
        name: 'Missing quotes on keys',
        json: '{name: "John", age: 30}'
    },
    {
        name: 'Single quotes instead of double',
        json: "{'name': 'John', 'age': 30}"
    },
    {
        name: 'Unbalanced braces',
        json: '{"name": "John", "age": 30'
    },
    {
        name: 'Extra closing brace',
        json: '{"name": "John", "age": 30}}'
    },
    {
        name: 'Completely malformed',
        json: 'this is not json at all'
    },
    {
        name: 'Multiple unescaped quotes',
        json: '{"postContent": "This is a "post" about "something" cool"}'
    },
    {
        name: 'Complex real-world example',
        json: '{"postContent": "Check out this "amazing" deal! It\'s "really" good.", "likes": 42,}'
    }
];

async function testDirtyJson() {
    for (const testCase of testCases) {
        console.log(`\n--- Testing: ${testCase.name} ---`);
        console.log(`Input: ${testCase.json}`);
        
        // Test standard JSON.parse
        let standardResult = 'FAILED';
        try {
            JSON.parse(testCase.json);
            standardResult = 'SUCCESS';
        } catch (e) {
            standardResult = `FAILED: ${e.message}`;
        }
        
        // Test dirty-json directly
        let dirtyResult = 'FAILED';
        try {
            const parsed = dirtyJSON.parse(testCase.json);
            dirtyResult = 'SUCCESS';
            console.log(`Parsed result:`, JSON.stringify(parsed, null, 2));
        } catch (e) {
            dirtyResult = `FAILED: ${e.message}`;
        }
        
        // Test our repair utility
        const repairResult = repairAndParseJson(testCase.json);
        
        console.log(`Standard JSON.parse: ${standardResult}`);
        console.log(`dirty-json: ${dirtyResult}`);
        console.log(`Our repair utility: ${repairResult.success ? 'SUCCESS' : 'FAILED'} (method: ${repairResult.method})`);
        
        if (repairResult.success && repairResult.data) {
            console.log(`Repair result:`, JSON.stringify(repairResult.data, null, 2));
        }
        
        console.log('---');
    }
}

testDirtyJson().catch(console.error);
