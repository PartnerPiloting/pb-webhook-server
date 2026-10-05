/**
 * Scoring-attribute backups (Postgres) - the safety net behind wingguy_scoring_commit / revert.
 *
 * Every write to a client's Scoring Attributes table through the chat door first saves a full copy
 * of the rows it is about to change. A revert restores from here (and backs up what it replaces, so
 * a revert can itself be undone). Append-only; nothing here is ever deleted by the tools.
 *
 * House style: wingguyLearningStore.js (lazy Pool, ensureSchema CREATE-IF-NOT-EXISTS). Unlike the
 * learning store, a failed SAVE throws: a write must never go ahead without its backup.
 */

const { Pool } = require('pg');

let pool;
let schemaEnsured = false;

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
  schemaEnsured = !!fake;
}

async function ensureSchema(client) {
  if (schemaEnsured) return;
  await client.query(`
    CREATE TABLE IF NOT EXISTS wingguy_scoring_backups (
      id BIGSERIAL PRIMARY KEY,
      at TIMESTAMPTZ NOT NULL DEFAULT now(),
      tenant_id TEXT NOT NULL,
      base_id TEXT NOT NULL,
      reason TEXT NOT NULL,
      rows JSONB NOT NULL
    );
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_wg_scoring_backups_tenant
    ON wingguy_scoring_backups (tenant_id, at DESC);
  `);
  schemaEnsured = true;
}

async function withDb(fn) {
  const p = getPool();
  if (!p) throw new Error('backup store unavailable (no database configured)');
  const client = await p.connect();
  try {
    await ensureSchema(client);
    return await fn(client);
  } finally {
    client.release();
  }
}

/** Save a backup; returns its id. THROWS on failure - callers must not write without one. */
async function saveBackup({ tenantId, baseId, reason, rows }) {
  return withDb(async (c) => {
    const r = await c.query(
      `INSERT INTO wingguy_scoring_backups (tenant_id, base_id, reason, rows) VALUES ($1, $2, $3, $4) RETURNING id, at`,
      [tenantId, baseId, reason, JSON.stringify(rows)],
    );
    return { id: Number(r.rows[0].id), at: r.rows[0].at };
  });
}

/** One backup by id, scoped to the tenant (another client's backup is never returned). */
async function getBackup(tenantId, id) {
  return withDb(async (c) => {
    const r = await c.query(
      `SELECT id, at, base_id, reason, rows FROM wingguy_scoring_backups WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id],
    );
    return r.rows[0] ? { ...r.rows[0], id: Number(r.rows[0].id) } : null;
  });
}

/** Most recent backups for the tenant, newest first (rows omitted - just the index). */
async function listBackups(tenantId, limit = 5) {
  return withDb(async (c) => {
    const r = await c.query(
      `SELECT id, at, reason, jsonb_array_length(rows) AS row_count FROM wingguy_scoring_backups
       WHERE tenant_id = $1 ORDER BY at DESC LIMIT $2`,
      [tenantId, Math.max(1, Math.min(20, limit))],
    );
    return r.rows.map((x) => ({ ...x, id: Number(x.id), row_count: Number(x.row_count) }));
  });
}

module.exports = { saveBackup, getBackup, listBackups, __setTestPool };
