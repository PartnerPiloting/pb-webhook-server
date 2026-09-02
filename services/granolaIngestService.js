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
 * HOW A NOTE IS MATCHED TO A LEAD (rewritten 2026-09-02 after the Pedro/Mehnaaz misfile):
 *   1. The REAL span of the words comes from the transcript segments' timestamps (Granola
 *      supplies start_time/end_time per segment). Nothing is assumed about duration any more.
 *   2. The coach's calendar bookings overlapping that span are the candidates. When the words
 *      overlap MORE THAN ONE booking (a standing Zoom room, back-to-back slots), the note is
 *      SPLIT by timestamp at the natural silence between slots and each chunk is filed as its
 *      own meeting — services/granolaSplitService.js.
 *   3. Each chunk links ONLY the leads invited to ITS booking (email match, then invitee-name
 *      match with email self-heal). A chunk is never linked to leads from two bookings.
 *   4. Guards, all fail-safe (store nothing rather than guess):
 *        - no other voice in the chunk => not a meeting, dropped (the no-show waiting room);
 *        - a few seconds of other voice => dropped (an early hello / a spilled goodbye);
 *        - other voice only after the slot ended => HELD FOR REVIEW, not filed;
 *        - Granola's Zoom display name contradicts every candidate lead => HELD FOR REVIEW;
 *        - no booking overlaps the words at all => HELD FOR REVIEW (nothing to attribute to).
 *      Review holds sit in capture_pending (status 'review'); the coach sees them in
 *      wingguy_recordings and assigns a lead via wingguy_recording_release, or vetoes.
 *   5. Granola's own linked calendar event (when the coach clicked the meeting in Granola) is
 *      still used: its invitees are the leads-only gate's first evidence and, when the note is
 *      a single chunk with no calendar booking readable, its leads.
 *
 * ⚠ Speaker labels are SYNTHESISED: Granola marks segments "me" (the coach) vs "them". The
 * other side is named for the chunk's matched lead when there is exactly one, else
 * "Participant" (+ Granola's display name when present). Honest, not guessed.
 *
 * ADDITIVE + SAFE:
 *   - WRITE path gated behind GRANOLA_INGEST_ENABLED (default OFF). dryRun supported and
 *     returns the full per-chunk plan (dryRun also reports, but does not obey, a tombstone).
 *   - Rows tagged source='granola', provider_recording_id=<note id> for a single chunk or
 *     <note id>#<n> per chunk of a split note — identifiable + reversible in one DELETE.
 *     Dedup = granolaNoteIngested(noteId) matches both shapes.
 */

const clientService = require('./clientService');
const { findLeadByName, learnEmailForLead } = require('./inboundEmailService');
const { insertImportedMeeting, addMeetingLead, providerRecordingIngestedAny } = require('./recallWebhookDb');
const { generateMeetingSummary } = require('./recallSummaryService');
const { matchLeads, calendarParticipantEmails, relevantCalendarEvents } = require('./fathomIngestService');
const { dedupeMeetingEvents } = require('./fathomSplitService');
const {
  extractSegments, transcriptSpan, planGranolaChunks, speakerNameVerdict, segmentsToTranscript,
} = require('./granolaSplitService');
const { createSafeLogger } = require('../utils/loggerHelper');

const log = createSafeLogger('SYSTEM', null, 'granola_ingest');

const GRANOLA_API_BASE = (process.env.GRANOLA_API_BASE || 'https://public-api.granola.ai/v1').replace(/\/$/, '');
const SOURCE = 'granola';
const METADATA_WINDOW_CAP_MS = 4 * 60 * 60 * 1000;   // metadata-only span: created_at -> updated_at, capped
const METADATA_WINDOW_MIN_MS = 30 * 60 * 1000;

/** The write path only runs when this is explicitly enabled. */
function ingestEnabled() {
  return String(process.env.GRANOLA_INGEST_ENABLED || '').trim().toLowerCase() === 'true';
}

/** "not_abc#2" -> { baseId: "not_abc", chunkIndex: 2 }; "not_abc" -> { baseId, chunkIndex: null }. */
function parseNoteRef(ref) {
  const s = String(ref || '').trim();
  const m = s.match(/^(.*)#(\d+)$/);
  if (m) return { baseId: m[1], chunkIndex: Number(m[2]) };
  return { baseId: s, chunkIndex: null };
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

/**
 * Title + the span of the note. With a transcript on the note the span is the REAL one (first
 * segment start -> last segment end). Metadata-only (policy pre-check, hold display) it is the
 * note's created_at -> updated_at, floored at 30 min and capped at 4 h — a generous window for
 * finding candidate bookings, never used to attribute words.
 */
function extractMeta(note) {
  const title = note.title || note.name || 'Granola meeting';
  const { segments } = extractSegments(note);
  const span = transcriptSpan(segments);
  if (span) {
    const d = Math.round((Date.parse(span.end) - Date.parse(span.start)) / 1000);
    return { title, meetingStart: span.start, meetingEnd: span.end, durationSeconds: d > 0 ? d : null, spanSource: 'transcript' };
  }
  const created = note.created_at || note.meeting_start || note.started_at || note.start_time || null;
  if (!created) return { title, meetingStart: null, meetingEnd: null, durationSeconds: null, spanSource: 'none' };
  const c = Date.parse(created);
  const u = Date.parse(note.updated_at || '');
  let endMs = Number.isFinite(u) && u > c ? u : c + METADATA_WINDOW_MIN_MS;
  endMs = Math.min(Math.max(endMs, c + METADATA_WINDOW_MIN_MS), c + METADATA_WINDOW_CAP_MS);
  return { title, meetingStart: new Date(c).toISOString(), meetingEnd: new Date(endMs).toISOString(), durationSeconds: null, spanSource: 'metadata' };
}

/**
 * People attached to the note (Granola links the calendar event when the coach picked the
 * meeting in Granola). Returns [{email?, name?}] minus the coach's own addresses. Empty when
 * Granola has no calendar context — the common case when a note is opened early.
 */
function extractNotePeople(note, coachEmails = []) {
  const coachSet = new Set((coachEmails || []).map((e) => String(e).toLowerCase().trim()).filter(Boolean));
  const buckets = [note.attendees, note.people, note.participants, note.calendar_event?.attendees, note.calendar_event?.invitees];
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
 * Legacy shape kept for callers/tests: a whole note -> "Name: text" lines with no split.
 * The ingest itself renders per chunk via segmentsToTranscript.
 */
function normalizeGranolaTranscript(note, { coachName, otherName } = {}) {
  const { segments } = extractSegments(note);
  if (segments.length) return segmentsToTranscript(segments, { coachName, otherName });
  // No timestamps at all (older/odd payloads): keep the original untimed rendering.
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
    if (typeof u === 'string') label = null;
    else {
      const src = String(u.speaker?.source || u.source || '').toLowerCase();
      const attr = String(u.speaker?.attribution || '').toLowerCase();
      const diar = String(u.diarization_label || u.speaker?.diarization_label || '').trim();
      if (attr === 'me' || (!attr && src === 'microphone')) label = me;
      else label = otherName || (diar ? `Participant (${diar})` : 'Participant');
    }
    const effective = label || lastLabel || 'Speaker';
    if (lines.length && effective === lastLabel) lines[lines.length - 1] += ` ${text}`;
    else { lines.push(`${effective}: ${text}`); lastLabel = effective; }
  }
  return lines.join('\n');
}

/**
 * Leads for ONE calendar booking: invitee + organiser emails (minus the coach) matched to
 * leads; an invitee whose email matched nobody gets a unique-NAME match (email self-heals at
 * write time). Returns { matched:[{email, leadId, name, via}], pending:[{email, name?}] }.
 */
/** One entry per lead: a person invited under two addresses (primary + alt) must not link or label twice. */
function dedupeByLead(matched) {
  const seen = new Set();
  return (matched || []).filter((m) => {
    const key = m.leadId || m.email;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function leadsForEvent(coach, event, coachEmails) {
  const participants = calendarParticipantEmails(event ? [event] : [], coachEmails);
  if (!participants.length) return { matched: [], pending: [] };
  const raw = await matchLeads(coach, participants.map((x) => x.email));
  const matched = dedupeByLead(raw.matched);
  const unmatched = raw.unmatched;
  const nameByEmail = new Map(participants.map((x) => [x.email, x.name || '']));
  const pending = [];
  for (const rawEmail of unmatched) {
    const email = String(rawEmail).toLowerCase().trim();
    const name = nameByEmail.get(email);
    let healed = false;
    if (name) {
      try {
        const r = await findLeadByName(coach, name);
        if (r && r.matchType === 'unique' && r.lead?.id) {
          matched.push({ email, leadId: r.lead.id, name: [r.lead.firstName, r.lead.lastName].filter(Boolean).join(' ').trim() || name, via: 'name' });
          healed = true;
          log.info(`granola name fallback matched "${name}" -> lead ${r.lead.id} (will learn ${email})`);
        }
      } catch (e) { log.warn(`granola name fallback failed for "${name}": ${e.message}`); }
    }
    if (!healed) pending.push({ email, ...(name ? { name } : {}) });
  }
  return { matched: dedupeByLead(matched), pending };
}

/** Resolve a coach-assigned lead (review release) by email. */
async function resolveAssignedLead(coach, email) {
  const clean = String(email || '').toLowerCase().trim();
  if (!clean) return null;
  const { matched } = await matchLeads(coach, [clean]);
  return matched.length ? { ...matched[0], via: 'assigned' } : null;
}

/**
 * Ingest one Granola note (or one chunk of it, when the ref carries "#n").
 *
 * @param {object} opts
 * @param {string} opts.noteId             Granola note id, optionally "<id>#<chunk>" (required)
 * @param {string} opts.coachClientId      tenant scope (required — the webhook route knows it from its URL)
 * @param {boolean} [opts.dryRun]          if true: do everything EXCEPT write; returns the full plan
 * @param {boolean} [opts.bypassHold]      the release sweep sets this: the holding window has
 *                                         been served (or released early), so don't re-queue.
 *                                         The leads-only gate still applies — release is not
 *                                         consent to capture a no-lead call.
 * @param {string}  [opts.assignedLeadEmail] the coach's answer to a review hold: file this chunk
 *                                         to that lead (overrides the calendar's candidates).
 * @param {object[]} [opts.calendarEvents] inject calendar events (tests); else read live
 * @returns {Promise<object>} { ok, dryRun?, plan, meetingId?, filed?, held?, dropped?, skipped?, review? }
 */
async function ingestGranolaNote(opts = {}) {
  const { noteId: noteRef, coachClientId, dryRun = false, bypassHold = false, assignedLeadEmail, calendarEvents } = opts;
  if (!noteRef) return { ok: false, error: 'noteId is required' };
  if (!coachClientId) return { ok: false, error: 'coachClientId is required' };
  const { baseId: noteId, chunkIndex: onlyChunk } = parseNoteRef(noteRef);

  const coach = await clientService.getClientById(coachClientId);
  if (!coach) return { ok: false, error: `coach client ${coachClientId} not found` };
  if (!coach.granolaApiKey) return { ok: false, error: `no Granola API key for ${coachClientId}` };

  // ---- Capture policy front door (services/capturePolicyStore.js) ------------
  // Tombstone first: a deleted/vetoed note stays gone — a Granola retry or regenerate that
  // hits this walks away without fetching ANYTHING. A dry run reports it and carries on (it
  // writes nothing), so a deleted note can still be replayed to see what WOULD happen.
  const { getCapturePolicy, isCaptureBlocked, holdCapture, holdForReview } = require('./capturePolicyStore');
  let tombstoned = false;
  if (await isCaptureBlocked(SOURCE, String(noteId))) {
    if (!dryRun) {
      log.info(`granola note=${noteId} is tombstoned (deleted/vetoed) — declining, nothing fetched`);
      return { ok: true, skipped: 'tombstoned' };
    }
    tombstoned = true;
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

  const coachEmails = [coach.googleCalendarEmail, coach.calendarEmail, coach.clientEmailAddress].filter(Boolean);
  const coachName = coach.clientName || coach.clientFirstName || 'Coach';
  const coachNames = [coach.clientName, 'Guy Wilson'].filter(Boolean);

  // ---- Evidence 1: Granola's own linked calendar event (when the coach picked it) ----------
  const people = extractNotePeople(note, coachEmails);
  const peopleEmails = people.filter((p) => p.email).map((p) => p.email);
  const linkedRaw = await matchLeads(coach, peopleEmails);
  const linked = { matched: dedupeByLead(linkedRaw.matched), unmatched: linkedRaw.unmatched };

  // ---- Evidence 2: the coach's calendar over the note's span --------------------------------
  const readCalendar = async (meta) => {
    if (!meta.meetingStart || !meta.meetingEnd) return [];
    const pseudoMeeting = { recording_start_time: meta.meetingStart, recording_end_time: meta.meetingEnd };
    const events = await relevantCalendarEvents(pseudoMeeting, coach, calendarEvents);
    return dedupeMeetingEvents(events, coachNames).sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  };
  let meta = extractMeta(note);
  let events = await readCalendar(meta);

  // ---- Capture policy decision on METADATA (the words have not been fetched yet) -----------
  // LEADS-ONLY GATE, pre-check: is ANYONE on Granola's linked event or on ANY booking in the
  // window a lead? No => decline STATELESSLY. Nothing stored, not even the title; the
  // transcript was never fetched. This is only a pre-filter: the per-chunk decision below is
  // what actually stores, and under leads-only a chunk with no lead is dropped again there.
  let candidateLeads = linked.matched.slice();
  if (policy.mode === 'leads-only' || (policy.holdMinutes > 0 && !bypassHold)) {
    for (const ev of events) {
      const { matched } = await leadsForEvent(coach, ev, coachEmails);
      for (const m of matched) if (!candidateLeads.some((c) => c.leadId === m.leadId)) candidateLeads.push(m);
    }
  }
  if (policy.mode === 'leads-only' && candidateLeads.length === 0) {
    log.info(`granola note=${realNoteId} declined by leads-only gate for ${coachClientId} (nobody on the call is a lead) — nothing stored`);
    return {
      ok: true, skipped: 'leads-only-no-match', dryRun: dryRun || undefined,
      plan: { noteId: realNoteId, title: meta.title, meetingStart: meta.meetingStart, source: SOURCE, declined: true },
    };
  }
  // HOLDING WINDOW: park the capture (metadata only) and walk away. The release sweep calls
  // back with bypassHold once the window has been served or the client says "take it now".
  if (policy.holdMinutes > 0 && !bypassHold) {
    const matchedSummary = candidateLeads.map((m) => ({ ...(m.name ? { name: m.name } : {}), ...(m.email ? { email: m.email } : {}) }));
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
    meta = extractMeta(note);
    events = await readCalendar(meta);   // re-read over the REAL span
  }

  // ---- Split by timestamp, decide per chunk ------------------------------------------------
  const { segments, untimed, total } = extractSegments(note);
  let planned;
  if (segments.length) {
    planned = planGranolaChunks({ segments, events, coachNames });
  } else if (total > 0) {
    // No usable timestamps on this payload: one untimed chunk. Only Granola's OWN linked event
    // can attribute it (no window guessing) — otherwise it goes to review.
    planned = {
      span: null,
      chunks: [{
        index: 1, event: null, segments: [], untimed: true, start: meta.meetingStart, end: meta.meetingEnd,
        themSeconds: null, themCount: null, firstThemAt: null, speakerNames: [],
        verdict: linked.matched.length ? 'file' : 'review-no-timestamps',
        reason: linked.matched.length ? 'no timestamps — attributed from Granola\'s linked event' : 'no timestamps on the transcript and no linked event',
      }],
    };
  } else {
    planned = { span: null, chunks: [] };
  }
  if (untimed) log.info(`granola note=${realNoteId}: ${untimed} of ${total} segments had no timestamp and were left out of the plan`);

  const assigned = assignedLeadEmail ? await resolveAssignedLead(coach, assignedLeadEmail) : null;
  if (assignedLeadEmail && !assigned) return { ok: false, error: `assigned lead ${assignedLeadEmail} matches no lead for ${coachClientId}` };

  const multi = planned.chunks.length > 1;
  const chunkPlans = [];
  for (const c of planned.chunks) {
    if (onlyChunk != null && c.index !== onlyChunk) continue;
    let matched = [];
    let pending = [];
    let nameCheck = { verdict: 'none' };
    let verdict = c.verdict;
    let reason = c.reason;

    if (assigned) {
      matched = [assigned];
      if (verdict.startsWith('review')) { verdict = 'file'; reason = `assigned by the coach to ${assigned.name}`; }
    } else if (c.event) {
      const r = await leadsForEvent(coach, c.event, coachEmails);
      matched = r.matched;
      pending = r.pending;
    } else if (!multi && linked.matched.length) {
      // Single chunk, no calendar booking readable, but Granola itself linked an event.
      matched = linked.matched.slice();
      if (verdict === 'review-no-booking') { verdict = 'file'; reason = 'attributed from Granola\'s linked event'; }
    }

    // Zoom display name vs the calendar's candidate: a contradiction is a hold, never a guess.
    if (verdict === 'file' && matched.length && !assigned) {
      nameCheck = speakerNameVerdict(c.speakerNames, matched);
      if (nameCheck.verdict === 'mismatch') {
        verdict = 'review-name-mismatch';
        reason = `the other side's display name (${c.speakerNames.join(', ')}) matches none of: ${matched.map((m) => m.name).join(', ')}`;
      }
    }
    const otherName = matched.length === 1 ? (matched[0].name || null) : (matched.length === 0 && pending.length === 1 && pending[0].name ? pending[0].name : null);
    const transcriptText = c.untimed
      ? normalizeGranolaTranscript(note, { coachName, otherName })
      : segmentsToTranscript(c.segments, { coachName, otherName });
    const refined = require('./pendingLeadFilter').refinePendingLeads(pending, { transcriptText, coach, log });

    // A filable chunk with no lead at all. Leads-only: dropped. Open mode: when we at least
    // IDENTIFIED someone (a real invitee address that is not a lead yet), file it unlinked so the
    // pending-lead machinery attaches it when that lead is created; when nobody usable is on
    // the booking (a role address, an invite-less event) nothing would ever link it, so it goes
    // to the coach instead of vanishing into an unlinked row.
    if (verdict === 'file' && matched.length === 0) {
      if (policy.mode === 'leads-only') { verdict = 'drop-no-lead'; reason = 'leads-only: nobody on this booking is a lead'; }
      else if (refined.length) verdict = 'file-unlinked';
      else { verdict = 'review-no-lead'; reason = `booking "${String(c.event?.summary || '').trim()}" found, but nobody on it is a known lead (invitees: ${pending.map((p) => p.email).join(', ') || 'none'})`; }
    }
    const title = String(c.event?.summary || '').trim() || (multi ? `${meta.title} (part ${c.index})` : meta.title);
    const durationSeconds = c.start && c.end ? Math.max(0, Math.round((Date.parse(c.end) - Date.parse(c.start)) / 1000)) : meta.durationSeconds;

    chunkPlans.push({
      index: c.index,
      providerRecordingId: multi ? `${realNoteId}#${c.index}` : realNoteId,
      title,
      booking: c.event ? { summary: c.event.summary, start: c.event.start, end: c.event.end } : null,
      start: c.start, end: c.end, durationSeconds,
      themSeconds: c.themSeconds, themCount: c.themCount, firstThemAt: c.firstThemAt, speakerNames: c.speakerNames,
      absorbedSpillSeconds: c.absorbedSpillSeconds || undefined,
      cutSteeredByNames: c.cutSteeredByNames || undefined,
      nameCheck: nameCheck.verdict,
      matchedLeads: matched,
      pendingLeads: refined,
      verdict, reason,
      transcriptLines: transcriptText ? transcriptText.split('\n').length : 0,
      transcriptChars: transcriptText.length,
      _transcriptText: transcriptText,
    });
  }

  const plan = {
    noteId: realNoteId,
    mode: multi ? 'split' : 'single',
    title: meta.title,
    noteCreatedAt: note.created_at || null,
    span: planned.span,
    spanSource: meta.spanSource,
    linkedEvent: note.calendar_event ? { title: note.calendar_event.event_title || note.calendar_event.title || null, invitees: peopleEmails } : null,
    linkedLeads: linked.matched,
    bookings: events.map((ev) => ({ summary: ev.summary, start: ev.start, end: ev.end })),
    tombstoned: tombstoned || undefined,
    onlyChunk: onlyChunk || undefined,
    assignedLead: assigned ? { email: assigned.email, name: assigned.name } : undefined,
    chunks: chunkPlans.map(({ _transcriptText, ...rest }) => rest),
    source: SOURCE,
  };

  if (dryRun) {
    return { ok: true, dryRun: true, plan, chunkTranscripts: chunkPlans.map((c) => ({ index: c.index, verdict: c.verdict, transcriptText: c._transcriptText })) };
  }
  if (!ingestEnabled()) return { ok: false, error: 'GRANOLA_INGEST_ENABLED is not true — write path is disabled', plan };
  if (!chunkPlans.length) {
    log.warn(`granola note=${realNoteId} ("${meta.title || ''}") has NO transcript text — NOT filing (webhook/regenerate will retry)`);
    return { ok: false, error: 'no transcript on the note — not filed (will retry)', plan, emptyTranscript: true };
  }

  // ---- Write: file / hold / drop per chunk ----------------------------------------------
  const filed = [];
  const held = [];
  const dropped = [];
  for (const cp of chunkPlans) {
    if (cp.verdict.startsWith('drop') || cp.verdict === 'absorbed-into-previous') {
      dropped.push({ index: cp.index, verdict: cp.verdict, reason: cp.reason });
      log.info(`granola note=${realNoteId} chunk ${cp.index} dropped (${cp.verdict}): ${cp.reason}`);
      continue;
    }
    if (cp.verdict.startsWith('review')) {
      if (bypassHold && !assigned && onlyChunk === cp.index) {
        // A review row released without an assignment and still ambiguous: leave it in review.
        held.push({ index: cp.index, verdict: cp.verdict, reason: cp.reason, stillAmbiguous: true });
        continue;
      }
      const h = await holdForReview({
        source: SOURCE, providerRecordingId: cp.providerRecordingId, coachClientId,
        title: cp.title, meetingStart: cp.start || meta.meetingStart,
        matchedLeads: cp.matchedLeads.map((m) => ({ ...(m.name ? { name: m.name } : {}), ...(m.email ? { email: m.email } : {}) })),
        reason: `${cp.verdict}: ${cp.reason}`,
      });
      if (!h.ok) log.warn(`granola note=${realNoteId} chunk ${cp.index}: review hold failed: ${h.error}`);
      else log.info(`granola note=${realNoteId} chunk ${cp.index} HELD FOR REVIEW (${cp.verdict}): ${cp.reason}`);
      held.push({ index: cp.index, verdict: cp.verdict, reason: cp.reason, holdId: h.id || null });
      continue;
    }
    // Same no-bodyless-filing rule as Fathom: a row without words masquerades as coverage.
    if (!String(cp._transcriptText || '').trim()) {
      dropped.push({ index: cp.index, verdict: 'drop-empty', reason: 'no words' });
      continue;
    }
    const ins = await insertImportedMeeting({
      title: cp.title,
      source: SOURCE,
      transcriptText: cp._transcriptText,
      meetingStart: cp.start || meta.meetingStart,
      durationSeconds: cp.durationSeconds,
      providerRecordingId: cp.providerRecordingId,
      coachClientId,
      pendingLeads: cp.pendingLeads,
    });
    if (!ins.ok) { log.warn(`granola note=${realNoteId} chunk ${cp.index} insert failed: ${ins.error}`); continue; }
    if (ins.duplicate) { log.info(`granola note=${realNoteId} chunk ${cp.index} already filed as meeting ${ins.meeting_id}`); filed.push({ index: cp.index, meetingId: ins.meeting_id, duplicate: true }); continue; }
    const meetingId = ins.meeting_id;
    const linkedLeads = [];
    for (const m of cp.matchedLeads) {
      try { await addMeetingLead(meetingId, m.leadId, coachClientId, SOURCE); linkedLeads.push(m); }
      catch (e) { log.warn(`failed to link lead ${m.leadId} to meeting ${meetingId}: ${e.message}`); }
      if (m.via === 'name' && m.email) {
        try { await learnEmailForLead(coach, m.leadId, m.email); } catch (e) { log.warn(`self-heal email failed for ${m.leadId}: ${e.message}`); }
      }
    }
    try {
      const gen = await generateMeetingSummary(meetingId);
      if (!gen.ok) log.warn(`granola summary generation failed for meeting=${meetingId}: ${gen.error}`);
    } catch (e) {
      log.warn(`granola summary exception for meeting=${meetingId}: ${e.message}`);
    }
    filed.push({ index: cp.index, meetingId, title: cp.title, leads: linkedLeads.length, lines: cp.transcriptLines });
    log.info(`ingested granola note=${realNoteId} chunk ${cp.index} -> meeting_id=${meetingId} "${cp.title}" (${cp.transcriptLines} lines, ${linkedLeads.length} lead(s))`);
  }

  const firstFiled = filed.find((x) => x.meetingId);
  const review = held.length > 0;
  return {
    ok: true,
    mode: plan.mode,
    meetingId: firstFiled ? firstFiled.meetingId : undefined,
    filed,
    dropped,
    // `held` stays falsy unless something is actually parked (the sweep treats a truthy `held`
    // as "still in the window").
    held: review ? held : undefined,
    review: review || undefined,
    // Nothing filed and nothing held => the sweep must not retry forever; say we're done.
    skipped: (!firstFiled && !review) ? 'nothing-to-file' : undefined,
    plan,
  };
}

/** Dedup gate for the webhook route: has this note (or any chunk of it) already been filed WITH a transcript? */
async function granolaNoteIngested(noteId) {
  return providerRecordingIngestedAny(SOURCE, parseNoteRef(noteId).baseId);
}

module.exports = {
  ingestGranolaNote,
  granolaNoteIngested,
  fetchGranolaNote,
  normalizeGranolaTranscript,
  extractNotePeople,
  extractMeta,
  parseNoteRef,
  ingestEnabled,
  SOURCE,
};
