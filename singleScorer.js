// singleScorer.js - UPDATED to increase maxOutputTokens

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
    
    // ***** MODIFICATION: Increased maxOutputForSingleLead *****
    const maxOutputForSingleLead = 4096; // Increased from 1212

    console.log(`singleScorer: Calling Gemini for single lead. Model ID: ${geminiModelId}. Max output tokens: ${maxOutputForSingleLead}`);

    let rawResponseText;
    let usageMetadata = {};

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
                responseMimeType: "application/json",
                maxOutputTokens: maxOutputForSingleLead // Using the updated value
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

        // Check for finishReason MAX_TOKENS specifically
        if (candidate.finishReason === 'MAX_TOKENS') {
            console.error(`singleScorer: Gemini API call finished due to MAX_TOKENS. Output may be truncated. Consider increasing maxOutputForSingleLead if response is incomplete. SafetyRatings: ${JSON.stringify(candidate.safetyRatings)}`);
            // Even if it's MAX_TOKENS, there might still be partial content. Try to use it.
            // If content is truly unusable or missing, the following check will catch it.
        } else if (candidate.finishReason && candidate.finishReason !== 'STOP' && candidate.finishReason !== 'MAX_TOKENS') {
            // Log other non-STOP finish reasons but still try to get text if available
            let sf = candidate.safetyRatings ? ` SafetyRatings: ${JSON.stringify(candidate.safetyRatings)}`:"";
            console.warn(`singleScorer: Gemini API call finished with reason: ${candidate.finishReason}.${sf}`);
        }
        
        if (candidate.content && candidate.content.parts && candidate.content.parts[0].text) {
            rawResponseText = candidate.content.parts[0].text;
        } else {
             // If there's no text content, and finishReason wasn't MAX_TOKENS (which might still have partial text)
             // or another specific non-STOP reason, then throw an error.
            if (candidate.finishReason !== 'MAX_TOKENS') { // Only throw if not MAX_TOKENS, as MAX_TOKENS might still have usable (truncated) text
                let sf = candidate.safetyRatings ? ` SafetyRatings: ${JSON.stringify(candidate.safetyRatings)}`:"";
                throw new Error(`Gemini API call (singleScorer) returned candidate with no text content. Finish Reason: ${candidate.finishReason || 'Unknown'}.${sf}`);
            } else {
                // If it's MAX_TOKENS and no text, it's a problem.
                rawResponseText = ""; // Ensure rawResponseText is an empty string to avoid parse errors on undefined
                console.error("singleScorer: MAX_TOKENS finish reason but no text content was returned.");
            }
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

    // Handle cases where rawResponseText might be empty due to MAX_TOKENS with no actual text part
    if (!rawResponseText && rawResponseText !== "") { // Check for null or undefined, allow empty string
        console.error("singleScorer: No raw response text from Gemini to parse. This might occur after a MAX_TOKENS error with no content.");
        throw new Error("singleScorer: No content from Gemini to parse, potentially due to MAX_TOKENS with no text output.");
    }
    if (rawResponseText === "" && candidate.finishReason === 'MAX_TOKENS') {
        console.warn("singleScorer: Gemini response was empty due to MAX_TOKENS. Returning null to indicate no parsable score.");
        // Depending on how you want to handle this, you could throw an error or return a specific object/null
        // For now, let's throw an error to make it clear in the logs that scoring failed due to MAX_TOKENS with no content.
        throw new Error("singleScorer: Gemini response was empty due to MAX_TOKENS. Cannot parse score.");
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