/**
 * Bring your connections in from a search - the server end (docs/CONNECTIONS-SEARCH-BUILD-PLAN.md,
 * planned with Guy 27-28 Nov 2026; this file is step 1 of the build).
 *
 * WHAT IT DOES: a client searches their OWN LinkedIn connections (1st degree, narrowed by title,
 * place, industry...), pastes the link with one sentence on WHY they want these people and,
 * optionally, a link to share with the ones who are interested. This keeps that search: the link,
 * the reason, the share link, and (from step 2) the people it brought in. Overnight the client's
 * Linked Helper machine collects the search and visits each person - no invite, no message - so they
 * arrive as full leads; they then show in the Reconnect list and /wg uses the reason for its ask.
 *
 * THE LINES GUY HELD (27-28 Nov 2026):
 *   - the machine collects and visits, it NEVER messages;
 *   - the share link waits for a yes - there is no "link in the first message" switch;
 *   - a search must be narrowed (utils/linkedinSearchUrl.js ownConnectionsCheck);
 *   - one person, one row: a person in two searches keeps the FIRST search's reason (UNIQUE slug).
 *
 * WHO HAS IT: CONNECTION_SEARCH_CLIENTS (comma list of client ids, '*' = everyone). Default = the
 * owner only, until the machine side (step 2) is proven on Guy's machine. A client not on the list
 * is told plainly it isn't switched on for them yet - nothing is saved that no machine will act on.
 *
 * STATUS of a search: waiting (saved; no machine has taken it yet) -> collecting -> done | failed.
 * Several searches may wait at once; the machine takes them one at a time (step 2).
 *
 * House style: leadFillIns.js - the Reconnect pool, CREATE-IF-NOT-EXISTS, no migrations.
 */

const { canonicalLinkedinSlug } = require('../utils/linkedinCanonical');

const REASON_MIN = 8;
const REASON_MAX = 300;
const LINK_MAX = 500;

function gateList() {
  const raw = (process.env.CONNECTION_SEARCH_CLIENTS || process.env.WINGGUY_PLATFORM_OWNER || 'Guy-Wilson');
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}
/** Is bringing connections in from a search switched on for this client? */
function enabledFor(clientId) {
  const list = gateList();
  return list.includes('*') || list.includes(String(clientId || ''));
}

let schemaReady = false;
async function ensureSchema(pool) {
  if (schemaReady) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS connection_searches (
      search_id    TEXT        PRIMARY KEY,
      client_id    TEXT        NOT NULL,
      url          TEXT        NOT NULL,
      url_kind     TEXT,
      reason       TEXT        NOT NULL,
      share_link   TEXT,
      requested_by TEXT,
      status       TEXT        NOT NULL DEFAULT 'waiting',
      collected    INTEGER,
      detail       JSONB,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      finished_at  TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS connection_searches_client ON connection_searches (client_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS connection_search_people (
      client_id    TEXT        NOT NULL,
      slug         TEXT        NOT NULL,
      search_id    TEXT        NOT NULL,
      lead_rec_id  TEXT,
      status       TEXT        NOT NULL DEFAULT 'waiting',
      added_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
      shown_on     DATE,
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (client_id, slug)
    );
    CREATE INDEX IF NOT EXISTS connection_search_people_search ON connection_search_people (search_id);
  `);
  schemaReady = true;
}

async function db(deps = {}) {
  const pool = deps.pool !== undefined ? deps.pool : require('./reconnectQueue')._getPool();
  if (!pool) return null;
  if (deps.pool === undefined) await ensureSchema(pool);
  return pool;
}

const newSearchId = () => `cs${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

/** The reason, tidied - or { problem } in words for the person who typed it. */
function cleanReason(raw) {
  const reason = String(raw || '').replace(/\s+/g, ' ').trim();
  if (!reason) return { problem: 'Why are you reaching out to these people? One sentence is enough - for example "CEOs I\'d like to tell about our leadership programme". Wingguy uses it to end each first message with a small ask that fits.' };
  if (reason.length < REASON_MIN) return { problem: 'Say a little more about why you want these people - one full sentence, for example "CEOs I\'d like to tell about our leadership programme".' };
  return { reason: reason.slice(0, REASON_MAX) };
}

/**
 * The share link, checked - or { problem }. Empty is fine (it is optional). A RETIRED asset's
 * address is refused here, the same ban the email draft door applies (wingguyMailMcp findRetiredUrls).
 */
async function cleanShareLink(raw, clientId, deps = {}) {
  let link = String(raw || '').trim();
  if (!link) return { link: null };
  if (/\s/.test(link)) return { problem: 'The link to share should be one web address on its own - copy it from the address bar.' };
  if (!/^https?:\/\//i.test(link)) link = `https://${link}`;
  let u;
  try { u = new URL(link); } catch (_e) { return { problem: 'That link to share is not a web address I can read - copy it from the address bar.' }; }
  if (!/\./.test(u.hostname)) return { problem: 'That link to share is not a web address I can read - copy it from the address bar.' };
  if (/linkedin\.com\/(search|sales)\//i.test(link)) return { problem: 'The link to share is the page you want interested people to see (your programme, your website) - not a LinkedIn search. Put the search in the first box.' };
  if (link.length > LINK_MAX) return { problem: 'That link to share is very long - use the page\'s normal address.' };
  try {
    const getAssets = deps.getAssets || require('./wingguyRulesStore').getAssets;
    const findRetired = deps.findRetiredUrls || require('./wingguyMailMcp').findRetiredUrls;
    const hits = findRetired(link, await getAssets({ tenantId: clientId }));
    if (hits && hits.length) return { problem: `That link to share is one you have retired (${hits[0].assetKey}) - it points somewhere you no longer use. Use the current one.` };
  } catch (_e) { /* the asset library being unreachable never blocks the search */ }
  return { link };
}

/**
 * Save a search. The caller has already checked the link (ownConnectionsCheck). Searches do NOT
 * replace each other - a CEO search and an accountants search are both kept, and the machine takes
 * them one at a time (step 2). The SAME link pasted again while it is still waiting updates that
 * search's reason and link instead of adding a second copy. One statement each way, so a failure
 * never loses a search that was already saved (review 28 Nov 2026).
 * Returns { ok, searchId, updated } or { ok:false, error }.
 */
async function saveSearch({ clientId, url, urlKind, reason, shareLink = null, requestedBy = null }, { deps = {} } = {}) {
  const id = String(clientId || '').trim();
  if (!id || !url || !reason) return { ok: false, error: 'missing client, link or reason' };
  const pool = await db(deps);
  if (!pool) return { ok: false, error: 'no database configured - searches cannot be saved' };
  const same = await pool.query(
    `UPDATE connection_searches SET reason = $3, share_link = $4, updated_at = now()
      WHERE client_id = $1 AND url = $2 AND status = 'waiting' RETURNING search_id`,
    [id, String(url), String(reason), shareLink || null]);
  if (same.rows && same.rows[0]) return { ok: true, searchId: same.rows[0].search_id, updated: true };
  const searchId = newSearchId();
  await pool.query(
    `INSERT INTO connection_searches (search_id, client_id, url, url_kind, reason, share_link, requested_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [searchId, id, String(url), urlKind || null, String(reason), shareLink || null, requestedBy ? String(requestedBy).slice(0, 80) : null]);
  return { ok: true, searchId, updated: false };
}

function rowOut(r) {
  if (!r) return null;
  return {
    searchId: r.search_id, clientId: r.client_id, url: r.url, urlKind: r.url_kind, reason: r.reason,
    shareLink: r.share_link || '', requestedBy: r.requested_by, status: r.status,
    collected: r.collected === null || r.collected === undefined ? null : Number(r.collected),
    detail: r.detail || {}, createdAt: r.created_at, updatedAt: r.updated_at, finishedAt: r.finished_at,
  };
}

/** Their searches, newest first. */
async function listFor(clientId, { limit = 10, deps = {} } = {}) {
  const pool = await db(deps);
  if (!pool || !clientId) return [];
  const r = await pool.query(
    `SELECT * FROM connection_searches WHERE client_id = $1
      ORDER BY created_at DESC LIMIT ${Math.max(1, Math.min(50, Number(limit) || 10))}`, [String(clientId)]);
  return r.rows.map(rowOut);
}

/**
 * Step 2 (the machine reports who a search brought in). One person, one row: someone already
 * tied to an earlier search keeps that search's reason. Only ever against a search of THIS client's
 * - a search id from another client adds nobody. Returns { ok, added }.
 */
async function recordPeople(clientId, searchId, slugs = [], { deps = {} } = {}) {
  const list = [...new Set((Array.isArray(slugs) ? slugs : []).map((s) => canonicalLinkedinSlug(s)).filter(Boolean))].slice(0, 5000);
  if (!clientId || !searchId || !list.length) return { ok: true, added: 0 };
  const pool = await db(deps);
  if (!pool) return { ok: false, added: 0, error: 'store_unavailable' };
  const r = await pool.query(
    `INSERT INTO connection_search_people (client_id, slug, search_id)
     SELECT $1, s, $2 FROM unnest($3::text[]) AS s
      WHERE EXISTS (SELECT 1 FROM connection_searches WHERE search_id = $2 AND client_id = $1)
     ON CONFLICT (client_id, slug) DO NOTHING`, [String(clientId), String(searchId), list]);
  return { ok: true, added: r.rowCount || 0 };
}

/**
 * Step 4 (/wg): why the client picked this person, and the link they want shared - or null.
 */
async function reasonFor(clientId, linkedin, { deps = {} } = {}) {
  const slug = canonicalLinkedinSlug(linkedin);
  if (!clientId || !slug) return null;
  const pool = await db(deps);
  if (!pool) return null;
  const r = await pool.query(
    `SELECT s.search_id, s.reason, s.share_link FROM connection_search_people p
       JOIN connection_searches s ON s.search_id = p.search_id AND s.client_id = p.client_id
      WHERE p.client_id = $1 AND p.slug = $2`, [String(clientId), slug]);
  const row = r.rows[0];
  return row ? { searchId: row.search_id, reason: row.reason, shareLink: row.share_link || '' } : null;
}

/** Offboarding plan: how many searches and people are held for this client (0 = nothing to do). */
async function countFor(clientId, { deps = {} } = {}) {
  const pool = await db(deps);
  if (!pool || !clientId) return { searches: 0, people: 0 };
  const a = await pool.query('SELECT count(*)::int AS n FROM connection_searches WHERE client_id = $1', [String(clientId)]);
  const b = await pool.query('SELECT count(*)::int AS n FROM connection_search_people WHERE client_id = $1', [String(clientId)]);
  return { searches: (a.rows[0] || {}).n || 0, people: (b.rows[0] || {}).n || 0 };
}

/** Offboarding: a leaving client's searches and people go with them. */
async function forgetClient(clientId, { deps = {} } = {}) {
  const pool = await db(deps);
  if (!pool || !clientId) return { ok: false, count: 0 };
  const a = await pool.query('DELETE FROM connection_search_people WHERE client_id = $1', [String(clientId)]);
  const b = await pool.query('DELETE FROM connection_searches WHERE client_id = $1', [String(clientId)]);
  return { ok: true, count: (a.rowCount || 0) + (b.rowCount || 0) };
}

/**
 * The one door both the chat tool and the portal use. Checks the link, the reason and the share
 * link, then saves. Returns { ok, text, searchId? } - text is for the person, either way.
 */
async function requestSearch({ client, url, reason, shareLink = '', requestedBy = null }, { deps = {} } = {}) {
  if (!client || !client.clientId) return { ok: false, text: 'No client.' };
  if (!enabledFor(client.clientId)) {
    return { ok: false, text: 'Bringing your connections in from a search is not switched on for you yet - Guy is trying it on his own machine first. It is coming; nothing was saved.' };
  }
  const { checkSearchUrl, ownConnectionsCheck } = require('../utils/linkedinSearchUrl');
  const check = checkSearchUrl(url);
  if (!check.ok) return { ok: false, text: `That link won't work - ${check.problem}. It needs the address of a LinkedIn or Sales Navigator people search of your own connections (Connections: 1st), copied from the address bar.` };
  const own = ownConnectionsCheck(check);
  if (own.problem) return { ok: false, text: own.problem };
  if (!own.own) {
    return { ok: false, text: check.kind === 'sn-list-people-page'
      ? 'A Sales Navigator lead list can\'t be used for this - its address does not say who in it you are connected to. Use a people search with Connections set to 1st instead.'
      : 'That search is not set to your own connections. On LinkedIn, set the Connections filter to 1st only (in Sales Navigator, Relationship: 1st-degree connections), then copy the link again. (People you are NOT connected to go in your campaign instead - that is "top up my campaign".)' };
  }
  const r = cleanReason(reason);
  if (r.problem) return { ok: false, text: r.problem, needsReason: true };
  const l = await cleanShareLink(shareLink, client.clientId, deps);
  if (l.problem) return { ok: false, text: l.problem };
  const saved = await saveSearch({ clientId: client.clientId, url: check.url, urlKind: check.kind, reason: r.reason, shareLink: l.link, requestedBy }, { deps });
  if (!saved.ok) return { ok: false, text: `Couldn't save the search: ${saved.error}` };
  const lines = [
    `${saved.updated ? 'Updated - you had already sent this search and it had not been picked up yet, so it now carries this reason and link.' : 'Saved.'} Your Linked Helper machine collects this search and visits each person - it never invites or messages anyone. They become full leads in Wingguy and appear in your Reconnect list on the Follow-Ups screen, a few each day. The first ones arrive the morning after the machine picks the search up, so start with those - you never need to wait for the last one.`,
    `Your reason - "${r.reason}" - goes with every one of them, so /wg ends each first message with a small ask that fits it.`,
    l.link ? `Your link (${l.link}) is kept back for the people who say yes - /wg puts it in the reply to them, never in the first message.` : 'No link to share was given - that is fine. To add one before the machine picks this search up, send the same search again with the link.',
    'Anyone you have already worked, or written to in the last three months, is left where they are - nobody shows up twice. Someone who was in an earlier search of yours keeps the reason and link from that one.',
  ];
  return { ok: true, text: lines.join('\n\n'), searchId: saved.searchId };
}

/** "What happened to my search?" in words. */
function describeSearch(s) {
  if (!s) return 'You have not brought in any connections from a search yet.';
  const when = new Date(s.createdAt).toLocaleString('en-AU', { timeZone: 'Australia/Brisbane', weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  const head = `Your search from ${when} (Brisbane) - "${s.reason}":`;
  switch (s.status) {
    case 'waiting': return `${head} saved, waiting for your Linked Helper machine to pick it up.`;
    case 'collecting': return `${head} your Linked Helper machine is collecting it now${s.collected !== null ? ` - ${s.collected} found so far` : ''}.`;
    case 'done': return `${head} finished - ${s.collected ?? 0} of your connections found. They arrive in your Reconnect list a few each day as Linked Helper visits them.`;
    case 'failed': return `${head} did not work - ${(s.detail && s.detail.error) || 'no reason came back'}.`;
    default: return `${head} ${s.status}.`;
  }
}

module.exports = {
  enabledFor, countFor, cleanReason, cleanShareLink, saveSearch, listFor, recordPeople, reasonFor, forgetClient,
  requestSearch, describeSearch, ensureSchema, REASON_MAX,
};
