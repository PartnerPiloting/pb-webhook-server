// singleScorer.js - Final Clean Version

require("dotenv").config();
const { createLogger } = require('./utils/contextLogger');

const { buildPrompt, slimLead } = require("./promptBuilder");
const { HarmCategory, HarmBlockThreshold } = require('@google-cloud/vertexai');
const { geminiCandidateText, geminiJsonText, isRetryableRateLimitError } = require('./config/geminiClient');
// Scoring-model seam (same switch as batchScorer): SCORING_PROVIDER=claude sends the same prompts
// to Claude and rescales its attribute points onto the Gemini scale. Default stays Gemini.
const {
    isClaudeScoring, scoringProviderLabel, describeScoringProvider,
    isRetryableClaudeError, callClaudeForScoring, scaleClaudePositiveScores,
} = require('./config/scoringProvider');
const { loadAttributes } = require('./attributeLoader');

const GEMINI_TIMEOUT_MS = Math.max(30000, parseInt(process.env.GEMINI_TIMEOUT_MS || "120000", 10));

// Same retry settings as batchScorer: a "429 TPM quota exhausted / no spare capacity" from Vertex's
// shared pool usually clears in seconds, so wait 5s, then 10s, before failing (and alerting). Before
// 14 Oct 2026 the instant score gave up on the first 429 while the batch retried.
const GEMINI_429_RETRY_ATTEMPTS = Math.max(1, parseInt(process.env.GEMINI_429_RETRY_ATTEMPTS || "3", 10));
const GEMINI_429_INITIAL_BACKOFF_MS = Math.max(1000, parseInt(process.env.GEMINI_429_INITIAL_BACKOFF_MS || "5000", 10));

async function scoreLeadNow(fullLead = {}, dependencies, logger = null) {
    const { vertexAIClient, geminiModelId, clientId } = dependencies || {};
    const providerLabel = scoringProviderLabel();

    // Initialize logger if not provided (backward compatibility)
    if (!logger) {
        const leadId = fullLead?.id || fullLead?.public_id || 'UNKNOWN';
        logger = createLogger({ runId: 'SYSTEM', clientId: `SINGLE-${leadId.substring(0, 8)}`, operation: 'single_scorer' });
    }

    logger.info( `Starting single lead scoring for lead: ${fullLead?.id || fullLead?.public_id || 'N/A'}${clientId ? ` (client: ${clientId})` : ''}`);

    // The Gemini client is still required on the Claude path - callers pass it unconditionally and
    // it is the rollback. Only its use is skipped.
    if (!vertexAIClient || !geminiModelId) {
        logger.error('scoreLeadNow', 'vertexAIClient or geminiModelId was not provided');
        throw new Error("Gemini client/model dependencies not available for single scoring.");
    }

    // MULTI-TENANT: Pass clientId to buildPrompt to load client-specific attributes
    const systemInstructionText = await buildPrompt(logger, clientId);
    const userLeadData = slimLead(fullLead);
    const userPromptContent = `Score the following single lead based on the criteria and JSON schema provided in the system instructions. The lead is: ${JSON.stringify(userLeadData, null, 2)}`;

    // Gemini 2.5 models spend hidden "thinking" tokens out of the SAME maxOutputTokens budget as the
    // visible answer. On gemini-2.5-flash a rich profile routinely burns 3,500-4,000 thinking tokens,
    // so the old 4096 cap left only 150-700 tokens for the JSON and it was cut off mid-string
    // (finishReason MAX_TOKENS -> "Unterminated string in JSON"). The batch scorer uses 60000 and
    // never hit this. Keep the cap generous; the model stops on its own when the JSON is complete.
    const maxOutputForSingleLead = Math.max(4096, parseInt(process.env.GEMINI_SINGLE_MAX_OUTPUT_TOKENS || "32768", 10) || 32768);
    const scoringSetup = describeScoringProvider(geminiModelId);

    logger.debug( `Calling ${providerLabel} for single lead - Model: ${scoringSetup.modelId}, Max tokens: ${isClaudeScoring() ? scoringSetup.maxTokens : maxOutputForSingleLead}`);

    let rawResponseText = "";
    let usageMetadata = {};
    let modelFinishReason = null;
    let modelSafetyRatings = null;

    // One model call (whichever provider is in force), returning the Gemini-shaped bundle the
    // parsing below consumes: { rawResponseText, usageMetadata, finishReason, safetyRatings }.
    async function callScoringModelOnce() {
        if (isClaudeScoring()) {
            return callClaudeForScoring({ systemPrompt: systemInstructionText, userPrompt: userPromptContent, timeoutMs: GEMINI_TIMEOUT_MS });
        }
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

        let timerId;
        let result;
        try {
            const callPromise = modelInstanceForRequest.generateContent(requestPayload);
            const timer = new Promise((_, rej) => { timerId = setTimeout(() => rej(new Error("Gemini API call timeout for single lead scoring")), GEMINI_TIMEOUT_MS); });
            result = await Promise.race([callPromise, timer]);
        } finally {
            clearTimeout(timerId);
        }

        if (!result || !result.response) {
            logger.error('scoreLeadNow', 'Gemini API call returned no response object');
            throw new Error("Gemini API call (singleScorer) returned no response object.");
        }

        const usage = result.response.usageMetadata || {};
        const candidate = result.response.candidates?.[0];

        if (!candidate) {
            const blockReason = result.response.promptFeedback?.blockReason;
            const ratings = result.response.promptFeedback?.safetyRatings;
            let sf = ratings ? ` SafetyRatings: ${JSON.stringify(ratings)}`:"";
            if (blockReason) {
                logger.error('scoreLeadNow', `Gemini API call blocked - Reason: ${blockReason}${sf}`);
                const e = new Error(`Gemini API call (singleScorer) blocked. Reason: ${blockReason}.${sf}`); e.safetyRatings = ratings; throw e;
            }
            logger.error('scoreLeadNow', `Gemini API call returned no candidates${sf}`);
            const e = new Error(`Gemini API call (singleScorer) returned no candidates.${sf}`); e.safetyRatings = ratings; throw e;
        }
        return { rawResponseText: geminiCandidateText(candidate), usageMetadata: usage, finishReason: candidate.finishReason, safetyRatings: candidate.safetyRatings };
    }

    const isTransientModelError = (error) => (isClaudeScoring() ? isRetryableClaudeError(error) : isRetryableRateLimitError(error));

    try {
        let call;
        for (let attempt = 1; attempt <= GEMINI_429_RETRY_ATTEMPTS; attempt++) {
            try {
                call = await callScoringModelOnce();
                break;
            } catch (callError) {
                if (attempt < GEMINI_429_RETRY_ATTEMPTS && isTransientModelError(callError)) {
                    const backoffMs = GEMINI_429_INITIAL_BACKOFF_MS * Math.pow(2, attempt - 1);
                    logger.warn('scoreLeadNow', `Transient ${providerLabel} error on attempt ${attempt}/${GEMINI_429_RETRY_ATTEMPTS} (${callError?.message || callError}). Waiting ${backoffMs}ms before retry...`);
                    await new Promise(resolve => setTimeout(resolve, backoffMs));
                    continue;
                }
                if (callError && callError.safetyRatings) modelSafetyRatings = callError.safetyRatings;
                throw callError;
            }
        }

        usageMetadata = call.usageMetadata || {};
        modelFinishReason = call.finishReason;
        modelSafetyRatings = call.safetyRatings || null;

        rawResponseText = call.rawResponseText || "";
        if (!rawResponseText) {
            logger.warn('scoreLeadNow', `Candidate had no text content - Finish Reason: ${modelFinishReason || 'Unknown'}`);
        }

        if (modelFinishReason === 'MAX_TOKENS') {
            logger.warn('scoreLeadNow', `${providerLabel} API call finished due to MAX_TOKENS (limit: ${isClaudeScoring() ? scoringSetup.maxTokens : maxOutputForSingleLead}, thinking tokens: ${usageMetadata.thoughtsTokenCount ?? "?"}, answer tokens: ${usageMetadata.candidatesTokenCount ?? "?"}) - Output may be truncated. SafetyRatings: ${JSON.stringify(modelSafetyRatings)}`);
            if (rawResponseText.trim() === "") {
                 logger.error('scoreLeadNow', 'MAX_TOKENS finish reason AND no text content returned - will likely cause parsing error');
            }
        } else if (modelFinishReason && modelFinishReason !== 'STOP') {
            logger.warn('scoreLeadNow', `${providerLabel} API call finished with non-STOP reason: ${modelFinishReason}. SafetyRatings: ${JSON.stringify(modelSafetyRatings)}`);
        }

    } catch (error) {
        logger.error('scoreLeadNow', `${providerLabel} API call failed for single lead: ${error.message}. Profile ID: ${fullLead.id || fullLead.public_id || 'N/A'}`);
        error.finishReason = modelFinishReason;
        error.safetyRatings = modelSafetyRatings;
        throw error;
    }

    logger.debug('scoreLeadNow',
        `TOKENS single lead (${providerLabel}) – Prompt: ${usageMetadata.promptTokenCount || "?"}, ` +
        `Thinking: ${usageMetadata.thoughtsTokenCount ?? "?"}, Candidates: ${usageMetadata.candidatesTokenCount || "?"}, Total: ${usageMetadata.totalTokenCount || "?"}`
    );

    if (process.env.DEBUG_RAW_GEMINI === "1") {
        logger.debug('scoreLeadNow', `DBG-RAW-GEMINI (Full Response Text): ${rawResponseText}`);
    } else if (modelFinishReason === 'MAX_TOKENS') {
        logger.debug('scoreLeadNow', `DBG-RAW-GEMINI (MAX_TOKENS - Snippet): ${rawResponseText.substring(0, 1000)}...`);
    }

    if (rawResponseText.trim() === "") {
        const errorMessage = `${providerLabel} response text is empty. Finish Reason: ${modelFinishReason || 'Unknown'}. Cannot parse score.`;
        logger.error('scoreLeadNow', errorMessage);
        const error = new Error(errorMessage);
        error.finishReason = modelFinishReason;
        error.safetyRatings = modelSafetyRatings;
        throw error;
    }

    let parsedResult = null;
    try {
        const cleanedJsonString = geminiJsonText(rawResponseText);
        const parsedArrayOrObject = JSON.parse(cleanedJsonString);

        // Prepare result with token usage information
        let result = null;
        const tokenUsageInfo = {
            promptTokens: usageMetadata.promptTokenCount || 0,
            responseTokens: usageMetadata.candidatesTokenCount || 0,
            totalTokens: usageMetadata.totalTokenCount || 0
        };

        if (Array.isArray(parsedArrayOrObject) && parsedArrayOrObject.length > 0) {
            logger.info('scoreLeadNow', 'Successfully parsed single lead score from array format');
            result = parsedArrayOrObject[0];
        } else if (!Array.isArray(parsedArrayOrObject) && typeof parsedArrayOrObject === 'object' && parsedArrayOrObject !== null) {
            logger.warn('scoreLeadNow', `${providerLabel} returned single object directly for single lead scoring - using it`);
            result = parsedArrayOrObject;
        } else {
            logger.error('scoreLeadNow', `${providerLabel} response was not a valid non-empty array or direct object. Parsed: ${JSON.stringify(parsedArrayOrObject)}`);
            throw new Error(`singleScorer: ${providerLabel} response format error: Expected array with one item or a single object.`);
        }

        // Add token usage information to the result
        result._tokenUsage = tokenUsageInfo;
        parsedResult = result;
    } catch (parseErr) {
        logger.error('scoreLeadNow', `Failed to parse ${providerLabel} JSON: ${parseErr.message}. Raw (first 500 chars): ${rawResponseText.substring(0, 500)}... Finish Reason: ${modelFinishReason}`);
        const error = new Error(`singleScorer: JSON Parse Error: ${parseErr.message}`);
        error.finishReason = modelFinishReason;
        error.safetyRatings = modelSafetyRatings;
        error.rawResponseSnippet = rawResponseText.substring(0, 500);
        throw error;
    }

    // Claude path only: lift the positive attribute points onto the Gemini scale (x1.5, capped at
    // each attribute's maxPoints) so the caller's computeFinalScore + breakdown see Gemini-scale
    // numbers. Done here, not in the caller, so every single-lead consumer gets it.
    if (isClaudeScoring() && parsedResult && parsedResult.positive_scores && typeof parsedResult.positive_scores === 'object') {
        const { positives } = await loadAttributes(null, clientId);
        parsedResult._rawPositiveScores = { ...parsedResult.positive_scores };
        parsedResult.positive_scores = scaleClaudePositiveScores(parsedResult.positive_scores, positives);
    }
    return parsedResult;
}

module.exports = { scoreLeadNow };
