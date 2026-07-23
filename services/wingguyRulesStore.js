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
 * Runtime read = foundation ∪ client(tenant). No cross-layer shadowing in v1.
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

let pool;
let schemaEnsured = false;

// --- Taxonomy (SIGNED OFF at the 2026-07-04 proof pass — six types are final; re-open only
// if the full import surfaces 2+ more quality-bar rules, per the session-4 close) -----------
const LAYERS = ['foundation', 'template', 'client'];
const CONTEXTS = ['global', 'outreach', 'reply', 'booking', 'post-call', 'follow-up'];
const RULE_TYPES = ['voice', 'formatting', 'stage-logic', 'scheduling', 'asset-usage', 'qualifying'];
const HISTORY_ACTIONS = ['commit', 'retire', 'revert', 'import', 'seed', 'variable-set', 'asset-set'];

const DEFAULT_TENANT = 'Guy-Wilson';

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
function validateRuleInput({ layer, tenantId, ruleKey, context, ruleType }) {
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
  return { key, tenant: tenant || null };
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
const META_SYNTAX_MENTIONS = new Set(['asset:key', 'variable']);

function resolveRuleBody(body, variables = {}, assets = {}) {
  const unresolved = [];
  const text = String(body || '').replace(/\{\{\s*(asset:)?([a-zA-Z0-9_.-]+)\s*\}\}/g, (whole, assetPrefix, key) => {
    if (META_SYNTAX_MENTIONS.has(`${assetPrefix || ''}${key}`)) return whole;
    if (assetPrefix) {
      const a = assets[key];
      if (a && a.url && a.status !== 'retired') return a.url;
      unresolved.push(`asset:${key}`);
      return whole;
    }
    const v = variables[key];
    if (v !== undefined && v !== null && String(v).length) return String(v);
    unresolved.push(key);
    return whole;
  });
  return { text, unresolved };
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
 */
async function getActiveRules({ tenantId = DEFAULT_TENANT, contexts, layer, campaign } = {}) {
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
              change_note, created_by, created_at
       FROM wingguy_rules WHERE ${conds.join(' AND ')}
       ORDER BY context, layer, rule_key`,
      params,
    );
    return r.rows;
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
              change_note, created_by, status, created_at, retired_at
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
  // Campaign scoping at render time: a campaign-tagged rule only applies when THAT campaign
  // is in play, and it SHADOWS the generic version of the same rule_key (per-rule fallback:
  // campaign version wins, else generic — one level, never campaign → campaign).
  const camp = (campaign || '').trim() || null;
  const byIdentity = new Map();
  for (const r of rules) {
    if (r.campaign && r.campaign !== camp) continue;
    const k = `${r.layer}|${r.tenant_id || ''}|${r.rule_key}`;
    const prev = byIdentity.get(k);
    if (!prev || (r.campaign && !prev.campaign)) byIdentity.set(k, r);
  }
  const inPlay = [...byIdentity.values()];
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
async function proposeRule({ tenantId, readerTenantId, layer, ruleKey, context, ruleType, campaign, body }) {
  const { key, tenant } = validateRuleInput({ layer, tenantId, ruleKey, context, ruleType });
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
  // Same key filed elsewhere = the cross-layer duplicate case (both copies render, no shadowing).
  const sameKey = all.filter((r) => r.rule_key === key && !(r.context === context && r.rule_type === ruleType));
  const neighbours = sameCell;
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
  action = 'commit',
}) {
  const { key, tenant } = validateRuleInput({ layer, tenantId, ruleKey, context, ruleType });
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
    const cur = await client.query(
      `SELECT id, version FROM wingguy_rules
       WHERE layer = $1 AND COALESCE(tenant_id, '') = $2 AND rule_key = $3
         AND COALESCE(campaign, '') = $4 AND status = 'active'
       FOR UPDATE`,
      [layer, tenant || '', key, (campaign || '').trim()],
    );
    const live = cur.rows[0] || null;
    const liveVersion = live ? Number(live.version) : 0;
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
    const ins = await client.query(
      `INSERT INTO wingguy_rules
         (rule_key, tenant_id, layer, context, rule_type, campaign, version, body, change_note, created_by, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'active')
       RETURNING id, version`,
      [key, tenant, layer, context, ruleType, campaign || null, nextVersion, String(body), changeNote || null, createdBy || null],
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
        JSON.stringify({ change_note: changeNote || null, context, rule_type: ruleType, campaign: campaign || null }),
      ],
    );
    await client.query('COMMIT');
    console.log(`WINGGUY-RULES ${action} layer=${layer} tenant=${tenant || '-'} key=${key} v${liveVersion}→v${nextVersion} by=${createdBy || '?'}`);
    return { ok: true, ruleKey: key, layer, tenantId: tenant, version: nextVersion, previousVersion: liveVersion || null };
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
async function retireRule({ tenantId, layer, ruleKey, campaign, createdBy, expectedVersion, changeNote }) {
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
async function revertRule({ tenantId, layer, ruleKey, campaign, toVersion, createdBy }) {
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
    action: 'revert',
  });
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
    const toSeed = tpl.rows.filter((r) => !have.has(identity(r)));
    const seeded = toSeed.map(identity);
    const skipped = tpl.rows.filter((r) => have.has(identity(r))).map(identity);

    if (dryRun) {
      return { tenantId: tenant, dryRun: true, templateCount: tpl.rows.length, seeded, skipped };
    }

    await client.query('BEGIN');
    for (const r of toSeed) {
      await client.query(
        `INSERT INTO wingguy_rules
           (rule_key, tenant_id, layer, context, rule_type, campaign, version, body, change_note, created_by, status)
         VALUES ($1, $2, 'client', $3, $4, $5, 1, $6, 'seed from template', $7, 'active')`,
        [r.rule_key, tenant, r.context, r.rule_type, r.campaign || null, r.body, createdBy],
      );
      await client.query(
        `INSERT INTO wingguy_rule_history (actor, action, layer, tenant_id, rule_key, from_version, to_version, detail)
         VALUES ($1, 'seed', 'client', $2, $3, NULL, 1, $4::jsonb)`,
        [createdBy, tenant, r.rule_key, JSON.stringify({ context: r.context, rule_type: r.rule_type, campaign: r.campaign || null, source: 'template' })],
      );
    }
    await client.query('COMMIT');
    console.log(`WINGGUY-RULES seed tenant=${tenant} seeded=${seeded.length} skipped=${skipped.length} of ${tpl.rows.length} template rules by=${createdBy}`);
    return { tenantId: tenant, dryRun: false, templateCount: tpl.rows.length, seeded, skipped };
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
 * on-demand job): cross-layer twins (same rule_key+campaign active in >1 layer — BOTH render,
 * nothing shadows) and unresolved {{variable}}/{{asset:key}} placeholders (unset variable, or a
 * missing/retired asset). Campaign-vs-generic same-key pairs are BY DESIGN (campaign shadows
 * generic) and are not flagged.
 * @returns Array<{kind, ruleKey, detail}>
 */
function computeRulebookHygiene(rules = [], variableRows = [], assetRows = []) {
  const findings = [];
  const varMap = {};
  for (const v of variableRows) if (v.value !== null && v.value !== undefined && v.value !== '') varMap[v.var_key] = v.value;
  const assetMap = {};
  for (const a of assetRows) assetMap[a.asset_key] = a;

  const byIdentity = {};
  for (const r of rules) {
    const k = `${r.rule_key}|${r.campaign || ''}`;
    (byIdentity[k] = byIdentity[k] || []).push(r);
  }
  for (const rows of Object.values(byIdentity)) {
    const layers = [...new Set(rows.map((r) => r.layer))];
    if (layers.length > 1) {
      findings.push({
        kind: 'cross-layer-twin',
        ruleKey: rows[0].rule_key,
        detail: `"${rows[0].rule_key}"${rows[0].campaign ? ` (campaign:${rows[0].campaign})` : ''} is active in ${layers.join(' AND ')} — both bodies render (nothing shadows), so the model reads two versions. Usually one should be retired (see the layer-precedence decision before bulk-fixing).`,
      });
    }
  }
  for (const r of rules) {
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
  // provisioning
  seedClientFromTemplate,
  setVariable,
  setAsset,
  // pure core (tests)
  validateRuleInput,
  resolveRuleBody,
  assembleRulesBlock,
  LAYERS,
  CONTEXTS,
  RULE_TYPES,
  DEFAULT_TENANT,
  // test seam
  __setTestPool,
};
