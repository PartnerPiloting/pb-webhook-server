/**
 * AI analysis of Krisp transcripts:
 * - Detect back-to-back calls (single recording spanning multiple meetings)
 * - Identify speaker roles / real names from context clues
 * - Return structured JSON for the review queue
 *
 * Uses Vertex AI (Gemini) with the same pattern as smartFollowUpService.js.
 */

const { vertexAIClient } = require('../config/geminiClient');
const { HarmCategory, HarmBlockThreshold } = require('@google-cloud/vertexai');
const { createSafeLogger } = require('../utils/loggerHelper');

const AI_TIMEOUT_MS = parseInt(process.env.KRISP_AI_TIMEOUT_MS || '30000', 10);
const MODEL_ID = process.env.KRISP_AI_MODEL_ID || process.env.GEMINI_MODEL_ID || 'gemini-2.5-flash';

const SAFETY_SETTINGS = [
  { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
];

/**
 * Analyze a Krisp transcript for split detection and speaker identification.
 * @param {string} transcriptText - full transcript text
 * @param {{ meetingTitle?: string, durationSeconds?: number, calendarEvents?: object[] }} context
 * @returns {Promise<{ needsSplit: boolean, splitReason?: string, suggestedSplitLine?: number, speakerGuesses: Record<string, { likelyName: string, role?: string, confidence: string }>, error?: string }>}
 */
async function analyzeTranscript(transcriptText, context = {}) {
  const log = createSafeLogger('SYSTEM', null, 'krisp_transcript_ai');

  const fallback = {
    needsSplit: false,
    speakerGuesses: {},
    error: null,
  };

  if (!vertexAIClient) {
    log.warn('Vertex AI client not available — skipping transcript analysis');
    return { ...fallback, error: 'ai_not_configured' };
  }

  if (!transcriptText || transcriptText.trim().length < 50) {
    return { ...fallback, error: 'transcript_too_short' };
  }

  const truncated = transcriptText.length > 12000
    ? transcriptText.slice(0, 12000) + '\n\n[... transcript truncated for analysis ...]'
    : transcriptText;

  const calendarContext = (context.calendarEvents || [])
    .map(e => `- "${e.summary}" (${e.start} to ${e.end})`)
    .join('\n');

  const prompt = `You are analyzing a Krisp call transcript to help a coaching business manage their call recordings.

MEETING INFO:
- Title: ${context.meetingTitle || 'Unknown'}
- Duration: ${context.durationSeconds ? Math.round(context.durationSeconds / 60) + ' minutes' : 'Unknown'}
${calendarContext ? `\nCALENDAR EVENTS THAT OVERLAPPED THIS RECORDING:\n${calendarContext}` : ''}

TRANSCRIPT:
${truncated}

Analyze this transcript and return a JSON object with exactly these fields:

{
  "needs_split": boolean,
  "split_reason": "string or null — why you think this needs splitting",
  "suggested_split_line": number or null — approximate line number where the second conversation starts (1-based),
  "speakers": {
    "Speaker 1": { "likely_name": "string", "role": "coach|client|unknown", "confidence": "high|medium|low" },
    "Speaker 2": { "likely_name": "string", "role": "coach|client|unknown", "confidence": "high|medium|low" }
  }
}

SPLIT DETECTION RULES:
- needs_split = true if the transcript contains TWO OR MORE distinct conversations (e.g. greetings happen twice, different people join, topic changes completely mid-transcript, explicit goodbyes followed by a new conversation)
- Look for patterns like: farewell/goodbye followed by new greetings, "joining" language mid-transcript, completely unrelated topics in different sections
- A single conversation that covers multiple topics is NOT a split — only flag genuinely separate meetings

SPEAKER IDENTIFICATION RULES:
- Use context clues from the transcript (names mentioned, introductions, topics, who asks questions vs. provides coaching)
- The coach typically asks questions, provides advice, references frameworks, or guides the conversation
- The client typically describes their situation, asks for help, or responds to coaching
- Use "likely_name" if you can infer their name from context (e.g. "Thanks, Sarah" or "Hi John")
- Set confidence to "high" only if a name is explicitly stated in the transcript

Return ONLY the JSON object, no markdown fences or explanation.`;

  try {
    const model = vertexAIClient.getGenerativeModel({
      model: MODEL_ID,
      safetySettings: SAFETY_SETTINGS,
      generationConfig: {
        temperature: 0.2,
        responseMimeType: 'application/json',
        maxOutputTokens: 2048,
      },
    });

    const callPromise = model.generateContent({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
    });
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Krisp AI analysis timed out')), AI_TIMEOUT_MS);
    });

    const result = await Promise.race([callPromise, timeoutPromise]);
    const raw = result.response?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!raw) {
      log.warn('Krisp AI returned empty response');
      return { ...fallback, error: 'empty_ai_response' };
    }

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      const cleaned = raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
      try {
        parsed = JSON.parse(cleaned);
      } catch (e2) {
        log.warn(`Krisp AI parse failed: ${e2.message}`);
        return { ...fallback, error: 'parse_failed' };
      }
    }

    const speakerGuesses = {};
    if (parsed.speakers && typeof parsed.speakers === 'object') {
      for (const [label, info] of Object.entries(parsed.speakers)) {
        if (info && typeof info === 'object') {
          speakerGuesses[label] = {
            likelyName: info.likely_name || info.likelyName || '',
            role: info.role || 'unknown',
            confidence: info.confidence || 'low',
          };
        }
      }
    }

    return {
      needsSplit: !!parsed.needs_split,
      splitReason: parsed.split_reason || null,
      suggestedSplitLine: typeof parsed.suggested_split_line === 'number' ? parsed.suggested_split_line : null,
      speakerGuesses,
      error: null,
    };
  } catch (err) {
    log.error(`Krisp AI analysis failed: ${err.message}`);
    return { ...fallback, error: err.message };
  }
}

module.exports = { analyzeTranscript };
