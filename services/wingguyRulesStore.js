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
  await client.query(`ALTER TABLE wingguy_rule_history DROP CONSTRAINT IF EXISTS wingguy_rule_history_action_check;`);
  await client.query(`
    ALTER TABLE wingguy_rule_history ADD CONSTRAINT wingguy_rule_history_action_check
    CHECK (action IN ('commit','retire','revert','import','seed','variable-set','asset-set'));
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
function resolveRuleBody(body, variables = {}, assets = {}) {
  const unresolved = [];
  const text = String(body || '').replace(/\{\{\s*(asset:)?([a-zA-Z0-9_.-]+)\s*\}\}/g, (whole, assetPrefix, key) => {
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
async function proposeRule({ tenantId, layer, ruleKey, context, ruleType, campaign, body }) {
  const { key, tenant } = validateRuleInput({ layer, tenantId, ruleKey, context, ruleType });
  const camp = (campaign || '').trim() || null;
  const existing = await getRule({ tenantId: tenant || undefined, layer, ruleKey: key, campaign: camp });
  const current = existing?.active || null;
  // Neighbours = same context+type, excluding only THIS exact chain — so when proposing a
  // campaign overlay, the generic version of the same rule_key surfaces for the eyeball check.
  const neighbours = (await getActiveRules({
    tenantId: tenant || DEFAULT_TENANT,
    contexts: [context],
    layer: layer === 'client' ? undefined : layer,
  })).filter((r) => r.rule_type === ruleType && !(r.rule_key === key && (r.campaign || null) === camp));
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
    neighbours: neighbours.map((n) => ({ rule_key: n.rule_key, layer: n.layer, campaign: n.campaign || null, version: n.version, body: n.body })),
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
