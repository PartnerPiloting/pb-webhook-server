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
    anthropicClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

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

/**
 * Whether Claude is configured (key present). Lets feature code degrade gracefully
 * — e.g. skip reconstruction with a clear warning instead of throwing — without a
 * try/catch around initialization.
 */
function isAnthropicConfigured() {
    return !!process.env.ANTHROPIC_API_KEY;
}

module.exports = {
    initializeAnthropic,
    getAnthropicClient,
    isAnthropicConfigured,
    claudeModelId: CLAUDE_MODEL_ID,
};
