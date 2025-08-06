const fs = require('fs');
const path = require('path');
const Airtable = require('airtable');
const { VertexAI } = require('@google-cloud/vertexai');
const { StructuredLogger } = require('./utils/structuredLogger');
const { buildPrompt, slimLead } = require('./promptBuilder');

// Load environment variables
require('dotenv').config();

class FailedLeadsDiagnostic {
    constructor() {
        this.logger = new StructuredLogger('FailedLeadsDiagnostic');
        this.base = null;
        this.vertex = null;
        
        this.results = {
            processed: 0,
            successful: 0,
            failed: 0,
            errors: [],
            successfulLeads: [],
            failedLeads: []
        };
        
        this.testLogsDir = path.join(__dirname, 'test-logs');
        if (!fs.existsSync(this.testLogsDir)) {
            fs.mkdirSync(this.testLogsDir, { recursive: true });
        }
    }

    async initializeAirtable() {
        try {
            console.log('��� Initializing Airtable connection for Guy-Wilson...');
            
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
            console.log('��� Initializing Vertex AI...');
            
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

    async findUnprocessedLeads() {
        try {
            console.log('🔍 Searching for leads with "To Be Scored" status...');
            
            const leads = [];
            
            await this.base('Leads').select({
                filterByFormula: '{Scoring Status} = "To Be Scored"',
                maxRecords: 50,
                sort: [{ field: 'First Name', direction: 'desc' }]
            }).eachPage((records, fetchNextPage) => {
                records.forEach(record => {
                    const fields = record.fields;
                    leads.push({
                        id: record.id,
                        email: fields.Email,
                        company: fields.Company,
                        firstName: fields['First Name'],
                        lastName: fields['Last Name'],
                        scoringStatus: fields['Scoring Status'],
                        processed: fields.Processed,
                        score: fields.Score
                    });
                });
                fetchNextPage();
            });
            
            console.log("📊 Found " + leads.length + " leads with 'To Be Scored' status");
            return leads;
            
        } catch (error) {
            console.error('❌ Failed to find unprocessed leads:', error.message);
            throw error;
        }
    }

    async testLeadScoring(lead) {
        const startTime = Date.now();
        
        try {
            console.log(`🧪 Testing lead: ${lead.email || 'No email'} (${lead.company || 'No company'})`);
            
            // Step 1: Build prompt using same method as production
            const systemPromptInstructions = await buildPrompt();
            const slimmedLead = slimLead(lead);
            const leadsDataForUserPrompt = JSON.stringify({ leads: [slimmedLead] });
            const fullPrompt = `Score the following 1 leads based on the criteria and JSON schema defined in the system instructions. The leads are: ${leadsDataForUserPrompt}`;
            
            if (!fullPrompt || fullPrompt.length === 0) {
                throw new Error('Prompt builder returned empty prompt');
            }
            
            console.log(`   📝 Prompt built successfully (${fullPrompt.length} characters)`);
            
            // Step 2: Get Vertex AI model
            const model = this.vertex.getGenerativeModel({
                model: 'gemini-1.5-flash-002'
            });
            
            // Step 3: Make the scoring request with same config as production
            const aiResult = await model.generateContent({
                contents: [
                    { role: 'system', parts: [{ text: systemPromptInstructions }] },
                    { role: 'user', parts: [{ text: fullPrompt }] }
                ],
                generationConfig: {
                    maxOutputTokens: 8192,
                    temperature: 0.1,
                    topK: 40,
                    topP: 0.8
                }
            });

            const response = aiResult.response;
            if (!response) {
                throw new Error('No response from Vertex AI');
            }

            const text = response.candidates[0]?.content?.parts[0]?.text;
            if (!text) {
                throw new Error('No text content in Vertex AI response');
            }

            console.log(`   🤖 AI response received (${text.length} characters)`);
            
            // Step 4: Parse JSON response (this is where many failures occur)
            let scoreData;
            try {
                scoreData = JSON.parse(text.trim());
            } catch (parseError) {
                throw new Error(`JSON parsing failed: ${parseError.message}. Raw response: ${text.substring(0, 200)}...`);
            }
            
            console.log(`   ✅ JSON parsed successfully - Score: ${scoreData.score || 'Unknown'}`);
            
            const processingTime = Date.now() - startTime;
            
            const result = {
                leadId: lead.id,
                email: lead.email,
                company: lead.company,
                status: 'SUCCESS',
                scoreData: scoreData,
                processingTime: processingTime,
                error: null,
                errorCategory: null,
                promptLength: fullPrompt.length,
                responseLength: text.length
            };
            
            this.results.successful++;
            this.results.successfulLeads.push(result);
            
            console.log(`   ✅ Lead scored successfully in ${processingTime}ms`);
            return result;
            
        } catch (error) {
            const processingTime = Date.now() - startTime;
            const errorCategory = this.categorizeError(error);
            
            const result = {
                leadId: lead.id,
                email: lead.email,
                company: lead.company,
                status: 'FAILED',
                scoreData: null,
                processingTime: processingTime,
                error: error.message,
                errorCategory: errorCategory,
                promptLength: null,
                responseLength: null
            };
            
            this.results.failed++;
            this.results.failedLeads.push(result);
            this.results.errors.push({
                leadId: lead.id,
                email: lead.email,
                error: error.message,
                category: errorCategory,
                timestamp: new Date().toISOString()
            });
            
            console.log(`   ❌ Lead failed: ${error.message} (${errorCategory})`);
            return result;
        }
    }

    /**
     * Categorize error types for analysis
     */
    categorizeError(error) {
        const errorMessage = error.message.toLowerCase();
        
        if (errorMessage.includes('vertex ai') || errorMessage.includes('gemini')) {
            return 'VERTEX_AI_ERROR';
        } else if (errorMessage.includes('json') || errorMessage.includes('parse')) {
            return 'JSON_PARSE_ERROR';
        } else if (errorMessage.includes('prompt') || errorMessage.includes('build')) {
            return 'PROMPT_BUILD_ERROR';
        } else if (errorMessage.includes('timeout') || errorMessage.includes('network')) {
            return 'NETWORK_ERROR';
        } else if (errorMessage.includes('credential') || errorMessage.includes('auth')) {
            return 'AUTH_ERROR';
        } else if (errorMessage.includes('quota') || errorMessage.includes('limit')) {
            return 'QUOTA_ERROR';
        } else if (errorMessage.includes('no response') || errorMessage.includes('no text content')) {
            return 'EMPTY_RESPONSE_ERROR';
        } else {
            return 'UNKNOWN_ERROR';
        }
    }

    /**
     * Save comprehensive test results
     */
    async saveResults(testResults) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        
        try {
            // Save detailed results as JSON
            const detailedResults = {
                metadata: {
                    testDate: new Date().toISOString(),
                    purpose: 'Phase 2 Failed Leads Root Cause Analysis',
                    totalLeads: testResults.length,
                    clientId: 'Guy-Wilson'
                },
                summary: this.results,
                detailedResults: testResults,
                errorAnalysis: this.analyzeErrors()
            };
            
            const resultsFile = path.join(this.testLogsDir, `lead-failure-analysis-${timestamp}.json`);
            fs.writeFileSync(resultsFile, JSON.stringify(detailedResults, null, 2));
            
            // Save CSV summary for quick analysis
            const csvLines = [
                'Lead ID,Email,Company,Status,Error Category,Processing Time,Error Message,Prompt Length,Response Length'
            ];
            
            testResults.forEach(result => {
                const errorMsg = result.error ? result.error.replace(/"/g, '""') : '';
                csvLines.push([
                    result.leadId,
                    result.email || '',
                    result.company || '',
                    result.status,
                    result.errorCategory || '',
                    result.processingTime,
                    `"${errorMsg}"`,
                    result.promptLength || '',
                    result.responseLength || ''
                ].join(','));
            });
            
            const csvFile = path.join(this.testLogsDir, `lead-failure-summary-${timestamp}.csv`);
            fs.writeFileSync(csvFile, csvLines.join('\n'));
            
            // Generate action plan based on errors
            const actionPlan = this.generateActionPlan();
            const actionPlanFile = path.join(this.testLogsDir, `action-plan-${timestamp}.md`);
            fs.writeFileSync(actionPlanFile, actionPlan);
            
            console.log(`📁 Results saved to:`);
            console.log(`   Detailed Analysis: ${resultsFile}`);
            console.log(`   CSV Summary: ${csvFile}`);
            console.log(`   Action Plan: ${actionPlanFile}`);
            
            return {
                detailedAnalysis: resultsFile,
                csvSummary: csvFile,
                actionPlan: actionPlanFile
            };
            
        } catch (error) {
            console.error('❌ Failed to save results:', error.message);
            throw error;
        }
    }

    /**
     * Analyze error patterns to identify root causes
     */
    analyzeErrors() {
        const errorCounts = {};
        const errorDetails = {};
        
        this.results.errors.forEach(err => {
            errorCounts[err.category] = (errorCounts[err.category] || 0) + 1;
            
            if (!errorDetails[err.category]) {
                errorDetails[err.category] = [];
            }
            errorDetails[err.category].push({
                leadId: err.leadId,
                email: err.email,
                error: err.error,
                timestamp: err.timestamp
            });
        });
        
        return {
            errorCounts,
            errorDetails,
            mostCommonError: Object.entries(errorCounts).sort((a, b) => b[1] - a[1])[0]
        };
    }

    /**
     * Generate action plan based on error analysis
     */
    generateActionPlan() {
        const analysis = this.analyzeErrors();
        
        let plan = `# Lead Scoring Failure Analysis & Action Plan
Generated: ${new Date().toISOString()}
Client: Guy-Wilson
Total Failed Leads: ${this.results.failed}
Total Successful Leads: ${this.results.successful}

## Error Summary
`;
        
        Object.entries(analysis.errorCounts).forEach(([category, count]) => {
            plan += `- **${category}**: ${count} failures
`;
        });
        
        plan += `
## Most Common Issue
Primary Error Type: **${analysis.mostCommonError ? analysis.mostCommonError[0] : 'None'}** (${analysis.mostCommonError ? analysis.mostCommonError[1] : 0} occurrences)

## Detailed Error Analysis
`;
        
        Object.entries(analysis.errorDetails).forEach(([category, errors]) => {
            plan += `
### ${category} (${errors.length} errors)
`;
            errors.slice(0, 3).forEach(error => {
                plan += `- Lead ${error.leadId} (${error.email}): ${error.error}
`;
            });
            if (errors.length > 3) {
                plan += `- ... and ${errors.length - 3} more similar errors
`;
            }
        });
        
        plan += `
## Recommended Actions

### Immediate Actions (High Priority)
`;
        
        if (analysis.errorCounts['JSON_PARSE_ERROR']) {
            plan += `1. **Fix JSON Response Issues**: ${analysis.errorCounts['JSON_PARSE_ERROR']} leads failing due to malformed AI responses
   - Review prompt templates for JSON format instructions
   - Add response validation before parsing
   - Implement retry logic for malformed responses

`;
        }
        
        if (analysis.errorCounts['PROMPT_BUILD_ERROR']) {
            plan += `2. **Fix Prompt Building**: ${analysis.errorCounts['PROMPT_BUILD_ERROR']} leads failing during prompt construction
   - Check lead data quality (missing fields, invalid data)
   - Validate prompt builder input handling
   - Add fallback for incomplete lead data

`;
        }
        
        if (analysis.errorCounts['VERTEX_AI_ERROR']) {
            plan += `3. **Address Vertex AI Issues**: ${analysis.errorCounts['VERTEX_AI_ERROR']} leads failing at AI level
   - Check rate limits and quotas
   - Validate model configuration
   - Implement exponential backoff retry

`;
        }
        
        plan += `### Production Enhancements (Medium Priority)
1. **Enhanced Error Logging**: Update batchScorer.js to capture individual lead error details
2. **Automatic Retry Logic**: Implement smart retry for recoverable errors
3. **Data Validation**: Add pre-scoring validation to catch data issues early
4. **Monitoring Alerts**: Set up alerts for specific error patterns

### Next Steps
1. Run this diagnostic again after implementing fixes
2. Monitor production batch jobs for error pattern changes
3. Update error categorization based on new patterns discovered
`;
        
        return plan;
    }

    async run() {
        console.log('🚀 Starting Phase 2 Failed Leads Root Cause Analysis');
        console.log('====================================================');
        
        try {
            await this.initializeAirtable();
            await this.initializeVertexAI();
            
            const leads = await this.findUnprocessedLeads();
            if (leads.length === 0) {
                console.log('✨ No unprocessed leads found - system appears healthy!');
                return;
            }
            
            console.log(`
🧪 Found ${leads.length} leads to test - Starting individual scoring tests...`);
            console.log('=' + '='.repeat(80));
            
            const testResults = [];
            
            for (let i = 0; i < leads.length; i++) {
                const lead = leads[i];
                console.log(`
[${i + 1}/${leads.length}] Testing Lead ID: ${lead.id}`);
                console.log('─'.repeat(60));
                
                const result = await this.testLeadScoring(lead);
                testResults.push(result);
                this.results.processed++;
                
                // Brief pause between requests to avoid rate limits
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
            
            // Generate comprehensive results
            console.log('' + '='.repeat(80));
            console.log('📊 PHASE 2 ANALYSIS COMPLETE');
            console.log('='.repeat(80));
            
            console.log(`
📈 Final Results Summary:`);
            console.log(`   Total Leads Tested: ${this.results.processed}`);
            console.log(`   ✅ Successful: ${this.results.successful}`);
            console.log(`   ❌ Failed: ${this.results.failed}`);
            console.log(`   📊 Success Rate: ${((this.results.successful / this.results.processed) * 100).toFixed(1)}%`);
            
            if (this.results.failed > 0) {
                console.log(`
🚨 ERROR PATTERN ANALYSIS:`);
                const errorCounts = {};
                this.results.errors.forEach(err => {
                    errorCounts[err.category] = (errorCounts[err.category] || 0) + 1;
                });
                
                Object.entries(errorCounts).sort((a, b) => b[1] - a[1]).forEach(([category, count]) => {
                    const percentage = ((count / this.results.failed) * 100).toFixed(1);
                    console.log(`   🔴 ${category}: ${count} errors (${percentage}%)`);
                });
                
                console.log(`
🎯 ROOT CAUSE IDENTIFIED:`);
                const topError = Object.entries(errorCounts).sort((a, b) => b[1] - a[1])[0];
                console.log(`   Primary Issue: ${topError[0]} (${topError[1]} out of ${this.results.failed} failures)`);
                
                // Show specific examples
                const examples = this.results.errors.filter(err => err.category === topError[0]).slice(0, 2);
                console.log(`
📝 Example Errors:`);
                examples.forEach((example, index) => {
                    console.log(`   ${index + 1}. Lead ${example.leadId}: ${example.error}`);
                });
            }
            
            const savedFiles = await this.saveResults(testResults);
            
            console.log(`
✅ Phase 2 analysis completed successfully!`);
            console.log(`📋 Check the action plan for next steps: ${savedFiles.actionPlan}`);
            
            return testResults;
            
        } catch (error) {
            console.error('❌ Phase 2 analysis failed:', error.message);
            throw error;
        }
    }
}

if (require.main === module) {
    const diagnostic = new FailedLeadsDiagnostic();
    diagnostic.run().catch(error => {
        console.error('��� Fatal error:', error.message);
        process.exit(1);
    });
}

module.exports = FailedLeadsDiagnostic;
