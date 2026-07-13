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
const { createSafeLogger } = require('../utils/loggerHelper');

const log = createSafeLogger('SYSTEM', null, 'calendar_provider');

function activeProvider(coach) {
  const p = (coach && coach.calendarProvider) || process.env.CALENDAR_PROVIDER || 'google';
  return String(p).trim().toLowerCase();
}

/**
 * @param {object} coach  client record (from clientService.getClientById)
 * @param {Date|string} timeMin
 * @param {Date|string} timeMax
 * @returns {Promise<{events:object[], error:string|null, provider:string}>}
 */
async function getMeetingsInWindow(coach, timeMin, timeMax) {
  const provider = activeProvider(coach);
  if (provider === 'nylas') return getViaNylas(coach, timeMin, timeMax);
  if (provider === 'zoho') return getViaZoho(coach, timeMin, timeMax);
  return getViaGoogle(coach, timeMin, timeMax);
}

/* ---- Google (existing service-account; unchanged behaviour) -------------- */
async function getViaGoogle(coach, timeMin, timeMax) {
  const calEmail = coach.googleCalendarEmail || coach.calendarEmail;
  if (!calEmail) return { events: [], error: 'no google calendar email for coach', provider: 'google' };
  const r = await listCalendarEventsWithAttendeesInRange(calEmail, timeMin, timeMax);
  return { events: r.events || [], error: r.error || null, provider: 'google' };
}

/* ---- Nylas (per-tenant grant; verify against sandbox) -------------------- */
async function getViaNylas(coach, timeMin, timeMax) {
  const apiKey = process.env.NYLAS_API_KEY;
  const grantId = (coach && coach.nylasGrantId) || process.env.NYLAS_GRANT_ID;
  const apiUri = (process.env.NYLAS_API_URI || 'https://api.us.nylas.com').replace(/\/$/, '');
  const calendarId = (coach && coach.nylasCalendarId) || process.env.NYLAS_CALENDAR_ID || 'primary';
  if (!apiKey || !grantId) return { events: [], error: 'NYLAS_API_KEY / grant not configured', provider: 'nylas' };

  const startSec = Math.floor(new Date(timeMin).getTime() / 1000);
  const endSec = Math.floor(new Date(timeMax).getTime() / 1000);
  const selfEmail = String(coach.googleCalendarEmail || coach.calendarEmail || '').toLowerCase();
  const events = [];
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
      return { events: [], error: `nylas HTTP ${res.status}: ${body.slice(0, 200)}`, provider: 'nylas' };
    }
    const json = await res.json();
    events.push(...(json.data || []).map((ev) => mapNylasEvent(ev, selfEmail)).filter(Boolean));
    cursor = json.next_cursor || null;
    if (!cursor) break;
  }
  return { events, error: null, provider: 'nylas' };
}

/** Map one Nylas v3 event into the Google-shaped event the filters expect. */
function mapNylasEvent(ev, selfEmail) {
  const when = ev.when || {};
  const startSec = when.start_time;
  const endSec = when.end_time;
  if (!startSec || !endSec) return null; // only timed events matter for splitting

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

async function getZohoCalendarUid(coach, accessToken) {
  if (coach && coach.calendarUid) return coach.calendarUid;
  const { calendarBase } = zohoHosts(coach.calendarProviderDomain);
  const res = await fetch(`${calendarBase}/api/v1/calendars`, { headers: zohoAuthHeaders(accessToken) });
  if (!res.ok) throw new Error(`Zoho calendars list HTTP ${res.status}: ${(await res.text()).slice(0, 150)}`);
  const json = await res.json();
  const cals = json.calendars || json.data || [];
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

/** Map one Zoho event into the Google-shaped event the filters expect. */
function mapZohoEvent(ev, selfEmail) {
  const dt = ev.dateandtime || {};
  const start = zohoToISO(dt.start);
  const end = zohoToISO(dt.end);
  if (!start || !end) return null; // all-day / unparseable → skip

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
    const uid = await getZohoCalendarUid(coach, accessToken);
    const { calendarBase } = zohoHosts(coach.calendarProviderDomain);
    const selfEmail = String(coach.googleCalendarEmail || coach.calendarEmail || '').toLowerCase();
    const events = [];
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
      if (!res.ok) return { events: [], error: `zoho HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`, provider: 'zoho' };
      const json = await res.json();
      const list = json.events || json.data || [];
      for (const ev of list) { const m = mapZohoEvent(ev, selfEmail); if (m) events.push(m); }
      cur = chunkEnd;
    }
    return { events, error: null, provider: 'zoho' };
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
  getMeetingsInWindow, createCalendarEvent, deleteCalendarEvent, activeProvider,
  mapNylasEvent, mapNylasStatus, mapZohoEvent, mapZohoStatus, zohoToISO, isoToZoho, zohoHosts,
};
