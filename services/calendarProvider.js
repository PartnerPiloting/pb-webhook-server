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
  const u = new URL(`${apiUri}/v3/grants/${grantId}/events`);
  u.searchParams.set('calendar_id', calendarId);
  u.searchParams.set('start', String(startSec));
  u.searchParams.set('end', String(endSec));
  u.searchParams.set('limit', '50');
  u.searchParams.set('expand_recurring', 'true');

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
  const selfEmail = String(coach.googleCalendarEmail || coach.calendarEmail || '').toLowerCase();
  const events = (json.data || []).map((ev) => mapNylasEvent(ev, selfEmail)).filter(Boolean);
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

module.exports = { getMeetingsInWindow, activeProvider, mapNylasEvent, mapNylasStatus };
