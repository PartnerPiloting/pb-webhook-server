// File: postAnalysisService.js (Final Version)

// --- Require our newly defined helper modules ---
const { loadPostScoringAirtableConfig } = require('./postAttributeLoader');
const { buildPostScoringPrompt } = require('./postPromptBuilder');
const { scorePostsWithGemini } = require('./postGeminiScorer');
// ------------------------------------------------

/**
 * (Internal helper function) Contains the common logic for analyzing and scoring
 * the posts for a single lead record.
 */
async function analyzeAndScorePostsForLead(leadRecord, base, vertexAIClient, config) {
    console.log(`PostAnalysisService: Analyzing posts for lead: ${leadRecord.id}`);

    const postsContentField = leadRecord.fields[config.fields.postsContent];

    // --- Check 1: Ensure there is post content to analyze ---
    if (!postsContentField) {
        // ... (error handling for no post content remains the same)
        console.warn(`Lead ${leadRecord.id} has no '${config.fields.postsContent}' content. Skipping.`);
        if (config.updateAirtableOnError) {
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
        // ... (error handling for JSON parsing remains the same)
        console.error(`Lead ${leadRecord.id}: Failed to parse '${config.fields.postsContent}' JSON. Error: ${parseError.message}`);
        if (config.updateAirtableOnError) {
            await base(config.leadsTableName).update(leadRecord.id, {
                [config.fields.aiEvaluation]: `Error parsing Posts Content: ${parseError.message}`,
                [config.fields.dateScored]: new Date().toISOString()
            });
        }
        return { status: "Posts Content parsing error", error: parseError.message, leadId: leadRecord.id };
    }

    try {
        // --- REAL IMPLEMENTATION Step 1: Load all dynamic configuration from Airtable ---
        console.log(`Lead ${leadRecord.id}: Loading config from Airtable...`);
        // This single call gets us the keywords, prompt components, and attributes.
        const airtableConfig = await loadPostScoringAirtableConfig(base, config);
        const aiKeywords = airtableConfig.aiKeywords || [];
        // ---------------------------------------------------------------------------------

        // --- Check 3: Initial AI Keyword Scan (using keywords from Airtable) ---
        const aiKeywordsFound = parsedPostsArray.some(post =>
            post && post.postContent && aiKeywords.some(keyword => post.postContent.toLowerCase().includes(keyword.toLowerCase()))
        );

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

        // --- REAL IMPLEMENTATION Step 2: Build the full system prompt ---
        console.log(`Lead ${leadRecord.id}: Building system prompt...`);
        const systemPrompt = await buildPostScoringPrompt(base, config); // The 'config' object has the table names needed by the loader
        // ----------------------------------------------------------------

        // --- REAL IMPLEMENTATION Step 3: Configure the Gemini Model & Call the Scorer ---
        console.log(`Lead ${leadRecord.id}: Configuring Gemini model instance...`);
        const geminiModelId = config.geminiModelIdForPosts; // Using the model ID from our config
        const configuredGeminiModel = vertexAIClient.getGenerativeModel({
            model: geminiModelId,
            systemInstruction: { parts: [{ text: systemPrompt }] },
            safetySettings: [ // Replicating safety settings from your singleScorer.js
                { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
                { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
                { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
                { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
            ],
            generationConfig: {
                temperature: 0,
                responseMimeType: "application/json",
            }
        });

        console.log(`Lead ${leadRecord.id}: Calling Gemini scorer...`);
        const aiResponseJson = await scorePostsWithGemini(parsedPostsArray, configuredGeminiModel);
        // --------------------------------------------------------------------------------

        // Update Airtable with the real results from the AI
        await base(config.leadsTableName).update(leadRecord.id, {
            [config.fields.relevanceScore]: aiResponseJson.overall_post_score,
            [config.fields.aiEvaluation]: JSON.stringify(aiResponseJson, null, 2),
            [config.fields.summarisedByAI]: aiResponseJson.post_analysis[0]?.scoring_rationale || "N/A",
            [config.fields.dateScored]: new Date().toISOString()
        });

        console.log(`Lead ${leadRecord.id}: Successfully scored. Score: ${aiResponseJson.overall_post_score}`);
        return { status: "Successfully scored", leadId: leadRecord.id, ...aiResponseJson };

    } catch (error) {
        console.error(`Lead ${leadRecord.id}: Error during AI scoring process. Error: ${error.message}`, error.stack);
        // This is our main catch-all for errors during the keyword check, prompt building, or Gemini call.
        if (config.updateAirtableOnError) {
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
 * (This function's logic does not need to change from our previous version).
 */
async function processAllPendingLeadPosts(base, vertexAIClient, config) {
    console.log("PostAnalysisService: processAllPendingLeadPosts - Called (Background task)");
    let processedCount = 0;
    let errorCount = 0;

    try {
        const recordsToProcess = await base(config.leadsTableName).select({
            filterByFormula: `AND({${config.fields.dateScored}} = BLANK(), {${config.fields.postsContent}} != BLANK())`,
            fields: [config.fields.postsContent]
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
 * (This function's logic does not need to change from our previous version).
 */
async function scoreSpecificLeadPosts(leadId, base, vertexAIClient, config, options = { updateAirtable: true }) {
    console.log(`PostAnalysisService: scoreSpecificLeadPosts - Called for leadId: ${leadId}`);
    try {
        const leadRecord = await base(config.leadsTableName).find(leadId);

        if (!leadRecord) {
            const notFoundMsg = `Lead with ID ${leadId} not found.`;
            console.error(notFoundMsg);
            return { status: "Lead not found", error: notFoundMsg, leadId: leadId };
        }

        // We are creating a temporary config to pass the updateAirtable option down
        // to the core processing function.
        const tempConfig = { ...config, updateAirtableOnError: options.updateAirtable, updateAirtableOnNoKeywords: options.updateAirtable };
        
        return await analyzeAndScorePostsForLead(leadRecord, base, vertexAIClient, tempConfig);

    } catch (error) {
        console.error(`Error in scoreSpecificLeadPosts for lead ${leadId}: ${error.message}`, error.stack);
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