// config/scoringProvider.js
// Which model scores leads - the one switch for batchScorer.js and singleScorer.js.
//
// Env (all read per call, so a flip is an env edit + redeploy, same as the Gemini 3.5 migration):
//   SCORING_PROVIDER          "gemini" (default) or "claude". Anything else is treated as gemini.
//   SCORING_CLAUDE_MODEL_ID   default claude-haiku-5-5. Must be served by api.anthropic.com - the
//                             Max-plan API credit does NOT cover Vertex/Bedrock, so this never
//                             routes through Google.
//   SCORING_CLAUDE_SCALE      default 1.5. Multiplier applied to every positive attribute's points
//                             on the Claude path only (see scaleClaudePositiveScores).
//   SCORING_CLAUDE_OFFSET     default 0. Additive term applied after the multiplier, in points.
//   SCORING_CLAUDE_MAX_TOKENS default 32000. Output cap per chunk call (10 leads ~ 9k tokens).
//   SCORING_CLAUDE_EFFORT     default "low". Haiku 5.5 effort level; medium was measured worse
//                             AND dearer on 21 Oct 2026, so leave it.
//
// Why the scale exists (measured 21 Oct 2026, 120 leads x 3 clients, memory note
// project_haiku_scoring_drift_test): Haiku 5.5 ranks leads as well as Gemini 3.5 Flash (Spearman
// 0.82-0.88) but awards roughly two-thirds of Gemini's points on EVERY positive attribute - it reads
// each attribute's score band from the bottom, Gemini from the top. Two rounds of prompt tuning did
// not move it. So the prompt is left alone and the points are rescaled per attribute, capped at
// that attribute's maxPoints. Scaling at attribute level (not the final percentage) keeps the AI
// Attribute Breakdown arithmetic equal to the displayed AI Score. Negative scores are penalties
// the model applies on evidence, and the diagnosis showed no drift there, so they are untouched.
//
// Nothing else uses Gemini through here: Reconnect triage, summaries and the Start Here help all
// keep their own clients. Scoring only.

require('dotenv').config();
const { getAnthropicClient } = require('./anthropicClient');
const { isRetryableRateLimitError } = require('./geminiClient');

const DEFAULT_CLAUDE_MODEL_ID = 'claude-haiku-5-5';
const DEFAULT_CLAUDE_SCALE = 1.5;
const DEFAULT_CLAUDE_MAX_TOKENS = 32000;
const JSON_ONLY_SUFFIX = '\n\nRespond with only the JSON array - no prose, no code fence.';

function scoringProvider() {
    return String(process.env.SCORING_PROVIDER || 'gemini').trim().toLowerCase() === 'claude' ? 'claude' : 'gemini';
}

function isClaudeScoring() {
    return scoringProvider() === 'claude';
}

function claudeScoringModelId() {
    return String(process.env.SCORING_CLAUDE_MODEL_ID || DEFAULT_CLAUDE_MODEL_ID).trim();
}

function numberEnv(name, fallback) {
    const raw = process.env[name];
    if (raw === undefined || raw === null || String(raw).trim() === '') return fallback;
    const n = Number(raw);
    return Number.isFinite(n) ? n : fallback;
}

function claudeScale() {
    const s = numberEnv('SCORING_CLAUDE_SCALE', DEFAULT_CLAUDE_SCALE);
    return s > 0 ? s : DEFAULT_CLAUDE_SCALE;
}

function claudeOffset() {
    return numberEnv('SCORING_CLAUDE_OFFSET', 0);
}

function claudeMaxTokens() {
    const n = parseInt(process.env.SCORING_CLAUDE_MAX_TOKENS || '', 10);
    return Number.isFinite(n) && n >= 4096 ? n : DEFAULT_CLAUDE_MAX_TOKENS;
}

function claudeEffort() {
    const e = String(process.env.SCORING_CLAUDE_EFFORT || 'low').trim().toLowerCase();
    return ['low', 'medium', 'high'].includes(e) ? e : 'low';
}

/** Human label for log lines: "Gemini" or "Claude". */
function scoringProviderLabel() {
    return isClaudeScoring() ? 'Claude' : 'Gemini';
}

/** What is in force right now - for logs, the debug endpoint and the PR/verification notes. */
function describeScoringProvider(geminiModelId) {
    if (isClaudeScoring()) {
        return { provider: 'claude', modelId: claudeScoringModelId(), scale: claudeScale(), offset: claudeOffset(), effort: claudeEffort(), maxTokens: claudeMaxTokens() };
    }
    return { provider: 'gemini', modelId: geminiModelId || process.env.GEMINI_MODEL_ID || null };
}

/**
 * Transient Claude failures worth retrying, mirroring isRetryableRateLimitError for Gemini:
 * rate limit (429), overloaded (529), server errors, request timeouts, plus the network blips the
 * Gemini matcher already recognises by message. The SDK itself retries 4 times first; this is the
 * outer loop the scorers run with the 5s/10s backoff, so a longer wobble is survived the same way.
 */
function isRetryableClaudeError(error) {
    if (!error) return false;
    const status = Number(error.status || error.statusCode || (error.response && error.response.status)) || 0;
    if (status === 408 || status === 409 || status === 429 || status === 529 || (status >= 500 && status < 600)) return true;
    const type = String(error.type || (error.error && error.error.type) || '').toLowerCase();
    if (type === 'overloaded_error' || type === 'rate_limit_error' || type === 'api_error') return true;
    if (status === 400 || status === 401 || status === 403 || status === 404) return false;
    return isRetryableRateLimitError(error);
}

/** Text of a Claude message: every text block joined, in order. */
function claudeMessageText(msg) {
    if (!msg || !Array.isArray(msg.content)) return '';
    return msg.content.filter(b => b && b.type === 'text' && typeof b.text === 'string').map(b => b.text).join('');
}

/** Map Claude's stop_reason onto the Gemini finishReason vocabulary the scorers already log and branch on. */
function finishReasonFromStop(stopReason) {
    if (!stopReason) return null;
    if (stopReason === 'end_turn' || stopReason === 'stop_sequence') return 'STOP';
    if (stopReason === 'max_tokens') return 'MAX_TOKENS';
    return String(stopReason).toUpperCase();
}

/**
 * One scoring call to Claude. Same system prompt and user prompt the Gemini path builds; the only
 * addition is a one-line "JSON array only" instruction, because Claude has no responseMimeType.
 * Returns the Gemini-shaped bundle the scorers already consume, so the parsing path is unchanged:
 *   { rawResponseText, usageMetadata: { promptTokenCount, candidatesTokenCount, totalTokenCount, provider, modelId }, finishReason }
 * No temperature is set - Haiku 5.5 rejects it. Streaming is used so a long chunk never trips the
 * SDK's non-streaming time limit; the caller's own timeout aborts the stream.
 */
async function callClaudeForScoring({ systemPrompt, userPrompt, timeoutMs, client = null } = {}) {
    const llm = client || getAnthropicClient();
    const params = {
        model: claudeScoringModelId(),
        max_tokens: claudeMaxTokens(),
        system: systemPrompt,
        output_config: { effort: claudeEffort() },
        messages: [{ role: 'user', content: String(userPrompt) + JSON_ONLY_SUFFIX }],
    };
    const stream = llm.messages.stream(params);
    let timerId;
    let msg;
    try {
        if (timeoutMs && timeoutMs > 0) {
            const timer = new Promise((_, rej) => {
                timerId = setTimeout(() => {
                    try { stream.abort(); } catch (_) { /* already finished */ }
                    rej(new Error(`Claude API call timeout after ${timeoutMs}ms (scoring)`));
                }, timeoutMs);
            });
            msg = await Promise.race([stream.finalMessage(), timer]);
        } else {
            msg = await stream.finalMessage();
        }
    } finally {
        clearTimeout(timerId);
    }
    const usage = (msg && msg.usage) || {};
    const promptTokenCount = Number(usage.input_tokens) || 0;
    const candidatesTokenCount = Number(usage.output_tokens) || 0;
    return {
        rawResponseText: claudeMessageText(msg),
        usageMetadata: {
            promptTokenCount,
            candidatesTokenCount,
            totalTokenCount: promptTokenCount + candidatesTokenCount,
            provider: 'claude',
            modelId: params.model,
        },
        finishReason: finishReasonFromStop(msg && msg.stop_reason),
    };
}

/**
 * Put Claude's positive attribute points onto the Gemini scale: each value x becomes
 * round(x * scale + offset), floored at 0 and capped at that attribute's maxPoints. Attributes the
 * model left out or set non-numeric are returned as they were. Pure - returns a new object.
 * `positivesDict` is the client's loaded positives ({ A: { maxPoints: 20, ... }, ... }).
 */
function scaleClaudePositiveScores(positive_scores, positivesDict, { scale = claudeScale(), offset = claudeOffset() } = {}) {
    const out = {};
    const src = positive_scores && typeof positive_scores === 'object' ? positive_scores : {};
    for (const [id, value] of Object.entries(src)) {
        const n = Number(value);
        if (value === null || value === undefined || value === '' || !Number.isFinite(n)) { out[id] = value; continue; }
        let scaled = Math.round(n * scale + offset);
        const def = positivesDict && positivesDict[id];
        const maxRaw = def ? (def.maxPoints ?? def.max_points ?? def.max) : undefined;
        const max = maxRaw === undefined || maxRaw === null ? null : parseInt(String(maxRaw), 10);
        if (Number.isFinite(max)) scaled = Math.min(scaled, max);
        out[id] = Math.max(0, scaled);
    }
    return out;
}

module.exports = {
    scoringProvider,
    isClaudeScoring,
    scoringProviderLabel,
    describeScoringProvider,
    claudeScoringModelId,
    claudeScale,
    claudeOffset,
    claudeMaxTokens,
    claudeEffort,
    isRetryableClaudeError,
    callClaudeForScoring,
    claudeMessageText,
    finishReasonFromStop,
    scaleClaudePositiveScores,
    DEFAULT_CLAUDE_MODEL_ID,
    DEFAULT_CLAUDE_SCALE,
    JSON_ONLY_SUFFIX,
};
