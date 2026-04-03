/**
 * Persist Krisp webhook payloads when DATABASE_URL is set (Render Postgres).
 * Creates table on first use.
 */

const { Pool } = require('pg');

let pool;
let schemaEnsured = false;

function getPool() {
  const url = (process.env.DATABASE_URL || '').trim();
  if (!url) return null;
  if (!pool) {
    pool = new Pool({
      connectionString: url,
      ssl: { rejectUnauthorized: false },
    });
  }
  return pool;
}

async function ensureSchema(client) {
  if (schemaEnsured) return;
  await client.query(`
    CREATE TABLE IF NOT EXISTS krisp_webhook_events (
      id BIGSERIAL PRIMARY KEY,
      received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      event TEXT,
      krisp_id TEXT,
      payload JSONB NOT NULL
    );
  `);
  schemaEnsured = true;
}

/**
 * @param {{ event: string | null, krispId: string | null, payload: object }} row
 * @returns {Promise<{ ok: true } | { skipped: true }>}
 */
async function persistKrispWebhook(row) {
  const p = getPool();
  if (!p) return { skipped: true };

  const client = await p.connect();
  try {
    await ensureSchema(client);
    await client.query(
      `INSERT INTO krisp_webhook_events (event, krisp_id, payload) VALUES ($1, $2, $3::jsonb)`,
      [row.event, row.krispId, JSON.stringify(row.payload)],
    );
    return { ok: true };
  } finally {
    client.release();
  }
}

module.exports = { persistKrispWebhook, getPool };
