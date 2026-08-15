/**
 * wingguyFollowupsDismissed — "Done" for TODAY-brief queue items, shared by every surface.
 *
 * Backlog items already have a done state (wingguyBacklogAudit.markItem), but a today-brief item
 * had nothing: the chat queue relies on the live re-check noticing a reply was sent. The
 * Follow-Ups screen needs an explicit Done that doesn't send anything, and it must be visible to
 * BOTH the screen and the chat queue — one store, or the two surfaces drift into contradicting
 * each other (the Vikas draft-contradiction lesson, 2026-08-15). buildQueue() filters this table
 * for every renderer.
 *
 * Dismissals AGE OUT after 14 days: "done" means "this item is handled", not "never show this
 * person again" — someone who becomes actionable again for a NEW reason (a fresh reply, a new
 * quiet spell) should resurface. Permanent removal is a cease; deferral is a park. Keyed by
 * lowercased full name, matching the queue's own dedupe key.
 */

require('dotenv').config();
const { Pool } = require('pg');

const MAX_AGE_DAYS = 14;

let pool;
function getPool() {
  if (pool) return pool;
  const url = (process.env.DATABASE_URL || '').trim();
  if (!url) return null;
  pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });
  return pool;
}

async function ensureSchema(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS wingguy_followups_dismissed (
      tenant_id    TEXT NOT NULL,
      person_key   TEXT NOT NULL,
      dismissed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (tenant_id, person_key)
    );
  `);
}

/** The queue's dedupe key: lowercased trimmed full name. */
function personKey(name) {
  return String(name || '').trim().toLowerCase();
}

/** Mark a person's current queue item done. Re-dismissing refreshes the timestamp. */
async function dismiss(tenantId, name) {
  const p = getPool();
  if (!p) throw new Error('DATABASE_URL not set');
  const c = await p.connect();
  try {
    await ensureSchema(c);
    await c.query(
      `INSERT INTO wingguy_followups_dismissed (tenant_id, person_key) VALUES ($1, $2)
       ON CONFLICT (tenant_id, person_key) DO UPDATE SET dismissed_at = now()`,
      [tenantId, personKey(name)],
    );
  } finally { c.release(); }
}

/** Undo a dismissal (the screen's escape hatch). No-op when absent. */
async function undismiss(tenantId, name) {
  const p = getPool();
  if (!p) return;
  const c = await p.connect();
  try {
    await ensureSchema(c);
    await c.query(
      'DELETE FROM wingguy_followups_dismissed WHERE tenant_id = $1 AND person_key = $2',
      [tenantId, personKey(name)],
    );
  } finally { c.release(); }
}

/**
 * Person-keys dismissed within the age window, as a Set. Returns an empty Set when Postgres is
 * unreachable — a missing dismissal list must degrade to "show everything", never break the queue.
 */
async function listActive(tenantId) {
  try {
    const p = getPool();
    if (!p) return new Set();
    const c = await p.connect();
    try {
      await ensureSchema(c);
      const r = await c.query(
        `SELECT person_key FROM wingguy_followups_dismissed
         WHERE tenant_id = $1 AND dismissed_at > now() - ($2 || ' days')::interval`,
        [tenantId, String(MAX_AGE_DAYS)],
      );
      return new Set(r.rows.map((row) => row.person_key));
    } finally { c.release(); }
  } catch (e) {
    console.warn(`[followupsDismissed] read failed (serving unfiltered): ${e.message}`);
    return new Set();
  }
}

module.exports = { dismiss, undismiss, listActive, personKey, MAX_AGE_DAYS };
