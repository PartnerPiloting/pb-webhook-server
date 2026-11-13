/**
 * Back-to-back calls in ONE Wispr recording - finding where one call ends and the next begins
 * (13 Nov 2026).
 *
 * The Fathom and Granola splitters cut on the clock: every line carries a time, and the calendar
 * says when each booking was. Wispr's transcript has NO times at all - just "Name: words" lines.
 * What it does have is voices told apart. In a back-to-back, the first guest's voice stops for good
 * and a new guest's voice starts, while the coach's voice runs the whole way through. That
 * changeover is the cut. No clock needed.
 *
 * Proven on Guy's own recordings the day it was written: of 7 real Wispr transcripts it cut exactly
 * one - 16 Sep 2026, a sales call with Matt followed by a coaching call with Owen - on the line
 * after Matt's "See you later. Bye-bye. Bye.", and left the other six whole (including a group call
 * where two guests talk over each other, and a recording where Wispr heard a single voice).
 *
 * This file only READS a transcript and says what it sees. It never decides to file anything:
 * services/wisprFeedService.js adds the second opinion (the coach's calendar must agree) before a
 * recording is actually split.
 *
 *   candidate  - guest voices fall into two or more groups that do not overlap, each a real
 *                conversation (not a few seconds)
 *   strong     - ...and there is a goodbye within a few lines of every cut
 *
 * Pure. Unit tested in tests/wispr-split.test.js.
 */

const GOODBYE = /\b(bye|see you|see ya|talk soon|speak soon|chat soon|talk to you|thanks for your time|thank you for your time|have a good|have a great|catch you|catch up soon|take care|cheers,? mate)\b/i;

const MIN_GUEST_LINES = 8;
const MIN_GUEST_CHARS = 400;
const MIN_SIDE_SHARE = 0.08;   // each side of a cut must be at least this much of the recording
const OVERLAP_SLACK = 0.02;    // a stray line or two across the cut is not "on the call together"
const GOODBYE_BEFORE = 12;     // lines before the cut searched for a goodbye
const GOODBYE_AFTER = 6;       // ...and after it (the coach often says it last)
const SPANNING_FROM = 0.05;    // a voice present from the first 5%...
const SPANNING_TO = 0.95;      // ...to the last 5% is the person who never left: the coach

/** "Name: words" lines -> [{ label, text, raw }]. A line with no usable label keeps label ''. */
function parseLines(transcript) {
  return String(transcript || '').split('\n').filter((l) => l.trim()).map((raw) => {
    const k = raw.indexOf(':');
    const ok = k > 0 && k < 70;
    return { label: ok ? raw.slice(0, k).trim() : '', text: ok ? raw.slice(k + 1).trim() : raw.trim(), raw };
  });
}

/** Is this label one of Wispr's placeholders ("Speaker 3") rather than a person's name? */
function isPlaceholder(label) {
  return /^speaker\s*\d*$/i.test(String(label || '').trim());
}

/** A label cleaned down to the person's name: "Roland Illyes, Screen sharing" -> "Roland Illyes". */
function personName(label) {
  return String(label || '')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/,\s*(screen sharing|presenting|host|co-host|guest|me)\b.*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function looksLikeCoach(label, coachNames) {
  const L = String(label || '').toLowerCase();
  if (!L) return false;
  if (/notetaker|note taker|\bbot\b/.test(L)) return false;
  if (/\(host\b[^)]*\bme\)|\bme\)/.test(L)) return true;             // Zoom's "(Host, me)"
  for (const n of (coachNames || [])) {
    const name = String(n || '').toLowerCase().trim();
    if (!name) continue;
    if (L === name || personName(L).toLowerCase() === name) return true;
  }
  return false;
}

/**
 * Read a transcript and say whether it looks like two or more calls end to end.
 *
 * @param {string} transcript  "Name: words" lines
 * @param {object} [opts] { coachNames: string[] }  the coach's own names (never treated as a guest)
 * @returns {{
 *   candidate: boolean, strong: boolean, why: string, lineCount: number,
 *   coachLabels: string[], guests: object[],
 *   cuts: {after:number, pct:number, goodbyeNear:boolean}[],
 *   segments: {index:number, from:number, to:number, guestLabels:string[], guestNames:string[], text:string, chars:number}[]
 * }}
 */
function planChangeover(transcript, { coachNames = [] } = {}) {
  const lines = parseLines(transcript);
  const n = lines.length;
  const none = (why, extra = {}) => ({ candidate: false, strong: false, why, lineCount: n, coachLabels: [], guests: [], cuts: [], segments: [], ...extra });
  if (n < 30) return none('too short to hold two calls');

  const by = new Map();
  lines.forEach((l, i) => {
    if (!l.label) return;
    const e = by.get(l.label) || { label: l.label, first: i, last: i, lines: 0, chars: 0 };
    e.last = i; e.lines++; e.chars += l.text.length;
    by.set(l.label, e);
  });
  const voices = [...by.values()];
  if (voices.length < 3) return none(voices.length < 2 ? 'Wispr heard a single voice - nothing to cut on' : 'only two voices - one call');

  // The coach: named as the coach, or simply the voice that is there from start to finish.
  const spanning = (e) => e.first <= n * SPANNING_FROM && e.last >= n * SPANNING_TO;
  const coach = voices.filter((e) => looksLikeCoach(e.label, coachNames) || spanning(e));
  const coachSet = new Set(coach.map((e) => e.label));
  if (!coach.length) return none('could not tell which voice is the coach');

  const guests = voices
    .filter((e) => !coachSet.has(e.label) && !/notetaker|note taker/i.test(e.label))
    .filter((e) => e.lines >= MIN_GUEST_LINES && e.chars >= MIN_GUEST_CHARS)
    .sort((a, b) => a.first - b.first);
  const base = { coachLabels: coach.map((e) => e.label), guests };
  if (guests.length < 2) return none(guests.length ? 'one guest voice - one call' : 'no separate guest voice', base);

  // Group guests who are on the call together; a new group starts only once everyone before has finished.
  const slack = Math.ceil(n * OVERLAP_SLACK);
  const groups = [];
  for (const g of guests) {
    const cur = groups[groups.length - 1];
    if (cur && g.first <= cur.last - slack) { cur.members.push(g); cur.last = Math.max(cur.last, g.last); }
    else if (cur && g.first <= cur.last) { // a blip of overlap: still a new group, but it starts after the old one ends
      groups.push({ members: [g], first: cur.last + 1, last: g.last });
    } else groups.push({ members: [g], first: g.first, last: g.last });
  }
  if (groups.length < 2) return none('the guest voices overlap - they are on one call together', base);

  // Cut after the last line of each group. Coach chatter between the two goes with the NEXT call.
  const cuts = [];
  for (let i = 0; i < groups.length - 1; i++) {
    const after = Math.min(groups[i].last, groups[i + 1].members[0].first - 1);
    const from = Math.max(0, after - GOODBYE_BEFORE);
    const goodbyeNear = lines.slice(from, after + 1 + GOODBYE_AFTER).some((l) => GOODBYE.test(l.text));
    cuts.push({ after, pct: Math.round(((after + 1) / n) * 100), goodbyeNear });
  }
  const bounds = [0, ...cuts.map((c) => c.after + 1), n];
  const segments = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    const from = bounds[i];
    const to = bounds[i + 1] - 1;
    if ((to - from + 1) / n < MIN_SIDE_SHARE) return none('one side of the changeover is too short to be its own call', { ...base, cuts });
    const part = lines.slice(from, to + 1);
    const labels = groups[i].members.map((m) => m.label);
    segments.push({
      index: i + 1, from, to,
      guestLabels: labels,
      guestNames: [...new Set(labels.filter((l) => !isPlaceholder(l)).map(personName).filter(Boolean))],
      text: part.map((l) => l.raw).join('\n'),
      chars: part.reduce((sum, l) => sum + l.raw.length + 1, 0),
    });
  }
  const strong = cuts.every((c) => c.goodbyeNear);
  return {
    candidate: true, strong,
    why: strong ? 'one guest finishes, a goodbye is said, a new guest starts' : 'guest voices change over, but no goodbye was heard at the changeover',
    lineCount: n, ...base, cuts, segments,
  };
}

/** Do this segment's named guests match this person/booking name? First names are enough. */
function nameAgrees(guestNames, candidateNames) {
  const firsts = (list) => (list || []).map((x) => String(x || '').toLowerCase().trim().split(/\s+/)[0]).filter((w) => w.length > 1);
  const a = new Set(firsts(guestNames));
  return firsts(candidateNames).some((w) => a.has(w));
}

module.exports = { planChangeover, parseLines, isPlaceholder, personName, nameAgrees, GOODBYE };
