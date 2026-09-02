/**
 * Granola split planner — carves ONE Granola note into the meetings it actually contains, using
 * the per-segment timestamps Granola supplies, and decides per chunk whether it is safe to file.
 *
 * Born from the 2026-08-21 misfile (Pedro Demartini's call filed on Mehnaaz Ahmed's record):
 * a note opened early in the coach's standing Zoom room had NO linked calendar event, so the
 * ingest guessed a one-hour window from the note's creation time and linked every lead booked
 * inside it. The guess put a no-show's slot on the transcript and missed the real caller by
 * three minutes. Four more notes in August got a neighbouring lead stuck on them the same way.
 *
 * Granola gives us better evidence than the code used to believe: every transcript segment has
 * `start_time` / `end_time`, and `speaker.attribution` says "me" (the coach) or "them", with
 * `speaker.name` (the Zoom display name) sometimes present. This module uses all three.
 *
 * PURE: no I/O, no Airtable, no calendar reads. The ingest service feeds it segments + the
 * coach's calendar events overlapping the real span and acts on the verdicts. Tested by
 * tests/test-granola-split.js.
 *
 * FAIL-SAFE BY DESIGN — every verdict other than 'file' stores nothing for that chunk:
 *   drop-no-other-voice   only the coach spoke (the waiting room, or the coach talking to
 *                         themselves before a no-show) — not a meeting.
 *   drop-too-short        the other side said a few words only (an early "hello" from the next
 *                         caller, a "bye" that spilled over a cut) — too thin to attribute.
 *   review-late-voice     the other side only started talking AFTER the booking's slot had
 *                         ended — probably not the booked person. Held for the coach to assign.
 *   review-no-booking     no calendar booking overlaps the words at all — nothing to attribute
 *                         to. Held for the coach.
 */

const PRE_ROLL_MS = 5 * 60 * 1000;         // a caller may join up to 5 min before their slot
const CUT_ZONE_MS = 5 * 60 * 1000;         // look for the natural silence within ±5 min of a boundary
const MIN_GAP_MS = 20 * 1000;              // a silence shorter than this is not a change of meeting
const MIN_THEM_SECONDS = 45;               // less other-voice speech than this is not a conversation
const MIN_THEM_SEGMENTS = 4;
const MIN_CONTIGUOUS_THEM_SECONDS = 5 * 60; // a chunk cut out of CONTINUOUS talk (no silence at the
                                            // boundary) must hold a real meeting's worth of other
                                            // voice, else it is the previous call spilling over

function ms(x) {
  if (x == null) return NaN;
  if (x instanceof Date) return x.getTime();
  const n = typeof x === 'number' ? x : Date.parse(String(x));
  return Number.isFinite(n) ? n : NaN;
}

/**
 * Granola note -> flat segment list [{ t0, t1, me, name, text }] sorted by start time.
 * Segments without a usable timestamp are dropped from the PLAN (they cannot be placed), and
 * the count is reported so the ingest can fall back to the untimed path when none have one.
 */
function extractSegments(note) {
  const raw = Array.isArray(note?.transcript) ? note.transcript
    : Array.isArray(note?.transcript?.segments) ? note.transcript.segments : [];
  const out = [];
  let untimed = 0;
  for (const u of raw) {
    if (!u || typeof u !== 'object') continue;
    const text = String(u.text ?? u.content ?? '').trim();
    if (!text) continue;
    const t0 = ms(u.start_time ?? u.startTime ?? u.start);
    const t1raw = ms(u.end_time ?? u.endTime ?? u.end);
    if (!Number.isFinite(t0)) { untimed++; continue; }
    const t1 = Number.isFinite(t1raw) && t1raw >= t0 ? t1raw : t0;
    const sp = u.speaker && typeof u.speaker === 'object' ? u.speaker : {};
    const attribution = String(sp.attribution || '').toLowerCase();
    const source = String(sp.source || u.source || '').toLowerCase();
    const me = attribution === 'me' || (!attribution && source === 'microphone');
    const name = String(sp.name || '').trim();
    out.push({ t0, t1, me, name, text });
  }
  out.sort((a, b) => a.t0 - b.t0);
  return { segments: out, untimed, total: raw.length };
}

/** The real span of the words: first segment start -> last segment end. */
function transcriptSpan(segments) {
  if (!segments || !segments.length) return null;
  let end = -Infinity;
  for (const s of segments) if (s.t1 > end) end = s.t1;
  return { start: new Date(segments[0].t0).toISOString(), end: new Date(end).toISOString() };
}

/** Other-voice statistics for a run of segments. */
function themStats(segs) {
  let themSeconds = 0;
  let themCount = 0;
  let firstThemAt = null;
  const names = new Set();
  for (const s of segs) {
    if (s.me) continue;
    themCount++;
    themSeconds += Math.max(0, (s.t1 - s.t0) / 1000);
    if (firstThemAt == null) firstThemAt = s.t0;
    if (s.name) names.add(s.name);
  }
  return { themSeconds: Math.round(themSeconds), themCount, firstThemAt, speakerNames: [...names] };
}

/**
 * Where to cut between two consecutive bookings: the longest silence (>= 20 s) between
 * segments inside the zone [prev.end - 5 min, next.start + 5 min], so an overrunning goodbye
 * stays with the earlier call and an early hello goes with the later one. No such silence
 * (the talk ran straight through, or nobody spoke in the zone) => cut at the next booking's
 * start exactly and flag the cut as `contiguous`, which makes the later chunk prove itself.
 * Returns { cut, contiguous, gapMs }.
 */
function cutBetween(segments, prevEndMs, nextStartMs) {
  const zoneStart = Math.min(prevEndMs, nextStartMs) - CUT_ZONE_MS;
  const zoneEnd = nextStartMs + CUT_ZONE_MS;
  let bestGap = -1;
  let bestCut = null;
  let anyInZone = false;
  for (let i = 0; i < segments.length - 1; i++) {
    const a = segments[i];
    const b = segments[i + 1];
    if (b.t0 < zoneStart || b.t0 > zoneEnd) continue;
    anyInZone = true;
    const gap = b.t0 - a.t1;
    if (gap > bestGap) { bestGap = gap; bestCut = b.t0; }
  }
  if (bestCut != null && bestGap >= MIN_GAP_MS) return { cut: bestCut, contiguous: false, gapMs: bestGap };
  // Words either side of the boundary with no silence: the talk is continuous across it.
  const before = segments.some((s) => s.t1 <= nextStartMs && s.t1 >= zoneStart);
  const after = segments.some((s) => s.t0 >= nextStartMs && s.t0 <= zoneEnd);
  return { cut: nextStartMs, contiguous: anyInZone && before && after, gapMs: bestGap < 0 ? null : bestGap };
}

/** "melissajarmyn" -> "melissajarmyn"; "Guy Wilson (Wingguy)" -> "guywilsonwingguy". */
function squash(s) {
  return String(s || '').toLowerCase().replace(/[^a-z]/g, '');
}

/**
 * The people a booking is with, as name tokens (squashed, 3+ letters): non-self attendee
 * display names plus the parts of the title ("Jay Critchley & Guy Wilson", "April & Guy
 * LinkedIn"), minus the coach. Used to steer a cut when Granola supplies display names.
 */
function eventPeopleTokens(ev, coachNames = []) {
  const coach = new Set((coachNames || []).flatMap((n) => [squash(n), ...String(n).split(/\s+/).map(squash)]).filter((t) => t.length >= 3));
  const out = new Set();
  const add = (name) => {
    for (const part of [String(name || ''), ...String(name || '').split(/\s+/)]) {
      const t = squash(part);
      if (t.length >= 3 && !coach.has(t)) out.add(t);
    }
  };
  for (const a of (ev?.attendees || [])) if (!a.self) add(a.displayName);
  for (const part of String(ev?.summary || '').split(/\s*(?:&|\band\b|\/|—|–|\bwith\b)\s*/i)) {
    // "Guy & CW - Connect" -> drop generic words; keep person-looking parts
    const cleaned = part.replace(/\b(meeting|call|catch ?up|connect|intro|linkedin|chat|onboarding)\b/gi, '').trim();
    if (cleaned && cleaned.split(/\s+/).length <= 3) add(cleaned);
  }
  return [...out];
}

/** Does a display name relate to any of these tokens? (either contains the other) */
function nameHits(displayName, tokens) {
  const n = squash(displayName);
  if (n.length < 3) return false;
  return (tokens || []).some((t) => n.includes(t) || t.includes(n));
}

/**
 * Steer a CONTIGUOUS cut with Granola's display names, when it has them: the talk ran straight
 * through the boundary, so the first lines after the cut may still be the previous caller
 * saying goodbye. If lines after the cut are named for the PREVIOUS booking's person and are
 * followed by a line named for the NEXT booking's person, move the cut to sit between them.
 * Never moves the cut earlier, never past the next-named line, and does nothing without names.
 */
function refineCutByNames(segments, cut, prevTokens, nextTokens) {
  if (!prevTokens?.length || !nextTokens?.length) return cut;
  let lastPrevNamedEnd = null;
  for (const s of segments) {
    if (s.t0 < cut) continue;
    if (s.me || !s.name) continue;
    if (nameHits(s.name, nextTokens) && !nameHits(s.name, prevTokens)) break;   // the next caller is here
    if (nameHits(s.name, prevTokens)) lastPrevNamedEnd = s;
  }
  if (!lastPrevNamedEnd) return cut;
  // Cut just after the previous caller's last named line: the next segment's start.
  const after = segments.find((s) => s.t0 > lastPrevNamedEnd.t0);
  return after ? after.t0 : cut;
}

/**
 * Plan the chunks.
 *
 * @param {object} p
 * @param {object[]} p.segments   from extractSegments(note).segments
 * @param {object[]} p.events     calendar events overlapping the span: { summary, start, end, ... }
 *                                (already filtered to real meetings by the caller)
 * @param {string[]} [p.coachNames]
 * @returns {{ span, chunks: object[] }} chunks: { index, event, segments, start, end,
 *          themSeconds, themCount, firstThemAt, speakerNames, verdict, reason, absorbedSpillSeconds? }
 */
function planGranolaChunks({ segments, events, coachNames = [] }) {
  const segs = (segments || []).slice().sort((a, b) => a.t0 - b.t0);
  const span = transcriptSpan(segs);
  if (!span) return { span: null, chunks: [] };
  const spanStart = ms(span.start);
  const spanEnd = ms(span.end);

  const evs = (events || [])
    .map((ev) => ({ ev, start: ms(ev.start), end: ms(ev.end), tokens: eventPeopleTokens(ev, coachNames) }))
    .filter((x) => Number.isFinite(x.start) && Number.isFinite(x.end))
    // overlap with the words, allowing the pre-roll (a caller who joins a little early)
    .filter((x) => x.start - PRE_ROLL_MS < spanEnd && x.end > spanStart)
    .sort((a, b) => a.start - b.start);

  const build = (index, event, chunkSegs, contiguousStart = false) => {
    const stats = themStats(chunkSegs);
    const start = chunkSegs.length ? new Date(chunkSegs[0].t0).toISOString() : null;
    const end = chunkSegs.length ? new Date(Math.max(...chunkSegs.map((s) => s.t1))).toISOString() : null;
    let verdict = 'file';
    let reason = '';
    if (!chunkSegs.length || stats.themCount === 0) {
      verdict = 'drop-no-other-voice';
      reason = 'only the coach spoke in this window';
    } else if (stats.themSeconds < MIN_THEM_SECONDS || stats.themCount < MIN_THEM_SEGMENTS) {
      verdict = 'drop-too-short';
      reason = `other voice for ${stats.themSeconds}s across ${stats.themCount} line(s) — too thin to attribute`;
    } else if (contiguousStart && stats.themSeconds < MIN_CONTIGUOUS_THEM_SECONDS) {
      verdict = 'drop-spill';
      reason = `the talk ran straight through from the previous booking with no pause, and only ${stats.themSeconds}s of other voice followed — the previous call spilling over, not a meeting`;
    } else if (!event) {
      verdict = 'review-no-booking';
      reason = 'no calendar booking overlaps these words';
    } else if (stats.firstThemAt != null && stats.firstThemAt > ms(event.end)) {
      verdict = 'review-late-voice';
      reason = `the other voice first spoke at ${new Date(stats.firstThemAt).toISOString().slice(11, 16)}Z, after the booking ended ${new Date(ms(event.end)).toISOString().slice(11, 16)}Z — probably not the booked person`;
    }
    return {
      index, event: event || null, segments: chunkSegs, start, end, contiguousStart,
      themSeconds: stats.themSeconds, themCount: stats.themCount,
      firstThemAt: stats.firstThemAt != null ? new Date(stats.firstThemAt).toISOString() : null,
      speakerNames: stats.speakerNames, verdict, reason,
    };
  };

  if (!evs.length) return { span, chunks: [build(1, null, segs)] };

  // Cut points between consecutive bookings; everything before the first cut belongs to the
  // first booking, everything after the last cut to the last booking.
  const cuts = [];
  for (let i = 0; i < evs.length - 1; i++) {
    const c = cutBetween(segs, evs[i].end, evs[i + 1].start);
    if (c.contiguous) {
      const refined = refineCutByNames(segs, c.cut, evs[i].tokens, evs[i + 1].tokens);
      if (refined !== c.cut) { c.cut = refined; c.steeredByNames = true; }
    }
    if (cuts.length && c.cut < cuts[cuts.length - 1].cut) c.cut = cuts[cuts.length - 1].cut; // keep monotonic
    cuts.push(c);
  }
  const chunks = [];
  let k = 0;
  for (let i = 0; i < evs.length; i++) {
    const upper = i < cuts.length ? cuts[i].cut : Infinity;
    const chunkSegs = [];
    while (k < segs.length && segs[k].t0 < upper) { chunkSegs.push(segs[k]); k++; }
    const ch = build(i + 1, evs[i].ev, chunkSegs, i > 0 && cuts[i - 1].contiguous);
    if (i > 0 && cuts[i - 1].steeredByNames) ch.cutSteeredByNames = true;
    chunks.push(ch);
  }

  // A spill-over is, by construction, the PREVIOUS call continuing past its slot with no pause:
  // give those words back to the previous chunk (when that chunk is a real, filable meeting)
  // rather than losing the last minutes of a conversation. The spill chunk itself files nothing.
  // Applies to every "not a meeting" verdict after a contiguous cut — a too-thin tail or the
  // coach alone saying goodbye is the same continuation.
  for (let i = 1; i < chunks.length; i++) {
    const spill = chunks[i];
    const prev = chunks[i - 1];
    if (!spill.contiguousStart || !spill.verdict.startsWith('drop') || prev.verdict !== 'file') continue;
    const merged = build(prev.index, prev.event, prev.segments.concat(spill.segments), prev.contiguousStart);
    merged.absorbedSpillSeconds = spill.themSeconds;
    if (prev.cutSteeredByNames) merged.cutSteeredByNames = true;
    chunks[i - 1] = merged;
    chunks[i] = { ...spill, segments: [], verdict: 'absorbed-into-previous', reason: `${spill.reason}; those ${spill.themSeconds}s were kept with "${prev.event?.summary || 'the previous booking'}"` };
  }
  return { span, chunks };
}

/**
 * Does the other side's Zoom display name agree with the lead the calendar points at?
 *   'match'    at least one display name relates to at least one candidate lead
 *   'mismatch' display names are present and NONE relates to ANY candidate — do not file
 *   'none'     Granola supplied no display name (the common case) — calendar decides alone
 * A name "relates" when a lead's first name, last name or full name (3+ letters) sits inside
 * the squashed display name, or the squashed display name sits inside the lead's full name.
 */
function speakerNameVerdict(speakerNames, leads) {
  const names = (speakerNames || []).map(squash).filter((n) => n.length >= 3);
  if (!names.length) return { verdict: 'none' };
  const tokensByLead = (leads || []).map((l) => {
    const full = String(l.name || '').trim();
    const parts = full.split(/\s+/).filter(Boolean);
    const toks = new Set([squash(full), ...parts.map(squash)].filter((t) => t.length >= 3));
    return { lead: l, toks: [...toks], full: squash(full) };
  });
  if (!tokensByLead.length) return { verdict: 'none' };
  for (const n of names) {
    for (const { lead, toks, full } of tokensByLead) {
      if (toks.some((t) => n.includes(t)) || (full && full.includes(n))) return { verdict: 'match', name: n, lead };
    }
  }
  return { verdict: 'mismatch', names };
}

/**
 * Segments -> canonical "Name: text" lines. me => the coach's name; them => the matched lead's
 * name when there is exactly one, else "Participant" (+ Granola's display name when it has one).
 * Consecutive same-speaker segments merge into one line so the store reads like a conversation.
 */
function segmentsToTranscript(segments, { coachName, otherName } = {}) {
  const me = (coachName || 'Coach').trim();
  const lines = [];
  let lastLabel = null;
  for (const s of segments || []) {
    const text = String(s.text || '').trim();
    if (!text) continue;
    let label;
    if (s.me) label = me;
    else label = otherName || (s.name ? `Participant (${s.name})` : 'Participant');
    if (lines.length && label === lastLabel) lines[lines.length - 1] += ` ${text}`;
    else { lines.push(`${label}: ${text}`); lastLabel = label; }
  }
  return lines.join('\n');
}

module.exports = {
  extractSegments,
  transcriptSpan,
  planGranolaChunks,
  speakerNameVerdict,
  segmentsToTranscript,
  cutBetween,
  refineCutByNames,
  eventPeopleTokens,
  PRE_ROLL_MS,
  MIN_THEM_SECONDS,
  MIN_THEM_SEGMENTS,
};
