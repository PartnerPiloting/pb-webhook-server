// batchScorer.js - MULTI-TENANT SUPPORT: Added client iteration, per-client logging, error isolation

require("dotenv").config(); 

const { HarmCategory, HarmBlockThreshold } = require('@google-cloud/vertexai');

// --- Multi-Tenant Dependencies ---
const clientService = require('./services/clientService');
const { getClientBase } = require('./config/airtableClient');

// --- Post Scoring Dependencies ---
const { loadPostScoringAirtableConfig } = require('./postAttributeLoader');
const { buildPostScoringPrompt } = require('./postPromptBuilder');
const { scorePostsWithGemini } = require('./postGeminiScorer');
const { parsePlainTextPosts } = require('./utils/parsePlainTextPosts');
const { repairAndParseJson } = require('./utils/jsonRepair');
const { alertAdmin } = require('./utils/appHelpers.js');

// --- Structured Logging ---
const { StructuredLogger } = require('./utils/structuredLogger');

// --- Centralized Dependencies (will be passed into 'run' function) ---
let POST_BATCH_SCORER_VERTEX_AI_CLIENT;
let POST_BATCH_SCORER_GEMINI_MODEL_ID;

/* ---------- ENV CONFIGURATION for Post Batch Scorer Operations ----------- */
const CHUNK_SIZE = Math.max(1, parseInt(process.env.POST_BATCH_CHUNK_SIZE || "10", 10));
const VERBOSE = process.env.VERBOSE_POST_SCORING !== "false"; // default = true
const GEMINI_TIMEOUT_MS = Math.max(30000, parseInt(process.env.GEMINI_TIMEOUT_MS || "120000", 10));

/* =================================================================
    Multi-Tenant Post Scoring Main Function
=================================================================== */

/**
 * Main multi-tenant post scoring function
 * @param {Object} geminiClient - Initialized Vertex AI client
 * @param {string} geminiModelId - Gemini model ID to use
 * @param {string} clientId - Optional specific client ID to process
 * @param {number} limit - Optional limit on posts to process per client
 * @returns {Object} - Summary of execution across all clients
 */
async function runMultiTenantPostScoring(geminiClient, geminiModelId, clientId = null, limit = null, options = {}) {
    // Create system-level logger for multi-tenant operations
    const systemLogger = new StructuredLogger('SYSTEM');
    
    systemLogger.setup("=== STARTING MULTI-TENANT POST SCORING ===");
    systemLogger.setup(`Parameters: clientId=${clientId || 'ALL'}, limit=${limit || 'UNLIMITED'}, dryRun=${!!options.dryRun}, tableOverride=${options.leadsTableName || 'DEFAULT'}, markSkips=${options.markSkips !== false}`);
    
    // Set global dependencies
    POST_BATCH_SCORER_VERTEX_AI_CLIENT = geminiClient;
    POST_BATCH_SCORER_GEMINI_MODEL_ID = geminiModelId;
    
    const startTime = new Date();
    const results = {
        totalClients: 0,
        successfulClients: 0,
        failedClients: 0,
        totalPostsProcessed: 0,
        totalPostsScored: 0,
        totalLeadsSkipped: 0,
        skipCounts: {}, // aggregated skip reasons
        totalErrors: 0, // total leads with status=error
        errorReasonCounts: {}, // aggregated error reasons across all clients
        duration: null,
        clientResults: []
    };

    try {
        // Get list of clients to process
        const clientsToProcess = await clientService.getActiveClients(clientId);
        results.totalClients = clientsToProcess.length;
        
        systemLogger.setup(`Found ${clientsToProcess.length} client(s) to process for post scoring`);
        
        // Process each client sequentially
        for (const client of clientsToProcess) {
            // Create client-specific logger with shared session ID
            const clientLogger = new StructuredLogger(client.clientId, systemLogger.getSessionId());
            clientLogger.setup(`--- PROCESSING CLIENT: ${client.clientName} (${client.clientId}) ---`);
            
            try {
                const clientResult = await processClientPostScoring(client, limit, clientLogger, options);
                results.clientResults.push(clientResult);
                
                // We now treat both success and completed_with_errors/failed similarly for aggregation,
                // but status 'success' means errors=0.
                const isSuccess = clientResult.status === 'success';
                if (isSuccess) results.successfulClients++; else results.failedClients++;
                results.totalPostsProcessed += clientResult.postsProcessed || 0;
                results.totalPostsScored += clientResult.postsScored || 0;
                results.totalLeadsSkipped += clientResult.leadsSkipped || 0;
                if (clientResult.skipCounts) {
                    for (const [reason, count] of Object.entries(clientResult.skipCounts)) {
                        results.skipCounts[reason] = (results.skipCounts[reason] || 0) + count;
                    }
                }
                if (clientResult.errorReasonCounts) {
                    for (const [reason, count] of Object.entries(clientResult.errorReasonCounts)) {
                        results.errorReasonCounts[reason] = (results.errorReasonCounts[reason] || 0) + count;
                    }
                }
                results.totalErrors += clientResult.errors || 0; // will be 0 if success
                if (isSuccess) {
                    clientLogger.summary(`SUCCESS - Processed: ${clientResult.postsProcessed}, Scored: ${clientResult.postsScored}, Duration: ${clientResult.duration}s`);
                } else {
                    clientLogger.error(`COMPLETED WITH ERRORS - Errors: ${clientResult.errors}, Details: ${clientResult.errorDetails?.join('; ')}`);
                }
                
                // Log execution for this client
                await clientService.logExecution(client.clientId, {
                    type: 'POST_SCORING',
                    status: clientResult.status,
                    postsProcessed: clientResult.postsProcessed || 0,
                    postsScored: clientResult.postsScored || 0,
                    leadsSkipped: clientResult.leadsSkipped || 0,
                    errors: clientResult.errors || 0,
                    duration: clientResult.duration,
                    errorDetails: clientResult.errorDetails || []
                });
                
            } catch (clientError) {
                const clientLogger = new StructuredLogger(client.clientId, systemLogger.getSessionId());
                clientLogger.error(`Failed to process client ${client.clientId}: ${clientError.message}`);
                
                const failedResult = {
                    clientId: client.clientId,
                    clientName: client.clientName,
                    status: 'failed',
                    postsProcessed: 0,
                    postsScored: 0,
                    errors: 1,
                    errorDetails: [clientError.message],
                    duration: 0
                };
                
                results.clientResults.push(failedResult);
                results.failedClients++;
                results.totalErrors++;
                
                // Log failure for this client
                await clientService.logExecution(client.clientId, {
                    type: 'POST_SCORING',
                    status: 'failed',
                    postsProcessed: 0,
                    postsScored: 0,
                    errors: 1,
                    duration: 0,
                    errorDetails: [clientError.message]
                });
            }
        }
        
    } catch (globalError) {
        systemLogger.error("Global error in multi-tenant post scoring:", globalError.message);
        await alertAdmin("Multi-Tenant Post Scoring Global Error", `Error: ${globalError.message}\nStack: ${globalError.stack}`);
        throw globalError;
    }
    
    // Calculate total duration
    const endTime = new Date();
    results.duration = Math.round((endTime - startTime) / 1000); // seconds
    
    systemLogger.summary("=== MULTI-TENANT POST SCORING SUMMARY ===");
    systemLogger.summary(`Clients: ${results.successfulClients}/${results.totalClients} successful`);
    systemLogger.summary(`Posts processed: ${results.totalPostsProcessed}`);
    systemLogger.summary(`Posts scored: ${results.totalPostsScored}`);
    systemLogger.summary(`Leads skipped: ${results.totalLeadsSkipped}`);
    systemLogger.summary(`Skip reasons: ${JSON.stringify(results.skipCounts)}`);
    systemLogger.summary(`Error reasons: ${JSON.stringify(results.errorReasonCounts)}`);
    systemLogger.summary(`Errors (lead-level): ${results.totalErrors}`);
    systemLogger.summary(`Duration: ${results.duration}s`);
    
    return results;
}

/* =================================================================
    Process Single Client Post Scoring
=================================================================== */

async function processClientPostScoring(client, limit, logger, options = {}) {
    const clientStartTime = new Date();
    const clientResult = {
        clientId: client.clientId,
        clientName: client.clientName,
        status: 'processing',
        postsProcessed: 0,
        postsScored: 0,
        leadsSkipped: 0,
        skipCounts: {},
        errors: 0, // lead-level errors
        errorReasonCounts: {},
        errorDetails: [],
        duration: 0
    };
    
    try {
        // Get client-specific Airtable base
        const clientBase = await getClientBase(client.clientId);
        if (!clientBase) {
            throw new Error(`Failed to connect to Airtable base: ${client.airtableBaseId}`);
        }
        
        logger.setup(`Connected to client base: ${client.airtableBaseId}`);
        
        // Load client-specific configuration
        const config = await loadClientPostScoringConfig(clientBase);
        // Optional table override (e.g., "Leads copy")
        if (options.leadsTableName) {
            logger.setup(`Overriding leads table name: ${config.leadsTableName} -> ${options.leadsTableName}`);
            config.leadsTableName = options.leadsTableName;
        }
        // Add skip reason field to config (tolerant if missing in Airtable)
        config.fields.skipReason = 'Posts Skip Reason';
        
        // Get leads with posts to be scored
        const leadsToProcess = await getLeadsForPostScoring(clientBase, config, limit);
        logger.setup(`Found ${leadsToProcess.length} leads with posts to score for client ${client.clientId}`);
        
        if (leadsToProcess.length === 0) {
            clientResult.status = 'success';
            clientResult.duration = Math.round((new Date() - clientStartTime) / 1000);
            logger.summary(`No posts to score for client ${client.clientId}`);
            return clientResult;
        }
        
        // Process leads in chunks
        const chunks = chunkArray(leadsToProcess, CHUNK_SIZE);
        logger.process(`Processing ${leadsToProcess.length} leads in ${chunks.length} chunk(s) of max ${CHUNK_SIZE}`);
        
        for (let i = 0; i < chunks.length; i++) {
            const chunk = chunks[i];
            logger.process(`Processing chunk ${i + 1}/${chunks.length} (${chunk.length} leads) for client ${client.clientId}`);
            
            try {
                const chunkResult = await processPostScoringChunk(chunk, clientBase, config, client.clientId, logger, options);
                clientResult.postsProcessed += chunkResult.processed;
                clientResult.postsScored += chunkResult.scored;
                clientResult.leadsSkipped += chunkResult.skipped || 0;
                if (chunkResult.skipCounts) {
                    for (const [reason, count] of Object.entries(chunkResult.skipCounts)) {
                        clientResult.skipCounts[reason] = (clientResult.skipCounts[reason] || 0) + count;
                    }
                }
                clientResult.errors += chunkResult.errors;
                clientResult.errorDetails.push(...chunkResult.errorDetails);
                if (chunkResult.errorReasonCounts) {
                    for (const [reason, count] of Object.entries(chunkResult.errorReasonCounts)) {
                        clientResult.errorReasonCounts[reason] = (clientResult.errorReasonCounts[reason] || 0) + count;
                    }
                }
                
            } catch (chunkError) {
                logger.error(`Error processing chunk ${i + 1} for client ${client.clientId}: ${chunkError.message}`);
                clientResult.errors++;
                clientResult.errorDetails.push(`Chunk ${i + 1}: ${chunkError.message}`);
            }
        }
        
        clientResult.status = clientResult.errors === 0 ? 'success' : 'completed_with_errors';
        
    } catch (error) {
        clientResult.status = 'failed';
        clientResult.errors++;
        clientResult.errorDetails.push(error.message);
        logger.error(`Failed to process client ${client.clientId}: ${error.message}`);
    }
    
    clientResult.duration = Math.round((new Date() - clientStartTime) / 1000);
    return clientResult;
}

/* =================================================================
    Helper Functions
=================================================================== */

async function loadClientPostScoringConfig(clientBase) {
    // Standard configuration for post scoring - matches postAnalysisService.js structure
    return {
        leadsTableName: 'Leads',
        fields: {
            postsContent: 'Posts Content',
            linkedinUrl: 'LinkedIn Profile URL',
            dateScored: 'Date Posts Scored',
            relevanceScore: 'Posts Relevance Score',
            aiEvaluation: 'Posts AI Evaluation',
            topScoringPost: 'Top Scoring Post'
        },
        attributesTableName: 'Post Scoring Attributes',
        promptComponentsTableName: 'Post Scoring Instructions',
        settingsTableName: 'Credentials'
    };
}

async function getLeadsForPostScoring(clientBase, config, limit) {
    const selectOptions = {
        fields: [
            config.fields.postsContent,
            config.fields.linkedinUrl,
            config.fields.dateScored,
            config.fields.relevanceScore,
            config.fields.aiEvaluation,
            config.fields.topScoringPost
        ],
        view: 'Leads with Posts not yet scored',
        filterByFormula: `AND({${config.fields.dateScored}} = BLANK())`
    };
    
    let records = await clientBase(config.leadsTableName).select(selectOptions).all();
    
    if (typeof limit === 'number' && limit > 0) {
        records = records.slice(0, limit);
        console.log(`Limited to first ${limit} leads`);
    }
    
    return records;
}

async function processPostScoringChunk(records, clientBase, config, clientId, logger, options = {}) {
    const chunkResult = {
        processed: 0,
        scored: 0,
        skipped: 0,
        errors: 0,
        errorDetails: [],
        skipCounts: {},
        errorReasonCounts: {}
    };
    
    logger.process(`Processing ${records.length} leads for post scoring in client ${clientId}`);
    
    for (const leadRecord of records) {
        try {
            chunkResult.processed++;
            
            const result = await analyzeAndScorePostsForLead(leadRecord, clientBase, config, clientId, logger, options);
            
            if (result.status === 'success' || result.status === 'scored') {
                chunkResult.scored++;
            } else if (result.status === 'skipped') {
                chunkResult.skipped++;
                if (result.skipReason) {
                    chunkResult.skipCounts[result.skipReason] = (chunkResult.skipCounts[result.skipReason] || 0) + 1;
                }
                logger.debug(`Lead ${leadRecord.id}: skipped (${result.skipReason || 'UNKNOWN'})`);
            } else if (result.status === 'error') {
                chunkResult.errors++;
                const baseReason = result.reason || 'UNKNOWN_ERROR';
                const category = result.errorCategory ? `${baseReason}:${result.errorCategory}` : baseReason;
                chunkResult.errorReasonCounts[category] = (chunkResult.errorReasonCounts[category] || 0) + 1;
                if (result.error) {
                    chunkResult.errorDetails.push(`Lead ${leadRecord.id}: ${category}: ${result.error}`);
                } else {
                    chunkResult.errorDetails.push(`Lead ${leadRecord.id}: ${category}`);
                }
            }
            
        } catch (leadError) {
            logger.error(`Error processing lead ${leadRecord.id} in client ${clientId}: ${leadError.message}`);
            chunkResult.errors++;
            chunkResult.errorDetails.push(`Lead ${leadRecord.id}: ${leadError.message}`);
        }
    }
    
    return chunkResult;
}

/**
 * Analyze and score posts for a single lead - adapted from postAnalysisService.js
 */
async function analyzeAndScorePostsForLead(leadRecord, clientBase, config, clientId, logger, options = {}) {
    logger.debug(`Analyzing posts for lead ${leadRecord.id} in client ${clientId}`);
    
    // Parse posts content
    const rawPostsContent = leadRecord.fields[config.fields.postsContent];
    if (!rawPostsContent) {
        logger.debug(`Lead ${leadRecord.id}: No posts content, skipping`);
        if (!options.dryRun && options.markSkips !== false) {
            try {
                await clientBase(config.leadsTableName).update(leadRecord.id, {
                    [config.fields.dateScored]: new Date().toISOString(),
                    [config.fields.skipReason]: 'NO_CONTENT'
                });
            } catch (e) { /* field may not exist */ }
        }
        return { status: 'skipped', skipReason: 'NO_CONTENT' };
    }
    
    let parsedPostsArray;
    if (typeof rawPostsContent === 'string') {
        // Use enhanced JSON repair utility
        const repairResult = repairAndParseJson(rawPostsContent);
        
        if (repairResult.success) {
            parsedPostsArray = repairResult.data;
            logger.debug(`Lead ${leadRecord.id}: JSON parsed successfully using method: ${repairResult.method}`);
            
            // Update Posts JSON Status field - simple pass/fail tracking
            const jsonStatus = repairResult.success ? 'Parsed' : 'Failed';
            
            if (!options.dryRun) {
                try {
                    await clientBase(config.leadsTableName).update(leadRecord.id, {
                        'Posts JSON Status': jsonStatus
                    });
                } catch (e) { /* Field might not exist yet */ }
            }
        } else {
            logger.error(`Lead ${leadRecord.id}: All JSON parsing methods failed: ${repairResult.error}`);
            
            // Enhanced diagnostic logging
            logger.debug(`Lead ${leadRecord.id}: Raw JSON length: ${rawPostsContent.length}`);
            logger.debug(`Lead ${leadRecord.id}: First 200 chars: ${rawPostsContent.substring(0, 200)}`);
            logger.debug(`Lead ${leadRecord.id}: Last 200 chars: ${rawPostsContent.substring(rawPostsContent.length - 200)}`);
            
            // Mark as processed with detailed error info
            if (!options.dryRun) {
                await clientBase(config.leadsTableName).update(leadRecord.id, {
                    [config.fields.relevanceScore]: 0,
                    [config.fields.aiEvaluation]: `JSON_PARSE_ERROR: ${repairResult.error}\nJSON Length: ${rawPostsContent.length}\nFirst 200 chars: ${rawPostsContent.substring(0, 200)}`,
                    [config.fields.dateScored]: new Date().toISOString(),
                    'Posts JSON Status': 'Failed'
                });
            }
            return { status: "error", reason: "Unparseable JSON", error: repairResult.error };
        }
    } else if (Array.isArray(rawPostsContent)) {
        parsedPostsArray = rawPostsContent;
        // Mark as parsed if it exists as array
        if (!options.dryRun) {
            try {
                await clientBase(config.leadsTableName).update(leadRecord.id, {
                    'Posts JSON Status': 'Parsed'
                });
            } catch (e) { /* Field might not exist */ }
        }
    } else {
        console.warn(`Lead ${leadRecord.id}: Posts Content field is not a string or array, skipping`);
        if (!options.dryRun) {
            await clientBase(config.leadsTableName).update(leadRecord.id, {
                [config.fields.relevanceScore]: 0,
                [config.fields.aiEvaluation]: "ERROR: Invalid Posts Content field type",
                [config.fields.dateScored]: new Date().toISOString(),
                'Posts JSON Status': 'Failed'
            });
        }
        return { status: "error", reason: "Invalid Posts Content field" };
    }
    
    if (!Array.isArray(parsedPostsArray) || parsedPostsArray.length === 0) {
        console.warn(`Lead ${leadRecord.id}: Parsed Posts Content is not an array or empty, skipping`);
        if (!options.dryRun && options.markSkips !== false) {
            try {
                await clientBase(config.leadsTableName).update(leadRecord.id, {
                    [config.fields.dateScored]: new Date().toISOString(),
                    [config.fields.skipReason]: 'NO_POSTS_PARSED'
                });
            } catch (e) { /* field may not exist */ }
        }
        return { status: 'skipped', skipReason: 'NO_POSTS_PARSED', leadId: leadRecord.id };
    }
    
    // Filter for original posts
    const leadProfileUrl = leadRecord.fields[config.fields.linkedinUrl];
    const originalPosts = filterOriginalPosts(parsedPostsArray, leadProfileUrl);
    
    if (originalPosts.length === 0) {
        console.log(`Lead ${leadRecord.id}: No original posts found, skipping`);
        if (!options.dryRun && options.markSkips !== false) {
            try {
                await clientBase(config.leadsTableName).update(leadRecord.id, {
                    [config.fields.dateScored]: new Date().toISOString(),
                    [config.fields.skipReason]: 'NO_ORIGINAL'
                });
            } catch (e) { /* field may not exist */ }
        }
        return { status: 'skipped', skipReason: 'NO_ORIGINAL', leadId: leadRecord.id };
    }

    try {
        // Load scoring configuration (no global filtering - let attributes handle relevance)
        const config_data = await loadPostScoringAirtableConfig(clientBase, config, logger);
        
        // Score all original posts using client's specific attributes
        logger.process(`Lead ${leadRecord.id}: Scoring all ${originalPosts.length} original posts using client's attribute criteria`);
        
        // Score posts with Gemini
        const systemPrompt = await buildPostScoringPrompt(clientBase, config);
        
        // Configure the Gemini Model instance with the system prompt
        const configuredGeminiModel = POST_BATCH_SCORER_VERTEX_AI_CLIENT.getGenerativeModel({
            model: POST_BATCH_SCORER_GEMINI_MODEL_ID,
            systemInstruction: { parts: [{ text: systemPrompt }] },
            safetySettings: [
                { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
                { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
                { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
                { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
            ],
            generationConfig: { temperature: 0, responseMimeType: "application/json" }
        });
        
        // Prepare input for Gemini
        const geminiInput = { lead_id: leadRecord.id, posts: originalPosts };
        const aiResponseArray = await scorePostsWithGemini(geminiInput, configuredGeminiModel);
        
        // Merge original post data into AI response (matching original)
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
        
        // Find the highest scoring post (matching original logic)
        if (!Array.isArray(aiResponseArray) || aiResponseArray.length === 0) {
            throw new Error("AI response was not a valid or non-empty array of post scores.");
        }

        const highestScoringPost = aiResponseArray.reduce((max, current) => {
            return (current.post_score > max.post_score) ? current : max;
        }, aiResponseArray[0]);

        if (!highestScoringPost || typeof highestScoringPost.post_score === 'undefined') {
             throw new Error("Could not determine the highest scoring post from the AI response.");
        }
        
        logger.process(`Lead ${leadRecord.id}: Highest scoring post has a score of ${highestScoringPost.post_score}`);
        
        // Format top scoring post text (matching original)
        function safeFormatDate(dateStr) {
            if (!dateStr) return "";
            const d = new Date(dateStr);
            return isNaN(d.getTime()) ? dateStr : d.toISOString().replace('T', ' ').substring(0, 16) + ' AEST';
        }
        const topScoringPostText =
            `Date: ${safeFormatDate(highestScoringPost.postDate || highestScoringPost.post_date)}\n` +
            `URL: ${highestScoringPost.postUrl || highestScoringPost.post_url || ''}\n` +
            `Score: ${highestScoringPost.post_score}\n` +
            `Content: ${highestScoringPost.postContent || highestScoringPost.post_content || ''}\n` +
            `Rationale: ${highestScoringPost.scoring_rationale || 'N/A'}`;

        // Update record with scoring results (matching original format exactly)
        if (!options.dryRun) {
            await clientBase(config.leadsTableName).update(leadRecord.id, {
                [config.fields.relevanceScore]: highestScoringPost.post_score,
                [config.fields.aiEvaluation]: JSON.stringify(aiResponseArray, null, 2), // Store the full array for debugging
                [config.fields.topScoringPost]: topScoringPostText,
                [config.fields.dateScored]: new Date().toISOString(),
                ...(options.markSkips !== false ? { [config.fields.skipReason]: '' } : {})
            });
        }
        
        logger.summary(`Lead ${leadRecord.id}: Successfully scored. Final Score: ${highestScoringPost.post_score}`);
        return { status: "success", relevanceScore: highestScoringPost.post_score };

    } catch (error) {
        console.error(`Lead ${leadRecord.id}: Error during AI scoring process. Error: ${error.message}`, error.stack);
        // Improved error/debug messaging in Airtable (matching original)
        const errorDetails = {
            errorMessage: error.message,
            finishReason: error.finishReason || null,
            safetyRatings: error.safetyRatings || null,
            rawResponseSnippet: error.rawResponseSnippet || null,
            timestamp: new Date().toISOString(),
        };
        // Classify error for aggregation
        function classifyAiError(err, details) {
            const msg = (err?.message || '').toLowerCase();
            const finish = (details?.finishReason || '').toLowerCase();
            if (finish.includes('safety') || msg.includes('safety')) return 'SAFETY_BLOCK';
            if (msg.includes('quota') || msg.includes('rate limit')) return 'QUOTA';
            if (msg.includes('timeout') || msg.includes('timed out') || msg.includes('etimedout')) return 'TIMEOUT';
            if (msg.includes('auth') || msg.includes('unauthorized') || msg.includes('permission') || msg.includes('forbidden') || msg.includes('401') || msg.includes('403')) return 'AUTH';
            if (msg.includes('json') || msg.includes('unexpected token') || msg.includes('parse')) return 'AI_RESPONSE_FORMAT';
            if (msg.includes('not found') || msg.includes('model') && msg.includes('invalid')) return 'MODEL_CONFIG';
            return 'UNKNOWN';
        }
        const aiErrorCategory = classifyAiError(error, errorDetails);
        if (!options.dryRun) {
            await clientBase(config.leadsTableName).update(leadRecord.id, {
                [config.fields.aiEvaluation]: `ERROR during AI post scoring: ${JSON.stringify(errorDetails, null, 2)}`,
                [config.fields.dateScored]: new Date().toISOString(),
                ...(options.markSkips !== false ? { [config.fields.skipReason]: '' } : {})
            });
        }
        return { status: "error", reason: 'AI_SCORING_ERROR', errorCategory: aiErrorCategory, error: error.message, leadId: leadRecord.id, errorDetails };
    }
}

// Helper functions from original postAnalysisService.js
function filterOriginalPosts(postsArray, leadProfileUrl) {
    function normalizeUrl(url) {
        if (!url) return '';
        return url.trim().replace(/^https?:\/\//i, '').replace(/\/$/, '').toLowerCase();
    }
    
    const normalizedLeadProfileUrl = normalizeUrl(leadProfileUrl);
    
    return postsArray.filter(post => {
        // Prefer pbMeta.authorUrl, fallback to post.authorUrl (matching original)
        const authorUrl = post?.pbMeta?.authorUrl || post.authorUrl;
        const normalizedAuthorUrl = normalizeUrl(authorUrl);
        const action = post?.pbMeta?.action?.toLowerCase() || '';
        const isOriginal = !action.includes('repost') && normalizedAuthorUrl && normalizedAuthorUrl === normalizedLeadProfileUrl;
        return isOriginal;
    });
}

function chunkArray(array, chunkSize) {
    const chunks = [];
    for (let i = 0; i < array.length; i += chunkSize) {
        chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
}

/* =================================================================
    Exports
=================================================================== */

module.exports = {
    runMultiTenantPostScoring
};
