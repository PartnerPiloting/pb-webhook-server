/* ===================================================================
   batchScorer.js  –  Gemini 2.5 Pro bulk scorer (chunked, always verbose)
   -------------------------------------------------------------------
   • Pulls “To Be Scored” leads from Airtable in chunks.
   • Sends each chunk to Gemini, expecting a detailed JSON array response.
   • ALWAYS uses our locally-computed percentage when writing AI Score.
=================================================================== */

require("dotenv").config();
console.log("▶︎ batchScorer module loaded (Gemini Always Verbose Version)");

const { VertexAI } = require('@google-cloud/vertexai'); // For service account auth with Vertex AI models
const { HarmCategory, HarmBlockThreshold } = require("@google/generative-ai"); // For safety settings
const Airtable = require("airtable");
const fetch = (...a) => import("node-fetch").then(({ default: f }) => f(...a)); // For Mailgun

// Your existing helper modules
const { buildPrompt, slimLead } = require("./promptBuilder");
const { loadAttributes } = require("./attributeLoader");
const { computeFinalScore } = require("./scoring");
const { buildAttributeBreakdown } = require("./breakdown");

/* ---------- ENV CONFIGURATION ------------------------------------ */
const MODEL_ID = process.env.GEMINI_MODEL_ID || "gemini-2.5-pro-preview-05-06";
// Defaulting to 70 for chunks, assuming ~700 tokens verbose output per lead to fit Gemini's 65k output limit
const CHUNK_SIZE = Math.max(1, parseInt(process.env.BATCH_CHUNK_SIZE || "70", 10));
// Increased default timeout as verbose responses for large chunks can take time
const GEMINI_TIMEOUT_MS = Math.max(30000, parseInt(process.env.GEMINI_TIMEOUT_MS || "240000", 10)); // 4 minutes

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "";
const FROM_EMAIL = process.env.FROM_EMAIL || "";
const MAILGUN_API_KEY = process.env.MAILGUN_API_KEY || "";
const MAILGUN_DOMAIN = process.env.MAILGUN_DOMAIN || "";

const GCP_PROJECT_ID = process.env.GCP_PROJECT_ID;
const GCP_LOCATION = process.env.GCP_LOCATION; // e.g., 'us-central1'
const GCP_CREDENTIALS_JSON_STRING = process.env.GCP_SERVICE_ACCOUNT_CREDENTIALS_JSON;

/* ---------- GOOGLE GENERATIVE AI CLIENT INITIALIZATION ----------- */
let vertexAIClient;
let geminiModel;

try {
    if (!GCP_PROJECT_ID || !GCP_LOCATION) {
        throw new Error("GCP_PROJECT_ID and GCP_LOCATION environment variables are required.");
    }
    if (!GCP_CREDENTIALS_JSON_STRING) {
        throw new Error("GCP_SERVICE_ACCOUNT_CREDENTIALS_JSON environment variable is not set.");
    }

    const credentials = JSON.parse(GCP_CREDENTIALS_JSON_STRING);
    
    vertexAIClient = new VertexAI({
        project: GCP_PROJECT_ID,
        location: GCP_LOCATION,
        credentials // Directly pass parsed credentials
    });

    geminiModel = vertexAIClient.getGenerativeModel({
        model: MODEL_ID,
        // Safety settings can also be applied here globally or per request
        safetySettings: [
            { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
            { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
            { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
            { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
        ],
        generationConfig: { // Default generation config
            temperature: 0, // For deterministic scoring
            responseMimeType: "application/json", // Crucial: Request JSON output
        }
    });
    console.log(`Google Vertex AI Client Initialized. Model: ${MODEL_ID}`);

} catch (error) {
    console.error("CRITICAL: Failed to initialize Google Vertex AI Client:", error.message);
    if (error.message.includes("Could not load the default credentials")) {
        console.error("Hint: Ensure GCP_SERVICE_ACCOUNT_CREDENTIALS_JSON is correctly set and valid, or GOOGLE_APPLICATION_CREDENTIALS points to a valid key file if running locally.");
    }
    geminiModel = null;
    alertAdmin("[Scorer] CRITICAL: Gemini Client Init Failed", String(error.message || error));
}

/* ---------- AIRTABLE CONFIGURATION ------------------------------- */
Airtable.configure({ apiKey: process.env.AIRTABLE_API_KEY });
const base = Airtable.base(process.env.AIRTABLE_BASE_ID);

/* ---------- EMAIL ALERT FUNCTION --------------------------------- */
async function alertAdmin(subject, text) {
    if (!MAILGUN_API_KEY || !ADMIN_EMAIL || !MAILGUN_DOMAIN || !FROM_EMAIL) {
        console.warn("Mailgun not configured, skipping admin alert:", subject);
        return;
    }
    const FormData = require("form-data");
    const form = new FormData();
    form.append("from", FROM_EMAIL);
    form.append("to", ADMIN_EMAIL);
    form.append("subject", `[LeadScorer-Gemini] ${subject}`);
    form.append("text", text);
    try {
        await fetch(`https://api.mailgun.net/v3/${MAILGUN_DOMAIN}/messages`, {
            method: "POST",
            headers: { Authorization: "Basic " + Buffer.from("api:" + MAILGUN_API_KEY).toString("base64") },
            body: form
        });
        console.log("Admin alert sent:", subject);
    } catch (emailError) {
        console.error("Failed to send admin alert:", subject, emailError.message);
    }
}

/* ---------- CRITICAL FIELD DETECTOR (Unchanged) ------------------ */
function isMissingCritical(profile = {}) {
    const about = (profile.about || profile.summary || profile.linkedinDescription || "").trim();
    const hasBio = about.length >= 40;
    const hasHeadline = !!profile.headline?.trim();
    let hasJob = Array.isArray(profile.experience) && profile.experience.length > 0;
    if (!hasJob) {
        for (let i = 1; i <= 5; i++) {
            if (profile[`organization_${i}`] || profile[`organization_title_${i}`]) {
                hasJob = true;
                break;
            }
        }
    }
    return !(hasBio && hasHeadline && hasJob);
}

/* ---------- LEAD PROCESSING QUEUE (Unchanged) -------------------- */
const queue = [];
let running = false;
async function enqueue(recs) {
    queue.push(recs);
    if (running) return;
    running = true;
    console.log(`Queue started. ${queue.length} chunk(s) to process.`);
    while (queue.length) {
        const chunk = queue.shift();
        console.log(`Processing chunk of ${chunk.length} records...`);
        try {
            await scoreChunk(chunk);
        } catch (err) {
            console.error(`CHUNK FATAL ERROR for a chunk of ${chunk.length} records:`, err.message, err.stack);
            await alertAdmin("Chunk Failed Critically", `Error: ${String(err.message)}\nStack: ${err.stack}`);
        }
    }
    running = false;
    console.log("Queue empty, all processing finished for this run.");
}

/* ---------- FETCH LEADS FROM AIRTABLE (Unchanged) --------------- */
async function fetchLeads(limit) {
    const records = [];
    console.log(`Workspaceing up to ${limit} leads with Scoring Status = 'To Be Scored'`);
    await base("Leads")
        .select({ maxRecords: limit, view: "To Be Scored" }) // Assuming you have a view named "To Be Scored"
        .eachPage((pageRecords, next) => {
            records.push(...pageRecords);
            next();
        }).catch(err => {
            console.error("Error fetching leads from Airtable:", err);
            throw err;
        });
    console.log(`Workspaceed ${records.length} leads.`);
    return records;
}

/* =================================================================
   scoreChunk - Processes a chunk of leads with Gemini
=================================================================== */
async function scoreChunk(records) {
    if (!geminiModel) {
        const errorMsg = "Aborting scoreChunk: Gemini AI Client not initialized. Check startup logs.";
        console.error(errorMsg);
        await alertAdmin("Aborted Chunk: Gemini Client Not Initialized", errorMsg);
        // Mark records as failed so they aren't picked up endlessly
        const failedUpdates = records.map(rec => ({
            id: rec.id,
            fields: { "Scoring Status": "Failed – Client Init Error" }
        }));
        if (failedUpdates.length > 0) await base("Leads").update(failedUpdates).catch(e => console.error("Airtable update error for client init failed leads:", e));
        return;
    }

    const scorable = [];
    const airtableUpdatesForSkipped = [];

    for (const rec of records) {
        const profile = JSON.parse(rec.get("Profile Full JSON") || "{}");
        const aboutText = (profile.about || profile.summary || profile.linkedinDescription || "").trim();
        let hasExp = Array.isArray(profile.experience) && profile.experience.length > 0;
        if (!hasExp) for (let i = 1; i <= 5; i++) if (profile[`organization_${i}`] || profile[`organization_title_${i}`]) { hasExp = true; break; }

        if (isMissingCritical(profile)) {
            console.log(`Lead ${rec.id} [${profile.linkedinProfileUrl || profile.profile_url || "unknown"}] missing critical data. Alerting admin.`);
            await alertAdmin(
                "Incomplete lead data for scoring",
                `Rec ID: ${rec.id}\nURL: ${profile.linkedinProfileUrl || profile.profile_url || "unknown"}\nHeadline: ${!!profile.headline}, About: ${aboutText.length >= 40}, Experience: ${hasExp}`
            );
        }

        if (aboutText.length < 40) {
            console.log(`Lead ${rec.id} profile too small, skipping. Queuing Airtable update.`);
            airtableUpdatesForSkipped.push({
                id: rec.id,
                fields: { "AI Score": 0, "Scoring Status": "Skipped – Profile Too Thin", "AI Profile Assessment": "", "AI Attribute Breakdown": "" }
            });
            continue;
        }
        scorable.push({ id: rec.id, rec, profile });
    }

    if (airtableUpdatesForSkipped.length > 0) {
        try {
            console.log(`Updating ${airtableUpdatesForSkipped.length} Airtable records for skipped leads.`);
            for (let i = 0; i < airtableUpdatesForSkipped.length; i += 10) { // Batch Airtable updates
                await base("Leads").update(airtableUpdatesForSkipped.slice(i, i + 10));
            }
        } catch (airtableError) {
            console.error("Airtable update error for skipped leads:", airtableError);
            await alertAdmin("Airtable Update Failed (Skipped Leads)", String(airtableError));
        }
    }

    if (!scorable.length) {
        console.log("No scorable leads in this chunk after pre-flight checks.");
        return;
    }
    console.log(`Attempting to score ${scorable.length} leads with Gemini.`);

    // Call buildPrompt() to get your system instructions.
    // IMPORTANT: This prompt MUST instruct Gemini to return a JSON array,
    // where each object in the array is the full verbose scoring object.
    const systemPromptInstructions = await buildPrompt();

    const slimmedLeadsForChunk = scorable.map(({ profile }) => slimLead(profile));
    const leadsDataForUserPrompt = JSON.stringify({ leads: slimmedLeadsForChunk });
    
    // Construct the user part of the prompt. System instructions are now part of the model initialization.
    const generationPromptForGemini = `Score the following ${scorable.length} leads based on the criteria and JSON schema defined in the system instructions. The leads are: ${leadsDataForUserPrompt}`;

    // Estimate max output tokens needed for this chunk (e.g., 700 tokens per lead for verbose)
    // Add a small buffer (e.g., 1024-2048 tokens) for JSON array structure, just in case.
    const estimatedTokensPerLead = 700; // Your target for verbose
    const bufferTokens = 2048;
    const calculatedMaxOutputTokens = (scorable.length * estimatedTokensPerLead) + bufferTokens;
    const maxOutputForRequest = Math.min(65536 - 100, calculatedMaxOutputTokens); // Stay just under absolute max

    console.log(`Calling Gemini. Estimated output: ${calculatedMaxOutputTokens}, Max set for API: ${maxOutputForRequest}`);

    let rawResponseText;
    try {
        const requestPayload = {
            contents: [{ role: "user", parts: [{ text: generationPromptForGemini }] }],
            generationConfig: { // Override default if needed, but systemInstruction is now on model
                maxOutputTokens: maxOutputForRequest,
                temperature: 0, // Already set on model, but can be overridden
                responseMimeType: "application/json", // Already set on model
            }
            // Safety settings are also on the model instance
        };
        
        // Re-initialize model instance with system prompt for this specific call context if buildPrompt changes frequently
        // OR ensure buildPrompt output is stable and use the globally initialized geminiModel.
        // For simplicity, if buildPrompt is dynamic per call, re-init is safer:
        let modelInstanceForRequest = vertexAIClient.getGenerativeModel({
            model: MODEL_ID,
            systemInstruction: { parts: [{text: systemPromptInstructions}]},
            safetySettings: [ /* ... same safety settings ... */
                { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
                { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
                { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
                { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
            ],
            generationConfig: { temperature: 0, responseMimeType: "application/json" } // Ensure these are set
        });

        const callPromise = modelInstanceForRequest.generateContent(requestPayload);
        const timer = new Promise((_, rej) => setTimeout(() => rej(new Error("Gemini API call timeout for chunk scoring")), GEMINI_TIMEOUT_MS));
        
        const result = await Promise.race([callPromise, timer]);

        if (!result || !result.response) throw new Error("Gemini API call (chunk) returned no response object.");
        
        const candidate = result.response.candidates?.[0];
        if (!candidate) {
            const blockReason = result.response.promptFeedback?.blockReason;
            let safetyRatingsInfo = "";
            if (result.response.promptFeedback?.safetyRatings) {
                safetyRatingsInfo = ` SafetyRatings: ${JSON.stringify(result.response.promptFeedback.safetyRatings)}`;
            }
            if (blockReason) throw new Error(`Gemini API call (chunk) blocked. Reason: ${blockReason}.${safetyRatingsInfo}`);
            throw new Error(`Gemini API call (chunk) returned no candidates.${safetyRatingsInfo}`);
        }

        if (candidate.content && candidate.content.parts && candidate.content.parts[0].text) {
            rawResponseText = candidate.content.parts[0].text;
        } else {
            const finishReason = candidate.finishReason;
            let safetyRatingsInfo = candidate.safetyRatings ? ` SafetyRatings: ${JSON.stringify(candidate.safetyRatings)}` : "";
            if (finishReason && finishReason !== "STOP") {
                throw new Error(`Gemini API call (chunk) finished with reason: ${finishReason}.${safetyRatingsInfo}`);
            }
            throw new Error(`Gemini API call (chunk) returned a candidate with no text content.${safetyRatingsInfo}`);
        }

    } catch (error) {
        console.error(`Gemini API call failed for chunk: ${error.message}. Check for safety blocks or other issues.`);
        await alertAdmin("Gemini API Call Failed (Chunk)", `Error: ${error.message}\nChunk Lead IDs (first 5): ${scorable.slice(0,5).map(s=>s.id).join(', ')}`);
        const failedUpdates = scorable.map(item => ({ id: item.rec.id, fields: { "Scoring Status": "Failed – API Error" } }));
        if (failedUpdates.length > 0) for (let i = 0; i < failedUpdates.length; i += 10) await base("Leads").update(failedUpdates.slice(i, i+10)).catch(e => console.error("Airtable update error for API failed leads:", e));
        return;
    }

    let outputArray;
    try {
        // Gemini with responseMimeType: "application/json" should return a parsable JSON string.
        // The cleaning for ```json might not be needed but kept for safety.
        const cleanedJsonString = rawResponseText.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
        outputArray = JSON.parse(cleanedJsonString);
        if (!Array.isArray(outputArray)) outputArray = [outputArray];
    } catch (parseErr) {
        console.error(`Failed to parse Gemini JSON response: ${parseErr.message}. Raw (first 500 chars): ${rawResponseText.substring(0, 500)}...`);
        await alertAdmin("Gemini JSON Parse Failed", `Error: ${parseErr.message}\nRaw: ${rawResponseText.substring(0, 500)}...\nChunk Lead IDs (first 5): ${scorable.slice(0,5).map(s=>s.id).join(', ')}`);
        const failedUpdates = scorable.map(item => ({ id: item.rec.id, fields: { "Scoring Status": "Failed – Parse Error" } }));
        if (failedUpdates.length > 0) for (let i = 0; i < failedUpdates.length; i += 10) await base("Leads").update(failedUpdates.slice(i, i+10)).catch(e => console.error("Airtable update error for parse-failed leads:", e));
        return;
    }
    
    console.log(`Successfully received and parsed ${outputArray.length} results from Gemini for chunk of ${scorable.length}.`);

    if (outputArray.length !== scorable.length) {
        console.warn(`MISMATCH: Gemini returned ${outputArray.length} results, expected ${scorable.length}.`);
        await alertAdmin("Gemini Result Count Mismatch", `Expected ${scorable.length}, got ${outputArray.length}. Some leads in the chunk were not processed by AI or returned.`);
    }

    const { positives, negatives } = await loadAttributes();
    const airtableResultUpdates = [];

    for (let i = 0; i < scorable.length; i++) {
        const leadItem = scorable[i];
        const geminiOutputItem = outputArray[i]; // Corresponds to scorable[i]

        if (!geminiOutputItem) {
            console.warn(`No corresponding output from Gemini for lead ${leadItem.id} (index ${i}). Marking as 'Failed – Missing in AI Response'.`);
            airtableResultUpdates.push({ id: leadItem.rec.id, fields: { "Scoring Status": "Failed – Missing in AI Response" } });
            continue;
        }
        
        const updateFields = {
            "Scoring Status": "Scored", // Default, override on error
            "Date Scored": new Date().toISOString().split("T")[0]
        };

        try {
            // ALWAYS VERBOSE: Expecting geminiOutputItem to be the full verbose object
            // Ensure your buildPrompt() instructs Gemini to return these fields.
            const positive_scores = geminiOutputItem.positive_scores || {};
            const negative_scores = geminiOutputItem.negative_scores || {};
            const contact_readiness = geminiOutputItem.contact_readiness === true; // Ensure boolean
            const unscored_attributes = Array.isArray(geminiOutputItem.unscored_attributes) ? geminiOutputItem.unscored_attributes : [];
            const attribute_reasoning = typeof geminiOutputItem.attribute_reasoning === 'object' && geminiOutputItem.attribute_reasoning !== null ? geminiOutputItem.attribute_reasoning : {};
            
            const { percentage, rawScore: earned, denominator: max } =
                computeFinalScore(
                    positive_scores, positives,
                    negative_scores, negatives,
                    contact_readiness, unscored_attributes
                );

            updateFields["AI Score"] = Math.round(percentage * 100) / 100;
            updateFields["AI Profile Assessment"] = String(geminiOutputItem.aiProfileAssessment || "N/A");
            updateFields["AI Attribute Breakdown"] = buildAttributeBreakdown(
                positive_scores, positives,
                negative_scores, negatives,
                unscored_attributes, earned, max,
                attribute_reasoning, false, null
            );
            updateFields["AI_Excluded"] = (geminiOutputItem.ai_excluded === "Yes" || geminiOutputItem.ai_excluded === true);
            updateFields["Exclude Details"] = String(geminiOutputItem.exclude_details || "");

        } catch (scoringErr) {
            console.error(`Error in scoring logic for lead ${leadItem.id}: ${scoringErr.message}`, geminiOutputItem);
            updateFields["Scoring Status"] = "Failed – Scoring Logic Error";
            updateFields["AI Profile Assessment"] = `Scoring Error: ${scoringErr.message}`;
            await alertAdmin("Scoring Logic Error", `Lead ID: ${leadItem.id}\nError: ${scoringErr.message}`);
        }
        airtableResultUpdates.push({ id: leadItem.rec.id, fields: updateFields });
    }

    if (airtableResultUpdates.length > 0) {
        console.log(`Attempting final Airtable update for ${airtableResultUpdates.length} processed leads in chunk.`);
        for (let i = 0; i < airtableResultUpdates.length; i += 10) {
            const batchUpdates = airtableResultUpdates.slice(i, i + 10);
            try {
                await base("Leads").update(batchUpdates);
                console.log(`Successfully updated batch of ${batchUpdates.length} Airtable records with scores/statuses.`);
            } catch (airtableUpdateError) {
                console.error("Airtable update error for scored/failed leads:", airtableUpdateError);
                await alertAdmin("Airtable Update Failed (Scoring Results)", String(airtableUpdateError));
                batchUpdates.forEach(bu => console.error(`Failed to update results for lead ID: ${bu.id}`));
            }
        }
    }
    console.log(`Finished processing chunk. Scorable leads: ${scorable.length}. Airtable updates attempted: ${airtableResultUpdates.length}.`);
}

/* ---------- PUBLIC ENDPOINT / MAIN FUNCTION ---------------------- */
async function run(req, res) {
    console.log("Gemini Batch Scorer: 'run' function invoked.");
    if (!geminiModel) {
        const errorMsg = "Gemini AI Client failed to initialize. Cannot process scoring. Check startup environment variables and logs.";
        console.error(errorMsg);
        if (res && res.status) res.status(500).json({ ok: false, error: errorMsg });
        else console.warn("Response object not available to send 500 status for client init failure.");
        await alertAdmin("Run Aborted: Gemini Client Not Initialized", errorMsg);
        return;
    }

    try {
        const limit = Number(req?.query?.limit) || 1000;
        console.log(`Workspaceing leads for scoring, limit: ${limit}`);
        const leads = await fetchLeads(limit);

        if (!leads.length) {
            const noLeadsMsg = "No leads found in 'To Be Scored' view.";
            console.log(noLeadsMsg);
            if (res && res.json) res.json({ ok: true, message: noLeadsMsg });
            return;
        }
        console.log(`Workspaceed ${leads.length} leads. Configured chunk size: ${CHUNK_SIZE}.`);

        const chunks = [];
        for (let i = 0; i < leads.length; i += CHUNK_SIZE) {
            chunks.push(leads.slice(i, i + CHUNK_SIZE));
        }

        console.log(`Queuing ${leads.length} leads in ${chunks.length} chunk(s) for processing.`);
        for (const c of chunks) { // Enqueue chunks sequentially to avoid overwhelming single queue runner
            await enqueue(c);
        }
        
        const message = `Batch scoring process initiated for ${leads.length} leads, divided into ${chunks.length} chunks. Processing will continue in the background.`;
        console.log(message);
        if (res && res.json) {
            res.json({ ok: true, message: message, leadsQueued: leads.length });
        }
        // Consider an admin alert for batch *completion* if the queue processing becomes part of a more managed system.
        // For now, alert on initiation.
        // await alertAdmin("Batch Scoring Initiated", message);

    } catch (err) {
        console.error("BATCH RUN FATAL ERROR:", err.message, err.stack);
        if (res && res.status && res.json) {
            res.status(500).json({ ok: false, error: String(err.message || err) });
        } else {
            console.warn("Response object not available to send 500 status on fatal batch error.");
        }
        await alertAdmin("Batch Run Failed Critically", `Error: ${String(err.message)}\nStack: ${err.stack}`);
    }
}

// If running this script directly via Node.js (e.g., for a Render background worker)
if (require.main === module) {
    console.log("Running batch scorer directly via Node.js for a one-off or continuous run...");
    const runLimit = parseInt(process.env.RUN_LIMIT, 10);
    const initialLimit = isNaN(runLimit) ? CHUNK_SIZE * 2 : runLimit; // Default to process a couple of chunks if not set
    
    console.log(`Initial run limit: ${initialLimit}. Will process leads and then script might exit if no further triggers unless set up as a long-running service.`);

    run({ query: { limit: initialLimit } })
        .then(() => {
            console.log("Direct Node.js run: Initial lead queuing complete. Queue will continue processing if leads were found.");
            // For a Render background worker, the process should stay alive to handle the queue.
            // If this is meant to be a one-off script that processes then exits, you'd need different logic
            // to wait for the queue to be empty.
            // The current `enqueue` pattern with `running` flag suggests it processes until empty then stops
            // until `run` is called again.
        })
        .catch(err => {
            console.error("Error in direct Node.js run execution:", err);
            process.exit(1); // Exit with error for one-off script failures
        });
}

module.exports = { run }; // For Render web service if it's triggered via HTTP