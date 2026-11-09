/**
 * Panel chat turns, started now and collected a moment later (9 Nov 2026).
 *
 * WHY: a panel chat turn (POST /api/wingguy/chat) takes 20-40+ seconds - the agent reads the
 * profile and the lead's record and asks Claude more than once. The browser gives up on a request
 * at about 30 seconds (Render logged it as 499, client closed), shows "Couldn't reach Wingguy
 * right now", and the server finishes the draft a few seconds later with nobody left to hand it
 * to. About 1 turn in 11 across all clients, 30 Oct - 9 Nov; David Gould asked Wingguy Learning
 * about it on 4 Nov. The draft was made, paid for on the client's own key, and thrown away.
 *
 * So the panel now STARTS a turn (an answer comes back at once with a job id) and then ASKS for
 * the result every couple of seconds. No request is held open long enough to be cut, and a
 * finished draft waits here until it is collected.
 *
 * Kept in Postgres so it works whichever server copy answers the asking (a deploy can swap the
 * copy mid-turn); a same-copy in-memory map answers first so the common case never waits on the
 * database. Rows are short-lived: anything older than an hour is cleared on the next start.
 *
 * House style: connectorSeenStore.js (lazy Pool, ensureSchema CREATE-IF-NOT-EXISTS, no migrations).
 */

const crypto = require('crypto');
const { Pool } = require('pg');

let pool;
let schemaEnsured = false;
const memory = new Map(); // id -> { tenantId, done, status, body, at }
const KEEP_MS = 60 * 60 * 1000;

function getPool() {
  const url = (process.env.DATABASE_URL || '').trim();
  if (!url) return null;
  if (!pool) pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });
  return pool;
}

async function ensureSchema(db) {
  if (schemaEnsured) return;
  await db.query(`
    CREATE TABLE IF NOT EXISTS wingguy_chat_jobs (
      id          TEXT PRIMARY KEY,
      tenant_id   TEXT NOT NULL,
      done        BOOLEAN NOT NULL DEFAULT false,
      status      INTEGER,
      body        JSONB,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  schemaEnsured = true;
}

function sweepMemory(nowMs) {
  for (const [id, j] of memory) if (nowMs - j.at > KEEP_MS) memory.delete(id);
}

/** A new job id for this tenant. Never throws: a database hiccup leaves the memory copy. */
async function startJob(tenantId, nowMs = Date.now()) {
  const id = crypto.randomBytes(12).toString('hex');
  sweepMemory(nowMs);
  memory.set(id, { tenantId, done: false, status: null, body: null, at: nowMs });
  const db = getPool();
  if (db) {
    try {
      await ensureSchema(db);
      await db.query('INSERT INTO wingguy_chat_jobs (id, tenant_id) VALUES ($1, $2)', [id, tenantId]);
      db.query(`DELETE FROM wingguy_chat_jobs WHERE created_at < now() - interval '1 hour'`).catch(() => {});
    } catch (e) {
      console.warn(`chatJobs: could not record job ${id}: ${e.message}`);
    }
  }
  return id;
}

/** Store the finished turn: the HTTP status and JSON body the old one-shot route would have sent. */
async function finishJob(id, status, body) {
  const j = memory.get(id);
  if (j) Object.assign(j, { done: true, status, body });
  const db = getPool();
  if (!db) return;
  try {
    await ensureSchema(db);
    await db.query('UPDATE wingguy_chat_jobs SET done = true, status = $2, body = $3 WHERE id = $1', [id, status, JSON.stringify(body || {})]);
  } catch (e) {
    console.warn(`chatJobs: could not store result ${id}: ${e.message}`);
  }
}

/**
 * { found, done, status, body }. A job belongs to one tenant: anyone else asking gets found:false,
 * the same as an id that never existed.
 */
async function getJob(id, tenantId) {
  const j = memory.get(id);
  if (j) {
    if (j.tenantId !== tenantId) return { found: false };
    if (j.done) return { found: true, done: true, status: j.status, body: j.body };
  }
  const db = getPool();
  if (db) {
    try {
      await ensureSchema(db);
      const r = await db.query('SELECT tenant_id, done, status, body FROM wingguy_chat_jobs WHERE id = $1', [id]);
      if (r.rows.length) {
        const row = r.rows[0];
        if (row.tenant_id !== tenantId) return { found: false };
        return { found: true, done: !!row.done, status: row.status, body: row.body };
      }
    } catch (e) {
      console.warn(`chatJobs: could not read ${id}: ${e.message}`);
    }
  }
  return j ? { found: true, done: false } : { found: false };
}

module.exports = { startJob, finishJob, getJob, _memory: memory };
