// services/wingguyFixedLines.js
// THE LINES WINGGUY WRITES ITSELF - one home for their wording (David Gould, 11 Nov 2026).
//
// A LinkedIn draft that offers meeting times is not all written by the model. Code writes the
// question above the time list, the "(All times are X time)" line under it, and the invite line
// (see propose_times in wingguyChat.js - each became code-owned after the model garbled it).
// That made them reliable, and it also made them deaf: a client's writing instructions go to the
// model, the model never writes these lines, so "capital A in All times" silently did nothing.
// David put four fixes in his instructions on 9 Nov and three of them could never land.
//
// So the WORDING is now a per-client value (a plain store variable, shown on the setup page and
// settable in chat), while code still writes the line and fills in the facts. Facts are the
// [city] and [email] gaps: a client can move the words around them, never remove them.
//
// Three rules this module exists to hold:
//   1. FAIL SAFE. Anything unreadable, unset or invalid renders the STANDARD wording. A bad value
//      in the store must never produce a broken draft.
//   2. THE FACTS STAY. A wording that drops a gap it needs is refused at every write door
//      (setup page, wingguy_variables) with a plain-English reason.
//   3. RECOGNITION FOLLOWS THE WORDING. Guards that spot "times were already offered" used to look
//      for the standard phrases only. offerMarkers() adds the client's own wording, and
//      hasTimeList() recognises the list itself, which no wording change can touch.
//
// Pure functions, no I/O - the callers hand in variable rows from wingguyRulesStore.getVariables.

const { extractOfferedTimes } = require('./wingguyOfferedTimes');

const MAX_LEN = 300;

const FIXED_LINES = [
  {
    key: 'times_question_line',
    label: 'The question above your list of times',
    standard: 'Would any of the following times work for you?',
    needs: [],
    sample: {},
  },
  {
    key: 'times_zone_line',
    label: 'The time-zone line under your list of times',
    standard: '(All times are [city] time)',
    needs: ['city'],
    sample: { city: 'Brisbane' },
  },
  {
    key: 'invite_line',
    label: 'The invite line, when Wingguy has their email',
    standard: "Let me know which suits, and I'll send a calendar invite with the Zoom link to [email] - just say if there's a better address.",
    needs: ['email'],
    sample: { email: 'jane@company.com' },
  },
  {
    key: 'invite_line_no_email',
    label: 'The invite line, when Wingguy has no email for them',
    standard: "Let me know which suits, and I'll send a calendar invite with the Zoom link - what's the best email to send it to?",
    needs: [],
    asksForEmail: true,
    sample: {},
  },
];

const BY_KEY = new Map(FIXED_LINES.map((l) => [l.key, l]));
const FIXED_LINE_KEYS = new Set(BY_KEY.keys());
const isFixedLineKey = (key) => FIXED_LINE_KEYS.has(String(key || '').trim());

const GAP_RE = /\[([a-z_ ]{1,20})\]/gi;
const gapsIn = (text) => [...String(text || '').matchAll(GAP_RE)].map((m) => m[1].trim().toLowerCase());

/**
 * Is this wording safe to save for this line?
 * Blank is always fine - it means "back to the standard wording".
 * @returns {{ok:true, value:string}|{ok:false, error:string}}  error is client-facing plain English
 */
function validateFixedLine(key, text) {
  const spec = BY_KEY.get(String(key || '').trim());
  if (!spec) return { ok: false, error: `"${key}" is not one of the lines Wingguy writes.` };
  const value = String(text == null ? '' : text).replace(/\r/g, '').trim();
  if (!value) return { ok: true, value: '' };
  if (/\n/.test(value)) return { ok: false, error: 'This has to stay on one line - Wingguy drops it into the message as a single line.' };
  if (value.length > MAX_LEN) return { ok: false, error: `That is too long for one line (limit ${MAX_LEN} characters).` };
  if (/[–—]/.test(value)) return { ok: false, error: 'Use a plain dash with a space each side ( - ) rather than a long dash.' };
  if (/https?:\/\/|www\./i.test(value)) return { ok: false, error: 'No web links in this line - your meeting link goes on the calendar invite itself.' };
  if (/\{\{|\}\}/.test(value)) return { ok: false, error: 'Use square brackets for the gaps, like [city] - not curly brackets.' };
  const found = gapsIn(value);
  for (const need of spec.needs) {
    const n = found.filter((g) => g === need).length;
    if (n === 0) {
      return { ok: false, error: `This line needs [${need}] in it - that is where Wingguy puts ${need === 'city' ? "the city whose clock the times are on, and without it the person can't tell whose time it is" : 'the email address the invite will go to, so the person can correct it if it is wrong'}.` };
    }
    if (n > 1) return { ok: false, error: `[${need}] should appear once only.` };
  }
  const extra = found.find((g) => !spec.needs.includes(g));
  if (extra) {
    return { ok: false, error: `[${extra}] is not something Wingguy can fill in on this line. ${spec.needs.length ? `The only gap here is ${spec.needs.map((n) => `[${n}]`).join(' and ')}.` : 'This line has no gaps to fill.'}` };
  }
  if (spec.asksForEmail && !(/e-?mail|address/i.test(value) && /\?/.test(value))) {
    return { ok: false, error: 'This is the line that asks the person for their email address (Wingguy has none on file), so it has to ask for it - as a question.' };
  }
  if (!/[a-z]{3}/i.test(value)) return { ok: false, error: 'That does not read as a sentence.' };
  return { ok: true, value };
}

/** Rows from wingguyRulesStore.getVariables ([{var_key, value}]) or a plain {key: value} object. */
function valueFrom(variables, key) {
  if (!variables) return '';
  if (Array.isArray(variables)) {
    const row = variables.find((r) => r && r.var_key === key);
    return row ? String(row.value || '').trim() : '';
  }
  return String(variables[key] || '').trim();
}

/**
 * The wording in force for one client: their own where it is set AND valid, else the standard.
 * @returns {{[key:string]: string}} one template per fixed line, always complete
 */
function resolveFixedLines(variables) {
  const out = {};
  for (const spec of FIXED_LINES) {
    const own = valueFrom(variables, spec.key);
    const v = own ? validateFixedLine(spec.key, own) : null;
    out[spec.key] = v && v.ok && v.value ? v.value : spec.standard;
  }
  return out;
}

const STANDARD_LINES = resolveFixedLines(null);

/** Fill the gaps. `lines` is resolveFixedLines() output; anything missing falls back to standard. */
function renderFixedLine(key, lines, facts = {}) {
  const spec = BY_KEY.get(key);
  if (!spec) return '';
  const tpl = (lines && lines[key]) || spec.standard;
  return tpl.replace(GAP_RE, (whole, name) => {
    const k = name.trim().toLowerCase();
    const fact = facts[k];
    return fact != null && String(fact).trim() ? String(fact).trim() : whole;
  });
}

/** The line as the client would see it in a real message - for the setup page and chat replies. */
function exampleFor(key, lines) {
  const spec = BY_KEY.get(key);
  return spec ? renderFixedLine(key, lines, spec.sample) : '';
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** A template as a forgiving matcher: gaps match anything short, spacing and case are ignored. */
function templateRegex(tpl) {
  const parts = String(tpl).split(GAP_RE).filter((_, i) => i % 2 === 0); // the static text between gaps
  const src = parts.map((p) => escapeRe(p.trim()).replace(/\s+/g, '\\s*')).filter(Boolean).join('.{1,80}?');
  return src ? new RegExp(src, 'i') : null;
}

/**
 * Patterns that mark a message as "this offered times", from the wording in force.
 * Only the two list lines count - the invite line also appears in messages with no time list.
 */
function offerMarkers(lines) {
  const seen = new Set();
  const out = [];
  for (const src of [STANDARD_LINES, lines || {}]) {
    for (const key of ['times_question_line', 'times_zone_line']) {
      const tpl = src[key];
      if (!tpl || seen.has(tpl)) continue;
      seen.add(tpl);
      // A very short custom line ("Any good?") is too weak a signal to hang a guard on.
      if (tpl.replace(GAP_RE, '').replace(/[^a-z]/gi, '').length < 12) continue;
      const re = templateRegex(tpl);
      if (re) out.push(re);
    }
  }
  return out;
}

/**
 * The list itself: two or more dated slots with clock times. Wording-proof and newline-proof
 * (LinkedIn flattens line breaks on some reads), so it is the backstop under offerMarkers.
 * Two, not one: "confirmed for Tue 3 Nov, 2:00 pm" is a booking, not an offer.
 */
function hasTimeList(text) {
  const slots = extractOfferedTimes(String(text || '')).filter((s) => /\b(am|pm)$/i.test(s.label));
  return slots.length >= 2;
}

/** Does this message offer times, as far as the wording in force and the list itself can tell? */
function looksLikeTimesOffer(text, lines) {
  const t = String(text || '');
  if (!t.trim()) return false;
  return offerMarkers(lines).some((re) => re.test(t)) || hasTimeList(t);
}

// Words that give a line away when an INSTRUCTION talks about it ("capital A in All times are
// Brisbane time"). Deliberately the distinctive middle of each sentence, not the whole of it.
const TELLS = {
  times_question_line: /following times work|would any of the(se| following) times/i,
  times_zone_line: /\(?\ball times (are|in)\b/i,
  invite_line: /which suits,? and i['’]ll send|let me know which suits|calendar invite (with|including) the (zoom|teams|meet|call) link/i,
  invite_line_no_email: /best email to send it to/i,
};

/**
 * Which fixed lines does this text (an instruction body someone is about to save) talk about?
 * Checks the standard wording's tells and the client's own current wording.
 * @returns {string[]} fixed-line keys, in FIXED_LINES order
 */
function fixedLinesMentioned(text, lines) {
  const t = String(text || '');
  if (!t.trim()) return [];
  const hit = [];
  for (const spec of FIXED_LINES) {
    const own = lines && lines[spec.key] && lines[spec.key] !== spec.standard ? templateRegex(lines[spec.key]) : null;
    if (TELLS[spec.key].test(t) || (own && own.test(t))) hit.push(spec.key);
  }
  // The two invite lines share an opening; mentioning one is mentioning both.
  if (hit.includes('invite_line') && !hit.includes('invite_line_no_email')) hit.push('invite_line_no_email');
  return FIXED_LINES.map((l) => l.key).filter((k) => hit.includes(k));
}

/**
 * The note a write door shows when an instruction touches a line Wingguy writes itself.
 * Written for the client's Claude to relay. '' when nothing is touched.
 */
function fixedLineNote(text, lines) {
  const keys = fixedLinesMentioned(text, lines);
  if (!keys.length) return '';
  const rows = keys.map((k) => `- ${BY_KEY.get(k).label} (wingguy_variables set_key="${k}")\n    now: ${(lines && lines[k]) || BY_KEY.get(k).standard}`);
  return [
    'HEADS UP - PART OF THIS CANNOT WORK AS AN INSTRUCTION ON ITS OWN.',
    'In LinkedIn drafts that offer meeting times, Wingguy writes these lines itself, after the draft is written, so a writing instruction never reaches them there:',
    ...rows,
    'To change how one of them reads, save the new wording with wingguy_variables (set_key as shown, set_value = the whole line, keeping any [city] or [email] gap exactly as written). That holds in every LinkedIn draft from then on. Blank puts the standard wording back.',
    'Tell the human this plainly, show them the line as it is now and as it would read, and make that change on their yes. The instruction can still be saved as well - it does apply where the message is written whole, such as an email draft in Claude.',
  ].join('\n');
}

module.exports = {
  FIXED_LINES,
  FIXED_LINE_KEYS,
  STANDARD_LINES,
  MAX_LEN,
  isFixedLineKey,
  validateFixedLine,
  resolveFixedLines,
  renderFixedLine,
  exampleFor,
  offerMarkers,
  hasTimeList,
  looksLikeTimesOffer,
  fixedLinesMentioned,
  fixedLineNote,
};
