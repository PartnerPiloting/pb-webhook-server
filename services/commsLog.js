/**
 * Wingguy communications log — the first brick of "one record of everything Wingguy has told a
 * client" (agreed with Guy 2026-08-26).
 *
 * Direction, not migration: NEW senders write here from day one (first user: the weekly
 * pending-people digest); existing senders are left alone until each is next touched. So today
 * this answers "when did Wingguy last send X to this client?" (the digest's once-a-week guard
 * reads it), and over time it grows into the per-client comms record.
 *
 * Shape: one row per outbound communication. `channel` is a short slug ('pending-digest', …),
 * `meta` is free JSON for whatever the sender wants to remember (person lists, message ids).
 * Reuses the recall store's pool — no new connection config.
 */

const { getPool } = require('./recallWebhookDb');

let ensured = false;
async function ensureTable(client) {
  if (ensured) return;
  await client.query(`
    CREATE TABLE IF NOT EXISTS wingguy_comms_log (
      id BIGSERIAL PRIMARY KEY,
      coach_client_id TEXT NOT NULL,
      channel TEXT NOT NULL,
      recipient TEXT,
      subject TEXT,
      summary TEXT,
      meta JSONB,
      sent_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_comms_log_tenant_channel ON wingguy_comms_log (coach_client_id, channel, sent_at DESC);`);
  ensured = true;
}

/** Record one outbound communication. Never throws — a log failure must not break a send. */
async function recordComm({ coachClientId, channel, recipient, subject, summary, meta }) {
  const p = getPool();
  if (!p || !coachClientId || !channel) return { ok: false };
  const client = await p.connect();
  try {
    await ensureTable(client);
    await client.query(
      `INSERT INTO wingguy_comms_log (coach_client_id, channel, recipient, subject, summary, meta)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [coachClientId, channel, recipient || null, subject || null, summary || null, meta ? JSON.stringify(meta) : null],
    );
    return { ok: true };
  } catch (e) {
    console.warn(`[commsLog] record failed (${coachClientId}/${channel}): ${e.message}`);
    return { ok: false, error: e.message };
  } finally {
    client.release();
  }
}

/** When did this channel last go out to this client? Returns a Date or null. */
async function lastCommAt({ coachClientId, channel }) {
  const p = getPool();
  if (!p || !coachClientId || !channel) return null;
  const client = await p.connect();
  try {
    await ensureTable(client);
    const r = await client.query(
      `SELECT max(sent_at) AS last FROM wingguy_comms_log WHERE coach_client_id = $1 AND channel = $2`,
      [coachClientId, channel],
    );
    return r.rows[0] && r.rows[0].last ? new Date(r.rows[0].last) : null;
  } catch (e) {
    console.warn(`[commsLog] lastCommAt failed (${coachClientId}/${channel}): ${e.message}`);
    return null;
  } finally {
    client.release();
  }
}

module.exports = { recordComm, lastCommAt };
