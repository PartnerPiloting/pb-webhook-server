/**
 * Extension distribution — the check-in ledger for client machines that pull the extension
 * from us directly (docs/extension-updater.md).
 *
 * WHY THIS EXISTS: every delivery lane we have depends on a cloud account the client controls,
 * and each one has a wall we discovered the hard way — OneDrive allows exactly ONE personal
 * account per machine (Rick Wong's slot was already taken by a family account, 2026-09-03),
 * a work/M365 account cannot accept a consumer share at all (Ashley Knowles, 2026-08-20), and
 * Google Drive's streamed drive is not mounted when the browser starts, so the browser silently
 * DELETES the extension (hit Guy twice, diagnosed 2026-08-25).
 *
 * The updater removes the cloud account from the picture entirely: a scheduled job on the
 * client's own machine pulls from us into a fixed local path. No account, no sync app, no slot,
 * and the folder is real local files that exist before any browser starts.
 *
 * DETECTION MATTERS MORE THAN THE FIX (the Linked Helper lesson — Roland's ran dead for ~10
 * weeks because nobody noticed, not because nobody could fix it). So every run reports what
 * version is actually on disk. A machine that stops checking in is the signal.
 *
 * House style: recallWebhookDb.js — lazy Pool, ensureSchema CREATE-IF-NOT-EXISTS, no migrations.
 * Blank DATABASE_URL is not an error: check-ins are monitoring, never a gate on delivery.
 */

const { Pool } = require('pg');
const { createSafeLogger } = require('../utils/loggerHelper');

const log = createSafeLogger('SYSTEM', null, 'extension_dist');

let pool;
let schemaEnsured = false;

function getPool() {
  const url = (process.env.DATABASE_URL || '').trim();
  if (!url) return null;
  if (!pool) {
    pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });
  }
  return pool;
}

async function ensureSchema(client) {
  if (schemaEnsured) return;
  await client.query(`
    CREATE TABLE IF NOT EXISTS wingguy_extension_checkins (
      id            BIGSERIAL PRIMARY KEY,
      client_id     TEXT        NOT NULL,
      version       TEXT,
      action        TEXT,
      agent         TEXT,
      machine       TEXT,
      note          TEXT,
      checked_in_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  // One row per client per run keeps this small; the useful query is always "latest per client".
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_wingguy_extension_checkins_client
      ON wingguy_extension_checkins (client_id, checked_in_at DESC)
  `);
  schemaEnsured = true;
}

/**
 * Record one run. Never throws — a monitoring write must not be able to fail a delivery.
 * action: 'updated' | 'current' | 'error'
 */
async function recordCheckin({ clientId, version, action, agent, machine, note }) {
  const p = getPool();
  if (!p || !clientId) return false;
  let client;
  try {
    client = await p.connect();
    await ensureSchema(client);
    await client.query(
      `INSERT INTO wingguy_extension_checkins
         (client_id, version, action, agent, machine, note)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        String(clientId),
        version ? String(version).slice(0, 40) : null,
        action ? String(action).slice(0, 40) : null,
        agent ? String(agent).slice(0, 120) : null,
        machine ? String(machine).slice(0, 120) : null,
        note ? String(note).slice(0, 500) : null,
      ]
    );
    return true;
  } catch (e) {
    log.warn(`check-in write failed: ${e.message}`);
    return false;
  } finally {
    if (client) client.release();
  }
}

/**
 * Latest check-in per client — the fleet view. Used by scripts/extension-fleet.js.
 */
async function latestPerClient() {
  const p = getPool();
  if (!p) return [];
  let client;
  try {
    client = await p.connect();
    await ensureSchema(client);
    const { rows } = await client.query(`
      SELECT DISTINCT ON (client_id)
             client_id, version, action, agent, machine, note, checked_in_at
        FROM wingguy_extension_checkins
       ORDER BY client_id, checked_in_at DESC
    `);
    return rows;
  } catch (e) {
    log.warn(`fleet read failed: ${e.message}`);
    return [];
  } finally {
    if (client) client.release();
  }
}

module.exports = { recordCheckin, latestPerClient };
