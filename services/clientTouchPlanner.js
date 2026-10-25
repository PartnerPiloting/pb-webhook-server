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
// Nothing goes to a client from here until Guy approves it (in chat with Claude, or the API) and presses "Send
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
const library = require('./inspirationLibrary');
const planStore = require('./clientTouchPlanStore');
const picker = require('./clientTouchPicker');
const opening = require('./clientTouchOpening');
const content = require('./onePagerContent');
const shell = require('./onePagerShell');
const MANIFEST = require('../config/onePagerSeriesManifest');
const { ORIENTATION, EVENTS } = require('../config/clientTouchLabels');
const briefs = require('./clientTouchBrief');
const cost = require('./clientTouchCost');
const { createLogger } = require('../utils/contextLogger');

const logger = createLogger({ runId: 'PLANNER', clientId: 'SYSTEM', operation: 'client_touch_planner' });

const DAY = 86400000;
const TICK_MS = 15 * 60 * 1000;
// The sending day (planStore.SEND_DAY - Wednesday since 24 Oct 2026, was Monday), Brisbane:
// approved emails go at SEND_HOUR - 11am Brisbane = 9am Perth, midday Sydney in daylight saving - then
// the NEXT week's plan is built at BUILD_HOUR (after the send, so today's sends are in the record).
const SEND_HOUR = Number(process.env.CLIENT_TOUCH_SEND_HOUR) || 11;
const BUILD_HOUR = Math.max(Number(process.env.CLIENT_TOUCH_BUILD_HOUR) || 12, SEND_HOUR + 1);
const SEND_DAY = planStore.SEND_DAY;
const SEND_DAY_NAME = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'][SEND_DAY];
const SEND_DAY_SHORT = SEND_DAY_NAME.slice(0, 3);
const hourLabel = (h) => (h < 12 ? `${h}am` : h === 12 ? '12pm' : `${h - 12}pm`);
const BRISBANE_OFFSET_HOURS = 10; // UTC+10, no daylight saving
const EMAIL_KINDS = new Set(['one-pager', 'habit', 'setup', 'one-off', 'call', 'custom']);
const BRAND = 'I Know A Guy';

let intervalHandle = null;
let ticking = false;

const present = (v) => Boolean(v && String(v).trim());
const lower = (v) => String(v || '').trim().toLowerCase();
const daysSince = (iso, now = Date.now()) => { const t = iso ? new Date(iso).getTime() : NaN; return Number.isNaN(t) ? null : Math.max(0, Math.floor((now - t) / DAY)); };

/**
 * Send-with-veto: when 'on', a proposal Guy never touched is treated as approved at the Monday
 * send (provided its opening passed the check). OFF by default - Guy approves every email.
 */
function autosendOn() {
  return lower(process.env.CLIENT_TOUCH_AUTOSEND) === 'on';
}

/** The Monday-morning send of what Guy APPROVED. On unless CLIENT_TOUCH_MONDAY_SEND=off. */
function mondaySendOn() {
  return lower(process.env.CLIENT_TOUCH_MONDAY_SEND || 'on') !== 'off';
}

/**
 * The master switch on sending ANY planner email to a client - the Monday send, "keep", the by-hand
 * route. On unless CLIENT_TOUCH_SEND_ENABLED=off; staging sets it off, so clicking around the staging
 * panel can never reach a real client (staging reads the same Airtable clients as production).
 */
function sendEnabled() {
  return lower(process.env.CLIENT_TOUCH_SEND_ENABLED || 'on') !== 'off';
}

/** The sending moment for a plan week: its sending day at SEND_HOUR, Brisbane. */
function sendAt(week, hour = SEND_HOUR) {
  const [y, m, d] = String(week).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + SEND_DAY, hour - BRISBANE_OFFSET_HOURS));
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

/**
 * When did the client's Today tab FIRST have records? = the earliest Date Connected in their base
 * (ISO date), or null when it has none (or the base cannot be read). "First" means the real first:
 * a client who has had Today records for months is not having that moment now (22 Oct 2026 - the
 * planner's first week saw it fire for every long-standing client).
 */
async function todayFirstRecordAt(client) {
  if (!client.airtableBaseId) return null;
  try {
    const base = clientService.getClientBase(client.airtableBaseId);
    const recs = await base('Leads').select({
      filterByFormula: "{Date Connected} != ''", sort: [{ field: 'Date Connected', direction: 'asc' }], maxRecords: 1, fields: ['Date Connected'],
    }).firstPage();
    const v = recs[0] && recs[0].get('Date Connected');
    const t = v ? new Date(v) : null;
    return t && !Number.isNaN(t.getTime()) ? t.toISOString() : null;
  } catch (e) {
    logger.warn(`Today probe for ${client.clientId} skipped: ${e.message}`);
    return null;
  }
}

/**
 * Is this client winding down - a cancellation already scheduled on their Stripe subscription?
 * Returns the end date (ISO) or null. Unknown (no subscription, Stripe not set up, a read error)
 * = null: never leave someone out on a guess.
 */
async function stripeCancellationAt(client, deps = {}) {
  if (!client.stripeSubscriptionId) return null;
  let stripe = deps.stripe;
  if (!stripe) {
    try {
      const sc = require('../config/stripeClient');
      if (!sc.isStripeAvailable()) return null;
      stripe = sc.stripe;
    } catch (_) { return null; }
  }
  try {
    return cancellationFrom(await stripe.subscriptions.retrieve(client.stripeSubscriptionId));
  } catch (e) {
    logger.warn(`Stripe read for ${client.clientId} skipped: ${e.message}`);
    return null;
  }
}

/** The scheduled end of a Stripe subscription that is set to cancel, or null. Pure. */
function cancellationFrom(sub) {
  if (!sub || ['canceled', 'incomplete_expired'].includes(sub.status)) return null; // already over - Status covers it
  const at = sub.cancel_at || (sub.cancel_at_period_end ? (sub.current_period_end || (sub.items && sub.items.data && sub.items.data[0] && sub.items.data[0].current_period_end)) : null);
  return at ? new Date(at * 1000).toISOString() : null;
}

/** Guy's leave-off list for all-client emails (config/clientEmailOverrides.json): clientId -> reason. */
function leaveOffList(file = path.join(__dirname, '..', 'config', 'clientEmailOverrides.json')) {
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return new Map((data.leaveOff || []).filter((x) => x && x.clientId).map((x) => [x.clientId, x.reason || 'on your leave-off list for all-client emails']));
  } catch (e) {
    logger.warn(`leave-off list unreadable: ${e.message}`);
    return new Map();
  }
}

/**
 * The today-first-records event's date: the REAL first record date when there is one, so the
 * event only counts while that is recent. Fixes the stored first-seen state too. Pure.
 */
function todayFirstSeen(firstSeen, firstRecordAt) {
  const out = { ...firstSeen };
  if (firstRecordAt) out['today-first-records'] = firstRecordAt;
  else delete out['today-first-records'];
  return out;
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

/**
 * The note's settings: "length" - full unless the note asks for short in so many words; "weeklyTips" -
 * "weekly tips" in the note gives an onboarding client a tips email most weeks (Guy, 23 Oct 2026 - Dean).
 */
function noteSettings(note) {
  const n = String(note || '');
  return { length: /\b(short|brief|keep (it|them) short)\b/i.test(n) ? 'short' : 'full', weeklyTips: /\bweekly tips?\b/i.test(n), text: n };
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

/**
 * The last substantial touch (shown as "last touch"), and the last one Guy made HIMSELF. "Not this
 * week" reads only the second: it is about Guy's own touches (a call, a real email, an
 * introduction). The planner's weekly email is not one - counting it would make every other week
 * a quiet one. Times in ms, or null.
 */
function lastTouches(record) {
  const latest = (rs) => rs.map((r) => new Date(r.sent_at).getTime()).filter((t) => !Number.isNaN(t)).sort((a, b) => b - a)[0] || null;
  const substantial = (record || []).filter((r) => touchStore.SUBSTANTIAL_KINDS.includes(r.kind));
  // The personal note Guy sends to clear what he owes (first things first) is what RELEASES that
  // week's email - it must not then make the week a quiet one.
  const own = substantial.filter((r) => r.source !== 'planner' && !String(r.key || '').startsWith(OWED_NOTE_KEY));
  return { lastTouchAt: latest(substantial), lastPersonal: latest(own) };
}

const OWED_NOTE_KEY = 'owed-note';

/** The live-fact lines the opening is allowed to rely on. */
function factLines(f, signals = {}, card = null) {
  const lines = [];
  signals = signals || {};
  // Their standing with Guy today - a brief once read a September card failure as "status unconfirmed".
  if (f.status) lines.push(`Client record: Status ${f.status}${f.coachingStatus ? `, coaching ${f.coachingStatus}` : ''} (current - any earlier pause or failed payment is over if this says Active)`);
  lines.push(`Invitations:${f.lastInviteSent ? `going out (last one ${String(f.lastInviteSent).slice(0, 10)})` : 'NOT going out yet'}${signals.paused ? ` - campaign PAUSED with ${signals.pausedWaiting} people waiting` : ''}`);
  if ((signals.lines || []).length) lines.push(`Campaign numbers: ${signals.lines.join(' | ')}`);
  lines.push(`Last call with Guy: ${f.daysSinceLastCall === null ? 'none on record' : `${f.daysSinceLastCall} days ago`}${card && card.nextSession ? `; next session booked ${String(card.nextSession.at).slice(0, 10)}` : '; nothing booked'}`);
  lines.push(`Today tab: ${f.todayHasRecords ? 'has records' : 'no records yet'}`);
  lines.push(`Journey: ${f.group === 'onboarding' ? 'still in onboarding' : 'running'}${f.stuckStop ? `; on the "${f.stuckStop}" stop for ${f.stuckDays} days` : ''}`);
  if (card && card.lastUsedAt) lines.push(`Last used Wingguy: ${daysSince(card.lastUsedAt)} days ago`);
  if (f.events && f.events.length) lines.push(`Happened recently: ${f.events.map((e) => (EVENTS[e.key] || {}).label || e.key).join('; ')}`);
  return lines;
}

// ---------------------------------------------------------------------------------------------
// Facts for one client

/**
 * The facts for one client. `ctx.now` is the real clock (when things were first seen); `ctx.at` is
 * the sending morning the plan is for - "days since" is counted to then, because a plan built a
 * week ahead is judged as it will stand on the day it goes.
 */
async function factsFor(client, card, ctx) {
  const now = ctx.now;
  const at = ctx.at || now;
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
    if (prevStop === stop && since) stuckDays = daysSince(since, at) || 0;
    else await planStore.setState(stopKey, `${stop}|${new Date(now).toISOString()}`);
  }

  // Events, with when each was first seen - so "first" means first.
  const seenKey = `events:${client.clientId}`;
  let firstSeen = {};
  try { firstSeen = JSON.parse((await planStore.getState(seenKey)) || '{}'); } catch (_) { firstSeen = {}; }
  const [todayFirstAt, cancelsAt] = await Promise.all([todayFirstRecordAt(client), stripeCancellationAt(client, ctx.stripeDeps || {})]);
  const today = !!todayFirstAt;
  firstSeen = todayFirstSeen(firstSeen, todayFirstAt);
  const nowIso = new Date(now).toISOString();
  const mark = (k) => { if (!firstSeen[k]) firstSeen[k] = nowIso; };
  if (signals.runningLow && client.lastInviteSent) {
    // A recurring event: it can fire again once the previous one is older than the resend window.
    const d = daysSince(firstSeen['campaign-running-low'], now);
    if (d === null || d > picker.REINFORCE_AFTER_WEEKS * 7) firstSeen['campaign-running-low'] = nowIso;
  }
  if (signals.acceptancesSlow) mark('acceptances-slow');
  // When their invitations started: nothing records it (the earliest connection is often an old
  // imported one - Alex's goes back to 2015), so the first day the planner sees invitations going out.
  if (client.lastInviteSent) mark('invitations-going');
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

  const { lastTouchAt, lastPersonal } = lastTouches(record);
  const dSession = daysSince(card.lastSessionAt, at);
  const dTouch = lastPersonal ? daysSince(lastPersonal, at) : null;
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
    windingDownUntil: cancelsAt,
    leaveOff: (ctx.leaveOff && ctx.leaveOff.get(client.clientId)) || null,
    todayFirstRecordAt: todayFirstAt,
    invitationsStartedAt: invitationsStarted(client.launchDate, firstSeen['invitations-going']),
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
    events: recentEvents(firstSeen, at),
    callProblems: [],
    stuckStop: stop,
    stuckDays,
    quietOrBusy: !!firstSeen.busy,
    note: { length: note.length },
    weeklyTips: note.weeklyTips,
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

// ---------------------------------------------------------------------------------------------
// The offer of times for a call. The plan is built a week ahead, so the times must be chosen for
// the day the email ARRIVES, not the day it was built (22 Oct: Hiresh's offer was drawn on the
// Thursday for a Monday send). Only slots from the day after the sending Monday are offered, the
// slots are kept on the plan row, and the sending-morning re-check re-picks them if any has gone.

const CALL_SLOTS = 3;
const CALL_NEAR_DAYS = 14;   // prefer times within a fortnight of the earliest offerable day

/** The earliest moment a call can be offered for a plan week: 00:00 Brisbane on the Tuesday after the send. */
function callNotBefore(week) {
  const [y, m, d] = String(week).split('-').map(Number);
  return Date.UTC(y, m - 1, d + SEND_DAY + 1, -BRISBANE_OFFSET_HOURS);
}

/**
 * Two or three considered times from filtered availability, no earlier than `notBefore`: one per
 * day, light days first within the fortnight after `notBefore`, then later days only to top up.
 * Pure. Returns [{ time, label }].
 */
function pickCallSlots(filtered, notBefore, { max = CALL_SLOTS, tz = 'Australia/Brisbane' } = {}) {
  const fmt = (s) => s.label || require('./wingguyCalendar').fmtSlot(s.time, tz);
  const days = (filtered && filtered.days ? filtered.days : [])
    .map((d) => ({ ...d, freeSlots: (d.freeSlots || []).filter((s) => Date.parse(s.time) >= notBefore) }))
    .filter((d) => d.freeSlots.length);
  const nearEnd = notBefore + CALL_NEAR_DAYS * DAY;
  const near = days.filter((d) => Date.parse(d.freeSlots[0].time) < nearEnd);
  const later = days.filter((d) => Date.parse(d.freeSlots[0].time) >= nearEnd);
  const ordered = [...near.filter((d) => !d.busyDay), ...near.filter((d) => d.busyDay), ...later];
  const picked = ordered.slice(0, max).map((d) => ({ time: d.freeSlots[0].time, label: fmt(d.freeSlots[0]) }));
  return picked.sort((x, y) => Date.parse(x.time) - Date.parse(y.time));
}

/**
 * The call offer reads as ONE short note (Guy, 22 Oct): the opening asks, the body is the times and
 * the reply line - no heading, no second "it has been a while". The opening is fixed, not drafted.
 */
const CALL_OPENING = "It's been a little while since our last call - I'd love to catch up. Would any of these suit for half an hour?";

/** The call-offer body for a list of slots. Pure. */
function callOfferHtml(slots) {
  const times = slots.length ? `<ul>${slots.map((s) => `<li>${s.label}</li>`).join('')}</ul>` : '<p>(no free times could be read from the calendar - add two or three by hand)</p>';
  return `${times}<p>Reply with whichever works and I'll send the invite - or tell me a time that suits you better.</p>`;
}

/** Guy's free times, filtered by his booking preferences, read now. */
async function callAvailability(coach, client) {
  const cal = require('./wingguyCalendar');
  const { getBookingPrefs } = require('../config/wingguyBookingPrefs');
  const avail = await cal.getAvailabilityForCoach(coach.clientId, client.location || client.timezone || '');
  const filtered = cal.filterAvailability(avail, getBookingPrefs(coach.clientId), { includeFarWeeks: true });
  return { filtered, tz: filtered.leadTimezone || filtered.yourTimezone || 'Australia/Brisbane' };
}

/** Guy's offer of two or three considered times for the week's sending Monday - never a booking link. */
async function callOfferBody(coach, client, { week } = {}, deps = {}) {
  let slots = [];
  try {
    const { filtered, tz } = await (deps.callAvailability || callAvailability)(coach, client);
    const notBefore = week ? Math.max(callNotBefore(week), Date.now() + DAY) : Date.now() + DAY;
    slots = pickCallSlots(filtered, notBefore, { tz });
  } catch (e) {
    logger.warn(`times for ${client.clientId} skipped: ${e.message}`);
  }
  return { title: 'Time for a catch-up', dek: '', bodyHtml: callOfferHtml(slots), slotsFound: slots.length, slots };
}

/**
 * The sending-morning check on a call offer: are the times still free and still at least a day
 * away? If yes, nothing changes. If not, fresh times are picked and the body redrawn (Guy's
 * approval stands - the email is the same offer with today's times). No free time at all -> hold.
 * Returns { ok, bodyHtml?, slots?, changed?, reason? }.
 */
async function refreshCallOffer(row, coach, client, deps = {}) {
  const offered = (row.pick && row.pick.body && row.pick.body.slots) || [];
  const { filtered, tz } = await (deps.callAvailability || callAvailability)(coach, client);
  const notBefore = Date.now() + DAY;
  const free = new Set();
  for (const d of filtered.days || []) for (const s of d.freeSlots || []) free.add(Date.parse(s.time));
  const stillGood = offered.length > 0 && offered.every((s) => Date.parse(s.time) >= notBefore && free.has(Date.parse(s.time)));
  if (stillGood) return { ok: true, changed: false };
  const slots = pickCallSlots(filtered, notBefore, { tz });
  if (!slots.length) return { ok: false, reason: 'the call offer has no free times left in your calendar - add times by hand or swap it' };
  return { ok: true, changed: true, slots, bodyHtml: callOfferHtml(slots) };
}

// ---------------------------------------------------------------------------------------------
// The FIRST weekly email every client gets - Guy's approved template (22 Oct 2026, "That works").
// Used when the pick is the orientation, the client has had no planner email yet, and their
// invitations are actually going out (Last Invite Sent) - never before.

const FIRST_EMAIL = {
  subject: "You're not doing this alone",
  title: "You're not doing this alone",
  congrats: "Congratulations! You've started the process of growing your network predictably and consistently - seeded by connection requests to people you've chosen on LinkedIn. From here, small tweaks to the process usually bring big improvements in results.",
  lead: "First, a quick word on what you're now part of.",
};

/** The orientation body for the first email: without "Your engine is switched on." and without the "Next email" line. Pure. */
function firstEmailBody(orientationHtml) {
  return String(orientationHtml)
    .replace(/<p>\s*Your engine is switched on\.\s*/, '<p>')
    .replace(/\s*<p>\s*Next email:[^<]*<\/p>/, '');
}

const WELCOME_LATE_DAYS = 28;

/**
 * The note when a welcome would read late: invitations started (the client's first connection,
 * their earliest Date Connected) more than four weeks before the sending morning. Null otherwise. Pure.
 */
function welcomeLateNote(startedAt, at) {
  const t = startedAt ? new Date(startedAt).getTime() : NaN;
  if (Number.isNaN(t) || at - t <= WELCOME_LATE_DAYS * DAY) return null;
  const d = new Date(t).toLocaleDateString('en-AU', { timeZone: 'Australia/Brisbane', day: 'numeric', month: 'short', year: 'numeric' });
  return `invitations started ${d} - "Congratulations, you've started" may read late; keep or reword`;
}

/**
 * When a client's invitations started, as best the system can tell: their Launch Date (when their
 * system went live - what the "since launch" filters already key on), else the first day the
 * planner saw their invitations going out. Pure.
 */
function invitationsStarted(launchDate, firstSeenGoing) {
  for (const v of [launchDate, firstSeenGoing]) {
    const t = v ? new Date(v).getTime() : NaN;
    if (!Number.isNaN(t)) return new Date(t).toISOString();
  }
  return null;
}

/** Does this pick get the first-email template? Pure. */
function usesFirstEmail(pick, { firstWeekly, lastInviteSent }) {
  return !!(pick && pick.what && pick.what.key === ORIENTATION.slug && firstWeekly && lastInviteSent);
}

/** Render the body for a pick: { title, dek, bodyHtml, preview }. Never throws; a failed render is flagged. */
async function buildBody(pick, { coach, client, pin, week, firstEmail = false }) {
  const kind = pick.what.kind;
  try {
    if (kind === 'one-pager' || kind === 'habit') {
      const slug = pick.what.key;
      if (slug === ORIENTATION.slug && firstEmail) {
        const email = require('./onePagerEmail');
        return { title: FIRST_EMAIL.title, dek: '', bodyHtml: firstEmailBody(email.clientOrientationBody()), qs: '?audience=client', template: 'first-email' };
      }
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
    if (kind === 'call') return await callOfferBody(coach, client, { week });
    return { error: `no body for kind ${kind}` };
  } catch (e) {
    return { error: e.message };
  }
}

function previewText(html) {
  return String(html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 240);
}

// The weekly client email looks like a personal email from Guy (22 Oct 2026): no banner, no series
// branding, no big heading - "Hi <name>," then his words, "Cheers, / Guy", and one quiet line at
// the bottom to stop them. A one-pager piece sits underneath as plain text under a simple bold
// title. The prospect series and the public /series pages keep their own look (onePagerShell).

const FIRST_WEEKLY_NOTE = "One more thing - from now on I'll send you a short email most weeks: an idea, a tip, or something I've picked up from other clients that I think will help. If one doesn't land, just reply and tell me. And if you'd rather not get them, there's a link at the bottom.";
const PIECE_KINDS = new Set(['one-pager', 'habit']);

/** "Hiresh, it's been..." under "Hi Hiresh," reads twice - drop a leading name (or greeting + name). Pure. */
function stripLeadingName(text, firstName) {
  const t = String(text || '').trim();
  const name = String(firstName || '').trim();
  if (!t || !name) return t;
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = t.match(new RegExp(`^(?:(?:hi|hello|hey|g'day)\\s+)?${esc}\\s*[,:!-]+\\s*`, 'i'));
  if (!m) return t;
  const rest = t.slice(m[0].length);
  return rest ? rest.charAt(0).toUpperCase() + rest.slice(1) : t;
}

/**
 * Compose the full email. `kind` decides whether the body is a piece (bold title + text) or part of
 * the note itself (a call offer, a setup step, a one-off). `firstWeekly` adds the one-time note
 * about what these emails are; `thought` adds "A thought for the week:".
 */
function composeEmail({ client, opening: openingText, body, unsubscribeUrl, baseUrl, kind = null, firstWeekly = false, thought = null }) {
  const email = require('./onePagerEmail');
  const esc = (x) => String(x).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  const first = email.firstNameOf(client.clientFirstName || client.clientName);
  const parts = [`<p>${first ? `Hi ${esc(first)},` : 'Hi there,'}</p>`];
  const op = stripLeadingName(openingText, first);
  if (body.template === 'first-email') {
    const congrats = typeof body.congrats === 'string' ? body.congrats.trim() : FIRST_EMAIL.congrats;
    if (congrats) parts.push(`<p>${esc(congrats)}</p>`);
    if (op) parts.push(`<p>${esc(op)}</p>`);
    parts.push(`<p>${esc(FIRST_EMAIL.lead)}</p>`);
  } else if (op) parts.push(`<p>${esc(op)}</p>`);
  const isPiece = kind ? PIECE_KINDS.has(kind) : !!body.title;
  if (isPiece && body.title) parts.push(`<p style="margin-top:22px"><strong>${esc(body.title)}</strong></p>`);
  parts.push(body.bodyHtml || '');
  if (thought && thought.text) parts.push(briefs.quoteHtml(thought.text, { label: 'A thought for the week' }));
  if (firstWeekly) parts.push(`<p>${esc(FIRST_WEEKLY_NOTE)}</p>`);
  parts.push('<p>Cheers,<br>Guy</p>');
  parts.push(`<p style="margin-top:28px;font-size:12px;color:#888">Rather not get these weekly emails? <a href="${esc(unsubscribeUrl || '#')}" style="color:#888">Unsubscribe</a></p>`);
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(body.title || 'A note from Guy')}</title></head><body style="margin:0;padding:16px;background:#ffffff"><div style="max-width:620px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.55;color:#222">${parts.join('\n')}</div></body></html>`;
  const base = baseUrl || process.env.SERIES_PUBLIC_BASE_URL || 'https://knowaguy.com.au';
  return email.absolutizeLinks(html, base);
}

/** Is this the first weekly email the client will ever get? = no planner send on their record (Mindset Mastery and Guy's own emails don't count). Pure. */
function isFirstWeekly(record) {
  return !(record || []).some((r) => r.source === 'planner');
}

function subjectFor(pick, body) {
  if (body && body.template === 'first-email') return FIRST_EMAIL.subject;
  const kind = pick.what.kind;
  if (kind === 'one-pager' || kind === 'habit') return `${BRAND} - ${body.title}`;
  return body.title;
}

// ---------------------------------------------------------------------------------------------
// The deep client brief's say on each week (services/clientTouchBrief.js, Guy 22 Oct 2026)

/** Guy's own server key (ANTHROPIC_API_KEY - "Guy's Individual Org"), or null when it is not set. */
function serverLlm() {
  try { return require('../config/anthropicClient').getAnthropicClient(); } catch (_) { return null; }
}

/** The words in a row the fact guard reads: a custom email's body, or the opening (and a welcome's congratulations line). Pure. */
function guardText({ pick, opening, bodyHtml }) {
  if (pick && pick.what && pick.what.kind === 'custom') return briefs.htmlText(bodyHtml);
  const parts = [];
  if (pick && pick.body && pick.body.template === 'first-email') parts.push(typeof pick.body.congrats === 'string' ? pick.body.congrats : FIRST_EMAIL.congrats);
  if (opening && !(pick && pick.opening && pick.opening.source === 'fixed')) parts.push(opening);
  return parts.filter(Boolean).join('\n');
}

/**
 * What the brief changes about one client's week. Three things, in order:
 *   - FIRST THINGS FIRST: Guy owes them something important -> a drafted personal note for him to
 *     edit and send himself (fact-guarded); the weekly email waits until he marks it sent or dismisses it;
 *   - FIT: the approved piece the picker chose is checked against where they really are;
 *   - CUSTOM: when it does not fit - or a running client has no invitations out yet, so nothing on the
 *     shelf can start - an email is written for them from the brief. Guy's pins are never replaced.
 * Returns { pick, body, firstThings, customDeclined }. Throws only BudgetError.
 * deps.briefs for tests; llmFor(purpose) -> a metered llm or null.
 */
async function deepen({ pick, body, brief, client, facts, factLinesNow = [], week, firstWeekly = false, pastTips = [], record = [], llmFor = () => null, at = Date.now() }, deps = {}) {
  const b = deps.briefs || briefs;
  const out = { pick, body, firstThings: null, customDeclined: null };
  if (!brief || pick.leftOut || (brief.error && !(brief.trueNow || []).length)) return out;
  const budget = (e) => { if (e && e.name === 'BudgetError') throw e; };

  const due = b.firstThingsDue(brief);
  if (due.length) {
    const ft = { status: 'open', items: due, note: null, guard: null, error: null, at: new Date().toISOString() };
    const llm = llmFor('note');
    if (llm) {
      try {
        ft.note = await b.draftOwedNote(llm, { client, brief, items: due });
        ft.guard = await b.checkClaims(ft.note.text, { facts, factLines: factLinesNow, brief, llm: llmFor('guard'), client, at });
      } catch (e) { budget(e); ft.error = `the note could not be drafted (${e.message}) - write it yourself`; }
    } else ft.error = 'no Claude key on the server - write the note yourself';
    out.firstThings = ft;
  }

  let notFit = null;
  if (pick.what && PIECE_KINDS.has(pick.what.kind) && pick.rule !== 'pinned' && body && !body.error && llmFor('fit')) {
    try {
      const text = [body.template === 'first-email' ? FIRST_EMAIL.congrats : '', briefs.htmlText(body.bodyHtml)].filter(Boolean).join('\n');
      const fit = await b.judgeFit(llmFor('fit'), { client, brief, piece: { title: body.title, text } });
      if (!fit.fits) notFit = `"${body.title}" - ${fit.why || 'it does not fit where they are'}`;
    } catch (e) { budget(e); logger.warn(`fit check for ${client.clientId} skipped: ${e.message}`); }
  } else if (!pick.what && pick.rule === 'waiting-for-invitations' && facts && facts.group === 'running') {
    notFit = 'no invitation has gone out yet, so the welcome and the opening run cannot start';
  }
  const steered = !pick.what && pick.rule === 'steered';
  const tips = !pick.what && (pick.rule === 'weekly-tips' || steered);
  if (steered) notFit = 'written to your direction for this week';
  else if (tips) notFit = 'in onboarding - the weekly email their note asks for';
  // The idea library (Guy, 25 Oct 2026): a short menu of ideas they have not had, for the idea email.
  const lib = deps.library || library;
  let menu = [];
  if (tips) { try { menu = lib.menuFor({ record, pastTips, seed: `${client.clientId}|${week}` }); } catch (e) { logger.warn(`idea library unread for ${client.clientId}: ${e.message}`); } }
  if (notFit && llmFor('custom')) {
    try {
      const c = await b.draftCustomEmail(llmFor('custom'), { client, brief, notFit, firstWeekly, tips, library: lib.menuLines(menu), note: (facts && facts.noteText) || '', pastTips, arrives: `${dayLabel(week)}, ${hourLabel(SEND_HOUR)} Brisbane`, nextSessionAt: (facts && facts.nextSessionAt) || null, direction: steered && facts && facts.pin ? facts.pin.note || '' : '' });
      const idea = c.idea ? menu.find((i) => i.id === c.idea) || null : null;
      const watchHtml = idea && c.watch ? await watchLink(idea, deps) : '';
      if (!c.subject || !c.paragraphs.length) out.customDeclined = c.why || 'nothing true and useful to say this week';
      else {
        out.pick = {
          what: { kind: 'custom', key: `custom:${week}`, title: c.subject },
          form: 'one-off',
          rule: 'custom',
          reason: tips ? `CUSTOM - ${notFit}` : `CUSTOM - nothing on the shelf fits: ${notFit}`,
          customWhy: c.why || null,
          ...(idea ? { idea: { id: idea.id, source: idea.source, title: idea.title, watch: !!watchHtml } } : {}),
          replaces: { what: pick.what || null, rule: pick.rule || null, reason: pick.reason || '', form: pick.form || null },
        };
        out.body = { title: c.subject, dek: '', bodyHtml: b.paragraphsHtml(c.paragraphs) + watchHtml, template: 'custom' };
      }
    } catch (e) { budget(e); out.customDeclined = `the custom email could not be written (${e.message})`; }
  }
  return out;
}

/**
 * The optional "Watch" line under a library idea: the author's own talk, from the asset library - only
 * when the asset is there and active, so a retired or missing link never goes. '' otherwise.
 */
async function watchLink(idea, deps = {}) {
  if (!idea || !idea.link || !idea.link.asset) return '';
  try {
    const rows = deps.assets || await require('./wingguyRulesStore').getAssets({});
    const a = (rows || []).find((r) => r.asset_key === idea.link.asset && r.status === 'active' && r.url);
    if (!a) return '';
    const esc = (x) => String(x).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
    return `
<p>Watch: <a href="${esc(a.url)}">${esc(idea.link.talk || 'the talk')}</a>${idea.link.minutes ? ` (${idea.link.minutes} min)` : ''}</p>`;
  } catch (e) { logger.warn(`watch link for ${idea.id} skipped: ${e.message}`); return ''; }
}

/** Last week's row when its email has not gone yet (pinned or approved, waiting for its Monday) - so this week's tip is not the same one. Pure. */
function plannedTipFrom(row) {
  if (!row || row.sentAt || !row.subject || !['proposed', 'approved', 'held'].includes(row.status)) return [];
  return [`${row.subject}: ${briefs.htmlText(row.bodyHtml || '').replace(/\s+/g, ' ').slice(0, 300)}`];
}

/** A custom email Guy pinned in his own words: it goes as he wrote it, top to bottom. Pure. */
function ownWordsPin(pick) {
  return !!(pick && pick.rule === 'pinned' && pick.what && pick.what.kind === 'one-off' && String(pick.what.key || '').startsWith('custom:'));
}

/** Every email written for them so far (custom, or a custom one Guy pinned), newest first, as "subject: body" - so a tip never repeats. Pure. */
function pastTipsFrom(record) {
  return (record || []).filter((r) => (r.kind === 'custom' || r.kind === 'one-off') && r.meta)
    .sort((a, b) => String(b.sent_at || '').localeCompare(String(a.sent_at || '')))
    .slice(0, 12)
    .map((r) => `${r.meta.subject || ''}: ${String(r.meta.body || '').replace(/\s+/g, ' ').slice(0, 300)}`);
}

/** The brief's facts the opening drafter should also know (what is true, what never to say). Pure. */
function briefFactLines(brief) {
  if (!brief) return [];
  const lines = [];
  for (const t of (brief.trueNow || []).slice(0, 8)) lines.push(`From the brief - true now: ${t}`);
  for (const w of (brief.wins || []).slice(0, 4)) lines.push(`From the brief - a recent win: ${w.what}${w.date ? ` (${w.date})` : ''}`);
  for (const t of (brief.neverSay || []).slice(0, 6)) lines.push(`From the brief - NEVER say: ${t}`);
  return lines;
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
/** Everything the facts read, for every client at once: the cards, the touch record, pins, skips, campaigns, bounces. */
async function gatherContext(coachClientId, week, { now = Date.now(), at = now } = {}) {
  const { all, pairs } = await clientsWithCards(coachClientId);
  const since = new Date(now - 400 * DAY);
  const [touches, pins, skips, snapshots, bounced] = await Promise.all([
    touchStore.touchesSince(since), planStore.pinsFor(week), planStore.skips(), campaignSnapshots(), bouncedAddresses(coachClientId),
  ]);
  const touchesByClient = new Map();
  for (const t of touches) {
    if (!touchesByClient.has(t.client_id)) touchesByClient.set(t.client_id, []);
    touchesByClient.get(t.client_id).push(t);
  }
  return { now, at, all, pairs, snapshots, bounced, touchesByClient, pins, skips, leaveOff: leaveOffList() };
}

/**
 * Build a week's plan for every client (stores proposals, sends nothing). The week defaults to the
 * Monday Guy is working towards (planStore.planningWeek) - built a week ahead, judged as at that
 * Monday's sending moment. `opts.clientIds` limits it (the "swap" and "rebuild one" paths).
 */
async function buildPlan(coachClientId, opts = {}) {
  const now = opts.now ? new Date(opts.now).getTime() : Date.now();
  const week = opts.weekOf || planStore.planningWeek(new Date(now), SEND_HOUR);
  const at = Math.max(now, sendAt(week).getTime());
  const coach = await clientService.getClientById(coachClientId);
  if (!coach) throw new Error(`coach ${coachClientId} not found`);
  const ctx = await gatherContext(coachClientId, week, { now, at });
  const { pairs } = ctx;
  const only = opts.clientIds ? new Set(opts.clientIds) : null;
  const shelf = content.listPieces();
  const out = [];
  // Every Claude call this build makes runs on Guy's own server key and is metered; past the budget
  // (US$10) the build stops and says so rather than spending more.
  const meter = opts.meter || cost.createMeter();
  const baseLlm = opts.llm !== undefined ? opts.llm : (opts.openings === false ? null : serverLlm());
  const llmFor = (purpose) => (baseLlm ? meter.wrap(baseLlm, purpose) : null);
  let stopped = null;

  for (const { card, client } of pairs) {
    if (only && !only.has(client.clientId)) continue;
    const existing = await planStore.planFor(week, client.clientId);
    // A hold the planner put on at build time is its own, not Guy's verdict - a rebuild re-decides it.
    const builtHold = existing && existing.status === 'held' && existing.hold && existing.hold.stage === 'build';
    if (existing && !['proposed', 'nothing', 'left-out'].includes(existing.status) && !builtHold && !opts.force) { out.push(existing); continue; } // Guy has spoken
    if (builtHold) await planStore.setPlanStatus(week, client.clientId, 'proposed', { hold: null, sendError: null });
    try {
      let facts;
      try { facts = await factsFor(client, card, ctx); }
      catch (e) { logger.error(`facts for ${client.clientId} failed: ${e.message}`); continue; }
      if (opts.skipThisWeek && opts.skipThisWeek.has(client.clientId)) facts.skipThisWeek = true;
      const record = ctx.touchesByClient.get(client.clientId) || [];
      let pick = picker.pickFor(facts, shelf, record, { now: at, order: MANIFEST.client });
      const firstWeekly = isFirstWeekly(record);
      const liveLines = factLines(facts, facts.signals, card);

      // The deep client brief - everything on record about them, re-read only where it changed.
      let brief = null;
      if (!pick.leftOut && opts.briefs !== false) {
        brief = await (opts.briefFor || briefs.briefFor)(coach, client, { facts, factLines: liveLines, llm: llmFor('brief'), now }, opts.briefDeps || {});
      }

      let status = 'proposed';
      let openingDraft = null;
      let body = null;
      let subject = '';
      let material = null;
      let deep = { firstThings: null, customDeclined: null };
      if (pick.what) {
        const firstEmail = usesFirstEmail(pick, { firstWeekly, lastInviteSent: facts.lastInviteSent });
        body = await buildBody(pick, { coach, client, week, firstEmail, pin: pick.rule === 'pinned' ? (facts.pin || facts.pinForEveryone) : null });
      }
      if (brief) {
        const lastWeek = !pick.what && (pick.rule === 'weekly-tips' || pick.rule === 'steered') ? await planStore.planFor(planStore.addWeeks(week, -1), client.clientId).catch(() => null) : null;
        deep = await deepen({ pick, body, brief, client, facts, factLinesNow: liveLines, week, firstWeekly, pastTips: [...plannedTipFrom(lastWeek), ...pastTipsFrom(record)], record, llmFor, at });
        pick = deep.pick;
        body = deep.body;
      }
      if (pick.leftOut) status = 'left-out';
      else if (!pick.what) status = 'nothing';
      else {
        subject = body.error ? '' : subjectFor(pick, body);
        // The client's world, read once: the opening and the thought for the week both draw on it.
        if (!body.error && opts.openings !== false && !material) {
          const od = opts.openingDeps || {};
          const [meetings, emails] = await Promise.all([
            od.meetings || opening.gatherMeetings(coach.clientId, client, od).catch(() => []),
            od.emails || opening.gatherEmails(coach, client, od).catch(() => []),
          ]);
          // The brief rides along with the note, so the thought is chosen knowing what is really going on.
          const briefNote = brief && brief.summary ? `\n\nBRIEF (everything on record, read this week): ${brief.summary}${(brief.onTheirMind || []).length ? ` On their mind: ${brief.onTheirMind.join('; ')}` : ''}` : '';
          material = { meetings, emails, note: `${facts.noteText || ''}${briefNote}`.trim() };
        }
        if (!body.error && pick.what.kind === 'call') {
          openingDraft = { opening: CALL_OPENING, check: opening.checkOpening(CALL_OPENING), confidence: 1, factsUsed: [], source: 'fixed' };
        } else if (!body.error && (pick.what.kind === 'custom' || ownWordsPin(pick))) {
          openingDraft = null; // a custom email is Guy's words from top to bottom - no separate opening
        } else if (!body.error && opts.openings !== false) {
          openingDraft = await opening.draftOpening({
            coach, client, note: facts.noteText,
            pick: { title: body.title, dek: body.dek, form: pick.form, kindLine: body.template === 'first-email'
              ? "the client's FIRST weekly email - it already opens with a fixed congratulations paragraph. Add ONE sentence only if there is something real and specific to say from the material; otherwise answer with an empty opening"
              : pick.what.kind === 'call' ? 'an offer of times for a call' : pick.what.kind },
            factLines: [...liveLines, ...briefFactLines(brief)],
            today: new Date(at).toISOString().slice(0, 10),
          }, { ...(opts.openingDeps || {}), llm: (opts.openingDeps && opts.openingDeps.llm) || llmFor('opening') || undefined, ...(material ? { meetings: material.meetings, emails: material.emails } : {}) });
          // The first email's personal line is optional - an empty one is right, not a problem.
          if (body.template === 'first-email' && openingDraft && !String(openingDraft.opening || '').trim() && !openingDraft.error) {
            openingDraft = { ...openingDraft, opening: '', check: { ok: true, problems: [], sentences: 0 } };
          }
        }
      }
      // A thought for the week, when the body is not itself a one-pager piece - chosen from the
      // client's own world (their calls, emails and note), with a one-line why for Guy.
      let thought = null;
      if (pick.what && !body.error && pick.what.kind !== 'one-pager') {
        const llm = opts.thoughtLlm !== undefined ? opts.thoughtLlm : llmFor('thought');
        thought = await require('./clientTouchThought').chooseThoughtForClient({
          facts, shelf, client, record, material: material || { note: facts.noteText },
          exclude: [pick.what.key, ...(pick.replaces && pick.replaces.what ? [pick.replaces.what.key] : [])], now: at, seed: `${client.clientId}|${week}`, llm: opts.openings === false ? null : llm,
          pieceThisWeek: `${pick.what.title} (${pick.what.kind === 'call' ? 'an offer of times for a call' : pick.what.kind === 'custom' ? `an email written for them: ${briefs.htmlText(body.bodyHtml)}` : pick.what.kind})`, logger,
        });
      }
      // THE FACT GUARD at build time: every claim in the opening or the custom email, against the brief and the live facts.
      const openingText = openingDraft ? stripLeadingName(openingDraft.opening, require('./onePagerEmail').firstNameOf(client.clientFirstName || client.clientName)) : '';
      let guard = null;
      if (pick.what && body && !body.error) {
        const text = guardText({ pick: { ...pick, body: { template: body.template }, opening: openingDraft }, opening: openingText, bodyHtml: body.bodyHtml });
        if (text) guard = await briefs.checkClaims(text, { facts, factLines: liveLines, brief, llm: llmFor('guard'), client, at });
      }
      const { noteText, signals, ...storedFacts } = facts;
      const row = await planStore.upsertPlan({
        weekOf: week, clientId: client.clientId, status,
        pick: { ...pick, body: body ? { title: body.title, dek: body.dek, qs: body.qs, error: body.error || null, missing: !!body.missing, slotsFound: body.slotsFound, slots: body.slots || undefined, template: body.template || undefined } : null, opening: openingDraft ? { check: openingDraft.check, confidence: openingDraft.confidence, factsUsed: openingDraft.factsUsed, source: openingDraft.source, error: openingDraft.error || null } : null, thought,
          brief: briefs.compactBrief(brief), briefSource: brief ? brief.source || null : null, briefError: brief && brief.error ? brief.error : null,
          firstThings: deep.firstThings, customDeclined: deep.customDeclined, guard },
        facts: { ...storedFacts, builtAt: new Date(now).toISOString(), at: new Date(at).toISOString(), signals: { paused: signals.paused, runningLow: signals.runningLow, acceptancesSlow: signals.acceptancesSlow, live: signals.live, pausedWaiting: signals.pausedWaiting } },
        // Stored as it will be sent - the panel shows exactly what goes (no "Rick, ..." under "Hi Rick,").
        opening: openingText,
        subject,
        bodyHtml: body && !body.error ? body.bodyHtml : '',
        bodyPreview: body && !body.error ? previewText(body.bodyHtml) : (body && body.error ? `could not build: ${body.error}` : ''),
        recipient: facts.address,
      });
      // "Congratulations, you've started" reads late to a client whose invitations began weeks ago:
      // build the welcome, but HOLD it for Guy to keep or reword rather than propose it as ready.
      let finalRow = row;
      const lateNote = body && body.template === 'first-email' ? welcomeLateNote(facts.invitationsStartedAt, at) : null;
      if (row && lateNote && row.status === 'proposed') {
        finalRow = await planStore.setPlanStatus(week, client.clientId, 'held', { sendError: `held: ${lateNote}`, hold: { stage: 'build', hard: false, changed: [lateNote], reason: lateNote, at: new Date(now).toISOString() } }) || row;
      }
      out.push(finalRow || { weekOf: week, clientId: client.clientId, status, pick, opening: openingDraft ? openingDraft.opening : '', subject });
      if (opts.onRow) await opts.onRow(out.length, meter.summary());
    } catch (e) {
      if (e && e.name === 'BudgetError') { stopped = e.message; logger.error(`plan ${week}: ${e.message} - stopping at ${client.clientId}`); break; }
      throw e;
    }
  }
  const spend = meter.summary();
  logger.info(`plan ${week}: ${out.length} rows (${out.filter((r) => r.pick && r.pick.what).length} picks, ${out.filter((r) => r.status === 'left-out').length} left out) - ${cost.costLine(spend)}`);
  return { weekOf: week, rows: out, cost: spend, stopped };
}

// ---------------------------------------------------------------------------------------------
// "Build" from the panel runs in the background - drafting an opening for every client takes
// minutes, longer than a browser will wait on one request (22 Oct: Guy's first press sat on
// "Building..." while the rows were being written). The run's state lives in client_touch_state
// under build-run:<week>, so the panel can poll it and a restart never leaves it "running" forever.

const BUILD_STALE_MS = 20 * 60 * 1000;

/** What a stored build-run value says, now. Pure. */
function buildStatus(value, now = Date.now()) {
  let s = null;
  try { s = value ? JSON.parse(value) : null; } catch (_) { s = null; }
  if (!s || !s.startedAt) return { running: false, startedAt: null, finishedAt: null, rows: null, error: null, cost: null };
  // A deep build (every client's calls read the first time) can run well past 20 minutes, so "still
  // running" is judged from the last row written (the heartbeat), not from when it started.
  const last = new Date(s.heartbeatAt || s.startedAt).getTime();
  const running = !s.finishedAt && now - last < BUILD_STALE_MS;
  return {
    running,
    startedAt: s.startedAt,
    finishedAt: s.finishedAt || null,
    rows: s.rows ?? null,
    cost: s.cost || null,
    stopped: s.stopped || null,
    error: s.error || (!s.finishedAt && !running ? 'the build stopped part-way (the server restarted?) - press Build again; rows already written are kept' : null),
  };
}

/**
 * Start a build without waiting for it. Returns { started: true } or, when one for that week is
 * already running, { started: false, already: status }. deps.buildPlan / deps.planStore for tests.
 */
async function startBuild(coachClientId, week, opts = {}, deps = {}) {
  const ps = deps.planStore || planStore;
  const run = deps.buildPlan || buildPlan;
  const key = `build-run:${week}`;
  const current = buildStatus(await ps.getState(key));
  if (current.running) return { started: false, weekOf: week, already: current };
  const startedAt = new Date().toISOString();
  await ps.setState(key, JSON.stringify({ startedAt }));
  const done = (async () => {
    try {
      const onRow = async (rows, spend) => { await ps.setState(key, JSON.stringify({ startedAt, heartbeatAt: new Date().toISOString(), rows, cost: spend })); };
      const plan = await run(coachClientId, { ...opts, weekOf: week, onRow });
      await ps.setState(key, JSON.stringify({ startedAt, finishedAt: new Date().toISOString(), rows: plan.rows.length, cost: plan.cost || null, stopped: plan.stopped || null }));
      if (plan.stopped) await (deps.sendAlertEmail || require('./emailNotificationService').sendAlertEmail)(`Monday emails - the build for ${dayLabel(week)} STOPPED at the cost limit`, `<p>${esc(plan.stopped)}.</p><p>${plan.rows.length} clients were done before it stopped; the rest have no plan yet. ${esc(cost.costLine(plan.cost))}.</p><p>Press Build again to carry on (raise CLIENT_TOUCH_BUILD_BUDGET_USD first if this is expected).</p>`);
      logger.info(`background build ${week}: ${plan.rows.length} rows`);
    } catch (e) {
      logger.error(`background build ${week} failed: ${e.message}`);
      await ps.setState(key, JSON.stringify({ startedAt, finishedAt: new Date().toISOString(), error: e.message }));
    }
  })();
  return { started: true, weekOf: week, startedAt, done };
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
    leaveOff: (deps.leaveOff || leaveOffList()).get(clientId) || null,
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

function weekdayName(iso) {
  const t = iso ? new Date(iso) : null;
  if (!t || Number.isNaN(t.getTime())) return '';
  return new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Brisbane', weekday: 'long' }).format(t);
}

/**
 * What changed for a client between the plan Guy approved and the sending morning - plain lines
 * for the panel and the report ("their invitations started going out on Wednesday"). Pure.
 * `before` = the facts the plan was built on; `after` = fresh facts; `fresh` = the picker's answer now.
 */
function whatChanged(before = {}, after = {}, row = {}, fresh = null) {
  const lines = [];
  if (before.status !== after.status) lines.push(`their Status is now ${after.status || 'blank'}`);
  if (before.group !== after.group) lines.push(after.group === 'onboarding' ? 'they are back in onboarding' : after.group === 'paused' ? 'they are paused on the board' : `they moved to ${after.group}`);
  if (!before.unsubscribed && after.unsubscribed) lines.push('they unsubscribed from the weekly emails');
  if (!before.windingDownUntil && after.windingDownUntil) lines.push(`their subscription is now set to cancel on ${String(after.windingDownUntil).slice(0, 10)}`);
  if (!before.leaveOff && after.leaveOff) lines.push('they are now on your leave-off list for all-client emails');
  if ((before.address || null) !== (after.address || null)) lines.push(`their address changed (${before.address || 'none'} -> ${after.address || 'none'})`);
  if (!before.bounced && after.bounced) lines.push('mail to their address bounced');
  if (!before.lastInviteSent && after.lastInviteSent) lines.push(`their invitations started going out on ${weekdayName(after.lastInviteSent)}`);
  if (!before.sessionBooked && after.sessionBooked) lines.push(`a session with you is now booked${after.nextSessionAt ? ` (${String(after.nextSessionAt).slice(0, 10)})` : ''}`);
  const had = new Set((before.events || []).map((e) => e.key));
  for (const e of after.events || []) {
    if (!had.has(e.key)) lines.push(`${((EVENTS[e.key] || {}).label || e.key).replace(/^./, (c) => c.toLowerCase())} (${weekdayName(e.at)})`);
  }
  const d = after.daysSinceLastSubstantial;
  const dBefore = before.daysSinceLastSubstantial;
  if (d !== null && d !== undefined && d <= picker.NOT_THIS_WEEK_DAYS && !(dBefore !== null && dBefore !== undefined && dBefore <= picker.NOT_THIS_WEEK_DAYS)) {
    lines.push(`you touched base with them ${d === 0 ? 'today' : `${d} day${d === 1 ? '' : 's'} ago`}`);
  }
  if (!before.skipUntil && after.skipUntil) lines.push(`you said nothing until ${after.skipUntil}`);
  if (fresh) {
    const was = row.pick && row.pick.what ? row.pick.what.title : 'this one';
    if (fresh.leftOut) lines.push(`the planner would now leave them out - ${fresh.reason}`);
    else if (!fresh.what) lines.push(`the planner would now send nothing - ${fresh.reason}`);
    else lines.push(`the planner would now pick "${fresh.what.title}" instead of "${was}" - ${fresh.reason}`);
  }
  return lines;
}

/** Same email? (kind + key - the opening and subject are Guy's to change). */
function samePick(a, b) {
  return !!(a && b && a.what && b.what && a.what.kind === b.what.kind && a.what.key === b.what.key);
}

/**
 * Would the picker still land where it did at build time? A custom email was written in place of
 * the picker's own choice (pick.replaces) - so the morning check compares against THAT: the same
 * piece again, or the same "nothing" for the same reason (no invitations out yet). Pure.
 */
function stillAsBuilt(fresh, built) {
  if (!built || !built.what || built.what.kind !== 'custom') return samePick(fresh, built);
  const was = built.replaces || {};
  if (was.what) return samePick(fresh, was);
  return !!(fresh && !fresh.what && !fresh.leftOut && fresh.rule === was.rule);
}

/** Is the first-things-first flag still waiting on Guy? Pure. */
function firstThingsOpen(pick) {
  return !!(pick && pick.firstThings && pick.firstThings.status === 'open');
}

/** Fresh facts + record for the given clients, read now - the sending-morning re-check's input. */
async function freshFactsFor(coachClientId, week, clientIds) {
  const now = Date.now();
  const ctx = await gatherContext(coachClientId, week, { now, at: now });
  const out = new Map();
  for (const { card, client } of ctx.pairs) {
    if (!clientIds.includes(client.clientId)) continue;
    try { out.set(client.clientId, { facts: await factsFor(client, card, ctx), record: ctx.touchesByClient.get(client.clientId) || [] }); }
    catch (e) { logger.warn(`fresh facts for ${client.clientId} failed: ${e.message}`); }
  }
  return out;
}

/**
 * Send every row Guy approved (status approved or edited) for the week. Nothing in 'proposed' is
 * ever sent here. Before anything goes, each row is checked twice, on fresh facts:
 *   1. "who is never sent anything" (sendGuard) - a hard hold;
 *   2. the picker, run again now - if it would no longer choose the email Guy approved (an event
 *      that would now win, a call booked, the piece no longer fits) the row is HELD with what
 *      changed, for Guy to keep or swap. `deps.keep` (a Set of clientIds) skips this one - Guy
 *      has already looked and said keep.
 * deps: mailer, planStore, touchStore, clientService (tests); onlyClientIds; keep; recheck (default
 * true); freshFacts(clientIds) -> Map clientId -> { facts, record } (tests); shelf.
 * Returns { sent, failed, held, results }.
 */
async function sendApproved(coachClientId, week, deps = {}) {
  if (!sendEnabled()) {
    logger.warn(`send ${week} refused - CLIENT_TOUCH_SEND_ENABLED=off on this server`);
    return { weekOf: week, sent: 0, failed: 0, held: 0, results: [], refused: 'Sending is switched off on this server (CLIENT_TOUCH_SEND_ENABLED=off) - nothing was sent.' };
  }
  const mailer = deps.mailer || require('./seriesMailer');
  const ps = deps.planStore || planStore;
  const ts = deps.touchStore || touchStore;
  const { unsubscribeUrlFor } = require('./clientUnsubscribe');
  const results = [];
  let sent = 0; let failed = 0; let held = 0;
  const only = deps.onlyClientIds ? new Set(deps.onlyClientIds) : null;
  const keep = deps.keep || new Set();
  const plan = (await ps.plansFor(week)).filter((row) => (!only || only.has(row.clientId))
    && ['approved', 'edited'].includes(row.status) && row.pick && row.pick.what && EMAIL_KINDS.has(row.pick.what.kind));

  // The picker re-check needs the live facts - read once, for everyone about to be sent.
  const recheck = deps.recheck !== false;
  const toCheck = plan.filter((r) => !keep.has(r.clientId)).map((r) => r.clientId);
  let fresh = new Map();
  if (recheck && toCheck.length) {
    try { fresh = await (deps.freshFacts || ((ids) => freshFactsFor(coachClientId, week, ids)))(toCheck); }
    catch (e) { logger.error(`sending-morning re-check could not read facts: ${e.message}`); }
  }
  const shelf = deps.shelf || content.listPieces();

  const hold = async (row, reason, holdInfo) => {
    held++;
    results.push({ clientId: row.clientId, status: 'held', reason, changed: holdInfo.changed || [] });
    await ps.setPlanStatus(week, row.clientId, 'held', { sendError: `held: ${reason}`, hold: { ...holdInfo, reason, at: new Date().toISOString() } });
  };

  // The fact guard's Claude check on the sending morning - Guy's own server key, metered like a build.
  const meter = deps.meter || cost.createMeter();
  const guardLlm = deps.guardLlm !== undefined ? deps.guardLlm : (() => { const l = serverLlm(); return l ? meter.wrap(l, 'guard') : null; })();

  for (const row of plan) {
    const guard = await sendGuard(row.clientId, row, deps);
    if (!guard.ok) { await hold(row, guard.reason, { hard: true, changed: [guard.reason] }); continue; }
    // First things first: Guy owes them something important - the weekly email waits for his note.
    if (firstThingsOpen(row.pick)) {
      const owed = (row.pick.firstThings.items || []).map((o) => o.what).join('; ');
      await hold(row, 'send your personal note first (or dismiss the flag)', { hard: false, changed: [`you owe them: ${owed || 'see the brief'} - send the personal note first, or dismiss the flag`] });
      continue;
    }

    if (recheck && !keep.has(row.clientId)) {
      const f = fresh.get(row.clientId);
      if (!f) { await hold(row, 'the re-check could not read their facts this morning', { hard: false, changed: ['the re-check could not read their facts this morning'] }); continue; }
      const now = Date.now();
      const freshPick = picker.pickFor(f.facts, shelf, f.record, { now, order: MANIFEST.client });
      if (!stillAsBuilt(freshPick, row.pick)) {
        const changed = whatChanged(row.facts || {}, f.facts, row, freshPick);
        const suggestion = freshPick.what ? { kind: freshPick.what.kind, key: freshPick.what.key, title: freshPick.what.title, reason: freshPick.reason } : null;
        await hold(row, `${changed[0] || 'something changed'} - keep or swap?`, { hard: !!freshPick.leftOut, changed, suggestion });
        continue;
      }
      // THE FACT GUARD again, on this morning's facts: every claim still true?
      const text = guardText(row);
      if (text) {
        let check;
        try {
          check = await briefs.checkClaims(text, { facts: f.facts, factLines: factLines(f.facts, f.facts.signals || {}, null), brief: row.pick.brief || null, llm: guardLlm, client: guard.client, at: now });
        } catch (e) { check = { ok: false, problems: [`the fact guard could not run (${e.message})`] }; }
        if (!check.ok) {
          await ps.setPlanPickField(week, row.clientId, 'guard', { ...check, stage: 'send' });
          await hold(row, `the fact guard: ${check.problems[0]} - reword or keep?`, { hard: false, changed: check.problems.map((p) => `fact guard: ${p}`) });
          continue;
        }
      }
    }
    const client = guard.client;
    const unsubscribeUrl = unsubscribeUrlFor(client);
    if (!unsubscribeUrl) { held++; results.push({ clientId: row.clientId, status: 'held', reason: 'no unsubscribe link' }); continue; }
    if (row.pick.body && (row.pick.body.error || row.pick.body.missing)) {
      held++; results.push({ clientId: row.clientId, status: 'held', reason: 'the body is not built' }); continue;
    }
    // An offer of times: the times must still be free, and at least a day away, on the morning it goes.
    let bodyHtml = row.bodyHtml;
    let offeredSlots = (row.pick.body && row.pick.body.slots) || null;
    if (row.pick.what.kind === 'call') {
      let fresh;
      try {
        const cs = deps.clientService || clientService;
        const coach = (await cs.getClientById(coachClientId)) || { clientId: coachClientId };
        fresh = await (deps.refreshCallOffer || refreshCallOffer)(row, coach, client, deps);
      } catch (e) {
        fresh = { ok: false, reason: `the call times could not be re-checked against your calendar (${e.message})` };
      }
      if (!fresh.ok) { await hold(row, fresh.reason, { hard: false, changed: [fresh.reason] }); continue; }
      if (fresh.changed) {
        bodyHtml = fresh.bodyHtml;
        offeredSlots = fresh.slots;
        await ps.setPlanStatus(week, row.clientId, row.status, { bodyHtml });
      }
    }
    const firstWeekly = isFirstWeekly(await ts.touchesFor(row.clientId, { limit: 500 }));
    const html = composeEmail({ client, opening: row.opening, body: { title: row.pick.body.title, dek: row.pick.body.dek, bodyHtml, qs: row.pick.body.qs, template: row.pick.body.template, congrats: row.pick.body.congrats }, unsubscribeUrl, kind: row.pick.what.kind, firstWeekly: firstWeekly && !ownWordsPin(row.pick), thought: row.pick.thought || null });
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
      meta: { weekOf: week, rule: row.pick.rule, subject: row.subject, mailgunId: res.id || null, opening: row.opening || '', firstWeekly, ...(row.pick.thought ? { thought: row.pick.thought.slug } : {}), ...(row.pick.idea ? { idea: row.pick.idea.id } : {}), ...(offeredSlots ? { slots: offeredSlots.map((x) => x.time) } : {}), ...(kind === 'custom' ? { body: briefs.htmlText(bodyHtml).slice(0, 4000), replaces: row.pick.replaces || null } : {}), ...(kind === 'one-off' ? { body: briefs.htmlText(bodyHtml).slice(0, 4000) } : {}) },
    });
    await ps.setPlanStatus(week, row.clientId, 'sent', { sentAt: new Date() });
    sent++;
    results.push({ clientId: row.clientId, status: 'sent', id: res.id });
  }
  logger.info(`send ${week}: ${sent} sent, ${failed} failed, ${held} held`);
  return { weekOf: week, sent, failed, held, results };
}

// ---------------------------------------------------------------------------------------------
// Monday morning: the send of what Guy approved, the report, the next week's build and its preview

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch])); }

/** "Monday 2 Nov" for a plan week. */
function dayLabel(week) {
  const d = new Date(`${week}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + SEND_DAY);
  return Number.isNaN(d.getTime()) ? String(week) : new Intl.DateTimeFormat('en-AU', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'short' }).format(d);
}

// The weekly review happens in chat with Claude (22 Oct 2026 - the panel is gone from My Clients).
const REVIEW_LINE = "Go through them with Claude: say \"let's do this week's emails\".";

function screenUrlFor() {
  return process.env.CLIENT_TOUCH_SCREEN_URL || 'https://pb-webhook-server.vercel.app/coached-clients';
}

/** The preview email to Guy - every row, what it is and why, the opening - and the one link to the screen. */
function buildPreview(plan, { screenUrl = '', autosend = false } = {}) {
  const name = (r) => esc(r.facts && r.facts.clientName ? r.facts.clientName : r.clientId);
  const picks = plan.rows.filter((r) => r.pick && r.pick.what);
  const quiet = plan.rows.filter((r) => r.status === 'nothing');
  const out = plan.rows.filter((r) => r.status === 'left-out');
  const owed = plan.rows.filter((r) => firstThingsOpen(r.pick));
  const custom = picks.filter((r) => r.pick.what.kind === 'custom');
  const when = `${dayLabel(plan.weekOf)} at ${SEND_HOUR}am`;
  const parts = [];
  parts.push(`<p>${picks.length} email${picks.length === 1 ? '' : 's'} prepared for ${esc(when)}. ${autosend
    ? 'Send-with-veto is ON: anything you have not skipped goes by itself then, after a fresh check.'
    : `Go through them with Claude whenever suits during the week. Only what you approve goes - by itself, on ${esc(when)}, after a fresh check that nothing has changed. Anything not approved by then is not sent.`}</p>`);
  if (owed.length) {
    parts.push(`<p><b>Send a personal note first (${owed.length})</b> - you owe these clients something important, so their weekly email waits until you send the note (ask Claude for the draft) or dismiss the flag:</p>`);
    parts.push(`<ul>${owed.map((r) => `<li>${name(r)}: ${esc((r.pick.firstThings.items || []).map((o) => o.what).join('; '))}</li>`).join('')}</ul>`);
  }
  if (custom.length) parts.push(`<p><b>Written for them (${custom.length}) - read these closely:</b> ${custom.map((r) => `${name(r)} - "${esc(r.pick.what.title)}"`).join('; ')}. Nothing on your approved shelf fitted where they are, so each was written from everything on record.</p>`);
  parts.push(`<p>${esc(REVIEW_LINE)}</p>`);
  for (const r of picks) {
    parts.push(`<h3 style="margin-bottom:2px">${name(r)} - ${r.pick.what.kind === 'custom' ? 'CUSTOM: ' : ''}${esc(r.pick.what.title)}${r.pick.form === 'short' ? ' (short)' : ''}</h3>`);
    parts.push(`<p style="margin:0;color:#666">${esc(r.pick.reason)}</p>`);
    if (r.pick.brief && r.pick.brief.summary) parts.push(`<p style="margin:4px 0;color:#555;font-size:13px"><i>Brief:</i> ${esc(r.pick.brief.summary)}</p>`);
    if (r.pick.what.kind === 'custom') parts.push(`<p style="margin:6px 0 12px">${esc(briefs.htmlText(r.bodyHtml || '').replace(/\n+/g, ' / '))}</p>`);
    else parts.push(`<p style="margin:6px 0 12px">${r.opening ? esc(r.opening) : '<i>(no opening drafted - needs your words)</i>'}</p>`);
    if (r.pick.guard && !r.pick.guard.ok) parts.push(`<p style="margin:0 0 12px;color:#b00">Fact guard: ${esc(r.pick.guard.problems.join('; '))}</p>`);
  }
  if (quiet.length) parts.push(`<p><b>Nothing that week:</b> ${quiet.map((r) => `${name(r)} (${esc(r.pick ? r.pick.reason : '')})`).join('; ')}</p>`);
  if (out.length) parts.push(`<p><b>Left out:</b> ${out.map((r) => `${name(r)} - ${esc(r.pick ? r.pick.reason : '')}`).join('; ')}</p>`);
  if (plan.cost) parts.push(`<p style="color:#666;font-size:13px">${esc(cost.costLine(plan.cost))}.</p>`);
  return { subject: `Monday emails - ${dayLabel(plan.weekOf)} - ${picks.length} to approve${owed.length ? `, ${owed.length} note${owed.length === 1 ? '' : 's'} to send first` : ''}${plan.stopped ? ' - BUILD STOPPED at the cost limit' : ''}`, html: parts.join('\n') };
}

/** Proposals Guy never approved roll off on the sending morning - marked lapsed, never sent. Returns those rows. */
async function rollOff(week, deps = {}) {
  const ps = deps.planStore || planStore;
  const lapsed = [];
  for (const r of await ps.plansFor(week)) {
    if (r.status !== 'proposed' || !r.pick || !r.pick.what) continue;
    await ps.setPlanStatus(week, r.clientId, 'lapsed');
    lapsed.push(r);
  }
  return lapsed;
}

/** The short report to Guy after the Monday send: what went, what was held and why, what wasn't approved. Pure. */
function buildSendReport({ result, lapsed = [], names = new Map(), titles = new Map(), screenUrl = '', buildCost = null, guardCost = null }) {
  const name = (id) => esc(names.get(id) || id);
  const title = (id) => (titles.get(id) ? ` - ${esc(titles.get(id))}` : '');
  const went = result.results.filter((r) => r.status === 'sent');
  const held = result.results.filter((r) => r.status === 'held');
  const failed = result.results.filter((r) => r.status === 'failed');
  const parts = [];
  parts.push(`<p><b>Went (${went.length}):</b> ${went.length ? went.map((r) => `${name(r.clientId)}${title(r.clientId)}`).join('; ') : 'nothing'}.</p>`);
  if (held.length) {
    parts.push(`<p><b>Held for you (${held.length})</b> - you approved these, but something changed since. Keep or swap them with Claude:</p>`);
    parts.push(`<ul>${held.map((r) => `<li>${name(r.clientId)}${title(r.clientId)}: ${esc((r.changed && r.changed.length ? r.changed : [r.reason]).join('; '))}</li>`).join('')}</ul>`);
  }
  if (failed.length) parts.push(`<p><b>Failed to send (${failed.length}):</b> ${failed.map((r) => `${name(r.clientId)} (${esc(r.error || 'error')})`).join('; ')}.</p>`);
  parts.push(`<p><b>Not approved, so not sent (${lapsed.length}):</b> ${lapsed.length ? lapsed.map((r) => `${name(r.clientId)} - ${esc(r.pick.what.title)}`).join('; ') : 'none'}.</p>`);
  parts.push(`<p>${esc(REVIEW_LINE)}</p>`);
  const spend = [buildCost ? `building this plan: ${cost.costLine(buildCost)}` : '', guardCost && guardCost.calls ? `this morning's fact check: US$${Number(guardCost.usd).toFixed(2)} (${guardCost.calls} calls)` : ''].filter(Boolean);
  if (spend.length) parts.push(`<p style="color:#666;font-size:13px">Claude cost - ${esc(spend.join('; '))}.</p>`);
  return { subject: `Monday emails - ${went.length} went, ${held.length} held, ${lapsed.length} not approved`, html: parts.join('\n') };
}

/** The Monday-morning send: approved rows go after the fresh re-check, the rest roll off, Guy gets the report. */
async function mondaySend(coachClientId, week, deps = {}) {
  const ps = deps.planStore || planStore;
  if (autosendOn()) {
    // Send-with-veto (OFF by default): an untouched proposal with a passing opening counts as approved.
    for (const r of await ps.plansFor(week)) {
      if (r.status !== 'proposed' || !r.pick || !r.pick.what) continue;
      // Never by veto: a CUSTOM email (Guy must read it), a row waiting on his personal note, a failed fact guard.
      if (r.pick.what.kind === 'custom' || firstThingsOpen(r.pick) || (r.pick.guard && !r.pick.guard.ok)) continue;
      if (r.pick.opening && r.pick.opening.check && r.pick.opening.check.ok) await ps.setPlanStatus(week, r.clientId, 'approved');
    }
  }
  const before = await ps.plansFor(week);
  const meter = deps.meter || cost.createMeter();
  const result = await sendApproved(coachClientId, week, { ...deps, meter });
  const lapsed = await rollOff(week, deps);
  let names = new Map();
  try { names = new Map((await (deps.clientService || clientService).getAllClients()).map((c) => [c.clientId, c.clientName])); } catch (_) { /* ids will do */ }
  const titles = new Map(before.filter((r) => r.pick && r.pick.what).map((r) => [r.clientId, r.pick.what.title]));
  const built = buildStatus(ps.getState ? await ps.getState(`build-run:${week}`) : null);
  const report = buildSendReport({ result, lapsed, names, titles, screenUrl: screenUrlFor(), buildCost: built.cost, guardCost: meter.summary() });
  const send = deps.sendAlertEmail || require('./emailNotificationService').sendAlertEmail;
  await send(report.subject, report.html);
  return { ...result, lapsed: lapsed.length };
}

/**
 * The scheduled Monday jobs, in order, each claimed in Postgres so a restart never doubles:
 *   SEND_HOUR (8am)  - send what Guy approved for THIS Monday (re-checked), roll off the rest, report;
 *   BUILD_HOUR (9am) - build NEXT Monday's plan and email Guy the preview, so he has the week to work through it.
 */
async function tick(deps = {}) {
  const coachClientId = (process.env.RECALL_COACH_CLIENT_ID || 'Guy-Wilson').trim();
  const nowB = deps.brisbaneNow || brisbaneNow();
  const ps = deps.planStore || planStore;
  const thisWeek = planStore.weekOf(deps.now || new Date());
  const ran = [];
  if (nowB.weekday !== SEND_DAY_SHORT) return { ran: false };
  if (nowB.hour >= SEND_HOUR && mondaySendOn() && await ps.claimWeekly('monday-send', thisWeek)) {
    logger.info(`Monday send for ${thisWeek} - approved only, each re-checked on fresh facts`);
    const res = await (deps.mondaySend || mondaySend)(coachClientId, thisWeek, deps);
    ran.push({ ran: 'send', weekOf: thisWeek, ...res });
  }
  if (nowB.hour >= BUILD_HOUR) {
    const nextWeek = planStore.addWeeks(thisWeek, 1);
    if (await ps.claimWeekly('build', nextWeek)) {
      logger.info(`Monday build for ${nextWeek} (a week ahead)`);
      const startedAt = new Date().toISOString();
      const plan = await (deps.buildPlan || buildPlan)(coachClientId, { weekOf: nextWeek });
      // Kept where the panel and the sending-morning report read the build's cost.
      if (ps.setState) await ps.setState(`build-run:${nextWeek}`, JSON.stringify({ startedAt, finishedAt: new Date().toISOString(), rows: plan.rows.length, cost: plan.cost || null, stopped: plan.stopped || null }));
      const send = deps.sendAlertEmail || require('./emailNotificationService').sendAlertEmail;
      const pv = buildPreview(plan, { screenUrl: screenUrlFor(), autosend: autosendOn() });
      await send(pv.subject, pv.html);
      ran.push({ ran: 'build', weekOf: nextWeek, rows: plan.rows.length });
    }
  }
  return ran.length ? { ran: ran.map((r) => r.ran).join('+'), steps: ran } : { ran: false };
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
  logger.info(`client-touch-planner: starting (${SEND_DAY_NAME}s Brisbane: approved emails go at ${SEND_HOUR}:00${mondaySendOn() ? '' : ' - OFF via CLIENT_TOUCH_MONDAY_SEND'}, next week built at ${BUILD_HOUR}:00; send-with-veto ${autosendOn() ? 'ON' : 'OFF - Guy approves every email'})`);
}

// ---------------------------------------------------------------------------------------------
// What the screen reads

function improvementsFile() {
  try { return fs.readFileSync(path.join(__dirname, '..', 'content', 'one-pagers', 'IMPROVEMENTS.md'), 'utf8'); } catch (_) { return ''; }
}

const KIND_LABEL = {
  'one-pager': 'one-pager', habit: 'habit email', mindset: 'Mindset Mastery', setup: 'setup step',
  'one-off': 'one-off', personal: 'personal', call: 'call', intro: 'introduction',
};

/** slug -> title for everything on the shelf, the orientation included. */
function shelfTitles(shelf) {
  const m = new Map((shelf || []).map((p) => [p.slug, p.title]));
  m.set(ORIENTATION.slug, "What you've actually joined");
  return m;
}

/** A plain title for a touch-record row. */
function touchTitle(t, titles) {
  const meta = t.meta || {};
  if (t.kind === 'personal' && t.key === 'check-in') return 'Time for a call (an offer of times)';
  if (t.kind === 'mindset') return t.key;
  return titles.get(t.key) || meta.subject || t.key;
}

/** "Already had": every touch on record, newest first, with dates. Pure. */
function historyLines(record, titles) {
  return [...(record || [])]
    .filter((t) => t && t.sent_at)
    .sort((a, b) => new Date(b.sent_at) - new Date(a.sent_at))
    .map((t) => ({ at: new Date(t.sent_at).toISOString(), kind: t.kind, kindLabel: KIND_LABEL[t.kind] || t.kind, key: t.key, title: touchTitle(t, titles), form: t.form || null, source: t.source || null }));
}

/**
 * One client's three columns: Already had | This Monday | Likely next. Pure - the plan row (with the
 * facts it was built on), that client's touch record, the shelf, and the pins already set for the
 * weeks ahead. "Likely next" treats this Monday's pick as sent unless Guy skipped it (or it lapsed).
 */
function outlookFor(row, record, shelf, { week, pinsAhead = [], order = MANIFEST.client } = {}) {
  const titles = shelfTitles(shelf);
  const alreadyHad = historyLines(record, titles);
  const pick = row && row.pick;
  const thisMonday = row ? {
    weekOf: row.weekOf || week,
    status: row.status,
    what: pick && pick.what ? { ...pick.what } : null,
    form: pick ? pick.form || null : null,
    reason: pick ? pick.reason || '' : '',
    opening: row.opening || '',
    subject: row.subject || '',
    hold: row.hold || null,
    thought: pick && pick.thought ? pick.thought : null,
    brief: pick && pick.brief ? pick.brief : null,
    firstThings: pick && pick.firstThings ? pick.firstThings : null,
    guard: pick && pick.guard ? pick.guard : null,
    customText: pick && pick.what && pick.what.kind === 'custom' ? briefs.htmlText(row.bodyHtml) : null,
  } : null;
  let likelyNext = [];
  if (row && row.facts) {
    const goes = pick && pick.what && ['proposed', 'approved', 'edited', 'held'].includes(row.status);
    const pinsByWeek = pinsAhead.map((m) => (m ? { pin: m.get(row.clientId) || null, pinForEveryone: m.get('*') || null } : {}));
    const ahead = picker.projectAhead(row.facts, shelf, record || [], {
      at: sendAt(row.weekOf || week).getTime(), order, thisPick: goes ? pick : null, pinsByWeek: [null, ...pinsByWeek],
    });
    likelyNext = ahead.map((p) => ({
      weekOf: planStore.addWeeks(row.weekOf || week, p.weekIndex),
      what: p.what ? { ...p.what } : null,
      form: p.form || null,
      reason: p.reason,
      leftOut: !!p.leftOut,
    }));
  }
  return { alreadyHad, thisMonday, likelyNext };
}

/** Plain text of one client's outlook - what wingguy_client_emails returns. Pure. */
function formatOutlook(name, o) {
  const d = (iso) => new Date(iso).toLocaleDateString('en-AU', { timeZone: 'Australia/Brisbane', day: 'numeric', month: 'short', year: 'numeric' });
  const lines = [`${name} - weekly emails`, ''];
  lines.push(`ALREADY HAD (${o.alreadyHad.length}, newest first):`);
  if (!o.alreadyHad.length) lines.push('  nothing on the touch record yet');
  for (const h of o.alreadyHad.slice(0, 40)) lines.push(`  ${d(h.at)} - ${h.title} (${h.kindLabel}${h.form === 'short' ? ', short' : ''})`);
  if (o.alreadyHad.length > 40) lines.push(`  ...and ${o.alreadyHad.length - 40} older`);
  lines.push('');
  const t = o.thisMonday;
  if (!t) lines.push('THIS WEEK: no plan built for this client yet (ask to build it).');
  else {
    const status = { proposed: 'waiting for your approval', approved: 'approved', edited: 'approved (your words)', skipped: 'skipped', sent: 'sent', failed: 'send failed', nothing: 'nothing that week', 'left-out': 'left out', held: 'HELD - something changed, keep or swap?', lapsed: 'not approved in time, not sent' }[t.status] || t.status;
    lines.push(`THIS WEEK (${dayLabel(t.weekOf)}) - ${status}:`);
    lines.push(t.what ? `  ${t.what.title} (${KIND_LABEL[t.what.kind] || t.what.kind}${t.form === 'short' ? ', short' : ''})` : '  nothing');
    if (t.reason) lines.push(`  why: ${t.reason}`);
    if (t.firstThings && t.firstThings.status === 'open') {
      lines.push(`  SEND A PERSONAL NOTE FIRST - you owe them: ${(t.firstThings.items || []).map((o) => `${o.what}${o.promisedOn ? ` (${o.promisedOn})` : ''}`).join('; ')}. The weekly email waits until you mark the note sent or dismiss the flag.`);
      if (t.firstThings.note && t.firstThings.note.text) lines.push(`  drafted note - "${t.firstThings.note.subject}": ${t.firstThings.note.text.replace(/\s*\n+\s*/g, ' / ')}`);
    }
    if (t.customText) lines.push(`  CUSTOM EMAIL (written for them - read closely): ${t.customText.replace(/\s*\n+\s*/g, ' / ')}`);
    if (t.opening) lines.push(`  opening: "${t.opening}"`);
    if (t.guard && !t.guard.ok) lines.push(`  fact guard: ${t.guard.problems.join('; ')}`);
    if (t.thought && t.thought.text) lines.push(`  thought for the week (${t.thought.title}): "${t.thought.text}"${t.thought.why ? ` - why: ${t.thought.why}` : ''}`);
    if (t.hold && t.hold.changed && t.hold.changed.length) lines.push(`  what changed: ${t.hold.changed.join('; ')}`);
    if (t.brief) {
      const b = t.brief;
      lines.push('', `THE BRIEF (everything on record, read ${b.builtAt ? String(b.builtAt).slice(0, 10) : 'this week'}):`);
      if (b.summary) lines.push(`  ${b.summary}`);
      for (const [label, xs] of [['true now', b.trueNow], ['waiting on', b.waitingOn], ['on their mind', b.onTheirMind], ['never say', b.neverSay]]) if ((xs || []).length) lines.push(`  ${label}: ${xs.join('; ')}`);
      if ((b.owed || []).length) lines.push(`  you owe them: ${b.owed.map((o) => `${o.what}${o.promisedOn ? ` (${o.promisedOn})` : ''}${o.quote ? ` - "${o.quote}"` : ''}`).join('; ')}`);
      if ((b.wins || []).length) lines.push(`  wins: ${b.wins.map((w) => w.what).join('; ')}`);
    }
  }
  lines.push('');
  lines.push('LIKELY NEXT - provisional, if nothing changes (a first call booked, a campaign running low and the like can jump the queue):');
  if (!o.likelyNext.length) lines.push('  (needs this Monday\'s plan first)');
  for (const n of o.likelyNext) lines.push(`  ${dayLabel(n.weekOf)} - ${n.what ? `${n.what.title} - ${n.reason}` : n.leftOut ? `left out - ${n.reason}` : `nothing - ${n.reason}`}`);
  return lines.join('\n');
}

/** The pins already set for the weeks after `week` (index 0 = the Monday after). */
async function pinsAheadOf(week, weeks = picker.LIKELY_WEEKS) {
  return Promise.all(Array.from({ length: weeks }, (_, i) => planStore.pinsFor(planStore.addWeeks(week, i + 1))));
}

/** Everyone's touch record, grouped by client. */
async function allTouchesByClient() {
  const out = new Map();
  for (const t of await touchStore.touchesSince(new Date('2000-01-01T00:00:00Z'))) {
    if (!out.has(t.client_id)) out.set(t.client_id, []);
    out.get(t.client_id).push(t);
  }
  return out;
}

/**
 * "Show me Steve's emails" - one of the coach's clients, by name or id: Already had / This Monday /
 * Likely next, for the Monday Guy is working towards (or `opts.week`). Coach-gated by the caller.
 */
async function clientEmails(coachClientId, query, opts = {}) {
  const all = await clientService.getAllClients();
  const mine = all.filter((c) => c.coach && c.coach === coachClientId);
  const q = String(query || '').trim().toLowerCase();
  if (!q) return { error: 'Which client? Pass a name or client id.' };
  const exact = mine.filter((c) => (c.clientId || '').toLowerCase() === q || (c.clientName || '').toLowerCase() === q);
  const hits = exact.length ? exact : mine.filter((c) => (c.clientId || '').toLowerCase().includes(q) || (c.clientName || '').toLowerCase().includes(q));
  if (!hits.length) return { error: `No client of yours matched "${query}". Your clients: ${mine.map((c) => c.clientName).join(', ')}.` };
  if (hits.length > 1) return { error: `"${query}" matched several: ${hits.map((c) => `${c.clientName} (${c.clientId})`).join(', ')}. Use the exact client id.` };
  const client = hits[0];
  const week = opts.week || planStore.planningWeek(new Date(), SEND_HOUR);
  const [row, record, pinsAhead] = await Promise.all([
    planStore.planFor(week, client.clientId), touchStore.touchesFor(client.clientId, { limit: 500 }), pinsAheadOf(week),
  ]);
  const outlook = outlookFor(row, record, content.listPieces(), { week, pinsAhead });
  return { client: { clientId: client.clientId, clientName: client.clientName, touchNote: client.touchNote || '' }, week, outlook, text: formatOutlook(client.clientName, outlook) };
}

// ---------------------------------------------------------------------------------------------
// The weekly review in chat (Guy, 22 Oct: "let me go through, approve, change, swap and skip the
// weekly emails here in chat with you") - what wingguy_weekly_emails reads.

/** An email's HTML as the plain text a person reads. Pure. */
function emailAsText(html) {
  return String(html || '')
    .replace(/^[ \t]+/gm, '') // the HTML source's own indentation
    .replace(/<title>[\s\S]*?<\/title>/i, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n  - ')
    .replace(/<\/(p|ul|ol|h1|h2|h3|blockquote|div)>/gi, '\n')
    .replace(/<strong>([\s\S]*?)<\/strong>/gi, '**$1**')
    .replace(/<[^>]+>/g, '')
    .replace(/&#39;|&rsquo;|&lsquo;/g, "'").replace(/&quot;|&ldquo;|&rdquo;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const STATUS_WORDS = {
  proposed: 'waiting for you', approved: 'approved', edited: 'approved (your words)', held: 'HELD', skipped: 'skipped',
  sent: 'sent', failed: 'send failed', lapsed: 'not approved in time', nothing: 'quiet', 'left-out': 'left out',
};

/** The week at a glance, grouped: waiting / held / approved / sent / skipped / quiet / left out. Pure over the screen's rows. */
function formatWeek(weekOf, rows, { sendHour = SEND_HOUR } = {}) {
  const groups = [
    ['WAITING FOR YOU', (r) => r.status === 'proposed' && r.pick && r.pick.what],
    ['HELD - needs your call', (r) => r.status === 'held'],
    [`APPROVED - goes ${SEND_DAY_NAME} ${hourLabel(SEND_HOUR)} after a fresh check`, (r) => ['approved', 'edited'].includes(r.status)],
    ['SENT', (r) => r.status === 'sent'],
    ['FAILED', (r) => r.status === 'failed'],
    ['SKIPPED', (r) => r.status === 'skipped'],
    ['NOT APPROVED IN TIME', (r) => r.status === 'lapsed'],
    ['QUIET THIS WEEK', (r) => r.status === 'nothing'],
    ['LEFT OUT', (r) => r.status === 'left-out'],
  ];
  const lines = [`Weekly emails for ${dayLabel(weekOf)} (they go at ${hourLabel(sendHour)} Brisbane that ${SEND_DAY_NAME} - approved ones only)`, ''];
  for (const [label, test] of groups) {
    const hit = rows.filter(test);
    if (!hit.length) continue;
    lines.push(`${label} (${hit.length}):`);
    for (const r of hit) {
      const what = r.pick && r.pick.what ? r.pick.what.title : '';
      const why = r.status === 'held' && r.hold ? (r.hold.changed || [r.hold.reason]).join('; ') : (r.pick ? r.pick.reason : '');
      const flags = [firstThingsOpen(r.pick) ? 'PERSONAL NOTE FIRST' : '', r.pick && r.pick.what && r.pick.what.kind === 'custom' ? 'written for them' : '', r.pick && r.pick.guard && r.pick.guard.ok === false && !r.pick.guard.overriddenAt ? 'fact guard flagged' : ''].filter(Boolean);
      lines.push(`  - ${r.clientName}${what ? ` - ${what}` : ''}${why ? ` (${why})` : ''}${flags.length ? ` [${flags.join(', ')}]` : ''}`);
    }
    lines.push('');
  }
  if (!rows.length) lines.push(`No plan for that week yet. It builds itself on the ${SEND_DAY_NAME} before, after that day's send, or ask to build it.`);
  return lines.join('\n').trim();
}

/** The week at a glance for the chat. */
async function weekReview(coachClientId, week) {
  const w = week || planStore.planningWeek(new Date(), SEND_HOUR);
  const screen = await screenFor(coachClientId, w);
  return { weekOf: w, counts: screen.counts, text: formatWeek(w, screen.rows) };
}

/**
 * One client's email IN FULL as it would go, plus why it was picked, the thought and why, what they
 * have already had, likely next, any hold, and the brief (pick.brief, when the deep-brief work has
 * put one there). For the chat.
 */
async function clientEmailFull(coachClientId, query, opts = {}) {
  const base = await clientEmails(coachClientId, query, opts);
  if (base.error) return base;
  const { client, week, outlook } = base;
  const row = await planStore.planFor(week, client.clientId);
  const lines = [`${client.clientName} - ${dayLabel(week)}`, ''];
  if (!row) {
    lines.push(`No plan row for them that week yet - it builds itself on the ${SEND_DAY_NAME} before.`);
    lines.push('', formatOutlook(client.clientName, outlook).split('\n').filter((l) => !/ - weekly emails$/.test(l)).join('\n'));
    return { ...base, text: lines.join('\n') };
  }
  const pick = row.pick || {};
  lines.push(`STATUS: ${STATUS_WORDS[row.status] || row.status}`);
  lines.push(`WHY THIS EMAIL: ${pick.reason || '-'}`);
  if (row.status === 'held' && row.hold) lines.push(`HELD BECAUSE: ${(row.hold.changed || [row.hold.reason]).join('; ')}`);
  if (pick.what && pick.what.kind === 'custom') lines.push(pick.replaces && pick.replaces.rule === 'steered' ? 'WRITTEN TO YOUR DIRECTION - read it closely.' : 'WRITTEN FOR THEM - nothing on the approved shelf fitted, so read it closely.');
  lines.push(`YOUR NOTE ON THEM: ${client.touchNote ? client.touchNote.replace(/\s*\n\s*/g, ' / ') : '(empty - add background with action=background)'}`);
  if (firstThingsOpen(pick)) {
    const ft = pick.firstThings;
    lines.push('', `SEND A PERSONAL NOTE FIRST - you owe them: ${(ft.items || []).map((o) => o.what).join('; ')}. The weekly email waits until you send it (or dismiss the flag).`);
    if (ft.note && ft.note.text) lines.push(`Draft note (subject "${ft.note.subject || ''}"):`, ft.note.text, ...(ft.note.guyChecks && ft.note.guyChecks.length ? [`Check before sending: ${ft.note.guyChecks.join('; ')}`] : []));
    if (ft.error) lines.push(`(${ft.error})`);
  }
  if (pick.guard && pick.guard.ok === false && !pick.guard.overriddenAt) lines.push(`FACT GUARD: ${(pick.guard.problems || []).join('; ')} - reword it, or approve anyway if you have checked.`);
  if (pick.thought && pick.thought.text) lines.push(`THOUGHT FOR THE WEEK from "${pick.thought.title}" - why this one: ${pick.thought.why || '-'}`);
  if (pick.what) {
    let html = null;
    try { html = await previewFor(week, client.clientId); } catch (e) { lines.push(`(could not render the email: ${e.message})`); }
    if (html) {
      lines.push('', '--- THE EMAIL, EXACTLY AS IT WOULD GO ---', `Subject: ${row.subject || '(none)'}`, '', emailAsText(html), '--- END ---');
    }
  } else lines.push('', 'Nothing goes to them that week.');
  if (pick.brief) {
    const b = pick.brief;
    lines.push('', 'BRIEF:');
    if (typeof b === 'string') lines.push(b);
    else {
      const said = (x) => (x && typeof x === 'object' ? x.what || x.text || x.summary || JSON.stringify(x) : x);
      for (const [k, v] of Object.entries(b)) lines.push(`  ${k}: ${Array.isArray(v) ? v.map(said).join('; ') : typeof v === 'object' ? JSON.stringify(v) : v}`);
    }
  }
  lines.push('', formatOutlook(client.clientName, outlook).split('\n').filter((l) => !/ - weekly emails$/.test(l)).join('\n'));
  return { ...base, row, text: lines.join('\n') };
}

/** The whole screen for a week: rows (with names and each client's three columns), the left-out list, call-due list, improvements, the approval rate. */
async function screenFor(coachClientId, week) {
  const [plan, rates, all, pins, skips, touchesByClient, pinsAhead, buildRun] = await Promise.all([
    planStore.plansFor(week), planStore.approvalRates(6), clientService.getAllClients(), planStore.pinsFor(week), planStore.skips(),
    allTouchesByClient(), pinsAheadOf(week), planStore.getState(`build-run:${week}`),
  ]);
  const byId = new Map(all.map((c) => [c.clientId, c]));
  const waiting = waitingImprovements(improvementsFile());
  const pieces = content.listPieces();
  const rows = plan.filter((r) => byId.has(r.clientId) && byId.get(r.clientId).coach === coachClientId).map((r) => {
    const c = byId.get(r.clientId);
    const f = r.facts || {};
    const outlook = outlookFor(r, touchesByClient.get(r.clientId) || [], pieces, { week, pinsAhead });
    return {
      ...r,
      bodyHtml: undefined, // heavy - the preview endpoint serves it
      customText: r.pick && r.pick.what && r.pick.what.kind === 'custom' ? briefs.htmlText(r.bodyHtml) : null, // Guy reads and edits a custom email on the row
      alreadyHad: outlook.alreadyHad,
      likelyNext: outlook.likelyNext,
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
  // Approved (final) pieces only - a draft can't be swapped or pinned in until Guy approves it.
  const titles = new Map(content.listPieces().filter((p) => p.status === 'final').map((p) => [p.slug, { title: p.title, kind: p.labels.kind }]));
  const shelf = [{ slug: ORIENTATION.slug, title: "What you've actually joined", kind: 'way-of-thinking' }, ...MANIFEST.client.filter((slug) => titles.has(slug)).map((slug) => ({ slug, title: titles.get(slug).title, kind: titles.get(slug).kind || '' }))];
  return {
    weekOf: week,
    planningWeek: planStore.planningWeek(new Date(), SEND_HOUR),
    sendAt: sendAt(week).toISOString(),
    sendHour: SEND_HOUR,
    mondaySend: mondaySendOn() && sendEnabled(),
    sendEnabled: sendEnabled(),
    build: buildStatus(buildRun),
    autosend: autosendOn(),
    shelf,
    firstEmail: { congrats: FIRST_EMAIL.congrats },
    // The thoughts Guy can swap in on a row (approved pieces with a nugget).
    thoughts: (() => { const n = require('./clientTouchThought').loadNuggets(); return content.listPieces().filter((p) => p.status === 'final' && n[p.slug]).map((p) => ({ slug: p.slug, title: p.title, text: n[p.slug] })); })(),
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
      held: rows.filter((r) => r.status === 'held').length,
      waiting: rows.filter((r) => r.status === 'proposed' && r.pick && r.pick.what).length,
    },
  };
}

/**
 * Guy's answer to "send a personal note first": 'sent' (he sent it himself - recorded in the touch
 * record, and the items are dealt with, so next week's brief does not raise them again) or
 * 'dismiss' (not needed - also remembered). Either way the weekly email for that client is free to
 * be approved. Returns the updated row.
 */
async function resolveFirstThings(week, clientId, { action, text = '' } = {}, deps = {}) {
  const ps = deps.planStore || planStore;
  const ts = deps.touchStore || touchStore;
  const row = await ps.planFor(week, clientId);
  if (!row || !row.pick || !row.pick.firstThings) throw new Error('No personal note is flagged for this client that week.');
  if (!['sent', 'dismiss'].includes(action)) throw new Error('action is sent or dismiss');
  const ft = row.pick.firstThings;
  const items = ft.items || [];
  const at = new Date();
  const words = String(text || (ft.note && ft.note.text) || '').replace(/[–—]/g, '-').trim();
  if (action === 'sent') {
    await ts.record({ clientId, kind: 'personal', key: `${OWED_NOTE_KEY}:${week}`, form: 'one-off', sentAt: at, reason: `personal note first - ${items.map((o) => o.what).join('; ')}`.slice(0, 900), source: 'manual', meta: { weekOf: week, firstThings: true, items: items.map((o) => o.id), subject: ft.note ? ft.note.subject : '', text: words.slice(0, 4000) } });
  }
  await briefs.markHandled(clientId, items, action === 'sent' ? 'sent' : 'dismissed', { text: action === 'sent' ? words : '', at: at.toISOString() }, { planStore: ps });
  return ps.setPlanPickField(week, clientId, 'firstThings', { ...ft, status: action === 'sent' ? 'sent' : 'dismissed', resolvedAt: at.toISOString(), ...(words && action === 'sent' ? { note: { ...(ft.note || {}), text: words } } : {}) });
}

/** Re-run the fact guard on a row's words now (after Guy edits them). Stores and returns the result. */
async function recheckGuard(week, clientId, deps = {}) {
  const ps = deps.planStore || planStore;
  const row = await ps.planFor(week, clientId);
  if (!row || !row.pick || !row.pick.what) return null;
  const text = guardText(row);
  const llm = deps.llm !== undefined ? deps.llm : serverLlm();
  const check = text ? await briefs.checkClaims(text, { facts: row.facts || {}, factLines: factLines(row.facts || {}, (row.facts && row.facts.signals) || {}, null), brief: row.pick.brief || null, llm, client: { clientName: (row.facts && row.facts.clientName) || clientId }, at: sendAt(week).getTime() })
    : { ok: true, problems: [], claims: [], checkedAt: new Date().toISOString(), by: 'code' };
  await ps.setPlanPickField(week, clientId, 'guard', { ...check, stage: 'edit' });
  return check;
}

/** The full HTML of one row's email as it would go (the screen's preview). */
async function previewFor(week, clientId) {
  const row = await planStore.planFor(week, clientId);
  if (!row || !row.pick || !row.pick.what || !row.pick.body) return null;
  const client = await clientService.getClientById(clientId);
  if (!client) return null;
  const { unsubscribeUrlFor } = require('./clientUnsubscribe');
  const firstWeekly = isFirstWeekly(await touchStore.touchesFor(clientId, { limit: 500 }));
  return composeEmail({ client, opening: row.opening, body: { title: row.pick.body.title, dek: row.pick.body.dek, bodyHtml: row.bodyHtml, qs: row.pick.body.qs, template: row.pick.body.template, congrats: row.pick.body.congrats }, unsubscribeUrl: unsubscribeUrlFor(client) || '#', kind: row.pick.what.kind, firstWeekly: firstWeekly && !ownWordsPin(row.pick), thought: row.pick.thought || null });
}

module.exports = {
  buildPlan,
  sendApproved,
  sendGuard,
  startBuild,
  buildStatus,
  mondaySend,
  rollOff,
  screenFor,
  clientEmails,
  clientEmailFull,
  weekReview,
  formatWeek,
  emailAsText,
  previewFor,
  buildPreview,
  buildSendReport,
  tick,
  startClientTouchPlanner,
  autosendOn,
  mondaySendOn,
  sendEnabled,
  resolveFirstThings,
  recheckGuard,
  deepen,
  // pure, tested
  stillAsBuilt,
  plannedTipFrom,
  ownWordsPin,
  firstThingsOpen,
  guardText,
  briefFactLines,
  OWED_NOTE_KEY,
  sendAt,
  callNotBefore,
  pickCallSlots,
  callOfferHtml,
  callOfferBody,
  refreshCallOffer,
  cancellationFrom,
  leaveOffList,
  todayFirstSeen,
  lastTouches,
  whatChanged,
  samePick,
  historyLines,
  outlookFor,
  formatOutlook,
  campaignSignals,
  noteSettings,
  currentStop,
  recentEvents,
  waitingImprovements,
  factLines,
  composeEmail,
  REVIEW_LINE,
  FIRST_EMAIL,
  welcomeLateNote,
  invitationsStarted,
  firstEmailBody,
  usesFirstEmail,
  stripLeadingName,
  isFirstWeekly,
  FIRST_WEEKLY_NOTE,
  CALL_OPENING,
  subjectFor,
  shortBody,
  buildBody,
  previewText,
  BUILD_HOUR,
  SEND_HOUR,
  SEND_DAY_NAME,
  hourLabel,
};
