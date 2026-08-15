// config/anthropicClient.js
// Claude (Anthropic) configuration — drafting/reasoning lane of the swappable model seam.
// Plain API-key client (no GCP project/location/creds like Gemini): `new Anthropic()`
// reads ANTHROPIC_API_KEY from the env. Model is env-switchable (CLAUDE_MODEL_ID),
// defaulting to claude-opus-4-8 (the recommended reasoning model; Fable 5 is suspended).
//
// First concrete consumer: speaker reconstruction on the transcript paste path. The
// later post-call email drafting reuses this exact client. Gemini (scoring/summaries)
// and OpenAI (Start Here help-Q&A) are untouched — three providers, three jobs.

require('dotenv').config();
const Anthropic = require('@anthropic-ai/sdk');
const { createLogger } = require('../utils/contextLogger');

// Module-level logger for config initialization.
const logger = createLogger({
    runId: 'SYSTEM',
    clientId: 'SYSTEM',
    operation: 'anthropic-config',
});

// Clean, stable model IDs — no dated-preview-string pain (unlike Gemini). Env-switchable.
const CLAUDE_MODEL_ID = process.env.CLAUDE_MODEL_ID || 'claude-opus-4-8';

let anthropicClient = null;

/**
 * Initialize the Anthropic client (lazy, cached). Throws if ANTHROPIC_API_KEY is unset
 * so callers can surface a clear "Claude not configured" message rather than a cryptic
 * SDK error.
 */
function initializeAnthropic() {
    if (anthropicClient) return anthropicClient;

    if (!process.env.ANTHROPIC_API_KEY) {
        throw new Error('ANTHROPIC_API_KEY environment variable is not set');
    }

    // new Anthropic() picks up ANTHROPIC_API_KEY from the env automatically; we pass it
    // explicitly for clarity and to keep the failure mode above as the single gate.
    // maxRetries=4 (SDK default 2): the API auto-retries 429 / 5xx / 529 overloaded with
    // exponential backoff — a few extra attempts lets a transient Anthropic overload spike
    // self-heal before a client (e.g. the Wingguy chat panel) ever sees an error.
    anthropicClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 4 });

    logger.info(`Anthropic client initialized successfully. Default Model ID: ${CLAUDE_MODEL_ID}`);
    return anthropicClient;
}

/**
 * Get the Anthropic client instance, initializing on first use.
 */
function getAnthropicClient() {
    if (!anthropicClient) {
        return initializeAnthropic();
    }
    return anthropicClient;
}

// Per-request BYO client cache: a client's OWN Anthropic key → its SDK client. Lets the extension's
// drafting run on the CLIENT's key (sent per request in a header, never stored — Option A, decided
// 2026-07-13) while the chat connector and everything else fall back to the platform key. Cached by
// key string so we don't rebuild the SDK client every request.
const byoClients = new Map();

/**
 * Anthropic client for a specific API key (bring-your-own). An empty/absent key returns the platform
 * client (getAnthropicClient — the ANTHROPIC_API_KEY env, i.e. Guy's), so callers can pass a
 * per-request key unconditionally and get a safe fallback.
 */
function getAnthropicClientForKey(apiKey) {
    const key = String(apiKey || '').trim();
    if (!key) return getAnthropicClient();
    let c = byoClients.get(key);
    if (!c) { c = new Anthropic({ apiKey: key, maxRetries: 4 }); byoClients.set(key, c); }
    return c;
}

// --- ONE DOOR: which key does a given client's work run on? -------------------------------------
// BILLING RULE (Guy 2026-07-14 for the /wg drafting path; extended to the OVERNIGHT services
// 2026-08-15): we must NEVER silently run a client's work on the PLATFORM key (Guy's charge).
// Three lanes, in order:
//   their own stored key (Client Master "Anthropic API Key")      -> theirs
//   the owner, a managed-plan client, or the env override list    -> platform
//   anyone else                                                   -> BLOCKED, caller surfaces the message
//
// This lived only in routes/wingguyRoutes.js, so the nightly brief / dossier / backlog jobs kept
// their own naive `key || platform` fallback and quietly billed Guy for any client switched on
// before their key was set up. One rule in one place is the whole point — a second copy is how the
// two drifted apart in the first place. Env is read per call, so flipping a client onto a managed
// plan stays an Airtable/env edit with no redeploy.
const NO_ANTHROPIC_KEY_MSG = "Your Claude key isn't set up yet - message Guy.";

function platformKeyClientIds() {
    const owner = (process.env.RECALL_COACH_CLIENT_ID || 'Guy-Wilson').trim();
    return new Set(
        [owner, ...String(process.env.WINGGUY_PLATFORM_KEY_CLIENTS || '').split(',')]
            .map((s) => s.trim())
            .filter(Boolean),
    );
}

/**
 * Resolve the Anthropic client a coach's work should run on, applying the billing rule above.
 *
 * @param {Object} client  a clientService record (uses clientId, anthropicApiKey, managedClaudeKey)
 * @returns {{llm: Object|null, lane: string, message: string|null}}
 *   `llm === null` means BLOCKED: do not do the work, and surface `message` to the human.
 *   `lane` is one of client-stored-key | platform-fallback | none-blocked (log it — the existing
 *   `anthropic lane=` log lines and any greps over them keep working unchanged).
 */
function resolveClientAnthropic(client) {
    const cid = String((client && client.clientId) || '').trim();
    const storedKey = String((client && client.anthropicApiKey) || '').trim();
    if (storedKey) {
        return { llm: getAnthropicClientForKey(storedKey), lane: 'client-stored-key', message: null };
    }
    const managed = !!(client && client.managedClaudeKey);
    if (managed || (cid && platformKeyClientIds().has(cid))) {
        return { llm: getAnthropicClient(), lane: 'platform-fallback', message: null };
    }
    return { llm: null, lane: 'none-blocked', message: NO_ANTHROPIC_KEY_MSG };
}

/**
 * Whether Claude is configured (key present). Lets feature code degrade gracefully
 * — e.g. skip reconstruction with a clear warning instead of throwing — without a
 * try/catch around initialization.
 */
function isAnthropicConfigured() {
    return !!process.env.ANTHROPIC_API_KEY;
}

/**
 * Classify a Claude call failure caused by the KEY or ACCOUNT itself — the failure a client's OWN
 * (BYO / stored) key throws when they revoke it or hit the spend cap they set — as distinct from a
 * transient overload (retryable) or a genuine bug. This is what makes the stored-key safety promise
 * real: `getAnthropicClientForKey` never falls a live-but-rejected key through to the platform key
 * (only an ABSENT key falls back), so a rejected key must be SURFACED, not swallowed. Callers use
 * this to tell the client "fix your key" instead of showing a raw 401 or quietly failing.
 * Returns 'revoked' (invalid/revoked key — the kill switch), 'billing' (spend limit / no credit), or null.
 */
function anthropicKeyError(e) {
    if (!e) return null;
    const status = Number(e.status || e.statusCode || (e.response && e.response.status)) || 0;
    const type = String(e.type || (e.error && e.error.type) || '');
    const msg = String(e.message || (e.error && e.error.message) || '');
    if (status === 401 || status === 403 || type === 'authentication_error' || type === 'permission_error') return 'revoked';
    // Billing/credit/spend-cap: Anthropic surfaces these as a 400 with a telltale message (not a
    // plain rate-limit, which transientClaudeError already treats as retryable).
    if (/credit balance|billing|spend limit|quota exceeded|insufficient|payment/i.test(msg)) return 'billing';
    return null;
}

module.exports = {
    initializeAnthropic,
    getAnthropicClient,
    getAnthropicClientForKey,
    resolveClientAnthropic,
    NO_ANTHROPIC_KEY_MSG,
    isAnthropicConfigured,
    anthropicKeyError,
    claudeModelId: CLAUDE_MODEL_ID,
};
