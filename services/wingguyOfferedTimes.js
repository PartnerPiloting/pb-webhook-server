// services/wingguyOfferedTimes.js
// "Offered times have passed" - the row flag (Guy, 2026-09-11). The Ask box caught, on Simon
// Haines, that the stored suggestion was still floating "Mon 7 / Wed 9 / Thu 10 Sep" on 11 Sep.
// The story already knows the dates the coach offered and the screen knows today, so this needs
// no model call: read the coach's LAST message, pull the dated slots out of it, and if nobody has
// replied since and every slot is behind us, say so on the row.
//
// Pure functions - no I/O. The dossier store hands us the material (wingguyDossier.listOfferSignals),
// buildQueue attaches the result so chat and the screen agree (one queue, two renderers).
//
// Deliberately narrow: a "slot" is a weekday + day + month, or a day + month + clock time. A bare
// "26 August" in narrative ("since our call on 26 August") is not an offer and is ignored.

const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
const WD_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// weekday? day month year? time?   e.g. "Monday 7 September, 4:00 pm" / "Thu 10 Sept 11am" / "Wed 26 August, 10:30 am"
const AU_RE = /\b(?:(mon|tue|wed|thu|fri|sat|sun)[a-z]*\.?,?\s+)?(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?(?:,?\s+(20\d{2}))?(?:,?\s*(?:at\s+|@\s*)?(\d{1,2})(?::(\d{2}))?\s*(am|pm))?/gi;
// weekday? month day year? time?   e.g. "Thursday, September 10 at 11am"
const US_RE = /\b(?:(mon|tue|wed|thu|fri|sat|sun)[a-z]*\.?,?\s+)?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(20\d{2}))?(?:,?\s*(?:at\s+|@\s*)?(\d{1,2})(?::(\d{2}))?\s*(am|pm))?/gi;

function isoOf(y, m, d) {
  const dt = new Date(Date.UTC(y, m, d));
  if (dt.getUTCMonth() !== m || dt.getUTCDate() !== d) return null; // 31 Sep etc.
  return dt.toISOString().slice(0, 10);
}

/**
 * Pull the dated slots out of ONE message the coach sent.
 * @param {string} text      the message body (plain text)
 * @param {string} sentIso   YYYY-MM-DD the message went out - resolves a missing year
 * @returns {Array<{iso:string, label:string}>}  unique, ascending by date
 */
function extractOfferedTimes(text, sentIso) {
  const body = String(text || '');
  const sent = /^\d{4}-\d{2}-\d{2}/.test(String(sentIso || '')) ? String(sentIso).slice(0, 10) : null;
  const sentYear = sent ? Number(sent.slice(0, 4)) : new Date().getUTCFullYear();
  const found = new Map();
  const take = (wd, day, mon, year, hh, mm, ap) => {
    if (!wd && !ap) return; // a bare "26 August" is narrative, not an offer
    const m = MONTHS[mon.slice(0, 3).toLowerCase()];
    const d = Number(day);
    if (m == null || !d || d > 31) return;
    let y = year ? Number(year) : sentYear;
    let iso = isoOf(y, m, d);
    if (!iso) return;
    // No year written: an offer is for a date on/after the send date. If it reads as earlier than
    // the send date (allowing a day of timezone slack), it means next year (a November email
    // offering "Tue 6 January"). Never assume more than a year out.
    if (!year && sent && iso < sent) {
      const bumped = isoOf(y + 1, m, d);
      if (bumped) { y += 1; iso = bumped; }
    }
    let label = `${WD_SHORT[new Date(`${iso}T00:00:00Z`).getUTCDay()]} ${d} ${MON_SHORT[m]}`;
    if (ap) label += ` ${Number(hh)}${mm ? `:${mm}` : ''} ${ap.toLowerCase()}`;
    const key = `${iso}|${ap ? `${hh}:${mm || '00'}${ap.toLowerCase()}` : ''}`;
    if (!found.has(key)) found.set(key, { iso, label });
  };
  let m;
  AU_RE.lastIndex = 0;
  while ((m = AU_RE.exec(body))) take(m[1], m[2], m[3], m[4], m[5], m[6], m[7]);
  US_RE.lastIndex = 0;
  while ((m = US_RE.exec(body))) take(m[1], m[3], m[2], m[4], m[5], m[6], m[7]);
  return [...found.values()].sort((a, b) => (a.iso < b.iso ? -1 : a.iso > b.iso ? 1 : 0));
}

/**
 * The row's verdict from the dossier material.
 * @param {Object} sig  { lastOutbound: {date,text}|null, timelineTail: [{date,kind,dir,text}], }
 * @param {string} todayIso  YYYY-MM-DD
 * @returns {{passed:true, times:string[], offeredOn:string}|null}  null = no flag
 */
function offeredTimesSignal(sig, todayIso) {
  if (!sig) return null;
  const tail = (Array.isArray(sig.timelineTail) ? sig.timelineTail : []).filter((t) => t && t.kind !== 'calendar');
  // The conversation's last word must be the coach's: a reply from them supersedes the offer.
  const lastHuman = tail.length ? tail[tail.length - 1] : null;
  if (lastHuman && lastHuman.dir === 'them') return null;
  const lastYou = [...tail].reverse().find((t) => t.dir === 'you');
  const lo = sig.lastOutbound && sig.lastOutbound.text ? sig.lastOutbound : null;
  const texts = [];
  let sentIso = null;
  if (lastYou && lastYou.text) { texts.push({ text: lastYou.text, date: lastYou.date }); sentIso = lastYou.date || null; }
  // The full email body when it IS (or is later than) that last message - the timeline row is a
  // 300-char snippet and the times often sit past the clip.
  if (lo && (!lastYou || !lastYou.date || !lo.date || lo.date >= lastYou.date)) {
    texts.push({ text: lo.text, date: lo.date });
    if (!sentIso || (lo.date && lo.date > sentIso)) sentIso = lo.date || sentIso;
  }
  if (!texts.length) return null;
  const all = new Map();
  for (const t of texts) for (const s of extractOfferedTimes(t.text, t.date || sentIso)) all.set(`${s.iso}|${s.label}`, s);
  const slots = [...all.values()];
  if (!slots.length) return null;
  const today = String(todayIso || new Date().toISOString().slice(0, 10)).slice(0, 10);
  if (slots.some((s) => s.iso >= today)) return null;
  return { passed: true, times: slots.map((s) => s.label), offeredOn: sentIso || null };
}

module.exports = { extractOfferedTimes, offeredTimesSignal };
