// Read-only: which meetings LOOK like coverage but have no transcript body?
//   node scripts/transcript-coverage-check.js [graceMins]
// Default grace = 90 min after the meeting's start. Run as a Render one-off job against prod
// (see memory reference_render_jobs_exec). Never writes.
//
// WHY (2026-07-17): a row with a populated header and an empty body was invisible - the review
// queue doesn't select transcript_text, its status is the same 'incomplete' a healthy meeting
// carries while awaiting speaker checks, and the MCP served it back with a confident header and
// nothing in it. Two meetings went missing in ~2.5 weeks before anyone noticed. The poller now
// runs this sweep every 15 min and logs it; this script is the on-demand version.
require('dotenv').config();
const { findEmptyTranscriptMeetings } = require('../services/recallWebhookDb');

const graceMins = Number(process.argv[2]) || 90;

(async () => {
  const rows = await findEmptyTranscriptMeetings({ olderThanMins: graceMins, limit: 200 });
  console.log(`Meetings with a header but NO transcript body, >${graceMins} min after start:\n`);
  if (!rows.length) {
    console.log('  none - every filed meeting has a body.');
    process.exit(0);
  }
  for (const r of rows) {
    const when = r.meeting_start || r.created_at;
    console.log(`  - meeting_id=${r.id}  "${r.title || '(untitled)'}"`);
    console.log(`      when=${when ? new Date(when).toISOString() : '?'}  owner=${r.coach_client_id}  source=${r.source}  status=${r.status}`);
    console.log(`      ${r.fathom_recording_id ? `fathom_rec=${r.fathom_recording_id} - retryable while inside Fathom's retention window` : 'no fathom recording id - nothing to re-ingest from'}`);
  }
  console.log(`\n${rows.length} empty-bodied meeting(s). Each one reads as coverage and is not.`);
  console.log('The Fathom dedup key now means SUCCEEDED, so the 15-min poller will retry any that still have a recording.');
  process.exit(0);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
