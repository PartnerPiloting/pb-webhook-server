const { repairAndParseJson } = require('./utils/jsonRepair');

console.log('=== Testing real PhantomBuster-like JSON issues ===\n');

const realWorldTestCases = [
    {
        name: 'Typical unescaped quotes in postContent',
        json: '[{"postContent": "This is a "real" post with "quotes" everywhere", "likes": 42, "comments": 3}]'
    },
    {
        name: 'Mixed quotes and apostrophes',
        json: '[{"postContent": "Can\'t believe this "amazing" deal! It\'s "really" something.", "date": "2024-01-01"}]'
    },
    {
        name: 'Nested quotes with line breaks',
        json: '[{"postContent": "He said:\n\\"This is \\"crazy\\" stuff\\"", "engagement": 100}]'
    },
    {
        name: 'Multiple posts with various quote issues',
        json: '[{"postContent": "First "post" here"}, {"postContent": "Second post with \'mixed\' quotes"}, {"postContent": "Third post is "clean""}]'
    },
    {
        name: 'Empty postContent with quotes elsewhere',
        json: '[{"postContent": "", "description": "This has "quotes" but content is empty"}]'
    },
    {
        name: 'Truncated JSON (missing closing bracket)',
        json: '[{"postContent": "This post is incomplete", "likes": 50'
    },
    {
        name: 'Extra trailing content',
        json: '[{"postContent": "Valid post", "likes": 10}] extra garbage here'
    },
    {
        name: 'Control characters and null bytes',
        json: '[{"postContent": "Post with\u0000null byte and\tcontrol chars", "status": "published"}]'
    },
    {
        name: 'Very long content with quotes',
        json: `[{"postContent": "${'This is a "very long" post with many "quotes" scattered throughout. '.repeat(50)}", "wordCount": 1000}]`
    },
    {
        name: 'Completely malformed - just text',
        json: 'This is not JSON at all, just plain text that somehow ended up in the field'
    }
];

async function testRealWorldCases() {
    let successCount = 0;
    let dirtyJsonSuccessCount = 0;
    let corruptedCount = 0;
    
    for (const testCase of realWorldTestCases) {
        console.log(`\n--- ${testCase.name} ---`);
        console.log(`Input length: ${testCase.json.length} characters`);
        console.log(`First 100 chars: ${testCase.json.substring(0, 100)}...`);
        
        const result = repairAndParseJson(testCase.json);
        
        console.log(`Result: ${result.success ? 'SUCCESS' : 'FAILED'}`);
        console.log(`Method: ${result.method}`);
        
        if (result.success) {
            successCount++;
            if (result.method.includes('DIRTY_JSON')) {
                dirtyJsonSuccessCount++;
            }
            
            // Show structure of parsed data
            const data = result.data;
            if (Array.isArray(data)) {
                console.log(`Parsed: Array with ${data.length} items`);
                if (data.length > 0 && data[0].postContent) {
                    console.log(`First post content: "${data[0].postContent.substring(0, 50)}..."`);
                }
            } else if (typeof data === 'object') {
                console.log(`Parsed: Object with keys: ${Object.keys(data).join(', ')}`);
            } else {
                console.log(`Parsed: ${typeof data} - "${String(data).substring(0, 50)}..."`);
            }
        } else {
            corruptedCount++;
            console.log(`Error: ${result.error}`);
        }
        
        console.log('---');
    }
    
    console.log(`\n=== SUMMARY ===`);
    console.log(`Total test cases: ${realWorldTestCases.length}`);
    console.log(`Successful parses: ${successCount}/${realWorldTestCases.length} (${Math.round(successCount/realWorldTestCases.length*100)}%)`);
    console.log(`Required dirty-json: ${dirtyJsonSuccessCount} cases`);
    console.log(`Truly corrupted: ${corruptedCount} cases`);
    
    console.log(`\nConclusion: dirty-json is ${dirtyJsonSuccessCount > 0 ? 'ESSENTIAL' : 'not needed'} for handling PhantomBuster data.`);
}

testRealWorldCases().catch(console.error);
