// singleScorer.js - DEBUG: Temporarily increased maxOutputTokens to 20k

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
    
    // ***** DEBUG MODIFICATION: Temporarily increased maxOutputForSingleLead *****
    const maxOutputForSingleLead = 20000; // Increased for debugging this specific MAX_TOKENS issue

    console.log(`singleScorer: DEBUG MODE - Calling Gemini for single lead. Model ID: ${geminiModelId}. Max output tokens: ${maxOutputForSingleLead}`);

    let rawResponseText = ""; 
    let usageMetadata = {};
    let modelFinishReason = null;
    let modelSafetyRatings = null;

    try {
        const modelInstanceForRequest = vertexAIClient.getGenerativeModel({
            model: geminiModelId,
            systemInstruction: { parts: [{ text: systemInstructionText }] },
            safetySettings: [
                { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
                { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
                { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
                { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
            ],
            generationConfig: {
                temperature: 0,
                responseMimeType: "application/json", // Still requesting JSON
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
            modelSafetyRatings = result.response.promptFeedback?.safetyRatings;
            let sf = modelSafetyRatings ? ` SafetyRatings: ${JSON.stringify(modelSafetyRatings)}`:"";
            if (blockReason) throw new Error(`Gemini API call (singleScorer) blocked. Reason: ${blockReason}.${sf}`);
            throw new Error(`Gemini API call (singleScorer) returned no candidates.${sf}`);
        }

        modelFinishReason = candidate.finishReason;
        modelSafetyRatings = candidate.safetyRatings;

        if (candidate.content && candidate.content.parts && candidate.content.parts[0].text) {
            rawResponseText = candidate.content.parts[0].text;
        } else {
            console.warn(`singleScorer: Candidate had no text content. Finish Reason: ${modelFinishReason || 'Unknown'}.`);
        }

        if (modelFinishReason === 'MAX_TOKENS') {
            console.warn(`singleScorer: Gemini API call finished due to MAX_TOKENS (limit was ${maxOutputForSingleLead}). Output may be truncated. SafetyRatings: ${JSON.stringify(modelSafetyRatings)}`);
            if (rawResponseText.trim() === "") {
                 console.error("singleScorer: MAX_TOKENS finish reason AND no text content was returned. This will likely cause a parsing error.");
            }
        } else if (modelFinishReason && modelFinishReason !== 'STOP') {
            console.warn(`singleScorer: Gemini API call finished with non-STOP reason: ${modelFinishReason}. SafetyRatings: ${JSON.stringify(modelSafetyRatings)}`);
        }

    } catch (error) {
        console.error(`singleScorer: Gemini API call failed for single lead: ${error.message}. Profile ID: ${fullLead.id || fullLead.public_id || 'N/A'}`);
        error.finishReason = modelFinishReason;
        error.safetyRatings = modelSafetyRatings;
        throw error; 
    }

    console.log(
        "singleScorer: TOKENS single lead (Gemini) – Prompt: %s, Candidates: %s, Total: %s",
        usageMetadata.promptTokenCount || "?",
        usageMetadata.candidatesTokenCount || "?",
        usageMetadata.totalTokenCount || "?"
    );

    // Ensure DEBUG_RAW_GEMINI is enabled in your Render environment variables to see this!
    if (process.env.DEBUG_RAW_GEMINI === "1") {
        console.log("singleScorer: DBG-RAW-GEMINI (Full Response Text):\n", rawResponseText);
    } else if (modelFinishReason === 'MAX_TOKENS') {
        // If not in full debug mode, but we hit MAX_TOKENS, let's log a snippet to help diagnose
        console.log(`singleScorer: DBG-RAW-GEMINI (MAX_TOKENS - Snippet):\n${rawResponseText.substring(0, 1000)}...`);
    }


    if (rawResponseText.trim() === "") {
        const errorMessage = `singleScorer: Gemini response text is empty. Finish Reason: ${modelFinishReason || 'Unknown'}. Cannot parse score.`;
        console.error(errorMessage);
        const error = new Error(errorMessage);
        error.finishReason = modelFinishReason;
        error.safetyRatings = modelSafetyRatings;
        throw error;
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
        console.error(`singleScorer: Failed to parse Gemini JSON: ${parseErr.message}. Raw (first 500 chars): ${rawResponseText.substring(0, 500)}... Finish Reason: ${modelFinishReason}`);
        const error = new Error(`singleScorer: JSON Parse Error: ${parseErr.message}`);
        error.finishReason = modelFinishReason;
        error.safetyRatings = modelSafetyRatings;
        error.rawResponseSnippet = rawResponseText.substring(0, 500);
        throw error;
    }
}

module.exports = { scoreLeadNow };