/* ===================================================================
   batchScorer.js  –  Gemini 2.5 Pro bulk scorer (chunked, always verbose)
   -------------------------------------------------------------------
   • Pulls “To Be Scored” leads from Airtable in chunks.
   • Sends each chunk to Gemini, expecting a detailed JSON array response.
   • ALWAYS uses our locally-computed percentage when writing AI Score.
=================================================================== */

require("dotenv").config();
console.log("▶︎ batchScorer module loaded (Gemini Always Verbose Version)");

// UPDATED: HarmCategory and HarmBlockThreshold now from @google-cloud/vertexai
const { VertexAI, HarmCategory, HarmBlockThreshold } = require('@google-cloud/vertexai');
const Airtable = require("airtable");
const fetch = (...a) => import("node-fetch").then(({ default: f }) => f(...a)); // For Mailgun

// Your existing helper modules
const { buildPrompt, slimLead } = require("./promptBuilder");
const { loadAttributes } = require("./attributeLoader");
const { computeFinalScore } = require("./scoring");
const { buildAttributeBreakdown } = require("./breakdown");

/* ---------- ENV CONFIGURATION ------------------------------------ */
const MODEL_ID = process.env.GEMINI_MODEL_ID || "gemini-2.5-pro-preview-05-06";
const CHUNK_SIZE = Math.max(1, parseInt(process.env.BATCH_CHUNK_SIZE || "70", 10));
const GEMINI_TIMEOUT_MS = Math.max(30000, parseInt(process.env.GEMINI_TIMEOUT_MS || "240000", 10)); // 4 minutes

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "";
const FROM_EMAIL = process.env.FROM_EMAIL || "";
const MAILGUN_API_KEY = process.env.MAILGUN_API_KEY || "";
const MAILGUN_DOMAIN = process.env.MAILGUN_DOMAIN || "";

const GCP_PROJECT_ID = process.env.GCP_PROJECT_ID;
const GCP_LOCATION = process.env.GCP_LOCATION;
const GCP_CREDENTIALS_JSON_STRING = process.env.GCP_SERVICE_ACCOUNT_CREDENTIALS_JSON;

/* ---------- GOOGLE GENERATIVE AI CLIENT INITIALIZATION ----------- */
let vertexAIClient;
let geminiModelDefaultInstance; // Renamed for clarity

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
        credentials
    });

    // This default instance is created once. Specific system instructions will be applied per call.
    geminiModelDefaultInstance = vertexAIClient.getGenerativeModel({
        model: MODEL_ID
        // Note: Global safety/generationConfig can be set here if they are ALWAYS the same
        // But batchScorer and singleScorer apply them per-call with systemInstruction
    });
    console.log(`Google Vertex AI Client Initialized for batchScorer. Default Model: ${MODEL_ID}`);

} catch (error) {
    console.error("CRITICAL: Failed to initialize Google Vertex AI Client for batchScorer:", error.message);
    geminiModelDefaultInstance = null;
    alertAdmin("[Scorer] CRITICAL: Gemini Client Init Failed (batchScorer)", String(error.message || error));
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
    const FormData = require("form-data"); // Ensure form-data is in package.json
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

/* ---------- LEAD PROCESSING QUEUE (Unchanged logic) ------------- */
const queue = [];
let running = false;
async function enqueue(recs) {
    queue.push(recs);
    if (running) return;
    running = true;
    console.log(`Queue started. ${queue.length} chunk(s) to process in batchScorer.`);
    while (queue.length) {
        const chunk = queue.shift();
        console.log(`batchScorer: Processing chunk of ${chunk.length} records...`);
        try {
            await scoreChunk(chunk);
        } catch (err) {
            console.error(`CHUNK FATAL ERROR in batchScorer for a chunk of ${chunk.length} records:`, err.message, err.stack);
            await alertAdmin("Chunk Failed Critically (batchScorer)", `Error: ${String(err.message)}\nStack: ${err.stack}`);
        }
    }
    running = false;
    console.log("batchScorer: Queue empty, all processing finished for this run.");
}

/* ---------- FETCH LEADS FROM AIRTABLE (Unchanged logic) --------- */
async function fetchLeads(limit) {
    const records = [];
    console.log(`batchScorer: Fetching up to ${limit} leads with Scoring Status = 'To Be Scored'`);
    await base("Leads")
        .select({ maxRecords: limit, view: "To Be Scored" }) // Ensure you have this view, or use filterByFormula
        .eachPage((pageRecords, next) => {
            records.push(...pageRecords);
            next();
        }).catch(err => {
            console.error("Error fetching leads from Airtable for batchScorer:", err);
            throw err;
        });
    console.log(`batchScorer: Fetched ${records.length} leads.`);
    return records;
}

/* =================================================================
   scoreChunk - Processes a chunk of leads with Gemini
=================================================================== */
async function scoreChunk(records) {
    if (!geminiModelDefaultInstance) { // Check the initialized model instance
        const errorMsg = "Aborting scoreChunk: Gemini AI Client (batchScorer) not initialized. Check startup logs.";
        console.error(errorMsg);
        await alertAdmin("Aborted Chunk (batchScorer): Gemini Client Not Initialized", errorMsg);
        const failedUpdates = records.map(rec => ({
            id: rec.id,
            fields: { "Scoring Status": "Failed – Client Init Error" }
        }));
        if (failedUpdates.length > 0) for (let i = 0; i < failedUpdates.length; i += 10) await base("Leads").update(failedUpdates.slice(i, i+10)).catch(e => console.error("Airtable update error for client init failed leads (batchScorer):", e));
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
            console.log(`Lead ${rec.id} [${profile.linkedinProfileUrl || profile.profile_url || "unknown"}] missing critical data (batchScorer). Alerting admin.`);
            await alertAdmin(
                "Incomplete lead data for batch scoring",
                `Rec ID: ${rec.id}\nURL: ${profile.linkedinProfileUrl || profile.profile_url || "unknown"}\nHeadline: ${!!profile.headline}, About: ${aboutText.length >= 40}, Experience: ${hasExp}`
            );
        }

        if (aboutText.length < 40) {
            console.log(`Lead ${rec.id} profile too thin for batch scoring, skipping. Queuing Airtable update.`);
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
            console.log(`batchScorer: Updating ${airtableUpdatesForSkipped.length} Airtable records for skipped leads.`);
            for (let i = 0; i < airtableUpdatesForSkipped.length; i += 10) {
                await base("Leads").update(airtableUpdatesForSkipped.slice(i, i + 10));
            }
        } catch (airtableError) {
            console.error("Airtable update error for skipped leads (batchScorer):", airtableError);
            await alertAdmin("Airtable Update Failed (Skipped Leads in batchScorer)", String(airtableError));
        }
    }

    if (!scorable.length) {
        console.log("No scorable leads in this chunk for batchScorer after pre-flight checks.");
        return;
    }
    console.log(`batchScorer: Attempting to score ${scorable.length} leads with Gemini.`);

    const systemPromptInstructions = await buildPrompt(); // buildPrompt is Gemini-ready
    const slimmedLeadsForChunk = scorable.map(({ profile }) => slimLead(profile));
    const leadsDataForUserPrompt = JSON.stringify({ leads: slimmedLeadsForChunk });
    const generationPromptForGemini = `Score the following ${scorable.length} leads based on the criteria and JSON schema defined in the system instructions. The leads are: ${leadsDataForUserPrompt}`;
    
    const estimatedTokensPerLead = 700;
    const bufferTokens = 2048;
    const calculatedMaxOutputTokens = (scorable.length * estimatedTokensPerLead) + bufferTokens;
    const maxOutputForRequest = Math.min(65536 - 100, calculatedMaxOutputTokens);

    console.log(`batchScorer: Calling Gemini. Estimated output: ${calculatedMaxOutputTokens}, Max set for API: ${maxOutputForRequest}`);

    let rawResponseText;
    try {
        // Get a model instance with the specific system instructions for this call
        const modelInstanceForRequest = vertexAIClient.getGenerativeModel({
            model: MODEL_ID, // Use the MODEL_ID from env
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
                maxOutputTokens: maxOutputForRequest // Apply calculated max output tokens here
            }
        });

        const requestPayload = {
            contents: [{ role: "user", parts: [{ text: generationPromptForGemini }] }],
        };
        
        const callPromise = modelInstanceForRequest.generateContent(requestPayload);
        const timer = new Promise((_, rej) => setTimeout(() => rej(new Error("Gemini API call timeout for batchScorer chunk")), GEMINI_TIMEOUT_MS));
        
        const result = await Promise.race([callPromise, timer]);

        if (!result || !result.response) throw new Error("Gemini API call (batchScorer chunk) returned no response object.");
        
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
        console.error(`Gemini API call failed for batchScorer chunk: ${error.message}.`);
        await alertAdmin("Gemini API Call Failed (batchScorer Chunk)", `Error: ${error.message}\nChunk Lead IDs (first 5): ${scorable.slice(0,5).map(s=>s.id).join(', ')}`);
        const failedUpdates = scorable.map(item => ({ id: item.rec.id, fields: { "Scoring Status": "Failed – API Error" } }));
        if (failedUpdates.length > 0) for (let i = 0; i < failedUpdates.length; i += 10) await base("Leads").update(failedUpdates.slice(i, i+10)).catch(e => console.error("Airtable update error for API failed leads (batchScorer):", e));
        return;
    }

    let outputArray;
    try {
        const cleanedJsonString = rawResponseText.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
        outputArray = JSON.parse(cleanedJsonString);
        if (!Array.isArray(outputArray)) outputArray = [outputArray];
    } catch (parseErr) {
        console.error(`Failed to parse Gemini JSON (batchScorer): ${parseErr.message}. Raw (500 chars): ${rawResponseText.substring(0, 500)}...`);
        await alertAdmin("Gemini JSON Parse Failed (batchScorer)", `Error: ${parseErr.message}\nRaw: ${rawResponseText.substring(0, 500)}...\nChunk Lead IDs (first 5): ${scorable.slice(0,5).map(s=>s.id).join(', ')}`);
        const failedUpdates = scorable.map(item => ({ id: item.rec.id, fields: { "Scoring Status": "Failed – Parse Error" } }));
        if (failedUpdates.length > 0) for (let i = 0; i < failedUpdates.length; i += 10) await base("Leads").update(failedUpdates.slice(i, i+10)).catch(e => console.error("Airtable update error for parse-failed leads (batchScorer):", e));
        return;
    }
    
    console.log(`batchScorer: Parsed ${outputArray.length} results from Gemini for chunk of ${scorable.length}.`);

    if (outputArray.length !== scorable.length) {
        console.warn(`MISMATCH (batchScorer): Gemini returned ${outputArray.length} results, expected ${scorable.length}.`);
        await alertAdmin("Gemini Result Count Mismatch (batchScorer)", `Expected ${scorable.length}, got ${outputArray.length}.`);
    }

    const { positives, negatives } = await loadAttributes();
    const airtableResultUpdates = [];

    for (let i = 0; i < scorable.length; i++) {
        const leadItem = scorable[i];
        const geminiOutputItem = outputArray[i];

        if (!geminiOutputItem) {
            console.warn(`No output from Gemini for lead ${leadItem.id} (index ${i}) in batch. Marking failed.`);
            airtableResultUpdates.push({ id: leadItem.rec.id, fields: { "Scoring Status": "Failed – Missing in AI Batch Response" } });
            continue;
        }
        
        const updateFields = { "Scoring Status": "Scored", "Date Scored": new Date().toISOString().split("T")[0] };

        try {
            const positive_scores = geminiOutputItem.positive_scores || {};
            const negative_scores = geminiOutputItem.negative_scores || {};
            const attribute_reasoning_obj = geminiOutputItem.attribute_reasoning || {}; // Renamed for clarity
            const contact_readiness = geminiOutputItem.contact_readiness === true;
            const unscored_attributes = Array.isArray(geminiOutputItem.unscored_attributes) ? geminiOutputItem.unscored_attributes : [];
            
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
                attribute_reasoning_obj, // Pass the object of reasons
                false, null // showZeros = false for batch, header = null
            );
            updateFields["AI_Excluded"] = (geminiOutputItem.ai_excluded === "Yes" || geminiOutputItem.ai_excluded === true);
            updateFields["Exclude Details"] = String(geminiOutputItem.exclude_details || "");

        } catch (scoringErr) {
            console.error(`Error in scoring logic for lead ${leadItem.id} (batchScorer): ${scoringErr.message}`, geminiOutputItem);
            updateFields["Scoring Status"] = "Failed – Scoring Logic Error";
            updateFields["AI Profile Assessment"] = `Scoring Error: ${scoringErr.message}`;
            await alertAdmin("Scoring Logic Error (batchScorer)", `Lead ID: ${leadItem.id}\nError: ${scoringErr.message}`);
        }
        airtableResultUpdates.push({ id: leadItem.rec.id, fields: updateFields });
    }

    if (airtableResultUpdates.length > 0) {
        console.log(`batchScorer: Attempting final Airtable update for ${airtableResultUpdates.length} leads.`);
        for (let i = 0; i < airtableResultUpdates.length; i += 10) {
            const batchUpdates = airtableResultUpdates.slice(i, i + 10);
            try {
                await base("Leads").update(batchUpdates);
                console.log(`batchScorer: Updated batch of ${batchUpdates.length} Airtable records.`);
            } catch (airtableUpdateError) {
                console.error("Airtable update error for scored/failed leads (batchScorer):", airtableUpdateError);
                await alertAdmin("Airtable Update Failed (Batch Scoring Results)", String(airtableUpdateError));
                batchUpdates.forEach(bu => console.error(`Failed to update results for lead ID (batchScorer): ${bu.id}`));
            }
        }
    }
    console.log(`batchScorer: Finished chunk. Scorable: ${scorable.length}, Updates: ${airtableResultUpdates.length}.`);
}

/* ---------- PUBLIC ENDPOINT / MAIN FUNCTION ---------------------- */
async function run(req, res) { 
    console.log("batchScorer: 'run' function invoked.");
    if (!geminiModelDefaultInstance) {
        const errorMsg = "batchScorer: Gemini AI Client failed to initialize. Cannot process scoring.";
        console.error(errorMsg);
        // If res is provided (from an HTTP trigger like /run-batch-score), use it.
        if (res && res.status && !res.headersSent) {
             res.status(500).json({ ok: false, error: errorMsg });
        }
        await alertAdmin("batchScorer Run Aborted: Client Not Initialized", errorMsg);
        return;
    }

    try {
        const limit = Number(req?.query?.limit) || 1000; 
        console.log(`batchScorer: Fetching leads, limit: ${limit}`);
        const leads = await fetchLeads(limit);

        if (!leads.length) {
            const noLeadsMsg = "batchScorer: No leads found in 'To Be Scored' to process.";
            console.log(noLeadsMsg);
            if (res && res.json && !res.headersSent) {
                res.json({ ok: true, message: noLeadsMsg });
            }
            return;
        }
        console.log(`batchScorer: Fetched ${leads.length}. Chunk size: ${CHUNK_SIZE}.`);

        const chunks = [];
        for (let i = 0; i < leads.length; i += CHUNK_SIZE) {
            chunks.push(leads.slice(i, i + CHUNK_SIZE));
        }

        console.log(`batchScorer: Queuing ${leads.length} leads in ${chunks.length} chunk(s).`);
        for (const c of chunks) { 
            await enqueue(c); // This will process chunks one by one due to the `running` flag logic
        }
        
        const message = `batchScorer: Batch scoring initiated for ${leads.length} leads in ${chunks.length} chunks.`;
        console.log(message);
        if (res && res.json && !res.headersSent) {
            res.json({ ok: true, message: message, leadsQueued: leads.length });
        }
        
    } catch (err) {
        console.error("batchScorer: Batch run fatal error:", err.message, err.stack);
        if (res && res.status && res.json && !res.headersSent) {
            res.status(500).json({ ok: false, error: String(err.message || err) });
        }
        await alertAdmin("batchScorer: Batch Run Failed Critically", `Error: ${String(err.message)}\nStack: ${err.stack}`);
    }
}

if (require.main === module) {
    console.log("batchScorer: Running directly via Node.js...");
    const runLimit = parseInt(process.env.RUN_LIMIT, 10);
    const initialLimit = isNaN(runLimit) ? CHUNK_SIZE * 2 : runLimit; 
    
    console.log(`batchScorer (direct run) initial limit: ${initialLimit}.`);
    run({ query: { limit: initialLimit } }, null) // Pass null for res if not HTTP triggered
        .then(() => {
            console.log("batchScorer (direct run): Initial lead queuing complete. Queue processing continues if leads were found.");
        })
        .catch(err => {
            console.error("Error in batchScorer (direct run) execution:", err);
            process.exit(1); 
        });
}

module.exports = { run };