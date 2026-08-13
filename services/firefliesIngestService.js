/**
 * Fireflies API ingest — the SECOND parallel transcript provider beside Fathom (after Granola).
 *
 * Takes a finished Fireflies transcript (the client's own note-taker: bot on Zoom/Meet/Teams,
 * desktop-app system audio, or the phone app for face-to-face meetings) and files it into the
 * SAME source-agnostic store a Fathom/Recall/Granola capture uses (recall_meetings +
 * recall_meeting_leads), so it flows through the existing review / summary / "I had a meeting
 * with X" lookup unchanged.
 *
 * Trigger: routes/firefliesWebhookRoutes.js (Fireflies' "transcript ready" webhook carries only
 * a meetingId; we fetch the transcript here with the CLIENT's own API key over GraphQL).
 *
 * Unlike Granola, Fireflies gives us the RICH shape: real speaker names, per-sentence
 * start_time, and attendee emails. So:
 *   - Speaker labels are REAL (bot-joined calls), preserved as-is. Phone/desktop captures fall
 *     back to Fireflies' diarization labels ("Speaker 1") — honest, not guessed.
 *   - Lines keep the [HH:MM:SS] prefix (Fathom's canonical shape), so timestamps survive into
 *     the store even though this path files one meeting per transcript (no splitter — Fireflies
 *     produces one transcript per meeting by design, like Granola).
 *
 * Lead matching reuses the Fathom ladder helpers (same order of trust): meeting attendee
 * emails -> coach's own calendar window (attendees + organizer) -> attendee NAME (unique match,
 * email self-heal) -> dominant non-coach SPEAKER name -> PENDING leads for the rest.
 *
 * ADDITIVE + SAFE (mirrors services/granolaIngestService.js):
 *   - New file; nothing calls it except the (gated) Fireflies webhook route.
 *   - WRITE path gated behind FIREFLIES_INGEST_ENABLED (default OFF). dryRun supported.
 *   - Rows tagged source='fireflies', provider_recording_id=<transcript id> — identifiable +
 *     reversible in one DELETE (leads cascade). Dedup = providerRecordingIngested('fireflies',
 *     id), same "only a non-empty transcript counts" semantics as Fathom/Granola.
 *   - API SHAPE: written against docs.fireflies.ai (GraphQL `transcript(id:)`). Fireflies dates
 *     arrive as epoch ms, duration in MINUTES, sentence start_time in SECONDS — all parsed
 *     defensively; verify against a real transcript on first live use (guinea pig: Rick Wong).
 */

const clientService = require('./clientService');
const { findLeadByName, learnEmailForLead } = require('./inboundEmailService');
const { insertImportedMeeting, addMeetingLead, providerRecordingIngested } = require('./recallWebhookDb');
const { generateMeetingSummary } = require('./recallSummaryService');
const { matchLeads, calendarParticipantEmails, relevantCalendarEvents } = require('./fathomIngestService');
const { createSafeLogger } = require('../utils/loggerHelper');

const log = createSafeLogger('SYSTEM', null, 'fireflies_ingest');

const FIREFLIES_API_URL = (process.env.FIREFLIES_API_URL || 'https://api.fireflies.ai/graphql').replace(/\/$/, '');
const SOURCE = 'fireflies';

/** The write path only runs when this is explicitly enabled. */
function ingestEnabled() {
  return String(process.env.FIREFLIES_INGEST_ENABLED || '').trim().toLowerCase() === 'true';
}

// Metadata-only vs full query: the capture-policy layer decides whether the WORDS may be
// fetched at all, so `sentences` stays out of the query until the gate has passed — the
// transcript never leaves Fireflies for a declined capture.
const META_FIELDS = `
    id
    title
    date
    duration
    host_email
    organizer_email
    participants
    meeting_attendees { displayName email name }
`;
const QUERY_META = `query Transcript($id: String!) { transcript(id: $id) {${META_FIELDS}} }`;
const QUERY_FULL = `query Transcript($id: String!) { transcript(id: $id) {${META_FIELDS}
    sentences { speaker_name text start_time }
} }`;

/**
 * Fetch one transcript from the Fireflies GraphQL API. Partial data + errors is a real GraphQL
 * outcome (e.g. a plan-gated field) — we take the transcript if it came back and log the rest.
 */
async function fetchFirefliesTranscript(transcriptId, apiKey, { includeSentences = true } = {}) {
  let res;
  try {
    res = await fetch(FIREFLIES_API_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: includeSentences ? QUERY_FULL : QUERY_META,
        variables: { id: String(transcriptId) },
      }),
    });
  } catch (e) {
    return { ok: false, error: `Fireflies API unreachable: ${e.message}` };
  }
  if (!res.ok) {
    return { ok: false, error: `Fireflies API ${res.status} ${res.statusText}` };
  }
  let data;
  try { data = await res.json(); } catch (_e) { return { ok: false, error: 'Fireflies API returned non-JSON' }; }
  const transcript = data?.data?.transcript || null;
  if (Array.isArray(data?.errors) && data.errors.length) {
    const msgs = data.errors.map((e) => e?.message || 'unknown').join('; ');
    if (!transcript) return { ok: false, error: `Fireflies GraphQL error: ${msgs}` };
    log.warn(`fireflies transcript=${transcriptId} returned partial data with errors: ${msgs}`);
  }
  if (!transcript || !transcript.id) return { ok: false, error: 'Fireflies API returned no transcript object' };
  return { ok: true, transcript };
}

/** Title + start time + duration off the transcript. `date` = epoch ms; `duration` = minutes. */
function extractMeta(t) {
  const title = t.title || 'Fireflies meeting';
  let meetingStart = null;
  if (t.date != null) {
    const ms = typeof t.date === 'number' ? t.date : Date.parse(t.date);
    if (Number.isFinite(ms) && ms > 0) meetingStart = new Date(ms).toISOString();
  }
  let durationSeconds = null;
  const durMin = Number(t.duration);
  if (Number.isFinite(durMin) && durMin > 0) durationSeconds = Math.round(durMin * 60);
  const meetingEnd = meetingStart && durationSeconds
    ? new Date(Date.parse(meetingStart) + durationSeconds * 1000).toISOString()
    : null;
  return { title, meetingStart, meetingEnd, durationSeconds };
}

/**
 * People on the transcript: meeting_attendees (name + email), the bare `participants` email
 * list, and host/organizer emails — minus the coach's own addresses. Returns [{email?, name?}].
 * Empty when Fireflies had no calendar context (phone capture of a face-to-face) — the
 * coach's-own-calendar fallback covers that case.
 */
function extractPeople(t, coachEmails = []) {
  const coachSet = new Set((coachEmails || []).map((e) => String(e).toLowerCase().trim()).filter(Boolean));
  const out = new Map(); // email (or name-key) -> {email?, name?}
  const add = (email, name) => {
    const e = String(email || '').toLowerCase().trim();
    const n = String(name || '').trim();
    if (e && coachSet.has(e)) return;
    const key = e || (n ? `name:${n.toLowerCase()}` : '');
    if (!key) return;
    const prev = out.get(key);
    if (!prev) out.set(key, { ...(e ? { email: e } : {}), ...(n ? { name: n } : {}) });
    else if (!prev.name && n) out.set(key, { ...prev, name: n });
  };
  for (const a of (Array.isArray(t.meeting_attendees) ? t.meeting_attendees : [])) {
    if (a) add(a.email, a.displayName || a.name);
  }
  for (const e of (Array.isArray(t.participants) ? t.participants : [])) add(e, '');
  add(t.host_email, '');
  add(t.organizer_email, '');
  return [...out.values()];
}

/** Seconds -> [HH:MM:SS] (the Fathom canonical prefix; timestamps are load-bearing there). */
function fmtTimestamp(sec) {
  const s = Math.max(0, Math.round(Number(sec) || 0));
  const h = String(Math.floor(s / 3600)).padStart(2, '0');
  const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `[${h}:${m}:${ss}]`;
}

/**
 * Fireflies sentences -> canonical "[HH:MM:SS] Name: text" lines. Speaker names are real on
 * bot-joined calls; diarization labels ("Speaker 1") on phone/desktop captures pass through
 * as-is. Consecutive same-speaker sentences merge into one line (first timestamp kept) so the
 * store reads like a conversation, not confetti.
 */
function normalizeFirefliesTranscript(t) {
  const sentences = Array.isArray(t.sentences) ? t.sentences : [];
  const lines = [];
  let lastSpeaker = null;
  for (const s of sentences) {
    if (!s) continue;
    const text = String(s.text ?? '').trim();
    if (!text) continue;
    const speaker = String(s.speaker_name || '').trim() || 'Speaker';
    if (lines.length && speaker === lastSpeaker) {
      lines[lines.length - 1] += ` ${text}`;
    } else {
      lines.push(`${fmtTimestamp(s.start_time)} ${speaker}: ${text}`);
      lastSpeaker = speaker;
    }
  }
  return lines.join('\n');
}

/**
 * Dominant non-coach speaker by word count — the LAST rung of the ladder, same idea as Fathom's
 * dominantSpeakerName. Generic diarization labels ("Speaker 1") are never returned: matching
 * those against lead names would be noise.
 */
function dominantOtherSpeaker(t, coachName) {
  const sentences = Array.isArray(t.sentences) ? t.sentences : [];
  const coach = String(coachName || '').trim().toLowerCase();
  const counts = new Map();
  for (const s of sentences) {
    const name = String(s?.speaker_name || '').trim();
    if (!name) continue;
    if (/^speaker(\s*\d+)?$/i.test(name)) continue;
    if (coach && name.toLowerCase() === coach) continue;
    counts.set(name, (counts.get(name) || 0) + String(s.text || '').split(/\s+/).length);
  }
  let best = null;
  for (const [name, words] of counts) if (!best || words > best.words) best = { name, words };
  return best ? best.name : null;
}

/**
 * Ingest one Fireflies transcript.
 *
 * @param {object} opts
 * @param {string} opts.transcriptId       Fireflies transcript/meeting id (required)
 * @param {string} opts.coachClientId      tenant scope (required — the webhook route knows it from its URL)
 * @param {boolean} [opts.dryRun]          if true: do everything EXCEPT write
 * @param {boolean} [opts.bypassHold]      the release sweep sets this: the holding window has
 *                                         been served (or released early), so don't re-queue.
 *                                         The leads-only gate still applies — release is not
 *                                         consent to capture a no-lead call.
 * @param {object[]} [opts.calendarEvents] inject calendar events (tests); else read live
 * @returns {Promise<object>} { ok, dryRun?, plan, meetingId?, linkedLeads?, held?, skipped? }
 */
async function ingestFirefliesTranscript(opts = {}) {
  const { transcriptId, coachClientId, dryRun = false, bypassHold = false, calendarEvents } = opts;
  if (!transcriptId) return { ok: false, error: 'transcriptId is required' };
  if (!coachClientId) return { ok: false, error: 'coachClientId is required' };

  const coach = await clientService.getClientById(coachClientId);
  if (!coach) return { ok: false, error: `coach client ${coachClientId} not found` };
  if (!coach.firefliesApiKey) return { ok: false, error: `no Fireflies API key for ${coachClientId}` };

  // ---- Capture policy front door (services/capturePolicyStore.js) ------------
  // Tombstone first: a deleted/vetoed transcript stays gone — a Fireflies retry that hits this
  // walks away without fetching ANYTHING.
  const { getCapturePolicy, isCaptureBlocked, holdCapture } = require('./capturePolicyStore');
  if (await isCaptureBlocked(SOURCE, String(transcriptId))) {
    log.info(`fireflies transcript=${transcriptId} is tombstoned (deleted/vetoed) — declining, nothing fetched`);
    return { ok: true, skipped: 'tombstoned' };
  }
  const policy = getCapturePolicy(coach);
  // Metadata-first when the policy has anything to decide: the words must not leave Fireflies
  // until the gate has passed and the window has been served. Open clients keep a single fetch.
  const metadataFirst = policy.mode === 'leads-only' || (policy.holdMinutes > 0 && !bypassHold);

  const f = await fetchFirefliesTranscript(transcriptId, coach.firefliesApiKey, { includeSentences: !metadataFirst });
  if (!f.ok) return f;
  let transcript = f.transcript;
  const realId = String(transcript.id || transcriptId);

  const meta = extractMeta(transcript);
  const coachEmails = [coach.googleCalendarEmail, coach.clientEmailAddress].filter(Boolean);
  const coachName = coach.clientName || coach.clientFirstName || 'Coach';

  // ---- Lead ladder (same trust order as Fathom's single path) ----------------
  const people = extractPeople(transcript, coachEmails);
  const peopleEmails = people.filter((p) => p.email).map((p) => p.email);
  const { matched, unmatched } = await matchLeads(coach, peopleEmails);

  // Coach's-own-calendar fallback: Fireflies had no (or unmatched) people on the transcript —
  // the booking on the coach's calendar carries the real participant emails, organizer included.
  // This is also the identity path for phone captures of face-to-face meetings, IF the coach
  // put the meeting in their calendar with the person's email (teach this at onboarding).
  let calendarUnmatched = [];
  if (matched.length === 0 && meta.meetingStart) {
    const startIso = new Date(meta.meetingStart).toISOString();
    const endIso = meta.meetingEnd
      ? new Date(meta.meetingEnd).toISOString()
      : new Date(Date.parse(meta.meetingStart) + 60 * 60 * 1000).toISOString(); // no duration — assume an hour
    const pseudoMeeting = { recording_start_time: startIso, recording_end_time: endIso };
    const events = await relevantCalendarEvents(pseudoMeeting, coach, calendarEvents);
    const calParticipants = calendarParticipantEmails(events, coachEmails);
    const cal = calParticipants.length ? await matchLeads(coach, calParticipants.map((x) => x.email)) : { matched: [], unmatched: [] };
    for (const m of cal.matched) matched.push({ ...m, via: 'calendar-email' });
    if (cal.matched.length) log.info(`fireflies calendar-email fallback matched ${cal.matched.length} lead(s) from ${calParticipants.length} calendar participant(s)`);
    const nameByEmail = new Map(calParticipants.map((x) => [x.email, x.name || '']));
    calendarUnmatched = (cal.unmatched || []).map((e) => {
      const clean = String(e).toLowerCase().trim();
      const name = nameByEmail.get(clean);
      return { email: clean, ...(name ? { name } : {}) };
    });
  }

  // NAME fallback: a transcript person whose email matched no lead (or who had no email at all)
  // still gets a shot via their name — unique match links the lead and self-heals the email.
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
          log.info(`fireflies name fallback matched "${name}" -> lead ${r.lead.id} (will learn ${rawEmail})`);
        }
      } catch (e) { log.warn(`fireflies name fallback failed for "${name}": ${e.message}`); }
    }
    if (!healed) remainingUnmatched.push(rawEmail);
  }

  // ---- Capture policy decision (the ladder above is now final) ---------------
  // LEADS-ONLY GATE: nobody on this call is a lead => decline STATELESSLY. Nothing stored, not
  // even the title; the sentences were never fetched (metadata-only pass). Miss beats leak.
  if (policy.mode === 'leads-only' && matched.length === 0) {
    log.info(`fireflies transcript=${realId} declined by leads-only gate for ${coachClientId} (nobody on the call is a lead) — nothing stored`);
    return {
      ok: true, skipped: 'leads-only-no-match', dryRun: dryRun || undefined,
      plan: { transcriptId: realId, title: meta.title, meetingStart: meta.meetingStart, source: SOURCE, declined: true },
    };
  }
  // HOLDING WINDOW: park the capture (metadata only) and walk away. The release sweep calls
  // back with bypassHold once the window has been served or the client says "take it now".
  if (policy.holdMinutes > 0 && !bypassHold) {
    const matchedSummary = matched.map((m) => ({ ...(m.name ? { name: m.name } : {}), ...(m.email ? { email: m.email } : {}) }));
    if (dryRun) {
      return { ok: true, dryRun: true, wouldHold: true, holdMinutes: policy.holdMinutes, plan: { transcriptId: realId, title: meta.title, matchedLeads: matchedSummary, source: SOURCE } };
    }
    const held = await holdCapture({
      source: SOURCE, providerRecordingId: realId, coachClientId,
      title: meta.title, meetingStart: meta.meetingStart, matchedLeads: matchedSummary,
      holdMinutes: policy.holdMinutes,
    });
    if (!held.ok) return { ok: false, error: `failed to queue capture: ${held.error}` };
    log.info(`fireflies transcript=${realId} HELD for ${coachClientId} (${policy.holdMinutes} min window${held.alreadyHeld ? ', already queued' : ''}) — sentences not fetched`);
    return { ok: true, held: true, releaseAt: held.releaseAt || held.release_at || null, alreadyHeld: !!held.alreadyHeld };
  }
  // Policy passed on a metadata-only pass: NOW the words may leave Fireflies.
  if (metadataFirst) {
    const full = await fetchFirefliesTranscript(transcriptId, coach.firefliesApiKey, { includeSentences: true });
    if (!full.ok) return full;
    transcript = full.transcript;
  }

  // DOMINANT-SPEAKER fallback: still nobody matched, but the transcript names a real person who
  // did most of the other side's talking (bot-joined calls carry real names) — last rung.
  if (matched.length === 0) {
    const domName = dominantOtherSpeaker(transcript, coachName);
    if (domName) {
      try {
        const r = await findLeadByName(coach, domName);
        if (r && r.matchType === 'unique' && r.lead?.id) {
          matched.push({
            email: null,
            leadId: r.lead.id,
            name: [r.lead.firstName, r.lead.lastName].filter(Boolean).join(' ').trim() || domName,
            via: 'speaker-name',
          });
          log.info(`fireflies dominant-speaker fallback matched "${domName}" -> lead ${r.lead.id}`);
        }
      } catch (e) { log.warn(`fireflies dominant-speaker fallback failed for "${domName}": ${e.message}`); }
    }
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

  const transcriptText = normalizeFirefliesTranscript(transcript);

  const plan = {
    transcriptId: realId,
    mode: 'single',
    title: meta.title,
    meetingStart: meta.meetingStart,
    durationSeconds: meta.durationSeconds,
    transcriptLines: transcriptText ? transcriptText.split('\n').length : 0,
    transcriptChars: transcriptText.length,
    transcriptPeople: people,
    matchedLeads: matched,
    unmatchedEmails: remainingUnmatched,
    pendingLeads,
    source: SOURCE,
  };

  if (dryRun) return { ok: true, dryRun: true, plan, transcriptText };
  if (!ingestEnabled()) return { ok: false, error: 'FIREFLIES_INGEST_ENABLED is not true — write path is disabled', plan };

  // Same no-bodyless-filing rule as Fathom/Granola: a row without words masquerades as coverage
  // and seals dedup shut. Fireflies retries give the natural re-attempt.
  if (!String(transcriptText || '').trim()) {
    log.warn(`fireflies transcript=${realId} ("${meta.title || ''}") has NO sentences — NOT filing (webhook retry will re-attempt)`);
    return { ok: false, error: 'no sentences on the transcript — not filed (will retry)', plan, emptyTranscript: true };
  }

  const ins = await insertImportedMeeting({
    title: meta.title,
    source: SOURCE,
    transcriptText,
    meetingStart: meta.meetingStart,
    durationSeconds: meta.durationSeconds,
    providerRecordingId: realId,
    coachClientId,
    pendingLeads,
  });
  if (!ins.ok) return { ok: false, error: ins.error || 'insert failed', plan };
  if (pendingLeads.length) log.info(`fireflies filed with ${pendingLeads.length} PENDING lead(s) (${pendingLeads.map((x) => x.email).join(', ')})`);

  const meetingId = ins.meeting_id;
  const linkedLeads = [];
  for (const m of matched) {
    try { await addMeetingLead(meetingId, m.leadId, coachClientId, SOURCE); linkedLeads.push(m); }
    catch (e) { log.warn(`failed to link lead ${m.leadId} to meeting ${meetingId}: ${e.message}`); }
    if (m.via === 'name' && m.email) {
      try { await learnEmailForLead(coach, m.leadId, m.email); } catch (e) { log.warn(`self-heal email failed for ${m.leadId}: ${e.message}`); }
    }
  }

  // Speakers arrive labelled (real names or diarization labels), so no reconstruction pass —
  // straight to the summary, like a clean import.
  try {
    const gen = await generateMeetingSummary(meetingId);
    if (!gen.ok) log.warn(`fireflies summary generation failed for meeting=${meetingId}: ${gen.error}`);
  } catch (e) {
    log.warn(`fireflies summary exception for meeting=${meetingId}: ${e.message}`);
  }

  log.info(`ingested fireflies transcript=${realId} -> meeting_id=${meetingId} (${plan.transcriptLines} lines, ${linkedLeads.length} leads)`);
  return { ok: true, mode: 'single', meetingId, botId: ins.bot_id, plan, linkedLeads };
}

/** Dedup gate for the webhook route: has this transcript already been filed WITH words? */
async function firefliesTranscriptIngested(transcriptId) {
  return providerRecordingIngested(SOURCE, transcriptId);
}

module.exports = {
  ingestFirefliesTranscript,
  firefliesTranscriptIngested,
  fetchFirefliesTranscript,
  normalizeFirefliesTranscript,
  dominantOtherSpeaker,
  extractPeople,
  extractMeta,
  ingestEnabled,
  SOURCE,
};
