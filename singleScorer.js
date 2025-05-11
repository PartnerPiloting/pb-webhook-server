// singleScorer.js - UPDATED to use vertexAIClient and geminiModelId for specific model configuration

require("dotenv").config();

const { buildPrompt, slimLead } = require("./promptBuilder");
const { HarmCategory, HarmBlockThreshold } = require('@google-cloud/vertexai');

const GEMINI_TIMEOUT_MS = Math.max(30000, parseInt(process.env.GEMINI_TIMEOUT_MS || "120000", 10));

async function scoreLeadNow(fullLead = {}, dependencies) {
    const { vertexAIClient, geminiModelId } = dependencies || {};

    if (!vertexAIClient || !geminiModelId) {
        console.error("singleScorer.scoreLeadNow: vertexAIClient or geminiModelId was not provided.");
        throw new Error("Gemini client/model dependencies not available for single scoring.");
    }

    const systemInstructionText = await buildPrompt();
    const userLeadData = slimLead(fullLead);
    const userPromptContent = `Score the following single lead based on the criteria and JSON schema provided in the system instructions. The lead is: ${JSON.stringify(userLeadData, null, 2)}`;
    
    const maxOutputForSingleLead = Math.min(4096, 700 + 512); // Example, adjust as needed

    console.log(`singleScorer: Calling Gemini for single lead. Model ID: ${geminiModelId}. Max output tokens: ${maxOutputForSingleLead}`);

    let rawResponseText;
    let usageMetadata = {};

    try {
        // Get a specifically configured model instance for this request
        const modelInstanceForRequest = vertexAIClient.getGenerativeModel({
            model: geminiModelId, // Use the passed-in model ID
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
        });

        const requestPayload = {
            contents: [{ role: "user", parts: [{ text: userPromptContent }] }],
        };
        
        const callPromise = modelInstanceForRequest.generateContent(requestPayload);
        const timer = new Promise((_, rej) => setTimeout(() => rej(new Error("Gemini API call timeout for single lead scoring")), GEMINI_TIMEOUT_MS));
        
        const result = await Promise.race([callPromise, timer]);

        if (!result || !result.response) {
            throw new Error("Gemini API call (singleScorer) returned no response object.");
        }
        
        usageMetadata = result.response.usageMetadata || {}; 

        const candidate = result.response.candidates?.[0];
        if (!candidate) {
            const blockReason = result.response.promptFeedback?.blockReason;
            let sf = result.response.promptFeedback?.safetyRatings ? ` SafetyRatings: ${JSON.stringify(result.response.promptFeedback.safetyRatings)}`:"";
            if (blockReason) throw new Error(`Gemini API call (singleScorer) blocked. Reason: ${blockReason}.${sf}`);
            throw new Error(`Gemini API call (singleScorer) returned no candidates.${sf}`);
        }

        if (candidate.content && candidate.content.parts && candidate.content.parts[0].text) {
            rawResponseText = candidate.content.parts[0].text;
        } else {
            const fr = candidate.finishReason;
            let sf = candidate.safetyRatings ? ` SafetyRatings: ${JSON.stringify(candidate.safetyRatings)}`:"";
            if (fr && fr !== "STOP") throw new Error(`Gemini API call (singleScorer) finished with reason: ${fr}.${sf}`);
            throw new Error(`Gemini API call (singleScorer) returned candidate with no text content.${sf}`);
        }

    } catch (error) {
        console.error(`singleScorer: Gemini API call failed for single lead: ${error.message}. Profile ID: ${fullLead.id || fullLead.public_id || 'N/A'}`);
        throw error; 
    }

    console.log(
        "singleScorer: TOKENS single lead (Gemini) – Prompt: %s, Candidates: %s, Total: %s",
        usageMetadata.promptTokenCount || "?",
        usageMetadata.candidatesTokenCount || "?",
        usageMetadata.totalTokenCount || "?"
    );

    if (process.env.DEBUG_RAW_PROMPT === "1" || process.env.DEBUG_RAW_GEMINI === "1") {
        console.log("singleScorer: DBG-RAW-GEMINI:\n", rawResponseText);
    }

    try {
        const cleanedJsonString = rawResponseText.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
        const parsedArrayOrObject = JSON.parse(cleanedJsonString);

        if (Array.isArray(parsedArrayOrObject) && parsedArrayOrObject.length > 0) {
            return parsedArrayOrObject[0]; 
        } else if (!Array.isArray(parsedArrayOrObject) && typeof parsedArrayOrObject === 'object' && parsedArrayOrObject !== null) {
            console.warn("singleScorer: Gemini returned a single object directly for single lead scoring. Using it.");
            return parsedArrayOrObject;
        } else {
            console.error("singleScorer: Gemini response was not a valid non-empty array or direct object. Parsed:", parsedArrayOrObject);
            throw new Error("singleScorer: Gemini response format error: Expected array with one item or a single object.");
        }
    } catch (parseErr) {
        console.error(`singleScorer: Failed to parse Gemini JSON: ${parseErr.message}. Raw: ${rawResponseText.substring(0, 500)}...`);
        throw new Error(`singleScorer: JSON Parse Error: ${parseErr.message}`);
    }
}

module.exports = { scoreLeadNow };