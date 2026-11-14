/**
 * captureShadow - keeps what the extension SAW of a LinkedIn conversation, has the server read it,
 * and records whether the server's reading agrees with the extension's.
 *
 * Step 1 of moving conversation reading from the extension to the server (see utils/threadReader.js
 * for why). Nothing here changes what is saved on a lead: the extension's own answer still goes to
 * the record exactly as before. This runs beside the save, after the reply has been decided, and a
 * failure here is logged and forgotten.
 *
 * Table wingguy_capture_raw (Postgres, same database as the selector store):
 *   one row per save that carried a sighting - the sighting itself (JSONB), the verdict
 *   ('match' | 'differs' | 'unreadable'), and, only when they differ, both answers and the first
 *   few differing lines. Rows are deleted after KEEP_DAYS (30) - this is working data for
 *   re-reading and repair, not a second copy of the client's records.
 *
 * Who is included is decided in content/extension-policy.json ("rawCapture.clients"), read through
 * services/extensionPolicy.wantsSeen - so the soak starts on Guy's machine alone and widens with a
 * deploy, never an extension release.
 *
 * A difference emails Guy at most once a day (the soak's signal). Reading the results:
 *   select verdict, count(*) from wingguy_capture_raw group by 1;
 *   select created_at, client_id, lead_id, diffs from wingguy_capture_raw where verdict <> 'match' order by 1 desc;
 *
 * House style: extensionDistStore.js - lazy Pool, CREATE IF NOT EXISTS, no migrations, blank
 * DATABASE_URL is not an error. Tested by tests/capture-shadow.test.js.
 */
const { Pool } = require('pg');
const { createSafeLogger } = require('../utils/loggerHelper');
const { serverReading, compareContent } = require('../utils/threadReader');

const log = createSafeLogger('SYSTEM', null, 'capture_shadow');

const KEEP_DAYS = 30;
const MAX_SIGHTING_BYTES = 600 * 1024;   // the extension caps itself well below this
const PRUNE_EVERY_MS = 24 * 60 * 60 * 1000;
const ALERT_EVERY_MS = 24 * 60 * 60 * 1000;

let pool;
let schemaEnsured = false;
let prunedAt = 0;
let alertedAt = 0;

function getPool() {
  const url = (process.env.DATABASE_URL || '').trim();
  if (!url) return null;
  if (!pool) pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });
  return pool;
}

async function ensureSchema(client) {
  if (schemaEnsured) return;
  await client.query(`
    CREATE TABLE IF NOT EXISTS wingguy_capture_raw (
      id                BIGSERIAL PRIMARY KEY,
      client_id         TEXT        NOT NULL,
      lead_id           TEXT,
      extension_version TEXT,
      verdict           TEXT        NOT NULL,
      reason            TEXT,
      seen              JSONB,
      extension_content TEXT,
      server_content    TEXT,
      diffs             JSONB,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await client.query('CREATE INDEX IF NOT EXISTS wingguy_capture_raw_created_idx ON wingguy_capture_raw (created_at)');
  schemaEnsured = true;
}

/**
 * The judgement, with no I/O: read the sighting, compare with what the extension sent.
 * @returns {{verdict:'match'|'differs'|'unreadable', reason?:string, serverContent?:string, diffs?:Array}}
 */
function judge({ seen, extensionContent, now } = {}) {
  let size = 0;
  try { size = JSON.stringify(seen || null).length; } catch (_) { return { verdict: 'unreadable', reason: 'sighting is not plain data' }; }
  if (size > MAX_SIGHTING_BYTES) return { verdict: 'unreadable', reason: `sighting too big (${size} bytes)` };
  let reading;
  try { reading = serverReading(seen, { now }); } catch (e) { return { verdict: 'unreadable', reason: `server reader threw: ${e.message}` }; }
  if (!reading.ok) return { verdict: 'unreadable', reason: reading.reason };
  const cmp = compareContent(extensionContent, reading.content);
  return { verdict: cmp.verdict, serverContent: reading.content, diffs: cmp.diffs };
}

/** The once-a-day email to Guy when the two readings differ. Plain data in, plain strings out. */
function differsEmail({ clientId, leadName, leadId, extensionVersion, diffs = [] }) {
  const who = leadName || leadId || 'a lead';
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const rows = diffs.map((d) => `line ${d.line}\n  extension: ${d.extension}\n  server:    ${d.server}`).join('\n\n');
  const text = [
    `The server read ${who}'s LinkedIn conversation differently from the extension (${clientId}, extension ${extensionVersion || 'unknown'}).`,
    '',
    'Nothing is wrong on the record - the extension\'s reading was saved as usual. This is the trial run of the server doing the reading, and a difference is what it is there to find.',
    '',
    'First differences:',
    rows || '(none listed)',
    '',
    'Only one of these emails is sent per day. Every difference is kept in wingguy_capture_raw for 30 days.',
  ].join('\n');
  return {
    subject: `Wingguy trial: server and extension read ${who}'s conversation differently`,
    text,
    html: `<pre style="font-family:inherit;white-space:pre-wrap">${esc(text)}</pre>`,
  };
}

/**
 * Record one save's sighting and verdict. Never throws; resolves to the verdict (or null when
 * there was nothing to do).
 * @param {Object} args
 * @param {string} args.clientId
 * @param {string} [args.leadId]
 * @param {string} [args.leadName]
 * @param {string} [args.extensionVersion]
 * @param {Object} args.seen               the sighting from the extension
 * @param {string} args.extensionContent   the extension's own answer (what was saved)
 * @param {Function} [args.sendAlert]      (subject, html, recipient, options) => Promise - injected by the route
 */
async function recordSighting({ clientId, leadId, leadName, extensionVersion, seen, extensionContent, sendAlert, now } = {}) {
  if (!clientId || !seen) return null;
  let result;
  try {
    result = judge({ seen, extensionContent, now });
  } catch (e) {
    log.warn(`capture shadow: judging failed (${clientId}, lead ${leadId}): ${e.message}`);
    return null;
  }
  if (result.verdict === 'differs') {
    const first = result.diffs[0];
    log.warn(`capture shadow: server and extension differ for lead ${leadId} (${clientId}, ext ${extensionVersion || '?'}) - line ${first.line}: extension "${first.extension}" / server "${first.server}"`);
    if (typeof sendAlert === 'function' && Date.now() - alertedAt > ALERT_EVERY_MS) {
      alertedAt = Date.now();
      const mail = differsEmail({ clientId, leadName, leadId, extensionVersion, diffs: result.diffs });
      Promise.resolve(sendAlert(mail.subject, mail.html, null, { text: mail.text })).catch((e) => log.warn(`capture shadow: alert email failed: ${e.message}`));
    }
  } else if (result.verdict === 'unreadable') {
    log.warn(`capture shadow: could not read the sighting for lead ${leadId} (${clientId}): ${result.reason}`);
  }

  const p = getPool();
  if (!p) return result.verdict;
  let client;
  try {
    client = await p.connect();
    await ensureSchema(client);
    const differs = result.verdict === 'differs';
    // An unreadable sighting that is too big is not kept whole - the reason says what happened.
    const keepSeen = !(result.verdict === 'unreadable' && /too big|not plain data/.test(result.reason || ''));
    await client.query(
      `INSERT INTO wingguy_capture_raw (client_id, lead_id, extension_version, verdict, reason, seen, extension_content, server_content, diffs)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        String(clientId), leadId ? String(leadId) : null, extensionVersion ? String(extensionVersion).slice(0, 40) : null,
        result.verdict, result.reason || null,
        keepSeen ? JSON.stringify(seen) : null,
        differs ? String(extensionContent || '') : null,
        differs ? result.serverContent : null,
        differs ? JSON.stringify(result.diffs) : null,
      ]
    );
    if (Date.now() - prunedAt > PRUNE_EVERY_MS) {
      prunedAt = Date.now();
      await client.query(`DELETE FROM wingguy_capture_raw WHERE created_at < now() - interval '${KEEP_DAYS} days'`);
    }
  } catch (e) {
    log.warn(`capture shadow: write failed (${clientId}, lead ${leadId}): ${e.message}`);
  } finally {
    if (client) client.release();
  }
  return result.verdict;
}

function _resetForTests() { alertedAt = 0; prunedAt = 0; }

module.exports = { recordSighting, judge, differsEmail, KEEP_DAYS, MAX_SIGHTING_BYTES, _resetForTests };
