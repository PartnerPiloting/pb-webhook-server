// test_single_scorer.js
require("dotenv").config();
// Correctly import the initialized client and model ID
const { vertexAIClient, geminiModelId } = require('./config/geminiClient'); 
const { getAirtableRecord } = require('./utils/airtableUtils'); 
const { scoreLeadNow } = require('./singleScorer');
const { createLogger } = require('./utils/unifiedLoggerFactory');

const logger = createLogger('SYSTEM', null, 'TEST-SINGLE-SCORER');

async function testSingleLeadScoring() {
    const leadId = process.argv[2] || 'recHkqPSMfdQWyqus'; // Default to the problematic lead
    logger.info( `Starting test for lead ID: ${leadId}`);

    try {
        // 1. Check if Gemini Client is initialized
        logger.info( 'Checking for VertexAI client...');
        if (!vertexAIClient || !geminiModelId) {
            logger.error('testSingleLeadScoring', 'Failed to initialize VertexAI client or model from config.');
            return;
        }
        logger.summary('testSingleLeadScoring', 'VertexAI client loaded successfully from config.');

        const dependencies = {
            vertexAIClient,
            geminiModelId: geminiModelId // Pass the model ID string
        };

        // 2. Fetch the lead data from Airtable
        logger.info( `Fetching lead data for ${leadId} from Airtable...`);
        const leadData = await getAirtableRecord('Leads', leadId);
        if (!leadData) {
            logger.error('testSingleLeadScoring', `Could not fetch lead data for ${leadId}.`);
            return;
        }
        logger.summary('testSingleLeadScoring', 'Successfully fetched lead data.');
        // console.log("Lead Data:", JSON.stringify(leadData, null, 2));


        // 3. Call the single scorer function
        logger.debug( 'Calling scoreLeadNow function...');
        const result = await scoreLeadNow(leadData, dependencies, logger);

        // 4. Log the result
        logger.summary('testSingleLeadScoring', 'scoreLeadNow completed.');
        console.log('--- FINAL SCORING RESULT ---');
        console.log(JSON.stringify(result, null, 2));
        console.log('--------------------------');

    } catch (error) {
        logger.error('testSingleLeadScoring', `An error occurred during the test: ${error.message}`);
        console.error(error);
    }
}

testSingleLeadScoring();
