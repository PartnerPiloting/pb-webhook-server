/**
 * Capture release sweep — files held captures whose holding window has been served.
 *
 * The other half of the holding window in services/capturePolicyStore.js: the webhook parks a
 * capture (metadata only), THIS sweep fetches + files it once release_at passes — or sooner,
 * when the client says "take it now" (releaseHeldCaptureNow just pulls release_at to now).
 *
 * Own setInterval heartbeat (same shape as fathomPollService.startFathomPoll) rather than riding
 * the Fathom poll's — held captures must release even for a client with no Fathom key, and even
 * if the Fathom poll is ever switched off. A pass with an empty queue is a no-op costing one
 * indexed SELECT, so there is no enable flag to remember: it simply runs.
 *
 * Failure semantics: a row whose ingest fails stays 'held' with last_error stamped, so the next
 * pass retries it (e.g. GRANOLA_INGEST_ENABLED still off at release time). The leads-only gate
 * is re-checked at release by the ingest itself; a veto that lands during the window wins —
 * ingest sees the tombstone and declines.
 */

const { createSafeLogger } = require('../utils/loggerHelper');
const { dueHeldCaptures, markHeldCaptureReleased, markHeldCaptureReview } = require('./capturePolicyStore');

const log = createSafeLogger('SYSTEM', null, 'capture_release');

const SWEEP_INTERVAL_MS = Number(process.env.CAPTURE_RELEASE_INTERVAL_MS) || 5 * 60 * 1000; // 5 min
const MAX_PER_PASS = Number(process.env.CAPTURE_RELEASE_MAX_PER_PASS) || 10;

let intervalHandle = null;
let lastPass = null;

/** One pass: file every due held capture, bounded; the next pass picks up the rest. */
async function releaseDueCaptures() {
  const due = await dueHeldCaptures({ limit: MAX_PER_PASS });
  if (!due.length) {
    lastPass = { at: new Date().toISOString(), released: 0, failed: 0 };
    return lastPass;
  }
  let released = 0;
  let failed = 0;
  for (const row of due) {
    try {
      let result;
      if (row.source === 'granola') {
        const { ingestGranolaNote } = require('./granolaIngestService');
        result = await ingestGranolaNote({
          noteId: row.provider_recording_id,          // may be "<note>#<chunk>" for a review row
          coachClientId: row.coach_client_id,
          bypassHold: true,
          assignedLeadEmail: row.assigned_lead || undefined,
        });
      } else if (row.source === 'fireflies') {
        const { ingestFirefliesTranscript } = require('./firefliesIngestService');
        result = await ingestFirefliesTranscript({
          transcriptId: row.provider_recording_id,
          coachClientId: row.coach_client_id,
          bypassHold: true,
        });
      } else {
        // Fathom (and future providers) don't feed the hold queue yet — if a row appears
        // anyway, leave it held and say so rather than guessing at an ingest path.
        result = { ok: false, error: `no release path for source '${row.source}'` };
      }
      // A capture the policy declined at release (leads-only re-check, or vetoed during the
      // window) is DONE, not a failure — mark it released so it leaves the queue.
      const done = !!result.ok && (!!result.meetingId || !!result.skipped);
      const stillHeld = !!result.ok && !!result.held; // shouldn't happen with bypassHold — treat as retry
      // The ingest could not attribute this capture with confidence: it is parked for the
      // coach (review), not retried. When THIS row is the chunk in question it goes back to
      // review here; other chunks of the same note were held by the ingest itself.
      const needsReview = !!result.ok && !!result.review && !result.meetingId;
      if (needsReview) {
        const why = (result.held || []).map((h) => `${h.verdict}: ${h.reason}`).join('; ') || 'could not attribute with confidence';
        await markHeldCaptureReview(row.id, why);
        log.info(`capture id=${row.id} ${row.source}/${row.provider_recording_id} needs review — ${why}`);
        continue;
      }
      if (done) {
        await markHeldCaptureReleased(row.id, { ok: true });
        released++;
        log.info(`released capture id=${row.id} ${row.source}/${row.provider_recording_id} (${row.coach_client_id})${result.meetingId ? ` -> meeting_id=${result.meetingId}` : ` — ${result.skipped}`}`);
      } else {
        await markHeldCaptureReleased(row.id, { ok: false, error: result.error || (stillHeld ? 'ingest re-held the capture' : 'unknown') });
        failed++;
        log.warn(`release failed for capture id=${row.id} ${row.source}/${row.provider_recording_id}: ${result.error || 'unknown'} — will retry next pass`);
      }
    } catch (e) {
      await markHeldCaptureReleased(row.id, { ok: false, error: e.message }).catch(() => {});
      failed++;
      log.warn(`release threw for capture id=${row.id}: ${e.message} — will retry next pass`);
    }
  }
  lastPass = { at: new Date().toISOString(), released, failed, due: due.length };
  return lastPass;
}

function startCaptureReleaseSweep() {
  if (intervalHandle) return;
  if (!(process.env.DATABASE_URL || '').trim()) {
    log.info('capture-release: no DATABASE_URL — not starting');
    return;
  }
  log.info(`capture-release: starting (every ${Math.round(SWEEP_INTERVAL_MS / 60000)} min)`);
  setTimeout(() => { releaseDueCaptures().catch((e) => log.error(`first pass: ${e.message}`)); }, 15000);
  intervalHandle = setInterval(() => {
    releaseDueCaptures().catch((e) => log.error(`pass: ${e.message}`));
  }, SWEEP_INTERVAL_MS);
}

function getCaptureReleaseStatus() {
  return { running: !!intervalHandle, intervalMs: SWEEP_INTERVAL_MS, lastPass };
}

module.exports = { startCaptureReleaseSweep, releaseDueCaptures, getCaptureReleaseStatus };
