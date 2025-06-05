// File: postGeminiScorer.js

// This hard-coded constant defines the maximum number of tokens for the AI's response,
// consistent with how your lead-scoring singleScorer.js handles it.
const MAX_OUTPUT_TOKENS_FOR_POST_SCORING = 4096;

// This uses your existing environment variable for timeouts for consistency.
// It will default to 120000ms (2 minutes) if the variable isn't set.
const GEMINI_TIMEOUT_MS = parseInt(process.env.GEMINI_TIMEOUT_MS || "120000", 10);

/**
 * Sends the post data and a pre-configured Gemini model instance to the API for scoring.
 * This is modeled closely on your existing singleScorer.js logic.
 *
 * @param {Array<object>} parsedPostsArray - The array of post objects to be scored.
 * @param {object} configuredGeminiModelInstance - The initialized & configured Vertex AI GenerativeModel instance.
 * This instance should have the system prompt, safety settings, temperature, and responseMimeType
 * already configured before being passed to this function.
 * @returns {Promise<object>} A promise that resolves to the parsed JSON object from Gemini.
 * @throws {Error} If the API call fails, times out, or the response is invalid.
 */
async function scorePostsWithGemini(parsedPostsArray, configuredGeminiModelInstance) {
    if (!parsedPostsArray || parsedPostsArray.length === 0) {
        throw new Error("PostGeminiScorer: No posts were provided to score.");
    }
    if (!configuredGeminiModelInstance) {
        throw new Error("PostGeminiScorer: A configured Gemini model instance is required.");
    }

    // 1. Construct the "user" part of the prompt, containing the post data.
    const userPromptContent = `Analyze and score the following set of LinkedIn posts from a single lead based on the criteria and JSON schema provided in the system instructions. The posts are: ${JSON.stringify(parsedPostsArray, null, 2)}`;

    console.log(`PostGeminiScorer: Calling Gemini. User prompt length (approx): ${userPromptContent.length}. Max output tokens: ${MAX_OUTPUT_TOKENS_FOR_POST_SCORING}`);

    let rawResponseText = "";
    let usageMetadata = {};
    let modelFinishReason = null;
    let modelSafetyRatings = null;

    try {
        // 2. Prepare the API request payload.
        const requestPayload = {
            contents: [{ role: "user", parts: [{ text: userPromptContent }] }],
            // Override the generationConfig for this specific call to set the token limit.
            generationConfig: {
                maxOutputTokens: MAX_OUTPUT_TOKENS_FOR_POST_SCORING
            }
        };

        // 3. Make the API call with a timeout.
        const callPromise = configuredGeminiModelInstance.generateContent(requestPayload);
        const timer = new Promise((_, rej) => setTimeout(() => rej(new Error(`Gemini API call timeout for post scoring after ${GEMINI_TIMEOUT_MS}ms`)), GEMINI_TIMEOUT_MS));
        const result = await Promise.race([callPromise, timer]);

        // 4. Process the response (this logic mirrors your robust singleScorer.js).
        if (!result || !result.response) {
            throw new Error("PostGeminiScorer: Gemini API call returned no response object.");
        }

        usageMetadata = result.response.usageMetadata || {};
        const candidate = result.response.candidates?.[0];

        if (!candidate) {
            const blockReason = result.response.promptFeedback?.blockReason;
            modelSafetyRatings = result.response.promptFeedback?.safetyRatings;
            let sf = modelSafetyRatings ? ` SafetyRatings: ${JSON.stringify(modelSafetyRatings)}` : "";
            if (blockReason) throw new Error(`PostGeminiScorer: API call blocked. Reason: ${blockReason}.${sf}`);
            throw new Error(`PostGeminiScorer: API call returned no candidates.${sf}`);
        }

        modelFinishReason = candidate.finishReason;
        modelSafetyRatings = candidate.safetyRatings;

        if (candidate.content?.parts?.[0]?.text) {
            rawResponseText = candidate.content.parts[0].text;
        } else {
            console.warn(`PostGeminiScorer: Candidate had no text content. Finish Reason: ${modelFinishReason || 'Unknown'}.`);
        }

        // Log finish reasons and token usage, just like in your existing code.
        if (modelFinishReason && modelFinishReason !== 'STOP') {
            console.warn(`PostGeminiScorer: Gemini API call finished with non-STOP reason: ${modelFinishReason}. SafetyRatings: ${JSON.stringify(modelSafetyRatings)}`);
        }
        console.log(
            "PostGeminiScorer: TOKENS (Gemini) – Prompt: %s, Candidates: %s, Total: %s",
            usageMetadata.promptTokenCount || "?",
            usageMetadata.candidatesTokenCount || "?",
            usageMetadata.totalTokenCount || "?"
        );

        if (rawResponseText.trim() === "") {
            const errorMessage = `PostGeminiScorer: Gemini response text is empty. Finish Reason: ${modelFinishReason || 'Unknown'}.`;
            throw new Error(errorMessage);
        }

        // 5. Clean and parse the JSON response.
        const cleanedJsonString = rawResponseText.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
        const parsedJsonObject = JSON.parse(cleanedJsonString);

        if (typeof parsedJsonObject === 'object' && parsedJsonObject !== null && !Array.isArray(parsedJsonObject)) {
            // Our post-scoring prompt requests a single object, so this is the expected success case.
            return parsedJsonObject;
        } else {
            console.error("PostGeminiScorer: Gemini response was not a valid single JSON object. Parsed:", parsedJsonObject);
            throw new Error("PostGeminiScorer: Gemini response format error: Expected a single JSON object.");
        }

    } catch (error) {
        // Enrich the error object with context before re-throwing it.
        console.error(`PostGeminiScorer: Gemini API call failed. Error: ${error.message}`);
        error.finishReason = modelFinishReason;
        error.safetyRatings = modelSafetyRatings;
        if (rawResponseText) { error.rawResponseSnippet = rawResponseText.substring(0, 500); }
        throw error;
    }
}

module.exports = {
    scorePostsWithGemini
};