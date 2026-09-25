// services/wingguyIntroductions.js
// Introductions Guy makes between people, logged by themselves and checked on later (2026-09-25).
//
// Guy: "I'm continually introducing my clients to each other ... I need some way of reminding me
// who I've introduced to who." Every introduction he asks for in Claude goes through
// wingguy_create_draft as ONE email to both people, so that is where it is caught:
//
//   1. DRAFT  - runCreateDraft calls logIntroductionDraft. A draft to exactly two people (To + Cc,
//      the coach's own addresses aside) that reads like an introduction, where at least one of the
//      two is one of the coach's clients, becomes a Referrals row: From Guy, Stage Promised, note
//      "drafted, not sent yet". A draft that is never sent therefore never counts as made.
//   2. SENT   - the overnight brief calls settleIntroductions. It looks for the sent email in the
//      coach's mailbox and moves the row to Introduced, dated the day it actually went.
//   3. CHECK  - introductionsToCheck lists From Guy rows still at Introduced with nothing recorded
//      for CHECK_DAYS (the later of the send date and the row's last edit), with whether either
//      person has replied on the thread. The brief shows them as one section. Guy's answer goes
//      back through wingguy_referrals update, which edits the row, so the same one does not come
//      back for another CHECK_DAYS.
//
// No new Airtable field: the Referrals table (services/referralService.js) holds the record. The
// only new store is wingguy_intro_watch in Postgres - what the sent-email search needs (the two
// addresses, subject, thread), which has no home on the Airtable row.
//
// Why follow-ups never did this: the follow-up sweep ignores 3+ party threads on purpose, so a
// brokered introduction never shows up as a phantom "reply owed". That also meant nothing ever
// mentioned an introduction again once it went out.

require('dotenv').config();
const { Pool } = require('pg');

const CHECK_DAYS = 14;          // quiet this long after the send (or the last note) = worth a check
const SEND_WAIT_DAYS = 14;      // a draft not sent after this long was dropped - stop looking
// What makes a two-person email an introduction rather than, say, a joint session reminder.
const INTRO_WORDS = /introduc|\bintro\b|meet each other|should meet|you two|want you to meet|connect you|put you in touch/i;

const lower = (v) => String(v || '').trim().toLowerCase();
const day = (iso) => String(iso || '').slice(0, 10);

// ---------------------------------------------------------------------------------------------
// Pure parts (tests/wingguy-introductions.test.js)

/** Every address a client can be emailed at. */
function clientEmails(c) {
  const set = new Set();
  const add = (v) => { const e = lower(v); if (e) set.add(e); };
  add(c.clientEmailAddress);
  add(c.googleCalendarEmail);
  add(c.calendarEmail);
  let alt = '';
  try {
    alt = (c.rawRecord && typeof c.rawRecord.get === 'function')
      ? c.rawRecord.get('Alternative Email Addresses')
      : ((c.rawRecord && c.rawRecord._rawJson && c.rawRecord._rawJson.fields) || {})['Alternative Email Addresses'];
  } catch (_) { /* stubbed record */ }
  String(alt || '').split(/[;,]/).forEach(add);
  return set;
}

/**
 * Is this draft an introduction worth logging? Returns null, or
 *   { client, other: { email, name, client }, parties: [email, email] }
 * where `client` is the coach's client the row hangs off and `other` is the person introduced to
 * them (another client, or anyone else).
 *   recipients - To + Cc, [{ email, name }]
 *   selfEmails - the coach's own addresses (a copy to yourself is not a party)
 *   clients    - the coach's own clients only
 */
function detectIntroduction({ recipients, subject, text, selfEmails, clients }) {
  const seen = new Set();
  const parties = [];
  for (const r of recipients || []) {
    const email = lower(r && r.email);
    if (!email || seen.has(email) || (selfEmails && selfEmails.has(email))) continue;
    seen.add(email);
    parties.push({ email, name: String((r && r.name) || '').trim() });
  }
  // Exactly two: one person to another. A group email is not an introduction we can pair up.
  if (parties.length !== 2) return null;
  if (!INTRO_WORDS.test(`${subject || ''}\n${text || ''}`)) return null;

  const clientFor = (email) => (clients || []).find((c) => clientEmails(c).has(email)) || null;
  const [a, b] = parties.map((p) => ({ ...p, client: clientFor(p.email) }));
  if (!a.client && !b.client) return null; // neither is a client - not what this tracks
  if (a.client && b.client && a.client.id === b.client.id) return null; // two addresses, one person
  const anchor = a.client ? a : b;
  const other = anchor === a ? b : a;
  return {
    client: anchor.client,
    other: {
      email: other.email,
      name: (other.client && other.client.clientName) || other.name || other.email,
      client: other.client,
    },
    parties: [a.email, b.email],
  };
}

/** The sent copy of an introduction: from anyone but the two parties, addressed to at least one of
 *  them, no earlier than the draft. Earliest wins. */
function findSentCopy(messages, { parties, draftedMs }) {
  const ps = parties.map(lower);
  return (messages || [])
    .filter((m) => !ps.includes(lower(m.fromEmail)))
    .filter((m) => ps.some((p) => lower(m.to).includes(p)))
    .filter((m) => !m.date || new Date(m.date).getTime() >= draftedMs - 60000)
    .sort((x, y) => new Date(x.date || 0) - new Date(y.date || 0))[0] || null;
}

/** Messages on the thread written by either party after the introduction went out. */
function repliesFrom(messages, { parties, sentMs }) {
  const ps = parties.map(lower);
  return (messages || [])
    .filter((m) => ps.includes(lower(m.fromEmail)))
    .filter((m) => !m.date || new Date(m.date).getTime() > sentMs)
    .sort((x, y) => new Date(x.date || 0) - new Date(y.date || 0));
}

/** Due for a check: Guy made it (From Guy), it is still just Introduced, and nothing has been
 *  recorded on it for CHECK_DAYS - counted from the later of the send date and the last edit, so
 *  any answer Guy gives (a note, a stage) pushes it out again. */
function isDue(row, nowMs, days = CHECK_DAYS) {
  if (row.direction !== 'From Guy' || row.stage !== 'Introduced') return false;
  const times = [row.introducedOn, row.lastModified].filter(Boolean).map((t) => new Date(t).getTime()).filter((t) => !Number.isNaN(t));
  if (!times.length) return false;
  return nowMs - Math.max(...times) >= days * 24 * 3600 * 1000;
}

function fmtDay(iso) {
  const d = new Date(`${day(iso)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return day(iso) || 'an unknown date';
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

/** One brief line for a due introduction. */
function checkLine(item) {
  const who = `${item.person} to ${item.introducedTo || 'your client'}`;
  let thread;
  if (!item.threadChecked) thread = 'no email thread on record to check';
  else if (!item.replies.length) thread = 'nobody has replied on that thread';
  else {
    const last = item.replies[item.replies.length - 1];
    thread = `${last.name} replied on the thread on ${fmtDay(last.date)}, nothing recorded since`;
  }
  return `You introduced ${who} on ${fmtDay(item.introducedOn)} - ${thread}.`;
}

// ---------------------------------------------------------------------------------------------
// Store: what the sent-email search needs

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

async function query(sql, params) {
  const p = getPool();
  if (!p) return null;
  const client = await p.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS wingguy_intro_watch (
        id BIGSERIAL PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        referral_id TEXT NOT NULL,
        parties TEXT NOT NULL,              -- the two addresses, comma-separated
        subject TEXT,
        thread_id TEXT,
        drafted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        status TEXT NOT NULL DEFAULT 'awaiting-send' CHECK (status IN ('awaiting-send','sent','expired')),
        sent_at TIMESTAMPTZ
      );
    `);
    return await client.query(sql, params);
  } finally { client.release(); }
}

// ---------------------------------------------------------------------------------------------
// 1. DRAFT - called by runCreateDraft once the draft exists. Best-effort: returns a line for the
// tool's reply, or '' when this is not an introduction. Throws only on real failures, which the
// caller turns into a warning line.

async function logIntroductionDraft({ tenant, coach, recipients, subject, text, threadId, selfEmails }) {
  const clientService = require('./clientService');
  const referrals = require('./referralService');
  const all = await clientService.getAllClients();
  const mine = (all || []).filter((c) => c.coach && c.coach === tenant);
  if (!mine.length) return ''; // only a coach's introductions are tracked

  const intro = detectIntroduction({ recipients, subject, text, selfEmails, clients: mine });
  if (!intro) return '';

  // The same introduction drafted twice (a redraft) reuses the row that is still waiting.
  const today = new Date().toISOString().slice(0, 10);
  const rows = referrals.scopeToCoach(await referrals.listAllReferrals(), all, tenant);
  let row = rows.find((r) => r.direction === 'From Guy' && r.stage === 'Promised'
    && r.clientRecordId === intro.client.id && lower(r.person) === lower(intro.other.name));
  if (!row) {
    row = await referrals.logReferral({
      person: intro.other.name,
      clientRecordId: intro.client.id,
      direction: 'From Guy',
      stage: 'Promised',
      introducedOn: today,
      how: 'Email introduction',
      email: intro.other.email,
      introducedTo: intro.client.clientName,
      notes: `${today} - Wingguy drafted this introduction ("${String(subject || '').trim()}") - not sent yet`,
    });
  }
  await query(
    `INSERT INTO wingguy_intro_watch (tenant_id, referral_id, parties, subject, thread_id) VALUES ($1, $2, $3, $4, $5)`,
    [tenant, row.id, intro.parties.join(','), String(subject || '').trim() || null, threadId || null],
  );
  return `Introduction logged: ${intro.other.name} to ${intro.client.clientName} (waiting for you to send it - once it goes, it is marked as made, and you'll be asked how it went after ${CHECK_DAYS} days).\n`;
}

// ---------------------------------------------------------------------------------------------
// 2. SENT - find each waiting draft's sent copy and move its row to Introduced.

async function settleIntroductions(tenant) {
  const out = { checked: 0, sent: 0, expired: 0, awaiting: 0 };
  const res = await query(
    `SELECT * FROM wingguy_intro_watch WHERE tenant_id = $1 AND status = 'awaiting-send' ORDER BY drafted_at`,
    [tenant],
  );
  const waiting = (res && res.rows) || [];
  if (!waiting.length) return out;

  const clientService = require('./clientService');
  const mailProvider = require('./mailProvider');
  const referrals = require('./referralService');
  const coach = await clientService.getClientById(tenant);
  if (!coach || !mailProvider.hasMailbox(coach)) { out.awaiting = waiting.length; return out; }
  const rowsById = new Map((await referrals.listAllReferrals()).map((r) => [r.id, r]));

  for (const w of waiting) {
    out.checked++;
    try {
      const parties = String(w.parties).split(',');
      const draftedMs = new Date(w.drafted_at).getTime();
      const after = Math.floor(draftedMs / 1000) - 60;
      const found = await mailProvider.findMessages(coach, w.thread_id
        ? { threadId: w.thread_id, receivedAfter: after, limit: 20 }
        : { anyEmail: parties[0], subject: w.subject || undefined, receivedAfter: after, limit: 20 });
      if (!found.ok) { out.awaiting++; continue; }
      const sent = findSentCopy(found.messages, { parties, draftedMs });
      const row = rowsById.get(w.referral_id);

      if (!sent) {
        if (Date.now() - draftedMs > SEND_WAIT_DAYS * 24 * 3600 * 1000) {
          if (row && row.stage === 'Promised') {
            await referrals.updateReferral(w.referral_id, { note: `the drafted introduction was never sent (looked for ${SEND_WAIT_DAYS} days)` });
          }
          await query(`UPDATE wingguy_intro_watch SET status = 'expired' WHERE id = $1`, [w.id]);
          out.expired++;
        } else {
          out.awaiting++;
        }
        continue;
      }

      const sentDay = day(sent.date) || new Date().toISOString().slice(0, 10);
      // Only move a row that is still waiting - if Guy already moved it on by hand, his call stands.
      if (row && row.stage === 'Promised') {
        await referrals.updateReferral(w.referral_id, { stage: 'Introduced', introducedOn: sentDay, note: `introduction email sent ${sentDay}` });
      }
      await query(
        `UPDATE wingguy_intro_watch SET status = 'sent', sent_at = $2, thread_id = COALESCE(thread_id, $3) WHERE id = $1`,
        [w.id, sent.date || new Date().toISOString(), sent.threadId || null],
      );
      out.sent++;
    } catch (e) {
      console.warn(`[introductions] settle #${w.id} failed (non-fatal): ${e.message}`);
      out.awaiting++;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// 3. CHECK - introductions that have gone quiet, with what happened on the thread.

async function introductionsToCheck(tenant, { nowMs = Date.now() } = {}) {
  const clientService = require('./clientService');
  const mailProvider = require('./mailProvider');
  const referrals = require('./referralService');
  const all = await clientService.getAllClients();
  const due = referrals.scopeToCoach(await referrals.listAllReferrals(), all, tenant).filter((r) => isDue(r, nowMs));
  if (!due.length) return [];

  const res = await query(
    `SELECT DISTINCT ON (referral_id) * FROM wingguy_intro_watch
      WHERE tenant_id = $1 AND status = 'sent' AND referral_id = ANY($2)
      ORDER BY referral_id, sent_at DESC`,
    [tenant, due.map((r) => r.id)],
  );
  const watchByRow = new Map(((res && res.rows) || []).map((w) => [w.referral_id, w]));
  const coach = await clientService.getClientById(tenant);
  const canRead = coach && mailProvider.hasMailbox(coach);

  const items = [];
  for (const r of due) {
    const w = watchByRow.get(r.id);
    const item = {
      id: r.id, person: r.person, introducedTo: r.introducedTo || r.clientName || '',
      introducedOn: r.introducedOn, threadChecked: false, replies: [],
    };
    if (w && canRead) {
      try {
        const parties = String(w.parties).split(',');
        const sentMs = new Date(w.sent_at).getTime();
        const found = await mailProvider.findMessages(coach, w.thread_id
          ? { threadId: w.thread_id, receivedAfter: Math.floor(sentMs / 1000), limit: 20 }
          : { anyEmail: parties[0], subject: w.subject || undefined, receivedAfter: Math.floor(sentMs / 1000), limit: 20 });
        if (found.ok) {
          item.threadChecked = true;
          const nameOf = (email) => (lower(email) === lower(r.email) ? r.person : (r.introducedTo || r.clientName || email));
          item.replies = repliesFrom(found.messages, { parties, sentMs }).map((m) => ({ name: nameOf(m.fromEmail), date: m.date }));
        }
      } catch (e) { console.warn(`[introductions] thread read for ${r.id} failed (non-fatal): ${e.message}`); }
    }
    item.line = checkLine(item);
    items.push(item);
  }
  return items;
}

module.exports = {
  CHECK_DAYS,
  SEND_WAIT_DAYS,
  clientEmails,
  detectIntroduction,
  findSentCopy,
  repliesFrom,
  isDue,
  checkLine,
  logIntroductionDraft,
  settleIntroductions,
  introductionsToCheck,
  _setPool,
};
