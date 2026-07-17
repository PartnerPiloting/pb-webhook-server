/**
 * Fathom poll trigger — STEP 3 of the Recall -> Fathom migration ("the trigger").
 *
 * Periodically lists the coach's recent Fathom meetings and ingests any that aren't already
 * filed, by calling services/fathomIngestService.ingestFathomMeeting (which itself handles
 * single-vs-split, lead matching, and the FATHOM_INGEST_ENABLED write gate). This is the
 * lean-poll MVP; a Fathom "new meeting content ready" webhook can replace the timer later
 * without touching the ingest path.
 *
 * THREE independent safety gates:
 *   - FATHOM_POLL_ENABLED   — does the poll loop run at all (default OFF; mirrors RECALL_AUTO_JOIN).
 *   - FATHOM_INGEST_ENABLED — does an ingest actually WRITE (enforced inside fathomIngestService).
 *   - FATHOM_LIVE_FROM       — ISO cutoff; only meetings at/after this are eligible (so we never
 *                              backfill ancient history, and the "loud fallback" read flag has a
 *                              matching boundary). Default: ingest nothing until it's set.
 *
 * Dedup: each candidate is skipped if recallWebhookDb.fathomRecordingIngested(recording_id) is
 * true, so re-polling never double-files. (Split recordings file several rows under one id; any
 * one row counts as done.)
 *
 * ADDITIVE + SAFE: nothing imports this unless index.js starts it; default OFF; in-process timer
 * mirrors the proven Recall auto-join poller. The Recall path is untouched.
 */

const clientService = require('./clientService');
const { ingestFathomMeeting } = require('./fathomIngestService');
const { fathomRecordingIngested } = require('./recallWebhookDb');
const { createSafeLogger } = require('../utils/loggerHelper');

const log = createSafeLogger('SYSTEM', null, 'fathom_poll');

const FATHOM_API_BASE = 'https://api.fathom.ai/external/v1';
const DEFAULT_COACH_CLIENT_ID = (process.env.RECALL_COACH_CLIENT_ID || 'Guy-Wilson').trim();
const POLL_INTERVAL_MS = Number(process.env.FATHOM_POLL_INTERVAL_MS) || 15 * 60 * 1000; // 15 min

let intervalHandle = null;
let lastRun = null;
let lastResult = null;

function pollEnabled() {
  const v = String(process.env.FATHOM_POLL_ENABLED || '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

/** ISO cutoff (FATHOM_LIVE_FROM). Returns ms, or null if unset/invalid (=> ingest nothing). */
function liveFromMs() {
  const raw = String(process.env.FATHOM_LIVE_FROM || '').trim();
  if (!raw) return null;
  const ms = Date.parse(raw);
  return Number.isNaN(ms) ? null : ms;
}

function meetingStartMs(m) {
  const t = m.recording_start_time || m.scheduled_start_time || m.created_at;
  const ms = t ? Date.parse(t) : NaN;
  return Number.isNaN(ms) ? null : ms;
}

/** List recent Fathom meetings for the coach (newest first). */
async function listRecentMeetings(apiKey, limit = 25) {
  const u = new URL(`${FATHOM_API_BASE}/meetings`);
  u.searchParams.set('limit', String(limit));
  // No include_transcript here — we only need ids/times to decide; ingest re-fetches with transcript.
  const res = await fetch(u.toString(), {
    headers: { 'X-Api-Key': apiKey, 'Content-Type': 'application/json' },
  });
  if (!res.ok) throw new Error(`Fathom API ${res.status} ${res.statusText}`);
  const data = await res.json();
  return data.items || data.meetings || data.results || data.data || [];
}

/**
 * One poll pass. Lists recent meetings, ingests eligible+new ones.
 * @param {object} [opts] { coachClientId, dryRun, limit }
 * @returns {Promise<{ok, ingested, skipped, failed, details, reason?}>}
 */
async function pollFathomMeetings(opts = {}) {
  const { coachClientId = DEFAULT_COACH_CLIENT_ID, dryRun = false, limit = 25 } = opts;

  const cutoff = liveFromMs();
  if (cutoff == null) {
    return { ok: false, reason: 'FATHOM_LIVE_FROM not set — nothing eligible', ingested: 0, skipped: 0, failed: 0, details: [] };
  }

  const coach = await clientService.getClientById(coachClientId);
  if (!coach) return { ok: false, reason: `coach ${coachClientId} not found`, ingested: 0, skipped: 0, failed: 0, details: [] };
  if (!coach.fathomApiKey) return { ok: false, reason: `no Fathom API key for ${coachClientId}`, ingested: 0, skipped: 0, failed: 0, details: [] };

  let meetings;
  try {
    meetings = await listRecentMeetings(String(coach.fathomApiKey).trim(), limit);
  } catch (e) {
    return { ok: false, reason: e.message, ingested: 0, skipped: 0, failed: 0, details: [] };
  }

  const details = [];
  let ingested = 0, skipped = 0, failed = 0;

  for (const m of meetings) {
    const recId = m.recording_id || m.id;
    if (!recId) { skipped++; continue; }
    const startMs = meetingStartMs(m);

    if (startMs == null || startMs < cutoff) {
      skipped++; details.push({ recId, action: 'skip', why: 'before FATHOM_LIVE_FROM' });
      continue;
    }
    let already;
    try { already = await fathomRecordingIngested(recId); } catch (e) { already = false; }
    if (already) {
      skipped++; details.push({ recId, action: 'skip', why: 'already ingested' });
      continue;
    }

    try {
      const r = await ingestFathomMeeting({ recordingId: String(recId), coachClientId, dryRun });
      if (r.ok && !r.dryRun) {
        ingested++;
        details.push({ recId, action: 'ingested', mode: r.mode, meetingId: r.meetingId, filed: r.filed?.length });
      } else if (r.dryRun) {
        details.push({ recId, action: 'would-ingest', mode: r.plan?.mode });
      } else {
        // The caller discards `details`, so a reason that only lands there is a reason nobody
        // ever sees: a recording failing every 15 minutes forever showed up as "failed=1" at
        // info level, with no id and no why. Log each failure where it happens.
        failed++; details.push({ recId, action: 'fail', why: r.error });
        log.warn(`poll: rec=${recId} FAILED to ingest for ${coachClientId}: ${r.error}`);
      }
    } catch (e) {
      failed++; details.push({ recId, action: 'fail', why: e.message });
      log.warn(`poll: rec=${recId} THREW for ${coachClientId}: ${e.message}`);
    }
  }

  const summary = { ok: true, ingested, skipped, failed, details, dryRun: !!dryRun };
  lastRun = new Date().toISOString();
  lastResult = { ingested, skipped, failed, dryRun: !!dryRun };
  const failLine = failed ? ` — FAILED: ${details.filter((d) => d.action === 'fail').map((d) => `${d.recId} (${d.why})`).join('; ')}` : '';
  log.info(`poll pass: ingested=${ingested} skipped=${skipped} failed=${failed}${dryRun ? ' (dry-run)' : ''}${failLine}`);
  return summary;
}

/**
 * Multi-tenant poll pass — poll EVERY Active client that has a Fathom API key, ingesting each
 * tenant's meetings under their own clientId (so the store is stamped per-owner). Single-tenant
 * today (only Guy has a key) and fans out automatically as more clients add one. The same global
 * gates still apply per tenant inside pollFathomMeetings (FATHOM_LIVE_FROM, FATHOM_INGEST_ENABLED),
 * and dedup makes re-polling a no-op.
 *
 * NOTE: FATHOM_LIVE_FROM is a single global cutoff for now. When real tenants onboard at different
 * times this should become per-client (an onboarding date on the client record) — flagged, not yet built.
 *
 * @returns {Promise<{ok, tenants, ingested, failed, results}>}
 */
async function pollAllFathomTenants(opts = {}) {
  const { dryRun = false, limit = 25 } = opts;
  let clients;
  try {
    clients = await clientService.getAllClients();
  } catch (e) {
    log.error(`multi-tenant poll: could not list clients: ${e.message}`);
    return { ok: false, reason: e.message, tenants: 0, ingested: 0, failed: 0, results: [] };
  }
  const tenants = (clients || []).filter(
    (c) => c && c.fathomApiKey && String(c.status || '').toLowerCase() === 'active',
  );
  if (tenants.length === 0) {
    log.info('multi-tenant poll: no Active clients with a Fathom API key');
    return { ok: true, tenants: 0, ingested: 0, failed: 0, results: [] };
  }
  const results = [];
  let totIngested = 0, totFailed = 0;
  for (const c of tenants) {
    try {
      const r = await pollFathomMeetings({ coachClientId: c.clientId, dryRun, limit });
      results.push({ clientId: c.clientId, ...r });
      totIngested += r.ingested || 0;
      totFailed += r.failed || 0;
    } catch (e) {
      results.push({ clientId: c.clientId, ok: false, reason: e.message });
      log.warn(`multi-tenant poll: ${c.clientId} failed: ${e.message}`);
    }
  }
  log.info(`multi-tenant poll: ${tenants.length} tenant(s), ingested=${totIngested} failed=${totFailed}${dryRun ? ' (dry-run)' : ''}`);
  const coverage = await sweepEmptyTranscripts().catch((e) => {
    log.warn(`coverage sweep failed: ${e.message}`);
    return null;
  });
  return { ok: true, tenants: tenants.length, ingested: totIngested, failed: totFailed, results, coverage };
}

// ── Coverage sweep: make silent transcript failures loud ────────────────────────────────────────
// A meeting row with a populated header and an EMPTY body is worse than no row: the review queue
// doesn't select transcript_text, its status ('incomplete') is the same one a healthy meeting
// awaiting speaker checks carries, and the MCP serves it back with a confident header and nothing
// in it. So nothing in the system could notice. Two went missing in ~2.5 weeks (Kate Phillips
// 1 Jul — unrecoverable past Fathom's retention; Julian Davis 17 Jul).
// Rides the poll's existing 15-min heartbeat rather than adding a cron nobody remembers.
const EMPTY_GRACE_MINS = Number(process.env.FATHOM_EMPTY_GRACE_MINS) || 90;
let lastCoverage = null;

async function sweepEmptyTranscripts({ olderThanMins = EMPTY_GRACE_MINS } = {}) {
  const { findEmptyTranscriptMeetings } = require('./recallWebhookDb');
  const rows = await findEmptyTranscriptMeetings({ olderThanMins });
  lastCoverage = { checkedAt: new Date().toISOString(), graceMins: olderThanMins, emptyCount: rows.length };
  if (!rows.length) return lastCoverage;
  log.warn(`COVERAGE: ${rows.length} meeting(s) have a header but NO transcript body (>${olderThanMins} min after start) — each looks like coverage and is not:`);
  for (const r of rows.slice(0, 20)) {
    const when = r.meeting_start || r.created_at;
    log.warn(`  - meeting_id=${r.id} "${r.title || '(untitled)'}" ${when ? new Date(when).toISOString() : '?'} owner=${r.coach_client_id} source=${r.source}${r.fathom_recording_id ? ` fathom_rec=${r.fathom_recording_id}` : ''}`);
  }
  if (rows.length > 20) log.warn(`  … and ${rows.length - 20} more`);
  lastCoverage.sample = rows.slice(0, 20).map((r) => ({ id: String(r.id), title: r.title, meetingStart: r.meeting_start, owner: r.coach_client_id }));
  return lastCoverage;
}

function startFathomPoll() {
  if (intervalHandle) return;
  if (!pollEnabled()) { log.info('fathom-poll: disabled (FATHOM_POLL_ENABLED not true)'); return; }
  if (liveFromMs() == null) { log.info('fathom-poll: FATHOM_LIVE_FROM not set — not starting'); return; }
  log.info(`fathom-poll: starting multi-tenant (every ${Math.round(POLL_INTERVAL_MS / 60000)} min)`);
  setTimeout(() => { pollAllFathomTenants().catch((e) => log.error(`first tick: ${e.message}`)); }, 8000);
  intervalHandle = setInterval(() => {
    pollAllFathomTenants().catch((e) => log.error(`tick: ${e.message}`));
  }, POLL_INTERVAL_MS);
}

function stopFathomPoll() {
  if (intervalHandle) { clearInterval(intervalHandle); intervalHandle = null; }
}

function getFathomPollStatus() {
  return {
    running: !!intervalHandle,
    enabled: pollEnabled(),
    liveFrom: process.env.FATHOM_LIVE_FROM || null,
    pollIntervalMs: POLL_INTERVAL_MS,
    lastRun,
    lastResult,
    // "Is anything looking like coverage but empty?" — the answer nothing used to be able to give.
    lastCoverage,
  };
}

module.exports = {
  pollFathomMeetings,
  pollAllFathomTenants,
  sweepEmptyTranscripts,
  startFathomPoll,
  stopFathomPoll,
  getFathomPollStatus,
  pollEnabled,
  liveFromMs,
};
