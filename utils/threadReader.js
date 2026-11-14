/**
 * threadReader - the SERVER's reading of a LinkedIn conversation from what the extension saw.
 *
 * Why this exists (Guy, 5 Nov 2026 - "which version a client is on should stop mattering"): the
 * extension used to work out who said what, which day label belongs to which message and what
 * counts as "today", and send only its conclusions. When that reading was wrong (Craig Carolan,
 * 4 Nov; Ashley Knowles, 5 Nov) the fix was a new extension on every machine, and the wrong
 * conclusion was already saved with nothing left to re-read. So from 0.3.43 the extension also
 * sends a plain list of what it saw, in page order, with no judgement applied (a "sighting"), and
 * this file does the reading here.
 *
 * STEP 1 (this file as first shipped) is a SHADOW: the extension's own answer is still what gets
 * saved. The server reads the sighting, builds its own answer and compares the two
 * (services/captureShadow.js). When they agree for a few days the server's answer takes over and
 * the reading rules in the extension stop mattering.
 *
 * The sighting (v1) - built in wingguy-extension/content-wingguy.js, "sighting" block:
 *   { v: 1, ui: 'new' | 'classic', events: [...], today: [y, m, d], tz, at,
 *     header: { name, profileUrl }, send: { proven: bool } }
 * Events, new messaging build (ui 'new'), in page order:
 *   { k: 't', x }        a <time> element's text ("9:41 AM", "Today", "Saturday")
 *   { k: 'a', x }        a profile link's label ("View Ann Smith's profile", "Ann Smith")
 *   { k: 'p', x, g }     a paragraph of message text; g = which parent it sits in (same g = same message)
 *   { k: 'l', x }        any other short piece of text outside a message (a possible day label)
 * Events, classic build (ui 'classic'):
 *   { k: 'r', s, t, x }  a message row: sender as shown, time as shown, text
 *   { k: 'l', x, h, inRow }  a short piece of text outside a message body; h = LinkedIn's own
 *                        heading element; inRow = it sits inside the row just read
 *
 * Pure - no I/O. Tested by tests/thread-reader.test.js, which also checks the label rules here
 * give the same answers as the ones still shipping in the extension.
 */

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MONTH_RE = '(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\.?';

const clean = (t) => String(t == null ? '' : t).replace(/\s+/g, ' ').trim();

function canonMonthDay(mon, day, year) {
  const mi = MONTHS.indexOf(String(mon || '').toLowerCase().slice(0, 3));
  const d = Number(day);
  if (mi < 0 || !(d >= 1 && d <= 31)) return '';
  const name = MONTHS[mi][0].toUpperCase() + MONTHS[mi].slice(1);
  return `${name} ${d}${year ? `, ${year}` : ''}`;
}

/** The canonical day label for a piece of text ("Today", "Monday", "Oct 19", "Oct 19, 2025"), or ''. */
function dayLabelOf(text) {
  const t = clean(text);
  if (!t || t.length > 30) return '';
  const low = t.toLowerCase().replace(/\s*,\s*/g, ', ');
  if (low === 'today') return 'Today';
  if (low === 'yesterday') return 'Yesterday';
  const wd = WEEKDAYS.indexOf(low);
  if (wd >= 0) return low[0].toUpperCase() + low.slice(1);
  let m = low.match(new RegExp(`^${MONTH_RE} (\\d{1,2})(?:,? (\\d{4}))?$`));
  if (m) return canonMonthDay(m[1], m[2], m[3]);
  m = low.match(new RegExp(`^(\\d{1,2}) ${MONTH_RE}(?:,? (\\d{4}))?$`));
  if (m) return canonMonthDay(m[2], m[1], m[3]);
  return '';
}

/** Days between a day label and `now` (0 = today). null = missing or unreadable, never a guess. */
function dayLabelDaysAgo(rawLabel, now = new Date()) {
  const label = (dayLabelOf(rawLabel) || clean(rawLabel)).toLowerCase();
  if (!label) return null;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (label === 'today') return 0;
  if (label === 'yesterday') return 1;
  const wd = WEEKDAYS.indexOf(label);
  if (wd >= 0) {
    const back = (today.getDay() - wd + 7) % 7;
    return back === 0 ? 7 : back;
  }
  const m = label.match(/^([a-z]{3,9})\.? (\d{1,2})(?:,? (\d{4}))?$/);
  if (!m) return null;
  const month = MONTHS.indexOf(m[1].slice(0, 3));
  if (month < 0) return null;
  let when = new Date(m[3] ? Number(m[3]) : today.getFullYear(), month, Number(m[2]));
  if (!m[3] && when > today) when = new Date(today.getFullYear() - 1, month, Number(m[2]));
  const days = Math.round((today - when) / 86400000);
  return days >= 0 ? days : null;
}

function isThreadHeading(t) {
  return /(\band you\b|people in this conversation|^\d+\s+people\b)/i.test(String(t || ''));
}
function looksLikeName(t) {
  return !!t && t.length >= 2 && t.length < 60 && /[A-Za-z]/.test(t) &&
    !/(message|reaction|status|sent the following|edited|open the options|see more|today|yesterday|active now|profile|· )/i.test(t) &&
    !isThreadHeading(t);
}

/** The coach's just-sent message is today's whatever label the page showed. Returns what it said, or null. */
function stampNewestAsToday(thread, leadName, now = new Date()) {
  if (!Array.isArray(thread) || !thread.length) return null;
  const last = thread[thread.length - 1];
  if (dayLabelDaysAgo(last.day, now) === 0) return null;
  const sender = String(last.sender || '').toLowerCase();
  const leadFirst = String(leadName || '').trim().toLowerCase().split(/\s+/)[0];
  if (!sender || sender === 'unknown' || (leadFirst && leadFirst.length > 1 && sender.includes(leadFirst))) return null;
  const was = last.day || '';
  last.day = 'Today';
  return was || '(no label)';
}

function readNewUi(events) {
  const out = [];
  const labelsSeen = [];
  const unreadable = [];
  let lastSender = '', curDay = '', lastTime = '';
  let buf = null;
  const flush = () => {
    if (buf && buf.parts.length) out.push({ sender: buf.sender || 'Unknown', text: buf.parts.join('\n'), day: buf.day, time: buf.time });
    buf = null;
  };
  const setDay = (label) => { if (label !== curDay) labelsSeen.push(label); curDay = label; };
  for (const ev of events) {
    if (!ev || typeof ev !== 'object') continue;
    if (ev.k === 't') {
      const t = clean(ev.x);
      const m = t.match(/\d{1,2}:\d{2}\s*(?:AM|PM)?/i);
      if (m) lastTime = m[0].replace(/\s+/g, ' ');
      else if (t) { const label = dayLabelOf(t); if (label) setDay(label); else if (t.length < 30) unreadable.push(t); }
      flush();
    } else if (ev.k === 'a') {
      let t = clean(ev.x);
      const vm = t.match(/^view\s+(.+?)[’']s\s+profile$/i);
      if (vm) t = vm[1];
      if (looksLikeName(t) && !/profile/i.test(t)) { if (buf && buf.sender !== t) flush(); lastSender = t; }
    } else if (ev.k === 'p') {
      const text = clean(ev.x);
      if (!text) continue;
      if (buf && buf.g === ev.g) buf.parts.push(text);
      else { flush(); buf = { sender: lastSender, day: curDay, time: lastTime, g: ev.g, parts: [text] }; }
    } else if (ev.k === 'l') {
      const label = dayLabelOf(ev.x);
      if (label) { setDay(label); flush(); }
    }
  }
  flush();
  return { thread: out, labelsSeen, unreadable };
}

function readClassic(events) {
  const out = [];
  const labelsSeen = [];
  const unreadable = [];
  let lastSender = '', curDay = '', lastTime = '';
  for (const ev of events) {
    if (!ev || typeof ev !== 'object') continue;
    if (ev.k === 'r') {
      const name = clean(ev.s); if (name) lastSender = name;
      const time = clean(ev.t); if (time) lastTime = time;
      const text = clean(ev.x);
      if (text) out.push({ sender: lastSender || 'Unknown', text, day: curDay, time: lastTime });
    } else if (ev.k === 'l') {
      const t = clean(ev.x);
      if (!t || t.length > 30) continue;
      const label = dayLabelOf(t);
      if (!label) { if (ev.h) unreadable.push(t); continue; }
      if (label === curDay) continue;
      labelsSeen.push(label);
      curDay = label;
      // A heading rendered inside the row it belongs to comes after that row in page order.
      if (ev.inRow && out.length) out[out.length - 1].day = label;
    }
  }
  return { thread: out, labelsSeen, unreadable };
}

/** A sighting we can read at all? Returns '' when fine, else the reason in a few words. */
function sightingProblem(seen) {
  if (!seen || typeof seen !== 'object') return 'no sighting';
  if (seen.skipped) return `extension skipped it (${String(seen.skipped).slice(0, 40)})`;
  if (seen.v !== 1) return `unknown sighting version ${String(seen.v).slice(0, 10)}`;
  if (seen.ui !== 'new' && seen.ui !== 'classic') return 'unknown page build';
  if (!Array.isArray(seen.events)) return 'no events';
  return '';
}

/** Read a sighting into the thread shape the extension produces: [{ sender, text, day, time }]. */
function readSighting(seen) {
  return seen.ui === 'new' ? readNewUi(seen.events) : readClassic(seen.events);
}

/** The coach's "today" as the extension's clock had it (so both sides resolve labels the same way). */
function sightingNow(seen, fallback = new Date()) {
  const t = seen && Array.isArray(seen.today) ? seen.today.map(Number) : null;
  if (t && t.length === 3 && t[0] > 2000 && t[1] >= 1 && t[1] <= 12 && t[2] >= 1 && t[2] <= 31) return new Date(t[0], t[1] - 1, t[2], 12);
  return fallback;
}

/** The text block the save route's parser reads - the same shape the extension builds. */
function formatThread(thread) {
  const out = [];
  let lastDay = '';
  for (const m of thread) {
    const sender = (m.sender || 'Unknown').trim();
    const time = (m.time && /\d{1,2}:\d{2}/.test(m.time)) ? m.time : '12:00 PM';
    const day = dayLabelOf(m.day);
    if (day && day !== lastDay) { out.push(day); lastDay = day; }
    out.push(`${sender} sent the following message at ${time}`);
    out.push(`${sender}   ${time}`);
    out.push(m.text || '');
    out.push('');
  }
  return out.join('\n');
}

/**
 * The server's own answer for a sighting.
 * @returns {{ok:boolean, reason?:string, content?:string, thread?:Array, labelsSeen?:string[], unreadable?:string[], stamped?:string|null}}
 */
function serverReading(seen, { now } = {}) {
  const problem = sightingProblem(seen);
  if (problem) return { ok: false, reason: problem };
  const { thread, labelsSeen, unreadable } = readSighting(seen);
  const leadName = seen.header && seen.header.name;
  const proven = !!(seen.send && seen.send.proven === true);
  const stamped = proven ? stampNewestAsToday(thread, leadName, sightingNow(seen, now)) : null;
  return { ok: true, content: formatThread(thread), thread, labelsSeen, unreadable, stamped };
}

const normalise = (s) => String(s == null ? '' : s).replace(/\r\n/g, '\n').split('\n').map((l) => l.replace(/\s+$/, '')).join('\n').replace(/\n+$/, '');

/**
 * Compare the extension's answer with the server's.
 * @returns {{verdict:'match'|'differs', diffs:Array<{line:number, extension:string, server:string}>}}
 */
function compareContent(extensionContent, serverContent, maxDiffs = 5) {
  const a = normalise(extensionContent).split('\n');
  const b = normalise(serverContent).split('\n');
  const diffs = [];
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n && diffs.length < maxDiffs; i += 1) {
    if (a[i] !== b[i]) diffs.push({ line: i + 1, extension: String(a[i] === undefined ? '(nothing)' : a[i]).slice(0, 200), server: String(b[i] === undefined ? '(nothing)' : b[i]).slice(0, 200) });
  }
  return { verdict: diffs.length ? 'differs' : 'match', diffs };
}

module.exports = {
  dayLabelOf, dayLabelDaysAgo, looksLikeName, stampNewestAsToday,
  sightingProblem, readSighting, sightingNow, formatThread, serverReading, compareContent,
};
