/* ===================================================================
   singleScorer.js – ONE-OFF Gemini scorer used by /score-lead etc.
   -------------------------------------------------------------------
   • Uses buildPrompt to get system instructions.
   • Calls Gemini 2.5 Pro with temperature 0 (deterministic).
   • Expects a JSON array with a single object, parses it, and returns the object.
   • Logs token usage from Gemini's response.
=================================================================== */
require("dotenv").config();

// Assuming buildPrompt and slimLead are correctly updated for Gemini
const { buildPrompt, slimLead } = require("./promptBuilder");
const { HarmCategory, HarmBlockThreshold } = require("@google/generative-ai"); // For safety settings

// Environment variables (GEMINI_MODEL_ID is used by the passed-in model instance)
const GEMINI_TIMEOUT_MS = Math.max(30000, parseInt(process.env.GEMINI_TIMEOUT_MS || "120000", 10)); // 2 minutes for single score

async function scoreLeadNow(fullLead = {}, geminiModelInstance) {
    if (!geminiModelInstance) {
        console.error("Gemini model instance was not provided to scoreLeadNow.");
        throw new Error("Gemini model instance not available for single scoring.");
    }

    /* 1️⃣  Build system prompt + trim profile for user content */
    // buildPrompt() should return the system instructions optimized for Gemini,
    // including the schema definition for a SINGLE lead object, but instructing
    // Gemini to return it within a JSON array.
    const systemInstructionText = await buildPrompt();
    const userLeadData = slimLead(fullLead); // Get the slimmed lead data

    // The user content will be the single lead, stringified
    const userPromptContent = `Score the following single lead based on the criteria and JSON schema provided in the system instructions. The lead is: ${JSON.stringify(userLeadData, null, 2)}`;
    
    // Define max output tokens for a single verbose lead.
    // 700 was our target, let's give it a bit more buffer. Max for Gemini 2.5 Pro output is 65536.
    const maxOutputForSingleLead = Math.min(4096, 700 + 512); // e.g., ~1200 tokens, adjustable

    console.log(`Calling Gemini for single lead. Max output tokens: ${maxOutputForSingleLead}`);

    let rawResponseText;
    let usageMetadata = {};

    try {
        // We need to get a model instance that includes the system prompt
        // The globalGeminiModel in index.js is initialized without a systemInstruction.
        // So, we get a new model interface here with the systemInstruction.
        const modelForRequest = geminiModelInstance.generativeModel // Access the underlying model interface
            ? geminiModelInstance.generativeModel // If it's a VertexAI wrapped model
            : geminiModelInstance; // If it's already a GenerativeModel instance

        const specificModelInstanceWithSystemPrompt = modelForRequest.CopyWith({ // Use CopyWith if available, or re-get
             systemInstruction: { parts: [{ text: systemInstructionText }]},
             safetySettings: [
                { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
                { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
                { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
                { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
            ],
            generationConfig: {
                temperature: 0,
                responseMimeType: "application/json", // Crucial
                maxOutputTokens: maxOutputForSingleLead
            }
        });


        const requestPayload = {
            contents: [{ role: "user", parts: [{ text: userPromptContent }] }],
            // generationConfig and safetySettings are now on specificModelInstanceWithSystemPrompt
        };
        
        const callPromise = specificModelInstanceWithSystemPrompt.generateContent(requestPayload);
        const timer = new Promise((_, rej) => setTimeout(() => rej(new Error("Gemini API call timeout for single lead scoring")), GEMINI_TIMEOUT_MS));
        
        const result = await Promise.race([callPromise, timer]);

        if (!result || !result.response) {
            throw new Error("Gemini API call (single lead) returned no response object.");
        }
        
        usageMetadata = result.response.usageMetadata || {}; // Store usage metadata

        const candidate = result.response.candidates?.[0];
        if (!candidate) {
            const blockReason = result.response.promptFeedback?.blockReason;
            let safetyRatingsInfo = result.response.promptFeedback?.safetyRatings ? ` SafetyRatings: ${JSON.stringify(result.response.promptFeedback.safetyRatings)}` : "";
            if (blockReason) throw new Error(`Gemini API call (single lead) blocked. Reason: ${blockReason}.${safetyRatingsInfo}`);
            throw new Error(`Gemini API call (single lead) returned no candidates.${safetyRatingsInfo}`);
        }

        if (candidate.content && candidate.content.parts && candidate.content.parts[0].text) {
            rawResponseText = candidate.content.parts[0].text;
        } else {
            const finishReason = candidate.finishReason;
            let safetyRatingsInfo = candidate.safetyRatings ? ` SafetyRatings: ${JSON.stringify(candidate.safetyRatings)}` : "";
            if (finishReason && finishReason !== "STOP") {
                throw new Error(`Gemini API call (single lead) finished with reason: ${finishReason}.${safetyRatingsInfo}`);
            }
            throw new Error(`Gemini API call (single lead) returned a candidate with no text content.${safetyRatingsInfo}`);
        }

    } catch (error) {
        console.error(`Gemini API call failed for single lead: ${error.message}. Profile ID (if available): ${fullLead.id || fullLead.public_id || 'N/A'}`);
        // No alertAdmin here, let the calling endpoint in index.js handle alerting if needed.
        throw error; // Re-throw the error to be caught by the calling route
    }

    /* === LOG TOKEN USAGE (Gemini) ================================== */
    console.log(
        "TOKENS single lead (Gemini) – Prompt: %s, Candidates: %s, Total: %s",
        usageMetadata.promptTokenCount || "?",
        usageMetadata.candidatesTokenCount || "?",
        usageMetadata.totalTokenCount || "?"
    );

    /* === DEBUG OUTPUT ============================================ */
    if (process.env.DEBUG_RAW_PROMPT === "1" || process.env.DEBUG_RAW_GEMINI === "1") { // Added DEBUG_RAW_GEMINI
        console.log("DBG-RAW-GEMINI (single lead):\n", rawResponseText);
    }
    /* ============================================================= */

    try {
        // Gemini with responseMimeType: "application/json" should return a parsable JSON string.
        // The prompt asks for an array, even for a single lead, so we expect an array with one item.
        const cleanedJsonString = rawResponseText.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
        const parsedArray = JSON.parse(cleanedJsonString);

        if (Array.isArray(parsedArray) && parsedArray.length > 0) {
            return parsedArray[0]; // Return the first (and should be only) object from the array
        } else if (!Array.isArray(parsedArray) && typeof parsedArray === 'object' && parsedArray !== null) {
            // If Gemini returns a single object directly when only one lead is in the conceptual "batch"
            console.warn("Gemini returned a single object instead of an array for single lead scoring. Using it directly.");
            return parsedArray;
        } else {
            console.error("Gemini response for single lead was not a valid non-empty array or direct object. Parsed:", parsedArray);
            throw new Error("Gemini response format error for single lead: Expected array with one item or a single object.");
        }
    } catch (parseErr) {
        console.error(`Failed to parse Gemini JSON response for single lead: ${parseErr.message}. Raw response: ${rawResponseText.substring(0, 500)}...`);
        throw new Error(`JSON Parse Error for single lead: ${parseErr.message}`);
    }
}

module.exports = { scoreLeadNow };