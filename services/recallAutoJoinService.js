/**
 * Auto-join: checks coach's Google Calendar every POLL_INTERVAL_MS for
 * upcoming meetings with Zoom / Google Meet / Teams links, then dispatches
 * a Recall bot to join BOT_JOIN_LEAD_MS before the meeting starts.
 *
 * Mimics Fathom-style "always recording" without the coach doing anything.
 */

const { listCalendarEventsWithAttendeesInRange } = require('../config/calendarServiceAccount');
const clientService = require('./clientService');
const { createRecallBot, leaveBot } = require('./recallBotService');
const { createSafeLogger } = require('../utils/loggerHelper');
const { sendMailgunEmail } = require('./emailNotificationService');

const log = createSafeLogger('SYSTEM', null, 'recall_auto_join');

const ALERT_EMAIL = process.env.ALERT_EMAIL || 'guyralphwilson@gmail.com';
const ALERT_COOLDOWN_MS = 24 * 60 * 60 * 1000;
let lastCreditAlertAt = 0;

async function sendCreditBalanceAlert(meetingTitle) {
  const now = Date.now();
  if (now - lastCreditAlertAt < ALERT_COOLDOWN_MS) return;
  lastCreditAlertAt = now;
  try {
    const from = process.env.FROM_EMAIL || `noreply@${process.env.MAILGUN_DOMAIN}`;
    await sendMailgunEmail({
      from,
      to: ALERT_EMAIL,
      subject: '⚠️ Recall.ai credit balance is empty — bot did not join meeting',
      text: [
        `Your Recall.ai credit balance has run out.`,
        ``,
        `The bot could not join: "${meetingTitle}"`,
        ``,
        `To fix: go to https://ap-northeast-1.recall.ai/dashboard/billing/payment-method and do a one-time top-up.`,
        ``,
        `This alert will not repeat for 24 hours.`,
      ].join('\n'),
    });
    log.info('auto-join: sent credit balance alert email');
  } catch (e) {
    log.warn(`auto-join: failed to send credit alert email: ${e.message}`);
  }
}

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
    if (info.botDone) continue;
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

function markBotDone(botId) {
  if (!botId) return false;
  for (const [, info] of scheduledEventIds) {
    if (info.botId === botId) {
      info.botDone = true;
      log.info(`auto-join: bot ${botId} marked done — link freed for new meetings`);
      return true;
    }
  }
  return false;
}

/**
 * Before dispatching a bot for `meetingUrl`, evict any prior bot we tracked at the same URL
 * whose calendar event has already ended (by `cutoffIso` — typically the new event's start).
 *
 * This prevents the duplicate-bot scenario: prior bot stays in a shared Zoom (e.g. PMR) past
 * its calendar end because new participants joined for the next call, never sends `bot.done`,
 * and the new bot ends up in the same room alongside it.
 */
async function evictStaleBotsOnUrl(meetingUrl, cutoffIso) {
  const norm = normalizeMeetingUrl(meetingUrl);
  const cutoffMs = cutoffIso ? new Date(cutoffIso).getTime() : Date.now();
  const effectiveCutoff = Number.isFinite(cutoffMs) ? Math.max(cutoffMs, Date.now()) : Date.now();

  for (const [, info] of scheduledEventIds) {
    if (!info.botId || !info.ok || info.botDone) continue;
    if (!info.meetingUrl) continue;
    if (normalizeMeetingUrl(info.meetingUrl) !== norm) continue;
    if (!info.eventEnd) continue;
    const priorEndMs = new Date(info.eventEnd).getTime();
    if (!Number.isFinite(priorEndMs)) continue;
    if (priorEndMs > effectiveCutoff) continue; // prior event still ongoing

    log.info(`auto-join: evicting prior bot ${info.botId} (event ended ${info.eventEnd}) before dispatching new bot for ${meetingUrl}`);
    try {
      const out = await leaveBot(info.botId);
      if (out.ok) {
        info.botDone = true; // bot.done webhook will follow shortly; mark optimistically
      } else {
        log.warn(`auto-join: leaveBot returned ${out.status || ''} ${out.error || ''} for ${info.botId}`);
      }
    } catch (e) {
      log.warn(`auto-join: evict prior bot ${info.botId} threw: ${e.message}`);
    }
  }
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
    const cached = scheduledEventIds.get(eventKey);
    // Re-evaluate events previously skipped only because a prior bot was on the same link —
    // that bot may have finished by now (markBotDone via bot.done webhook).
    const isStaleBackToBackSkip = cached?.skipped && cached.reason === 'bot already on same link';
    if (cached && !isStaleBackToBackSkip) continue;

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

    // Evict any ghost bot lingering at this URL from a prior calendar event (e.g. PMR back-to-back
    // where the prior bot never received bot.done because Dean joined right as it was about to leave).
    await evictStaleBotsOnUrl(meetingUrl, ev.start);

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
        if ((result.error || '').toLowerCase().includes('insufficient credit')) {
          await sendCreditBalanceAlert(ev.summary);
        }
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
  markBotDone,
};
