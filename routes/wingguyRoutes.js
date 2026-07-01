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
const { WINGGUY_VOICE, WINGGUY_REPLY_INSTRUCTIONS, listTemplates, getTemplate, detectTemplate } = require('../config/wingguyTemplates');
const { getBookingPrefs } = require('../config/wingguyBookingPrefs');
const { createBookingEvent } = require('../services/wingguyCalendar');
const { runWingguyChatTurn } = require('../services/wingguyChat');
const clientService = require('../services/clientService');

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
  add('Job title', profile.jobTitle);
  add('Company', profile.companyName);
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
  // Raw page-text fallback: included when the structured About is thin, so the model still has real
  // content to hook on (robust to LinkedIn's class churn). Bounded; the prompt tells it to ignore boilerplate.
  if (!profile.about && profile.pageText) {
    lines.push('Raw profile page text (mine for the hook; ignore nav/buttons/"People also viewed"):');
    lines.push(String(profile.pageText).slice(0, PROFILE_CHAR_CAP));
  }

  // Private CRM context pulled from the Portal (Airtable) by enrichProfileFromPortal(). Fenced + clearly
  // labelled so the model uses it for angle/tone/timing but NEVER quotes or reveals it to the lead.
  const portal = [];
  const addPortal = (label, val) => {
    const v = (val == null ? '' : String(val)).trim();
    if (v) portal.push(`${label}: ${v}`);
  };
  if (profile.ceaseFup) {
    addPortal('⚠ DO-NOT-FOLLOW-UP flag is SET — do not draft a chase; only respond if the lead re-initiated', profile.ceaseFup);
  }
  addPortal('CRM status', profile.status);
  addPortal('Follow-up due', profile.followUpDate);
  addPortal('AI assessment of this lead', profile.aiProfileAssessment && String(profile.aiProfileAssessment).slice(0, PROFILE_CHAR_CAP));
  addPortal('Your private notes on them', profile.notes);
  addPortal('Your follow-up notes', profile.followUpNotes);
  if (portal.length) {
    lines.push('');
    lines.push('FROM YOUR PORTAL — private CRM context (informs the angle, tone and timing; NEVER quote, paraphrase, reveal or hint at any of it to the lead):');
    portal.forEach((p) => lines.push(`  - ${p}`));
  }

  return lines.join('\n');
}

// Defensive strip: occasionally the model appends a meta "Note: ..." or "*Note ...*" line explaining
// the draft (more likely when the profile was thin). Such commentary must never reach a paste-ready
// message. Remove a trailing block that is clearly meta — conservatively, only at the end.
function stripMetaCommentary(text) {
  const lines = String(text).split('\n');
  while (lines.length) {
    const last = lines[lines.length - 1].trim();
    if (last === '') { lines.pop(); continue; }
    if (/^[*_(\[]*\s*note\b/i.test(last) || /^\*.*\*$/.test(last)) { lines.pop(); continue; }
    break;
  }
  return lines.join('\n').trim();
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

// The approved enrichment set — map an Airtable Leads record's fields to the profile shape we draft from.
// (Deliberately curated, not the whole record: what helps the reply/rebook without bloating cost/latency.)
function portalFieldsFromRecord(f = {}) {
  return {
    name: [f['First Name'], f['Last Name']].filter(Boolean).join(' ').trim(),
    headline: f['Headline'],
    jobTitle: f['Job Title'],
    companyName: f['Company Name'] || f['Company'],
    location: f['Location'],
    about: f['About'],
    aiProfileAssessment: f['AI Profile Assessment'],
    notes: f['Notes'],
    followUpNotes: f['Follow Up Notes'],
    status: f['Status'],
    followUpDate: f['Follow-Up Date'],
    ceaseFup: f['Cease FUP'],
  };
}

// Best-effort: enrich the scraped profile with the lead's stored Portal (Airtable) record, keyed by the
// LinkedIn profile URL Wingguy already extracts (name as fallback). This is what lets a reply/rebook from
// the MESSAGES draw on real context — it fills the gaps the page didn't provide (About/headline aren't in
// the messaging DOM) and adds CRM-only signal the DOM never has (AI assessment, your notes, status,
// follow-up date, do-not-FUP flag). Same 'Leads' read the portal uses. NEVER throws into the request —
// on any miss/error it returns the original page profile so drafting still proceeds.
async function enrichProfileFromPortal(req, profile = {}) {
  try {
    if (!req.client || !req.client.airtableBaseId) return profile;
    const url = String(profile.profileUrl || '');
    const slugMatch = url.match(/linkedin\.com\/in\/([^/?#]+)/i);
    const name = String(profile.name || '').trim();
    if (!slugMatch && !name) return profile;

    const base = clientService.getClientBase(req.client.airtableBaseId);
    if (!base) return profile;

    let records = [];
    if (slugMatch) {
      const slug = slugMatch[1].toLowerCase();
      records = await base('Leads').select({
        filterByFormula: `SEARCH("${slug}", LOWER({LinkedIn Profile URL}))`,
        maxRecords: 3,
      }).firstPage();
    }
    if (!records.length && name) {
      const parts = name.split(/\s+/);
      const first = (parts[0] || '').toLowerCase();
      const last = (parts.length > 1 ? parts[parts.length - 1] : '').toLowerCase();
      const formula = last
        ? `AND(SEARCH("${first}", LOWER({First Name})), SEARCH("${last}", LOWER({Last Name})))`
        : `OR(SEARCH("${first}", LOWER({First Name})), SEARCH("${first}", LOWER({Last Name})))`;
      records = await base('Leads').select({ filterByFormula: formula, maxRecords: 3 }).firstPage();
    }
    if (!records.length) {
      logger.info(`[Wingguy] enrich: no Portal match for ${slugMatch ? slugMatch[1] : name}`);
      return profile;
    }

    // The live page wins where it has a value; the Portal fills gaps AND supplies the CRM-only fields
    // (which are never on the page, so the loop always attaches them).
    const portal = portalFieldsFromRecord(records[0].fields || {});
    const merged = { ...profile };
    for (const [k, v] of Object.entries(portal)) {
      const has = merged[k] != null && String(merged[k]).trim() !== '';
      if (!has && v != null && String(v).trim() !== '') merged[k] = v;
    }
    logger.info(`[Wingguy] enrich: merged Portal record ${records[0].id} (status=${portal.status || '—'}, ceaseFup=${portal.ceaseFup ? 'yes' : 'no'})`);
    return merged;
  } catch (e) {
    logger.error(`[Wingguy] enrich failed (continuing with page profile): ${e.message}`);
    return profile;
  }
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

  // Per-tenant booking preferences (the SEAM — Guy's defaults for now, Postgres later). The extension
  // reads these to pick which slots to offer; hard timezone/clash rules stay in the calendar code.
  router.get('/booking-prefs', (req, res) => {
    res.json({ ok: true, prefs: getBookingPrefs(req.client && req.client.clientId) });
  });

  // Draft a personalised thanks-for-connecting message.
  router.post('/draft-thanks', async (req, res) => {
    if (!ENABLED) {
      return res.status(503).json({ ok: false, error: 'Wingguy drafting is disabled.' });
    }
    if (!isAnthropicConfigured()) {
      return res.status(500).json({ ok: false, error: 'Claude (ANTHROPIC_API_KEY) is not configured.' });
    }

    const { templateId: requestedTemplateId, profile, conversation } = req.body || {};

    // Auto-detect when the extension sends "auto" (or nothing): pick the campaign template by matching
    // detection keywords against the connection-request note (first thread message) + profile. The
    // human can override by sending a specific id. Detection logic lives in the templates config.
    const autoDetected = !requestedTemplateId || requestedTemplateId === 'auto';
    const templateId = autoDetected ? detectTemplate(profile, conversation) : requestedTemplateId;
    const template = getTemplate(templateId);
    if (!template) {
      return res.status(400).json({
        ok: false,
        error: `Unknown templateId "${requestedTemplateId}". Valid: ${listTemplates().map((t) => t.id).join(', ')}, or "auto".`,
      });
    }

    const profileBlock = buildProfileBlock(profile);
    if (!profileBlock) {
      return res.status(400).json({ ok: false, error: 'No profile data supplied to draft from.' });
    }
    // Pass any open thread through too — templates that are follow-up replies (e.g. \frac) react to
    // their warm reply; templates that don't reference it (e.g. \tks) simply ignore it.
    const convoBlock = buildConversationBlock(conversation, profile && profile.name);

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
              `${convoBlock ? `CONVERSATION SO FAR (oldest first):\n${convoBlock}\n\n` : ''}` +
              `PROFILE:\n${profileBlock}`,
          },
        ],
      });

      if (response.stop_reason === 'refusal') {
        return res.status(502).json({ ok: false, error: 'Claude declined the request.' });
      }

      const draft = stripMetaCommentary(
        (response.content || [])
          .filter((b) => b.type === 'text')
          .map((b) => b.text)
          .join('')
          .trim()
      );

      if (!draft) {
        return res.status(502).json({ ok: false, error: 'Claude returned an empty draft.' });
      }

      logger.info(`[Wingguy] drafted thanks template=${template.id}${autoDetected ? ' (auto)' : ''} for ${req.client.clientId} (${draft.length} chars)`);
      return res.json({
        ok: true,
        draft,
        model: WINGGUY_DRAFT_MODEL_ID,
        templateId: template.id,
        templateLabel: template.label,
        autoDetected,
      });
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

      const draft = stripMetaCommentary(
        (response.content || [])
          .filter((b) => b.type === 'text')
          .map((b) => b.text)
          .join('')
          .trim()
      );

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

  // Create the calendar invite (the proven Nylas write path) when a lead has agreed a time. Human-
  // confirmed in the panel first (confirm-then-book). Builds a guest-first title + puts the coach's
  // Zoom on it, invites the lead (notify on). Airtable follow-up sync is a later add.
  router.post('/book', async (req, res) => {
    if (!ENABLED) return res.status(503).json({ ok: false, error: 'Wingguy is disabled.' });
    const { startISO, durationMins, leadEmail, leadName, leadLinkedIn, title, note } = req.body || {};
    try {
      // Full coach record (carries nylasGrantId + clientName) — req.client is the lighter auth object.
      const coach = await clientService.getClientById(req.client.clientId);
      if (!coach) return res.status(500).json({ ok: false, error: 'coach record not found' });

      const result = await createBookingEvent(coach, { startISO, durationMins, leadEmail, leadName, leadLinkedIn, title, note });
      if (!result.ok) return res.status(502).json({ ok: false, error: result.error });

      logger.info(`[Wingguy] booked event ${result.eventId} for ${coach.clientId} guest=${leadEmail} @ ${result.start}`);
      return res.json(result);
    } catch (e) {
      logger.error(`[Wingguy] book failed: ${e.message}`);
      return res.status(500).json({ ok: false, error: e.message });
    }
  });

  // The Slice 2 BIG half — the tool-using CHAT agent (2026-06-27). Guy chats with it in the panel;
  // it checks his real calendar and books, and keeps a current LinkedIn message draft. STATELESS:
  // the panel sends the running `messages` array each turn (including prior tool blocks) + the
  // on-screen `profile`/`conversation` + the lead's email (looked up by the panel). The agent loop
  // lives in services/wingguyChat.js so this route and the cloud test share ONE implementation.
  // Returns the updated `messages` (to resend next turn), the latest assistant `reply` (chat), the
  // `draft` (the LinkedIn message Guy edits/accepts and sends), and `booked` (set once an invite is made).
  router.post('/chat', async (req, res) => {
    if (!ENABLED) return res.status(503).json({ ok: false, error: 'Wingguy is disabled.' });
    if (!isAnthropicConfigured()) {
      return res.status(500).json({ ok: false, error: 'Claude (ANTHROPIC_API_KEY) is not configured.' });
    }

    const { profile = {}, conversation = [], messages = [], leadEmail } = req.body || {};
    if (!Array.isArray(messages) || !messages.length) {
      return res.status(400).json({ ok: false, error: 'messages[] required (the chat so far).' });
    }

    try {
      const coach = await clientService.getClientById(req.client.clientId);
      if (!coach) return res.status(500).json({ ok: false, error: 'coach record not found' });

      // Enrich the scraped profile with the lead's stored Portal record (About/headline the messaging DOM
      // lacks + CRM-only context: AI assessment, your notes, status, follow-up date, do-not-FUP flag).
      const enriched = await enrichProfileFromPortal(req, profile);

      // Detect the campaign template (\tks / \frac …) from the profile + thread and pass its real
      // voice-tuned structure to the agent, so opener / warm-reply drafts match Guy's templates.
      const campaignTemplate = getTemplate(detectTemplate(enriched, conversation));

      const result = await runWingguyChatTurn({
        coach,
        profile: enriched,
        conversation,
        messages,
        leadEmail,
        campaignTemplate,
        // Reuse the route's grounding-block formatting so the agent sees the same shape as the other endpoints.
        profileBlock: buildProfileBlock(enriched),
        convoBlock: buildConversationBlock(conversation, enriched && enriched.name),
      });
      if (!result.ok) return res.status(502).json({ ok: false, error: result.error });

      logger.info(`[Wingguy] chat turn for ${coach.clientId}: ${result.messages.length} msgs, draft=${result.draft ? 'yes' : 'no'}, booked=${result.booked ? result.booked.eventId : 'no'}`);
      return res.json(result);
    } catch (e) {
      logger.error(`[Wingguy] chat failed: ${e.message}`);
      return res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.use('/api/wingguy', router);
};
