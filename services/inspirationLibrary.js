/**
 * The idea library for the weekly client emails (Guy, 25 Oct 2026) - content/inspiration-library.json.
 *
 * Every weekly idea email carries ONE idea from here: a book, one of Guy's Mindset Mastery editions, or
 * one of Beth Berghan's emails (Guy rated those Best / Good / Skip - Skip never goes). This module turns
 * the library into a short MENU for one client: ideas they have not had, best first, mixed across the
 * three sources. The drafter picks one and says which; the planner records its id on the touch, so the
 * next week's menu leaves it out.
 *
 * "Already had" is read two ways: the idea id on a touch (every email from 26 Oct on), and - for the
 * emails written by hand before that - the book's title or author, or Beth's subject, appearing in what
 * they were sent. Over-cautious by design: a near miss leaves an idea out, never sends it twice.
 */

const path = require('path');
const fs = require('fs');

const FILE = path.join(__dirname, '..', 'content', 'inspiration-library.json');
// Guy's top five next, after the first week's books (25 Oct 2026).
const BOOKS_FIRST = new Set(['never-eat-alone', 'who-not-how', 'go-giver', 'slight-edge', 'think-and-grow-rich']);

let cache = null;
function load(file = FILE) {
  if (file === FILE && cache) return cache;
  const lib = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (file === FILE) cache = lib;
  return lib;
}

/** Every idea that can go, flattened: {id, source, title, idea, angle, credit, link, rank} (rank 0 = best). Pure given the library. */
function ideas(lib = load()) {
  const out = [];
  for (const b of lib.books || []) {
    out.push({ id: `book-${b.id}`, source: 'book', title: `${b.title} by ${b.author}`, idea: b.idea, angle: b.angle, credit: `${b.author}, ${b.title}`, link: b.link || null, rank: BOOKS_FIRST.has(b.id) ? 0 : 1, match: [b.title, plainAuthor(b.author)] });
  }
  for (const m of lib.mindsetMastery || []) {
    if ((m.fit || 0) < 3) continue; // Guy's weaker fits for a networking email stay out
    out.push({ id: m.id || `mm-${m.messageId}`, source: 'mindset-mastery', title: String(m.subject || '').replace(/^Mindset Mastery:\s*/i, ''), idea: m.idea, angle: m.angle || '', credit: 'my Mindset Mastery notes', link: null, rank: m.fit >= 5 ? 0 : 1, match: [String(m.subject || '').replace(/^Mindset Mastery:\s*/i, '')] });
  }
  for (const b of lib.beth || []) {
    if (b.rating === 'skip' || !b.rating) continue; // only what Guy rated goes
    out.push({ id: b.id || `beth-${b.messageId}`, source: 'beth', title: b.subject, idea: b.idea, angle: b.angle || '', credit: b.credit || 'my friend Beth Berghan', link: null, rank: b.rating === 'best' ? 0 : 1, match: [b.subject] });
  }
  return out;
}

/** "Stephen R. Covey" -> "Stephen Covey"; "Bob Burg and John David Mann" -> "Bob Burg". Pure. */
function plainAuthor(a) {
  const first = String(a || '').split(/\s+and\s+/i)[0];
  return first.split(/\s+/).filter((w) => !/^[A-Z](\.[A-Z])*\.$/.test(w)).join(' ');
}

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

/** The ids this client has had: idea ids on their touches, and any idea whose title shows up in what they were sent. Pure. */
function hadIds({ record = [], pastTips = [] } = {}, all = ideas()) {
  const had = new Set();
  for (const r of record || []) if (r && r.meta && r.meta.idea) had.add(r.meta.idea);
  const text = norm([...(pastTips || []), ...(record || []).map((r) => (r && r.meta ? `${r.meta.subject || ''} ${r.meta.body || ''}` : ''))].join(' \n '));
  if (text) for (const i of all) if (i.match.some((m) => norm(m).length >= 6 && text.includes(norm(m)))) had.add(i.id);
  return had;
}

/** A small seeded shuffle, so two clients the same week see the menu in a different order. Pure. */
function seeded(list, seed) {
  let h = 2166136261;
  for (const ch of String(seed || '')) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  const rnd = () => { h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return ((h ^= h >>> 16) >>> 0) / 4294967296; };
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

/**
 * The menu for one client this week: up to `size` ideas they have not had, best-rated first, taken in
 * turn from each source so it is never all Beth or all books. `avoid` = ids already chosen for someone
 * else this week, only used to break ties. Pure.
 */
function menuFor({ record = [], pastTips = [], seed = '', size = 6, avoid = [] } = {}, all = ideas()) {
  const had = hadIds({ record, pastTips }, all);
  const avoidSet = new Set(avoid);
  const fresh = all.filter((i) => !had.has(i.id));
  const bySource = {};
  for (const i of seeded(fresh, seed)) (bySource[i.source] = bySource[i.source] || []).push(i);
  for (const s of Object.keys(bySource)) bySource[s].sort((a, b) => a.rank - b.rank || (avoidSet.has(a.id) ? 1 : 0) - (avoidSet.has(b.id) ? 1 : 0));
  const order = seeded(['book', 'mindset-mastery', 'beth'], `${seed}|sources`);
  const menu = [];
  while (menu.length < size && order.some((s) => (bySource[s] || []).length)) {
    for (const s of order) { const next = (bySource[s] || []).shift(); if (next && menu.length < size) menu.push(next); }
  }
  return menu;
}

/** The menu as prompt lines for the drafter. Pure. */
function menuLines(menu) {
  return menu.map((i) => `- [${i.id}] ${i.source === 'book' ? 'BOOK' : i.source === 'beth' ? "BETH BERGHAN'S EMAIL" : "GUY'S OWN MINDSET MASTERY NOTE"}: "${i.title}" - ${i.idea}${i.angle ? ` For clients: ${i.angle}` : ''} (credit: ${i.credit})${i.link ? ` [has a ${i.link.minutes}-minute talk]` : ''}`);
}

function byId(id, all = ideas()) { return all.find((i) => i.id === id) || null; }

module.exports = { load, ideas, hadIds, menuFor, menuLines, byId, plainAuthor };
