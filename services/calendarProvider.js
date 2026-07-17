/**
 * Calendar provider adapter — the ONE swappable seam for reading a coach's calendar.
 *
 * Two backends behind a switch (CALENDAR_PROVIDER, default 'google'; per-coach override via
 * a `calendarProvider` field wins):
 *   google = existing Google service-account read (single-tenant: a calendar shared with our
 *            service account). Proven; same path recallAutoSplitService uses.
 *   nylas  = per-tenant Nylas grant (the multi-tenant client model). Each tenant connects their
 *            own Google/Outlook once via Nylas hosted auth; we read through Nylas server-side.
 *
 * The Fathom splitter calls getMeetingsInWindow() and never knows which backend served it, so
 * swapping providers — or going multi-tenant — is contained to THIS file.
 *
 * Output shape matches the Google reader so the existing filters (extractMeetingUrl /
 * isCoachAttending in recallAutoJoinService) work unchanged:
 *   { summary, start, end, location, description, htmlLink, conferenceData,
 *     attendees:[{ email, displayName, self, organizer, responseStatus }] }
 *
 * SAFE: default 'google' = today's behaviour exactly. Flip CALENDAR_PROVIDER=nylas to dogfood
 * Nylas; flip back instantly. Only the Fathom splitter routes through here for now — the daily
 * booking/availability flow is untouched.
 *
 * NOTE: the Nylas mapping targets the Nylas v3 Events API; verify field shapes against the live
 * sandbox the first time Guy connects his calendar (built before a sandbox existed).
 */

const { listCalendarEventsWithAttendeesInRange } = require('../config/calendarServiceAccount');
const { DateTime } = require('luxon');
const { createSafeLogger } = require('../utils/loggerHelper');

const log = createSafeLogger('SYSTEM', null, 'calendar_provider');

function activeProvider(coach) {
  const p = (coach && coach.calendarProvider) || process.env.CALENDAR_PROVIDER || 'google';
  return String(p).trim().toLowerCase();
}

/* ---- Multi-calendar read scope (2026-07-17) ------------------------------------------------------
 * The no-double-book guarantee is only TRUE if availability reads see EVERY calendar the coach keeps
 * (miss the personal calendar and Wingguy books a lead over the dentist). Read scope comes from the
 * per-client `Calendar Read IDs` roster field (coach.calendarReadIds):
 *   blank          -> the single default calendar (exactly the pre-2026-07-17 behaviour)
 *   "all"          -> every calendar in the connected account (nylas/zoho; read-only subscribed
 *                     feeds are skipped on nylas — they're FYI, list them explicitly to include one)
 *   "id1, id2"     -> exactly those provider-native ids (nylas calendar ids / zoho uids / google
 *                     calendar emails shared with the service account)
 * Writes stay on ONE nominated calendar (coach.nylasCalendarId / coach.calendarUid, fed by the
 * `Calendar Write ID` roster field; blank = the provider default, unchanged). */
function parseReadIds(coach) {
  const raw = String((coach && coach.calendarReadIds) || '').trim();
  if (!raw) return null; // default: single-calendar, today's behaviour
  if (/^all$/i.test(raw)) return 'all';
  const ids = raw.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
  return ids.length ? ids : null;
}

// Same meeting can appear on several calendars (an invite accepted onto two) — for busy-merge it's
// harmless, for listing it's noise. Key on what makes it "the same block of time".
function dedupEvents(events) {
  const seen = new Set();
  return events.filter((e) => {
    const k = `${e.summary}|${e.start}|${e.end}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// [startISO, endExclusiveISO] for an all-day span, computed at the COACH's local midnights so day
// grouping and "overlaps this day" checks land on the right local days (UTC midnights would smear a
// one-day event across two Brisbane days).
function allDaySpan(startDate, endDateExclusive, tz) {
  const zone = tz || 'UTC';
  const s = DateTime.fromISO(startDate, { zone });
  const e = endDateExclusive ? DateTime.fromISO(endDateExclusive, { zone }) : s.plus({ days: 1 });
  if (!s.isValid || !e.isValid) return null;
  return { start: s.toUTC().toISO(), end: (e > s ? e : s.plus({ days: 1 })).toUTC().toISO() };
}

/**
 * @param {object} coach  client record (from clientService.getClientById)
 * @param {Date|string} timeMin
 * @param {Date|string} timeMax
 * @param {object} [opts] { includeAllDay } — all-day events are DROPPED by default (an all-day
 *   "Leave" marker isn't a 30-min clash, and must never blanket-block a day's slots); only the
 *   read-only listing path opts in to see them.
 * @returns {Promise<{events:object[], error:string|null, provider:string}>}
 */
async function getMeetingsInWindow(coach, timeMin, timeMax, opts = {}) {
  const provider = activeProvider(coach);
  let r;
  if (provider === 'nylas') r = await getViaNylas(coach, timeMin, timeMax);
  else if (provider === 'zoho') r = await getViaZoho(coach, timeMin, timeMax);
  else r = await getViaGoogle(coach, timeMin, timeMax);
  if (!opts.includeAllDay && Array.isArray(r.events)) {
    r = { ...r, events: r.events.filter((e) => !e.allDay) };
  }
  return r;
}

/**
 * Every calendar in the coach's connected account — for the "which calendars do you keep?" setup
 * step that fills `Calendar Read IDs` / `Calendar Write ID`. Google service-account clients can't
 * enumerate (the service account only sees calendars explicitly shared with it) — list ids by hand.
 * @returns {Promise<{calendars:Array<{id,name,isDefault,readOnly}>, error:string|null, provider:string}>}
 */
async function listCalendars(coach) {
  const provider = activeProvider(coach);
  try {
    if (provider === 'nylas') {
      const cals = await listNylasCalendars(coach);
      return { calendars: cals.map((c) => ({ id: c.id, name: c.name || '', isDefault: !!c.is_primary, readOnly: !!c.read_only })), error: null, provider };
    }
    if (provider === 'zoho') {
      const accessToken = await getZohoAccessToken(coach);
      const cals = await listZohoCalendars(coach, accessToken);
      return { calendars: cals.map((c) => ({ id: c.uid, name: c.name || '', isDefault: !!c.isdefault, readOnly: false })), error: null, provider };
    }
    return { calendars: [], error: 'google service-account clients can\'t enumerate calendars — put explicit calendar emails (shared with the service account) in Calendar Read IDs', provider };
  } catch (e) {
    return { calendars: [], error: e.message, provider };
  }
}

/* ---- Google (existing service-account; single-calendar behaviour unchanged) -------------- */
async function getViaGoogle(coach, timeMin, timeMax) {
  const calEmail = coach.googleCalendarEmail || coach.calendarEmail;
  if (!calEmail) return { events: [], error: 'no google calendar email for coach', provider: 'google' };
  const readIds = parseReadIds(coach);
  // 'all' can't work here: the service account only sees calendars explicitly shared with it, so
  // the read set must be listed. The primary share is always included.
  if (readIds === 'all') log.warn('[calendarProvider] Calendar Read IDs="all" not supported on google service-account — reading the primary share only; list calendar emails explicitly');
  const ids = [...new Set([calEmail, ...(Array.isArray(readIds) ? readIds : [])])];
  const tz = coach.timezone || null;
  const events = [];
  for (const id of ids) {
    const r = await listCalendarEventsWithAttendeesInRange(id, timeMin, timeMax);
    if (r.error) return { events: [], error: ids.length > 1 ? `calendar "${id}": ${r.error}` : r.error, provider: 'google' };
    for (const ev of r.events || []) events.push(googleAllDayNormalise(ev, tz, id));
  }
  return { events: ids.length > 1 ? dedupEvents(events) : events, error: null, provider: 'google' };
}

// Google all-day events carry date-only start/end (no 'T'). Flag them and pin the span to the
// coach's local midnights; timed events pass through untouched.
function googleAllDayNormalise(ev, tz, calendarId) {
  const out = calendarId ? { ...ev, calendarId } : ev;
  const s = String(ev.start || '');
  if (!s || s.includes('T')) return out;
  const span = allDaySpan(s, String(ev.end || '') || null, tz); // Google end date is exclusive
  if (!span) return out;
  return { ...out, allDay: true, start: span.start, end: span.end };
}

/* ---- Nylas (per-tenant grant; verify against sandbox) -------------------- */
function nylasEnv(coach) {
  return {
    apiKey: process.env.NYLAS_API_KEY,
    grantId: (coach && coach.nylasGrantId) || process.env.NYLAS_GRANT_ID,
    apiUri: (process.env.NYLAS_API_URI || 'https://api.us.nylas.com').replace(/\/$/, ''),
    writeCalendarId: (coach && coach.nylasCalendarId) || process.env.NYLAS_CALENDAR_ID || 'primary',
  };
}

/** All calendars on the grant (paginated). Throws on failure. */
async function listNylasCalendars(coach) {
  const { apiKey, grantId, apiUri } = nylasEnv(coach);
  if (!apiKey || !grantId) throw new Error('NYLAS_API_KEY / grant not configured');
  const cals = [];
  let cursor = null;
  for (let page = 0; page < 5; page++) {
    const u = new URL(`${apiUri}/v3/grants/${grantId}/calendars`);
    u.searchParams.set('limit', '50');
    if (cursor) u.searchParams.set('page_token', cursor);
    const res = await fetch(u.toString(), { headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' } });
    if (!res.ok) throw new Error(`nylas calendars HTTP ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
    const json = await res.json();
    cals.push(...(json.data || []));
    cursor = json.next_cursor || null;
    if (!cursor) break;
  }
  return cals;
}

async function getViaNylas(coach, timeMin, timeMax) {
  const { apiKey, grantId, apiUri, writeCalendarId } = nylasEnv(coach);
  if (!apiKey || !grantId) return { events: [], error: 'NYLAS_API_KEY / grant not configured', provider: 'nylas' };

  // Read scope: default = the one write calendar (today's behaviour); 'all' = every calendar on the
  // grant except read-only subscribed feeds (FYI noise — list one explicitly to include it).
  const readIds = parseReadIds(coach);
  let calendarIds = [writeCalendarId];
  if (readIds === 'all') {
    try {
      calendarIds = (await listNylasCalendars(coach)).filter((c) => !c.read_only).map((c) => c.id);
      if (!calendarIds.length) calendarIds = [writeCalendarId];
    } catch (e) {
      return { events: [], error: `nylas calendar list failed: ${e.message}`, provider: 'nylas' };
    }
  } else if (Array.isArray(readIds)) {
    calendarIds = readIds;
  }

  const startSec = Math.floor(new Date(timeMin).getTime() / 1000);
  const endSec = Math.floor(new Date(timeMax).getTime() / 1000);
  const selfEmail = String(coach.googleCalendarEmail || coach.calendarEmail || '').toLowerCase();
  const tz = coach.timezone || null;
  const events = [];
  for (const calendarId of calendarIds) {
    // Paginate: with expand_recurring a multi-week window easily exceeds one page (daily recurring
    // personal events count as one instance each).
    let cursor = null;
    for (let page = 0; page < 5; page++) {
      const u = new URL(`${apiUri}/v3/grants/${grantId}/events`);
      u.searchParams.set('calendar_id', calendarId);
      u.searchParams.set('start', String(startSec));
      u.searchParams.set('end', String(endSec));
      u.searchParams.set('limit', '200');
      u.searchParams.set('expand_recurring', 'true');
      if (cursor) u.searchParams.set('page_token', cursor);

      let res;
      try {
        res = await fetch(u.toString(), { headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' } });
      } catch (e) {
        return { events: [], error: `nylas request failed: ${e.message}`, provider: 'nylas' };
      }
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        return { events: [], error: `nylas HTTP ${res.status} (calendar ${calendarId}): ${body.slice(0, 200)}`, provider: 'nylas' };
      }
      const json = await res.json();
      events.push(...(json.data || [])
        .map((ev) => mapNylasEvent(ev, selfEmail, tz))
        .filter(Boolean)
        .map((ev) => ({ ...ev, calendarId })));
      cursor = json.next_cursor || null;
      if (!cursor) break;
    }
  }
  return { events: calendarIds.length > 1 ? dedupEvents(events) : events, error: null, provider: 'nylas' };
}

/** Map one Nylas v3 event into the Google-shaped event the filters expect. */
function mapNylasEvent(ev, selfEmail, tz) {
  const when = ev.when || {};
  let allDay = false;
  let startSec = when.start_time;
  let endSec = when.end_time;
  if (!startSec || !endSec) {
    // All-day: when.object 'date' ({date}) or 'datespan' ({start_date, end_date}). VERIFY-LIVE:
    // datespan end_date assumed EXCLUSIVE (Google passthrough semantics) — check against a real
    // multi-day all-day event the first time one shows up in a live listing.
    const startDate = when.date || when.start_date;
    if (!startDate) return null; // no usable time shape at all
    const span = allDaySpan(String(startDate), when.end_date ? String(when.end_date) : null, tz);
    if (!span) return null;
    allDay = true;
    startSec = Math.floor(new Date(span.start).getTime() / 1000);
    endSec = Math.floor(new Date(span.end).getTime() / 1000);
  }

  const orgEmail = String(ev.organizer?.email || '').toLowerCase();
  const participants = Array.isArray(ev.participants) ? ev.participants : [];
  const attendees = participants.map((p) => {
    const email = String(p.email || '').toLowerCase();
    return {
      email: p.email || '',
      displayName: p.name || '',
      self: !!selfEmail && email === selfEmail,
      organizer: !!orgEmail && email === orgEmail,
      responseStatus: mapNylasStatus(p.status),
    };
  });
  // The coach is usually the organizer and often absent from participants — ensure a 'self' row
  // exists so isCoachAttending() recognises the coach is in the meeting.
  if (selfEmail && !attendees.some((a) => a.self)) {
    attendees.push({ email: selfEmail, displayName: '', self: true, organizer: orgEmail === selfEmail, responseStatus: 'accepted' });
  }

  const confUrl = ev.conferencing?.details?.url || '';
  return {
    id: ev.id || null, // Nylas event id — needed to delete (e.g. clearing Wingguy offer HOLDs)
    summary: ev.title || '(No title)',
    start: new Date(startSec * 1000).toISOString(),
    end: new Date(endSec * 1000).toISOString(),
    ...(allDay ? { allDay: true } : {}),
    location: confUrl || ev.location || '',
    description: ev.description || '',
    htmlLink: confUrl || '',
    conferenceData: confUrl ? { entryPoints: [{ entryPointType: 'video', uri: confUrl }] } : null,
    attendees,
  };
}

function mapNylasStatus(s) {
  const v = String(s || '').toLowerCase();
  if (v === 'yes') return 'accepted';
  if (v === 'no') return 'declined';
  if (v === 'maybe') return 'tentative';
  return 'needsAction';
}

/* ---- WRITE: create an event + invite the guest (proven via scripts/nylas-write-test.js) --------- */
/**
 * @param {object} coach  client record (needs nylasGrantId for the nylas backend)
 * @param {object} details { title, description, startISO, endISO, attendees:[{email,name}], location }
 * @returns {Promise<{ok:boolean, eventId?:string, htmlLink?:string, error?:string, provider:string}>}
 */
async function createCalendarEvent(coach, details) {
  const provider = activeProvider(coach);
  if (provider === 'nylas') return createViaNylas(coach, details);
  if (provider === 'zoho') return createViaZoho(coach, details);
  // The Google service account is READ-ONLY (calendar.readonly) — no write path there by design.
  return { ok: false, error: `create-event not supported on provider '${provider}' (Google service account is read-only — use Nylas or Zoho)`, provider };
}

async function createViaNylas(coach, details) {
  const apiKey = process.env.NYLAS_API_KEY;
  const grantId = (coach && coach.nylasGrantId) || process.env.NYLAS_GRANT_ID;
  const apiUri = (process.env.NYLAS_API_URI || 'https://api.us.nylas.com').replace(/\/$/, '');
  const calendarId = (coach && coach.nylasCalendarId) || process.env.NYLAS_CALENDAR_ID || 'primary';
  if (!apiKey || !grantId) return { ok: false, error: 'NYLAS_API_KEY / grant not configured', provider: 'nylas' };

  const startSec = Math.floor(new Date(details.startISO).getTime() / 1000);
  const endSec = Math.floor(new Date(details.endISO).getTime() / 1000);
  if (!startSec || !endSec || endSec <= startSec) return { ok: false, error: 'invalid start/end time', provider: 'nylas' };

  const u = new URL(`${apiUri}/v3/grants/${grantId}/events`);
  u.searchParams.set('calendar_id', calendarId);
  // Emails the guest the invite — except attendee-less utility events (offer HOLDs) where there is
  // no one to notify and notifying would be wrong anyway.
  u.searchParams.set('notify_participants', details.notifyParticipants === false ? 'false' : 'true');
  const body = {
    title: details.title || 'Meeting',
    description: details.description || '',
    when: { start_time: startSec, end_time: endSec },
    participants: (details.attendees || [])
      .filter((a) => a && a.email)
      .map((a) => ({ email: String(a.email).trim(), name: a.name || '' })),
  };
  if (details.location) body.location = details.location;
  if (details.reminders) body.reminders = details.reminders; // { use_default, overrides:[{reminder_minutes,reminder_method}] }

  let res;
  try {
    res = await fetch(u.toString(), {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (e) {
    return { ok: false, error: `nylas request failed: ${e.message}`, provider: 'nylas' };
  }
  const text = await res.text();
  if (!res.ok) {
    log.warn(`[calendarProvider] nylas create failed HTTP ${res.status}: ${text.slice(0, 200)}`);
    return { ok: false, error: `nylas HTTP ${res.status}: ${text.slice(0, 200)}`, provider: 'nylas' };
  }
  let json = {}; try { json = JSON.parse(text); } catch (_) { /* leave empty */ }
  const ev = json.data || json;
  return { ok: true, eventId: ev.id, htmlLink: ev.html_link || '', provider: 'nylas' };
}

/* ---- DELETE: remove an event by id (Nylas only — used to clear Wingguy offer HOLDs) ------------- */
async function deleteCalendarEvent(coach, eventId) {
  const provider = activeProvider(coach);
  if (provider === 'zoho') return deleteViaZoho(coach, eventId);
  if (provider !== 'nylas') {
    return { ok: false, error: `delete-event not supported on provider '${provider}' (use Nylas or Zoho)`, provider };
  }
  const apiKey = process.env.NYLAS_API_KEY;
  const grantId = (coach && coach.nylasGrantId) || process.env.NYLAS_GRANT_ID;
  const apiUri = (process.env.NYLAS_API_URI || 'https://api.us.nylas.com').replace(/\/$/, '');
  const calendarId = (coach && coach.nylasCalendarId) || process.env.NYLAS_CALENDAR_ID || 'primary';
  if (!apiKey || !grantId) return { ok: false, error: 'NYLAS_API_KEY / grant not configured', provider: 'nylas' };
  if (!eventId) return { ok: false, error: 'eventId required', provider: 'nylas' };

  const u = new URL(`${apiUri}/v3/grants/${grantId}/events/${encodeURIComponent(eventId)}`);
  u.searchParams.set('calendar_id', calendarId);
  u.searchParams.set('notify_participants', 'false');
  let res;
  try {
    res = await fetch(u.toString(), { method: 'DELETE', headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' } });
  } catch (e) {
    return { ok: false, error: `nylas request failed: ${e.message}`, provider: 'nylas' };
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    return { ok: false, error: `nylas HTTP ${res.status}: ${body.slice(0, 200)}`, provider: 'nylas' };
  }
  return { ok: true, provider: 'nylas' };
}

/* ---- Zoho (direct adapter; Nylas can't serve Zoho calendar) ------------------------------------
 * Per-tenant creds live on the client record: calendarProviderToken = a long-lived Zoho REFRESH
 * token, calendarProviderDomain = the account's data-centre. The platform Zoho app (one for all
 * tenants) supplies ZOHO_CLIENT_ID / ZOHO_CLIENT_SECRET (env). Access tokens (~1h) are refreshed on
 * demand and cached in-memory.
 * Zoho Calendar API v1: GET/POST /api/v1/calendars/<uid>/events ; auth header
 * "Authorization: Zoho-oauthtoken <access>". Datetimes are "yyyyMMdd'T'HHmmss'Z'" (GMT).
 * VERIFY-AGAINST-LIVE (per docs/zoho-calendar-adapter-plan.md): exact scope names, the events
 * response field shapes (dateandtime / attendees / location), the create invite-email behaviour,
 * and whether DELETE needs an etag — confirm the first time Julian connects a real account. Dormant
 * until a tenant has calendarProvider='zoho', so this can ship unverified without affecting anyone. */

const zohoTokenCache = new Map(); // refreshToken -> { accessToken, expiresAt }

// Accept either a bare DC suffix ("com", "com.au", "eu", …) or a full host ("calendar.zoho.com.au").
function zohoHosts(domain) {
  let d = String(domain || '').trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (!d) d = 'com';
  if (/^(com|com\.au|com\.cn|eu|in|jp|ca|sa|com\.sa|uk)$/i.test(d)) {
    return { calendarBase: `https://calendar.zoho.${d}`, accountsBase: `https://accounts.zoho.${d}` };
  }
  return { calendarBase: `https://${d}`, accountsBase: `https://${d.replace(/^calendar\./, 'accounts.')}` };
}

function zohoAuthHeaders(accessToken) {
  return { Authorization: `Zoho-oauthtoken ${accessToken}`, Accept: 'application/json' };
}

async function getZohoAccessToken(coach) {
  const refreshToken = coach && coach.calendarProviderToken;
  if (!refreshToken) throw new Error('no Zoho refresh token on file (calendarProviderToken)');
  const cached = zohoTokenCache.get(refreshToken);
  if (cached && cached.expiresAt > Date.now() + 60000) return cached.accessToken;
  const clientId = process.env.ZOHO_CLIENT_ID;
  const clientSecret = process.env.ZOHO_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error('ZOHO_CLIENT_ID / ZOHO_CLIENT_SECRET not configured');
  const { accountsBase } = zohoHosts(coach.calendarProviderDomain);
  const u = new URL(`${accountsBase}/oauth/v2/token`);
  u.searchParams.set('refresh_token', refreshToken);
  u.searchParams.set('client_id', clientId);
  u.searchParams.set('client_secret', clientSecret);
  u.searchParams.set('grant_type', 'refresh_token');
  const res = await fetch(u.toString(), { method: 'POST', headers: { Accept: 'application/json' } });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.access_token) throw new Error(`Zoho token refresh HTTP ${res.status}: ${JSON.stringify(json).slice(0, 160)}`);
  const accessToken = json.access_token;
  const ttlMs = (Number(json.expires_in) || 3600) * 1000;
  zohoTokenCache.set(refreshToken, { accessToken, expiresAt: Date.now() + ttlMs });
  return accessToken;
}

/** All calendars on the Zoho account. Throws on failure. */
async function listZohoCalendars(coach, accessToken) {
  const { calendarBase } = zohoHosts(coach.calendarProviderDomain);
  const res = await fetch(`${calendarBase}/api/v1/calendars`, { headers: zohoAuthHeaders(accessToken) });
  if (!res.ok) throw new Error(`Zoho calendars list HTTP ${res.status}: ${(await res.text()).slice(0, 150)}`);
  const json = await res.json();
  return json.calendars || json.data || [];
}

async function getZohoCalendarUid(coach, accessToken) {
  if (coach && coach.calendarUid) return coach.calendarUid;
  const cals = await listZohoCalendars(coach, accessToken);
  const def = cals.find((c) => c.isdefault) || cals[0];
  if (!def || !def.uid) throw new Error('no Zoho calendar found for this account');
  return def.uid;
}

// ISO -> Zoho GMT "yyyyMMddTHHmmssZ"
function isoToZoho(iso) {
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
}

// Zoho datetime -> ISO. Handles GMT "…Z" and offset "…+hhmm"; returns null for all-day (yyyyMMdd)
// or unparseable, so all-day entries drop out (parity with the Nylas mapper — only timed events
// matter for availability).
function zohoToISO(s) {
  const str = String(s || '').trim();
  let m = str.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6])).toISOString();
  m = str.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})([+-]\d{4})$/);
  if (m) {
    const d = new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${m[7].slice(0, 3)}:${m[7].slice(3)}`);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }
  return null;
}

function mapZohoStatus(s) {
  const v = String(s || '').toUpperCase();
  if (v === 'ACCEPTED') return 'accepted';
  if (v === 'DECLINED') return 'declined';
  if (v === 'TENTATIVE') return 'tentative';
  return 'needsAction'; // NEEDS-ACTION / unknown
}

// Bare Zoho all-day date "yyyyMMdd" -> "yyyy-MM-dd" (or null).
function zohoDateOnly(s) {
  const m = String(s || '').trim().match(/^(\d{4})(\d{2})(\d{2})$/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/** Map one Zoho event into the Google-shaped event the filters expect. */
function mapZohoEvent(ev, selfEmail, tz) {
  // An empty window returns events: [{"message": "No events found."}] — a sentinel INSIDE the
  // array, not an empty array. Drop it explicitly so it can never be miscounted as a real event.
  if (!ev || (!ev.dateandtime && ev.message)) return null;
  const dt = ev.dateandtime || {};
  let start = zohoToISO(dt.start);
  let end = zohoToISO(dt.end);
  let allDay = false;
  if (!start || !end) {
    // All-day: bare yyyyMMdd dates. VERIFY-LIVE: end date assumed EXCLUSIVE (parity with
    // Google/Nylas) — confirm against a real multi-day Zoho all-day event once Julian's account
    // is connected; if Zoho turns out inclusive, the span helper just needs endDate+1 here.
    const sDate = zohoDateOnly(dt.start);
    if (!sDate) return null; // unparseable → skip
    const span = allDaySpan(sDate, zohoDateOnly(dt.end), tz);
    if (!span) return null;
    allDay = true;
    start = span.start;
    end = span.end;
  }

  const orgEmail = String((ev.organizer && (ev.organizer.email || ev.organizer)) || '').toLowerCase();
  const raw = Array.isArray(ev.attendees) ? ev.attendees : [];
  const attendees = raw.map((a) => {
    const email = String(a.email || '').toLowerCase();
    return {
      email: a.email || '',
      displayName: a.dname || a.name || '',
      self: !!selfEmail && email === selfEmail,
      organizer: !!orgEmail && email === orgEmail,
      responseStatus: mapZohoStatus(a.status),
    };
  });
  // Coach is usually the organizer and often absent from attendees — synthesise a 'self' row so
  // isCoachAttending() recognises the coach is in the meeting (parity with mapNylasEvent).
  if (selfEmail && !attendees.some((a) => a.self)) {
    attendees.push({ email: selfEmail, displayName: '', self: true, organizer: orgEmail === selfEmail, responseStatus: 'accepted' });
  }

  return {
    id: ev.uid || ev.id || null,
    summary: ev.title || '(No title)',
    start,
    end,
    ...(allDay ? { allDay: true } : {}),
    location: ev.location || '',
    description: ev.description || '',
    htmlLink: ev.vieweventurl || '',
    conferenceData: null,
    attendees,
  };
}

async function getViaZoho(coach, timeMin, timeMax) {
  try {
    const accessToken = await getZohoAccessToken(coach);
    const { calendarBase } = zohoHosts(coach.calendarProviderDomain);
    const selfEmail = String(coach.googleCalendarEmail || coach.calendarEmail || '').toLowerCase();
    const tz = coach.timezone || null;

    // Read scope: default = the one write calendar (today's behaviour); 'all' = every calendar on
    // the account; explicit uids = those.
    const readIds = parseReadIds(coach);
    let uids;
    if (readIds === 'all') {
      uids = (await listZohoCalendars(coach, accessToken)).map((c) => c.uid).filter(Boolean);
      if (!uids.length) throw new Error('no Zoho calendar found for this account');
    } else if (Array.isArray(readIds)) {
      uids = readIds;
    } else {
      uids = [await getZohoCalendarUid(coach, accessToken)];
    }

    const events = [];
    for (const uid of uids) {
      // Zoho caps the range at 31 days; Wingguy windows are ~2-3 weeks, but chunk defensively.
      const CHUNK_MS = 30 * 86400000;
      let cur = new Date(timeMin).getTime();
      const end = new Date(timeMax).getTime();
      while (cur < end) {
        const chunkEnd = Math.min(cur + CHUNK_MS, end);
        const range = JSON.stringify({ start: isoToZoho(new Date(cur).toISOString()), end: isoToZoho(new Date(chunkEnd).toISOString()) });
        const u = new URL(`${calendarBase}/api/v1/calendars/${encodeURIComponent(uid)}/events`);
        u.searchParams.set('range', range);
        u.searchParams.set('byinstance', 'true'); // expand recurring instances
        const res = await fetch(u.toString(), { headers: zohoAuthHeaders(accessToken) });
        if (!res.ok) return { events: [], error: `zoho HTTP ${res.status} (calendar ${uid}): ${(await res.text()).slice(0, 200)}`, provider: 'zoho' };
        const json = await res.json();
        const list = json.events || json.data || [];
        for (const ev of list) { const m = mapZohoEvent(ev, selfEmail, tz); if (m) events.push({ ...m, calendarId: uid }); }
        cur = chunkEnd;
      }
    }
    return { events: uids.length > 1 ? dedupEvents(events) : events, error: null, provider: 'zoho' };
  } catch (e) {
    return { events: [], error: `zoho read failed: ${e.message}`, provider: 'zoho' };
  }
}

async function createViaZoho(coach, details) {
  try {
    const accessToken = await getZohoAccessToken(coach);
    const uid = await getZohoCalendarUid(coach, accessToken);
    const { calendarBase } = zohoHosts(coach.calendarProviderDomain);
    const guests = (details.attendees || [])
      .filter((a) => a && a.email)
      .map((a) => ({ email: String(a.email).trim(), permission: 2, attendance: 1 }));
    const eventData = {
      title: details.title || 'Meeting',
      dateandtime: { start: isoToZoho(details.startISO), end: isoToZoho(details.endISO) },
      // 1 = email the invite to attendees; 0 = silent (attendee-less utility events / offer HOLDs).
      notify_attendee: details.notifyParticipants === false ? 0 : 1,
    };
    // Zoho rejects an EMPTY attendees array ([1-50] only) — omit the field entirely for guest-less
    // events (offer HOLDs). Only include it when there's at least one guest.
    if (guests.length) eventData.attendees = guests;
    if (details.description) eventData.description = String(details.description).slice(0, 10000);
    if (details.location) eventData.location = String(details.location).slice(0, 255);
    if (details.reminders && Array.isArray(details.reminders.overrides)) {
      eventData.reminders = details.reminders.overrides.map((r) => ({ action: 'email', minutes: r.reminder_minutes }));
    }
    // Zoho takes the event as a URL query param "eventdata" (JSON), not a request body.
    const u = new URL(`${calendarBase}/api/v1/calendars/${encodeURIComponent(uid)}/events`);
    u.searchParams.set('eventdata', JSON.stringify(eventData));
    const res = await fetch(u.toString(), { method: 'POST', headers: zohoAuthHeaders(accessToken) });
    const text = await res.text();
    if (!res.ok) {
      log.warn(`[calendarProvider] zoho create HTTP ${res.status}: ${text.slice(0, 200)}`);
      return { ok: false, error: `zoho HTTP ${res.status}: ${text.slice(0, 200)}`, provider: 'zoho' };
    }
    let json = {}; try { json = JSON.parse(text); } catch (_) { /* leave empty */ }
    const ev = (json.events && json.events[0]) || json.event || json.data || json;
    return { ok: true, eventId: ev.uid || ev.id || null, htmlLink: ev.vieweventurl || '', provider: 'zoho' };
  } catch (e) {
    return { ok: false, error: `zoho create failed: ${e.message}`, provider: 'zoho' };
  }
}

async function deleteViaZoho(coach, eventId) {
  try {
    if (!eventId) return { ok: false, error: 'eventId required', provider: 'zoho' };
    const accessToken = await getZohoAccessToken(coach);
    const uid = await getZohoCalendarUid(coach, accessToken);
    const { calendarBase } = zohoHosts(coach.calendarProviderDomain);
    // VERIFY-LIVE: Zoho DELETE may require the event's etag as a query param; if a live 400/412 shows
    // that, fetch the event for its etag first. Kept simple until tested against a real account.
    const u = new URL(`${calendarBase}/api/v1/calendars/${encodeURIComponent(uid)}/events/${encodeURIComponent(eventId)}`);
    const res = await fetch(u.toString(), { method: 'DELETE', headers: zohoAuthHeaders(accessToken) });
    if (!res.ok) return { ok: false, error: `zoho HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`, provider: 'zoho' };
    return { ok: true, provider: 'zoho' };
  } catch (e) {
    return { ok: false, error: `zoho delete failed: ${e.message}`, provider: 'zoho' };
  }
}

module.exports = {
  getMeetingsInWindow, createCalendarEvent, deleteCalendarEvent, activeProvider, listCalendars,
  mapNylasEvent, mapNylasStatus, mapZohoEvent, mapZohoStatus, zohoToISO, isoToZoho, zohoHosts,
  parseReadIds, dedupEvents, allDaySpan, zohoDateOnly, googleAllDayNormalise,
};
