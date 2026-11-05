/**
 * bannedWords - a client's "words you never use" list, read and enforced in code.
 *
 * The list is the `never_say_words` setting (the "Any words or phrases you would never be caught
 * using?" box on the setup page). Until 6 Nov 2026 it was only ever TEXT in the instructions the
 * drafter reads: the model usually obeyed, nothing checked. David Gould, 5 Nov 2026: a draft to
 * Barrie East used "folks". His box was empty - "never use folks" said in Claude had gone into the
 * wording of his writing-voice instruction instead, as a "starting default" in the middle of 7,000
 * characters - and no code looked at the draft either way.
 *
 * "Banned" has to mean never, so the check is code: the draft door refuses a draft that contains
 * a listed word and the model writes it again. Pure functions only; the door and the tool own the
 * reads and writes.
 */

const MAX_TERM_CHARS = 50;
const MAX_TERM_WORDS = 7;

function cleanTerm(raw) {
  let t = String(raw || '').replace(/\s+/g, ' ').trim();
  // Bullets, list numbers and a leading "and"/"or" left over from a sentence-style list.
  t = t.replace(/^[-*•·–—]+\s*/, '').replace(/^\d+[.)]\s*/, '').replace(/^(and|or)\s+/i, '');
  // Wrapping quotes and trailing punctuation.
  t = t.replace(/^["'“”‘’`]+/, '').replace(/["'“”‘’`]+$/, '').replace(/[.,;:!]+$/, '').trim();
  t = t.replace(/^["'“”‘’`]+/, '').replace(/["'“”‘’`]+$/, '').trim();
  return t;
}

/**
 * The setting's free text -> a clean list of words and short phrases. People type this box by
 * hand ("reach out, folks," / one per line / with headings like "Barclays:"), so anything that is
 * not plainly a word or short phrase is LEFT OUT rather than guessed at: a heading, a sentence, a
 * description ("no em dashes", "words like leverage"). Left-out items still reach the drafter as
 * text, exactly as before - they are just not enforced in code.
 */
function parseBannedList(value) {
  // A list split under headings ("FindMe First:" / "Barclays:") is one list PER heading - the
  // client bans different words for different businesses. Code cannot tell which business a draft
  // is for, so only the words under EVERY heading are enforced; the rest stay as text.
  const text = String(value || '');
  const sections = [];
  let cur = null;
  let sawHeading = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^[^,;]{1,60}:\s*$/.test(line.trim())) { sawHeading = true; cur = []; sections.push(cur); continue; }
    if (!cur) { cur = []; sections.push(cur); }
    cur.push(line);
  }
  const lists = sections.map((lines) => parseFlatList(lines.join('\n'))).filter((l) => l.length);
  if (!sawHeading || lists.length < 2) return parseFlatList(text);
  const rest = lists.slice(1).map((l) => new Set(l.map((t) => t.toLowerCase())));
  return lists[0].filter((t) => rest.every((s) => s.has(t.toLowerCase())));
}

function parseFlatList(value) {
  const out = [];
  const seen = new Set();
  for (const piece of String(value || '').split(/[,;\n\r]+|\s[·•|]\s/)) {
    if (/:\s*$/.test(piece.trim())) continue; // a heading ("FindMe First:")
    const term = cleanTerm(piece);
    if (!term) continue;
    if (term.length > MAX_TERM_CHARS || term.split(' ').length > MAX_TERM_WORDS) continue;
    if (!/[a-z]/i.test(term)) continue;
    if (/:/.test(term)) continue; // "banned list: leverage" - a label glued to a word
    if (/["“”]/.test(term)) continue; // quotes left inside = a sentence about words, not a word
    if (/^(no|words?|phrases?|any|anything|sentences?)\s/i.test(term)) continue; // a description, not a word
    const key = term.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(term);
  }
  return out;
}

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function termRegex(term) {
  const body = escapeRe(term).replace(/ /g, '\\s+').replace(/['’]/g, "['’]");
  return new RegExp(`(?<![A-Za-z0-9])${body}(?![A-Za-z0-9])`, 'i');
}

/**
 * The first banned word in a piece of text, or null. Whole words only ("folks" does not match
 * "folksy"; "honest" does not match "honestly"), any capitalisation.
 *
 * `exempt` is text the word is allowed to come from - the lead's own name, headline and company.
 * A client who bans "solutions" must still be able to write to someone at Acme Solutions.
 */
function findBannedWord(text, terms, { exempt = '' } = {}) {
  const hay = String(text || '');
  if (!hay.trim()) return null;
  const ex = String(exempt || '');
  for (const term of Array.isArray(terms) ? terms : []) {
    if (!term) continue;
    const re = termRegex(term);
    const m = hay.match(re);
    if (!m) continue;
    if (ex && re.test(ex)) continue;
    return { term, found: m[0] };
  }
  return null;
}

/** What the drafter is told when its draft is refused. */
function bannedWordRefusal(hit, coachFirst = 'the coach') {
  return `REJECTED - draft NOT set. It uses "${hit.found}", which is on ${coachFirst}'s banned-words list ("${hit.term}"). That list is absolute - no exceptions, no "but it fits here". Write the message again without it: say the same thing another way, do not just swap in a near-twin of the word, and do not mention the ban to anyone. Then call the same tool again.`;
}

/**
 * Add words to the setting's text without disturbing what is there (headings, notes and all).
 * Returns { value, added, already }.
 */
function addToList(value, words) {
  const current = String(value || '').trim();
  const have = new Set(parseBannedList(current).map((t) => t.toLowerCase()));
  const added = [];
  const already = [];
  for (const w of Array.isArray(words) ? words : [words]) {
    const term = cleanTerm(w);
    if (!term) continue;
    const key = term.toLowerCase();
    if (have.has(key)) { already.push(term); continue; }
    have.add(key);
    added.push(term);
  }
  if (!added.length) return { value: current, added, already };
  const base = current.replace(/[,\s]+$/, '');
  return { value: base ? `${base}, ${added.join(', ')}` : added.join(', '), added, already };
}

/** Take words off the list. Returns { value, removed, missing }. */
function removeFromList(value, words) {
  let current = String(value || '');
  const removed = [];
  const missing = [];
  for (const w of Array.isArray(words) ? words : [words]) {
    const term = cleanTerm(w);
    if (!term) continue;
    const re = new RegExp(`(^|[,;\\n\\r])[ \\t]*["'“‘]?${escapeRe(term)}["'”’]?[ \\t]*(?=[,;\\n\\r]|$)`, 'i');
    if (re.test(current)) {
      current = current.replace(re, (whole, lead) => (lead === '\n' || lead === '\r' ? lead : ''));
      removed.push(term);
    } else missing.push(term);
  }
  current = current.replace(/^[,;\s]+/, '').replace(/[,;]\s*(?=[,;])/g, '').replace(/[ \t]+,/g, ',').replace(/[,;\s]+$/, '').trim();
  return { value: current, removed, missing };
}

module.exports = { parseBannedList, findBannedWord, bannedWordRefusal, addToList, removeFromList, cleanTerm };

/**
 * The text of an email that the ban applies to: the subject plus the body the coach is sending.
 * Left out on purpose - quoted material (a <blockquote> is someone else's words, or the thread
 * being replied to) and web addresses (a link is not something the coach "said").
 * `toText` turns HTML into plain text (the mail door's own htmlToText).
 */
function emailCheckText(subject, html, toText) {
  let body = String(html || '').replace(/<blockquote[\s\S]*?<\/blockquote>/gi, ' ');
  body = typeof toText === 'function' ? toText(body) : body.replace(/<[^>]+>/g, ' ');
  const text = `${String(subject || '')}\n${body}`;
  return text.replace(/\bhttps?:\/\/\S+/gi, ' ').replace(/\bwww\.\S+/gi, ' ').replace(/\S+@\S+\.\S+/g, ' ');
}

/** What Claude is told when an email draft is refused. */
function bannedWordEmailRefusal(hit, who = 'their') {
  return `Draft NOT created - the email uses "${hit.found}", which is on ${who} banned-words list ("${hit.term}"). That list is absolute. Rewrite the email without it - say the same thing another way, do not swap in a near-twin of the word - and call wingguy_create_draft again. Do not make a fuss about it to the human: one short line that you reworded it is enough. ONLY if the human wrote that exact wording themselves, or tells you to keep it, call again with banned_words_ok: true.`;
}

module.exports.emailCheckText = emailCheckText;
module.exports.bannedWordEmailRefusal = bannedWordEmailRefusal;
