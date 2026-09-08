// services/clientBoardService.js
// The coach's client board (the page that replaced My Coached Clients, 2026-09-09).
//
// One card per client the coach owns, in three groups - onboarding / running / paused - with
// step pills, session dates, last-used and owed items. EVERYTHING IS DERIVED LIVE from the record
// and the stores at read time; nothing on this board is a stored stage (decided 2026-08-24:
// no stalled-client alerts, no stored checklist - a dashboard, not a nag). The two levers the
// coach has are real fields with real meaning: `Launch Date` (set = on the onboarding journey)
// and `Coaching Status` = Graduated (sessions finished, plumbing complete - now a running client).
//
// Cost model: the board is one Airtable read, one calendar read and a handful of grouped
// Postgres queries - it loads in a second or two for a book of ~25. The slow live probes
// (listCalendars, the rules essentials, held captures) live in services/onboardingPreflight.js
// and run PER CARD on demand, never for the whole grid.

const clientService = require('./clientService');
const { getPool } = require('./recallWebhookDb');
const { createLogger } = require('../utils/contextLogger');

const logger = createLogger({ runId: 'BOARD', clientId: 'SYSTEM', operation: 'client_board' });

const present = (v) => Boolean(v && String(v).trim());
const lower = (v) => String(v || '').trim().toLowerCase();
const DAY = 24 * 60 * 60 * 1000;

// Owed items live in the Client Tasks table under these two phases (a session-wrap convention
// from 2026-09-09: promises made on the call go here, not only into memory files).
const OWED_PHASES = { 'You owe': 'coach', 'They owe': 'client' };

// ---------------------------------------------------------------------------------------------
// Postgres: grouped reads, each tolerant of a table that has never been created on this DB.

async function groupedQuery(sql, params = []) {
  const p = getPool();
  if (!p) return [];
  let c = null;
  try {
    c = await p.connect();
    const r = await c.query(sql, params);
    return r.rows;
  } catch (e) {
    // A store that is down, or a table this DB has never created, costs one column on the
    // board - never the board itself.
    logger.warn(`board grouped query skipped: ${e.message}`);
    return [];
  } finally {
    if (c) c.release();
  }
}

/** tenant -> ISO of the most recent sign of life across the stores that record per-tenant use. */
async function lastUsedByTenant() {
  const sources = [
    `SELECT tenant_id AS t, MAX(created_at) AS at FROM wingguy_chat_metrics GROUP BY 1`,
    `SELECT client_id AS t, MAX(checked_in_at) AS at FROM wingguy_extension_checkins GROUP BY 1`,
    `SELECT tenant_id AS t, MAX(at) AS at FROM wingguy_learning_events GROUP BY 1`,
    `SELECT tenant_id AS t, MAX(created_at) AS at FROM wingguy_draft_ledger GROUP BY 1`,
    `SELECT tenant_id AS t, MAX(updated_at) AS at FROM wingguy_rules WHERE layer = 'client' GROUP BY 1`,
  ];
  const out = new Map();
  for (const sql of sources) {
    const rows = await groupedQuery(sql);
    for (const r of rows) {
      const t = String(r.t || '').trim();
      const at = r.at ? new Date(r.at) : null;
      if (!t || !at || Number.isNaN(at.getTime())) continue;
      const prev = out.get(t);
      if (!prev || at > prev) out.set(t, at);
    }
  }
  return out;
}

/** tenant -> count of their own active instructions (client layer). */
async function ownRulesByTenant() {
  const rows = await groupedQuery(
    `SELECT tenant_id AS t, COUNT(*)::int AS n FROM wingguy_rules WHERE status = 'active' AND layer = 'client' GROUP BY 1`,
  );
  return new Map(rows.map((r) => [String(r.t).trim(), r.n]));
}

/** tenant -> count of meetings their recorder has filed. */
async function storedMeetingsByTenant() {
  const rows = await groupedQuery(
    `SELECT coach_client_id AS t, COUNT(*)::int AS n FROM recall_meetings GROUP BY 1`,
  );
  return new Map(rows.map((r) => [String(r.t).trim(), r.n]));
}

/** email -> ISO of the latest COACH-owned meeting that email attended (the last session). */
async function lastSessionByEmail(coachClientId) {
  const rows = await groupedQuery(
    `SELECT LOWER(p.verified_email) AS e, MAX(COALESCE(m.meeting_start, m.created_at)) AS at
       FROM recall_meetings m
       JOIN recall_meeting_participants p ON p.meeting_id = m.id
      WHERE m.coach_client_id = $1 AND p.verified_email IS NOT NULL AND p.verified_email <> ''
      GROUP BY 1`,
    [coachClientId],
  );
  return new Map(rows.map((r) => [String(r.e), new Date(r.at)]));
}

/** client_id -> latest extension check-in row. */
async function extensionByClient() {
  try {
    const { latestPerClient } = require('./extensionDistStore');
    const rows = await latestPerClient();
    return new Map(rows.map((r) => [String(r.client_id).trim(), r]));
  } catch (e) {
    logger.warn(`extension check-ins skipped: ${e.message}`);
    return new Map();
  }
}

// ---------------------------------------------------------------------------------------------
// Airtable: owed items from Client Tasks (one read for the whole board).

function masterBase() {
  const Airtable = require('airtable');
  Airtable.configure({ apiKey: process.env.AIRTABLE_API_KEY });
  return Airtable.base(process.env.MASTER_CLIENTS_BASE_ID);
}

/** clientRecordId -> [{ id, who: 'coach'|'client', task, status }] */
async function owedByClientRecord() {
  const out = new Map();
  try {
    const phases = Object.keys(OWED_PHASES).map((p) => `{Phase} = "${p}"`).join(', ');
    const records = await masterBase()('Client Tasks').select({
      filterByFormula: `AND(OR(${phases}), {Status} != "Done")`,
      sort: [{ field: 'Task Order', direction: 'asc' }],
    }).all();
    for (const rec of records) {
      const links = rec.get('Client') || [];
      const item = {
        id: rec.id,
        who: OWED_PHASES[rec.get('Phase')] || 'coach',
        task: rec.get('Task') || '',
        status: rec.get('Status') || 'Todo',
      };
      for (const recId of links) {
        if (!out.has(recId)) out.set(recId, []);
        out.get(recId).push(item);
      }
    }
  } catch (e) {
    logger.warn(`owed items skipped: ${e.message}`);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// The coach's calendar: one read, -90 days to +60 days, matched to clients by attendee email
// (or by the client's name in the title, for Calendly-shaped events that carry no attendee).

async function coachCalendarEvents(coachClientId) {
  try {
    const cal = require('./wingguyCalendar');
    const { getMeetingsInWindow } = require('./calendarProvider');
    const info = await cal.getCoachCalendarInfo(coachClientId);
    const coach = cal.coachForCalendar(info);
    const now = Date.now();
    const r = await getMeetingsInWindow(coach, new Date(now - 90 * DAY).toISOString(), new Date(now + 60 * DAY).toISOString());
    if (r && r.error) logger.warn(`coach calendar read errored: ${r.error}`);
    return (r && Array.isArray(r.events)) ? r.events : [];
  } catch (e) {
    logger.warn(`coach calendar read skipped: ${e.message}`);
    return [];
  }
}

function clientEmails(client) {
  const raw = (client.rawRecord && client.rawRecord._rawJson && client.rawRecord._rawJson.fields) || {};
  const alts = String(raw['Alternative Email Addresses'] || '').split(/[;,]/);
  return new Set([client.clientEmailAddress, client.lhAccountEmail, ...alts].map(lower).filter(Boolean));
}

function eventMatchesClient(ev, emails, clientName) {
  const attendees = Array.isArray(ev.attendees) ? ev.attendees : [];
  if (attendees.some((a) => !a.self && emails.has(lower(a.email)))) return true;
  const title = lower(ev.summary);
  const name = lower(clientName);
  return Boolean(name) && title.includes(name);
}

function sessionsFor(events, client) {
  const emails = clientEmails(client);
  const now = Date.now();
  let next = null;
  let last = null;
  for (const ev of events) {
    if (!ev || !ev.start || !eventMatchesClient(ev, emails, client.clientName)) continue;
    const start = new Date(ev.start);
    if (Number.isNaN(start.getTime())) continue;
    if (start.getTime() >= now) {
      if (!next || start < next.start) next = { start, title: ev.summary || '', link: ev.htmlLink || ev.location || '' };
    } else if (!last || start > last) {
      last = start;
    }
  }
  return { next, last };
}

// ---------------------------------------------------------------------------------------------
// Pills - the journey compressed to the eight things a glance needs. Each is
// { key, label, state: 'done'|'next'|'owed'|'off'|'manual', note }.

function calendarWired(client) {
  return present(client.googleCalendarEmail) || present(client.calendarProvider) || present(client.nylasGrantId)
    || present(client.unipileAccountId) || present(client.calendarProviderToken);
}

function recorderKey(client) {
  const provider = lower(client.transcriptProvider || 'fathom');
  if (provider === 'granola') return present(client.granolaApiKey) && present(client.granolaWebhookSecret);
  if (provider === 'fireflies') return present(client.firefliesApiKey) && present(client.firefliesWebhookSecret);
  return present(client.fathomApiKey);
}

function buildPills(client, ctx) {
  const raw = (client.rawRecord && client.rawRecord._rawJson && client.rawRecord._rawJson.fields) || {};
  const rules = ctx.ownRules.get(client.clientId) || 0;
  const stored = ctx.storedMeetings.get(client.clientId) || 0;
  const ext = ctx.extension.get(client.clientId) || null;
  const folder = present(raw['Extension Folder Provider']) && present(raw['Extension Folder Ref']);
  const seriesStart = raw['Email Series Start Date'] || '';
  const graduated = client.coachingStatus === 'Graduated';
  const usedAt = ctx.lastUsed.get(client.clientId) || null;

  const pills = [];
  pills.push({
    key: 'connector', label: 'Connector',
    state: usedAt ? 'done' : (present(client.portalToken) ? 'manual' : 'owed'),
    note: usedAt ? 'used' : (present(client.portalToken) ? 'URL ready - proof is Wingguy answering in their Claude' : 'no portal token'),
  });
  pills.push({
    key: 'calendar', label: 'Calendar & mailbox',
    state: calendarWired(client) ? 'done' : 'owed',
    note: calendarWired(client) ? (client.calendarProvider || (client.googleCalendarEmail ? 'google' : 'connected')) : 'nothing connected',
  });
  pills.push({
    key: 'meetingLink', label: 'Meeting link',
    state: present(client.bookingZoom) ? 'done' : 'owed',
    note: present(client.bookingZoom) ? 'set' : 'blank - invites go out with nothing to click',
  });
  pills.push({
    key: 'instructions', label: 'Instructions',
    state: rules > 0 ? 'done' : 'owed',
    note: rules > 0 ? `${rules} own instruction${rules === 1 ? '' : 's'}` : 'homework not started',
  });
  const rk = recorderKey(client);
  pills.push({
    key: 'recorder', label: 'Recorder',
    state: rk ? (stored > 0 ? 'done' : 'next') : 'owed',
    note: rk ? `${lower(client.transcriptProvider || 'fathom')} · ${stored} filed` : 'no recorder key',
  });
  if (client.wingguyEnabled) {
    pills.push({
      key: 'extension', label: 'Extension',
      state: folder ? 'done' : 'owed',
      note: folder ? `${raw['Extension Folder Provider']}${ext && ext.version ? ` · v${ext.version}` : ''}` : 'no update folder yet',
    });
  }
  pills.push({
    key: 'key', label: 'Own key',
    state: (present(client.anthropicApiKey) || client.managedClaudeKey) ? 'done' : 'owed',
    note: client.managedClaudeKey ? 'managed plan' : (present(client.anthropicApiKey) ? 'set' : 'no sk-ant- key - drafting and the overnight brief are blocked'),
  });
  pills.push({
    key: 'linkedHelper', label: 'Linked Helper',
    state: (graduated || present(seriesStart)) ? 'done' : 'manual',
    note: present(seriesStart) ? `series started ${seriesStart}` : 'the closing step',
  });

  // "next" = the first pill still owed, so the card reads as a journey rather than a scorecard.
  const firstOwed = pills.find((p) => p.state === 'owed');
  if (firstOwed) firstOwed.state = 'next';
  return pills;
}

function plumbingComplete(pills) {
  const need = ['calendar', 'meetingLink', 'key'];
  return need.every((k) => (pills.find((p) => p.key === k) || {}).state === 'done');
}

// ---------------------------------------------------------------------------------------------

function groupFor(client) {
  // Status Paused = access off. Coaching Status Paused = access on but the journey is parked
  // (a billing pause, a client too busy this quarter) - both belong under Paused so nobody
  // sits in Onboarding looking stalled when they are deliberately on hold.
  if (client.status !== 'Active' || client.coachingStatus === 'Paused') return 'paused';
  if (client.coachingStatus === 'Graduated') return 'running';
  if (present(client.launchDate) || client.wingguyEnabled) return 'onboarding';
  return 'running';
}

function daysAgo(d) {
  if (!d) return null;
  return Math.max(0, Math.floor((Date.now() - new Date(d).getTime()) / DAY));
}

function attentionFor(group, { next, lastTouch, pills }) {
  if (group !== 'onboarding') return 'none';
  if (pills.some((p) => p.key === 'linkedHelper' ? false : p.state === 'owed' && p.note && p.note.includes('blocked'))) return 'red';
  const touchDays = daysAgo(lastTouch);
  if (!next && (touchDays === null || touchDays > 14)) return 'red';
  if (!next) return 'amber';
  return 'green';
}

async function getBoard(coachClientId) {
  const all = await clientService.getAllClients();
  const mine = all.filter((c) => c.coach === coachClientId && c.clientId !== coachClientId);

  const [lastUsed, ownRules, storedMeetings, lastSessions, extension, owed, events] = await Promise.all([
    lastUsedByTenant(),
    ownRulesByTenant(),
    storedMeetingsByTenant(),
    lastSessionByEmail(coachClientId),
    extensionByClient(),
    owedByClientRecord(),
    coachCalendarEvents(coachClientId),
  ]);
  const ctx = { lastUsed, ownRules, storedMeetings, extension };

  const cards = mine.map((client) => {
    const raw = (client.rawRecord && client.rawRecord._rawJson && client.rawRecord._rawJson.fields) || {};
    const group = groupFor(client);
    const pills = buildPills(client, ctx);
    const { next, last: lastCal } = sessionsFor(events, client);
    // Last session = the later of the recorder's filing and the calendar's past match.
    let lastSession = lastCal;
    for (const e of clientEmails(client)) {
      const t = lastSessions.get(e);
      if (t && (!lastSession || t > lastSession)) lastSession = t;
    }
    const usedAt = lastUsed.get(client.clientId) || null;
    const lastTouch = [lastSession, usedAt, client.launchDate ? new Date(client.launchDate) : null]
      .filter(Boolean).sort((a, b) => b - a)[0] || null;
    const attention = attentionFor(group, { next, lastTouch, pills });
    return {
      recordId: client.id,
      clientId: client.clientId,
      clientName: client.clientName,
      group,
      attention,
      status: client.status,
      coachingStatus: client.coachingStatus || null,
      launchDate: client.launchDate || null,
      introducedBy: raw['Introduced By'] || null,
      seriesStart: raw['Email Series Start Date'] || null,
      reconnectOn: raw['Reconnect On'] || null,
      pills,
      plumbingComplete: plumbingComplete(pills),
      nextSession: next ? { at: next.start.toISOString(), title: next.title, link: next.link } : null,
      lastSessionAt: lastSession ? new Date(lastSession).toISOString() : null,
      lastUsedAt: usedAt ? usedAt.toISOString() : null,
      owed: owed.get(client.id) || [],
      portalToken: client.portalToken || null,
      loginEmail: client.clientEmailAddress || null,
      leadsBaseId: client.airtableBaseId || null,
      calendarProvider: client.calendarProvider || (client.googleCalendarEmail ? 'google' : null),
      coachNotes: client.coachNotes || '',
    };
  });

  cards.sort((a, b) => a.clientName.localeCompare(b.clientName));
  const byGroup = { onboarding: [], running: [], paused: [] };
  for (const c of cards) byGroup[c.group].push(c);

  const active = cards.filter((c) => c.status === 'Active');
  const quarterStart = new Date(Date.UTC(new Date().getUTCFullYear(), Math.floor(new Date().getUTCMonth() / 3) * 3, 1));
  const newThisQuarter = cards.filter((c) => c.launchDate && new Date(c.launchDate) >= quarterStart);
  const strip = {
    onboarding: byGroup.onboarding.length,
    onboardingNotBooked: byGroup.onboarding.filter((c) => !c.nextSession).length,
    plumbingComplete: active.filter((c) => c.plumbingComplete).length,
    plumbingCompleteEver: cards.filter((c) => c.plumbingComplete).length,
    paused: byGroup.paused.length,
    pausedWithCheckIn: byGroup.paused.filter((c) => c.reconnectOn).length,
    referralsThisQuarter: newThisQuarter.filter((c) => present(c.introducedBy)).length,
    newThisQuarter: newThisQuarter.length,
    calendarRead: events.length > 0,
  };

  return { coachClientId, count: cards.length, generatedAt: new Date().toISOString(), strip, groups: byGroup };
}

/** The per-card drawer: live preflight + every task + the links the coach pastes into emails. */
async function getCardDetail(coachClientId, clientId) {
  const client = await clientService.getClientById(clientId);
  if (!client || client.coach !== coachClientId) {
    const err = new Error('not your client');
    err.code = 'FORBIDDEN';
    throw err;
  }
  const { runPreflight } = require('./onboardingPreflight');
  const [preflight, tasks] = await Promise.all([
    runPreflight(clientId).catch((e) => ({ clientId, steps: [], warnings: [`preflight failed: ${e.message}`] })),
    clientService.getClientTasks(clientId).catch(() => []),
  ]);
  return {
    clientId,
    clientName: client.clientName,
    preflight,
    tasks,
    links: {
      portalUrl: client.portalToken ? `https://pb-webhook-server.vercel.app/?token=${client.portalToken}` : null,
      connectorUrl: client.portalToken ? `https://pb-webhook-server.onrender.com/mcp2/${client.portalToken}` : null,
    },
  };
}

module.exports = { getBoard, getCardDetail, OWED_PHASES };
