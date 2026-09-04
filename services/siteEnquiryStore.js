// services/siteEnquiryStore.js
//
// Durable store for the two things the public site captures:
//   'enquiry'   — someone filled in "Let's have a chat"
//   'subscribe' — someone asked for the series by email
//
// Both land in ONE table with a `kind` column: they carry the same fields,
// they're read together ("who came in this week?"), and a subscriber who later
// books a call is the same person. Splitting them would mean joining them back.
//
// Storage is deliberately belt-and-braces: the row is written FIRST and the
// notification email sent after. If Gmail is down, or the OAuth token has
// expired, the enquiry is still on disk — losing a warm inbound because a mail
// API blipped would be the worst possible failure here.
//
// House style follows recallWebhookDb.js / wingguyRulesStore.js: lazy Pool,
// ensureSchema with CREATE-IF-NOT-EXISTS, no migration framework.

const crypto = require('crypto');
const { Pool } = require('pg');
const { createLogger } = require('../utils/contextLogger');

const logger = createLogger({ runId: 'SYSTEM', clientId: 'SYSTEM', operation: 'site_enquiry' });

const KINDS = ['enquiry', 'subscribe'];

let pool;
let schemaEnsured = false;

function getPool() {
  if (pool) return pool;
  const url = (process.env.DATABASE_URL || '').trim();
  if (!url) return null;
  pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });
  return pool;
}

/** Test seam: inject a fake pool (unit tests never touch a real database). */
function __setTestPool(fake) {
  pool = fake;
  schemaEnsured = !!fake;
}

async function ensureSchema(client) {
  if (schemaEnsured) return;
  await client.query(`
    CREATE TABLE IF NOT EXISTS site_enquiries (
      id BIGSERIAL PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      kind TEXT NOT NULL CHECK (kind IN ('enquiry','subscribe')),
      name TEXT,
      email TEXT NOT NULL,
      referrer TEXT,
      note TEXT,
      source_page TEXT,
      user_agent TEXT,
      notified_at TIMESTAMPTZ,
      unsubscribed_at TIMESTAMPTZ
    );
  `);
  // The send job will ask "who is still subscribed?" — index for that read.
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_site_enquiries_live
    ON site_enquiries (kind, created_at) WHERE unsubscribed_at IS NULL;
  `);
  // One live subscription per address. Enquiries are NOT deduped: a second
  // enquiry from the same person is a real event Guy needs to see.
  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_site_enquiries_one_sub
    ON site_enquiries (lower(email)) WHERE kind = 'subscribe' AND unsubscribed_at IS NULL;
  `);

  // Drip state. Added after the fact, hence ADD COLUMN IF NOT EXISTS rather
  // than a migration - house style is no migration framework.
  //   sent_count   how many emails of their run they have had (0 = none yet).
  //                onePagerEmail.resolveItem() turns this into "what's next".
  //   last_sent_at drives the weekly cadence.
  //   unsub_token  unguessable, per-subscriber, so an unsubscribe link needs no
  //                login and cannot be used to unsubscribe anyone else by
  //                guessing an email address.
  await client.query(`ALTER TABLE site_enquiries ADD COLUMN IF NOT EXISTS sent_count INT NOT NULL DEFAULT 0;`);
  await client.query(`ALTER TABLE site_enquiries ADD COLUMN IF NOT EXISTS last_sent_at TIMESTAMPTZ;`);
  await client.query(`ALTER TABLE site_enquiries ADD COLUMN IF NOT EXISTS unsub_token TEXT;`);
  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_site_enquiries_token
    ON site_enquiries (unsub_token) WHERE unsub_token IS NOT NULL;
  `);
  schemaEnsured = true;
}

function newToken() {
  return crypto.randomBytes(24).toString('base64url');
}

function cleanText(v, max) {
  if (v === undefined || v === null) return null;
  const s = String(v).replace(/\s+/g, ' ').trim();
  if (!s) return null;
  return s.slice(0, max);
}

// Permissive on purpose. A rejected valid address costs a real lead; a junk
// address costs one useless row. Fail toward accepting.
function cleanEmail(v) {
  const s = cleanText(v, 320);
  if (!s) return null;
  return /^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(s) ? s.toLowerCase() : null;
}

/**
 * Record an enquiry or a subscription.
 * Returns { ok, id, duplicate, error }. Never throws — the caller is a public
 * web form and must always be able to answer the visitor.
 */
async function record({ kind, name, email, referrer, note, sourcePage, userAgent } = {}) {
  if (!KINDS.includes(kind)) return { ok: false, error: 'unknown kind' };

  const cleanedEmail = cleanEmail(email);
  if (!cleanedEmail) return { ok: false, error: 'a valid email address is required' };

  const p = getPool();
  if (!p) {
    logger.error('[site] DATABASE_URL not set — enquiry cannot be stored');
    return { ok: false, error: 'storage unavailable' };
  }

  let client;
  try {
    client = await p.connect();
    await ensureSchema(client);
    const res = await client.query(
      `INSERT INTO site_enquiries (kind, name, email, referrer, note, source_page, user_agent, unsub_token)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [
        kind,
        cleanText(name, 200),
        cleanedEmail,
        cleanText(referrer, 200),
        cleanText(note, 4000),
        cleanText(sourcePage, 300),
        cleanText(userAgent, 400),
        newToken(),
      ],
    );
    // No row back = the unique index caught an already-live subscription.
    // That's a success from the visitor's point of view, not an error.
    if (!res.rows.length) return { ok: true, duplicate: true };
    return { ok: true, id: res.rows[0].id };
  } catch (err) {
    logger.error(`[site] failed to store ${kind}: ${err && err.message}`);
    return { ok: false, error: 'could not be saved' };
  } finally {
    if (client) client.release();
  }
}

async function markNotified(id) {
  const p = getPool();
  if (!p || !id) return;
  try {
    await p.query('UPDATE site_enquiries SET notified_at = now() WHERE id = $1', [id]);
  } catch (err) {
    logger.warn(`[site] could not stamp notified_at for ${id}: ${err && err.message}`);
  }
}

/** Live subscribers, oldest first — what the drip send will read. */
async function listSubscribers() {
  const p = getPool();
  if (!p) return [];
  let client;
  try {
    client = await p.connect();
    await ensureSchema(client);
    const res = await client.query(
      `SELECT id, created_at, name, email FROM site_enquiries
       WHERE kind = 'subscribe' AND unsubscribed_at IS NULL
       ORDER BY created_at ASC`,
    );
    return res.rows;
  } catch (err) {
    logger.error(`[site] could not list subscribers: ${err && err.message}`);
    return [];
  } finally {
    if (client) client.release();
  }
}

/**
 * Who is due their next email right now.
 *
 * Due = subscribed, not unsubscribed, hasn't finished the run, and either has
 * never been sent to or was last sent to more than `cadenceDays` ago.
 *
 * `limit` is the warm-up lever: a brand-new sending domain that suddenly posts
 * hundreds of messages looks exactly like a compromised one, so early runs stay
 * small deliberately.
 */
async function dueSubscribers({ cadenceDays = 7, maxEmails = 19, limit = 50 } = {}) {
  const p = getPool();
  if (!p) return [];
  let client;
  try {
    client = await p.connect();
    await ensureSchema(client);
    const res = await client.query(
      `SELECT id, email, name, sent_count, unsub_token, last_sent_at
         FROM site_enquiries
        WHERE kind = 'subscribe'
          AND unsubscribed_at IS NULL
          AND sent_count < $1
          AND (last_sent_at IS NULL OR last_sent_at < now() - ($2 || ' days')::interval)
        ORDER BY last_sent_at NULLS FIRST, created_at ASC
        LIMIT $3`,
      [maxEmails, String(cadenceDays), limit],
    );
    return res.rows;
  } catch (err) {
    logger.error(`[site] could not read due subscribers: ${err && err.message}`);
    return [];
  } finally {
    if (client) client.release();
  }
}

/**
 * Record that one email went out. Conditional on sent_count still being what we
 * read, so two overlapping runs can never send the same person the same piece
 * twice — the second update simply matches no rows.
 */
async function markSent(id, expectedSentCount) {
  const p = getPool();
  if (!p) return false;
  try {
    const res = await p.query(
      `UPDATE site_enquiries
          SET sent_count = sent_count + 1, last_sent_at = now()
        WHERE id = $1 AND sent_count = $2
        RETURNING sent_count`,
      [id, expectedSentCount],
    );
    return res.rows.length > 0;
  } catch (err) {
    logger.error(`[site] could not mark sent for ${id}: ${err && err.message}`);
    return false;
  }
}

/** One-click unsubscribe. Returns the email so we can confirm it on the page. */
async function unsubscribeByToken(token) {
  const t = String(token || '').trim();
  const p = getPool();
  if (!p || !t) return { ok: false };
  let client;
  try {
    client = await p.connect();
    await ensureSchema(client);
    const res = await client.query(
      `UPDATE site_enquiries SET unsubscribed_at = now()
        WHERE unsub_token = $1 AND kind = 'subscribe'
        RETURNING email, unsubscribed_at`,
      [t],
    );
    // Already-unsubscribed is still a success from the person's point of view -
    // they clicked to be off the list and they are off the list.
    if (!res.rows.length) return { ok: false };
    return { ok: true, email: res.rows[0].email };
  } catch (err) {
    logger.error(`[site] unsubscribe by token failed: ${err && err.message}`);
    return { ok: false };
  } finally {
    if (client) client.release();
  }
}

async function unsubscribe(email) {
  const cleaned = cleanEmail(email);
  const p = getPool();
  if (!p || !cleaned) return { ok: false };
  try {
    await p.query(
      `UPDATE site_enquiries SET unsubscribed_at = now()
       WHERE kind = 'subscribe' AND lower(email) = $1 AND unsubscribed_at IS NULL`,
      [cleaned],
    );
    return { ok: true };
  } catch (err) {
    logger.error(`[site] unsubscribe failed: ${err && err.message}`);
    return { ok: false };
  }
}

module.exports = {
  record, markNotified, listSubscribers, unsubscribe,
  dueSubscribers, markSent, unsubscribeByToken,
  cleanEmail, __setTestPool, KINDS,
};
