// Test Production API Locally - Token Limit Comparison
// This replicates the exact production API call for recHkqPSMfdQWyqus
// but tests different token limits locally

require('dotenv').config();
const https = require('https');

// Simple HTTP request function
function makeHttpsRequest(url) {
    return new Promise((resolve, reject) => {
        https.get(url, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(data);
                    resolve({ statusCode: res.statusCode, data: parsed });
                } catch (parseError) {
                    resolve({ statusCode: res.statusCode, data: data, parseError: parseError.message });
                }
            });
        }).on('error', reject);
    });
}

async function testProductionAPILocally() {
    const leadId = 'recHkqPSMfdQWyqus';
    
    console.log('🧪 TESTING PRODUCTION API LOCALLY');
    console.log('=' .repeat(60));
    console.log(`🎯 Target Lead: ${leadId}`);
    console.log(`📍 Production URL: https://pb-webhook-server.onrender.com/score-lead?recordId=${leadId}`);
    
    // Test 1: Call current production API (4096 tokens)
    console.log('\n📞 TEST 1: Current Production API (4096 tokens)');
    console.log('-'.repeat(50));
    
    try {
        const productionUrl = `https://pb-webhook-server.onrender.com/score-lead?recordId=${leadId}`;
        console.log(`🔗 Calling: ${productionUrl}`);
        
        const startTime = Date.now();
        const result = await makeHttpsRequest(productionUrl);
        const duration = Date.now() - startTime;
        
        console.log(`⏱️  Duration: ${duration}ms`);
        console.log(`📊 Status Code: ${result.statusCode}`);
        
        if (result.statusCode === 200) {
            console.log('✅ SUCCESS - Production API returned 200');
            console.log('📄 Response:');
            console.log(JSON.stringify(result.data, null, 2));
        } else {
            console.log('❌ FAILED - Production API error');
            console.log('📄 Error Response:');
            console.log(typeof result.data === 'string' ? result.data : JSON.stringify(result.data, null, 2));
            
            if (result.parseError) {
                console.log(`🚨 JSON Parse Error: ${result.parseError}`);
                console.log('📝 Raw Response (first 1000 chars):');
                console.log(result.data.substring(0, 1000));
            }
        }
        
    } catch (error) {
        console.log(`❌ Request failed: ${error.message}`);
    }
    
    // Test 2: Now test locally with 16K tokens
    console.log('\n📞 TEST 2: Local Test with 16K tokens');
    console.log('-'.repeat(50));
    
    try {
        // Import our local modules
        const { scoreLeadNow } = require('./singleScorer');
        const { buildPrompt, slimLead } = require('./promptBuilder');
        const Airtable = require('airtable');
        const { VertexAI } = require('@google-cloud/vertexai');
        
        // Initialize services
        console.log('🔧 Initializing local services...');
        
        // Setup Airtable
        const airtableApiKey = process.env.GUY_WILSON_AIRTABLE_API_KEY;
        const baseId = process.env.GUY_WILSON_AIRTABLE_BASE_ID;
        Airtable.configure({ apiKey: airtableApiKey });
        const base = Airtable.base(baseId);
        
        // Setup Vertex AI
        const vertex = new VertexAI({
            project: process.env.GCP_PROJECT_ID,
            location: process.env.GCP_LOCATION
        });
        
        const modelId = process.env.GEMINI_MODEL_ID || 'gemini-2.5-flash';
        
        console.log('✅ Services initialized');
        console.log(`🤖 Using model: ${modelId}`);
        
        // Fetch the lead data
        console.log(`📥 Fetching lead ${leadId} from Airtable...`);
        
        let leadData;
        try {
            const leadRecord = await base('Master Client Leads').find(leadId);
            leadData = leadRecord.fields;
        } catch (airtableError) {
            console.log(`⚠️  Direct lookup failed, trying to fetch from table...`);
            // Try to fetch from the table by filtering
            const records = await base('Master Client Leads').select({
                filterByFormula: `RECORD_ID() = '${leadId}'`,
                maxRecords: 1
            }).firstPage();
            
            if (records.length === 0) {
                throw new Error(`Lead ${leadId} not found in Airtable`);
            }
            leadData = records[0].fields;
        }
        
        console.log(`✅ Lead fetched: ${leadData.firstName} ${leadData.lastName}`);
        console.log(`📊 Profile size: ${leadData.profileFullJSON?.length || 0} characters`);
        
        // Test with 16K tokens
        console.log('\n🧪 Testing with 16384 tokens...');
        
        // Build the prompt exactly like production
        const systemPrompt = await buildPrompt();
        const slimmedLead = slimLead(leadData);
        const userPrompt = `Score the following single lead based on the criteria and JSON schema provided in the system instructions. The lead is: ${JSON.stringify(slimmedLead, null, 2)}`;
        
        console.log(`📝 System prompt: ${systemPrompt.length} characters`);
        console.log(`📝 User prompt: ${userPrompt.length} characters`);
        
        // Create model with 16K tokens
        const model = vertex.getGenerativeModel({
            model: modelId,
            systemInstruction: { parts: [{ text: systemPrompt }] },
            generationConfig: {
                temperature: 0,
                responseMimeType: "application/json",
                maxOutputTokens: 16384  // 🔥 THIS IS THE KEY CHANGE
            }
        });
        
        console.log('🚀 Calling Gemini with 16384 tokens...');
        const startTime16k = Date.now();
        
        const response = await model.generateContent({
            contents: [{ role: "user", parts: [{ text: userPrompt }] }]
        });
        
        const duration16k = Date.now() - startTime16k;
        const candidate = response.response.candidates[0];
        const text = candidate?.content?.parts[0]?.text;
        
        console.log(`⏱️  Duration: ${duration16k}ms`);
        console.log(`📈 Finish reason: ${candidate?.finishReason || 'Unknown'}`);
        console.log(`📄 Response length: ${text?.length || 0} characters`);
        
        if (text) {
            console.log('\n📄 RAW RESPONSE:');
            console.log('='.repeat(80));
            console.log(text);
            console.log('='.repeat(80));
            
            // Try to parse as JSON
            try {
                const parsed = JSON.parse(text);
                console.log('\n✅ JSON PARSING SUCCESSFUL!');
                console.log('📋 Parsed structure:');
                console.log(JSON.stringify(parsed, null, 2));
                
                if (parsed.leads && parsed.leads[0]) {
                    const lead = parsed.leads[0];
                    console.log('\n🎯 SCORING RESULTS:');
                    console.log(`   Score: ${lead.score || 'N/A'}`);
                    console.log(`   Status: ${lead.scoring_status || 'N/A'}`);
                    console.log(`   Reason: ${lead.reason || 'N/A'}`);
                }
                
            } catch (parseError) {
                console.log('\n❌ JSON PARSING FAILED');
                console.log(`🚨 Parse Error: ${parseError.message}`);
                console.log('📝 This suggests the response is still truncated or malformed');
            }
        } else {
            console.log('❌ No response text received');
        }
        
    } catch (error) {
        console.log(`❌ Local test failed: ${error.message}`);
        console.log('Stack trace:', error.stack);
    }
    
    console.log('\n🎯 COMPARISON SUMMARY');
    console.log('='.repeat(60));
    console.log('This test shows:');
    console.log('1. How the current production API behaves (likely fails with JSON parse error)');
    console.log('2. How the same lead scores with 16K tokens locally');
    console.log('3. Whether increasing token limit fixes the JSON parsing issue');
    console.log('\nIf 16K tokens produces valid JSON while production fails,');
    console.log('we have proof that increasing maxOutputTokens will fix the issue!');
}

// Run the test
testProductionAPILocally().catch(console.error);
