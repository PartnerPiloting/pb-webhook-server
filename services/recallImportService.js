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
 * Fathom: real exports look like
 *   "Guy Wilson and Roland Illyes - June 01"        ← title line
 *   "VIEW RECORDING - 34 mins (No highlights): "    ← Fathom watermark + link
 *   "---"                                            ← separator
 *   ""
 *   "0:01 - Guy Wilson"                              ← timestamp + speaker header
 *   "  That was a mammoth effort..."                 ← indented body
 *   ""
 *   "0:27 - Roland Illyes (GRACEX)"
 *   "  I used to send out..."
 *
 * Older exports use "Name HH:MM[:SS]" (name first) — we still handle that as a fallback.
 *
 * Output is normalised to canonical "Name: text" lines so the existing speaker parser
 * and rendering pick up the right labels.
 */
function normalizeFathom(text) {
  let lines = basicClean(text).split('\n');

  // Strip Fathom header: everything up to and including the first "---" separator line.
  const sepIdx = lines.findIndex(l => /^\s*-{3,}\s*$/.test(l));
  if (sepIdx >= 0) {
    lines = lines.slice(sepIdx + 1);
  } else {
    // No separator — peel off the "VIEW RECORDING - X mins ..." watermark line if present.
    lines = lines.filter(l => !/^\s*VIEW RECORDING\b/i.test(l));
  }

  const out = [];
  // Modern Fathom: "M:SS - Name" or "H:MM:SS - Name" (en-dash or hyphen tolerated).
  const tsFirstRe = /^\s*\d{1,2}:\d{2}(?::\d{2})?\s*[-–—]\s*(.+?)\s*$/;
  // Legacy fallback: "Name HH:MM[:SS]".
  const nameFirstRe = /^\s*([^:0-9\n][^:\n]{0,58}?)\s+\d{1,2}:\d{2}(?::\d{2})?\s*$/;

  const matchHeader = (line) => {
    const a = line.match(tsFirstRe);
    if (a) return a[1].trim();
    const b = line.match(nameFirstRe);
    if (b) return b[1].trim();
    return null;
  };

  for (let i = 0; i < lines.length; i++) {
    const name = matchHeader(lines[i]);
    if (name) {
      // Skip blank lines after the header.
      let j = i + 1;
      while (j < lines.length && !lines[j].trim()) j++;
      if (j < lines.length) {
        const body = lines[j].trim();
        out.push(`${name}: ${body}`);
        // Continuation lines: indented or non-blank text until the next header / blank-then-header.
        let k = j + 1;
        while (k < lines.length) {
          const trimmed = lines[k].trim();
          if (!trimmed) {
            // Blank line — peek ahead; if next non-blank is a header, stop.
            let p = k + 1;
            while (p < lines.length && !lines[p].trim()) p++;
            if (p >= lines.length || matchHeader(lines[p])) break;
            out.push('');
            k = p;
            continue;
          }
          if (matchHeader(lines[k])) break;
          out.push(trimmed);
          k++;
        }
        i = k - 1;
        continue;
      }
    }
    // Lines that aren't headers and aren't part of an utterance: drop blank-only ones to keep
    // the output tidy, otherwise pass through (rare — strays after header strip).
    if (lines[i].trim()) out.push(lines[i]);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function normalizeTranscript(source, text) {
  const s = String(source || '').toLowerCase();
  if (s === 'tactiq') return normalizeTactiq(text);
  if (s === 'fathom') return normalizeFathom(text);
  return basicClean(text).trim();
}

/**
 * Normalise a pasted email so easy-to-introduce noise doesn't break the Airtable lookup.
 * Handles: surrounding whitespace, "mailto:" prefix, <angle brackets>, and — the one that
 * actually bit us — a trailing full stop / comma / semicolon (e.g. "ken@iibroker.com.au.").
 * Returns '' if the result doesn't look like an email.
 */
function normalizeEmail(raw) {
  let e = String(raw || '').trim().toLowerCase();
  if (!e) return '';
  e = e.replace(/^mailto:/, '');
  e = e.replace(/^<+/, '').replace(/>+$/, '');
  e = e.replace(/[.,;:\s]+$/, '');   // strip trailing punctuation/whitespace
  e = e.replace(/^[.,;:\s]+/, '');   // and any leading noise
  e = e.trim();
  // Basic sanity: exactly one @, a dot in the domain, no spaces.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return '';
  return e;
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

  // Optional: link to Airtable lead by email. We surface the outcome so the UI can warn the
  // user rather than silently saving an unretrievable (lead-less) transcript.
  let leadLinked = false;
  let leadWarning = null;
  let linkedLeadName = null;
  const rawEmail = (opts.leadEmail || '').trim();
  if (rawEmail) {
    const cleanEmail = normalizeEmail(rawEmail);
    if (!cleanEmail) {
      leadWarning = `"${rawEmail}" doesn't look like a valid email — transcript saved but not linked to a lead.`;
      log.info(`import: lead email "${rawEmail}" failed validation for meeting=${meetingId}`);
    } else {
      try {
        const coach = await clientService.getClientById(coachClientId);
        if (coach) {
          const lead = await findLeadByEmail(coach, cleanEmail);
          if (lead?.id) {
            await addMeetingLead(meetingId, lead.id, coachClientId, `import:${source}`);
            leadLinked = true;
            linkedLeadName = [lead.firstName, lead.lastName].filter(Boolean).join(' ').trim() || cleanEmail;
            log.info(`import: linked meeting=${meetingId} to lead=${lead.id} (${cleanEmail})`);
          } else {
            leadWarning = `No Airtable lead found with email ${cleanEmail} — transcript saved but not retrievable by that lead until linked.`;
            log.info(`import: no Airtable lead matched email=${cleanEmail} for coach=${coachClientId}`);
          }
        } else {
          leadWarning = 'Coach record not found — transcript saved but not linked.';
        }
      } catch (e) {
        leadWarning = `Lead lookup failed (${e.message}) — transcript saved but not linked.`;
        log.warn(`import: lead-link failed for meeting=${meetingId}: ${e.message}`);
      }
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

  return { ok: true, meetingId, leadLinked, linkedLeadName, leadWarning, summary };
}

module.exports = {
  importTranscript,
  normalizeTranscript,
  normalizeTactiq,
  normalizeFathom,
  normalizeEmail,
};
