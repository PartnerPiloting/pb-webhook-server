// services/clientTouchPlanStore.js
//
// Where the weekly client touch planner keeps its working state (docs/CLIENT-TOUCH-PLANNER.md):
//
//   client_touch_plans      one row per client per week - the pick, the drafted opening, the status
//                           Guy gave it (proposed -> approved | edited | skipped | sent), and his
//                           "why not" with where it was filed
//   client_touch_pins       what Guy pinned - for one client ('*' = everyone) for a given week
//   client_touch_skips      "nothing for X until <date>"
//   client_touch_feedback   every "why not", with the home it belongs in (the "Tuning by approval"
//                           table). The laptop script scripts/file-touch-feedback.js drains the ones
//                           that live in git (IMPROVEMENTS.md, the design doc); the ones that live in
//                           a store (the client note, the opening instructions) are applied at once.
//   client_touch_opening_rules  the writing instructions for openings, used every week
//
// The SEND RECORD is not here - that is services/clientTouchStore.js (client_touches), the memory
// the picker reads. A plan row is a proposal; a touch row is a fact.
//
// House style: clientTouchStore.js - lazy Pool, CREATE IF NOT EXISTS, test seam, no DATABASE_URL =
// reads return empty and writes no-op.

const { Pool } = require('pg');

let pool;
let schemaEnsured = false;

// held   = approved, but the sending-morning re-check found something changed - Guy keeps or swaps
// lapsed = never approved by the sending morning - it rolled off, nothing went
const STATUSES = ['proposed', 'approved', 'edited', 'skipped', 'sent', 'failed', 'nothing', 'left-out', 'held', 'lapsed'];
const FEEDBACK_HOMES = ['body', 'choice', 'person', 'openings'];

function getPool() {
  if (pool) return pool;
  const url = (process.env.DATABASE_URL || '').trim();
  if (!url) return null;
  pool = new Pool({ connectionString: url, max: 3, ssl: { rejectUnauthorized: false } });
  return pool;
}

/** Test seam: inject a fake pool. */
function __setTestPool(fake) {
  pool = fake;
  schemaEnsured = fake ? true : false;
}

async function ensureSchema(c) {
  if (schemaEnsured) return;
  await c.query(`
    CREATE TABLE IF NOT EXISTS client_touch_plans (
      id BIGSERIAL PRIMARY KEY,
      week_of DATE NOT NULL,
      client_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'proposed',
      pick JSONB,
      facts JSONB,
      opening TEXT,
      subject TEXT,
      body_html TEXT,
      body_preview TEXT,
      recipient TEXT,
      why_not TEXT,
      why_not_home TEXT,
      sent_at TIMESTAMPTZ,
      send_error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (week_of, client_id)
    );
  `);
  // Added 22 Oct 2026 (week-ahead planner): why a row was held on the sending morning, and the
  // pick the re-check would choose instead - so the panel can offer "keep" or "swap to that".
  await c.query('ALTER TABLE client_touch_plans ADD COLUMN IF NOT EXISTS hold JSONB');
  await c.query(`
    CREATE TABLE IF NOT EXISTS client_touch_pins (
      id BIGSERIAL PRIMARY KEY,
      client_id TEXT NOT NULL,
      week_of DATE NOT NULL,
      kind TEXT NOT NULL,
      key TEXT NOT NULL,
      title TEXT,
      form TEXT,
      note TEXT,
      body_html TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (client_id, week_of)
    );
  `);
  await c.query(`
    CREATE TABLE IF NOT EXISTS client_touch_skips (
      client_id TEXT PRIMARY KEY,
      until DATE NOT NULL,
      note TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await c.query(`
    CREATE TABLE IF NOT EXISTS client_touch_feedback (
      id BIGSERIAL PRIMARY KEY,
      week_of DATE,
      client_id TEXT,
      piece_key TEXT,
      home TEXT NOT NULL,
      words TEXT NOT NULL,
      filed_at TIMESTAMPTZ,
      filed_where TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await c.query(`
    CREATE TABLE IF NOT EXISTS client_touch_opening_rules (
      id BIGSERIAL PRIMARY KEY,
      rule TEXT NOT NULL,
      source TEXT,
      active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await c.query(`
    CREATE TABLE IF NOT EXISTS client_touch_state (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  schemaEnsured = true;
}

async function withDb(fn, fallback) {
  const p = getPool();
  if (!p) return fallback;
  let c;
  try {
    c = await p.connect();
    await ensureSchema(c);
    return await fn(c);
  } catch (e) {
    console.warn(`[clientTouchPlanStore] ${e.message}`);
    return fallback;
  } finally {
    if (c) c.release();
  }
}

// ---------------------------------------------------------------------------------------------
// Pure

/** 'YYYY-MM-DD' of the Monday of the week `now` falls in (Brisbane clock - Guy's Monday). */
function weekOf(now = new Date(), timeZone = 'Australia/Brisbane') {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' }).formatToParts(new Date(now));
  const get = (t) => (parts.find((p) => p.type === t) || {}).value;
  const back = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 }[get('weekday')] || 0;
  const d = new Date(Date.UTC(Number(get('year')), Number(get('month')) - 1, Number(get('day'))));
  d.setUTCDate(d.getUTCDate() - back);
  return d.toISOString().slice(0, 10);
}

/** 'YYYY-MM-DD' n weeks on from a week (negative goes back). */
function addWeeks(week, n) {
  const d = new Date(`${week}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 7 * n);
  return d.toISOString().slice(0, 10);
}

/**
 * The Monday Guy is working towards - the next sending morning that has not happened yet. Before
 * the send hour on a Monday that is today; from then on it is the Monday after (the plan is built
 * a week ahead, so Guy can chip away at it all week).
 */
function planningWeek(now = new Date(), sendHour = 8, timeZone = 'Australia/Brisbane') {
  const parts = new Intl.DateTimeFormat('en-AU', { timeZone, hour: '2-digit', hour12: false, weekday: 'short' }).formatToParts(new Date(now));
  const get = (t) => (parts.find((p) => p.type === t) || {}).value;
  const thisWeek = weekOf(now, timeZone);
  return get('weekday') === 'Mon' && Number(get('hour')) < sendHour ? thisWeek : addWeeks(thisWeek, 1);
}

/** Where a "why not" belongs (the Tuning-by-approval table). Pure; `home` must be one of FEEDBACK_HOMES. */
function feedbackHome(home) {
  const h = String(home || '').trim().toLowerCase();
  if (!FEEDBACK_HOMES.includes(h)) throw new Error(`why-not home must be one of ${FEEDBACK_HOMES.join(', ')}`);
  return {
    body: { home: 'body', where: 'content/one-pagers/IMPROVEMENTS.md under that piece', live: false },
    choice: { home: 'choice', where: 'docs/CLIENT-TOUCH-PLANNER.md - a rule', live: false },
    person: { home: 'person', where: "the client's note (Touch Note on the record)", live: true },
    openings: { home: 'openings', where: 'the opening instructions, used every week', live: true },
  }[h];
}

// ---------------------------------------------------------------------------------------------
// Plans

function rowOut(r) {
  if (!r) return null;
  return {
    id: r.id,
    weekOf: r.week_of instanceof Date ? r.week_of.toISOString().slice(0, 10) : String(r.week_of).slice(0, 10),
    clientId: r.client_id,
    status: r.status,
    pick: r.pick || null,
    facts: r.facts || null,
    opening: r.opening || '',
    subject: r.subject || '',
    bodyHtml: r.body_html || '',
    bodyPreview: r.body_preview || '',
    recipient: r.recipient || null,
    whyNot: r.why_not || '',
    whyNotHome: r.why_not_home || null,
    sentAt: r.sent_at || null,
    sendError: r.send_error || null,
    hold: r.hold || null,
    updatedAt: r.updated_at || null,
  };
}

/** Write (or refresh) one client's plan row for a week. A row Guy already acted on keeps his verdict. */
async function upsertPlan({ weekOf: week, clientId, status = 'proposed', pick = null, facts = null, opening = '', subject = '', bodyHtml = '', bodyPreview = '', recipient = null }) {
  if (!week || !clientId) throw new Error('weekOf and clientId are required');
  return withDb(async (c) => {
    const r = await c.query(
      `INSERT INTO client_touch_plans (week_of, client_id, status, pick, facts, opening, subject, body_html, body_preview, recipient)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (week_of, client_id) DO UPDATE SET
         pick = EXCLUDED.pick, facts = EXCLUDED.facts, body_preview = EXCLUDED.body_preview, recipient = EXCLUDED.recipient,
         -- a rebuild refreshes the proposal only where Guy has not yet spoken
         status = CASE WHEN client_touch_plans.status IN ('proposed','nothing','left-out') THEN EXCLUDED.status ELSE client_touch_plans.status END,
         opening = CASE WHEN client_touch_plans.status IN ('proposed','nothing','left-out') THEN EXCLUDED.opening ELSE client_touch_plans.opening END,
         subject = CASE WHEN client_touch_plans.status IN ('proposed','nothing','left-out') THEN EXCLUDED.subject ELSE client_touch_plans.subject END,
         body_html = CASE WHEN client_touch_plans.status IN ('proposed','nothing','left-out') THEN EXCLUDED.body_html ELSE client_touch_plans.body_html END,
         updated_at = now()
       RETURNING *`,
      [week, clientId, status, pick ? JSON.stringify(pick) : null, facts ? JSON.stringify(facts) : null, opening, subject, bodyHtml, bodyPreview, recipient],
    );
    return rowOut(r.rows[0]);
  }, null);
}

async function plansFor(week) {
  if (!week) return [];
  return withDb(async (c) => {
    const r = await c.query('SELECT * FROM client_touch_plans WHERE week_of = $1 ORDER BY client_id', [week]);
    return r.rows.map(rowOut);
  }, []);
}

async function planFor(week, clientId) {
  if (!week || !clientId) return null;
  return withDb(async (c) => {
    const r = await c.query('SELECT * FROM client_touch_plans WHERE week_of = $1 AND client_id = $2', [week, clientId]);
    return rowOut(r.rows[0]);
  }, null);
}

/**
 * Guy's verdict on a row: approve / edit (new opening or subject) / skip / swap (a new pick, rebuilt
 * by the planner) - and the sender's: sent / failed / held / lapsed. `hold` undefined leaves the
 * stored hold as it is; null clears it; an object replaces it.
 */
async function setPlanStatus(week, clientId, status, { opening, subject, bodyHtml, whyNot, whyNotHome, sentAt, sendError, hold } = {}) {
  if (!STATUSES.includes(status)) throw new Error(`invalid status "${status}"`);
  return withDb(async (c) => {
    const r = await c.query(
      `UPDATE client_touch_plans SET status = $3,
         opening = COALESCE($4, opening), subject = COALESCE($5, subject), body_html = COALESCE($6, body_html),
         why_not = COALESCE($7, why_not), why_not_home = COALESCE($8, why_not_home),
         sent_at = COALESCE($9, sent_at), send_error = $10,
         hold = CASE WHEN $11::boolean THEN $12::jsonb ELSE hold END, updated_at = now()
       WHERE week_of = $1 AND client_id = $2 RETURNING *`,
      [week, clientId, status, opening ?? null, subject ?? null, bodyHtml ?? null, whyNot ?? null, whyNotHome ?? null, sentAt ?? null, sendError ?? null,
        hold !== undefined, hold ? JSON.stringify(hold) : null],
    );
    return rowOut(r.rows[0]);
  }, null);
}

/** Guy rewords the welcome's congratulations line on a row ('' drops it). Stored inside the pick's body. */
async function setPlanCongrats(week, clientId, text) {
  return withDb(async (c) => {
    const r = await c.query(
      `UPDATE client_touch_plans SET pick = jsonb_set(COALESCE(pick, '{}'::jsonb), '{body,congrats}', $3::jsonb, true), updated_at = now()
       WHERE week_of = $1 AND client_id = $2 AND pick ? 'body' AND pick->'body' IS NOT NULL AND jsonb_typeof(pick->'body') = 'object' RETURNING *`,
      [week, clientId, JSON.stringify(String(text))],
    );
    return rowOut(r.rows[0]);
  }, null);
}

/** Guy changes the thought for the week on a row (it is stored inside the pick). Leaves the status alone. */
async function setPlanThought(week, clientId, thought) {
  return withDb(async (c) => {
    const r = await c.query(
      `UPDATE client_touch_plans SET pick = jsonb_set(COALESCE(pick, '{}'::jsonb), '{thought}', $3::jsonb, true), updated_at = now()
       WHERE week_of = $1 AND client_id = $2 RETURNING *`,
      [week, clientId, JSON.stringify(thought || null)],
    );
    return rowOut(r.rows[0]);
  }, null);
}

/** The share approved without a change, per week - the measure that decides send-with-veto. */
async function approvalRates(weeks = 6) {
  return withDb(async (c) => {
    const r = await c.query(
      `SELECT week_of, COUNT(*) FILTER (WHERE status IN ('approved','sent'))::int AS approved,
              COUNT(*) FILTER (WHERE status = 'edited')::int AS edited,
              COUNT(*) FILTER (WHERE status = 'skipped')::int AS skipped
       FROM client_touch_plans WHERE pick IS NOT NULL AND status NOT IN ('proposed','nothing','left-out')
       GROUP BY week_of ORDER BY week_of DESC LIMIT $1`, [weeks],
    );
    return r.rows.map((x) => {
      const total = x.approved + x.edited + x.skipped;
      return { weekOf: String(x.week_of).slice(0, 10), approved: x.approved, edited: x.edited, skipped: x.skipped, total, share: total ? Math.round((100 * x.approved) / total) : null };
    });
  }, []);
}

// ---------------------------------------------------------------------------------------------
// Pins and skips

async function setPin({ clientId, weekOf: week, kind, key, title = '', form = null, note = '', bodyHtml = '' }) {
  if (!clientId || !week || !kind || !key) throw new Error('clientId, weekOf, kind and key are required');
  return withDb(async (c) => {
    const r = await c.query(
      `INSERT INTO client_touch_pins (client_id, week_of, kind, key, title, form, note, body_html) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (client_id, week_of) DO UPDATE SET kind = $3, key = $4, title = $5, form = $6, note = $7, body_html = $8
       RETURNING *`, [clientId, week, kind, key, title, form, note, bodyHtml],
    );
    return r.rows[0];
  }, null);
}

async function clearPin(clientId, week) {
  return withDb(async (c) => { await c.query('DELETE FROM client_touch_pins WHERE client_id = $1 AND week_of = $2', [clientId, week]); return true; }, false);
}

/** clientId -> pin for the week; '*' is everyone's. */
async function pinsFor(week) {
  return withDb(async (c) => {
    const r = await c.query('SELECT * FROM client_touch_pins WHERE week_of = $1', [week]);
    const out = new Map();
    for (const p of r.rows) out.set(p.client_id, { kind: p.kind, key: p.key, title: p.title || '', form: p.form || null, note: p.note || '', bodyHtml: p.body_html || '' });
    return out;
  }, new Map());
}

async function setSkip(clientId, until, note = '') {
  if (!clientId || !until) throw new Error('clientId and until are required');
  return withDb(async (c) => {
    await c.query(
      `INSERT INTO client_touch_skips (client_id, until, note) VALUES ($1,$2,$3)
       ON CONFLICT (client_id) DO UPDATE SET until = $2, note = $3, created_at = now()`, [clientId, until, note],
    );
    return true;
  }, false);
}

async function clearSkip(clientId) {
  return withDb(async (c) => { await c.query('DELETE FROM client_touch_skips WHERE client_id = $1', [clientId]); return true; }, false);
}

/** clientId -> 'YYYY-MM-DD' for every standing skip. */
async function skips() {
  return withDb(async (c) => {
    const r = await c.query('SELECT client_id, until, note FROM client_touch_skips');
    return new Map(r.rows.map((x) => [x.client_id, { until: String(x.until instanceof Date ? x.until.toISOString() : x.until).slice(0, 10), note: x.note || '' }]));
  }, new Map());
}

// ---------------------------------------------------------------------------------------------
// Feedback ("why not") and opening instructions

async function addFeedback({ weekOf: week = null, clientId = null, pieceKey = null, home, words, filedWhere = null, filedAt = null }) {
  const h = feedbackHome(home);
  const w = String(words || '').trim();
  if (!w) throw new Error('words are required');
  return withDb(async (c) => {
    const r = await c.query(
      `INSERT INTO client_touch_feedback (week_of, client_id, piece_key, home, words, filed_where, filed_at) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [week, clientId, pieceKey, h.home, w, filedWhere || h.where, filedAt],
    );
    return { id: r.rows[0].id, ...h };
  }, null);
}

/** Feedback not yet written into its git-held home (body and choice) - the laptop script reads these. */
async function unfiledFeedback() {
  return withDb(async (c) => {
    const r = await c.query(`SELECT * FROM client_touch_feedback WHERE filed_at IS NULL ORDER BY created_at`);
    return r.rows;
  }, []);
}

async function markFiled(id, where) {
  return withDb(async (c) => { await c.query('UPDATE client_touch_feedback SET filed_at = now(), filed_where = $2 WHERE id = $1', [id, where]); return true; }, false);
}

async function addOpeningRule(rule, source = 'guy') {
  const r = String(rule || '').trim();
  if (!r) throw new Error('rule is required');
  return withDb(async (c) => {
    const x = await c.query('INSERT INTO client_touch_opening_rules (rule, source) VALUES ($1,$2) RETURNING id', [r, source]);
    return x.rows[0].id;
  }, null);
}

async function openingRules() {
  return withDb(async (c) => {
    const r = await c.query('SELECT id, rule FROM client_touch_opening_rules WHERE active ORDER BY created_at');
    return r.rows;
  }, []);
}

// ---------------------------------------------------------------------------------------------
// State (the Monday claim, the preview sent, the veto deadline)

async function getState(key) {
  return withDb(async (c) => { const r = await c.query('SELECT value FROM client_touch_state WHERE key = $1', [key]); return r.rows[0] ? r.rows[0].value : null; }, null);
}

async function setState(key, value) {
  return withDb(async (c) => {
    await c.query(`INSERT INTO client_touch_state (key, value, updated_at) VALUES ($1,$2,now()) ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = now()`, [key, value]);
    return true;
  }, false);
}

/** Claim a one-per-week job (the Monday build, the preview email). True = this call owns it. */
async function claimWeekly(key, week) {
  return withDb(async (c) => {
    const r = await c.query(
      `INSERT INTO client_touch_state (key, value, updated_at) VALUES ($1, $2, now())
       ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = now() WHERE client_touch_state.value IS DISTINCT FROM $2
       RETURNING key`, [key, week],
    );
    return r.rows.length > 0;
  }, false);
}

module.exports = {
  STATUSES,
  FEEDBACK_HOMES,
  weekOf,
  addWeeks,
  planningWeek,
  feedbackHome,
  upsertPlan,
  plansFor,
  planFor,
  setPlanStatus,
  setPlanThought,
  setPlanCongrats,
  approvalRates,
  setPin,
  clearPin,
  pinsFor,
  setSkip,
  clearSkip,
  skips,
  addFeedback,
  unfiledFeedback,
  markFiled,
  addOpeningRule,
  openingRules,
  getState,
  setState,
  claimWeekly,
  __setTestPool,
};
