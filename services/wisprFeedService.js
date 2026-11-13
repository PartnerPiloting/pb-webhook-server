/**
 * The Wispr Flow feed - Wispr calls arrive in the transcript store by themselves (13 Nov 2026).
 *
 * WHAT IT DOES. A client records calls with Wispr Flow Notetaker (no bot - it records on their own
 * laptop). Wispr has no webhook and no REST API, so until now a Wispr call only reached Wingguy
 * when someone asked Claude to copy it across. Now: the client clicks "Connect Wispr" once
 * (routes/wisprAuthRoutes.js), and Wingguy signs in to Wispr's read-only connector as them
 * (services/wisprAuth.js) and collects new calls:
 *
 *   - every 15 minutes (heartbeat(), riding the Fathom poll's timer), and
 *   - on demand, the moment their Claude asks for a transcript (prepareForTranscriptRequest()).
 *
 * Each new recording is filed through the SAME pipeline as recall_import_transcript
 * (recallImportService.importTranscript, source 'wispr'), matched to leads with the SAME matchers
 * the Fathom ingest uses (attendee emails, unique name, the coach's own calendar booking, pending
 * leads for people not in the database yet).
 *
 * THE RULES IT KEEPS
 *   - Read-only. Nothing here can change or delete anything in Wispr.
 *   - Off unless the tenant is in WISPR_FEED_TENANTS (services/wisprConfig.js).
 *   - One filed copy per Wispr recording: Wispr's own meeting id is the store's
 *     provider_recording_id (the database refuses a second) and the feed keeps its own ledger
 *     (wispr_recordings), so a re-run does nothing.
 *   - No doubles: if another recorder already filed the same call (same tenant, the times mostly
 *     overlap), the Wispr copy is skipped.
 *   - A call whose transcript is not ready is NOT filed and is picked up on a later pass.
 *   - A recording Wispr could not match to a calendar booking, and that Wingguy cannot match
 *     either, is stored UNLINKED and flagged "needs a name". Wingguy works out a best guess from
 *     names said on the call, asks ONE question ("who was this call with?") - in chat when it
 *     matters, plus one backstop email per recording - and never files on the guess.
 *   - A dropped connection is never silent: one email per logout with a one-click reconnect link,
 *     the chat says so plainly, and after a reconnect everything since the last good check is
 *     collected.
 *
 * Everything external is reached through `deps`, so tests run this file against stand-ins.
 */

const cfg = require('./wisprConfig');
const auth = require('./wisprAuth');
const wisprClient = require('./wisprClient');
const { getStore, publicConnection } = require('./wisprStore');

const SOURCE = cfg.SOURCE;
// Decided for good - never looked at again.
const FINAL = new Set(['filed', 'unnamed', 'duplicate', 'skipped-short', 'tombstoned']);

function liveLog() {
  try { return require('../utils/loggerHelper').createSafeLogger('SYSTEM', null, 'wispr_feed'); } catch (_) { return console; }
}

/** The real world. Required lazily: clientService needs Airtable env at load, tests have none. */
function liveDeps() {
  const fathom = require('./fathomIngestService');
  const inbound = require('./inboundEmailService');
  const db = require('./recallWebhookDb');
  const filter = require('./pendingLeadFilter');
  const mailgun = require('./mailgunCreds');
  return {
    store: getStore(),
    fetchImpl: fetch,
    now: Date.now,
    log: liveLog(),
    openSession: (token) => wisprClient.openWispr(token),
    getClient: (id) => require('./clientService').getClientById(id),
    matchLeads: fathom.matchLeads,
    relevantCalendarEvents: fathom.relevantCalendarEvents,
    pickAlignedEvent: fathom.pickAlignedEvent,
    calendarParticipantEmails: fathom.calendarParticipantEmails,
    findLeadByName: inbound.findLeadByName,
    findLeadByEmail: inbound.findLeadByEmail,
    learnEmailForLead: inbound.learnEmailForLead,
    refinePendingLeads: filter.refinePendingLeads,
    claimSameLeadEmails: filter.claimSameLeadEmails,
    importTranscript: (o) => require('./recallImportService').importTranscript(o),
    providerRecordingIngested: db.providerRecordingIngested,
    findOverlappingMeetings: db.findOverlappingMeetings,
    addMeetingLead: db.addMeetingLead,
    updateMeetingTitle: db.updateMeetingTitle,
    isCaptureBlocked: (source, id) => require('./capturePolicyStore').isCaptureBlocked(source, id),
    sendMail: (fields) => mailgun.sendMailgunMessage(fields),
    fromAddress: (name) => mailgun.fromAddress(name),
    recordComm: (o) => require('./commsLog').recordComm(o),
  };
}

const withDeps = (deps) => (deps && deps.store ? deps : { ...liveDeps(), ...(deps || {}) });

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** Wispr's start/end -> ms. A missing or backwards end is taken as start + 60 minutes. */
function spanOf(m) {
  const s = Date.parse(m && m.start);
  let e = Date.parse(m && m.end);
  if (!Number.isFinite(s)) return null;
  if (!Number.isFinite(e) || e <= s) e = s + 60 * 60 * 1000;
  return { startMs: s, endMs: e, startIso: new Date(s).toISOString(), endIso: new Date(e).toISOString() };
}

/**
 * Is `row` (a filed store meeting from another recorder) the SAME call as this Wispr recording?
 * Yes when the shared time covers at least half of the Wispr recording. So a 30-minute Wispr note
 * against a Fathom copy of the same slot is a double, while a 2.5-hour Wispr recording that merely
 * contains a 30-minute Fathom call is not (it is mostly something else, and is kept).
 */
function isDouble(span, row, { share = 0.5 } = {}) {
  if (!span || !row) return false;
  const rs = Date.parse(row.meeting_start);
  if (!Number.isFinite(rs)) return false;
  let re = Date.parse(row.meeting_end);
  if (!Number.isFinite(re) || re <= rs) re = rs + (Number(row.duration_seconds) > 0 ? Number(row.duration_seconds) * 1000 : 60 * 60 * 1000);
  const overlap = Math.max(0, Math.min(re, span.endMs) - Math.max(rs, span.startMs));
  const length = span.endMs - span.startMs;
  return length > 0 && overlap / length >= share;
}

function fmtLocal(isoOrMs, tz) {
  try {
    return new Date(isoOrMs).toLocaleString('en-AU', {
      weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit', hour12: true,
      timeZone: tz || 'Australia/Brisbane',
    });
  } catch (_) { return new Date(isoOrMs).toISOString(); }
}

const minutesOf = (span) => (span ? Math.max(1, Math.round((span.endMs - span.startMs) / 60000)) : null);

const STOP_NAMES = new Set(['speaker', 'okay', 'yeah', 'thanks', 'thank', 'hello', 'sorry', 'well', 'right', 'look',
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday', 'january', 'february', 'march', 'april',
  'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december', 'next', 'steps', 'the', 'and', 'but',
  'linkedin', 'zoom', 'google', 'claude', 'wingguy', 'wispr', 'fathom', 'australia', 'english', 'christmas']);

/**
 * Names said on a call, most-said first: full names ("Roland Illyes") ahead of single first names
 * said mid-sentence ("...landed with Niman but..."). Candidates only - each still has to match
 * exactly one of the client's leads before it becomes a guess.
 */
function nameCandidates(text, { exclude = [], max = 10 } = {}) {
  const src = String(text || '');
  const skip = new Set(exclude.flatMap((n) => String(n || '').toLowerCase().split(/\s+/)).filter(Boolean));
  const ok = (w) => w.length >= 3 && !STOP_NAMES.has(w.toLowerCase()) && !skip.has(w.toLowerCase());
  const full = new Map();
  const single = new Map();
  let m;
  const fullRe = /\b([A-Z][a-z'’-]{1,})\s+([A-Z][a-z'’-]{1,})\b/g;
  while ((m = fullRe.exec(src)) !== null) {
    if (/^Speaker$/i.test(m[1])) continue;
    if (!ok(m[1]) || !ok(m[2])) continue;
    const k = `${m[1]} ${m[2]}`;
    full.set(k, (full.get(k) || 0) + 1);
  }
  const singleRe = /[a-z,;]\s+([A-Z][a-z]{2,})\b/g;
  while ((m = singleRe.exec(src)) !== null) {
    if (!ok(m[1])) continue;
    single.set(m[1], (single.get(m[1]) || 0) + 1);
  }
  const inFull = new Set([...full.keys()].flatMap((k) => k.split(' ')));
  const byCount = (a, b) => b[1] - a[1];
  const out = [...full.entries()].sort(byCount).map(([name, count]) => ({ name, count, kind: 'full' }));
  for (const [name, count] of [...single.entries()].sort(byCount)) {
    if (count < 2 || inFull.has(name)) continue;
    out.push({ name, count, kind: 'first' });
  }
  return out.slice(0, max);
}

/** Best guess at who an unnamed recording was with: the most-said name that is exactly ONE lead. */
async function guessWho({ transcript, summary, coach, coachNames }, deps) {
  const text = `${summary || ''}\n${transcript || ''}`;
  const candidates = nameCandidates(text, { exclude: coachNames, max: 8 });
  for (const c of candidates) {
    try {
      const r = await deps.findLeadByName(coach, c.name);
      if (r && r.matchType === 'unique' && r.lead && r.lead.id) {
        const name = [r.lead.firstName, r.lead.lastName].filter(Boolean).join(' ').trim() || c.name;
        return { leadId: r.lead.id, name, email: r.lead.email || '', said: c.name, count: c.count };
      }
    } catch (e) {
      deps.log.warn(`wispr guess: lookup "${c.name}" failed: ${e.message}`);
    }
  }
  return null;
}

/** Does any of these attendee names look like the person asked about? Loose on purpose. */
function attendeesMention(attendees, person) {
  const names = (attendees || []).map((a) => String((a && a.name) || a || '').toLowerCase()).filter(Boolean);
  if (!names.length) return false;
  const words = String((person && person.name) || '').toLowerCase().split(/\s+/).filter((w) => w.length > 2);
  const local = String((person && person.email) || '').toLowerCase().split('@')[0].split(/[^a-z]+/).filter((w) => w.length > 2);
  return [...words, ...local].some((w) => names.some((n) => n.includes(w)));
}

function otherRecorder(coach) {
  return !!(coach && (coach.fathomApiKey || coach.granolaApiKey || coach.firefliesApiKey));
}

// ---------------------------------------------------------------------------
// One recording
// ---------------------------------------------------------------------------

async function matchPeople({ coach, participants, span, transcript }, deps) {
  const user = (participants && participants.user) || {};
  const coachEmails = [coach.googleCalendarEmail, coach.calendarEmail, coach.clientEmailAddress, user.email]
    .map((e) => String(e || '').toLowerCase().trim()).filter(Boolean);
  const coachSet = new Set(coachEmails);
  const people = ((participants && participants.participants) || [])
    .filter((p) => p && !p.is_self && p.role !== 'self')
    .map((p) => ({
      name: String(p.name || '').trim(),
      emails: (p.emails || []).map((e) => String(e).toLowerCase().trim()).filter((e) => e && !coachSet.has(e)),
    }));

  const nameByEmail = new Map();
  for (const p of people) for (const e of p.emails) if (!nameByEmail.has(e)) nameByEmail.set(e, p.name);

  const matched = [];
  const seenLead = new Set();
  const add = (m) => { if (m.leadId && !seenLead.has(m.leadId)) { seenLead.add(m.leadId); matched.push(m); } };

  // 1. Wispr's own attendee emails.
  const byEmail = await deps.matchLeads(coach, [...nameByEmail.keys()]);
  for (const m of byEmail.matched) add(m);
  let unmatched = (byEmail.unmatched || []).map((e) => String(e).toLowerCase().trim());

  // 2. An attendee whose email matched nobody (or who has no email): a UNIQUE name match.
  const nameTries = [];
  for (const e of unmatched) nameTries.push({ email: e, name: nameByEmail.get(e) || '' });
  for (const p of people) if (!p.emails.length && p.name) nameTries.push({ email: '', name: p.name });
  const stillUnmatched = [];
  for (const t of nameTries) {
    let healed = false;
    if (t.name && !/^speaker\s*\d*$/i.test(t.name) && !t.name.includes('@')) {
      try {
        const r = await deps.findLeadByName(coach, t.name);
        if (r && r.matchType === 'unique' && r.lead && r.lead.id) {
          add({ email: t.email, leadId: r.lead.id, name: [r.lead.firstName, r.lead.lastName].filter(Boolean).join(' ').trim() || t.name, via: 'name' });
          healed = true;
        }
      } catch (e) { deps.log.warn(`wispr: name match "${t.name}" failed: ${e.message}`); }
    }
    if (!healed && t.email) stillUnmatched.push({ email: t.email, ...(t.name ? { name: t.name } : {}) });
  }

  // 3. Nobody yet: the coach's OWN calendar booking this recording belongs to (the impromptu path).
  let aligned = null;
  let calendarUnmatched = [];
  if (!matched.length && span) {
    try {
      const events = await deps.relevantCalendarEvents(
        { recording_start_time: span.startIso, recording_end_time: span.endIso }, coach, deps.calendarEvents,
      );
      aligned = deps.pickAlignedEvent(events, span.startIso, span.endIso);
      const cal = deps.calendarParticipantEmails(aligned ? [aligned] : [], coachEmails);
      if (cal.length) {
        const r = await deps.matchLeads(coach, cal.map((x) => x.email));
        for (const m of r.matched) add({ ...m, via: 'calendar-email' });
        const calName = new Map(cal.map((x) => [x.email, x.name || '']));
        calendarUnmatched = (r.unmatched || []).map((e) => {
          const clean = String(e).toLowerCase().trim();
          return { email: clean, ...(calName.get(clean) ? { name: calName.get(clean) } : {}) };
        });
      }
    } catch (e) { deps.log.warn(`wispr: calendar fallback failed: ${e.message}`); }
  }

  // 4. The same person under a second address is learned, not parked as a stranger.
  const c1 = deps.claimSameLeadEmails({ matched, candidates: stillUnmatched });
  const c2 = deps.claimSameLeadEmails({ matched, candidates: calendarUnmatched });
  const learn = [...c1.claimed, ...c2.claimed];

  // 5. People we could identify (an email) who are not leads yet -> pending leads on the meeting.
  const seen = new Set(matched.map((m) => String(m.email || '').toLowerCase()).filter(Boolean));
  const pendingRaw = [];
  for (const p of [...c1.rest, ...c2.rest]) {
    if (!p.email || seen.has(p.email)) continue;
    seen.add(p.email);
    pendingRaw.push(p);
  }
  const pendingLeads = deps.refinePendingLeads(pendingRaw, { transcriptText: transcript, coach, log: deps.log });

  return { matched, pendingLeads, learn, aligned, coachNames: [coach.clientName, user.name].filter(Boolean) };
}

/**
 * Look at one Wispr recording and do the right thing with it.
 * @returns {{action:string, ...}} action: known | tombstoned | already-filed | not-ready | no-transcript |
 *          settling | skipped-short | duplicate | filed | unnamed | failed
 */
async function processRecording({ tenant, coach, m, session, onDemand }, deps) {
  const { store, log } = deps;
  const span = spanOf(m);
  const brief = { id: m.id, title: m.title || '', attendees: (m.attendees || []).map((a) => (typeof a === 'string' ? a : (a && a.name) || '')).filter(Boolean), start: span && span.startIso, end: span && span.endIso };

  const rec = await store.getRecording(tenant, m.id);
  if (rec && FINAL.has(rec.outcome)) return { action: 'known', ...brief };

  if (await deps.isCaptureBlocked(SOURCE, String(m.id))) {
    await store.upsertRecording(tenant, m.id, { outcome: 'tombstoned', title: brief.title, startedAt: brief.start, endedAt: brief.end, detail: 'deleted by the client - never re-filed' });
    return { action: 'tombstoned', ...brief };
  }
  if (await deps.providerRecordingIngested(SOURCE, String(m.id))) {
    await store.upsertRecording(tenant, m.id, { outcome: 'filed', title: brief.title, startedAt: brief.start, endedAt: brief.end, detail: 'already in the store' });
    return { action: 'already-filed', ...brief };
  }
  if (!span) return { action: 'failed', why: 'no start time', ...brief };

  const nowMs = deps.now();
  if (m.finalized === false) return { action: 'not-ready', ...brief };
  if (!m.has_transcript) {
    return nowMs - span.endMs < cfg.TUNING.notReadyWindowMs() ? { action: 'not-ready', ...brief } : { action: 'no-transcript', ...brief };
  }
  if (!onDemand && otherRecorder(coach) && nowMs - span.endMs < cfg.TUNING.settleMs()) return { action: 'settling', ...brief };

  const full = await wisprClient.getMeetingFull(session, m.id);
  const transcript = String(full.transcript || '').trim();
  if (!transcript) return { action: 'not-ready', ...brief };
  if (transcript.length < cfg.TUNING.minTranscriptChars()) {
    await store.upsertRecording(tenant, m.id, { outcome: 'skipped-short', title: brief.title, startedAt: brief.start, endedAt: brief.end, detail: `${transcript.length} characters - nothing worth filing` });
    return { action: 'skipped-short', ...brief };
  }

  // Doubles: has another recorder already filed this same call?
  const overlapping = (await deps.findOverlappingMeetings(tenant, span.startIso, span.endIso)).filter((r) => String(r.source || '') !== SOURCE);
  const dbl = overlapping.find((r) => isDouble(span, r));
  if (dbl) {
    await store.upsertRecording(tenant, m.id, { outcome: 'duplicate', meetingId: dbl.id, title: brief.title, startedAt: brief.start, endedAt: brief.end, detail: `same call already filed by ${dbl.source || 'another recorder'} as #${dbl.id}` });
    log.info(`wispr: ${tenant} rec=${m.id} skipped - same call already filed by ${dbl.source || 'another recorder'} as meeting #${dbl.id}`);
    return { action: 'duplicate', meetingId: String(dbl.id), ...brief };
  }

  let participants = null;
  try { participants = await wisprClient.getParticipants(session, m.id); } catch (e) {
    if (e && e.code === 'WISPR_UNAUTHORIZED') throw e;
    log.warn(`wispr: ${tenant} rec=${m.id} participants unavailable (${e.message}) - matching without attendee emails`);
  }
  const who = await matchPeople({ coach, participants, span, transcript }, deps);
  const identified = who.matched.length > 0 || who.pendingLeads.length > 0;
  const coachName = coach.clientName || 'Coach';
  const durationSeconds = Math.round((span.endMs - span.startMs) / 1000);

  let title = String(m.title || '').trim();
  if (!title && who.aligned && who.aligned.summary) title = String(who.aligned.summary).trim();
  if (!title && who.matched.length) title = `${who.matched.map((x) => x.name).join(' & ')} & ${coachName}`;
  if (!title) title = `Unnamed Wispr recording - ${fmtLocal(span.startMs, coach.timezone)}`;

  let guess = null;
  if (!identified) {
    guess = await guessWho({ transcript, summary: full.summary, coach, coachNames: who.coachNames }, deps);
  }

  const r = await deps.importTranscript({
    title,
    source: SOURCE,
    transcriptText: transcript,
    meetingStart: span.startIso,
    durationSeconds,
    coachClientId: tenant,
    providerRecordingId: String(m.id),
    pendingLeads: who.pendingLeads,
    matchedLeads: who.matched,
  });
  if (!r.ok) {
    log.warn(`wispr: ${tenant} rec=${m.id} FAILED to file: ${r.error}`);
    return { action: 'failed', why: r.error, ...brief };
  }

  if (!r.duplicate) {
    for (const mm of who.matched) {
      if (mm.via === 'name' && mm.email) {
        try { await deps.learnEmailForLead(coach, mm.leadId, mm.email, { preferWork: true }); } catch (e) { log.warn(`wispr: learn email failed for ${mm.leadId}: ${e.message}`); }
      }
    }
    for (const l of who.learn) {
      try { await deps.learnEmailForLead(coach, l.leadId, l.email, { preferWork: true }); } catch (e) { log.warn(`wispr: learn email failed for ${l.leadId}: ${e.message}`); }
    }
  }

  const unnamed = !identified;
  await store.upsertRecording(tenant, m.id, {
    outcome: unnamed ? 'unnamed' : 'filed',
    meetingId: r.meetingId,
    title,
    startedAt: span.startIso,
    endedAt: span.endIso,
    needsName: unnamed,
    guess: guess || null,
    detail: unnamed
      ? 'no calendar booking and no attendee matched - stored unlinked, waiting on "who was this with?"'
      : `${who.matched.length} lead(s) linked${who.pendingLeads.length ? `, ${who.pendingLeads.length} person(s) not in the database yet` : ''}`,
  });
  log.info(`wispr: ${tenant} rec=${m.id} -> meeting #${r.meetingId} "${title}" (${transcript.length} chars, ${who.matched.length} lead(s)${who.pendingLeads.length ? `, ${who.pendingLeads.length} pending` : ''}${unnamed ? `, NEEDS A NAME${guess ? ` - guess ${guess.name}` : ''}` : ''})`);
  return {
    action: unnamed ? 'unnamed' : 'filed', meetingId: String(r.meetingId), leads: who.matched.map((x) => ({ leadId: x.leadId, name: x.name, via: x.via })),
    guess, ...brief, title,
  };
}

// ---------------------------------------------------------------------------
// One tenant
// ---------------------------------------------------------------------------

const inFlight = new Map();   // tenant -> promise of the pass that is running right now
const lastPass = new Map();   // tenant -> { at, result }

async function runPass(tenant, { onDemand }, deps) {
  const { store, log } = deps;
  const startedAt = deps.now();
  const base = { tenant, ok: false, filed: [], unnamed: [], notReady: [], duplicates: [], skipped: 0, failed: [] };

  if (!cfg.feedEnabledFor(tenant)) return { ...base, off: true, reason: 'switch is off for this tenant' };
  const conn = await store.getConnection(tenant);
  if (!conn) return { ...base, notConnected: true, reason: 'not connected' };
  if (conn.status === 'needs_reconnect') return { ...base, needsReconnect: true, reason: conn.disconnectReason || 'needs reconnect' };

  const coach = await deps.getClient(tenant);
  if (!coach) return { ...base, reason: `client ${tenant} not found` };

  const fail = async (reason) => {
    await store.updateConnection(tenant, { lastCheckAt: new Date(deps.now()).toISOString(), lastError: String(reason).slice(0, 300), lastErrorAt: new Date(deps.now()).toISOString() }).catch(() => {});
    log.warn(`wispr: ${tenant} check FAILED - ${reason}`);
    return { ...base, reason };
  };

  let token;
  let session;
  const open = async (opts = {}) => {
    token = await auth.ensureAccessToken(tenant, { store, fetchImpl: deps.fetchImpl, now: deps.now, log, ...opts });
    session = await deps.openSession(token);
  };
  try {
    try {
      await open();
    } catch (e) {
      if (e && e.code === 'WISPR_UNAUTHORIZED') {
        // The pass looked fine here and Wispr still said no: renew once and try again.
        try {
          await open({ force: true, rejected: token });
        } catch (e2) {
          if (e2 && e2.code === 'WISPR_UNAUTHORIZED') {
            await auth.markNeedsReconnect(tenant, 'Wispr rejected a freshly renewed pass', { store, now: deps.now, log });
            return { ...base, needsReconnect: true, reason: 'Wispr rejected a freshly renewed pass' };
          }
          throw e2;
        }
      } else {
        throw e;
      }
    }
  } catch (e) {
    if (e && e.code === 'WISPR_NEEDS_RECONNECT') return { ...base, needsReconnect: true, reason: 'renewal refused' };
    return fail(`could not sign in to Wispr: ${e.message}`);
  }

  try {
    const sinceMs = conn.lastSuccessAt
      ? Date.parse(conn.lastSuccessAt) - cfg.TUNING.overlapMs()
      : startedAt - cfg.TUNING.firstLookbackMs();
    const since = new Date(sinceMs).toISOString();
    const meetings = await wisprClient.searchMeetings(session, { since });
    meetings.sort((a, b) => Date.parse(a.start || 0) - Date.parse(b.start || 0));

    const out = { ...base, ok: true, since, seen: meetings.length };
    for (const m of meetings) {
      // Somebody else's note shared with this client is not their call to file.
      if (m.shared) { out.skipped++; continue; }
      let r;
      try {
        r = await processRecording({ tenant, coach, m, session, onDemand }, deps);
      } catch (e) {
        if (e && e.code === 'WISPR_UNAUTHORIZED') throw e;
        r = { action: 'failed', why: e.message, id: m.id };
        log.warn(`wispr: ${tenant} rec=${m.id} THREW: ${e.message}`);
      }
      if (r.action === 'filed') out.filed.push(r);
      else if (r.action === 'unnamed') out.unnamed.push(r);
      else if (r.action === 'not-ready') out.notReady.push(r);
      else if (r.action === 'duplicate') out.duplicates.push(r);
      else if (r.action === 'failed') out.failed.push(r);
      else out.skipped++;
    }

    const line = `seen=${out.seen} filed=${out.filed.length} unnamed=${out.unnamed.length} not-ready=${out.notReady.length} doubles=${out.duplicates.length} failed=${out.failed.length}`;
    await store.updateConnection(tenant, {
      lastCheckAt: new Date(deps.now()).toISOString(),
      // The START of this pass: anything that began while it ran is inside the next look-back.
      lastSuccessAt: new Date(startedAt).toISOString(),
      lastError: out.failed.length ? `${out.failed.length} recording(s) failed to file: ${out.failed.map((f) => `${f.id} (${f.why})`).join('; ').slice(0, 250)}` : null,
      lastErrorAt: out.failed.length ? new Date(deps.now()).toISOString() : null,
      lastResult: line,
    });
    log.info(`wispr: ${tenant} ${onDemand ? 'on-demand check' : 'poll pass'} since ${since}: ${line}`);
    return out;
  } catch (e) {
    if (e && e.code === 'WISPR_UNAUTHORIZED') {
      // Wispr said no part-way through. Renew now so the next pass starts on a new pass; if Wispr
      // refuses the renewal too, the connection really is gone.
      try {
        await auth.ensureAccessToken(tenant, { store, fetchImpl: deps.fetchImpl, now: deps.now, log, force: true, rejected: token });
      } catch (e2) {
        if (e2 && e2.code === 'WISPR_NEEDS_RECONNECT') return { ...base, needsReconnect: true, reason: 'renewal refused' };
      }
      return fail('Wispr rejected the pass part-way through a check - renewed, will retry next pass');
    }
    return fail(e.message);
  } finally {
    try { if (session) await session.close(); } catch (_) { /* nothing to do */ }
  }
}

/**
 * Check one tenant's Wispr for new recordings. One pass at a time per tenant: a second caller
 * waits for the pass that is already running and gets its result.
 */
async function syncTenant(tenant, { onDemand = false } = {}, deps) {
  const d = withDeps(deps);
  const key = String(tenant);
  if (inFlight.has(key)) return inFlight.get(key);
  const p = runPass(key, { onDemand }, d)
    .then((result) => { lastPass.set(key, { at: d.now(), result }); return result; })
    .finally(() => { inFlight.delete(key); });
  inFlight.set(key, p);
  return p;
}

/** The on-demand check: the same pass, at most once per tenant per minute. */
async function checkNow(tenant, deps) {
  const d = withDeps(deps);
  const last = lastPass.get(String(tenant));
  if (last && d.now() - last.at < cfg.TUNING.onDemandMinGapMs() && !inFlight.has(String(tenant))) return last.result;
  return syncTenant(tenant, { onDemand: true }, d);
}

// ---------------------------------------------------------------------------
// Emails (one per logout, one per unnamed recording)
// ---------------------------------------------------------------------------

const firstName = (coach) => String((coach && coach.clientName) || '').trim().split(/\s+/)[0] || 'there';
const isActive = (coach) => String((coach && coach.status) || '').trim().toLowerCase() === 'active';

function buildReconnectEmail({ coach, conn, link }) {
  const tz = coach.timezone;
  const since = conn.lastSuccessAt ? fmtLocal(conn.lastSuccessAt, tz) : null;
  const subject = 'Wingguy has lost its connection to Wispr - one click to fix';
  const text =
`Hi ${firstName(coach)},

Wingguy's connection to your Wispr Flow has dropped, so it has stopped collecting your call recordings. Wispr itself is still recording - nothing is lost.

One click reconnects it:
${link}

Click Allow on the Wispr page that opens. Wingguy then catches up on every call${since ? ` since ${since}` : ' it missed'} by itself.

- Wingguy`;
  return { subject, text };
}

/** ONE email per logout. The stamp is cleared when they reconnect, so the next logout emails again. */
async function sendReconnectEmailOnce(tenant, deps) {
  const d = withDeps(deps);
  const { store, log } = d;
  const conn = await store.getConnection(tenant);
  if (!conn || conn.status !== 'needs_reconnect' || conn.reconnectEmailedAt) return { sent: false, why: 'not needed' };
  const coach = await d.getClient(tenant);
  if (!coach || !isActive(coach)) return { sent: false, why: 'client not Active' };
  const to = String(coach.clientEmailAddress || '').trim();
  const link = auth.connectLink(tenant);
  if (!to || !link) return { sent: false, why: 'no address or link' };
  // Claim the send under the lock so two callers cannot both email.
  const claimed = await store.withConnectionLock(tenant, async (row, save) => {
    if (!row || row.status !== 'needs_reconnect' || row.reconnectEmailedAt) return false;
    await save({ reconnectEmailedAt: new Date(d.now()).toISOString() });
    return true;
  });
  if (!claimed) return { sent: false, why: 'already sent' };
  const { subject, text } = buildReconnectEmail({ coach, conn, link });
  try {
    await d.sendMail({ from: d.fromAddress('Wingguy'), to, subject, text });
    await d.recordComm({ coachClientId: tenant, channel: 'wispr-reconnect', recipient: to, subject, summary: `connection dropped: ${conn.disconnectReason || 'unknown'}` });
    log.info(`wispr: reconnect email sent to ${tenant}`);
    return { sent: true };
  } catch (e) {
    // The send failed: give the claim back so the next pass tries again.
    await store.updateConnection(tenant, { reconnectEmailedAt: null }).catch(() => {});
    log.warn(`wispr: reconnect email to ${tenant} failed: ${e.message}`);
    return { sent: false, why: e.message };
  }
}

function buildUnnamedEmail({ coach, rec }) {
  const tz = coach.timezone;
  const when = fmtLocal(rec.startedAt, tz);
  const mins = minutesOf(spanOf({ start: rec.startedAt, end: rec.endedAt }));
  const subject = `Who was your call on ${when} with?`;
  const guess = rec.guess && rec.guess.name ? `\nMy best guess from the names said on the call is ${rec.guess.name} - but I haven't filed it on a guess.\n` : '';
  const text =
`Hi ${firstName(coach)},

Wispr recorded a call on ${when}${mins ? ` (${mins} minutes)` : ''}, but it wasn't on your calendar, so I can't tell who it was with. I've kept the transcript - it just isn't filed under anyone yet.
${guess}
Next time you're in Claude, say "name my last recording" and tell it who the call was with. If it isn't one worth keeping against anyone, say "skip it" and I won't ask again.

I only send this once per recording.

- Wingguy`;
  return { subject, text };
}

/** The backstop: ONE email per unnamed recording. */
async function notifyUnnamed(tenant, deps) {
  const d = withDeps(deps);
  const { store, log } = d;
  const waiting = (await store.listNeedsName(tenant)).filter((r) => !r.askEmailedAt && !r.skippedAt && !r.namedAt);
  if (!waiting.length) return { sent: 0 };
  const coach = await d.getClient(tenant);
  if (!coach || !isActive(coach)) return { sent: 0, why: 'client not Active' };
  const to = String(coach.clientEmailAddress || '').trim();
  if (!to) return { sent: 0, why: 'no address' };
  let sent = 0;
  for (const rec of waiting.slice(0, 5)) {
    const { subject, text } = buildUnnamedEmail({ coach, rec });
    try {
      // Stamp first: a crash between the two must cost an email, never send two.
      await store.upsertRecording(tenant, rec.wisprId, { askEmailedAt: new Date(d.now()).toISOString() });
      await d.sendMail({ from: d.fromAddress('Wingguy'), to, subject, text });
      await d.recordComm({ coachClientId: tenant, channel: 'wispr-unnamed', recipient: to, subject, summary: `meeting #${rec.meetingId}`, meta: { meetingId: rec.meetingId, wisprId: rec.wisprId } });
      sent++;
    } catch (e) {
      await store.upsertRecording(tenant, rec.wisprId, { askEmailedAt: null }).catch(() => {});
      log.warn(`wispr: unnamed-recording email to ${tenant} failed: ${e.message}`);
    }
  }
  if (sent) log.info(`wispr: asked ${tenant} by email about ${sent} unnamed recording(s)`);
  return { sent };
}

// ---------------------------------------------------------------------------
// The 15-minute poll
// ---------------------------------------------------------------------------

let lastHeartbeatAt = 0;
let lastHeartbeat = null;

/** Every connected tenant the switch is on for. Never throws. */
async function pollAllWisprTenants(deps) {
  const d = withDeps(deps);
  const { store, log } = d;
  const summary = { checkedAt: new Date(d.now()).toISOString(), tenants: 0, filed: 0, unnamed: 0, notReady: 0, failed: 0, needsReconnect: [], details: [] };
  let conns;
  try { conns = await store.listConnections(); } catch (e) {
    log.warn(`wispr poll: could not list connections: ${e.message}`);
    return { ...summary, error: e.message };
  }
  for (const c of conns) {
    const tenant = c.coachClientId;
    if (!cfg.feedEnabledFor(tenant)) continue;
    summary.tenants++;
    try {
      const coach = await d.getClient(tenant);
      if (!coach || !isActive(coach)) { summary.details.push({ tenant, skipped: 'client not Active' }); continue; }
      const r = await syncTenant(tenant, { onDemand: false }, d);
      summary.filed += r.filed.length; summary.unnamed += r.unnamed.length; summary.notReady += r.notReady.length; summary.failed += r.failed.length;
      if (r.needsReconnect) {
        summary.needsReconnect.push(tenant);
        await sendReconnectEmailOnce(tenant, d);
      }
      await notifyUnnamed(tenant, d);
      summary.details.push({ tenant, ok: r.ok, reason: r.reason || null, filed: r.filed.length, unnamed: r.unnamed.length, notReady: r.notReady.length, failed: r.failed.length });
    } catch (e) {
      summary.failed++;
      summary.details.push({ tenant, error: e.message });
      log.warn(`wispr poll: ${tenant} threw: ${e.message}`);
    }
  }
  return summary;
}

/**
 * Called from the Fathom poll's timer on every tick. Does nothing at all while the switch is off
 * for everyone (not even a database read), and runs at most once per WISPR_POLL_INTERVAL_MS.
 */
async function heartbeat(deps) {
  if (!cfg.feedTenants().length) return { skipped: 'WISPR_FEED_TENANTS is empty' };
  const now = (deps && deps.now ? deps.now : Date.now)();
  // A little slack so a 15-minute interval is not pushed to 20 by a 5-minute timer landing early.
  if (lastHeartbeatAt && now - lastHeartbeatAt < cfg.TUNING.pollIntervalMs() - 30 * 1000) return { skipped: 'not due' };
  lastHeartbeatAt = now;
  lastHeartbeat = await pollAllWisprTenants(deps);
  return lastHeartbeat;
}

// ---------------------------------------------------------------------------
// When Claude asks for a transcript (recall_latest_transcript / recall_find_transcript)
// ---------------------------------------------------------------------------

/**
 * Step 1, BEFORE the store is read: for a Wispr-connected tenant, check Wispr right now so a call
 * that finished a minute ago is in the store by the time we look. Returns null when the feed has
 * nothing to do with this tenant (switch off / never connected) - the caller then behaves exactly
 * as it always has.
 */
async function prepareForTranscriptRequest(tenant, deps) {
  if (!cfg.feedEnabledFor(tenant)) return null;
  const d = withDeps(deps);
  let conn;
  try { conn = await d.store.getConnection(tenant); } catch (e) { d.log.warn(`wispr: connection lookup failed for ${tenant}: ${e.message}`); return null; }
  if (!conn) return null;
  let sync = null;
  if (conn.status !== 'needs_reconnect') {
    // Someone is waiting on this reply: give Wispr 25 seconds, then answer from the store and say
    // the check did not finish (the pass itself carries on and files whatever it finds).
    const slow = new Promise((resolve) => {
      const t = setTimeout(() => resolve({ ok: false, reason: 'Wispr was slow to answer', notReady: [], filed: [], unnamed: [] }), d.onDemandTimeoutMs || 25000);
      if (t.unref) t.unref();
    });
    try { sync = await Promise.race([checkNow(tenant, d), slow]); } catch (e) { sync = { ok: false, reason: e.message, notReady: [], filed: [], unnamed: [] }; }
    if (sync && sync.needsReconnect) conn = (await d.store.getConnection(tenant).catch(() => conn)) || conn;
  }
  let coach = null;
  try { coach = await d.getClient(tenant); } catch (_) { coach = null; }
  return { tenant, conn, sync, tz: coach && coach.timezone, deps: d };
}

/**
 * Step 2, AFTER the store has been read. Says what the reply must lead with:
 *   { block }  - do NOT serve the call that was found; relay this instead (Wispr is still writing
 *                the call up, or the newest recording has no name yet).
 *   { prefix } - serve the call, but lead with this (the connection has dropped; a fresh call was
 *                just collected; the check itself failed).
 *
 * @param {object} ctx        from prepareForTranscriptRequest (null = nothing to say)
 * @param {object} q
 * @param {number|null} q.foundStartMs  when the call the store is about to serve started (null = none found)
 * @param {object|null} q.person        { name, email } of who was asked about (null = "my last call")
 * @param {number|null} q.beforeMs      the request's own upper date bound, if it had one
 * @param {string|null} q.foundLabel    how to refer to the call found, e.g. '#123 "Title" on <date>'
 * @param {string|number|null} q.foundMeetingId  the store id of the call found (so an unnamed recording can be recognised as itself)
 */
async function decideTranscriptReply(ctx, { foundStartMs = null, person = null, beforeMs = null, foundLabel = null, foundMeetingId = null } = {}) {
  if (!ctx) return {};
  const { tenant, conn, sync, tz, deps: d } = ctx;
  const newerThanFound = (iso) => {
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) return false;
    if (beforeMs != null && t >= beforeMs) return false;
    return foundStartMs == null || t > foundStartMs;
  };
  const older = foundLabel
    ? `\nThe newest call already on file is ${foundLabel}. That is an OLDER call - do not use it in place of this one. If they say the older call is the one they mean, fetch it with recall_find_transcript and its meeting_id.`
    : '';

  if (conn.status === 'needs_reconnect') {
    const link = auth.connectLink(tenant);
    const since = conn.lastSuccessAt ? fmtLocal(conn.lastSuccessAt, tz) : 'the connection was made';
    return {
      prefix:
        `⚠ WINGGUY'S CONNECTION TO WISPR HAS DROPPED. Calls recorded since ${since} have NOT been collected, so the call they are asking about may be missing. `
        + `Tell them this plainly, give them this one-click link to reconnect - ${link} - and ask them to ask you again once they have clicked Allow. `
        + 'Wispr itself is still recording; nothing is lost, and Wingguy catches up by itself after the reconnect.'
        + (foundLabel ? ' Anything below is the newest call ALREADY on file - it may not be the call they mean; say so.' : ''),
    };
  }

  // Wispr has a recording it has not finished writing up.
  const waiting = ((sync && sync.notReady) || [])
    .filter((r) => newerThanFound(r.start))
    .filter((r) => !person || !r.attendees.length || attendeesMention(r.attendees, person))
    .sort((a, b) => Date.parse(b.start) - Date.parse(a.start));
  if (waiting.length) {
    const r = waiting[0];
    const withWho = r.attendees.length ? ` with ${r.attendees.join(', ')}` : ' (Wispr found no calendar booking for it)';
    return {
      block:
        `WISPR IS STILL WRITING UP A CALL. Wispr has a recording that started ${fmtLocal(r.start, tz)}${withWho}, and its transcript is not ready yet. `
        + 'Tell them: "Wispr is still writing up that call - try again in a couple of minutes." Then stop. Do NOT draft or answer from an earlier call.'
        + older,
    };
  }

  // The newest recording has no name yet: one question.
  let waitingForName = [];
  try {
    waitingForName = (await d.store.listNeedsName(tenant))
      .filter((r) => !r.skippedAt && !r.namedAt && r.startedAt)
      .filter((r) => d.now() - Date.parse(r.startedAt) < cfg.TUNING.askWindowMs());
  } catch (e) { d.log.warn(`wispr: needs-name lookup failed for ${tenant}: ${e.message}`); }
  // The call about to be served IS the unnamed recording ("my last call"): serve it, and ask.
  const same = foundMeetingId != null ? waitingForName.find((r) => String(r.meetingId) === String(foundMeetingId)) : null;
  if (same) {
    return { prefix: `${whoWasThisText(same, tz)} The call below IS that recording - it is filed under nobody until they say who it was with.` };
  }
  const unnamed = waitingForName.filter((r) => newerThanFound(r.startedAt));
  if (unnamed.length) {
    return { block: whoWasThisText(unnamed[0], tz) + older };
  }

  const fresh = sync && sync.ok && sync.filed && sync.filed.length
    ? `(Wingguy collected ${sync.filed.length === 1 ? 'this call' : `${sync.filed.length} calls`} from Wispr just now.)`
    : '';
  if (sync && sync.ok === false && !sync.off && !sync.notConnected) {
    return { prefix: `NOTE: Wingguy could not check Wispr for new calls just now (${sync.reason || 'unknown'}). If the call they mean is from the last hour or so it may not be here yet - say so, and try again in a few minutes.` };
  }
  return fresh ? { prefix: fresh } : {};
}

function whoWasThisText(rec, tz) {
  const mins = minutesOf(spanOf({ start: rec.startedAt, end: rec.endedAt }));
  const guess = rec.guess && rec.guess.name
    ? ` Best guess from the names said on the call: ${rec.guess.name}${rec.guess.email ? ` (${rec.guess.email})` : ''} - a guess only, so ask, do not assume.`
    : ' There is no good guess from the names said on the call.';
  return 'ONE QUESTION BEFORE ANYTHING ELSE - who was this call with? '
    + `Wingguy collected a Wispr recording it cannot put a name to: it started ${fmtLocal(rec.startedAt, tz)}${mins ? ` and ran ${mins} minutes` : ''} (stored as meeting #${rec.meetingId}). It was not on their calendar.`
    + guess
    + ` Ask them exactly that one question, with the time and length. When they answer, call wingguy_name_recording with meeting_id ${rec.meetingId} and the person's name or email. If they say "skip it", call it with skip set to true.`;
}

// ---------------------------------------------------------------------------
// Naming an unnamed recording (the wingguy_name_recording tool)
// ---------------------------------------------------------------------------

async function listUnnamed(tenant, deps) {
  const d = withDeps(deps);
  return (await d.store.listNeedsName(tenant)).filter((r) => !r.skippedAt && !r.namedAt);
}

/**
 * Attach an unnamed recording to the lead the client names, or mark it "skip it".
 * @returns {{ok, text}} text is written for Claude to relay.
 */
async function nameRecording(tenant, { meetingId, leadEmail, leadName, skip }, deps) {
  const d = withDeps(deps);
  const { store } = d;
  const coach = await d.getClient(tenant);
  const tz = coach && coach.timezone;
  const waiting = await listUnnamed(tenant, d);

  let rec = null;
  if (meetingId != null && String(meetingId).trim()) {
    rec = await store.getRecordingByMeetingId(tenant, String(meetingId).replace(/^#/, '').trim());
    if (!rec) return { ok: false, text: `Meeting #${meetingId} is not a Wispr recording Wingguy collected for this account.` };
  } else if (waiting.length === 1) {
    rec = waiting[0];
  }

  if (!rec) {
    if (!waiting.length) return { ok: true, text: 'No recordings are waiting for a name.' };
    const lines = waiting.slice(0, 10).map((r) => `  - meeting #${r.meetingId}: started ${fmtLocal(r.startedAt, tz)}, ${minutesOf(spanOf({ start: r.startedAt, end: r.endedAt })) || '?'} minutes${r.guess && r.guess.name ? ` - best guess ${r.guess.name}` : ''}`);
    return { ok: true, text: `${waiting.length} recordings are waiting for a name. Ask who each call was with, one at a time, then call this tool again with the meeting_id:\n${lines.join('\n')}` };
  }

  if (skip) {
    await store.upsertRecording(tenant, rec.wisprId, { needsName: false, skippedAt: new Date(d.now()).toISOString() });
    return { ok: true, text: `Done - Wingguy will not ask about meeting #${rec.meetingId} again. The transcript stays in the store, filed under nobody; it can be deleted for good with wingguy_recording_delete if they want it gone.` };
  }

  const email = String(leadEmail || '').trim().toLowerCase();
  const name = String(leadName || '').trim();
  if (!email && !name) {
    return { ok: true, text: whoWasThisText(rec, tz) };
  }

  let lead = null;
  if (email) {
    if (!email.includes('@')) return { ok: false, text: `"${leadEmail}" is not an email address. Pass the person's email as lead_email, or their full name as lead_name.` };
    lead = await d.findLeadByEmail(coach, email);
    if (!lead || !lead.id) return { ok: false, text: `Nobody in the Wingguy database has the email ${email}, so meeting #${rec.meetingId} is still unnamed. Offer to add them (wingguy_create_lead needs their LinkedIn link), then name the recording again.` };
  } else {
    const r = await d.findLeadByName(coach, name);
    if (r && r.matchType === 'unique' && r.lead && r.lead.id) lead = r.lead;
    else if (r && r.matchType === 'ambiguous') {
      const some = (r.allMatches || []).slice(0, 6).map((l) => `${[l.firstName, l.lastName].filter(Boolean).join(' ')}${l.email ? ` (${l.email})` : ''}${l.company ? ` - ${l.company}` : ''}`).join('; ');
      return { ok: false, text: `More than one person in the Wingguy database is called "${name}"${some ? `: ${some}` : ''}. Ask which one, then call this again with that person's email as lead_email. Meeting #${rec.meetingId} is still unnamed.` };
    } else {
      return { ok: false, text: `Nobody in the Wingguy database is called "${name}", so meeting #${rec.meetingId} is still unnamed. Check the spelling, or offer to add them (wingguy_create_lead needs their LinkedIn link), then name the recording again.` };
    }
  }

  const fullName = [lead.firstName, lead.lastName].filter(Boolean).join(' ').trim() || lead.email || name || email;
  await d.addMeetingLead(rec.meetingId, lead.id, tenant, 'wispr-named');
  if (/^Unnamed Wispr recording/i.test(String(rec.title || ''))) {
    try { await d.updateMeetingTitle(rec.meetingId, tenant, `${fullName} & ${(coach && coach.clientName) || 'Coach'}`); } catch (_) { /* the link is what matters */ }
  }
  await store.upsertRecording(tenant, rec.wisprId, { needsName: false, outcome: 'filed', namedAt: new Date(d.now()).toISOString(), namedLeadId: lead.id });
  d.log.info(`wispr: ${tenant} named meeting #${rec.meetingId} -> lead ${lead.id}`);
  return { ok: true, text: `Done - meeting #${rec.meetingId} (${fmtLocal(rec.startedAt, tz)}) is now filed under ${fullName}. recall_latest_transcript will find it under their email.` };
}

// ---------------------------------------------------------------------------
// Status (for Guy, and for the client's own Settings page)
// ---------------------------------------------------------------------------

/** One tenant's connection with the secrets left out, or null. */
async function getConnectionStatus(tenant, deps) {
  const d = deps && deps.store ? deps : { store: getStore() };
  const conn = await d.store.getConnection(tenant);
  return publicConnection(conn);
}

/** Every connection, secrets left out - for the board and the status route. */
async function getFeedStatus(deps) {
  const d = deps && deps.store ? deps : { store: getStore() };
  let connections = [];
  let error = null;
  if (cfg.feedTenants().length) {
    try { connections = (await d.store.listConnections()).map(publicConnection); } catch (e) { error = e.message; }
  }
  return {
    switchedOnFor: cfg.feedTenants(),
    registered: !!cfg.oauthClientId(),
    pollIntervalMs: cfg.TUNING.pollIntervalMs(),
    lastHeartbeat,
    connections,
    ...(error ? { error } : {}),
  };
}

/** A short line for a status cell: "connected - last check 12 min ago" / "NEEDS RECONNECT since ...". */
function statusLine(pub, nowMs = Date.now()) {
  if (!pub) return '';
  if (pub.status === 'needs_reconnect') return `wispr NEEDS RECONNECT${pub.disconnectedAt ? ` since ${String(pub.disconnectedAt).slice(0, 10)}` : ''}`;
  if (!pub.lastSuccessAt) return 'wispr connected, not checked yet';
  const mins = Math.max(0, Math.round((nowMs - Date.parse(pub.lastSuccessAt)) / 60000));
  const ago = mins < 90 ? `${mins} min ago` : (mins < 2880 ? `${Math.round(mins / 60)} h ago` : `${Math.round(mins / 1440)} days ago`);
  return `wispr connected, last good check ${ago}${pub.lastError ? ' (last check had an error)' : ''}`;
}

function _resetForTests() {
  inFlight.clear();
  lastPass.clear();
  lastHeartbeatAt = 0;
  lastHeartbeat = null;
}

module.exports = {
  SOURCE,
  // the feed
  syncTenant, checkNow, pollAllWisprTenants, heartbeat,
  // chat
  prepareForTranscriptRequest, decideTranscriptReply, nameRecording, listUnnamed, whoWasThisText,
  // emails
  sendReconnectEmailOnce, notifyUnnamed, buildReconnectEmail, buildUnnamedEmail,
  // status
  getConnectionStatus, getFeedStatus, statusLine,
  // pure, for tests
  spanOf, isDouble, nameCandidates, attendeesMention, fmtLocal, _resetForTests,
};
