/**
 * Machine files - one file, on its way to one client's Linked Helper machine.
 *
 * The sibling of services/machineClipboardStore.js, and built the same way for the same reasons:
 * the request is left here, and the machine's own agent (scripts/linked-helper/lh-clipboard.py)
 * comes and gets it. Nothing reaches INTO a machine; the machine asks. The why of the feature is
 * in services/machineFileLink.js.
 *
 * What differs from the clipboard:
 *   - the row is KEPT after the machine takes it, because the person will ask "did it arrive?"
 *     and the honest answer is whatever the machine reported - arrived, how big, whose export -
 *     or why not. A clipboard item is deleted on read; this is a receipt.
 *   - the machine reports back (reportFromMachine). Queued is not delivered: a link that needs a
 *     sign-in fetches a web page, and only the machine finds that out.
 *
 * ONE FILE PER MACHINE, LATEST WINS - same reasoning as the clipboard. A second link means "no,
 * this one".
 *
 * TENANT SAFETY IS STRUCTURAL, as there: rows are keyed by client id and the machine proves
 * itself with its own 'Machine Report Secret' before it can take one.
 *
 * What is stored is the LINK, never the file. Links expire from here after KEEP_HOURS.
 */

const { Pool } = require('pg');
const { createSafeLogger } = require('../utils/loggerHelper');

const log = createSafeLogger('SYSTEM', null, 'machine_files');

/** A link nobody's machine collected in this long is a machine that is off - say so, stop offering it. */
const WAIT_MINUTES = 60;
/** How long the receipt is kept, so "did it arrive?" still has an answer the next morning. */
const KEEP_HOURS = 72;

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
    CREATE TABLE IF NOT EXISTS wingguy_machine_files (
      client_id    TEXT        PRIMARY KEY,
      job_id       TEXT        NOT NULL,
      service      TEXT,
      share_url    TEXT        NOT NULL,
      download_url TEXT        NOT NULL,
      status       TEXT        NOT NULL DEFAULT 'waiting',
      detail       JSONB,
      sent_by      TEXT,
      sent_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    )
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

const newJobId = () => `f${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

/** Leave a link for a client's machine to fetch. Replaces whatever was there. */
async function putForMachine(clientId, link, sentBy = null) {
  const id = String(clientId || '').trim();
  if (!id) throw new Error('no client id');
  if (!getPool()) throw new Error('no database configured - files cannot be sent to machines');
  const jobId = newJobId();
  await withClient((c) => c.query(
    `INSERT INTO wingguy_machine_files (client_id, job_id, service, share_url, download_url, status, detail, sent_by, sent_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, 'waiting', NULL, $6, now(), now())
     ON CONFLICT (client_id) DO UPDATE
       SET job_id = EXCLUDED.job_id, service = EXCLUDED.service, share_url = EXCLUDED.share_url,
           download_url = EXCLUDED.download_url, status = 'waiting', detail = NULL,
           sent_by = EXCLUDED.sent_by, sent_at = now(), updated_at = now()`,
    [id, jobId, link.service || null, link.shareUrl, link.downloadUrl, sentBy ? String(sentBy).slice(0, 80) : null],
  ));
  log.info(`MACHINE-FILE queued a ${link.service || 'file'} link for ${id} (${jobId})`);
  return { ok: true, jobId };
}

/**
 * The machine asking whether there is anything to fetch. Hands a waiting link over ONCE and marks
 * it fetching, so a second poll two seconds later does not start a second download.
 */
async function takeForMachine(clientId) {
  const id = String(clientId || '').trim();
  if (!id) return null;
  try {
    return await withClient(async (c) => {
      const { rows } = await c.query(
        `UPDATE wingguy_machine_files
            SET status = 'fetching', updated_at = now()
          WHERE client_id = $1 AND status = 'waiting'
            AND sent_at > now() - ($2 || ' minutes')::interval
        RETURNING job_id, service, share_url, download_url`,
        [id, String(WAIT_MINUTES)],
      );
      await c.query(
        `DELETE FROM wingguy_machine_files
          WHERE client_id = $1 AND sent_at <= now() - ($2 || ' hours')::interval`,
        [id, String(KEEP_HOURS)],
      );
      if (!rows.length) return null;
      const r = rows[0];
      return { id: r.job_id, service: r.service, share_url: r.share_url, url: r.download_url };
    });
  } catch (e) {
    log.error(`MACHINE-FILE take failed for ${id}: ${e.message}`);
    return null;
  }
}

/** Only what a receipt needs, clipped - this comes from a machine, and is shown to a person. */
function cleanReport(report = {}) {
  const s = (v, n) => (v === undefined || v === null ? null : String(v).replace(/[\r\n\t]+/g, ' ').trim().slice(0, n));
  const bytes = Number(report.bytes);
  return {
    ok: report.ok === true,
    name: s(report.name, 160),
    bytes: Number.isFinite(bytes) && bytes >= 0 ? Math.round(bytes) : null,
    kind: s(report.kind, 40),
    account: s(report.account, 20),
    version: s(report.version, 20),
    folder: s(report.folder, 120),
    error: s(report.error, 300),
  };
}

/** The machine saying how the fetch went. Ignored unless it is about the job now on record. */
async function reportFromMachine(clientId, jobId, report) {
  const id = String(clientId || '').trim();
  const detail = cleanReport(report);
  try {
    return await withClient(async (c) => {
      const { rowCount } = await c.query(
        `UPDATE wingguy_machine_files
            SET status = $3, detail = $4::jsonb, updated_at = now()
          WHERE client_id = $1 AND job_id = $2`,
        [id, String(jobId || ''), detail.ok ? 'arrived' : 'failed', JSON.stringify(detail)],
      );
      log.info(`MACHINE-FILE ${id} ${detail.ok ? `arrived (${detail.bytes} bytes, ${detail.kind})` : `FAILED: ${detail.error}`}`);
      return rowCount > 0;
    }, false);
  } catch (e) {
    log.error(`MACHINE-FILE report failed for ${id}: ${e.message}`);
    return false;
  }
}

/** Where the last file for this machine got to. null = nothing on record. */
async function statusForMachine(clientId) {
  const id = String(clientId || '').trim();
  if (!id) return null;
  try {
    return await withClient(async (c) => {
      const { rows } = await c.query(
        `SELECT job_id, service, status, detail, sent_at, updated_at,
                (status = 'waiting' AND sent_at <= now() - ($2 || ' minutes')::interval) AS gave_up
           FROM wingguy_machine_files
          WHERE client_id = $1 AND sent_at > now() - ($3 || ' hours')::interval`,
        [id, String(WAIT_MINUTES), String(KEEP_HOURS)],
      );
      return rows.length ? rows[0] : null;
    });
  } catch (_e) {
    return null;
  }
}

module.exports = { putForMachine, takeForMachine, reportFromMachine, statusForMachine, cleanReport, WAIT_MINUTES, KEEP_HOURS };
