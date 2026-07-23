// services/wingguyRulesSource.js
// Wingguy — the RULES SOURCE seam (convergence roadmap STEP 2, 2026-07-05).
//
// ONE module decides where the drafting rules come from:
//   WINGGUY_RULES_SOURCE=config  (DEFAULT) — the hard-coded config/wingguyTemplates.js copy,
//                                 byte-identical to pre-step-2 behaviour. The store path ships dark.
//   WINGGUY_RULES_SOURCE=store   — the Postgres rules store (services/wingguyRulesStore.js,
//                                 seeded from the Notion corpus 2026-07-05), rendered per surface
//                                 via renderRulesBlock(). The flip = one Render env var.
//
// HARNESS vs RULES — the split that makes "delete the config file" honest:
//   RULES   = voice, message structure, campaign wording, playbook logic → the store owns these.
//   HARNESS = task framing, grounding/output contracts, TOOL behaviour (the agent instructions,
//             the reply-engine task block) → CODE owns these; the Notion import deliberately
//             excluded chat-tooling content. In store mode we still reuse the harness constants
//             from config/wingguyTemplates.js (WINGGUY_REPLY_INSTRUCTIONS, WINGGUY_AGENT_
//             INSTRUCTIONS) — on boat-burning day (~2 weeks stable after the flip) those MOVE
//             into this module and the TEMPLATES/VOICE rules content is deleted with the file.
//
// SHADOW-COMPARE (the flip-safety week): while source=config, every draft surface also renders
// what the store WOULD say and logs ONE line (prefix WINGGUY-SHADOW) — store render health,
// which campaign each side detected, rule count, unresolved {{tokens}}. Fire-and-forget: a
// store failure can never touch a live draft. Disable via WINGGUY_RULES_SHADOW=false.
// "Clean week" = renders green, zero unresolved, detection agreement (or explained disagreements).
//
// Campaign ids: config mode keeps tks/frac. Store mode uses the seeded campaigns —
// generic (= the old tks, campaign NULL in the store) / frac / broker / financial-planner —
// detected from the campaign-markers rule (the registry the import drafted; edit it through
// the door, never here). 'tks' arriving from a stale extension is aliased to generic.

const configTemplates = require('../config/wingguyTemplates');
const store = require('./wingguyRulesStore');

const DEFAULT_TENANT = store.DEFAULT_TENANT;

// Contexts each surface reads from the store ('global' is always included by renderRulesBlock).
const SURFACE_CONTEXTS = {
  'draft-thanks': ['outreach'],
  'draft-reply': ['reply'],
  chat: ['outreach', 'reply', 'booking', 'follow-up'],
};

// Store-mode task harness for the single-shot draft surfaces (replaces WINGGUY_VOICE's task
// framing; the voice/structure content itself now comes from the rendered rulebook). The
// grounding contract stays CODE — it's the model-failure-mode guard, not a coach preference.
const STORE_DRAFT_HARNESS = `You are drafting a short, personal LinkedIn message on the coach's behalf, in the coach's own voice. The coach's RULEBOOK below is authoritative for voice, structure, tone and campaign wording — follow it closely, and match any worked examples' shape without copying them verbatim.

GROUNDING RULES (these override fluency — a plain grounded line beats a smooth invented one):
- GROUND THE FACTS. Use ONLY details present in the supplied profile / conversation. Never invent companies, roles, events or claims, and never assert a trait that isn't clearly stated.
- If the profile is genuinely thin (no usable hook), keep it warm and generic rather than inventing one.

OUTPUT: return ONLY the message text, ready to paste — nothing else. No preamble, no quotes, no subject line, and NO notes or commentary about the draft.`;

const RULEBOOK_PREAMBLE = `THE COACH'S RULEBOOK (authoritative voice, playbook and campaign rules — follow these):`;

function parseBool(val, defaultValue) {
  if (val === undefined || val === null || val === '') return defaultValue;
  const s = String(val).toLowerCase().trim();
  return s === '1' || s === 'true' || s === 'yes' || s === 'on';
}

/** Which source is live. Read at CALL time (not module load) so tests and the flip need no restart. */
function getSource() {
  return String(process.env.WINGGUY_RULES_SOURCE || '').toLowerCase().trim() === 'store' ? 'store' : 'config';
}

/** Shadow-compare is on by default while source=config (the pre-flip observation week). */
function isShadowEnabled() {
  return getSource() === 'config' && parseBool(process.env.WINGGUY_RULES_SHADOW, true);
}

// ---------------------------------------------------------------------------
// Campaign detection (store mode) — the campaign-markers registry rule
// ---------------------------------------------------------------------------

/**
 * Parse the campaign-markers rule body into { slug: [lowercased phrases] }.
 * Recognised shape (what the import seeded; edited through the door):
 *   **frac** markers:
 *   - "phrase one"
 *   - "variant a" / "variant b"
 * Any other non-bullet line ENDS the current section — so the "Shared ... markers" list
 * (ambiguous between campaigns by definition) is deliberately NOT used for auto-detection.
 */
function parseCampaignMarkers(body) {
  const out = {};
  let current = null;
  for (const raw of String(body || '').split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const header = line.match(/^\*\*([a-z0-9-]+)\*\*\s*markers\s*:/i);
    if (header) {
      current = header[1].toLowerCase();
      if (!out[current]) out[current] = [];
      continue;
    }
    const bullet = line.match(/^-\s*(.+)$/);
    if (bullet && current) {
      for (const piece of bullet[1].split('/')) {
        const phrase = piece.replace(/^[\s"“”']+|[\s"“”']+$/g, '').toLowerCase();
        if (phrase) out[current].push(phrase);
      }
      continue;
    }
    current = null; // prose / shared-section boundary
  }
  return out;
}

// Same signal sources as the config detector: the connection-request note (= first thread
// message) + the profile — lowercased into one haystack.
function detectionContext(profile = {}, conversation = []) {
  const firstMsg = (Array.isArray(conversation) && conversation.length)
    ? String((conversation[0] && conversation[0].text) || '')
    : '';
  return [
    firstMsg,
    profile.connectionMessage,
    profile.headline,
    profile.about,
    profile.pageText,
  ].filter(Boolean).join('\n').toLowerCase();
}

async function getCampaignMarkers(tenantId) {
  const rules = await store.getActiveRules({ tenantId, contexts: ['global'] });
  const markersRule = rules.find((r) => r.rule_key === 'campaign-markers');
  return markersRule ? parseCampaignMarkers(markersRule.body) : {};
}

/** Store-mode detection: most marker matches wins; tie or no signal = generic (= correct). */
async function detectCampaignFromStore(profile, conversation, tenantId) {
  const markers = await getCampaignMarkers(tenantId);
  const haystack = detectionContext(profile, conversation);
  let best = null;
  let bestCount = 0;
  let tied = false;
  for (const [slug, phrases] of Object.entries(markers)) {
    const count = phrases.filter((p) => haystack.includes(p)).length;
    if (count > bestCount) { best = slug; bestCount = count; tied = false; }
    else if (count === bestCount && count > 0) tied = true;
  }
  return (best && bestCount > 0 && !tied) ? best : 'generic';
}

// Store campaign id → the renderRulesBlock campaign arg (generic = no campaign in play).
function storeCampaignArg(id) {
  const slug = String(id || '').toLowerCase().trim();
  return (!slug || slug === 'generic' || slug === 'tks' || slug === 'auto') ? undefined : slug;
}

function campaignLabel(slug) {
  if (slug === 'generic') return 'General';
  return String(slug).split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

// ---------------------------------------------------------------------------
// The template surface the routes/chat consume (source-agnostic)
// ---------------------------------------------------------------------------

/** The quick-pick button set. Config: the config list. Store: generic + the registry's campaigns. */
async function listTemplates({ tenantId = DEFAULT_TENANT } = {}) {
  if (getSource() === 'config') return configTemplates.listTemplates();
  const markers = await getCampaignMarkers(tenantId);
  const campaigns = Object.keys(markers).sort();
  return [
    { id: 'generic', label: 'General', useWhen: 'Any worthwhile new connection — the default.', detectionKeywords: [], isDefault: true },
    ...campaigns.map((slug) => ({
      id: slug,
      label: campaignLabel(slug),
      useWhen: `The ${campaignLabel(slug).toLowerCase()} campaign — detected from its marker phrases in the thread.`,
      detectionKeywords: markers[slug],
      isDefault: false,
    })),
  ];
}

/** Pick the campaign/template for this profile+thread. Returns an id valid for getTemplate(). */
async function detectTemplate(profile, conversation, { tenantId = DEFAULT_TENANT } = {}) {
  if (getSource() === 'config') return configTemplates.detectTemplate(profile, conversation);
  return detectCampaignFromStore(profile, conversation, tenantId);
}

/**
 * Template descriptor by id. Config: the full config template (instructions, signoff…).
 * Store: a light descriptor — the CONTENT lives in the rendered rulebook, so instructions and
 * signoff are null (sign-offs are in the campaign rule bodies / voice prefs). Unknown id = null
 * (routes 400 on that, same as today). 'tks' is aliased to generic for stale extensions.
 */
async function getTemplate(id, { tenantId = DEFAULT_TENANT } = {}) {
  if (getSource() === 'config') return configTemplates.getTemplate(id);
  const slug = String(id || '').toLowerCase().trim() === 'tks' ? 'generic' : String(id || '').toLowerCase().trim();
  const valid = new Set(['generic', ...Object.keys(await getCampaignMarkers(tenantId))]);
  if (!valid.has(slug)) return null;
  return { id: slug, label: campaignLabel(slug), useWhen: '', detectionKeywords: [], isDefault: slug === 'generic', instructions: null, signoff: null, store: true };
}

// ---------------------------------------------------------------------------
// System-prompt assembly per surface
// ---------------------------------------------------------------------------

async function renderedRulebookBlock({ tenantId, surface, templateId }) {
  const { text, unresolved, ruleCount } = await store.renderRulesBlock({
    tenantId,
    contexts: SURFACE_CONTEXTS[surface] || [],
    campaign: storeCampaignArg(templateId),
  });
  if (!text) throw new Error(`rules store rendered EMPTY for ${surface} (tenant ${tenantId}) — is DATABASE_URL set and the store seeded?`);
  if (unresolved.length) {
    console.warn(`WINGGUY-RULES unresolved tokens in ${surface} render (tenant ${tenantId}): ${unresolved.join(', ')}`);
  }
  return { text: `${RULEBOOK_PREAMBLE}\n\n${text}`, unresolved, ruleCount };
}

/**
 * System blocks for POST /draft-thanks. Config mode is byte-identical to pre-step-2:
 * [ VOICE (cached), template.instructions ]. Store: [ harness, rendered rulebook (cached) ] —
 * the cache marker sits on the LAST stable block either way (prefix caching covers both).
 *
 * Cache TTL = 1h (not the 5-min default). The store-flip made the cached prefix ~25.5k tokens
 * and Guy works in a spread-out in-and-out rhythm, so a 5-min TTL went cold between messages →
 * near-full price every turn. 1h keeps it warm all session (write costs 2× vs 1.25×, reuse 0.1×;
 * break-even ~3 uses/hr, met in work sessions). GA on the first-party API — no beta header.
 */
async function draftSystem(templateId, { tenantId = DEFAULT_TENANT } = {}) {
  if (getSource() === 'config') {
    const template = configTemplates.getTemplate(templateId);
    if (!template) throw new Error(`unknown template "${templateId}"`);
    return [
      { type: 'text', text: configTemplates.WINGGUY_VOICE, cache_control: { type: 'ephemeral', ttl: '1h' } },
      { type: 'text', text: template.instructions },
    ];
  }
  const block = await renderedRulebookBlock({ tenantId, surface: 'draft-thanks', templateId });
  return [
    { type: 'text', text: STORE_DRAFT_HARNESS },
    { type: 'text', text: block.text, cache_control: { type: 'ephemeral', ttl: '1h' } },
  ];
}

/** System blocks for POST /draft-reply. The reply-engine task block is HARNESS — kept in both modes. */
async function replySystem({ tenantId = DEFAULT_TENANT } = {}) {
  if (getSource() === 'config') {
    return [
      { type: 'text', text: configTemplates.WINGGUY_VOICE, cache_control: { type: 'ephemeral', ttl: '1h' } },
      { type: 'text', text: configTemplates.WINGGUY_REPLY_INSTRUCTIONS },
    ];
  }
  const block = await renderedRulebookBlock({ tenantId, surface: 'draft-reply' });
  return [
    { type: 'text', text: configTemplates.WINGGUY_REPLY_INSTRUCTIONS },
    { type: 'text', text: block.text, cache_control: { type: 'ephemeral', ttl: '1h' } },
  ];
}

/**
 * System PREFIX blocks for the chat agent (wingguyChat appends its per-turn context block).
 * Config: [ VOICE, AGENT_INSTRUCTIONS (cached) ] + the campaign template embedded in the
 * context by the caller — exactly today's shape. Store: the rendered rulebook (outreach+reply+
 * booking, campaign-shadowed) REPLACES both VOICE and the context's CAMPAIGN TEMPLATE block,
 * so campaignTemplate comes back null and buildContext skips that section.
 */
async function agentSystem(templateId, { tenantId = DEFAULT_TENANT } = {}) {
  if (getSource() === 'config') {
    return {
      blocks: [
        { type: 'text', text: configTemplates.WINGGUY_VOICE },
        { type: 'text', text: configTemplates.WINGGUY_AGENT_INSTRUCTIONS, cache_control: { type: 'ephemeral', ttl: '1h' } },
      ],
      campaignTemplate: configTemplates.getTemplate(templateId) || configTemplates.getTemplate(configTemplates.DEFAULT_TEMPLATE_ID),
    };
  }
  const block = await renderedRulebookBlock({ tenantId, surface: 'chat', templateId });
  return {
    blocks: [
      { type: 'text', text: block.text },
      { type: 'text', text: configTemplates.WINGGUY_AGENT_INSTRUCTIONS, cache_control: { type: 'ephemeral', ttl: '1h' } },
    ],
    campaignTemplate: null,
  };
}

// ---------------------------------------------------------------------------
// Shadow-compare (the pre-flip observation week)
// ---------------------------------------------------------------------------

// Config ids mapped into store terms so "agree" means something: tks = generic by ruling.
function toStoreCampaignId(configId) {
  return String(configId || '').toLowerCase().trim() === 'tks' ? 'generic' : String(configId || '').toLowerCase().trim();
}

let shadowSkipNoted = false;

/**
 * Fire-and-forget: render what the store WOULD say for this request and log ONE line.
 * NEVER throws, never blocks the live draft — call without await.
 */
function shadowCompare({ surface, profile, conversation, configTemplateId, tenantId = DEFAULT_TENANT }) {
  if (!isShadowEnabled()) return;
  if (!(process.env.DATABASE_URL || '').trim()) {
    if (!shadowSkipNoted) { console.log('WINGGUY-SHADOW skipped: DATABASE_URL not set'); shadowSkipNoted = true; }
    return;
  }
  const started = Date.now();
  (async () => {
    const storeId = await detectCampaignFromStore(profile || {}, conversation || [], tenantId);
    const { text, unresolved, ruleCount } = await store.renderRulesBlock({
      tenantId,
      contexts: SURFACE_CONTEXTS[surface] || [],
      campaign: storeCampaignArg(storeId),
    });
    // draft-reply has no config-side campaign detection — nothing to agree/disagree with.
    const agree = configTemplateId ? (toStoreCampaignId(configTemplateId) === storeId ? 'yes' : 'NO') : 'n/a';
    console.log(
      `WINGGUY-SHADOW surface=${surface} configCampaign=${configTemplateId || '-'} storeCampaign=${storeId} ` +
      `agree=${agree} rules=${ruleCount} unresolved=${unresolved.length}${unresolved.length ? `(${unresolved.join(',')})` : ''} ` +
      `chars=${text.length} ms=${Date.now() - started}`,
    );
  })().catch((e) => {
    console.error(`WINGGUY-SHADOW surface=${surface} FAILED after ${Date.now() - started}ms: ${e.message}`);
  });
}

module.exports = {
  getSource,
  isShadowEnabled,
  listTemplates,
  detectTemplate,
  getTemplate,
  draftSystem,
  replySystem,
  agentSystem,
  shadowCompare,
  // exported for tests
  parseCampaignMarkers,
  storeCampaignArg,
  SURFACE_CONTEXTS,
  STORE_DRAFT_HARNESS,
};
