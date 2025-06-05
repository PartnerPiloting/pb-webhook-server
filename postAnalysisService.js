// File: postAnalysisService.js

// --- We will require these other new modules once they are created ---
// const { buildPostScoringPrompt } = require('./postPromptBuilder');
// const { scorePostsWithGemini } = require('./postGeminiScorer');
// const { loadPostScoringAirtableConfig } = require('./postAttributeLoader');
// -----------------------------------------------------------------------

/**
 * (Internal helper function) Contains the common logic for analyzing and scoring
 * the posts for a single lead record.
 * @param {object} leadRecord - The full lead record object from Airtable.
 * @param {object} base - The initialized Airtable base instance.
 * @param {object} vertexAIClient - The initialized Vertex AI client.
 * @param {object} config - The postAnalysisConfig object from index.js.
 * @param {boolean} shouldUpdateAirtable - Flag to control if this function writes back to Airtable.
 * @returns {Promise<object>} A promise that resolves to a result object.
 */
async function analyzeAndScorePostsForLead(leadRecord, base, vertexAIClient, config) {
    const shouldUpdateAirtable = config.updateAirtableOnError; // Using this as a general flag for now
    console.log(`PostAnalysisService: Analyzing posts for lead: ${leadRecord.id}`);

    const postsContentField = leadRecord.fields[config.fields.postsContent];

    // --- Check 1: Ensure there is post content to analyze ---
    if (!postsContentField) {
        console.warn(`Lead ${leadRecord.id} has no '${config.fields.postsContent}' content. Skipping.`);
        if (shouldUpdateAirtable) {
            await base(config.leadsTableName).update(leadRecord.id, {
                [config.fields.relevanceScore]: 0,
                [config.fields.aiEvaluation]: "No post content found to analyze.",
                [config.fields.dateScored]: new Date().toISOString()
            });
        }
        return { status: "No post content", score: 0, leadId: leadRecord.id };
    }

    // --- Check 2: Parse the post content ---
    let parsedPostsArray;
    try {
        parsedPostsArray = JSON.parse(postsContentField);
        if (!Array.isArray(parsedPostsArray) || parsedPostsArray.length === 0) throw new Error("Content is not a non-empty array.");
    } catch (parseError) {
        console.error(`Lead ${leadRecord.id}: Failed to parse '${config.fields.postsContent}' JSON. Error: ${parseError.message}`);
        if (shouldUpdateAirtable) {
            await base(config.leadsTableName).update(leadRecord.id, {
                [config.fields.aiEvaluation]: `Error parsing Posts Content: ${parseError.message}`,
                [config.fields.dateScored]: new Date().toISOString()
            });
        }
        return { status: "Posts Content parsing error", error: parseError.message, leadId: leadRecord.id };
    }

    // --- Check 3: Initial AI Keyword Scan ---
    // (This part will eventually use keywords loaded from Airtable)
    const keywordsFromAirtable = []; // MOCK: This will be replaced by a call to postAttributeLoader
    const aiKeywords = keywordsFromAirtable.length > 0 ? keywordsFromAirtable : config.aiKeywords; // Use fallback from config
    let aiKeywordsFound = false;
    for (const post of parsedPostsArray) {
        if (post && post.postContent) {
            if (aiKeywords.some(keyword => post.postContent.toLowerCase().includes(keyword.toLowerCase()))) {
                aiKeywordsFound = true;
                break;
            }
        }
    }

    // --- Handle if no keywords are found ---
    if (!aiKeywordsFound) {
        console.log(`Lead ${leadRecord.id}: No AI keywords found in posts.`);
        if (config.updateAirtableOnNoKeywords) {
            await base(config.leadsTableName).update(leadRecord.id, {
                [config.fields.relevanceScore]: 0,
                [config.fields.aiEvaluation]: `No relevant AI keywords detected.`,
                [config.fields.dateScored]: new Date().toISOString()
            });
        }
        return { status: "No AI keywords found", score: 0, leadId: leadRecord.id };
    }

    // --- If keywords are found, proceed with full AI scoring ---
    console.log(`Lead ${leadRecord.id}: AI keywords found. Proceeding with Gemini scoring.`);
    try {
        // --- MOCK AI CALL for now ---
        // In the future, these lines will call our other new modules:
        // const systemPrompt = await buildPostScoringPrompt(base, config);
        // const aiResponseJson = await scorePostsWithGemini(parsedPostsArray, systemPrompt, vertexAIClient, config);
        console.log(`   (MOCK) Building prompt for lead ${leadRecord.id}`);
        console.log(`   (MOCK) Calling Gemini for lead ${leadRecord.id}`);
        const aiResponseJson = { // A mock response structure for testing
            overall_post_score: Math.floor(Math.random() * 81) + 20, // Random score from 20 to 100
            post_analysis: [{
                post_id: parsedPostsArray[0]?.postUrl || "N/A",
                post_content_preview: (parsedPostsArray[0]?.postContent || "").substring(0, 100) + "...",
                post_score: Math.floor(Math.random() * 81) + 20,
                scores_breakdown: { MOCK_SENTIMENT: 15, MOCK_BUSINESS_VALUE: 18 },
                scoring_rationale: "This is a MOCK rationale from the AI, indicating a positive analysis."
            }],
            general_errors: []
        };
        // --- END MOCK AI CALL ---

        // Update Airtable with the results from the AI
        if (shouldUpdateAirtable) {
            await base(config.leadsTableName).update(leadRecord.id, {
                [config.fields.relevanceScore]: aiResponseJson.overall_post_score,
                [config.fields.aiEvaluation]: JSON.stringify(aiResponseJson, null, 2), // Store pretty-printed JSON
                [config.fields.summarisedByAI]: aiResponseJson.post_analysis[0]?.scoring_rationale || "N/A",
                [config.fields.dateScored]: new Date().toISOString()
            });
        }
        console.log(`Lead ${leadRecord.id}: Successfully scored. Score: ${aiResponseJson.overall_post_score}`);
        return { status: "Successfully scored", leadId: leadRecord.id, ...aiResponseJson };

    } catch (error) {
        console.error(`Lead ${leadRecord.id}: Error during AI scoring process. Error: ${error.message}`, error.stack);
        if (shouldUpdateAirtable) {
            await base(config.leadsTableName).update(leadRecord.id, {
                [config.fields.aiEvaluation]: `ERROR during AI post scoring: ${error.message}`,
                [config.fields.dateScored]: new Date().toISOString()
            });
        }
        return { status: "Error during AI scoring", error: error.message, leadId: leadRecord.id };
    }
}

/**
 * Processes posts for all leads in Airtable that haven't been scored yet.
 * Intended to be run as a background batch job.
 */
async function processAllPendingLeadPosts(base, vertexAIClient, config) {
    console.log("PostAnalysisService: processAllPendingLeadPosts - Called (Background task)");
    let processedCount = 0;
    let errorCount = 0;

    try {
        const recordsToProcess = await base(config.leadsTableName).select({
            filterByFormula: `AND({${config.fields.dateScored}} = BLANK(), {${config.fields.postsContent}} != BLANK())`,
            fields: [config.fields.postsContent] // Only fetch necessary fields
        }).all();

        console.log(`Found ${recordsToProcess.length} leads to process for post scoring.`);

        for (const leadRecord of recordsToProcess) {
            try {
                await analyzeAndScorePostsForLead(leadRecord, base, vertexAIClient, config);
                processedCount++;
            } catch (leadProcessingError) {
                console.error(`Error processing lead ${leadRecord.id} in main loop. The error should have been logged and handled by analyzeAndScorePostsForLead. Continuing. Error: ${leadProcessingError.message}`);
                errorCount++;
            }
        }
    } catch (error) {
        console.error(`Major error in processAllPendingLeadPosts (e.g., fetching records from Airtable): ${error.message}`, error.stack);
    }
    console.log(`PostAnalysisService: processAllPendingLeadPosts - Finished. Processed: ${processedCount}, Errors: ${errorCount}.`);
}

/**
 * Fetches a specific lead by its Airtable Record ID, analyzes its posts,
 * and returns the scoring outcome.
 */
async function scoreSpecificLeadPosts(leadId, base, vertexAIClient, config, options = { updateAirtable: true }) {
    console.log(`PostAnalysisService: scoreSpecificLeadPosts - Called for leadId: ${leadId}`);
    try {
        // In Airtable, you fetch a single record directly by its ID like this:
        const leadRecord = await base(config.leadsTableName).find(leadId);

        if (!leadRecord) {
            const notFoundMsg = `Lead with ID ${leadId} not found.`;
            console.error(notFoundMsg);
            return { status: "Lead not found", error: notFoundMsg, leadId: leadId };
        }
        // This function doesn't exist yet but we are creating the structure now
        return await analyzeAndScorePostsForLead(leadRecord, base, vertexAIClient, config);

    } catch (error) {
        console.error(`Error in scoreSpecificLeadPosts for lead ${leadId}: ${error.message}`, error.stack);
        // This catch block handles errors like the leadId not being found by .find()
        if (error.statusCode === 404) {
             return { status: "Lead not found", error: error.message, leadId: leadId };
        }
        return { status: "Error scoring specific lead", error: error.message, leadId: leadId };
    }
}

// Export the two main functions that will be called from outside this module
module.exports = {
    processAllPendingLeadPosts,
    scoreSpecificLeadPosts
};