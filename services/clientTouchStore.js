/**
 * Client touch record - every email, call and introduction each client has had from Guy.
 *
 * WHY (2026-10-22, docs/CLIENT-TOUCH-PLANNER.md "What has to exist first"): the weekly planner
 * picks ONE email per client per week, and two of its rules need a memory it did not have:
 *   - "a full piece goes to a client once" - so it must know which one-pagers, habit emails and
 *     Mindset Mastery editions each client already received (Series Sent Count says how many, never
 *     which);
 *   - "not this week if Guy wrote to them, or had a call with them, in the last 6 days".
 *
 * One row per touch. `kind` says what sort of thing it was, `key` says which one:
 *
 *   kind        key                                  example
 *   one-pager   the piece slug                        first-discovery-call
 *   habit       habit-1 .. habit-4                    habit-1  ("A few minutes a morning")
 *   mindset     the edition's subject, as sent        Mindset Mastery: Let Them
 *   setup       the setup step slug                   setup:connect-linkedin
 *   one-off     event:<name> or a short slug          event:rick-open-meeting
 *   personal    Guy's own substantial email (subject) Re: the Brad introduction
 *   call        session | check-in | discovery        session
 *   intro       the other party's name                John Zhao
 *
 * `form` is full | short | one-off (a short re-send of an earlier piece is 'short').
 * `version` is the piece's version or the commit it was built from, so "they had the old version"
 * is answerable later. `reason` is the planner's one-line why (never shown to the client).
 * `source` says who wrote the row: planner | backfill | gmail | manual | wingguy.
 *
 * Idempotent writes: the same (client, kind, key, sent_at) is never recorded twice, so the backfill
 * script and a re-run planner cannot double up. Tenant key = Client ID (e.g. Rick-Wong), the
 * coach_client_id convention used across the Wingguy stores.
 *
 * House style: wingguyLearningStore.js - lazy Pool, ensureSchema CREATE IF NOT EXISTS, no migration
 * files, every read/write defensive (no DATABASE_URL = reads return empty, writes no-op).
 */

const { Pool } = require('pg');

let pool;
let schemaEnsured = false;

// custom = an email written for one client from their brief, when nothing approved on the shelf fits (22 Oct 2026)
const KINDS = ['one-pager', 'habit', 'mindset', 'setup', 'one-off', 'personal', 'call', 'intro', 'custom'];
const FORMS = ['full', 'short', 'one-off'];
const SOURCES = ['planner', 'backfill', 'gmail', 'manual', 'wingguy'];
// Kinds that count as "Guy touched base" for the planner's not-this-week rule and the Monday
// screen's "last touched" column. Admin emails are never recorded here, so every row counts,
// except the newsletter: a Mindset Mastery edition went to 200 people and is not a personal touch.
const SUBSTANTIAL_KINDS = KINDS.filter((k) => k !== 'mindset');

function getPool() {
  if (pool) return pool;
  const url = (process.env.DATABASE_URL || '').trim();
  if (!url) return null;
  pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });
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
    CREATE TABLE IF NOT EXISTS client_touches (
      id BIGSERIAL PRIMARY KEY,
      client_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      key TEXT NOT NULL,
      form TEXT NOT NULL DEFAULT 'full' CHECK (form IN ('full','short','one-off')),
      version TEXT,
      sent_at TIMESTAMPTZ NOT NULL,
      reason TEXT,
      source TEXT NOT NULL DEFAULT 'planner',
      recipient TEXT,
      meta JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  // The kind check follows KINDS, so adding a kind (custom, 22 Oct 2026) widens the table too. The
  // table was first made with the check inline, which Postgres named client_touches_kind_check.
  // One statement, so the table is never without its check; never fatal - a read must not fail
  // because two servers widened the check at the same moment.
  try {
    await client.query(`ALTER TABLE client_touches DROP CONSTRAINT IF EXISTS client_touches_kind_check, ADD CONSTRAINT client_touches_kind_check CHECK (kind IN (${KINDS.map((k) => `'${k}'`).join(',')}))`);
  } catch (e) { console.warn(`[clientTouchStore] kind check not widened: ${e.message}`); }
  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_client_touches_once
    ON client_touches (client_id, kind, key, sent_at);
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_client_touches_client
    ON client_touches (client_id, sent_at DESC);
  `);
  schemaEnsured = true;
}

/** Run fn(client) with schema ensured; swallow infrastructure errors, returning fallback. */
async function withDb(fn, fallback) {
  const p = getPool();
  if (!p) return fallback;
  let client;
  try {
    client = await p.connect();
    await ensureSchema(client);
    return await fn(client);
  } catch (e) {
    console.warn(`[clientTouchStore] ${e.message}`);
    return fallback;
  } finally {
    if (client) client.release();
  }
}

// ---------------------------------------------------------------------------------------------
// Pure validation (unit tested)

/**
 * Check and normalise one touch. Throws on anything the table would reject, so a bad call fails
 * loudly in the caller rather than vanishing in withDb's catch.
 */
function normaliseTouch(input) {
  const t = input || {};
  const clientId = String(t.clientId || '').trim();
  if (!clientId) throw new Error('clientId is required');
  if (!KINDS.includes(t.kind)) throw new Error(`invalid kind "${t.kind}" (one of ${KINDS.join(', ')})`);
  const key = String(t.key || '').trim().slice(0, 500);
  if (!key) throw new Error('key is required');
  const form = t.form || 'full';
  if (!FORMS.includes(form)) throw new Error(`invalid form "${form}" (one of ${FORMS.join(', ')})`);
  const source = t.source || 'planner';
  if (!SOURCES.includes(source)) throw new Error(`invalid source "${source}" (one of ${SOURCES.join(', ')})`);
  const sentAt = t.sentAt ? new Date(t.sentAt) : new Date();
  if (Number.isNaN(sentAt.getTime())) throw new Error(`invalid sentAt "${t.sentAt}"`);
  return {
    clientId,
    kind: t.kind,
    key,
    form,
    version: t.version ? String(t.version).trim().slice(0, 200) : null,
    sentAt,
    reason: t.reason ? String(t.reason).trim().slice(0, 1000) : null,
    source,
    recipient: t.recipient ? String(t.recipient).trim().toLowerCase().slice(0, 300) : null,
    meta: t.meta && typeof t.meta === 'object' ? t.meta : null,
  };
}

// ---------------------------------------------------------------------------------------------
// Writes

/**
 * Record one touch. Returns { ok, inserted } - inserted is false when the same touch was already
 * there (same client, kind, key and moment), which is a success, not an error.
 * Throws only on invalid input; database trouble is logged and returns { ok: false }.
 */
async function record(input) {
  const t = normaliseTouch(input);
  return withDb(async (c) => {
    const r = await c.query(
      `INSERT INTO client_touches (client_id, kind, key, form, version, sent_at, reason, source, recipient, meta)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (client_id, kind, key, sent_at) DO NOTHING
       RETURNING id`,
      [t.clientId, t.kind, t.key, t.form, t.version, t.sentAt, t.reason, t.source, t.recipient, t.meta ? JSON.stringify(t.meta) : null],
    );
    return { ok: true, inserted: r.rows.length > 0, id: r.rows[0] ? r.rows[0].id : null };
  }, { ok: false, inserted: false, id: null });
}

// ---------------------------------------------------------------------------------------------
// Reads

/** Everything this client has had, newest first. */
async function touchesFor(clientId, { kinds = null, limit = 500 } = {}) {
  if (!clientId) return [];
  return withDb(async (c) => {
    const r = kinds && kinds.length
      ? await c.query(
        `SELECT id, kind, key, form, version, sent_at, reason, source, recipient, meta FROM client_touches
         WHERE client_id = $1 AND kind = ANY($2) ORDER BY sent_at DESC LIMIT $3`,
        [clientId, kinds, limit],
      )
      : await c.query(
        `SELECT id, kind, key, form, version, sent_at, reason, source, recipient, meta FROM client_touches
         WHERE client_id = $1 ORDER BY sent_at DESC LIMIT $2`,
        [clientId, limit],
      );
    return r.rows;
  }, []);
}

/** Has this client already had this piece (any form)? Returns the most recent row or null. */
async function hasHad(clientId, kind, key) {
  if (!clientId || !kind || !key) return null;
  return withDb(async (c) => {
    const r = await c.query(
      `SELECT id, kind, key, form, version, sent_at, source FROM client_touches
       WHERE client_id = $1 AND kind = $2 AND key = $3 ORDER BY sent_at DESC LIMIT 1`,
      [clientId, kind, key],
    );
    return r.rows[0] || null;
  }, null);
}

/** The keys of every piece of this kind the client has had - "what's left to send" is the complement. */
async function keysHad(clientId, kind) {
  if (!clientId || !kind) return [];
  return withDb(async (c) => {
    const r = await c.query(
      `SELECT key, MIN(sent_at) AS first_at FROM client_touches
       WHERE client_id = $1 AND kind = $2 GROUP BY key ORDER BY first_at`,
      [clientId, kind],
    );
    return r.rows.map((row) => row.key);
  }, []);
}

/**
 * When did Guy last touch this client in a way that counts? Returns a Date or null.
 * Default = every kind except the newsletter (see SUBSTANTIAL_KINDS).
 */
async function lastTouchAt(clientId, { kinds = SUBSTANTIAL_KINDS } = {}) {
  if (!clientId) return null;
  return withDb(async (c) => {
    const r = await c.query(
      `SELECT MAX(sent_at) AS last FROM client_touches WHERE client_id = $1 AND kind = ANY($2)`,
      [clientId, kinds],
    );
    return r.rows[0] && r.rows[0].last ? new Date(r.rows[0].last) : null;
  }, null);
}

/** Touched within the last N days? The planner's "not this week" test. */
async function touchedWithinDays(clientId, days, opts = {}) {
  const last = await lastTouchAt(clientId, opts);
  if (!last) return false;
  return isWithinDays(last, days);
}

/** Pure: is `when` within the last `days` days of `now`? */
function isWithinDays(when, days, now = new Date()) {
  const ms = Number(days) * 24 * 60 * 60 * 1000;
  const diff = now.getTime() - new Date(when).getTime();
  return diff >= 0 && diff <= ms;
}

/** Everyone's touches since a date - the Monday screen reads all clients in one query. */
async function touchesSince(sinceDate, { kinds = null } = {}) {
  const since = new Date(sinceDate);
  if (Number.isNaN(since.getTime())) return [];
  return withDb(async (c) => {
    const r = kinds && kinds.length
      ? await c.query(
        `SELECT client_id, kind, key, form, sent_at, reason, source, meta FROM client_touches
         WHERE sent_at >= $1 AND kind = ANY($2) ORDER BY sent_at DESC`,
        [since, kinds],
      )
      : await c.query(
        `SELECT client_id, kind, key, form, sent_at, reason, source, meta FROM client_touches
         WHERE sent_at >= $1 ORDER BY sent_at DESC`,
        [since],
      );
    return r.rows;
  }, []);
}

module.exports = {
  KINDS,
  FORMS,
  SOURCES,
  SUBSTANTIAL_KINDS,
  normaliseTouch,
  isWithinDays,
  record,
  touchesFor,
  hasHad,
  keysHad,
  lastTouchAt,
  touchedWithinDays,
  touchesSince,
  __setTestPool,
};
