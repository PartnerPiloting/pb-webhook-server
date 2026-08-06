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
// Rules/templates come through the SOURCE SEAM (services/wingguyRulesSource.js, step 2):
// WINGGUY_RULES_SOURCE=config (default) keeps the hard-coded config/wingguyTemplates.js copy
// byte-identical to before; =store reads the Postgres rules store. While on config, every
// draft also shadow-renders the store and logs a WINGGUY-SHADOW line (the pre-flip week).
//
// Endpoints (mounted at /api/wingguy):
//   GET  /status      public-ish; { ok, enabled }
//   GET  /templates   the quick-pick button set [{ id, label, useWhen }]
//   POST /draft-thanks  { templateId, profile } -> { ok, draft, model }

const express = require('express');
const { createLogger } = require('../utils/contextLogger');
const { authenticateUserWithTestMode } = require('../middleware/authMiddleware');
const { getAnthropicClient, getAnthropicClientForKey, isAnthropicConfigured, anthropicKeyError } = require('../config/anthropicClient');
const rulesSource = require('../services/wingguyRulesSource');
const { getBookingPrefs } = require('../config/wingguyBookingPrefs');
const { createBookingEvent } = require('../services/wingguyCalendar');
const { runWingguyChatTurn } = require('../services/wingguyChat');
const wingguyLeads = require('../services/wingguyLeads');
const clientService = require('../services/clientService');
const { canonicalLinkedinSlug, slugPrefilterFormula, findExactSlugMatch } = require('../utils/linkedinCanonical');
const wingguyStore = require('../services/wingguyRulesStore');
const setupFields = require('../config/wingguySetupFields');

const logger = createLogger({ runId: 'SYSTEM', clientId: 'SYSTEM', operation: 'wingguy' });

// Sonnet-default; env-switchable without touching the repo-wide Opus default.
const WINGGUY_DRAFT_MODEL_ID = process.env.WINGGUY_DRAFT_MODEL_ID || 'claude-sonnet-4-6';
const DRAFT_MAX_TOKENS = 700;             // a thanks-for-connecting note is short
const PROFILE_CHAR_CAP = 6000;            // bound the input (About can be long); keeps cost + latency sane
// Multi-tenant gate: Wingguy is switched on PER-CLIENT via the "Wingguy Enabled" field on their
// Master Clients row (Yes/No; blank = off), read into req.client.wingguyEnabled. Still CLOSED by
// default — a client passes only when their record says Yes (403 otherwise). The OWNER is always
// allowed in code, so a field edit can never lock Guy out. (Replaced the WINGGUY_ENABLED_CLIENTS
// env allow-list 2026-07-14 — enablement now lives on the record beside Status / Managed Claude
// Key, so flipping a client on/off is an Airtable edit, no redeploy.)
const OWNER_CLIENT_ID = (process.env.RECALL_COACH_CLIENT_ID || 'Guy-Wilson').trim();

// --- BYO Anthropic key (billing) ---------------------------------------------------------------
// A client's own Claude key rides in this header (Option A, 2026-07-13): kept in their browser,
// sent per draft, never stored. BILLING RULE (Guy, 2026-07-14): we must NEVER silently draft a
// client on the PLATFORM key (Guy's charge). So: their own key → theirs; else the platform key
// ONLY for the owner or an explicit managed-plan client (WINGGUY_PLATFORM_KEY_CLIENTS, comma-sep);
// else BLOCK (they add their key, or go on a plan). Returns the client to draft with, or null =
// the caller must reject the request.
const NO_ANTHROPIC_KEY_MSG = "Your Claude key isn't set up yet - message Guy.";
const PLATFORM_KEY_CLIENTS = new Set(
  [OWNER_CLIENT_ID, ...String(process.env.WINGGUY_PLATFORM_KEY_CLIENTS || '').split(',')]
    .map((s) => s.trim())
    .filter(Boolean),
);
function byoAnthropicClient(req) {
  const cid = req.client && String(req.client.clientId || '').trim();
  // Each draft logs which key lane it took (mirrors the overnight services' `anthropic lane=` line).
  // The browser-key header lane (Option A, 2026-07-13) was REMOVED 2026-08-05 on Julian's feedback:
  // an empty key field in the popup read as a form to fill in, and every client's key now lives on
  // their Client Master row anyway. One door, not two.
  const storedKey = req.client && String(req.client.anthropicApiKey || '').trim();
  if (storedKey) {                                                      // their own key (stored on record)
    logger.info(`[Wingguy] anthropic lane=client-stored-key client=${cid}`);
    return getAnthropicClientForKey(storedKey);
  }
  // Platform (Guy's) key allowed only for: the owner, a client on a managed plan (the record's
  // "Managed Claude Key" = Yes → req.client.managedClaudeKey), or the env override list.
  const managed = !!(req.client && req.client.managedClaudeKey);
  if (managed || (cid && PLATFORM_KEY_CLIENTS.has(cid))) {
    logger.info(`[Wingguy] anthropic lane=platform-fallback client=${cid}`);
    return getAnthropicClient();
  }
  logger.info(`[Wingguy] anthropic lane=none-blocked client=${cid}`);
  return null;                                                          // no key → block, never bill the platform
}

// Map a transient UPSTREAM Anthropic failure (their servers busy / rate-limited / hiccup) to a
// calm, user-facing sentence, so a client sees "briefly busy, try again" instead of a raw
// `529 {"type":"overloaded_error",...}` payload. Returns null for anything that isn't a transient
// upstream error (real bugs still surface their message). The SDK already auto-retries these
// (maxRetries=4) — this only handles the case where the overload outlasts every retry.
function transientClaudeError(e) {
  if (!e) return null;
  const status = Number(e.status || e.statusCode || (e.response && e.response.status)) || 0;
  const type = e.type || (e.error && e.error.type) || '';
  if (status === 529 || type === 'overloaded_error') {
    return "Claude's servers are briefly busy right now - give it a moment and send that again.";
  }
  if (status === 429 || type === 'rate_limit_error') {
    return 'Claude is handling a lot of requests right now - wait a few seconds and try again.';
  }
  if (status >= 500) {
    return 'Claude had a brief server hiccup - please try that again in a moment.';
  }
  return null;
}

// A client-facing sentence for a rejected KEY (their own key revoked, or their spend cap / credit
// exhausted). This is the surfaced-not-swallowed half of the stored-key safety promise: a dead key
// stops their Wingguy and tells them how to fix it — it is NEVER retried on the platform key.
const ANTHROPIC_KEY_ERROR_MSG = {
  revoked: 'Your Anthropic (Claude) API key was rejected - it looks revoked or invalid. Message Guy and it will get sorted.',
  billing: "Your Anthropic (Claude) account declined the request - most likely the spend limit or credit ran out. Raise the limit or top up in your Anthropic Console, then try again.",
};

// Single place that turns a Claude call failure into the right HTTP response, so every model-calling
// route handles a rejected key / overload / real bug identically. Key/billing failure -> 400 + a
// clear "fix your key" message (surfaced, never retried on the platform key); transient upstream
// overload -> 503 "try again"; anything else -> 500 raw.
function respondClaudeError(res, e) {
  const keyReason = anthropicKeyError(e);
  if (keyReason) return res.status(400).json({ ok: false, error: ANTHROPIC_KEY_ERROR_MSG[keyReason], keyError: keyReason });
  const friendly = transientClaudeError(e);
  return res.status(friendly ? 503 : 500).json({ ok: false, error: friendly || e.message });
}

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
  const enabled = cid && (cid === OWNER_CLIENT_ID || !!req.client.wingguyEnabled);
  if (!enabled) {
    return res.status(403).json({
      ok: false,
      error: 'Wingguy is not enabled for this account yet.',
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
    // Exact canonical-slug match only (Bognar/Byrne, 2026-07-28): a substring match here would enrich
    // the draft with the WRONG person's CRM record. The SEARCH formula is just a prefilter.
    const slug = canonicalLinkedinSlug(url);
    const name = String(profile.name || '').trim();
    if (!slug && !name) return profile;

    const base = clientService.getClientBase(req.client.airtableBaseId);
    if (!base) return profile;

    let records = [];
    if (slug) {
      const candidates = await base('Leads').select({
        filterByFormula: slugPrefilterFormula(slug),
        maxRecords: 50,
      }).firstPage();
      records = findExactSlugMatch(candidates, slug).slice(0, 3);
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
      logger.info(`[Wingguy] enrich: no Portal match for ${slug || name}`);
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
    // Carry the matched record id so the chat agent can WRITE back (update_lead_email). Non-enumerable-ish
    // underscore key: buildProfileBlock/detectTemplate read named fields only, so it never reaches the model.
    merged._leadRecordId = records[0].id;
    // Carry the lead's stored email too (same underscore-key convention → never reaches the model), so the
    // chat route can use it as the invite address when the panel didn't pass one. Closes the "agent says it
    // can't book — no email" gap where the panel's own email lookup came through empty but the Portal has it
    // (Mary Anne, 2026-07-03): the invite email now comes from the SAME enriched record the context is built on.
    merged._leadEmail = (records[0].fields && records[0].fields['Email']) || '';
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

  // Lightweight status (no auth) so the extension can show a clear "off" state. Also answers
  // "which rules source is live" (the wingguy_status idea) — the flip/shadow state is askable.
  router.get('/status', (req, res) => {
    res.json({
      ok: true,
      enabled: ENABLED,
      aiConfigured: isAnthropicConfigured(),
      rulesSource: rulesSource.getSource(),
      rulesShadow: rulesSource.isShadowEnabled(),
    });
  });

  // Everything below requires an authenticated client...
  router.use(authenticateUserWithTestMode);
  // ...and, for Slice 1, that client must be the owner.
  router.use(requireOwner);
  // An assistant's key only opens this section if their row has "My Wingguy" ticked - enforced
  // here at the back door, not just by the hidden tab.
  router.use((req, res, next) => {
    if (req.assistant && !req.assistant.functions.includes('My Wingguy')) {
      return res.status(403).json({
        ok: false,
        error: 'Your key does not include the Wingguy pages. Ask the account owner (or Guy) to tick "My Wingguy" for you.',
      });
    }
    next();
  });

  // The quick-pick button set for the panel.
  router.get('/templates', async (req, res) => {
    try {
      res.json({ ok: true, templates: await rulesSource.listTemplates({ tenantId: req.client.clientId }) });
    } catch (e) {
      logger.error(`[Wingguy] templates failed: ${e.message}`);
      res.status(500).json({ ok: false, error: e.message });
    }
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
    // the detection signals against the connection-request note (first thread message) + profile. The
    // human can override by sending a specific id. Detection logic lives behind the rules-source seam.
    const tenantId = req.client.clientId;
    const autoDetected = !requestedTemplateId || requestedTemplateId === 'auto';
    const templateId = autoDetected
      ? await rulesSource.detectTemplate(profile, conversation, { tenantId })
      : requestedTemplateId;
    const template = await rulesSource.getTemplate(templateId, { tenantId });
    if (!template) {
      const valid = (await rulesSource.listTemplates({ tenantId })).map((t) => t.id).join(', ');
      return res.status(400).json({
        ok: false,
        error: `Unknown templateId "${requestedTemplateId}". Valid: ${valid}, or "auto".`,
      });
    }

    const profileBlock = buildProfileBlock(profile);
    if (!profileBlock) {
      return res.status(400).json({ ok: false, error: 'No profile data supplied to draft from.' });
    }
    // Pass any open thread through too — templates that are follow-up replies (e.g. \frac) react to
    // their warm reply; templates that don't reference it (e.g. \tks) simply ignore it.
    const convoBlock = buildConversationBlock(conversation, profile && profile.name);

    // Pre-flip observation: render what the store WOULD say for this draft and log one
    // WINGGUY-SHADOW line. Fire-and-forget — never blocks or breaks the live draft.
    rulesSource.shadowCompare({ surface: 'draft-thanks', profile, conversation, configTemplateId: templateId, tenantId });

    try {
      const client = byoAnthropicClient(req);
      if (!client) return res.status(400).json({ ok: false, error: NO_ANTHROPIC_KEY_MSG });

      // System comes from the rules-source seam. Config mode = [ stable voice block (CACHED),
      // per-template instructions ] — byte-identical to pre-step-2; store mode = [ task harness,
      // rendered rulebook (CACHED) ]. Either way the big stable prefix is prompt-cached.
      const response = await client.messages.create({
        model: WINGGUY_DRAFT_MODEL_ID,
        max_tokens: DRAFT_MAX_TOKENS,
        system: await rulesSource.draftSystem(template.id, { tenantId }),
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
      return respondClaudeError(res, e);
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

    // Shadow-render the store's reply rules too (no config-side campaign here — agree=n/a).
    rulesSource.shadowCompare({ surface: 'draft-reply', profile, conversation, tenantId: req.client.clientId });

    try {
      const client = byoAnthropicClient(req);
      if (!client) return res.status(400).json({ ok: false, error: NO_ANTHROPIC_KEY_MSG });
      const userContent =
        `${profileBlock ? `PROFILE:\n${profileBlock}\n\n` : ''}` +
        `CONVERSATION SO FAR (oldest first):\n${convoBlock}\n\n` +
        `Draft Guy's next message.`;

      const response = await client.messages.create({
        model: WINGGUY_DRAFT_MODEL_ID,
        max_tokens: DRAFT_MAX_TOKENS,
        system: await rulesSource.replySystem({ tenantId: req.client.clientId }),
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
      return respondClaudeError(res, e);
    }
  });

  // Learn-from-my-edit: the extension logs a {generated, sent} pair here when the human changed
  // Wingguy's draft before sending (fired silently by the on-Send capture — never blocks it).
  // Unchanged sends are dropped in the store (no diff, no row). Review happens in chat
  // ("review my edits" → wingguy_edit_review), NOT here — this endpoint only records.
  router.post('/edit-pair', async (req, res) => {
    const { generated, sent, leadName, leadUrl, surface } = req.body || {};
    const CAP = 8000; // a LinkedIn message; anything bigger is a scrape gone wrong, not a draft
    if (!generated || !sent) {
      return res.status(400).json({ ok: false, error: 'generated and sent are both required.' });
    }
    if (String(generated).length > CAP || String(sent).length > CAP) {
      return res.status(400).json({ ok: false, error: `Message too long (cap ${CAP} chars) — not stored.` });
    }
    try {
      const r = await wingguyStore.recordEditPair({
        tenantId: req.client.clientId,
        leadName, leadUrl, surface: surface || 'linkedin',
        generated, sent,
      });
      if (r.stored) logger.info(`[Wingguy] edit pair #${r.id} stored for ${req.client.clientId} (${leadName || 'unknown lead'})`);
      return res.json(r);
    } catch (e) {
      logger.error(`[Wingguy] edit-pair failed: ${e.message}`);
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

      // Detect the campaign from the profile + thread, then get the agent's system prefix from the
      // rules-source seam. Config mode: [voice, agent instructions] + the campaign template embedded
      // in the context (today's shape). Store mode: the rendered rulebook replaces both — the
      // campaign-shadowed rules ARE the template, so campaignTemplate comes back null.
      const templateId = await rulesSource.detectTemplate(enriched, conversation, { tenantId: req.client.clientId });
      const { blocks: systemPrefixBlocks, campaignTemplate } = await rulesSource.agentSystem(templateId, { tenantId: req.client.clientId });
      rulesSource.shadowCompare({ surface: 'chat', profile: enriched, conversation, configTemplateId: templateId, tenantId: req.client.clientId });

      const chatClient = byoAnthropicClient(req);
      if (!chatClient) return res.status(400).json({ ok: false, error: NO_ANTHROPIC_KEY_MSG });

      const result = await runWingguyChatTurn({
        coach,
        profile: enriched,
        conversation,
        messages,
        // Invite address: prefer the FRESH CRM primary (read this turn by enrichProfileFromPortal) over
        // the panel's leadEmail, which is looked up ONCE at chat-open and cached in the browser for the
        // whole session. Both read the same {Email} field, so the server read is never staler and is
        // often fresher - when the address is changed mid-session (e.g. the panel's own Email edit →
        // quick-update), the cached panel value goes stale and would send the invite to the OLD address
        // (Szymon Zurek, 2026-07-21: booked to his old gmail minutes after the email was changed to his
        // work address). Fall back to the panel value, then empty, so a lead with no CRM match still
        // works and the "no email on file" path (Mary Anne, 2026-07-03) is preserved.
        leadEmail: (enriched && enriched._leadEmail) || leadEmail || '',
        // CRM write seam for update_lead_email: the lead's base + the record id the enrich step matched.
        airtableBaseId: req.client && req.client.airtableBaseId,
        leadRecordId: enriched && enriched._leadRecordId,
        campaignTemplate,
        systemPrefixBlocks,
        // BYO key: the booking agent's backend Claude call runs on the client's own key (guarded above).
        deps: { client: chatClient },
        // Reuse the route's grounding-block formatting so the agent sees the same shape as the other endpoints.
        profileBlock: buildProfileBlock(enriched),
        convoBlock: buildConversationBlock(conversation, enriched && enriched.name),
      });
      if (!result.ok) return res.status(502).json({ ok: false, error: result.error });

      logger.info(`[Wingguy] chat turn for ${coach.clientId}: ${result.messages.length} msgs, draft=${result.draft ? 'yes' : 'no'}, booked=${result.booked ? result.booked.eventId : 'no'}`);
      return res.json(result);
    } catch (e) {
      logger.error(`[Wingguy] chat failed: ${e.message}`);
      // Key/billing failure -> clear "fix your key" (400); transient overload -> 503; else 500.
      return respondClaudeError(res, e);
    }
  });

  // Second half of the "create → enrich" handshake: the extension reads the lead's LinkedIn Contact
  // Info (email + phone — only the logged-in browser tab can see them) and posts them here to patch
  // the record the chat agent just created. Narrow + non-destructive: fills phone always (when empty)
  // and email only when the record has none (so a thread-supplied address wins). Guy's rule 2026-07-08.
  router.post('/lead-contact', async (req, res) => {
    if (!ENABLED) return res.status(503).json({ ok: false, error: 'Wingguy is disabled.' });
    const { leadRecordId, email = '', phone = '' } = req.body || {};
    if (!leadRecordId) return res.status(400).json({ ok: false, error: 'leadRecordId required.' });
    try {
      const r = await wingguyLeads.updateLeadContact(req.client && req.client.airtableBaseId, leadRecordId, { email, phone });
      if (!r.ok) return res.status(502).json(r);
      logger.info(`[Wingguy] lead-contact ${leadRecordId}: changed=${r.changed} (email=${r.email ? 'set' : '—'}, phone=${r.phone ? 'set' : '—'})`);
      return res.json(r);
    } catch (e) {
      logger.error(`[Wingguy] lead-contact failed: ${e.message}`);
      return res.status(500).json({ ok: false, error: e.message });
    }
  });

  // --- "Set up your own Wingguy" page ------------------------------------------------------------
  // The client-facing read/write door for the fill-in-the-blanks half of their instructions: the
  // {{variables}} their rules reference, plus the handful of {{asset:...}} links safe to expose.
  // WORDING of an instruction is deliberately NOT here — changing that needs the conflict check
  // and the neighbour view the propose→commit door gives you, and a text box on a page cannot do
  // it. This endpoint only ever fills in blanks the rules already leave.
  //
  // Both handlers filter against config/wingguySetupFields.js, so the page can never read or write
  // a key that file does not name (the catalog also holds plumbing like tracking_bcc).

  // Three settings the instructions need that a CLIENT must never be asked for: the CRM tracking
  // address (same for everyone; handing it over is how someone breaks their own follow-up queue),
  // their own email (already on their record), and their network name (only used in one line).
  // Filled here rather than remembered by the coach - onboarding steps that live only in someone's
  // head get skipped, and Julian's rulebook has been rendering literal braces because of it.
  // Idempotent: only ever fills a blank, never overwrites an answer.
  const TRACKING_BCC = (process.env.WINGGUY_TRACKING_BCC || 'track@mail.australiansidehustles.com.au').trim();

  /** Surname from the record: the explicit field if present, else whatever follows the first name. */
  function lastNameFrom(client) {
    if (!client) return '';
    const explicit = String(client.clientLastName || '').trim();
    if (explicit) return explicit;
    const full = String(client.clientName || '').trim();
    const first = String(client.clientFirstName || '').trim();
    if (full && first && full.toLowerCase().startsWith(first.toLowerCase())) {
      return full.slice(first.length).trim();
    }
    const parts = full.split(/\s+/);
    return parts.length > 1 ? parts.slice(1).join(' ') : '';
  }

  async function ensureCoachManagedVariables(tenantId, client, existingRows) {
    const have = new Map((existingRows || []).map((r) => [r.var_key, r.value]));
    const blank = (k) => !String(have.get(k) || '').trim();
    const wanted = [
      // Never client-editable - the same address for everyone, and handing it over is how someone
      // quietly drops themselves out of their own follow-up queue.
      ['tracking_bcc', TRACKING_BCC],
      // Already on their record, so asking them to retype it is busywork. These land as PRE-FILLS,
      // not locks: they appear in the page's boxes and the client can change any of them.
      ['owner_email', String((client && (client.clientEmailAddress || client.email)) || '').trim()],
      ['network_name', String((client && client.clientName) || '').trim()],
      ['owner_first_name', String((client && client.clientFirstName) || '').trim()],
      ['timezone', String((client && client.timezone) || '').trim()],
      // Calendar invite titles use the full name. Derived rather than asked: the record has it,
      // and "what is your surname" is a silly question to put on a setup page.
      ['owner_last_name', lastNameFrom(client)],
    ];
    let filled = 0;
    for (const [key, value] of wanted) {
      if (!value || !blank(key)) continue;
      try {
        await wingguyStore.setVariable({ tenantId, varKey: key, value, actor: 'system:coach-managed' });
        filled++;
      } catch (e) {
        logger.error(`[Wingguy] could not fill coach-managed "${key}" for ${tenantId}: ${e.message}`);
      }
    }
    if (filled) logger.info(`[Wingguy] filled ${filled} coach-managed variable(s) for ${tenantId}`);
    return filled;
  }

  // Hand a brand-new client their starter kit the first time they open their setup page.
  //
  // Before this, the ONLY automatic trigger was a client happening to ask "set up my instructions"
  // in a chat - so someone could work through this entire page, read every shared instruction, and
  // still own none of their own. The page is the front door to onboarding, so the page is what
  // should do it.
  //
  // Safe to call on every load: the store skips any rule they already hold, refuses to touch the
  // owner tenant, and will not seed a copy over a locked guardrail. It only ever fires for a client
  // whose own layer is completely empty, so a client who has since retired a seeded rule does not
  // get it silently resurrected.
  //
  // NO LATCH ANY MORE (2026-08-06). WINGGUY_SEED_FROM_TEMPLATE existed to protect clients from a
  // starter kit we knew was broken - nine rules that assumed the client was Guy selling ASH
  // memberships, seventeen carrying his exact scripted sentences. That kit was rewritten and the
  // danger is gone, and a manual gate on an automatic process is the kind of thing that gets
  // forgotten: someone onboards, silently receives nothing, and nobody notices for a fortnight.
  // A client now gets whatever the kit is on the day they open their page.
  //
  // What protects the kit from here is review before a change ships, not a switch - a switch that
  // is off does not stop a bad instruction being written, it only delays who receives it. And note
  // the asymmetry: seeding again later ADDS but never undoes, so a wrong instruction that reached
  // clients needs a deliberate fix, not a reseed.
  async function ensureSeededFromTemplate(tenantId) {
    if (tenantId === wingguyStore.DEFAULT_TENANT) return 0;
    try {
      const existing = await wingguyStore.getActiveRules({ tenantId, layer: 'client' });
      if (existing.length) return 0;
      const r = await wingguyStore.seedClientFromTemplate({ tenantId, createdBy: `portal:setup-page:${tenantId}` });
      const n = (r && r.seeded && r.seeded.length) || 0;
      if (n) logger.info(`[Wingguy] seeded ${n} starter-kit instructions for ${tenantId} on first setup-page open`);
      return n;
    } catch (e) {
      // Never break the page over this - they still get the shared instructions, and the next
      // open (or the chat door) will try again.
      logger.error(`[Wingguy] seeding failed for ${tenantId}: ${e.message}`);
      return 0;
    }
  }

  router.get('/setup', async (req, res) => {
    const tenantId = req.client.clientId;
    try {
      await ensureSeededFromTemplate(tenantId);
      // SEQUENTIAL, NOT Promise.all. Each store call runs ensureSchema on its own connection, and
      // against a database where the tables do not exist yet (a fresh environment, or the first
      // request after a deploy to a new one) two of them race their CREATE TABLE / CREATE INDEX
      // and Postgres rejects the loser with a duplicate-key error on pg_class. The first call
      // flips the store's schemaEnsured latch, so the second is then free. Two round trips on a
      // page load nobody is timing is the right trade for never serving that 500.
      let variableRows = await wingguyStore.getVariables({ tenantId });
      // Self-healing: opening the page tops up anything the coach's side owes (see above).
      if (await ensureCoachManagedVariables(tenantId, req.client, variableRows)) {
        variableRows = await wingguyStore.getVariables({ tenantId });
      }
      const assetRows = await wingguyStore.getAssets({ tenantId });

      const varValues = new Map(variableRows.map((r) => [r.var_key, r.value]));
      const assetValues = new Map(
        assetRows.filter((r) => r.status !== 'retired').map((r) => [r.asset_key, r.url]),
      );

      const fields = [
        ...setupFields.VARIABLE_FIELDS.map((f) => ({
          ...f, scope: 'variable', value: varValues.get(f.key) || '',
        })),
        ...setupFields.ASSET_FIELDS.map((f) => ({
          ...f, scope: 'asset', value: assetValues.get(f.key) || '',
        })),
        ...setupFields.VOICE_FIELDS.map((f) => ({
          ...f, scope: 'variable', section: 'voice', value: varValues.get(f.key) || '',
        })),
      ];

      // Progress counts the ESSENTIALS only. Counting the glance fields would nag a client toward
      // filling in settings the page has just told them are fine left alone.
      const essentials = fields.filter((f) => f.tier === 'essential');
      const answered = essentials.filter((f) => String(f.value).trim()).length;
      return res.json({
        ok: true,
        clientName: req.client.clientName || '',
        groups: setupFields.groupOrder(),
        tierGroups: {
          essential: setupFields.groupOrder('essential'),
          glance: setupFields.groupOrder('glance'),
          voice: setupFields.groupOrder('voice'),
        },
        fields,
        answered,
        total: essentials.length,
      });
    } catch (e) {
      logger.error(`[Wingguy] setup read failed for ${tenantId}: ${e.message}`);
      return res.status(500).json({ ok: false, error: e.message });
    }
  });

  // Saves one field at a time — the page autosaves as they leave each box, so a dropped connection
  // costs one answer rather than the lot. Both store writes are history-logged, so "what did they
  // change and when" stays answerable.
  router.put('/setup', async (req, res) => {
    const tenantId = req.client.clientId;
    const { scope, key, value } = req.body || {};
    const clean = value == null ? '' : String(value).trim();

    if (scope !== 'variable' && scope !== 'asset') {
      return res.status(400).json({ ok: false, error: 'scope must be "variable" or "asset".' });
    }
    const known = scope === 'variable' ? setupFields.VARIABLE_KEYS : setupFields.ASSET_KEYS;
    if (!key || !known.has(key)) {
      return res.status(400).json({ ok: false, error: `"${key}" is not a setting you can change here.` });
    }
    // Per-field cap: voice pieces (the advocacy case in their words) legitimately run long;
    // a sign-off does not. Anything past its cap is a paste gone wrong.
    const cap = setupFields.capFor(scope, key);
    if (clean.length > cap) {
      return res.status(400).json({ ok: false, error: `That is too long (limit ${cap} characters).` });
    }
    // A link box that is not a link is the one mistake worth catching before it reaches an invite.
    if (scope === 'asset' && clean && !/^https?:\/\/\S+$/i.test(clean)) {
      return res.status(400).json({ ok: false, error: 'That does not look like a web link - it should start with https://' });
    }

    try {
      // Same attribution as instruction commits: a named link signs its blank changes too, so
      // the review page can read "April filled in the sign-off".
      const by = `portal:${tenantId}${pageName(req) ? `:as:${pageName(req)}` : ''}`;
      if (scope === 'variable') {
        await wingguyStore.setVariable({ tenantId, varKey: key, value: clean, actor: by });
      } else {
        const field = setupFields.ASSET_FIELDS.find((f) => f.key === key);
        await wingguyStore.setAsset({
          tenantId, assetKey: key, url: clean, kind: field.kind || 'url',
          status: clean ? 'active' : 'retired', actor: by,
        });
      }
      logger.info(`[Wingguy] setup ${scope} "${key}" updated by ${tenantId} (${clean ? 'set' : 'cleared'})`);
      return res.json({ ok: true, scope, key, value: clean });
    } catch (e) {
      logger.error(`[Wingguy] setup write failed for ${tenantId} (${scope}/${key}): ${e.message}`);
      return res.status(500).json({ ok: false, error: e.message });
    }
  });

  // --- "How your Wingguy works" — the browse + change + add doors (stage 3) ---------------------
  // The page shows every instruction in plain English and lets the client push back on any of
  // them, right where they are reading it. All writes still go through the ONE checked door
  // (commitRule), always with the client's explicit confirm click - the page never saves a
  // free-text change directly. Titles live in config/wingguyInstructionTitles.js because the
  // store has no title column and `warm-reply-gtm` is not a name a client should read.

  const titles = require('../config/wingguyInstructionTitles');

  const GROUP_LABELS = {
    global: 'Everywhere',
    outreach: 'Reaching out',
    reply: 'When they reply',
    booking: 'Getting it in the diary',
    'post-call': 'After a call',
    'follow-up': 'Following up',
  };

  router.get('/setup/instructions', async (req, res) => {
    const tenantId = req.client.clientId;
    try {
      // Sequential for the same schema-race reason as GET /setup.
      const variableRows = await wingguyStore.getVariables({ tenantId });
      const assetRows = await wingguyStore.getAssets({ tenantId });
      // The RESOLVED runtime view: one rule per key, client overrides already applied - exactly
      // what reaches the model. Campaign-tagged variants are out of scope for the page (generic
      // view only); they stay a chat conversation.
      const rules = await wingguyStore.getActiveRules({ tenantId, shadowed: true });

      const varMap = {};
      variableRows.forEach((r) => { if (r.value != null && String(r.value).length) varMap[r.var_key] = r.value; });
      const assetMap = {};
      assetRows.forEach((r) => { assetMap[r.asset_key] = { url: r.url, status: r.status }; });

      const foundationKeys = new Set(rules.filter((r) => r.layer === 'foundation').map((r) => r.rule_key));

      const items = rules
        .filter((r) => !r.campaign)
        .map((r) => {
          const isFoundation = r.layer === 'foundation';
          const kind = isFoundation
            ? (wingguyStore.ruleTier(r) === 'locked' ? 'fixed' : 'standard')
            : 'yours';
          const { text: resolved, unresolved } = wingguyStore.resolveRuleBody(r.body, varMap, assetMap);
          // A blank the client has not filled in resolves to its literal {{key}} - honest, but it
          // reads as broken code to a client. Render it as a human nudge back up the page instead.
          // ONLY the keys the store actually reported unresolved: some instructions legitimately
          // print {{asset:key}} as syntax documentation, and rewriting that into "not filled in
          // yet" turns an explanation into a fake error.
          const stillMissing = new Set(unresolved);
          const text = resolved.replace(
            /\{\{\s*(asset:)?([a-zA-Z0-9_.-]+)\s*\}\}/g,
            (whole, assetPrefix, key) => {
              const id = `${assetPrefix || ''}${key}`;
              if (!stillMissing.has(id)) return whole;
              return `[${key.replace(/[_-]+/g, ' ')} - not filled in yet]`;
            },
          );
          // A kit prompt they have not written yet is flagged, so the page can present it as a
          // space left for them rather than an instruction that looks half-finished.
          const unwritten = titles.isUnwritten(r.rule_key);
          return {
            ruleKey: r.rule_key,
            context: r.context,
            ruleType: r.rule_type,
            version: r.version,
            kind,
            unwritten,
            blurb: unwritten ? titles.blurbFor(r.rule_key) : '',
            title: titles.titleFor(r.rule_key),
            gist: titles.gistFor(r.rule_key),
            body: text,
          };
        });

      const groups = Object.keys(GROUP_LABELS)
        .map((ctx) => ({
          key: ctx,
          label: GROUP_LABELS[ctx],
          items: items
            .filter((i) => i.context === ctx)
            .sort((a, b) => a.title.localeCompare(b.title)),
        }))
        .filter((g) => g.items.length);

      return res.json({ ok: true, groups, total: items.length });
    } catch (e) {
      logger.error(`[Wingguy] setup instructions read failed for ${tenantId}: ${e.message}`);
      return res.status(500).json({ ok: false, error: e.message });
    }
  });

  // Pull a JSON object out of a model reply that may carry prose around it.
  function extractJson(text) {
    const s = String(text || '');
    const start = s.indexOf('{');
    const end = s.lastIndexOf('}');
    if (start < 0 || end <= start) throw new Error('the assistant did not return usable JSON');
    return JSON.parse(s.slice(start, end + 1));
  }

  async function runAssistModel(anthropic, system, userText, maxTokens = 900) {
    const msg = await anthropic.messages.create({
      model: WINGGUY_DRAFT_MODEL_ID,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: userText }],
    });
    return (msg.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  }

  function tenantVoiceContext(variableRows) {
    const wanted = ['owner_first_name', 'signoff', 'region', 'core_framing', 'target_verticals',
      'network_explainer_line', 'call_platform', 'canonical_inversion_line', 'never_say_words'];
    const lines = [];
    variableRows.forEach((r) => {
      if (wanted.includes(r.var_key) && r.value != null && String(r.value).trim()) {
        lines.push(`${r.var_key}: ${String(r.value).trim()}`);
      }
    });
    return lines.length ? lines.join('\n') : '(they have not filled anything in yet)';
  }

  // One assist door, three moves. BILLING PRINCIPLE (Guy, 2026-08-06): a client's own key powers
  // the EXTENSION and its behind-the-scenes work; pages GUY PROVIDES run on the platform key, for
  // everyone - the setup page is the welcome mat, not client usage. This is the one deliberate
  // exception to the never-on-the-platform-key rule, so it does NOT go through byoAnthropicClient:
  // a BYO client's stored key must not be charged for onboarding themselves.
  router.post('/setup/assist', async (req, res) => {
    const tenantId = req.client.clientId;
    const { mode } = req.body || {};
    if (!isAnthropicConfigured()) {
      return res.status(500).json({ ok: false, error: 'The writing helper is not available right now.' });
    }
    const anthropic = getAnthropicClient();
    logger.info(`[Wingguy] setup assist lane=platform (page principle) client=${tenantId} mode=${mode}`);

    try {
      const variableRows = await wingguyStore.getVariables({ tenantId });
      const voice = tenantVoiceContext(variableRows);

      if (mode === 'example') {
        const { kind } = req.body || {};
        if (kind === 'post_connection') {
          const raw = await runAssistModel(anthropic,
            'You draft LinkedIn messages for a professional. Reply with JSON only: {"leadIntro": string, "message": string}. British/Australian spelling. No em dashes - use " - ".',
            `Their setup so far:\n${voice}\n\nInvent ONE realistic lead from their target audience (a first name, a profession from their audience, one concrete career detail and an Australian location). Then write the thanks-for-connecting message they would send that person: three short lines - one true observation about the invented profile, one line hinting at what THEY are building (their framing, never explaining a system), and a closing question. leadIntro is one line describing the invented person (e.g. "an imaginary mortgage broker - Karen, 12 years running her own book in Parramatta"). If their setup is mostly empty, write a plainly generic-but-decent message and make leadIntro note it will get sharper as they fill things in.`);
          const j = extractJson(raw);
          return res.json({ ok: true, leadIntro: String(j.leadIntro || ''), text: String(j.message || '') });
        }
        if (kind === 'advocacy') {
          const raw = await runAssistModel(anthropic,
            'You help a professional see how an argument would sound in conversation. Reply with JSON only: {"text": string}. Spoken register, first person, warm, no bullet points. British/Australian spelling. No em dashes - use " - ".',
            `Their setup so far:\n${voice}\n\nWrite how the case for building a network of ADVOCATES (people who recommend you unprompted) rather than collecting contacts might sound, said across a table in about 120-160 words, following these beats in order: start from what they already know (best opportunities came through people who vouched for them) - name the gap (most networking builds contacts, not advocates) - the distinction (a contact knows you, an advocate recommends you unprompted) - take the blame off them (normal networking is designed for reach, not trust) - why it takes deliberate systematic effort. Use their framing where it exists.`);
          const j = extractJson(raw);
          return res.json({ ok: true, text: String(j.text || '') });
        }
        if (kind === 'inversion') {
          const raw = await runAssistModel(anthropic,
            'You help a professional phrase one idea in their own voice. Reply with JSON only: {"text": string}. British/Australian spelling. No em dashes - use " - ".',
            `Their setup so far:\n${voice}\n\nSuggest ONE natural phrasing (a single sentence) of this idea, in words that fit them: having trusted people recommending you, rather than having to recommend yourself. Plain, sayable out loud, no jargon.`);
          const j = extractJson(raw);
          return res.json({ ok: true, text: String(j.text || '') });
        }
        return res.status(400).json({ ok: false, error: `unknown example kind "${kind}"` });
      }

      if (mode === 'readback') {
        const { text, label } = req.body || {};
        if (!String(text || '').trim()) return res.status(400).json({ ok: false, error: 'Nothing to read back yet.' });
        const raw = await runAssistModel(anthropic,
          'You are Wingguy, helping a client sound like themselves. You mostly ask ONE good question; you only suggest a rewrite when the text plainly reads like a brochure. Never condescending, never gushing. Reply with JSON only: {"note": string, "suggestion": string|null}. note is 1-3 short sentences reacting to their answer. suggestion is a plainer-spoken rewrite ONLY if genuinely needed, else null. British/Australian spelling. No em dashes - use " - ".',
          `The box they are filling in: "${label || 'their answer'}"\n\nWhat they wrote:\n${String(text).slice(0, 2500)}\n\nRead it back: does it sound like something a person would say across a table, or like a LinkedIn bio? React accordingly.`,
          600);
        const j = extractJson(raw);
        return res.json({ ok: true, note: String(j.note || ''), suggestion: j.suggestion ? String(j.suggestion) : null });
      }

      // One-tap explainers on an open instruction: "explain plainly" / "what does this mean for
      // my messages?". Personalised via their setup so a planner hears it in planner terms.
      if (mode === 'explain') {
        const { ruleKey, angle } = req.body || {};
        const rules = await wingguyStore.getActiveRules({ tenantId, shadowed: true });
        const current = rules.filter((r) => !r.campaign).find((r) => r.rule_key === ruleKey);
        if (!current) return res.status(404).json({ ok: false, error: 'That instruction was not found.' });
        const ask = angle === 'impact'
          ? 'Explain what this instruction actually changes about the messages and emails Wingguy writes for them - the visible difference they would notice. One tiny concrete example in their world if their setup gives you one.'
          : 'Explain this instruction in plain spoken English, as if across a table. What it does and why it exists. No jargon, no restating it line by line.';
        const raw = await runAssistModel(anthropic,
          'You are Wingguy explaining one of a client\'s own writing instructions to them. Warm, plain, brief - 3-5 short sentences. Reply with JSON only: {"text": string}. British/Australian spelling. No em dashes - use " - ".',
          `Their setup so far:\n${voice}\n\nThe instruction ("${titles.titleFor(ruleKey)}"):\n---\n${current.body}\n---\n\n${ask}`,
          700);
        const j = extractJson(raw);
        return res.json({ ok: true, text: String(j.text || '') });
      }

      // The whole-rulebook question box: "is there something that does X?" Answers plainly and
      // names the instruction so the page can point at it.
      if (mode === 'ask') {
        const { question } = req.body || {};
        if (!String(question || '').trim()) return res.status(400).json({ ok: false, error: 'Ask away - the box is empty.' });
        const rules = await wingguyStore.getActiveRules({ tenantId, shadowed: true });
        const generic = rules.filter((r) => !r.campaign);
        const index = generic.map((r) => `- ${r.rule_key}: ${titles.titleFor(r.rule_key)}${titles.gistFor(r.rule_key) ? ' - ' + titles.gistFor(r.rule_key) : ''}`).join('\n');
        const first = await runAssistModel(anthropic,
          'You route a client\'s question about their writing instructions to the ONE most relevant instruction, or none. Reply with JSON only: {"ruleKey": string|null}.',
          `Their instructions:\n${index}\n\nTheir question:\n${String(question).slice(0, 1000)}`,
          200);
        const route = extractJson(first);
        const hit = route.ruleKey ? generic.find((r) => r.rule_key === route.ruleKey) : null;
        const raw = await runAssistModel(anthropic,
          'You are Wingguy answering a client\'s question about how their instructions work. Plain spoken English, 2-5 short sentences, honest when the answer is "nothing covers that". Reply with JSON only: {"answer": string}. British/Australian spelling. No em dashes - use " - ".',
          hit
            ? `Their setup so far:\n${voice}\n\nTheir question:\n${String(question).slice(0, 1000)}\n\nThe most relevant instruction ("${titles.titleFor(hit.rule_key)}"):\n---\n${hit.body}\n---\n\nAnswer their question from it. If it does not actually answer the question, say what does not exist yet and that they can add it in the box above.`
            : `Their instructions (titles only):\n${index}\n\nTheir question:\n${String(question).slice(0, 1000)}\n\nNothing obviously covers this. Say so honestly, and note they can add an instruction for it in the box above.`,
          700);
        const j = extractJson(raw);
        return res.json({
          ok: true,
          answer: String(j.answer || ''),
          ruleKey: hit ? hit.rule_key : null,
          title: hit ? titles.titleFor(hit.rule_key) : null,
        });
      }

      if (mode === 'change') {
        const { ruleKey, request } = req.body || {};
        if (!String(request || '').trim()) return res.status(400).json({ ok: false, error: 'Say what you would like changed first.' });
        const rules = await wingguyStore.getActiveRules({ tenantId, shadowed: true });
        const generic = rules.filter((r) => !r.campaign);

        if (ruleKey) {
          // CHANGE an instruction they are looking at. Their new version lands in their own layer
          // and replaces the shared one for them alone (the door refuses if it is locked).
          const current = generic.find((r) => r.rule_key === ruleKey);
          if (!current) return res.status(404).json({ ok: false, error: 'That instruction was not found.' });
          if (current.layer === 'foundation' && wingguyStore.ruleTier(current) === 'locked') {
            return res.status(403).json({ ok: false, error: 'That one is a guardrail - it applies to everyone and cannot be changed.' });
          }
          // The box takes ANYTHING - a question or a change request. The client never has to
          // classify their own thought; the model does, and answers or proposes accordingly.
          const raw = await runAssistModel(anthropic,
            `You maintain a client's writing instructions. They typed something under an instruction they were reading. FIRST decide what it is:\n- A QUESTION or confusion ("what does this mean?", "why?", "does this apply to...?") → answer it plainly, grounded in the instruction. Reply JSON: {"answer": string} - 2-4 short sentences, plain spoken English, use their world where their setup shows it.\n- A CHANGE request → fold it into the instruction, changing as little as possible and keeping {{placeholders}} intact. Reply JSON: {"explanation": string, "body": string} - explanation is 1-2 plain sentences on what changed; body is the COMPLETE new instruction text.\nReply with ONE of those JSON shapes only. British/Australian spelling. No em dashes - use " - ".`,
            `Their setup so far:\n${voice}\n\nThe instruction ("${titles.titleFor(ruleKey)}"):\n---\n${current.body}\n---\n\nWhat they typed:\n${String(request).slice(0, 1500)}`,
            1600);
          const j = extractJson(raw);
          if (j.answer && !j.body) {
            return res.json({ ok: true, action: 'answer', text: String(j.answer) });
          }
          const clientVersion = current.layer === 'client' ? current.version : 0;
          return res.json({
            ok: true,
            action: 'change',
            ruleKey,
            title: titles.titleFor(ruleKey),
            explanation: String(j.explanation || ''),
            proposedBody: String(j.body || ''),
            context: current.context,
            ruleType: current.rule_type,
            expectedVersion: clientVersion,
            replacesShared: current.layer === 'foundation',
          });
        }

        // ADD a new instruction - with the overlap guard Guy promised on the page: if something
        // already covers the ground, lead with "amend that one instead" rather than minting a twin.
        const index = generic.map((r) => `- ${r.rule_key} (${r.context}): ${titles.titleFor(r.rule_key)}${titles.gistFor(r.rule_key) ? ' - ' + titles.gistFor(r.rule_key) : ''}`).join('\n');
        const raw = await runAssistModel(anthropic,
          `You maintain a client's writing instructions. They want to add a new one. FIRST check the existing list for one that already covers the same ground - overlapping instructions quietly fight each other. Reply with JSON only, ONE of:\n{"overlapKey": string, "why": string}  - an existing instruction covers this ground; why is 1-2 plain sentences\n{"ruleKey": string, "context": string, "ruleType": string, "explanation": string, "body": string}  - genuinely new; ruleKey is a new kebab-case key, context is one of global|outreach|reply|booking|post-call|follow-up, ruleType is one of voice|formatting|stage-logic|scheduling|asset-usage|qualifying, body is the complete instruction in second person ("you"), explanation is 1-2 plain sentences. British/Australian spelling. No em dashes - use " - ".`,
          `Their existing instructions:\n${index}\n\nWhat they want, in their words:\n${String(request).slice(0, 1500)}`,
          1600);
        const j = extractJson(raw);
        if (j.overlapKey) {
          const hit = generic.find((r) => r.rule_key === j.overlapKey);
          return res.json({
            ok: true,
            action: 'overlap',
            ruleKey: j.overlapKey,
            title: titles.titleFor(j.overlapKey),
            why: String(j.why || ''),
            found: !!hit,
          });
        }
        const newKey = String(j.ruleKey || '').trim();
        if (!/^[a-z0-9][a-z0-9-]{2,60}$/.test(newKey)) return res.status(500).json({ ok: false, error: 'Could not coin a sensible name for that - try wording it differently.' });
        if (generic.some((r) => r.rule_key === newKey)) return res.status(409).json({ ok: false, error: 'That clashes with an existing instruction - try again.' });
        if (!wingguyStore.CONTEXTS.includes(j.context) || !wingguyStore.RULE_TYPES.includes(j.ruleType)) {
          return res.status(500).json({ ok: false, error: 'Could not place that instruction - try wording it differently.' });
        }
        return res.json({
          ok: true,
          action: 'add',
          ruleKey: newKey,
          title: titles.titleFor(newKey),
          explanation: String(j.explanation || ''),
          proposedBody: String(j.body || ''),
          context: j.context,
          ruleType: j.ruleType,
          expectedVersion: 0,
          replacesShared: false,
        });
      }

      return res.status(400).json({ ok: false, error: `unknown assist mode "${mode}"` });
    } catch (e) {
      if (transientClaudeError(e)) return respondClaudeError(res, e);
      logger.error(`[Wingguy] setup assist (${mode}) failed for ${tenantId}: ${e.message}`);
      return res.status(500).json({ ok: false, error: 'That did not work - try again in a moment.' });
    }
  });

  // The confirm click. The ONLY way the page writes an instruction, and it goes through the same
  // door as chat: version-checked, guardrail-refusing, history-logged, append-only.
  router.post('/setup/change-commit', async (req, res) => {
    const tenantId = req.client.clientId;
    const { ruleKey, context, ruleType, body, expectedVersion, explanation } = req.body || {};
    if (!ruleKey || !String(body || '').trim()) {
      return res.status(400).json({ ok: false, error: 'Nothing to save.' });
    }
    try {
      const r = await wingguyStore.commitRule({
        layer: 'client',
        tenantId,
        ruleKey: String(ruleKey),
        context,
        ruleType,
        body: String(body),
        changeNote: `From their setup page: ${String(explanation || 'client change').slice(0, 300)}`,
        createdBy: `portal:${tenantId}${pageName(req) ? `:as:${pageName(req)}` : ''}`,
        expectedVersion: Number(expectedVersion) || 0,
        actorTenantId: tenantId,
        via: 'door',
      });
      logger.info(`[Wingguy] setup page instruction commit: ${ruleKey} v${r.version || '?'} for ${tenantId}`);
      // Write the review page's plain-English line now, while nobody is waiting on it. Doing it
      // here rather than at read time is what keeps the review page instant and costs one small
      // call per change ever. Never allowed to fail the save.
      if (r.historyId) {
        setImmediate(() => {
          summariseChange(tenantId, r.historyId)
            .catch((e) => logger.error(`[Wingguy] change summary failed for ${tenantId} #${r.historyId}: ${e.message}`));
        });
      }
      return res.json({ ok: true, ruleKey });
    } catch (e) {
      const friendly = e.code === 'WG_TIER_LOCKED'
        ? 'That one is a guardrail - it applies to everyone and cannot be changed.'
        : (/version conflict/.test(e.message)
          ? 'That instruction changed since you looked at it - reopen it and try again.'
          : e.message);
      logger.error(`[Wingguy] setup page commit failed for ${tenantId} (${ruleKey}): ${e.message}`);
      return res.status(409).json({ ok: false, error: friendly });
    }
  });

  // -------------------------------------------------------------------------
  // The review page — the owner's window. One tenant can be two people (a business owner and
  // whoever operates the page day to day), so links may carry &as=<name>: pure attribution, not
  // authentication — the token is still the whole auth story, the name just makes the change
  // history readable ("April, Tuesday") and lets notes carry a signature.
  // -------------------------------------------------------------------------

  // The display name a page identifies itself with (?as= passed through as a header or body
  // field). Kept to letters/spaces so an actor string stays parseable.
  // Whose name signs a change or a note. The TOKEN decides, not the URL: an assistant's key
  // signs as the assistant, the client's own key signs as the client's first name. (This
  // replaced the old &as= link decoration, which was attribution on the honour system - anyone
  // could edit the URL and become someone else, and it fell off bookmarked links.)
  function pageName(req) {
    if (req.assistant && req.assistant.name) {
      return String(req.assistant.name).replace(/[^a-zA-Z' -]/g, '').trim().slice(0, 40);
    }
    const clientName = (req.client && req.client.clientName) || '';
    return String(clientName).split(/\s+/)[0].replace(/[^a-zA-Z' -]/g, '').trim().slice(0, 40);
  }

  // actor column → the name a human should read on the review page. The fallback is a plain
  // phrase, never the raw actor string - "promotion-pass" leaking through is exactly the
  // techo-speak this page exists to avoid.
  function whoFromActor(actor) {
    const a = String(actor || '');
    const as = a.match(/:as:(.+)$/);
    if (as) return as[1];
    if (a.startsWith('portal:')) return 'the setup page';
    if (a.startsWith('mcp:')) return 'a chat with Wingguy';
    if (a.includes('seed')) return 'the starter kit';
    if (a.startsWith('system:coach-managed')) return 'automatic onboarding fill';
    if (isHousekeepingActor(a)) return 'housekeeping';
    return 'Wingguy';
  }

  // Engineering reshuffles and automatic plumbing - rules moving between layers without their
  // wording changing, and the coach-managed blanks (email, timezone, name) filled from the
  // client record on first open. Real events, kept in the record, but not decisions anyone made
  // about THIS business, so the page folds them out of the main list.
  function isHousekeepingActor(actor) {
    const a = String(actor || '');
    return /promotion.?pass/i.test(a) || a.startsWith('system:');
  }

  // A blank's human name comes from the setup page's own field labels; anything not on the page
  // (coach-managed keys like owner_email) falls back to a prettified key.
  function blankLabelFor(key) {
    const all = [...setupFields.VARIABLE_FIELDS, ...setupFields.ASSET_FIELDS, ...(setupFields.VOICE_FIELDS || [])];
    const hit = all.find((f) => f.key === key);
    if (hit && hit.label) return hit.label.replace(/\?$/, '');
    const words = String(key || '').replace(/[-_]+/g, ' ').trim();
    return words.charAt(0).toUpperCase() + words.slice(1);
  }

  // A stored instruction body as a human should read it: the client's own values woven in, and
  // any blank they have not filled rendered as a nudge instead of literal {{braces}}. Same
  // treatment GET /setup/instructions gives the live rulebook — without it the review page shows
  // raw model-facing text, which reads as broken code to the person whose business it governs.
  async function bodyHumaniser(tenantId) {
    const variableRows = await wingguyStore.getVariables({ tenantId });
    const assetRows = await wingguyStore.getAssets({ tenantId });
    const varMap = {};
    variableRows.forEach((r) => { if (r.value != null && String(r.value).length) varMap[r.var_key] = r.value; });
    const assetMap = {};
    assetRows.forEach((r) => { assetMap[r.asset_key] = { url: r.url, status: r.status }; });
    return (body) => {
      if (!body) return null;
      const { text: resolved, unresolved } = wingguyStore.resolveRuleBody(body, varMap, assetMap);
      const stillMissing = new Set(unresolved);
      return resolved.replace(
        /\{\{\s*(asset:)?([a-zA-Z0-9_.-]+)\s*\}\}/g,
        (whole, assetPrefix, key) => {
          const id = `${assetPrefix || ''}${key}`;
          if (!stillMissing.has(id)) return whole;
          return `[${key.replace(/[_-]+/g, ' ')} - not filled in yet]`;
        },
      );
    };
  }

  // What changed lately — client-layer instruction changes with before/after and notes attached.
  router.get('/setup/changes', async (req, res) => {
    const tenantId = req.client.clientId;
    try {
      const titles = require('../config/wingguyInstructionTitles');
      const { changes, openNotes } = await wingguyStore.getClientChangeLog({
        tenantId, limit: Number(req.query.limit) || 30,
      });
      const humanise = await bodyHumaniser(tenantId);
      return res.json({
        ok: true,
        // Who this visitor's actions would be signed as - the token decides (assistant name, or
        // the client's first name). The page shows it on the note box.
        you: pageName(req),
        openNotes,
        changes: changes.map((c) => ({
          id: c.id,
          kind: c.kind,
          when: c.createdAt,
          who: whoFromActor(c.actor),
          housekeeping: isHousekeepingActor(c.actor),
          action: c.action,
          ruleKey: c.ruleKey,
          title: c.kind === 'blank' ? blankLabelFor(c.ruleKey) : titles.titleFor(c.ruleKey),
          // An empty string is "was empty" - render it as nothing there, not a blank quote.
          fromValue: c.fromValue || null,
          toValue: c.toValue || null,
          blankStatus: c.blankStatus,
          changeNote: c.changeNote,
          summary: c.summary,
          // An entry with a previous version can be put back; one that added an instruction can
          // only be undone by removing it. Either way the page says which, in those words.
          // Blanks get no undo door: changing one back is a single field on the setup page.
          undo: c.kind === 'blank' ? null : (c.action === 'retire' ? null : (c.beforeBody ? 'restore' : 'remove')),
          beforeBody: humanise(c.beforeBody),
          afterBody: humanise(c.afterBody),
          notes: c.notes.map((note) => ({
            id: Number(note.id),
            when: note.created_at,
            author: note.author || 'unsigned',
            note: note.note,
            resolvedAt: note.resolved_at,
            resolvedBy: note.resolved_by,
          })),
        })),
      });
    } catch (e) {
      logger.error(`[Wingguy] change log read failed for ${tenantId}: ${e.message}`);
      return res.status(500).json({ ok: false, error: 'Could not load the change history.' });
    }
  });

  // Leave a note on a change. Notes never alter instructions — they sit in the margin.
  router.post('/setup/change-note', async (req, res) => {
    const tenantId = req.client.clientId;
    const { historyId, note } = req.body || {};
    try {
      const r = await wingguyStore.addChangeNote({
        tenantId, historyId, note, author: pageName(req) || null,
      });
      logger.info(`[Wingguy] change note #${r.id} left on change ${historyId} for ${tenantId}`);
      return res.json({ ok: true, id: r.id });
    } catch (e) {
      logger.error(`[Wingguy] change note failed for ${tenantId}: ${e.message}`);
      return res.status(400).json({ ok: false, error: e.message });
    }
  });

  // "Sorted" — tick a note off once it has been read and acted on.
  router.post('/setup/change-note-resolve', async (req, res) => {
    const tenantId = req.client.clientId;
    const { noteId } = req.body || {};
    try {
      const r = await wingguyStore.resolveChangeNote({
        tenantId, noteId, resolvedBy: pageName(req) || null,
      });
      return res.json({ ok: true, resolved: r.resolved });
    } catch (e) {
      logger.error(`[Wingguy] change note resolve failed for ${tenantId}: ${e.message}`);
      return res.status(400).json({ ok: false, error: e.message });
    }
  });

  // Write and keep one change's plain-English line. Shared by the commit hook (fire-and-forget,
  // so nobody waits) and the review page's first-open backfill. Safe to call twice - the store
  // keeps the first summary and ignores later ones.
  async function summariseChange(tenantId, historyId) {
    if (!isAnthropicConfigured()) return null;
    const existing = await wingguyStore.getChangeSummary({ tenantId, historyId });
    if (existing) return existing;
    const entry = await wingguyStore.getChangeEntry({ tenantId, historyId });
    if (!entry) return null;
    const titles = require('../config/wingguyInstructionTitles');
    const humanise = await bodyHumaniser(tenantId);
    const variableRows = await wingguyStore.getVariables({ tenantId });
    const raw = await runAssistModel(getAnthropicClient(),
      'You explain a change to a business owner\'s own writing instructions, in their terms. Warm, plain, brief. Never use the instruction\'s internal shorthand without explaining it. Reply with JSON only: {"text": string}. British/Australian spelling. No em dashes - use " - ".',
      `Their setup so far:\n${tenantVoiceContext(variableRows)}\n\nThe instruction ("${titles.titleFor(entry.ruleKey)}") as it stands now:\n---\n${humanise(entry.afterBody) || '(the instruction was removed)'}\n---${entry.beforeBody ? `\n\nWhat it said BEFORE this change:\n---\n${humanise(entry.beforeBody)}\n---` : '\n\n(There was no previous version - this change ADDED the instruction.)'}\n\nIn ONE or TWO sentences, say what this instruction makes Wingguy do - and if there was a previous version, what is different now. Address the business owner as "you". Plain English, no jargon, never quote the instruction text back.`,
      400);
    const text = String(extractJson(raw).text || '').trim();
    if (text) await wingguyStore.setChangeSummary({ tenantId, historyId, summary: text });
    return text;
  }

  // Explaining a change, in four depths. Platform key, same page principle as /setup/assist.
  //
  //   summary  one or two sentences, CACHED forever - the line the page leads with, so a reader
  //            never meets the raw instruction first. Written at commit time going forward;
  //            filled in on first open for changes made before this existed.
  //   detail   several paragraphs, on request
  //   impact   what it changes about the messages, on request
  //   example  what it looks like in practice - ALWAYS on request, never automatic: a worked
  //            example earns its place on a change that alters the SHAPE of something, and is
  //            pure noise on "never say delighted", where a whole invented message teaches
  //            nothing. So the model picks the form: a full example, or the one line that would
  //            now read differently.
  router.post('/setup/change-explain', async (req, res) => {
    const tenantId = req.client.clientId;
    const { historyId, depth } = req.body || {};
    const titles = require('../config/wingguyInstructionTitles');
    if (!isAnthropicConfigured()) {
      return res.status(500).json({ ok: false, error: 'The explainer is not available right now.' });
    }
    try {
      if (depth === 'summary') {
        const text = await summariseChange(tenantId, historyId);
        if (text == null) return res.status(404).json({ ok: false, error: 'That change was not found.' });
        return res.json({ ok: true, depth, text });
      }
      const entry = await wingguyStore.getChangeEntry({ tenantId, historyId });
      if (!entry) return res.status(404).json({ ok: false, error: 'That change was not found.' });

      const humanise = await bodyHumaniser(tenantId);
      const variableRows = await wingguyStore.getVariables({ tenantId });
      const voice = tenantVoiceContext(variableRows);
      const anthropic = getAnthropicClient();
      const title = titles.titleFor(entry.ruleKey);
      const now = humanise(entry.afterBody) || '(the instruction was removed)';
      const was = entry.beforeBody
        ? `\n\nWhat it said BEFORE this change:\n---\n${humanise(entry.beforeBody)}\n---`
        : '\n\n(There was no previous version - this change ADDED the instruction.)';
      const context = `Their setup so far:\n${voice}\n\nThe instruction ("${title}") as it stands now:\n---\n${now}\n---${was}`;
      logger.info(`[Wingguy] change-explain depth=${depth} change=${historyId} client=${tenantId}`);

      if (depth === 'example') {
        const raw = await runAssistModel(anthropic,
          'You show a business owner what one of their writing instructions looks like in practice. FIRST judge which form actually helps:\n- "worked" when the instruction shapes a whole message (a new kind of email, a structure, a flow) - then show that message.\n- "fragment" when the instruction is a constraint applied inside otherwise-normal writing (a banned word, a length limit, a timing rule) - then show ONE short line as it would have read before and as it reads now. A whole invented message teaches nothing about a constraint.\nReply with JSON only: {"form": "worked"|"fragment", "intro": string, "text": string, "before": string|null, "after": string|null}. intro is one line setting the scene ("an imaginary mortgage broker in Parramatta" / "a line from a follow-up email"). For worked: text is the message, before/after null. For fragment: before and after are the two short lines, text empty. Use their real setup so it is their world, not a generic sample. British/Australian spelling. No em dashes - use " - ".',
          `${context}\n\nShow what this instruction produces.`, 900);
        const j = extractJson(raw);
        return res.json({
          ok: true, depth, form: j.form === 'fragment' ? 'fragment' : 'worked',
          intro: String(j.intro || ''), text: String(j.text || ''),
          before: j.before ? String(j.before) : null, after: j.after ? String(j.after) : null,
        });
      }

      const ask = depth === 'detail'
        ? 'Explain it properly in 3 short paragraphs: what it does, when it kicks in, and what they would visibly notice about the writing. Plain spoken English, no jargon, never restate it line by line.'
        : depth === 'impact'
          ? 'Explain what this actually changes about the messages and emails Wingguy writes for them - the visible difference. 3-5 short sentences.'
          : 'In ONE or TWO sentences, say what this instruction makes Wingguy do - and if there was a previous version, what is different now. Address the business owner as "you". Plain English, no jargon, never quote the instruction text back.';
      const raw = await runAssistModel(anthropic,
        'You explain a change to a business owner\'s own writing instructions, in their terms. Warm, plain, brief. Never use the instruction\'s internal shorthand without explaining it. Reply with JSON only: {"text": string}. British/Australian spelling. No em dashes - use " - ".',
        `${context}\n\n${ask}`, depth === 'detail' ? 900 : 400);
      const text = String(extractJson(raw).text || '').trim();
      if (depth === 'summary' && text) {
        await wingguyStore.setChangeSummary({ tenantId, historyId, summary: text });
      }
      return res.json({ ok: true, depth, text });
    } catch (e) {
      logger.error(`[Wingguy] change-explain (${depth}) failed for ${tenantId}: ${e.message}`);
      return res.status(500).json({ ok: false, error: 'That did not work - try again in a moment.' });
    }
  });

  // Undo a change. Never a delete: putting the old wording back is itself a new version, and
  // removing an added instruction retires it - both land in the history like any other change,
  // so the review page tells the whole story including the reversals.
  router.post('/setup/change-undo', async (req, res) => {
    const tenantId = req.client.clientId;
    const { historyId } = req.body || {};
    try {
      const entry = await wingguyStore.getChangeEntry({ tenantId, historyId });
      if (!entry) return res.status(404).json({ ok: false, error: 'That change was not found.' });
      const who = pageName(req);
      const by = `portal:${tenantId}${who ? `:as:${who}` : ''}`;

      if (entry.beforeBody) {
        await wingguyStore.commitRule({
          layer: 'client', tenantId, ruleKey: entry.ruleKey,
          context: entry.context, ruleType: entry.ruleType,
          body: entry.beforeBody,
          changeNote: `Undone from the review page${who ? ` by ${who}` : ''}: put back the wording from before that change`,
          createdBy: by, expectedVersion: entry.liveVersion,
          actorTenantId: tenantId, via: 'door', action: 'revert',
        });
        logger.info(`[Wingguy] change ${historyId} undone (restored) for ${tenantId}`);
        return res.json({ ok: true, undone: 'restore' });
      }

      await wingguyStore.retireRule({
        layer: 'client', tenantId, ruleKey: entry.ruleKey,
        expectedVersion: entry.liveVersion,
        changeNote: `Undone from the review page${who ? ` by ${who}` : ''}: removed the instruction that change added`,
        createdBy: by, actorTenantId: tenantId, via: 'door',
      });
      logger.info(`[Wingguy] change ${historyId} undone (removed) for ${tenantId}`);
      return res.json({ ok: true, undone: 'remove' });
    } catch (e) {
      const friendly = /version conflict/.test(e.message)
        ? 'That instruction has changed again since - reopen the page and take another look before undoing.'
        : e.message;
      logger.error(`[Wingguy] change undo failed for ${tenantId}: ${e.message}`);
      return res.status(409).json({ ok: false, error: friendly });
    }
  });

  app.use('/api/wingguy', router);
};
