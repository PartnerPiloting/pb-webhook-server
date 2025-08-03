// test-batch-small.js - Test batch scoring with a small number of leads for debugging

require('dotenv').config();

const https = require('https');

function makeRequest(url, options = {}) {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        
        const requestOptions = {
            hostname: urlObj.hostname,
            port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
            path: urlObj.pathname + urlObj.search,
            method: options.method || 'GET',
            headers: {
                'Accept': 'application/json',
                'User-Agent': 'Test-Batch-Small/1.0',
                ...options.headers
            }
        };

        const req = https.request(requestOptions, (res) => {
            let data = '';
            
            res.on('data', (chunk) => {
                data += chunk;
            });
            
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(data);
                    resolve({
                        statusCode: res.statusCode,
                        data: parsed,
                        headers: res.headers
                    });
                } catch (parseError) {
                    // If JSON parsing fails, return raw data
                    resolve({
                        statusCode: res.statusCode,
                        data: data,
                        headers: res.headers,
                        parseError: parseError.message
                    });
                }
            });
        });

        req.on('error', (error) => {
            reject(error);
        });

        if (options.body) {
            req.write(JSON.stringify(options.body));
        }

        req.end();
    });
}

async function testBatchScoring() {
    console.log('🧪 Testing batch scoring with small lead count...\n');
    
    const testParams = [
        { limit: 3, description: 'Ultra small test (3 leads)' },
        { limit: 5, description: 'Small test (5 leads)' },
        { limit: 10, description: 'Medium test (10 leads)' }
    ];
    
    for (const test of testParams) {
        console.log(`\n${'='.repeat(60)}`);
        console.log(`🔍 ${test.description}`);
        console.log(`📊 Limit: ${test.limit} leads`);
        console.log(`${'-'.repeat(40)}`);
        
        try {
            const startTime = Date.now();
            
            const url = `https://pb-webhook-server.onrender.com/run-batch-score?limit=${test.limit}`;
            console.log(`📡 Calling: ${url}`);
            
            const response = await makeRequest(url);
            const duration = Date.now() - startTime;
            
            console.log(`\n📈 Response Status: ${response.statusCode}`);
            console.log(`⏱️  Duration: ${duration}ms`);
            
            if (response.parseError) {
                console.log(`⚠️  JSON Parse Error: ${response.parseError}`);
                console.log(`📄 Raw Response (first 500 chars):`);
                console.log(typeof response.data === 'string' ? response.data.substring(0, 500) : response.data);
            } else {
                console.log(`\n📊 RESPONSE ANALYSIS:`);
                
                if (response.data.ok) {
                    console.log(`✅ Status: Success`);
                    console.log(`📝 Message: ${response.data.message || 'No message'}`);
                    
                    // Analyze summary
                    if (response.data.summary) {
                        const summary = response.data.summary;
                        console.log(`\n📈 SUMMARY:`);
                        console.log(`   🏢 Clients Processed: ${summary.clientsProcessed || 0}`);
                        console.log(`   📊 Total Leads: ${summary.totalLeadsProcessed || 0}`);
                        console.log(`   ✅ Successful: ${summary.totalSuccessful || 0}`);
                        console.log(`   ❌ Failed: ${summary.totalFailed || 0}`);
                        console.log(`   🪙 Tokens Used: ${summary.totalTokensUsed || 0}`);
                        console.log(`   ⏱️  Duration: ${summary.totalDurationSeconds || 0}s`);
                    }
                    
                    // Analyze client results
                    if (response.data.clientResults && Array.isArray(response.data.clientResults)) {
                        console.log(`\n🏢 CLIENT BREAKDOWN (${response.data.clientResults.length} clients):`);
                        
                        response.data.clientResults.forEach((client, index) => {
                            console.log(`\n   ${index + 1}. CLIENT: ${client.clientId || 'Unknown'}`);
                            console.log(`      📊 Processed: ${client.processed || 0}`);
                            console.log(`      ✅ Successful: ${client.successful || 0}`);
                            console.log(`      ❌ Failed: ${client.failed || 0}`);
                            console.log(`      🪙 Tokens: ${client.tokensUsed || 0}`);
                            console.log(`      ⏱️  Duration: ${client.duration || 0}s`);
                            console.log(`      📈 Status: ${client.status || 'Unknown'}`);
                            
                            // Check for error details - THIS IS THE KEY PART WE'RE INVESTIGATING
                            if (client.errorDetails) {
                                if (Array.isArray(client.errorDetails) && client.errorDetails.length > 0) {
                                    console.log(`      🚨 ERROR DETAILS (${client.errorDetails.length} errors):`);
                                    client.errorDetails.slice(0, 5).forEach((error, errorIndex) => {
                                        console.log(`         ${errorIndex + 1}. ${error.message || error.error || error}`);
                                        if (error.leadId) console.log(`            Lead ID: ${error.leadId}`);
                                        if (error.code) console.log(`            Error Code: ${error.code}`);
                                    });
                                    if (client.errorDetails.length > 5) {
                                        console.log(`         ... and ${client.errorDetails.length - 5} more errors`);
                                    }
                                } else {
                                    console.log(`      🔍 ERROR DETAILS: Empty array (this is the issue we found!)`);
                                }
                            } else {
                                console.log(`      🔍 ERROR DETAILS: Field missing (this confirms the logging gap)`);
                            }
                            
                            if (client.failed > 0 && (!client.errorDetails || client.errorDetails.length === 0)) {
                                console.log(`      ⚠️  WARNING: ${client.failed} failures but no error details captured!`);
                            }
                        });
                    }
                    
                } else {
                    console.log(`❌ Status: Failed`);
                    console.log(`📝 Error: ${response.data.error || 'Unknown error'}`);
                }
            }
            
            console.log(`\n${'-'.repeat(60)}`);
            
        } catch (error) {
            console.error(`❌ Test failed: ${error.message}`);
            console.error(`Stack: ${error.stack}`);
        }
        
        // Small delay between tests
        if (test !== testParams[testParams.length - 1]) {
            console.log(`\n⏳ Waiting 3 seconds before next test...`);
            await new Promise(resolve => setTimeout(resolve, 3000));
        }
    }
    
    console.log(`\n${'='.repeat(60)}`);
    console.log(`🎯 BATCH SCORING TEST COMPLETED`);
    console.log(`${'-'.repeat(40)}`);
    console.log(`✅ All tests completed. Check the results above to identify:`);
    console.log(`   1. Whether failures are being detected`);
    console.log(`   2. Whether error details are missing from client results`);
    console.log(`   3. Which clients are experiencing failures`);
    console.log(`   4. What the actual error messages are (if captured)`);
}

if (require.main === module) {
    testBatchScoring().catch(console.error);
}

module.exports = { testBatchScoring };
