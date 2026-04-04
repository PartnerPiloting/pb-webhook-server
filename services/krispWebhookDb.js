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

/**
 * Read-only summary for admin checks (no payload bodies).
 * @param {number} [limit=15]
 */
async function getKrispWebhookDbSummary(limit = 15) {
  const p = getPool();
  if (!p) return { database_configured: false, error: 'DATABASE_URL not set' };

  const cap = Math.min(Math.max(Number(limit) || 15, 1), 50);
  const client = await p.connect();
  try {
    await ensureSchema(client);
    const countR = await client.query('SELECT COUNT(*)::text AS c FROM krisp_webhook_events');
    const recentR = await client.query(
      `SELECT id, received_at, event, krisp_id FROM krisp_webhook_events ORDER BY id DESC LIMIT $1`,
      [cap],
    );
    return {
      database_configured: true,
      table: 'krisp_webhook_events',
      total_rows: countR.rows[0].c,
      recent: recentR.rows,
    };
  } catch (e) {
    return { database_configured: true, error: e.message };
  } finally {
    client.release();
  }
}

/**
 * @param {string|number} id
 * @returns {Promise<{ id, received_at, event, krisp_id, payload } | null>}
 */
async function getKrispWebhookEventById(id) {
  const n = typeof id === 'string' ? parseInt(id, 10) : Number(id);
  if (!Number.isFinite(n) || n < 1) return null;

  const p = getPool();
  if (!p) return null;

  const client = await p.connect();
  try {
    await ensureSchema(client);
    const r = await client.query(
      `SELECT id, received_at, event, krisp_id, payload FROM krisp_webhook_events WHERE id = $1`,
      [n],
    );
    return r.rows[0] || null;
  } finally {
    client.release();
  }
}

/** For live test harness only — obvious fake rows, safe to purge. */
async function seedManualTestTranscript() {
  const p = getPool();
  if (!p) return { ok: false, error: 'DATABASE_URL not set' };

  const krispId = `test-${Date.now()}`;
  const payload = {
    id: krispId,
    event: 'manual_test',
    data: {
      note: 'Seeded by POST /krisp-test/seed (safe to delete)',
      raw_content:
        'FAKE TRANSCRIPT FOR TESTING.\n\nAlice: Hello\nBob: Hi — this is not a real Krisp meeting.',
      participants: [
        { email: 'alice.example@test.invalid', first_name: 'Alice', last_name: 'Test' },
        { email: 'bob.example@test.invalid', first_name: 'Bob', last_name: 'Sample' },
      ],
    },
  };

  const client = await p.connect();
  try {
    await ensureSchema(client);
    await client.query(
      `INSERT INTO krisp_webhook_events (event, krisp_id, payload) VALUES ($1, $2, $3::jsonb)`,
      ['manual_test', krispId, JSON.stringify(payload)],
    );
    const idR = await client.query(`SELECT id FROM krisp_webhook_events WHERE krisp_id = $1`, [krispId]);
    return { ok: true, postgres_id: idR.rows[0].id, krisp_id: krispId };
  } finally {
    client.release();
  }
}

/** Removes rows created by the harness (manual_test or krisp_id prefix test-). */
async function purgeManualTestTranscripts() {
  const p = getPool();
  if (!p) return { ok: false, error: 'DATABASE_URL not set', deleted: 0 };

  const client = await p.connect();
  try {
    await ensureSchema(client);
    const r = await client.query(`
      DELETE FROM krisp_webhook_events
      WHERE event = 'manual_test' OR krisp_id LIKE 'test-%'
      RETURNING id
    `);
    return { ok: true, deleted: r.rowCount, ids: r.rows.map((row) => row.id) };
  } finally {
    client.release();
  }
}

module.exports = {
  persistKrispWebhook,
  getPool,
  getKrispWebhookDbSummary,
  getKrispWebhookEventById,
  seedManualTestTranscript,
  purgeManualTestTranscripts,
};
