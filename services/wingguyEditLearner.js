/**
 * Learn-from-my-edit, done for the client - the weekly automatic pass over their draft edits.
 *
 * WHY (Guy, 3-4 Nov 2026): busy people rarely say "review my edits", so the pairs Wingguy collects
 * (every /wg draft next to what was actually sent - docs/wingguy.md "Learn-from-my-edit") pile up
 * unread and the drafts never learn. Training the instructions is also the main lever on a client's
 * Claude bill: a draft that is right first time needs no back-and-forth in the panel. So once a week
 * this pass makes the judgement call itself - but ONLY on a clear pattern - and always tells the
 * client what changed, with a one-click undo.
 *
 * THE RULES (settled with Guy 3-4 Nov 2026):
 *   - A pattern = the same kind of change in 3+ edits, sent to 3+ different people, all in the same
 *     direction (the model must name any edit that went the other way, and one such edit kills it).
 *     One-offs are left alone and stay pending for "review my edits".
 *   - Folded into ONE instruction through the normal propose -> commit door, amending an existing
 *     instruction over adding one. Client layer only: never a shared instruction, never a locked
 *     guardrail, never an instruction the client changed themselves in the last 7 days. At most two
 *     changes a week.
 *   - Every change is told to the client in a short email with an undo link (undoChange below), and
 *     Guy gets one summary covering everyone.
 *
 * COST (Guy, 4 Nov 2026 - "Approve both"):
 *   - Runs on the client's OWN stored Claude key. Never the platform key - except for the owner's
 *     own tenant, which uses it as normal. Stricter than resolveClientAnthropic on purpose: managed
 *     clients and WINGGUY_PLATFORM_KEY_CLIENTS are skipped here, not billed to Guy.
 *   - No new edit since the last run = no Claude call at all. Fewer than 3 pending = no call.
 *   - At most two calls a client a week: one to find patterns, one to write the changed wording
 *     (only when a pattern passed the code checks).
 *
 * WHEN: Sundays after 6pm Brisbane, so Monday's drafts already carry what was learned. The week is
 * claimed in Postgres before anything runs (the lhWeeklyCampaignReport pattern), so a restart never
 * runs it twice. EDIT_LEARN = off (default) | owner (Guy's tenant only) | on (everyone).
 * scripts/edit-learner-run-now.js runs it by hand, with --dry-run to see what it WOULD change.
 */

const crypto = require('crypto');
const { Pool } = require('pg');
const { createSafeLogger } = require('../utils/loggerHelper');
const { noUpfrontThinking } = require('../config/wingguyThinking');

const log = createSafeLogger('SYSTEM', null, 'edit_learner');

const RUN_HOUR = Number(process.env.EDIT_LEARN_HOUR) || 18;   // Brisbane, Sundays
const RUN_DAY = 'Sun';
const TICK_MS = 15 * 60 * 1000;
const MODEL_ID = process.env.EDIT_LEARN_MODEL_ID || process.env.WINGGUY_DRAFT_MODEL_ID || 'claude-sonnet-5-5';
// Sonnet 5.5 list prices (US$ per million tokens) - for the cost line in the dry run and the digest.
const PRICE_IN = 2;
const PRICE_OUT = 10;

const MIN_PAIRS = 3;          // a pattern needs at least this many edits...
const MIN_PEOPLE = 3;         // ...sent to at least this many different people
const MAX_CHANGES = 2;        // per client per week
const LOOKBACK_DAYS = 60;     // older pending edits are not read
const MAX_PAIRS_READ = 40;    // newest first
const HUMAN_EDIT_QUIET_DAYS = 7;
// The pattern call only has to know WHICH instruction a change belongs in - the writing call gets
// the full body. Guy's dry run on 4 Nov 2026 at 1500 chars: 65k tokens in, US$0.14.
const RULE_BODY_CAP = 600;    // chars of each instruction shown to the pattern call
const PAIR_TEXT_CAP = 1500;   // chars of each side of an edit
const ACTOR_PREFIX = 'auto-learn:';

let pool;
let schemaEnsured = false;
let intervalHandle = null;
let ticking = false;

function getPool() {
  const url = (process.env.DATABASE_URL || '').trim();
  if (!url) return null;
  if (!pool) {
    pool = new Pool({ connectionString: url, max: 2, ssl: { rejectUnauthorized: false } });
    pool.on('error', (e) => log.error(`edit-learner pool error: ${e.message}`));
  }
  return pool;
}

async function ensureSchema(client) {
  if (schemaEnsured) return;
  // One row per client: the newest edit already looked at, so a week with nothing new costs nothing.
  await client.query(`
    CREATE TABLE IF NOT EXISTS wingguy_edit_learn_state (
      tenant_id     TEXT        PRIMARY KEY,
      last_pair_id  BIGINT      NOT NULL DEFAULT 0,
      last_run_at   TIMESTAMPTZ,
      last_result   JSONB
    )
  `);
  // Once-a-week claim (key 'last_run' = the Brisbane date it ran).
  await client.query(`
    CREATE TABLE IF NOT EXISTS wingguy_edit_learn_runs (
      key         TEXT        PRIMARY KEY,
      value       TEXT,
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  // Every change this pass made - what the client was told, and what undo puts back.
  await client.query(`
    CREATE TABLE IF NOT EXISTS wingguy_edit_learn_changes (
      id            BIGSERIAL   PRIMARY KEY,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      tenant_id     TEXT        NOT NULL,
      rule_key      TEXT        NOT NULL,
      campaign      TEXT,
      from_version  INTEGER     NOT NULL DEFAULT 0,
      to_version    INTEGER     NOT NULL,
      over_standard BOOLEAN     NOT NULL DEFAULT false,
      noticed       TEXT,
      instruction   TEXT,
      pair_ids      BIGINT[]    NOT NULL DEFAULT '{}',
      undo_token    TEXT        NOT NULL UNIQUE,
      undone_at     TIMESTAMPTZ,
      emailed_at    TIMESTAMPTZ
    )
  `);
  schemaEnsured = true;
}

async function withClient(fn) {
  const p = getPool();
  if (!p) return null;
  const client = await p.connect();
  try {
    await ensureSchema(client);
    return await fn(client);
  } finally {
    client.release();
  }
}

function brisbaneNow() {
  const parts = new Intl.DateTimeFormat('en-AU', {
    timeZone: 'Australia/Brisbane', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23', weekday: 'short',
  }).formatToParts(new Date());
  const get = (t) => (parts.find((p) => p.type === t) || {}).value;
  return { date: `${get('year')}-${get('month')}-${get('day')}`, hour: Number(get('hour')), weekday: get('weekday') };
}

function ownerId() {
  return (process.env.RECALL_COACH_CLIENT_ID || 'Guy-Wilson').trim();
}

// ---------------------------------------------------------------------------
// Gates - pure, so the tests can pin every reason a client is skipped
// ---------------------------------------------------------------------------

/**
 * Which key pays for this client's pass. The client's own stored key, or - for the owner's tenant
 * only - the platform key. Anything else is skipped: this job never bills Guy for a client.
 * Returns { lane: 'client-stored-key' | 'owner-platform' | null }.
 */
function keyLane(client) {
  if (String((client && client.anthropicApiKey) || '').trim()) return { lane: 'client-stored-key' };
  if (client && String(client.clientId || '').trim() === ownerId()) return { lane: 'owner-platform' };
  return { lane: null };
}

/** Is this client in this run at all? mode = EDIT_LEARN (off | owner | on). */
function inScope(client, mode) {
  if (mode === 'on') return true;
  if (mode === 'owner') return String((client && client.clientId) || '').trim() === ownerId();
  return false;
}

/**
 * The cheap pre-check, before any Claude call. pairs = pending, newest first. lastPairId = the
 * newest id the previous run looked at.
 * Returns null (go ahead) or a plain-English skip reason.
 */
function skipBeforeCall({ client, pairs, lastPairId }) {
  if (client && client.stopLearningFromEdits) return 'switched off (Stop Learning From Edits)';
  if (!pairs.length) return 'no edits waiting';
  const newest = Math.max(...pairs.map((p) => Number(p.id)));
  if (newest <= Number(lastPairId || 0)) return 'no new edits since last week';
  if (pairs.length < MIN_PAIRS) return `only ${pairs.length} edit${pairs.length === 1 ? '' : 's'} waiting`;
  if (!keyLane(client).lane) return 'no Claude key of their own';
  return null;
}

/** Recent pending pairs worth reading: inside the lookback window, newest first, capped. */
function selectPairs(pairs, now = Date.now()) {
  const since = now - LOOKBACK_DAYS * 86400000;
  return (pairs || [])
    .filter((p) => !p.created_at || new Date(p.created_at).getTime() >= since)
    .slice(0, MAX_PAIRS_READ);
}

function personKey(p) {
  const k = String(p.lead_url || p.lead_name || '').trim().toLowerCase();
  return k || null;
}

/**
 * Code's check on what the pattern call claims. Returns the patterns that pass, each with the
 * target resolved, and the reason for every one that does not. Nothing the model says is trusted on
 * its own: the ids must be real, the people distinct, the direction unbroken, the target writable.
 *
 * rules = the tenant's active rules as they render (getActiveRules shadowed). recentHumanKeys = rule
 * keys the client changed themselves in the last HUMAN_EDIT_QUIET_DAYS.
 */
function checkPatterns(patterns, { pairs, rules, recentHumanKeys = new Set() }) {
  const byId = new Map(pairs.map((p) => [Number(p.id), p]));
  const accepted = [];
  const rejected = [];
  const usedKeys = new Set();
  const usedPairs = new Set();
  for (const pat of Array.isArray(patterns) ? patterns : []) {
    // This is the sentence the client reads - never cut it mid-sentence.
    const name = String(pat.noticed || pat.change_kind || 'a pattern').slice(0, 400);
    const ids = [...new Set((pat.pair_ids || []).map(Number).filter((n) => byId.has(n)))];
    const against = (pat.counter_pair_ids || []).map(Number).filter((n) => byId.has(n));
    if (ids.length < MIN_PAIRS) { rejected.push({ noticed: name, why: `only ${ids.length} matching edit(s)` }); continue; }
    if (against.length) { rejected.push({ noticed: name, why: `${against.length} edit(s) went the other way` }); continue; }
    const people = new Set(ids.map((n) => personKey(byId.get(n))).filter(Boolean));
    if (people.size < MIN_PEOPLE) { rejected.push({ noticed: name, why: `only ${people.size} different people` }); continue; }
    if (ids.some((n) => usedPairs.has(n))) { rejected.push({ noticed: name, why: 'shares edits with a pattern already taken' }); continue; }

    const key = String((pat.target && pat.target.rule_key) || '').trim();
    const camp = String((pat.target && pat.target.campaign) || '').trim() || null;
    let target;
    if (key) {
      const existing = (rules || []).find((r) => r.rule_key === key && (r.campaign || null) === camp);
      if (!existing) { rejected.push({ noticed: name, why: `instruction "${key}" not found` }); continue; }
      if (existing.layer === 'foundation' && existing.tier === 'locked') { rejected.push({ noticed: name, why: `"${key}" is a locked guardrail` }); continue; }
      if (existing.layer !== 'client' && existing.layer !== 'foundation') { rejected.push({ noticed: name, why: `"${key}" is in the ${existing.layer} drawer` }); continue; }
      target = {
        ruleKey: key, campaign: camp, context: existing.context, ruleType: existing.rule_type,
        currentBody: existing.body, overStandard: existing.layer === 'foundation', isNew: false,
      };
    } else {
      const nr = pat.new_rule || {};
      const newKey = String(nr.rule_key || '').trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
      if (!newKey || !nr.context || !nr.rule_type) { rejected.push({ noticed: name, why: 'no instruction to change and no complete new one' }); continue; }
      if ((rules || []).some((r) => r.rule_key === newKey)) { rejected.push({ noticed: name, why: `new key "${newKey}" already exists - should have amended it` }); continue; }
      target = { ruleKey: newKey, campaign: null, context: nr.context, ruleType: nr.rule_type, currentBody: null, overStandard: false, isNew: true };
    }
    if (recentHumanKeys.has(target.ruleKey)) { rejected.push({ noticed: name, why: `"${target.ruleKey}" was changed by hand this week` }); continue; }
    if (usedKeys.has(target.ruleKey)) { rejected.push({ noticed: name, why: `"${target.ruleKey}" already being changed this week` }); continue; }
    if (accepted.length >= MAX_CHANGES) { rejected.push({ noticed: name, why: `already ${MAX_CHANGES} changes this week` }); continue; }
    usedKeys.add(target.ruleKey);
    ids.forEach((n) => usedPairs.add(n));
    accepted.push({ noticed: name, pairIds: ids, people: people.size, target });
  }
  return { accepted, rejected };
}

// ---------------------------------------------------------------------------
// The two Claude calls
// ---------------------------------------------------------------------------

const PATTERN_SYSTEM = `You read a coach's edits to drafts an assistant wrote for them. Each EDIT is what the assistant DRAFTED next to what the coach actually SENT. Your job is to find STANDING PREFERENCES - the same kind of change made again and again - so the coach's instructions can be updated and the drafts come out right first time.

Be strict. Most edits are one-offs about that particular person or conversation (a fact fixed, a detail added, a reference to something they said). Those are NOT patterns - leave them out.

A pattern is ONLY: the same kind of change (e.g. "shortens the sign-off to first name", "removes the question at the end", "replaces 'catch up' with 'chat'", "cuts the second paragraph") in at least 3 edits, to at least 3 different people, all in the same direction. If any edit went the OTHER way (e.g. lengthened where others shortened), list it in counter_pair_ids - be honest, it decides whether the pattern stands.

For each pattern, pick the ONE existing instruction it belongs in (by rule_key, and campaign if the instruction is campaign-specific) - amending an existing instruction is strongly preferred over adding one. Only when nothing existing covers it, propose a new_rule with rule_key (lowercase-hyphenated), context (one of: global, outreach, reply, booking, post-call, follow-up) and rule_type (one of: voice, formatting, stage-logic, scheduling, asset-usage, qualifying). Never target an instruction marked LOCKED.

"noticed" is ONE plain sentence to the coach, in the second person, naming what they kept doing - e.g. "You kept cutting the closing question before sending." No jargon, no counts.

Return ONLY JSON: {"patterns":[{"noticed":"...","change_kind":"short label","pair_ids":[...],"counter_pair_ids":[...],"target":{"rule_key":"...","campaign":null},"new_rule":null}]}
No patterns is a perfectly good answer: {"patterns":[]}`;

const WRITE_SYSTEM = `You update a coach's drafting instructions to capture a preference they have shown by repeatedly editing drafts. For each item you get the current instruction (or none, for a new one), what was noticed, and the edits that show it (DRAFTED vs SENT).

Write the FULL new body of the instruction:
- Keep everything already in it that the edits do not contradict - same wording, same order. Change as little as possible.
- Add or amend only what the edits show, stated as a plain instruction ("Sign off with just the first name."), never as a story about the edits.
- Never copy a person's name, company or other specifics from the edits into the instruction.
- No em or en dashes; use " - " where a dash is needed. Australian English.

Also give "instruction": the ONE sentence that captures the change, as the coach would read it in a short note ("Sign off with just your first name - no 'Kind regards'."), second person, no dashes other than " - ".

Return ONLY JSON: {"items":[{"index":0,"body":"...","instruction":"...","change_note":"short note for the history"}]}`;

function clip(s, n) {
  const t = String(s || '');
  return t.length > n ? `${t.slice(0, n)}...[cut]` : t;
}

function pairsText(pairs) {
  return pairs.map((p) => [
    `EDIT #${p.id} · ${p.surface || 'linkedin'} · to ${p.lead_name || p.lead_url || 'unknown'} · ${String(p.created_at || '').slice(0, 10)}`,
    '--- DRAFTED ---', clip(p.generated, PAIR_TEXT_CAP),
    '--- SENT ---', clip(p.sent, PAIR_TEXT_CAP),
  ].join('\n')).join('\n\n');
}

function rulesText(rules) {
  return rules.map((r) => {
    const locked = r.layer === 'foundation' && r.tier === 'locked';
    return `[rule_key=${r.rule_key}${r.campaign ? ` campaign=${r.campaign}` : ''} · ${r.context}/${r.rule_type}${locked ? ' · LOCKED' : ''}]\n${clip(r.body, RULE_BODY_CAP)}`;
  }).join('\n\n');
}

function parseJsonObject(text) {
  const s = String(text || '');
  const a = s.indexOf('{');
  const b = s.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(s.slice(a, b + 1)); } catch (_) { return null; }
}

function textOf(resp) {
  return (resp && resp.content ? resp.content : []).filter((b) => b.type === 'text').map((b) => b.text).join('');
}

function addUsage(acc, resp) {
  const u = (resp && resp.usage) || {};
  acc.calls += 1;
  acc.inputTokens += Number(u.input_tokens || 0) + Number(u.cache_read_input_tokens || 0) + Number(u.cache_creation_input_tokens || 0);
  acc.outputTokens += Number(u.output_tokens || 0);
  acc.usd = (acc.inputTokens * PRICE_IN + acc.outputTokens * PRICE_OUT) / 1e6;
}

async function findPatterns(llm, { pairs, rules }, usage) {
  const scrub = require('./wingguyDossier').scrub;
  const resp = await llm.messages.create({
    model: MODEL_ID, max_tokens: 3000, thinking: noUpfrontThinking(MODEL_ID),
    system: PATTERN_SYSTEM,
    messages: [{ role: 'user', content: scrub(`THE COACH'S CURRENT INSTRUCTIONS\n\n${rulesText(rules)}\n\n====\n\nTHE EDITS (newest first)\n\n${pairsText(pairs)}`) }],
  });
  addUsage(usage, resp);
  const parsed = parseJsonObject(textOf(resp));
  return (parsed && Array.isArray(parsed.patterns)) ? parsed.patterns : [];
}

async function writeChanges(llm, { accepted, pairs }, usage) {
  const scrub = require('./wingguyDossier').scrub;
  const byId = new Map(pairs.map((p) => [Number(p.id), p]));
  const items = accepted.map((a, i) => [
    `ITEM ${i}`,
    `NOTICED: ${a.noticed}`,
    a.target.isNew ? `NEW INSTRUCTION (${a.target.context}/${a.target.ruleType}) - no current body` : `CURRENT INSTRUCTION "${a.target.ruleKey}":\n${a.target.currentBody}`,
    '', 'THE EDITS:', pairsText(a.pairIds.map((n) => byId.get(n))),
  ].join('\n')).join('\n\n====\n\n');
  const resp = await llm.messages.create({
    model: MODEL_ID, max_tokens: 4000, thinking: noUpfrontThinking(MODEL_ID),
    system: WRITE_SYSTEM,
    messages: [{ role: 'user', content: scrub(items) }],
  });
  addUsage(usage, resp);
  const parsed = parseJsonObject(textOf(resp));
  return (parsed && Array.isArray(parsed.items)) ? parsed.items : [];
}

/** The wording must pass the house checks before it is committed. Returns a reason or null. */
function badWording(item) {
  const body = String((item && item.body) || '').trim();
  if (!body) return 'no wording came back';
  if (!String(item.instruction || '').trim()) return 'no one-line summary came back';
  if (/[–—]/.test(body + item.instruction)) return 'wording used an em or en dash';
  return null;
}

// ---------------------------------------------------------------------------
// One client
// ---------------------------------------------------------------------------

function llmFor(client, deps = {}) {
  if (deps.llm) return deps.llm;
  const { getAnthropicClient, getAnthropicClientForKey } = require('../config/anthropicClient');
  const lane = keyLane(client).lane;
  if (lane === 'client-stored-key') return getAnthropicClientForKey(String(client.anthropicApiKey).trim());
  if (lane === 'owner-platform') return getAnthropicClient();
  return null;
}

async function recentHumanRuleKeys(store, tenant) {
  const since = Date.now() - HUMAN_EDIT_QUIET_DAYS * 86400000;
  const hist = await store.getHistory({ tenantId: tenant, limit: 100 }).catch(() => []);
  return new Set(hist
    .filter((h) => h.layer === 'client' && h.tenant_id === tenant)
    .filter((h) => new Date(h.created_at).getTime() >= since)
    .filter((h) => !String(h.actor || '').startsWith(ACTOR_PREFIX))
    .map((h) => h.rule_key));
}

/**
 * The whole pass for one client. dryRun = both Claude calls happen (so Guy sees the real result
 * and the real cost) but nothing is committed, resolved, remembered or emailed.
 * Returns { tenant, skipped?, changes: [...], rejected: [...], usage }.
 */
async function learnForClient(client, { dryRun = false, deps = {} } = {}) {
  const store = deps.store || require('./wingguyRulesStore');
  const tenant = String(client.clientId).trim();
  const usage = { calls: 0, inputTokens: 0, outputTokens: 0, usd: 0 };
  const out = { tenant, clientName: client.clientName || tenant, changes: [], rejected: [], usage };

  // Email edits first: read sent mail back and file any edited ones (no Claude cost).
  if (!deps.skipSettle) {
    try { await require('./wingguyMailMcp').settleEmailEditPairs(tenant); }
    catch (e) { log.warn(`edit-learner: email settle for ${tenant} skipped: ${e.message}`); }
  }

  const all = await store.getEditPairs({ tenantId: tenant, status: 'pending', limit: 100 });
  const pairs = selectPairs(all);
  const lastPairId = deps.lastPairId != null ? deps.lastPairId : await getLastPairId(tenant);
  const skip = skipBeforeCall({ client, pairs, lastPairId });
  out.pending = pairs.length;
  if (skip) { out.skipped = skip; return out; }

  const llm = llmFor(client, deps);
  if (!llm) { out.skipped = 'no Claude key of their own'; return out; }
  out.lane = keyLane(client).lane;

  const rules = await store.getActiveRules({ tenantId: tenant, shadowed: true });
  const recentHumanKeys = await recentHumanRuleKeys(store, tenant);
  const newestId = Math.max(...pairs.map((p) => Number(p.id)));

  const patterns = await findPatterns(llm, { pairs, rules }, usage);
  const { accepted, rejected } = checkPatterns(patterns, { pairs, rules, recentHumanKeys });
  out.rejected.push(...rejected);
  out.patternsSeen = patterns.length;

  if (accepted.length) {
    const written = await writeChanges(llm, { accepted, pairs }, usage);
    for (let i = 0; i < accepted.length; i++) {
      const a = accepted[i];
      const item = written.find((w) => Number(w.index) === i);
      const bad = badWording(item);
      if (bad) { out.rejected.push({ noticed: a.noticed, why: bad }); continue; }
      const change = {
        noticed: a.noticed, instruction: String(item.instruction).trim(), ruleKey: a.target.ruleKey,
        campaign: a.target.campaign, isNew: a.target.isNew, overStandard: a.target.overStandard,
        currentBody: a.target.currentBody, newBody: String(item.body).trim(), pairIds: a.pairIds, people: a.people,
      };
      if (dryRun) { out.changes.push({ ...change, dryRun: true }); continue; }
      try {
        out.changes.push(await commitChange(store, tenant, a.target, change, item.change_note));
      } catch (e) {
        out.rejected.push({ noticed: a.noticed, why: `commit refused: ${e.message}` });
      }
    }
  }

  if (!dryRun) await setLastPairId(tenant, newestId, { changes: out.changes.length, rejected: out.rejected.length, usage });
  return out;
}

async function commitChange(store, tenant, target, change, changeNote) {
  const actor = `${ACTOR_PREFIX}${tenant}`;
  // The proposal step is the same check a human proposal gets - refused here means refused.
  const prop = await store.proposeRule({
    tenantId: tenant, readerTenantId: tenant, layer: 'client', ruleKey: target.ruleKey,
    context: target.context, ruleType: target.ruleType, campaign: target.campaign || undefined,
    body: change.newBody, actorTenantId: tenant, via: 'door',
  });
  if (prop.blocked) throw new Error(prop.blocked.message);
  const r = await store.commitRule({
    tenantId: tenant, layer: 'client', ruleKey: target.ruleKey, context: target.context,
    ruleType: target.ruleType, campaign: target.campaign || undefined, body: change.newBody,
    changeNote: `learned from ${change.pairIds.length} edits: ${String(changeNote || change.noticed).slice(0, 200)}`,
    createdBy: actor, expectedVersion: prop.expectedVersion, actorTenantId: tenant, via: 'door',
  });
  await store.resolveEditPairs({
    tenantId: tenant, ids: change.pairIds, status: 'reviewed',
    note: `auto-learn: folded into ${r.ruleKey} v${r.version}`,
  });
  const token = crypto.randomBytes(24).toString('base64url');
  const row = await withClient(async (c) => (await c.query(
    `INSERT INTO wingguy_edit_learn_changes
       (tenant_id, rule_key, campaign, from_version, to_version, over_standard, noticed, instruction, pair_ids, undo_token)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
    [tenant, r.ruleKey, target.campaign || null, prop.expectedVersion, r.version, !!target.overStandard && prop.expectedVersion === 0,
      change.noticed, change.instruction, change.pairIds, token],
  )).rows[0]);
  log.info(`edit-learner: ${tenant} ${r.ruleKey} v${prop.expectedVersion}->v${r.version} from ${change.pairIds.length} edits`);
  return { ...change, version: r.version, fromVersion: prop.expectedVersion, changeId: row && row.id, undoToken: token };
}

async function getLastPairId(tenant) {
  const r = await withClient((c) => c.query('SELECT last_pair_id FROM wingguy_edit_learn_state WHERE tenant_id = $1', [tenant]));
  return r && r.rows.length ? Number(r.rows[0].last_pair_id) : 0;
}

async function setLastPairId(tenant, id, result) {
  await withClient((c) => c.query(
    `INSERT INTO wingguy_edit_learn_state (tenant_id, last_pair_id, last_run_at, last_result) VALUES ($1, $2, now(), $3::jsonb)
     ON CONFLICT (tenant_id) DO UPDATE SET last_pair_id = GREATEST(wingguy_edit_learn_state.last_pair_id, EXCLUDED.last_pair_id),
       last_run_at = now(), last_result = EXCLUDED.last_result`,
    [tenant, id, JSON.stringify(result || {})],
  ));
}

// ---------------------------------------------------------------------------
// Telling people
// ---------------------------------------------------------------------------

function undoUrl(token) {
  const base = (process.env.SERIES_PUBLIC_BASE_URL || 'https://knowaguy.com.au').replace(/\/+$/, '');
  return `${base}/wingguy/undo-learned?t=${encodeURIComponent(token)}`;
}

function escapeHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** The short note to the client. Pure. */
function clientEmail({ firstName, changes }) {
  const one = changes.length === 1;
  const subject = one ? 'Wingguy picked up something from your edits' : 'Wingguy picked up a couple of things from your edits';
  const blocks = changes.map((c) => ({
    text: `${c.noticed} So I've added this to your instructions:\n"${c.instruction}"\nNot right? Undo it here: ${undoUrl(c.undoToken)}`,
    html: `<p>${escapeHtml(c.noticed)} So I've added this to your instructions:</p><p style="margin-left:1em"><em>"${escapeHtml(c.instruction)}"</em></p><p><a href="${undoUrl(c.undoToken)}">Not right? Undo this change</a></p>`,
  }));
  const hi = firstName ? `Hi ${firstName},` : 'Hi,';
  const close = 'Or just tell your Claude "undo that change from my edits". Your drafts use this from now on.';
  return {
    subject,
    text: [hi, '', ...blocks.map((b) => b.text).join('\n\n').split('\n'), '', close, '', '- Wingguy'].join('\n'),
    html: `<p>${hi}</p>${blocks.map((b) => b.html).join('')}<p>${escapeHtml(close)}</p><p>- Wingguy</p>`,
  };
}

async function emailClient(client, changes, deps = {}) {
  const to = String(client.clientEmailAddress || '').trim();
  if (!to || !changes.length) return { sent: false, why: to ? 'no changes' : 'no email address' };
  let coach = null;
  try { coach = client.coach ? await require('./clientService').getClientById(client.coach) : null; } catch (_) { coach = null; }
  const coachEmail = String((coach && coach.clientEmailAddress) || process.env.ALERT_EMAIL || 'guyralphwilson@gmail.com').trim();
  const addr = require('./mailgunCreds').fromEmail();
  const m = clientEmail({ firstName: client.clientFirstName, changes });
  const send = deps.sendClientEmail || require('./emailNotificationService').sendMailgunEmail;
  await send({ from: addr.includes('<') ? addr : `Wingguy <${addr}>`, to, 'h:Reply-To': coachEmail, subject: m.subject, text: m.text, html: m.html });
  await withClient((c) => c.query('UPDATE wingguy_edit_learn_changes SET emailed_at = now() WHERE id = ANY($1)', [changes.map((x) => x.changeId).filter(Boolean)]));
  const record = deps.recordComm || require('./commsLog').recordComm;
  await Promise.resolve(record({
    coachClientId: client.clientId, channel: 'edit-learn', recipient: to, subject: m.subject,
    summary: `Learned from edits: ${changes.map((c) => c.ruleKey).join(', ')}`, meta: { changes: changes.map((c) => ({ ruleKey: c.ruleKey, version: c.version, instruction: c.instruction })) },
  })).catch((e) => log.error(`edit-learner comms log for ${client.clientId} failed: ${e.message}`));
  return { sent: true };
}

/** Guy's one summary. Pure. */
function buildDigest(results, { date, dryRun = false }) {
  const lines = [];
  const changed = results.filter((r) => r.changes.length);
  const cost = results.reduce((s, r) => s + (r.usage ? r.usage.usd : 0), 0);
  lines.push(`Learning from edits - ${date}${dryRun ? ' (DRY RUN - nothing changed)' : ''}`, '');
  for (const r of changed) {
    lines.push(`${r.clientName}:`);
    for (const c of r.changes) lines.push(`  - ${c.ruleKey}${c.isNew ? ' (new)' : ''}: "${c.instruction}" (${c.pairIds.length} edits, ${c.people} people)${c.emailed === false ? ' - NOT emailed' : ''}`);
  }
  if (!changed.length) lines.push('No clear patterns this week - nothing changed.');
  const looked = results.filter((r) => !r.skipped && !r.changes.length);
  if (looked.length) lines.push('', `Looked, nothing clear: ${looked.map((r) => r.clientName).join(', ')}`);
  const skipped = results.filter((r) => r.skipped);
  if (skipped.length) lines.push('', 'Skipped (no Claude call):', ...skipped.map((r) => `  - ${r.clientName} - ${r.skipped}`));
  lines.push('', `Claude calls: ${results.reduce((s, r) => s + (r.usage ? r.usage.calls : 0), 0)}, about US$${cost.toFixed(2)} in all (each on the client's own key).`);
  const text = lines.join('\n');
  return { subject: `Learning from edits: ${changed.reduce((s, r) => s + r.changes.length, 0)} change(s)${dryRun ? ' (dry run)' : ''}`, text, html: `<pre style="font-family:inherit;white-space:pre-wrap">${escapeHtml(text)}</pre>` };
}

// ---------------------------------------------------------------------------
// The weekly run
// ---------------------------------------------------------------------------

function mode() {
  const m = String(process.env.EDIT_LEARN || 'off').toLowerCase();
  return ['owner', 'on'].includes(m) ? m : 'off';
}

/**
 * force = skip the clock and the claim (the run-now script). tenant = just that client. dryRun =
 * no writes, no emails (Guy still gets the digest unless quiet).
 */
async function runWeekly({ force = false, dryRun = false, tenant, quiet = false, deps = {} } = {}) {
  const m = tenant ? 'on' : mode();
  if (m === 'off') return { ran: false, reason: 'EDIT_LEARN is off' };
  const now = brisbaneNow();
  if (!force) {
    if (now.weekday !== RUN_DAY || now.hour < RUN_HOUR) return { ran: false, reason: 'not Sunday evening' };
    const claim = await withClient((c) => c.query(
      `INSERT INTO wingguy_edit_learn_runs (key, value, updated_at) VALUES ('last_run', $1, now())
       ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = now() WHERE wingguy_edit_learn_runs.value IS DISTINCT FROM $1
       RETURNING key`, [now.date]));
    if (!claim || !claim.rows.length) return { ran: false, reason: 'already ran this week' };
  }
  const getAll = deps.getAllActiveClients || require('./clientService').getAllActiveClients;
  const clients = (await getAll()).filter((c) => (tenant ? String(c.clientId) === tenant : inScope(c, m)));
  const results = [];
  for (const c of clients) {
    try {
      // A dry run does not even settle email drafts (that files pairs and closes ledger rows).
      const r = await learnForClient(c, { dryRun, deps: dryRun ? { skipSettle: true, ...deps } : deps });
      if (!dryRun && r.changes.length) {
        try { const e = await emailClient(c, r.changes, deps); r.changes.forEach((x) => { x.emailed = e.sent; }); }
        catch (e) { r.changes.forEach((x) => { x.emailed = false; }); log.error(`edit-learner: email to ${c.clientId} failed: ${e.message}`); }
      }
      results.push(r);
    } catch (e) {
      results.push({ tenant: c.clientId, clientName: c.clientName || c.clientId, changes: [], rejected: [], skipped: `failed (${e.message})` });
    }
  }
  const digest = buildDigest(results, { date: now.date, dryRun });
  if (!quiet) {
    const send = deps.sendAlertEmail || require('./emailNotificationService').sendAlertEmail;
    await send(digest.subject, digest.html, null, { text: digest.text }).catch((e) => log.error(`edit-learner digest failed: ${e.message}`));
  }
  log.info(`edit-learner: ${results.length} client(s), ${results.reduce((s, r) => s + r.changes.length, 0)} change(s)${dryRun ? ' (dry run)' : ''}`);
  return { ran: true, results, digest };
}

function startEditLearner() {
  if (mode() === 'off') { log.info('edit-learner: off (EDIT_LEARN=off)'); return; }
  if (intervalHandle) return;
  const tick = async () => {
    if (ticking) return;
    ticking = true;
    try { await runWeekly(); } catch (e) { log.error(`edit-learner tick failed (non-fatal): ${e.message}`); } finally { ticking = false; }
  };
  intervalHandle = setInterval(tick, TICK_MS);
  setTimeout(tick, 3 * 60 * 1000);
  log.info(`edit-learner: starting (Sundays after ${RUN_HOUR}:00 Brisbane, EDIT_LEARN=${mode()})`);
}

// ---------------------------------------------------------------------------
// Undo - the email link, and "undo that change from my edits" in chat
// ---------------------------------------------------------------------------

async function getChangeByToken(token) {
  const t = String(token || '').trim();
  if (t.length < 16) return null;
  const r = await withClient((c) => c.query('SELECT * FROM wingguy_edit_learn_changes WHERE undo_token = $1', [t]));
  return r && r.rows.length ? r.rows[0] : null;
}

async function listChanges(tenant, limit = 10) {
  const r = await withClient((c) => c.query(
    'SELECT * FROM wingguy_edit_learn_changes WHERE tenant_id = $1 ORDER BY id DESC LIMIT $2', [tenant, limit]));
  return r ? r.rows : [];
}

/**
 * Put back what was there before. Only if the instruction is still the version this pass wrote -
 * if the client has changed it since, undoing would throw their change away, so it refuses and says so.
 * Returns { ok, already?, message }.
 */
async function undoChange(row, { deps = {} } = {}) {
  if (!row) return { ok: false, message: 'That change was not found.' };
  if (row.undone_at) return { ok: true, already: true, message: 'Already undone - nothing more to do.' };
  const store = deps.store || require('./wingguyRulesStore');
  const actor = `${ACTOR_PREFIX}${row.tenant_id}:undo`;
  const live = await store.getRule({ tenantId: row.tenant_id, layer: 'client', ruleKey: row.rule_key, campaign: row.campaign || undefined });
  const liveVersion = live && live.active ? Number(live.active.version) : 0;
  if (liveVersion !== Number(row.to_version)) {
    return { ok: false, message: `This instruction has been changed again since (it is now version ${liveVersion}), so it can't be undone automatically - just tell your Claude what you'd like it to say.` };
  }
  if (Number(row.from_version) > 0) {
    await store.revertRule({ tenantId: row.tenant_id, layer: 'client', ruleKey: row.rule_key, campaign: row.campaign || undefined, toVersion: row.from_version, createdBy: actor, actorTenantId: row.tenant_id, via: 'door' });
  } else if (row.over_standard) {
    await store.resetRuleToStandard({ tenantId: row.tenant_id, ruleKey: row.rule_key, campaign: row.campaign || undefined, createdBy: actor, changeNote: 'undo of a change learned from edits' });
  } else {
    await store.retireRule({ tenantId: row.tenant_id, layer: 'client', ruleKey: row.rule_key, campaign: row.campaign || undefined, createdBy: actor, expectedVersion: row.to_version, changeNote: 'undo of a change learned from edits', actorTenantId: row.tenant_id, via: 'door' });
  }
  await withClient((c) => c.query('UPDATE wingguy_edit_learn_changes SET undone_at = now() WHERE id = $1', [row.id]));
  log.info(`edit-learner: undo ${row.tenant_id} ${row.rule_key} v${row.to_version}`);
  return { ok: true, message: 'Done - that change is undone, and your instruction is back to how it was.' };
}

const page = (title, body) => `<!doctype html>
<html lang="en-AU"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><title>${title}</title>
<style>
  body{margin:0;background:#F2EEE6;color:#22201C;font-family:system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;line-height:1.65;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:2rem}
  .card{max-width:32rem}
  h1{font-family:"Iowan Old Style","Palatino Linotype",Palatino,Georgia,serif;font-weight:600;font-size:1.7rem;margin:0 0 .8rem}
  p{color:#4C473F;margin:0 0 1rem}
  button{font:inherit;background:#1E5E58;color:#fff;border:0;border-radius:6px;padding:.6rem 1.2rem;cursor:pointer}
  @media (prefers-color-scheme:dark){body{background:#1A1917;color:#ECE6DA}p{color:#B6AD9E}button{background:#63B6AB;color:#1A1917}}
</style></head><body><div class="card">${body}</div></body></html>`;

/**
 * GET shows what would be undone and a button (a mail scanner previewing the link changes
 * nothing); POST does it. Token = the auth, as with the unsubscribe links.
 */
function mountUndoRoutes(app) {
  const express = require('express');
  app.get('/wingguy/undo-learned', async (req, res) => {
    const row = await getChangeByToken(req.query.t).catch(() => null);
    if (!row) return res.status(404).send(page('Link not recognised', '<h1>That link didn\'t work</h1><p>It may have been cut short by your email. Just tell your Claude "undo that change from my edits" instead.</p>'));
    if (row.undone_at) return res.send(page('Already undone', '<h1>Already undone</h1><p>That change has already been taken back out. Nothing more to do.</p>'));
    return res.send(page('Undo this change?', `<h1>Undo this change?</h1>
      <p>${escapeHtml(row.noticed)} So Wingguy added this to your instructions:</p>
      <p><em>"${escapeHtml(row.instruction)}"</em></p>
      <form method="post"><input type="hidden" name="t" value="${escapeHtml(req.query.t)}"><button type="submit">Yes, undo it</button></form>`));
  });
  app.post('/wingguy/undo-learned', express.urlencoded({ extended: false }), async (req, res) => {
    try {
      const row = await getChangeByToken(req.body && req.body.t);
      const r = await undoChange(row);
      return res.status(r.ok ? 200 : 409).send(page(r.ok ? 'Undone' : 'Not undone', `<h1>${r.ok ? 'Undone' : 'Not undone'}</h1><p>${escapeHtml(r.message)}</p>`));
    } catch (e) {
      log.error(`edit-learner undo failed: ${e.message}`);
      return res.status(500).send(page('Something went wrong', '<h1>Something went wrong</h1><p>Nothing was changed. Tell your Claude "undo that change from my edits" and it will sort it out.</p>'));
    }
  });
}

module.exports = {
  keyLane, inScope, skipBeforeCall, selectPairs, checkPatterns, badWording, clientEmail, buildDigest, parseJsonObject,
  learnForClient, runWeekly, startEditLearner, mountUndoRoutes, undoChange, listChanges, getChangeByToken, undoUrl,
  MIN_PAIRS, MIN_PEOPLE, MAX_CHANGES,
};
