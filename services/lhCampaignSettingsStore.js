/**
 * Campaign message + working hours - what each machine last reported, and the changes waiting
 * for it. The words and checks are in lhCampaignSettings.js; the machine end is
 * scripts/linked-helper/lh-settings.py, run by lh-clipboard.py.
 *
 * TWO TABLES:
 *   lh_campaign_settings  one row per client: the machine's latest snapshot of every live campaign
 *                         (steps, message nodes, hours in the machine's local time). Sent when it
 *                         changes, so "show me my campaign message" is answered at once, with a date.
 *   lh_campaign_setting_changes  the changes a client confirmed in Claude. queued -> applying ->
 *                         done | failed. One live change per client: a newer one replaces it, the
 *                         same as top-ups and the clipboard - "no, this one".
 *
 * TENANT SAFETY IS STRUCTURAL: rows are keyed by client id and the machine authenticates with its
 * per-client 'Machine Report Secret' (routes/linkedHelperMachineRoutes.js) before it can read or
 * report one. House style: lhTopUpStore.js - lazy Pool, CREATE-IF-NOT-EXISTS, no migrations.
 */

const { Pool } = require('pg');
const { createSafeLogger } = require('../utils/loggerHelper');

const log = createSafeLogger('SYSTEM', null, 'lh_settings');

/** A change no machine took in this long belongs to a machine that is off - fail it, say so. */
const WAIT_HOURS = 6;
const KEEP_DAYS = 60;
const MAX_SNAPSHOT_BYTES = 200000;

let pool;
let schemaEnsured = false;

function getPool() {
  const url = (process.env.DATABASE_URL || '').trim();
  if (!url) return null;
  if (!pool) {
    pool = new Pool({ connectionString: url, max: 2, ssl: { rejectUnauthorized: false } });
    pool.on('error', (e) => log.error(`lh-settings pool error: ${e.message}`));
  }
  return pool;
}

async function ensureSchema(client) {
  if (schemaEnsured) return;
  await client.query(`
    CREATE TABLE IF NOT EXISTS lh_campaign_settings (
      client_id    TEXT        PRIMARY KEY,
      snapshot     JSONB       NOT NULL,
      reported_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS lh_campaign_setting_changes (
      change_id     TEXT        PRIMARY KEY,
      client_id     TEXT        NOT NULL,
      kind          TEXT        NOT NULL,
      campaign_id   INTEGER     NOT NULL,
      campaign_name TEXT,
      payload       JSONB       NOT NULL,
      summary       TEXT,
      requested_by  TEXT,
      status        TEXT        NOT NULL DEFAULT 'queued',
      result        JSONB,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      taken_at      TIMESTAMPTZ,
      finished_at   TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS lh_campaign_setting_changes_client ON lh_campaign_setting_changes (client_id, created_at DESC);
  `);
  schemaEnsured = true;
}

async function withClient(fn, fallback = null) {
  const p = getPool();
  if (!p) return fallback;
  const client = await p.connect();
  try {
    await ensureSchema(client);
    return await fn(client);
  } finally {
    client.release();
  }
}

const newId = () => `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

/** Keep only the shape we use, clipped - it comes from a machine and is shown to a person. */
function cleanSnapshot(body = {}) {
  const s = (v, n) => (v === undefined || v === null ? null : String(v).slice(0, n));
  const camps = Array.isArray(body.campaigns) ? body.campaigns.slice(0, 60) : [];
  return {
    tz: s(body.tz, 60),
    offset_min: Number.isFinite(Number(body.offset_min)) ? Number(body.offset_min) : null,
    at: s(body.at, 40),
    campaigns: camps.filter((c) => c && Number.isInteger(Number(c.id))).map((c) => ({
      id: Number(c.id), name: s(c.name, 120) || `Campaign ${c.id}`, paused: !!c.paused,
      steps: (Array.isArray(c.steps) ? c.steps.slice(0, 30) : []).filter((x) => x && Number.isInteger(Number(x.id))).map((x) => ({
        id: Number(x.id), name: s(x.name, 120) || '', type: s(x.type, 60),
        template: x.template && typeof x.template === 'object' ? x.template : null,
        template_hash: s(x.template_hash, 40),
        hours: x.hours === undefined ? null : x.hours,
      })),
    })),
  };
}

async function saveSnapshot(clientId, body) {
  const snap = cleanSnapshot(body);
  const json = JSON.stringify(snap);
  if (json.length > MAX_SNAPSHOT_BYTES) {
    log.error(`LH-SETTINGS snapshot for ${clientId} too big (${json.length} bytes) - not kept`);
    return false;
  }
  try {
    await withClient((c) => c.query(
      `INSERT INTO lh_campaign_settings (client_id, snapshot, reported_at) VALUES ($1, $2::jsonb, now())
       ON CONFLICT (client_id) DO UPDATE SET snapshot = EXCLUDED.snapshot, reported_at = now()`,
      [String(clientId), json]));
    return true;
  } catch (e) {
    log.error(`LH-SETTINGS snapshot save failed for ${clientId}: ${e.message}`);
    return false;
  }
}

/** { snapshot, reportedAt } or null when the machine has never sent one. */
async function getSnapshot(clientId) {
  return withClient(async (c) => {
    const { rows } = await c.query('SELECT snapshot, reported_at FROM lh_campaign_settings WHERE client_id = $1', [String(clientId)]);
    return rows.length ? { snapshot: rows[0].snapshot, reportedAt: rows[0].reported_at } : null;
  });
}

function rowOut(r) {
  if (!r) return null;
  return {
    changeId: r.change_id, clientId: r.client_id, kind: r.kind, campaignId: Number(r.campaign_id),
    campaignName: r.campaign_name || '', payload: r.payload || {}, summary: r.summary || '',
    requestedBy: r.requested_by, status: r.status, result: r.result || null,
    createdAt: r.created_at, takenAt: r.taken_at, finishedAt: r.finished_at,
  };
}

/** Leave a change for the machine. Any live change of theirs is replaced. */
async function request({ clientId, kind, campaignId, campaignName, payload, summary, requestedBy }) {
  if (!getPool()) throw new Error('no database configured - changes cannot be queued');
  const id = newId();
  await withClient(async (c) => {
    await c.query(
      `UPDATE lh_campaign_setting_changes SET status = 'replaced', finished_at = now()
        WHERE client_id = $1 AND status = 'queued'`, [String(clientId)]);
    await c.query(
      `INSERT INTO lh_campaign_setting_changes (change_id, client_id, kind, campaign_id, campaign_name, payload, summary, requested_by)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)`,
      [id, String(clientId), kind, Number(campaignId), campaignName || null, JSON.stringify(payload || {}),
        summary ? String(summary).slice(0, 400) : null, requestedBy ? String(requestedBy).slice(0, 80) : null]);
  });
  log.info(`LH-SETTINGS queued ${id} for ${clientId}: ${kind} on campaign ${campaignId}`);
  return { ok: true, changeId: id };
}

/** The machine asking for work: the oldest queued change, marked applying. */
async function takeForMachine(clientId) {
  const id = String(clientId || '').trim();
  if (!id) return null;
  try {
    return await withClient(async (c) => {
      await c.query(
        `UPDATE lh_campaign_setting_changes
            SET status = 'failed', finished_at = now(),
                result = jsonb_build_object('ok', false, 'error', 'the machine did not pick this change up within ' || $2 || ' hours - it may be off')
          WHERE client_id = $1 AND status = 'queued' AND created_at <= now() - ($2 || ' hours')::interval`,
        [id, String(WAIT_HOURS)]);
      await c.query(`DELETE FROM lh_campaign_setting_changes WHERE client_id = $1 AND created_at <= now() - ($2 || ' days')::interval`, [id, String(KEEP_DAYS)]);
      const { rows } = await c.query(
        `UPDATE lh_campaign_setting_changes SET status = 'applying', taken_at = now()
          WHERE change_id = (SELECT change_id FROM lh_campaign_setting_changes WHERE client_id = $1 AND status = 'queued' ORDER BY created_at LIMIT 1)
        RETURNING *`, [id]);
      if (!rows.length) return null;
      const r = rowOut(rows[0]);
      return { id: r.changeId, kind: r.kind, campaign_id: r.campaignId, ...r.payload };
    });
  } catch (e) {
    log.error(`LH-SETTINGS take failed for ${id}: ${e.message}`);
    return null;
  }
}

function cleanResult(body = {}) {
  const s = (v, n) => (v === undefined || v === null ? null : String(v).replace(/[\r\n\t]+/g, ' ').slice(0, n));
  return {
    ok: body.ok === true, error: s(body.error, 400), stale: body.stale === true,
    restarted: body.restarted === undefined ? null : body.restarted === true,
    was_running: body.was_running === undefined ? null : body.was_running === true,
    changed: Array.isArray(body.changed) ? body.changed.slice(0, 30).map(Number) : null,
    hours: body.hours === undefined ? null : body.hours,
  };
}

/** The machine reporting the outcome. Returns the row, or null. */
async function reportFromMachine(clientId, changeId, body) {
  const result = cleanResult(body);
  try {
    return await withClient(async (c) => {
      const { rows } = await c.query(
        `UPDATE lh_campaign_setting_changes SET status = $3, result = $4::jsonb, finished_at = now()
          WHERE client_id = $1 AND change_id = $2 AND status = 'applying' RETURNING *`,
        [String(clientId), String(changeId || ''), result.ok ? 'done' : 'failed', JSON.stringify(result)]);
      if (rows.length) log.info(`LH-SETTINGS ${clientId} ${changeId} -> ${result.ok ? 'done' : `failed: ${result.error}`}`);
      return rowOut(rows[0]);
    });
  } catch (e) {
    log.error(`LH-SETTINGS report failed for ${clientId}: ${e.message}`);
    return null;
  }
}

async function latestFor(clientId) {
  return withClient(async (c) => {
    const { rows } = await c.query('SELECT * FROM lh_campaign_setting_changes WHERE client_id = $1 ORDER BY created_at DESC LIMIT 1', [String(clientId)]);
    return rowOut(rows[0]);
  });
}

module.exports = { saveSnapshot, getSnapshot, request, takeForMachine, reportFromMachine, latestFor, cleanSnapshot, cleanResult, WAIT_HOURS };
