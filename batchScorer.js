// batchScorer.js - Refactored to use centralized configs and helpers

require("dotenv").config(); // For process.env access

// --- Centralized Dependencies (will be passed into 'run' function) ---
// We will store them in module-scoped variables once 'run' is called.
let BATCH_SCORER_VERTEX_AI_CLIENT;
let BATCH_SCORER_GEMINI_MODEL_ID;
let BATCH_SCORER_AIRTABLE_BASE;

// --- NPM Modules & Local Modules batchScorer itself needs ---
const fetch = (...a) => import("node-fetch").then(({ default: f }) => f(...a)); // Still needed if alertAdmin is called from here

// Local modules needed by batchScorer's logic
const { buildPrompt, slimLead } = require("./promptBuilder"); // Assuming these are in the project root
const { loadAttributes } = require("./attributeLoader");
const { computeFinalScore } = require("./scoring");
const { buildAttributeBreakdown } = require("./breakdown");

// Centralized Helper functions
const { alertAdmin, isMissingCritical } = require('./utils/appHelpers.js'); // Using centralized helpers

/* ---------- ENV CONFIGURATION for Batch Scorer Operations ----------- */
// MODEL_ID from env is a fallback if not passed, but passed one should be primary.
// For CHUNK_SIZE and TIMEOUT, these are specific to batch scorer's operation.
const DEFAULT_MODEL_ID_FALLBACK = process.env.GEMINI_MODEL_ID || "gemini-2.5-pro-preview-05-06";
const CHUNK_SIZE = Math.max(1, parseInt(process.env.BATCH_CHUNK_SIZE || "70", 10));
const GEMINI_TIMEOUT_MS = Math.max(30000, parseInt(process.env.GEMINI_TIMEOUT_MS || "240000", 10));

console.log("▶︎ batchScorer module loaded (Refactored Version). Ready to receive dependencies.");

/*
    BLOCKS REMOVED:
    - Internal "GOOGLE GENERATIVE AI CLIENT INITIALIZATION"
    - Internal "AIRTABLE CONFIGURATION"
    - Internal 'alertAdmin' function (now uses centralized one from appHelpers)
    - Internal 'isMissingCritical' function (now uses centralized one from appHelpers)
*/

/* ---------- LEAD PROCESSING QUEUE (Unchanged logic) ------------- */
const queue = [];
let running = false;
async function enqueue(recs) { // Note: This enqueue is internal to batchScorer's run
    queue.push(recs);
    if (running) return;
    running = true;
    console.log(`batchScorer.enqueue: Queue started. ${queue.length} chunk(s) to process.`);
    while (queue.length) {
        const chunk = queue.shift();
        console.log(`batchScorer.enqueue: Processing chunk of ${chunk.length} records...`);
        try {
            // scoreChunk will now use the module-scoped BATCH_SCORER_... variables
            await scoreChunk(chunk);
        } catch (err) {
            console.error(`batchScorer.enqueue: CHUNK FATAL ERROR for a chunk of ${chunk.length} records:`, err.message, err.stack);
            await alertAdmin("Chunk Failed Critically (batchScorer)", `Error: ${String(err.message)}\nStack: ${err.stack}`);
        }
    }
    running = false;
    console.log("batchScorer.enqueue: Queue empty, all processing finished for this run.");
}

/* ---------- FETCH LEADS FROM AIRTABLE --------- */
async function fetchLeads(limit) {
    if (!BATCH_SCORER_AIRTABLE_BASE) {
        throw new Error("batchScorer.fetchLeads: Airtable base not initialized/provided.");
    }
    const records = [];
    console.log(`batchScorer.fetchLeads: Fetching up to ${limit} leads with Scoring Status = 'To Be Scored'`);
    await BATCH_SCORER_AIRTABLE_BASE("Leads") // Uses module-scoped base
        .select({ maxRecords: limit, view: "To Be Scored" }) // Ensure you have this view
        .eachPage((pageRecords, next) => {
            records.push(...pageRecords);
            next();
        }).catch(err => {
            console.error("batchScorer.fetchLeads: Error fetching leads from Airtable:", err);
            throw err;
        });
    console.log(`batchScorer.fetchLeads: Fetched ${records.length} leads.`);
    return records;
}

/* =================================================================
    scoreChunk - Processes a chunk of leads with Gemini
=================================================================== */
async function scoreChunk(records) {
    if (!BATCH_SCORER_VERTEX_AI_CLIENT || !BATCH_SCORER_GEMINI_MODEL_ID) {
        const errorMsg = "batchScorer.scoreChunk: Aborting. Gemini AI Client or Model ID not initialized/provided. Check startup logs and if dependencies are passed to batchScorer.run().";
        console.error(errorMsg);
        await alertAdmin("Aborted Chunk (batchScorer): Gemini Client/ModelID Not Provided", errorMsg);
        const failedUpdates = records.map(rec => ({
            id: rec.id,
            fields: { "Scoring Status": "Failed – Client Init Error" }
        }));
        if (failedUpdates.length > 0 && BATCH_SCORER_AIRTABLE_BASE) {
            for (let i = 0; i < failedUpdates.length; i += 10) await BATCH_SCORER_AIRTABLE_BASE("Leads").update(failedUpdates.slice(i, i+10)).catch(e => console.error("batchScorer.scoreChunk: Airtable update error for client init failed leads:", e));
        }
        return;
    }

    const scorable = [];
    const airtableUpdatesForSkipped = [];

    for (const rec of records) {
        const profile = JSON.parse(rec.get("Profile Full JSON") || "{}");
        const aboutText = (profile.about || profile.summary || profile.linkedinDescription || "").trim();
        
        if (isMissingCritical(profile)) { // Uses centralized helper
            console.log(`batchScorer.scoreChunk: Lead ${rec.id} [${profile.linkedinProfileUrl || profile.profile_url || "unknown"}] missing critical data. Alerting admin.`);
            await alertAdmin( /* ... */ ); // Uses centralized helper
        }

        if (aboutText.length < 40) {
            console.log(`batchScorer.scoreChunk: Lead ${rec.id} profile too thin, skipping. Queuing Airtable update.`);
            airtableUpdatesForSkipped.push({
                id: rec.id,
                fields: { "AI Score": 0, "Scoring Status": "Skipped – Profile Too Thin", "AI Profile Assessment": "", "AI Attribute Breakdown": "" }
            });
            continue;
        }
        scorable.push({ id: rec.id, rec, profile });
    }

    if (airtableUpdatesForSkipped.length > 0 && BATCH_SCORER_AIRTABLE_BASE) {
        try {
            console.log(`batchScorer.scoreChunk: Updating ${airtableUpdatesForSkipped.length} Airtable records for skipped leads.`);
            for (let i = 0; i < airtableUpdatesForSkipped.length; i += 10) {
                await BATCH_SCORER_AIRTABLE_BASE("Leads").update(airtableUpdatesForSkipped.slice(i, i + 10));
            }
        } catch (airtableError) { /* ... alertAdmin ... */ }
    }

    if (!scorable.length) {
        console.log("batchScorer.scoreChunk: No scorable leads in this chunk after pre-flight checks.");
        return;
    }
    console.log(`batchScorer.scoreChunk: Attempting to score ${scorable.length} leads with Gemini.`);

    const systemPromptInstructions = await buildPrompt(); 
    const slimmedLeadsForChunk = scorable.map(({ profile }) => slimLead(profile));
    const leadsDataForUserPrompt = JSON.stringify({ leads: slimmedLeadsForChunk });
    const generationPromptForGemini = `Score the following ${scorable.length} leads based on the criteria and JSON schema defined in the system instructions. The leads are: ${leadsDataForUserPrompt}`;
    
    const estimatedTokensPerLead = 700; // These constants can remain or be passed in if more dynamic
    const bufferTokens = 2048;
    const calculatedMaxOutputTokens = (scorable.length * estimatedTokensPerLead) + bufferTokens;
    const maxOutputForRequest = Math.min(65536 - 100, calculatedMaxOutputTokens); // Gemini Pro 1.5 has larger limits, adjust if using that. This seems like for older models or a general safe cap.

    console.log(`batchScorer.scoreChunk: Calling Gemini. Using Model ID: ${BATCH_SCORER_GEMINI_MODEL_ID}. Max output tokens for API: ${maxOutputForRequest}`);

    let rawResponseText;
    try {
        // Use the passed-in BATCH_SCORER_VERTEX_AI_CLIENT and BATCH_SCORER_GEMINI_MODEL_ID
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
        
        const callPromise = modelInstanceForRequest.generateContent(requestPayload);
        const timer = new Promise((_, rej) => setTimeout(() => rej(new Error("Gemini API call timeout for batchScorer chunk")), GEMINI_TIMEOUT_MS));
        
        const result = await Promise.race([callPromise, timer]);

        if (!result || !result.response) throw new Error("Gemini API call (batchScorer chunk) returned no response object.");
        
        // ... (rest of Gemini response handling, same as before) ...
        const candidate = result.response.candidates?.[0];
        if (!candidate) {
            const blockReason = result.response.promptFeedback?.blockReason;
            let sf = result.response.promptFeedback?.safetyRatings ? ` SafetyRatings: ${JSON.stringify(result.response.promptFeedback.safetyRatings)}`:"";
            if (blockReason) throw new Error(`Gemini API call (batchScorer chunk) blocked. Reason: ${blockReason}.${sf}`);
            throw new Error(`Gemini API call (batchScorer chunk) returned no candidates.${sf}`);
        }
        if (candidate.content && candidate.content.parts && candidate.content.parts[0].text) {
            rawResponseText = candidate.content.parts[0].text;
        } else {
            const fr = candidate.finishReason;
            let sf = candidate.safetyRatings ? ` SafetyRatings: ${JSON.stringify(candidate.safetyRatings)}`:"";
            if (fr && fr !== "STOP") throw new Error(`Gemini API call (batchScorer chunk) finished with reason: ${fr}.${sf}`);
            throw new Error(`Gemini API call (batchScorer chunk) returned candidate with no text content.${sf}`);
        }

    } catch (error) {
        // ... (error handling for Gemini call, update Airtable status to "Failed – API Error") ...
        // Ensure BATCH_SCORER_AIRTABLE_BASE is used here for updates
        console.error(`batchScorer.scoreChunk: Gemini API call failed: ${error.message}.`);
        await alertAdmin("Gemini API Call Failed (batchScorer Chunk)", `Error: ${error.message}\nChunk Lead IDs (first 5): ${scorable.slice(0,5).map(s=>s.id).join(', ')}`);
        const failedUpdates = scorable.map(item => ({ id: item.rec.id, fields: { "Scoring Status": "Failed – API Error" } }));
        if (failedUpdates.length > 0 && BATCH_SCORER_AIRTABLE_BASE) for (let i = 0; i < failedUpdates.length; i += 10) await BATCH_SCORER_AIRTABLE_BASE("Leads").update(failedUpdates.slice(i, i+10)).catch(e => console.error("batchScorer.scoreChunk: Airtable update error for API failed leads:", e));
        return;
    }

    let outputArray;
    try {
        // ... (JSON parsing logic, same as before) ...
        const cleanedJsonString = rawResponseText.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
        outputArray = JSON.parse(cleanedJsonString);
        if (!Array.isArray(outputArray)) outputArray = [outputArray]; // Ensure it's an array
    } catch (parseErr) {
        // ... (error handling for parse error, update Airtable status to "Failed – Parse Error") ...
        // Ensure BATCH_SCORER_AIRTABLE_BASE is used here
        console.error(`batchScorer.scoreChunk: Failed to parse Gemini JSON: ${parseErr.message}. Raw (500 chars): ${rawResponseText.substring(0, 500)}...`);
        await alertAdmin("Gemini JSON Parse Failed (batchScorer)", `Error: ${parseErr.message}\nRaw: ${rawResponseText.substring(0, 500)}...\nChunk Lead IDs (first 5): ${scorable.slice(0,5).map(s=>s.id).join(', ')}`);
        const failedUpdates = scorable.map(item => ({ id: item.rec.id, fields: { "Scoring Status": "Failed – Parse Error" } }));
        if (failedUpdates.length > 0 && BATCH_SCORER_AIRTABLE_BASE) for (let i = 0; i < failedUpdates.length; i += 10) await BATCH_SCORER_AIRTABLE_BASE("Leads").update(failedUpdates.slice(i, i+10)).catch(e => console.error("batchScorer.scoreChunk: Airtable update error for parse-failed leads:", e));
        return;
    }
    
    console.log(`batchScorer.scoreChunk: Parsed ${outputArray.length} results from Gemini for chunk of ${scorable.length}.`);
    if (outputArray.length !== scorable.length) { /* ... alertAdmin ... */ }

    const { positives, negatives } = await loadAttributes();
    const airtableResultUpdates = [];

    for (let i = 0; i < scorable.length; i++) {
        // ... (logic to process each Gemini output, computeFinalScore, buildAttributeBreakdown, same as before) ...
        // This loop uses computeFinalScore, buildAttributeBreakdown which are required from their own modules.
        // It also has the specific "I" attribute logic.
        const leadItem = scorable[i];
        const geminiOutputItem = outputArray[i];

        if (!geminiOutputItem) {
            console.warn(`batchScorer.scoreChunk: No output from Gemini for lead ${leadItem.id} (index ${i}) in batch. Marking failed.`);
            airtableResultUpdates.push({ id: leadItem.rec.id, fields: { "Scoring Status": "Failed – Missing in AI Batch Response" } });
            continue;
        }
        
        const updateFields = { "Scoring Status": "Scored", "Date Scored": new Date().toISOString().split("T")[0] };

        try {
            const positive_scores = geminiOutputItem.positive_scores || {};
            const negative_scores = geminiOutputItem.negative_scores || {};
            const attribute_reasoning_obj = geminiOutputItem.attribute_reasoning || {}; 
            const contact_readiness = geminiOutputItem.contact_readiness === true;
            const unscored_attributes = Array.isArray(geminiOutputItem.unscored_attributes) ? geminiOutputItem.unscored_attributes : [];
            
            // Specific "I" attribute logic (as per user request, this should also be in singleScorer path)
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
                false, null // showZeros = false for batch
            );
            updateFields["AI_Excluded"] = (geminiOutputItem.ai_excluded === "Yes" || geminiOutputItem.ai_excluded === true);
            updateFields["Exclude Details"] = String(geminiOutputItem.exclude_details || "");

        } catch (scoringErr) {
            console.error(`batchScorer.scoreChunk: Error in scoring logic for lead ${leadItem.id}: ${scoringErr.message}`, geminiOutputItem);
            updateFields["Scoring Status"] = "Failed – Scoring Logic Error";
            updateFields["AI Profile Assessment"] = `Scoring Error: ${scoringErr.message}`;
            await alertAdmin("Scoring Logic Error (batchScorer)", `Lead ID: ${leadItem.id}\nError: ${scoringErr.message}`);
        }
        airtableResultUpdates.push({ id: leadItem.rec.id, fields: updateFields });
    }

    if (airtableResultUpdates.length > 0 && BATCH_SCORER_AIRTABLE_BASE) {
        // ... (Airtable update logic, same as before, using BATCH_SCORER_AIRTABLE_BASE) ...
        console.log(`batchScorer.scoreChunk: Attempting final Airtable update for ${airtableResultUpdates.length} leads.`);
        for (let i = 0; i < airtableResultUpdates.length; i += 10) {
            const batchUpdates = airtableResultUpdates.slice(i, i + 10);
            try {
                await BATCH_SCORER_AIRTABLE_BASE("Leads").update(batchUpdates);
                console.log(`batchScorer.scoreChunk: Updated batch of ${batchUpdates.length} Airtable records.`);
            } catch (airtableUpdateError) {
                console.error("batchScorer.scoreChunk: Airtable update error for scored/failed leads:", airtableUpdateError);
                await alertAdmin("Airtable Update Failed (Batch Scoring Results)", String(airtableUpdateError));
                batchUpdates.forEach(bu => console.error(`batchScorer.scoreChunk: Failed to update results for lead ID: ${bu.id}`));
            }
        }
    }
    console.log(`batchScorer.scoreChunk: Finished chunk. Scorable: ${scorable.length}, Updates: ${airtableResultUpdates.length}.`);
}

/* ---------- PUBLIC EXPORTED FUNCTION ---------------------- */
async function run(req, res, dependencies) { 
    console.log("batchScorer.run: Invoked.");

    if (!dependencies || !dependencies.vertexAIClient || !dependencies.geminiModelId || !dependencies.airtableBase) {
        const errorMsg = "batchScorer.run: Critical dependencies (vertexAIClient, geminiModelId, airtableBase) not provided.";
        console.error(errorMsg);
        if (res && res.status && !res.headersSent) {
            res.status(503).json({ ok: false, error: "Batch scorer service not properly configured." });
        }
        // Use the centralized alertAdmin, which should be available via require at the top
        await alertAdmin("batchScorer Run Aborted: Dependencies Missing", errorMsg);
        return;
    }

    // Store dependencies in module-scoped variables so other functions in this file can use them
    BATCH_SCORER_VERTEX_AI_CLIENT = dependencies.vertexAIClient;
    BATCH_SCORER_GEMINI_MODEL_ID = dependencies.geminiModelId;
    BATCH_SCORER_AIRTABLE_BASE = dependencies.airtableBase;

    console.log("batchScorer.run: Dependencies received and set.");

    try {
        const limit = Number(req?.query?.limit) || 1000; 
        console.log(`batchScorer.run: Fetching leads, limit: ${limit}`);
        const leads = await fetchLeads(limit); // Will use BATCH_SCORER_AIRTABLE_BASE

        if (!leads.length) {
            const noLeadsMsg = "batchScorer.run: No leads found in 'To Be Scored' to process.";
            console.log(noLeadsMsg);
            if (res && res.json && !res.headersSent) {
                res.json({ ok: true, message: noLeadsMsg });
            }
            return;
        }
        console.log(`batchScorer.run: Fetched ${leads.length}. Chunk size: ${CHUNK_SIZE}.`);

        const chunks = [];
        for (let i = 0; i < leads.length; i += CHUNK_SIZE) {
            chunks.push(leads.slice(i, i + CHUNK_SIZE));
        }

        console.log(`batchScorer.run: Queuing ${leads.length} leads in ${chunks.length} chunk(s).`);
        // Enqueue all chunks. The enqueue function itself will process them sequentially.
        for (const c of chunks) { 
            await enqueue(c); // This pushes to the queue, and an active loop processes it.
        }
        
        const message = `batchScorer.run: Batch scoring initiated for ${leads.length} leads in ${chunks.length} chunks. Processing will continue in the background.`;
        console.log(message);
        if (res && res.json && !res.headersSent) {
            res.json({ ok: true, message: message, leadsQueued: leads.length });
        }
        
    } catch (err) {
        console.error("batchScorer.run: Batch run fatal error:", err.message, err.stack);
        if (res && res.status && res.json && !res.headersSent) {
            res.status(500).json({ ok: false, error: String(err.message || err) });
        }
        await alertAdmin("batchScorer: Batch Run Failed Critically", `Error: ${String(err.message)}\nStack: ${err.stack}`);
    }
}

// Handling direct execution (e.g., for a cron job or manual script run)
// This part will now NOT work as expected without manually providing dependencies.
// For now, we'll leave it but note that it's not usable without modification
// if you were previously running `node batchScorer.js` directly.
if (require.main === module) {
    console.warn("batchScorer.js: Attempting to run directly via Node.js.");
    console.warn("batchScorer.js: Direct execution mode currently does NOT support automatic dependency injection (Gemini client, Airtable base).");
    console.warn("batchScorer.js: This direct run will likely fail unless this script is modified to load configurations itself OR if called by a wrapper that provides them.");
    
    // Example of how it might be adapted if needed (but not fully implemented here)
    // const localGeminiConfig = require('./config/geminiClient.js');
    // const localAirtableBase = require('./config/airtableClient.js');
    // if (localGeminiConfig && localGeminiConfig.vertexAIClient && localAirtableBase) {
    //     const runLimit = parseInt(process.env.RUN_LIMIT, 10);
    //     const initialLimit = isNaN(runLimit) ? CHUNK_SIZE * 2 : runLimit; 
    //     console.log(`batchScorer (direct run attempt) initial limit: ${initialLimit}.`);
    //     run(
    //         { query: { limit: initialLimit } }, // mock req object
    //         null,                               // mock res object
    //         {                                   // dependencies
    //             vertexAIClient: localGeminiConfig.vertexAIClient,
    //             geminiModelId: localGeminiConfig.geminiModelId,
    //             airtableBase: localAirtableBase
    //         }
    //     ).then(() => { /* ... */ }).catch(err => { /* ... */ });
    // } else {
    //     console.error("batchScorer.js (direct run): Failed to load necessary configurations for direct execution.");
    // }
}

module.exports = { run };