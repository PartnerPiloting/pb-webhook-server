/**
 * Overnight fill-in for a contact made into a lead (Guy, 27 Nov 2026).
 *
 * WHY: "Make this contact a lead" creates the lead from what the contact had - a name, a LinkedIn
 * address, maybe an email. That is a LIGHT lead: no About section, no job history, no score. A lead
 * a Linked Helper campaign sent is RICH, because Linked Helper opened the profile. Guy's point: the
 * two should not stay mixed. So a promoted contact with a LinkedIn address is noted here, and the
 * client's Linked Helper machine collects the note on its nightly "My own connections" run
 * (scripts/linked-helper/lh-own-connections.py), visits the profile and sends it through the usual
 * webhook - by morning the lead has the full picture and is in the scoring queue
 * (services/leadService.js queues a never-profiled lead for scoring when its profile arrives).
 *
 * RULES:
 *   - the note is ALWAYS kept (any client), so a machine switched on later clears the backlog;
 *   - it is only ever HANDED to a machine the nightly collection is on for
 *     (leadCampaign.OWN_CONNECTIONS_ARRIVE) - and `willFill` in the answer says so, so nothing on
 *     screen promises a fill-in that will not happen;
 *   - one note per client + LinkedIn address; asking twice changes nothing;
 *   - handed over only once: the machine confirms (markQueued) and the note stops being offered;
 *   - recording a note can never fail the add - callers swallow errors.
 *
 * Same door shape as the Reconnect removals (services/reconnectDisconnects.js): GET hands the list
 * over, POST { queued: [...] } confirms.
 */

const { canonicalLinkedinSlug } = require('../utils/linkedinCanonical');

const HAND_OVER_MAX = 50;      // most notes handed to a machine in one night (its own cap is far lower)

let schemaReady = false;
async function ensureSchema(pool) {
  if (schemaReady) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS lead_fill_ins (
      tenant_id TEXT NOT NULL,
      slug TEXT NOT NULL,
      lead_rec_id TEXT,
      requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      queued_at TIMESTAMPTZ,
      PRIMARY KEY (tenant_id, slug)
    )`);
  schemaReady = true;
}

async function db(deps = {}) {
  const pool = deps.pool !== undefined ? deps.pool : require('./reconnectQueue')._getPool();
  if (!pool) return null;
  if (deps.pool === undefined) await ensureSchema(pool);
  return pool;
}

const arrives = (clientId, deps = {}) => (deps.leadCampaign || require('./leadCampaign')).ownConnectionsArrive(clientId);

/**
 * Note that this lead wants its profile fetched. Returns { ok, noted, willFill }.
 * willFill = this client's machine really will collect it (the nightly collection is on for them).
 */
async function request(clientId, linkedin, leadRecordId, { deps = {} } = {}) {
  const slug = canonicalLinkedinSlug(linkedin);
  if (!clientId || !slug) return { ok: true, noted: false, willFill: false };
  const pool = await db(deps);
  if (!pool) return { ok: false, noted: false, willFill: false, error: 'store_unavailable' };
  await pool.query(
    `INSERT INTO lead_fill_ins (tenant_id, slug, lead_rec_id) VALUES ($1, $2, $3)
     ON CONFLICT (tenant_id, slug) DO NOTHING`,
    [String(clientId), slug, leadRecordId || null]
  );
  return { ok: true, noted: true, willFill: arrives(clientId, deps) };
}

/** What the client's machine collects: profile links not yet handed over, oldest request first. */
async function pendingForMachine(client, { deps = {} } = {}) {
  const clientId = client && client.clientId;
  if (!clientId || !arrives(clientId, deps)) return [];
  const pool = await db(deps);
  if (!pool) return [];
  const r = await pool.query(
    `SELECT slug FROM lead_fill_ins WHERE tenant_id = $1 AND queued_at IS NULL ORDER BY requested_at, slug LIMIT ${HAND_OVER_MAX}`,
    [String(clientId)]
  );
  return r.rows.map((x) => ({ slug: x.slug, link: `https://www.linkedin.com/in/${x.slug}/` }));
}

/** The machine confirming which people it has put in its "My own connections" campaign. */
async function markQueued(clientId, slugs = [], { deps = {} } = {}) {
  const list = [...new Set((Array.isArray(slugs) ? slugs : []).map((s) => canonicalLinkedinSlug(s)).filter(Boolean))].slice(0, 500);
  if (!clientId || !list.length) return { ok: true, count: 0 };
  const pool = await db(deps);
  if (!pool) return { ok: false, error: 'store_unavailable' };
  const r = await pool.query(
    `UPDATE lead_fill_ins SET queued_at = now() WHERE tenant_id = $1 AND slug = ANY($2) AND queued_at IS NULL`,
    [String(clientId), list]
  );
  return { ok: true, count: r.rowCount || 0 };
}

/** Offboarding: a leaving client's notes go with them. */
async function forgetClient(clientId, { deps = {} } = {}) {
  const pool = await db(deps);
  if (!pool || !clientId) return { ok: false, count: 0 };
  const r = await pool.query('DELETE FROM lead_fill_ins WHERE tenant_id = $1', [String(clientId)]);
  return { ok: true, count: r.rowCount || 0 };
}

module.exports = { request, pendingForMachine, markQueued, forgetClient, HAND_OVER_MAX };
