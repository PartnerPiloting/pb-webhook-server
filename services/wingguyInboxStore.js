/**
 * Standing inbox instructions - "always clear LinkedIn notifications", "always flag anything from
 * the accountant". Said once in chat, kept here, read back at the top of every "go through my
 * inbox" (services/wingguyInboxMcp.js) so the sorting follows them.
 *
 * WHY NOT THE RULES STORE (2 Nov 2026): wingguy_rules is about how drafts are WRITTEN - its context
 * and rule_type columns are CHECK-constrained to drafting values, widening a CHECK on that table
 * once cost a live outage, and a rule there is rendered into every draft prompt. An inbox habit
 * has no business in a draft, so it lives in its own small table.
 *
 * Per person (tenant_id = the caller's client id). Forgetting retires the row rather than deleting
 * it, so "what did I tell it?" always has an answer.
 *
 * House style: machineClipboardStore.js - lazy Pool, ensureSchema CREATE-IF-NOT-EXISTS, no
 * migrations. No DATABASE_URL means no instructions, and the inbox still works without them.
 */

const { Pool } = require('pg');

const MAX_CHARS = 500;
const MAX_ACTIVE = 40;

let pool;
let schemaEnsured = false;
let testPool = null;

function getPool() {
  if (testPool) return testPool;
  const url = (process.env.DATABASE_URL || '').trim();
  if (!url) return null;
  if (!pool) pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false }, max: 2 });
  return pool;
}

function __setTestPool(fake) { testPool = fake; schemaEnsured = false; }

async function ensureSchema(db) {
  if (schemaEnsured) return;
  await db.query(`
    CREATE TABLE IF NOT EXISTS wingguy_inbox_instructions (
      id         BIGSERIAL   PRIMARY KEY,
      tenant_id  TEXT        NOT NULL,
      body       TEXT        NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      retired_at TIMESTAMPTZ
    )
  `);
  // "Since I last looked" (Guy, 13 Nov 2026) - one row per person. flag_at = when their last FINISHED
  // run started; pending = the run in progress ({ at, complete, shown }); shown = thread -> newest
  // message time, for what was listed in the hour before the flag (so the look-back never repeats
  // it); later = thread ids they said "later" to.
  await db.query(`
    CREATE TABLE IF NOT EXISTS wingguy_inbox_looked (
      tenant_id  TEXT        PRIMARY KEY,
      flag_at    TIMESTAMPTZ,
      pending    JSONB,
      shown      JSONB       NOT NULL DEFAULT '{}'::jsonb,
      later      JSONB       NOT NULL DEFAULT '[]'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  schemaEnsured = true;
}

/** The person's active instructions, oldest first. [] when there is no database. */
async function listInstructions(tenantId) {
  const db = getPool();
  if (!db) return [];
  await ensureSchema(db);
  const r = await db.query(
    `SELECT id, body, created_at FROM wingguy_inbox_instructions
      WHERE tenant_id = $1 AND retired_at IS NULL ORDER BY id`, [tenantId]);
  return r.rows.map((x) => ({ id: Number(x.id), body: x.body, createdAt: x.created_at }));
}

async function addInstruction(tenantId, body) {
  const text = String(body || '').trim().replace(/\s+/g, ' ');
  if (!text) throw new Error('nothing to remember - the instruction is empty');
  if (text.length > MAX_CHARS) throw new Error(`keep it to one instruction (under ${MAX_CHARS} characters)`);
  const db = getPool();
  if (!db) throw new Error('no database here, so instructions cannot be kept');
  await ensureSchema(db);
  const existing = await listInstructions(tenantId);
  const same = existing.find((x) => x.body.toLowerCase() === text.toLowerCase());
  if (same) return { ...same, duplicate: true };
  if (existing.length >= MAX_ACTIVE) throw new Error(`that would be more than ${MAX_ACTIVE} inbox instructions - forget one first`);
  const r = await db.query(
    `INSERT INTO wingguy_inbox_instructions (tenant_id, body) VALUES ($1, $2) RETURNING id, body, created_at`, [tenantId, text]);
  return { id: Number(r.rows[0].id), body: r.rows[0].body, createdAt: r.rows[0].created_at };
}

/** Retire one of THIS person's instructions. Returns the body, or null if it was not theirs / not active. */
async function retireInstruction(tenantId, id) {
  const db = getPool();
  if (!db) throw new Error('no database here');
  await ensureSchema(db);
  const r = await db.query(
    `UPDATE wingguy_inbox_instructions SET retired_at = now()
      WHERE id = $1 AND tenant_id = $2 AND retired_at IS NULL RETURNING body`, [Number(id), tenantId]);
  return r.rows.length ? r.rows[0].body : null;
}

// ---------------------------------------------------------------------------
// "Since I last looked" - the flag in the letterbox.
//
// THE RULE: when in doubt, show it again. An email seen twice is a small annoyance; an email never
// shown is a broken promise. So the flag only moves when a run is FINISHED (markDone), it moves to
// when that run STARTED (mail that arrived while they were talking is next time's), and it never
// moves past emails that were not listed (a run that only got through its first 50).
// ---------------------------------------------------------------------------

const LOOKBACK_MS = 60 * 60 * 1000;   // the mail link can be minutes behind the real mailbox
const MAX_SHOWN = 600;
const MAX_LATER = 30;

const asObj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});

/** -> { flagAt(ms)|null, pending:{at, complete, shown}|null, shown:{threadId: ms}, later:[threadId] } | null (no database). */
async function getLooked(tenantId) {
  const db = getPool();
  if (!db) return null;
  await ensureSchema(db);
  const r = await db.query('SELECT flag_at, pending, shown, later FROM wingguy_inbox_looked WHERE tenant_id = $1', [tenantId]);
  const x = r.rows[0];
  if (!x) return { flagAt: null, pending: null, shown: {}, later: [] };
  const pending = x.pending && Number(x.pending.at) ? { at: Number(x.pending.at), complete: !!x.pending.complete, shown: asObj(x.pending.shown) } : null;
  return { flagAt: x.flag_at ? new Date(x.flag_at).getTime() : null, pending, shown: asObj(x.shown), later: Array.isArray(x.later) ? x.later.map(String) : [] };
}

/**
 * A list has just been shown. first=true starts a new run (replaces any unfinished one - that run's
 * emails are simply listed again); first=false is the next batch of the same run and adds to it.
 * shown = { threadId: newest message ms }. complete = nothing was left unlisted.
 */
async function notePending(tenantId, { at, shown, complete, first }) {
  const db = getPool();
  if (!db) return false;
  await ensureSchema(db);
  let pending = { at: Number(at), complete: !!complete, shown: asObj(shown) };
  if (!first) {
    const had = (await getLooked(tenantId)).pending;
    if (had) pending = { at: had.at, complete: !!complete, shown: { ...had.shown, ...asObj(shown) } };
  }
  await db.query(
    `INSERT INTO wingguy_inbox_looked (tenant_id, pending, updated_at) VALUES ($1, $2::jsonb, now())
     ON CONFLICT (tenant_id) DO UPDATE SET pending = EXCLUDED.pending, updated_at = now()`, [tenantId, JSON.stringify(pending)]);
  return true;
}

/**
 * The run is finished. A complete run moves the flag to when it started. A run that did not list
 * everything leaves the flag where it was and only remembers what it showed, so the rest comes up
 * next time. later = the thread ids not decided - they come back next time whatever their age.
 * -> { moved, flagAt, later } | null when there is no run to finish / no database.
 */
async function markDone(tenantId, laterIds = []) {
  const db = getPool();
  if (!db) return null;
  const now = await getLooked(tenantId);
  if (!now || !now.pending) return null;
  const { pending } = now;
  const flagAt = pending.complete ? pending.at : now.flagAt;
  const all = pending.complete ? pending.shown : { ...now.shown, ...pending.shown };
  // Only what the next look-back could list again is worth keeping.
  const keepFrom = flagAt ? flagAt - LOOKBACK_MS : 0;
  const shown = Object.fromEntries(Object.entries(all).filter(([, ms]) => Number(ms) > keepFrom || !pending.complete)
    .sort((a, b) => b[1] - a[1]).slice(0, MAX_SHOWN));
  const later = [...new Set((laterIds || []).map((x) => String(x || '').trim()).filter(Boolean))].slice(0, MAX_LATER);
  await db.query(
    `UPDATE wingguy_inbox_looked SET flag_at = $2, pending = NULL, shown = $3::jsonb, later = $4::jsonb, updated_at = now() WHERE tenant_id = $1`,
    [tenantId, flagAt ? new Date(flagAt).toISOString() : null, JSON.stringify(shown), JSON.stringify(later)]);
  return { moved: !!pending.complete, flagAt, later };
}

module.exports = { listInstructions, addInstruction, retireInstruction, getLooked, notePending, markDone, LOOKBACK_MS, __setTestPool };
