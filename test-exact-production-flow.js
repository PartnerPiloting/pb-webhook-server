// Test the EXACT production flow using the actual singleScorer.js
// This will call the same functions that production uses

require('dotenv').config();
const Airtable = require('airtable');
const { VertexAI } = require('@google-cloud/vertexai');
const { scoreLeadNow } = require('./singleScorer'); // Import the actual production function

class ExactProductionTest {
    constructor() {
        this.base = null;
        this.vertexAI = null;
    }

    async initialize() {
        try {
            console.log('🔧 Initializing EXACT production dependencies...');
            
            // Initialize Airtable exactly like production
            const airtableApiKey = process.env.AIRTABLE_API_KEY;
            const baseId = process.env.AIRTABLE_BASE_ID;
            
            if (!airtableApiKey || !baseId) {
                throw new Error('Missing Airtable credentials');
            }

            Airtable.configure({ apiKey: airtableApiKey });
            this.base = Airtable.base(baseId);
            
            // Initialize Vertex AI exactly like production
            const projectId = process.env.GCP_PROJECT_ID;
            const location = process.env.GCP_LOCATION;
            const geminiModelId = process.env.GEMINI_MODEL_ID || 'gemini-2.5-flash';
            
            if (!projectId || !location) {
                throw new Error('Missing GCP credentials');
            }

            this.vertexAI = new VertexAI({
                project: projectId,
                location: location
            });
            
            this.dependencies = {
                vertexAIClient: this.vertexAI,
                geminiModelId: geminiModelId
            };
            
            console.log('✅ Production dependencies initialized');
            console.log(`   Model: ${geminiModelId}`);
            console.log(`   Project: ${projectId}`);
            console.log(`   Location: ${location}`);
            
            return true;
        } catch (error) {
            console.error('❌ Failed to initialize:', error.message);
            throw error;
        }
    }

    async getFailingLead() {
        try {
            console.log('🔍 Fetching the exact failing lead: recHkqPSMfdQWyqus...');
            
            const record = await this.base('Leads').find('recHkqPSMfdQWyqus');
            const lead = record.fields;
            
            // Add the ID field that production expects
            lead.id = record.id;
            
            console.log(`✅ Found lead: ${lead['First Name']} ${lead['Last Name']} (${lead.Company})`);
            console.log(`   Email: ${lead.Email}`);
            console.log(`   Current Status: ${lead['Scoring Status']}`);
            console.log(`   Profile size: ${lead['Profile Full JSON'] ? lead['Profile Full JSON'].length : 0} characters`);
            
            return lead;
            
        } catch (error) {
            console.error('❌ Failed to fetch lead:', error.message);
            throw error;
        }
    }

    async testExactProductionScoring(lead, shouldUpdateAirtable = false) {
        const startTime = Date.now();
        
        try {
            console.log('\n🧪 TESTING EXACT PRODUCTION SCORING FLOW');
            console.log('='.repeat(80));
            console.log(`🎯 Lead: ${lead['First Name']} ${lead['Last Name']} (${lead.Company})`);
            console.log(`📧 Email: ${lead.Email}`);
            console.log(`📊 Profile size: ${lead['Profile Full JSON'] ? lead['Profile Full JSON'].length : 0} characters`);
            console.log(`🔧 Will update Airtable: ${shouldUpdateAirtable ? 'YES' : 'NO (test mode)'}`);
            
            // Call the EXACT same function that production calls
            console.log('\n🚀 Calling singleScorer.scoreLeadNow() - THE EXACT PRODUCTION FUNCTION...');
            
            const scoringResult = await scoreLeadNow(lead, this.dependencies);
            
            const endTime = Date.now();
            const duration = endTime - startTime;
            
            console.log(`✅ Production scoring succeeded in ${duration}ms!`);
            
            // Show the result
            console.log('\n📊 SCORING RESULT:');
            console.log('='.repeat(80));
            console.log(JSON.stringify(scoringResult, null, 2));
            console.log('='.repeat(80));
            
            // Validate the result structure
            if (scoringResult && typeof scoringResult === 'object') {
                console.log('\n✅ Result validation:');
                console.log(`   Has score: ${scoringResult.score !== undefined ? 'YES' : 'NO'}`);
                console.log(`   Has scoring_status: ${scoringResult.scoring_status !== undefined ? 'YES' : 'NO'}`);
                console.log(`   Has reason: ${scoringResult.reason !== undefined ? 'YES' : 'NO'}`);
                console.log(`   Has attributes: ${scoringResult.attributes !== undefined ? 'YES' : 'NO'}`);
                
                if (scoringResult.attributes) {
                    const attrCount = Object.keys(scoringResult.attributes).length;
                    console.log(`   Attributes count: ${attrCount}`);
                }
            } else {
                console.log('❌ Invalid result structure');
                return { success: false, error: 'Invalid result structure' };
            }
            
            // Optionally update Airtable to prove the full flow works
            if (shouldUpdateAirtable && scoringResult.score !== undefined) {
                console.log('\n🔄 Updating Airtable record...');
                
                try {
                    await this.base('Leads').update(lead.id, {
                        'Score': scoringResult.score,
                        'Scoring Status': 'Scored',
                        'Date Scored': new Date().toISOString()
                    });
                    
                    console.log('✅ Airtable record updated successfully!');
                    console.log('   The lead should now show "Scored" status in Airtable');
                    
                } catch (updateError) {
                    console.error('❌ Failed to update Airtable:', updateError.message);
                    return { 
                        success: false, 
                        error: `Scoring succeeded but Airtable update failed: ${updateError.message}`,
                        scoringResult: scoringResult
                    };
                }
            }
            
            return { 
                success: true, 
                duration: duration,
                scoringResult: scoringResult
            };
            
        } catch (error) {
            const endTime = Date.now();
            const duration = endTime - startTime;
            
            console.error(`❌ Production scoring failed after ${duration}ms:`, error.message);
            
            // Show additional error details if available
            if (error.finishReason) {
                console.error(`   Finish Reason: ${error.finishReason}`);
            }
            if (error.safetyRatings) {
                console.error(`   Safety Ratings: ${JSON.stringify(error.safetyRatings)}`);
            }
            if (error.rawResponseSnippet) {
                console.error(`   Response Snippet: ${error.rawResponseSnippet}`);
            }
            
            return { 
                success: false, 
                error: error.message,
                duration: duration,
                finishReason: error.finishReason,
                safetyRatings: error.safetyRatings
            };
        }
    }

    async runTest() {
        try {
            await this.initialize();
            const lead = await this.getFailingLead();
            
            console.log('\n' + '='.repeat(100));
            console.log('🎯 TESTING PHASE 1: Read-only test (no Airtable updates)');
            console.log('='.repeat(100));
            
            const testResult = await this.testExactProductionScoring(lead, false);
            
            console.log('\n' + '='.repeat(100));
            console.log('📊 TEST RESULTS SUMMARY');
            console.log('='.repeat(100));
            
            if (testResult.success) {
                console.log('✅ SUCCESS: The exact production code can score this lead!');
                console.log(`   Duration: ${testResult.duration}ms`);
                console.log(`   Score: ${testResult.scoringResult?.score || 'N/A'}`);
                console.log(`   Status: ${testResult.scoringResult?.scoring_status || 'N/A'}`);
                
                // Ask if we should update Airtable
                console.log('\n🤔 NEXT STEP OPTIONS:');
                console.log('   1. This proves the production code CAN work');
                console.log('   2. The issue is likely production environment constraints');
                console.log('   3. To fully prove the flow, run again with Airtable updates');
                console.log('\n💡 To test full flow including Airtable update:');
                console.log('   - Uncomment the line in runTest() that calls with shouldUpdateAirtable=true');
                
            } else {
                console.log('❌ FAILURE: The production code failed even locally!');
                console.log(`   Duration: ${testResult.duration}ms`);
                console.log(`   Error: ${testResult.error}`);
                
                if (testResult.finishReason) {
                    console.log(`   Finish Reason: ${testResult.finishReason}`);
                }
                
                console.log('\n🔍 This suggests the issue might be in the production code itself');
            }
            
            // Uncomment this line to test the full flow including Airtable updates
            // WARNING: This will actually update the Airtable record!
            // const fullFlowResult = await this.testExactProductionScoring(lead, true);
            
        } catch (error) {
            console.error('❌ Test suite failed:', error.message);
        }
    }
}

// Run the test
console.log('🔬 EXACT PRODUCTION FLOW TEST');
console.log('This uses the same singleScorer.js function that production uses');
console.log('If this works, the issue is definitely environment-related\n');

const test = new ExactProductionTest();
test.runTest();
