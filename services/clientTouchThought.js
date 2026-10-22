// services/clientTouchThought.js
//
// "A thought for the week" - Guy, 22 Oct 2026: "how about some words of wisdom/value add as well".
// Every weekly client email whose body is NOT a one-pager piece (an offer of times for a call, a
// setup step, a one-off, a habit email) carries two or three sentences lifted WORD FOR WORD from
// an approved piece (status final), introduced "A thought for the week:". The sentences per piece
// live in config/clientTouchNuggets.json (Guy can change any of them); tests/client-touch-planner
// checks each still appears verbatim in its piece, so an edit to a piece cannot leave a misquote.
//
// Which one: the piece that fits where the client is (their journey stop, the problems on recent
// calls), never one they have had in full in the last 8 weeks, never one already used as a thought
// in the last 8 weeks, never the piece going this week or in their likely-next for the next two
// weeks. Ties are broken by a stable per-client-per-week shuffle, so clients do not all get the same.
// Pure.

const fs = require('fs');
const path = require('path');

const DAY = 86400000;
const RECENT_DAYS = 56;   // 8 weeks

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
 * Choose this week's thought for one client.
 * @param {object} facts   the planner's facts (stuckStop, callProblems)
 * @param {object[]} shelf listPieces() - slug, title, status, labels
 * @param {object[]} record that client's touch rows (kind, key, form, sent_at, meta)
 * @param {{ nuggets, exclude: Iterable<string>, now, seed }} opts
 * @returns {{ slug, title, text } | null}
 */
function chooseThought(facts, shelf, record, { nuggets = loadNuggets(), exclude = [], now = Date.now(), seed = '' } = {}) {
  const skip = new Set(exclude);
  const cutoff = now - RECENT_DAYS * DAY;
  for (const r of record || []) {
    const at = t(r.sent_at);
    if (at === null || at < cutoff) continue;
    if ((r.kind === 'one-pager' || r.kind === 'habit') && r.form !== 'short') skip.add(r.key);
    if (r.meta && r.meta.thought) skip.add(r.meta.thought);
  }
  const stop = facts && facts.stuckStop;
  const problems = new Set((facts && facts.callProblems) || []);
  const candidates = (shelf || [])
    .filter((p) => p && p.status === 'final' && nuggets[p.slug] && !skip.has(p.slug))
    .map((p) => {
      const labels = p.labels || {};
      const score = ((stop && (labels.stops || []).includes(stop)) ? 2 : 0)
        + (labels.problems || []).filter((x) => problems.has(x)).length;
      return { p, score, tie: hash(`${seed}|${p.slug}`) };
    })
    .sort((a, b) => b.score - a.score || a.tie - b.tie);
  if (!candidates.length) return null;
  const { p } = candidates[0];
  return { slug: p.slug, title: p.title, text: nuggets[p.slug] };
}

module.exports = { chooseThought, loadNuggets, plainText, RECENT_DAYS };
