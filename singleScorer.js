/* ===================================================================
   singleScorer.js – ONE-OFF Gemini scorer used by /score-lead etc.
   (UPDATED FOR GEMINI 2.5 PRO and to use @google-cloud/vertexai for constants)
   -------------------------------------------------------------------
   • Uses buildPrompt to get system instructions.
   • Calls Gemini 2.5 Pro with temperature 0 (deterministic).
   • Expects a JSON array with a single object, parses it, and returns the object.
   • Logs token usage from Gemini's response.
=================================================================== */
require("dotenv").config();

const { buildPrompt, slimLead } = require("./promptBuilder");
// UPDATED: HarmCategory and HarmBlockThreshold now from @google-cloud/vertexai
const { HarmCategory, HarmBlockThreshold } = require('@google-cloud/vertexai');

const GEMINI_TIMEOUT_MS = Math.max(30000, parseInt(process.env.GEMINI_TIMEOUT_MS || "120000", 10));

async function scoreLeadNow(fullLead = {}, geminiModelPassedIn) {
    if (!geminiModelPassedIn) {
        console.error("Gemini model instance was not provided to scoreLeadNow.");
        // As a fallback, we could try to initialize one here if global config is available
        // but it's better if the calling context (e.g., index.js) passes it.
        // For now, we'll throw, assuming index.js or batchScorer handle initialization.
        throw new Error("Gemini model instance not available for single scoring.");
    }

    const systemInstructionText = await buildPrompt();
    const userLeadData = slimLead(fullLead);
    const userPromptContent = `Score the following single lead based on the criteria and JSON schema provided in the system instructions. The lead is: ${JSON.stringify(userLeadData, null, 2)}`;
    
    const maxOutputForSingleLead = Math.min(4096, 700 + 512); 

    console.log(`singleScorer: Calling Gemini for single lead. Max output tokens: ${maxOutputForSingleLead}`);

    let rawResponseText;
    let usageMetadata = {};

    try {
        // The passed geminiModelPassedIn is already an initialized GenerativeModel instance from VertexAI
        // We need to apply system instructions for this specific call.
        // The SDK's getGenerativeModel can take systemInstruction directly.
        // If geminiModelPassedIn is the result of vertexAIClient.getGenerativeModel({model: MODEL_ID}),
        // we can make a call with overriding/providing systemInstruction in the request if the SDK allows,
        // or get a new instance with that system instruction.
        // The model.CopyWith() method is ideal here if the base model instance doesn't have system instructions.
        // However, if the global one in index.js ALREADY has system instructions, this might override it.
        // It's cleaner if the model passed in is the base model, and we add system instructions here.
        // The batchScorer now gets a model with system instructions for each call, let's do similarly for robustness.
        
        const modelForRequest = geminiModelPassedIn.project && geminiModelPassedIn.location ? 
            geminiModelPassedIn.getGenerativeModel({ // If it's a VertexAI client instance
                model: geminiModelPassedIn.model, // Assuming model name is on the passed client or use global MODEL_ID
                systemInstruction: { parts: [{ text: systemInstructionText }] },
                safetySettings: [
                    { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
                    { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
                    { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
                    { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
                ],
                generationConfig: {
                    temperature: 0,
                    responseMimeType: "application/json",
                    maxOutputTokens: maxOutputForSingleLead 
                }
            })
            : geminiModelPassedIn; // Assume it's already a fully configured GenerativeModel instance

        const requestPayload = {
            contents: [{ role: "user", parts: [{ text: userPromptContent }] }],
            // generationConfig and safetySettings are on modelForRequest now
        };
        
        const callPromise = modelForRequest.generateContent(requestPayload);
        const timer = new Promise((_, rej) => setTimeout(() => rej(new Error("Gemini API call timeout for single lead scoring")), GEMINI_TIMEOUT_MS));
        
        const result = await Promise.race([callPromise, timer]);

        if (!result || !result.response) {
            throw new Error("Gemini API call (single lead) returned no response object.");
        }
        
        usageMetadata = result.response.usageMetadata || {}; 

        const candidate = result.response.candidates?.[0];
        if (!candidate) {
            const blockReason = result.response.promptFeedback?.blockReason;
            let sf = result.response.promptFeedback?.safetyRatings ? ` SafetyRatings: ${JSON.stringify(result.response.promptFeedback.safetyRatings)}`:"";
            if (blockReason) throw new Error(`Gemini API call (single lead) blocked. Reason: ${blockReason}.${sf}`);
            throw new Error(`Gemini API call (single lead) returned no candidates.${sf}`);
        }

        if (candidate.content && candidate.content.parts && candidate.content.parts[0].text) {
            rawResponseText = candidate.content.parts[0].text;
        } else {
            const fr = candidate.finishReason;
            let sf = candidate.safetyRatings ? ` SafetyRatings: ${JSON.stringify(candidate.safetyRatings)}`:"";
            if (fr && fr !== "STOP") throw new Error(`Gemini API call (single lead) finished with reason: ${fr}.${sf}`);
            throw new Error(`Gemini API call (single lead) returned candidate with no text content.${sf}`);
        }

    } catch (error) {
        console.error(`Gemini API call failed for single lead (singleScorer): ${error.message}. Profile ID: ${fullLead.id || fullLead.public_id || 'N/A'}`);
        throw error; 
    }

    console.log(
        "TOKENS single lead (Gemini via singleScorer) – Prompt: %s, Candidates: %s, Total: %s",
        usageMetadata.promptTokenCount || "?",
        usageMetadata.candidatesTokenCount || "?",
        usageMetadata.totalTokenCount || "?"
    );

    if (process.env.DEBUG_RAW_PROMPT === "1" || process.env.DEBUG_RAW_GEMINI === "1") {
        console.log("DBG-RAW-GEMINI (singleScorer):\n", rawResponseText);
    }

    try {
        const cleanedJsonString = rawResponseText.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
        const parsedArrayOrObject = JSON.parse(cleanedJsonString);

        if (Array.isArray(parsedArrayOrObject) && parsedArrayOrObject.length > 0) {
            return parsedArrayOrObject[0]; 
        } else if (!Array.isArray(parsedArrayOrObject) && typeof parsedArrayOrObject === 'object' && parsedArrayOrObject !== null) {
            console.warn("Gemini returned a single object directly for single lead scoring in singleScorer. Using it.");
            return parsedArrayOrObject;
        } else {
            console.error("Gemini response (singleScorer) was not a valid non-empty array or direct object. Parsed:", parsedArrayOrObject);
            throw new Error("Gemini response format error (singleScorer): Expected array with one item or a single object.");
        }
    } catch (parseErr) {
        console.error(`Failed to parse Gemini JSON (singleScorer): ${parseErr.message}. Raw: ${rawResponseText.substring(0, 500)}...`);
        throw new Error(`JSON Parse Error (singleScorer): ${parseErr.message}`);
    }
}

module.exports = { scoreLeadNow };