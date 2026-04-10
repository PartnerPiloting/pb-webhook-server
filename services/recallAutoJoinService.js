/**
 * Auto-join: checks coach's Google Calendar every POLL_INTERVAL_MS for
 * upcoming meetings with Zoom / Google Meet / Teams links, then dispatches
 * a Recall bot to join BOT_JOIN_LEAD_MS before the meeting starts.
 *
 * Mimics Fathom-style "always recording" without the coach doing anything.
 */

const { listCalendarEventsWithAttendeesInRange } = require('../config/calendarServiceAccount');
const clientService = require('./clientService');
const { createRecallBot } = require('./recallBotService');
const { createSafeLogger } = require('../utils/loggerHelper');

const log = createSafeLogger('SYSTEM', null, 'recall_auto_join');

const POLL_INTERVAL_MS = 2 * 60 * 1000;
const LOOKAHEAD_MS = 15 * 60 * 1000;
const BOT_JOIN_LEAD_MS = 5 * 60 * 1000;
const DEFAULT_COACH_CLIENT_ID = (process.env.RECALL_COACH_CLIENT_ID || 'Guy-Wilson').trim();

const MEETING_URL_PATTERNS = [
  /https?:\/\/[\w.-]*zoom\.us\/j\/[\w?&=%-]+/i,
  /https?:\/\/meet\.google\.com\/[\w-]+/i,
  /https?:\/\/teams\.microsoft\.com\/l\/meetup-join\/[\w%./+-]+/i,
  /https?:\/\/teams\.live\.com\/meet\/[\w?&=%-]+/i,
];

const scheduledEventIds = new Map();

function normalizeMeetingUrl(url) {
  try {
    const u = new URL(url);
    if (u.hostname.includes('zoom.us')) return `${u.origin}${u.pathname}`;
    return `${u.origin}${u.pathname}`;
  } catch { return url; }
}

function hasActiveBotForUrl(meetingUrl, currentEventStart) {
  const norm = normalizeMeetingUrl(meetingUrl);
  const now = Date.now();
  for (const [, info] of scheduledEventIds) {
    if (info.skipped || !info.ok || !info.meetingUrl) continue;
    if (normalizeMeetingUrl(info.meetingUrl) !== norm) continue;
    if (!info.eventEnd) continue;
    const endMs = new Date(info.eventEnd).getTime();
    const bufferMs = 15 * 60 * 1000;
    if (endMs + bufferMs < now) continue;
    if (currentEventStart) {
      const startMs = new Date(currentEventStart).getTime();
      if (startMs > endMs + bufferMs) continue;
    }
    return true;
  }
  return false;
}

function extractMeetingUrl(event) {
  if (event.conferenceData) {
    const eps = event.conferenceData.entryPoints;
    if (Array.isArray(eps)) {
      for (const ep of eps) {
        if (ep.entryPointType === 'video' && ep.uri) return ep.uri;
      }
    }
  }

  const fields = [event.location || '', event.description || '', event.htmlLink || ''];
  for (const field of fields) {
    for (const rx of MEETING_URL_PATTERNS) {
      const m = field.match(rx);
      if (m) return m[0];
    }
  }
  return null;
}

function cleanupOldEntries() {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  for (const [key, info] of scheduledEventIds) {
    if (info.scheduledAt < cutoff) scheduledEventIds.delete(key);
  }
}

async function checkAndDispatchBots() {
  let calendarEmail = (process.env.RECALL_COACH_CALENDAR_EMAIL || '').trim();

  if (!calendarEmail) {
    try {
      const coach = await clientService.getClientById(DEFAULT_COACH_CLIENT_ID);
      calendarEmail = coach?.googleCalendarEmail || '';
    } catch (e) {
      log.warn(`auto-join: could not get coach calendar email: ${e.message}`);
      return;
    }
  }

  if (!calendarEmail) {
    return;
  }

  const now = new Date();
  const lookbackStart = new Date(now.getTime() - 10 * 60 * 1000);
  const lookaheadEnd = new Date(now.getTime() + LOOKAHEAD_MS);
  const { events, error } = await listCalendarEventsWithAttendeesInRange(calendarEmail, lookbackStart, lookaheadEnd);

  if (error) {
    log.warn(`auto-join: calendar error: ${error}`);
    return;
  }

  if (!events || events.length === 0) {
    log.info(`auto-join: no calendar events in window ${lookbackStart.toISOString()} → ${lookaheadEnd.toISOString()}`);
    return;
  }

  log.info(`auto-join: found ${events.length} event(s) in window: ${events.map(e => `"${e.summary}" at ${e.start}`).join(', ')}`);

  cleanupOldEntries();

  for (const ev of events) {
    const eventKey = ev.eventId || `${ev.summary}_${ev.start}`;
    if (scheduledEventIds.has(eventKey)) continue;

    const meetingUrl = extractMeetingUrl(ev);
    if (!meetingUrl) {
      log.info(`auto-join: no meeting link found for "${ev.summary}" (location="${ev.location?.substring(0,100)}", hasConferenceData=${!!ev.conferenceData})`);
      continue;
    }

    const eventStart = new Date(ev.start);

    if (eventStart.getTime() < now.getTime() - 10 * 60 * 1000) {
      scheduledEventIds.set(eventKey, { scheduledAt: Date.now(), skipped: true, reason: 'started >10min ago' });
      continue;
    }

    if (hasActiveBotForUrl(meetingUrl, ev.start)) {
      log.info(`auto-join: skipping "${ev.summary}" — bot already active on same meeting link (back-to-back)`);
      scheduledEventIds.set(eventKey, { scheduledAt: Date.now(), skipped: true, reason: 'bot already on same link' });
      continue;
    }

    const joinAt = new Date(eventStart.getTime() - BOT_JOIN_LEAD_MS);
    const joinAtIso = joinAt > now ? joinAt.toISOString() : undefined;

    log.info(`auto-join: dispatching bot for "${ev.summary}" at ${ev.start}, join_at=${joinAtIso || 'now'}, url=${meetingUrl}`);

    try {
      const result = await createRecallBot({
        meetingUrl,
        joinAt: joinAtIso,
        meetingTitle: ev.summary,
      });

      scheduledEventIds.set(eventKey, {
        scheduledAt: Date.now(),
        meetingUrl,
        eventEnd: ev.end || null,
        botId: result.recall_response?.id || null,
        ok: result.ok,
        error: result.ok ? null : result.error,
      });

      if (result.ok) {
        log.info(`auto-join: bot created for "${ev.summary}" bot_id=${result.recall_response?.id}`);
      } else {
        log.warn(`auto-join: bot creation failed for "${ev.summary}": ${result.error}`);
      }
    } catch (e) {
      log.error(`auto-join: exception dispatching bot for "${ev.summary}": ${e.message}`);
      scheduledEventIds.set(eventKey, { scheduledAt: Date.now(), error: e.message });
    }
  }
}

let intervalHandle = null;

function startAutoJoin() {
  if (intervalHandle) return;

  const apiKey = (process.env.RECALL_API_KEY || '').trim();
  if (!apiKey) {
    log.info('auto-join: RECALL_API_KEY not set — auto-join disabled');
    return;
  }

  log.info(`auto-join: started (poll every ${POLL_INTERVAL_MS / 1000}s, lookahead ${LOOKAHEAD_MS / 60000}min, join ${BOT_JOIN_LEAD_MS / 60000}min early)`);

  setTimeout(() => checkAndDispatchBots().catch(e => log.error(`auto-join tick error: ${e.message}`)), 5000);

  intervalHandle = setInterval(() => {
    checkAndDispatchBots().catch(e => log.error(`auto-join tick error: ${e.message}`));
  }, POLL_INTERVAL_MS);
}

function stopAutoJoin() {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}

function getAutoJoinStatus() {
  return {
    running: !!intervalHandle,
    pollIntervalMs: POLL_INTERVAL_MS,
    lookaheadMs: LOOKAHEAD_MS,
    botJoinLeadMs: BOT_JOIN_LEAD_MS,
    trackedEvents: scheduledEventIds.size,
    recent: [...scheduledEventIds.entries()].slice(-10).map(([k, v]) => ({ eventKey: k, ...v })),
  };
}

module.exports = {
  startAutoJoin,
  stopAutoJoin,
  checkAndDispatchBots,
  getAutoJoinStatus,
  extractMeetingUrl,
};
