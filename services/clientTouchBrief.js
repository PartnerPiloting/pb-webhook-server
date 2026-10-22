// services/clientTouchBrief.js
//
// THE DEEP CLIENT BRIEF behind every weekly client email (docs/CLIENT-TOUCH-PLANNER.md, "The deep
// client brief"). Guy, 22 Oct 2026: "delight every client ... the email from me really does look like
// the email from me, based on everything we've got, and gives them some wisdom as well." That day a
// deep read done by hand for Ashley Knowles (every call, email and LinkedIn message) found what the
// planner could not see: his campaign had never launched, Guy owed him three things, and a personal
// note had to come before any weekly email. This file makes that read the standard, every Monday,
// for every client.
//
// What it reads, per client (the same stores the dossier reads, through the dossier's own readers):
//   - EVERY recorded call with Guy (the transcript store). Each call is digested ONCE - promises each
//     side with quotes, worries, wins, what was set up - and the digest kept (client_touch_call_digests),
//     so only a new call is ever read again. Calls in the last 60 days are digested by Sonnet, older
//     ones by Haiku (cheaper; their detail matters less).
//   - their email with Guy, both ways (Guy's mailbox, every address on their record - gatherEmailRecord);
//   - their LinkedIn messages with Guy (the Notes field on their lead in Guy's leads base);
//   - the dossier, when one exists for them (its standing and commitments);
//   - the Touch Note, the live facts (Last Invite Sent, campaign, next session), last week's brief,
//     and what Guy has already dealt with.
// The brief is rebuilt only when that material changed (the basis); otherwise last week's is used.
//
// What the brief holds: what is TRUE now, what Guy OWES them (with dates and quotes), what they are
// waiting on, recent wins, what is on their mind, how to write to them, and what never to say.
//
// And what the planner does with it (each a function below, called from clientTouchPlanner):
//   - FIRST THINGS FIRST: when Guy owes something important, a personal note in his voice is drafted
//     for him to edit and send himself; the weekly email is held until he marks it sent or dismisses it.
//   - FIT: does the approved piece the picker chose fit their real situation? If not, a CUSTOM email is
//     written from the brief (short, plain, ends with a thought for the week lifted word for word from
//     an approved piece), marked CUSTOM for Guy to read closely. It goes only if he approves it.
//   - THE FACT GUARD: every claim in an opening, a custom email or a note is checked against the brief
//     and the live facts - at build time and again on the sending morning.
// Every Claude call here runs on Guy's own server key, metered (services/clientTouchCost.js).

const { createLogger } = require('../utils/contextLogger');
const { estimateTokens } = require('./clientTouchCost');

const logger = createLogger({ runId: 'PLANNER', clientId: 'SYSTEM', operation: 'client_touch_brief' });

const MODEL = process.env.WINGGUY_DRAFT_MODEL_ID || 'claude-sonnet-5-5';
const OLD_CALL_MODEL = process.env.CLIENT_TOUCH_OLD_CALL_MODEL || 'claude-haiku-5-5';
const RECENT_CALL_DAYS = 60;
const TRANSCRIPT_CAP = 100000;     // chars of one call handed to the digest (an hour of talk is ~55k)
const EMAIL_MAX = 60;
const LINKEDIN_MAX = 60;
const THREAD_CHARS = 60000;        // the email thread handed to the synthesis
const DIGEST_CONCURRENCY = 4;
// b2 (23 Oct 2026): "important" narrowed to what a client is waiting on - every brief re-reads once.
const BRIEF_VERSION = 'b2';
const DAY = 86400000;

// Guy's quality bar for a custom email (22 Oct 2026, written by hand for Ashley Knowles; Guy: "perfect").
// Shown to the drafter as the standard to meet - never its facts, which are Ashley's alone.
const QUALITY_BAR = {
  subject: "1,588 conversations you've already started",
  body: [
    'Congratulations on finishing the Masters - and on getting the podcast out the door. Big month.',
    "While your new campaign's still on the bench, there's something already sitting in your portal: your LinkedIn history. 4,221 connections and 1,588 past conversations came in on 15 October. You called those lost threads \"the beauty of this\" - and they are. Every one is someone who already knows you, which beats any cold request.",
    "No need to do anything with them yet. Have a look at who's there before the 11th, and we'll work through how to pick them back up together.",
  ],
  why: "true to where he is, acknowledges real wins, uses what he already has, asks nothing new of him, short",
};

const STYLE = "Guy's voice: first person, plain, warm, Australian English. Short spaced dashes ' - ' only, never an em or en dash. No exclamation marks. No 'I hope this finds you well', 'just checking in', 'I wanted to reach out', 'great news'. No links. Never mention Wingguy, Claude, AI, automation or that anything was chosen or scheduled.";

// ---------------------------------------------------------------------------------------------
// Small pure helpers

const dash = (s) => String(s == null ? '' : s).replace(/\s*[–—]\s*/g, ' - ');
const arr = (v) => (Array.isArray(v) ? v : []);
const str = (v) => dash(String(v == null ? '' : v).replace(/\s+/g, ' ').trim());
const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

function scrub(s) {
  try { return require('./wingguyDossier').scrub(s); } catch (_) { return String(s || ''); }
}

/** The first JSON object in a reply. Throws when there is none. Pure. */
function parseJsonObject(text) {
  const raw = String(text || '');
  const a = raw.indexOf('{'); const b = raw.lastIndexOf('}');
  if (a === -1 || b <= a) throw new Error(`no JSON object in the reply ("${raw.slice(0, 120).replace(/\s+/g, ' ')}")`);
  return JSON.parse(raw.slice(a, b + 1).replace(/[\u0000-\u001f]/g, ' '));
}

async function ask(llm, { model = MODEL, system, user, maxTokens = 16000, effort = 'low' }) {
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await llm.messages.create({
        model,
        max_tokens: maxTokens,
        output_config: { effort },
        system: system + (attempt ? '\nSTRICT: answer with ONE valid JSON object only - escape every double quote inside strings as \\" and never put raw newlines inside strings.' : ''),
        messages: [{ role: 'user', content: scrub(user) }],
      });
      const text = (response.content || []).filter((x) => x.type === 'text').map((x) => x.text).join('');
      return parseJsonObject(text);
    } catch (e) {
      lastErr = e;
      if (e && e.name === 'BudgetError') throw e;
      const ac = require('../config/anthropicClient');
      if (ac.anthropicKeyError && ac.anthropicKeyError(e)) break;
    }
  }
  throw lastErr;
}

/** Run fn over items, a few at a time. */
async function inBatches(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  const worker = async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  return out;
}

// ---------------------------------------------------------------------------------------------
// Material

/** Every address the client writes from (the record's Email, LH email, billing, alternatives). Pure. */
function clientAddresses(client) {
  const raw = (client.rawRecord && client.rawRecord._rawJson && client.rawRecord._rawJson.fields) || {};
  const alts = String(raw['Alternative Email Addresses'] || '').split(/[;,\s]+/);
  return [...new Set([client.clientEmailAddress, client.lhAccountEmail, client.billingEmail, ...alts]
    .map((v) => String(v || '').trim().toLowerCase()).filter((v) => v.includes('@')))];
}

/** Every recorded call between the coach and this client, newest first, with the whole transcript. */
async function gatherCalls(coachClientId, client, deps = {}) {
  const getPool = deps.getPool || (() => require('./recallWebhookDb').getPool());
  const p = getPool();
  if (!p) return [];
  let c;
  try {
    c = await p.connect();
    const r = await c.query(
      `SELECT m.id, m.title, m.meeting_start, m.summary_json, m.transcript_text
         FROM recall_meetings m
        WHERE m.coach_client_id = $1
          AND (m.title ILIKE $3 OR EXISTS (SELECT 1 FROM recall_meeting_participants p WHERE p.meeting_id = m.id AND LOWER(p.verified_email) = ANY($2)))
        ORDER BY m.meeting_start DESC NULLS LAST`,
      [coachClientId, clientAddresses(client), `%${client.clientName}%`],
    );
    return r.rows.map((m) => ({
      id: String(m.id),
      date: m.meeting_start ? new Date(m.meeting_start).toISOString().slice(0, 10) : null,
      title: m.title || '(call)',
      transcript: m.transcript_text || '',
      summary: m.summary_json || null,
    }));
  } catch (e) {
    logger.warn(`calls for ${client.clientId} skipped: ${e.message}`);
    return [];
  } finally { if (c) c.release(); }
}

/** Their lead record in the coach's own leads base (by email, then name) - its Notes hold the LinkedIn thread. */
async function findClientLead(coach, client, deps = {}) {
  try {
    const dossier = deps.dossier || require('./wingguyDossier');
    const base = (deps.getClientBase || require('./clientService').getClientBase)(coach.airtableBaseId);
    for (const email of clientAddresses(client)) {
      const recs = await dossier.findLeadRecords(base, { email });
      if (recs.length) return recs[0];
    }
    const byName = await dossier.findLeadRecords(base, { name: client.clientName });
    return byName.length === 1 ? byName[0] : null;
  } catch (e) {
    logger.warn(`lead record for ${client.clientId} skipped: ${e.message}`);
    return null;
  }
}

/** Everything the brief reads for one client, in one shape. */
async function gatherMaterial(coach, client, deps = {}) {
  const dossier = deps.dossier || require('./wingguyDossier');
  const mailProvider = deps.mailProvider || require('./mailProvider');
  const [calls, mail, lead] = await Promise.all([
    deps.calls || gatherCalls(coach.clientId, client, deps),
    (async () => {
      try {
        if (!mailProvider.hasMailbox(coach)) return { timeline: [], thread: [] };
        return await dossier.gatherEmailRecord(mailProvider, coach, clientAddresses(client), EMAIL_MAX);
      } catch (e) { logger.warn(`mail for ${client.clientId} skipped: ${e.message}`); return { timeline: [], thread: [] }; }
    })(),
    deps.lead !== undefined ? deps.lead : findClientLead(coach, client, deps),
  ]);
  const first = String(client.clientFirstName || client.clientName || '').split(' ')[0];
  const linkedin = lead ? dossier.gatherLinkedIn(lead.fields ? lead.fields['Notes'] : lead.get('Notes'), first, LINKEDIN_MAX) : [];
  let dossierRow = null;
  try {
    for (const email of clientAddresses(client)) { dossierRow = await dossier.getDossierRow(coach.clientId, email); if (dossierRow) break; }
  } catch (_) { dossierRow = null; }
  const dp = dossierRow && dossierRow.payload ? (typeof dossierRow.payload === 'string' ? JSON.parse(dossierRow.payload) : dossierRow.payload) : null;
  return {
    calls,
    emails: (mail.thread || []).length ? mail.thread : (mail.timeline || []).filter((e) => e.kind === 'email'),
    linkedin,
    dossier: dp ? { builtAt: dp.builtAt || null, standing: dp.standing || '', commitmentsYou: dp.commitmentsYou || [], commitmentsThem: dp.commitmentsThem || [] } : null,
  };
}

/**
 * What the brief was built from - when this string is unchanged, last week's brief still holds.
 * Calls by id, mail and LinkedIn by count + newest date, the Touch Note, what Guy has dealt with, and
 * the few live facts that change what is true (invitations going out, a session booked). Pure.
 */
function basisFor(material, { note = '', handled = [], facts = {} } = {}) {
  const last = (xs) => (xs.length ? String(xs[xs.length - 1].date || '') : '');
  const h = (s) => { let x = 2166136261; for (const ch of String(s)) { x ^= ch.charCodeAt(0); x = Math.imul(x, 16777619); } return (x >>> 0).toString(36); };
  const factKey = [facts.lastInviteSent ? 'inv' : 'noinv', facts.signals && facts.signals.paused ? 'paused' : '', facts.nextSessionAt ? String(facts.nextSessionAt).slice(0, 10) : 'nosess', facts.group || ''].join(',');
  return [
    BRIEF_VERSION,
    `m:${material.calls.map((c) => c.id).sort().join('.')}`,
    `e:${material.emails.length}:${last(material.emails)}`,
    `l:${material.linkedin.length}:${last(material.linkedin)}`,
    `n:${h(note)}`,
    `h:${handled.map((x) => `${x.id}/${x.how}`).sort().join('.')}`,
    `f:${factKey}`,
  ].join('|');
}

// ---------------------------------------------------------------------------------------------
// The call digests - each call read once

const DIGEST_SYSTEM = `You digest ONE recorded call between Guy Wilson (a network-building coach, I Know A Guy) and his client, so the call never has to be read again. Later weeks will rely only on your digest to know what was promised, worried about and achieved. Return ONE JSON object:
{"about": "one sentence: what this call was for",
 "guy_promised": [{"what": "something Guy said he would do, send, introduce, fix or find out", "quote": "Guy's words, verbatim, under 30 words"}],
 "client_promised": [{"what": "", "quote": ""}],
 "worries": [{"what": "a concern, frustration or fear the client voiced", "quote": "their words, verbatim"}],
 "asked_for": [{"what": "something the client asked Guy for", "quote": ""}],
 "wins": ["good news in their business or life they mentioned, plainly"],
 "status": ["facts about where they were up to at the time of the call - what was set up, launched, not launched, paused"],
 "decided": ["what was agreed"],
 "personal": ["human detail they volunteered - travel, family, study, health"],
 "how_they_are": "one line on how they came across and how they like to work"}
Rules: ground everything in the words. Quotes verbatim and short. Empty arrays are right when the call holds nothing. Speaker labels in transcripts are sometimes wrong - work out who said what from the content. A [TRANSCRIPT CLIPPED ...] marker means YOUR INPUT was cut, never that the call ended. Plain short spaced dashes ' - ', never an em or en dash.`;

function digestModelFor(call, now = Date.now()) {
  const t = call.date ? Date.parse(call.date) : NaN;
  return !Number.isNaN(t) && now - t > RECENT_CALL_DAYS * DAY ? OLD_CALL_MODEL : MODEL;
}

async function digestCall(llm, client, call, { now = Date.now() } = {}) {
  const { clipTranscript } = require('./wingguyDossier');
  const model = digestModelFor(call, now);
  const text = call.transcript ? clipTranscript(call.transcript, TRANSCRIPT_CAP) : '';
  const summary = call.summary ? String(call.summary).slice(0, 4000) : '';
  if (!text && !summary) return { model: null, digest: { about: '(no transcript or summary stored)', empty: true } };
  const user = `CLIENT: ${client.clientName}\nCALL: ${call.date || '(no date)'} "${call.title}"\n${summary ? `STORED SUMMARY: ${summary}\n` : ''}${text ? `TRANSCRIPT:\n${text}` : ''}`;
  const digest = await ask(llm, { model, system: DIGEST_SYSTEM, user, maxTokens: 8000, effort: 'low' });
  return { model, digest };
}

/** Digests for every call: stored ones as they are, new ones read now (and stored). */
async function callDigests(llm, client, calls, deps = {}) {
  const ps = deps.planStore || require('./clientTouchPlanStore');
  const have = await ps.digestsFor(calls.map((c) => c.id));
  const missing = calls.filter((c) => !have.has(c.id));
  let read = 0;
  if (missing.length && llm) {
    await inBatches(missing, DIGEST_CONCURRENCY, async (call) => {
      try {
        const { model, digest } = await digestCall(llm, client, call, deps);
        await ps.saveDigest({ meetingId: call.id, clientId: client.clientId, date: call.date, model, digest });
        have.set(call.id, digest);
        read++;
      } catch (e) {
        if (e && e.name === 'BudgetError') throw e;
        logger.warn(`digest of call ${call.id} (${client.clientId}) failed: ${e.message}`);
      }
    });
  }
  return { digests: calls.filter((c) => have.has(c.id)).map((c) => ({ id: c.id, date: c.date, title: c.title, ...have.get(c.id) })), read, missing: missing.length - read };
}

// ---------------------------------------------------------------------------------------------
// The brief

const BRIEF_SYSTEM = `You keep the working brief Guy Wilson - a network-building coach (I Know A Guy / Wingguy) - reads before anything goes from him to one of his clients. The weekly email has to sound like it comes from someone who remembers everything, so the brief must be right. Read ALL of it: the digest of every recorded call with Guy (newest first), the email exchange both ways, their LinkedIn messages with Guy, the dossier when there is one, the note Guy keeps, last week's brief, what Guy has already dealt with, and the LIVE FACTS. Return ONE JSON object:
{"summary": "three or four short plain lines for Guy's screen: where they really are, the most important thing owed, what to be careful of",
 "true_now": ["each thing that is TRUE today about where they are up to - campaign launched or not, what is set up and what is not, what they have and have not used"],
 "owed": [{"id": "short-stable-kebab-case-id", "what": "what Guy promised, or the worry or question of theirs he has not answered", "promised_on": "YYYY-MM-DD", "quote": "the words, verbatim from the material", "source": "e.g. call 14 Oct", "important": true, "why": "why it matters to them"}],
 "waiting_on": ["what they are waiting on - from Guy, from the system, from someone Guy promised"],
 "wins": [{"what": "", "date": "YYYY-MM-DD"}],
 "on_their_mind": ["pressures, worries, what they asked for - their words where you can"],
 "how_to_write": ["how they read and reply, from the evidence"],
 "never_say": ["things that would be untrue or land badly to say to them now"]}
Rules:
- LIVE FACTS are checked this morning and win over anything said on a call or in an email. If the facts say invitations are NOT going out, the campaign has not launched, whatever was hoped on a call.
- OWED is only what Guy (or the system on his behalf) promised and has NOT done, or a worry or question of theirs he has not answered. Check every LATER email, call and LinkedIn message - if it was done, answered or overtaken, leave it out. Keep the same id as last week's brief for the same item.
- important = true ONLY when the client is waiting on it, so an ordinary weekly email while it is open would feel like being ignored: a worry or question of theirs left unanswered (their data, money, something that went wrong), a fix or answer they are waiting on, or something Guy told them that turned out wrong and needs correcting. A promised introduction is important only if they have chased it; otherwise it is owed but false (Guy, 23 Oct 2026: introductions stay on the list, they do not hold the email). Small admin (a link, a date), offers the client did not take up, and things waiting on someone else are false.
- Anything under HANDLED BY GUY is not owed unless newer material reopens it.
- Ground everything in the material. Quotes verbatim. Never invent. Empty arrays are right when the material holds nothing.
- Plain short spaced dashes ' - ', never an em or en dash. Australian English.`;

function briefPrompt({ client, factLines, note, previous, handled, digests, emails, linkedin, dossier, today }) {
  const lines = [`Today is ${today}.`, `CLIENT: ${client.clientName}.`, ''];
  lines.push('LIVE FACTS (checked this morning - authoritative):', ...(factLines || []).map((f) => `- ${f}`), '');
  lines.push('NOTE GUY KEEPS ABOUT THEM:', note && String(note).trim() ? String(note).trim() : '(none)', '');
  if (handled && handled.length) {
    lines.push('HANDLED BY GUY (not owed unless newer material reopens it):');
    for (const h of handled) lines.push(`- [${h.id}] ${h.what} - ${h.how === 'sent' ? `he sent a personal note on ${String(h.at).slice(0, 10)}` : `he dismissed it on ${String(h.at).slice(0, 10)}`}${h.text ? `: "${String(h.text).slice(0, 600)}"` : ''}`);
    lines.push('');
  }
  if (previous) lines.push("LAST WEEK'S BRIEF (re-check every item against the material - things change):", JSON.stringify({ true_now: previous.trueNow, owed: previous.owed, waiting_on: previous.waitingOn }), '');
  if (dossier && (dossier.standing || dossier.commitmentsYou.length)) {
    lines.push(`DOSSIER (built ${dossier.builtAt || '?'}):`, `Standing: ${dossier.standing}`, `Guy committed: ${dossier.commitmentsYou.join('; ')}`, `They committed: ${dossier.commitmentsThem.join('; ')}`, '');
  }
  lines.push(`EVERY RECORDED CALL WITH GUY (${digests.length}, newest first):`);
  if (!digests.length) lines.push('(none on record)');
  for (const d of digests) lines.push(`--- ${d.date || '?'} "${d.title}"`, JSON.stringify(Object.fromEntries(Object.entries(d).filter(([k]) => !['id', 'date', 'title'].includes(k)))));
  lines.push('');
  let thread = (emails || []).map((e) => `--- ${e.date} [${e.dir === 'them' ? 'THEM' : e.dir === 'other' ? 'OTHER' : 'GUY'}] "${e.subject || ''}"\n${e.text || ''}`).join('\n');
  if (thread.length > THREAD_CHARS) thread = `[OLDER EMAIL CLIPPED FOR LENGTH]\n${thread.slice(-THREAD_CHARS)}`;
  lines.push(`EMAIL BETWEEN GUY AND THEM (oldest first; ${emails.length}):`, thread || '(none found)', '');
  lines.push(`LINKEDIN MESSAGES WITH GUY (oldest first; ${linkedin.length}):`);
  for (const m of linkedin) lines.push(`- ${m.date} ${m.dir === 'them' ? 'THEM' : 'GUY'}: ${m.text}`);
  if (!linkedin.length) lines.push('(none)');
  return { system: BRIEF_SYSTEM, user: lines.join('\n') };
}

/** Clean a model's brief into the stored shape. Pure. */
function normaliseBrief(j) {
  const owed = arr(j && j.owed).map((o) => ({
    id: slug(o.id || o.what) || 'owed',
    what: str(o.what),
    promisedOn: str(o.promised_on || o.promisedOn || ''),
    quote: str(o.quote),
    source: str(o.source),
    important: o.important === true || o.important === 'true',
    why: str(o.why),
  })).filter((o) => o.what);
  return {
    summary: str(j && j.summary),
    trueNow: arr(j && j.true_now).map(str).filter(Boolean),
    owed,
    waitingOn: arr(j && j.waiting_on).map(str).filter(Boolean),
    wins: arr(j && j.wins).map((w) => (typeof w === 'string' ? { what: str(w), date: '' } : { what: str(w.what), date: str(w.date) })).filter((w) => w.what),
    onTheirMind: arr(j && j.on_their_mind).map(str).filter(Boolean),
    howToWrite: arr(j && j.how_to_write).map(str).filter(Boolean),
    neverSay: arr(j && j.never_say).map(str).filter(Boolean),
  };
}

/** The brief as the plan row keeps it (shown on the panel, read by the fact guard on the sending morning). Pure. */
function compactBrief(b) {
  if (!b) return null;
  return {
    summary: b.summary, trueNow: b.trueNow, owed: b.owed, waitingOn: b.waitingOn, wins: b.wins, onTheirMind: b.onTheirMind,
    howToWrite: b.howToWrite, neverSay: b.neverSay, builtAt: b.builtAt || null, read: b.read || null,
  };
}

/** What Guy has already dealt with for a client (sent a note about, or dismissed). */
async function handledFor(clientId, deps = {}) {
  const ps = deps.planStore || require('./clientTouchPlanStore');
  try { return JSON.parse((await ps.getState(`owed-handled:${clientId}`)) || '[]'); } catch (_) { return []; }
}

async function markHandled(clientId, items, how, { text = '', at = new Date().toISOString() } = {}, deps = {}) {
  const ps = deps.planStore || require('./clientTouchPlanStore');
  const now = await handledFor(clientId, deps);
  const keep = now.filter((h) => !items.some((i) => i.id === h.id));
  for (const i of items) keep.push({ id: i.id, what: i.what, how, at, text: text ? String(text).slice(0, 2000) : '' });
  await ps.setState(`owed-handled:${clientId}`, JSON.stringify(keep.slice(-60)));
  return keep;
}

/**
 * The brief for one client: last week's when nothing it was built from changed, otherwise rebuilt
 * (new calls digested first). Throws BudgetError; any other failure returns the previous brief (or
 * null) with `error`. deps: planStore, llm (metered), material (tests), now.
 */
async function briefFor(coach, client, { facts = {}, factLines = [], llm = null, now = Date.now() } = {}, deps = {}) {
  const ps = deps.planStore || require('./clientTouchPlanStore');
  const stored = await ps.getBrief(client.clientId);
  const previous = stored && stored.payload ? stored.payload : null;
  try {
    const material = deps.material || await gatherMaterial(coach, client, deps);
    const handled = await handledFor(client.clientId, deps);
    const basis = basisFor(material, { note: client.touchNote || '', handled, facts });
    if (previous && stored.basis === basis) return { ...previous, source: 'cached' };
    if (!llm) return previous ? { ...previous, source: 'cached', stale: 'no Claude key - last brief kept' } : null;
    const { digests, read, missing } = await callDigests(llm, client, material.calls, { ...deps, now });
    const prompt = briefPrompt({
      client, factLines, note: client.touchNote, previous, handled, digests, emails: material.emails, linkedin: material.linkedin,
      dossier: material.dossier, today: new Date(now).toISOString().slice(0, 10),
    });
    const j = await ask(llm, { system: prompt.system, user: prompt.user, effort: 'medium' });
    const handledIds = new Set(handled.map((h) => h.id));
    const brief = normaliseBrief(j);
    brief.owed = brief.owed.filter((o) => !handledIds.has(o.id));
    brief.builtAt = new Date(now).toISOString();
    brief.read = { calls: material.calls.length, callsDigestedNow: read, callsUnread: missing, emails: material.emails.length, linkedin: material.linkedin.length, dossier: !!material.dossier, promptTokens: estimateTokens(prompt.user) };
    await ps.saveBrief(client.clientId, basis, brief, null);
    return { ...brief, source: 'built' };
  } catch (e) {
    if (e && e.name === 'BudgetError') throw e;
    logger.warn(`brief for ${client.clientId} failed: ${e.message}`);
    return previous ? { ...previous, source: 'cached', error: e.message } : { error: e.message, summary: '', trueNow: [], owed: [], waitingOn: [], wins: [], onTheirMind: [], howToWrite: [], neverSay: [] };
  }
}

// ---------------------------------------------------------------------------------------------
// First things first - a personal note before any weekly email

/** The important things Guy still owes (not dealt with). Pure. */
function firstThingsDue(brief, handled = []) {
  const done = new Set((handled || []).map((h) => h.id));
  return arr(brief && brief.owed).filter((o) => o.important && !done.has(o.id));
}

const NOTE_SYSTEM = `You draft a short personal email from Guy Wilson (a network-building coach) to one of his clients, to deal with what Guy owes them BEFORE any ordinary weekly email goes. Guy edits it and sends it himself.
- Deal with each item honestly and specifically. Never say something is done, fixed or sent unless TRUE NOW says so. Where Guy must check or do something first (confirm a fix, ask a third party before an introduction), put that in guy_checks - never pretend it in the email.
- Own it plainly where Guy dropped the ball; no grovelling, no excuses.
- Short: under 120 words, two or three short paragraphs, no lists or numbering. Never start with their name, and write no sign-off line - the greeting "Hi <name>," and "Cheers, Guy" are added. One small easy next step at most.
- Only what is owed - leave out every other open item, however tempting.
- ${STYLE}
Return ONE JSON object: {"subject": "short and specific", "body": "the paragraphs, separated by a blank line", "guy_checks": ["what Guy must confirm or do before he sends it"]}`;

async function draftOwedNote(llm, { client, brief, items }) {
  const user = [
    `CLIENT: ${client.clientName}${client.clientFirstName ? ` (first name ${client.clientFirstName})` : ''}.`,
    '', 'WHAT GUY OWES THEM:', ...items.map((o) => `- ${o.what} (${o.promisedOn || 'date unknown'}${o.source ? `, ${o.source}` : ''})${o.quote ? ` - "${o.quote}"` : ''}${o.why ? ` - why it matters: ${o.why}` : ''}`),
    '', 'TRUE NOW:', ...arr(brief.trueNow).map((t) => `- ${t}`),
    '', 'HOW TO WRITE TO THEM:', ...arr(brief.howToWrite).map((t) => `- ${t}`),
    '', 'NEVER SAY:', ...arr(brief.neverSay).map((t) => `- ${t}`),
  ].join('\n');
  const j = await ask(llm, { system: NOTE_SYSTEM, user });
  return { subject: str(j.subject), text: stripName(dash(String(j.body || '').trim()), client), guyChecks: arr(j.guy_checks).map(str).filter(Boolean) };
}

/** "Ashley, on 7 Oct..." under "Hi Ashley," reads twice - drop a leading name. Pure. */
function stripName(text, client) {
  const first = String((client && (client.clientFirstName || client.clientName)) || '').trim().split(/\s+/)[0];
  if (!first) return text;
  const esc = first.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const out = String(text).replace(new RegExp(`^(?:(?:hi|hello|hey)\\s+)?${esc}\\s*[,:-]+\\s*`, 'i'), '');
  return out ? out.charAt(0).toUpperCase() + out.slice(1) : text;
}

// ---------------------------------------------------------------------------------------------
// Does the approved piece fit? If not, a custom email

const FIT_SYSTEM = `Guy Wilson's planner picked an approved piece for this week's email to one of his clients. Decide whether it FITS their real situation: is everything it assumes or says true for them now, and will it land as relevant rather than tone-deaf? Say false only for a real mismatch - it assumes something untrue (that their campaign is running when it never launched, that they have used something they have not), or it cuts across something big they are dealing with. A weaker or less exciting fit is still a fit.
Return ONE JSON object: {"fits": true or false, "why": "one plain line for Guy"}`;

async function judgeFit(llm, { client, brief, piece }) {
  const user = [
    `CLIENT: ${client.clientName}.`,
    '', 'TRUE NOW:', ...arr(brief.trueNow).map((t) => `- ${t}`),
    '', 'ON THEIR MIND:', ...arr(brief.onTheirMind).map((t) => `- ${t}`),
    '', 'NEVER SAY:', ...arr(brief.neverSay).map((t) => `- ${t}`),
    '', `THE PIECE: "${piece.title}"`, String(piece.text || '').slice(0, 5000),
  ].join('\n');
  const j = await ask(llm, { system: FIT_SYSTEM, user });
  return { fits: j.fits !== false && j.fits !== 'false', why: str(j.why) };
}

const CUSTOM_SYSTEM = `You write this week's email from Guy Wilson - a network-building coach (I Know A Guy) - to one of his clients, because nothing on his approved shelf fits where they really are. Guy reads it closely before anything is sent.
- Short: two to four short paragraphs, under 110 words in all.
- Acknowledge a real win from the brief if there is one - specific, not gushing. Their wins in their business and life (a qualification, a launch, a big client) come before anything about Wingguy.
- Use what they ALREADY have; ask nothing new of them - no homework, no setup, no tasks, no "let me know", no "optional:". At most an invitation to look at something already there.
- What has not happened yet (a campaign not launched) is mentioned lightly or not at all - never as a gap they must close.
- Everything you say must be true in TRUE NOW. Respect NEVER SAY and HOW TO WRITE.
- Do not deal with what Guy owes them - a separate personal note handles that.
- Begin with the substance (no greeting) and stop before any sign-off: the system adds "Hi <name>,", a thought for the week, and "Cheers, Guy".
- ${STYLE}
THE QUALITY BAR - an email Guy called perfect, written for a DIFFERENT client (match its quality and shape, never its facts):
Subject: ${QUALITY_BAR.subject}
${QUALITY_BAR.body.join('\n\n')}
(Why it works: ${QUALITY_BAR.why}.)
Return ONE JSON object: {"subject": "short, specific to them, no brand name", "paragraphs": ["..."], "why": "one line for Guy: what in their world this speaks to"}. If there is genuinely nothing true and useful to say this week, return {"subject": "", "paragraphs": [], "why": "the reason"}.`;

const TIPS_SYSTEM = `You write this week's tips email from Guy Wilson - a network-building coach (I Know A Guy) - to one of his clients who is still getting set up. Guy asked for it: on top of their weekly call, they love a practical hint each week. Guy reads it closely before anything is sent.
- ONE tip, ready to use today, for finding or warming up the right people on LinkedIn in THEIR market (read it from the brief and Guy's note): a Boolean search string to paste into LinkedIn search (quotes for phrases, OR / AND / NOT, brackets - on a paragraph of its own), a search filter worth adding, a way into the connections they already have, a profile touch, a kind of post or comment that starts conversations.
- Never repeat a tip from PAST TIPS - a different angle or a different slice of their market each week.
- Short: two to four short paragraphs, under 130 words in all. Say what to do, then in one line why it finds the right people.
- An offer, not homework: no tasks, no "let me know". At most "if you like, we can try it together" - only when NEXT SESSION is after the day the email ARRIVES, and never name a date that will already be past.
- What a search will bring up is a suggestion ("should bring up"), never a promise. Name a city or region only when TRUE NOW or Guy's note gives it.
- Everything you say about them must be true in TRUE NOW. Respect NEVER SAY and HOW TO WRITE. What has not happened yet is not mentioned.
- Do not deal with what Guy owes them - a separate personal note handles that.
- Begin with the substance (no greeting) and stop before any sign-off: the system adds "Hi <name>,", a thought for the week, and "Cheers, Guy".
- ${STYLE}
Return ONE JSON object: {"subject": "short, says what the tip is, no brand name", "paragraphs": ["..."], "why": "one line for Guy: why this tip for them now"}. If there is genuinely nothing true and useful to say, return {"subject": "", "paragraphs": [], "why": "the reason"}.`;

/**
 * This week's email written for them: in place of a piece that does not fit (notFit), or - tips set -
 * the weekly tips email Guy asked for (pastTips = what they have already had, so no tip repeats).
 */
async function draftCustomEmail(llm, { client, brief, notFit, firstWeekly, tips = false, note = '', pastTips = [], arrives = null, nextSessionAt = null }) {
  const user = [
    `CLIENT: ${client.clientName}${client.clientFirstName ? ` (first name ${client.clientFirstName})` : ''}.`,
    tips ? '' : `WHY NOTHING ON THE SHELF FITS: ${notFit}`,
    tips && arrives ? `THE EMAIL ARRIVES: Monday ${arrives}, 8am Brisbane. NEXT SESSION: ${nextSessionAt ? String(nextSessionAt).slice(0, 16).replace('T', ' ') : 'none booked'}.` : '',
    tips && note ? `GUY'S NOTE ON THEM: ${note}` : '',
    tips && arr(pastTips).length ? ['PAST TIPS (never repeat one):', ...arr(pastTips).map((t) => `- ${t}`)].join('\n') : '',
    firstWeekly ? 'This is the FIRST weekly email they will ever get from Guy (a one-line note about the weekly emails is added after it).' : '',
    '', 'TRUE NOW:', ...arr(brief.trueNow).map((t) => `- ${t}`),
    '', 'WINS:', ...arr(brief.wins).map((w) => `- ${w.what}${w.date ? ` (${w.date})` : ''}`),
    '', 'ON THEIR MIND:', ...arr(brief.onTheirMind).map((t) => `- ${t}`),
    '', 'WAITING ON:', ...arr(brief.waitingOn).map((t) => `- ${t}`),
    '', 'HOW TO WRITE TO THEM:', ...arr(brief.howToWrite).map((t) => `- ${t}`),
    '', 'NEVER SAY:', ...arr(brief.neverSay).map((t) => `- ${t}`),
  ].filter((x) => x !== '').join('\n');
  const j = await ask(llm, { system: tips ? TIPS_SYSTEM : CUSTOM_SYSTEM, user, effort: 'medium' });
  const paragraphs = arr(j.paragraphs).map((p) => dash(String(p).trim())).filter(Boolean);
  return { subject: str(j.subject), paragraphs, why: str(j.why) };
}

/** Paragraphs -> the email's body HTML (escaped). Pure. */
function paragraphsHtml(paragraphs) {
  const esc = (x) => String(x).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  return arr(paragraphs).map((p) => `<p>${esc(p)}</p>`).join('\n');
}

/** Plain text of body HTML (for the guard and the fit read). Pure. */
function htmlText(html) {
  return String(html || '').replace(/<\/(p|li|h\d)>/gi, '\n').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/[ \t]+/g, ' ').replace(/\n\s*/g, '\n').trim();
}

// ---------------------------------------------------------------------------------------------
// The fact guard

const INVITES_RE = /\b(invitations?|connection requests?|invites?)\b[^.]{0,40}\b(are|is|have been|has been|went|going|gone|sent)\b[^.]{0,15}\b(out|going|sent|live)\b|\byour campaign\b[^.]{0,25}\b(is|has)\b[^.]{0,10}\b(running|live|going|started|launched)\b|\byou'?ve started\b|\byou have started\b|\bnow that (your )?(invitations|campaign)\b/i;
const SESSION_RE = /\b(see you|speak|talk)\b[^.]{0,30}\b(on|next)\b[^.]{0,20}\b(mon|tue|wed|thu|fri|sat|sun|\d{1,2}(st|nd|rd|th)?)\b|\bour next (session|call)\b/i;

/**
 * The checks code can make with certainty, against the live facts. Returns a list of problems. Pure.
 * facts: { lastInviteSent, signals: { paused }, nextSessionAt }, at = the sending moment.
 */
function deterministicClaims(text, facts = {}, at = Date.now()) {
  const t = String(text || '');
  const problems = [];
  // Per sentence, and only where the sentence says it IS happening - "no invitations are going out
  // yet" is true for a client whose campaign has not launched, and must not trip the check.
  // ...and not where Guy is quoting what was said before ("I said the first invitations were going
  // out. They aren't." - the correction Steve was owed on 22 Oct).
  const NEGATED = /\b(no|not|never|yet to)\b|n't\b|\bI (said|told you|wrote)\b|\bmy (\d+ \w+ )?email said\b/i;
  const sentences = t.split(/(?<=[.!?])\s+|\n+/);
  if (sentences.some((s) => INVITES_RE.test(s) && !NEGATED.test(s))) {
    const sent = facts.lastInviteSent ? Date.parse(facts.lastInviteSent) : NaN;
    if (Number.isNaN(sent)) problems.push('says their invitations are going out - but Last Invite Sent is empty');
    else if (at - sent > 14 * DAY) problems.push(`says their invitations are going out - but the last one went ${String(facts.lastInviteSent).slice(0, 10)}`);
    else if (facts.signals && facts.signals.paused && !facts.signals.live) problems.push('says their invitations are going out - but their campaign is paused');
  }
  if (sentences.some((s) => SESSION_RE.test(s) && !NEGATED.test(s)) && !facts.nextSessionAt) problems.push('mentions a next session - but none is booked');
  if (/[–—]/.test(t)) problems.push('an em or en dash');
  if (/https?:\/\/|www\./i.test(t)) problems.push('a link');
  if (/\b(wingguy|claude|automat\w*|this email was)\b/i.test(t)) problems.push('mentions the system');
  return problems;
}

const GUARD_SYSTEM = `You check an email Guy Wilson is about to send one of his clients. List every FACTUAL claim in it - anything stated as fact about the client, their business, their setup or campaign, or what has already happened - and check each against the BRIEF and the LIVE FACTS. NOT claims (leave them out): what Guy says he will do from now on, apologies and owning a slip, offers, opinions, ideas, general advice, and the thought for the week. Judge the meaning, not the wording - a fair paraphrase of the brief is supported.
verdict: "supported" (the brief or facts say so), "unsupported" (nothing there says so), "contradicted" (they say otherwise).
Return ONE JSON object: {"claims": [{"claim": "...", "verdict": "supported|unsupported|contradicted", "why": "one line"}]}`;

/**
 * Check every claim in `text`: the code checks always; the Claude check when an llm is given.
 * Returns { ok, problems: [], claims: [], checkedAt, by }. Never throws except BudgetError.
 */
async function checkClaims(text, { facts = {}, factLines = [], brief = null, llm = null, client = null, at = Date.now() } = {}) {
  const t = String(text || '').trim();
  const out = { ok: true, problems: [], claims: [], checkedAt: new Date().toISOString(), by: llm ? 'code+claude' : 'code' };
  if (!t) return out;
  out.problems.push(...deterministicClaims(t, facts, at));
  if (llm && brief) {
    try {
      const user = [
        `CLIENT: ${client ? client.clientName : ''}`, '', 'LIVE FACTS (checked now - authoritative):', ...(factLines || []).map((f) => `- ${f}`),
        '', 'BRIEF - TRUE NOW:', ...arr(brief.trueNow).map((x) => `- ${x}`), '', 'BRIEF - WINS:', ...arr(brief.wins).map((w) => `- ${w.what}${w.date ? ` (${w.date})` : ''}`),
        '', 'BRIEF - OWED / WAITING ON:', ...arr(brief.owed).map((o) => `- ${o.what}`), ...arr(brief.waitingOn).map((x) => `- ${x}`),
        '', 'BRIEF - ON THEIR MIND:', ...arr(brief.onTheirMind).map((x) => `- ${x}`), '', 'NEVER SAY:', ...arr(brief.neverSay).map((x) => `- ${x}`),
        '', 'THE EMAIL:', t,
      ].join('\n');
      const j = await ask(llm, { system: GUARD_SYSTEM, user });
      out.claims = arr(j.claims).map((c) => ({ claim: str(c.claim), verdict: ['supported', 'unsupported', 'contradicted'].includes(c.verdict) ? c.verdict : 'unsupported', why: str(c.why) }));
      for (const c of out.claims) if (c.verdict !== 'supported') out.problems.push(`${c.verdict}: "${c.claim}"${c.why ? ` - ${c.why}` : ''}`);
    } catch (e) {
      if (e && e.name === 'BudgetError') throw e;
      out.by = 'code';
      out.claudeError = e.message;
    }
  }
  out.ok = out.problems.length === 0;
  return out;
}

module.exports = {
  briefFor,
  gatherMaterial,
  gatherCalls,
  callDigests,
  handledFor,
  markHandled,
  firstThingsDue,
  draftOwedNote,
  judgeFit,
  draftCustomEmail,
  checkClaims,
  // pure, tested
  basisFor,
  briefPrompt,
  normaliseBrief,
  compactBrief,
  deterministicClaims,
  digestModelFor,
  paragraphsHtml,
  htmlText,
  parseJsonObject,
  clientAddresses,
  QUALITY_BAR,
  MODEL,
  OLD_CALL_MODEL,
};
