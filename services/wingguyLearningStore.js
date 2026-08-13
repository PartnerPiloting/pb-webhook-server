/**
 * Wingguy Learning store — teaching telemetry for the tour + library.
 *
 * WHY (2026-08-05, designed with Guy): Wingguy Learning served topics but remembered nothing, so
 * "where's Rick up to?" was unanswerable, the tour had no bookmark, and every question the library
 * couldn't answer evaporated. This store keeps exactly three kinds of fact, all coarse:
 *
 *   beat  — a tour beat was served to a tenant (the bookmark: next beat = first one not stamped)
 *   topic — a library topic was served (tour or not; Guy asked for both: "he's on beat 4 AND he's
 *           been circling transcripts on his own")
 *   gap   — a question Wingguy Learning could not answer (feeds Guy's weekly gap review)
 *
 * Plus one nudge per tenant — Guy's "suggest transcripts to Rick next" note. The nudge and the
 * line in Guy's follow-up email come from the same stored note so they can never contradict.
 *
 * Deliberate line (Guy's call): this is TEACHING telemetry, never surveillance. We stamp what
 * Wingguy served and what Guy suggested — the client's conversation itself lives in their Claude
 * and is invisible to us, which is a feature worth being able to state plainly.
 *
 * House style: wingguyRulesStore.js (lazy Pool, ensureSchema CREATE-IF-NOT-EXISTS, no migration
 * files, tenant key = coach_client_id convention). Every read/write here is DEFENSIVE: with no
 * DATABASE_URL (or a dead pool) reads return empty and writes no-op, so the learning tools keep
 * serving content — just unstamped — rather than failing a client's chat.
 */

const { Pool } = require('pg');

let pool;
let schemaEnsured = false;

const EVENT_KINDS = ['beat', 'topic', 'gap'];

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
    CREATE TABLE IF NOT EXISTS wingguy_learning_events (
      id BIGSERIAL PRIMARY KEY,
      at TIMESTAMPTZ NOT NULL DEFAULT now(),
      tenant_id TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('beat','topic','gap')),
      key TEXT NOT NULL
    );
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_wg_learning_events_tenant
    ON wingguy_learning_events (tenant_id, kind, at DESC);
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS wingguy_learning_nudges (
      id BIGSERIAL PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      done_at TIMESTAMPTZ,
      tenant_id TEXT NOT NULL,
      note TEXT NOT NULL,
      topic_hint TEXT,
      set_by TEXT,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','done'))
    );
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_wg_learning_nudges_tenant
    ON wingguy_learning_nudges (tenant_id, status);
  `);
  schemaEnsured = true;
}

/** Run fn(client) with schema ensured; swallow infrastructure errors, returning fallback.
 *  The learning tools must never fail a client chat because telemetry hiccuped. */
async function withDb(fn, fallback) {
  const p = getPool();
  if (!p) return fallback;
  let client;
  try {
    client = await p.connect();
    await ensureSchema(client);
    return await fn(client);
  } catch (e) {
    console.warn(`[wingguyLearningStore] ${e.message}`);
    return fallback;
  } finally {
    if (client) client.release();
  }
}

/** Stamp one event. Fire-and-forget safe: never throws, returns true iff written. */
async function stamp(tenantId, kind, key) {
  if (!EVENT_KINDS.includes(kind)) return false;
  const k = String(key || '').trim().slice(0, 500);
  if (!tenantId || !k) return false;
  return withDb(async (c) => {
    await c.query(
      `INSERT INTO wingguy_learning_events (tenant_id, kind, key) VALUES ($1, $2, $3)`,
      [tenantId, kind, k],
    );
    return true;
  }, false);
}

/** The beat names this tenant has been served, in first-served order. */
async function servedBeats(tenantId) {
  return withDb(async (c) => {
    const r = await c.query(
      `SELECT key, MIN(at) AS first_at FROM wingguy_learning_events
       WHERE tenant_id = $1 AND kind = 'beat' GROUP BY key ORDER BY first_at`,
      [tenantId],
    );
    return r.rows.map((row) => row.key);
  }, []);
}

/** Library topics this tenant pulled, with counts and last-served — newest first. */
async function topicServes(tenantId) {
  return withDb(async (c) => {
    const r = await c.query(
      `SELECT key, COUNT(*)::int AS times, MAX(at) AS last_at FROM wingguy_learning_events
       WHERE tenant_id = $1 AND kind = 'topic' GROUP BY key ORDER BY last_at DESC`,
      [tenantId],
    );
    return r.rows;
  }, []);
}

/** Unanswered questions. All tenants when tenantId is null — Guy's weekly gap review. */
async function gaps(tenantId = null, sinceDays = 90) {
  return withDb(async (c) => {
    const r = await c.query(
      tenantId
        ? `SELECT tenant_id, key, at FROM wingguy_learning_events
           WHERE kind = 'gap' AND tenant_id = $1 AND at > now() - ($2 || ' days')::interval
           ORDER BY at DESC`
        : `SELECT tenant_id, key, at FROM wingguy_learning_events
           WHERE kind = 'gap' AND at > now() - ($1 || ' days')::interval
           ORDER BY at DESC`,
      tenantId ? [tenantId, String(sinceDays)] : [String(sinceDays)],
    );
    return r.rows;
  }, []);
}

/** Set the tenant's nudge (replaces any active one — one nudge at a time, always current). */
async function setNudge(tenantId, note, topicHint = null, setBy = null) {
  const n = String(note || '').trim();
  if (!tenantId || !n) return false;
  return withDb(async (c) => {
    await c.query(
      `UPDATE wingguy_learning_nudges SET status = 'done', done_at = now()
       WHERE tenant_id = $1 AND status = 'active'`,
      [tenantId],
    );
    await c.query(
      `INSERT INTO wingguy_learning_nudges (tenant_id, note, topic_hint, set_by) VALUES ($1, $2, $3, $4)`,
      [tenantId, n.slice(0, 1000), topicHint ? String(topicHint).trim().slice(0, 200) : null, setBy],
    );
    return true;
  }, false);
}

async function clearNudge(tenantId) {
  if (!tenantId) return false;
  return withDb(async (c) => {
    const r = await c.query(
      `UPDATE wingguy_learning_nudges SET status = 'done', done_at = now()
       WHERE tenant_id = $1 AND status = 'active'`,
      [tenantId],
    );
    return r.rowCount > 0;
  }, false);
}

async function activeNudge(tenantId) {
  return withDb(async (c) => {
    const r = await c.query(
      `SELECT id, note, topic_hint, created_at, set_by FROM wingguy_learning_nudges
       WHERE tenant_id = $1 AND status = 'active' ORDER BY created_at DESC LIMIT 1`,
      [tenantId],
    );
    return r.rows[0] || null;
  }, null);
}

/** Auto-retire the nudge once its hinted topic has actually been served to the tenant. */
async function markNudgeDoneIfTopicMatches(tenantId, servedTopicTitle) {
  const nudge = await activeNudge(tenantId);
  if (!nudge || !nudge.topic_hint) return false;
  const hit = String(servedTopicTitle || '').toLowerCase().includes(nudge.topic_hint.toLowerCase());
  if (!hit) return false;
  return withDb(async (c) => {
    await c.query(`UPDATE wingguy_learning_nudges SET status = 'done', done_at = now() WHERE id = $1`, [nudge.id]);
    return true;
  }, false);
}

module.exports = {
  stamp,
  servedBeats,
  topicServes,
  gaps,
  setNudge,
  clearNudge,
  activeNudge,
  markNudgeDoneIfTopicMatches,
  __setTestPool,
};
