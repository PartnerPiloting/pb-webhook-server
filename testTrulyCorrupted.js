const { repairAndParseJson } = require('./utils/jsonRepair');

console.log('=== Testing what actually breaks dirty-json ===\n');

const trulyCorrputedCases = [
    {
        name: 'Extra closing braces',
        json: '{"name": "John"}}'
    },
    {
        name: 'Random binary data',
        json: '\x00\x01\x02\x03\x04\x05'
    },
    {
        name: 'Infinite nested quotes',
        json: '{"content": "He said "She said "They said "We said "Hello""""}'
    },
    {
        name: 'Mixed brackets and braces badly',
        json: '{"array": [1, 2, 3}, "object": {"key": "value"]]'
    },
    {
        name: 'Escape sequence chaos',
        json: '{"content": "\\\\\\"\\\\\\"\\n\\t\\r"}'
    },
    {
        name: 'Unicode mess',
        json: '{"content": "\\u00ZZ\\u123G\\uABXY"}'
    }
];

async function testCorruptedCases() {
    let corruptedCount = 0;
    
    for (const testCase of trulyCorrputedCases) {
        console.log(`\n--- ${testCase.name} ---`);
        console.log(`Input: ${testCase.json}`);
        
        const result = repairAndParseJson(testCase.json);
        
        console.log(`Result: ${result.success ? 'SUCCESS' : 'FAILED'}`);
        console.log(`Method: ${result.method}`);
        
        if (result.success) {
            console.log(`Parsed data type: ${typeof result.data}`);
            if (typeof result.data === 'object') {
                console.log(`Parsed object keys: ${Object.keys(result.data || {}).join(', ')}`);
            } else {
                console.log(`Parsed value: "${String(result.data).substring(0, 50)}..."`);
            }
        } else {
            corruptedCount++;
            console.log(`Error: ${result.error}`);
        }
        
        console.log('---');
    }
    
    console.log(`\n=== CORRUPTION ANALYSIS ===`);
    console.log(`Total test cases: ${trulyCorrputedCases.length}`);
    console.log(`Actually corrupted (unparseable): ${corruptedCount}/${trulyCorrputedCases.length}`);
    console.log(`Success rate even on "corrupted" data: ${Math.round((trulyCorrputedCases.length-corruptedCount)/trulyCorrputedCases.length*100)}%`);
}

testCorruptedCases().catch(console.error);
