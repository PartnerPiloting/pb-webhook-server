// File: postAnalysisService.js (Now with robust diagnostics for Posts Content parsing)

// Require our newly defined helper modules
const { loadPostScoringAirtableConfig } = require('./postAttributeLoader');
const { buildPostScoringPrompt } = require('./postPromptBuilder');
const { scorePostsWithGemini } = require('./postGeminiScorer');
const { parsePlainTextPosts } = require('./utils/parsePlainTextPosts');
const { repairAndParseJson } = require('./utils/jsonRepair');
const dirtyJSON = require('dirty-json');

// --- Structured Logging ---
const { StructuredLogger } = require('./utils/structuredLogger');

/**
 * Diagnostic helper for parsing the Posts Content field safely.
 * Logs type, length, head/tail, and prints raw value if parsing fails.
 */
function diagnosePostsContent(rawField, recordId = '', logger = null) {
    const log = logger || new StructuredLogger('DIAGNOSTICS');
    
    log.debug('------------------------');
    log.debug(`Diagnosing Posts Content for record: ${recordId}`);
    log.debug('Type:', typeof rawField);
    if (rawField == null) {
        log.debug('Field is null or undefined');
        return [];
    }
    if (typeof rawField !== 'string') {
        log.debug('Field is not a string, returning as-is:', rawField);
        return Array.isArray(rawField) ? rawField : [];
    }
    log.debug('String length:', rawField.length);
    log.debug('First 300 chars:', rawField.slice(0, 300));
    if (rawField.length > 600) {
        log.debug('Last 300 chars:', rawField.slice(-300));
    }

    try {
        const parsed = JSON.parse(rawField);
        log.debug('JSON successfully parsed. Type:', typeof parsed, Array.isArray(parsed) ? '(array)' : '');
        return parsed;
    } catch (err) {
        log.error('JSON parse error:', err.message);
        if (rawField.length > 1200) {
            log.error('Problematic JSON (first 600 chars):', rawField.slice(0, 600));
            log.error('Problematic JSON (last 600 chars):', rawField.slice(-600));
        } else {
            log.error('Problematic JSON:', rawField);
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
async function analyzeAndScorePostsForLead(leadRecord, base, vertexAIClient, config, logger = null) {
    const log = logger || new StructuredLogger(`LEAD-${leadRecord.id}`);
    
    log.setup(`Analyzing posts for lead: ${leadRecord.id}`);

    // Read the JSON field and robustly parse it into structured posts
    const postsJsonField = leadRecord.fields[config.fields.postsContent];
    let parsedPostsArray = [];
    // Parse the Posts Content field using enhanced JSON repair
    if (typeof postsJsonField === 'string') {
        const repairResult = repairAndParseJson(postsJsonField);
        
        if (repairResult.success) {
            parsedPostsArray = repairResult.data;
            log.process(`JSON parsed successfully using method: ${repairResult.method}`);
            
            // Update Posts JSON Status field
            try {
                await base('Leads').update(leadRecord.id, {
                    'Posts JSON Status': 'Parsed'
                });
            } catch (e) { /* Field might not exist */ }
        } else {
            log.error(`All JSON parsing methods failed:`, repairResult.error);
            
            // Update Posts JSON Status field and mark as processed
            try {
                await base('Leads').update(leadRecord.id, {
                    'Posts JSON Status': 'Failed'
                });
            } catch (e) { /* Field might not exist */ }
            
            return { status: "Skipped - Unparseable JSON", error: repairResult.error, leadId: leadRecord.id };
        }
    } else if (Array.isArray(postsJsonField)) {
        parsedPostsArray = postsJsonField;
        
        // Update Posts JSON Status field
        try {
            await base('Leads').update(leadRecord.id, {
                'Posts JSON Status': 'Parsed'
            });
        } catch (e) { /* Field might not exist */ }
    } else {
        log.warn(`Posts Content field is not a string or array, skipping`);
        
        // Update Posts JSON Status field
        try {
            await base('Leads').update(leadRecord.id, {
                'Posts JSON Status': 'Failed'
            });
        } catch (e) { /* Field might not exist */ }
        
        return { status: "Skipped - Invalid Posts Content field", leadId: leadRecord.id };
    }
    if (!Array.isArray(parsedPostsArray)) {
        log.warn(`Parsed Posts Content is not an array, skipping`);
        return { status: "Skipped - Parsed Posts Content not array", leadId: leadRecord.id };
    }
    log.debug('Parsed posts array:', JSON.stringify(parsedPostsArray, null, 2));

    // Define originalPosts before logging it
    function normalizeUrl(url) {
        if (!url) return '';
        return url.trim().replace(/^https?:\/\//i, '').replace(/\/$/, '').toLowerCase();
    }
    const leadProfileUrl = leadRecord.fields[config.fields.linkedinUrl];
    // console.log(`DEBUG: leadProfileUrl for lead ${leadRecord.id}:`, leadProfileUrl);
    const originalPosts = filterOriginalPosts(parsedPostsArray, leadProfileUrl);
    // Log the original posts after filtering
    // console.log(`DEBUG: Original posts before filtering for lead ${leadRecord.id}:`, JSON.stringify(originalPosts, null, 2));

    try {
        // Load scoring configuration (no global filtering - let attributes handle relevance)
        log.setup(`Loading config from Airtable...`);
        const config_data = await loadPostScoringAirtableConfig(base, config, log);
        
        // Score all original posts using client's specific attributes
        log.process(`Scoring all ${originalPosts.length} original posts using client's attribute criteria`);
        
        if (originalPosts.length === 0) {
            log.summary(`No original posts found, skipping scoring`);
            return { status: "No original posts found", leadId: leadRecord.id };
        }

        // Proceed with full AI scoring on all original posts
        log.process(`Found ${originalPosts.length} original posts. Proceeding with Gemini scoring`);

        // Step 3: Build the full system prompt
        log.process(`Building system prompt...`);
        const systemPrompt = await buildPostScoringPrompt(base, config);

        // Step 4: Configure the Gemini Model instance with the system prompt
        log.process(`Configuring Gemini model instance...`);
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

        // Step 5: Call the Gemini scorer with all original posts
        log.process(`Calling Gemini scorer...`);
        // --- FIX: Wrap posts in object with lead_id for Gemini ---
        const geminiInput = { lead_id: leadRecord.id, posts: originalPosts };
        const aiResponseArray = await scorePostsWithGemini(geminiInput, configuredGeminiModel);

        // --- NEW: Merge original post data into AI response ---
        // Map post_url to original post for quick lookup
        const postUrlToOriginal = {};
        for (const post of originalPosts) {
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
        
        log.process(`Highest scoring post has a score of ${highestScoringPost.post_score}`);

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

        log.summary(`Successfully scored. Final Score: ${highestScoringPost.post_score}`);
        return { status: "Successfully scored", leadId: leadRecord.id, final_score: highestScoringPost.post_score, full_analysis: aiResponseArray };

    } catch (error) {
        log.error(`Error during AI scoring process: ${error.message}`, error.stack);
        // --- Improved error/debug messaging in Airtable ---
        const errorDetails = {
            errorMessage: error.message,
            finishReason: error.finishReason || null,
            safetyRatings: error.safetyRatings || null,
            rawResponseSnippet: error.rawResponseSnippet || null,
            aiInputPosts: originalPosts,
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
async function processAllPendingLeadPosts(base, vertexAIClient, config, limit, forceRescore, viewName, logger = null) {
    const log = logger || new StructuredLogger('POST-BATCH-PROCESSOR');
    
    log.setup("=== STARTING POST BATCH PROCESSING ===");
    let processedCount = 0, errorCount = 0;
    try {
        // Build select options
        const selectOptions = {
            fields: [
                config.fields.postsContent,
                config.fields.linkedinUrl,
                config.fields.dateScored,
                config.fields.relevanceScore,
                config.fields.aiEvaluation,
                config.fields.topScoringPost
            ]
        };
        if (viewName) {
            selectOptions.view = viewName;
        }
        if (!forceRescore) {
            selectOptions.filterByFormula = `AND({${config.fields.dateScored}} = BLANK())`;
        }
        let recordsToProcess = await base(config.leadsTableName).select(selectOptions).all();
        if (typeof limit === 'number' && limit > 0) {
            recordsToProcess = recordsToProcess.slice(0, limit);
            log.setup(`Limiting batch to first ${limit} leads`);
        }
        log.setup(`Found ${recordsToProcess.length} leads to process for post scoring`);
        for (const leadRecord of recordsToProcess) {
            try {
                await analyzeAndScorePostsForLead(leadRecord, base, vertexAIClient, config, log);
                processedCount++;
            } catch (leadProcessingError) {
                log.error(`Error processing lead ${leadRecord.id} in main loop. Continuing. Error: ${leadProcessingError.message}`);
                errorCount++;
            }
        }
    } catch (error) {
        log.error(`Major error in processAllPendingLeadPosts (e.g., fetching records from Airtable): ${error.message}`, error.stack);
    }
    log.summary(`Finished. Processed: ${processedCount}, Errors: ${errorCount}`);
}

/**
 * Fetches a specific lead by its Airtable Record ID, analyzes its posts,
 * and returns the scoring outcome.
 */
async function scoreSpecificLeadPosts(leadId, base, vertexAIClient, config, logger = null) {
    const log = logger || new StructuredLogger(`SPECIFIC-LEAD-${leadId}`);
    
    log.setup(`Processing specific lead: ${leadId}`);
    try {
        const records = await base(config.leadsTableName).select({
            filterByFormula: `RECORD_ID() = '${leadId}'`,
            maxRecords: 1
        }).firstPage();
        const leadRecord = records[0];

        if (!leadRecord) {
            const notFoundMsg = `Lead with ID ${leadId} not found`;
            log.error(notFoundMsg);
            return { status: "Lead not found", error: notFoundMsg, leadId: leadId };
        }
        return await analyzeAndScorePostsForLead(leadRecord, base, vertexAIClient, config, log);
    } catch (error) {
        log.error(`Error in scoreSpecificLeadPosts: ${error.message}`, error.stack);
        if (error.statusCode === 404) return { status: "Lead not found", error: error.message, leadId: leadId };
        return { status: "Error scoring specific lead", error: error.message, leadId: leadId };
    }
}

module.exports = {
    processAllPendingLeadPosts,
    scoreSpecificLeadPosts
};