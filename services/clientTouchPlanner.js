// services/clientTouchPlanner.js
//
// THE MONDAY RUN of the weekly client touch planner (docs/CLIENT-TOUCH-PLANNER.md) and what
// Guy's Monday screen reads. Every week, for every client Guy coaches:
//
//   1. gather the FACTS live (the client board's cards, the record, the journey, the touch record,
//      the campaign numbers, the Today tab, the pins and skips Guy set) - never from a stored stage;
//   2. the PICKER (services/clientTouchPicker.js) says what, if anything, this week and why;
//   3. the OPENING (services/clientTouchOpening.js) is drafted for picks that are emails;
//   4. the BODY is built from the shelf (the one-pager renderer the drip uses), a setup step, a
//      pinned one-off or a drafted offer of times for a call;
//   5. the plan row is stored (services/clientTouchPlanStore.js) as a PROPOSAL.
//
// Nothing goes to a client from here until Guy approves it on the screen and presses "Send
// approved" - or, only when CLIENT_TOUCH_AUTOSEND=on (off by default), until the Tuesday 9am veto
// deadline passes. The one email that goes by itself is the Monday PREVIEW to Guy. Every send goes
// through the series mailer (knowaguy sending key), carries the client's unsubscribe link, and is
// recorded in the touch record (client_touches) so the picker remembers it next week.
//
// "Who is never sent anything" is re-checked from a fresh record at the moment of sending, not only
// on Monday (Guy, 22 Oct: "if a client becomes inactive, then nothing will be sent").

const fs = require('fs');
const path = require('path');
const clientService = require('./clientService');
const touchStore = require('./clientTouchStore');
const planStore = require('./clientTouchPlanStore');
const picker = require('./clientTouchPicker');
const opening = require('./clientTouchOpening');
const content = require('./onePagerContent');
const shell = require('./onePagerShell');
const MANIFEST = require('../config/onePagerSeriesManifest');
const { ORIENTATION, EVENTS } = require('../config/clientTouchLabels');
const { createLogger } = require('../utils/contextLogger');

const logger = createLogger({ runId: 'PLANNER', clientId: 'SYSTEM', operation: 'client_touch_planner' });

const DAY = 86400000;
const TICK_MS = 15 * 60 * 1000;
const BUILD_HOUR = Number(process.env.CLIENT_TOUCH_BUILD_HOUR) || 6;   // Monday, Brisbane
const VETO_HOUR = 9;                                                     // Tuesday, Brisbane (autosend only)
const EMAIL_KINDS = new Set(['one-pager', 'habit', 'setup', 'one-off', 'call']);
const BRAND = 'I Know A Guy';

let intervalHandle = null;
let ticking = false;

const present = (v) => Boolean(v && String(v).trim());
const lower = (v) => String(v || '').trim().toLowerCase();
const daysSince = (iso, now = Date.now()) => { const t = iso ? new Date(iso).getTime() : NaN; return Number.isNaN(t) ? null : Math.max(0, Math.floor((now - t) / DAY)); };

/** The switch: nothing sends by itself unless this reads 'on'. */
function autosendOn() {
  return lower(process.env.CLIENT_TOUCH_AUTOSEND) === 'on';
}

function brisbaneNow(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Brisbane', hour: '2-digit', hour12: false, weekday: 'short' }).formatToParts(now);
  const get = (t) => (parts.find((p) => p.type === t) || {}).value;
  return { hour: Number(get('hour')), weekday: get('weekday') };
}

// ---------------------------------------------------------------------------------------------
// Postgres reads the facts need (each tolerant of a missing table)

function getPool() {
  try { return require('./recallWebhookDb').getPool(); } catch (_) { return null; }
}

async function rows(sql, params = []) {
  const p = getPool();
  if (!p) return [];
  let c;
  try { c = await p.connect(); return (await c.query(sql, params)).rows; }
  catch (e) { logger.warn(`planner query skipped: ${e.message}`); return []; }
  finally { if (c) c.release(); }
}

/** client_id -> { campaigns, reportedAt } from the machines' five-minute reports. */
async function campaignSnapshots() {
  const out = new Map();
  for (const r of await rows('SELECT client_id, campaigns, reported_at FROM lh_campaign_snapshots')) {
    out.set(String(r.client_id).trim(), { campaigns: Array.isArray(r.campaigns) ? r.campaigns : [], reportedAt: r.reported_at });
  }
  return out;
}

/** Addresses that bounced in the last 30 days (Guy's own mailbox watcher). */
async function bouncedAddresses(coachClientId) {
  const r = await rows(`SELECT DISTINCT LOWER(address) AS a FROM wingguy_bounce_alerts WHERE coach_client_id = $1 AND alerted_at > now() - interval '30 days'`, [coachClientId]);
  return new Set(r.map((x) => x.a));
}

/** Has the client's Today tab ever had records? = a lead in their base with Date Connected. */
async function todayHasRecords(client) {
  if (!client.airtableBaseId) return false;
  try {
    const base = clientService.getClientBase(client.airtableBaseId);
    const recs = await base('Leads').select({ filterByFormula: "{Date Connected} != ''", maxRecords: 1, fields: ['Date Connected'] }).firstPage();
    return recs.length > 0;
  } catch (e) {
    logger.warn(`Today probe for ${client.clientId} skipped: ${e.message}`);
    return false;
  }
}

// ---------------------------------------------------------------------------------------------
// Pure helpers (tested)

/** The campaign signals the picker's events need, from one client's snapshot. */
function campaignSignals(snapshot) {
  const out = { paused: false, runningLow: false, acceptancesSlow: false, exhausted: false, live: 0, pausedWaiting: 0, lines: [] };
  if (!snapshot || !Array.isArray(snapshot.campaigns)) return out;
  let campaignLines;
  try { ({ campaignLines } = require('./lhWeeklyCampaignReport')); } catch (_) { campaignLines = null; }
  for (const c of snapshot.campaigns) {
    if (c.paused) { out.paused = true; out.pausedWaiting += Number(c.waiting) || 0; continue; }
    out.live += 1;
    if (campaignLines) {
      const l = campaignLines(c);
      if (l.topUp) out.runningLow = true;
      out.lines.push(`${l.name}: ${l.lines.join(' ')}`);
    } else if (!c.waiting) out.runningLow = true;
    if (c.cohort_accepted !== null && c.cohort_accepted !== undefined && Number(c.cohort_invited) >= 10) {
      const pct = (100 * Number(c.cohort_accepted)) / Number(c.cohort_invited);
      if (pct < 15) out.acceptancesSlow = true;
    }
    if (!c.waiting && !c.invited_7d) out.exhausted = true;
  }
  return out;
}

/** The note's "length" - full unless the note asks for short in so many words. */
function noteSettings(note) {
  const n = String(note || '');
  return { length: /\b(short|brief|keep (it|them) short)\b/i.test(n) ? 'short' : 'full', text: n };
}

/** The journey stop a client is sat on, from the statuses: the first stop not done. */
function currentStop(statuses) {
  const order = ['claude', 'reconnect', 'voice', 'linkedin', 'calendar', 'calls', 'rhythm', 'newpeople'];
  return order.find((k) => statuses[k] !== 'done') || null;
}

/**
 * Which events are "recent" (worth sending for) given when each was first seen. An event the planner
 * first saw this week or last counts; older ones have had their email (or their chance).
 */
function recentEvents(firstSeen, now = Date.now(), windowDays = 14) {
  const out = [];
  for (const [key, at] of Object.entries(firstSeen || {})) {
    const d = daysSince(at, now);
    if (d !== null && d <= windowDays) out.push({ key, at });
  }
  return out;
}

/** Waiting improvements per piece slug, from IMPROVEMENTS.md ("### slug - ..." sections, **Waiting** items). */
function waitingImprovements(markdown) {
  const counts = {};
  let slug = null;
  for (const line of String(markdown || '').split('\n')) {
    const h = line.match(/^###\s+([a-z0-9-]+)\b/);
    if (h) { slug = h[1]; continue; }
    if (/^##\s/.test(line)) { slug = null; continue; }
    if (slug && /\*\*Waiting\*\*/.test(line)) counts[slug] = (counts[slug] || 0) + 1;
  }
  return counts;
}

/** The live-fact lines the opening is allowed to rely on. */
function factLines(f, signals, card) {
  const lines = [];
  lines.push(`Invitations: ${f.lastInviteSent ? `going out (last one ${String(f.lastInviteSent).slice(0, 10)})` : 'NOT going out yet'}${signals.paused ? ` - campaign PAUSED with ${signals.pausedWaiting} people waiting` : ''}`);
  if (signals.lines.length) lines.push(`Campaign numbers: ${signals.lines.join(' | ')}`);
  lines.push(`Last call with Guy: ${f.daysSinceLastCall === null ? 'none on record' : `${f.daysSinceLastCall} days ago`}${card && card.nextSession ? `; next session booked ${String(card.nextSession.at).slice(0, 10)}` : '; nothing booked'}`);
  lines.push(`Today tab: ${f.todayHasRecords ? 'has records' : 'no records yet'}`);
  lines.push(`Journey: ${f.group === 'onboarding' ? 'still in onboarding' : 'running'}${f.stuckStop ? `; on the "${f.stuckStop}" stop for ${f.stuckDays} days` : ''}`);
  if (card && card.lastUsedAt) lines.push(`Last used Wingguy: ${daysSince(card.lastUsedAt)} days ago`);
  if (f.events && f.events.length) lines.push(`Happened recently: ${f.events.map((e) => (EVENTS[e.key] || {}).label || e.key).join('; ')}`);
  return lines;
}

// ---------------------------------------------------------------------------------------------
// Facts for one client

async function factsFor(client, card, ctx) {
  const now = ctx.now;
  const snapshot = ctx.snapshots.get(client.clientId) || null;
  const signals = campaignSignals(snapshot);
  const record = ctx.touchesByClient.get(client.clientId) || [];
  const address = lower(client.clientEmailAddress) || null;

  // The journey, live, and how long they have sat on the current stop (first seen in planner state).
  let statuses = {};
  try {
    const cj = require('./clientJourney');
    statuses = cj.statusFromFacts(await cj.gatherFacts(client, { db: getPool() }));
  } catch (e) { logger.warn(`journey for ${client.clientId} skipped: ${e.message}`); }
  const stop = currentStop(statuses);
  const stopKey = `stop:${client.clientId}`;
  const stopState = await planStore.getState(stopKey);
  let stuckDays = 0;
  if (stop) {
    const [prevStop, since] = String(stopState || '').split('|');
    if (prevStop === stop && since) stuckDays = daysSince(since, now) || 0;
    else await planStore.setState(stopKey, `${stop}|${new Date(now).toISOString()}`);
  }

  // Events, with when each was first seen - so "first" means first.
  const seenKey = `events:${client.clientId}`;
  let firstSeen = {};
  try { firstSeen = JSON.parse((await planStore.getState(seenKey)) || '{}'); } catch (_) { firstSeen = {}; }
  const today = await todayHasRecords(client);
  const nowIso = new Date(now).toISOString();
  const mark = (k) => { if (!firstSeen[k]) firstSeen[k] = nowIso; };
  if (today) mark('today-first-records');
  if (signals.runningLow && client.lastInviteSent) {
    // A recurring event: it can fire again once the previous one is older than the resend window.
    const d = daysSince(firstSeen['campaign-running-low'], now);
    if (d === null || d > picker.REINFORCE_AFTER_WEEKS * 7) firstSeen['campaign-running-low'] = nowIso;
  }
  if (signals.acceptancesSlow) mark('acceptances-slow');
  const usedDays = daysSince(card.lastUsedAt, now);
  if (usedDays !== null && usedDays >= 21 && signals.live > 0 && !signals.paused) mark('busy');
  if (usedDays !== null && usedDays >= 42 && card.group === 'running') mark('drifting');
  await planStore.setState(seenKey, JSON.stringify(firstSeen));

  // The next setup step: the first "They owe" task not done.
  let nextSetupStep = null;
  if (card.group === 'onboarding') {
    const owed = (card.owed || []).filter((t) => t.who === 'client' && t.status !== 'Done');
    if (owed[0]) nextSetupStep = { key: `setup:${owed[0].id}`, title: owed[0].task, instructionsUrl: owed[0].instructionsUrl || null };
  }

  const lastTouchAt = record.filter((r) => touchStore.SUBSTANTIAL_KINDS.includes(r.kind)).map((r) => new Date(r.sent_at).getTime()).sort((a, b) => b - a)[0] || null;
  const dSession = daysSince(card.lastSessionAt, now);
  const dTouch = lastTouchAt ? daysSince(lastTouchAt, now) : null;
  const daysSinceLastSubstantial = [dSession, dTouch].filter((d) => d !== null).sort((a, b) => a - b)[0] ?? null;
  const skip = ctx.skips.get(client.clientId) || null;
  const note = noteSettings(client.touchNote);

  return {
    clientId: client.clientId,
    clientName: client.clientName,
    status: client.status,
    coachingStatus: client.coachingStatus || null,
    group: card.group,
    billingLapsed: false, // the lapse chain flips Status to Paused - covered by status
    unsubscribed: !!client.emailUnsubscribed,
    hasUnsubToken: !!client.emailUnsubToken,
    address,
    bounced: address ? ctx.bounced.has(address) : false,
    skipUntil: skip ? skip.until : null,
    skipThisWeek: false,
    lastInviteSent: client.lastInviteSent || null,
    seriesStartDate: card.seriesStart || null,
    daysSinceLastCall: dSession,
    daysSinceLastSubstantial,
    sessionBooked: !!card.nextSession,
    todayHasRecords: today,
    events: recentEvents(firstSeen, now),
    callProblems: [],
    stuckStop: stop,
    stuckDays,
    quietOrBusy: !!firstSeen.busy,
    note: { length: note.length },
    noteText: note.text,
    pin: ctx.pins.get(client.clientId) || null,
    pinForEveryone: ctx.pins.get('*') || null,
    nextSetupStep,
    signals,
    lastTouchAt: lastTouchAt ? new Date(lastTouchAt).toISOString() : null,
    lastSessionAt: card.lastSessionAt || null,
    nextSessionAt: card.nextSession ? card.nextSession.at : null,
    lastUsedAt: card.lastUsedAt || null,
  };
}

// ---------------------------------------------------------------------------------------------
// The body for a pick

function paragraphs(html) {
  return String(html || '').match(/<(p|ul|ol|h2|h3|blockquote)\b[\s\S]*?<\/\1>/g) || [];
}

/** Short form: the dek, the first two paragraphs, then "read the full piece". */
function shortBody(piece, slug) {
  const first = paragraphs(piece.bodyHtml).slice(0, 2).join('\n');
  return `${first}\n<p><strong><a href="/series/${slug}?audience=client">Read the full piece</a></strong></p>`;
}

/** Guy's offer of two or three considered times - never a booking link. */
async function callOfferBody(coach, client) {
  const cal = require('./wingguyCalendar');
  const { getBookingPrefs } = require('../config/wingguyBookingPrefs');
  let slots = [];
  let tz = 'Australia/Brisbane';
  try {
    const avail = await cal.getAvailabilityForCoach(coach.clientId, client.location || client.timezone || '');
    const filtered = cal.filterAvailability(avail, getBookingPrefs(coach.clientId), {});
    tz = filtered.leadTimezone || filtered.yourTimezone || tz;
    const seenDays = new Set();
    for (const d of filtered.days || []) {
      if (d.busyDay && slots.length) continue;
      const s = (d.freeSlots || []).find((x) => !seenDays.has(d.date));
      if (!s) continue;
      seenDays.add(d.date);
      slots.push(s.label || cal.fmtSlot(s.time, tz));
      if (slots.length >= 3) break;
    }
  } catch (e) {
    logger.warn(`times for ${client.clientId} skipped: ${e.message}`);
  }
  const times = slots.length ? `<ul>${slots.map((s) => `<li>${s}</li>`).join('')}</ul>` : '<p>(no free times could be read from the calendar - add two or three by hand)</p>';
  return {
    title: 'Time for a catch-up',
    dek: '',
    bodyHtml: `<p>It has been a while since we talked properly. Would any of these suit for half an hour?</p>${times}<p>Reply with whichever works and I will send the invite - or tell me a time that suits you better.</p>`,
    slotsFound: slots.length,
  };
}

/** Render the body for a pick: { title, dek, bodyHtml, preview }. Never throws; a failed render is flagged. */
async function buildBody(pick, { coach, client, pin }) {
  const kind = pick.what.kind;
  try {
    if (kind === 'one-pager' || kind === 'habit') {
      const slug = pick.what.key;
      if (slug === ORIENTATION.slug) {
        const email = require('./onePagerEmail');
        return { title: "What you've actually joined", dek: '', bodyHtml: email.clientOrientationBody(), qs: '?audience=client' };
      }
      if (slug === 'the-process') {
        const email = require('./onePagerEmail');
        return { title: 'The whole process on one page', dek: '', bodyHtml: email.clientMapShortBody({ portalToken: client.portalToken }), qs: '?audience=client' };
      }
      const piece = await content.renderPiece(slug, { audience: 'client' });
      if (!piece) return { error: `piece "${slug}" not found` };
      return { title: piece.title, dek: piece.dek, bodyHtml: pick.form === 'short' ? shortBody(piece, slug) : piece.bodyHtml };
    }
    if (kind === 'setup') {
      const step = pick.what;
      const link = step.instructionsUrl ? `<p><a href="${step.instructionsUrl}">Here is how</a>.</p>` : '';
      return { title: step.title, dek: '', bodyHtml: `<p>One small thing before our next session: ${step.title}.</p>${link}<p>If anything in it is unclear, reply and I will sort it with you.</p>` };
    }
    if (kind === 'one-off') {
      const html = (pin && pin.bodyHtml) || '';
      return { title: pick.what.title, dek: '', bodyHtml: html || '<p>(Guy writes this one - the pin has no text yet)</p>', missing: !html };
    }
    if (kind === 'call') return await callOfferBody(coach, client);
    return { error: `no body for kind ${kind}` };
  } catch (e) {
    return { error: e.message };
  }
}

function previewText(html) {
  return String(html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 240);
}

/** Compose the full email: greeting, the opening, the body, the footer, the unsubscribe link. */
function composeEmail({ client, opening: openingText, body, unsubscribeUrl, baseUrl }) {
  const email = require('./onePagerEmail');
  const esc = (s) => String(s).replace(/[&<>]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch]));
  const introHtml = openingText ? `<p>${esc(openingText)}</p>` : '';
  const inner = shell.articleCard({
    greeting: email.greetingFor(client.clientFirstName || client.clientName),
    introHtml,
    title: body.title,
    dek: body.dek,
    bodyHtml: body.bodyHtml,
    footerHtml: email.emailFooter({ audience: 'client', unsubscribeUrl }),
    qs: body.qs || '?audience=client',
  });
  const base = baseUrl || process.env.SERIES_PUBLIC_BASE_URL || 'https://knowaguy.com.au';
  return email.absolutizeLinks(shell.fullPage({ title: body.title, inner }), base);
}

function subjectFor(pick, body) {
  const kind = pick.what.kind;
  if (kind === 'one-pager' || kind === 'habit') return `${BRAND} - ${body.title}`;
  return body.title;
}

// ---------------------------------------------------------------------------------------------
// The run

/** Everyone Guy coaches, with their board card. */
async function clientsWithCards(coachClientId) {
  const board = await require('./clientBoardService').getBoard(coachClientId);
  const all = await clientService.getAllClients();
  const byId = new Map(all.map((c) => [c.clientId, c]));
  const cards = [...board.groups.onboarding, ...board.groups.running, ...board.groups.paused];
  return { board, all, pairs: cards.map((card) => ({ card, client: byId.get(card.clientId) })).filter((p) => p.client) };
}

/**
 * Build this week's plan for every client (a dry run - stores proposals, sends nothing).
 * `opts.clientIds` limits it (the "swap" and "rebuild one" paths). Returns the plan.
 */
async function buildPlan(coachClientId, opts = {}) {
  const now = opts.now ? new Date(opts.now).getTime() : Date.now();
  const week = opts.weekOf || planStore.weekOf(new Date(now));
  const coach = await clientService.getClientById(coachClientId);
  if (!coach) throw new Error(`coach ${coachClientId} not found`);
  const { all, pairs } = await clientsWithCards(coachClientId);
  const only = opts.clientIds ? new Set(opts.clientIds) : null;
  const since = new Date(now - 400 * DAY);
  const [touches, pins, skips, snapshots, bounced] = await Promise.all([
    touchStore.touchesSince(since), planStore.pinsFor(week), planStore.skips(), campaignSnapshots(), bouncedAddresses(coachClientId),
  ]);
  const touchesByClient = new Map();
  for (const t of touches) {
    if (!touchesByClient.has(t.client_id)) touchesByClient.set(t.client_id, []);
    touchesByClient.get(t.client_id).push(t);
  }
  const ctx = { now, snapshots, bounced, touchesByClient, pins, skips };
  const shelf = content.listPieces();
  const out = [];

  for (const { card, client } of pairs) {
    if (only && !only.has(client.clientId)) continue;
    const existing = await planStore.planFor(week, client.clientId);
    if (existing && !['proposed', 'nothing', 'left-out'].includes(existing.status) && !opts.force) { out.push(existing); continue; } // Guy has spoken
    let facts;
    try { facts = await factsFor(client, card, ctx); }
    catch (e) { logger.error(`facts for ${client.clientId} failed: ${e.message}`); continue; }
    if (opts.skipThisWeek && opts.skipThisWeek.has(client.clientId)) facts.skipThisWeek = true;
    const pick = picker.pickFor(facts, shelf, ctx.touchesByClient.get(client.clientId) || [], { now, order: MANIFEST.client });

    let status = 'proposed';
    let openingDraft = null;
    let body = null;
    let subject = '';
    if (pick.leftOut) status = 'left-out';
    else if (!pick.what) status = 'nothing';
    else {
      body = await buildBody(pick, { coach, client, pin: pick.rule === 'pinned' ? (facts.pin || facts.pinForEveryone) : null });
      subject = body.error ? '' : subjectFor(pick, body);
      if (!body.error && opts.openings !== false) {
        openingDraft = await opening.draftOpening({
          coach, client, note: facts.noteText,
          pick: { title: body.title, dek: body.dek, form: pick.form, kindLine: pick.what.kind === 'call' ? 'an offer of times for a call' : pick.what.kind },
          factLines: factLines(facts, facts.signals, card),
          today: new Date(now).toISOString().slice(0, 10),
        }, opts.openingDeps || {});
      }
    }
    const { noteText, signals, ...storedFacts } = facts;
    const row = await planStore.upsertPlan({
      weekOf: week, clientId: client.clientId, status,
      pick: { ...pick, body: body ? { title: body.title, dek: body.dek, qs: body.qs, error: body.error || null, missing: !!body.missing, slotsFound: body.slotsFound } : null, opening: openingDraft ? { check: openingDraft.check, confidence: openingDraft.confidence, factsUsed: openingDraft.factsUsed, source: openingDraft.source, error: openingDraft.error || null } : null },
      facts: { ...storedFacts, signals: { paused: signals.paused, runningLow: signals.runningLow, acceptancesSlow: signals.acceptancesSlow, live: signals.live, pausedWaiting: signals.pausedWaiting } },
      opening: openingDraft ? openingDraft.opening : '',
      subject,
      bodyHtml: body && !body.error ? body.bodyHtml : '',
      bodyPreview: body && !body.error ? previewText(body.bodyHtml) : (body && body.error ? `could not build: ${body.error}` : ''),
      recipient: facts.address,
    });
    out.push(row || { weekOf: week, clientId: client.clientId, status, pick, opening: openingDraft ? openingDraft.opening : '', subject });
  }
  logger.info(`plan ${week}: ${out.length} rows (${out.filter((r) => r.pick && r.pick.what).length} picks, ${out.filter((r) => r.status === 'left-out').length} left out)`);
  return { weekOf: week, rows: out };
}

// ---------------------------------------------------------------------------------------------
// Sending

/** The never-sent check again, from a FRESH record, at the moment of sending. */
async function sendGuard(clientId, row, deps = {}) {
  const cs = deps.clientService || clientService;
  const ps = deps.planStore || planStore;
  const ts = deps.touchStore || touchStore;
  if (cs.clearCache) cs.clearCache();
  const client = await cs.getClientById(clientId);
  if (!client) return { ok: false, reason: 'record not found' };
  const skips = await ps.skips();
  const skip = skips.get(clientId);
  const facts = {
    status: client.status, coachingStatus: client.coachingStatus || null,
    group: client.coachingStatus === 'Paused' || client.status !== 'Active' ? 'paused' : 'running',
    billingLapsed: false, unsubscribed: !!client.emailUnsubscribed, hasUnsubToken: !!client.emailUnsubToken,
    address: lower(client.clientEmailAddress) || null, bounced: false, skipUntil: skip ? skip.until : null, skipThisWeek: false,
  };
  const reason = picker.neverSentReason(facts, Date.now());
  if (reason) return { ok: false, reason, client };
  const todays = await ts.touchesFor(clientId, { limit: 5 });
  const start = new Date(); start.setHours(0, 0, 0, 0);
  if (todays.some((t) => ['one-pager', 'habit', 'setup', 'one-off', 'personal'].includes(t.kind) && new Date(t.sent_at) >= start)) {
    return { ok: false, reason: 'something already went to them today', client };
  }
  if (row.pick && row.pick.what && ['one-pager', 'habit'].includes(row.pick.what.kind) && row.pick.form !== 'short') {
    const already = await ts.hasHad(clientId, row.pick.what.kind, row.pick.what.key);
    if (already) return { ok: false, reason: `they already had ${row.pick.what.key} (${String(already.sent_at).slice(0, 10)})`, client };
  }
  return { ok: true, client };
}

/**
 * Send every row Guy approved (status approved or edited) for the week. `deps.mailer` for tests.
 * Returns { sent, failed, held, results }. Nothing in 'proposed' is ever sent here.
 */
async function sendApproved(coachClientId, week, deps = {}) {
  const mailer = deps.mailer || require('./seriesMailer');
  const ps = deps.planStore || planStore;
  const ts = deps.touchStore || touchStore;
  const { unsubscribeUrlFor } = require('./clientUnsubscribe');
  const results = [];
  let sent = 0; let failed = 0; let held = 0;
  const plan = await ps.plansFor(week);
  for (const row of plan) {
    if (!['approved', 'edited'].includes(row.status)) continue;
    if (!row.pick || !row.pick.what || !EMAIL_KINDS.has(row.pick.what.kind)) continue;
    const guard = await sendGuard(row.clientId, row, deps);
    if (!guard.ok) {
      held++;
      results.push({ clientId: row.clientId, status: 'held', reason: guard.reason });
      await ps.setPlanStatus(week, row.clientId, row.status, { sendError: `held: ${guard.reason}` });
      continue;
    }
    const client = guard.client;
    const unsubscribeUrl = unsubscribeUrlFor(client);
    if (!unsubscribeUrl) { held++; results.push({ clientId: row.clientId, status: 'held', reason: 'no unsubscribe link' }); continue; }
    if (row.pick.body && (row.pick.body.error || row.pick.body.missing)) {
      held++; results.push({ clientId: row.clientId, status: 'held', reason: 'the body is not built' }); continue;
    }
    const html = composeEmail({ client, opening: row.opening, body: { title: row.pick.body.title, dek: row.pick.body.dek, bodyHtml: row.bodyHtml, qs: row.pick.body.qs }, unsubscribeUrl });
    const to = lower(client.clientEmailAddress);
    const res = await mailer.sendSeriesEmail({ to, subject: row.subject, html, unsubscribeUrl, preheader: row.opening ? row.opening.slice(0, 120) : undefined, tag: `client-touch-${row.pick.what.kind}` });
    if (!res.ok) {
      failed++;
      results.push({ clientId: row.clientId, status: 'failed', error: res.error });
      await ps.setPlanStatus(week, row.clientId, 'failed', { sendError: res.error });
      continue;
    }
    const kind = row.pick.what.kind === 'call' ? 'personal' : row.pick.what.kind;
    await ts.record({
      clientId: row.clientId, kind, key: row.pick.what.key, form: row.pick.form, sentAt: new Date(),
      reason: row.pick.reason, source: 'planner', recipient: to,
      meta: { weekOf: week, rule: row.pick.rule, subject: row.subject, mailgunId: res.id || null, opening: row.opening || '' },
    });
    await ps.setPlanStatus(week, row.clientId, 'sent', { sentAt: new Date() });
    sent++;
    results.push({ clientId: row.clientId, status: 'sent', id: res.id });
  }
  logger.info(`send ${week}: ${sent} sent, ${failed} failed, ${held} held`);
  return { weekOf: week, sent, failed, held, results };
}

// ---------------------------------------------------------------------------------------------
// Guy's Monday preview (the only automatic email), and the tick

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch])); }

/** The preview email to Guy - every row, what it is and why, the opening - and the one link to the screen. */
function buildPreview(plan, { screenUrl = '', autosend = false, vetoBy = 'Tuesday 9am' } = {}) {
  const picks = plan.rows.filter((r) => r.pick && r.pick.what);
  const quiet = plan.rows.filter((r) => r.status === 'nothing');
  const out = plan.rows.filter((r) => r.status === 'left-out');
  const parts = [];
  parts.push(`<p>${picks.length} email${picks.length === 1 ? '' : 's'} prepared for the week of ${esc(plan.weekOf)}. ${autosend ? `They go out by themselves after ${esc(vetoBy)} unless you veto them on the screen.` : 'Nothing goes until you approve it on the screen and press Send approved.'}</p>`);
  if (screenUrl) parts.push(`<p><a href="${esc(screenUrl)}">Open the Monday screen</a></p>`);
  for (const r of picks) {
    parts.push(`<h3 style="margin-bottom:2px">${esc(r.facts && r.facts.clientName ? r.facts.clientName : r.clientId)} - ${esc(r.pick.what.title)}${r.pick.form === 'short' ? ' (short)' : ''}</h3>`);
    parts.push(`<p style="margin:0;color:#666">${esc(r.pick.reason)}</p>`);
    parts.push(`<p style="margin:6px 0 12px">${r.opening ? esc(r.opening) : '<i>(no opening drafted - needs your words)</i>'}</p>`);
  }
  if (quiet.length) parts.push(`<p><b>Nothing this week:</b> ${quiet.map((r) => `${esc(r.facts && r.facts.clientName ? r.facts.clientName : r.clientId)} (${esc(r.pick ? r.pick.reason : '')})`).join('; ')}</p>`);
  if (out.length) parts.push(`<p><b>Left out:</b> ${out.map((r) => `${esc(r.facts && r.facts.clientName ? r.facts.clientName : r.clientId)} - ${esc(r.pick ? r.pick.reason : '')}`).join('; ')}</p>`);
  return { subject: `Monday emails - ${plan.weekOf} - ${picks.length} to approve`, html: parts.join('\n') };
}

/** The scheduled Monday build + preview, and (autosend only) the Tuesday send. Claims in Postgres, so a restart never doubles. */
async function tick(deps = {}) {
  const coachClientId = (process.env.RECALL_COACH_CLIENT_ID || 'Guy-Wilson').trim();
  const nowB = brisbaneNow();
  const week = planStore.weekOf();
  if (nowB.weekday === 'Mon' && nowB.hour >= BUILD_HOUR) {
    if (await planStore.claimWeekly('build', week)) {
      logger.info(`Monday build for ${week}`);
      const plan = await buildPlan(coachClientId);
      const send = deps.sendAlertEmail || require('./emailNotificationService').sendAlertEmail;
      const screenUrl = process.env.CLIENT_TOUCH_SCREEN_URL || 'https://pb-webhook-server.vercel.app/coached-clients';
      const pv = buildPreview(plan, { screenUrl, autosend: autosendOn() });
      await send(pv.subject, pv.html);
      return { ran: 'build', weekOf: week, rows: plan.rows.length };
    }
  }
  if (autosendOn() && nowB.weekday === 'Tue' && nowB.hour >= VETO_HOUR) {
    if (await planStore.claimWeekly('autosend', week)) {
      logger.info(`autosend for ${week} (CLIENT_TOUCH_AUTOSEND=on) - approving every untouched proposal with a passing opening`);
      const plan = await planStore.plansFor(week);
      for (const r of plan) {
        if (r.status !== 'proposed' || !r.pick || !r.pick.what) continue;
        const ok = r.pick.opening && r.pick.opening.check && r.pick.opening.check.ok;
        if (ok) await planStore.setPlanStatus(week, r.clientId, 'approved');
      }
      const res = await sendApproved(coachClientId, week, deps);
      return { ran: 'autosend', ...res };
    }
  }
  return { ran: false };
}

function startClientTouchPlanner() {
  if (lower(process.env.CLIENT_TOUCH_PLANNER || 'on') === 'off') { logger.info('client-touch-planner: disabled via CLIENT_TOUCH_PLANNER=off'); return; }
  if (intervalHandle) return;
  const run = async () => {
    if (ticking) return;
    ticking = true;
    try { await tick(); } catch (e) { logger.error(`client-touch-planner tick failed (non-fatal): ${e.message}`); } finally { ticking = false; }
  };
  intervalHandle = setInterval(run, TICK_MS);
  setTimeout(run, 3 * 60 * 1000);
  logger.info(`client-touch-planner: starting (build Mondays after ${BUILD_HOUR}:00 Brisbane; autosend ${autosendOn() ? 'ON - Tuesday 9am veto' : 'OFF - Guy approves every email'})`);
}

// ---------------------------------------------------------------------------------------------
// What the screen reads

function improvementsFile() {
  try { return fs.readFileSync(path.join(__dirname, '..', 'content', 'one-pagers', 'IMPROVEMENTS.md'), 'utf8'); } catch (_) { return ''; }
}

/** The whole screen for a week: rows (with names), the left-out list, call-due list, improvements, the approval rate. */
async function screenFor(coachClientId, week) {
  const [plan, rates, all, pins, skips] = await Promise.all([
    planStore.plansFor(week), planStore.approvalRates(6), clientService.getAllClients(), planStore.pinsFor(week), planStore.skips(),
  ]);
  const byId = new Map(all.map((c) => [c.clientId, c]));
  const waiting = waitingImprovements(improvementsFile());
  const rows = plan.filter((r) => byId.has(r.clientId) && byId.get(r.clientId).coach === coachClientId).map((r) => {
    const c = byId.get(r.clientId);
    const f = r.facts || {};
    return {
      ...r,
      bodyHtml: undefined, // heavy - the preview endpoint serves it
      clientName: c.clientName,
      group: f.group || null,
      lastCallAt: f.lastSessionAt || null,
      lastTouchAt: [f.lastSessionAt, f.lastTouchAt].filter(Boolean).sort().reverse()[0] || null,
      nextSessionAt: f.nextSessionAt || null,
      callDue: f.group === 'running' && !f.nextSessionAt && (f.daysSinceLastCall === null || f.daysSinceLastCall >= picker.CALL_EVERY_DAYS),
      pinned: pins.get(r.clientId) || null,
      skip: skips.get(r.clientId) || null,
      waitingImprovements: r.pick && r.pick.what ? (waiting[r.pick.what.key] || 0) : 0,
      touchNote: c.touchNote || '',
    };
  });
  rows.sort((a, b) => String(a.clientName).localeCompare(String(b.clientName)));
  // The shelf, for swap and pin: the orientation then the client run, with titles.
  const titles = new Map(content.listPieces().map((p) => [p.slug, { title: p.title, kind: p.labels.kind }]));
  const shelf = [{ slug: ORIENTATION.slug, title: "What you've actually joined", kind: 'way-of-thinking' }, ...MANIFEST.client.map((slug) => ({ slug, title: (titles.get(slug) || {}).title || slug, kind: (titles.get(slug) || {}).kind || '' }))];
  return {
    weekOf: week,
    autosend: autosendOn(),
    shelf,
    rows,
    leftOut: rows.filter((r) => r.status === 'left-out').map((r) => ({ clientId: r.clientId, clientName: r.clientName, reason: r.pick ? r.pick.reason : '' })),
    onboardingNotBooked: rows.filter((r) => r.group === 'onboarding' && !r.nextSessionAt).map((r) => ({ clientId: r.clientId, clientName: r.clientName })),
    pinForEveryone: pins.get('*') || null,
    approvalRates: rates,
    waitingImprovements: waiting,
    counts: {
      picks: rows.filter((r) => r.pick && r.pick.what).length,
      approved: rows.filter((r) => ['approved', 'edited'].includes(r.status)).length,
      sent: rows.filter((r) => r.status === 'sent').length,
      nothing: rows.filter((r) => r.status === 'nothing').length,
      leftOut: rows.filter((r) => r.status === 'left-out').length,
    },
  };
}

/** The full HTML of one row's email as it would go (the screen's preview). */
async function previewFor(week, clientId) {
  const row = await planStore.planFor(week, clientId);
  if (!row || !row.pick || !row.pick.what || !row.pick.body) return null;
  const client = await clientService.getClientById(clientId);
  if (!client) return null;
  const { unsubscribeUrlFor } = require('./clientUnsubscribe');
  return composeEmail({ client, opening: row.opening, body: { title: row.pick.body.title, dek: row.pick.body.dek, bodyHtml: row.bodyHtml, qs: row.pick.body.qs }, unsubscribeUrl: unsubscribeUrlFor(client) || '#' });
}

module.exports = {
  buildPlan,
  sendApproved,
  sendGuard,
  screenFor,
  previewFor,
  buildPreview,
  tick,
  startClientTouchPlanner,
  autosendOn,
  // pure, tested
  campaignSignals,
  noteSettings,
  currentStop,
  recentEvents,
  waitingImprovements,
  factLines,
  composeEmail,
  subjectFor,
  shortBody,
  buildBody,
  previewText,
  BUILD_HOUR,
  VETO_HOUR,
};
