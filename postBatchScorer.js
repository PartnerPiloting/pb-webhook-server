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
const dirtyJSON = require('dirty-json');
const { alertAdmin } = require('./utils/appHelpers.js');

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
async function runMultiTenantPostScoring(geminiClient, geminiModelId, clientId = null, limit = null) {
    console.log("=== STARTING MULTI-TENANT POST SCORING ===");
    console.log(`Parameters: clientId=${clientId || 'ALL'}, limit=${limit || 'UNLIMITED'}`);
    
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
        totalErrors: 0,
        duration: null,
        clientResults: []
    };

    try {
        // Get list of clients to process
        const clientsToProcess = await clientService.getActiveClients(clientId);
        results.totalClients = clientsToProcess.length;
        
        console.log(`Found ${clientsToProcess.length} client(s) to process for post scoring`);
        
        // Process each client sequentially
        for (const client of clientsToProcess) {
            console.log(`\n--- PROCESSING CLIENT: ${client.clientName} (${client.clientId}) ---`);
            
            try {
                const clientResult = await processClientPostScoring(client, limit);
                results.clientResults.push(clientResult);
                
                if (clientResult.status === 'success') {
                    results.successfulClients++;
                    results.totalPostsProcessed += clientResult.postsProcessed || 0;
                    results.totalPostsScored += clientResult.postsScored || 0;
                } else {
                    results.failedClients++;
                    results.totalErrors += clientResult.errors || 0;
                }
                
                // Log execution for this client
                await clientService.logExecution(client.clientId, {
                    type: 'POST_SCORING',
                    status: clientResult.status,
                    postsProcessed: clientResult.postsProcessed || 0,
                    postsScored: clientResult.postsScored || 0,
                    errors: clientResult.errors || 0,
                    duration: clientResult.duration,
                    errorDetails: clientResult.errorDetails || []
                });
                
            } catch (clientError) {
                console.error(`Failed to process client ${client.clientId}:`, clientError.message);
                
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
        console.error("Global error in multi-tenant post scoring:", globalError.message);
        await alertAdmin("Multi-Tenant Post Scoring Global Error", `Error: ${globalError.message}\nStack: ${globalError.stack}`);
        throw globalError;
    }
    
    // Calculate total duration
    const endTime = new Date();
    results.duration = Math.round((endTime - startTime) / 1000); // seconds
    
    console.log("\n=== MULTI-TENANT POST SCORING SUMMARY ===");
    console.log(`Clients: ${results.successfulClients}/${results.totalClients} successful`);
    console.log(`Posts processed: ${results.totalPostsProcessed}`);
    console.log(`Posts scored: ${results.totalPostsScored}`);
    console.log(`Errors: ${results.totalErrors}`);
    console.log(`Duration: ${results.duration}s`);
    
    return results;
}

/* =================================================================
    Process Single Client Post Scoring
=================================================================== */

async function processClientPostScoring(client, limit) {
    const clientStartTime = new Date();
    const clientResult = {
        clientId: client.clientId,
        clientName: client.clientName,
        status: 'processing',
        postsProcessed: 0,
        postsScored: 0,
        errors: 0,
        errorDetails: [],
        duration: 0
    };
    
    try {
        // Get client-specific Airtable base
        const clientBase = await getClientBase(client.clientId);
        if (!clientBase) {
            throw new Error(`Failed to connect to Airtable base: ${client.airtableBaseId}`);
        }
        
        console.log(`Connected to client base: ${client.airtableBaseId}`);
        
        // Load client-specific configuration
        const config = await loadClientPostScoringConfig(clientBase);
        
        // Get leads with posts to be scored
        const leadsToProcess = await getLeadsForPostScoring(clientBase, config, limit);
        console.log(`Found ${leadsToProcess.length} leads with posts to score for client ${client.clientId}`);
        
        if (leadsToProcess.length === 0) {
            clientResult.status = 'success';
            clientResult.duration = Math.round((new Date() - clientStartTime) / 1000);
            console.log(`No posts to score for client ${client.clientId}`);
            return clientResult;
        }
        
        // Process leads in chunks
        const chunks = chunkArray(leadsToProcess, CHUNK_SIZE);
        console.log(`Processing ${leadsToProcess.length} leads in ${chunks.length} chunk(s) of max ${CHUNK_SIZE}`);
        
        for (let i = 0; i < chunks.length; i++) {
            const chunk = chunks[i];
            console.log(`Processing chunk ${i + 1}/${chunks.length} (${chunk.length} leads) for client ${client.clientId}`);
            
            try {
                const chunkResult = await processPostScoringChunk(chunk, clientBase, config, client.clientId);
                clientResult.postsProcessed += chunkResult.processed;
                clientResult.postsScored += chunkResult.scored;
                clientResult.errors += chunkResult.errors;
                clientResult.errorDetails.push(...chunkResult.errorDetails);
                
            } catch (chunkError) {
                console.error(`Error processing chunk ${i + 1} for client ${client.clientId}:`, chunkError.message);
                clientResult.errors++;
                clientResult.errorDetails.push(`Chunk ${i + 1}: ${chunkError.message}`);
            }
        }
        
        clientResult.status = clientResult.errors === 0 ? 'success' : 'completed_with_errors';
        
    } catch (error) {
        clientResult.status = 'failed';
        clientResult.errors++;
        clientResult.errorDetails.push(error.message);
        console.error(`Failed to process client ${client.clientId}:`, error.message);
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
        settingsTableName: 'Global Settings'
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

async function processPostScoringChunk(records, clientBase, config, clientId) {
    const chunkResult = {
        processed: 0,
        scored: 0,
        errors: 0,
        errorDetails: []
    };
    
    console.log(`Processing ${records.length} leads for post scoring in client ${clientId}`);
    
    for (const leadRecord of records) {
        try {
            chunkResult.processed++;
            
            const result = await analyzeAndScorePostsForLead(leadRecord, clientBase, config, clientId);
            
            if (result.status === 'success' || result.status === 'scored') {
                chunkResult.scored++;
            }
            
        } catch (leadError) {
            console.error(`Error processing lead ${leadRecord.id} in client ${clientId}:`, leadError.message);
            chunkResult.errors++;
            chunkResult.errorDetails.push(`Lead ${leadRecord.id}: ${leadError.message}`);
        }
    }
    
    return chunkResult;
}

/**
 * Analyze and score posts for a single lead - adapted from postAnalysisService.js
 */
async function analyzeAndScorePostsForLead(leadRecord, clientBase, config, clientId) {
    console.log(`Analyzing posts for lead ${leadRecord.id} in client ${clientId}`);
    
    // Parse posts content
    const rawPostsContent = leadRecord.fields[config.fields.postsContent];
    if (!rawPostsContent) {
        console.log(`Lead ${leadRecord.id}: No posts content, skipping`);
        return { status: "skipped", reason: "No posts content" };
    }
    
    let parsedPostsArray;
    if (typeof rawPostsContent === 'string') {
        try {
            parsedPostsArray = JSON.parse(rawPostsContent);
        } catch (parseError) {
            console.warn(`Lead ${leadRecord.id}: JSON.parse failed, attempting dirty-json fallback...`);
            try {
                parsedPostsArray = dirtyJSON.parse(rawPostsContent);
                console.warn(`Lead ${leadRecord.id}: dirty-json succeeded`);
            } catch (dirtyError) {
                console.error(`Lead ${leadRecord.id}: Both JSON.parse and dirty-json failed:`, dirtyError.message);
                return { status: "skipped", reason: "Invalid posts JSON" };
            }
        }
    } else if (Array.isArray(rawPostsContent)) {
        parsedPostsArray = rawPostsContent;
    } else {
        console.warn(`Lead ${leadRecord.id}: Posts Content field is not a string or array, skipping`);
        return { status: "skipped", reason: "Invalid Posts Content field" };
    }
    
    if (!Array.isArray(parsedPostsArray) || parsedPostsArray.length === 0) {
        console.log(`Lead ${leadRecord.id}: No valid posts array, skipping`);
        return { status: "skipped", reason: "No valid posts" };
    }
    
    // Filter for original posts
    const leadProfileUrl = leadRecord.fields[config.fields.linkedinUrl];
    const originalPosts = filterOriginalPosts(parsedPostsArray, leadProfileUrl);
    
    if (originalPosts.length === 0) {
        console.log(`Lead ${leadRecord.id}: No original posts found, skipping`);
        return { status: "skipped", reason: "No original posts" };
    }

    try {
        // Load scoring configuration
        const { aiKeywords } = await loadPostScoringAirtableConfig(clientBase, config);
        
        // Filter for AI-relevant posts
        const relevantPosts = filterRelevantPosts(originalPosts, aiKeywords);
        
        if (relevantPosts.length === 0) {
            console.log(`Lead ${leadRecord.id}: No AI-relevant posts found, marking as scored with 0 relevance`);
            
            let aiEvalMsg = `Scanned ${originalPosts.length} original posts. No relevant AI keywords detected.`;
            
            // Update record to mark as processed (matching original format)
            await clientBase(config.leadsTableName).update(leadRecord.id, {
                [config.fields.relevanceScore]: 0,
                [config.fields.aiEvaluation]: aiEvalMsg,
                [config.fields.dateScored]: new Date().toISOString()
            });
            
            return { status: "scored", relevanceScore: 0 };
        }
        
        // Score posts with Gemini
        console.log(`Lead ${leadRecord.id}: Found ${relevantPosts.length} relevant posts. Proceeding with Gemini scoring.`);
        
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
        const geminiInput = { lead_id: leadRecord.id, posts: relevantPosts };
        const aiResponseArray = await scorePostsWithGemini(geminiInput, configuredGeminiModel);
        
        // Merge original post data into AI response (matching original)
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
        
        console.log(`Lead ${leadRecord.id}: Highest scoring post has a score of ${highestScoringPost.post_score}.`);
        
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
        await clientBase(config.leadsTableName).update(leadRecord.id, {
            [config.fields.relevanceScore]: highestScoringPost.post_score,
            [config.fields.aiEvaluation]: JSON.stringify(aiResponseArray, null, 2), // Store the full array for debugging
            [config.fields.topScoringPost]: topScoringPostText,
            [config.fields.dateScored]: new Date().toISOString()
        });
        
        console.log(`Lead ${leadRecord.id}: Successfully scored. Final Score: ${highestScoringPost.post_score}`);
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
        await clientBase(config.leadsTableName).update(leadRecord.id, {
            [config.fields.aiEvaluation]: `ERROR during AI post scoring: ${JSON.stringify(errorDetails, null, 2)}`,
            [config.fields.dateScored]: new Date().toISOString()
        });
        return { status: "error", error: error.message, leadId: leadRecord.id, errorDetails };
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

function filterRelevantPosts(originalPosts, aiKeywords) {
    const keywordPatterns = aiKeywords.map(keyword => {
        const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        if (escaped.includes(' ')) {
            return new RegExp(`\\b${escaped}s?\\b`, 'i');
        }
        if (escaped.toLowerCase() === 'ai') {
            return new RegExp('\\bAI(\\b|[-\s]?(powered|related|driven|enabled|based|focused|centric|solutions?))\\b', 'i');
        }
        return new RegExp(`\\b${escaped}s?\\b`, 'i');
    });
    
    return originalPosts.filter(post => {
        let text = '';
        if (typeof post === 'string') {
            text = post;
        } else if (post && typeof post === 'object' && post.postContent) {
            text = post.postContent;
        }
        
        if (!text) return false;
        
        return keywordPatterns.some(pattern => pattern.test(text));
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
