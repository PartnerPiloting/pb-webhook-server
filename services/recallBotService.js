/**
 * Create Recall.ai meeting bots via their API with transcript + diarization settings
 * that match our webhook ingest (routes/recallIngestRoutes.js).
 *
 * Env:
 *   RECALL_API_KEY — required (Recall dashboard → API key). Header: Authorization: Token …
 *   RECALL_API_BASE_URL — optional, default https://us-west-2.recall.ai (pay-as-you-go region)
 *   RECALL_INBOUND_WEBHOOK_BASE — optional, public origin for POST /webhooks/recall (no trailing slash)
 */

const { createSafeLogger } = require('../utils/loggerHelper');

const log = createSafeLogger('SYSTEM', null, 'recall_bot');

function recallApiBase() {
  const raw = (process.env.RECALL_API_BASE_URL || 'https://us-west-2.recall.ai').trim().replace(/\/$/, '');
  return raw;
}

function inboundWebhookBase() {
  const fromEnv = (process.env.RECALL_INBOUND_WEBHOOK_BASE || '').trim().replace(/\/$/, '');
  if (fromEnv) return fromEnv;
  return 'https://pb-webhook-server.onrender.com';
}

/**
 * @param {object} opts
 * @param {string} opts.meetingUrl - Zoom / Google Meet join URL
 * @param {string} [opts.joinAt] - ISO 8601 — schedule bot ≥10 min ahead per Recall guidance
 * @param {'prioritize_accuracy'|'prioritize_low_latency'} [opts.transcriptMode]
 */
async function createRecallBot(opts) {
  const apiKey = (process.env.RECALL_API_KEY || '').trim();
  if (!apiKey) {
    return { ok: false, error: 'RECALL_API_KEY not set on server' };
  }

  const meetingUrl = typeof opts.meetingUrl === 'string' ? opts.meetingUrl.trim() : '';
  if (!meetingUrl || !/^https?:\/\//i.test(meetingUrl)) {
    return { ok: false, error: 'meetingUrl required (https Zoom or Meet link)' };
  }

  const mode = opts.transcriptMode === 'prioritize_low_latency' ? 'prioritize_low_latency' : 'prioritize_accuracy';
  const base = recallApiBase();
  const webhookUrl = `${inboundWebhookBase()}/webhooks/recall`;

  const body = {
    meeting_url: meetingUrl,
    recording_config: {
      transcript: {
        provider: {
          recallai_streaming: { mode },
        },
        diarization: {
          use_separate_streams_when_available: true,
        },
      },
      realtime_endpoints: [
        {
          type: 'webhook',
          url: webhookUrl,
          events: [
            'transcript.data',
            'participant_events.join',
            'participant_events.leave',
          ],
        },
      ],
    },
  };

  if (opts.joinAt && String(opts.joinAt).trim()) {
    body.join_at = String(opts.joinAt).trim();
  }

  const url = `${base}/api/v1/bot/`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Token ${apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
    });

    const text = await res.text();
    let data;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { raw: text };
    }

    if (!res.ok) {
      log.warn(`createRecallBot failed ${res.status}: ${text.slice(0, 500)}`);
      return {
        ok: false,
        status: res.status,
        error: data.detail || data.message || data.error || `Recall API HTTP ${res.status}`,
        recall_response: data,
      };
    }

    log.info(`createRecallBot ok meeting_url host=${new URL(meetingUrl).host}`);
    return {
      ok: true,
      webhook_url_used: webhookUrl,
      transcript_mode: mode,
      perfect_diarization: true,
      recall_response: data,
    };
  } catch (e) {
    log.error(`createRecallBot fetch error: ${e.message}`);
    return { ok: false, error: e.message || 'fetch failed' };
  }
}

/**
 * Retrieve a bot's full data from Recall API, including status_changes.
 * @param {string} botId - UUID of the bot
 * @returns {Promise<{ok: boolean, data?: object, error?: string}>}
 */
async function retrieveRecallBot(botId) {
  const apiKey = (process.env.RECALL_API_KEY || '').trim();
  if (!apiKey) return { ok: false, error: 'RECALL_API_KEY not set' };
  if (!botId) return { ok: false, error: 'botId required' };

  const base = recallApiBase();
  const url = `${base}/api/v1/bot/${botId}/`;

  try {
    const res = await fetch(url, {
      headers: {
        Authorization: `Token ${apiKey}`,
        Accept: 'application/json',
      },
    });
    const text = await res.text();
    let data;
    try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }

    if (!res.ok) {
      log.warn(`retrieveRecallBot failed ${res.status}: ${text.slice(0, 500)}`);
      return { ok: false, status: res.status, error: data.detail || `HTTP ${res.status}` };
    }
    return { ok: true, data };
  } catch (e) {
    log.error(`retrieveRecallBot error: ${e.message}`);
    return { ok: false, error: e.message };
  }
}

/**
 * Extract meeting start/end from a Recall bot's status_changes array.
 * start = first in_call_recording created_at
 * end   = call_ended created_at (or done if no call_ended)
 */
function extractMeetingTimesFromBot(botData) {
  const changes = botData?.status_changes;
  if (!Array.isArray(changes) || changes.length === 0) return { start: null, end: null };

  let start = null;
  let end = null;

  for (const ev of changes) {
    if (ev.code === 'in_call_recording' && !start) {
      start = ev.created_at || null;
    }
    if (ev.code === 'call_ended') {
      end = ev.created_at || null;
    }
  }

  if (!end) {
    const done = changes.find(e => e.code === 'done');
    if (done) end = done.created_at || null;
  }

  return { start, end };
}

module.exports = {
  createRecallBot,
  retrieveRecallBot,
  extractMeetingTimesFromBot,
  recallApiBase,
  inboundWebhookBase,
};
