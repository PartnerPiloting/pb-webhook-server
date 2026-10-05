// services/linkedinNetworkSync.js
// Reconnect, brick 1 (docs/RECONNECT-BUILD-PLAN.md): read a client's LinkedIn network and inbox from
// Unipile into OUR OWN store, so the conversation score and the Reconnect list can work from it
// after the one-month LinkedIn connection is gone.
//
//   Unipile (chats, attendees, messages, relations)  ->  linkedin_messages  (one row per message, append-only)
//                                                    ->  linkedin_people    (one row per person, rebuilt each sync)
//
// Rules this file keeps:
//   - READ-ONLY against Unipile. It reads the copy Unipile already holds; it never starts or widens a
//     LinkedIn sync (the date-range sync is deliberately not here - see the plan).
//   - The LinkedIn account id comes ONLY from the client's own record (`Unipile LinkedIn Account ID`).
//     No env fallback, ever - a fallback would read one tenant's inbox into another's store.
//   - Conversations live in Postgres only. Airtable gets the people worth working (brick 3).
//   - The Sales Navigator inbox is NOT used (Guy, 5 Oct 2026: too much complication for what it
//     adds; clients are told Wingguy works from the ordinary inbox). Its threads identify people by
//     a different id (ACwA...) from classic threads and the connections list (ACoA...), with no id
//     mapping. The salesNav option below is the one switch: when on, the two copies of a person are
//     merged by name, only when that is safe (see resolveSalesNav), and messages keep the RAW
//     attendee id so a later, better merge never has to rewrite them.

const { Pool } = require('pg');
const { createLogger } = require('../utils/contextLogger');

const MS_DAY = 86400000;
const ORG_FOLDER = 'INBOX_LINKEDIN_ORGANIZATION';
const SALES_NAV_FOLDER = 'INBOX_LINKEDIN_SALES_NAVIGATOR';
const PAGE_LIMIT = 250;
// The connections list is the one call here whose pace on a big network is unobserved, so it is
// read gently and can be capped or skipped by the caller.
const RELATIONS_LIMIT = 100;
const RELATIONS_PAUSE_MS = 1500;
const WRITE_CHUNK = 500;

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

let pool;
function getPool() {
  if (pool) return pool;
  const url = (process.env.DATABASE_URL || '').trim();
  if (!url) return null;
  pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });
  return pool;
}
/** Test seam. */
function _setPool(fake) { pool = fake; }

async function ensureSchema(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS linkedin_messages (
      tenant_id    TEXT NOT NULL,
      message_id   TEXT NOT NULL,
      chat_id      TEXT NOT NULL,
      attendee_id  TEXT NOT NULL,              -- RAW Unipile attendee id (ACoA... classic, ACwA... Sales Nav)
      sent_at      TIMESTAMPTZ NOT NULL,
      is_sender    BOOLEAN NOT NULL,           -- true = the client wrote it
      body         TEXT NOT NULL DEFAULT '',
      message_type TEXT,
      folder       TEXT,                       -- CLASSIC | SALES_NAVIGATOR
      source       TEXT NOT NULL DEFAULT 'unipile',
      PRIMARY KEY (tenant_id, message_id)
    );
    CREATE INDEX IF NOT EXISTS linkedin_messages_person ON linkedin_messages (tenant_id, attendee_id, sent_at);
    CREATE TABLE IF NOT EXISTS linkedin_people (
      tenant_id         TEXT NOT NULL,
      person_key        TEXT NOT NULL,         -- member_id when known, else the Sales Nav id
      member_id         TEXT,                  -- ACoA...
      sales_nav_id      TEXT,                  -- ACwA...
      public_identifier TEXT,                  -- vanity slug, from the connections list
      profile_url       TEXT,
      name              TEXT,
      first_name        TEXT,
      last_name         TEXT,
      headline          TEXT,
      is_connection     BOOLEAN NOT NULL DEFAULT false,
      connected_at      TIMESTAMPTZ,
      msgs_in           INTEGER NOT NULL DEFAULT 0,
      msgs_out          INTEGER NOT NULL DEFAULT 0,
      first_msg_at      TIMESTAMPTZ,
      last_msg_at       TIMESTAMPTZ,
      last_in_at        TIMESTAMPTZ,
      last_dir          TEXT,                  -- 'in' | 'out' - whose message is the last word
      folders           TEXT,                  -- CLASSIC, SALES_NAVIGATOR or CLASSIC+SALES_NAVIGATOR
      lead_rec_id       TEXT,                  -- set by brick 3; never touched by a sync
      synced_at         TIMESTAMPTZ NOT NULL,
      PRIMARY KEY (tenant_id, person_key)
    );
  `);
}

// ---------------------------------------------------------------------------
// Pure: Unipile rows -> people + messages
// ---------------------------------------------------------------------------

const nrm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N} ]/gu, ' ').replace(/\s+/g, ' ').trim();
const tokens = (s) => new Set(nrm(s).split(' ').filter((w) => w.length > 3));
const overlap = (a, b) => { let n = 0; for (const w of a) if (b.has(w)) n++; return n; };
const iso = (v) => {
  if (v == null || v === '') return null;
  const d = new Date(typeof v === 'number' || /^\d+$/.test(String(v)) ? Number(v) : v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};
// Postgres text and jsonb both refuse a NUL byte.
const clean = (s) => String(s || '').replace(/\u0000/g, '');

/**
 * Which connection is this Sales Navigator attendee? Returns the relation, or null to leave the
 * person unmerged. A wrong merge puts a stranger's thread on a connection's record, so:
 *   - exactly one connection has the name AND Sales Nav says they are 1st-degree -> that one;
 *   - otherwise the headlines must also agree (2+ shared words), and only one candidate may.
 */
function resolveSalesNav(attendee, relationsByName) {
  const cands = relationsByName.get(nrm(attendee && attendee.name)) || [];
  if (!cands.length) return null;
  const spec = (attendee && attendee.specifics) || {};
  if (cands.length === 1 && spec.network_distance === 'DISTANCE_1') return cands[0];
  const occ = tokens(spec.occupation);
  const agree = cands.filter((r) => overlap(occ, tokens(r.headline)) >= 2);
  return agree.length === 1 ? agree[0] : null;
}

/**
 * Turn one account's Unipile rows into the two things we store.
 * @returns {{ people: object[], messages: object[], summary: object }}
 */
function buildNetwork({ chats = [], attendees = [], messages = [], relations = [], nowMs = Date.now(), salesNav = false } = {}) {
  const attBy = new Map();
  for (const a of attendees) if (a && a.provider_id && !a.is_self) attBy.set(a.provider_id, a);
  const chatBy = new Map();
  for (const c of chats) if (c && c.id) chatBy.set(c.id, c);

  // 1. One bucket per RAW attendee id, from the messages.
  const raw = new Map();
  const outMessages = [];
  for (const m of messages) {
    if (!m || m.is_event || m.deleted || m.hidden) continue;
    const c = chatBy.get(m.chat_id);
    const pid = c && c.attendee_provider_id;
    const at = iso(m.timestamp);
    if (!pid || !at) continue;
    const inbox = (c.folder || []).find((f) => String(f).startsWith('INBOX_')) || '';
    if (inbox === ORG_FOLDER) continue;
    if (inbox === SALES_NAV_FOLDER && !salesNav) continue;
    const folder = inbox.replace('INBOX_LINKEDIN_', '') || null;
    const mine = m.is_sender === 1 || m.is_sender === true;
    let b = raw.get(pid);
    if (!b) { b = { pid, in: 0, out: 0, first: at, last: at, lastMine: mine, lastIn: null, folders: new Set() }; raw.set(pid, b); }
    if (folder) b.folders.add(folder);
    if (mine) b.out++; else { b.in++; if (!b.lastIn || at > b.lastIn) b.lastIn = at; }
    if (at < b.first) b.first = at;
    if (at >= b.last) { b.last = at; b.lastMine = mine; }
    outMessages.push({
      message_id: String(m.id), chat_id: String(m.chat_id), attendee_id: pid, sent_at: at,
      is_sender: mine, body: clean(m.text), message_type: m.message_type || null, folder,
    });
  }

  // 2. The connections list is the spine: one person per connection, keyed by member id.
  const people = new Map();
  const relationsByName = new Map();
  for (const r of relations) {
    if (!r || !r.member_id) continue;
    const name = [r.first_name, r.last_name].filter(Boolean).join(' ').trim();
    people.set(r.member_id, {
      person_key: r.member_id, member_id: r.member_id, sales_nav_id: null,
      public_identifier: r.public_identifier || null, profile_url: r.public_profile_url || null,
      name: clean(name) || null, first_name: clean(r.first_name) || null, last_name: clean(r.last_name) || null,
      headline: clean(r.headline) || null, is_connection: true, connected_at: iso(r.created_at),
      msgs_in: 0, msgs_out: 0, first_msg_at: null, last_msg_at: null, last_in_at: null, last_dir: null, _folders: new Set(),
    });
    const k = nrm(name);
    if (k) { if (!relationsByName.has(k)) relationsByName.set(k, []); relationsByName.get(k).push(r); }
  }

  // 3. Hang each message bucket on its person: by id, else (Sales Nav) by a safe name match, else
  //    as a person of their own.
  let mergedSalesNav = 0; let unmergedSalesNav = 0;
  for (const b of raw.values()) {
    const a = attBy.get(b.pid) || {};
    const spec = a.specifics || {};
    const isSalesNavId = !people.has(b.pid) && (b.pid.startsWith('ACwA') || (b.folders.has('SALES_NAVIGATOR') && !b.folders.has('CLASSIC')));
    let p = people.get(b.pid);
    if (!p && isSalesNavId) {
      const rel = resolveSalesNav(a, relationsByName);
      if (rel) { p = people.get(rel.member_id); p.sales_nav_id = b.pid; mergedSalesNav++; } else unmergedSalesNav++;
    }
    if (!p) {
      p = {
        person_key: b.pid, member_id: isSalesNavId ? null : b.pid, sales_nav_id: isSalesNavId ? b.pid : null,
        public_identifier: null, profile_url: a.profile_url || null, name: clean(a.name) || null,
        first_name: null, last_name: null, headline: clean(spec.occupation) || null,
        is_connection: spec.network_distance === 'DISTANCE_1', connected_at: null,
        msgs_in: 0, msgs_out: 0, first_msg_at: null, last_msg_at: null, last_in_at: null, last_dir: null, _folders: new Set(),
      };
      people.set(b.pid, p);
    }
    p.msgs_in += b.in; p.msgs_out += b.out;
    if (!p.first_msg_at || b.first < p.first_msg_at) p.first_msg_at = b.first;
    if (!p.last_msg_at || b.last >= p.last_msg_at) { p.last_msg_at = b.last; p.last_dir = b.lastMine ? 'out' : 'in'; }
    if (b.lastIn && (!p.last_in_at || b.lastIn > p.last_in_at)) p.last_in_at = b.lastIn;
    for (const f of b.folders) p._folders.add(f);
  }

  const rows = []; const summary = {
    people: 0, connections: 0, withMessages: 0, neverSpoke: 0, theySpokeLast: 0, repliedThenQuiet: 0,
    quiet90Connected: 0, mergedSalesNav, unmergedSalesNav, messages: outMessages.length,
  };
  for (const p of people.values()) {
    const folders = [...p._folders].sort().join('+') || null;
    const { _folders, ...row } = p;
    rows.push({ ...row, folders });
    summary.people++;
    if (p.is_connection) summary.connections++;
    if (!p.last_msg_at) continue;
    summary.withMessages++;
    if (p.msgs_in === 0) summary.neverSpoke++;
    else if (p.last_dir === 'in') summary.theySpokeLast++;
    else summary.repliedThenQuiet++;
    if (p.msgs_in > 0 && p.is_connection && (nowMs - Date.parse(p.last_msg_at)) / MS_DAY >= 90) summary.quiet90Connected++;
  }
  return { people: rows, messages: outMessages, summary };
}

// ---------------------------------------------------------------------------
// Unipile read
// ---------------------------------------------------------------------------

function unipileEnv() {
  const dsn = String(process.env.UNIPILE_DSN || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
  return { apiKey: process.env.UNIPILE_API_KEY, base: dsn ? `https://${dsn}/api/v1` : '' };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function unipileGet(env, path, tries = 4) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(`${env.base}${path}`, { headers: { 'X-API-KEY': env.apiKey, accept: 'application/json' } });
      if (res.ok) return res.json();
      const body = (await res.text()).slice(0, 200);
      lastErr = new Error(`unipile HTTP ${res.status} ${path.split('?')[0]}: ${body}`);
      if (res.status < 500 && res.status !== 429) throw lastErr;
    } catch (e) {
      lastErr = e;
      if (/unipile HTTP 4(?!29)/.test(e.message)) throw e;
    }
    await sleep(3000 * (i + 1));
  }
  throw lastErr;
}

async function pageAll(env, path, { limit = PAGE_LIMIT, pauseMs = 0, maxPages = 5000, onPage } = {}) {
  const items = []; let cursor = null; let pages = 0;
  do {
    const j = await unipileGet(env, `${path}&limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
    items.push(...(j.items || []));
    cursor = j.cursor || null; pages++;
    if (onPage) onPage(pages, items.length);
    if (cursor && pauseMs) await sleep(pauseMs);
  } while (cursor && pages < maxPages);
  return { items, complete: !cursor };
}

/** Read everything Unipile holds for one LinkedIn account. Read-only. */
async function readUnipile(accountId, { relations = true, relationsMaxPages, logger } = {}) {
  const env = unipileEnv();
  if (!env.apiKey || !env.base) throw new Error('UNIPILE_API_KEY / UNIPILE_DSN not configured');
  const acc = encodeURIComponent(accountId);
  const note = (label) => (pages, n) => { if (logger && pages % 20 === 0) logger.info(`${label}: ${pages} pages, ${n} rows`); };
  const chats = await pageAll(env, `/chats?account_id=${acc}`, { onPage: note('chats') });
  const attendees = await pageAll(env, `/chat_attendees?account_id=${acc}`, { onPage: note('attendees') });
  const messages = await pageAll(env, `/messages?account_id=${acc}`, { onPage: note('messages') });
  let rel = { items: [], complete: false };
  if (relations) {
    rel = await pageAll(env, `/users/relations?account_id=${acc}`, {
      limit: RELATIONS_LIMIT, pauseMs: RELATIONS_PAUSE_MS, maxPages: relationsMaxPages || 5000, onPage: note('relations'),
    });
  }
  return {
    chats: chats.items, attendees: attendees.items, messages: messages.items, relations: rel.items,
    inboxComplete: chats.complete && attendees.complete && messages.complete, relationsComplete: rel.complete,
  };
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

const MESSAGE_COLS = 'message_id text, chat_id text, attendee_id text, sent_at timestamptz, is_sender boolean, body text, message_type text, folder text';
const PEOPLE_COLS = 'person_key text, member_id text, sales_nav_id text, public_identifier text, profile_url text, name text, first_name text, last_name text, headline text, is_connection boolean, connected_at timestamptz, msgs_in integer, msgs_out integer, first_msg_at timestamptz, last_msg_at timestamptz, last_in_at timestamptz, last_dir text, folders text';
const PEOPLE_NAMES = PEOPLE_COLS.split(', ').map((c) => c.split(' ')[0]);

async function writeNetwork(db, tenantId, { people, messages }, { fullPeople = true } = {}) {
  const syncedAt = new Date().toISOString();
  let newMessages = 0;
  for (let i = 0; i < messages.length; i += WRITE_CHUNK) {
    const r = await db.query(
      `INSERT INTO linkedin_messages (tenant_id, message_id, chat_id, attendee_id, sent_at, is_sender, body, message_type, folder)
       SELECT $1, x.message_id, x.chat_id, x.attendee_id, x.sent_at, x.is_sender, x.body, x.message_type, x.folder
       FROM jsonb_to_recordset($2::jsonb) AS x(${MESSAGE_COLS})
       ON CONFLICT (tenant_id, message_id) DO NOTHING`,
      [tenantId, JSON.stringify(messages.slice(i, i + WRITE_CHUNK))]
    );
    newMessages += r.rowCount || 0;
  }
  const sets = PEOPLE_NAMES.filter((c) => c !== 'person_key').map((c) => `${c} = EXCLUDED.${c}`).join(', ');
  for (let i = 0; i < people.length; i += WRITE_CHUNK) {
    await db.query(
      `INSERT INTO linkedin_people (tenant_id, ${PEOPLE_NAMES.join(', ')}, synced_at)
       SELECT $1, ${PEOPLE_NAMES.map((c) => `x.${c}`).join(', ')}, $3::timestamptz
       FROM jsonb_to_recordset($2::jsonb) AS x(${PEOPLE_COLS})
       ON CONFLICT (tenant_id, person_key) DO UPDATE SET ${sets}, synced_at = EXCLUDED.synced_at`,
      [tenantId, JSON.stringify(people.slice(i, i + WRITE_CHUNK)), syncedAt]
    );
  }
  // linkedin_people is derived, so a complete read replaces it: anyone not in this read (a Sales Nav
  // copy that has now merged into a connection, say) goes. Skipped on a partial read.
  let removedPeople = 0;
  if (fullPeople) {
    const r = await db.query('DELETE FROM linkedin_people WHERE tenant_id = $1 AND synced_at < $2::timestamptz', [tenantId, syncedAt]);
    removedPeople = r.rowCount || 0;
  }
  return { newMessages, removedPeople };
}

/**
 * Read one client's LinkedIn from Unipile and store it.
 * @param {string} tenantId  client id (e.g. 'Guy-Wilson')
 * @param {{dryRun?: boolean, relations?: boolean, relationsMaxPages?: number}} opts
 */
async function syncLinkedinNetwork(tenantId, { dryRun = false, relations = true, relationsMaxPages, salesNav = false } = {}) {
  const logger = createLogger({ runId: 'LI-SYNC', clientId: tenantId, operation: 'linkedin_network_sync' });
  const clientService = require('./clientService');
  const client = await clientService.getClientById(tenantId);
  if (!client) return { ok: false, error: `no client ${tenantId}` };
  const accountId = String(client.unipileLinkedinAccountId || '').trim();
  if (!accountId) return { ok: false, error: `${tenantId} has no Unipile LinkedIn Account ID` };

  const read = await readUnipile(accountId, { relations, relationsMaxPages, logger });
  if (!read.inboxComplete) return { ok: false, error: 'inbox read stopped before the end - nothing written' };
  const built = buildNetwork({ ...read, salesNav });
  const result = { ok: true, dryRun, relationsComplete: read.relationsComplete, summary: built.summary };
  if (dryRun) return result;

  const db = getPool();
  if (!db) return { ok: false, error: 'DATABASE_URL not configured' };
  await ensureSchema(db);
  // A capped or skipped connections read must not wipe people a full one put there.
  Object.assign(result, await writeNetwork(db, tenantId, built, { fullPeople: read.relationsComplete }));
  logger.info(`stored ${built.people.length} people, ${result.newMessages} new messages`);
  return result;
}

module.exports = { syncLinkedinNetwork, buildNetwork, resolveSalesNav, readUnipile, writeNetwork, ensureSchema, _setPool };
