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

const { Pool } = require('pg');

const MS_DAY = 86400000;
const QUIET_DAYS = 90;
const DEFAULT_DAILY = 20;
const DEFAULT_CUT_OFF = 3;
const MORE_STEP = 10;
const SKIP_DAYS = 90;
const LEADS_CACHE_MS = 5 * 60 * 1000;
const NEVER_SHOWN = new Set(['declined', 'their_pitch']);

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
function eligible(people, leadsById, { todayIso, nowMs = Date.now(), cutOff = DEFAULT_CUT_OFF, clientEmails = new Set(), clientNames = new Set() } = {}) {
  const out = [];
  for (const p of people) {
    if (Number(p.warmth) < cutOff || NEVER_SHOWN.has(p.ending)) continue;
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

function toItem(p, todayIso) {
  const lead = p.lead || {};
  const profile = lead['AI Score'];
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
    if (!client || String(client.reconnect || '').trim() !== 'Yes') return off;
    const db = getPool();
    const base = client.airtableBaseId && clientService.getClientBase(client.airtableBaseId);
    if (!db || !base) return off;
    await ensureSchema(db);

    const cutOff = Number(client.reconnectLeadCutOff) || DEFAULT_CUT_OFF;
    const number = Number(client.reconnectDailyNumber) || DEFAULT_DAILY;
    const todayIso = todayIn(client.timezone, nowMs);
    const [people, leadsById, clients] = await Promise.all([
      loadPeople(db, tenantId, cutOff), loadLeads(base, tenantId, cutOff), clientService.getAllClients(),
    ]);
    const clientEmails = new Set((clients || []).map((c) => nrm(c.clientEmailAddress)).filter(Boolean));
    const clientNames = new Set((clients || []).map((c) => nrm(c.clientName)).filter(Boolean));

    const everyone = eligible(people, leadsById, { todayIso, nowMs, cutOff, clientEmails, clientNames });
    const { live, handedOver, liveKeys } = splitOwnership(liveItems, everyone);
    const poolNow = everyone.filter((p) => !liveKeys.has(p.person_key));
    const { portion, stamp, waiting } = pickPortion(poolNow, { todayIso, number, more });
    await stampShown(db, tenantId, stamp, todayIso);

    return {
      enabled: true, live,
      handedOver: handedOver.length,
      items: portion.map((p) => toItem(p, todayIso)),
      waiting, dailyNumber: number, moreStep: MORE_STEP,
      // Disconnects is its own switch (Guy, 5 Oct 2026): most clients never need it. Off = no button.
      disconnects: disconnectsOn(client),
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
  const who = await db.query('SELECT lead_rec_id, name FROM linkedin_people WHERE tenant_id = $1 AND person_key = $2', [tenantId, personKey]);
  if (!who.rows.length) return { ok: false, error: 'unknown_person' };
  const { lead_rec_id: leadRecId, name } = who.rows[0];

  if (action === 'never' && leadRecId) {
    const clientService = require('./clientService');
    const client = await clientService.getClientById(tenantId);
    const base = client && client.airtableBaseId && clientService.getClientBase(client.airtableBaseId);
    if (!base) return { ok: false, error: 'no_leads_base' };
    await base('Leads').update(leadRecId, { 'Cease FUP': 'Yes', 'Reconnect On': null, 'Cease FUP At': new Date(nowMs).toISOString() });
    leadsCache.delete(tenantId);
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

/** Is the optional disconnects extra switched on for this client? */
function disconnectsOn(client) {
  return !!client && String(client.reconnect || '').trim() === 'Yes' && String(client.reconnectDisconnects || '').trim() === 'Yes';
}

/** The line chat adds under the queue. '' when the list is off or empty. */
function reconnectNote(rc) {
  if (!rc || !rc.enabled || !(rc.items || []).length) return '';
  const lines = rc.items.map((it, i) => `${i + 1}. ${it.name} [${it.chip}, ${it.warmth}/5, quiet ${it.quietDays}d] - ${it.why}${it.pickUpOn ? ` Pick up on: ${it.pickUpOn}.` : ''}`);
  return `\n\nRECONNECT (${rc.items.length} today, ${rc.waiting} more waiting) - people whose old LinkedIn conversation is worth picking up. A separate list from the queue above: mention it in one line and give the list only if the human asks. No message is pre-written - they open the thread and type /wg. Done / Skip 90 days / Never / Potential disconnect are buttons on the Follow-Ups screen.\n${lines.join('\n')}`;
}

module.exports = {
  buildReconnect, reconnectAction, reconnectNote, disconnectsOn,
  eligible, rank, pickPortion, splitOwnership, toItem, newestNoteMs, todayIn,
  ensureSchema, _setPool, _getPool: getPool, QUIET_DAYS, MORE_STEP, ENDING_CHIP,
};
