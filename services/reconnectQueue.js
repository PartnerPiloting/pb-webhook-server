// services/reconnectQueue.js
// Reconnect, brick 4 (docs/RECONNECT-BUILD-PLAN.md): the daily Reconnect list - a PORTION of the
// people whose old LinkedIn conversation is worth picking up again, served beside the live
// follow-up queue. buildQueue() in wingguyMailMcp.js calls buildReconnect() and carries the result,
// so chat and the Follow-Ups screen read the same list (one queue, two renderers).
//
// Decisions this file implements (Guy, 5 Oct 2026):
//   - WHO OWNS WHOM: someone quiet for more than 90 days who is in the Reconnect pool belongs to
//     Reconnect, not the live queue - splitOwnership() takes them out of the live list so nobody
//     shows twice. Anyone the live queue still holds is kept OFF the Reconnect list. A live row
//     with no quiet-days figure stays live: when in doubt nobody vanishes.
//   - "Never" is a Drop: it sets Cease FUP on the lead, the same stop as everywhere else.
//   - People met and not spoken to since are on the list, labelled.
//   - Clients, current or former, never appear.
//   - A portion, never padded: the client's daily number (default 20), yesterday's unworked people
//     first, no reshuffle. "Show more" adds 10.
//   - NOTHING AUTOMATIC: every exit is a click (reconnectAction).
//
// Not here yet: the overnight "prepared in full" pass and the calendar check for a booked person.
//
// SECOND WAY IN (28 Nov 2026, docs/CONNECTIONS-SEARCH-BUILD-PLAN.md step 3): people the client brought
// in from a SEARCH of their own connections (services/connectionSearches.js). They join the same
// list AFTER the conversation people - someone who said yes once beats someone picked by title - with
// the client's reason as the "why". Their key is "search:<profile slug>" in the same reconnect_state
// table, so Done / Skip / Never and the daily portion work unchanged. No Disconnect for them. The list
// shows for a client whose Reconnect switch is off when searches are switched on for them (Steve has
// no conversation history, only searches). One person, one row: a conversation person or anyone on
// the live list is never shown again as a search person.

const { Pool } = require('pg');

const MS_DAY = 86400000;
const QUIET_DAYS = 90;
const DEFAULT_DAILY = 20;
const DEFAULT_CUT_OFF = 3;
const MORE_STEP = 10;
const SKIP_DAYS = 90;
const LEADS_CACHE_MS = 5 * 60 * 1000;
const NEVER_SHOWN = new Set(['declined', 'their_pitch']);
const SEARCH_PREFIX = 'search:';
const SEARCH_CHIP = 'From your search';
const SEARCH_LOOKUPS_PER_BUILD = 120;   // search people matched to their lead per queue load (Airtable calls)

// Order within one warmth score: who is most owed a message first.
const ENDING_RANK = {
  open_question_or_offer: 0, not_now: 1, stalled_after_interest: 2, answered_then_dropped: 3,
  moved_to_call_or_email: 4, closed_politely: 5, other: 6,
};
const ENDING_CHIP = {
  open_question_or_offer: 'Left something open', not_now: 'Not now', stalled_after_interest: 'Keen, then quiet',
  answered_then_dropped: 'Good exchange', moved_to_call_or_email: 'Met, not since', closed_politely: 'Closed politely', other: 'Other',
};

// ---------------------------------------------------------------------------
// Pure
// ---------------------------------------------------------------------------

const nrm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();

function todayIn(timeZone, nowMs = Date.now()) {
  try { return new Intl.DateTimeFormat('en-CA', { timeZone: timeZone || 'Australia/Brisbane' }).format(new Date(nowMs)); } catch (_) { return new Date(nowMs).toISOString().slice(0, 10); }
}

/** Newest dated line in the lead's LINKEDIN MESSAGES notes section, as epoch ms (0 when none). */
function newestNoteMs(notes) {
  // Read the section directly: notesSectionManager.getSection logs four lines a call, and this
  // runs for every lead in the pool on every queue load.
  const text = String(notes || '');
  const start = text.indexOf('=== LINKEDIN MESSAGES ===');
  if (start < 0) return 0;
  const after = text.slice(start + 25);
  const end = after.search(/^=== .+ ===s*$/m);
  const section = end < 0 ? after : after.slice(0, end);
  let best = 0;
  for (const m of section.matchAll(/^\s*(\d{2})-(\d{2})-(\d{2})\b/gm)) {
    const t = Date.UTC(2000 + Number(m[3]), Number(m[2]) - 1, Number(m[1]));
    if (t > best) best = t;
  }
  return best;
}

/**
 * Who may be on the list today. `people` are scored people joined to their state row; `leadsById`
 * is the lead record's fields by record id. Returns the survivors, each with its lead attached.
 */
function eligible(people, leadsById, { todayIso, nowMs = Date.now(), cutOff = DEFAULT_CUT_OFF, clientEmails = new Set(), clientNames = new Set(), oldest = null } = {}) {
  const out = [];
  const oldestMs = oldest ? new Date(oldest).getTime() : 0;
  for (const p of people) {
    if (Number(p.warmth) < cutOff || NEVER_SHOWN.has(p.ending)) continue;
    if (oldestMs && (new Date(p.last_msg_at).getTime() || 0) < oldestMs) continue; // past the client's "how far back"
    if (p.status === 'done' || p.status === 'never' || p.status === 'disconnect') continue;
    if (p.status === 'skipped' && p.until && String(p.until).slice(0, 10) > todayIso) continue;
    const lead = p.lead_rec_id && leadsById.get(p.lead_rec_id);
    if (!lead) continue;
    if (String(lead['Cease FUP'] || '').trim() === 'Yes' || lead['Cease FUP At']) continue;
    if (lead['Reconnect On'] && String(lead['Reconnect On']).slice(0, 10) > todayIso) continue;
    const email = nrm(lead.Email);
    const fullName = nrm(`${lead['First Name'] || ''} ${lead['Last Name'] || ''}`) || nrm(p.name);
    if ((email && clientEmails.has(email)) || (fullName && clientNames.has(fullName))) continue;
    const lastMs = Math.max(new Date(p.last_msg_at).getTime() || 0, newestNoteMs(lead.Notes));
    const quietDays = Math.floor((nowMs - lastMs) / MS_DAY);
    if (quietDays < QUIET_DAYS) continue; // written to since - the live queue's business now
    out.push({ ...p, lead, quietDays });
  }
  return out;
}

function rank(a, b) {
  const ka = a.kind === 'search' ? 1 : 0;
  const kb = b.kind === 'search' ? 1 : 0;
  if (ka !== kb) return ka - kb;                       // conversation people first, always
  if (ka) {
    return ((Number(b.lead && b.lead['AI Score']) || 0) - (Number(a.lead && a.lead['AI Score']) || 0))
      || String(a.added_at || '').localeCompare(String(b.added_at || ''))
      || String(a.person_key).localeCompare(String(b.person_key));
  }
  return (Number(b.warmth) - Number(a.warmth))
    || ((ENDING_RANK[a.ending] ?? 9) - (ENDING_RANK[b.ending] ?? 9))
    || (a.quietDays - b.quietDays)
    || ((Number(b.lead && b.lead['AI Score']) || 0) - (Number(a.lead && a.lead['AI Score']) || 0))
    || String(a.person_key).localeCompare(String(b.person_key));
}

const day = (v) => (v ? (v instanceof Date ? v.toISOString() : String(v)).slice(0, 10) : '');

/**
 * Today's portion. Already-stamped people stay (no reshuffle through the day); on a new day the
 * people shown before and not worked come first, then the best of the rest, up to `number`.
 * `more` adds that many on top. Returns { portion, stamp (keys to mark shown today), waiting }.
 */
function pickPortion(pool, { todayIso, number = DEFAULT_DAILY, more = 0 } = {}) {
  const today = pool.filter((p) => day(p.shown_on) === todayIso).sort(rank);
  const rest = pool.filter((p) => day(p.shown_on) !== todayIso);
  const carried = rest.filter((p) => p.shown_on).sort(rank);
  const fresh = rest.filter((p) => !p.shown_on).sort(rank);
  const queue = [...carried, ...fresh];
  const want = today.length ? more : Math.max(0, number) + more;
  const added = queue.slice(0, want);
  return { portion: [...today, ...added], stamp: added.map((p) => p.person_key), waiting: queue.length - added.length };
}

/**
 * The hand-over. Live rows that Reconnect owns (in the pool AND quiet more than 90 days) leave the
 * live list; everyone still live is reported so the Reconnect list can leave them alone.
 */
function splitOwnership(liveItems, pool) {
  const byRec = new Map(); const byName = new Map();
  for (const p of pool) { if (p.lead_rec_id) byRec.set(p.lead_rec_id, p); const n = nrm(p.name); if (n) byName.set(n, p); }
  const find = (it) => (it.recId && byRec.get(it.recId)) || byName.get(nrm(it.name)) || null;
  const live = []; const handedOver = []; const liveKeys = new Set();
  for (const it of liveItems) {
    const p = find(it);
    // A dated park that has come due and an accepted-but-unbooked time are promises - they stay live.
    const promise = it.kind === 'park' || !!it.unbooked;
    if (p && !promise && Number(it.quietDays) > QUIET_DAYS) { handedOver.push(it); continue; }
    live.push(it);
    if (p) liveKeys.add(p.person_key);
  }
  return { live, handedOver, liveKeys };
}

/**
 * Search people who may be on the list today. Pure. `rows` = connection_search_people joined to
 * their search and state, each with `lead` attached (or none yet - not visited, so not shown).
 * Left out: worked (done / never / skipped for now), stopped (Cease FUP), clients, anyone written to
 * in the last 90 days (the live list's), anyone already on the live list or in the conversation pool.
 */
function eligibleSearch(rows, { todayIso, nowMs = Date.now(), clientEmails = new Set(), clientNames = new Set(), takenRecIds = new Set() } = {}) {
  const out = [];
  const seen = new Set();
  for (const p of rows || []) {
    const lead = p.lead;
    if (!lead || !p.lead_rec_id || takenRecIds.has(p.lead_rec_id) || seen.has(p.lead_rec_id)) continue;
    if (p.status === 'done' || p.status === 'never' || p.status === 'disconnect') continue;
    if (p.status === 'skipped' && p.until && String(p.until).slice(0, 10) > todayIso) continue;
    if (String(lead['Cease FUP'] || '').trim() === 'Yes' || lead['Cease FUP At']) continue;
    if (lead['Reconnect On'] && String(lead['Reconnect On']).slice(0, 10) > todayIso) continue;
    const email = nrm(lead.Email);
    const fullName = nrm(`${lead['First Name'] || ''} ${lead['Last Name'] || ''}`);
    if ((email && clientEmails.has(email)) || (fullName && clientNames.has(fullName))) continue;
    const lastMs = newestNoteMs(lead.Notes);
    if (lastMs && Math.floor((nowMs - lastMs) / MS_DAY) < QUIET_DAYS) continue;
    seen.add(p.lead_rec_id);
    out.push({ ...p, kind: 'search', person_key: `${SEARCH_PREFIX}${p.slug}` });
  }
  return out;
}

function toItem(p, todayIso) {
  const lead = p.lead || {};
  const profile = lead['AI Score'];
  if (p.kind === 'search') {
    const fullName = `${lead['First Name'] || ''} ${lead['Last Name'] || ''}`.trim();
    return {
      key: p.person_key,
      recId: p.lead_rec_id,
      kind: 'search',
      name: fullName || p.slug,
      headline: String(lead.Headline || '').split('\n')[0].slice(0, 160),
      linkedin: lead['LinkedIn Profile URL'] || `https://www.linkedin.com/in/${p.slug}/`,
      warmth: null,
      ending: 'search',
      chip: SEARCH_CHIP,
      why: p.reason || '',
      pickUpOn: '',
      quietDays: null,
      profileScore: profile == null || profile === '' ? null : Math.round(Number(profile)),
      carried: !!p.shown_on && day(p.shown_on) !== todayIso,
    };
  }
  return {
    key: p.person_key,
    recId: p.lead_rec_id,
    name: nrm(`${lead['First Name'] || ''} ${lead['Last Name'] || ''}`) ? `${lead['First Name'] || ''} ${lead['Last Name'] || ''}`.trim() : p.name,
    headline: String(p.headline || lead.Headline || '').split('\n')[0].slice(0, 160),
    linkedin: lead['LinkedIn Profile URL'] || p.profile_url || null,
    warmth: Number(p.warmth),
    ending: p.ending,
    chip: ENDING_CHIP[p.ending] || ENDING_CHIP.other,
    why: p.why || '',
    pickUpOn: p.pick_up_on || '',
    quietDays: p.quietDays,
    profileScore: profile == null || profile === '' ? null : Math.round(Number(profile)),
    carried: !!p.shown_on && day(p.shown_on) !== todayIso,
  };
}

// ---------------------------------------------------------------------------
// Store + Airtable
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
function _setPool(fake) { pool = fake; schemaReady = false; }

let schemaReady = false;
async function ensureSchema(db) {
  if (schemaReady) return;
  await db.query(`
    CREATE TABLE IF NOT EXISTS reconnect_state (
      tenant_id   TEXT NOT NULL,
      person_key  TEXT NOT NULL,
      lead_rec_id TEXT,
      status      TEXT,                 -- NULL (untouched) | done | skipped | never | disconnect | kept
      until       DATE,                 -- skipped: back on the list after this day
      shown_on    DATE,                 -- the last day this person was put in a portion
      source      TEXT,                 -- disconnect: 'client' (their button) | 'system' (suggested)
      approved_at TIMESTAMPTZ,          -- disconnect: when the client approved it (brick 5)
      acted_at    TIMESTAMPTZ,
      PRIMARY KEY (tenant_id, person_key)
    );
    -- disconnect: when the client told us they had removed the person themselves (brick 5).
    ALTER TABLE reconnect_state ADD COLUMN IF NOT EXISTS removed_at TIMESTAMPTZ;
    -- disconnect: when the approved person was handed to the client's Linked Helper machine.
    ALTER TABLE reconnect_state ADD COLUMN IF NOT EXISTS queued_at TIMESTAMPTZ;
  `);
  schemaReady = true;
}

async function loadPeople(db, tenantId, cutOff) {
  const r = await db.query(
    `SELECT p.person_key, p.lead_rec_id, p.name, p.headline, p.profile_url, p.last_msg_at,
            s.ending, s.warmth, s.why, s.pick_up_on, st.status, st.until::text AS until, st.shown_on::text AS shown_on
     FROM linkedin_conversation_scores s
     JOIN linkedin_people p ON p.tenant_id = s.tenant_id AND p.person_key = s.person_key
     LEFT JOIN reconnect_state st ON st.tenant_id = s.tenant_id AND st.person_key = s.person_key
     WHERE s.tenant_id = $1 AND s.warmth >= $2 AND p.lead_rec_id IS NOT NULL`,
    [tenantId, cutOff]
  );
  return r.rows;
}

/** Search people with their search's reason and their Reconnect state. */
async function loadSearchPeople(db, tenantId) {
  await require('./connectionSearches').ensureSchema(db);
  const r = await db.query(
    `SELECT p.slug, p.lead_rec_id, p.search_id, p.added_at::text AS added_at, s.reason, s.share_link,
            st.status, st.until::text AS until, st.shown_on::text AS shown_on
       FROM connection_search_people p
       JOIN connection_searches s ON s.search_id = p.search_id AND s.client_id = p.client_id
       LEFT JOIN reconnect_state st ON st.tenant_id = p.client_id AND st.person_key = 'search:' || p.slug
      WHERE p.client_id = $1`, [tenantId]);
  return r.rows;
}

const LEAD_FIELDS_SHOWN = ['First Name', 'Last Name', 'Email', 'Headline', 'LinkedIn Profile URL', 'Notes', 'Cease FUP', 'Cease FUP At', 'Reconnect On', 'AI Score'];
// Some bases predate these two fields (wingguyMailMcp.js loads the same way): richest first, then without.
const LEAD_FIELD_ATTEMPTS = [LEAD_FIELDS_SHOWN, LEAD_FIELDS_SHOWN.filter((f) => f !== 'Cease FUP At'), LEAD_FIELDS_SHOWN.filter((f) => f !== 'Cease FUP At' && f !== 'Reconnect On')];
async function selectLeads(base, filterByFormula) {
  for (let i = 0; i < LEAD_FIELD_ATTEMPTS.length; i++) {
    try {
      return await base('Leads').select({ filterByFormula, fields: LEAD_FIELD_ATTEMPTS[i] }).all();
    } catch (e) {
      const unknownField = /Reconnect On|Cease FUP At|UNKNOWN_FIELD_NAME|422|INVALID|Unknown field/i.test(e.message);
      if (!unknownField || i === LEAD_FIELD_ATTEMPTS.length - 1) throw e;
    }
  }
  return [];
}
const searchLeadsCache = new Map(); // tenantId -> { at, byId }
const searchMisses = new Map();     // tenantId -> Map(slug -> when last looked for and not found)
const MISS_RETRY_MS = 60 * 60 * 1000;   // not a lead yet (not visited) - look again in an hour, not every load
const quote = (v) => `"${String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

/**
 * Attach each search person's lead. A person becomes a lead only once Linked Helper has visited them,
 * so the match is made by profile address the first time (and saved), by record id after that.
 */
async function attachSearchLeads(db, base, tenantId, rows) {
  const open = rows.filter((p) => !['done', 'never', 'disconnect'].includes(p.status));
  const { canonicalLinkedinSlug: canon, slugPrefilterFormula } = require('../utils/linkedinCanonical');
  const misses = searchMisses.get(tenantId) || new Map();
  searchMisses.set(tenantId, misses);
  const nowMs = Date.now();
  // Newest first, so a backlog of people never visited can't starve today's arrivals.
  const unmatched = open
    .filter((p) => !p.lead_rec_id && !(misses.get(p.slug) > nowMs - MISS_RETRY_MS))
    .sort((a, b) => String(b.added_at || '').localeCompare(String(a.added_at || '')))
    .slice(0, SEARCH_LOOKUPS_PER_BUILD);
  for (let i = 0; i < unmatched.length; i += 30) {
    const chunk = unmatched.slice(i, i + 30);
    // The shared prefilter: matches the stored address with a ?query, a trailing slash or none, and
    // the percent-encoded spelling of non-English names. The exact check below throws out the rest.
    const ors = chunk.map((p) => slugPrefilterFormula(p.slug)).join(',');
    const recs = await selectLeads(base, `OR(${ors})`);
    for (const p of chunk) misses.set(p.slug, nowMs);
    for (const rec of recs) {
      const slug = canon(rec.fields['LinkedIn Profile URL']);
      const p = chunk.find((x) => x.slug === slug);
      if (!p) continue;
      p.lead_rec_id = rec.id;
      p.lead = rec.fields;
      misses.delete(slug);
      await db.query('UPDATE connection_search_people SET lead_rec_id = $3, updated_at = now() WHERE client_id = $1 AND slug = $2', [tenantId, slug, rec.id]);
    }
  }
  const need = open.filter((p) => p.lead_rec_id && !p.lead).map((p) => p.lead_rec_id);
  let cache = searchLeadsCache.get(tenantId);
  if (!cache || Date.now() - cache.at > LEADS_CACHE_MS) { cache = { at: Date.now(), byId: new Map() }; searchLeadsCache.set(tenantId, cache); }
  const missing = [...new Set(need.filter((id) => !cache.byId.has(id)))];
  for (let i = 0; i < missing.length; i += 50) {
    const chunk = missing.slice(i, i + 50);
    const recs = await selectLeads(base, `OR(${chunk.map((id) => `RECORD_ID() = ${quote(id)}`).join(',')})`);
    for (const rec of recs) cache.byId.set(rec.id, rec.fields);
  }
  for (const p of open) if (!p.lead && p.lead_rec_id) p.lead = cache.byId.get(p.lead_rec_id) || null;
  return open;
}

const leadsCache = new Map(); // tenantId -> { at, byId }
async function loadLeads(base, tenantId, cutOff) {
  const hit = leadsCache.get(tenantId);
  if (hit && Date.now() - hit.at < LEADS_CACHE_MS) return hit.byId;
  const records = await base('Leads').select({
    filterByFormula: `{Conversation Score} >= ${Number(cutOff)}`,
    fields: ['First Name', 'Last Name', 'Email', 'Headline', 'LinkedIn Profile URL', 'Notes', 'Cease FUP', 'Cease FUP At', 'Reconnect On', 'AI Score'],
  }).all();
  const byId = new Map(records.map((r) => [r.id, r.fields]));
  leadsCache.set(tenantId, { at: Date.now(), byId });
  return byId;
}

async function stampShown(db, tenantId, keys, todayIso) {
  if (!keys.length) return;
  await db.query(
    `INSERT INTO reconnect_state (tenant_id, person_key, shown_on)
     SELECT $1, k, $3::date FROM unnest($2::text[]) AS k
     ON CONFLICT (tenant_id, person_key) DO UPDATE SET shown_on = EXCLUDED.shown_on`,
    [tenantId, keys, todayIso]
  );
}

/**
 * The Reconnect list for a client, and the live list with the handed-over people taken out.
 * Returns { enabled:false, live } untouched when the client's Reconnect switch is off.
 * Never throws: on any failure the live list is returned whole and the Reconnect list is absent.
 */
async function buildReconnect(tenantId, liveItems = [], { more = 0, nowMs = Date.now() } = {}) {
  const off = { enabled: false, live: liveItems };
  try {
    const clientService = require('./clientService');
    const client = await clientService.getClientById(tenantId);
    const convoOn = !!client && String(client.reconnect || '').trim() === 'Yes';
    const searchOn = !!client && require('./connectionSearches').enabledFor(tenantId);
    if (!convoOn && !searchOn) return off;
    const db = getPool();
    const base = client.airtableBaseId && clientService.getClientBase(client.airtableBaseId);
    if (!db || !base) return off;
    await ensureSchema(db);

    const cutOff = Number(client.reconnectLeadCutOff) || DEFAULT_CUT_OFF;
    const number = Number(client.reconnectDailyNumber) || DEFAULT_DAILY;
    const todayIso = todayIn(client.timezone, nowMs);
    const score = require('./conversationScore');
    const [people, leadsById, clients, profile, searchRows] = await Promise.all([
      convoOn ? loadPeople(db, tenantId, cutOff) : [], convoOn ? loadLeads(base, tenantId, cutOff) : new Map(),
      clientService.getAllClients(), convoOn ? score.loadProfile(tenantId) : { yearsBack: null },
      searchOn ? loadSearchPeople(db, tenantId).then((rows) => attachSearchLeads(db, base, tenantId, rows)).catch((e) => {
        console.error(`[reconnectQueue] ${tenantId}: search people not loaded - ${e.message}`);
        return [];
      }) : [],
    ]);
    const oldest = score.oldestAllowed(profile.yearsBack, nowMs);
    const clientEmails = new Set((clients || []).map((c) => nrm(c.clientEmailAddress)).filter(Boolean));
    const clientNames = new Set((clients || []).map((c) => nrm(c.clientName)).filter(Boolean));

    const everyone = eligible(people, leadsById, { todayIso, nowMs, cutOff, clientEmails, clientNames, oldest });
    const { live, handedOver, liveKeys } = splitOwnership(liveItems, everyone);
    const convoNow = everyone.filter((p) => !liveKeys.has(p.person_key));
    // Search people: never someone on the live list or already here from a conversation.
    // Every conversation person - worked, skipped, declined or not - owns their lead: a search never
    // brings them back under a second key (review 28 Nov 2026).
    const takenRecIds = new Set([...(liveItems || []).map((it) => it.recId), ...people.map((p) => p.lead_rec_id)].filter(Boolean));
    const fromSearches = eligibleSearch(searchRows, { todayIso, nowMs, clientEmails, clientNames, takenRecIds });
    const poolNow = [...convoNow, ...fromSearches];
    const { portion, stamp, waiting } = pickPortion(poolNow, { todayIso, number, more });
    await stampShown(db, tenantId, stamp, todayIso);

    return {
      enabled: true, live,
      handedOver: handedOver.length,
      items: portion.map((p) => toItem(p, todayIso)),
      waiting, dailyNumber: number, moreStep: MORE_STEP,
      // Nobody scored at the cut-off yet = the read has not run (switch on from the first batch,
      // 29 Oct 2026) - the screen says so instead of "nobody left".
      unread: convoOn && people.length === 0,
      // Which ways in this client has (the screen explains the ones they don't), and the full
      // explanation in Wingguy Learning (Guy, 28 Nov 2026: the box links to it).
      conversations: convoOn,
      searches: searchOn,
      learnLink: (() => { try { return require('../utils/learnGuides').topicLink('YOUR RECONNECT LIST') || null; } catch (_) { return null; } })(),
      // Disconnects is its own switch (Guy, 5 Oct 2026): most clients never need it. Off = no button.
      disconnects: convoOn && disconnectsOn(client),
    };
  } catch (e) {
    console.error(`[reconnectQueue] ${tenantId}: ${e.message}`);
    return off;
  }
}

/**
 * One click from the Reconnect list. `never` also sets Cease FUP on the lead - the same stop as a
 * Drop on the live list (a new message from them still surfaces there).
 */
async function reconnectAction(tenantId, key, action, { nowMs = Date.now(), clientOverride } = {}) {
  const STATUS = { done: 'done', skip: 'skipped', never: 'never', disconnect: 'disconnect' };
  if (action === 'disconnect') {
    const c = clientOverride || await require('./clientService').getClientById(tenantId);
    if (!disconnectsOn(c)) return { ok: false, error: 'disconnects_not_enabled' };
  }
  const status = STATUS[action];
  const personKey = String(key || '').trim();
  if (!status || !personKey) return { ok: false, error: 'invalid_action' };
  const db = getPool();
  if (!db) return { ok: false, error: 'store_unavailable' };
  await ensureSchema(db);
  if (action === 'disconnect' && personKey.startsWith(SEARCH_PREFIX)) return { ok: false, error: 'invalid_action' };
  const who = await lookupPerson(db, tenantId, personKey);
  if (!who) return { ok: false, error: 'unknown_person' };
  const { leadRecId, name } = who;

  if (action === 'never' && leadRecId) {
    const clientService = require('./clientService');
    const client = await clientService.getClientById(tenantId);
    const base = client && client.airtableBaseId && clientService.getClientBase(client.airtableBaseId);
    if (!base) return { ok: false, error: 'no_leads_base' };
    await base('Leads').update(leadRecId, { 'Cease FUP': 'Yes', 'Reconnect On': null, 'Cease FUP At': new Date(nowMs).toISOString() });
    leadsCache.delete(tenantId);
    searchLeadsCache.delete(tenantId);
  }
  const until = action === 'skip' ? new Date(nowMs + SKIP_DAYS * MS_DAY).toISOString().slice(0, 10) : null;
  // DISCONNECT is the client's own decision about one person they are looking at, so it is
  // approved on the click (Guy, 5 Oct 2026) - no second review. It is not handed to Linked Helper
  // until that night's pick-up, and until then it can be undone (reconnectDisconnects 'keep').
  await db.query(
    `INSERT INTO reconnect_state (tenant_id, person_key, lead_rec_id, status, until, source, approved_at, acted_at)
     VALUES ($1, $2, $3, $4, $5::date, $6, $7::timestamptz, now())
     ON CONFLICT (tenant_id, person_key) DO UPDATE SET lead_rec_id = EXCLUDED.lead_rec_id, status = EXCLUDED.status,
       until = EXCLUDED.until, source = EXCLUDED.source, approved_at = EXCLUDED.approved_at, acted_at = EXCLUDED.acted_at`,
    [tenantId, personKey, leadRecId, status, until, action === 'disconnect' ? 'client' : null, action === 'disconnect' ? new Date(nowMs).toISOString() : null]
  );
  return { ok: true, action, name, until };
}

/** A Reconnect key -> { leadRecId, name }: a conversation person, or a search person ("search:<slug>"). */
async function lookupPerson(db, tenantId, personKey) {
  if (personKey.startsWith(SEARCH_PREFIX)) {
    const slug = personKey.slice(SEARCH_PREFIX.length);
    await require('./connectionSearches').ensureSchema(db);
    const r = await db.query('SELECT lead_rec_id FROM connection_search_people WHERE client_id = $1 AND slug = $2', [tenantId, slug]);
    if (!r.rows[0]) return null;
    const leadRecId = r.rows[0].lead_rec_id || null;
    const cached = leadRecId && (searchLeadsCache.get(tenantId) || { byId: new Map() }).byId.get(leadRecId);
    const name = cached ? `${cached['First Name'] || ''} ${cached['Last Name'] || ''}`.trim() : '';
    return { leadRecId, name: name || slug };
  }
  const r = await db.query('SELECT lead_rec_id, name FROM linkedin_people WHERE tenant_id = $1 AND person_key = $2', [tenantId, personKey]);
  return r.rows[0] ? { leadRecId: r.rows[0].lead_rec_id || null, name: r.rows[0].name || '' } : null;
}

/** One person on the Reconnect list: their lead record (if they are a lead) and name. */
async function personFor(tenantId, key) {
  const db = getPool();
  if (!db || !String(key || '').trim()) return null;
  await ensureSchema(db);
  return lookupPerson(db, tenantId, String(key).trim());
}

/** Is the optional disconnects extra switched on for this client? */
function disconnectsOn(client) {
  return !!client && String(client.reconnect || '').trim() === 'Yes' && String(client.reconnectDisconnects || '').trim() === 'Yes';
}

/** The line chat adds under the queue. '' when the list is off or empty. */
function reconnectNote(rc) {
  if (!rc || !rc.enabled || !(rc.items || []).length) return '';
  const lines = rc.items.map((it, i) => (it.kind === 'search'
    ? `${i + 1}. ${it.name} [${it.chip}${it.profileScore != null ? `, profile ${it.profileScore}` : ''}] - why they picked them: ${it.why}`
    : `${i + 1}. ${it.name} [${it.chip}, ${it.warmth}/5, quiet ${it.quietDays}d] - ${it.why}${it.pickUpOn ? ` Pick up on: ${it.pickUpOn}.` : ''}`));
  return `\n\nRECONNECT (${rc.items.length} today, ${rc.waiting} more waiting) - people whose old LinkedIn conversation is worth picking up, then people they brought in from a search of their own connections ("${SEARCH_CHIP}"). A separate list from the queue above: mention it in one line and give the list only if the human asks. No message is pre-written - they open the thread and type /wg. Done / Skip 90 days / Never / Potential disconnect are buttons on the Follow-Ups screen.\n${lines.join('\n')}`;
}

module.exports = {
  buildReconnect, reconnectAction, personFor, reconnectNote, disconnectsOn,
  eligible, eligibleSearch, rank, pickPortion, splitOwnership, toItem, newestNoteMs, todayIn, SEARCH_PREFIX, SEARCH_CHIP,
  ensureSchema, _setPool, _getPool: getPool, QUIET_DAYS, MORE_STEP, ENDING_CHIP,
};
