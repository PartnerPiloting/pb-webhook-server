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
const { houseDashes, withHouseDashes } = require('../utils/houseDashes');

// Module-level logger for config initialization.
const logger = createLogger({
    runId: 'SYSTEM',
    clientId: 'SYSTEM',
    operation: 'anthropic-config',
});

// Clean, stable model IDs — no dated-preview-string pain (unlike Gemini). Env-switchable.
const CLAUDE_MODEL_ID = process.env.CLAUDE_MODEL_ID || 'claude-opus-4-8';

// --- Half an emoji must never leave here --------------------------------------------------------
// An emoji is TWO code units that only mean anything as a pair. Anything that shortens text by
// counting characters can cut between them — the extension caps a scraped LinkedIn post at 400
// characters and the page text at 6,000 — and a lone half is not valid text. Anthropic rejects the
// WHOLE request with `400 ... "no low surrogate in string"` before Claude reads a word of it, so the
// caller gets a bare status code and the panel can only say "couldn't reach Wingguy". Worse, it is
// not transient: the same thread fails identically on every retry (Roland Illyes' group thread,
// 2026-09-07 — three attempts, same character position each time).
//
// The extension no longer cuts emojis in half, but a stray half can still arrive from any scrape, or
// from older chat history being replayed turn after turn, so every outgoing call is swept here too.
// One guard on the shared client covers every route rather than each one having to remember.
//
// Complete pairs are matched FIRST and kept, so real emoji survive untouched; only an orphan is dropped.
function stripLoneSurrogates(text) {
    return text.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]|[\uD800-\uDFFF]/g, (m) => (m.length === 2 ? m : ''));
}

// Sweep every string in a request payload. Returns the SAME value when nothing needed changing
// (virtually every call), so the guard costs one scan and no allocation.
function withoutLoneSurrogates(value) {
    if (typeof value === 'string') {
        const cleaned = stripLoneSurrogates(value);
        return cleaned === value ? value : cleaned;
    }
    if (Array.isArray(value)) {
        let changed = false;
        const out = value.map((v) => { const c = withoutLoneSurrogates(v); if (c !== v) changed = true; return c; });
        return changed ? out : value;
    }
    if (value && typeof value === 'object') {
        let changed = false;
        const out = {};
        for (const [k, v] of Object.entries(value)) {
            const c = withoutLoneSurrogates(v);
            if (c !== v) changed = true;
            out[k] = c;
        }
        return changed ? out : value;
    }
    return value;
}

// --- No em dash ever leaves here ----------------------------------------------------------------
// The mirror image of the guard above, on the way BACK IN. Guy's house style is a spaced hyphen
// " - "; an em dash is the loudest AI tell in Australian business writing, and every reader he
// cares about reads one as "a machine wrote this".
//
// The rule has been written in prose everywhere prose can go - the rules store, the writing-style
// docs, the drafting prompts, CLAUDE.md - roughly ten times, and it kept losing to the model's
// generation default in real sends. Two services had already given up and grown their own private
// copy of the fix (wingguyMailMcp, wingguyFollowupsAsk), which is the tell that it belonged one
// level down: the /wg panel that writes LinkedIn messages had no copy, so Guy was still watching em
// dashes appear in drafts on his screen on 2026-09-16.
//
// So it moves to the client, next to the surrogate guard and for the same reason: hold the client,
// be covered. Every text block and every string inside a tool_use input is swept, which catches
// drafts (they arrive as propose_message/propose_times tool arguments, not as reply text) as well
// as anything Claude says to the coach.
//
// Requests are NOT swept - what a lead actually wrote stays verbatim, dashes and all.
// `stream` is NOT wrapped: its one caller is speaker reconstruction, which rebuilds a transcript of
// what people said. That is a record, not prose Wingguy is writing, and records are not restyled.
function houseDashesInResponse(msg) {
    if (!msg || !Array.isArray(msg.content)) return msg;
    let changed = false;
    const content = msg.content.map((block) => {
        if (!block || typeof block !== 'object') return block;
        if (block.type === 'text' && typeof block.text === 'string') {
            const cleaned = houseDashes(block.text);
            if (cleaned === block.text) return block;
            changed = true;
            return { ...block, text: cleaned };
        }
        // Drafts arrive HERE, as tool arguments - propose_message's `message`, propose_times'
        // `intro`/`outro`, wingguy_create_draft's `html_body`. Text blocks alone would miss them.
        if (block.type === 'tool_use' && block.input) {
            const cleaned = withHouseDashes(block.input);
            if (cleaned === block.input) return block;
            changed = true;
            return { ...block, input: cleaned };
        }
        return block;
    });
    return changed ? { ...msg, content } : msg;
}

// Patch a fresh SDK client so both message paths sweep their params on the way out, and `create`
// applies the house dash rule on the way back. Wrapping at construction means every caller —
// routes, chat agent, overnight jobs — is covered by holding the client, with nothing to remember
// at the call site.
function guardLoneSurrogates(client) {
    for (const method of ['create', 'stream']) {
        const original = client.messages[method].bind(client.messages);
        client.messages[method] = (params, ...rest) => original(withoutLoneSurrogates(params), ...rest);
    }
    const create = client.messages.create.bind(client.messages);
    client.messages.create = (params, ...rest) => {
        const out = create(params, ...rest);
        // stream:true returns a Stream, not a Promise of a Message - leave it alone.
        if (params && params.stream) return out;
        return Promise.resolve(out).then(houseDashesInResponse);
    };
    return client;
}

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
    anthropicClient = guardLoneSurrogates(new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 4 }));

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
    if (!c) { c = guardLoneSurrogates(new Anthropic({ apiKey: key, maxRetries: 4 })); byoClients.set(key, c); }
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
    stripLoneSurrogates,
    withoutLoneSurrogates,
    houseDashesInResponse,
    claudeModelId: CLAUDE_MODEL_ID,
};
