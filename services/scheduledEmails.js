// services/scheduledEmails.js
//
// Scheduled sends from the coach's OWN mailbox (Guy, 24 Oct 2026). Until now every Wingguy email
// was a draft the human opened and sent. Guy reviews each weekly email and introduction with Claude
// in chat first, so opening it again in Drafts was a second look at something already approved:
// "schedule it" sends it at a sensible time instead. Coach-only - clients still get drafts.
//
//   WHEN   weekly emails Wednesday 9:30am, introductions Tuesday 9:30am, anything else the next
//          weekday 9:30am - in the RECIPIENT'S time zone (a client's record, else the coach's),
//          never a weekend. An introduction is spaced so nobody gets two in one week (the
//          scheduled queue plus the introduction log, wingguy_intro_watch).
//   AWAY   Guy overseas: introductions wait until the first Tuesday after he is back; weekly
//          emails still go. A daily summary reaches him either way.
//   CHECK  just before it goes: sending switched on here, the address still takes mail, a client
//          still subscribed, two people not already introduced by another email, and Guy has not
//          written to them himself since he scheduled it. Anything that fails is HELD, not sent.
//   AFTER  the same bookkeeping as a draft (asset ledger, follow-up stamp, introduction log), and
//          for a weekly email the client's touch record and a dated line on their note, so the
//          weekly planner knows what they have had.
//
// Nothing is ever sent that was not scheduled by the coach in chat.

const { Pool } = require('pg');

const TICK_MS = 5 * 60 * 1000;
const DAY = 86400000;
const SEND_TIME = { hour: 9, minute: 30 };
const SUMMARY_HOUR = 17; // Brisbane - the daily summary
const KINDS = ['weekly', 'intro', 'email'];
const WEEKDAY = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
const DEFAULT_DAY = { weekly: WEEKDAY.Wed, intro: WEEKDAY.Tue }; // 'email' = the next weekday
const COACH_TZ = 'Australia/Brisbane';

let pool;
let schemaEnsured = false;
let intervalHandle = null;
let ticking = false;

// ---------------------------------------------------------------------------------------------
// Time - all pure

/** { dateStr, weekday (0=Mon), hour, minute } for a moment in a time zone. */
function localParts(ms, tz) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(ms));
  const get = (t) => (parts.find((p) => p.type === t) || {}).value;
  return { dateStr: `${get('year')}-${get('month')}-${get('day')}`, weekday: WEEKDAY[get('weekday')], hour: Number(get('hour')), minute: Number(get('minute')) };
}

/** How far a time zone is ahead of UTC at a moment, in ms. */
function tzOffset(ms, tz) {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(ms));
  const get = (t) => Number((p.find((x) => x.type === t) || {}).value);
  return Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second')) - Math.floor(ms / 1000) * 1000;
}

/** 'YYYY-MM-DD' at hh:mm in a time zone -> UTC ms (daylight saving handled). */
function zonedToUtc(dateStr, hour, minute, tz) {
  const [y, m, d] = String(dateStr).split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d, hour, minute);
  const first = guess - tzOffset(guess, tz);
  return guess - tzOffset(first, tz);
}

function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * The first slot at SEND_TIME in `tz` on `weekday` (0=Mon; null = any weekday) that is at least
 * `leadMs` after `fromMs`. Never a Saturday or Sunday.
 */
function nextSlot(fromMs, tz, weekday = null, leadMs = 30 * 60 * 1000) {
  let dateStr = localParts(fromMs, tz).dateStr;
  for (let i = 0; i < 21; i++) {
    const at = zonedToUtc(dateStr, SEND_TIME.hour, SEND_TIME.minute, tz);
    const wd = localParts(at, tz).weekday;
    const dayOk = weekday === null ? wd <= 4 : wd === weekday;
    if (dayOk && at >= fromMs + leadMs) return at;
    dateStr = addDays(dateStr, 1);
  }
  throw new Error('no slot found');
}

/** The coach's week (Monday date, Brisbane) a moment falls in - the unit introductions are spaced by. */
function weekKey(ms) {
  const p = localParts(ms, COACH_TZ);
  return addDays(p.dateStr, -p.weekday);
}

/**
 * When an email goes when nobody named a time. Every recipient time zone gets its 9:30am - the
 * latest of those, so nobody gets it before 9:30 their time. `fromMs` lets an introduction start
 * after Guy's return.
 */
function defaultSendAt({ kind, tzs, fromMs }) {
  const zones = (tzs && tzs.length ? tzs : [COACH_TZ]);
  const day = Object.prototype.hasOwnProperty.call(DEFAULT_DAY, kind) ? DEFAULT_DAY[kind] : null;
  // The day is judged in the first zone; every zone's 9:30 on that calendar day, the latest wins.
  const first = nextSlot(fromMs, zones[0], day);
  const dateStr = localParts(first, zones[0]).dateStr;
  return Math.max(...zones.map((tz) => zonedToUtc(dateStr, SEND_TIME.hour, SEND_TIME.minute, tz)));
}

/**
 * A time Guy named: 'YYYY-MM-DD' (9:30am their time that day), 'YYYY-MM-DDTHH:MM' (that time in the
 * first recipient's zone) or a full ISO time with Z / an offset (exactly then).
 * Returns ms, or null when it cannot be read.
 */
function parseWhen(when, tzs) {
  const w = String(when || '').trim();
  const zones = (tzs && tzs.length ? tzs : [COACH_TZ]);
  if (/^\d{4}-\d{2}-\d{2}$/.test(w)) return Math.max(...zones.map((tz) => zonedToUtc(w, SEND_TIME.hour, SEND_TIME.minute, tz)));
  const m = w.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{1,2}):(\d{2})$/);
  if (m) return zonedToUtc(m[1], Number(m[2]), Number(m[3]), zones[0]);
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(w)) { const t = Date.parse(w); return Number.isNaN(t) ? null : t; }
  return null;
}

/**
 * Push an introduction a week at a time until none of its people already has one that week.
 * `busy(email)` -> Set of week keys. Returns { at, movedFor: [emails that forced a move] }.
 */
function spaceIntroduction(at, parties, busy, tzs) {
  let t = at;
  const movedFor = new Set();
  for (let i = 0; i < 8; i++) {
    const wk = weekKey(t);
    const clash = parties.filter((e) => busy(e).has(wk));
    if (!clash.length) return { at: t, movedFor: [...movedFor] };
    clash.forEach((e) => movedFor.add(e));
    t = defaultSendAt({ kind: 'intro', tzs, fromMs: zonedToUtc(addDays(wk, 7), 0, 0, COACH_TZ) });
  }
  return { at: t, movedFor: [...movedFor] };
}

/** Is a moment inside Guy's away window? away = { from, until } dates (inclusive), Brisbane. */
function inAway(ms, away) {
  if (!away || !away.from || !away.until) return false;
  const d = localParts(ms, COACH_TZ).dateStr;
  return d >= away.from && d <= away.until;
}

/** The first introduction slot after Guy is back. */
function afterAway(away, tzs) {
  return defaultSendAt({ kind: 'intro', tzs, fromMs: zonedToUtc(addDays(away.until, 1), 0, 0, COACH_TZ) });
}

/** "Tuesday 3 Nov, 9:30am" in a time zone. */
function whenLabel(ms, tz = COACH_TZ) {
  const s = new Intl.DateTimeFormat('en-AU', { timeZone: tz, weekday: 'long', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(ms));
  return s.replace(/\s?(am|pm)/i, (x) => x.trim().toLowerCase()).replace(' at ', ', ');
}

/**
 * "Wednesday 28 Oct, 9:30am their time (8:30am your time)" - or, when the recipients are in
 * different zones, each zone named: "Tuesday 3 Nov, 9:30am Perth, 12:30pm Sydney (11:30am your time)".
 */
function goesLabel(ms, zones) {
  const time = (tz) => whenLabel(ms, tz).split(', ').pop();
  const yours = zones.length === 1 && zones[0] === COACH_TZ ? '' : ` (${time(COACH_TZ)} your time)`;
  if (zones.length === 1) return `${whenLabel(ms, zones[0])} their time${yours}`;
  const city = (tz) => tz.split('/').pop().replace(/_/g, ' ');
  return `${whenLabel(ms, zones[0]).split(', ')[0]}, ${zones.map((tz) => `${time(tz)} ${city(tz)}`).join(', ')}${yours}`;
}

/** Away-mode nudge: an email that asks something only Guy can answer. Heuristic, warns only. */
function asksForGuy(text) {
  return /\?|\b(let me know|reply|get back to me|book a|a call|catch-up|catch up|chat next week)\b/i.test(String(text || ''));
}

// ---------------------------------------------------------------------------------------------
// Store

function getPool() {
  if (pool) return pool;
  const url = (process.env.DATABASE_URL || '').trim();
  if (!url) return null;
  pool = new Pool({ connectionString: url, max: 2, ssl: { rejectUnauthorized: false } });
  return pool;
}
/** Test seam. */
function __setTestPool(fake) { pool = fake; schemaEnsured = !!fake; }

async function withDb(fn, fallback) {
  const p = getPool();
  if (!p) return fallback;
  const c = await p.connect();
  try {
    if (!schemaEnsured) {
      await c.query(`
        CREATE TABLE IF NOT EXISTS scheduled_emails (
          id BIGSERIAL PRIMARY KEY,
          tenant_id TEXT NOT NULL,
          kind TEXT NOT NULL,
          to_json JSONB NOT NULL,
          cc_json JSONB,
          bcc_json JSONB,
          subject TEXT NOT NULL,
          html TEXT NOT NULL,
          reply_to_message_id TEXT,
          resend_ok BOOLEAN NOT NULL DEFAULT false,
          client_id TEXT,
          parties TEXT,
          note TEXT,
          send_at TIMESTAMPTZ NOT NULL,
          status TEXT NOT NULL DEFAULT 'scheduled',
          hold_reason TEXT,
          result TEXT,
          message_id TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          sent_at TIMESTAMPTZ
        );
      `);
      await c.query('CREATE INDEX IF NOT EXISTS scheduled_emails_due ON scheduled_emails (status, send_at)');
      await c.query(`
        CREATE TABLE IF NOT EXISTS scheduled_email_state (
          key TEXT PRIMARY KEY,
          value TEXT,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
      `);
      schemaEnsured = true;
    }
    return await fn(c);
  } finally { c.release(); }
}

function rowOut(r) {
  if (!r) return null;
  return {
    id: Number(r.id), tenantId: r.tenant_id, kind: r.kind,
    to: r.to_json || [], cc: r.cc_json || [], bcc: r.bcc_json || [],
    subject: r.subject, html: r.html, replyToMessageId: r.reply_to_message_id || null, resendOk: !!r.resend_ok,
    clientId: r.client_id || null, parties: r.parties ? r.parties.split(',') : [], note: r.note || null,
    sendAt: new Date(r.send_at).getTime(), status: r.status, holdReason: r.hold_reason || null, result: r.result || null,
    messageId: r.message_id || null, createdAt: new Date(r.created_at).getTime(), sentAt: r.sent_at ? new Date(r.sent_at).getTime() : null,
  };
}

async function insertRow(e) {
  return withDb(async (c) => {
    const r = await c.query(
      `INSERT INTO scheduled_emails (tenant_id, kind, to_json, cc_json, bcc_json, subject, html, reply_to_message_id, resend_ok, client_id, parties, note, send_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [e.tenantId, e.kind, JSON.stringify(e.to || []), JSON.stringify(e.cc || []), JSON.stringify(e.bcc || []), e.subject, e.html,
        e.replyToMessageId || null, !!e.resendOk, e.clientId || null, (e.parties || []).join(',') || null, e.note || null, new Date(e.sendAt)],
    );
    return rowOut(r.rows[0]);
  }, null);
}

async function listRows(tenantId, { statuses = null, sinceMs = null } = {}) {
  return withDb(async (c) => {
    const r = await c.query(
      `SELECT * FROM scheduled_emails WHERE tenant_id = $1
         AND ($2::text[] IS NULL OR status = ANY($2::text[]))
         AND ($3::timestamptz IS NULL OR COALESCE(sent_at, send_at) >= $3::timestamptz)
       ORDER BY send_at`,
      [tenantId, statuses, sinceMs ? new Date(sinceMs) : null],
    );
    return r.rows.map(rowOut);
  }, []);
}

async function getRow(tenantId, id) {
  return withDb(async (c) => rowOut((await c.query('SELECT * FROM scheduled_emails WHERE tenant_id = $1 AND id = $2', [tenantId, id])).rows[0]), null);
}

async function updateRow(id, fields) {
  const cols = Object.keys(fields);
  if (!cols.length) return null;
  const map = { status: 'status', holdReason: 'hold_reason', result: 'result', messageId: 'message_id', sendAt: 'send_at', sentAt: 'sent_at' };
  const sets = cols.map((k, i) => `${map[k]} = $${i + 2}`);
  const vals = cols.map((k) => (k === 'sendAt' || k === 'sentAt') && fields[k] ? new Date(fields[k]) : fields[k]);
  return withDb(async (c) => rowOut((await c.query(`UPDATE scheduled_emails SET ${sets.join(', ')}, updated_at = now() WHERE id = $1 RETURNING *`, [id, ...vals])).rows[0]), null);
}

/** Claim a due row for sending - one instance only, ever. */
async function claimDue(id, nowMs) {
  return withDb(async (c) => rowOut((await c.query(
    `UPDATE scheduled_emails SET status = 'sending', updated_at = now() WHERE id = $1 AND status = 'scheduled' AND send_at <= $2 RETURNING *`,
    [id, new Date(nowMs)],
  )).rows[0]), null);
}

async function dueRows(nowMs) {
  return withDb(async (c) => (await c.query(
    `SELECT * FROM scheduled_emails WHERE status = 'scheduled' AND send_at <= $1 ORDER BY send_at LIMIT 20`, [new Date(nowMs)],
  )).rows.map(rowOut), []);
}

async function getState(key) {
  return withDb(async (c) => { const r = await c.query('SELECT value FROM scheduled_email_state WHERE key = $1', [key]); return r.rows[0] ? r.rows[0].value : null; }, null);
}
async function setState(key, value) {
  return withDb(async (c) => { await c.query('INSERT INTO scheduled_email_state (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = now()', [key, value]); return true; }, false);
}
/** Once-only claim (the daily summary). */
async function claimOnce(key) {
  return withDb(async (c) => (await c.query('INSERT INTO scheduled_email_state (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING RETURNING key', [key, new Date().toISOString()])).rows.length > 0, false);
}

async function getAway(tenantId) {
  const v = await getState(`away:${tenantId}`);
  try { return v ? JSON.parse(v) : null; } catch (_) { return null; }
}

/** The weeks each address already has an introduction in: the scheduled queue + the introduction log. */
async function introWeeks(tenantId, emails, nowMs) {
  const out = new Map(emails.map((e) => [e, new Set()]));
  const add = (e, ms) => { if (out.has(e)) out.get(e).add(weekKey(ms)); };
  const queued = await listRows(tenantId, { statuses: ['scheduled', 'held', 'sending', 'sent'] });
  for (const r of queued) if (r.kind === 'intro') for (const e of r.parties) add(e, r.sentAt || r.sendAt);
  const watch = await withDb(async (c) => {
    try {
      return (await c.query(`SELECT parties, status, drafted_at, sent_at FROM wingguy_intro_watch WHERE tenant_id = $1 AND drafted_at > now() - interval '60 days'`, [tenantId])).rows;
    } catch (_) { return []; }
  }, []);
  for (const w of watch) {
    const people = String(w.parties || '').split(',').map((x) => x.trim().toLowerCase());
    if (w.sent_at) { people.forEach((e) => add(e, new Date(w.sent_at).getTime())); continue; }
    if (w.status !== 'awaiting-send') continue;
    // A draft not sent yet goes when Guy gets to it - usually within days, often the week after a
    // weekend drafting session - so it holds this week AND next.
    const ms = Math.max(new Date(w.drafted_at).getTime(), nowMs);
    people.forEach((e) => { add(e, ms); add(e, ms + 7 * DAY); });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Scheduling

/** Recipient addresses -> the coach's clients they belong to (for time zones and the touch record). */
async function clientsByEmail(tenantId, deps = {}) {
  const cs = deps.clientService || require('./clientService');
  const all = await cs.getAllClients();
  const map = new Map();
  for (const c of all || []) {
    if (c.coach !== tenantId) continue;
    for (const e of [c.clientEmailAddress, c.googleCalendarEmail]) if (e) map.set(String(e).trim().toLowerCase(), c);
  }
  return map;
}

/**
 * Schedule one email. args: { to, cc, bcc, subject, html_body, reply_to_message_id, resend_ok,
 * kind, client, send_at, note }. Checks it exactly as a draft would be checked, then queues it.
 * Returns { ok, text, row? }.
 */
async function schedule(tenantId, args = {}, deps = {}) {
  const mail = deps.mail || require('./wingguyMailMcp');
  const now = deps.now || Date.now();
  const prepared = await mail.prepareOutbound({ to: args.to, subject: args.subject, html_body: args.html_body, resend_ok: args.resend_ok }, tenantId);
  if (prepared.error) return { ok: false, text: prepared.error.replace(/^Draft NOT created/, 'NOT scheduled') };
  const { toParticipants } = require('./mailProvider');
  const to = prepared.recipients;
  const cc = toParticipants(args.cc);
  const people = [...to, ...cc].map((r) => r.email.toLowerCase());
  const byEmail = await clientsByEmail(tenantId, deps);

  let client = null;
  if (args.client) {
    const actions = deps.actions || require('./clientTouchActions');
    const r = await actions.resolveClient(tenantId, args.client);
    if (r.error) return { ok: false, text: r.error };
    client = r.client;
  }
  const text = mail.htmlToText(prepared.html);
  let kind = String(args.kind || '').trim().toLowerCase();
  if (!KINDS.includes(kind)) {
    const intro = people.length === 2 && /introduc|\bintro\b|you two|should meet|connect you/i.test(`${prepared.subject} ${text}`);
    kind = intro ? 'intro' : client ? 'weekly' : 'email';
  }
  if (kind === 'weekly' && !client) {
    const only = to.length === 1 ? byEmail.get(to[0].email.toLowerCase()) : null;
    if (only) client = only;
    else return { ok: false, text: 'A weekly email needs the client it is for - pass client (a name or id).' };
  }

  const tzs = [...new Set(people.map((e) => (byEmail.get(e) || {}).timezone).concat(client ? [client.timezone] : []).filter(Boolean))];
  const zones = tzs.length ? tzs : [COACH_TZ];
  const notes = [];
  let at;
  if (args.send_at) {
    at = parseWhen(args.send_at, zones);
    if (at === null) return { ok: false, text: `Could not read send_at "${args.send_at}". Use a date (2026-11-03), a local time (2026-11-03T10:00) or a full ISO time.` };
    if (at < now) return { ok: false, text: 'That time has already passed - pick a time in the future.' };
    const wd = localParts(at, zones[0]).weekday;
    if (wd >= 5) notes.push('Heads up: that lands on a weekend.');
  } else {
    at = defaultSendAt({ kind, tzs: zones, fromMs: now });
  }

  const away = await getAway(tenantId);
  if (kind === 'intro') {
    if (inAway(at, away)) { at = afterAway(away, zones); notes.push(`You're away until ${away.until}, so it waits for your return.`); }
    if (!args.send_at) {
      const weeks = await introWeeks(tenantId, people, now);
      const spaced = spaceIntroduction(at, people, (e) => weeks.get(e) || new Set(), zones);
      if (spaced.movedFor.length) {
        const names = spaced.movedFor.map((e) => (byEmail.get(e) || {}).clientName || e);
        notes.push(`Moved on a week because ${names.join(' and ')} already ${names.length > 1 ? 'have' : 'has'} an introduction that week.`);
      }
      at = spaced.at;
    }
  }
  if (inAway(at, away) && asksForGuy(text)) notes.push('You will be away when this goes, and it asks something of them - they may reply while you are not around.');

  const row = await insertRow({
    tenantId, kind, to, cc, bcc: toParticipants(args.bcc), subject: prepared.subject, html: args.html_body,
    replyToMessageId: args.reply_to_message_id || null, resendOk: !!args.resend_ok,
    clientId: client ? client.clientId : null, parties: kind === 'intro' ? people : [], note: args.note || null, sendAt: at,
  });
  if (!row) return { ok: false, text: 'NOT scheduled - the database is not reachable here. Make it a draft instead.' };

  // A weekly email Guy scheduled replaces that week's planner email - it must never go twice.
  if (kind === 'weekly' && client) {
    try {
      const ps = deps.planStore || require('./clientTouchPlanStore');
      const week = ps.weekOf(new Date(at));
      const plan = await ps.planFor(week, client.clientId);
      if (plan && !['sent', 'skipped'].includes(plan.status)) {
        await ps.setPlanStatus(week, client.clientId, 'skipped', { whyNot: `Guy scheduled his own email for this week ("${prepared.subject}")` });
        notes.push(`Their planned weekly email for that week is skipped, so they only get this one.`);
      }
    } catch (e) { notes.push(`⚠ Could not skip their planned weekly email (${e.message}) - check it is not approved as well.`); }
  }

  return {
    ok: true, row,
    text: `Scheduled #${row.id}: "${row.subject}" to ${to.map((r) => r.name || r.email).join(', ')}${cc.length ? ` and ${cc.map((r) => r.name || r.email).join(', ')}` : ''} - goes ${goesLabel(row.sendAt, zones)}, from your own mailbox.` +
      (notes.length ? `\n${notes.join('\n')}` : '') +
      '\nIt is checked again just before it goes. "What\'s scheduled?" lists the queue; anything can be moved or cancelled until it goes.',
  };
}

// ---------------------------------------------------------------------------------------------
// The queue: list, cancel, move, send now, away

function lineFor(r) {
  const who = [...r.to, ...r.cc].map((p) => p.name || p.email).join(' + ');
  const when = r.status === 'sent' ? `sent ${whenLabel(r.sentAt)}` : whenLabel(r.sendAt);
  return `#${r.id} ${r.kind} - "${r.subject}" to ${who} - ${when}${r.status === 'held' ? ` - HELD: ${r.holdReason}` : r.status === 'failed' ? ` - FAILED: ${r.result}` : ''}`;
}

async function listText(tenantId, nowMs = Date.now()) {
  const rows = await listRows(tenantId, { statuses: ['scheduled', 'held', 'failed', 'sent'], sinceMs: nowMs - 7 * DAY });
  const away = await getAway(tenantId);
  const held = rows.filter((r) => r.status === 'held' || r.status === 'failed');
  const queued = rows.filter((r) => r.status === 'scheduled');
  const sent = rows.filter((r) => r.status === 'sent');
  const out = [];
  if (away) out.push(`AWAY: ${away.from} to ${away.until} - introductions wait for your return; weekly emails still go.`, '');
  out.push(held.length ? `HELD - need you (${held.length}):` : 'Nothing held.');
  held.forEach((r) => out.push(`  ${lineFor(r)}`));
  out.push('', queued.length ? `SCHEDULED (${queued.length}, Brisbane times):` : 'Nothing scheduled.');
  queued.forEach((r) => out.push(`  ${lineFor(r)}`));
  if (sent.length) { out.push('', `SENT in the last 7 days (${sent.length}):`); sent.forEach((r) => out.push(`  ${lineFor(r)}`)); }
  return out.join('\n');
}

async function cancel(tenantId, id) {
  const r = await getRow(tenantId, id);
  if (!r) return { ok: false, text: `No scheduled email #${id}.` };
  if (!['scheduled', 'held', 'failed'].includes(r.status)) return { ok: false, text: `#${id} is ${r.status} - too late to cancel.` };
  await updateRow(id, { status: 'cancelled' });
  return { ok: true, text: `Cancelled #${id} "${r.subject}" - it will not go.${r.kind === 'weekly' ? ' Their planned weekly email for that week stays skipped; un-skip it in the weekly review if you want it back.' : ''}` };
}

async function move(tenantId, id, when, deps = {}) {
  const r = await getRow(tenantId, id);
  if (!r) return { ok: false, text: `No scheduled email #${id}.` };
  if (!['scheduled', 'held', 'failed'].includes(r.status)) return { ok: false, text: `#${id} is ${r.status} - too late to move.` };
  const byEmail = await clientsByEmail(tenantId, deps);
  const zones = [...new Set([...r.to, ...r.cc].map((p) => (byEmail.get(p.email.toLowerCase()) || {}).timezone).filter(Boolean))];
  const at = parseWhen(when, zones.length ? zones : [COACH_TZ]);
  if (at === null) return { ok: false, text: `Could not read "${when}". Use a date (2026-11-03), a local time (2026-11-03T10:00) or a full ISO time.` };
  if (at < (deps.now || Date.now())) return { ok: false, text: 'That time has already passed.' };
  await updateRow(id, { sendAt: at, status: 'scheduled', holdReason: null });
  return { ok: true, text: `Moved #${id} "${r.subject}" - now goes ${whenLabel(at)} (Brisbane), checked again just before.` };
}

/** Send a held (or scheduled) one now - Guy has looked at why it was held and says go. */
async function sendNow(tenantId, id, deps = {}) {
  const r = await getRow(tenantId, id);
  if (!r) return { ok: false, text: `No scheduled email #${id}.` };
  if (!['scheduled', 'held', 'failed'].includes(r.status)) return { ok: false, text: `#${id} is ${r.status}.` };
  await updateRow(id, { status: 'sending', holdReason: null });
  const out = await deliver({ ...r, status: 'sending' }, { ...deps, skipChecks: true });
  return { ok: out.status === 'sent', text: out.status === 'sent' ? `Sent #${id} "${r.subject}" now.\n${out.result || ''}`.trim() : `#${id} did not go: ${out.result || out.holdReason}` };
}

async function setAway(tenantId, from, until) {
  const ok = /^\d{4}-\d{2}-\d{2}$/;
  if (!ok.test(String(from)) || !ok.test(String(until)) || until < from) return { ok: false, text: 'Give the away dates as from=YYYY-MM-DD and until=YYYY-MM-DD (the last day away).' };
  await setState(`away:${tenantId}`, JSON.stringify({ from, until }));
  return { ok: true, text: `Away set: ${from} to ${until}. Introductions wait for your return (first Tuesday after ${until}); weekly emails still go; a summary reaches you each day at ${SUMMARY_HOUR > 12 ? SUMMARY_HOUR - 12 : SUMMARY_HOUR}pm Brisbane.` };
}

async function clearAway(tenantId) {
  await setState(`away:${tenantId}`, '');
  return { ok: true, text: 'Welcome back - away is off. Introductions go at their normal times again.' };
}

// ---------------------------------------------------------------------------------------------
// Sending

function sendSwitchOn() {
  const v = (name) => String(process.env[name] || 'on').trim().toLowerCase() !== 'off';
  // Staging reads the same clients and mailbox as production - it must never send to a real person.
  return v('SCHEDULED_SEND_ENABLED') && v('CLIENT_TOUCH_SEND_ENABLED');
}

/** The just-before-it-goes checks. Returns the reason to hold, or null. */
async function holdReason(row, ctx, deps = {}) {
  if (!sendSwitchOn()) return 'sending is switched off on this server';
  const cs = deps.clientService || require('./clientService');
  if (row.kind === 'weekly' && row.clientId) {
    const c = await cs.getClientById(row.clientId);
    if (!c) return `client ${row.clientId} not found`;
    if (c.emailUnsubscribed) return `${c.clientName} has unsubscribed from the weekly emails`;
    if (String(c.status || '').toLowerCase() !== 'active') return `${c.clientName} is no longer an active client (${c.status})`;
  }
  if (row.kind === 'intro' && row.parties.length === 2) {
    const met = await withDb(async (c) => {
      try {
        return (await c.query(
          `SELECT sent_at FROM wingguy_intro_watch WHERE tenant_id = $1 AND status = 'sent' AND sent_at > $2
             AND position($3 in lower(parties)) > 0 AND position($4 in lower(parties)) > 0 LIMIT 1`,
          [row.tenantId, new Date(row.createdAt), row.parties[0], row.parties[1]],
        )).rows[0];
      } catch (_) { return null; }
    }, null);
    if (met) return `these two were introduced by another email on ${new Date(met.sent_at).toISOString().slice(0, 10)}`;
  }
  // Guy wrote to them himself after scheduling - the scheduled email may now be stale.
  if (row.kind !== 'intro' && ctx.coach) {
    const mp = deps.mailProvider || require('./mailProvider');
    const self = ctx.selfEmails;
    for (const p of row.to) {
      try {
        const r = await mp.findMessages(ctx.coach, { anyEmail: p.email, receivedAfter: Math.floor(row.createdAt / 1000), limit: 10 });
        const mine = (r.messages || []).find((m) => {
          const from = String(m.from || '').toLowerCase();
          return [...self].some((s) => from.includes(s)) && !ctx.ourSubjects.has(String(m.subject || '').trim().toLowerCase());
        });
        if (mine) return `you emailed ${p.name || p.email} yourself since scheduling ("${mine.subject || 'no subject'}") - check this one still fits`;
      } catch (_) { /* a failed look is not a reason to hold */ }
    }
  }
  return null;
}

/** Send one claimed row (status 'sending'). Returns the updated row. */
async function deliver(row, deps = {}) {
  const mail = deps.mail || require('./wingguyMailMcp');
  const mp = deps.mailProvider || require('./mailProvider');
  const cs = deps.clientService || require('./clientService');
  const { coachOwnEmails } = require('../utils/coachOwnEmails');
  const coach = await cs.getClientById(row.tenantId);
  const selfEmails = coach ? coachOwnEmails(coach) : new Set();
  const sentRows = await listRows(row.tenantId, { statuses: ['sent'], sinceMs: (deps.now || Date.now()) - 30 * DAY });
  const ctx = { coach, selfEmails, ourSubjects: new Set(sentRows.map((r) => r.subject.trim().toLowerCase())) };

  if (!deps.skipChecks) {
    const why = await holdReason(row, ctx, deps);
    if (why) return updateRow(row.id, { status: 'held', holdReason: why });
  } else if (!sendSwitchOn()) {
    return updateRow(row.id, { status: 'held', holdReason: 'sending is switched off on this server' });
  }

  const prepared = await mail.prepareOutbound({ to: row.to, subject: row.subject, html_body: row.html, resend_ok: row.resendOk }, row.tenantId);
  if (prepared.error) return updateRow(row.id, { status: 'held', holdReason: prepared.error.replace(/^Draft NOT created\s*[-—]\s*/, '').slice(0, 500) });

  const res = await mp.sendMessage(prepared.coach, { to: prepared.recipients, cc: row.cc, bcc: row.bcc, subject: prepared.subject, html: prepared.html, replyToMessageId: row.replyToMessageId });
  if (!res.ok) return updateRow(row.id, { status: 'failed', result: String(res.error || 'send failed').slice(0, 500) });

  const sentAt = deps.now || Date.now();
  const lines = await mail.finishOutbound({ tenant: row.tenantId, prepared, cc: row.cc, result: res });
  const extra = [];
  if (row.kind === 'weekly' && row.clientId) {
    // The planner's memory: this week's email went (so no repeats, no second "first email").
    try {
      const ts = deps.touchStore || require('./clientTouchStore');
      const ps = deps.planStore || require('./clientTouchPlanStore');
      await ts.record({
        clientId: row.clientId, kind: 'custom', key: `scheduled:${row.id}`, form: 'one-off', sentAt: new Date(sentAt),
        reason: 'Guy scheduled his own weekly email', source: 'planner', recipient: row.to[0].email,
        meta: { weekOf: ps.weekOf(new Date(sentAt)), subject: row.subject, body: mail.htmlToText(prepared.html).slice(0, 4000), via: 'scheduled' },
      });
    } catch (e) { extra.push(`⚠ touch record not written (${e.message})`); }
    try {
      const c = await cs.getClientById(row.clientId);
      const actions = require('./clientTouchActions');
      const line = row.note || `Weekly email sent (scheduled): "${row.subject}" - ${mail.htmlToText(prepared.html).replace(/\s+/g, ' ').slice(0, 300)}`;
      if (c) await cs.updateTouchNote(c.id, actions.appendNote(c.touchNote, line));
    } catch (e) { extra.push(`⚠ note not updated (${e.message})`); }
  }
  const result = [lines.ledgerLine, lines.followUpLine, lines.introLine, ...extra].join('').trim();
  return updateRow(row.id, { status: 'sent', sentAt, messageId: res.messageId || null, result: result.slice(0, 2000) || null, holdReason: null });
}

// ---------------------------------------------------------------------------------------------
// The tick: send what is due, defer introductions while Guy is away, the daily summary

async function tick(deps = {}) {
  const now = deps.now || Date.now();
  const due = await dueRows(now);
  const done = [];
  for (const r of due) {
    if (r.kind === 'intro') {
      const away = await getAway(r.tenantId);
      if (inAway(now, away)) {
        const byEmail = await clientsByEmail(r.tenantId, deps);
        const zones = [...new Set(r.parties.map((e) => (byEmail.get(e) || {}).timezone).filter(Boolean))];
        await updateRow(r.id, { sendAt: afterAway(away, zones.length ? zones : [COACH_TZ]) });
        done.push({ id: r.id, status: 'deferred' });
        continue;
      }
    }
    const claimed = await claimDue(r.id, now);
    if (!claimed) continue;
    try { const out = await deliver(claimed, deps); done.push({ id: r.id, status: out ? out.status : 'unknown' }); }
    catch (e) { await updateRow(r.id, { status: 'failed', result: `crashed: ${e.message}`.slice(0, 500) }); done.push({ id: r.id, status: 'failed' }); }
  }
  const p = localParts(now, COACH_TZ);
  if (p.hour >= SUMMARY_HOUR && await claimOnce(`summary:${p.dateStr}`)) {
    try { await sendSummary((process.env.RECALL_COACH_CLIENT_ID || 'Guy-Wilson').trim(), now, deps); } catch (e) { console.warn(`[scheduledEmails] summary failed: ${e.message}`); }
  }
  return done;
}

/** The daily summary: what went today, what is held, what is coming, and who has replied. */
async function sendSummary(tenantId, now, deps = {}) {
  const today = localParts(now, COACH_TZ).dateStr;
  const rows = await listRows(tenantId, { statuses: ['scheduled', 'held', 'failed', 'sent'], sinceMs: now - 14 * DAY });
  const sentToday = rows.filter((r) => r.status === 'sent' && localParts(r.sentAt, COACH_TZ).dateStr === today);
  const held = rows.filter((r) => r.status === 'held' || r.status === 'failed');
  const coming = rows.filter((r) => r.status === 'scheduled' && r.sendAt <= now + 7 * DAY);
  const replies = [];
  const cs = deps.clientService || require('./clientService');
  const mp = deps.mailProvider || require('./mailProvider');
  const coach = await cs.getClientById(tenantId);
  if (coach) {
    for (const r of rows.filter((x) => x.status === 'sent')) {
      for (const p of [...r.to, ...r.cc]) {
        try {
          const res = await mp.findMessages(coach, { from: p.email, receivedAfter: Math.floor(r.sentAt / 1000), limit: 1 });
          if (res.ok && res.messages && res.messages.length) replies.push(`${p.name || p.email} replied to "${r.subject}"`);
        } catch (_) { /* skip */ }
      }
    }
  }
  if (!sentToday.length && !held.length && !replies.length) return false;
  const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  const list = (title, items) => (items.length ? `<p><b>${title}</b></p><ul>${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>` : '');
  const away = await getAway(tenantId);
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#222">` +
    (away && inAway(now, away) ? `<p>You're away until ${esc(away.until)} - introductions are waiting for your return.</p>` : '') +
    list(`Went today (${sentToday.length})`, sentToday.map(lineFor)) +
    list(`Held - need you (${held.length})`, held.map(lineFor)) +
    list(`Replies (${replies.length})`, replies) +
    list(`Coming in the next 7 days (${coming.length})`, coming.map(lineFor)) +
    `<p style="color:#888;font-size:12px">To change anything, open Claude and say "what's scheduled?"</p></div>`;
  const send = deps.sendAlertEmail || require('./emailNotificationService').sendAlertEmail;
  await send(`Your scheduled emails - ${sentToday.length} went today${held.length ? `, ${held.length} held` : ''}${replies.length ? `, ${replies.length} replied` : ''}`, html);
  return true;
}

function startScheduledEmails() {
  if (String(process.env.SCHEDULED_SEND_TICK || 'on').toLowerCase() === 'off') return;
  if (intervalHandle) return;
  const run = async () => {
    if (ticking) return;
    ticking = true;
    try { await tick(); } catch (e) { console.error(`[scheduledEmails] tick failed (non-fatal): ${e.message}`); } finally { ticking = false; }
  };
  intervalHandle = setInterval(run, TICK_MS);
  setTimeout(run, 2 * 60 * 1000);
  console.log(`[scheduledEmails] started - every ${TICK_MS / 60000} min; sending ${sendSwitchOn() ? 'ON' : 'OFF here'}`);
}

module.exports = {
  // time (pure)
  localParts, zonedToUtc, nextSlot, weekKey, defaultSendAt, parseWhen, spaceIntroduction, inAway, afterAway, whenLabel, asksForGuy,
  // queue
  schedule, listText, cancel, move, sendNow, setAway, clearAway, getAway,
  // engine
  tick, deliver, holdReason, sendSummary, startScheduledEmails, sendSwitchOn,
  // store (tests)
  __setTestPool, insertRow, listRows, getRow, updateRow, claimDue, dueRows,
  SEND_TIME, COACH_TZ, KINDS,
};
