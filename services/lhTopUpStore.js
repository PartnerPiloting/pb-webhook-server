/**
 * Campaign top-ups - the jobs a client's Linked Helper machine collects and reports on.
 *
 * WHY (Guy, 5 Nov 2026): "time to top up the search" in the Monday email gave nobody a way to do
 * it, and people forget the clicks (Roland asked where to paste; Matthew ran dry twice). Now the
 * client hands over a search link - in chat, or on the top-up page the email links to - and the
 * job waits here for their machine. The machine (scripts/linked-helper/lh-clipboard.py, running
 * scripts/linked-helper/lh-topup.py) puts the search into their one campaign as Linked Helper's
 * own auto-collect step, makes sure the campaign is running, and reports progress until the
 * collect has finished. The final report is what the client is emailed (services/lhTopUp.js).
 *
 * ONE LIVE JOB PER CLIENT. A second link while one is collecting replaces it - "no, this one" -
 * exactly like the clipboard. Linked Helper itself only ever has one auto-collect URL per
 * campaign, so a queue would be a fiction.
 *
 * TENANT SAFETY IS STRUCTURAL, same as the clipboard: rows are keyed by client id, and the machine
 * authenticates with the per-client 'Machine Report Secret' before it can take or report one.
 *
 * Statuses: queued (waiting for the machine) -> applying (machine took it) -> collecting (the
 * search is in, Linked Helper is walking it) -> done | failed. `detail` carries whatever the
 * machine last said (collected, degrees, waiting before/after, the reason it failed).
 *
 * House style: machineFileStore.js - lazy Pool, CREATE-IF-NOT-EXISTS, no migrations. No
 * DATABASE_URL = no top-ups, and the caller is told so in words.
 */

const { Pool } = require('pg');
const { createSafeLogger } = require('../utils/loggerHelper');

const log = createSafeLogger('SYSTEM', null, 'lh_topup');

/** A job no machine took in this long is a machine that is off - stop offering it, say so. */
const WAIT_MINUTES = 6 * 60;
/** Receipts are kept this long, so "what happened to my top-up?" has an answer for a while. */
const KEEP_DAYS = 60;

let pool;
let schemaEnsured = false;

function getPool() {
  const url = (process.env.DATABASE_URL || '').trim();
  if (!url) return null;
  if (!pool) pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });
  return pool;
}

async function ensureSchema(client) {
  if (schemaEnsured) return;
  await client.query(`
    CREATE TABLE IF NOT EXISTS lh_campaign_topups (
      job_id        TEXT        PRIMARY KEY,
      client_id     TEXT        NOT NULL,
      campaign_id   INTEGER     NOT NULL,
      campaign_name TEXT,
      url           TEXT        NOT NULL,
      url_kind      TEXT,
      degrees       JSONB,
      requested_by  TEXT,
      status        TEXT        NOT NULL DEFAULT 'queued',
      detail        JSONB,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      taken_at      TIMESTAMPTZ,
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      finished_at   TIMESTAMPTZ,
      notified_at   TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS lh_campaign_topups_client ON lh_campaign_topups (client_id, created_at DESC);
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

const newJobId = () => `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

function rowOut(r) {
  if (!r) return null;
  return {
    jobId: r.job_id, clientId: r.client_id, campaignId: Number(r.campaign_id), campaignName: r.campaign_name || '',
    url: r.url, urlKind: r.url_kind, degrees: r.degrees || null, requestedBy: r.requested_by, status: r.status,
    detail: r.detail || {}, createdAt: r.created_at, takenAt: r.taken_at, updatedAt: r.updated_at,
    finishedAt: r.finished_at, notifiedAt: r.notified_at,
  };
}

/**
 * Leave a top-up for a client's machine. Any job of theirs still queued/applying/collecting is
 * superseded (status 'replaced') - one live job per client.
 */
async function request({ clientId, campaignId, campaignName, url, urlKind, degrees, requestedBy }) {
  const id = String(clientId || '').trim();
  if (!id) throw new Error('no client id');
  if (!Number.isInteger(Number(campaignId))) throw new Error('no campaign id');
  if (!url) throw new Error('no search link');
  if (!getPool()) throw new Error('no database configured - top-ups cannot be queued');
  const jobId = newJobId();
  await withClient(async (c) => {
    await c.query(
      `UPDATE lh_campaign_topups SET status = 'replaced', updated_at = now(), finished_at = now()
        WHERE client_id = $1 AND status IN ('queued', 'applying', 'collecting')`, [id]);
    await c.query(
      `INSERT INTO lh_campaign_topups (job_id, client_id, campaign_id, campaign_name, url, url_kind, degrees, requested_by, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, 'queued')`,
      [jobId, id, Number(campaignId), campaignName || null, String(url), urlKind || null,
        JSON.stringify(degrees || null), requestedBy ? String(requestedBy).slice(0, 80) : null]);
  });
  log.info(`LH-TOPUP queued ${jobId} for ${id}: campaign ${campaignId} (${urlKind || 'link'})`);
  return { ok: true, jobId };
}

/**
 * The machine asking for work. Hands over the one queued job (oldest first), marking it applying.
 * A job nobody took within WAIT_MINUTES is failed as "machine never collected it" so the client
 * is told, rather than it waking up a day later and quietly re-pointing their campaign.
 */
async function takeForMachine(clientId) {
  const id = String(clientId || '').trim();
  if (!id) return null;
  try {
    return await withClient(async (c) => {
      await c.query(
        `UPDATE lh_campaign_topups
            SET status = 'failed', updated_at = now(), finished_at = now(),
                detail = COALESCE(detail, '{}'::jsonb) || jsonb_build_object('error', 'the machine did not collect this top-up within ' || $2 || ' hours - it may be off')
          WHERE client_id = $1 AND status = 'queued' AND created_at <= now() - ($2 || ' hours')::interval`,
        [id, String(WAIT_MINUTES / 60)]);
      await c.query(`DELETE FROM lh_campaign_topups WHERE client_id = $1 AND created_at <= now() - ($2 || ' days')::interval`, [id, String(KEEP_DAYS)]);
      const { rows } = await c.query(
        `UPDATE lh_campaign_topups SET status = 'applying', taken_at = now(), updated_at = now()
          WHERE job_id = (SELECT job_id FROM lh_campaign_topups WHERE client_id = $1 AND status = 'queued' ORDER BY created_at LIMIT 1)
        RETURNING *`, [id]);
      if (!rows.length) return null;
      const r = rowOut(rows[0]);
      return { id: r.jobId, campaign_id: r.campaignId, url: r.url, kind: r.urlKind };
    });
  } catch (e) {
    log.error(`LH-TOPUP take failed for ${id}: ${e.message}`);
    return null;
  }
}

/** The jobs the machine should still be reporting on - so a restarted agent can pick them back up. */
async function openForMachine(clientId) {
  const id = String(clientId || '').trim();
  if (!id) return [];
  try {
    return await withClient(async (c) => {
      const { rows } = await c.query(
        `SELECT * FROM lh_campaign_topups WHERE client_id = $1 AND status IN ('applying', 'collecting') ORDER BY created_at`, [id]);
      return rows.map((r) => ({ id: r.job_id, campaign_id: Number(r.campaign_id), url: r.url, kind: r.url_kind, status: r.status, detail: r.detail || {} }));
    }, []);
  } catch (e) {
    log.error(`LH-TOPUP open-jobs read failed for ${id}: ${e.message}`);
    return [];
  }
}

/** Only what a receipt needs, clipped - it comes from a machine and is shown to a person. */
function cleanReport(report = {}) {
  const s = (v, n) => (v === undefined || v === null ? null : String(v).replace(/[\r\n\t]+/g, ' ').trim().slice(0, n));
  const n = (v) => (Number.isFinite(Number(v)) && v !== null && v !== undefined && v !== '' ? Math.round(Number(v)) : null);
  const degrees = {};
  if (report.degrees && typeof report.degrees === 'object') {
    for (const [k, v] of Object.entries(report.degrees).slice(0, 8)) degrees[s(k, 30)] = n(v);
  }
  return {
    ok: report.ok === true,
    stage: s(report.stage, 20),                 // applied | progress | final
    how: s(report.how, 20),                     // inserted | updated
    action_id: n(report.action_id),
    campaign_name: s(report.campaign_name, 120),
    waiting_before: n(report.waiting_before),
    waiting_now: n(report.waiting_now),
    collected: n(report.collected),
    skipped: n(report.skipped),
    degrees,
    since: s(report.since, 40),
    last_collect_at: s(report.last_collect_at, 40),
    minutes_since_last: n(report.minutes_since_last),
    collecting_now: report.collecting_now === true,
    paused: report.paused === true,
    postpone_reason: s(report.postpone_reason, 80),
    finished_because: s(report.finished_because, 120),
    error: s(report.error, 400),
  };
}

/**
 * The machine saying how it is going. stage 'applied' -> collecting; 'progress' keeps collecting;
 * 'final' -> done (or failed when ok is false at any stage). Returns the row after the write, or null.
 */
async function reportFromMachine(clientId, jobId, report) {
  const id = String(clientId || '').trim();
  const detail = cleanReport(report);
  let status;
  if (!detail.ok) status = 'failed';
  else if (detail.stage === 'final') status = 'done';
  else status = 'collecting';
  try {
    return await withClient(async (c) => {
      const { rows } = await c.query(
        `UPDATE lh_campaign_topups
            SET status = $3, detail = COALESCE(detail, '{}'::jsonb) || $4::jsonb, updated_at = now(),
                campaign_name = COALESCE($5, campaign_name),
                finished_at = CASE WHEN $3 IN ('done', 'failed') THEN now() ELSE finished_at END
          WHERE client_id = $1 AND job_id = $2 AND status NOT IN ('replaced')
        RETURNING *`,
        [id, String(jobId || ''), status, JSON.stringify(detail), detail.campaign_name]);
      if (!rows.length) return null;
      log.info(`LH-TOPUP ${id} ${jobId} -> ${status}${detail.collected !== null ? ` (${detail.collected} collected)` : ''}${detail.error ? `: ${detail.error}` : ''}`);
      return rowOut(rows[0]);
    });
  } catch (e) {
    log.error(`LH-TOPUP report failed for ${id}: ${e.message}`);
    return null;
  }
}

/** The latest job for a client (any status). null = none on record. */
async function latestFor(clientId) {
  const id = String(clientId || '').trim();
  if (!id) return null;
  try {
    return await withClient(async (c) => {
      const { rows } = await c.query(`SELECT * FROM lh_campaign_topups WHERE client_id = $1 ORDER BY created_at DESC LIMIT 1`, [id]);
      return rowOut(rows[0]);
    });
  } catch (e) {
    log.error(`LH-TOPUP latest read failed for ${id}: ${e.message}`);
    return null;
  }
}

/** Mark the client told about a finished job. */
async function markNotified(jobId) {
  try {
    await withClient((c) => c.query(`UPDATE lh_campaign_topups SET notified_at = now() WHERE job_id = $1`, [String(jobId)]));
  } catch (e) {
    log.error(`LH-TOPUP notified mark failed for ${jobId}: ${e.message}`);
  }
}

module.exports = { request, takeForMachine, openForMachine, reportFromMachine, latestFor, markNotified, cleanReport, WAIT_MINUTES };
