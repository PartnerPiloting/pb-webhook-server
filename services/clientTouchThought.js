// services/clientTouchThought.js
//
// "A thought for the week" - Guy, 22 Oct 2026: "how about some words of wisdom/value add as well".
// Every weekly client email whose body is NOT a one-pager piece (an offer of times for a call, a
// setup step, a one-off, a habit email) carries two or three sentences lifted WORD FOR WORD from
// an approved piece (status final), introduced "A thought for the week:". The sentences per piece
// live in config/clientTouchNuggets.json (Guy can change any of them); tests/client-touch-planner
// checks each still appears verbatim in its piece, so an edit to a piece cannot leave a misquote.
//
// Which one (Guy, 22 Oct: "look at his profile and work it out - it doesn't even matter if it's
// something that's rehashed"): the one that speaks to what is going on for the client RIGHT NOW,
// read from the same material the opening drafter reads - their recent calls with Guy, recent
// emails, their Touch Note. Claude chooses and says why in one line Guy sees on the panel. Repeats
// are fine; only two rules: never the same nugget two weeks running, never the piece that is this
// week's body. Without Claude (no key, an error) it falls back to the labels: their journey stop,
// then call problems, then a stable per-client shuffle.

const fs = require('fs');
const path = require('path');

const DAY = 86400000;
const LAST_WEEK_DAYS = 13;   // "two weeks running" - anything used as a thought in the last 13 days
const MODEL_ID = process.env.WINGGUY_DRAFT_MODEL_ID || 'claude-sonnet-5-5';

/** The nuggets: slug -> text. */
function loadNuggets(file = path.join(__dirname, '..', 'config', 'clientTouchNuggets.json')) {
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return data.nuggets || {};
  } catch (_) {
    return {};
  }
}

/** A piece's body as plain text with straight quotes - what a nugget must be found in, word for word. */
function plainText(markdown) {
  return String(markdown || '')
    .replace(/^---[\s\S]*?---/, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/[*_`]+/g, '')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function hash(s) {
  let h = 2166136261;
  for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

const t = (v) => { const x = v ? new Date(v).getTime() : NaN; return Number.isNaN(x) ? null : x; };

/**
 * The nuggets this client may get this week: every approved piece with a nugget, except this
 * week's body piece (in `exclude`) and the one they got as a thought last week. Pure.
 */
function eligible(shelf, record, { nuggets = loadNuggets(), exclude = [], now = Date.now(), library = null } = {}) {
  const skip = new Set(exclude);
  const cutoff = now - LAST_WEEK_DAYS * DAY;
  for (const r of record || []) {
    const at = t(r.sent_at);
    if (at !== null && at >= cutoff && r.meta && r.meta.thought) skip.add(r.meta.thought);
  }
  // The idea library (26 Oct 2026): when the planner offers ideas from it, the thought is one of those -
  // the idea in a line, with where it comes from (none for Guy's own Mindset Mastery notes).
  if (library && library.length) {
    return library.filter((i) => !skip.has(i.id)).map((i) => ({ slug: i.id, title: i.title, text: i.idea, credit: i.source === 'book' ? `From ${i.title}` : i.source === 'beth' ? 'From my friend Beth Berghan' : '', library: true, labels: {} }));
  }
  return (shelf || []).filter((p) => p && p.status === 'final' && nuggets[p.slug] && !skip.has(p.slug))
    .map((p) => ({ slug: p.slug, title: p.title, text: nuggets[p.slug], labels: p.labels || {} }));
}

/** The fallback choice from the labels: journey stop, then call problems, then a stable shuffle. Pure. */
function chooseThought(facts, shelf, record, { nuggets = loadNuggets(), exclude = [], now = Date.now(), seed = '', library = null } = {}) {
  const stop = facts && facts.stuckStop;
  const problems = new Set((facts && facts.callProblems) || []);
  const ranked = eligible(shelf, record, { nuggets, exclude, now, library })
    .map((c) => {
      const stopHit = !!(stop && (c.labels.stops || []).includes(stop));
      const probHits = (c.labels.problems || []).filter((x) => problems.has(x)).length;
      return { c, stopHit, score: (stopHit ? 2 : 0) + probHits, tie: hash(`${seed}|${c.slug}`) };
    })
    .sort((a, b) => b.score - a.score || a.tie - b.tie);
  if (!ranked.length) return null;
  const { c, stopHit, score } = ranked[0];
  const why = stopHit ? `fits where they are up to (the "${stop}" stop)` : score ? 'fits a problem from a recent call' : 'chosen by rotation - no call or email material to choose from';
  return { slug: c.slug, title: c.title, text: c.text, why, source: 'labels', ...(c.library ? { library: true, credit: c.credit } : {}) };
}

/** The prompt for Claude's choice. Pure. */
function buildChoicePrompt({ client, note, meetings, emails, candidates, pieceThisWeek, today }) {
  const system = [
    "You choose the 'thought for the week' that goes at the end of a short weekly email from Guy Wilson - a network-building coach - to one of his clients. Guy reads every email before it is sent.",
    'Read what is going on for this client RIGHT NOW - their recent calls with Guy, recent emails, and the note Guy keeps about them - and pick the ONE thought below that would speak to them most this week: their pressures, what they are stuck on, what they are trying to do. It is fine if they have read the piece before.',
    "The thought sits at the end of this week's email, so it must ADD something - a different angle from what this week's email already says, never the same point in other words.",
    'Answer with ONE JSON object and nothing else: {"slug": "<the chosen slug>", "why": "<one plain line for Guy, under 40 words: what in their world this speaks to, concrete, from the material>"}. Never invent facts that are not in the material.',
  ].join('\n');
  const lines = [`Today is ${today}.`, `CLIENT: ${client.clientName}.`];
  if (pieceThisWeek) lines.push(`This week's email is: ${pieceThisWeek}.`);
  lines.push('', 'NOTE GUY KEEPS ABOUT THEM:', note && String(note).trim() ? String(note).trim() : '(none)');
  lines.push('', `RECENT CALLS WITH GUY (newest first; ${meetings && meetings.length ? meetings.length : 'none'}):`);
  for (const m of meetings || []) {
    lines.push(`--- ${m.date || '(no date)'} ${m.title || ''}`);
    if (m.summary) lines.push(`Summary: ${m.summary}`);
    if (m.transcript) lines.push(`Transcript (head): ${m.transcript}`);
  }
  lines.push('', 'RECENT EMAIL (YOU = Guy, THEM = the client):');
  if (emails && emails.length) for (const e of emails) lines.push(`- ${e.date} ${e.dir === 'them' ? 'THEM' : 'YOU'}: [${e.subject}] ${e.text}`);
  else lines.push('(none found)');
  lines.push('', 'THE THOUGHTS TO CHOOSE FROM (slug: text):');
  for (const c of candidates) lines.push(`- ${c.slug}: ${c.text}`);
  return { system, user: lines.join('\n') };
}

function parseChoice(text, candidates) {
  const m = String(text || '').match(/\{[\s\S]*\}/);
  if (!m) throw new Error('no JSON object in the reply');
  const j = JSON.parse(m[0]);
  const hit = candidates.find((c) => c.slug === String(j.slug || '').trim());
  if (!hit) throw new Error(`"${j.slug}" is not one of the thoughts offered`);
  const why = String(j.why || '').replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim();
  return { slug: hit.slug, title: hit.title, text: hit.text, why: why || 'chosen for what is going on for them now', source: 'llm', ...(hit.library ? { library: true, credit: hit.credit } : {}) };
}

/**
 * The thought for one client this week, chosen from their own world. Never throws: any failure
 * falls back to the labels (chooseThought). `material` = { meetings, emails, note } - the same the
 * opening drafter read. `llm` = an Anthropic client (or null).
 */
async function chooseThoughtForClient({ facts, shelf, record, material = {}, client, exclude = [], now = Date.now(), seed = '', llm = null, pieceThisWeek = '', nuggets = loadNuggets(), logger = null, library = null }) {
  const candidates = eligible(shelf, record, { nuggets, exclude, now, library });
  if (!candidates.length) return null;
  const hasMaterial = (material.meetings && material.meetings.length) || (material.emails && material.emails.length) || (material.note && String(material.note).trim());
  if (llm && hasMaterial) {
    try {
      const prompt = buildChoicePrompt({ client, note: material.note, meetings: material.meetings, emails: material.emails, candidates, pieceThisWeek, today: new Date(now).toISOString().slice(0, 10) });
      const response = await llm.messages.create({
        model: MODEL_ID,
        // Room for the model's thinking as well as the answer (a tight max_tokens cut replies off, 22 Oct).
        max_tokens: 16000,
        output_config: { effort: 'low' },
        system: prompt.system,
        messages: [{ role: 'user', content: prompt.user }],
      });
      const text = (response.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
      return parseChoice(text, candidates);
    } catch (e) {
      if (logger) logger.warn(`thought choice for ${client && client.clientId} fell back to the labels: ${e.message}`);
    }
  }
  return chooseThought(facts, shelf, record, { nuggets, exclude, now, seed, library });
}

module.exports = { chooseThought, chooseThoughtForClient, eligible, buildChoicePrompt, parseChoice, loadNuggets, plainText, LAST_WEEK_DAYS };
