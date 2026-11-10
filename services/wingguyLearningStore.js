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
 *   unclear  — the client asked for a better explanation ("can you ask Guy to explain this better
 *              in future?"); key = the topic or question, detail = the write-up for Guy
 *   pushback — the client's Claude saw an answer not land (they said it didn't work or didn't
 *              match what they see) and reported it; the client is TOLD it was reported
 *
 * 10 Nov 2026 (Guy): a gap only catches a question with NO answer. An answer that was given but
 * wasn't good enough reached nobody unless the client emailed Guy. unclear / pushback, plus
 * repeatServes() (same client, same topic, twice in a week), are the catch for those.
 *
 * Plus one nudge per tenant — Guy's "suggest transcripts to Rick next" note. The nudge and the
 * line in Guy's follow-up email come from the same stored note so they can never contradict.
 *
 * Deliberate line (Guy's call): this is TEACHING telemetry, never surveillance. We stamp what
 * Wingguy served and what Guy suggested — the client's conversation itself lives in their Claude
 * and is invisible to us, which is a feature worth being able to state plainly. The one thing that
 * does cross is an unclear / pushback report, and only as a write-up the client's own Claude
 * composes and tells them it has sent - never silently.
 *
 * House style: wingguyRulesStore.js (lazy Pool, ensureSchema CREATE-IF-NOT-EXISTS, no migration
 * files, tenant key = coach_client_id convention). Every read/write here is DEFENSIVE: with no
 * DATABASE_URL (or a dead pool) reads return empty and writes no-op, so the learning tools keep
 * serving content — just unstamped — rather than failing a client's chat.
 */

const { Pool } = require('pg');

let pool;
let schemaEnsured = false;

const EVENT_KINDS = ['beat', 'topic', 'gap', 'unclear', 'pushback'];
const REPORT_KINDS = ['unclear', 'pushback'];
// Not a teaching topic: people open their machine every day, which is not "asked twice".
const NOT_A_REPEAT = /^OPEN YOUR LINKED HELPER MACHINE/i;

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
  // The table was created with a three-kind CHECK; widen it once (10 Nov 2026) and add the
  // write-up column. Guarded by reading the constraint, so a restart does not re-validate rows.
  await client.query(`ALTER TABLE wingguy_learning_events ADD COLUMN IF NOT EXISTS detail TEXT`);
  const chk = await client.query(`
    SELECT pg_get_constraintdef(c.oid) AS def FROM pg_constraint c
    WHERE c.conname = 'wingguy_learning_events_kind_check'
      AND c.conrelid = to_regclass('wingguy_learning_events')
  `);
  const def = chk.rows && chk.rows[0] ? String(chk.rows[0].def || '') : '';
  if (!def.includes('pushback')) {
    // Own try: if this fails (two instances starting together, say) beats, topics and gaps must
    // still be stamped - only the two new kinds wait for the next start.
    try {
      await client.query(`ALTER TABLE wingguy_learning_events DROP CONSTRAINT IF EXISTS wingguy_learning_events_kind_check`);
      await client.query(`
        ALTER TABLE wingguy_learning_events ADD CONSTRAINT wingguy_learning_events_kind_check
        CHECK (kind IN ('beat','topic','gap','unclear','pushback'))
      `);
    } catch (e) {
      console.warn(`[wingguyLearningStore] could not widen the kind check: ${e.message}`);
    }
  }
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
async function stamp(tenantId, kind, key, detail = null) {
  if (!EVENT_KINDS.includes(kind)) return false;
  const k = String(key || '').trim().slice(0, 500);
  if (!tenantId || !k) return false;
  const d = detail == null ? null : String(detail).trim().slice(0, 6000) || null;
  return withDb(async (c) => {
    await c.query(
      `INSERT INTO wingguy_learning_events (tenant_id, kind, key, detail) VALUES ($1, $2, $3, $4)`,
      [tenantId, kind, k, d],
    );
    return true;
  }, false);
}

/** "Explain this better" and "that answer didn't land" reports, newest first. All tenants when
 *  tenantId is null. Each row: tenant_id, kind (unclear | pushback), key, detail, at. */
async function reports(tenantId = null, sinceDays = 7) {
  return withDb(async (c) => {
    const r = await c.query(
      tenantId
        ? `SELECT tenant_id, kind, key, detail, at FROM wingguy_learning_events
           WHERE kind = ANY($1) AND tenant_id = $2 AND at > now() - ($3 || ' days')::interval
           ORDER BY at DESC`
        : `SELECT tenant_id, kind, key, detail, at FROM wingguy_learning_events
           WHERE kind = ANY($1) AND at > now() - ($2 || ' days')::interval
           ORDER BY at DESC`,
      tenantId ? [REPORT_KINDS, tenantId, String(sinceDays)] : [REPORT_KINDS, String(sinceDays)],
    );
    return r.rows;
  }, []);
}

/** Same client, same topic, served more than once - at least an hour apart, so two calls inside
 *  one chat do not count. Nobody has to report anything for this one: going back to the same
 *  answer within days usually means it did not land the first time. */
async function repeatServes(sinceDays = 7, exceptTenant = null) {
  const rows = await withDb(async (c) => {
    const r = await c.query(
      `SELECT tenant_id, key, COUNT(*)::int AS times, MIN(at) AS first_at, MAX(at) AS last_at
       FROM wingguy_learning_events
       WHERE kind = 'topic' AND at > now() - ($1 || ' days')::interval
       GROUP BY tenant_id, key
       HAVING COUNT(*) > 1 AND MAX(at) - MIN(at) >= interval '1 hour'
       ORDER BY COUNT(*) DESC, MAX(at) DESC`,
      [String(sinceDays)],
    );
    return r.rows;
  }, []);
  return rows.filter((r) => !NOT_A_REPEAT.test(String(r.key || '')) && (!exceptTenant || r.tenant_id !== exceptTenant));
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
  reports,
  repeatServes,
  setNudge,
  clearNudge,
  activeNudge,
  markNudgeDoneIfTopicMatches,
  __setTestPool,
};
