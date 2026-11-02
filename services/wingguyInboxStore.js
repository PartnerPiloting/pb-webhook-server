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

module.exports = { listInstructions, addInstruction, retireInstruction, __setTestPool };
