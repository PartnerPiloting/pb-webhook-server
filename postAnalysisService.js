// File: postAnalysisService.js (Now with robust diagnostics for Posts Content parsing)

// Require our newly defined helper modules
const { loadPostScoringAirtableConfig } = require('./postAttributeLoader');
const { buildPostScoringPrompt } = require('./postPromptBuilder');
const { scorePostsWithGemini } = require('./postGeminiScorer');

/**
 * Diagnostic helper for parsing the Posts Content field safely.
 * Logs type, length, head/tail, and prints raw value if parsing fails.
 */
function diagnosePostsContent(rawField, recordId = '') {
    console.log('------------------------');
    console.log(`Diagnosing Posts Content for record: ${recordId}`);
    console.log('Type:', typeof rawField);
    if (rawField == null) {
        console.log('Field is null or undefined');
        return [];
    }
    if (typeof rawField !== 'string') {
        console.log('Field is not a string, returning as-is:', rawField);
        return Array.isArray(rawField) ? rawField : [];
    }
    console.log('String length:', rawField.length);
    console.log('First 300 chars:', rawField.slice(0, 300));
    if (rawField.length > 600) {
        console.log('Last 300 chars:', rawField.slice(-300));
    }

    try {
        const parsed = JSON.parse(rawField);
        console.log('JSON successfully parsed. Type:', typeof parsed, Array.isArray(parsed) ? '(array)' : '');
        return parsed;
    } catch (err) {
        console.error('JSON parse error:', err.message);
        if (rawField.length > 1200) {
            console.error('Problematic JSON (first 600 chars):', rawField.slice(0, 600));
            console.error('Problematic JSON (last 600 chars):', rawField.slice(-600));
        } else {
            console.error('Problematic JSON:', rawField);
        }
        return [];
    }
}

/**
 * Filter out reposts and keep only original posts authored by the lead.
 * @param {Array} postsArray - All posts for the lead
 * @param {string} leadProfileUrl - LinkedIn profile URL of the lead
 * @returns {Array}
 */
function filterOriginalPosts(postsArray, leadProfileUrl) {
    return postsArray.filter(post => {
        const action = post?.pbMeta?.action?.toLowerCase() || '';
        const isOriginalAuthor = post?.pbMeta?.authorUrl === leadProfileUrl;
        return !action.includes('repost') && isOriginalAuthor;
    });
}

/**
 * (Internal helper function) Contains the common logic for analyzing and scoring
 * the posts for a single lead record.
 */
async function analyzeAndScorePostsForLead(leadRecord, base, vertexAIClient, config) {
    console.log(`PostAnalysisService: Analyzing posts for lead: ${leadRecord.id}`);

    // Read the plain text field instead of JSON
    const postsPlainTextField = leadRecord.fields[config.fields.postsContent];

    // Check 1: Ensure there is post content to analyze
    if (!postsPlainTextField) {
        console.warn(`Lead ${leadRecord.id} has no '${config.fields.postsContent}' content. Skipping.`);
        await base(config.leadsTableName).update(leadRecord.id, {
            [config.fields.relevanceScore]: 0,
            [config.fields.aiEvaluation]: "No post content found to analyze.",
            [config.fields.dateScored]: new Date().toISOString()
        });
        return { status: "No post content", score: 0, leadId: leadRecord.id };
    }

    // No JSON parsing needed, just wrap the plain text in an array of objects for compatibility
    const parsedPostsArray = Array.isArray(postsPlainTextField)
        ? postsPlainTextField.map(text => ({ postContent: text }))
        : [{ postContent: postsPlainTextField }];

    // NEW: Filter to only original posts by this lead (no reposts)
    const leadProfileUrl = leadRecord.fields[config.fields.linkedinUrl];
    const originalPosts = filterOriginalPosts(parsedPostsArray, leadProfileUrl);

    try {
        // Step 1: Load all dynamic configuration from Airtable (including keywords)
        console.log(`Lead ${leadRecord.id}: Loading config from Airtable...`);
        const { aiKeywords } = await loadPostScoringAirtableConfig(base, config);
        console.log(`Loaded AI Keywords:`, aiKeywords);
        // Step 2: Filter for all posts containing AI keywords (only from originals)
        console.log(`Lead ${leadRecord.id}: Scanning ${originalPosts.length} original posts for AI keywords...`);
        const relevantPosts = originalPosts.filter(post => {
            let text = '';
            if (typeof post === 'string') {
                text = post;
            } else if (post && typeof post === 'object' && post.postContent) {
                text = post.postContent;
            }
            if (!text) return false;
            const matches = aiKeywords.filter(keyword => text.toLowerCase().includes(keyword.toLowerCase()));
            return matches.length > 0;
        });

        if (relevantPosts.length === 0) {
            console.log(`Lead ${leadRecord.id}: No relevant posts with AI keywords found.`);
            await base(config.leadsTableName).update(leadRecord.id, {
                [config.fields.relevanceScore]: 0,
                [config.fields.aiEvaluation]: `Scanned ${originalPosts.length} original posts. No relevant AI keywords detected.`,
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

        // --- NEW: Merge original post data into AI response ---
        // Map post_url to original post for quick lookup
        const postUrlToOriginal = {};
        for (const post of relevantPosts) {
            const url = post.postUrl || post.post_url;
            if (url) postUrlToOriginal[url] = post;
        }
        // Attach content and date to each AI response object
        aiResponseArray.forEach(resp => {
            const orig = postUrlToOriginal[resp.post_url] || {};
            resp.post_content = orig.postContent || orig.post_content || '';
            resp.postDate = orig.postDate || orig.post_date || '';
        });
        // --- END MERGE ---

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
        // Format the top scoring post details for the new field
        function formatDateAEST(utcString) {
            if (!utcString) return "";
            const date = new Date(utcString);
            const offsetMs = 10 * 60 * 60 * 1000; // 10 hours in ms
            const aestDate = new Date(date.getTime() + offsetMs);
            // Format as YYYY-MM-DD HH:mm AEST
            return aestDate.toISOString().replace('T', ' ').substring(0, 16) + ' AEST';
        }
        const topScoringPostText =
            `Date: ${formatDateAEST(highestScoringPost.post_date || highestScoringPost.postDate)}\n` +
            `URL: ${highestScoringPost.post_url || highestScoringPost.postUrl || ''}\n` +
            `Score: ${highestScoringPost.post_score}\n` +
            `Content: ${highestScoringPost.post_content || highestScoringPost.postContent || ''}\n` +
            `Rationale: ${highestScoringPost.scoring_rationale || 'N/A'}`;

        await base(config.leadsTableName).update(leadRecord.id, {
            [config.fields.relevanceScore]: highestScoringPost.post_score,
            [config.fields.aiEvaluation]: JSON.stringify(aiResponseArray, null, 2), // Store the full array for debugging
            [config.fields.topScoringPost]: topScoringPostText,
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
        const records = await base(config.leadsTableName).select({
            filterByFormula: `RECORD_ID() = '${leadId}'`,
            maxRecords: 1
        }).firstPage();
        const leadRecord = records[0];

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