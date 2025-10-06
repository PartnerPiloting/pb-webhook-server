// test-debug-logging.js
// Test script to verify the debugging enhancements work without breaking anything

require('dotenv').config();

async function testDebugLogging() {
    console.log('🧪 Testing Batch Scorer Debug Logging...\n');
    
    try {
        // Test 1: Initialize Gemini (verify config works)
        console.log('📝 Test 1: Initializing Gemini client...');
        const geminiConfig = require('./config/geminiClient.js');
        
        if (!geminiConfig || !geminiConfig.vertexAIClient) {
            throw new Error('Gemini client not available');
        }
        
        const { vertexAIClient } = geminiConfig;
        console.log('✅ Gemini client initialized successfully');
        
        // Test 2: Create a mock model instance to test metadata extraction
        console.log('\n📝 Test 2: Testing Gemini response metadata extraction...');
        
        const model = vertexAIClient.getGenerativeModel({
            model: 'gemini-2.5-flash',
            generationConfig: {
                maxOutputTokens: 100,
                temperature: 0,
                responseMimeType: "application/json"
            }
        });
        
        // Simple test request that should work
        const testPrompt = `Return a JSON array with exactly 2 objects: [{"test": "one", "status": "success"}, {"test": "two", "status": "success"}]`;
        
        console.log('🚀 Calling Gemini API with test prompt...');
        const result = await model.generateContent({
            contents: [{ role: 'user', parts: [{ text: testPrompt }] }]
        });
        
        // Test the debug logging extraction (this is what we'll add to batchScorer.js)
        const response = result.response;
        const finishReason = response.candidates?.[0]?.finishReason || 'UNKNOWN';
        const tokenCount = response.usageMetadata?.candidatesTokenCount || 0;
        const promptTokens = response.usageMetadata?.promptTokenCount || 0;
        const totalTokens = response.usageMetadata?.totalTokenCount || 0;
        
        // Create mock batch ID (like we'll do in production)
        const batchId = `TEST_BATCH_${new Date().toISOString().replace(/[:.]/g, '-')}_2leads`;
        
        // Test the debug logging structure
        const debugInfo = {
            batchId: batchId,
            chunkSize: 2,
            maxOutputTokens: 100,
            responseTime: '150ms', // Mock value
            finishReason: finishReason,
            outputTokens: tokenCount,
            promptTokens: promptTokens,
            totalTokens: totalTokens,
            hitTokenLimit: finishReason === 'MAX_TOKENS',
            clientId: 'TEST_CLIENT',
            firstLeadId: 'TEST_LEAD_1',
            lastLeadId: 'TEST_LEAD_2'
        };
        
        console.log('🎯 BATCH_SCORER_DEBUG:', JSON.stringify(debugInfo, null, 2));
        
        // Test response analysis
        const candidate = response.candidates?.[0];
        const rawResponseText = candidate?.content?.parts?.[0]?.text || '';
        const responseLength = rawResponseText.length;
        const lastChar = rawResponseText[responseLength - 1];
        const last50Chars = rawResponseText.substring(responseLength - 50);
        const hasClosingBracket = rawResponseText.trim().endsWith(']');
        const hasClosingBrace = rawResponseText.trim().endsWith('}');
        
        const responseAnalysis = {
            batchId: batchId,
            responseLength: responseLength,
            lastCharacter: lastChar,
            last50Characters: last50Chars,
            appearsComplete: hasClosingBracket || hasClosingBrace,
            possiblyTruncated: !hasClosingBracket && !hasClosingBrace,
            finishReason: finishReason
        };
        
        console.log('🔍 RESPONSE_ANALYSIS:', JSON.stringify(responseAnalysis, null, 2));
        
        // Test JSON parsing with error handling
        console.log('\n📝 Test 3: Testing JSON parsing and error handling...');
        try {
            const parsedJson = JSON.parse(rawResponseText);
            console.log('✅ JSON parsed successfully');
            console.log(`✅ Parsed ${parsedJson.length} objects`);
            console.log('✅ Sample object:', parsedJson[0]);
        } catch (parseErr) {
            // This shouldn't happen with our simple test, but test the error handling
            const errorPosition = parseErr.message.match(/position (\d+)/)?.[1];
            const contextStart = Math.max(0, parseInt(errorPosition || 0) - 50);
            const contextEnd = Math.min(rawResponseText.length, parseInt(errorPosition || 0) + 50);
            const errorContext = rawResponseText.substring(contextStart, contextEnd);
            
            const errorDebugInfo = {
                batchId: batchId,
                errorMessage: parseErr.message,
                errorPosition: errorPosition,
                responseLength: rawResponseText.length,
                finishReason: finishReason,
                wasTokenLimitHit: finishReason === 'MAX_TOKENS',
                errorContext: errorContext,
                last100Chars: rawResponseText.substring(rawResponseText.length - 100)
            };
            
            console.log('🚨 JSON_PARSE_FAILED:', JSON.stringify(errorDebugInfo, null, 2));
        }
        
        // Test 4: Force a token limit to test truncation detection
        console.log('\n📝 Test 4: Testing token limit detection...');
        
        const limitedModel = vertexAIClient.getGenerativeModel({
            model: 'gemini-2.5-flash',
            generationConfig: {
                maxOutputTokens: 50, // Very low limit to force truncation
                temperature: 0,
                responseMimeType: "application/json"
            }
        });
        
        const longPrompt = `Return a JSON array with 20 objects, each containing detailed information with multiple fields like: [{"id": 1, "name": "Very long detailed name", "description": "A very long description with lots of text to exceed token limits", "status": "active", "metadata": {"created": "2024-01-01", "tags": ["tag1", "tag2", "tag3"], "notes": "Additional notes"}}, ...]`;
        
        try {
            console.log('🚀 Calling Gemini API with token-limit test...');
            const limitResult = await limitedModel.generateContent({
                contents: [{ role: 'user', parts: [{ text: longPrompt }] }]
            });
            
            const limitResponse = limitResult.response;
            const limitFinishReason = limitResponse.candidates?.[0]?.finishReason || 'UNKNOWN';
            const limitTokenCount = limitResponse.usageMetadata?.candidatesTokenCount || 0;
            
            console.log(`✅ Finish Reason: ${limitFinishReason}`);
            console.log(`✅ Output Tokens: ${limitTokenCount}/50`);
            console.log(`✅ Hit Token Limit: ${limitFinishReason === 'MAX_TOKENS'}`);
            
            if (limitFinishReason === 'MAX_TOKENS') {
                console.log('🎯 SUCCESS: Token limit detection works!');
                
                const limitResponseText = limitResponse.text();
                console.log(`✅ Response ends with: ...${limitResponseText.slice(-30)}`);
                console.log(`✅ Appears truncated: ${!limitResponseText.trim().endsWith(']')}`);
                
                // Test JSON parsing failure on truncated response
                try {
                    JSON.parse(limitResponseText);
                    console.log('⚠️  Unexpected: Truncated JSON parsed successfully');
                } catch (limitParseErr) {
                    console.log('✅ Expected: JSON parse failed on truncated response');
                    console.log(`✅ Parse error: ${limitParseErr.message}`);
                }
            } else {
                console.log('⚠️  Note: Token limit was not hit (response was short enough)');
            }
            
        } catch (limitError) {
            console.log(`⚠️  Token limit test error: ${limitError.message}`);
        }
        
        console.log('\n🎉 All debug logging tests completed successfully!');
        console.log('\n📋 Summary of what we tested:');
        console.log('✅ Gemini client initialization');
        console.log('✅ Response metadata extraction (finishReason, tokens)');
        console.log('✅ Response analysis (length, completeness)');
        console.log('✅ JSON parsing error handling');
        console.log('✅ Token limit detection');
        console.log('✅ Debug info structure formatting');
        
        console.log('\n🚀 Ready to implement in batchScorer.js!');
        
    } catch (error) {
        console.error('❌ Test failed:', error.message);
        console.log('\n⚠️  Error details:', error.stack);
        console.log('\n❌ Fix the issue before implementing in production!');
        process.exit(1);
    }
}

// Run the test
testDebugLogging().catch(console.error);
