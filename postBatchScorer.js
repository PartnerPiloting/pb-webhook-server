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
        // Collect diagnostics only if verboseErrors flag is on
        const diagnosticsCollector = options.verboseErrors ? { errors: [] } : null;
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
            clientResults: [],
            diagnostics: undefined
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
                const clientResult = await processClientPostScoring(client, limit, clientLogger, { ...options, diagnosticsCollector });
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

    // Attach diagnostics BEFORE returning (previously unreachable after early return)
    if (options.verboseErrors && diagnosticsCollector) {
        results.diagnostics = {
            projectId: process.env.GCP_PROJECT_ID || null,
            location: process.env.GCP_LOCATION || null,
            model: POST_BATCH_SCORER_GEMINI_MODEL_ID,
            envDefined: {
                GCP_PROJECT_ID: !!process.env.GCP_PROJECT_ID,
                GCP_LOCATION: !!process.env.GCP_LOCATION,
                GEMINI_MODEL_ID: !!POST_BATCH_SCORER_GEMINI_MODEL_ID
            },
            errorsSample: diagnosticsCollector.errors.slice(0, options.maxVerboseErrors || 10)
        };
    }
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
    const leadsToProcess = await getLeadsForPostScoring(clientBase, config, limit, options);
        logger.setup(`Found ${leadsToProcess.length} leads with posts to score for client ${client.clientId}`);
        console.log(`[DEBUG] Client ${client.clientId}: Found ${leadsToProcess.length} leads for scoring`);
        if (leadsToProcess.length > 0) {
            console.log(`[DEBUG] Client ${client.clientId}: Sample lead fields:`, Object.keys(leadsToProcess[0].fields || {}));
        }

        // Build the post scoring prompt ONCE per client batch (cache for this run)
        // This avoids rebuilding the same ~15K char prompt for every lead.
        let prebuiltPrompt = null;
        try {
            prebuiltPrompt = await buildPostScoringPrompt(clientBase, config);
            logger.setup(`Built post scoring prompt once for client ${client.clientId} (length=${prebuiltPrompt.length})`);
        } catch (e) {
            logger.error(`Failed to build prebuilt prompt (will fallback per-lead): ${e.message}`);
        }
        
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
                const chunkResult = await processPostScoringChunk(
                    chunk,
                    clientBase,
                    config,
                    client.clientId,
                    logger,
                    { ...options, prebuiltPrompt }
                );
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

// Safely update a lead record; if Airtable rejects an unknown skip reason field,
// retry without that field so we still persist scoring results and date.
async function safeLeadUpdate(clientBase, tableName, recordId, fields, skipReasonFieldName) {
    try {
        return await clientBase(tableName).update(recordId, fields);
    } catch (err) {
        const msg = (err && err.message) || '';
        if (skipReasonFieldName && msg.includes(skipReasonFieldName)) {
            // Remove the skip reason field and retry once
            const cloned = { ...fields };
            delete cloned[skipReasonFieldName];
            try {
                return await clientBase(tableName).update(recordId, cloned);
            } catch (e2) {
                // Re-throw original context with note
                throw new Error(`${msg} (and retry without '${skipReasonFieldName}' also failed: ${e2.message})`);
            }
        }
        throw err;
    }
}

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

async function getLeadsForPostScoring(clientBase, config, limit, options = {}) {
    // If explicit targetIds provided, use them directly (bypass view path)
    if (Array.isArray(options.targetIds) && options.targetIds.length > 0) {
        const ids = options.targetIds.slice(0, Math.max(1, limit || options.targetIds.length));
        const found = [];
        for (const id of ids) {
            try {
                const recs = await clientBase(config.leadsTableName).select({
                    filterByFormula: `RECORD_ID() = '${id}'`,
                    fields: [
                        config.fields.postsContent,
                        config.fields.linkedinUrl,
                        config.fields.dateScored,
                        config.fields.relevanceScore,
                        config.fields.aiEvaluation,
                        config.fields.topScoringPost
                    ],
                    maxRecords: 1
                }).firstPage();
                if (recs && recs[0]) found.push(recs[0]);
            } catch (e) {
                console.warn(`[postBatchScorer] Failed to fetch record by id ${id}: ${e.message}`);
            }
        }
        return found;
    }

    // Primary: try using the named view (many bases have it), plus a safety filter to ensure unscored
    const primarySelect = {
        fields: [
            config.fields.postsContent,
            config.fields.linkedinUrl,
            config.fields.dateScored,
            config.fields.relevanceScore,
            config.fields.aiEvaluation,
            config.fields.topScoringPost
        ],
        view: 'Leads with Posts not yet scored',
    filterByFormula: options.forceRescore ? undefined : `AND({${config.fields.dateScored}} = BLANK())`
    };

    let records = [];
    let usedFallback = false;
    try {
        console.log(`[DEBUG] getLeadsForPostScoring: Trying primary select with view "Leads with Posts not yet scored"`);
        records = await clientBase(config.leadsTableName).select(primarySelect).all();
        console.log(`[DEBUG] getLeadsForPostScoring: Primary select found ${records.length} records`);
    } catch (e) {
        console.log(`[DEBUG] getLeadsForPostScoring: Primary select failed: ${e.message}`);
        // If the view doesn't exist on this tenant, fall back to a formula-only query below
        console.warn(`[postBatchScorer] Primary select using view failed: ${e.message}. Falling back to formula-only selection.`);
    }

    // Fallback: if no records found (or view missing), query by formula only:
    // - Must have Posts Content not blank
    // - Date Posts Scored blank
    // - Posts Actioned blank/false when field exists
    if (!Array.isArray(records) || records.length === 0) {
        console.log(`[DEBUG] getLeadsForPostScoring: Using fallback formula-based query`);
        usedFallback = true;
        const postsActionedField = 'Posts Actioned';
        // Attempt 1: include Posts Actioned guard
        const actionedGuard = `OR({${postsActionedField}} = 0, {${postsActionedField}} = '', {${postsActionedField}} = BLANK())`;
        const baseFields = [
            config.fields.postsContent,
            config.fields.linkedinUrl,
            config.fields.dateScored,
            config.fields.relevanceScore,
            config.fields.aiEvaluation,
            config.fields.topScoringPost
        ];
        const makeFilter = (withActioned) => {
            const dateClause = options.forceRescore ? 'TRUE()' : `{${config.fields.dateScored}} = BLANK()`;
            return withActioned
                ? `AND({${config.fields.postsContent}} != '', ${dateClause}, ${actionedGuard})`
                : `AND({${config.fields.postsContent}} != '', ${dateClause})`;
        };

        try {
            console.log(`[DEBUG] getLeadsForPostScoring: Trying fallback with Posts Actioned guard`);
            records = await clientBase(config.leadsTableName).select({
                fields: baseFields,
                filterByFormula: makeFilter(true)
            }).all();
            console.log(`[DEBUG] getLeadsForPostScoring: Fallback with guard found ${records.length} records`);
        } catch (e2) {
            console.log(`[DEBUG] getLeadsForPostScoring: Fallback with guard failed: ${e2.message}`);
            // If "Posts Actioned" is missing on this base, retry without referencing it
            const msg = e2?.message || String(e2);
            console.warn(`[postBatchScorer] Fallback select with actioned guard failed: ${msg}. Retrying without Posts Actioned condition.`);
            try {
                console.log(`[DEBUG] getLeadsForPostScoring: Trying fallback without Posts Actioned guard`);
                records = await clientBase(config.leadsTableName).select({
                    fields: baseFields,
                    filterByFormula: makeFilter(false)
                }).all();
                console.log(`[DEBUG] getLeadsForPostScoring: Fallback without guard found ${records.length} records`);
            } catch (e3) {
                console.log(`[DEBUG] getLeadsForPostScoring: All fallback attempts failed: ${e3.message}`);
                console.error(`[postBatchScorer] Fallback select without actioned guard also failed: ${e3.message}`);
                records = [];
            }
        }
    }

    if (typeof limit === 'number' && limit > 0 && Array.isArray(records)) {
        console.log(`[DEBUG] getLeadsForPostScoring: Applying limit ${limit} to ${records.length} records`);
        records = records.slice(0, limit);
        console.log(`[postBatchScorer] Limiting batch to first ${limit} leads (${usedFallback ? 'fallback' : 'view'} mode)`);
    }

    console.log(`[DEBUG] getLeadsForPostScoring: Final result: ${records.length} records`);
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
                    if (options.verboseErrors && options.diagnosticsCollector && result.errorDetails) {
                        const signature = `${result.errorDetails.errorMessage || result.error}:${result.errorCategory || ''}:${baseReason}`;
                        const existing = options.diagnosticsCollector.errors.find(e => e.signature === signature);
                        if (!existing) {
                            options.diagnosticsCollector.errors.push({
                                signature,
                                leadId: leadRecord.id,
                                reason: baseReason,
                                category: result.errorCategory || null,
                                message: result.errorDetails.errorMessage || result.error,
                                code: result.errorDetails.code || null,
                                finishReason: result.errorDetails.finishReason || null,
                                model: POST_BATCH_SCORER_GEMINI_MODEL_ID,
                                projectId: process.env.GCP_PROJECT_ID || null,
                                location: process.env.GCP_LOCATION || null,
                                stackSnippet: result.errorDetails.stackSnippet || null,
                                rawKeys: result.errorDetails.rawKeys || null,
                                timestamp: result.errorDetails.timestamp || new Date().toISOString()
                            });
                        }
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
    
    // Use ALL posts (including reposts) for scoring to match single-lead behavior
    const leadProfileUrl = leadRecord.fields[config.fields.linkedinUrl];
    const allPosts = parsedPostsArray;

    try {
    // Load scoring configuration (no global filtering - let attributes handle relevance)
    const config_data = await loadPostScoringAirtableConfig(clientBase, config, logger);

    // Score all posts (originals + reposts) using client's specific attributes
    logger.process(`Lead ${leadRecord.id}: Scoring all ${allPosts.length} posts (including reposts) using client's attribute criteria`);

    // Use prebuilt prompt if provided (per-client batch cache), else build on demand
    const systemPrompt = options.prebuiltPrompt || await buildPostScoringPrompt(clientBase, config);
        
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
        const geminiInput = { lead_id: leadRecord.id, posts: allPosts };
        const aiResponseArray = await scorePostsWithGemini(geminiInput, configuredGeminiModel);
        
        // Merge original post data into AI response (now including reposts)
        function normalizePostUrl(u) {
            if (!u) return '';
            let s = String(u).trim().toLowerCase();
            s = s.replace(/^https?:\/\//, '').replace(/^www\./, '');
            s = s.split('?')[0].split('#')[0];
            // Remove trailing slash
            s = s.replace(/\/$/, '');
            // Remove trailing underscores sometimes appended to LinkedIn share URLs
            s = s.replace(/_+$/, '');
            return s;
        }
        const postUrlToOriginal = {};
        const activityIdToOriginal = {};
        function extractLinkedInActivityId(u) {
            if (!u) return null;
            const s = String(u).toLowerCase();
            // Common patterns: activity-<digits>, urn:li:activity:<digits>, or -<digits>- in posts slug
            let m = s.match(/activity[-/:](\d{8,})/);
            if (m) return m[1];
            m = s.match(/-(\d{8,})-/);
            if (m) return m[1];
            return null;
        }
        for (const post of allPosts) {
            const url = post.postUrl || post.post_url;
            const key = normalizePostUrl(url);
            if (key) postUrlToOriginal[key] = post;
            const actId = extractLinkedInActivityId(url);
            if (actId) activityIdToOriginal[actId] = post;
        }
        // Extract best-effort post timestamp from various shapes
        function extractBestPostDate(primary, secondary) {
            const candidates = [];
            function pushFrom(obj) {
                if (!obj || typeof obj !== 'object') return;
                const pa = obj.postedAt;
                if (pa !== undefined && pa !== null) {
                    if (typeof pa === 'object') {
                        candidates.push(pa.timestamp, pa.date, pa.ms, pa.value);
                    } else if (typeof pa === 'number') {
                        candidates.push(pa);
                    } else if (typeof pa === 'string') {
                        const num = Number(pa);
                        candidates.push(!Number.isNaN(num) ? num : pa);
                    }
                }
                candidates.push(
                    obj.postDate,
                    obj.post_date,
            obj.postTimestamp,
            obj.post_time,
                    obj.publishedAt,
                    obj.time,
                    obj.date,
                    obj.createdAt,
                    obj.timestamp
                );
            }
            pushFrom(primary || {});
            pushFrom(secondary || {});
            const found = candidates.find(v => v && String(v).trim());
            return found || '';
        }
        // Helpers for robust author vs. lead matching
        function extractLinkedInPublicId(url) {
            try {
                const m = String(url || '').match(/linkedin\.com\/in\/([^\/?#]+)/i);
                return m ? m[1].toLowerCase() : null;
            } catch (_) {
                return null;
            }
        }
        function deepNormalizeLinkedInUrl(url) {
            if (!url) return '';
            let s = String(url).trim().toLowerCase();
            s = s.replace(/^https?:\/\//, '').replace(/^www\./, '');
            // Drop query/hash
            s = s.split('?')[0].split('#')[0];
            // Remove recent-activity suffixes
            s = s.replace(/\/recent-activity\/.*/,'');
            // Remove trailing slash
            s = s.replace(/\/$/, '');
            return s;
        }
        // Attach content/date and author metadata to each AI response object
        aiResponseArray.forEach(resp => {
            const respUrl = resp.post_url || resp.postUrl || '';
            const key = normalizePostUrl(respUrl);
            let orig = key ? (postUrlToOriginal[key] || {}) : {};
            if (!orig || Object.keys(orig).length === 0) {
                const rid = extractLinkedInActivityId(respUrl);
                if (rid && activityIdToOriginal[rid]) orig = activityIdToOriginal[rid];
            }
            // Prefer source content; if not found, keep AI-provided content to avoid blanks
            const mergedContent = (orig.postContent || orig.post_content || resp.post_content || resp.postContent || '');
            resp.post_content = mergedContent;
            resp.postDate = extractBestPostDate(orig, resp);
            // Propagate author metadata for UI/reporting (original author vs lead)
            resp.authorUrl = (orig.pbMeta && orig.pbMeta.authorUrl) || orig.authorUrl || resp.authorUrl || '';
            resp.authorName = (orig.pbMeta && orig.pbMeta.authorName) || orig.author || resp.authorName || '';
            // Determine if the item is a repost (reduce false positives)
            const action = (orig.pbMeta && orig.pbMeta.action) || orig.action || '';
            const a = String(action || '').toLowerCase();
            // Extract canonical identifiers and normalized roots once
            const leadId = extractLinkedInPublicId(leadProfileUrl);
            const authorId = extractLinkedInPublicId(resp.authorUrl);
            const normLead = deepNormalizeLinkedInUrl(leadProfileUrl);
            const normAuth = deepNormalizeLinkedInUrl(resp.authorUrl);
            const isSameAuthor = (leadId && authorId) ? (leadId === authorId) : ((normLead && normAuth) ? (normLead === normAuth) : false);

            // Primary signal from source (explicit action), but override if the author is the lead
            let isRepost = a.includes('repost');
            if (isSameAuthor) {
                // Override any explicit repost flag when it's clearly the same person
                isRepost = false;
            } else if (!a.includes('repost')) {
                // Heuristic: when not explicitly a repost, treat as repost only if author differs from lead
                if (leadId && authorId) {
                    isRepost = leadId !== authorId;
                } else if (normLead && normAuth) {
                    isRepost = normLead !== normAuth;
                } else {
                    isRepost = false;
                }
            }
            resp.isRepost = isRepost;
            // If not a repost and authorUrl missing, default to the lead's profile (avoid '(unknown)')
            if (!resp.isRepost && (!resp.authorUrl || !resp.authorUrl.trim())) {
                resp.authorUrl = leadProfileUrl || '';
            }
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
            if (dateStr === undefined || dateStr === null || dateStr === '') return "";
            // Allow epoch ms (number) or numeric-like string
            let d;
            if (typeof dateStr === 'number') {
                d = new Date(dateStr);
            } else if (typeof dateStr === 'string' && /^\d{10,}$/.test(dateStr.trim())) {
                d = new Date(Number(dateStr.trim()));
            } else {
                d = new Date(dateStr);
            }
            return isNaN(d.getTime()) ? dateStr : d.toISOString().replace('T', ' ').substring(0, 16) + ' AEST';
        }
        // If repost wins, include Original Author banner like single-lead path
        const isRepostWinner = Boolean(highestScoringPost.isRepost);
        const originalAuthorUrl = (highestScoringPost.authorUrl || '').trim();
        const originalAuthorLine = isRepostWinner
            ? `REPOST - ORIGINAL AUTHOR: ${originalAuthorUrl || '(unknown)'}\n`
            : '';
        const topScoringPostText =
            `Date: ${safeFormatDate(highestScoringPost.postDate || highestScoringPost.post_date)}\n` +
            `URL: ${highestScoringPost.postUrl || highestScoringPost.post_url || ''}\n` +
            `Score: ${highestScoringPost.post_score}\n` +
            (originalAuthorLine) +
            `Content: ${highestScoringPost.postContent || highestScoringPost.post_content || ''}\n` +
            `Rationale: ${highestScoringPost.scoring_rationale || 'N/A'}`;

        // Update record with scoring results (matching original format exactly)
        if (!options.dryRun) {
            await safeLeadUpdate(
                clientBase,
                config.leadsTableName,
                leadRecord.id,
                {
                    [config.fields.relevanceScore]: highestScoringPost.post_score,
                    [config.fields.aiEvaluation]: JSON.stringify(aiResponseArray, null, 2), // Store the full array for debugging
                    [config.fields.topScoringPost]: topScoringPostText,
                    [config.fields.dateScored]: new Date().toISOString(),
                    ...(options.markSkips !== false ? { [config.fields.skipReason]: '' } : {})
                },
                options.markSkips !== false ? config.fields.skipReason : null
            );
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
            code: error.code || null,
            stackSnippet: error.stack ? error.stack.split('\n').slice(0,5).join('\n') : null,
            rawKeys: Object.keys(error || {}).slice(0,15)
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
            await safeLeadUpdate(
                clientBase,
                config.leadsTableName,
                leadRecord.id,
                {
                    [config.fields.aiEvaluation]: `ERROR during AI post scoring: ${JSON.stringify(errorDetails, null, 2)}`,
                    [config.fields.dateScored]: new Date().toISOString(),
                    ...(options.markSkips !== false ? { [config.fields.skipReason]: '' } : {})
                },
                options.markSkips !== false ? config.fields.skipReason : null
            );
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
