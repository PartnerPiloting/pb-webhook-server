// File: postAnalysisService.js (Now with robust diagnostics for Posts Content parsing)

// Require our newly defined helper modules
const { loadPostScoringAirtableConfig } = require('./postAttributeLoader');
const { buildPostScoringPrompt } = require('./postPromptBuilder');
const { scorePostsWithGemini } = require('./postGeminiScorer');
const { parsePlainTextPosts } = require('./utils/parsePlainTextPosts');
const dirtyJSON = require('dirty-json');

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
    function normalizeUrl(url) {
        if (!url) return '';
        return url.trim().replace(/^https?:\/\//i, '').replace(/\/$/, '').toLowerCase();
    }
    const normalizedLeadProfileUrl = normalizeUrl(leadProfileUrl);
    return postsArray.filter(post => {
        // Prefer pbMeta.authorUrl, fallback to post.authorUrl
        const authorUrl = post?.pbMeta?.authorUrl || post.authorUrl;
        const normalizedAuthorUrl = normalizeUrl(authorUrl);
        const action = post?.pbMeta?.action?.toLowerCase() || '';
        const isOriginal = !action.includes('repost') && normalizedAuthorUrl && normalizedAuthorUrl === normalizedLeadProfileUrl;
        return isOriginal;
    });
}

/**
 * (Internal helper function) Contains the common logic for analyzing and scoring
 * the posts for a single lead record.
 */
async function analyzeAndScorePostsForLead(leadRecord, base, vertexAIClient, config) {
    console.log(`PostAnalysisService: Analyzing posts for lead: ${leadRecord.id}`);

    // Read the JSON field and robustly parse it into structured posts
    const postsJsonField = leadRecord.fields[config.fields.postsContent];
    let parsedPostsArray = [];
    if (typeof postsJsonField === 'string') {
        try {
            parsedPostsArray = JSON.parse(postsJsonField);
        } catch (e) {
            console.warn(`JSON.parse failed for record ${leadRecord.id}, attempting dirty-json fallback...`);
            try {
                parsedPostsArray = dirtyJSON.parse(postsJsonField);
                console.warn(`dirty-json succeeded for record ${leadRecord.id}`);
            } catch (err) {
                console.error(`Both JSON.parse and dirty-json failed for record ${leadRecord.id}:`, err.message);
                // Optionally log to Airtable or alert admin here
                return { status: "Skipped - Unparseable JSON", error: err.message, leadId: leadRecord.id };
            }
        }
    } else if (Array.isArray(postsJsonField)) {
        parsedPostsArray = postsJsonField;
    } else {
        console.warn(`Posts Content field for record ${leadRecord.id} is not a string or array, skipping.`);
        return { status: "Skipped - Invalid Posts Content field", leadId: leadRecord.id };
    }
    if (!Array.isArray(parsedPostsArray)) {
        console.warn(`Parsed Posts Content for record ${leadRecord.id} is not an array, skipping.`);
        return { status: "Skipped - Parsed Posts Content not array", leadId: leadRecord.id };
    }
    console.log('DEBUG: Parsed posts array:', JSON.stringify(parsedPostsArray, null, 2));

    // Define originalPosts before logging it
    function normalizeUrl(url) {
        if (!url) return '';
        return url.trim().replace(/^https?:\/\//i, '').replace(/\/$/, '').toLowerCase();
    }
    const leadProfileUrl = leadRecord.fields[config.fields.linkedinUrl];
    const originalPosts = filterOriginalPosts(parsedPostsArray, leadProfileUrl);
    // Log the original posts after filtering
    console.log(`DEBUG: Original posts before filtering for lead ${leadRecord.id}:`, JSON.stringify(originalPosts, null, 2));

    try {
        // Step 1: Load all dynamic configuration from Airtable (including keywords)
        console.log(`Lead ${leadRecord.id}: Loading config from Airtable...`);
        const { aiKeywords } = await loadPostScoringAirtableConfig(base, config);
        console.log(`DEBUG: Loaded AI Keywords:`, aiKeywords);
        // Step 2: Filter for all posts containing AI keywords (only from originals)
        console.log(`Lead ${leadRecord.id}: Scanning ${originalPosts.length} original posts for AI keywords...`);
        // Build regex patterns for each keyword/phrase
        const keywordPatterns = aiKeywords.map(keyword => {
            // Escape regex special chars
            const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            // If phrase (contains space), match as phrase (with optional plural 's')
            if (escaped.includes(' ')) {
                return new RegExp(`\\b${escaped}s?\\b`, 'i');
            }
            // For 'AI', match as word or with hyphen/space and common suffixes
            if (escaped.toLowerCase() === 'ai') {
                return new RegExp('\\bAI(\\b|[-\s]?(powered|related|driven|enabled|based|focused|centric|solutions?))\\b', 'i');
            }
            // For other keywords, allow optional plural 's'
            return new RegExp(`\\b${escaped}s?\\b`, 'i');
        });
        const relevantPosts = originalPosts.filter(post => {
            let text = '';
            if (typeof post === 'string') {
                text = post;
            } else if (post && typeof post === 'object' && post.postContent) {
                text = post.postContent;
            }
            if (!text) return false;
            // DEBUG: Print post content being checked
            console.log(`DEBUG: Checking post content:`, text);
            // Check for matches using regex patterns
            const matches = aiKeywords.filter((keyword, idx) => keywordPatterns[idx].test(text));
            if (matches.length > 0) {
                console.log(`DEBUG: Keyword match for post:`, matches);
                return true;
            } else {
                // Manual review: log posts that contain any keyword fragment but didn't match strictly
                const lowerText = text.toLowerCase();
                const fragment = aiKeywords.find(k => lowerText.includes(k.toLowerCase()));
                if (fragment) {
                    console.log(`REVIEW: Post contains possible AI keyword fragment but did not pass strict filter:`, text);
                }
                console.log(`DEBUG: No AI keyword matches for this post.`);
                return false;
            }
        });

        console.log(`DEBUG: Relevant posts after AI keyword filtering for lead ${leadRecord.id}:`, JSON.stringify(relevantPosts, null, 2));

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
        // --- FIX: Wrap posts in object with lead_id for Gemini ---
        const geminiInput = { lead_id: leadRecord.id, posts: relevantPosts };
        const aiResponseArray = await scorePostsWithGemini(geminiInput, configuredGeminiModel);

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
        // Use the date as-is if it's not a valid ISO string
        function safeFormatDate(dateStr) {
            if (!dateStr) return "";
            // Try to parse as ISO, otherwise return as-is
            const d = new Date(dateStr);
            return isNaN(d.getTime()) ? dateStr : d.toISOString().replace('T', ' ').substring(0, 16) + ' AEST';
        }
        const topScoringPostText =
            `Date: ${safeFormatDate(highestScoringPost.postDate || highestScoringPost.post_date)}\n` +
            `URL: ${highestScoringPost.postUrl || highestScoringPost.post_url || ''}\n` +
            `Score: ${highestScoringPost.post_score}\n` +
            `Content: ${highestScoringPost.postContent || highestScoringPost.post_content || ''}\n` +
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
        // --- Improved error/debug messaging in Airtable ---
        const errorDetails = {
            errorMessage: error.message,
            finishReason: error.finishReason || null,
            safetyRatings: error.safetyRatings || null,
            rawResponseSnippet: error.rawResponseSnippet || null,
            aiInputPosts: relevantPosts,
            aiPrompt: systemPrompt || null,
            timestamp: new Date().toISOString(),
        };
        await base(config.leadsTableName).update(leadRecord.id, {
            [config.fields.aiEvaluation]: `ERROR during AI post scoring: ${JSON.stringify(errorDetails, null, 2)}`,
            [config.fields.dateScored]: new Date().toISOString()
        });
        return { status: "Error during AI scoring", error: error.message, leadId: leadRecord.id, errorDetails };
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