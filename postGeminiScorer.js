// File: services/postGeminiScorer.js
const StructuredLogger = require('./utils/structuredLogger');
const MAX_OUTPUT_TOKENS_FOR_POST_SCORING = 16384;
const GEMINI_TIMEOUT_MS = parseInt(process.env.GEMINI_TIMEOUT_MS || "120000", 10);

async function scorePostsWithGemini(geminiInputObject, configuredGeminiModelInstance, logger = null) {
    // Initialize logger if not provided (backward compatibility)
    if (!logger) {
        const clientId = geminiInputObject?.lead_id?.substring(0, 8) || 'UNKNOWN';
        logger = new StructuredLogger(clientId, 'GEMINI');
    }

    logger.setup('scorePostsWithGemini', `Starting Gemini post scoring for ${geminiInputObject?.posts?.length || 0} posts`);

    if (!geminiInputObject || !geminiInputObject.posts || geminiInputObject.posts.length === 0) {
        logger.error('scorePostsWithGemini', 'No posts provided to score');
        throw new Error("PostGeminiScorer: No posts provided to score.");
    }
    if (!configuredGeminiModelInstance) {
        logger.error('scorePostsWithGemini', 'No configured Gemini model instance provided');
        throw new Error("PostGeminiScorer: A configured Gemini model instance is required.");
    }

    const userPromptContent = `
Analyze and score EACH of the LinkedIn posts in the following JSON object individually based on the criteria provided in the system instructions.

**Your Task:**
1.  The input is a JSON object with two keys: 'lead_id' (string) and 'posts' (array of post objects).
2.  Evaluate every single post in the 'posts' array.
3.  For each post, generate a score and a detailed rationale based on the scoring rubric.
4.  Return ONLY a JSON array - nothing else. Do not wrap it in an object.
5.  **CRITICAL RESPONSE FORMAT:** Your response must be a direct JSON array like this:
    [
      {
        "post_url": "URL_OF_POST_1",
        "post_score": 75,
        "scoring_rationale": "Detailed explanation..."
      },
      {
        "post_url": "URL_OF_POST_2", 
        "post_score": 45,
        "scoring_rationale": "Detailed explanation..."
      }
    ]
6.  **DO NOT** wrap the array in any object structure like {"post_analysis": [...]} or {"posts": [...]}
7.  **DO NOT** include any text before or after the JSON array
8.  Each object in the array must have these exact keys: "post_url", "post_score", "scoring_rationale"

Here is the object to analyze:
${JSON.stringify(geminiInputObject, null, 2)}
`;

    logger.process('scorePostsWithGemini', `Calling Gemini API - Prompt length: ${userPromptContent.length}, Max tokens: ${MAX_OUTPUT_TOKENS_FOR_POST_SCORING}`);
    let rawResponseText = "", usageMetadata = {}, modelFinishReason = null, modelSafetyRatings = null;
    try {
        const requestPayload = {
            contents: [{ role: "user", parts: [{ text: userPromptContent }] }],
            generationConfig: { maxOutputTokens: MAX_OUTPUT_TOKENS_FOR_POST_SCORING }
        };
        const callPromise = configuredGeminiModelInstance.generateContent(requestPayload);
        const timer = new Promise((_, rej) => setTimeout(() => rej(new Error(`Gemini API call for post scoring timeout after ${GEMINI_TIMEOUT_MS}ms`)), GEMINI_TIMEOUT_MS));
        const result = await Promise.race([callPromise, timer]);

        if (!result || !result.response) {
            logger.error('scorePostsWithGemini', 'Gemini API call returned no response object');
            throw new Error("PostGeminiScorer: Gemini API call returned no response object.");
        }
        usageMetadata = result.response.usageMetadata || {};
        const candidate = result.response.candidates?.[0];
        if (!candidate) {
            const blockReason = result.response.promptFeedback?.blockReason;
            modelSafetyRatings = result.response.promptFeedback?.safetyRatings;
            const sf = modelSafetyRatings ? ` SafetyRatings: ${JSON.stringify(modelSafetyRatings)}` : "";
            if (blockReason) {
                logger.error('scorePostsWithGemini', `API call blocked - Reason: ${blockReason}${sf}`);
                throw new Error(`PostGeminiScorer: API call blocked. Reason: ${blockReason}.${sf}`);
            }
            logger.error('scorePostsWithGemini', `API call returned no candidates${sf}`);
            throw new Error(`PostGeminiScorer: API call returned no candidates.${sf}`);
        }
        modelFinishReason = candidate.finishReason;
        modelSafetyRatings = candidate.safetyRatings;
        if (candidate.content?.parts?.[0]?.text) rawResponseText = candidate.content.parts[0].text;
        else logger.warn('scorePostsWithGemini', `Candidate had no text content - Finish Reason: ${modelFinishReason || "Unknown"}`);
        if (modelFinishReason && modelFinishReason !== "STOP") logger.warn('scorePostsWithGemini', `Gemini API call finished with non-STOP reason: ${modelFinishReason}`);
        logger.debug('scorePostsWithGemini', `TOKENS (Gemini) – Prompt: ${usageMetadata.promptTokenCount || "?"}, Candidates: ${usageMetadata.candidatesTokenCount || "?"}, Total: ${usageMetadata.totalTokenCount || "?"}`);
        if (rawResponseText.trim() === "") {
            logger.error('scorePostsWithGemini', `Gemini response text is empty - Finish Reason: ${modelFinishReason || "Unknown"}`);
            throw new Error(`PostGeminiScorer: Gemini response text is empty. Finish Reason: ${modelFinishReason || "Unknown"}.`);
        }

        const cleanedJsonString = rawResponseText.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
        const parsedJsonObject = JSON.parse(cleanedJsonString);

        // Flexible parsing to handle multiple Gemini response formats
        if (Array.isArray(parsedJsonObject)) {
            // Format 1: Direct array [{post_id: "...", post_score: 50}]
            logger.summary('scorePostsWithGemini', `Successfully parsed direct array format with ${parsedJsonObject.length} scored posts`);
            return parsedJsonObject;
        } else if (parsedJsonObject.post_analysis && Array.isArray(parsedJsonObject.post_analysis)) {
            // Format 2: Wrapped in object {post_analysis: [{post_id: "...", post_score: 50}]}
            logger.debug('scorePostsWithGemini', 'Detected wrapped response format, extracting post_analysis array');
            logger.summary('scorePostsWithGemini', `Successfully parsed wrapped format with ${parsedJsonObject.post_analysis.length} scored posts`);
            return parsedJsonObject.post_analysis;
        } else if (parsedJsonObject.posts && Array.isArray(parsedJsonObject.posts)) {
            // Format 3: Alternative wrapper {posts: [{post_id: "...", post_score: 50}]}
            logger.debug('scorePostsWithGemini', 'Detected alternative wrapped response format, extracting posts array');
            logger.summary('scorePostsWithGemini', `Successfully parsed alternative format with ${parsedJsonObject.posts.length} scored posts`);
            return parsedJsonObject.posts;
        } else {
            logger.error('scorePostsWithGemini', `Gemini response not in recognized format: ${JSON.stringify(parsedJsonObject).substring(0, 200)}...`);
            throw new Error("PostGeminiScorer: Gemini response format error: Expected a JSON array or object containing an array of post score objects.");
        }
    } catch (error) {
        logger.error('scorePostsWithGemini', `Gemini API call failed: ${error.message}`);
        error.finishReason = modelFinishReason;
        error.safetyRatings = modelSafetyRatings;
        if (rawResponseText) error.rawResponseSnippet = rawResponseText.substring(0, 500);
        throw error;
    }
}

module.exports = { scorePostsWithGemini };