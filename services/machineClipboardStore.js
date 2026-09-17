/**
 * Machine clipboard - a one-item outbox per client machine.
 *
 * WHY THIS EXISTS (Rick Wong, 17 Sep 2026): you cannot paste from your own laptop into a client's
 * Linked Helper machine. Not a missing setting - a consequence of how the machines are built.
 * The desktop is ONE always-on screen (x11vnc on :0) so Linked Helper keeps running with nobody
 * connected and Guy and the client see the same thing; xrdp bridges onto that screen rather than
 * starting a session of its own, and the clipboard only travels on a session of its own. Every
 * clipboard setting on the machine is already correct and always was. Rick's closing words on
 * that call: "You've got to fix that ability to cut and paste."
 *
 * So the text goes the other way round: it is left here, and the machine's own agent
 * (scripts/linked-helper/lh-clipboard.py) collects it and puts it on the machine's clipboard.
 * The person looking at the screen hits Ctrl+V. Nothing is installed on anybody's laptop.
 *
 * ONE ITEM, LATEST WINS. Not a queue: a clipboard holds one thing, and a person who sends twice
 * means "no, this one". A queue would paste the stale one first, which is worse than useless when
 * the point is to hand someone a URL mid-call.
 *
 * TENANT SAFETY IS STRUCTURAL. Rows are keyed by client id, and the machine authenticates with
 * the per-client 'Machine Report Secret' before it can read one. A machine can therefore only
 * ever collect its OWN client's text - there is no code path that could hand Rick's URL to
 * Julian's screen. That guard is deliberate: the LH webhook crossed tenants once already
 * (project_lh_webhook_cross_tenant_incident) and a clipboard carries passwords.
 *
 * EVERYTHING EXPIRES. Unread text is dead after TTL_MINUTES - a clipboard item nobody collected
 * is a person who gave up and did it another way, and it must not surface days later when they
 * next connect. Collected items are deleted on read, not tombstoned: the whole point is that it
 * does not linger on our server.
 *
 * House style: recallWebhookDb.js - lazy Pool, ensureSchema CREATE-IF-NOT-EXISTS, no migrations.
 * A blank DATABASE_URL is not an error here: no database means no clipboard, and the machines
 * carry on doing their real job.
 */

const { Pool } = require('pg');
const { createSafeLogger } = require('../utils/loggerHelper');

const log = createSafeLogger('SYSTEM', null, 'machine_clipboard');

/** How long unread text lives. Long enough to walk someone through a step, short enough that a
 *  forgotten paste never turns up in a later session. */
const TTL_MINUTES = 30;

/** Generous for a search URL or a config line, far short of "someone pasted a document". */
const MAX_CHARS = 8000;

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
    CREATE TABLE IF NOT EXISTS wingguy_machine_clipboard (
      client_id  TEXT        PRIMARY KEY,
      body       TEXT        NOT NULL,
      sent_by    TEXT,
      sent_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  schemaEnsured = true;
}

/** Trim to something a clipboard should hold, and say so rather than silently truncating. */
function normalise(text) {
  const body = String(text === undefined || text === null ? '' : text);
  if (!body.trim()) throw new Error('nothing to send - the text is empty');
  if (body.length > MAX_CHARS) {
    throw new Error(`that is ${body.length} characters; the machine clipboard takes up to ${MAX_CHARS}`);
  }
  return body;
}

/**
 * Leave text for a client's machine to collect. Replaces anything already waiting.
 * Returns { ok, chars } or throws with a reason worth showing a human.
 */
async function putForMachine(clientId, text, sentBy = null) {
  const id = String(clientId || '').trim();
  if (!id) throw new Error('no client id');
  const body = normalise(text);

  const p = getPool();
  if (!p) throw new Error('no database configured - the machine clipboard is unavailable');

  const client = await p.connect();
  try {
    await ensureSchema(client);
    await client.query(
      `INSERT INTO wingguy_machine_clipboard (client_id, body, sent_by, sent_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (client_id) DO UPDATE
         SET body = EXCLUDED.body, sent_by = EXCLUDED.sent_by, sent_at = now()`,
      [id, body, sentBy ? String(sentBy).slice(0, 80) : null],
    );
  } finally {
    client.release();
  }
  log.info(`MACHINE-CLIPBOARD queued ${body.length} chars for ${id}`);
  return { ok: true, chars: body.length };
}

/**
 * The machine collecting its own text. Deletes as it reads - one collection, then it is gone.
 * Returns the body string, or null when there is nothing waiting (the overwhelmingly common case,
 * so this stays cheap).
 */
async function takeForMachine(clientId) {
  const id = String(clientId || '').trim();
  if (!id) return null;
  const p = getPool();
  if (!p) return null;

  const client = await p.connect();
  try {
    await ensureSchema(client);
    const { rows } = await client.query(
      `DELETE FROM wingguy_machine_clipboard
        WHERE client_id = $1
          AND sent_at > now() - ($2 || ' minutes')::interval
        RETURNING body`,
      [id, String(TTL_MINUTES)],
    );
    // Sweep anything of this client's that timed out, so a stale row cannot sit forever.
    await client.query(
      `DELETE FROM wingguy_machine_clipboard
        WHERE client_id = $1 AND sent_at <= now() - ($2 || ' minutes')::interval`,
      [id, String(TTL_MINUTES)],
    );
    return rows.length ? rows[0].body : null;
  } catch (e) {
    log.error(`MACHINE-CLIPBOARD read failed for ${id}: ${e.message}`);
    return null;
  } finally {
    client.release();
  }
}

/** Is something waiting, and how old - for telling a human "it has not been collected yet". */
async function peekForMachine(clientId) {
  const id = String(clientId || '').trim();
  const p = getPool();
  if (!id || !p) return null;
  const client = await p.connect();
  try {
    await ensureSchema(client);
    const { rows } = await client.query(
      `SELECT length(body) AS chars, sent_at, sent_by
         FROM wingguy_machine_clipboard
        WHERE client_id = $1
          AND sent_at > now() - ($2 || ' minutes')::interval`,
      [id, String(TTL_MINUTES)],
    );
    return rows.length ? rows[0] : null;
  } catch (_e) {
    return null;
  } finally {
    client.release();
  }
}

module.exports = { putForMachine, takeForMachine, peekForMachine, TTL_MINUTES, MAX_CHARS };
