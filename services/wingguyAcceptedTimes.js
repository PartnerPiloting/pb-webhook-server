// services/wingguyAcceptedTimes.js
// "They said yes to a time and nothing is in your diary" (Guy, 2026-09-14 - the Max Dagenais miss).
// Guy offered Max three slots on 9 Sep, Max picked Thursday 17 Sep 2pm on 10 Sep and asked for the
// invite, and nothing was ever booked. Nothing flagged it: Dean was cc'd, so the sweep's 1:1-only
// reply signal ignored the thread, and the offered-times flag deliberately stands down the moment
// the lead speaks. This is the missing half of that flag - the coach offered, the lead picked, the
// calendar is empty.
//
// Pure functions - no I/O. The sweep (wingguyMailMcp.findAcceptedUnbooked) picks the candidates
// from its mailbox window, reads the few full bodies it needs, and hands them here.
//
// Lessons from the first real-mailbox run (same day):
//   - Thread ids are NOT reliable: Max's yes came back with an edited subject, so Outlook/Unipile
//     gave it a new thread id with no coach message on it. Candidates are per LEAD, not per thread
//     - the coach's messages addressed to that person, whatever thread they sit on.
//   - The lead's newest message is not always the one (Max's newest was a reply to an intro), so
//     the last few of their messages are read, newest first.
//   - Gmail's "On Wed, 2 Sep 2026 at 5:31 pm, Guy Wilson <...> wrote:" wraps onto two lines and
//     slips past the line-anchored stripper, so the quoted offer read as the lead's own slots.
//     stripQuotedDeep cuts at "wrote:" wherever the "On " sentence started.
//   - A reply naming four dated slots is a counter-offer (or an unstripped quote), never a yes.
//
// Deliberately narrow, like the offered-times flag: the lead's reply must name one of the slots
// the coach offered, in a form extractOfferedTimes reads (weekday + day + month, or day + month +
// clock time). "Thursday works" or "the 2pm one" does not count - the Ask box still catches those
// on request. A fresh offer from the coach after the acceptance supersedes it (they renegotiated).

const { extractOfferedTimes } = require('./wingguyOfferedTimes');

const MS_DAY = 86400000;
const TIME_RE = /\d\s*(am|pm)$/i;
const MAX_SLOTS_IN_A_YES = 2; // "Tuesday or Thursday" is a yes-ish; three or more is a counter-offer
// Calendar-generated mail (an Accepted:/Declined: notice carries the event's date+time in its body).
const CALENDAR_SUBJECT_RE = /^(accepted|declined|tentative|invitation|updated invitation|cancell?ed):/i;

function dayOf(iso) {
  const s = String(iso || '');
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
}
function hasTime(slot) { return TIME_RE.test(slot.label || ''); }

/**
 * Cut quoted history the line-anchored stripQuotedTail misses: the wrapped Gmail attribution
 * ("On <date>, <name>\n<email> wrote:"), Outlook's "From: ... Sent: ..." block with blank lines
 * between the headers, and a "Le ... a écrit :" for good measure. Apply AFTER stripQuotedTail.
 */
function stripQuotedDeep(text) {
  let t = String(text || '');
  let cut = t.length;
  // "wrote:" at a line end, with an "On " sentence start within the previous 300 chars.
  const w = t.search(/\bwrote:\s*$/m);
  if (w > -1) {
    const back = t.slice(Math.max(0, w - 300), w);
    const on = back.search(/(^|\n)\s*On\s/);
    cut = Math.min(cut, on > -1 ? Math.max(0, w - 300) + on : w);
  }
  const ecrit = t.search(/\ba écrit\s*:\s*$/m);
  if (ecrit > -1) cut = Math.min(cut, Math.max(0, t.lastIndexOf('\n', ecrit)));
  // Outlook header block where blank lines separate "From:" and "Sent:"/"Date:".
  const from = t.search(/^From:\s.+$/m);
  if (from > -1 && /^\s*(Sent|Date):\s/m.test(t.slice(from, from + 400))) cut = Math.min(cut, from);
  return t.slice(0, cut).trim();
}

/**
 * Walk a lead's exchange with the coach (any order - sorted here) and say whether the lead
 * accepted a slot the coach offered, with no fresher offer from the coach since.
 * @param {Array<{fromEmail:string, date:string, text:string}>} messages  quoted tails already stripped
 * @param {{coachEmails:Set<string>, leadEmail:string}} who
 * @returns {{slot:{iso:string,label:string}, acceptedOn:string, offeredOn:string}|null}
 */
function acceptedTimeSignal(messages, { coachEmails, leadEmail } = {}) {
  const lead = String(leadEmail || '').toLowerCase();
  const coach = coachEmails instanceof Set ? coachEmails : new Set(coachEmails || []);
  if (!lead || !coach.size) return null;
  const msgs = (messages || [])
    .filter((m) => m && m.date && !Number.isNaN(Date.parse(m.date)))
    .slice()
    .sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
  let offered = null;
  let offeredOn = null;
  let accepted = null;
  for (const m of msgs) {
    const from = String(m.fromEmail || '').toLowerCase();
    const day = dayOf(m.date);
    if (coach.has(from)) {
      const slots = extractOfferedTimes(m.text, day);
      if (slots.length) { offered = slots; offeredOn = day; accepted = null; } // a fresh offer supersedes any earlier yes
      continue;
    }
    if (from !== lead || !offered) continue;
    const mine = extractOfferedTimes(m.text, day);
    if (new Set(mine.map((s) => s.iso)).size > MAX_SLOTS_IN_A_YES) continue; // a list of dates is not a yes
    for (const s of mine) {
      const hit = offered.find((o) => o.iso === s.iso && (!hasTime(o) || !hasTime(s) || o.label === s.label));
      if (hit) { accepted = { slot: hit, acceptedOn: day, offeredOn }; break; }
    }
  }
  return accepted;
}

/**
 * From the sweep's mailbox window (mailProvider.listRecent shape: id, threadId, subject, fromEmail,
 * toEmails, ccEmails, date), pick the leads worth reading: they wrote recently, and the coach wrote
 * TO them (to or cc, any thread) at some point in the window. Per lead: their last few messages
 * newest first (calendar notices skipped) and every coach message addressed to them, oldest first.
 * Leads ordered by their newest message, capped.
 * @returns {Array<{leadEmail:string, leadMsgs:Array<{id,date,ms}>, coachMsgs:Array<{id,date,ms}>}>}
 */
function pickAcceptCandidates(messages, { leadEmails, coachEmails, nowMs, lookbackDays = 21, max = 30, perLead = 4 } = {}) {
  const leads = leadEmails instanceof Set ? leadEmails : new Set(leadEmails || []);
  const coach = coachEmails instanceof Set ? coachEmails : new Set(coachEmails || []);
  if (!leads.size || !coach.size) return [];
  const now = Number(nowMs) || Date.now();
  const floor = now - lookbackDays * MS_DAY;
  const byLead = new Map(); // leadEmail -> { leadMsgs: [], coachMsgs: [] }
  const slot = (e) => { let x = byLead.get(e); if (!x) { x = { leadMsgs: [], coachMsgs: [] }; byLead.set(e, x); } return x; };
  for (const m of (messages || [])) {
    if (!m || !m.id || !m.date) continue;
    const ms = Date.parse(m.date);
    if (Number.isNaN(ms)) continue;
    const from = String(m.fromEmail || '').toLowerCase();
    const rec = { id: m.id, date: m.date, ms };
    if (coach.has(from)) {
      const seen = new Set();
      for (const e of [...(m.toEmails || []), ...(m.ccEmails || [])]) {
        const le = String(e || '').toLowerCase();
        if (le && leads.has(le) && !seen.has(le)) { seen.add(le); slot(le).coachMsgs.push(rec); }
      }
    } else if (leads.has(from)) {
      if (ms < floor) continue;
      if (CALENDAR_SUBJECT_RE.test(String(m.subject || '').trim())) continue;
      slot(from).leadMsgs.push(rec);
    }
  }
  const out = [];
  for (const [leadEmail, x] of byLead) {
    if (!x.leadMsgs.length || !x.coachMsgs.length) continue;
    x.leadMsgs.sort((a, b) => b.ms - a.ms);
    x.coachMsgs.sort((a, b) => a.ms - b.ms);
    if (x.coachMsgs[0].ms > x.leadMsgs[0].ms) continue; // the coach never wrote to them before they last spoke
    out.push({ leadEmail, leadMsgs: x.leadMsgs.slice(0, perLead), coachMsgs: x.coachMsgs });
  }
  out.sort((a, b) => b.leadMsgs[0].ms - a.leadMsgs[0].ms);
  return out.slice(0, max);
}

/** "10 Sep" from an ISO day - for the row and the brief line. */
function shortDay(iso) {
  const d = dayOf(iso);
  if (!d) return '';
  const dt = new Date(`${d}T00:00:00Z`);
  return `${dt.getUTCDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][dt.getUTCMonth()]}`;
}

/** The one line every surface says about an unbooked yes - chat, brief and screen agree. */
function unbookedLine(sig) {
  if (!sig || !sig.slot) return '';
  return `they said yes to ${sig.slot.label} on ${shortDay(sig.acceptedOn)} - nothing is in your diary with them`;
}

module.exports = { acceptedTimeSignal, pickAcceptCandidates, stripQuotedDeep, shortDay, unbookedLine, MAX_SLOTS_IN_A_YES };
