/**
 * When each client's Claude last reached Wingguy through its OWN connector link (14 Oct 2026).
 *
 * WHY: Ashley Knowles' Claude was added with the shared connector secret, which maps to Guy, so
 * for weeks his "open my portal" and "rebuild my scoring" ran as Guy and nothing said so. The
 * "Connect Wingguy to your Claude" card on My Wingguy shows "Connected - last used <when>" from
 * this table: a client who has connected but never turns green is on the wrong address.
 *
 * Only PERSONAL links (a Portal Token) are recorded. A shared-secret call cannot say who is
 * calling, so it never stamps anyone - least of all the owner.
 *
 * House style: recallWebhookDb.js (lazy Pool, ensureSchema CREATE-IF-NOT-EXISTS, no migrations).
 */

const { Pool } = require('pg');

let pool;
let schemaEnsured = false;
const lastWrite = new Map(); // tenant -> ms; one write a minute per tenant is plenty
const WRITE_EVERY_MS = 60 * 1000;

function getPool() {
  const url = (process.env.DATABASE_URL || '').trim();
  if (!url) return null;
  if (!pool) pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });
  return pool;
}

async function ensureSchema(db) {
  if (schemaEnsured) return;
  await db.query(`
    CREATE TABLE IF NOT EXISTS wingguy_connector_seen (
      tenant_id    TEXT PRIMARY KEY,
      first_seen   TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_seen    TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  schemaEnsured = true;
}

/** Fire-and-forget from the connector door. Never throws, never slows the call. */
function markSeen(tenantId, nowMs = Date.now()) {
  if (!tenantId) return;
  const prev = lastWrite.get(tenantId) || 0;
  if (nowMs - prev < WRITE_EVERY_MS) return;
  lastWrite.set(tenantId, nowMs);
  const db = getPool();
  if (!db) return;
  (async () => {
    try {
      await ensureSchema(db);
      await db.query(
        `INSERT INTO wingguy_connector_seen (tenant_id) VALUES ($1)
         ON CONFLICT (tenant_id) DO UPDATE SET last_seen = now()`,
        [tenantId]
      );
    } catch (e) {
      console.warn(`connectorSeen: could not stamp ${tenantId}: ${e.message}`);
    }
  })();
}

/** { firstSeen, lastSeen } (ISO) or null when this client's own link has never been used. */
async function getSeen(tenantId) {
  const db = getPool();
  if (!db || !tenantId) return null;
  await ensureSchema(db);
  const r = await db.query('SELECT first_seen, last_seen FROM wingguy_connector_seen WHERE tenant_id = $1', [tenantId]);
  if (!r.rows.length) return null;
  return { firstSeen: r.rows[0].first_seen.toISOString(), lastSeen: r.rows[0].last_seen.toISOString() };
}

module.exports = { markSeen, getSeen };
