// Test 16K tokens for specific failing lead recHkqPSMfdQWyqus

require('dotenv').config();
const Airtable = require('airtable');
const { VertexAI } = require('@google-cloud/vertexai');
const { buildPrompt, slimLead } = require('./promptBuilder');

class TokenTest {
    constructor() {
        this.base = null;
        this.vertex = null;
    }

    async initializeAirtable() {
        try {
            console.log('🔧 Initializing Airtable connection for Guy-Wilson...');
            
            const airtableApiKey = process.env.AIRTABLE_API_KEY;
            const baseId = process.env.AIRTABLE_BASE_ID;
            
            if (!airtableApiKey || !baseId) {
                throw new Error('Missing Guy-Wilson Airtable credentials in .env file');
            }

            Airtable.configure({ apiKey: airtableApiKey });
            this.base = Airtable.base(baseId);
            
            console.log('✅ Airtable connection initialized successfully');
            return true;
        } catch (error) {
            console.error('❌ Failed to initialize Airtable:', error.message);
            throw error;
        }
    }

    async initializeVertexAI() {
        try {
            console.log('🔧 Initializing Vertex AI...');
            
            const projectId = process.env.GCP_PROJECT_ID;
            const location = process.env.GCP_LOCATION;
            
            if (!projectId || !location) {
                throw new Error('Missing GCP_PROJECT_ID or GCP_LOCATION in .env file');
            }

            this.vertex = new VertexAI({
                project: projectId,
                location: location
            });
            
            console.log('✅ Vertex AI initialized successfully');
            return true;
        } catch (error) {
            console.error('❌ Failed to initialize Vertex AI:', error.message);
            throw error;
        }
    }

    async getSpecificLead(leadId) {
        try {
            console.log(`🔍 Fetching lead: ${leadId}...`);
            
            const record = await this.base('Leads').find(leadId);
            const fields = record.fields;
            
            const lead = {
                id: record.id,
                email: fields.Email,
                company: fields.Company,
                firstName: fields['First Name'],
                lastName: fields['Last Name'],
                scoringStatus: fields['Scoring Status'],
                profileFullJSON: fields['Profile Full JSON'],
                processed: fields.Processed,
                score: fields.Score
            };
            
            console.log(`✅ Found lead: ${lead.firstName} ${lead.lastName} (${lead.company})`);
            console.log(`   Email: ${lead.email}`);
            console.log(`   Status: ${lead.scoringStatus}`);
            console.log(`   Profile size: ${lead.profileFullJSON ? lead.profileFullJSON.length : 0} characters`);
            
            return lead;
            
        } catch (error) {
            console.error(`❌ Failed to fetch lead ${leadId}:`, error.message);
            throw error;
        }
    }

    async testLeadWithTokens(lead, maxTokens) {
        const startTime = Date.now();
        
        try {
            console.log(`\n🧪 TESTING WITH ${maxTokens} TOKENS`);
            console.log('='.repeat(60));
            console.log(`🎯 Lead: ${lead.firstName} ${lead.lastName} (${lead.company})`);
            console.log(`📧 Email: ${lead.email}`);
            console.log(`📊 Profile size: ${lead.profileFullJSON ? lead.profileFullJSON.length : 0} characters`);
            
            // Step 1: Build prompt using same method as production
            console.log('\n📝 Building prompt...');
            const systemPromptInstructions = await buildPrompt();
            const slimmedLead = slimLead(lead);
            const leadsDataForUserPrompt = JSON.stringify({ leads: [slimmedLead] });
            const fullPrompt = `Score the following single lead based on the criteria and JSON schema provided in the system instructions. The lead is: ${leadsDataForUserPrompt}`;
            
            if (!fullPrompt || fullPrompt.length === 0) {
                throw new Error('Prompt builder returned empty prompt');
            }
            
            console.log(`✅ Prompt built successfully (${fullPrompt.length} characters)`);
            console.log(`   System prompt: ${systemPromptInstructions.length} characters`);
            console.log(`   User prompt: ${fullPrompt.length} characters`);
            
            // Step 2: Get Vertex AI model
            console.log('\n🤖 Getting Gemini model...');
            const modelId = process.env.GEMINI_MODEL_ID || 'gemini-2.5-flash';
            console.log(`   Using model: ${modelId}`);
            const model = this.vertex.getGenerativeModel({
                model: modelId,
                systemInstruction: { parts: [{ text: systemPromptInstructions }] },
                generationConfig: {
                    temperature: 0,
                    responseMimeType: "application/json",
                    maxOutputTokens: maxTokens
                }
            });
            console.log('✅ Model obtained');
            
            // Step 3: Make the scoring request with specified token limit
            console.log(`\n🚀 Calling Gemini API with ${maxTokens} maxOutputTokens...`);
            const aiResult = await model.generateContent({
                contents: [{ role: "user", parts: [{ text: fullPrompt }] }]
            });

            const response = aiResult.response;
            if (!response) {
                throw new Error('No response from Vertex AI');
            }

            // Check finish reason
            const candidate = response.candidates[0];
            const finishReason = candidate?.finishReason;
            const safetyRatings = candidate?.safetyRatings;
            
            console.log(`📈 Finish reason: ${finishReason}`);
            if (safetyRatings) {
                console.log(`🛡️  Safety ratings: ${JSON.stringify(safetyRatings)}`);
            }

            const text = response.candidates[0]?.content?.parts[0]?.text;
            if (!text) {
                throw new Error('No text content in Vertex AI response');
            }

            console.log(`✅ Response received (${text.length} characters)`);
            
            // Step 4: Show the actual response content
            console.log('\n📄 ACTUAL RESPONSE CONTENT:');
            console.log('='.repeat(80));
            console.log(text);
            console.log('='.repeat(80));
            
            // Step 5: Try to parse JSON
            console.log('\n🔍 Analyzing response...');
            let parsedResult = null;
            let parseError = null;
            
            try {
                parsedResult = JSON.parse(text);
                console.log('✅ JSON parsing successful!');
                
                // Show parsed structure
                console.log('\n📋 PARSED JSON STRUCTURE:');
                console.log(JSON.stringify(parsedResult, null, 2));
                
                // Analyze the parsed result
                if (parsedResult.leads && Array.isArray(parsedResult.leads)) {
                    const leadResult = parsedResult.leads[0];
                    if (leadResult) {
                        console.log(`\n📊 LEAD SCORING RESULTS:`);
                        console.log(`   Score: ${leadResult.score || 'N/A'}`);
                        console.log(`   Status: ${leadResult.scoring_status || 'N/A'}`);
                        console.log(`   Reason: ${leadResult.reason || 'N/A'}`);
                        
                        if (leadResult.attributes) {
                            const attrCount = Object.keys(leadResult.attributes).length;
                            console.log(`🎯 Attributes evaluated: ${attrCount}`);
                        }
                    }
                } else {
                    console.log('⚠️  Unexpected response structure');
                }
                
            } catch (jsonError) {
                parseError = jsonError;
                console.log('❌ JSON parsing failed:', jsonError.message);
                
                // Show response sample for debugging
                console.log('\n📄 Response sample (first 500 chars):');
                console.log(text.substring(0, 500));
                console.log('...');
                
                console.log('\n📄 Response sample (last 500 chars):');
                console.log('...');
                console.log(text.substring(Math.max(0, text.length - 500)));
                
                // Check if response was truncated
                if (finishReason === 'MAX_TOKENS') {
                    console.log('🚨 Response was TRUNCATED due to token limit!');
                } else if (text.length > 0 && !text.trim().endsWith('}')) {
                    console.log('🚨 Response appears to be INCOMPLETE (no closing brace)');
                }
            }
            
            const duration = Date.now() - startTime;
            console.log(`\n⏱️  Total test duration: ${duration}ms`);
            
            return {
                success: parsedResult !== null,
                finishReason: finishReason,
                responseLength: text.length,
                duration: duration,
                parseError: parseError,
                result: parsedResult
            };
            
        } catch (error) {
            const duration = Date.now() - startTime;
            console.error(`❌ Test failed after ${duration}ms:`, error.message);
            
            return {
                success: false,
                error: error.message,
                duration: duration
            };
        }
    }

    async runComparison() {
        try {
            await this.initializeAirtable();
            await this.initializeVertexAI();
            
            console.log('\n' + '='.repeat(80));
            console.log('🎯 16K TOKEN TEST FOR FAILING LEAD');
            console.log('='.repeat(80));
            
            // Get the specific failing lead
            const lead = await this.getSpecificLead('recHkqPSMfdQWyqus');
            
            // Test with different token limits
            const tokenLimits = [4096, 8192, 16384];
            const results = [];
            
            for (const tokens of tokenLimits) {
                console.log('\n' + '-'.repeat(80));
                const result = await this.testLeadWithTokens(lead, tokens);
                results.push({ tokens, ...result });
                
                // Add delay between tests
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
            
            // Summary
            console.log('\n' + '='.repeat(80));
            console.log('📊 COMPARISON SUMMARY');
            console.log('='.repeat(80));
            
            results.forEach(result => {
                const status = result.success ? '✅ SUCCESS' : '❌ FAILED';
                const reason = result.finishReason ? ` (${result.finishReason})` : '';
                const responseSize = result.responseLength ? ` - ${result.responseLength} chars` : '';
                
                console.log(`${result.tokens} tokens: ${status}${reason}${responseSize}`);
                
                if (!result.success && result.error) {
                    console.log(`   Error: ${result.error}`);
                }
                if (result.parseError) {
                    console.log(`   Parse Error: ${result.parseError.message}`);
                }
            });
            
            // Analysis
            console.log('\n🎯 ANALYSIS:');
            const successfulTests = results.filter(r => r.success);
            const failedTests = results.filter(r => !r.success);
            
            if (successfulTests.length > 0) {
                const minSuccessTokens = Math.min(...successfulTests.map(r => r.tokens));
                console.log(`✅ Minimum tokens needed for success: ${minSuccessTokens}`);
                
                if (minSuccessTokens > 4096) {
                    console.log(`🎯 RECOMMENDATION: Increase production maxOutputTokens from 4096 to ${minSuccessTokens}`);
                }
            } else {
                console.log('❌ No tests succeeded - may need even higher token limits or different approach');
            }
            
            if (failedTests.some(r => r.finishReason === 'MAX_TOKENS')) {
                console.log('🚨 Some failures due to MAX_TOKENS - response truncation confirmed');
            }
            
        } catch (error) {
            console.error('❌ Test suite failed:', error.message);
        }
    }
}

// Run the test
const test = new TokenTest();
test.runComparison();
