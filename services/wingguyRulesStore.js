/**
 * Wingguy rules store — the ONE rulebook (convergence roadmap step 1).
 *
 * Postgres store for every tenant's Wingguy rules ("the second brain"), with the single
 * conflict-checked WRITE-DOOR: this module is the only code path that inserts rule rows.
 * The MCP tools and the one-time Notion import script all route through here.
 *
 * Design: docs/wingguy.md → "Rules store (roadmap step 1) — detailed design, APPROVED (2026-07-04)".
 * House style: recallWebhookDb.js (lazy Pool, ensureSchema CREATE-IF-NOT-EXISTS, no migrations;
 * tenant key = coach_client_id convention, 'Guy-Wilson' = tenant 0).
 *
 * Tables:
 *   wingguy_rules             — append-only: one row per VERSION of a rule; edits insert n+1
 *                               and retire n; body is never UPDATEd, rows never DELETEd.
 *   wingguy_variable_catalog  — the known {{variables}} (becomes the onboarding form)
 *   wingguy_tenant_variables  — each tenant's values
 *   wingguy_assets            — per-tenant asset library ({{asset:key}} targets)
 *   wingguy_asset_ledger      — append-only record of which asset went to which lead (written by
 *                               wingguy_create_draft at DRAFT time — Wingguy records what it sent
 *                               itself instead of reading mailboxes; the asset-usage-gates rules
 *                               become enforceable via this, for every tenant, provider-free)
 *   wingguy_rule_history      — separate append-only audit of every door action
 *
 * Layer semantics:
 *   foundation — platform-wide, runtime-read by ALL tenants, Guy/platform edits only (tenant_id NULL)
 *   template   — the de-personalised seed; NOT runtime-read; provisioning copies template rows
 *                into a new client's own layer (seed-then-diverge) (tenant_id NULL)
 *   client     — the tenant's own rules (tenant_id required)
 *
 * Runtime read = foundation ∪ client(tenant), WITH cross-layer shadowing (built 2026-07-31 —
 * the "client-override shadowing" this file's v1 note and docs/wingguy.md both flagged as a
 * later feature). Foundation rules carry a TIER:
 *   locked   — the guardrails. Never overridable; a client rule of the same key is REFUSED at
 *              the door, and any pre-existing one is suppressed at render (foundation wins).
 *   standard — shared by default, improved centrally, but a tenant MAY keep their own version.
 *              An active client rule of the same (rule_key, campaign) REPLACES it for that
 *              tenant — it does not stack. `tier` is NULL for template/client rows and defaults
 *              to 'standard' when unset on a foundation row.
 * This is what makes the third middle option real: before it, an instruction was either locked
 * in foundation (nobody could adapt it) or handed over via template (the client owns a photocopy
 * and later central improvements never reach them).
 *
 * standard_version on a client row = the foundation version that rule was overriding when the
 * override was written. That is the drift marker: when the standard later moves past it, the
 * divergence view can say "the standard has changed since you took your own version, and here is
 * what it says now" without touching the tenant's copy. Recorded at OVERRIDE time rather than
 * fanned out to every tenant at foundation-commit time — same answer, one column, no push table,
 * and it self-clears the moment the tenant re-commits their override. NULL = override predates
 * this column (baseline unknown, reported honestly as such).
 *
 * Campaign overlay (proof-pass decision, 2026-07-04): a rule's identity is
 * (layer, tenant, rule_key, campaign) — the same rule_key may hold a generic version
 * (campaign NULL) AND campaign-tagged versions, each with its own version chain. At render
 * time the campaign version SHADOWS the generic for that rule_key when its campaign is in
 * play; no campaign (or no campaign match) falls through to the generic. One level only —
 * campaign → generic, never campaign → campaign.
 *
 * Step-1 auth posture: every caller is Guy; edit-authority by identity (owner/va/platform)
 * lands with step-3 per-person tokens. The door logs the layer prominently instead.
 */

const { Pool } = require('pg');
const { defaultFor } = require('../config/wingguyVariableDefaults');

let pool;
let schemaEnsured = false;

// --- Taxonomy (SIGNED OFF at the 2026-07-04 proof pass — six types are final; re-open only
// if the full import surfaces 2+ more quality-bar rules, per the session-4 close) -----------
const LAYERS = ['foundation', 'template', 'client'];
const CONTEXTS = ['global', 'outreach', 'reply', 'booking', 'post-call', 'follow-up'];
const RULE_TYPES = ['voice', 'formatting', 'stage-logic', 'scheduling', 'asset-usage', 'qualifying'];
const HISTORY_ACTIONS = ['commit', 'retire', 'revert', 'import', 'seed', 'variable-set', 'asset-set'];
// Foundation-only. 'standard' is the default because that is the safe read of an unset tier:
// overridable-but-shared. Locking is always a deliberate act (see setRuleTier / the tier script).
const TIERS = ['locked', 'standard'];
const DEFAULT_TIER = 'standard';

const DEFAULT_TENANT = 'Guy-Wilson';

// --- Who may write the SHARED drawers (2026-07-31) --------------------------------------------
// foundation and template belong to the PLATFORM, not to any one client: a foundation edit lands
// on every tenant at once, and a template edit lands on every client provisioned after it. Until
// now the only thing standing between a client's chat session and a platform-wide rewrite was
// prose in the tool description telling the model that drawer was "reserved for Guy/platform
// calls" — persuasion, not a gate. A client saying "make that a rule for everyone" is exactly the
// phrasing that talks a model into complying. This is the gate.
const SHARED_LAYERS = ['foundation', 'template'];
const PLATFORM_OWNER = (process.env.WINGGUY_PLATFORM_OWNER || DEFAULT_TENANT).trim();

function getPool() {
  if (pool) return pool;
  const url = (process.env.DATABASE_URL || '').trim();
  if (!url) return null;
  pool = new Pool({
    connectionString: url,
    ssl: { rejectUnauthorized: false },
  });
  return pool;
}

/** Test seam: inject a fake pool (unit tests never touch a real database). */
function __setTestPool(fake) {
  pool = fake;
  schemaEnsured = fake ? true : false;
}

async function ensureSchema(client) {
  if (schemaEnsured) return;

  await client.query(`
    CREATE TABLE IF NOT EXISTS wingguy_rules (
      id BIGSERIAL PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      retired_at TIMESTAMPTZ,
      rule_key TEXT NOT NULL,
      tenant_id TEXT,
      layer TEXT NOT NULL CHECK (layer IN ('foundation','template','client')),
      context TEXT NOT NULL CHECK (context IN ('global','outreach','reply','booking','post-call','follow-up')),
      rule_type TEXT NOT NULL CHECK (rule_type IN ('voice','formatting','stage-logic','scheduling','asset-usage','qualifying')),
      campaign TEXT,
      version INT NOT NULL,
      body TEXT NOT NULL,
      change_note TEXT,
      created_by TEXT,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','retired'))
    );
  `);
  // Three-tier + override tracking (2026-07-31). ADD COLUMN IF NOT EXISTS is the house-style
  // migration (this codebase has no migration files). Deliberately NO CHECK constraint on tier:
  // a CHECK on an existing table can only be widened by the DROP/ADD dance above, which already
  // cost us a live outage when two fresh connections raced it. Values are validated in code.
  await client.query(`ALTER TABLE wingguy_rules ADD COLUMN IF NOT EXISTS tier TEXT;`);
  await client.query(`ALTER TABLE wingguy_rules ADD COLUMN IF NOT EXISTS standard_version INT;`);

  // One ACTIVE version per rule identity — and identity INCLUDES campaign, so a generic
  // (campaign NULL) and a campaign-tagged version of the same rule_key coexist, each with its
  // own version chain. NULLs use COALESCE (tenant_id is NULL for foundation/template rows).
  // The pre-campaign index is dropped in place (store was empty when the identity widened).
  await client.query(`DROP INDEX IF EXISTS idx_wg_rules_one_active;`);
  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_wg_rules_one_active_camp
    ON wingguy_rules (layer, COALESCE(tenant_id, ''), rule_key, COALESCE(campaign, ''))
    WHERE status = 'active';
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_wg_rules_read
    ON wingguy_rules (COALESCE(tenant_id, ''), layer, context) WHERE status = 'active';
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS wingguy_variable_catalog (
      id BIGSERIAL PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      var_key TEXT NOT NULL UNIQUE,
      description TEXT,
      required BOOLEAN NOT NULL DEFAULT FALSE,
      example TEXT
    );
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS wingguy_tenant_variables (
      id BIGSERIAL PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      tenant_id TEXT NOT NULL,
      var_key TEXT NOT NULL,
      value TEXT,
      UNIQUE (tenant_id, var_key)
    );
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS wingguy_assets (
      id BIGSERIAL PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      tenant_id TEXT NOT NULL,
      asset_key TEXT NOT NULL,
      kind TEXT,
      url TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      UNIQUE (tenant_id, asset_key)
    );
  `);

  // Asset ledger — one row per (lead × asset) each time a draft carrying that asset is created.
  // sent_at = DRAFT time (Wingguy never sends; the coach sends from their mailbox — this is the
  // honest proxy, and the only one that needs no mailbox read).
  await client.query(`
    CREATE TABLE IF NOT EXISTS wingguy_asset_ledger (
      id BIGSERIAL PRIMARY KEY,
      sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      tenant_id TEXT NOT NULL,
      lead_email TEXT NOT NULL,
      asset_key TEXT NOT NULL,
      draft_id TEXT,
      thread_id TEXT,
      subject TEXT
    );
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_wg_ledger_lead
    ON wingguy_asset_ledger (tenant_id, lead_email, asset_key);
  `);

  // Edit pairs — learn-from-my-edit (design: docs/wingguy.md "Learn-from-my-edit", 2026-07-18).
  // One row per LinkedIn send where the human materially changed Wingguy's draft: the extension
  // logs {generated, sent} silently on Send; "review my edits" in chat reads the pending rows,
  // discusses the pattern, and routes any rule change through the normal propose→commit door.
  // Byte-identical (after whitespace normalisation) sends are never stored — no diff, no row.
  await client.query(`
    CREATE TABLE IF NOT EXISTS wingguy_edit_pairs (
      id BIGSERIAL PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      tenant_id TEXT NOT NULL,
      lead_name TEXT,
      lead_url TEXT,
      surface TEXT NOT NULL DEFAULT 'linkedin',
      generated TEXT NOT NULL,
      sent TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','reviewed','dismissed')),
      reviewed_at TIMESTAMPTZ,
      review_note TEXT
    );
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_wg_edit_pairs_pending
    ON wingguy_edit_pairs (tenant_id, created_at DESC) WHERE status = 'pending';
  `);

  // Draft ledger — the EMAIL half of learn-from-my-edit. wingguy_create_draft logs the generated
  // body (plain-text render) here at draft time; the review tool later settles each row by reading
  // the sent message back through Nylas and, if the human edited it in Gmail, files a
  // wingguy_edit_pairs row (surface='email'). Statuses: awaiting-send → paired | no-diff | expired.
  await client.query(`
    CREATE TABLE IF NOT EXISTS wingguy_draft_ledger (
      id BIGSERIAL PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      tenant_id TEXT NOT NULL,
      draft_id TEXT,
      thread_id TEXT,
      to_email TEXT NOT NULL,
      subject TEXT,
      generated TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'awaiting-send' CHECK (status IN ('awaiting-send','paired','no-diff','expired')),
      settled_at TIMESTAMPTZ
    );
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_wg_draft_ledger_awaiting
    ON wingguy_draft_ledger (tenant_id, created_at) WHERE status = 'awaiting-send';
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS wingguy_rule_history (
      id BIGSERIAL PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      actor TEXT,
      action TEXT NOT NULL CHECK (action IN ('commit','retire','revert','import','seed','variable-set','asset-set')),
      layer TEXT,
      tenant_id TEXT,
      rule_key TEXT,
      from_version INT,
      to_version INT,
      detail JSONB
    );
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_wg_history_rule
    ON wingguy_rule_history (rule_key, COALESCE(tenant_id, ''));
  `);
  // Migration: the action CHECK on an already-created history table can't be widened by the
  // CREATE ... IF NOT EXISTS above. Re-assert it so existing DBs accept newer actions ('seed').
  // ONE atomic DO block that swallows the duplicate: the old drop-then-add pair raced when two
  // fresh processes/connections ensured concurrently (B drops, A adds, B adds → "already exists"),
  // which made renderRulesBlock fail in job processes and the brief drafts fall back to PLAIN
  // VOICE (observed live 2026-07-23).
  await client.query(`
    DO $$
    BEGIN
      ALTER TABLE wingguy_rule_history DROP CONSTRAINT IF EXISTS wingguy_rule_history_action_check;
      ALTER TABLE wingguy_rule_history ADD CONSTRAINT wingguy_rule_history_action_check
        CHECK (action IN ('commit','retire','revert','import','seed','variable-set','asset-set'));
    EXCEPTION WHEN duplicate_object OR duplicate_table THEN
      NULL; -- another connection won the race — the constraint exists, which is all we want
    END
    $$;
  `);

  schemaEnsured = true;
}

// ---------------------------------------------------------------------------
// Pure core (unit-tested directly — no database involved)
// ---------------------------------------------------------------------------

/**
 * Validate a rule's taxonomy + layer/tenant pairing. Throws with a message that names the
 * allowed values (these errors surface verbatim in chat via the MCP tools, so they teach).
 */
function validateRuleInput({ layer, tenantId, ruleKey, context, ruleType, tier }) {
  if (!LAYERS.includes(layer)) {
    throw new Error(`invalid layer "${layer}" — must be one of: ${LAYERS.join(', ')}`);
  }
  if (!CONTEXTS.includes(context)) {
    throw new Error(`invalid context "${context}" — must be one of: ${CONTEXTS.join(', ')}`);
  }
  if (!RULE_TYPES.includes(ruleType)) {
    throw new Error(`invalid rule_type "${ruleType}" — must be one of: ${RULE_TYPES.join(', ')}`);
  }
  const key = String(ruleKey || '').trim();
  if (!/^[a-z0-9][a-z0-9-]{1,80}$/.test(key)) {
    throw new Error(`invalid rule_key "${ruleKey}" — use a stable kebab-case slug (a-z, 0-9, dashes)`);
  }
  const tenant = (tenantId || '').trim();
  if (layer === 'client' && !tenant) {
    throw new Error('layer "client" requires a tenant_id');
  }
  if (layer !== 'client' && tenant) {
    throw new Error(`layer "${layer}" is tenant-less — do not pass tenant_id (got "${tenant}")`);
  }
  const t = (tier || '').trim();
  if (t) {
    if (layer !== 'foundation') {
      throw new Error(`tier is a FOUNDATION property — layer "${layer}" must not carry one (got "${t}")`);
    }
    if (!TIERS.includes(t)) {
      throw new Error(`invalid tier "${t}" — must be one of: ${TIERS.join(', ')}`);
    }
  }
  return { key, tenant: tenant || null, tier: t || null };
}

/**
 * GUARD — may this caller write this drawer? Throws if not. Called first thing by every write
 * path in this file, so no code route can skip it (the same posture as the locked-tier refusal).
 *
 * `via` says what kind of caller this is, and it FAILS CLOSED:
 *   'door'     — a chat/MCP call. `actorTenantId` is required and must be the platform owner for
 *                a shared drawer. This is the default, so a new call path that forgets to declare
 *                itself gets refused loudly rather than silently waved through.
 *   'internal' — server-side ops running the deployed code (the import, the tier script, the
 *                smoke test). Deploy access is already a higher trust level than a chat session;
 *                declaring it is a deliberate act, visible in the script.
 *
 * The CLIENT drawer is unguarded on purpose: it is the tenant's own, and every client-layer write
 * is already scoped to the caller's own tenant by the door.
 */
function assertMayWriteLayer({ layer, actorTenantId, via = 'door' } = {}) {
  if (!SHARED_LAYERS.includes(layer)) return;
  if (via === 'internal') return;
  if (via !== 'door') throw new Error(`invalid via "${via}" — must be "door" or "internal"`);
  const actor = String(actorTenantId || '').trim();
  if (!actor) {
    const e = new Error(
      `changing the SHARED "${layer}" instructions needs an identified caller, and this call did not carry one. ` +
      `This is refused by default — shared instructions reach every client at once.`,
    );
    e.code = 'WG_NO_ACTOR';
    throw e;
  }
  if (actor.toLowerCase() !== PLATFORM_OWNER.toLowerCase()) {
    const e = new Error(
      `"${actor}" cannot change the SHARED instructions. The "${layer}" drawer is platform-wide: a change there ` +
      `lands on EVERY client at once, so only the platform owner may edit it. Your own instructions (the "client" ` +
      `layer) are yours to change freely — save this as your own version instead.`,
    );
    e.code = 'WG_NOT_PLATFORM_OWNER';
    throw e;
  }
}

/** A foundation rule's effective tier (unset = standard). NULL for template/client rows. */
function ruleTier(rule) {
  if (!rule || rule.layer !== 'foundation') return null;
  return TIERS.includes(rule.tier) ? rule.tier : DEFAULT_TIER;
}

/**
 * Resolve {{variable}} and {{asset:key}} placeholders in a rule body.
 * Returns { text, unresolved } — unresolved placeholders are left in place and reported,
 * never silently dropped (a rendered prompt with a hole should be visible, not invisible).
 */
// Self-referential syntax mentions: rule prose that DOCUMENTS the placeholder syntax by its
// canonical name ("{{asset:key}}", "{{variable}}") rather than using it. Stays literal and is
// NOT reported unresolved — it's documentation, not a hole. Consequence: no real asset may be
// keyed "key" and no real variable may be named "variable"; both would be unreachable here.
// Placeholders that instructions PRINT as syntax documentation ("reference it here as
// {{asset:your_key}}") rather than expecting resolved. Treating these as missing values turns an
// explanation into a fake error on the client's setup page.
const META_SYNTAX_MENTIONS = new Set(['asset:key', 'asset:your_key', 'variable']);

/**
 * OPTIONAL placeholders: `{{?key}}`.
 *
 * A normal `{{key}}` that has no value is left in the text verbatim and reported as unresolved —
 * correct for a required variable (a rule about the coach's sign-off is broken without one, and
 * the braces are the loud signal). It is exactly wrong for a variable that is legitimately blank
 * most of the time, because the literal `{{...}}` then goes to the model in every message.
 *
 * `{{?key}}` says "this line only exists when there is a value". Unset or empty → the whole LINE
 * is dropped, and it is NOT reported as unresolved (nothing is missing; there is simply nothing to
 * say). A rule whose every line drops resolves to empty and falls out of the assembled block, so
 * an unanswered optional setting costs nothing rather than emitting a dangling sentence.
 *
 * Line-level rather than token-level on purpose: "Never use these words: " with nothing after it
 * is worse than no instruction at all.
 */
function stripOptionalPlaceholders(body, variables, assets = {}) {
  if (!/\{\{\s*\?/.test(String(body || ''))) return String(body || '');
  // `asset:` is part of the key here — an optional LINK ({{?asset:default_explainer}}) is just as
  // legitimate as an optional variable, and leaving it out silently left the placeholder in the
  // text as literal braces, which is the exact bug optional syntax exists to prevent.
  const OPTIONAL = /\{\{\s*\?\s*((?:asset:)?[a-zA-Z0-9_.-]+)\s*\}\}/g;
  const hasValue = (key) => {
    if (key.startsWith('asset:')) {
      const a = assets[key.slice('asset:'.length)];
      return !!(a && a.url && String(a.url).trim() && a.status !== 'retired');
    }
    const v = variables[key];
    return v !== undefined && v !== null && String(v).trim().length > 0;
  };
  return String(body)
    .split('\n')
    .filter((line) => {
      const keys = [...line.matchAll(OPTIONAL)].map((m) => m[1]);
      if (!keys.length) return true;
      // One empty optional on the line is enough to drop it — the line was written to carry it.
      return keys.every(hasValue);
    })
    .join('\n')
    // Surviving lines keep their values; rewrite `{{?key}}` to `{{key}}` for the main pass below.
    .replace(OPTIONAL, (_w, key) => `{{${key}}}`);
}

function resolveRuleBody(body, variables = {}, assets = {}) {
  const unresolved = [];
  const prepared = stripOptionalPlaceholders(body, variables, assets);
  const text = String(prepared).replace(/\{\{\s*(asset:)?([a-zA-Z0-9_.-]+)\s*\}\}/g, (whole, assetPrefix, key) => {
    if (META_SYNTAX_MENTIONS.has(`${assetPrefix || ''}${key}`)) return whole;
    if (assetPrefix) {
      const a = assets[key];
      if (a && a.url && a.status !== 'retired') return a.url;
      unresolved.push(`asset:${key}`);
      return whole;
    }
    const v = variables[key];
    if (v !== undefined && v !== null && String(v).length) return String(v);
    // Unset, but some settings have an obvious sensible answer (30 minutes, a 9am floor, "call").
    // Using it beats emitting a literal {{placeholder}} into the prompt, and it is what lets the
    // setup page honestly say these are already set sensibly. Keys with no safe default are
    // absent from the map and still render loudly - see config/wingguyVariableDefaults.js.
    const fallback = defaultFor(key, variables);
    if (fallback !== undefined) return String(fallback);
    unresolved.push(key);
    return whole;
  });
  return { text, unresolved };
}

/**
 * Resolve a raw foundation ∪ client set down to the ONE rule that actually applies per rule_key.
 * Pure, and the single place both shadowing rules live. Two passes, in this order:
 *
 *   1. CAMPAIGN overlay, WITHIN a layer (unchanged semantics): a rule tagged with a campaign only
 *      applies when THAT campaign is in play, and then it shadows the same layer's generic version
 *      of the same rule_key. One level only — campaign → generic, never campaign → campaign.
 *   2. CROSS-LAYER shadowing (new 2026-07-31): when the tenant has a client rule and foundation has
 *      one with the same rule_key, exactly ONE renders. A STANDARD foundation rule loses to the
 *      client's version (that IS the override). A LOCKED one wins — a guardrail cannot be shadowed,
 *      so a pre-existing client twin is suppressed (the door refuses to create new ones).
 *
 * Before this, both bodies rendered and the model read two contradictory versions of the same
 * instruction — the reason the promotion pass had to retire every client copy by hand.
 *
 * @returns {{rules: Array, dropped: Array<{rule, reason, by}>}} reason:
 *   'other-campaign' | 'campaign' | 'override' | 'locked'
 */
function resolveRuleShadowing(rules = [], { campaign } = {}) {
  const camp = (campaign || '').trim() || null;
  const dropped = [];

  // Pass 1 — campaign overlay within (layer, tenant, rule_key).
  const perLayer = new Map();
  for (const r of rules) {
    if (r.campaign && r.campaign !== camp) { dropped.push({ rule: r, reason: 'other-campaign', by: null }); continue; }
    const k = `${r.layer}|${r.tenant_id || ''}|${r.rule_key}`;
    const prev = perLayer.get(k);
    if (!prev) { perLayer.set(k, r); continue; }
    const winner = (r.campaign && !prev.campaign) ? r : prev;
    perLayer.set(k, winner);
    dropped.push({ rule: winner === r ? prev : r, reason: 'campaign', by: winner });
  }

  // Pass 2 — cross-layer, keyed on rule_key alone (campaign is already resolved per layer).
  const byKey = new Map();
  for (const r of perLayer.values()) {
    const prev = byKey.get(r.rule_key);
    if (!prev) { byKey.set(r.rule_key, r); continue; }
    if (prev.layer === r.layer) {
      // Unreachable via the union read (the unique index forbids two active rows of one identity),
      // but stay deterministic rather than letting map order decide if a caller mixes layers.
      dropped.push({ rule: r, reason: 'duplicate', by: prev });
      continue;
    }
    const found = prev.layer === 'foundation' ? prev : r;
    const mine = found === prev ? r : prev;
    const locked = ruleTier(found) === 'locked';
    const winner = locked ? found : mine;
    byKey.set(r.rule_key, winner);
    dropped.push({ rule: locked ? mine : found, reason: locked ? 'locked' : 'override', by: winner });
  }
  return { rules: [...byKey.values()], dropped };
}

/**
 * Assemble resolved rules into the prompt-ready block. Pure — used by renderRulesBlock and
 * tested directly. Rules are grouped by context in taxonomy order; foundation before client
 * inside each group (stable, deterministic output for the step-2 shadow-compare).
 */
function assembleRulesBlock(rules, variables, assets) {
  const allUnresolved = [];
  const byContext = new Map();
  for (const ctx of CONTEXTS) byContext.set(ctx, []);
  const ordered = [...rules].sort((a, b) => {
    const la = a.layer === 'foundation' ? 0 : 1;
    const lb = b.layer === 'foundation' ? 0 : 1;
    return la - lb || String(a.rule_key).localeCompare(String(b.rule_key));
  });
  for (const r of ordered) {
    const { text, unresolved } = resolveRuleBody(r.body, variables, assets);
    allUnresolved.push(...unresolved);
    const bucket = byContext.get(r.context) || byContext.get('global');
    bucket.push({ ...r, resolvedBody: text });
  }
  const sections = [];
  for (const ctx of CONTEXTS) {
    const items = byContext.get(ctx);
    if (!items.length) continue;
    const lines = items.map((r) => r.resolvedBody.trim()).filter(Boolean);
    if (!lines.length) continue;
    sections.push(`## ${ctx}\n\n${lines.join('\n\n')}`);
  }
  return { text: sections.join('\n\n'), unresolved: [...new Set(allUnresolved)] };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * Active rules for a tenant: foundation ∪ client(tenant). Optional filters:
 * contexts (array), layer ('foundation'|'template'|'client' — overrides the union, e.g. to
 * inspect the template layer), campaign.
 *
 * `shadowed: true` returns the RESOLVED runtime view instead of the raw union — one rule per
 * rule_key, client overrides replacing standard foundation rules (see resolveRuleShadowing).
 * Default false so the raw union stays available to the callers that need to SEE both copies:
 * the hygiene sweep, the propose-time conflict check, and the divergence view. `activeCampaign`
 * is the campaign in play for that resolution (defaults to the `campaign` filter).
 */
async function getActiveRules({ tenantId = DEFAULT_TENANT, contexts, layer, campaign, shadowed = false, activeCampaign } = {}) {
  const p = getPool();
  if (!p) return [];
  const tenant = (tenantId || DEFAULT_TENANT).trim();
  const client = await p.connect();
  try {
    await ensureSchema(client);
    const conds = [`status = 'active'`];
    const params = [];
    if (layer) {
      conds.push(`layer = $${params.length + 1}`);
      params.push(layer);
      if (layer === 'client') {
        conds.push(`tenant_id = $${params.length + 1}`);
        params.push(tenant);
      }
    } else {
      conds.push(`(layer = 'foundation' OR (layer = 'client' AND tenant_id = $${params.length + 1}))`);
      params.push(tenant);
    }
    if (Array.isArray(contexts) && contexts.length) {
      conds.push(`context = ANY($${params.length + 1})`);
      params.push(contexts);
    }
    if (campaign) {
      conds.push(`campaign = $${params.length + 1}`);
      params.push(campaign);
    }
    const r = await client.query(
      `SELECT id, rule_key, tenant_id, layer, context, rule_type, campaign, version, body,
              change_note, created_by, created_at, tier, standard_version
       FROM wingguy_rules WHERE ${conds.join(' AND ')}
       ORDER BY context, layer, rule_key`,
      params,
    );
    if (!shadowed) return r.rows;
    return resolveRuleShadowing(r.rows, { campaign: activeCampaign !== undefined ? activeCampaign : campaign }).rules;
  } finally {
    client.release();
  }
}

/**
 * One rule: the active version + full version history (newest first). campaign selects WHICH
 * version chain of the rule_key — omit it for the generic chain, pass it for a campaign's.
 */
async function getRule({ tenantId = DEFAULT_TENANT, layer = 'client', ruleKey, campaign }) {
  const p = getPool();
  if (!p) return null;
  const tenant = layer === 'client' ? (tenantId || DEFAULT_TENANT).trim() : '';
  const client = await p.connect();
  try {
    await ensureSchema(client);
    const r = await client.query(
      `SELECT id, rule_key, tenant_id, layer, context, rule_type, campaign, version, body,
              change_note, created_by, status, created_at, retired_at, tier, standard_version
       FROM wingguy_rules
       WHERE layer = $1 AND COALESCE(tenant_id, '') = $2 AND rule_key = $3
         AND COALESCE(campaign, '') = $4
       ORDER BY version DESC`,
      [layer, tenant, String(ruleKey || '').trim(), (campaign || '').trim()],
    );
    if (!r.rows.length) return null;
    const active = r.rows.find((row) => row.status === 'active') || null;
    return { active, versions: r.rows };
  } finally {
    client.release();
  }
}

/**
 * The prompt-ready rules block for a tenant — THE function step 2 swaps the extension/chat
 * onto (replacing the hard-coded config/wingguyTemplates.js copy). 'global' context is always
 * included; pass contexts to add the situation-specific groups.
 */
async function renderRulesBlock({ tenantId = DEFAULT_TENANT, contexts = [], campaign } = {}) {
  const wanted = [...new Set(['global', ...contexts])].filter((c) => CONTEXTS.includes(c));
  const [rules, variables, assets] = await Promise.all([
    getActiveRules({ tenantId, contexts: wanted, campaign: undefined }),
    getVariables({ tenantId }),
    getAssets({ tenantId }),
  ]);
  // Campaign overlay + cross-layer shadowing, both in resolveRuleShadowing. ONE rule per rule_key
  // reaches the model: the tenant's own version when they have overridden a standard, the
  // foundation body otherwise, and always the foundation body for a locked guardrail.
  const inPlay = resolveRuleShadowing(rules, { campaign }).rules;
  const varMap = {};
  for (const v of variables) if (v.value != null) varMap[v.var_key] = v.value;
  const assetMap = {};
  for (const a of assets) assetMap[a.asset_key] = a;
  const { text, unresolved } = assembleRulesBlock(inPlay, varMap, assetMap);
  return { text, unresolved, ruleCount: inPlay.length };
}

// ---------------------------------------------------------------------------
// The write-door
// ---------------------------------------------------------------------------

/**
 * PROPOSE — pure read, no write. Returns everything a human needs to eyeball the change in
 * chat: the current active version (if any), the proposed body, and the NEIGHBOURS (other
 * active rules in the same context+type for the same scope — the v1 conflict check is human
 * eyes on the neighbours). expected_version feeds commitRule's structural conflict check.
 */
// readerTenantId = whose rulebook to show as neighbours. Distinct from tenantId (which OWNS the
// rule being proposed and is correctly blank for foundation/template): a foundation proposal is
// tenant-less but is still made BY someone, and the rules it must be checked against are the ones
// that render for that someone. Read-scope only — never written anywhere.
async function proposeRule({ tenantId, readerTenantId, layer, ruleKey, context, ruleType, campaign, body, tier, actorTenantId, via }) {
  const validated = validateRuleInput({ layer, tenantId, ruleKey, context, ruleType, tier });
  const { key, tenant } = validated;
  const camp = (campaign || '').trim() || null;
  const existing = await getRule({ tenantId: tenant || undefined, layer, ruleKey: key, campaign: camp });
  const current = existing?.active || null;
  // Neighbours = the OTHER active rules that will render alongside this one, for the human
  // eyeball check. Two things this must get right, both live finds (2026-07-17):
  //   1. Exclude only THIS EXACT CHAIN — identity is (layer, tenant, rule_key, campaign), the
  //      same identity the unique index uses. Matching on rule_key+campaign alone hid a
  //      SAME-KEY rule in the OTHER layer as if it were self: the precise collision the check
  //      exists to catch (foundation ∪ client both render — no cross-layer shadowing in v1).
  //   2. Always read the foundation ∪ client union. A foundation proposal reading only the
  //      foundation layer is blind to the tenant's client rules it will render beside.
  const chainId = (r) => `${r.layer}|${r.layer === 'client' ? (r.tenant_id || '') : ''}|${r.rule_key}|${r.campaign || ''}`;
  const selfId = `${layer}|${layer === 'client' ? (tenant || '') : ''}|${key}|${camp || ''}`;
  // The whole rulebook that renders for this tenant, minus this exact chain. Rules are FILED by
  // context/type but they LAND on the same generated message — a taxonomy cell is not a blast
  // radius (live find 2026-07-17: a global/stage-logic proposal that overrode a post-call/voice
  // rule and a follow-up/stage-logic rule reported "no neighbouring rules", which was true and
  // useless). So the check is tiered by likelihood of collision, widest last.
  const readerTenant = (readerTenantId || tenantId || '').trim() || DEFAULT_TENANT;
  const all = (await getActiveRules({ tenantId: readerTenant })).filter((r) => chainId(r) !== selfId);
  const sameCell = all.filter((r) => r.context === context && r.rule_type === ruleType);
  const sameType = all.filter((r) => r.rule_type === ruleType && r.context !== context);
  // Same key filed elsewhere. Since 2026-07-31 this is no longer automatically a bug: a client
  // rule over a STANDARD foundation rule is the override feature working. It is still a collision
  // worth showing (the human is replacing a shared instruction, and should read what they are
  // replacing) — the door words it as an override rather than a duplicate. See `standard` below.
  const sameKey = all.filter((r) => r.rule_key === key && !(r.context === context && r.rule_type === ruleType));
  const neighbours = sameCell;

  // Would the WRITE be refused for who is asking? Checked here, on the pure-read step, so the
  // model never walks a human through a proposal the door is going to reject at commit.
  let sharedWriteRefusal = null;
  try {
    assertMayWriteLayer({ layer, actorTenantId, via });
  } catch (e) {
    sharedWriteRefusal = { reason: e.code === 'WG_NOT_PLATFORM_OWNER' ? 'not-platform-owner' : 'no-actor', message: e.message };
  }

  // The standard this proposal sits against, and whether it may be overridden at all.
  const standardRow = layer === 'client'
    ? all.find((r) => r.layer === 'foundation' && r.rule_key === key && (r.campaign || null) === camp) || null
    : null;
  const standardTier = ruleTier(standardRow);
  // Proposing a FOUNDATION change: who is already running their own version of this key, and so
  // will NOT receive it. Guy asked for this the moment overrides became possible.
  const overrideTenants = layer === 'foundation' ? await getOverrideTenants({ ruleKey: key, campaign: camp }) : [];

  return {
    ruleKey: key,
    layer,
    tenantId: tenant,
    context,
    ruleType,
    campaign: camp,
    proposedBody: String(body || ''),
    currentVersion: current ? current.version : 0,
    currentBody: current ? current.body : null,
    expectedVersion: current ? current.version : 0,
    isNew: !current,
    neighbours: neighbours.map(neighbourView),
    // Wider rings of the conflict check (see the tiering note above).
    sameTypeElsewhere: sameType.map(neighbourView),
    sameKeyElsewhere: sameKey.map(neighbourView),
    // Three-tier view of this proposal.
    tier: layer === 'foundation' ? (validated.tier || (current ? ruleTier(current) : DEFAULT_TIER)) : null,
    standard: standardRow ? { ...neighbourView(standardRow), tier: standardTier } : null,
    isOverride: !!standardRow && standardTier !== 'locked',
    blocked: sharedWriteRefusal || (standardTier === 'locked'
      ? {
        reason: 'locked',
        message: `"${key}" is a LOCKED instruction — one of the shared guardrails, and not overridable. `
          + `A version of your own cannot be saved against this key; the shared one would keep applying anyway. `
          + `If the guardrail itself needs to change, that is a platform-wide (foundation) change affecting every client.`,
      }
      : null),
    overrideTenants: overrideTenants.map((t) => ({
      tenantId: t.tenant_id, version: t.version, basedOnStandardVersion: t.standard_version == null ? null : Number(t.standard_version),
    })),
  };
}

function neighbourView(n) {
  return {
    rule_key: n.rule_key,
    layer: n.layer,
    context: n.context,
    rule_type: n.rule_type,
    campaign: n.campaign || null,
    version: n.version,
    body: n.body,
  };
}

/**
 * COMMIT — the one insert path. Validates taxonomy, enforces the structural conflict check
 * (expectedVersion must equal the live active version — 0 for a brand-new rule), then in ONE
 * transaction: retire version n, insert version n+1 active, write history.
 */
async function commitRule({
  tenantId, layer, ruleKey, context, ruleType, campaign, body, changeNote, createdBy, expectedVersion,
  tier, action = 'commit', actorTenantId, via,
}) {
  assertMayWriteLayer({ layer, actorTenantId, via });
  const { key, tenant, tier: askedTier } = validateRuleInput({ layer, tenantId, ruleKey, context, ruleType, tier });
  if (!String(body || '').trim()) throw new Error('rule body is required');
  if (!HISTORY_ACTIONS.includes(action)) throw new Error(`invalid history action "${action}"`);
  const expect = Number.isFinite(Number(expectedVersion)) ? Number(expectedVersion) : NaN;
  if (Number.isNaN(expect)) throw new Error('expectedVersion is required (0 for a new rule) — call proposeRule first');

  const p = getPool();
  if (!p) throw new Error('DATABASE_URL not set');
  const client = await p.connect();
  try {
    await ensureSchema(client);
    await client.query('BEGIN');

    // The standard this write sits against (client layer only). Two jobs: refuse an override of a
    // LOCKED guardrail here at the write-door (so no code path can create one, not just the tools),
    // and stamp the drift baseline — which foundation version this override was taken against.
    let standardVersion = null;
    if (layer === 'client') {
      const f = await client.query(
        `SELECT version, tier FROM wingguy_rules
         WHERE layer = 'foundation' AND rule_key = $1 AND COALESCE(campaign, '') = $2 AND status = 'active'`,
        [key, (campaign || '').trim()],
      );
      const std = f.rows[0] || null;
      if (std && ruleTier({ ...std, layer: 'foundation' }) === 'locked') {
        await client.query('ROLLBACK');
        const err = new Error(
          `"${key}" is a LOCKED instruction — it is one of the guardrails, shared by every client and ` +
          `not overridable. Your own version cannot be saved against this key. If the guardrail itself ` +
          `is wrong, that is a foundation change (platform-wide, affects everyone) — raise it as one.`,
        );
        err.code = 'WG_TIER_LOCKED';
        throw err;
      }
      standardVersion = std ? Number(std.version) : null;
    }

    const cur = await client.query(
      `SELECT id, version, tier FROM wingguy_rules
       WHERE layer = $1 AND COALESCE(tenant_id, '') = $2 AND rule_key = $3
         AND COALESCE(campaign, '') = $4 AND status = 'active'
       FOR UPDATE`,
      [layer, tenant || '', key, (campaign || '').trim()],
    );
    const live = cur.rows[0] || null;
    const liveVersion = live ? Number(live.version) : 0;
    // Tier is sticky across versions: editing a locked rule's WORDING must never quietly unlock it.
    // Changing the tier is its own deliberate act (pass tier explicitly — see setRuleTier).
    const tierValue = layer === 'foundation'
      ? (askedTier || (live ? ruleTier({ ...live, layer: 'foundation' }) : DEFAULT_TIER))
      : null;
    if (liveVersion !== expect) {
      await client.query('ROLLBACK');
      const err = new Error(
        `version conflict: expected v${expect} but the live active version is v${liveVersion} — ` +
        `the rule changed since it was proposed. Re-propose to see the current state.`,
      );
      err.code = 'WG_VERSION_CONFLICT';
      throw err;
    }
    const nextVersion = liveVersion + 1;
    if (live) {
      await client.query(
        `UPDATE wingguy_rules SET status = 'retired', retired_at = now() WHERE id = $1`,
        [live.id],
      );
    }
    // Every column bound as a parameter (no interspersed literals) so the column list and the
    // parameter list line up 1:1 — the test fake binds by that alignment.
    const ins = await client.query(
      `INSERT INTO wingguy_rules
         (rule_key, tenant_id, layer, context, rule_type, campaign, version, body, change_note, created_by, status, tier, standard_version)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING id, version`,
      [key, tenant, layer, context, ruleType, campaign || null, nextVersion, String(body), changeNote || null, createdBy || null, 'active', tierValue, standardVersion],
    );
    await client.query(
      `INSERT INTO wingguy_rule_history (actor, action, layer, tenant_id, rule_key, from_version, to_version, detail)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
      [
        createdBy || null,
        action,
        layer,
        tenant,
        key,
        live ? liveVersion : null,
        nextVersion,
        JSON.stringify({
          change_note: changeNote || null, context, rule_type: ruleType, campaign: campaign || null,
          tier: tierValue, standard_version: standardVersion,
        }),
      ],
    );
    await client.query('COMMIT');
    console.log(`WINGGUY-RULES ${action} layer=${layer}${tierValue ? `/${tierValue}` : ''} tenant=${tenant || '-'} key=${key} v${liveVersion}→v${nextVersion}${standardVersion ? ` (overrides standard v${standardVersion})` : ''} by=${createdBy || '?'}`);
    return {
      ok: true, ruleKey: key, layer, tenantId: tenant, version: nextVersion,
      previousVersion: liveVersion || null, tier: tierValue, standardVersion,
    };
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) { /* already rolled back */ }
    throw e;
  } finally {
    client.release();
  }
}

/**
 * RETIRE — deactivate a rule without a replacement (append-only: the row stays, status flips).
 * History-logged. expectedVersion guards the same way commit does.
 */
async function retireRule({ tenantId, layer, ruleKey, campaign, createdBy, expectedVersion, changeNote, actorTenantId, via }) {
  assertMayWriteLayer({ layer, actorTenantId, via });
  const key = String(ruleKey || '').trim();
  const tenant = layer === 'client' ? (tenantId || '').trim() : '';
  if (layer === 'client' && !tenant) throw new Error('layer "client" requires a tenant_id');
  const expect = Number(expectedVersion);
  if (!Number.isFinite(expect) || expect < 1) throw new Error('expectedVersion (the live version) is required');

  const p = getPool();
  if (!p) throw new Error('DATABASE_URL not set');
  const client = await p.connect();
  try {
    await ensureSchema(client);
    await client.query('BEGIN');
    const cur = await client.query(
      `SELECT id, version FROM wingguy_rules
       WHERE layer = $1 AND COALESCE(tenant_id, '') = $2 AND rule_key = $3
         AND COALESCE(campaign, '') = $4 AND status = 'active'
       FOR UPDATE`,
      [layer, tenant, key, (campaign || '').trim()],
    );
    const live = cur.rows[0];
    if (!live) { await client.query('ROLLBACK'); throw new Error(`no active rule "${key}" in ${layer}${tenant ? `/${tenant}` : ''}`); }
    if (Number(live.version) !== expect) {
      await client.query('ROLLBACK');
      throw new Error(`version conflict: expected v${expect} but live is v${live.version} — re-check first`);
    }
    await client.query(`UPDATE wingguy_rules SET status = 'retired', retired_at = now() WHERE id = $1`, [live.id]);
    await client.query(
      `INSERT INTO wingguy_rule_history (actor, action, layer, tenant_id, rule_key, from_version, to_version, detail)
       VALUES ($1, 'retire', $2, $3, $4, $5, NULL, $6::jsonb)`,
      [createdBy || null, layer, tenant || null, key, expect, JSON.stringify({ change_note: changeNote || null })],
    );
    await client.query('COMMIT');
    console.log(`WINGGUY-RULES retire layer=${layer} tenant=${tenant || '-'} key=${key} v${expect} by=${createdBy || '?'}`);
    return { ok: true, ruleKey: key, retiredVersion: expect };
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) { /* already rolled back */ }
    throw e;
  } finally {
    client.release();
  }
}

/**
 * REVERT — insert a fresh version copying an older body (append-only revert; never resurrects
 * the old row itself). Implemented THROUGH commitRule so it inherits the conflict check.
 */
async function revertRule({ tenantId, layer, ruleKey, campaign, toVersion, createdBy, actorTenantId, via }) {
  assertMayWriteLayer({ layer, actorTenantId, via });
  const camp = (campaign || '').trim() || null;
  const existing = await getRule({ tenantId, layer, ruleKey, campaign: camp });
  if (!existing) throw new Error(`rule "${ruleKey}" not found in ${layer}${camp ? ` (campaign ${camp})` : ''}`);
  const target = existing.versions.find((v) => Number(v.version) === Number(toVersion));
  if (!target) throw new Error(`version v${toVersion} of "${ruleKey}" not found`);
  const live = existing.active;
  return commitRule({
    tenantId,
    layer,
    ruleKey,
    context: target.context,
    ruleType: target.rule_type,
    campaign: target.campaign,
    body: target.body,
    changeNote: `revert to v${toVersion}`,
    createdBy,
    expectedVersion: live ? live.version : 0,
    // tier is deliberately NOT passed: revert restores WORDING, and commitRule keeps the live
    // tier. Rolling a guardrail's body back must never roll its lock off as a side effect.
    action: 'revert',
    actorTenantId,
    via,
  });
}

// ---------------------------------------------------------------------------
// Tiers, overrides, divergence — "standard vs yours"
// ---------------------------------------------------------------------------

/**
 * SET TIER — mark a foundation rule locked (a guardrail) or standard (overridable). Append-only
 * like everything else: it commits a new version carrying the SAME body with the new tier, so the
 * change shows up in history with a reason instead of mutating a row.
 */
async function setRuleTier({ ruleKey, campaign, tier, createdBy, changeNote, actorTenantId, via }) {
  assertMayWriteLayer({ layer: 'foundation', actorTenantId, via });
  if (!TIERS.includes(tier)) throw new Error(`invalid tier "${tier}" — must be one of: ${TIERS.join(', ')}`);
  const camp = (campaign || '').trim() || null;
  const found = await getRule({ layer: 'foundation', ruleKey, campaign: camp });
  if (!found?.active) throw new Error(`no active foundation rule "${ruleKey}"${camp ? ` (campaign ${camp})` : ''}`);
  const live = found.active;
  const was = ruleTier(live);
  if (was === tier) return { ok: true, ruleKey: live.rule_key, tier, version: live.version, unchanged: true };
  const overrides = tier === 'locked' ? await getOverrideTenants({ ruleKey, campaign: camp }) : [];
  const r = await commitRule({
    layer: 'foundation',
    ruleKey,
    context: live.context,
    ruleType: live.rule_type,
    campaign: camp,
    body: live.body,
    tier,
    changeNote: changeNote || `tier ${was} → ${tier}`,
    createdBy,
    expectedVersion: live.version,
    actorTenantId,
    via,
  });
  // Locking a rule that tenants already override: their copies stop applying at once (foundation
  // wins). Surfaced, never silently swallowed — the caller decides whether that is acceptable.
  return { ...r, previousTier: was, suppressedOverrides: overrides.map((o) => o.tenant_id) };
}

/** Which tenants hold an active client-layer override of this rule_key (+campaign chain). */
async function getOverrideTenants({ ruleKey, campaign } = {}) {
  const p = getPool();
  if (!p) return [];
  const client = await p.connect();
  try {
    await ensureSchema(client);
    const r = await client.query(
      `SELECT tenant_id, version, standard_version, created_at
       FROM wingguy_rules
       WHERE layer = 'client' AND rule_key = $1 AND COALESCE(campaign, '') = $2 AND status = 'active'
       ORDER BY tenant_id`,
      [String(ruleKey || '').trim(), (campaign || '').trim()],
    );
    return r.rows;
  } finally {
    client.release();
  }
}

/**
 * DIVERGENCE — "what have I changed?". Every rule_key where this tenant runs their OWN version in
 * place of a shared standard, with both bodies side by side, plus the drift check: has the standard
 * moved since they took their copy, and what does it say now.
 *
 * TWO kinds of divergence, and they are not the same question:
 *   overrides — they took a shared instruction and made it their own. Often taste.
 *   yoursOnly — they wrote something that has no shared version at all. That means they found a
 *               GAP in the shared set, which is the stronger signal and the promotion candidate.
 * Both come back in full. (Until 2026-07-31 this returned additions as bare keys, because the
 * view was built comparison-shaped and an addition has nothing to sit beside.)
 */
async function getDivergence({ tenantId = DEFAULT_TENANT } = {}) {
  const tenant = (tenantId || DEFAULT_TENANT).trim();
  const rules = await getActiveRules({ tenantId: tenant });
  const foundation = new Map();
  const mine = new Map();
  for (const r of rules) {
    const k = `${r.rule_key}|${r.campaign || ''}`;
    if (r.layer === 'foundation') foundation.set(k, r);
    else if (r.layer === 'client') mine.set(k, r);
  }

  const overrides = [];
  const yoursOnly = [];
  for (const [k, own] of mine) {
    const std = foundation.get(k);
    // No shared version behind it = an ADDITION, not a change. Returned in full, not as a bare
    // key: an addition is the stronger signal of the two (the tenant found something the shared
    // set didn't cover, which is exactly what should be considered for promotion to standard),
    // and a comparison-shaped view reduced it to a name because there was nothing to compare to.
    if (!std) {
      yoursOnly.push({
        ruleKey: own.rule_key,
        campaign: own.campaign || null,
        context: own.context,
        ruleType: own.rule_type,
        version: own.version,
        body: own.body,
        changeNote: own.change_note || null,
        // The ACTIVE version's timestamp = when this was last touched, not when it was first
        // written. Reading the first version of every chain would be a query per instruction;
        // "last updated" is the honest label for what this is.
        updatedAt: own.created_at || null,
      });
      continue;
    }
    const tier = ruleTier(std);
    const basedOn = own.standard_version == null ? null : Number(own.standard_version);
    const standardMoved = basedOn != null && Number(std.version) > basedOn;
    const entry = {
      ruleKey: own.rule_key,
      campaign: own.campaign || null,
      context: own.context,
      ruleType: own.rule_type,
      tier,
      // A locked standard means the override is INERT — foundation wins at render. Shown loudly
      // rather than hidden: the tenant still has a stale copy sitting there doing nothing.
      applies: tier !== 'locked',
      yourVersion: own.version,
      yourBody: own.body,
      yourChangeNote: own.change_note || null,
      standardVersion: Number(std.version),
      standardBody: std.body,
      basedOnStandardVersion: basedOn,
      standardMoved,
      standardChanges: [],
    };
    if (standardMoved) {
      const chain = await getRule({ layer: 'foundation', ruleKey: own.rule_key, campaign: own.campaign || undefined });
      entry.standardChanges = (chain?.versions || [])
        .filter((v) => Number(v.version) > basedOn)
        .sort((a, b) => Number(a.version) - Number(b.version))
        .map((v) => ({ version: Number(v.version), changeNote: v.change_note || null, at: v.created_at || null }));
    }
    overrides.push(entry);
  }
  overrides.sort((a, b) => String(a.ruleKey).localeCompare(String(b.ruleKey)));
  // Newest first: the recently-written ones are the ones the tenant hasn't reconsidered yet.
  yoursOnly.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''))
    || String(a.ruleKey).localeCompare(String(b.ruleKey)));
  return { tenantId: tenant, overrides, yoursOnly, standardCount: foundation.size };
}

/**
 * RESET TO STANDARD — retire the tenant's override so the live shared version applies again.
 * Refuses when there is no standard to fall back to: that would not be a reset, it would be
 * deleting the instruction outright, which is a different (deliberate) act.
 */
async function resetRuleToStandard({ tenantId, ruleKey, campaign, createdBy, changeNote } = {}) {
  const tenant = (tenantId || '').trim();
  if (!tenant) throw new Error('resetRuleToStandard requires a tenantId');
  const key = String(ruleKey || '').trim();
  const camp = (campaign || '').trim() || null;

  const own = await getRule({ tenantId: tenant, layer: 'client', ruleKey: key, campaign: camp });
  if (!own?.active) {
    throw new Error(`"${key}" has no version of your own${camp ? ` on campaign "${camp}"` : ''} — there is nothing to reset (you are already on the standard).`);
  }
  const std = await getRule({ layer: 'foundation', ruleKey: key, campaign: camp });
  if (!std?.active) {
    throw new Error(`"${key}" is yours alone — there is no shared standard behind it to fall back to. Resetting would leave you with no instruction at all; archive it deliberately if that is what you want.`);
  }
  const r = await retireRule({
    tenantId: tenant,
    layer: 'client',
    ruleKey: key,
    campaign: camp,
    createdBy,
    expectedVersion: own.active.version,
    changeNote: changeNote || `reset to standard v${std.active.version}`,
  });
  return {
    ok: true,
    ruleKey: key,
    campaign: camp,
    retiredVersion: r.retiredVersion,
    standardVersion: Number(std.active.version),
    standardBody: std.active.body,
    tier: ruleTier(std.active),
  };
}

// ---------------------------------------------------------------------------
// Provisioning — seed-then-diverge
// ---------------------------------------------------------------------------

/**
 * SEED — copy the de-personalised TEMPLATE layer into a NEW client's own layer, so a freshly
 * connected tenant starts with the full craft rulebook (+ the unfilled *-scaffold rules the
 * "let's set up my rules" walkthrough then replaces) instead of a blank slate. Runtime read is
 * foundation ∪ client, so before this runs a new tenant sees only the 3 foundation rules.
 *
 * IDEMPOTENT + non-destructive: any (rule_key, campaign) the client ALREADY has an active
 * version of is skipped, never overwritten — so re-running after a client has diverged is safe,
 * and a half-finished seed can be re-run to completion. Each seeded rule lands as client v1 with
 * a 'seed' history entry. Variables (catalog is global) and assets (client fills their own) are
 * deliberately NOT seeded — only rules.
 */
async function seedClientFromTemplate({ tenantId, createdBy = 'system:seed', dryRun = false } = {}) {
  const tenant = (tenantId || '').trim();
  if (!tenant) throw new Error('seedClientFromTemplate requires a tenantId');
  if (tenant === DEFAULT_TENANT) {
    throw new Error(`refusing to seed the default tenant "${DEFAULT_TENANT}" — that is the live owner layer, not a fresh client`);
  }
  const p = getPool();
  if (!p) throw new Error('DATABASE_URL not set');
  const client = await p.connect();
  try {
    await ensureSchema(client);
    const tpl = await client.query(
      `SELECT rule_key, context, rule_type, campaign, body
       FROM wingguy_rules WHERE layer = 'template' AND status = 'active'
       ORDER BY context, rule_key, COALESCE(campaign, '')`,
    );
    const ex = await client.query(
      `SELECT rule_key, COALESCE(campaign, '') AS campaign
       FROM wingguy_rules WHERE layer = 'client' AND tenant_id = $1 AND status = 'active'`,
      [tenant],
    );
    const have = new Set(ex.rows.map((r) => `${r.rule_key}|${r.campaign}`));
    const identity = (r) => `${r.rule_key}|${r.campaign || ''}`;

    // Foundation twins of the template keys. Two consequences now that layers shadow each other:
    // a seeded rule over a STANDARD key lands as an override (stamp its baseline so drift reads
    // right), and one over a LOCKED key would be inert dead weight — refuse to seed those.
    const fnd = await client.query(
      `SELECT rule_key, COALESCE(campaign, '') AS campaign, version, tier
       FROM wingguy_rules WHERE layer = 'foundation' AND status = 'active'`,
    );
    const standards = new Map(fnd.rows.map((r) => [`${r.rule_key}|${r.campaign}`, r]));
    const isLocked = (r) => ruleTier({ ...(standards.get(identity(r)) || {}), layer: 'foundation' }) === 'locked'
      && standards.has(identity(r));

    const candidates = tpl.rows.filter((r) => !have.has(identity(r)));
    const toSeed = candidates.filter((r) => !isLocked(r));
    const seeded = toSeed.map(identity);
    const skipped = tpl.rows.filter((r) => have.has(identity(r))).map(identity);
    const skippedLocked = candidates.filter(isLocked).map(identity);

    if (dryRun) {
      return { tenantId: tenant, dryRun: true, templateCount: tpl.rows.length, seeded, skipped, skippedLocked };
    }

    await client.query('BEGIN');
    for (const r of toSeed) {
      const std = standards.get(identity(r)) || null;
      await client.query(
        `INSERT INTO wingguy_rules
           (rule_key, tenant_id, layer, context, rule_type, campaign, version, body, change_note, created_by, status, standard_version)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [r.rule_key, tenant, 'client', r.context, r.rule_type, r.campaign || null, 1, r.body, 'seed from template', createdBy, 'active', std ? Number(std.version) : null],
      );
      await client.query(
        `INSERT INTO wingguy_rule_history (actor, action, layer, tenant_id, rule_key, from_version, to_version, detail)
         VALUES ($1, 'seed', 'client', $2, $3, NULL, 1, $4::jsonb)`,
        [createdBy, tenant, r.rule_key, JSON.stringify({ context: r.context, rule_type: r.rule_type, campaign: r.campaign || null, source: 'template' })],
      );
    }
    await client.query('COMMIT');
    console.log(`WINGGUY-RULES seed tenant=${tenant} seeded=${seeded.length} skipped=${skipped.length}${skippedLocked.length ? ` skippedLocked=${skippedLocked.length}` : ''} of ${tpl.rows.length} template rules by=${createdBy}`);
    return { tenantId: tenant, dryRun: false, templateCount: tpl.rows.length, seeded, skipped, skippedLocked };
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) { /* already rolled back or read-only */ }
    throw e;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Variables + assets
// ---------------------------------------------------------------------------

async function setVariable({ tenantId = DEFAULT_TENANT, varKey, value, description, required, example, actor }) {
  const key = String(varKey || '').trim();
  if (!/^[a-zA-Z0-9_.-]{1,80}$/.test(key)) throw new Error(`invalid var_key "${varKey}"`);
  const tenant = (tenantId || DEFAULT_TENANT).trim();
  const p = getPool();
  if (!p) throw new Error('DATABASE_URL not set');
  const client = await p.connect();
  try {
    await ensureSchema(client);
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO wingguy_variable_catalog (var_key, description, required, example)
       VALUES ($1, $2, COALESCE($3, false), $4)
       ON CONFLICT (var_key) DO UPDATE SET
         description = COALESCE(EXCLUDED.description, wingguy_variable_catalog.description),
         required = COALESCE($3, wingguy_variable_catalog.required),
         example = COALESCE(EXCLUDED.example, wingguy_variable_catalog.example)`,
      [key, description || null, typeof required === 'boolean' ? required : null, example || null],
    );
    const prev = await client.query(
      `SELECT value FROM wingguy_tenant_variables WHERE tenant_id = $1 AND var_key = $2`,
      [tenant, key],
    );
    await client.query(
      `INSERT INTO wingguy_tenant_variables (tenant_id, var_key, value)
       VALUES ($1, $2, $3)
       ON CONFLICT (tenant_id, var_key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [tenant, key, value == null ? null : String(value)],
    );
    await client.query(
      `INSERT INTO wingguy_rule_history (actor, action, tenant_id, rule_key, detail)
       VALUES ($1, 'variable-set', $2, $3, $4::jsonb)`,
      [actor || null, tenant, key, JSON.stringify({ from: prev.rows[0]?.value ?? null, to: value == null ? null : String(value) })],
    );
    await client.query('COMMIT');
    return { ok: true, varKey: key, tenantId: tenant };
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) { /* already rolled back */ }
    throw e;
  } finally {
    client.release();
  }
}

/** Catalog LEFT JOIN tenant values — unset-but-catalogued variables come back with value null. */
async function getVariables({ tenantId = DEFAULT_TENANT } = {}) {
  const p = getPool();
  if (!p) return [];
  const tenant = (tenantId || DEFAULT_TENANT).trim();
  const client = await p.connect();
  try {
    await ensureSchema(client);
    const r = await client.query(
      `SELECT c.var_key, c.description, c.required, c.example, v.value, v.updated_at
       FROM wingguy_variable_catalog c
       LEFT JOIN wingguy_tenant_variables v ON v.var_key = c.var_key AND v.tenant_id = $1
       ORDER BY c.var_key`,
      [tenant],
    );
    return r.rows;
  } finally {
    client.release();
  }
}

async function setAsset({ tenantId = DEFAULT_TENANT, assetKey, kind, url, status = 'active', actor }) {
  const key = String(assetKey || '').trim();
  if (!/^[a-zA-Z0-9_.-]{1,80}$/.test(key)) throw new Error(`invalid asset_key "${assetKey}"`);
  const tenant = (tenantId || DEFAULT_TENANT).trim();
  const p = getPool();
  if (!p) throw new Error('DATABASE_URL not set');
  const client = await p.connect();
  try {
    await ensureSchema(client);
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO wingguy_assets (tenant_id, asset_key, kind, url, status)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (tenant_id, asset_key) DO UPDATE SET
         kind = COALESCE(EXCLUDED.kind, wingguy_assets.kind),
         url = COALESCE(EXCLUDED.url, wingguy_assets.url),
         status = EXCLUDED.status,
         updated_at = now()`,
      [tenant, key, kind || null, url || null, status],
    );
    await client.query(
      `INSERT INTO wingguy_rule_history (actor, action, tenant_id, rule_key, detail)
       VALUES ($1, 'asset-set', $2, $3, $4::jsonb)`,
      [actor || null, tenant, key, JSON.stringify({ kind: kind || null, url: url || null, status })],
    );
    await client.query('COMMIT');
    return { ok: true, assetKey: key, tenantId: tenant };
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) { /* already rolled back */ }
    throw e;
  } finally {
    client.release();
  }
}

async function getAssets({ tenantId = DEFAULT_TENANT } = {}) {
  const p = getPool();
  if (!p) return [];
  const tenant = (tenantId || DEFAULT_TENANT).trim();
  const client = await p.connect();
  try {
    await ensureSchema(client);
    const r = await client.query(
      `SELECT asset_key, kind, url, status, updated_at FROM wingguy_assets WHERE tenant_id = $1 ORDER BY asset_key`,
      [tenant],
    );
    return r.rows;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Asset ledger (what actually went to whom — written at draft time by the mail door)
// ---------------------------------------------------------------------------

/**
 * Record that a draft carrying these assets was created for these leads — one row per
 * (lead × asset). Append-only; called by wingguy_create_draft AFTER the Nylas draft exists.
 */
async function recordAssetSends({ tenantId = DEFAULT_TENANT, leadEmails = [], assetKeys = [], draftId, threadId, subject }) {
  const tenant = (tenantId || DEFAULT_TENANT).trim();
  const leads = [...new Set(leadEmails.map((e) => String(e || '').trim().toLowerCase()).filter(Boolean))];
  const keys = [...new Set(assetKeys.map((k) => String(k || '').trim()).filter(Boolean))];
  if (!leads.length || !keys.length) return { ok: true, rows: 0 };
  const p = getPool();
  if (!p) throw new Error('DATABASE_URL not set');
  const client = await p.connect();
  try {
    await ensureSchema(client);
    let rows = 0;
    for (const lead of leads) {
      for (const key of keys) {
        await client.query(
          `INSERT INTO wingguy_asset_ledger (tenant_id, lead_email, asset_key, draft_id, thread_id, subject)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [tenant, lead, key, draftId || null, threadId || null, subject || null],
        );
        rows++;
      }
    }
    return { ok: true, rows };
  } finally {
    client.release();
  }
}

/** Full asset history for one lead — newest first. The wingguy_lead_history read. */
async function getLeadAssetHistory({ tenantId = DEFAULT_TENANT, leadEmail, limit = 50 } = {}) {
  const p = getPool();
  if (!p) throw new Error('DATABASE_URL not set');
  const tenant = (tenantId || DEFAULT_TENANT).trim();
  const lead = String(leadEmail || '').trim().toLowerCase();
  if (!lead) throw new Error('leadEmail required');
  const cap = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const client = await p.connect();
  try {
    await ensureSchema(client);
    const r = await client.query(
      `SELECT sent_at, asset_key, draft_id, thread_id, subject
       FROM wingguy_asset_ledger WHERE tenant_id = $1 AND lead_email = $2
       ORDER BY sent_at DESC, id DESC LIMIT $3`,
      [tenant, lead, cap],
    );
    return r.rows;
  } finally {
    client.release();
  }
}

/**
 * The repeat gate's question: of these (lead × asset) pairs, which already have ledger rows?
 * Returns [{lead_email, asset_key, last_sent_at, times}] — empty means all clear.
 */
async function getAssetSendSummary({ tenantId = DEFAULT_TENANT, leadEmails = [], assetKeys = [] } = {}) {
  const leads = [...new Set(leadEmails.map((e) => String(e || '').trim().toLowerCase()).filter(Boolean))];
  const keys = [...new Set(assetKeys.map((k) => String(k || '').trim()).filter(Boolean))];
  if (!leads.length || !keys.length) return [];
  const p = getPool();
  if (!p) throw new Error('DATABASE_URL not set');
  const tenant = (tenantId || DEFAULT_TENANT).trim();
  const client = await p.connect();
  try {
    await ensureSchema(client);
    const r = await client.query(
      `SELECT lead_email, asset_key, MAX(sent_at) AS last_sent_at, COUNT(*)::int AS times
       FROM wingguy_asset_ledger
       WHERE tenant_id = $1 AND lead_email = ANY($2) AND asset_key = ANY($3)
       GROUP BY lead_email, asset_key`,
      [tenant, leads, keys],
    );
    return r.rows;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Edit pairs — learn-from-my-edit (generated-vs-sent, reviewed in chat)
// ---------------------------------------------------------------------------

/**
 * Whitespace-insensitive equality view of a message, used ONLY to decide "did the human actually
 * change anything?" — never shown or stored. Deliberately conservative: case and punctuation
 * changes DO count as edits (they are often exactly the style signal being hunted).
 */
function normalizeForEditCompare(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

/**
 * Record one generated-vs-sent pair from a LinkedIn send. Returns { ok, stored, id? }:
 * stored=false when the send matched the draft (whitespace aside) — an unchanged send carries
 * no learning signal and never lands a row.
 */
async function recordEditPair({ tenantId = DEFAULT_TENANT, leadName, leadUrl, surface = 'linkedin', generated, sent }) {
  const gen = String(generated || '').trim();
  const fin = String(sent || '').trim();
  if (!gen || !fin) throw new Error('recordEditPair: both generated and sent are required');
  if (normalizeForEditCompare(gen) === normalizeForEditCompare(fin)) {
    return { ok: true, stored: false, reason: 'unchanged' };
  }
  const p = getPool();
  if (!p) throw new Error('DATABASE_URL not set');
  const client = await p.connect();
  try {
    await ensureSchema(client);
    const r = await client.query(
      `INSERT INTO wingguy_edit_pairs (tenant_id, lead_name, lead_url, surface, generated, sent)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [(tenantId || DEFAULT_TENANT).trim(), leadName || null, leadUrl || null, surface, gen, fin],
    );
    return { ok: true, stored: true, id: r.rows[0].id };
  } finally {
    client.release();
  }
}

/** Edit pairs for review — newest first. status: 'pending' (default) | 'reviewed' | 'dismissed' | 'all'. */
async function getEditPairs({ tenantId = DEFAULT_TENANT, status = 'pending', limit = 20 } = {}) {
  const p = getPool();
  if (!p) throw new Error('DATABASE_URL not set');
  const cap = Math.min(Math.max(Number(limit) || 20, 1), 100);
  const client = await p.connect();
  try {
    await ensureSchema(client);
    const where = status === 'all' ? '' : `AND status = $3`;
    const params = status === 'all'
      ? [(tenantId || DEFAULT_TENANT).trim(), cap]
      : [(tenantId || DEFAULT_TENANT).trim(), cap, status];
    const r = await client.query(
      `SELECT id, created_at, lead_name, lead_url, surface, generated, sent, status, reviewed_at, review_note
       FROM wingguy_edit_pairs WHERE tenant_id = $1 ${where}
       ORDER BY created_at DESC, id DESC LIMIT $2`,
      params,
    );
    return r.rows;
  } finally {
    client.release();
  }
}

/** Close out reviewed/dismissed pairs. Only ever moves pending → reviewed|dismissed; never deletes. */
async function resolveEditPairs({ tenantId = DEFAULT_TENANT, ids = [], status = 'reviewed', note } = {}) {
  if (!['reviewed', 'dismissed'].includes(status)) throw new Error(`resolveEditPairs: invalid status "${status}"`);
  const idList = [...new Set(ids.map((n) => Number(n)).filter((n) => Number.isInteger(n) && n > 0))];
  if (!idList.length) return { ok: true, resolved: 0 };
  const p = getPool();
  if (!p) throw new Error('DATABASE_URL not set');
  const client = await p.connect();
  try {
    await ensureSchema(client);
    const r = await client.query(
      `UPDATE wingguy_edit_pairs SET status = $1, reviewed_at = now(), review_note = $2
       WHERE tenant_id = $3 AND id = ANY($4) AND status = 'pending'`,
      [status, note || null, (tenantId || DEFAULT_TENANT).trim(), idList],
    );
    return { ok: true, resolved: r.rowCount };
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Rulebook hygiene — code-detected structural findings (no LLM judgement)
// ---------------------------------------------------------------------------

/**
 * Pure structural sweep of a tenant's runtime rulebook. Deliberately ONLY what code can decide
 * deterministically (rules integrity = code; semantic contradiction-hunting stays a human/LLM
 * on-demand job). Campaign-vs-generic same-key pairs are BY DESIGN (campaign shadows generic) and
 * are not flagged.
 *
 * REVISED 2026-07-31 with cross-layer shadowing. A client rule sitting over a STANDARD foundation
 * rule used to be the headline finding ("both render, the model reads two versions") — it is now
 * the override feature working correctly, and is NOT a finding. What replaces it:
 *   - inert-override: a client rule over a LOCKED foundation rule. It never applies (the guardrail
 *     wins) but it is still sitting there looking like it does — a real trap, worth flagging.
 * Placeholder checking runs over the RESOLVED view, so a hole in a foundation body that the
 * tenant's own override replaces is not reported against them.
 * @returns Array<{kind, ruleKey, detail}>
 */
function computeRulebookHygiene(rules = [], variableRows = [], assetRows = []) {
  const findings = [];
  const varMap = {};
  for (const v of variableRows) if (v.value !== null && v.value !== undefined && v.value !== '') varMap[v.var_key] = v.value;
  const assetMap = {};
  for (const a of assetRows) assetMap[a.asset_key] = a;

  const { rules: inPlay, dropped } = resolveRuleShadowing(rules);
  for (const d of dropped) {
    if (d.reason !== 'locked') continue;
    findings.push({
      kind: 'inert-override',
      ruleKey: d.rule.rule_key,
      detail: `"${d.rule.rule_key}"${d.rule.campaign ? ` (campaign:${d.rule.campaign})` : ''} has a version of your own, but the shared version is a LOCKED guardrail — so yours never applies and the shared one is what runs. Your copy is dead weight: archive it, or raise the guardrail itself as a platform change.`,
    });
  }
  for (const r of inPlay) {
    const { unresolved } = resolveRuleBody(r.body, varMap, assetMap);
    if (unresolved.length) {
      findings.push({
        kind: 'unresolved-placeholders',
        ruleKey: r.rule_key,
        detail: `"${r.rule_key}" (${r.layer}) references ${unresolved.map((u) => `{{${u}}}`).join(', ')} with no live value — unset variable, or missing/retired asset. The placeholder goes out as literal text.`,
      });
    }
  }
  return findings;
}

/** DB wrapper: run the structural sweep over the tenant's runtime view (foundation ∪ client). */
async function rulebookHygiene({ tenantId = DEFAULT_TENANT } = {}) {
  const [rules, vars, assets] = await Promise.all([
    getActiveRules({ tenantId }),
    getVariables({ tenantId }),
    getAssets({ tenantId }),
  ]);
  return computeRulebookHygiene(rules, vars, assets);
}

// ---------------------------------------------------------------------------
// Draft ledger — the email half of learn-from-my-edit
// ---------------------------------------------------------------------------

/** Log the generated body of an email draft at wingguy_create_draft time (best-effort caller). */
async function recordDraftBody({ tenantId = DEFAULT_TENANT, draftId, threadId, toEmail, subject, generated }) {
  const gen = String(generated || '').trim();
  const lead = String(toEmail || '').trim().toLowerCase();
  if (!gen || !lead) throw new Error('recordDraftBody: generated body and toEmail are required');
  const p = getPool();
  if (!p) throw new Error('DATABASE_URL not set');
  const client = await p.connect();
  try {
    await ensureSchema(client);
    const r = await client.query(
      `INSERT INTO wingguy_draft_ledger (tenant_id, draft_id, thread_id, to_email, subject, generated)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [(tenantId || DEFAULT_TENANT).trim(), draftId || null, threadId || null, lead, subject || null, gen],
    );
    return { ok: true, id: r.rows[0].id };
  } finally {
    client.release();
  }
}

/** Draft-ledger rows still awaiting their sent counterpart — oldest first (settle in send order). */
async function getAwaitingDrafts({ tenantId = DEFAULT_TENANT, limit = 10 } = {}) {
  const p = getPool();
  if (!p) throw new Error('DATABASE_URL not set');
  const cap = Math.min(Math.max(Number(limit) || 10, 1), 25);
  const client = await p.connect();
  try {
    await ensureSchema(client);
    const r = await client.query(
      `SELECT id, created_at, draft_id, thread_id, to_email, subject, generated
       FROM wingguy_draft_ledger WHERE tenant_id = $1 AND status = 'awaiting-send'
       ORDER BY created_at ASC, id ASC LIMIT $2`,
      [(tenantId || DEFAULT_TENANT).trim(), cap],
    );
    return r.rows;
  } finally {
    client.release();
  }
}

/** Close out one draft-ledger row: paired (edit filed) | no-diff (sent as drafted) | expired. */
async function settleDraftRecord({ tenantId = DEFAULT_TENANT, id, status }) {
  if (!['paired', 'no-diff', 'expired'].includes(status)) throw new Error(`settleDraftRecord: invalid status "${status}"`);
  const p = getPool();
  if (!p) throw new Error('DATABASE_URL not set');
  const client = await p.connect();
  try {
    await ensureSchema(client);
    const r = await client.query(
      `UPDATE wingguy_draft_ledger SET status = $1, settled_at = now()
       WHERE tenant_id = $2 AND id = $3 AND status = 'awaiting-send'`,
      [status, (tenantId || DEFAULT_TENANT).trim(), Number(id)],
    );
    return { ok: true, settled: r.rowCount };
  } finally {
    client.release();
  }
}

/** History for one rule (or the whole door when ruleKey omitted) — newest first. */
async function getHistory({ tenantId, ruleKey, limit = 50 } = {}) {
  const p = getPool();
  if (!p) return [];
  const cap = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const conds = [];
  const params = [];
  if (ruleKey) { conds.push(`rule_key = $${params.length + 1}`); params.push(String(ruleKey).trim()); }
  if (tenantId) { conds.push(`(tenant_id = $${params.length + 1} OR tenant_id IS NULL)`); params.push(String(tenantId).trim()); }
  const whereSql = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  params.push(cap);
  const client = await p.connect();
  try {
    await ensureSchema(client);
    const r = await client.query(
      `SELECT id, created_at, actor, action, layer, tenant_id, rule_key, from_version, to_version, detail
       FROM wingguy_rule_history ${whereSql} ORDER BY id DESC LIMIT $${params.length}`,
      params,
    );
    return r.rows;
  } finally {
    client.release();
  }
}

/** "Where am I" — rules source + version counts, for the wingguy_status idea + smoke checks. */
async function getStoreStatus() {
  const p = getPool();
  if (!p) return { database_configured: false };
  const client = await p.connect();
  try {
    await ensureSchema(client);
    const r = await client.query(
      `SELECT layer, COALESCE(tenant_id, '(none)') AS tenant, COUNT(*) FILTER (WHERE status = 'active')::int AS active,
              COUNT(*)::int AS total_versions
       FROM wingguy_rules GROUP BY layer, COALESCE(tenant_id, '(none)') ORDER BY layer, tenant`,
    );
    const h = await client.query(`SELECT COUNT(*)::int AS c FROM wingguy_rule_history`);
    return { database_configured: true, rules: r.rows, history_rows: h.rows[0].c };
  } finally {
    client.release();
  }
}

module.exports = {
  // reads
  getActiveRules,
  getRule,
  renderRulesBlock,
  getVariables,
  getAssets,
  getHistory,
  getStoreStatus,
  // asset ledger (the usage-gate evidence)
  recordAssetSends,
  getLeadAssetHistory,
  getAssetSendSummary,
  // edit pairs (learn-from-my-edit)
  recordEditPair,
  getEditPairs,
  resolveEditPairs,
  normalizeForEditCompare,
  // draft ledger (the email half of learn-from-my-edit)
  recordDraftBody,
  getAwaitingDrafts,
  settleDraftRecord,
  // rulebook hygiene (structural sweep)
  rulebookHygiene,
  computeRulebookHygiene,
  // the write-door
  proposeRule,
  commitRule,
  retireRule,
  revertRule,
  // three-tier + per-client overrides ("standard vs yours")
  setRuleTier,
  getOverrideTenants,
  getDivergence,
  resetRuleToStandard,
  // provisioning
  seedClientFromTemplate,
  setVariable,
  setAsset,
  // pure core (tests)
  validateRuleInput,
  resolveRuleBody,
  assembleRulesBlock,
  resolveRuleShadowing,
  ruleTier,
  LAYERS,
  CONTEXTS,
  RULE_TYPES,
  TIERS,
  DEFAULT_TIER,
  DEFAULT_TENANT,
  // test seam
  __setTestPool,
};
