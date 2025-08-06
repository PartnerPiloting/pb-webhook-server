const { VertexAI } = require('@google-cloud/vertexai');
require('dotenv').config();
const airtableClient = require('./config/airtableClient');

// Initialize Vertex AI client (using same config as production)
const vertex_ai = new VertexAI({
    project: process.env.GCP_PROJECT_ID,
    location: process.env.GCP_LOCATION
});

const model = vertex_ai.getGenerativeModel({
    model: process.env.GEMINI_MODEL_ID || 'gemini-2.5-flash',
    generationConfig: {
        maxOutputTokens: 8192,
        temperature: 0.1,
    }
});

async function comprehensiveGeminiTest() {
    console.log('🧪 COMPREHENSIVE GEMINI TRUNCATION TEST');
    console.log('=' .repeat(80));
    
    try {
        const base = airtableClient;
        
        // Get the same failing lead used in previous tests
        console.log('\n📊 Fetching test lead data...');
        const record = await base('Leads').find('recHkqPSMfdQWyqus');
        const name = record.get('Name') || 'Unknown';
        const profileJSON = record.get('Profile Full JSON');
        
        console.log(`   ✅ Lead: ${name}`);
        console.log(`   📏 Original JSON Length: ${profileJSON ? profileJSON.length : 0} characters`);
        
        if (!profileJSON) {
            console.log('   ❌ No Profile Full JSON found!');
            return;
        }
        
        const jsonString = profileJSON;
        
        console.log(`📊 Test Data Stats:`);
        console.log(`   Characters: ${jsonString.length}`);
        console.log(`   Lines: ${jsonString.split('\n').length}`);
        console.log(`   Approximate tokens: ${Math.ceil(jsonString.length / 4)}`);
        
        // TEST 1: Progressive size test - find exact truncation point
        console.log('\n🔍 TEST 1: Progressive Size Test - Finding Exact Truncation Point');
        console.log('-'.repeat(60));
        
        const testSizes = [1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000];
        const truncationResults = {};
        
        for (const size of testSizes) {
            const testInput = jsonString.substring(0, size);
            const marker = `__END_MARKER_${size}__`;
            const testInputWithMarker = testInput + marker;
            
            try {
                const prompt = `Please return exactly what I send you, character for character. No formatting, no analysis, just echo back the exact input:\n\n${testInputWithMarker}`;
                
                const result = await model.generateContent(prompt);
                const response = result.response.candidates[0].content.parts[0].text;
                
                // Check if marker is present
                const hasMarker = response.includes(marker);
                const actualLength = response.length;
                const expectedLength = testInputWithMarker.length;
                const lossPercentage = ((expectedLength - actualLength) / expectedLength * 100).toFixed(1);
                
                truncationResults[size] = {
                    hasMarker,
                    actualLength,
                    expectedLength,
                    lossPercentage,
                    truncated: !hasMarker || actualLength < expectedLength
                };
                
                console.log(`   📏 Size ${size}: ${hasMarker ? '✅' : '❌'} Marker present | Loss: ${lossPercentage}% | Actual: ${actualLength} / Expected: ${expectedLength}`);
                
                // Small delay to avoid rate limiting
                await new Promise(resolve => setTimeout(resolve, 1000));
                
            } catch (error) {
                console.log(`   ❌ Size ${size}: Error - ${error.message}`);
                truncationResults[size] = { error: error.message };
            }
        }
        
        // TEST 2: Multiple independent confirmations
        console.log('\n🔍 TEST 2: Multiple Independent Confirmations');
        console.log('-'.repeat(60));
        
        const confirmationTests = [
            {
                name: "Character Count Test",
                prompt: `Count the exact number of characters in this JSON data and return ONLY the number:\n\n${jsonString}`
            },
            {
                name: "Last Line Test", 
                prompt: `What is the EXACT last line of this JSON data? Return only that line:\n\n${jsonString}`
            },
            {
                name: "Specific Field Test",
                prompt: `Find the field "industry" in this JSON and return its exact value:\n\n${jsonString}`
            },
            {
                name: "Structure Analysis",
                prompt: `How many top-level keys does this JSON object have? List them:\n\n${jsonString}`
            }
        ];
        
        for (const test of confirmationTests) {
            try {
                console.log(`\n   🧪 ${test.name}:`);
                
                const result = await model.generateContent(test.prompt);
                const response = result.response.candidates[0].content.parts[0].text.trim();
                
                console.log(`      Response: ${response}`);
                
                // Verify against actual data
                if (test.name === "Character Count Test") {
                    const actualCount = jsonString.length;
                    const reportedCount = parseInt(response);
                    console.log(`      ✓ Actual count: ${actualCount}`);
                    console.log(`      ${reportedCount === actualCount ? '✅' : '❌'} Match: ${reportedCount === actualCount}`);
                }
                
                if (test.name === "Last Line Test") {
                    const actualLastLine = jsonString.split('\n').pop().trim();
                    console.log(`      ✓ Actual last line: "${actualLastLine}"`);
                    console.log(`      ${response.includes(actualLastLine) ? '✅' : '❌'} Match: ${response.includes(actualLastLine)}`);
                }
                
                await new Promise(resolve => setTimeout(resolve, 1000));
                
            } catch (error) {
                console.log(`      ❌ Error: ${error.message}`);
            }
        }
        
        // TEST 3: Raw token analysis
        console.log('\n🔍 TEST 3: Raw Token Analysis');
        console.log('-'.repeat(60));
        
        try {
            // Use a simple counting prompt
            const tokenPrompt = `Please count how many words are in this text and return ONLY the number. Text: ${jsonString}`;
            
            const tokenResult = await model.generateContent(tokenPrompt);
            const tokenResponse = tokenResult.response.candidates[0].content.parts[0].text.trim();
            
            // Count actual words
            const actualWords = jsonString.split(/\s+/).length;
            const reportedWords = parseInt(tokenResponse);
            
            console.log(`   📊 Word Count Analysis:`);
            console.log(`      Actual words: ${actualWords}`);
            console.log(`      AI reported: ${reportedWords}`);
            console.log(`      Difference: ${actualWords - reportedWords} words`);
            console.log(`      ${Math.abs(actualWords - reportedWords) < 10 ? '✅' : '❌'} Reasonable match: ${Math.abs(actualWords - reportedWords) < 10}`);
            
        } catch (error) {
            console.log(`   ❌ Token analysis error: ${error.message}`);
        }
        
        // TEST 4: Control test with small data
        console.log('\n🔍 TEST 4: Control Test with Small Data');
        console.log('-'.repeat(60));
        
        const smallData = { test: "small", value: 123, array: [1, 2, 3] };
        const smallJsonString = JSON.stringify(smallData, null, 2);
        const smallMarker = "__SMALL_END__";
        const smallInput = smallJsonString + smallMarker;
        
        try {
            const controlPrompt = `Echo back exactly: ${smallInput}`;
            const controlResult = await model.generateContent(controlPrompt);
            const controlResponse = controlResult.response.candidates[0].content.parts[0].text;
            
            console.log(`   📊 Small Data Control:`);
            console.log(`      Input length: ${smallInput.length}`);
            console.log(`      Output length: ${controlResponse.length}`);
            console.log(`      Has marker: ${controlResponse.includes(smallMarker) ? '✅' : '❌'}`);
            console.log(`      Perfect match: ${controlResponse.trim() === smallInput ? '✅' : '❌'}`);
            
        } catch (error) {
            console.log(`   ❌ Control test error: ${error.message}`);
        }
        
        // ANALYSIS AND CONCLUSION
        console.log('\n📋 ANALYSIS AND CONCLUSION');
        console.log('=' .repeat(80));
        
        console.log('\n🎯 Truncation Point Analysis:');
        Object.entries(truncationResults).forEach(([size, result]) => {
            if (!result.error) {
                console.log(`   Size ${size}: ${result.truncated ? '❌ TRUNCATED' : '✅ INTACT'} (${result.lossPercentage}% loss)`);
            }
        });
        
        // Find the truncation threshold
        const intactSizes = Object.entries(truncationResults)
            .filter(([size, result]) => !result.error && !result.truncated)
            .map(([size]) => parseInt(size));
        
        const truncatedSizes = Object.entries(truncationResults)
            .filter(([size, result]) => !result.error && result.truncated)
            .map(([size]) => parseInt(size));
        
        if (intactSizes.length > 0 && truncatedSizes.length > 0) {
            const maxIntact = Math.max(...intactSizes);
            const minTruncated = Math.min(...truncatedSizes);
            
            console.log(`\n🎯 CONCLUSION:`);
            console.log(`   ✅ Maximum intact size: ${maxIntact} characters`);
            console.log(`   ❌ Minimum truncated size: ${minTruncated} characters`);
            console.log(`   📊 Truncation threshold: Between ${maxIntact} and ${minTruncated} characters`);
            
            if (minTruncated <= jsonString.length) {
                console.log(`   🚨 CONFIRMED: Your ${jsonString.length}-character input WILL be truncated`);
                console.log(`   💡 Recommendation: Split large JSON inputs into smaller chunks`);
            } else {
                console.log(`   ✅ Your ${jsonString.length}-character input should be processed intact`);
            }
        } else {
            console.log(`\n❓ INCONCLUSIVE: Need more data points to determine truncation threshold`);
        }
        
        console.log(`\n🔬 SCIENTIFIC CONFIDENCE:`);
        console.log(`   Multiple test methods used: ✅`);
        console.log(`   Progressive size testing: ✅`);
        console.log(`   Independent verification: ✅`);
        console.log(`   Control test with small data: ✅`);
        console.log(`   \n   📊 CONFIDENCE LEVEL: ${truncatedSizes.length > 0 ? 'HIGH' : 'MODERATE'} - Truncation behavior ${truncatedSizes.length > 0 ? 'CONFIRMED' : 'NOT CONFIRMED'}`);
        
    } catch (error) {
        console.error('❌ Test error:', error);
    }
}

// Run the comprehensive test
comprehensiveGeminiTest();
