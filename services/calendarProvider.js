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

/* ---- Multi-grant read (2026-07-23) ---------------------------------------------------------------
 * "One client, many grants": a client whose calendars live in DIFFERENT accounts/providers (Julian:
 * Zoho work calendar + iCloud personal calendar) unions FREE/BUSY across all of them for availability,
 * but WRITES bookings to ONE nominated calendar (the PRIMARY — the flat coach fields, unchanged).
 * Extra READ-only sources live in coach.readGrants (from the `Calendar Read Grants` JSON field); each
 * is just another coach-shaped object dispatched through the SAME provider switch. Absent/empty
 * readGrants => the read fans out to nobody => single-provider clients behave EXACTLY as before. Only
 * the read path fans out; createCalendarEvent/deleteCalendarEvent never look at readGrants. */

// The provider switch, factored out so the primary grant AND each extra read-grant share one path.
async function dispatchRead(coach, timeMin, timeMax) {
  const provider = activeProvider(coach);
  if (provider === 'nylas') return getViaNylas(coach, timeMin, timeMax);
  if (provider === 'unipile') return getViaUnipile(coach, timeMin, timeMax);
  if (provider === 'zoho') return getViaZoho(coach, timeMin, timeMax);
  if (provider === 'icloud') return getViaICloud(coach, timeMin, timeMax);
  return getViaGoogle(coach, timeMin, timeMax);
}

// Turn one extra read-grant (a plain object from the `Calendar Read Grants` JSON) into a coach-shaped
// object the provider switch understands. Inherits timezone + self email from the primary coach; each
// getViaX reads only the credential fields its branch needs. NB: no readGrants here — grants don't
// nest (and dispatchRead, not getMeetingsInWindow, runs them, so there's no re-fan-out anyway).
function grantToCoach(grant, base) {
  const g = grant || {};
  return {
    calendarProvider: String(g.provider || '').trim().toLowerCase(),
    timezone: base.timezone,
    googleCalendarEmail: g.selfEmail || base.googleCalendarEmail || base.calendarEmail || '',
    nylasGrantId: g.nylasGrantId || g.grantId || null,
    unipileAccountId: g.unipileAccountId || g.accountId || null,
    calendarProviderToken: g.calendarProviderToken || g.token || null,
    calendarProviderDomain: g.calendarProviderDomain || g.domain || null,
    appleId: g.appleId || null,
    appPassword: g.appPassword || null,
    calendarUrls: g.calendarUrls || null,
    // read scope WITHIN this grant's account ('all' | ids); iCloud uses calendarUrls instead.
    calendarReadIds: g.readIds || g.calendarReadIds || null,
    calendarWriteId: g.calendarWriteId || null,
  };
}

// Parse the `Calendar Read Grants` field (a JSON array of extra read-sources) into an array. Blank /
// invalid / non-array -> [] (today's single-grant behaviour). Never throws — a malformed field must
// degrade to "no extra grants", never break a booking read.
function parseReadGrants(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.filter((g) => g && typeof g === 'object');
  try {
    const v = JSON.parse(String(raw));
    if (Array.isArray(v)) return v.filter((g) => g && typeof g === 'object');
    if (v && typeof v === 'object') return [v];
    return [];
  } catch (_) {
    return [];
  }
}

/**
 * @param {object} coach  client record (from clientService.getClientById). coach.readGrants (optional)
 *   is an array of extra READ-only sources unioned into the busy set (see multi-grant note above).
 * @param {Date|string} timeMin
 * @param {Date|string} timeMax
 * @param {object} [opts] { includeAllDay } — all-day events are DROPPED by default (an all-day
 *   "Leave" marker isn't a 30-min clash, and must never blanket-block a day's slots); only the
 *   read-only listing path opts in to see them.
 * @returns {Promise<{events:object[], error:string|null, provider:string}>}
 */
async function getMeetingsInWindow(coach, timeMin, timeMax, opts = {}) {
  const provider = activeProvider(coach);
  let r = await dispatchRead(coach, timeMin, timeMax);

  // Fan out across any extra read-grants (calendars in OTHER accounts/providers), union + dedup.
  const grants = Array.isArray(coach && coach.readGrants) ? coach.readGrants : [];
  if (grants.length && !r.error) {
    const merged = [...(r.events || [])];
    for (const grant of grants) {
      const gr = await dispatchRead(grantToCoach(grant, coach), timeMin, timeMax);
      // HARD-FAIL on an extra grant's error: silently dropping a busy source risks the exact
      // double-book this feature exists to prevent. Better to refuse to offer times than to offer
      // one over a private appointment we couldn't see.
      if (gr.error) return { events: [], error: `read-grant "${grant.label || grant.provider || 'unknown'}" failed: ${gr.error}`, provider };
      merged.push(...(gr.events || []));
    }
    r = { events: dedupEvents(merged), error: null, provider };
  }

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
    if (provider === 'unipile') {
      const cals = await listUnipileCalendars(coach);
      return { calendars: cals.map((c) => ({ id: c.id, name: c.name || '', isDefault: !!c.is_primary, readOnly: !!c.is_read_only })), error: null, provider };
    }
    if (provider === 'zoho') {
      const accessToken = await getZohoAccessToken(coach);
      const cals = await listZohoCalendars(coach, accessToken);
      return { calendars: cals.map((c) => ({ id: c.uid, name: c.name || '', isDefault: !!c.isdefault, readOnly: false })), error: null, provider };
    }
    if (provider === 'icloud') {
      const cals = await discoverICloudCalendars(coach);
      // The collection URL IS the id that goes into a read-grant's calendarUrls / calendarWriteUrl.
      return { calendars: cals.map((c) => ({ id: c.url, name: c.name || '', isDefault: !!c.isDefault, readOnly: false })), error: null, provider };
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
  if (provider === 'unipile') return createViaUnipile(coach, details);
  if (provider === 'zoho') return createViaZoho(coach, details);
  if (provider === 'icloud') return createViaICloud(coach, details);
  // The Google service account is READ-ONLY (calendar.readonly) — no write path there by design.
  return { ok: false, error: `create-event not supported on provider '${provider}' (Google service account is read-only — use Nylas, Unipile, Zoho or iCloud)`, provider };
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
  if (provider === 'unipile') return deleteViaUnipile(coach, eventId);
  if (provider === 'icloud') return deleteViaICloud(coach, eventId);
  if (provider !== 'nylas') {
    return { ok: false, error: `delete-event not supported on provider '${provider}' (use Nylas, Unipile, Zoho or iCloud)`, provider };
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

/* ---- Unipile (per-tenant account; the Nylas REPLACEMENT — validated live 2026-07-22) ------------
 * Why: Nylas' shared pre-verified Google app (CASA-skip) is enterprise-only; Unipile gives it on
 * standard plans, so tenants connect Google/Outlook (and Zoho/IMAP for mail) through Unipile's
 * audit-cleared doorway. ONE Unipile `account_id` covers BOTH calendar and email for a tenant
 * (stored per-client as coach.unipileAccountId). Platform creds in env: UNIPILE_API_KEY +
 * UNIPILE_DSN (the app's DSN host:port, e.g. "api21.unipile.com:15118").
 * REST base: https://<DSN>/api/v1 ; auth header "X-API-KEY: <key>".
 * PROVEN LIVE 2026-07-22 on Guy's Google account: list calendars, list/read events, create event
 * with an external attendee (invite DELIVERED), delete — all pass. Baked-in gotchas:
 *   - URL-ENCODE the calendar_id (an "@" in a Google primary id 500s the events path otherwise).
 *   - create REQUIRES >=1 attendee; `notify` DEFAULTS FALSE (must set true or invites silently
 *     don't send); the event's description field is `body`, not `description`.
 *   - date_time is wall-clock + IANA `time_zone` (14:00 + Australia/Brisbane stored as +10:00).
 * Event-list filtering CONFIRMED live 2026-07-22: params are `start`/`end` (RFC3339, NO ms — a
 * ".000Z" or epoch is silently ignored and you get UNFILTERED results) + `expand_recurring=true`
 * (else a recurring series returns its original master date, useless as a busy block) + `limit` +
 * `cursor`/`next_cursor`. STILL VERIFY-LIVE: all-day end-date exclusivity; the response_status
 * vocabulary; the create-response event-id path. Dormant until a tenant has calendarProvider=
 * 'unipile', so it ships safely alongside Nylas. */

function unipileEnv(coach) {
  const dsn = String(process.env.UNIPILE_DSN || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
  return {
    apiKey: process.env.UNIPILE_API_KEY,
    base: dsn ? `https://${dsn}/api/v1` : '',
    accountId: (coach && coach.unipileAccountId) || process.env.UNIPILE_ACCOUNT_ID,
    writeCalendarId: (coach && coach.calendarWriteId) || process.env.UNIPILE_CALENDAR_ID || '',
  };
}

function unipileHeaders(apiKey) {
  return { 'X-API-KEY': apiKey, Accept: 'application/json' };
}

// Unipile calendar ids are often email addresses (a Google primary) — encode so an "@" can't break
// the events path (unencoded "@" returned HTTP 500 in the smoke test).
function unipileEventsPath(base, calendarId) {
  return `${base}/calendars/${encodeURIComponent(calendarId)}/events`;
}

// Unipile's start/end filters want RFC3339 WITHOUT milliseconds ("2026-07-22T00:00:00Z"). Date's
// toISOString() emits ".000Z", which the API SILENTLY IGNORES (returns unfiltered) — as does epoch.
function rfc3339(t) {
  return new Date(t).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** All calendars on the Unipile account. Throws on failure. */
async function listUnipileCalendars(coach) {
  const { apiKey, base, accountId } = unipileEnv(coach);
  if (!apiKey || !base || !accountId) throw new Error('UNIPILE_API_KEY / UNIPILE_DSN / account not configured');
  const u = new URL(`${base}/calendars`);
  u.searchParams.set('account_id', accountId);
  const res = await fetch(u.toString(), { headers: unipileHeaders(apiKey) });
  if (!res.ok) throw new Error(`unipile calendars HTTP ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
  const json = await res.json();
  return json.data || json.items || []; // [{ id, name, is_primary, is_read_only, ... }]
}

// The calendar Unipile writes to (and the default read scope): the nominated write id, else the
// account's primary, else the account id (a Google primary calendar id == the account email).
async function unipileWriteCalendarId(coach) {
  const { writeCalendarId, accountId } = unipileEnv(coach);
  if (writeCalendarId) return writeCalendarId;
  try {
    const cals = await listUnipileCalendars(coach);
    const primary = cals.find((c) => c.is_primary) || cals[0];
    if (primary && primary.id) return primary.id;
  } catch (_) { /* fall through to account id */ }
  return accountId;
}

function mapUnipileStatus(s) {
  const v = String(s || '').toLowerCase();
  if (v === 'yes' || v === 'accepted') return 'accepted';
  if (v === 'no' || v === 'declined') return 'declined';
  if (v === 'maybe' || v === 'tentative') return 'tentative';
  return 'needsAction'; // 'noreply' / unknown
}

/** Map one Unipile CalendarEvent into the Google-shaped event the filters expect. */
function mapUnipileEvent(ev, selfEmail, tz) {
  if (!ev) return null;
  const st = ev.start || {};
  const en = ev.end || {};
  let start; let end; let allDay = false;
  if (st.date_time) {
    // date_time carries an offset (e.g. "2026-07-24T14:00:00+10:00") — Date() parses it correctly.
    start = new Date(st.date_time).toISOString();
    end = new Date(en.date_time || st.date_time).toISOString();
  } else if (st.date) {
    // All-day: { date: "YYYY-MM-DD" }. VERIFY-LIVE: end.date assumed EXCLUSIVE (Google passthrough).
    const span = allDaySpan(String(st.date), en.date ? String(en.date) : null, tz);
    if (!span) return null;
    allDay = true; start = span.start; end = span.end;
  } else {
    return null; // no usable time shape
  }

  const orgEmail = String((ev.organizer && ev.organizer.email) || '').toLowerCase();
  const raw = Array.isArray(ev.attendees) ? ev.attendees : [];
  const attendees = raw.map((a) => {
    const email = String(a.email || '').toLowerCase();
    return {
      email: a.email || '',
      displayName: a.display_name || '',
      self: !!selfEmail && email === selfEmail,
      organizer: !!a.is_organizer || (!!orgEmail && email === orgEmail),
      responseStatus: mapUnipileStatus(a.response_status),
    };
  });
  // Coach is usually the organizer and often absent from attendees — synthesise a 'self' row so
  // isCoachAttending() recognises the coach is in the meeting (parity with mapNylasEvent/mapZohoEvent).
  if (selfEmail && !attendees.some((a) => a.self)) {
    attendees.push({ email: selfEmail, displayName: '', self: true, organizer: orgEmail === selfEmail, responseStatus: 'accepted' });
  }

  const confUrl = (ev.conference && ev.conference.url) || '';
  return {
    id: ev.id || null,
    summary: ev.title || '(No title)',
    start,
    end,
    ...(allDay ? { allDay: true } : {}),
    location: confUrl || ev.location || '',
    description: ev.body || '',
    htmlLink: confUrl || '',
    conferenceData: confUrl ? { entryPoints: [{ entryPointType: 'video', uri: confUrl }] } : null,
    attendees,
  };
}

async function getViaUnipile(coach, timeMin, timeMax) {
  const { apiKey, base, accountId } = unipileEnv(coach);
  if (!apiKey || !base || !accountId) return { events: [], error: 'UNIPILE_API_KEY / UNIPILE_DSN / account not configured', provider: 'unipile' };
  try {
    // Read scope: default = the one write calendar (today's behaviour); 'all' = every calendar on the
    // account except read-only subscribed feeds (FYI noise); explicit ids = those.
    const readIds = parseReadIds(coach);
    let calendarIds;
    if (readIds === 'all') {
      calendarIds = (await listUnipileCalendars(coach)).filter((c) => !c.is_read_only).map((c) => c.id);
      if (!calendarIds.length) calendarIds = [await unipileWriteCalendarId(coach)];
    } else if (Array.isArray(readIds)) {
      calendarIds = readIds;
    } else {
      calendarIds = [await unipileWriteCalendarId(coach)];
    }

    const selfEmail = String(coach.googleCalendarEmail || coach.calendarEmail || '').toLowerCase();
    const tz = coach.timezone || null;
    const events = [];
    for (const calendarId of calendarIds) {
      // Params CONFIRMED live 2026-07-22: start/end (RFC3339 no-ms) + expand_recurring (else a
      // recurring series returns its ORIGINAL master date, useless as a busy block) + limit + cursor.
      let cursor = null;
      for (let page = 0; page < 10; page++) {
        const u = new URL(unipileEventsPath(base, calendarId));
        u.searchParams.set('account_id', accountId);
        u.searchParams.set('start', rfc3339(timeMin));
        u.searchParams.set('end', rfc3339(timeMax));
        u.searchParams.set('expand_recurring', 'true');
        u.searchParams.set('limit', '300');
        if (cursor) u.searchParams.set('cursor', cursor);
        const res = await fetch(u.toString(), { headers: unipileHeaders(apiKey) });
        if (!res.ok) return { events: [], error: `unipile HTTP ${res.status} (calendar ${calendarId}): ${(await res.text().catch(() => '')).slice(0, 200)}`, provider: 'unipile' };
        const json = await res.json();
        const list = json.data || json.items || [];
        for (const ev of list) { const m = mapUnipileEvent(ev, selfEmail, tz); if (m) events.push({ ...m, calendarId }); }
        cursor = json.next_cursor || json.cursor || null;
        if (!cursor) break;
      }
    }
    return { events: calendarIds.length > 1 ? dedupEvents(events) : events, error: null, provider: 'unipile' };
  } catch (e) {
    return { events: [], error: `unipile read failed: ${e.message}`, provider: 'unipile' };
  }
}

async function createViaUnipile(coach, details) {
  const { apiKey, base, accountId } = unipileEnv(coach);
  if (!apiKey || !base || !accountId) return { ok: false, error: 'UNIPILE_API_KEY / UNIPILE_DSN / account not configured', provider: 'unipile' };
  try {
    const calendarId = await unipileWriteCalendarId(coach);
    const tz = coach.timezone || 'UTC';
    // Unipile wants wall-clock date_time + IANA time_zone (proven: 14:00 + Brisbane -> +10:00).
    const toWall = (iso) => DateTime.fromISO(iso, { zone: 'utc' }).setZone(tz).toFormat("yyyy-MM-dd'T'HH:mm:ss");
    let attendees = (details.attendees || []).filter((a) => a && a.email).map((a) => ({ email: String(a.email).trim() }));
    let notify = details.notifyParticipants === false ? false : true;
    // Unipile REQUIRES >=1 attendee (unlike Nylas/Zoho, which allow guest-less HOLDs). For an
    // attendee-less utility event (offer HOLD) add the coach's own address and force notify off so
    // nobody is emailed. VERIFY-LIVE: confirm a self-only HOLD doesn't notify the coach.
    const selfEmail = String(coach.googleCalendarEmail || coach.calendarEmail || '').trim();
    if (!attendees.length) {
      if (selfEmail) attendees = [{ email: selfEmail }];
      notify = false;
    }
    if (!attendees.length) return { ok: false, error: 'unipile create needs at least one attendee (no guest and no coach email to self-invite)', provider: 'unipile' };

    const body = {
      title: details.title || 'Meeting',
      body: details.description || '',
      start: { date_time: toWall(details.startISO), time_zone: tz },
      end: { date_time: toWall(details.endISO), time_zone: tz },
      attendees,
      notify,
    };
    if (details.location) body.location = String(details.location);

    const u = new URL(unipileEventsPath(base, calendarId));
    u.searchParams.set('account_id', accountId);
    let res;
    try {
      res = await fetch(u.toString(), {
        method: 'POST',
        headers: { ...unipileHeaders(apiKey), 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (e) {
      return { ok: false, error: `unipile request failed: ${e.message}`, provider: 'unipile' };
    }
    const text = await res.text();
    if (!res.ok) {
      log.warn(`[calendarProvider] unipile create HTTP ${res.status}: ${text.slice(0, 200)}`);
      return { ok: false, error: `unipile HTTP ${res.status}: ${text.slice(0, 200)}`, provider: 'unipile' };
    }
    let json = {}; try { json = JSON.parse(text); } catch (_) { /* leave empty */ }
    // Create returns { object: 'CalendarEventCreated', event_id: '...' }.
    return { ok: true, eventId: json.event_id || (json.data && json.data.event_id) || null, htmlLink: '', provider: 'unipile' };
  } catch (e) {
    return { ok: false, error: `unipile create failed: ${e.message}`, provider: 'unipile' };
  }
}

async function deleteViaUnipile(coach, eventId) {
  const { apiKey, base, accountId } = unipileEnv(coach);
  if (!apiKey || !base || !accountId) return { ok: false, error: 'UNIPILE_API_KEY / UNIPILE_DSN / account not configured', provider: 'unipile' };
  if (!eventId) return { ok: false, error: 'eventId required', provider: 'unipile' };
  try {
    const calendarId = await unipileWriteCalendarId(coach);
    const u = new URL(`${unipileEventsPath(base, calendarId)}/${encodeURIComponent(eventId)}`);
    u.searchParams.set('account_id', accountId);
    const res = await fetch(u.toString(), { method: 'DELETE', headers: unipileHeaders(apiKey) });
    if (!res.ok) return { ok: false, error: `unipile HTTP ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`, provider: 'unipile' };
    return { ok: true, provider: 'unipile' };
  } catch (e) {
    return { ok: false, error: `unipile delete failed: ${e.message}`, provider: 'unipile' };
  }
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
      // Zoho caps the range at 31 days; Wingguy windows are ~7 weeks (DAYS_TO_SCAN), so chunk defensively.
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

/* ---- iCloud / Apple Calendar (CalDAV; no OAuth — app-specific password) -------------------------
 * Apple offers NO OAuth for calendar, so a tenant connects by generating an APP-SPECIFIC PASSWORD at
 * appleid.apple.com (requires 2FA) — same friction class as Zoho's app password. We talk raw CalDAV
 * at caldav.icloud.com with HTTP Basic (Apple ID + app-specific password). Neither Unipile nor Nylas
 * can serve iCloud CALENDAR, so this is a custom adapter like Zoho.
 *
 * Creds live on the coach object (so it works both as a client's PRIMARY provider AND — the near-term
 * use — as an extra READ-GRANT in coach.readGrants for a Zoho-primary client like Julian):
 *   coach.appleId          Apple ID (email)
 *   coach.appPassword      app-specific password
 *   coach.calendarUrls     array of calendar-collection URLs to READ (resolve once with
 *                          scripts/wingguy-icloud-discover.js), or the string 'all' to discover live
 *   coach.calendarWriteUrl the ONE collection URL to PUT bookings into (write); defaults to the first
 *                          calendarUrls entry
 *
 * READ = a CalDAV REPORT calendar-query with a VEVENT time-range and SERVER-SIDE <C:expand> so iCloud
 * pre-expands recurring instances (we don't hand-roll RRULE). VEVENT text is parsed with ical.js,
 * required LAZILY (loadICAL) so a missing dep can only break the iCloud path, never the seam's boot.
 * WRITE = PUT a VCALENDAR/VEVENT resource; iCloud does the iTIP scheduling (attendee invites) itself.
 *
 * VERIFY-LIVE (NOTHING here is proven against a real Apple account yet — dormant until a coach carries
 * iCloud creds): (a) the discovery host/redirect flow (iCloud 301s to a per-user partition host — we
 * follow redirects manually to preserve the PROPFIND/REPORT method + body); (b) that <C:expand> is
 * accepted and instances return in UTC; (c) all-day end-date exclusivity; (d) the DECISIVE write
 * question — does a PUT with ATTENDEE lines actually EMAIL the invite (server-side scheduling), the
 * same trap as Unipile's notify-defaults-false; (e) that DELETE needs no If-Match/etag. Probe write
 * with scripts/wingguy-icloud-write-probe.js on a real account (create + immediately delete). */

const ICLOUD_CALDAV_ROOT = 'https://caldav.icloud.com';

// ical.js is required lazily: a missing module then degrades ONLY the iCloud path (returns a clean
// error) instead of throwing at require-time and taking down the whole calendar seam for everyone.
function loadICAL() {
  try { return require('ical.js'); } catch (_) {
    throw new Error('ical.js not installed (iCloud calendar parsing needs it) — run `npm install`');
  }
}

function icloudCreds(coach) {
  const appleId = (coach && coach.appleId) || process.env.ICLOUD_APPLE_ID || '';
  const appPassword = (coach && coach.appPassword) || process.env.ICLOUD_APP_PASSWORD || '';
  const authHeader = appleId && appPassword
    ? `Basic ${Buffer.from(`${appleId}:${appPassword}`).toString('base64')}`
    : '';
  const raw = coach && coach.calendarUrls;
  let readUrls = null; // array of collection URLs, or the string 'all', or null
  if (Array.isArray(raw)) readUrls = raw.filter(Boolean);
  else if (typeof raw === 'string' && /^all$/i.test(raw.trim())) readUrls = 'all';
  else if (typeof raw === 'string' && raw.trim()) readUrls = raw.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
  const writeUrl = (coach && coach.calendarWriteUrl) || (Array.isArray(readUrls) && readUrls[0]) || '';
  return { appleId, appPassword, authHeader, readUrls, writeUrl };
}

// One CalDAV call. Redirects are followed MANUALLY (redirect:'manual') so the method + body + auth
// survive iCloud's 301/308 to a per-user partition host — auto-follow can drop the body or downgrade
// PROPFIND/REPORT to GET.
async function caldavRequest(method, url, authHeader, { depth, body, headers } = {}) {
  let current = url;
  for (let hop = 0; hop < 6; hop++) {
    const h = { Authorization: authHeader, ...(headers || {}) };
    if (depth != null) h.Depth = String(depth);
    if (body != null && !h['Content-Type']) h['Content-Type'] = 'application/xml; charset=utf-8';
    const res = await fetch(current, { method, headers: h, body, redirect: 'manual' });
    if ([301, 302, 307, 308].includes(res.status)) {
      const loc = res.headers.get('location');
      if (!loc) return res;
      current = new URL(loc, current).toString();
      continue;
    }
    return res;
  }
  throw new Error(`too many CalDAV redirects for ${url}`);
}

// Minimal XML entity unescape for the iCalendar text carried inside <calendar-data> (&amp; last).
function xmlUnescape(s) {
  return String(s || '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d))
    .replace(/&amp;/g, '&');
}

// Pull every <calendar-data> payload (any namespace prefix) out of a CalDAV multistatus body.
function extractCalendarData(xml) {
  const out = [];
  const re = /<[\w-]*:?calendar-data[^>]*>([\s\S]*?)<\/[\w-]*:?calendar-data>/gi;
  let m;
  while ((m = re.exec(xml)) !== null) { const t = xmlUnescape(m[1]).trim(); if (t) out.push(t); }
  return out;
}

// Pull <href> values out of a multistatus body (discovery).
function extractHrefs(xml) {
  const out = [];
  const re = /<[\w-]*:?href[^>]*>([\s\S]*?)<\/[\w-]*:?href>/gi;
  let m;
  while ((m = re.exec(xml)) !== null) { const t = xmlUnescape(m[1]).trim(); if (t) out.push(t); }
  return out;
}

function mapICloudStatus(s) {
  const v = String(s || '').toUpperCase();
  if (v === 'ACCEPTED') return 'accepted';
  if (v === 'DECLINED') return 'declined';
  if (v === 'TENTATIVE') return 'tentative';
  return 'needsAction'; // NEEDS-ACTION / unknown
}

const icloudMailto = (v) => String(v || '').replace(/^mailto:/i, '').trim();

/** Map one iCloud VEVENT (an ICAL.Component) into the Google-shaped event the filters expect. */
function mapICloudEvent(ve, selfEmail, tz) {
  if (!ve) return null;
  const ICAL = loadICAL();
  let ev;
  try { ev = new ICAL.Event(ve); } catch (_) { return null; }
  let start; let end; let allDay = false;
  try {
    if (ev.startDate && ev.startDate.isDate) {
      // All-day: DTSTART;VALUE=DATE. Use the date COMPONENTS with the coach's tz — toJSDate() would
      // read a floating date in the server's local zone and smear the day. end assumed EXCLUSIVE.
      const sd = ev.startDate; const ed = ev.endDate;
      const p = (n) => String(n).padStart(2, '0');
      const sStr = `${sd.year}-${p(sd.month)}-${p(sd.day)}`;
      const eStr = ed ? `${ed.year}-${p(ed.month)}-${p(ed.day)}` : null;
      const span = allDaySpan(sStr, eStr, tz);
      if (!span) return null;
      allDay = true; start = span.start; end = span.end;
    } else if (ev.startDate) {
      start = ev.startDate.toJSDate().toISOString();
      end = (ev.endDate || ev.startDate).toJSDate().toISOString();
    } else {
      return null;
    }
  } catch (_) { return null; }

  const orgProp = ve.getFirstProperty('organizer');
  const orgEmail = orgProp ? icloudMailto(orgProp.getFirstValue()).toLowerCase() : '';
  const attendees = ve.getAllProperties('attendee').map((p) => {
    const email = icloudMailto(p.getFirstValue());
    const el = email.toLowerCase();
    return {
      email,
      displayName: p.getParameter('cn') || '',
      self: !!selfEmail && el === selfEmail,
      organizer: !!orgEmail && el === orgEmail,
      responseStatus: mapICloudStatus(p.getParameter('partstat')),
    };
  });
  // Coach is usually the organizer and often absent from attendees — synthesise a 'self' row so
  // isCoachAttending() recognises the coach is in the meeting (parity with the other mappers).
  if (selfEmail && !attendees.some((a) => a.self)) {
    attendees.push({ email: selfEmail, displayName: '', self: true, organizer: orgEmail === selfEmail, responseStatus: 'accepted' });
  }

  return {
    id: ev.uid || null,
    summary: ev.summary || '(No title)',
    start,
    end,
    ...(allDay ? { allDay: true } : {}),
    location: ev.location || '',
    description: ev.description || '',
    htmlLink: '',
    conferenceData: null,
    attendees,
  };
}

// Parse every VEVENT out of one iCalendar text into canonical events. Never throws (bad payload -> []).
function parseICloudVEvents(icsText, selfEmail, tz) {
  const ICAL = loadICAL();
  let comp;
  try { comp = new ICAL.Component(ICAL.parse(icsText)); } catch (_) { return []; }
  return comp.getAllSubcomponents('vevent').map((ve) => mapICloudEvent(ve, selfEmail, tz)).filter(Boolean);
}

// CalDAV time-range wants UTC basic format yyyymmddTHHMMSSZ — identical to Zoho's, so reuse isoToZoho.
function icloudReportBody(start, end) {
  return `<?xml version="1.0" encoding="utf-8"?>
<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop><d:getetag/><c:calendar-data><c:expand start="${start}" end="${end}"/></c:calendar-data></d:prop>
  <c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT">
    <c:time-range start="${start}" end="${end}"/>
  </c:comp-filter></c:comp-filter></c:filter>
</c:calendar-query>`;
}

/**
 * Resolve the calendar collections on an iCloud account (principal -> calendar-home-set -> collections).
 * Returns [{ url, name, isDefault }]. Throws on failure. Used by the setup step (listCalendars) and by
 * getViaICloud only when calendarUrls === 'all'.
 */
async function discoverICloudCalendars(coach) {
  const { authHeader } = icloudCreds(coach);
  if (!authHeader) throw new Error('iCloud appleId / appPassword not configured');

  // 1) current-user-principal
  const principalBody = '<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:"><d:prop><d:current-user-principal/></d:prop></d:propfind>';
  let res = await caldavRequest('PROPFIND', `${ICLOUD_CALDAV_ROOT}/`, authHeader, { depth: 0, body: principalBody });
  if (!res.ok) throw new Error(`iCloud principal PROPFIND HTTP ${res.status}: ${(await res.text().catch(() => '')).slice(0, 150)}`);
  const principalHref = extractHrefs(await res.text())[0];
  if (!principalHref) throw new Error('iCloud: no current-user-principal href returned');
  const principalUrl = new URL(principalHref, ICLOUD_CALDAV_ROOT).toString();

  // 2) calendar-home-set
  const homeBody = '<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><c:calendar-home-set/></d:prop></d:propfind>';
  res = await caldavRequest('PROPFIND', principalUrl, authHeader, { depth: 0, body: homeBody });
  if (!res.ok) throw new Error(`iCloud calendar-home PROPFIND HTTP ${res.status}`);
  const homeHref = extractHrefs(await res.text())[0];
  if (!homeHref) throw new Error('iCloud: no calendar-home-set href returned');
  const homeUrl = new URL(homeHref, principalUrl).toString();

  // 3) list the collections under the home (Depth 1); keep only VEVENT-capable calendar collections.
  const listBody = '<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><d:resourcetype/><d:displayname/><c:supported-calendar-component-set/></d:prop></d:propfind>';
  res = await caldavRequest('PROPFIND', homeUrl, authHeader, { depth: 1, body: listBody });
  if (!res.ok) throw new Error(`iCloud calendar list PROPFIND HTTP ${res.status}`);
  return parseICloudCalendarList(await res.text(), homeUrl);
}

function parseICloudCalendarList(xml, baseUrl) {
  const blocks = xml.split(/<[\w-]*:?response[\s>]/i).slice(1);
  const cals = [];
  for (const b of blocks) {
    const href = extractHrefs(b)[0];
    if (!href) continue;
    const rt = /<[\w-]*:?resourcetype[^>]*>([\s\S]*?)<\/[\w-]*:?resourcetype>/i.exec(b);
    if (!rt || !/<[\w-]*:?calendar[\s/>]/i.test(rt[1])) continue; // must be a calendar collection
    const comp = /supported-calendar-component-set[\s\S]*?<\/[\w-]*:?supported-calendar-component-set>/i.exec(b);
    if (comp && !/name="VEVENT"/i.test(comp[0])) continue; // skip VTODO-only (Reminders) collections
    const nameM = /<[\w-]*:?displayname[^>]*>([\s\S]*?)<\/[\w-]*:?displayname>/i.exec(b);
    cals.push({ url: new URL(href, baseUrl).toString(), name: nameM ? xmlUnescape(nameM[1]).trim() : '', isDefault: false });
  }
  return cals;
}

async function getViaICloud(coach, timeMin, timeMax) {
  const { authHeader, readUrls } = icloudCreds(coach);
  if (!authHeader) return { events: [], error: 'iCloud appleId / appPassword not configured', provider: 'icloud' };
  try {
    let urls = readUrls;
    if (urls === 'all') urls = (await discoverICloudCalendars(coach)).map((c) => c.url);
    if (!urls || !urls.length) {
      return { events: [], error: 'iCloud: no calendar URLs configured (set calendarUrls, or "all"; resolve with scripts/wingguy-icloud-discover.js)', provider: 'icloud' };
    }
    const selfEmail = String(coach.googleCalendarEmail || coach.calendarEmail || coach.appleId || '').toLowerCase();
    const tz = coach.timezone || null;
    const start = isoToZoho(new Date(timeMin).toISOString());
    const end = isoToZoho(new Date(timeMax).toISOString());
    const body = icloudReportBody(start, end);
    const events = [];
    for (const url of urls) {
      const res = await caldavRequest('REPORT', url, authHeader, { depth: 1, body });
      if (!res.ok) return { events: [], error: `iCloud REPORT HTTP ${res.status} (${url}): ${(await res.text().catch(() => '')).slice(0, 200)}`, provider: 'icloud' };
      const xml = await res.text();
      for (const ics of extractCalendarData(xml)) {
        for (const m of parseICloudVEvents(ics, selfEmail, tz)) events.push({ ...m, calendarId: url });
      }
    }
    return { events: urls.length > 1 ? dedupEvents(events) : events, error: null, provider: 'icloud' };
  } catch (e) {
    return { events: [], error: `iCloud read failed: ${e.message}`, provider: 'icloud' };
  }
}

// The resource href for an event we created: {collection}/{uid}.ics (we choose the href on PUT, so
// delete can reconstruct it deterministically from the uid).
function icloudEventHref(writeUrl, uid) {
  return `${String(writeUrl).replace(/\/$/, '')}/${encodeURIComponent(uid)}.ics`;
}

async function createViaICloud(coach, details) {
  const { authHeader, writeUrl, appleId } = icloudCreds(coach);
  if (!authHeader) return { ok: false, error: 'iCloud appleId / appPassword not configured', provider: 'icloud' };
  if (!writeUrl) return { ok: false, error: 'iCloud: no calendarWriteUrl configured (which collection to book into)', provider: 'icloud' };
  try {
    const ICAL = loadICAL();
    const startD = new Date(details.startISO);
    const endD = new Date(details.endISO);
    if (isNaN(startD.getTime()) || isNaN(endD.getTime()) || endD <= startD) return { ok: false, error: 'invalid start/end time', provider: 'icloud' };
    const uid = details.uid || `wingguy-${startD.getTime()}-${require('crypto').randomUUID()}`;

    const vcal = new ICAL.Component(['vcalendar', [], []]);
    vcal.updatePropertyWithValue('prodid', '-//Wingguy//Calendar//EN');
    vcal.updatePropertyWithValue('version', '2.0');
    const vevent = new ICAL.Component('vevent');
    vcal.addSubcomponent(vevent);
    const ev = new ICAL.Event(vevent);
    ev.uid = uid;
    ev.summary = details.title || 'Meeting';
    if (details.description) ev.description = details.description;
    if (details.location) ev.location = details.location;
    ev.startDate = ICAL.Time.fromJSDate(startD, true); // true = UTC
    ev.endDate = ICAL.Time.fromJSDate(endD, true);
    vevent.updatePropertyWithValue('dtstamp', ICAL.Time.fromJSDate(new Date(), true));

    // Organizer = the iCloud account owner; attendee lines drive iCloud's server-side iTIP invites.
    // Attendee-less utility events (offer HOLDs) get no ORGANIZER/ATTENDEE, so nobody is emailed.
    const organizerEmail = String(coach.googleCalendarEmail || coach.calendarEmail || appleId || '').trim();
    const guests = (details.attendees || []).filter((a) => a && a.email);
    const notify = details.notifyParticipants !== false;
    if (notify && guests.length && organizerEmail) {
      vevent.addPropertyWithValue('organizer', `mailto:${organizerEmail}`).setParameter('cn', 'Wingguy');
      for (const g of guests) {
        const at = vevent.addPropertyWithValue('attendee', `mailto:${String(g.email).trim()}`);
        at.setParameter('role', 'REQ-PARTICIPANT');
        at.setParameter('partstat', 'NEEDS-ACTION');
        at.setParameter('rsvp', 'TRUE');
        if (g.name) at.setParameter('cn', g.name);
      }
    }

    const res = await caldavRequest('PUT', icloudEventHref(writeUrl, uid), authHeader, {
      headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'If-None-Match': '*' },
      body: vcal.toString(),
    });
    if (!res.ok) {
      log.warn(`[calendarProvider] iCloud PUT HTTP ${res.status}`);
      return { ok: false, error: `iCloud PUT HTTP ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`, provider: 'icloud' };
    }
    return { ok: true, eventId: uid, htmlLink: '', provider: 'icloud' };
  } catch (e) {
    return { ok: false, error: `iCloud create failed: ${e.message}`, provider: 'icloud' };
  }
}

async function deleteViaICloud(coach, eventId) {
  const { authHeader, writeUrl } = icloudCreds(coach);
  if (!authHeader) return { ok: false, error: 'iCloud appleId / appPassword not configured', provider: 'icloud' };
  if (!writeUrl) return { ok: false, error: 'iCloud: no calendarWriteUrl configured', provider: 'icloud' };
  if (!eventId) return { ok: false, error: 'eventId required', provider: 'icloud' };
  try {
    // eventId is the uid we set on create; accept a full href too (defensive).
    const href = String(eventId).startsWith('http') ? String(eventId) : icloudEventHref(writeUrl, eventId);
    const res = await caldavRequest('DELETE', href, authHeader, {});
    if (!res.ok && res.status !== 404) return { ok: false, error: `iCloud DELETE HTTP ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`, provider: 'icloud' };
    return { ok: true, provider: 'icloud' };
  } catch (e) {
    return { ok: false, error: `iCloud delete failed: ${e.message}`, provider: 'icloud' };
  }
}

module.exports = {
  getMeetingsInWindow, createCalendarEvent, deleteCalendarEvent, activeProvider, listCalendars,
  mapNylasEvent, mapNylasStatus, mapUnipileEvent, mapUnipileStatus, listUnipileCalendars,
  mapZohoEvent, mapZohoStatus, zohoToISO, isoToZoho, zohoHosts,
  mapICloudEvent, mapICloudStatus, parseICloudVEvents, discoverICloudCalendars,
  parseReadIds, parseReadGrants, grantToCoach, dedupEvents, allDaySpan, zohoDateOnly, googleAllDayNormalise,
};
