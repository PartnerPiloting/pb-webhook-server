// File: postAnalysisService.js (Final aggressive cleaning)

// Require our newly defined helper modules
const { loadPostScoringAirtableConfig } = require('./postAttributeLoader');
const { buildPostScoringPrompt } = require('./postPromptBuilder');
const { scorePostsWithGemini } = require('./postGeminiScorer');

/**
 * (Internal helper function) Contains the common logic for analyzing and scoring
 * the posts for a single lead record.
 */
async function analyzeAndScorePostsForLead(leadRecord, base, vertexAIClient, config) {
    console.log(`PostAnalysisService: Analyzing posts for lead: ${leadRecord.id}`);

    const postsContentField = leadRecord.fields[config.fields.postsContent];

    // Check 1: Ensure there is post content to analyze
    if (!postsContentField) {
        console.warn(`Lead ${leadRecord.id} has no '${config.fields.postsContent}' content. Skipping.`);
        await base(config.leadsTableName).update(leadRecord.id, {
            [config.fields.relevanceScore]: 0,
            [config.fields.aiEvaluation]: "No post content found to analyze.",
            [config.fields.dateScored]: new Date().toISOString()
        });
        return { status: "No post content", score: 0, leadId: leadRecord.id };
    }

    // Check 2: Parse the post content
    let parsedPostsArray;
    try {
        // FINAL ATTEMPT: Aggressively strip any character(s) from the start of the string that are not a '['
        const cleanedString = postsContentField.trim().replace(/^[^\[]*/, '');
        parsedPostsArray = JSON.parse(cleanedString);

        if (!Array.isArray(parsedPostsArray) || parsedPostsArray.length === 0) throw new Error("Content is not a non-empty array.");
    } catch (parseError) {
        console.error(`Lead ${leadRecord.id}: Failed to parse '${config.fields.postsContent}' JSON. Error: ${parseError.message}`);
        await base(config.leadsTableName).update(leadRecord.id, {
            [config.fields.aiEvaluation]: `Error parsing Posts Content: ${parseError.message}`,
            [config.fields.dateScored]: new Date().toISOString()
        });
        return { status: "Posts Content parsing error", error: parseError.message, leadId: leadRecord.id };
    }

    try {
        // Step 1: Load all dynamic configuration from Airtable (including keywords)
        console.log(`Lead ${leadRecord.id}: Loading config from Airtable...`);
        const { aiKeywords } = await loadPostScoringAirtableConfig(base, config);

        // Step 2: Filter for all posts containing AI keywords
        console.log(`Lead ${leadRecord.id}: Scanning ${parsedPostsArray.length} posts for AI keywords...`);
        const relevantPosts = parsedPostsArray.filter(post =>
            post && post.postContent && aiKeywords.some(keyword => post.postContent.toLowerCase().includes(keyword.toLowerCase()))
        );

        if (relevantPosts.length === 0) {
            console.log(`Lead ${leadRecord.id}: No relevant posts with AI keywords found.`);
            await base(config.leadsTableName).update(leadRecord.id, {
                [config.fields.relevanceScore]: 0,
                [config.fields.aiEvaluation]: `Scanned ${parsedPostsArray.length} posts. No relevant AI keywords detected.`,
                [config.fields.dateScored]: new Date().toISOString()
            });
            return { status: "No AI keywords found", score: 0, leadId: leadRecord.id };
        }

        // If keywords are found, proceed with full AI scoring
        console.log(`Lead ${leadRecord.id}: Found ${relevantPosts.length} relevant posts. Proceeding with Gemini scoring.`);

        // Step 3: Build the full system prompt
        console.log(`Lead ${leadRecord.id}: Building system prompt...`);
        const systemPrompt = await buildPostScoringPrompt(base, config);

        // Step 4: Configure the Gemini Model instance with the system prompt
        console.log(`Lead ${leadRecord.id}: Configuring Gemini model instance...`);
        const geminiModelId = process.env.GEMINI_MODEL_ID || (config.geminiConfig && config.geminiConfig.geminiModelId);
        const configuredGeminiModel = vertexAIClient.getGenerativeModel({
            model: geminiModelId,
            systemInstruction: { parts: [{ text: systemPrompt }] },
            safetySettings: [
                { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
                { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
                { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
                { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
            ],
            generationConfig: { temperature: 0, responseMimeType: "application/json" }
        });

        // Step 5: Call the Gemini scorer with only the relevant posts
        console.log(`Lead ${leadRecord.id}: Calling Gemini scorer...`);
        const aiResponseArray = await scorePostsWithGemini(relevantPosts, configuredGeminiModel);

        // Step 6: Find the highest scoring post from the response
        if (!Array.isArray(aiResponseArray) || aiResponseArray.length === 0) {
            throw new Error("AI response was not a valid or non-empty array of post scores.");
        }

        // Use reduce to find the post with the highest score.
        const highestScoringPost = aiResponseArray.reduce((max, current) => {
            return (current.post_score > max.post_score) ? current : max;
        }, aiResponseArray[0]);

        if (!highestScoringPost || typeof highestScoringPost.post_score === 'undefined') {
             throw new Error("Could not determine the highest scoring post from the AI response.");
        }
        
        console.log(`Lead ${leadRecord.id}: Highest scoring post has a score of ${highestScoringPost.post_score}.`);

        // Step 7: Update Airtable with the results from the highest-scoring post
        await base(config.leadsTableName).update(leadRecord.id, {
            [config.fields.relevanceScore]: highestScoringPost.post_score,
            [config.fields.aiEvaluation]: JSON.stringify(aiResponseArray, null, 2), // Store the full array for debugging
            [config.fields.summarisedByAI]: highestScoringPost.scoring_rationale || "N/A",
            [config.fields.dateScored]: new Date().toISOString()
        });

        console.log(`Lead ${leadRecord.id}: Successfully scored. Final Score: ${highestScoringPost.post_score}`);
        return { status: "Successfully scored", leadId: leadRecord.id, final_score: highestScoringPost.post_score, full_analysis: aiResponseArray };

    } catch (error) {
        console.error(`Lead ${leadRecord.id}: Error during AI scoring process. Error: ${error.message}`, error.stack);
        await base(config.leadsTableName).update(leadRecord.id, {
            [config.fields.aiEvaluation]: `ERROR during AI post scoring: ${error.message}`,
            [config.fields.dateScored]: new Date().toISOString()
        });
        return { status: "Error during AI scoring", error: error.message, leadId: leadRecord.id };
    }
}

/**
 * Processes posts for all leads in Airtable that haven't been scored yet.
 */
async function processAllPendingLeadPosts(base, vertexAIClient, config) {
    console.log("PostAnalysisService: processAllPendingLeadPosts - Called (Background task)");
    let processedCount = 0, errorCount = 0;
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
                console.error(`Error processing lead ${leadRecord.id} in main loop. Continuing. Error: ${leadProcessingError.message}`);
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
async function scoreSpecificLeadPosts(leadId, base, vertexAIClient, config) {
    console.log(`PostAnalysisService: scoreSpecificLeadPosts - Called for leadId: ${leadId}`);
    try {
        const leadRecord = await base(config.leadsTableName).find(leadId);

        if (!leadRecord) {
            const notFoundMsg = `Lead with ID ${leadId} not found.`;
            console.error(notFoundMsg);
            return { status: "Lead not found", error: notFoundMsg, leadId: leadId };
        }
        return await analyzeAndScorePostsForLead(leadRecord, base, vertexAIClient, config);
    } catch (error) {
        console.error(`Error in scoreSpecificLeadPosts for lead ${leadId}: ${error.message}`, error.stack);
        if (error.statusCode === 404) return { status: "Lead not found", error: error.message, leadId: leadId };
        return { status: "Error scoring specific lead", error: error.message, leadId: leadId };
    }
}

module.exports = {
    processAllPendingLeadPosts,
    scoreSpecificLeadPosts
};