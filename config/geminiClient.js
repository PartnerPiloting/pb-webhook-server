// config/geminiClient.js
// One place that builds the Vertex AI (Gemini) client for the whole server.
//
// Env:
//   GCP_PROJECT_ID       required
//   GCP_LOCATION         required. A region ("us-central1") or "global". Gemini 3.x models are
//                        NOT served from us-central1 for this project (404) - they need "global".
//   GEMINI_MODEL_ID      default model for scoring and every service that does not set its own.
//   GEMINI_API_ENDPOINT  optional host override; normally derived from GCP_LOCATION.
//   GOOGLE_APPLICATION_CREDENTIALS  path to the service-account key (Render secret file).
//
// The @google-cloud/vertexai SDK builds the host as `${location}-aiplatform.googleapis.com`,
// which is wrong for "global" (that host returns HTML). Proven 11 Oct 2026 on prod: passing
// apiEndpoint "aiplatform.googleapis.com" with location "global" reaches gemini-2.5-flash and
// every gemini-3.x model, so no SDK swap is needed for the Gemini 2.5 retirement.

require('dotenv').config();

const { VertexAI } = require('@google-cloud/vertexai');
const { createLogger } = require('../utils/contextLogger');

const logger = createLogger({
    runId: 'SYSTEM',
    clientId: 'SYSTEM',
    operation: 'gemini-config'
});

// Code-level fallback only. Prod sets GEMINI_MODEL_ID explicitly (Render "AI Service Configuration").
const DEFAULT_GEMINI_MODEL_ID = 'gemini-2.5-flash';

const MODEL_ID_FROM_ENV = process.env.GEMINI_MODEL_ID || DEFAULT_GEMINI_MODEL_ID;
const GCP_PROJECT_ID = process.env.GCP_PROJECT_ID;
const GCP_LOCATION = process.env.GCP_LOCATION;

function resolveApiEndpoint(location) {
    if (process.env.GEMINI_API_ENDPOINT) return process.env.GEMINI_API_ENDPOINT;
    if (location === 'global') return 'aiplatform.googleapis.com';
    return undefined; // SDK default: `${location}-aiplatform.googleapis.com`
}

// Text of one candidate: every text part joined, thought parts skipped. Gemini 3 attaches a
// thoughtSignature to parts and may return more than one part, so never read parts[0] alone.
function geminiCandidateText(candidate) {
    const parts = candidate && candidate.content && candidate.content.parts;
    if (!Array.isArray(parts)) return '';
    return parts
        .filter(p => p && !p.thought && typeof p.text === 'string')
        .map(p => p.text)
        .join('');
}

// Model JSON output, made parseable: strips a ```json fence and escapes raw control characters
// (newline, tab, ...) that appear INSIDE string literals. Gemini 3.5 Flash was seen emitting a raw
// newline inside a string ("Bad control character in string literal", 11 Oct 2026 drift test),
// which fails JSON.parse and costs the whole batch. Outside strings, whitespace is left alone.
function geminiJsonText(raw) {
    let s = String(raw == null ? '' : raw).trim();
    s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    let out = '', inString = false, escaped = false;
    for (const ch of s) {
        if (inString) {
            if (escaped) { escaped = false; out += ch; continue; }
            if (ch === '\\') { escaped = true; out += ch; continue; }
            if (ch === '"') { inString = false; out += ch; continue; }
            const code = ch.charCodeAt(0);
            if (code < 0x20) {
                out += ch === '\n' ? '\\n' : ch === '\r' ? '\\r' : ch === '\t' ? '\\t' : '\\u' + code.toString(16).padStart(4, '0');
                continue;
            }
            out += ch; continue;
        }
        if (ch === '"') inString = true;
        out += ch;
    }
    return out;
}

function geminiResponseText(response) {
    const candidate = response && Array.isArray(response.candidates) ? response.candidates[0] : null;
    return geminiCandidateText(candidate);
}

/**
 * Returns true if the Vertex/Gemini error looks transient and worth retrying.
 * Covers both rate-limit (429 / resource exhausted) AND common transient network /
 * server-side hiccups that Vertex wraps in generic messages (e.g. the SDK's
 * "exception posting request to model", 5xx, socket resets, DNS blips, timeouts).
 * Shared by batchScorer and singleScorer. Keeping this broad means a brief Google/Vertex/network blip retries silently
 * instead of instantly failing a whole chunk of leads and emailing an alert.
 */
function isRetryableRateLimitError(error) {
    const msg = String(error?.message || error || '').toLowerCase();
    const code = String(error?.code || '').toLowerCase();
    return (
        msg.includes('429') ||
        msg.includes('resource exhausted') ||
        msg.includes('resource_exhausted') ||
        msg.includes('too many requests') ||
        msg.includes('rate limit') ||
        msg.includes('exception posting request') ||
        msg.includes('unavailable') ||
        msg.includes('deadline') ||
        msg.includes('internal error') ||
        msg.includes('socket hang up') ||
        msg.includes('econnreset') ||
        msg.includes('etimedout') ||
        msg.includes('enotfound') ||
        msg.includes('eai_again') ||
        msg.includes('fetch failed') ||
        msg.includes('network error') ||
        msg.includes('timeout') ||
        /\b5\d\d\b/.test(msg) ||
        code === 'econnreset' ||
        code === 'etimedout' ||
        code === 'enotfound' ||
        code === 'eai_again'
    );
}

const API_ENDPOINT = resolveApiEndpoint(GCP_LOCATION);

let initializedVertexAIClient = null;
let defaultGeminiModelInstance = null;

try {
    if (!GCP_PROJECT_ID || !GCP_LOCATION) {
        throw new Error("Gemini Client Config: GCP_PROJECT_ID and GCP_LOCATION environment variables are required.");
    }

    // GOOGLE_APPLICATION_CREDENTIALS is picked up automatically by the SDK's auth.
    initializedVertexAIClient = new VertexAI({
        project: GCP_PROJECT_ID,
        location: GCP_LOCATION,
        ...(API_ENDPOINT ? { apiEndpoint: API_ENDPOINT } : {})
    });

    defaultGeminiModelInstance = initializedVertexAIClient.getGenerativeModel({ model: MODEL_ID_FROM_ENV });

    logger.info(`Gemini Client Initialized. Model: ${MODEL_ID_FROM_ENV}, location: ${GCP_LOCATION}, endpoint: ${API_ENDPOINT || `${GCP_LOCATION}-aiplatform.googleapis.com`}`);

} catch (error) {
    logger.error("CRITICAL ERROR: Failed to initialize Gemini Client in config/geminiClient.js:", { error: error.message, stack: error.stack });
}

module.exports = {
    vertexAIClient: initializedVertexAIClient,
    geminiModel: defaultGeminiModelInstance,
    geminiModelId: MODEL_ID_FROM_ENV,
    geminiLocation: GCP_LOCATION,
    geminiApiEndpoint: API_ENDPOINT || null,
    DEFAULT_GEMINI_MODEL_ID,
    geminiCandidateText,
    geminiResponseText,
    geminiJsonText,
    isRetryableRateLimitError
};
