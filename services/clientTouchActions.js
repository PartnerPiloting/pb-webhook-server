// services/clientTouchActions.js
//
// Guy's verdicts on the weekly client emails - approve, edit, swap, skip, pin, change the thought -
// in one place, used by the web routes (routes/clientTouchRoutes.js) and by the chat tool Guy runs
// the weekly review with (wingguy_weekly_emails, services/wingguyRulesMcp.js). Since 22 Oct 2026 the
// review happens in chat, not on a panel ("let me go through, approve, change, swap and skip the
// weekly emails here in chat with you"). Every action says back, in plain words, exactly what changed.
//
// Nothing here sends anything. Sending stays the Monday 8am run (approved only, re-checked first).

const planStore = require('./clientTouchPlanStore');
const clientService = require('./clientService');

const DASHES = /[–—]/g;
const clean = (s) => String(s == null ? '' : s).replace(DASHES, '-').trim();

/** "Monday 26 Oct" for a plan week. */
function dayLabel(week) {
  const d = new Date(`${week}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? String(week) : new Intl.DateTimeFormat('en-AU', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'short' }).format(d);
}

/** The Monday Guy is working towards (or the one asked for). */
function weekOrDefault(week) {
  const w = String(week || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(w)) return w;
  return planStore.planningWeek(new Date(), require('./clientTouchPlanner').SEND_HOUR);
}

/** One of the coach's own clients, by name or id. Returns { client } or { error }. */
async function resolveClient(coachClientId, query, deps = {}) {
  const cs = deps.clientService || clientService;
  const all = await cs.getAllClients();
  const mine = all.filter((c) => c.coach && c.coach === coachClientId);
  const q = clean(query).toLowerCase();
  if (!q) return { error: 'Which client? Give a name or client id.' };
  const exact = mine.filter((c) => (c.clientId || '').toLowerCase() === q || (c.clientName || '').toLowerCase() === q);
  const hits = exact.length ? exact : mine.filter((c) => (c.clientId || '').toLowerCase().includes(q) || (c.clientName || '').toLowerCase().includes(q));
  if (!hits.length) return { error: `No client of yours matched "${query}". Your clients: ${mine.map((c) => c.clientName).join(', ')}.` };
  if (hits.length > 1) return { error: `"${query}" matched several: ${hits.map((c) => `${c.clientName} (${c.clientId})`).join(', ')}. Use the exact client id.` };
  return { client: hits[0] };
}

/** Paragraphs of Guy's words -> HTML. Blank line between paragraphs; single line breaks kept. */
function wordsToHtml(text) {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return clean(text).split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean).map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('\n');
}

/** An approved piece by slug or title (approximate match). Returns the listPieces() entry or null. */
function findPiece(query, pieces = require('./onePagerContent').listPieces()) {
  const q = clean(query).toLowerCase();
  if (!q) return null;
  const approved = pieces.filter((p) => p.status === 'final');
  const { ORIENTATION } = require('../config/clientTouchLabels');
  const all = [{ slug: ORIENTATION.slug, title: "What you've actually joined", status: 'final', labels: ORIENTATION }, ...approved];
  return all.find((p) => p.slug.toLowerCase() === q || p.title.toLowerCase() === q)
    || all.find((p) => p.slug.toLowerCase().includes(q) || p.title.toLowerCase().includes(q))
    || null;
}

/** A row that exists and still has an email to act on. */
async function rowFor(week, clientId, ps = planStore) {
  const row = await ps.planFor(week, clientId);
  if (!row) return { error: `There is no plan row for them for ${dayLabel(week)} yet - it builds on the Monday before, or ask to build it.` };
  if (row.status === 'sent') return { error: `Their ${dayLabel(week)} email has already gone.` };
  return { row };
}

const titleOf = (row) => (row && row.pick && row.pick.what ? row.pick.what.title : 'nothing');

/**
 * Why a row cannot be approved yet, or null. A personal note is owed first; or the fact guard found
 * a claim the brief and the facts do not support (Guy can say "approve anyway" - he has checked).
 */
function approveBlocked(row, { override = false } = {}) {
  if (!row || !row.pick) return null;
  if (require('./clientTouchPlanner').firstThingsOpen(row.pick)) return 'Send your personal note first (or dismiss the flag) - you owe them something important, so the weekly email waits.';
  if (!override && row.pick.guard && row.pick.guard.ok === false) return `The fact guard found: ${row.pick.guard.problems.join('; ')}. Reword it, or approve anyway if you have checked.`;
  return null;
}

async function approve(coachClientId, clientId, { week, override = false } = {}, deps = {}) {
  const ps = deps.planStore || planStore;
  const w = weekOrDefault(week);
  const { row, error } = await rowFor(w, clientId, ps);
  if (error) return { ok: false, said: error };
  if (!row.pick || !row.pick.what) return { ok: false, said: `There is nothing to approve - ${dayLabel(w)} is a quiet week for them (${row.pick ? row.pick.reason : 'no pick'}).` };
  if (row.pick.body && (row.pick.body.error || row.pick.body.missing)) return { ok: false, said: `It can't be approved yet - the body isn't built (${row.pick.body.error || 'no text yet'}). Edit the body or swap it.` };
  const blocked = approveBlocked(row, { override });
  if (blocked) return { ok: false, said: `Not approved. ${blocked}` };
  if (override && row.pick.guard && row.pick.guard.ok === false && ps.setPlanPickField) {
    await ps.setPlanPickField(w, clientId, 'guard', { ...row.pick.guard, overriddenAt: new Date().toISOString() });
  }
  const out = await ps.setPlanStatus(w, clientId, 'approved', { hold: null });
  return { ok: true, row: out, said: `Approved${override ? ' (anyway - you checked the fact guard)' : ''}: "${titleOf(row)}" for ${dayLabel(w)}. It goes at 8am that Monday after a fresh check that nothing has changed.` };
}

/** "Send a personal note first": Guy sent it himself (action 'sent', with what he sent) or it is not needed ('dismiss'). */
async function firstThings(coachClientId, clientId, { week, action, text = '' } = {}, deps = {}) {
  const w = weekOrDefault(week);
  const a = String(action || '').toLowerCase();
  if (!['sent', 'dismiss'].includes(a)) return { ok: false, said: 'Say whether you sent the personal note (sent) or it is not needed (dismiss).' };
  try {
    const row = await (deps.resolveFirstThings || require('./clientTouchPlanner').resolveFirstThings)(w, clientId, { action: a, text: clean(text) });
    return { ok: true, row, said: a === 'sent' ? `Noted: you sent them the personal note. Their ${dayLabel(w)} email can now be approved.` : `Dismissed: no personal note needed. Their ${dayLabel(w)} email can now be approved.` };
  } catch (e) {
    return { ok: false, said: e.message };
  }
}

async function edit(coachClientId, clientId, { week, opening, subject, body, congrats } = {}, deps = {}) {
  const ps = deps.planStore || planStore;
  const w = weekOrDefault(week);
  const { row, error } = await rowFor(w, clientId, ps);
  if (error) return { ok: false, said: error };
  if (!row.pick || !row.pick.what) return { ok: false, said: `There is no email to edit for ${dayLabel(w)} - it's a quiet week for them. Swap in a piece or a custom email first.` };
  const changed = [];
  if (typeof congrats === 'string') { await ps.setPlanCongrats(w, clientId, clean(congrats)); changed.push(congrats.trim() ? 'the Congratulations line' : 'the Congratulations line (removed)'); }
  const fields = { hold: null };
  if (typeof opening === 'string') { fields.opening = clean(opening); changed.push('the opening'); }
  if (typeof subject === 'string' && clean(subject)) { fields.subject = clean(subject); changed.push('the subject'); }
  if (typeof body === 'string' && clean(body)) {
    // A custom email is all Guy's words: its body as plain paragraphs, the way it was drafted.
    fields.bodyHtml = row.pick.what.kind === 'custom'
      ? require('./clientTouchBrief').paragraphsHtml(clean(body).split(/\n\s*\n/).map((x) => x.replace(/\s*\n\s*/g, ' ').trim()).filter(Boolean))
      : wordsToHtml(body);
    changed.push('the body');
  }
  if (!changed.length) return { ok: false, said: 'Nothing to change - give the new opening, subject, body or Congratulations line.' };
  // His words are checked like the drafts were: the fact guard reads them again before approving.
  await ps.setPlanStatus(w, clientId, 'proposed', fields);
  let guard = null;
  try { guard = await (deps.recheckGuard || require('./clientTouchPlanner').recheckGuard)(w, clientId); } catch (_) { guard = null; }
  const after = await ps.planFor(w, clientId);
  const blocked = approveBlocked(after);
  if (blocked) return { ok: true, approved: false, blocked, row: after, said: `Changed ${changed.join(', ')} of "${titleOf(row)}" for ${dayLabel(w)}, in your words - but NOT approved yet. ${blocked}` };
  const out = await ps.setPlanStatus(w, clientId, 'edited', { hold: null });
  return { ok: true, approved: true, guard, row: out, said: `Changed ${changed.join(', ')} of "${titleOf(row)}" for ${dayLabel(w)}, in your words - and approved it. It goes at 8am that Monday after a fresh check.` };
}

/**
 * A different email this week: an approved piece (by name) or a custom one in Guy's words
 * (title + text). Rebuilt for them with a fresh opening; waits for approval again.
 */
async function swap(coachClientId, clientId, { week, piece, title, text } = {}, deps = {}) {
  const ps = deps.planStore || planStore;
  const w = weekOrDefault(week);
  const { row, error } = await rowFor(w, clientId, ps);
  if (error && !/no plan row/.test(error)) return { ok: false, said: error };
  let pin;
  if (clean(text)) {
    const t = clean(title) || 'A note from Guy';
    pin = { kind: 'one-off', key: `custom:${t.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 50)}`, title: t, bodyHtml: wordsToHtml(text) };
  } else {
    const p = findPiece(piece, deps.pieces);
    if (!p) return { ok: false, said: `"${piece}" isn't an approved piece. Name one of the approved pieces, or give a title and your own text for a custom email.` };
    pin = { kind: p.labels && p.labels.kind === 'habit' ? 'habit' : 'one-pager', key: p.slug, title: p.title };
  }
  await ps.setPin({ clientId, weekOf: w, ...pin });
  if (row) await ps.setPlanStatus(w, clientId, 'proposed', { hold: null });
  const build = deps.buildPlan || require('./clientTouchPlanner').buildPlan;
  const plan = await build(coachClientId, { weekOf: w, clientIds: [clientId], force: true });
  const fresh = plan.rows[0] || null;
  return { ok: true, row: fresh, said: `Swapped: ${dayLabel(w)} is now "${pin.title}"${pin.kind === 'one-off' ? ' (your own words)' : ''}${row && row.pick && row.pick.what ? `, instead of "${titleOf(row)}"` : ''}, with a fresh opening. It is waiting for your approval.` };
}

async function skip(coachClientId, clientId, { week, whyNot, home, until } = {}, deps = {}) {
  const ps = deps.planStore || planStore;
  const w = weekOrDefault(week);
  const { row, error } = await rowFor(w, clientId, ps);
  if (error) return { ok: false, said: error };
  const words = clean(whyNot);
  const lines = [`Skipped: nothing goes to them on ${dayLabel(w)}${row.pick && row.pick.what ? ` ("${titleOf(row)}" will not be sent)` : ''}.`];
  if (until && /^\d{4}-\d{2}-\d{2}$/.test(until)) { await ps.setSkip(clientId, until, words); lines.push(`Nothing more until ${until}.`); }
  const out = await ps.setPlanStatus(w, clientId, 'skipped', { whyNot: words || null, whyNotHome: home || null });
  if (words && home) {
    const filed = await fileWhyNot(coachClientId, { weekOf: w, clientId, pieceKey: row.pick && row.pick.what ? row.pick.what.key : null, home, words }, deps);
    lines.push(filed.applied ? `Your why-not is filed to ${filed.where}.` : `Your why-not is noted - it goes to ${filed.where} the next time the laptop files feedback.`);
  } else if (words) lines.push('Your reason is kept on the row.');
  return { ok: true, row: out, said: lines.join(' ') };
}

/** Pin a piece (or a custom email) for a coming Monday - by default the one after the week being worked on. */
async function pin(coachClientId, clientId, { week, piece, title, text } = {}, deps = {}) {
  const ps = deps.planStore || planStore;
  const w = /^\d{4}-\d{2}-\d{2}$/.test(String(week || '')) ? week : planStore.addWeeks(weekOrDefault(null), 1);
  let p;
  if (clean(text)) {
    const t = clean(title) || 'A note from Guy';
    p = { kind: 'one-off', key: `custom:${t.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 50)}`, title: t, bodyHtml: wordsToHtml(text) };
  } else {
    const found = findPiece(piece, deps.pieces);
    if (!found) return { ok: false, said: `"${piece}" isn't an approved piece. Name one, or give a title and your own text.` };
    p = { kind: found.labels && found.labels.kind === 'habit' ? 'habit' : 'one-pager', key: found.slug, title: found.title };
  }
  await ps.setPin({ clientId, weekOf: w, ...p });
  return { ok: true, said: `Pinned: "${p.title}" goes to them on ${dayLabel(w)} (it shows when that Monday's plan builds; you still approve it).` };
}

async function setThought(coachClientId, clientId, { week, piece, why } = {}, deps = {}) {
  const ps = deps.planStore || planStore;
  const w = weekOrDefault(week);
  const { row, error } = await rowFor(w, clientId, ps);
  if (error) return { ok: false, said: error };
  if (!clean(piece) || /^(none|no thought|remove)$/i.test(clean(piece))) {
    await ps.setPlanThought(w, clientId, null);
    return { ok: true, said: `No thought for the week in their ${dayLabel(w)} email.` };
  }
  const thoughts = require('./clientTouchThought');
  const nuggets = thoughts.loadNuggets();
  const p = findPiece(piece, deps.pieces);
  if (!p || !nuggets[p.slug]) return { ok: false, said: `"${piece}" has no thought for the week. The thoughts come from: ${Object.keys(nuggets).join(', ')}.` };
  const thought = { slug: p.slug, title: p.title, text: nuggets[p.slug], why: clean(why) || 'your choice', source: 'guy' };
  await ps.setPlanThought(w, clientId, thought);
  return { ok: true, said: `Thought for the week in their ${dayLabel(w)} email is now from "${p.title}": "${thought.text}"${row.status === 'approved' || row.status === 'edited' ? ' (still approved)' : ''}.` };
}

/** Where a "why not" goes (the Tuning-by-approval table), applied at once where it can be. */
async function fileWhyNot(coachClientId, { weekOf, clientId, pieceKey, home, words }, deps = {}) {
  const ps = deps.planStore || planStore;
  const cs = deps.clientService || clientService;
  const w = clean(words);
  if (!w) throw new Error('words are required');
  const target = ps.feedbackHome(home);
  let filedWhere = target.where;
  let filedAt = null;
  if (target.home === 'person' && clientId) {
    const client = await cs.getClientById(clientId);
    if (client && client.coach === coachClientId) {
      const r = await cs.updateTouchNote(client.id, appendNote(client.touchNote, w));
      if (r.success) { filedAt = new Date(); filedWhere = `Touch Note on ${client.clientName}'s record`; }
    }
  } else if (target.home === 'openings') {
    await ps.addOpeningRule(w, `guy ${weekOf || ''}`.trim());
    filedAt = new Date();
    filedWhere = 'the opening instructions (used from next week)';
  }
  const fb = await ps.addFeedback({ weekOf, clientId, pieceKey, home: target.home, words: w, filedWhere, filedAt });
  return { id: fb ? fb.id : null, home: target.home, where: filedWhere, applied: !!filedAt, laptop: !filedAt };
}

function appendNote(existing, line) {
  const today = new Date().toISOString().slice(0, 10);
  const base = String(existing || '').trim();
  return `${base ? `${base}\n` : ''}${today}: ${line}`;
}

module.exports = { approveBlocked, firstThings, approve, edit, swap, skip, pin, setThought, fileWhyNot, appendNote, resolveClient, findPiece, wordsToHtml, weekOrDefault, dayLabel };
