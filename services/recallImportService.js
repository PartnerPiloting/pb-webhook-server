/**
 * Manually-imported transcripts (Tactiq, Fathom, other).
 *
 * Takes a pasted transcript + light metadata and produces a recall_meetings row
 * that flows through the rest of the system identically to a Recall capture:
 * review queue, summary generation, share link, send-from-Gmail.
 *
 * Per-source normalisers turn the wire format into the canonical "Name: text"
 * the rest of the system expects. Robust to common patterns; degrades gracefully
 * (leaves text as-is) on unrecognised shapes.
 */

const clientService = require('./clientService');
const { findLeadByEmail } = require('./inboundEmailService');
const { insertImportedMeeting, addMeetingLead } = require('./recallWebhookDb');
const { generateMeetingSummary } = require('./recallSummaryService');
const { createSafeLogger } = require('../utils/loggerHelper');

const log = createSafeLogger('SYSTEM', null, 'recall_import');

const DEFAULT_COACH_CLIENT_ID = (process.env.RECALL_COACH_CLIENT_ID || 'Guy-Wilson').trim();

/* ------------------------------------------------------------------ */
/* Normalisers                                                         */
/* ------------------------------------------------------------------ */

// Strip ASCII control chars (NUL, BEL, etc.) and zero-width Unicode that
// otherwise leak into clipboard pastes (Gmail-paste killer — same fix as elsewhere).
const STRIP_CTRL = new RegExp('[\\x00-\\x08\\x0B\\x0C\\x0E-\\x1F\\x7F]', 'g');
const STRIP_ZERO_WIDTH = new RegExp('[\\u200B-\\u200D\\u2060\\uFEFF]', 'g');

function basicClean(text) {
  return String(text || '').replace(STRIP_CTRL, '').replace(STRIP_ZERO_WIDTH, '').replace(/\r\n/g, '\n');
}

/**
 * Tactiq: typical shapes we see are
 *   "[10:23] John Smith: Hello"
 *   "John Smith (00:00:23): Hello"
 *   "00:00:05  John Smith: Hello"
 * Strip the timestamp decoration and keep "Name: text". Lines we don't recognise
 * pass through untouched.
 */
function normalizeTactiq(text) {
  const lines = basicClean(text).split('\n');
  const out = [];
  for (const raw of lines) {
    let l = raw;
    // Leading "[HH:MM]" or "[HH:MM:SS]"
    l = l.replace(/^\s*\[\s*\d{1,2}:\d{2}(?::\d{2})?\s*\]\s*/, '');
    // Leading bare "HH:MM" or "HH:MM:SS" before a name
    l = l.replace(/^\s*\d{1,2}:\d{2}(?::\d{2})?\s+(?=[A-Za-z(])/, '');
    // " (HH:MM:SS)" sitting between name and colon
    l = l.replace(/^([^:\n]{1,60})\s*\(\d{1,2}:\d{2}(?::\d{2})?\)\s*:/, '$1:');
    out.push(l);
  }
  return out.join('\n').trim();
}

/**
 * Fathom: typical export shape is two lines per utterance —
 *   "John Smith 00:00:05"
 *   "Hello, how are you?"
 * Sometimes "Name 0:05" or "Name HH:MM:SS". We collapse the pair into "Name: text".
 * Lines that don't match the header pattern pass through untouched.
 */
function normalizeFathom(text) {
  const lines = basicClean(text).split('\n');
  const out = [];
  // Header line = "Name HH:MM[:SS]" or "Name H:MM[:SS]", name is non-colon, up to ~60 chars.
  const headerRe = /^\s*([^:0-9\n][^:\n]{0,58}?)\s+\d{1,2}:\d{2}(?::\d{2})?\s*$/;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(headerRe);
    if (m) {
      // Find the next non-blank line and merge.
      let j = i + 1;
      while (j < lines.length && !lines[j].trim()) j++;
      if (j < lines.length) {
        const name = m[1].trim();
        const body = lines[j].trim();
        out.push(`${name}: ${body}`);
        // Append any continuation lines (until next blank or next header) under the same speaker.
        let k = j + 1;
        while (k < lines.length && lines[k].trim() && !lines[k].match(headerRe)) {
          out.push(lines[k]);
          k++;
        }
        i = k - 1;
        continue;
      }
    }
    out.push(lines[i]);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function normalizeTranscript(source, text) {
  const s = String(source || '').toLowerCase();
  if (s === 'tactiq') return normalizeTactiq(text);
  if (s === 'fathom') return normalizeFathom(text);
  return basicClean(text).trim();
}

/* ------------------------------------------------------------------ */
/* Import orchestration                                                */
/* ------------------------------------------------------------------ */

/**
 * Import a manually-pasted transcript.
 *
 * @param {object} opts
 * @param {string} opts.title           Meeting title (required).
 * @param {string} opts.source          'tactiq' | 'fathom' | 'other' (default 'other').
 * @param {string} opts.transcriptText  Raw pasted transcript (required, non-empty).
 * @param {string} [opts.meetingStart]  ISO timestamp; defaults to now.
 * @param {number} [opts.durationSeconds]
 * @param {string} [opts.leadEmail]     If provided, looks up the Airtable lead and attaches it.
 * @param {string} [opts.coachClientId] Tenant scope; defaults to RECALL_COACH_CLIENT_ID.
 * @returns {Promise<{ok:boolean, meetingId?:string, error?:string, leadLinked?:boolean, summary?:object}>}
 */
async function importTranscript(opts) {
  const title = (opts.title || '').trim();
  const rawText = String(opts.transcriptText || '').trim();
  if (!title) return { ok: false, error: 'title is required' };
  if (!rawText) return { ok: false, error: 'transcript text is required' };

  const source = (opts.source || 'other').toString().toLowerCase().trim() || 'other';
  const meetingStart = opts.meetingStart || new Date().toISOString();
  const durationSeconds = Number.isFinite(opts.durationSeconds) ? opts.durationSeconds : null;
  const coachClientId = (opts.coachClientId || DEFAULT_COACH_CLIENT_ID).trim();

  const transcriptText = normalizeTranscript(source, rawText);

  const ins = await insertImportedMeeting({
    title,
    source,
    transcriptText,
    meetingStart,
    durationSeconds,
  });
  if (!ins.ok) return { ok: false, error: ins.error || 'failed to insert meeting' };

  const meetingId = ins.meeting_id;
  log.info(`import: created meeting=${meetingId} source=${source} title="${title}" len=${transcriptText.length}`);

  // Optional: link to Airtable lead by email.
  let leadLinked = false;
  if (opts.leadEmail) {
    try {
      const coach = await clientService.getClientById(coachClientId);
      if (coach) {
        const lead = await findLeadByEmail(coach, String(opts.leadEmail).trim());
        if (lead?.id) {
          await addMeetingLead(meetingId, lead.id, coachClientId, `import:${source}`);
          leadLinked = true;
          log.info(`import: linked meeting=${meetingId} to lead=${lead.id} (${opts.leadEmail})`);
        } else {
          log.info(`import: no Airtable lead matched email=${opts.leadEmail} for coach=${coachClientId}`);
        }
      }
    } catch (e) {
      log.warn(`import: lead-link failed for meeting=${meetingId}: ${e.message}`);
    }
  }

  // Generate the Fathom-style summary inline so the user lands on a fully-populated review page.
  let summary = null;
  try {
    const gen = await generateMeetingSummary(meetingId);
    if (gen.ok) summary = gen.summary;
    else log.warn(`import: summary generation failed for meeting=${meetingId}: ${gen.error}`);
  } catch (e) {
    log.warn(`import: summary exception for meeting=${meetingId}: ${e.message}`);
  }

  return { ok: true, meetingId, leadLinked, summary };
}

module.exports = {
  importTranscript,
  normalizeTranscript,
  normalizeTactiq,
  normalizeFathom,
};
