/**
 * Capture policy — the per-client security layer between "a recording exists at the provider"
 * and "its transcript is fetched and filed". Born from the Ashley Knowles security discussion
 * (2026-08-04, agreed by email: "those three layers are all I need"):
 *
 *   1. LEADS-ONLY GATE  — per-client: fetch a transcript only when someone on the call is
 *      already a lead. No match => nothing stored, not even the title (stateless decline).
 *   2. HOLDING WINDOW   — per-client minutes between "note exists" and "transcript fetched".
 *      The queue row holds metadata only; the WORDS are not fetched until release. The client
 *      can see what's queued, veto it, or release it early — through chat.
 *   3. TOMBSTONES       — a deleted/vetoed capture stays deleted: provider retries and
 *      re-polls check here first. Without this, deleting a meeting row re-opens the dedup
 *      gate and the next poll cheerfully re-files it — making the delete button a lie.
 *
 * PROVIDER-AGNOSTIC by design: keyed (source, provider_recording_id) like the store itself.
 * Granola is wired first (Ashley is a Granola client); Fathom consults the tombstones today
 * and can adopt the gate/window later through the same functions.
 *
 * BLANK-SAFE: policy comes from two Clients-master fields — 'Capture Mode' (blank = open,
 * today's behaviour) and 'Capture Hold Minutes' (blank/0 = immediate). A client with blank
 * fields never touches this module's tables.
 *
 * House style: recallWebhookDb.js (lazy Pool, ensureSchema CREATE-IF-NOT-EXISTS, no migrations).
 */

const { Pool } = require('pg');
const { createSafeLogger } = require('../utils/loggerHelper');

const log = createSafeLogger('SYSTEM', null, 'capture_policy');

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

  // Held captures: metadata only, by design — the transcript is NOT fetched until release.
  await client.query(`
    CREATE TABLE IF NOT EXISTS capture_pending (
      id                    BIGSERIAL PRIMARY KEY,
      created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
      source                TEXT NOT NULL,
      provider_recording_id TEXT NOT NULL,
      coach_client_id       TEXT NOT NULL,
      title                 TEXT,
      meeting_start         TIMESTAMPTZ,
      matched_leads         TEXT,              -- JSON [{name?, email?}] — who justified the capture
      release_at            TIMESTAMPTZ NOT NULL,
      status                TEXT NOT NULL DEFAULT 'held',  -- 'held' | 'released' | 'vetoed'
      released_at           TIMESTAMPTZ,
      last_error            TEXT,
      UNIQUE (source, provider_recording_id)
    );
  `);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_capture_pending_due ON capture_pending (release_at) WHERE status = 'held';`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_capture_pending_coach ON capture_pending (coach_client_id);`);

  // Tombstones: the never-again list. A provider retry, regenerate, or poll pass that hits a
  // tombstone walks away without fetching anything.
  await client.query(`
    CREATE TABLE IF NOT EXISTS capture_tombstones (
      id                    BIGSERIAL PRIMARY KEY,
      created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
      source                TEXT NOT NULL,
      provider_recording_id TEXT NOT NULL,
      coach_client_id       TEXT NOT NULL,
      reason                TEXT,              -- 'deleted' | 'vetoed' | 'purged'
      UNIQUE (source, provider_recording_id)
    );
  `);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_capture_tomb_coach ON capture_tombstones (coach_client_id);`);

  schemaEnsured = true;
}

// ── Policy off the client object ────────────────────────────────────────────────────────────

/**
 * Read the capture policy off a clientService client object. Blank fields = fully open =
 * exactly the pre-policy behaviour, so every existing client is untouched.
 */
function getCapturePolicy(client) {
  const mode = String(client?.captureMode || '').toLowerCase() === 'leads only' ? 'leads-only' : 'open';
  const holdMinutes = Number(client?.captureHoldMinutes) > 0 ? Math.round(Number(client.captureHoldMinutes)) : 0;
  return { mode, holdMinutes, active: mode === 'leads-only' || holdMinutes > 0 };
}

// ── Tombstones ──────────────────────────────────────────────────────────────────────────────

/**
 * Is this capture on the never-again list? FAIL-CLOSED: if the check itself errors we report
 * blocked — a DB outage must not let a deleted meeting slip back in (the insert would fail
 * anyway; skipping is honest).
 */
async function isCaptureBlocked(source, providerRecordingId) {
  if (!source || !providerRecordingId) return false;
  const p = getPool();
  if (!p) return false; // no DB configured at all — nothing to protect
  let client;
  try {
    client = await p.connect();
    await ensureSchema(client);
    const r = await client.query(
      `SELECT 1 FROM capture_tombstones WHERE source = $1 AND provider_recording_id = $2 LIMIT 1`,
      [String(source).toLowerCase(), String(providerRecordingId)],
    );
    return r.rows.length > 0;
  } catch (e) {
    log.warn(`tombstone check failed for ${source}/${providerRecordingId}: ${e.message} — failing CLOSED (skip)`);
    return true;
  } finally {
    if (client) client.release();
  }
}

async function addTombstone({ source, providerRecordingId, coachClientId, reason }) {
  if (!source || !providerRecordingId) return { ok: false, error: 'source and providerRecordingId required' };
  const p = getPool();
  if (!p) return { ok: false, error: 'database not available' };
  const client = await p.connect();
  try {
    await ensureSchema(client);
    await client.query(
      `INSERT INTO capture_tombstones (source, provider_recording_id, coach_client_id, reason)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (source, provider_recording_id) DO NOTHING`,
      [String(source).toLowerCase(), String(providerRecordingId), String(coachClientId || '').trim() || 'unknown', reason || null],
    );
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  } finally {
    client.release();
  }
}

// ── Holding window ──────────────────────────────────────────────────────────────────────────

/** Queue a capture for later release. Idempotent per (source, provider id) — a webhook retry updates nothing. */
async function holdCapture({ source, providerRecordingId, coachClientId, title, meetingStart, matchedLeads, holdMinutes }) {
  const p = getPool();
  if (!p) return { ok: false, error: 'database not available' };
  const mins = Number(holdMinutes) > 0 ? Math.round(Number(holdMinutes)) : 0;
  const client = await p.connect();
  try {
    await ensureSchema(client);
    const r = await client.query(
      `INSERT INTO capture_pending (source, provider_recording_id, coach_client_id, title, meeting_start, matched_leads, release_at)
       VALUES ($1, $2, $3, $4, $5, $6, now() + ($7 || ' minutes')::interval)
       ON CONFLICT (source, provider_recording_id) DO NOTHING
       RETURNING id, release_at`,
      [
        String(source).toLowerCase(), String(providerRecordingId), String(coachClientId).trim(),
        title || null, meetingStart ? new Date(meetingStart) : null,
        matchedLeads ? JSON.stringify(matchedLeads) : null, String(mins),
      ],
    );
    if (!r.rows.length) {
      const existing = await client.query(
        `SELECT id, release_at, status FROM capture_pending WHERE source = $1 AND provider_recording_id = $2`,
        [String(source).toLowerCase(), String(providerRecordingId)],
      );
      return { ok: true, alreadyHeld: true, ...(existing.rows[0] || {}) };
    }
    return { ok: true, id: r.rows[0].id, releaseAt: r.rows[0].release_at };
  } catch (e) {
    return { ok: false, error: e.message };
  } finally {
    client.release();
  }
}

/** Everything a client currently has in the window (newest first). */
async function listHeldCaptures(coachClientId, { limit = 25 } = {}) {
  const p = getPool();
  if (!p) return [];
  const client = await p.connect();
  try {
    await ensureSchema(client);
    const r = await client.query(
      `SELECT id, source, provider_recording_id, title, meeting_start, matched_leads, release_at, status, last_error, created_at
       FROM capture_pending
       WHERE coach_client_id = $1 AND status = 'held'
       ORDER BY release_at ASC
       LIMIT $2`,
      [String(coachClientId).trim(), limit],
    );
    return r.rows;
  } finally {
    client.release();
  }
}

/** Held rows whose release time has passed — the sweep's worklist. */
async function dueHeldCaptures({ limit = 10 } = {}) {
  const p = getPool();
  if (!p) return [];
  const client = await p.connect();
  try {
    await ensureSchema(client);
    const r = await client.query(
      `SELECT id, source, provider_recording_id, coach_client_id, title, release_at, last_error
       FROM capture_pending
       WHERE status = 'held' AND release_at <= now()
       ORDER BY release_at ASC
       LIMIT $1`,
      [limit],
    );
    return r.rows;
  } finally {
    client.release();
  }
}

/** Veto a held capture: it is never fetched, and the tombstone makes that permanent. Tenant-checked. */
async function vetoHeldCapture({ id, coachClientId, reason = 'vetoed' }) {
  const p = getPool();
  if (!p) return { ok: false, error: 'database not available' };
  const client = await p.connect();
  try {
    await ensureSchema(client);
    const r = await client.query(
      `UPDATE capture_pending SET status = 'vetoed'
       WHERE id = $1 AND coach_client_id = $2 AND status = 'held'
       RETURNING source, provider_recording_id, title`,
      [Number(id), String(coachClientId).trim()],
    );
    if (!r.rows.length) return { ok: false, error: 'no held capture with that id for this client' };
    const row = r.rows[0];
    await client.query(
      `INSERT INTO capture_tombstones (source, provider_recording_id, coach_client_id, reason)
       VALUES ($1, $2, $3, $4) ON CONFLICT (source, provider_recording_id) DO NOTHING`,
      [row.source, row.provider_recording_id, String(coachClientId).trim(), reason],
    );
    return { ok: true, title: row.title, source: row.source, providerRecordingId: row.provider_recording_id };
  } catch (e) {
    return { ok: false, error: e.message };
  } finally {
    client.release();
  }
}

/** Pull a held capture's release time to NOW ("take it now"). The sweep files it on its next pass. Tenant-checked. */
async function releaseHeldCaptureNow({ id, coachClientId }) {
  const p = getPool();
  if (!p) return { ok: false, error: 'database not available' };
  const client = await p.connect();
  try {
    await ensureSchema(client);
    const r = await client.query(
      `UPDATE capture_pending SET release_at = now()
       WHERE id = $1 AND coach_client_id = $2 AND status = 'held'
       RETURNING source, provider_recording_id, title`,
      [Number(id), String(coachClientId).trim()],
    );
    if (!r.rows.length) return { ok: false, error: 'no held capture with that id for this client' };
    return { ok: true, ...r.rows[0] };
  } catch (e) {
    return { ok: false, error: e.message };
  } finally {
    client.release();
  }
}

/** Sweep bookkeeping: mark a due row filed, or record why filing failed (row stays held and retries). */
async function markHeldCaptureReleased(id, { ok, error } = {}) {
  const p = getPool();
  if (!p) return;
  const client = await p.connect();
  try {
    await ensureSchema(client);
    if (ok) {
      await client.query(`UPDATE capture_pending SET status = 'released', released_at = now(), last_error = NULL WHERE id = $1`, [Number(id)]);
    } else {
      await client.query(`UPDATE capture_pending SET last_error = $2 WHERE id = $1`, [Number(id), String(error || 'unknown').slice(0, 500)]);
    }
  } finally {
    client.release();
  }
}

module.exports = {
  getCapturePolicy,
  isCaptureBlocked,
  addTombstone,
  holdCapture,
  listHeldCaptures,
  dueHeldCaptures,
  vetoHeldCapture,
  releaseHeldCaptureNow,
  markHeldCaptureReleased,
};
