// singleScorer.js - Final Clean Version

require("dotenv").config();
const StructuredLogger = require('./utils/structuredLogger');

const { buildPrompt, slimLead } = require("./promptBuilder");
const { HarmCategory, HarmBlockThreshold } = require('@google-cloud/vertexai');

const GEMINI_TIMEOUT_MS = Math.max(30000, parseInt(process.env.GEMINI_TIMEOUT_MS || "120000", 10));

async function scoreLeadNow(fullLead = {}, dependencies, logger = null) {
    const { vertexAIClient, geminiModelId } = dependencies || {};

    // Initialize logger if not provided (backward compatibility)
    if (!logger) {
        const leadId = fullLead?.id || fullLead?.public_id || 'UNKNOWN';
        logger = new StructuredLogger(`SINGLE-${leadId.substring(0, 8)}`, 'SCORER');
    }

    logger.setup('scoreLeadNow', `Starting single lead scoring for lead: ${fullLead?.id || fullLead?.public_id || 'N/A'}`);

    if (!vertexAIClient || !geminiModelId) {
        logger.error('scoreLeadNow', 'vertexAIClient or geminiModelId was not provided');
        throw new Error("Gemini client/model dependencies not available for single scoring.");
    }

    const systemInstructionText = await buildPrompt(logger);
    const userLeadData = slimLead(fullLead);
    const userPromptContent = `Score the following single lead based on the criteria and JSON schema provided in the system instructions. The lead is: ${JSON.stringify(userLeadData, null, 2)}`;
    
    const maxOutputForSingleLead = 4096; // Production-appropriate value

    logger.process('scoreLeadNow', `Calling Gemini for single lead - Model: ${geminiModelId}, Max tokens: ${maxOutputForSingleLead}`);

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
            logger.error('scoreLeadNow', 'Gemini API call returned no response object');
            throw new Error("Gemini API call (singleScorer) returned no response object.");
        }
        
        usageMetadata = result.response.usageMetadata || {}; 
        const candidate = result.response.candidates?.[0];

        if (!candidate) {
            const blockReason = result.response.promptFeedback?.blockReason;
            modelSafetyRatings = result.response.promptFeedback?.safetyRatings;
            let sf = modelSafetyRatings ? ` SafetyRatings: ${JSON.stringify(modelSafetyRatings)}`:"";
            if (blockReason) {
                logger.error('scoreLeadNow', `Gemini API call blocked - Reason: ${blockReason}${sf}`);
                throw new Error(`Gemini API call (singleScorer) blocked. Reason: ${blockReason}.${sf}`);
            }
            logger.error('scoreLeadNow', `Gemini API call returned no candidates${sf}`);
            throw new Error(`Gemini API call (singleScorer) returned no candidates.${sf}`);
        }

        modelFinishReason = candidate.finishReason;
        modelSafetyRatings = candidate.safetyRatings;

        if (candidate.content && candidate.content.parts && candidate.content.parts[0].text) {
            rawResponseText = candidate.content.parts[0].text;
        } else {
            logger.warn('scoreLeadNow', `Candidate had no text content - Finish Reason: ${modelFinishReason || 'Unknown'}`);
        }

        if (modelFinishReason === 'MAX_TOKENS') {
            logger.warn('scoreLeadNow', `Gemini API call finished due to MAX_TOKENS (limit: ${maxOutputForSingleLead}) - Output may be truncated. SafetyRatings: ${JSON.stringify(modelSafetyRatings)}`);
            if (rawResponseText.trim() === "") {
                 logger.error('scoreLeadNow', 'MAX_TOKENS finish reason AND no text content returned - will likely cause parsing error');
            }
        } else if (modelFinishReason && modelFinishReason !== 'STOP') {
            logger.warn('scoreLeadNow', `Gemini API call finished with non-STOP reason: ${modelFinishReason}. SafetyRatings: ${JSON.stringify(modelSafetyRatings)}`);
        }

    } catch (error) {
        logger.error('scoreLeadNow', `Gemini API call failed for single lead: ${error.message}. Profile ID: ${fullLead.id || fullLead.public_id || 'N/A'}`);
        error.finishReason = modelFinishReason;
        error.safetyRatings = modelSafetyRatings;
        throw error; 
    }

    logger.debug('scoreLeadNow',
        `TOKENS single lead (Gemini) – Prompt: ${usageMetadata.promptTokenCount || "?"}, ` +
        `Candidates: ${usageMetadata.candidatesTokenCount || "?"}, Total: ${usageMetadata.totalTokenCount || "?"}`
    );

    if (process.env.DEBUG_RAW_GEMINI === "1") {
        logger.debug('scoreLeadNow', `DBG-RAW-GEMINI (Full Response Text): ${rawResponseText}`);
    } else if (modelFinishReason === 'MAX_TOKENS') {
        logger.debug('scoreLeadNow', `DBG-RAW-GEMINI (MAX_TOKENS - Snippet): ${rawResponseText.substring(0, 1000)}...`);
    }

    if (rawResponseText.trim() === "") {
        const errorMessage = `Gemini response text is empty. Finish Reason: ${modelFinishReason || 'Unknown'}. Cannot parse score.`;
        logger.error('scoreLeadNow', errorMessage);
        const error = new Error(errorMessage);
        error.finishReason = modelFinishReason;
        error.safetyRatings = modelSafetyRatings;
        throw error;
    }

    try {
        const cleanedJsonString = rawResponseText.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
        const parsedArrayOrObject = JSON.parse(cleanedJsonString);

        if (Array.isArray(parsedArrayOrObject) && parsedArrayOrObject.length > 0) {
            logger.summary('scoreLeadNow', 'Successfully parsed single lead score from array format');
            return parsedArrayOrObject[0]; 
        } else if (!Array.isArray(parsedArrayOrObject) && typeof parsedArrayOrObject === 'object' && parsedArrayOrObject !== null) {
            logger.warn('scoreLeadNow', 'Gemini returned single object directly for single lead scoring - using it');
            return parsedArrayOrObject;
        } else {
            logger.error('scoreLeadNow', `Gemini response was not a valid non-empty array or direct object. Parsed: ${JSON.stringify(parsedArrayOrObject)}`);
            throw new Error("singleScorer: Gemini response format error: Expected array with one item or a single object.");
        }
    } catch (parseErr) {
        logger.error('scoreLeadNow', `Failed to parse Gemini JSON: ${parseErr.message}. Raw (first 500 chars): ${rawResponseText.substring(0, 500)}... Finish Reason: ${modelFinishReason}`);
        const error = new Error(`singleScorer: JSON Parse Error: ${parseErr.message}`);
        error.finishReason = modelFinishReason;
        error.safetyRatings = modelSafetyRatings;
        error.rawResponseSnippet = rawResponseText.substring(0, 500);
        throw error;
    }
}

module.exports = { scoreLeadNow };