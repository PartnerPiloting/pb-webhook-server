// File: postGeminiScorer.js
const MAX_OUTPUT_TOKENS_FOR_POST_SCORING = 16_384;   // was 4 096
const GEMINI_TIMEOUT_MS = parseInt(process.env.GEMINI_TIMEOUT_MS || "120000", 10);

async function scorePostsWithGemini(parsedPostsArray, configuredGeminiModelInstance) {
    if (!parsedPostsArray || parsedPostsArray.length === 0)
        throw new Error("PostGeminiScorer: No posts provided to score.");
    if (!configuredGeminiModelInstance)
        throw new Error(
            "PostGeminiScorer: A configured Gemini model instance is required."
        );

    // **MODIFIED LOGIC**: The user prompt now gives very specific instructions for the desired output format.
    // This overrides any ambiguity in the system prompt.
    const userPromptContent = `
Analyze and score EACH of the following LinkedIn posts individually based on the criteria provided in the system instructions.

**Your Task:**
1.  Evaluate every single post in the JSON array provided below.
2.  For each post, generate a score and a detailed rationale based on the scoring rubric.
3.  Return a single JSON array where each object represents one of the posts you evaluated.
4.  **IMPORTANT:** Do NOT return a single overall score. Return an array of objects. Each object in the array must have the following exact keys: "post_url", "post_score", "scoring_rationale".

Here are the posts to analyze:
${JSON.stringify(parsedPostsArray, null, 2)}
`;

    console.log(
        `PostGeminiScorer: Calling Gemini. User prompt length (approx): ${userPromptContent.length}. Max output tokens: ${MAX_OUTPUT_TOKENS_FOR_POST_SCORING}`
    );

    let rawResponseText = "",
        usageMetadata = {},
        modelFinishReason = null,
        modelSafetyRatings = null;

    try {
        const requestPayload = {
            contents: [{ role: "user", parts: [{ text: userPromptContent }] }],
            generationConfig: {
                maxOutputTokens: MAX_OUTPUT_TOKENS_FOR_POST_SCORING, // ← updated
            },
        };

        const callPromise =
            configuredGeminiModelInstance.generateContent(requestPayload);
        const timer = new Promise((_, rej) =>
            setTimeout(
                () =>
                    rej(
                        new Error(
                            `Gemini API call for post scoring timeout after ${GEMINI_TIMEOUT_MS}ms`
                        )
                    ),
                GEMINI_TIMEOUT_MS
            )
        );

        const result = await Promise.race([callPromise, timer]);

        if (!result || !result.response)
            throw new Error(
                "PostGeminiScorer: Gemini API call returned no response object."
            );

        usageMetadata = result.response.usageMetadata || {};
        const candidate = result.response.candidates?.[0];

        if (!candidate) {
            const blockReason = result.response.promptFeedback?.blockReason;
            modelSafetyRatings = result.response.promptFeedback?.safetyRatings;
            let sf = modelSafetyRatings
                ? ` SafetyRatings: ${JSON.stringify(modelSafetyRatings)}`
                : "";
            if (blockReason)
                throw new Error(
                    `PostGeminiScorer: API call blocked. Reason: ${blockReason}.${sf}`
                );
            throw new Error(
                `PostGeminiScorer: API call returned no candidates.${sf}`
            );
        }

        modelFinishReason = candidate.finishReason;
        modelSafetyRatings = candidate.safetyRatings;

        if (candidate.content?.parts?.[0]?.text)
            rawResponseText = candidate.content.parts[0].text;
        else
            console.warn(
                `PostGeminiScorer: Candidate had no text content. Finish Reason: ${
                    modelFinishReason || "Unknown"
                }.`
            );

        if (modelFinishReason && modelFinishReason !== "STOP")
            console.warn(
                `PostGeminiScorer: Gemini API call finished with non-STOP reason: ${modelFinishReason}.`
            );

        console.log(
            "PostGeminiScorer: TOKENS (Gemini) – Prompt: %s, Candidates: %s, Total: %s",
            usageMetadata.promptTokenCount || "?",
            usageMetadata.candidatesTokenCount || "?",
            usageMetadata.totalTokenCount || "?"
        );

        if (rawResponseText.trim() === "")
            throw new Error(
                `PostGeminiScorer: Gemini response text is empty. Finish Reason: ${
                    modelFinishReason || "Unknown"
                }.`
            );

        const cleanedJsonString = rawResponseText
            .replace(/^```(?:json)?\s*/i, "")
            .replace(/\s*```$/, "");
        const parsedJsonObject = JSON.parse(cleanedJsonString);

        // **MODIFIED LOGIC**: Check if the response is an array, as requested in the new prompt.
        if (Array.isArray(parsedJsonObject)) {
            return parsedJsonObje