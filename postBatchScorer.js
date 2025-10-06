// =====================================================
// PERMANENT SOLUTION - JOB RUNNING BYPASS ENABLED
// This version permanently bypasses job running checks
// to avoid issues with job locking in the client service.
// This is the chosen permanent solution rather than
// replacing it with an alternative approach.
// ===================================================== // batchScorer.js - MULTI-TENANT SUPPORT: Added client iteration, per-client logging, error isolation

require("dotenv").config(); 

const { HarmCategory, HarmBlockThreshold } = require('@google-cloud/vertexai');

// --- Multi-Tenant Dependencies ---
const clientService = require('./services/clientService');
const { getClientBase } = require('./config/airtableClient');

// --- Repository Layer Dependencies ---
const JobTracking = require('./services/jobTracking');
const runIdSystem = require('./services/runIdSystem');

// --- Post Scoring Dependencies ---
const { loadPostScoringAirtableConfig } = require('./postAttributeLoader');
const { buildPostScoringPrompt } = require('./postPromptBuilder');
const { scorePostsWithGemini } = require('./postGeminiScorer');
const { parsePlainTextPosts } = require('./utils/parsePlainTextPosts');
const { repairAndParseJson } = require('./utils/jsonRepair');
const { alertAdmin } = require('./utils/appHelpers.js');

// --- Structured Logging ---
const { createLogger } = require('./utils/unifiedLoggerFactory');

// --- Field Validation ---
const { FIELD_NAMES, createValidatedObject } = require('./utils/airtableFieldValidator');
// Import CLIENT_RUN_STATUS_VALUES from the unified constants for status handling
const { CLIENT_RUN_STATUS_VALUES } = require('./constants/airtableUnifiedConstants');
// FIXED: Import our runIdValidator utility
const { validateAndNormalizeRunId, validateAndNormalizeClientId } = require('./utils/runIdValidator');

// --- Centralized Dependencies (will be passed into 'run' function) ---
let POST_BATCH_SCORER_VERTEX_AI_CLIENT;
let POST_BATCH_SCORER_GEMINI_MODEL_ID;

/* ---------- ENV CONFIGURATION for Post Batch Scorer Operations ----------- */
const CHUNK_SIZE = Math.max(1, parseInt(process.env.POST_BATCH_CHUNK_SIZE || "10", 10));
const VERBOSE = process.env.VERBOSE_POST_SCORING === "true"; // default = false - only show debug logs when explicitly enabled
const GEMINI_TIMEOUT_MS = Math.max(30000, parseInt(process.env.GEMINI_TIMEOUT_MS || "120000", 10));

/* =================================================================
    Multi-Tenant Post Scoring Main Function
=================================================================== */

/**
 * Main multi-tenant post scoring function
 * @param {Object} geminiClient - Initialized Vertex AI client
 * @param {string} geminiModelId - Gemini model ID to use
 * @param {string} runId - The run ID for job tracking (REQUIRED)
 * @param {string} clientId - Optional specific client ID to process
 * @param {number} limit - Optional limit on posts to process per client
 * @returns {Object} - Summary of execution across all clients
 */
async function runMultiTenantPostScoring(geminiClient, geminiModelId, runId, clientId = null, limit = null, options = {}) {
    // Validate required runId
    if (!runId) {
        throw new Error('Run ID is required for post scoring operations');
    }
    
    // FIX: Initialize normalizedRunId at the beginning of the function
    // This ensures it's available throughout the entire function scope
    let normalizedRunId;
    try {
        normalizedRunId = runId;
    } catch (error) {
        // Fallback to original runId if normalization fails
        normalizedRunId = runId;
    }
    
    // Create system-level logger for multi-tenant operations using safe creation
    const systemLogger = createSafeLogger('SYSTEM', null, 'post_batch_scorer');
    
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
            // Create client-specific logger with shared session ID using safe creation
            const clientLogger = createSafeLogger(client.clientId, systemLogger.getSessionId(), 'post_batch_scorer');
            clientLogger.setup(`--- PROCESSING CLIENT: ${client.clientName} (${client.clientId}) ---`);
            
            try {
                // Explicitly pass the normalized runId to ensure consistency
                // FIX: Added defensive check to ensure normalizedRunId is always defined
                if (!normalizedRunId) {
                    clientLogger.warn(`normalizedRunId was undefined, using fallback runId: ${runId}`);
                    normalizedRunId = runId;
                }
                
                const clientResult = await processClientPostScoring(client, limit, clientLogger, { 
                    ...options, 
                    diagnosticsCollector,
                    runId: normalizedRunId  // Ensure consistent runId usage
                });
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
                const clientLogger = createSafeLogger(client.clientId, systemLogger.getSessionId(), 'post_batch_scorer');
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
        duration: 0,
        totalTokensUsed: 0 // Add missing token tracking field
    };
    
    // Special debugging for Guy Wilson
    if (client.clientId === 'Guy-Wilson' && process.env.VERBOSE_POST_SCORING === "true") {
        console.log(`[POST_DEBUG] 🚨🚨🚨 SPECIAL FOCUS: Starting post scoring process for Guy Wilson`);
    }
    
    // PERMANENT BYPASS - Skip job running check as we're now permanently bypassing the lock
    if (process.env.VERBOSE_POST_SCORING === "true") {
        console.log(`[POST_DEBUG] Using permanent job lock bypass`);
    }
    
    try {
        // ROOT CAUSE FIX: Extract runId from options - it was previously undefined
        const inputRunId = options.runId || null;
        logger.debug(`Received runId from options: ${inputRunId}`);
        
        // Use the validated runId passed from the parent function to ensure consistency
        // This ensures we use the same runId throughout the system
        let normalizedRunId;
        try {
            normalizedRunId = inputRunId ? inputRunId : `post_batch_${Date.now()}`;
            logger.info(`Using normalized runId: ${normalizedRunId} (original: ${inputRunId || 'not provided'})`);
        } catch (error) {
            logger.error(`Error normalizing runId: ${error.message}. Using fallback.`);
            normalizedRunId = `post_batch_${Date.now()}`;
        }
        
        // Pass the normalized runId to child operations
        options.runId = normalizedRunId;
        
        // For backward compatibility during transition
        options.standardizedRunId = normalizedRunId;
        
        if (process.env.VERBOSE_POST_SCORING === "true") {
            console.log(`[POST_DEBUG] Setting job status to RUNNING with normalized ID: ${normalizedRunId}`);
        }
        
        try {
            // First try to reset any existing job
            await clientService.setJobStatus(client.clientId, 'post_scoring', 'COMPLETED', 'force_reset_for_testing');
            if (process.env.VERBOSE_POST_SCORING === "true") {
                console.log(`[POST_DEBUG] Forcibly reset any existing job status`);
            }
        } catch (resetError) {
            if (process.env.VERBOSE_POST_SCORING === "true") {
                console.log(`[POST_DEBUG] Could not reset existing job: ${resetError.message}`);
            }
        }
        
        // Then set new job status
        await clientService.setJobStatus(client.clientId, 'post_scoring', 'RUNNING', jobId);
        
        if (process.env.VERBOSE_POST_SCORING === "true") {
            console.log(`[POST_DEBUG] Successfully set job status to RUNNING`);
        }
        
        logger.setup(`Set job status to RUNNING for client ${client.clientId}`);
    } catch (jobError) {
        logger.warn(`Could not check/set job status: ${jobError.message}`);
        console.warn(`[WARN] Could not check/set job status for ${client.clientId}: ${jobError.message}`);
    }
    
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
        
        // Check if Posts Skip Reason field exists in this client base
        let hasSkipReasonField = false;
        try {
            // Get a sample record to check fields
            const sampleRec = await clientBase(config.leadsTableName).select({ maxRecords: 1 }).firstPage();
            // Check if field exists in field list (different from having a value)
            if (sampleRec && sampleRec[0]) {
                const fieldNames = Object.keys(sampleRec[0].fields || {});
                hasSkipReasonField = fieldNames.includes('Posts Skip Reason');
                if (process.env.VERBOSE_POST_SCORING === "true") {
                    console.log(`[POST_DEBUG] Field check for 'Posts Skip Reason': ${hasSkipReasonField ? 'exists' : 'missing'}`);
                }
            }
        } catch (fieldCheckErr) {
            if (process.env.VERBOSE_POST_SCORING === "true") {
                console.log(`[POST_DEBUG] Error checking for field existence: ${fieldCheckErr.message}`);
            }
            hasSkipReasonField = false; // Be safe and assume it doesn't exist
        }
        
        // Only add skip reason field to config if it exists
        if (hasSkipReasonField) {
            config.fields.skipReason = 'Posts Skip Reason';
        } else {
            if (process.env.VERBOSE_POST_SCORING === "true") {
                console.log(`[POST_DEBUG] 'Posts Skip Reason' field not found in this client base, skipping updates to this field`);
            }
            // Set to null to indicate field doesn't exist (different from undefined)
            config.fields.skipReason = null;
        }
        
        // Get leads with posts to be scored - reduce debug logging
        if (process.env.VERBOSE_POST_SCORING === "true") {
            console.log(`[POST_DEBUG] CLIENT ${client.clientId}: Starting to look for leads with posts to be scored`);
        }
        logger.setup(`Looking for leads with posts to score for client ${client.clientId} (${client.clientName})`);
        
        // Special debug for Guy Wilson client - only in verbose mode
        if (client.clientId === 'Guy-Wilson' && process.env.VERBOSE_POST_SCORING === "true") {
            console.log(`[POST_DEBUG] SPECIAL FOCUS: Processing Guy Wilson client`);
        }
        
        const leadsToProcess = await getLeadsForPostScoring(clientBase, config, limit, options);
        
        logger.setup(`Found ${leadsToProcess.length} leads with posts to score for client ${client.clientId}`);
        
        if (process.env.VERBOSE_POST_SCORING === "true") {
            console.log(`[POST_DEBUG] 🔢 CLIENT ${client.clientId} (${client.clientName}): Found ${leadsToProcess.length} leads with posts to score`);
        }
        
        // Special debug for Guy Wilson client
        if (client.clientId === 'Guy-Wilson' && process.env.VERBOSE_POST_SCORING === "true") {
            console.log(`[POST_DEBUG] 🚨 SPECIAL FOCUS: Guy Wilson has ${leadsToProcess.length} leads for post scoring`);
        }
        
        if (leadsToProcess.length === 0) {
            // No leads to process, complete with success but 0 scored
            logger.summary(`No posts to score for client ${client.clientId} (${client.clientName})`);
            
            if (process.env.VERBOSE_POST_SCORING === "true") {
                console.log(`[POST_DEBUG] ℹ️ CLIENT ${client.clientId} (${client.clientName}): No leads with posts to score found`);
            }
            
            // Special debug for Guy Wilson client
            if (client.clientId === 'Guy-Wilson' && process.env.VERBOSE_POST_SCORING === "true") {
                console.log(`[POST_DEBUG] 🚨🚨 SPECIAL FOCUS: Guy Wilson has NO leads with posts to score. Check if posts are being properly harvested.`);
            }
            
            clientResult.status = 'success';
            clientResult.duration = Math.round((new Date() - clientStartTime) / 1000);
            return clientResult;
        } else if (process.env.VERBOSE_POST_SCORING === "true") {
            console.log(`[POST_DEBUG] 📋 CLIENT ${client.clientId}: Sample lead fields:`, Object.keys(leadsToProcess[0].fields || {}));
            
            // Log more details about first few leads for debugging
            const maxToLog = Math.min(3, leadsToProcess.length);
            console.log(`[POST_DEBUG] 📝 First ${maxToLog} leads to process:`);
            for (let i = 0; i < maxToLog; i++) {
                const lead = leadsToProcess[i];
                console.log(`[POST_DEBUG]   - Lead ${i+1}: ID=${lead.id}, Name=${lead.fields['Full Name'] || 'Unknown'}`);
                // Check key fields
                console.log(`[POST_DEBUG]     Has posts content: ${!!lead.fields[config.fields.postsContent]}`);
                console.log(`[POST_DEBUG]     Already scored: ${!!lead.fields[config.fields.dateScored]}`);
            }
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
                
                // Track token usage from chunk
                if (chunkResult.totalTokensUsed) {
                    clientResult.totalTokensUsed += chunkResult.totalTokensUsed;
                    logger.debug(`Chunk ${i + 1}: Added ${chunkResult.totalTokensUsed} tokens, cumulative total: ${clientResult.totalTokensUsed}`);
                }
                
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
        
        // Always update metrics in Client Run Results table using the normalized runId
        try {
            // Use the normalized runId consistently that was passed from the parent function
            // This ensures we're updating the same record that was created in apiAndJobRoutes.js
            const processRunId = options.runId;
            
            // If we don't have any valid ID, don't try to update metrics
            if (!processRunId) {
                logger.warn(`No valid run ID available for client ${client.clientId}, skipping metrics update`);
                return clientResult;
            }
            
            logger.process(`Updating post scoring metrics for client ${client.clientId} using run ID: ${processRunId}`);
            
            // Add client suffix to the normalized runId for client-specific records
            const clientSpecificRunId = runIdSystem.createClientRunId(
                runIdSystem.getBaseRunId(processRunId),
                client.clientId
            );
                
                // Update metrics in the Client Run Results table
                console.log(`[DEBUG-METRICS] PREPARING TO UPDATE POST METRICS for ${client.clientId}`);
                console.log(`[DEBUG-METRICS] - Run ID: ${clientSpecificRunId}`);
                console.log(`[DEBUG-METRICS] - Posts Examined for Scoring: ${clientResult.postsProcessed}`);
                console.log(`[DEBUG-METRICS] - Posts Successfully Scored: ${clientResult.postsScored}`);
                console.log(`[DEBUG-METRICS] - Status: ${clientResult.status}`);
                
                // Add post scoring tokens to the update
                const postScoringTokens = clientResult.totalTokensUsed || 0;
                console.log(`[DEBUG-METRICS] - Post Scoring Tokens to be updated: ${postScoringTokens}`);
                
                // Log if token tracking is properly implemented
                if (postScoringTokens > 0) {
                    console.log(`[DEBUG-METRICS] ✅ Token tracking is WORKING! ${postScoringTokens} tokens used.`);
                } else {
                    console.log(`[DEBUG-METRICS] ❌ WARNING: Token tracking still shows 0 tokens!`);
                    console.log(`[DEBUG-METRICS] - clientResult.totalTokensUsed: ${clientResult.totalTokensUsed}`);
                }
                
                logger.debug(`Updating run record for client ${client.clientId} with run ID ${clientSpecificRunId}`);
                
                try {
                    // Use the new metrics helper for more consistent updates
                    const { updatePostScoringMetrics } = require('./utils/postScoringMetricsHelper');
                    const updateResult = await updatePostScoringMetrics({
                        runId: clientSpecificRunId,
                        clientId: client.clientId,
                        metrics: {
                            postsExamined: clientResult.postsProcessed || 0,
                            postsScored: clientResult.postsScored || 0,
                            tokensUsed: postScoringTokens || 0,
                            errors: clientResult.errors || 0,
                            errorDetails: clientResult.errorDetails || [],
                            leadsSkipped: clientResult.leadsSkipped || 0
                        },
                        logger
                    });
                    
                    if (updateResult.success) {
                        logger.debug(`Successfully updated run record for client ${client.clientId}`);
                    } else {
                        logger.warn(`Partial update of metrics for client ${client.clientId}: ${updateResult.error}`);
                    }
                } catch (error) {
                    logger.error(`Failed to update run record for client ${client.clientId}: ${error.message}`, { 
                        runId: standardizedRunId || clientSpecificRunId,
                        errorMessage: error.message
                    });
                    // Don't fail the entire process just because metrics couldn't be updated
                    console.error(`[METRICS_UPDATE_ERROR] Failed to update client run metrics: ${error.message}`);
                }
                
                logger.summary(`Successfully updated post scoring metrics in Client Run Results table`);
                console.log(`[DEBUG-METRICS] POST METRICS UPDATE COMPLETED for ${client.clientId}`);
            } catch (metricsError) {
                logger.error(`Failed to update metrics: ${metricsError.message}`);
                console.error(`[POST_METRICS_ERROR] Failed to update metrics for ${client.clientId}: ${metricsError.message}`);
                // Continue execution even if metrics update fails
            }
        
    } catch (error) {
        clientResult.status = 'failed';
        clientResult.errors++;
        clientResult.errorDetails.push(error.message);
        logger.error(`Failed to process client ${client.clientId}: ${error.message}`);
    }
    
    // Calculate duration
    clientResult.duration = Math.round((new Date() - clientStartTime) / 1000);
    
    // Complete client processing after post scoring
    try {
        if (process.env.VERBOSE_POST_SCORING === "true") {
            console.log(`[POST_DEBUG] Completing processing for client ${client.clientId}`);
        }
        
        // Determine if this is a standalone run by checking for parentRunId in options
        const isStandalone = !options.parentRunId;
        
        if (process.env.VERBOSE_POST_SCORING === "true") {
            console.log(`[POST_DEBUG] Processing mode: ${isStandalone ? 'STANDALONE' : 'PART OF WORKFLOW'}`);
        }
        
        // Use the normalized runId from options that was passed from the parent function
        // Complete all processing for this client
        // FIXED: Validate client ID and run ID before passing to JobTracking
        const safeRunId = validateAndNormalizeRunId(options.runId);
        const safeClientId = validateAndNormalizeClientId(client.clientId);
        
        if (!safeRunId || !safeClientId) {
            logger.error(`Missing required parameters for job completion: runId=${safeRunId}, clientId=${safeClientId}`);
        }
        
        // Create metrics object with proper field names from constants
        const finalMetrics = {
            [FIELD_NAMES.POSTS_EXAMINED]: clientResult.postsProcessed || 0,
            [FIELD_NAMES.POSTS_SCORED]: clientResult.postsScored || 0,
            [FIELD_NAMES.POST_SCORING_TOKENS]: clientResult.totalTokensUsed || 0,
            [FIELD_NAMES.ERRORS]: clientResult.errors || 0
        };
        
        // Use the validator to ensure all field names are correct
        const validatedMetrics = createValidatedObject(finalMetrics);
        
        await JobTracking.completeClientProcessing({
            runId: safeRunId, // Use the consistent runId from options
            clientId: safeClientId,
            finalMetrics: validatedMetrics,
            options: {
                source: 'postBatchScorer_completion',
                isStandalone: isStandalone,
                logger
            }
        });
        
        logger.summary(`Completed all processing for client ${client.clientId} with duration=${clientResult.duration}s, posts scored=${clientResult.postsScored}`);
        
        // Also update the main job tracking record to show progress
        // Check if options.runId is defined before attempting to update job status
        if (!options.runId) {
            logger.warn(`No valid run ID available for client ${client.clientId}, skipping job status update`);
        } else {
            await JobTracking.updateJob({
                runId: options.runId, // Use consistent runId from options
                updates: {
                    'Last Client': client.clientId,
                    'Progress': `Processed client ${client.clientId}: ${clientResult.postsScored}/${clientResult.postsProcessed} posts scored`
                }
            });
        }
    } catch (jobError) {
        logger.warn(`Could not update job status: ${jobError.message}`);
        console.error(`Error updating job status: ${jobError.message}`);
    }
    
    return clientResult;
}

/* =================================================================
    Helper Functions
=================================================================== */

// Safely update a lead record; if Airtable rejects an unknown skip reason field,
// retry without that field so we still persist scoring results and date.
async function safeLeadUpdate(clientBase, tableName, recordId, fields, skipReasonFieldName) {
    // Get more info about the lead for better logging
    let profileUrl = 'unknown';
    let leadName = 'unknown';
    try {
        const lead = await clientBase(tableName).find(recordId);
        if (lead && lead.fields) {
            profileUrl = lead.fields['LinkedIn Profile URL'] || lead.fields['LinkedIn URL'] || 'unknown';
            const firstName = lead.fields['First Name'] || '';
            const lastName = lead.fields['Last Name'] || '';
            leadName = `${firstName} ${lastName}`.trim() || 'Unknown';
        }
    } catch (error) {
        console.log(`[POST_DEBUG] Error retrieving lead details: ${error.message}`);
    }

    // Reduced debug logging
    if (process.env.VERBOSE_POST_SCORING === "true") {
        console.log(`[POST_DEBUG] 🔄 Updating lead: ${recordId} (${leadName}) - LinkedIn URL: ${profileUrl}`);
        console.log(`[POST_DEBUG] Fields to update: ${JSON.stringify(Object.keys(fields))}`);
        
        // Check for Date Posts Scored field specifically
        if (fields['Date Posts Scored']) {
            console.log(`[POST_DEBUG] Setting Date Posts Scored to: ${fields['Date Posts Scored']} for lead ${recordId}`);
        } else {
            console.log(`[POST_DEBUG] WARNING: Date Posts Scored field not present in update for lead ${recordId}!`);
        }
    }
    
    try {
        const result = await clientBase(tableName).update(recordId, fields);
        
        if (process.env.VERBOSE_POST_SCORING === "true") {
            console.log(`[POST_DEBUG] SUCCESS: Updated lead ${recordId} with fields: ${Object.keys(fields).join(', ')}`);
            
            // Verify the result
            if (Array.isArray(result) && result.length > 0) {
                // Double-check if Date Posts Scored is actually set in the result
                if (result[0].fields && result[0].fields['Date Posts Scored']) {
                    console.log(`[POST_DEBUG] CONFIRMED: Date Posts Scored field is set to ${result[0].fields['Date Posts Scored']}`);
                }
            }
        }
        
        return result;
    } catch (err) {
        const msg = (err && err.message) || '';
        
        // Log error but reduce verbosity
        if (process.env.VERBOSE_POST_SCORING === "true") {
            console.log(`[POST_DEBUG] ERROR updating lead ${recordId}: ${err.message}`);
        }
        
        // Handle missing field gracefully (especially skipReason)
        if (skipReasonFieldName && (msg.includes(skipReasonFieldName) || msg.includes(`Unknown field name`))) {
            if (process.env.VERBOSE_POST_SCORING === "true") {
                console.log(`[POST_DEBUG] Retrying without ${skipReasonFieldName} field for lead ${recordId}`);
            }
            
            // Remove the skip reason field and retry once
            const cloned = { ...fields };
            delete cloned[skipReasonFieldName];
            
            try {
                const retryResult = await clientBase(tableName).update(recordId, cloned);
                if (process.env.VERBOSE_POST_SCORING === "true") {
                    console.log(`[POST_DEBUG] RETRY SUCCESS: Updated lead ${recordId} without ${skipReasonFieldName} field`);
                }
                return retryResult;
            } catch (e2) {
                if (process.env.VERBOSE_POST_SCORING === "true") {
                    console.error(`[POST_DEBUG] RETRY ERROR: ${e2.message}`);
                }
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

// Helper function to ensure consistent quotes in Airtable formulas
function ensureFormulaQuotes(formula) {
    // For empty string comparisons, use single quotes (Airtable's preferred format)
    return formula
        // Fix empty string comparisons - convert double quotes to single quotes
        .replace(/!= *""/g, "!= ''")
        .replace(/= *""/g, "= ''")
        .replace(/ != *''/g, " != ''")
        .replace(/ = *''/g, " = ''")
        // Fix any inconsistent BLANK() function syntax
        .replace(/BLANK\(\)/g, "BLANK()")
        // Log the transformation if there was a change (only in verbose mode)
        .replace(/(.*?)(["'])(.+?)\2(.*)/g, (match, before, quote, content, after) => {
            const fixed = before + "'" + content + "'" + after;
            if (match !== fixed && process.env.VERBOSE_POST_SCORING === "true") {
                console.log(`[POST_DEBUG] Fixed quotes in formula: "${match}" → "${fixed}"`);
            }
            return fixed;
        });
}

async function getLeadsForPostScoring(clientBase, config, limit, options = {}) {
    console.log(`🔍 [GET-LEADS-DEBUG] ========== getLeadsForPostScoring CALLED ==========`);
    console.log(`🔍 [GET-LEADS-DEBUG] Config:`, {
        leadsTableName: config.leadsTableName,
        postsContentField: config.fields.postsContent,
        dateScoredField: config.fields.dateScored,
        forceRescore: !!options.forceRescore,
        limit: limit || 'unlimited'
    });
    console.log(`🔍 [GET-LEADS-DEBUG] ClientBase type: ${typeof clientBase}`);
    
    // Display the full environment variables that might affect post scoring if in verbose mode
    if (process.env.VERBOSE_POST_SCORING === "true") {
        console.log(`[POST_DEBUG] Environment variables:`);
        console.log(`[POST_DEBUG] - POST_SCORING_LIMIT: ${process.env.POST_SCORING_LIMIT || 'not set'}`);
        console.log(`[POST_DEBUG] - VERBOSE_POST_SCORING: ${process.env.VERBOSE_POST_SCORING || 'not set'}`);
        console.log(`[POST_DEBUG] - OVERRIDE_POSTS_TABLE_NAME: ${process.env.OVERRIDE_POSTS_TABLE_NAME || 'not set'}`);
        console.log(`[POST_DEBUG] - GEMINI_TIMEOUT_MS: ${process.env.GEMINI_TIMEOUT_MS || 'not set'}`);
        console.log(`[POST_DEBUG] - POST_BATCH_CHUNK_SIZE: ${process.env.POST_BATCH_CHUNK_SIZE || 'not set'}`);
        
        // Check the client base connection
        console.log(`[POST_DEBUG] Client base object type: ${typeof clientBase}`);
        console.log(`[POST_DEBUG] Client base has Leads table: ${typeof clientBase(config.leadsTableName) === 'object'}`);
    }
    
    // Add a count query to get the total number of leads with unscored posts
    try {
        const formula = ensureFormulaQuotes(`AND({${config.fields.postsContent}} != '', {${config.fields.dateScored}} = BLANK())`);
        
        console.log(`🔍 [GET-LEADS-DEBUG] COUNT QUERY: Running count of unscored leads`);
        console.log(`🔍 [GET-LEADS-DEBUG] COUNT QUERY: Formula: ${formula}`);
        
        // Get a sample record first to check field names (case sensitivity)
        const sampleRec = await clientBase(config.leadsTableName).select({ maxRecords: 1 }).firstPage();
        const hasUpperCaseIdField = sampleRec && sampleRec[0] && Object.keys(sampleRec[0].fields || {}).includes('ID');
        const hasLowerCaseIdField = sampleRec && sampleRec[0] && Object.keys(sampleRec[0].fields || {}).includes('id');
        
        console.log(`🔍 [GET-LEADS-DEBUG] COUNT QUERY: ID field check - uppercase: ${hasUpperCaseIdField}, lowercase: ${hasLowerCaseIdField}`);
        
        // Use the first available ID field, or don't specify fields at all if neither exists
        const countQuery = await clientBase(config.leadsTableName).select({
            fields: hasUpperCaseIdField ? ['ID'] : (hasLowerCaseIdField ? ['id'] : []),
            filterByFormula: formula
        }).all();
        
        console.log(`🔍 [GET-LEADS-DEBUG] COUNT QUERY RESULT: ${countQuery.length} leads have posts content but no Date Posts Scored`);
        if (VERBOSE) console.log(`[POST_DEBUG] TOTAL UNSCORED LEADS: ${countQuery.length} leads have posts content but no Date Posts Scored`);
        
        // Check limit constraints
        if (limit && limit < countQuery.length) {
            console.log(`[DEBUG-POST-SCORING] LIMIT CONSTRAINT: Processing only ${limit} of ${countQuery.length} available leads due to limit parameter`);
        }
    } catch (countError) {
        console.error(`[DEBUG-POST-SCORING] Error counting unscored leads: ${countError.message}`);
    }

    // If explicit targetIds provided, use them directly (bypass view path)
    if (Array.isArray(options.targetIds) && options.targetIds.length > 0) {
        const ids = options.targetIds.slice(0, Math.max(1, limit || options.targetIds.length));
        const found = [];
        for (const id of ids) {
            try {
                const formula = ensureFormulaQuotes(`RECORD_ID() = '${id}'`);
                const recs = await clientBase(config.leadsTableName).select({
                    filterByFormula: formula,
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
        console.log(`[DEBUG] getLeadsForPostScoring: Using explicit targetIds: ${ids.length} specified, ${found.length} found`);
        return found;
    }

    // Primary: try using the named view (many bases have it) WITHOUT additional filters
    // The view "Leads with Posts not yet scored" should already have proper filtering
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
        // IMPORTANT: Remove additional filters that might conflict with the view's filters
        // Only apply a force rescore filter if needed
        // Ensure consistent quotes for Airtable formula compatibility
        filterByFormula: options.forceRescore ? ensureFormulaQuotes(`OR({${config.fields.dateScored}} = BLANK(), {${config.fields.dateScored}} != BLANK()})`) : undefined
    };

    let records = [];
    let usedFallback = false;
    
    // Check if the table exists first
    try {
        // NOTE: clientBase.tables() doesn't exist in the Airtable API
        // Instead, we'll check if we can access the table directly
        try {
            await clientBase(config.leadsTableName).select({ maxRecords: 1 }).all();
            console.log(`[DEBUG] getLeadsForPostScoring: Confirmed table "${config.leadsTableName}" exists`);
        } catch (accessError) {
            console.error(`[ERROR] getLeadsForPostScoring: Table "${config.leadsTableName}" does not exist or is not accessible!`);
            return [];
        }
    } catch (tableError) {
        console.error(`[ERROR] getLeadsForPostScoring: Failed to check tables: ${tableError.message}`);
    }
    
    try {
        console.log(`🔍 [GET-LEADS-DEBUG] PRIMARY SELECT: Trying view "Leads with Posts not yet scored"`);
        console.log(`🔍 [GET-LEADS-DEBUG] PRIMARY SELECT: Filter: ${primarySelect.filterByFormula || 'NONE (using view filters only)'}`);
        console.log(`🔍 [GET-LEADS-DEBUG] PRIMARY SELECT: Fields requested:`, primarySelect.fields);
        
        records = await clientBase(config.leadsTableName).select(primarySelect).all();
        
        console.log(`🔍 [GET-LEADS-DEBUG] PRIMARY SELECT RESULT: Found ${records.length} records from view`);
        console.log(`[DEBUG] getLeadsForPostScoring: Primary select found ${records.length} records`);
        
        if (records.length > 0) {
            console.log(`🔍 [GET-LEADS-DEBUG] FILTERING: Checking ${records.length} records for valid posts content...`);
            
            // Check if the records actually have posts content
            const withPosts = records.filter(r => {
                if (!r.fields || !r.fields[config.fields.postsContent]) {
                    console.log(`🔍 [GET-LEADS-DEBUG] FILTER OUT: Record ${r.id} - No posts content field`);
                    return false;
                }
                
                // Verify post content is not empty
                const content = r.fields[config.fields.postsContent];
                if (typeof content === 'string') {
                    // Check if it's just whitespace or very short
                    const isValid = content.trim().length > 10;
                    if (!isValid) {
                        console.log(`🔍 [GET-LEADS-DEBUG] FILTER OUT: Record ${r.id} - Content too short (${content.trim().length} chars)`);
                    }
                    return isValid;
                } else if (Array.isArray(content)) {
                    // If it's an array (multi-line text in Airtable), check if it has entries
                    const isValid = content.length > 0;
                    if (!isValid) {
                        console.log(`🔍 [GET-LEADS-DEBUG] FILTER OUT: Record ${r.id} - Empty array`);
                    }
                    return isValid;
                }
                console.log(`🔍 [GET-LEADS-DEBUG] FILTER OUT: Record ${r.id} - Invalid content type: ${typeof content}`);
                return false;
            });
            console.log(`🔍 [GET-LEADS-DEBUG] FILTERING RESULT: ${withPosts.length} of ${records.length} records have valid posts content`);
            console.log(`[DEBUG] getLeadsForPostScoring: ${withPosts.length} of ${records.length} records have valid posts content`);
            
            // Check if the records have been scored already
            const alreadyScored = records.filter(r => r.fields && r.fields[config.fields.dateScored]);
            console.log(`[DEBUG] getLeadsForPostScoring: ${alreadyScored.length} of ${records.length} records have already been scored`);
            
            // Filter out records without valid post content
            if (withPosts.length < records.length) {
                console.warn(`[WARN] getLeadsForPostScoring: ${records.length - withPosts.length} records don't have valid posts content!`);
                console.log(`[INFO] getLeadsForPostScoring: Filtering out records without valid posts content`);
                records = withPosts;
            }
            
            // Warn about already scored records (shouldn't happen with view-based filtering)
            if (alreadyScored.length > 0) {
                console.warn(`[WARN] getLeadsForPostScoring: ${alreadyScored.length} records have already been scored!`);
            }
            
            // If we have records to process, log a sample to help with debugging
            if (records.length > 0) {
                const sample = records[0];
                console.log(`[DEBUG] getLeadsForPostScoring: Sample record ID: ${sample.id}`);
                console.log(`[DEBUG] getLeadsForPostScoring: Sample LinkedIn URL: ${sample.fields[config.fields.linkedinUrl] || 'N/A'}`);
                
                // Only log a snippet of the posts content for debugging
                const postsContent = sample.fields[config.fields.postsContent];
                if (typeof postsContent === 'string') {
                    const snippet = postsContent.slice(0, 100) + (postsContent.length > 100 ? '...' : '');
                    console.log(`[DEBUG] getLeadsForPostScoring: Sample posts content (snippet): ${snippet}`);
                }
            }
        }
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
        // Using helper function to ensure consistent quotes for Airtable formula compatibility
        const actionedGuardRaw = `OR({${postsActionedField}} = 0, {${postsActionedField}} = '', {${postsActionedField}} = BLANK())`;
        const actionedGuard = ensureFormulaQuotes(actionedGuardRaw);
        
        const baseFields = [
            config.fields.postsContent,
            config.fields.linkedinUrl,
            config.fields.dateScored,
            config.fields.relevanceScore,
            config.fields.aiEvaluation,
            config.fields.topScoringPost
        ];
        
        const makeFilter = (withActioned) => {
            // Using helper function to ensure consistent quotes for Airtable formula compatibility
            const dateClauseRaw = options.forceRescore ? 'TRUE()' : `{${config.fields.dateScored}} = BLANK()`;
            const dateClause = ensureFormulaQuotes(dateClauseRaw);
            
            let filterFormula = withActioned
                ? `AND({${config.fields.postsContent}} != '', ${dateClause}, ${actionedGuard})`
                : `AND({${config.fields.postsContent}} != '', ${dateClause})`;
            
            // Apply quote fixing to ensure consistency
            filterFormula = ensureFormulaQuotes(filterFormula);
            console.log(`[DEBUG] getLeadsForPostScoring: Generated filter formula: ${filterFormula}`);
            return filterFormula;
        };

        // First, try a very basic check to see if we can find ANY records with posts content
        try {
            console.log(`[DEBUG] getLeadsForPostScoring: Checking if any records have posts content`);
            const basicFormula = ensureFormulaQuotes(`{${config.fields.postsContent}} != ''`);
            const basicCheck = await clientBase(config.leadsTableName).select({
                fields: [config.fields.postsContent],
                filterByFormula: basicFormula,
                maxRecords: 5
            }).firstPage();
            
            console.log(`[DEBUG] getLeadsForPostScoring: Basic posts content check found ${basicCheck.length} records`);
            
            if (basicCheck.length === 0) {
                console.warn(`[WARN] getLeadsForPostScoring: No records with posts content found at all!`);
                // If no posts content found, there's nothing to score
                return [];
            }
        } catch (e) {
            console.warn(`[WARN] getLeadsForPostScoring: Basic posts content check failed: ${e.message}`);
        }

        try {
            console.log(`[DEBUG] getLeadsForPostScoring: Trying fallback with Posts Actioned guard`);
            const filter = makeFilter(true);
            const formula = ensureFormulaQuotes(filter);
            records = await clientBase(config.leadsTableName).select({
                fields: baseFields,
                filterByFormula: formula
            }).all();
            console.log(`[DEBUG] getLeadsForPostScoring: Fallback with guard found ${records.length} records`);
        } catch (e2) {
            console.log(`[DEBUG] getLeadsForPostScoring: Fallback with guard failed: ${e2.message}`);
            // If "Posts Actioned" is missing on this base, retry without referencing it
            const msg = e2?.message || String(e2);
            console.warn(`[postBatchScorer] Fallback select with actioned guard failed: ${msg}. Retrying without Posts Actioned condition.`);
            try {
                console.log(`[DEBUG] getLeadsForPostScoring: Trying fallback without Posts Actioned guard`);
                const filter = makeFilter(false);
                const formula = ensureFormulaQuotes(filter);
                records = await clientBase(config.leadsTableName).select({
                    fields: baseFields,
                    filterByFormula: formula
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
    
    // Enhanced validation and logging
    if (records.length > 0) {
        // Check for field existence and format in the records
        const sampleRecord = records[0];
        console.log(`[DEBUG] getLeadsForPostScoring: Sample record fields: ${Object.keys(sampleRecord.fields || {}).join(', ')}`);
        
        const hasPostsContent = sampleRecord.fields && sampleRecord.fields[config.fields.postsContent];
        console.log(`[DEBUG] getLeadsForPostScoring: Sample record has posts content: ${!!hasPostsContent}`);
        
        if (hasPostsContent) {
            const postsValue = sampleRecord.fields[config.fields.postsContent];
            const postsValueType = typeof postsValue;
            const postsValueLength = postsValueType === 'string' ? postsValue.length : (Array.isArray(postsValue) ? postsValue.length : 'N/A');
            console.log(`[DEBUG] getLeadsForPostScoring: Posts content type: ${postsValueType}, length: ${postsValueLength}`);
        }
        
        // Count records with essential data
        const withValidPostsCount = records.filter(r => {
            const hasContent = r.fields && r.fields[config.fields.postsContent];
            return hasContent && (typeof r.fields[config.fields.postsContent] === 'string' ? 
                r.fields[config.fields.postsContent].length > 10 : true);
        }).length;
        
        console.log(`[DEBUG] getLeadsForPostScoring: Records with valid posts content: ${withValidPostsCount} of ${records.length}`);
        
        // If many records have no posts content, that's a problem
        if (withValidPostsCount < records.length * 0.5 && records.length > 1) {
            console.warn(`[WARN] getLeadsForPostScoring: Less than half of records have valid posts content!`);
        }
    } else {
        console.warn(`[WARN] getLeadsForPostScoring: No records found for post scoring!`);
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
        errorReasonCounts: {},
        totalTokensUsed: 0  // Add token tracking at chunk level
    };
    
    logger.process(`Processing ${records.length} leads for post scoring in client ${clientId}`);
    
    for (const leadRecord of records) {
        try {
            chunkResult.processed++;
            
            const result = await analyzeAndScorePostsForLead(leadRecord, clientBase, config, clientId, logger, options);
            
            // Track token usage regardless of success/failure status
            if (result.tokenUsage) {
                chunkResult.totalTokensUsed += result.tokenUsage;
                // Log token usage for debugging
                logger.debug(`Lead ${leadRecord.id}: Used ${result.tokenUsage} tokens`);
            }
            
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
    // Retrieve LinkedIn profile URL for more explicit logging
    const linkedinProfileUrl = leadRecord.fields[config.fields.linkedinUrl] || 'unknown';
    const firstName = leadRecord.fields['First Name'] || '';
    const lastName = leadRecord.fields['Last Name'] || '';
    const fullName = `${firstName} ${lastName}`.trim() || 'Unknown';
    
    console.log(`[POST_DEBUG] Processing lead: ${leadRecord.id} (${fullName}) - LinkedIn URL: ${linkedinProfileUrl}`);
    logger.debug(`Analyzing posts for lead ${leadRecord.id} in client ${clientId}`);
    
    // Parse posts content
    const rawPostsContent = leadRecord.fields[config.fields.postsContent];
    if (!rawPostsContent) {
        console.log(`[POST_DEBUG] Lead ${leadRecord.id} (${linkedinProfileUrl}): No posts content found in Airtable`);
        logger.debug(`Lead ${leadRecord.id}: No posts content, skipping`);
        if (!options.dryRun && options.markSkips !== false) {
            try {
                // Initialize basic update fields
                const updateFields = {
                    [config.fields.dateScored]: new Date().toISOString()
                };
                
                // Only add skipReason if the field exists
                if (config.fields.skipReason) {
                    updateFields[config.fields.skipReason] = 'NO_CONTENT';
                }
                
                console.log(`[POST_DEBUG] Updating lead ${leadRecord.id} (${linkedinProfileUrl}) with Date Posts Scored: ${updateFields[config.fields.dateScored]}`);
                await clientBase(config.leadsTableName).update(leadRecord.id, updateFields);
                console.log(`[POST_DEBUG] Successfully marked lead ${leadRecord.id} (${linkedinProfileUrl}) as skipped due to NO_CONTENT`);
            } catch (e) { 
                console.log(`[POST_DEBUG] Error updating lead ${leadRecord.id} (${linkedinProfileUrl}): ${e.message}`);
            }
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
                // Initialize basic update fields
                const updateFields = {
                    [config.fields.dateScored]: new Date().toISOString()
                };
                
                // Only add skipReason if the field exists
                if (config.fields.skipReason) {
                    updateFields[config.fields.skipReason] = 'NO_POSTS_PARSED';
                }
                
                await clientBase(config.leadsTableName).update(leadRecord.id, updateFields);
            } catch (e) {
                console.log(`[POST_DEBUG] Error updating lead ${leadRecord.id}: ${e.message}`);
            }
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
        const aiResponse = await scorePostsWithGemini(geminiInput, configuredGeminiModel);
        const aiResponseArray = aiResponse.results;
        const tokenUsage = aiResponse.tokenUsage || { totalTokens: 0 };
        
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
            // Instead of throwing an error directly, handle this case more gracefully
            // Log what happened for debugging
            if (process.env.VERBOSE_POST_SCORING === "true") {
                console.log(`[POST_DEBUG] ⚠️ AI response was not a valid or non-empty array of post scores for lead ${leadRecord.id}`);
                console.log(`[POST_DEBUG] ⚠️ Raw response type: ${typeof aiResponseArray}`);
                console.log(`[POST_DEBUG] ⚠️ Is array: ${Array.isArray(aiResponseArray)}`);
                console.log(`[POST_DEBUG] ⚠️ Length: ${Array.isArray(aiResponseArray) ? aiResponseArray.length : 'N/A'}`);
            }
            // Now throw the error which will be caught and handled by the error handler below
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
            // Log before the update
            const profileUrl = leadRecord.fields[config.fields.linkedinUrl] || 'unknown';
            const dateScoredValue = new Date().toISOString();
            
            console.log(`[POST_DEBUG] 🌟 About to update lead ${leadRecord.id} (${profileUrl}) with scoring results`);
            console.log(`[POST_DEBUG] 🌟 Date Posts Scored value being set: ${dateScoredValue}`);
            console.log(`[POST_DEBUG] 🌟 Highest scoring post score: ${highestScoringPost.post_score}`);
            
            // Initialize basic update fields
            const updateFields = {
                [config.fields.relevanceScore]: highestScoringPost.post_score,
                [config.fields.aiEvaluation]: JSON.stringify(aiResponseArray, null, 2), // Store the full array for debugging
                [config.fields.topScoringPost]: topScoringPostText,
                [config.fields.dateScored]: dateScoredValue
            };
            
            // Only add skipReason if the field exists and we're marking skips
            if (config.fields.skipReason && options.markSkips !== false) {
                updateFields[config.fields.skipReason] = '';
            }
            
            console.log(`[POST_DEBUG] 🌟 Fields being updated: ${JSON.stringify(Object.keys(updateFields))}`);
            console.log(`[POST_DEBUG] 🌟 dateScored field name: ${config.fields.dateScored}`);
            
            // Verify the field mappings
            console.log(`[POST_DEBUG] 🌟 Field mapping check:`);
            console.log(`[POST_DEBUG] 🌟 - dateScored maps to: ${config.fields.dateScored}`);
            console.log(`[POST_DEBUG] 🌟 - relevanceScore maps to: ${config.fields.relevanceScore}`);
            console.log(`[POST_DEBUG] 🌟 - skipReason maps to: ${config.fields.skipReason || 'NOT_AVAILABLE'}`);
            
            const result = await safeLeadUpdate(
                clientBase,
                config.leadsTableName,
                leadRecord.id,
                updateFields,
                options.markSkips !== false ? config.fields.skipReason : null
            );
            
            // After update verification
            console.log(`[POST_DEBUG] ✅ Post-update verification for lead ${leadRecord.id} (${profileUrl})`);
            try {
                const updatedLead = await clientBase(config.leadsTableName).find(leadRecord.id);
                if (updatedLead && updatedLead.fields) {
                    const dateScored = updatedLead.fields[config.fields.dateScored];
                    if (dateScored) {
                        console.log(`[POST_DEBUG] ✅ CONFIRMED: Date Posts Scored is now set to ${dateScored}`);
                    } else {
                        console.log(`[POST_DEBUG] ❌ ERROR: Date Posts Scored field is still not set after update!`);
                    }
                }
            } catch (verifyError) {
                console.log(`[POST_DEBUG] ❌ Error verifying update: ${verifyError.message}`);
            }
        }
        
        logger.summary(`Lead ${leadRecord.id}: Successfully scored. Final Score: ${highestScoringPost.post_score}`);
        return { 
            status: "success", 
            relevanceScore: highestScoringPost.post_score,
            tokenUsage: tokenUsage.totalTokens || 0
        };

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
            // Log before the update
            const profileUrl = leadRecord.fields[config.fields.linkedinUrl] || 'unknown';
            const dateScoredValue = new Date().toISOString();
            
            if (process.env.VERBOSE_POST_SCORING === "true") {
                console.log(`[POST_DEBUG] About to update lead ${leadRecord.id} with error result`);
                console.log(`[POST_DEBUG] AI Error Category: ${aiErrorCategory}`);
            }
            
            const updateFields = {
                [config.fields.aiEvaluation]: `ERROR during AI post scoring: ${JSON.stringify(errorDetails, null, 2)}`,
                [config.fields.dateScored]: dateScoredValue
            };
            
            // Only add skipReason if field exists and we're marking skips
            if (options.markSkips !== false && config.fields.skipReason) {
                updateFields[config.fields.skipReason] = '';
            }
            
            if (process.env.VERBOSE_POST_SCORING === "true") {
                console.log(`[POST_DEBUG] Fields being updated in error case: ${JSON.stringify(Object.keys(updateFields))}`);
            }
            
            const result = await safeLeadUpdate(
                clientBase,
                config.leadsTableName,
                leadRecord.id,
                updateFields,
                options.markSkips !== false ? config.fields.skipReason : null
            );
            
            // After update verification - only do this if verbose logging is enabled
            if (process.env.VERBOSE_POST_SCORING === "true") {
                console.log(`[POST_DEBUG] Post-update verification for lead with error ${leadRecord.id}`);
                try {
                    const updatedLead = await clientBase(config.leadsTableName).find(leadRecord.id);
                    if (updatedLead && updatedLead.fields) {
                        const dateScored = updatedLead.fields[config.fields.dateScored];
                        if (dateScored) {
                            console.log(`[POST_DEBUG] CONFIRMED: Date Posts Scored is now set to ${dateScored}`);
                        }
                    }
                } catch (verifyError) {
                    // Silently ignore verification errors in production
                }
            }
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
