/**
 * Granola API ingest — the FIRST parallel transcript provider beside Fathom.
 *
 * Takes a finished Granola note (the client's personal note-taker: local capture, NO bot,
 * host-independent) and files it into the SAME source-agnostic store a Fathom/Recall capture
 * uses (recall_meetings + recall_meeting_leads), so it flows through the existing review /
 * summary / "I had a meeting with X" lookup unchanged.
 *
 * Trigger: routes/granolaWebhookRoutes.js (Granola's note.generated webhook carries only a
 * note id; we fetch the note + transcript here with the CLIENT's own API key).
 *
 * ⚠ Granola transcripts label speakers only as source='microphone' (the coach talking) vs
 * 'speaker' (everyone else) — no names, no per-line timestamps. So:
 *   - Speaker labels are SYNTHESISED: microphone -> the coach's name; the other side -> the
 *     matched lead's name when exactly ONE lead matched, else "Participant" (+ Granola's
 *     anonymous diarization_label when present). Honest, not guessed.
 *   - No timestamps => the back-to-back splitter CANNOT run. That's acceptable: Granola creates
 *     one note per meeting by design, so the "lump" problem is largely structural to Fathom.
 *
 * Lead matching reuses the Fathom ladder helpers (same order of trust): note attendee emails ->
 * coach's own calendar window (attendees + organizer) -> attendee NAME (unique match, email
 * self-heal) -> PENDING leads for identified-but-unmatched people.
 *
 * ADDITIVE + SAFE:
 *   - New file; nothing calls it except the (gated) Granola webhook route.
 *   - WRITE path gated behind GRANOLA_INGEST_ENABLED (default OFF). dryRun supported.
 *   - Rows tagged source='granola', provider_recording_id=<note id> — identifiable + reversible
 *     in one DELETE (leads cascade). Dedup = providerRecordingIngested('granola', noteId), with
 *     the same "only a non-empty transcript counts" semantics as Fathom.
 *   - NOTE SHAPE: written against docs.granola.ai (GET /v1/notes/{id}?include=transcript).
 *     Field fallbacks are deliberately defensive — verify against a real note on first live use.
 */

const clientService = require('./clientService');
const { findLeadByName, learnEmailForLead } = require('./inboundEmailService');
const { insertImportedMeeting, addMeetingLead, providerRecordingIngested } = require('./recallWebhookDb');
const { generateMeetingSummary } = require('./recallSummaryService');
const { matchLeads, calendarParticipantEmails, relevantCalendarEvents } = require('./fathomIngestService');
const { createSafeLogger } = require('../utils/loggerHelper');

const log = createSafeLogger('SYSTEM', null, 'granola_ingest');

const GRANOLA_API_BASE = (process.env.GRANOLA_API_BASE || 'https://public-api.granola.ai/v1').replace(/\/$/, '');
const SOURCE = 'granola';

/** The write path only runs when this is explicitly enabled. */
function ingestEnabled() {
  return String(process.env.GRANOLA_INGEST_ENABLED || '').trim().toLowerCase() === 'true';
}

/**
 * Fetch one note from the Granola API. includeTranscript=false fetches METADATA ONLY (title,
 * attendees, times) — the capture-policy layer uses that to decide whether the words may be
 * fetched at all, so the transcript never leaves Granola for a declined capture.
 */
async function fetchGranolaNote(noteId, apiKey, { includeTranscript = true } = {}) {
  const qs = includeTranscript ? '?include=transcript' : '';
  const res = await fetch(`${GRANOLA_API_BASE}/notes/${encodeURIComponent(noteId)}${qs}`, {
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
  });
  if (!res.ok) {
    return { ok: false, error: `Granola API ${res.status} ${res.statusText}` };
  }
  const data = await res.json();
  const note = data.note || data.data || data;
  if (!note || (!note.id && !note.note_id)) return { ok: false, error: 'Granola API returned no note object' };
  return { ok: true, note };
}

/** Title + start/end times off the note (field names defensive; end/duration often absent). */
function extractMeta(note) {
  const title = note.title || note.name || 'Granola meeting';
  const start = note.meeting_start || note.started_at || note.start_time
    || note.calendar_event?.start || note.created_at || null;
  const end = note.meeting_end || note.ended_at || note.end_time || note.calendar_event?.end || null;
  let durationSeconds = null;
  if (start && end) {
    const d = (Date.parse(end) - Date.parse(start)) / 1000;
    if (Number.isFinite(d) && d > 0) durationSeconds = Math.round(d);
  }
  return { title, meetingStart: start, meetingEnd: end, durationSeconds };
}

/**
 * People attached to the note (Granola links the calendar event when its calendar integration is
 * on). Returns [{email?, name?}] minus the coach's own addresses. Empty when Granola has no
 * calendar context — the coach's-own-calendar fallback covers that case.
 */
function extractNotePeople(note, coachEmails = []) {
  const coachSet = new Set((coachEmails || []).map((e) => String(e).toLowerCase().trim()).filter(Boolean));
  const buckets = [note.attendees, note.people, note.participants, note.calendar_event?.attendees];
  const out = new Map(); // email (or name-key) -> {email?, name?}
  for (const bucket of buckets) {
    if (!Array.isArray(bucket)) continue;
    for (const p of bucket) {
      if (!p) continue;
      const email = String(p.email || p.email_address || '').toLowerCase().trim();
      const name = String(p.name || p.display_name || p.full_name || '').trim();
      if (email && coachSet.has(email)) continue;
      const key = email || (name ? `name:${name.toLowerCase()}` : '');
      if (!key) continue;
      const prev = out.get(key);
      if (!prev) out.set(key, { ...(email ? { email } : {}), ...(name ? { name } : {}) });
      else if (!prev.name && name) out.set(key, { ...prev, name });
    }
  }
  return [...out.values()];
}

/**
 * Granola transcript segments -> canonical "Name: text" lines (the paste-import format — no
 * timestamps exist to preserve). microphone = the coach; anything else = the other side, named
 * for the matched lead when there is exactly one, else "Participant" (+ anonymous diarization
 * label when Granola provides one). Consecutive same-speaker segments merge into one line so the
 * store reads like a conversation, not confetti.
 */
function normalizeGranolaTranscript(note, { coachName, otherName } = {}) {
  const segs = Array.isArray(note.transcript) ? note.transcript
    : Array.isArray(note.transcript?.segments) ? note.transcript.segments : [];
  const me = (coachName || 'Coach').trim();
  const lines = [];
  let lastLabel = null;
  for (const u of segs) {
    if (!u) continue;
    const text = String(typeof u === 'string' ? u : (u.text ?? u.content ?? '')).trim();
    if (!text) continue;
    let label;
    if (typeof u === 'string') {
      label = null; // bare string segment — no speaker info at all
    } else {
      const src = String(u.speaker?.source || u.source || '').toLowerCase();
      const diar = String(u.diarization_label || u.speaker?.diarization_label || '').trim();
      if (src === 'microphone') label = me;
      else label = otherName || (diar ? `Participant (${diar})` : 'Participant');
    }
    const effective = label || lastLabel || 'Speaker';
    if (lines.length && effective === lastLabel) {
      lines[lines.length - 1] += ` ${text}`;
    } else {
      lines.push(`${effective}: ${text}`);
      lastLabel = effective;
    }
  }
  return lines.join('\n');
}

/**
 * Ingest one Granola note.
 *
 * @param {object} opts
 * @param {string} opts.noteId             Granola note id (required)
 * @param {string} opts.coachClientId      tenant scope (required — the webhook route knows it from its URL)
 * @param {boolean} [opts.dryRun]          if true: do everything EXCEPT write
 * @param {boolean} [opts.bypassHold]      the release sweep sets this: the holding window has
 *                                         been served (or released early), so don't re-queue.
 *                                         The leads-only gate still applies — release is not
 *                                         consent to capture a no-lead call.
 * @param {object[]} [opts.calendarEvents] inject calendar events (tests); else read live
 * @returns {Promise<object>} { ok, dryRun?, plan, meetingId?, linkedLeads?, held?, skipped? }
 */
async function ingestGranolaNote(opts = {}) {
  const { noteId, coachClientId, dryRun = false, bypassHold = false, calendarEvents } = opts;
  if (!noteId) return { ok: false, error: 'noteId is required' };
  if (!coachClientId) return { ok: false, error: 'coachClientId is required' };

  const coach = await clientService.getClientById(coachClientId);
  if (!coach) return { ok: false, error: `coach client ${coachClientId} not found` };
  if (!coach.granolaApiKey) return { ok: false, error: `no Granola API key for ${coachClientId}` };

  // ---- Capture policy front door (services/capturePolicyStore.js) ------------
  // Tombstone first: a deleted/vetoed note stays gone — a Granola retry or regenerate that
  // hits this walks away without fetching ANYTHING.
  const { getCapturePolicy, isCaptureBlocked, holdCapture } = require('./capturePolicyStore');
  if (await isCaptureBlocked(SOURCE, String(noteId))) {
    log.info(`granola note=${noteId} is tombstoned (deleted/vetoed) — declining, nothing fetched`);
    return { ok: true, skipped: 'tombstoned' };
  }
  const policy = getCapturePolicy(coach);
  // Metadata-first when the policy has anything to decide: the transcript must not leave
  // Granola until the gate has passed and the window has been served. Open clients keep the
  // original single fetch — identical behaviour, no extra API call.
  const metadataFirst = policy.mode === 'leads-only' || (policy.holdMinutes > 0 && !bypassHold);

  const f = await fetchGranolaNote(noteId, coach.granolaApiKey, { includeTranscript: !metadataFirst });
  if (!f.ok) return f;
  let note = f.note;
  const realNoteId = String(note.id || note.note_id || noteId);

  const meta = extractMeta(note);
  const coachEmails = [coach.googleCalendarEmail, coach.clientEmailAddress].filter(Boolean);
  const coachName = coach.clientName || coach.clientFirstName || 'Coach';

  // ---- Lead ladder (same trust order as Fathom's single path) ----------------
  const people = extractNotePeople(note, coachEmails);
  const peopleEmails = people.filter((p) => p.email).map((p) => p.email);
  const { matched, unmatched } = await matchLeads(coach, peopleEmails);

  // Coach's-own-calendar fallback: Granola had no (or unmatched) people on the note — the
  // booking on the coach's calendar carries the real participant emails, organizer included.
  let calendarUnmatched = [];
  if (matched.length === 0 && meta.meetingStart) {
    const startIso = new Date(meta.meetingStart).toISOString();
    const endIso = meta.meetingEnd
      ? new Date(meta.meetingEnd).toISOString()
      : new Date(Date.parse(meta.meetingStart) + 60 * 60 * 1000).toISOString(); // no end recorded — assume an hour
    const pseudoMeeting = { recording_start_time: startIso, recording_end_time: endIso };
    const events = await relevantCalendarEvents(pseudoMeeting, coach, calendarEvents);
    const calParticipants = calendarParticipantEmails(events, coachEmails);
    const cal = calParticipants.length ? await matchLeads(coach, calParticipants.map((x) => x.email)) : { matched: [], unmatched: [] };
    for (const m of cal.matched) matched.push({ ...m, via: 'calendar-email' });
    if (cal.matched.length) log.info(`granola calendar-email fallback matched ${cal.matched.length} lead(s) from ${calParticipants.length} calendar participant(s)`);
    const nameByEmail = new Map(calParticipants.map((x) => [x.email, x.name || '']));
    calendarUnmatched = (cal.unmatched || []).map((e) => {
      const clean = String(e).toLowerCase().trim();
      const name = nameByEmail.get(clean);
      return { email: clean, ...(name ? { name } : {}) };
    });
  }

  // NAME fallback: a note person whose email matched no lead (or who had no email at all) still
  // gets a shot via their name — unique match links the lead and flags the email to self-heal.
  const nameByEmailNote = new Map(people.filter((p) => p.email).map((p) => [p.email, p.name || '']));
  const remainingUnmatched = [];
  for (const rawEmail of unmatched) {
    const name = nameByEmailNote.get(String(rawEmail).toLowerCase().trim());
    let healed = false;
    if (name) {
      try {
        const r = await findLeadByName(coach, name);
        if (r && r.matchType === 'unique' && r.lead?.id) {
          matched.push({
            email: String(rawEmail).toLowerCase().trim(),
            leadId: r.lead.id,
            name: [r.lead.firstName, r.lead.lastName].filter(Boolean).join(' ').trim() || name,
            via: 'name',
          });
          healed = true;
          log.info(`granola name fallback matched "${name}" -> lead ${r.lead.id} (will learn ${rawEmail})`);
        }
      } catch (e) { log.warn(`granola name fallback failed for "${name}": ${e.message}`); }
    }
    if (!healed) remainingUnmatched.push(rawEmail);
  }

  // ---- Capture policy decision (the ladder above is now final) ---------------
  // LEADS-ONLY GATE: nobody on this call is a lead => decline STATELESSLY. Nothing stored,
  // not even the title; the transcript was never fetched (metadata-only pass). A regenerate
  // re-fires the webhook and we simply decide again. This deliberately disables the
  // pending-lead impromptu-capture machinery for leads-only clients: miss beats leak.
  if (policy.mode === 'leads-only' && matched.length === 0) {
    log.info(`granola note=${realNoteId} declined by leads-only gate for ${coachClientId} (nobody on the call is a lead) — nothing stored`);
    return {
      ok: true, skipped: 'leads-only-no-match', dryRun: dryRun || undefined,
      plan: { noteId: realNoteId, title: meta.title, meetingStart: meta.meetingStart, source: SOURCE, declined: true },
    };
  }
  // HOLDING WINDOW: park the capture (metadata only) and walk away. The release sweep calls
  // back with bypassHold once the window has been served or the client says "take it now".
  if (policy.holdMinutes > 0 && !bypassHold) {
    const matchedSummary = matched.map((m) => ({ ...(m.name ? { name: m.name } : {}), ...(m.email ? { email: m.email } : {}) }));
    if (dryRun) {
      return { ok: true, dryRun: true, wouldHold: true, holdMinutes: policy.holdMinutes, plan: { noteId: realNoteId, title: meta.title, matchedLeads: matchedSummary, source: SOURCE } };
    }
    const held = await holdCapture({
      source: SOURCE, providerRecordingId: realNoteId, coachClientId,
      title: meta.title, meetingStart: meta.meetingStart, matchedLeads: matchedSummary,
      holdMinutes: policy.holdMinutes,
    });
    if (!held.ok) return { ok: false, error: `failed to queue capture: ${held.error}` };
    log.info(`granola note=${realNoteId} HELD for ${coachClientId} (${policy.holdMinutes} min window${held.alreadyHeld ? ', already queued' : ''}) — transcript not fetched`);
    return { ok: true, held: true, releaseAt: held.releaseAt || held.release_at || null, alreadyHeld: !!held.alreadyHeld };
  }
  // Policy passed on a metadata-only note: NOW the words may leave Granola.
  if (metadataFirst) {
    const full = await fetchGranolaNote(noteId, coach.granolaApiKey, { includeTranscript: true });
    if (!full.ok) return full;
    note = full.note;
  }

  // PENDING LEADS: identified people who match NO lead — stored on the meeting row so the
  // existing auto-link machinery (create doors + reconcile sweep) resolves them later.
  const matchedEmails = new Set(matched.map((m) => String(m.email || '').toLowerCase()).filter(Boolean));
  const pendingLeads = [];
  const seenPending = new Set();
  for (const rawEmail of remainingUnmatched) {
    const e = String(rawEmail).toLowerCase().trim();
    if (!e || matchedEmails.has(e) || seenPending.has(e)) continue;
    seenPending.add(e);
    const name = nameByEmailNote.get(e);
    pendingLeads.push({ email: e, ...(name ? { name } : {}) });
  }
  for (const c of calendarUnmatched) {
    if (!c.email || matchedEmails.has(c.email) || seenPending.has(c.email)) continue;
    seenPending.add(c.email);
    pendingLeads.push(c);
  }

  // The other side's display name: only when exactly ONE identity is on the table — one matched
  // lead, or (failing that) one pending person with a name. Anything else stays "Participant".
  let otherName = null;
  if (matched.length === 1) otherName = matched[0].name || null;
  else if (matched.length === 0 && pendingLeads.length === 1 && pendingLeads[0].name) otherName = pendingLeads[0].name;

  const transcriptText = normalizeGranolaTranscript(note, { coachName, otherName });

  const plan = {
    noteId: realNoteId,
    mode: 'single',
    title: meta.title,
    meetingStart: meta.meetingStart,
    durationSeconds: meta.durationSeconds,
    transcriptLines: transcriptText ? transcriptText.split('\n').length : 0,
    transcriptChars: transcriptText.length,
    notePeople: people,
    matchedLeads: matched,
    unmatchedEmails: remainingUnmatched,
    pendingLeads,
    source: SOURCE,
  };

  if (dryRun) return { ok: true, dryRun: true, plan, transcriptText };
  if (!ingestEnabled()) return { ok: false, error: 'GRANOLA_INGEST_ENABLED is not true — write path is disabled', plan };

  // Same no-bodyless-filing rule as Fathom: a row without words masquerades as coverage and
  // seals dedup shut. The webhook retries (Granola retries 24h; regenerated fires again too).
  if (!String(transcriptText || '').trim()) {
    log.warn(`granola note=${realNoteId} ("${meta.title || ''}") has NO transcript text — NOT filing (webhook/regenerate will retry)`);
    return { ok: false, error: 'no transcript on the note — not filed (will retry)', plan, emptyTranscript: true };
  }

  const ins = await insertImportedMeeting({
    title: meta.title,
    source: SOURCE,
    transcriptText,
    meetingStart: meta.meetingStart,
    durationSeconds: meta.durationSeconds,
    providerRecordingId: realNoteId,
    coachClientId,
    pendingLeads,
  });
  if (!ins.ok) return { ok: false, error: ins.error || 'insert failed', plan };
  if (pendingLeads.length) log.info(`granola filed with ${pendingLeads.length} PENDING lead(s) (${pendingLeads.map((x) => x.email).join(', ')})`);

  const meetingId = ins.meeting_id;
  const linkedLeads = [];
  for (const m of matched) {
    try { await addMeetingLead(meetingId, m.leadId, coachClientId, SOURCE); linkedLeads.push(m); }
    catch (e) { log.warn(`failed to link lead ${m.leadId} to meeting ${meetingId}: ${e.message}`); }
    if (m.via === 'name' && m.email) {
      try { await learnEmailForLead(coach, m.leadId, m.email); } catch (e) { log.warn(`self-heal email failed for ${m.leadId}: ${e.message}`); }
    }
  }

  // Speakers are two-way labelled by construction (coach vs other), so no reconstruction pass —
  // straight to the summary, like a clean import.
  try {
    const gen = await generateMeetingSummary(meetingId);
    if (!gen.ok) log.warn(`granola summary generation failed for meeting=${meetingId}: ${gen.error}`);
  } catch (e) {
    log.warn(`granola summary exception for meeting=${meetingId}: ${e.message}`);
  }

  log.info(`ingested granola note=${realNoteId} -> meeting_id=${meetingId} (${plan.transcriptLines} lines, ${linkedLeads.length} leads)`);
  return { ok: true, mode: 'single', meetingId, botId: ins.bot_id, plan, linkedLeads };
}

/** Dedup gate for the webhook route: has this note already been filed WITH a transcript? */
async function granolaNoteIngested(noteId) {
  return providerRecordingIngested(SOURCE, noteId);
}

module.exports = {
  ingestGranolaNote,
  granolaNoteIngested,
  fetchGranolaNote,
  normalizeGranolaTranscript,
  extractNotePeople,
  extractMeta,
  ingestEnabled,
  SOURCE,
};
