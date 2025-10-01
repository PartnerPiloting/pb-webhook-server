// batchScorer.js - MULTI-TENANT SUPPORT: Added client iteration, per-client logging, error isolation

require("dotenv").config(); 

// Debug logging for environment variables
console.log('ENVIRONMENT VARIABLES CHECK (batchScorer):');
console.log(`- FIRE_AND_FORGET_BATCH_PROCESS_TESTING: ${process.env.FIRE_AND_FORGET_BATCH_PROCESS_TESTING || 'not set'}`);
console.log(`- DEBUG_LEVEL: ${process.env.DEBUG_LEVEL || 'not set'}`);
console.log(`- DEBUG_MODE: ${process.env.DEBUG_MODE || 'not set'}`);
console.log(`- LEAD_SCORING_LIMIT: ${process.env.LEAD_SCORING_LIMIT || 'not set'}`);
console.log(`- BATCH_PROCESSING_STREAM: ${process.env.BATCH_PROCESSING_STREAM || 'not set'}`);

const { HarmCategory, HarmBlockThreshold } = require('@google-cloud/vertexai');

// --- Multi-Tenant Dependencies ---
const clientService = require('./services/clientService');
const { getClientBase } = require('./config/airtableClient');
const { trackLeadProcessingMetrics } = require('./services/leadService');
// Legacy import - only used for functions not related to run records
const airtableService = require('./services/airtableService');
const runIdService = require('./services/runIdService');
// Using the adapter that enforces the Single Creation Point pattern
const runRecordService = require('./services/runRecordAdapterSimple');

// --- Structured Logging ---
const { StructuredLogger } = require('./utils/structuredLogger');
const { createSafeLogger, getLoggerFromOptions } = require('./utils/loggerHelper');

// --- Centralized Dependencies (will be passed into 'run' function) ---
let BATCH_SCORER_VERTEX_AI_CLIENT;
let BATCH_SCORER_GEMINI_MODEL_ID;
let BATCH_SCORER_AIRTABLE_BASE; // Legacy support - will be dynamically set per client

// --- Local Modules ---
const { buildPrompt, slimLead } = require("./promptBuilder"); 
const { loadAttributes } = require("./attributeLoader");
const { computeFinalScore } = require("./scoring");
const { buildAttributeBreakdown } = require("./breakdown");
const { alertAdmin, isMissingCritical } = require('./utils/appHelpers.js');
const { costGovernanceService } = require('./services/costGovernanceService.js'); 

/* ---------- ENV CONFIGURATION for Batch Scorer Operations ----------- */
const DEFAULT_MODEL_ID_FALLBACK = process.env.GEMINI_MODEL_ID || "gemini-2.5-pro-preview-05-06";
const CHUNK_SIZE = Math.max(1, parseInt(process.env.BATCH_CHUNK_SIZE || "40", 10)); 
// ***** INCREASED TIMEOUT FOR DEBUGGING LARGER BATCHES *****
const GEMINI_TIMEOUT_MS = Math.max(30000, parseInt(process.env.GEMINI_TIMEOUT_MS || "900000", 10)); // 15 minutes

// MODIFIED a few turns ago to indicate "Prompt Length Log" to help confirm version - keeping it
console.log(`▶︎ batchScorer module loaded (DEBUG Profile, High Output, Increased Timeout, filterByFormula, Prompt Length Log). CHUNK_SIZE: ${CHUNK_SIZE}, TIMEOUT: ${GEMINI_TIMEOUT_MS}ms. Ready for dependencies.`);

/* ---------- LEAD PROCESSING QUEUE (Client-Aware Internal Queue) ------------- */
const queue = [];
let running = false;
async function enqueue(recs, clientId, clientBase, log = console) { 
    queue.push({ records: recs, clientId, clientBase });
    if (running) return;
    running = true;
    const logger = (log === console) ? createSafeLogger('SYSTEM', null, 'lead_scoring') : log;
    logger.debug(`batchScorer.enqueue: Queue started. ${queue.length} chunk(s) to process.`);
    while (queue.length) {
        const { records: chunk, clientId: chunkClientId, clientBase: chunkClientBase } = queue.shift();
        log.process(`Processing chunk of ${chunk.length} records for client [${chunkClientId || 'unknown'}]...`);
        try {
            await scoreChunk(chunk, chunkClientId, chunkClientBase, log);
        } catch (err) {
            log.error(`CHUNK FATAL ERROR for client [${chunkClientId || 'unknown'}] chunk of ${chunk.length} records: ${err.message}`, err.stack);
            await alertAdmin("Chunk Failed Critically (batchScorer)", `Client: ${chunkClientId || 'unknown'}\nError: ${String(err.message)}\nStack: ${err.stack}`);
        }
    }
    running = false;
    log.summary("Queue empty, all processing finished for this run.");
}

/* ---------- FETCH LEADS FROM AIRTABLE (Client-Specific) --------- */
async function fetchLeads(limit, clientBase, clientId, logger = null) {
    const log = logger || createSafeLogger(clientId || 'UNKNOWN', null, 'lead_scoring');
    
    if (!clientBase) {
        throw new Error(`Airtable base not provided for client ${clientId || 'unknown'}.`);
    }
    const records = [];
    
    // Check if we're in testing mode
    const TESTING_MODE = process.env.FIRE_AND_FORGET_BATCH_PROCESS_TESTING === 'true';
    
    // Determine filter formula based on mode
    // FIXED: Use single quotes for value to maintain compatibility with original code
    let filterFormula = `{Scoring Status} = 'To Be Scored'`;
    
    // Debug logging for client ID and filter formula
    console.log(`[DEBUG] fetchLeads for client: ${clientId} using filter formula with single quotes`);
    console.log(`[DEBUG] Raw filter formula: ${filterFormula}`);
    
    // In testing mode, we might want to allow rescoring of leads that were recently scored
    if (TESTING_MODE) {
        log.setup(`TESTING MODE ACTIVE: Including recently scored leads for testing`);
        
        // Modify the filter to include recently scored leads for testing
        // This will re-score leads that were scored in the past 2 days
        // FIXED: Use single quotes for values to maintain compatibility with original code
        filterFormula = `OR({Scoring Status} = 'To Be Scored', AND({Scoring Status} = 'Scored', IS_AFTER(DATEADD(TODAY(), -2, 'days'), {Date Scored})))`;
        
        log.debug(`Testing mode filter formula: ${filterFormula}`);
    } else {
        log.setup(`Normal mode: Using standard filter for "To Be Scored" status only`);
    }
    
    log.setup(`Fetching up to ${limit} leads using formula: ${filterFormula}`);
    
    // Add debug logging for table discovery
    try {
        // NOTE: clientBase.tables() doesn't exist in the Airtable API
        // Instead, we'll check if we can access the Leads table directly
        try {
            await clientBase('Leads').select({ maxRecords: 1 }).all();
            log.debug(`'Leads' table found and accessible`);
        } catch (tableError) {
            log.error(`'Leads' table not found or not accessible in client base: ${tableError.message}`);
        }
    
            // Debug - check if Scoring Status field exists
            try {
                // Get a sample record to examine its fields
                const sampleRecords = await clientBase('Leads').select({ maxRecords: 1 }).all();
                if (sampleRecords.length > 0) {
                    const fields = Object.keys(sampleRecords[0].fields);
                    const hasScoringStatus = fields.includes('Scoring Status');
                    if (!hasScoringStatus) {
                        log.error(`'Scoring Status' field not found in 'Leads' table`);
                    } else {
                        log.debug(`'Scoring Status' field found in 'Leads' table`);
                    }
                } else {
                    log.warn(`No records found in 'Leads' table to check for 'Scoring Status' field`);
                }
            } catch (fieldErr) {
                log.error(`Failed to get fields for 'Leads' table: ${fieldErr.message}`);
            }
    } catch (tableErr) {
        log.error(`Failed to list tables: ${tableErr.message}`);
    }
    
        // Get a count of leads with "To Be Scored" status
    try {
        // Special debug for Guy Wilson
        if (clientId === 'guy-wilson') {
            console.log(`[DEBUG-GUY-WILSON] About to count Guy Wilson leads with filter: ${filterFormula}`);
        }
        
        const countQuery = await clientBase("Leads")
            .select({ 
                filterByFormula: filterFormula 
            })
            .all();
        log.debug(`TOTAL leads with "To Be Scored" status: ${countQuery.length}`);
        
        // Special debug for Guy Wilson
        if (clientId === 'guy-wilson') {
            console.log(`[DEBUG-GUY-WILSON] Found ${countQuery.length} leads to score for Guy Wilson`);
            if (countQuery.length === 0) {
                try {
                    // Try to query with double quotes to confirm issue
                    const doubleQuoteFilter = `{Scoring Status} = "To Be Scored"`;
                    const doubleQuoteQuery = await clientBase("Leads")
                        .select({ 
                            filterByFormula: doubleQuoteFilter
                        })
                        .all();
                    console.log(`[DEBUG-GUY-WILSON] Double quote query found ${doubleQuoteQuery.length} leads`);
                } catch (doubleQuoteErr) {
                    console.log(`[DEBUG-GUY-WILSON] Double quote query error: ${doubleQuoteErr.message}`);
                }
            }
        }
    } catch (countErr) {
        log.error(`Failed to count leads: ${countErr.message}`);
    }    try {
        await clientBase("Leads") 
            .select({ 
                maxRecords: limit, 
                filterByFormula: filterFormula 
            }) 
            .eachPage((pageRecords, next) => {
                records.push(...pageRecords);
                next();
            });
    } catch (err) {
        log.error(`Failed to fetch leads: ${err.message}`);
    }
    log.setup(`Fetched ${records.length} leads`);
    
    // Add more detailed logging
    if (records.length === 0) {
        log.debug(`No leads found with status "To Be Scored" for client ${clientId}`);
    } else {
        log.debug(`First lead ID: ${records[0].id}, fields: ${Object.keys(records[0].fields).join(', ')}`);
    }
    
    return records;
}

/* =================================================================
    scoreChunk - Processes a chunk of leads with Gemini (Client-Aware)
=================================================================== */
async function scoreChunk(records, clientId, clientBase, logger = null) {
    const log = logger || createSafeLogger(clientId || 'UNKNOWN', null, 'lead_scoring');
    
    if (!BATCH_SCORER_VERTEX_AI_CLIENT || !BATCH_SCORER_GEMINI_MODEL_ID) {
        const errorMsg = `Aborting. Gemini AI Client or Model ID not initialized/provided`;
        log.error(errorMsg);
        await alertAdmin("Aborted Chunk (batchScorer): Gemini Client/ModelID Not Provided", errorMsg);
        const failedUpdates = records.map(rec => ({ id: rec.id, fields: { "Scoring Status": "Failed – Client Init Error", "Date Scored": new Date().toISOString() }}));
        if (failedUpdates.length > 0 && clientBase) {
            for (let i = 0; i < failedUpdates.length; i += 10) await clientBase("Leads").update(failedUpdates.slice(i, i+10)).catch(e => log.error(`Airtable update error for client init failed leads: ${e.message}`));
        }
        return { processed: 0, successful: 0, failed: records.length, tokensUsed: 0 };
    }

    const scorable = [];
    const airtableUpdatesForSkipped = [];
    let debugProfileLogCount = 0; 

    log.process(`Starting pre-flight checks for ${records.length} records`);
    for (const rec of records) {
        const profileJsonString = rec.get("Profile Full JSON") || "{}";
        let profile;
        try {
            profile = JSON.parse(profileJsonString);
        } catch (e) {
            log.error(`Failed to parse "Profile Full JSON" for record ${rec.id}. JSON string (first 200 chars): ${profileJsonString.substring(0,200)}... Error: ${e.message}`);
            profile = {}; 
        }
        
        const aboutText = (profile.about || profile.summary || profile.linkedinDescription || "").trim();
        
        // ***** DEBUG LOGGING for isMissingCritical *****
        if (debugProfileLogCount < 5) { // Log details for the first 5 profiles being checked in the chunk
            console.log(`batchScorer.scoreChunk: Debugging profile for rec.id ${rec.id}:`);
            console.log(`  - Profile URL: ${profile.linkedinProfileUrl || profile.profile_url || "unknown"}`);
            console.log(`  - Has 'about' or 'summary' or 'linkedinDescription'? Length: ${aboutText.length}`);
            console.log(`  - Has 'headline'? : ${profile.headline ? 'Yes' : 'No'} (Value: ${profile.headline ? `"${profile.headline.substring(0,50)}..."` : 'N/A'})`);
            console.log(`  - Has 'experience' array? : ${Array.isArray(profile.experience) && profile.experience.length > 0 ? `Yes, length ${profile.experience.length}` : 'No'}`);
            let orgFallbackFound = false;
            if (!(Array.isArray(profile.experience) && profile.experience.length > 0)) {
                for (let i = 1; i <= 5; i++) { // Check first 5 org fallbacks
                    if (profile[`organization_${i}`] || profile[`organization_title_${i}`]) {
                        orgFallbackFound = true;
                        console.log(`  - Found job history via organization_${i} ("${profile[`organization_${i}`]}") or title_${i} ("${profile[`organization_title_${i}`]}")`);
                        break;
                    }
                }
                if (!orgFallbackFound) console.log(`  - No job history found via organization_X fallback (checked 1-5).`);
            }
            const isMissing = isMissingCritical(profile);
            console.log(`  - isMissingCritical() will return: ${isMissing}`);
            if (isMissing) {
                debugProfileLogCount++; 
            } else {
                // If it's not missing critical data, we still want to log a few non-failing ones for comparison
                if (debugProfileLogCount < 5) debugProfileLogCount++; 
            }
        }
        // ***** END DEBUG LOGGING *****

        if (isMissingCritical(profile)) { 
            log.warn(`Lead ${rec.id} [${profile.linkedinProfileUrl || profile.profile_url || "unknown"}] missing critical data. Alerting admin`);
            await alertAdmin("Incomplete lead data for batch scoring", `Client: ${clientId || 'unknown'}\nRec ID: ${rec.id}\nURL: ${profile.linkedinProfileUrl || profile.profile_url || "unknown"}`); 
            // For now, we still let it go through to the 'aboutText.length < 40' check as per original logic.
            // We can add a skip here later if needed.
        }

        if (aboutText.length < 40) {
            log.debug(`Lead ${rec.id} profile too thin (aboutText length: ${aboutText.length}), skipping AI call`);
            airtableUpdatesForSkipped.push({
                id: rec.id,
                fields: { "AI Score": 0, "Scoring Status": "Skipped – Profile Too Thin", "AI Profile Assessment": "", "AI Attribute Breakdown": "", "Date Scored": new Date().toISOString() }
            });
            continue;
        }
        scorable.push({ id: rec.id, rec, profile });
    }

    if (airtableUpdatesForSkipped.length > 0 && clientBase) {
        try {
            log.process(`Updating ${airtableUpdatesForSkipped.length} Airtable records for skipped leads`);
            for (let i = 0; i < airtableUpdatesForSkipped.length; i += 10) {
                await clientBase("Leads").update(airtableUpdatesForSkipped.slice(i, i + 10));
            }
        } catch (airtableError) { 
            log.error(`Airtable update error for skipped leads: ${airtableError.message}`);
            await alertAdmin("Airtable Update Failed (Skipped Leads in batchScorer)", `Client: ${clientId || 'unknown'}\nError: ${String(airtableError)}`);
        }
    }

    if (!scorable.length) {
        log.summary(`No scorable leads in this chunk after pre-flight checks`);
        return { processed: records.length, successful: 0, failed: 0, tokensUsed: 0 };
    }
    log.process(`Attempting to score ${scorable.length} leads with Gemini`);

    // MULTI-TENANT: Pass clientId to buildPrompt to load client-specific attributes
    const systemPromptInstructions = await buildPrompt(log, clientId); 
    const slimmedLeadsForChunk = scorable.map(({ profile }) => slimLead(profile));
    const leadsDataForUserPrompt = JSON.stringify({ leads: slimmedLeadsForChunk });
    const generationPromptForGemini = `Score the following ${scorable.length} leads based on the criteria and JSON schema defined in the system instructions. The leads are: ${leadsDataForUserPrompt}`;
    
    // ***** THIS IS THE NEW LINE TO LOG THE CHARACTER LENGTH *****
    log.debug(`Length of generationPromptForGemini (characters): ${generationPromptForGemini.length}`);
    // ***** END OF NEW LINE *****
    
    const maxOutputForRequest = 60000; // DEBUG: High limit

    log.process(`DEBUG MODE - Calling Gemini. Using Model ID: ${BATCH_SCORER_GEMINI_MODEL_ID}. Max output tokens for API: ${maxOutputForRequest}`);

    let rawResponseText = "";
    let usageMetadataForBatch = {}; 
    let modelFinishReasonForBatch = null;
    let requestStartTime = Date.now(); // Initialize here so it's available after try/catch

    try {
        const modelInstanceForRequest = BATCH_SCORER_VERTEX_AI_CLIENT.getGenerativeModel({
            model: BATCH_SCORER_GEMINI_MODEL_ID, 
            systemInstruction: { parts: [{ text: systemPromptInstructions }] },
            safetySettings: [
                { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
                { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
                { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
                { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
            ],
            generationConfig: {
                temperature: 0,
                responseMimeType: "application/json",
                maxOutputTokens: maxOutputForRequest
            }
        });

        const requestPayload = {
            contents: [{ role: "user", parts: [{ text: generationPromptForGemini }] }],
        };
        
        requestStartTime = Date.now(); // Update timing right before API call
        const callPromise = modelInstanceForRequest.generateContent(requestPayload);
        const timer = new Promise((_, rej) => setTimeout(() => rej(new Error("Gemini API call timeout for batchScorer chunk")), GEMINI_TIMEOUT_MS));
        
        const result = await Promise.race([callPromise, timer]);

        if (!result || !result.response) throw new Error("Gemini API call (batchScorer chunk) returned no response object.");
        
        usageMetadataForBatch = result.response.usageMetadata || {};
        console.log("<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<");
        console.log(`batchScorer.scoreChunk: [${clientId || 'unknown'}] TOKENS FOR BATCH CALL (Gemini):`);
        console.log("  Prompt Tokens      :", usageMetadataForBatch.promptTokenCount || "?");
        console.log("  Candidates Tokens  :", usageMetadataForBatch.candidatesTokenCount || "?");
        console.log("  Total Tokens       :", usageMetadataForBatch.totalTokenCount || "?");
        console.log("<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<");

        const candidate = result.response.candidates?.[0];
        if (!candidate) { 
            const blockReason = result.response.promptFeedback?.blockReason;
            let sf = result.response.promptFeedback?.safetyRatings ? ` SafetyRatings: ${JSON.stringify(result.response.promptFeedback.safetyRatings)}`:"";
            if (blockReason) throw new Error(`Gemini API call (batchScorer chunk) blocked. Reason: ${blockReason}.${sf}`);
            throw new Error(`Gemini API call (batchScorer chunk) returned no candidates.${sf}`);
        }

        modelFinishReasonForBatch = candidate.finishReason;

        if (candidate.content && candidate.content.parts && candidate.content.parts[0].text) {
            rawResponseText = candidate.content.parts[0].text;
        } else { 
            log.warn(`Candidate had no text content. Finish Reason: ${modelFinishReasonForBatch || 'Unknown'}`);
        }

        if (modelFinishReasonForBatch === 'MAX_TOKENS') {
            log.warn(`Gemini API call finished due to MAX_TOKENS (limit was ${maxOutputForRequest}). Output may be truncated. SafetyRatings: ${JSON.stringify(candidate.safetyRatings)}`);
        } else if (modelFinishReasonForBatch && modelFinishReasonForBatch !== 'STOP') {
            log.warn(`Gemini API call finished with non-STOP reason: ${modelFinishReasonForBatch}. SafetyRatings: ${JSON.stringify(candidate.safetyRatings)}`);
        }

    } catch (error) { 
        log.error(`Gemini API call failed: ${error.message}`);
        await alertAdmin("Gemini API Call Failed (batchScorer Chunk)", `Client: ${clientId || 'unknown'}\nError: ${error.message}\\nChunk Lead IDs (first 5): ${scorable.slice(0,5).map(s=>s.id).join(', ')}`);
        const failedUpdates = scorable.map(item => ({ id: item.rec.id, fields: { "Scoring Status": "Failed – API Error", "Date Scored": new Date().toISOString() } }));
        if (failedUpdates.length > 0 && clientBase) for (let i = 0; i < failedUpdates.length; i += 10) await clientBase("Leads").update(failedUpdates.slice(i, i+10)).catch(e => log.error(`Airtable update error for API failed leads: ${e.message}`));
        return { processed: records.length, successful: 0, failed: records.length, tokensUsed: usageMetadataForBatch.totalTokenCount || 0 }; 
    }

    // Enhanced debugging for JSON truncation investigation
    const batchId = `BATCH_${new Date().toISOString().replace(/[:.]/g, '-')}_${scorable.length}leads`;
    const responseEndTime = Date.now();
    const responseTime = responseEndTime - requestStartTime;
    
    const batchDebugInfo = {
        batchId: batchId,
        chunkSize: scorable.length,
        maxOutputTokens: maxOutputForRequest,
        responseTime: `${responseTime}ms`,
        finishReason: modelFinishReasonForBatch,
        outputTokens: usageMetadataForBatch.candidatesTokenCount || 0,
        promptTokens: usageMetadataForBatch.promptTokenCount || 0,
        totalTokens: usageMetadataForBatch.totalTokenCount || 0,
        hitTokenLimit: modelFinishReasonForBatch === 'MAX_TOKENS',
        clientId: clientId || 'unknown',
        firstLeadId: scorable[0]?.id || 'unknown',
        lastLeadId: scorable[scorable.length - 1]?.id || 'unknown'
    };
    
    log.process(`🎯 BATCH_SCORER_DEBUG: ${JSON.stringify(batchDebugInfo)}`);
    
    // Response completeness analysis 
    const responseLength = rawResponseText.length;
    const lastChar = rawResponseText[responseLength - 1];
    const last50Chars = rawResponseText.substring(Math.max(0, responseLength - 50));
    const hasClosingBracket = rawResponseText.trim().endsWith(']');
    const hasClosingBrace = rawResponseText.trim().endsWith('}');
    
    const responseAnalysis = {
        batchId: batchId,
        responseLength: responseLength,
        lastCharacter: lastChar,
        last50Characters: last50Chars,
        appearsComplete: hasClosingBracket || hasClosingBrace,
        possiblyTruncated: !hasClosingBracket && !hasClosingBrace,
        finishReason: modelFinishReasonForBatch
    };
    
    log.process(`🔍 RESPONSE_ANALYSIS: ${JSON.stringify(responseAnalysis)}`);

    if (process.env.DEBUG_RAW_GEMINI === "1") {
        console.log(`batchScorer.scoreChunk: [${clientId || 'unknown'}] DBG-RAW-GEMINI (Full Batch Response Text):\n`, rawResponseText);
    } else if (modelFinishReasonForBatch === 'MAX_TOKENS' && rawResponseText) {
        console.log(`batchScorer.scoreChunk: [${clientId || 'unknown'}] DBG-RAW-GEMINI (MAX_TOKENS - Batch Snippet):\\n${rawResponseText.substring(0, 2000)}...`);
    }

    if (rawResponseText.trim() === "") {
        const errorMessage = `batchScorer.scoreChunk: [${clientId || 'unknown'}] Gemini response text is empty for batch. Finish Reason: ${modelFinishReasonForBatch || 'Unknown'}. Cannot parse scores.`;
        log.error(errorMessage);
        await alertAdmin("Gemini Empty Response (batchScorer)", errorMessage + `\\nChunk Lead IDs (first 5): ${scorable.slice(0,5).map(s=>s.id).join(', ')}`);
        const failedUpdates = scorable.map(item => ({ id: item.rec.id, fields: { "Scoring Status": "Failed – Empty AI Response", "Date Scored": new Date().toISOString() } })); 
        if (failedUpdates.length > 0 && clientBase) for (let i = 0; i < failedUpdates.length; i += 10) await clientBase("Leads").update(failedUpdates.slice(i, i+10)).catch(e => log.error(`Airtable update error for empty AI response leads: ${e.message}`));
        return { processed: records.length, successful: 0, failed: records.length, tokensUsed: usageMetadataForBatch.totalTokenCount || 0 };
    }

    let outputArray;
    try {
        const cleanedJsonString = rawResponseText.replace(/^```(?:json)?\\s*/i, "").replace(/\s*```$/, "");
        outputArray = JSON.parse(cleanedJsonString);
        if (!Array.isArray(outputArray)) {
            log.warn("Gemini batch response was not an array, attempting to wrap it.");
            outputArray = [outputArray]; 
        }
    } catch (parseErr) { 
        // Enhanced JSON parse error debugging
        const jsonParseFailInfo = {
            batchId: batchId,
            errorMessage: parseErr.message,
            responseLength: rawResponseText.length,
            finishReason: modelFinishReasonForBatch,
            wasTokenLimitHit: modelFinishReasonForBatch === 'MAX_TOKENS',
            errorContext: rawResponseText.substring(0, 200),
            last100Chars: rawResponseText.substring(Math.max(0, rawResponseText.length - 100))
        };
        
        log.error(`🚨 JSON_PARSE_FAILED: ${JSON.stringify(jsonParseFailInfo)}`);
        log.error(`Failed to parse Gemini JSON: ${parseErr.message}. Raw (first 500 chars): ${rawResponseText.substring(0, 500)}... Finish Reason: ${modelFinishReasonForBatch}`);
        await alertAdmin("Gemini JSON Parse Failed (batchScorer)", `Client: ${clientId || 'unknown'}\nError: ${parseErr.message}\nRaw: ${rawResponseText.substring(0, 500)}...\nChunk Lead IDs (first 5): ${scorable.slice(0,5).map(s=>s.id).join(', ')}`);
        const failedUpdates = scorable.map(item => ({ id: item.rec.id, fields: { "Scoring Status": "Failed – Parse Error", "Date Scored": new Date().toISOString() } }));
        if (failedUpdates.length > 0 && clientBase) for (let i = 0; i < failedUpdates.length; i += 10) await clientBase("Leads").update(failedUpdates.slice(i, i+10)).catch(e => log.error(`Airtable update error for parse-failed leads: ${e.message}`));
        return { processed: records.length, successful: 0, failed: records.length, tokensUsed: usageMetadataForBatch.totalTokenCount || 0 }; 
    }
    
    log.process(`Parsed ${outputArray.length} results from Gemini for chunk of ${scorable.length}`);
    if (outputArray.length !== scorable.length) { 
        await alertAdmin("Gemini Result Count Mismatch (batchScorer)", `Client: ${clientId || 'unknown'}\nExpected ${scorable.length}, got ${outputArray.length}.`);
    }

    let positives, negatives;
    try {
        const attrs = await loadAttributes(null, clientId);
        positives = attrs.positives;
        negatives = attrs.negatives;
    } catch (attrErr) {
        log.error(`Failed to load attributes for client ${clientId || 'unknown'}: ${attrErr.message}`);
        await alertAdmin("Attribute Loading Failed (batchScorer)", `Client: ${clientId || 'unknown'}\nError: ${attrErr.message}`);
        // Mark all leads as failed due to attribute loading error
        const failedUpdates = scorable.map(item => ({ id: item.rec.id, fields: { "Scoring Status": "Failed – Attribute Load Error", "Date Scored": new Date().toISOString(), "AI Profile Assessment": `Attribute Load Error: ${attrErr.message}` } }));
        if (failedUpdates.length > 0 && clientBase) {
            for (let i = 0; i < failedUpdates.length; i += 10) {
                await clientBase("Leads").update(failedUpdates.slice(i, i+10)).catch(e => log.error(`Airtable update error for attribute load failed leads: ${e.message}`));
            }
        }
        return { processed: records.length, successful: 0, failed: records.length, tokensUsed: 0 };
    }

    const airtableResultUpdates = [];
    let successfulUpdates = 0;
    let failedUpdates = 0;

    for (let i = 0; i < scorable.length; i++) {
        const leadItem = scorable[i];
        const geminiOutputItem = outputArray[i];

        if (!geminiOutputItem) { 
            log.warn(`No corresponding output from Gemini for lead ${leadItem.id} (index ${i}) in batch due to count mismatch. Marking failed.`);
            airtableResultUpdates.push({ id: leadItem.rec.id, fields: { "Scoring Status": "Failed – API Error", "Date Scored": new Date().toISOString() } });
            failedUpdates++;
            continue; 
        }
        
        const updateFields = { "Scoring Status": "Scored", "Date Scored": new Date().toISOString() };

        try {
            const positive_scores = geminiOutputItem.positive_scores || {};
            const negative_scores = geminiOutputItem.negative_scores || {};
            const attribute_reasoning_obj = geminiOutputItem.attribute_reasoning || {}; 
            const contact_readiness = geminiOutputItem.contact_readiness === true;
            const unscored_attributes = Array.isArray(geminiOutputItem.unscored_attributes) ? geminiOutputItem.unscored_attributes : [];
            
            let temp_positive_scores = {...positive_scores};
            if (contact_readiness && positives?.I && (temp_positive_scores.I === undefined || temp_positive_scores.I === null) ) {
                temp_positive_scores.I = positives.I.maxPoints || 0; 
                if(!attribute_reasoning_obj.I && temp_positive_scores.I > 0) { 
                    attribute_reasoning_obj.I = "Contact readiness indicated by AI, points awarded for attribute I.";
                }
            }
            
            const { percentage, rawScore: earned, denominator: max } =
                computeFinalScore(
                    temp_positive_scores, positives,
                    negative_scores, negatives,
                    contact_readiness, unscored_attributes
                );

            updateFields["AI Score"] = Math.round(percentage * 100) / 100;
            updateFields["AI Profile Assessment"] = String(geminiOutputItem.aiProfileAssessment || "N/A");
            updateFields["AI Attribute Breakdown"] = buildAttributeBreakdown(
                temp_positive_scores, positives,
                negative_scores, negatives,
                unscored_attributes, earned, max,
                attribute_reasoning_obj, 
                false, null 
            );
            updateFields["AI_Excluded"] = (geminiOutputItem.ai_excluded === "Yes" || geminiOutputItem.ai_excluded === true);
            updateFields["Exclude Details"] = String(geminiOutputItem.exclude_details || "");
            successfulUpdates++;

        } catch (scoringErr) { 
            console.error(`batchScorer.scoreChunk: [${clientId || 'unknown'}] Error in scoring logic for lead ${leadItem.id}: ${scoringErr.message}`, geminiOutputItem);
            updateFields["Scoring Status"] = "Failed – Scoring Logic Error";
            updateFields["Date Scored"] = new Date().toISOString();
            updateFields["AI Profile Assessment"] = `Scoring Error: ${scoringErr.message}`;
            await alertAdmin("Scoring Logic Error (batchScorer)", `Client: ${clientId || 'unknown'}\nLead ID: ${leadItem.id}\nError: ${scoringErr.message}`);
            failedUpdates++;
        }
        airtableResultUpdates.push({ id: leadItem.rec.id, fields: updateFields });
    }

    if (airtableResultUpdates.length > 0 && clientBase) { 
        console.log(`batchScorer.scoreChunk: [${clientId || 'unknown'}] Attempting final Airtable update for ${airtableResultUpdates.length} leads.`);
        for (let i = 0; i < airtableResultUpdates.length; i += 10) {
            const batchUpdates = airtableResultUpdates.slice(i, i + 10);
            try {
                await clientBase("Leads").update(batchUpdates);
                log.process(`Updated batch of ${batchUpdates.length} Airtable records`);
            } catch (airtableUpdateError) {
                log.error(`Airtable update error for scored/failed leads: ${airtableUpdateError.message}`, airtableUpdateError.stack);
                await alertAdmin("Airtable Update Failed (Batch Scoring Results)", `Client: ${clientId || 'unknown'}\nError: ${String(airtableUpdateError)}`);
                batchUpdates.forEach(bu => log.error(`Failed to update results for lead ID: ${bu.id}`));
                // Count these as failed updates since they didn't get saved
                failedUpdates += batchUpdates.filter(bu => bu.fields["Scoring Status"] === "Scored").length;
                successfulUpdates -= batchUpdates.filter(bu => bu.fields["Scoring Status"] === "Scored").length;
            }
        }
    }
    log.summary(`Finished chunk. Scorable: ${scorable.length}, Updates: ${airtableResultUpdates.length}, Successful: ${successfulUpdates}, Failed: ${failedUpdates}`);
    
    return { 
        processed: records.length, 
        successful: successfulUpdates, 
        failed: failedUpdates, 
        tokensUsed: usageMetadataForBatch.totalTokenCount || 0 
    };
}

/* ---------- MULTI-TENANT PUBLIC EXPORTED FUNCTION ---------------------- */
async function run(req, res, dependencies) { 
    // Create system-level logger for multi-tenant lead scoring operations
    const systemLogger = createSafeLogger('SYSTEM', null, 'lead_scoring');
    
    systemLogger.setup("=== STARTING MULTI-TENANT LEAD SCORING ===");

    if (!dependencies || !dependencies.vertexAIClient || !dependencies.geminiModelId) {
        const errorMsg = "Critical dependencies (vertexAIClient, geminiModelId) not provided";
        systemLogger.error(errorMsg);
        if (res && res.status && !res.headersSent) {
            res.status(503).json({ ok: false, error: "Batch scorer service not properly configured." });
        }
        await alertAdmin("batchScorer Run Aborted: Dependencies Missing", errorMsg);
        return;
    }

    BATCH_SCORER_VERTEX_AI_CLIENT = dependencies.vertexAIClient;
    BATCH_SCORER_GEMINI_MODEL_ID = dependencies.geminiModelId;

    systemLogger.setup("Dependencies received and set");

    const startTime = Date.now();
    const limit = Number(req?.query?.limit) || 1000;
    const requestedClientId = req?.query?.clientId;

    systemLogger.setup(`Parameters: limit=${limit}, clientId=${requestedClientId || 'ALL'}`);

    try {
        let clientsToProcess = [];
        
        if (requestedClientId) {
            // Single client mode
            systemLogger.setup(`Single client mode requested for: ${requestedClientId}`);
            const isValid = await clientService.validateClient(requestedClientId);
            if (!isValid) {
                const errorMsg = `Invalid or inactive client: ${requestedClientId}`;
                systemLogger.error(errorMsg);
                if (res && res.status && !res.headersSent) {
                    res.status(400).json({ ok: false, error: `Invalid client: ${requestedClientId}` });
                }
                return;
            }
            const client = await clientService.getClientById(requestedClientId);
            clientsToProcess = [client];
        } else {
            // Multi-client mode - process all active clients
            systemLogger.setup("Multi-client mode - processing all active clients");
            clientsToProcess = await clientService.getAllActiveClients();
        }

        if (!clientsToProcess.length) {
            const noClientsMsg = "No active clients found to process";
            systemLogger.summary(noClientsMsg);
            if (res && res.json && !res.headersSent) {
                res.json({ ok: true, message: noClientsMsg });
            }
            return;
        }

        systemLogger.setup(`Processing ${clientsToProcess.length} client(s): ${clientsToProcess.map(c => c.clientId).join(', ')}`);

        let totalLeadsProcessed = 0;
        let totalSuccessful = 0;
        let totalFailed = 0;
        let totalTokensUsed = 0;
        const clientResults = [];
        
        // Extract runId from request if available
        const runId = req?.query?.runId;
        if (runId) {
            systemLogger.setup(`Using run ID: ${runId}`);
        }

        // Process each client sequentially for error isolation
        for (const client of clientsToProcess) {
            const clientId = client.clientId;
            const clientStartTime = Date.now();
            
            // Create client-specific logger with shared session ID
            const clientLogger = createSafeLogger(clientId, systemLogger.getSessionId(), 'lead_scoring');
            clientLogger.setup(`--- PROCESSING CLIENT: ${client.clientName} (${clientId}) ---`);
            
            // Initialize client variables early
            let clientProcessed = 0;
            let clientSuccessful = 0;
            let clientFailed = 0;
            let clientTokensUsed = 0;
            const clientErrors = [];
            
            try {
                // Get client-specific Airtable base
                const clientBase = await getClientBase(clientId);
                if (!clientBase) {
                    throw new Error(`Failed to get Airtable base for client ${clientId}`);
                }

                clientLogger.setup(`Connected to client base: ${client.airtableBaseId}`);

                // Fetch leads for this client (with error handling)
                let leads;
                try {
                    leads = await fetchLeads(limit, clientBase, clientId, clientLogger);
                } catch (fetchError) {
                    const errorMsg = `Failed to fetch leads: ${fetchError.message}`;
                    clientLogger.error(errorMsg);
                    clientErrors.push(errorMsg);
                    
                    // Continue with empty leads array - all failures will be counted in the outer catch
                    leads = [];
                }
                
                if (!leads.length) {
                    // Get a more detailed reason for no leads
                    const TESTING_MODE = process.env.FIRE_AND_FORGET_BATCH_PROCESS_TESTING === 'true';
                    const reason = TESTING_MODE ? 
                        `No leads found with "To Be Scored" status or recently scored (testing mode active)` : 
                        `No leads found with "To Be Scored" status`;
                    
                    clientLogger.summary(reason);
                    
                    // Log execution for this client
                    const duration = Date.now() - clientStartTime;
                    const logEntry = clientService.formatExecutionLog({
                        status: 'Completed successfully',
                        leadsProcessed: { successful: 0, failed: 0, total: 0 },
                        duration: `${Math.round(duration / 1000)} seconds`,
                        tokensUsed: 0,
                        errors: []
                    });
                    await clientService.updateExecutionLog(clientId, logEntry);
                    
                    // ARCHITECTURAL FIX: Only update existing records, never create
                    if (runId) {
                        try {
                            // Check if record exists first
                            const recordExists = await runRecordService.checkRunRecordExists({
                                runId, 
                                clientId,
                                options: {
                                    logger: clientLogger,
                                    source: 'batchScorer_skip'
                                }
                            });
                            
                            if (recordExists) {
                                clientLogger.setup(`Updating existing client run record with skip reason: ${reason}`);
                                // Only complete the record if it exists
                                await runRecordService.completeRunRecord({
                                    runId, 
                                    clientId, 
                                    Status: 'Skipped', 
                                    notes: `No action taken: ${reason}`,
                                    options: {
                                        logger: clientLogger,
                                        source: 'batchScorer_skip'
                                    }
                                });
                            } else {
                                clientLogger.warn(`No run record exists for ${runId}/${clientId} - cannot update with skip status`);
                            }
                        } catch (error) {
                            clientLogger.warn(`Failed to update client run record: ${error.message}`);
                        }
                    }
                    
                    clientResults.push({
                        clientId,
                        processed: 0,
                        successful: 0,
                        failed: 0,
                        tokensUsed: 0,
                        duration: Math.round(duration / 1000),
                        status: 'No leads to process',
                        reason: reason,
                        errorDetails: []  // ADD: Empty array for consistency
                    });
                    continue;
                }

                clientLogger.setup(`Fetched ${leads.length} leads. Chunk size: ${CHUNK_SIZE}`);

                // Create chunks for this client
                const chunks = [];
                for (let i = 0; i < leads.length; i += CHUNK_SIZE) {
                    chunks.push(leads.slice(i, i + CHUNK_SIZE));
                }

                clientLogger.process(`Queuing ${leads.length} leads in ${chunks.length} chunk(s)`);
                
                // Reset the client counters since they were declared earlier
                clientProcessed = 0;
                clientSuccessful = 0;
                clientFailed = 0;
                clientTokensUsed = 0;

                // ARCHITECTURAL FIX: Only check for existing records, never create
                if (runId) {
                    try {
                        clientLogger.setup(`Checking for existing client run record for ${clientId} in run ${runId}...`);
                        
                        // Check if record exists first
                        const recordExists = await runRecordService.checkRunRecordExists({
                            runId, 
                            clientId,
                            options: {
                                logger: clientLogger,
                                source: 'batchScorer_process'
                            }
                        });
                        
                        if (recordExists) {
                            clientLogger.setup(`Found existing run record for ${runId}/${clientId}`);
                            
                            // Update the existing record with processing started status
                            await runRecordService.updateRunRecord({
                                runId,
                                clientId,
                                updates: {
                                    'System Notes': `Batch scoring process started at ${new Date().toISOString()}`
                                },
                                options: {
                                    logger: clientLogger,
                                    source: 'batchScorer_process'
                                }
                            });
                        } else {
                            clientLogger.warn(`No run record exists for ${runId}/${clientId} - continuing without metrics tracking`);
                        }
                    } catch (error) {
                        clientLogger.warn(`Failed to verify client run record: ${error.message}. Continuing execution.`);
                    }
                }
                
                // Process chunks for this client
                for (const chunk of chunks) {
                    try {
                        const chunkResult = await scoreChunk(chunk, clientId, clientBase, clientLogger);
                        clientProcessed += chunkResult.processed;
                        clientSuccessful += chunkResult.successful;
                        clientFailed += chunkResult.failed;
                        clientTokensUsed += chunkResult.tokensUsed;
                        
                        // Update metrics in run tracking if runId is provided
                        if (runId) {
                            try {
                                const metrics = {
                                    'Profiles Examined for Scoring': chunkResult.processed || 0,
                                    'Profiles Successfully Scored': chunkResult.successful || 0,
                                    'Profile Scoring Tokens': chunkResult.tokensUsed || 0
                                };
                                await trackLeadProcessingMetrics(runId, clientId, metrics);
                            } catch (metricError) {
                                clientLogger.warn(`Failed to update run metrics: ${metricError.message}`);
                            }
                        }
                    } catch (chunkError) {
                        clientLogger.error(`Chunk processing error: ${chunkError.message}`, chunkError.stack);
                        clientErrors.push(`Chunk error: ${chunkError.message}`);
                        clientFailed += chunk.length; // Mark all leads in failed chunk as failed
                    }
                }

                // Calculate client execution time
                const clientDuration = Date.now() - clientStartTime;
                
                // Create a detailed reason/notes about what happened
                let reason;
                if (clientProcessed === 0) {
                    reason = `No leads were processed`;
                } else if (clientSuccessful === 0 && clientProcessed > 0) {
                    reason = `Processed ${clientProcessed} leads but none were scored successfully`;
                } else if (clientErrors.length === 0) {
                    reason = `Processed ${clientProcessed} leads, scored ${clientSuccessful} successfully`;
                } else {
                    reason = `Processed ${clientProcessed} leads with ${clientErrors.length} errors`;
                }
                
                // Complete client run record if runId is provided
                if (runId) {
                    try {
                        const success = clientErrors.length === 0;
                        
                        clientLogger.setup(`Completing client run record for ${clientId}...`);
                        const status = success ? 'Success' : 'Error';
                        await runRecordService.completeRunRecord(runId, clientId, status, reason, {
                            logger: clientLogger,
                            source: 'batchScorer_complete'
                        });
                    } catch (error) {
                        clientLogger.warn(`Failed to complete client run record: ${error.message}`);
                    }
                }
                
                // Update totals
                totalLeadsProcessed += clientProcessed;
                totalSuccessful += clientSuccessful;
                totalFailed += clientFailed;
                totalTokensUsed += clientTokensUsed;

                // Log execution for this client
                const clientStatus = clientErrors.length > 0 ? 'Completed with errors' : 'Completed successfully';
                const logEntry = clientService.formatExecutionLog({
                    status: clientStatus,
                    leadsProcessed: {
                        successful: clientSuccessful,
                        failed: clientFailed,
                        total: clientProcessed
                    },
                    duration: `${Math.round(clientDuration / 1000)}s`,
                    tokensUsed: clientTokensUsed,
                    errors: clientErrors
                });
                await clientService.updateExecutionLog(clientId, logEntry);

                clientResults.push({
                    clientId,
                    processed: clientProcessed,
                    successful: clientSuccessful,
                    failed: clientFailed,
                    tokensUsed: clientTokensUsed,
                    duration: Math.round(clientDuration / 1000),
                    status: clientStatus,
                    reason: reason, // Add the detailed reason
                    errorDetails: clientErrors && clientErrors.length > 0 ? clientErrors : []  // Handle potential undefined
                });

                console.log(`batchScorer.run: [${clientId}] Client processing completed. Processed: ${clientProcessed}, Successful: ${clientSuccessful}, Failed: ${clientFailed}, Tokens: ${clientTokensUsed}`);

            } catch (clientError) {
                console.error(`batchScorer.run: [${clientId}] Fatal client processing error:`, clientError);
                
                // Log client failure
                const clientDuration = Date.now() - clientStartTime;
                const errorReason = `Failed to process client: ${clientError.message}`;
                
                const logEntry = clientService.formatExecutionLog({
                    status: 'Failed',
                    leadsProcessed: {
                        successful: 0,
                        failed: 0,
                        total: 0
                    },
                    duration: `${Math.round(clientDuration / 1000)}s`,
                    tokensUsed: 0,
                    errors: [`Fatal error: ${clientError.message}`]
                });
                await clientService.updateExecutionLog(clientId, logEntry);
                
                // Complete client run record if runId is provided
                if (runId) {
                    try {
                        console.log(`Completing failed client run record for ${clientId}...`);
                        // FIXED: Use proper field name capitalization and validate IDs
                        const safeRunId = typeof runId === 'object' ? (runId.runId || runId.id || String(runId)) : String(runId);
                        const safeClientId = typeof clientId === 'object' ? (clientId.clientId || clientId.id || String(clientId)) : String(clientId);
                        
                        await runRecordService.completeRunRecord(safeRunId, safeClientId, 'Error', {
                            'Status': 'Error',  // Use properly capitalized field name
                            'System Notes': errorReason,
                            'Error Summary': errorReason
                        }, {
                            source: 'batchScorer_error'
                        });
                    } catch (error) {
                        console.warn(`Failed to complete client run record: ${error.message}`);
                    }
                }

                clientResults.push({
                    clientId,
                    processed: 0,
                    successful: 0,
                    failed: 0,
                    tokensUsed: 0,
                    duration: Math.round(clientDuration / 1000),
                    status: `Failed: ${clientError.message}`,
                    reason: errorReason,
                    errorDetails: [`Fatal error: ${clientError.message}`]  // ADD: Include fatal error details
                });

                // Alert admin but continue with other clients
                await alertAdmin(`batchScorer: Client ${clientId} Failed`, `Error: ${clientError.message}\nStack: ${clientError.stack}`);
            }
        }

        const totalDuration = Math.round((Date.now() - startTime) / 1000);
        
        const message = requestedClientId 
            ? `Single client processing completed for ${requestedClientId}. Processed: ${totalLeadsProcessed}, Successful: ${totalSuccessful}, Failed: ${totalFailed}, Tokens: ${totalTokensUsed}, Duration: ${totalDuration}s`
            : `Multi-client batch scoring completed for ${clientsToProcess.length} clients. Total processed: ${totalLeadsProcessed}, Successful: ${totalSuccessful}, Failed: ${totalFailed}, Tokens: ${totalTokensUsed}, Duration: ${totalDuration}s`;
        
        systemLogger.summary(message);
        
        // Complete job tracking record if runId is provided
        if (runId) {
            try {
                systemLogger.setup(`Updating aggregate metrics for run ${runId}...`);
                await airtableService.updateAggregateMetrics(runId);
                
                const success = totalFailed === 0;
                const notes = `Processed ${totalLeadsProcessed} leads across ${clientsToProcess.length} clients`;
                
                systemLogger.setup(`Completing job tracking record for run ${runId}...`);
                await airtableService.completeJobRun(runId, success, notes);
            } catch (error) {
                systemLogger.warn(`Failed to update/complete job tracking record: ${error.message}`);
            }
        }
        
        if (res && res.json && !res.headersSent) {
            res.json({ 
                ok: true, 
                message: message,
                summary: {
                    clientsProcessed: clientsToProcess.length,
                    totalLeadsProcessed,
                    totalSuccessful,
                    totalFailed,
                    totalTokensUsed,
                    totalDurationSeconds: totalDuration
                },
                clientResults
            });
        }
        
    } catch (err) { 
        systemLogger.error(`Multi-tenant batch run fatal error: ${err.message}`, err.stack);
        if (res && res.status && res.json && !res.headersSent) {
            res.status(500).json({ ok: false, error: String(err.message || err) });
        }
        await alertAdmin("batchScorer: Multi-Tenant Batch Run Failed Critically", `Error: ${String(err.message)}\nStack: ${err.stack}`);
    }
}

// Direct execution block (remains with warnings about needing manual dependency setup if run directly)
if (require.main === module) { 
    console.warn("batchScorer.js: Attempting to run directly via Node.js.");
    console.warn("batchScorer.js: Direct execution mode currently does NOT support automatic dependency injection (Gemini client, multi-tenant configuration).");
    console.warn("batchScorer.js: This direct run will likely fail unless this script is modified to load configurations itself OR if called by a wrapper that provides them.");
}

module.exports = { run };