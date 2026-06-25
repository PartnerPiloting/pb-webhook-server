// routes/wingguyRoutes.js
// Wingguy — Slice 1 backend: personalised "thanks for connecting" drafting (single-tenant Guy).
//
// ONE backend endpoint, ONE AI call, NO tools (that's why it's the first slice — it proves the
// end-to-end plumbing: fork extension → read profile → pick campaign template → backend draft →
// formatting-preserving insert → human sends). Sits behind the EXISTING auth middleware
// (`authenticateUserWithTestMode` → req.client) and is additionally OWNER-GATED to Guy-Wilson,
// because Slice 1 is just Guy. Multi-tenant is Slice 5.
//
// Model = Sonnet by default (WINGGUY_DRAFT_MODEL_ID, default claude-sonnet-4-6) — deliberately NOT
// the repo-wide Opus default (CLAUDE_MODEL_ID=claude-opus-4-8). Cost lever per the cost/quality model.
// The stable voice/rules system block is prompt-CACHED (cache_control: ephemeral) so repeated drafts
// only pay for the small per-profile delta.
//
// Templates are SEEDED DIRECTLY (config/wingguyTemplates.js) — no Postgres store yet.
//
// Endpoints (mounted at /api/wingguy):
//   GET  /status      public-ish; { ok, enabled }
//   GET  /templates   the quick-pick button set [{ id, label, useWhen }]
//   POST /draft-thanks  { templateId, profile } -> { ok, draft, model }

const express = require('express');
const { createLogger } = require('../utils/contextLogger');
const { authenticateUserWithTestMode } = require('../middleware/authMiddleware');
const { getAnthropicClient, isAnthropicConfigured } = require('../config/anthropicClient');
const { WINGGUY_VOICE, WINGGUY_REPLY_INSTRUCTIONS, listTemplates, getTemplate } = require('../config/wingguyTemplates');

const logger = createLogger({ runId: 'SYSTEM', clientId: 'SYSTEM', operation: 'wingguy' });

// Sonnet-default; env-switchable without touching the repo-wide Opus default.
const WINGGUY_DRAFT_MODEL_ID = process.env.WINGGUY_DRAFT_MODEL_ID || 'claude-sonnet-4-6';
const DRAFT_MAX_TOKENS = 700;             // a thanks-for-connecting note is short
const PROFILE_CHAR_CAP = 6000;            // bound the input (About can be long); keeps cost + latency sane
const OWNER_CLIENT_ID = 'Guy-Wilson';     // Slice 1 = single-tenant Guy

function parseBoolFlag(val, defaultValue = false) {
  if (val === undefined || val === null || val === '') return defaultValue;
  const s = String(val).toLowerCase().trim();
  return s === '1' || s === 'true' || s === 'yes' || s === 'on';
}

// Process-level kill-switch. Owner-gating is the real control for Slice 1, so this defaults ON
// (Guy needs it live to prove it on his real LinkedIn) and only force-disables if ever needed.
const ENABLED = parseBoolFlag(process.env.WINGGUY_DRAFT_ENABLED, true);

function requireOwner(req, res, next) {
  const cid = req.client && String(req.client.clientId);
  if (cid !== OWNER_CLIENT_ID) {
    return res.status(403).json({
      ok: false,
      error: 'Wingguy is currently owner-only (single-tenant Slice 1).',
    });
  }
  next();
}

// Build the compact, GROUNDED profile block the model drafts from. We pass through only what the
// extension scraped — and label each part — so the "ground the facts" rule has clean material and
// the model can't confuse a missing field for an empty one.
function buildProfileBlock(profile = {}) {
  const lines = [];
  const add = (label, val) => {
    const v = (val == null ? '' : String(val)).trim();
    if (v) lines.push(`${label}: ${v}`);
  };
  add('Name', profile.name);
  add('Headline', profile.headline);
  add('Location', profile.location);
  add('Current role/company', profile.currentRole);
  add('LinkedIn URL', profile.profileUrl);
  if (profile.about) {
    add('About (their own words)', String(profile.about).slice(0, PROFILE_CHAR_CAP));
  }
  if (Array.isArray(profile.recentPosts) && profile.recentPosts.length) {
    lines.push('Recent posts / featured (passion signal — prefer for the hook):');
    profile.recentPosts.slice(0, 5).forEach((p) => {
      const t = String(p || '').trim();
      if (t) lines.push(`  - ${t.slice(0, 400)}`);
    });
  }
  if (profile.connectionMessage) {
    add('Their connection-request note', profile.connectionMessage);
  }
  return lines.join('\n');
}

const CONVO_MAX_MESSAGES = 60;   // most recent N messages (bounds tokens on long threads)
const CONVO_CHAR_CAP = 8000;

// Format the scraped thread as "Sender: text" lines, oldest→newest, labelling who the prospect is
// so the model knows which side is Guy. Accepts an array of { sender, text }.
function buildConversationBlock(conversation = [], prospectName = '') {
  if (!Array.isArray(conversation)) return '';
  const msgs = conversation
    .map((m) => ({ sender: String((m && m.sender) || '').trim(), text: String((m && m.text) || '').trim() }))
    .filter((m) => m.text);
  if (!msgs.length) return '';
  const recent = msgs.slice(-CONVO_MAX_MESSAGES);
  const body = recent.map((m) => `${m.sender || 'Unknown'}: ${m.text}`).join('\n').slice(-CONVO_CHAR_CAP);
  const who = prospectName ? `\n(The other person is ${prospectName}; the other sender is Guy — draft Guy's next message.)` : '';
  return `${body}${who}`;
}

module.exports = function mountWingguy(app) {
  const router = express.Router();
  logger.info(`[Wingguy] Mounted. ENABLED=${ENABLED}, model=${WINGGUY_DRAFT_MODEL_ID}`);

  // Lightweight status (no auth) so the extension can show a clear "off" state.
  router.get('/status', (req, res) => {
    res.json({ ok: true, enabled: ENABLED, aiConfigured: isAnthropicConfigured() });
  });

  // Everything below requires an authenticated client...
  router.use(authenticateUserWithTestMode);
  // ...and, for Slice 1, that client must be the owner.
  router.use(requireOwner);

  // The quick-pick button set for the panel.
  router.get('/templates', (req, res) => {
    res.json({ ok: true, templates: listTemplates() });
  });

  // Draft a personalised thanks-for-connecting message.
  router.post('/draft-thanks', async (req, res) => {
    if (!ENABLED) {
      return res.status(503).json({ ok: false, error: 'Wingguy drafting is disabled.' });
    }
    if (!isAnthropicConfigured()) {
      return res.status(500).json({ ok: false, error: 'Claude (ANTHROPIC_API_KEY) is not configured.' });
    }

    const { templateId, profile } = req.body || {};
    const template = getTemplate(templateId);
    if (!template) {
      return res.status(400).json({
        ok: false,
        error: `Unknown templateId "${templateId}". Valid: ${listTemplates().map((t) => t.id).join(', ')}`,
      });
    }

    const profileBlock = buildProfileBlock(profile);
    if (!profileBlock) {
      return res.status(400).json({ ok: false, error: 'No profile data supplied to draft from.' });
    }

    try {
      const client = getAnthropicClient();

      // System = [ stable voice block (CACHED) , per-template instructions ]. Caching the big stable
      // prefix means repeat drafts (same session) mostly re-bill the small profile delta only.
      const response = await client.messages.create({
        model: WINGGUY_DRAFT_MODEL_ID,
        max_tokens: DRAFT_MAX_TOKENS,
        system: [
          { type: 'text', text: WINGGUY_VOICE, cache_control: { type: 'ephemeral' } },
          { type: 'text', text: template.instructions },
        ],
        messages: [
          {
            role: 'user',
            content:
              `Draft the message for this person. Ground every detail in what's below; ` +
              `if a hook isn't clearly here, stay warm and generic rather than inventing one.\n\n` +
              `PROFILE:\n${profileBlock}`,
          },
        ],
      });

      if (response.stop_reason === 'refusal') {
        return res.status(502).json({ ok: false, error: 'Claude declined the request.' });
      }

      const draft = (response.content || [])
        .filter((b) => b.type === 'text')
        .map((b) => b.text)
        .join('')
        .trim();

      if (!draft) {
        return res.status(502).json({ ok: false, error: 'Claude returned an empty draft.' });
      }

      logger.info(`[Wingguy] drafted thanks template=${template.id} for ${req.client.clientId} (${draft.length} chars)`);
      return res.json({ ok: true, draft, model: WINGGUY_DRAFT_MODEL_ID, templateId: template.id });
    } catch (e) {
      logger.error(`[Wingguy] draft-thanks failed: ${e.message}`);
      return res.status(500).json({ ok: false, error: e.message });
    }
  });

  // Draft the next message in an ONGOING conversation (Option A — the reply engine, single AI call,
  // NO tools). The extension decides thanks-vs-reply in code and routes follow-ons here.
  router.post('/draft-reply', async (req, res) => {
    if (!ENABLED) {
      return res.status(503).json({ ok: false, error: 'Wingguy drafting is disabled.' });
    }
    if (!isAnthropicConfigured()) {
      return res.status(500).json({ ok: false, error: 'Claude (ANTHROPIC_API_KEY) is not configured.' });
    }

    const { profile, conversation } = req.body || {};
    const profileBlock = buildProfileBlock(profile);
    const convoBlock = buildConversationBlock(conversation, profile && profile.name);
    if (!convoBlock) {
      return res.status(400).json({ ok: false, error: 'No conversation supplied to reply to.' });
    }

    try {
      const client = getAnthropicClient();
      const userContent =
        `${profileBlock ? `PROFILE:\n${profileBlock}\n\n` : ''}` +
        `CONVERSATION SO FAR (oldest first):\n${convoBlock}\n\n` +
        `Draft Guy's next message.`;

      const response = await client.messages.create({
        model: WINGGUY_DRAFT_MODEL_ID,
        max_tokens: DRAFT_MAX_TOKENS,
        system: [
          { type: 'text', text: WINGGUY_VOICE, cache_control: { type: 'ephemeral' } },
          { type: 'text', text: WINGGUY_REPLY_INSTRUCTIONS },
        ],
        messages: [{ role: 'user', content: userContent }],
      });

      if (response.stop_reason === 'refusal') {
        return res.status(502).json({ ok: false, error: 'Claude declined the request.' });
      }

      const draft = (response.content || [])
        .filter((b) => b.type === 'text')
        .map((b) => b.text)
        .join('')
        .trim();

      if (!draft) {
        return res.status(502).json({ ok: false, error: 'Claude returned an empty draft.' });
      }

      logger.info(`[Wingguy] drafted reply for ${req.client.clientId} (${draft.length} chars, ${(conversation || []).length} msgs in)`);
      return res.json({ ok: true, draft, model: WINGGUY_DRAFT_MODEL_ID, mode: 'reply' });
    } catch (e) {
      logger.error(`[Wingguy] draft-reply failed: ${e.message}`);
      return res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.use('/api/wingguy', router);
};
