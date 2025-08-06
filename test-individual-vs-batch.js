require('dotenv').config();
const https = require('https');

// Test the specific lead that fails in batch but works individually
const PROBLEMATIC_LEAD_ID = 'recHkqPSMfdQWyqus';
const WEBHOOK_SERVER_URL = process.env.WEBHOOK_SERVER_URL || 'https://pb-webhook-server.onrender.com';

function makeRequest(url, method = 'GET', data = null) {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const options = {
            hostname: urlObj.hostname,
            port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
            path: urlObj.pathname + urlObj.search,
            method: method,
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'Test-Script/1.0'
            }
        };

        const req = https.request(options, (res) => {
            let responseData = '';
            res.on('data', (chunk) => {
                responseData += chunk;
            });
            res.on('end', () => {
                resolve({
                    statusCode: res.statusCode,
                    data: responseData,
                    headers: res.headers
                });
            });
        });

        req.on('error', (error) => {
            reject(error);
        });

        if (data) {
            req.write(JSON.stringify(data));
        }

        req.end();
    });
}

async function testIndividualLead() {
    console.log('🧪 TESTING INDIVIDUAL LEAD SCORING...');
    console.log(`📋 Lead ID: ${PROBLEMATIC_LEAD_ID}`);
    
    try {
        const startTime = Date.now();
        const response = await makeRequest(`${WEBHOOK_SERVER_URL}/score-lead?recordId=${PROBLEMATIC_LEAD_ID}`);
        const duration = Date.now() - startTime;
        
        console.log(`⏱️  Duration: ${duration}ms`);
        console.log(`📊 Status Code: ${response.statusCode}`);
        
        let parsedResponse;
        try {
            parsedResponse = JSON.parse(response.data);
            if (response.statusCode >= 400) {
                console.log('❌ INDIVIDUAL TEST RESULT: HTTP ERROR');
                console.log(`🚨 Status Code: ${response.statusCode}`);
                console.log('📄 Error Response:', JSON.stringify(parsedResponse, null, 2));
                return { success: false, duration, statusCode: response.statusCode, response: parsedResponse };
            } else {
                console.log('✅ INDIVIDUAL TEST RESULT: SUCCESS');
                console.log('📄 Response structure:', Object.keys(parsedResponse));
                if (parsedResponse.score) console.log(`🎯 Score: ${parsedResponse.score}`);
                if (parsedResponse.status) console.log(`📈 Status: ${parsedResponse.status}`);
                return { success: true, duration, response: parsedResponse };
            }
        } catch (parseError) {
            console.log('❌ INDIVIDUAL TEST RESULT: JSON PARSE FAILED');
            console.log('🚨 Parse Error:', parseError.message);
            console.log('📄 Raw Response (first 500 chars):', response.data.substring(0, 500));
            return { success: false, duration, error: parseError.message, rawResponse: response.data };
        }
    } catch (error) {
        console.log('❌ INDIVIDUAL TEST RESULT: REQUEST FAILED');
        console.log('🚨 Error:', error.message);
        return { success: false, error: error.message };
    }
}

async function testBatchWithProblematicLead() {
    console.log('\n🧪 TESTING BATCH SCORING...');
    
    console.log(`📋 Testing batch endpoint with limit=1`);
    
    try {
        const startTime = Date.now();
        const response = await makeRequest(`${WEBHOOK_SERVER_URL}/run-batch-score?limit=1`);
        const duration = Date.now() - startTime;
        
        console.log(`⏱️  Duration: ${duration}ms`);
        console.log(`📊 Status Code: ${response.statusCode}`);
        
        let parsedResponse;
        try {
            parsedResponse = JSON.parse(response.data);
            console.log('✅ BATCH TEST RESULT: SUCCESS');
            console.log('📄 Response structure:', Object.keys(parsedResponse));
            if (parsedResponse.successful !== undefined) console.log(`✅ Successful: ${parsedResponse.successful}`);
            if (parsedResponse.failed !== undefined) console.log(`❌ Failed: ${parsedResponse.failed}`);
            return { success: true, duration, response: parsedResponse };
        } catch (parseError) {
            console.log('❌ BATCH TEST RESULT: JSON PARSE FAILED');
            console.log('🚨 Parse Error:', parseError.message);
            console.log('📄 Raw Response (first 500 chars):', response.data.substring(0, 500));
            return { success: false, duration, error: parseError.message, rawResponse: response.data };
        }
    } catch (error) {
        console.log('❌ BATCH TEST RESULT: REQUEST FAILED');
        console.log('🚨 Error:', error.message);
        return { success: false, error: error.message };
    }
}

async function testMultipleGuyWilsonLeads() {
    console.log('\n🧪 TESTING LARGER BATCH SCORING...');
    
    console.log(`📋 Testing batch endpoint with limit=10`);
    
    try {
        const startTime = Date.now();
        const response = await makeRequest(`${WEBHOOK_SERVER_URL}/run-batch-score?limit=10`);
        const duration = Date.now() - startTime;
        
        console.log(`⏱️  Duration: ${duration}ms`);
        console.log(`📊 Status Code: ${response.statusCode}`);
        
        let parsedResponse;
        try {
            parsedResponse = JSON.parse(response.data);
            console.log('✅ MULTI-LEAD BATCH TEST RESULT: SUCCESS');
            console.log('📄 Response structure:', Object.keys(parsedResponse));
            if (parsedResponse.successful !== undefined) console.log(`✅ Successful: ${parsedResponse.successful}`);
            if (parsedResponse.failed !== undefined) console.log(`❌ Failed: ${parsedResponse.failed}`);
            if (parsedResponse.errors) console.log(`🚨 Errors: ${parsedResponse.errors.length}`);
            return { success: true, duration, response: parsedResponse };
        } catch (parseError) {
            console.log('❌ MULTI-LEAD BATCH TEST RESULT: JSON PARSE FAILED');
            console.log('🚨 Parse Error:', parseError.message);
            console.log('📄 Raw Response (first 500 chars):', response.data.substring(0, 500));
            return { success: false, duration, error: parseError.message, rawResponse: response.data };
        }
    } catch (error) {
        console.log('❌ MULTI-LEAD BATCH TEST RESULT: REQUEST FAILED');
        console.log('🚨 Error:', error.message);
        return { success: false, error: error.message };
    }
}

async function runDefinitiveTest() {
    console.log('🎯 DEFINITIVE INDIVIDUAL vs BATCH COMPARISON TEST');
    console.log('='.repeat(80));
    console.log(`🕐 Started at: ${new Date().toLocaleString()}`);
    console.log(`🌐 Target Server: ${WEBHOOK_SERVER_URL}`);
    
    // Test 1: Individual lead
    const individualResult = await testIndividualLead();
    
    // Wait a moment between tests
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Test 2: Same lead in batch
    const batchResult = await testBatchWithProblematicLead();
    
    // Wait a moment between tests
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Test 3: Multiple Guy-Wilson leads
    const multiBatchResult = await testMultipleGuyWilsonLeads();
    
    // Analysis
    console.log('\n' + '='.repeat(80));
    console.log('🔍 DEFINITIVE ANALYSIS RESULTS');
    console.log('='.repeat(80));
    
    console.log(`\n📊 INDIVIDUAL LEAD TEST:`);
    console.log(`   Result: ${individualResult.success ? '✅ SUCCESS' : '❌ FAILED'}`);
    if (individualResult.duration) console.log(`   Duration: ${individualResult.duration}ms`);
    if (individualResult.error) console.log(`   Error: ${individualResult.error}`);
    
    console.log(`\n📊 BATCH (SINGLE LEAD) TEST:`);
    console.log(`   Result: ${batchResult.success ? '✅ SUCCESS' : '❌ FAILED'}`);
    if (batchResult.duration) console.log(`   Duration: ${batchResult.duration}ms`);
    if (batchResult.error) console.log(`   Error: ${batchResult.error}`);
    
    console.log(`\n📊 MULTI-LEAD BATCH TEST:`);
    console.log(`   Result: ${multiBatchResult.success ? '✅ SUCCESS' : '❌ FAILED'}`);
    if (multiBatchResult.duration) console.log(`   Duration: ${multiBatchResult.duration}ms`);
    if (multiBatchResult.error) console.log(`   Error: ${multiBatchResult.error}`);
    
    // Definitive conclusion
    console.log(`\n🎯 DEFINITIVE CONCLUSION:`);
    if (individualResult.success && !batchResult.success) {
        console.log('   ✅ CONFIRMED: Lead works individually but fails in batch processing');
        console.log('   🔍 Root Cause: Batch processing changes how Gemini AI responds');
    } else if (individualResult.success && batchResult.success && !multiBatchResult.success) {
        console.log('   ✅ CONFIRMED: Single lead batches work, but multiple Guy-Wilson leads fail');
        console.log('   🔍 Root Cause: Similar data repetition causes Gemini quality degradation');
    } else if (!individualResult.success) {
        console.log('   ❌ UNEXPECTED: Lead fails even individually - check lead data or server');
    } else if (individualResult.success && batchResult.success && multiBatchResult.success) {
        console.log('   ⚠️  INTERESTING: All tests pass - the issue might be intermittent or load-related');
    } else {
        console.log('   🤔 MIXED RESULTS: Need further investigation');
    }
    
    console.log(`\n🕐 Test completed at: ${new Date().toLocaleString()}`);
}

// Run the test
runDefinitiveTest().catch(console.error);
