/**
 * Regression tests for the Granola timestamp splitter (services/granolaSplitService.js) —
 * replays the August 2026 misfiles against the planner. Pure functions only; run with:
 *   node tests/test-granola-split.js
 *
 * The cases (all Australia/Brisbane mornings in a single standing Zoom room):
 *   1. Fri 21 Aug: note opened 9:26, Mehnaaz (9:30) no-show, Pedro (10:30) attended — the
 *      whole call was filed to Mehnaaz. Must file Pedro's chunk to Pedro only, drop the empty
 *      waiting period.
 *   2. Fri 28 Aug: Melissa (3:00) with a goodbye running 1 min into Leanne's (3:30) slot — must
 *      be ONE chunk (the spill is too thin to be Leanne's).
 *   3. Tue 25 Aug: Roland (10:00), Jay (10:30), April (11:00) in one note — three chunks.
 *   4. Wed 2 Sep: a booking whose only invitee is a role address — filed unlinked (open mode).
 *   5. No booking at all — review, not a guess.
 *   6. Other voice only AFTER the slot ended — review.
 *   7. Display-name veto: "melissajarmyn" agrees with Melissa; contradicts Leanne.
 *   8. An untimed payload plans nothing (the ingest falls back to Granola's linked event).
 */

const assert = require('assert');
const {
  extractSegments, transcriptSpan, planGranolaChunks, speakerNameVerdict, segmentsToTranscript,
} = require('../services/granolaSplitService');

// Brisbane = UTC+10. bris('2026-08-21', '09:30') -> ISO UTC.
function bris(day, hm) { return new Date(`${day}T${hm}:00+10:00`).toISOString(); }
function ev(summary, day, from, to, email) {
  return {
    summary, start: bris(day, from), end: bris(day, to),
    attendees: [{ email: 'guyralphwilson@gmail.com', self: true, organizer: true, responseStatus: 'accepted' }, { email, displayName: summary.split(' & ')[0] }],
    organizerEmail: 'guyralphwilson@gmail.com', description: 'https://zoom.us/j/1',
  };
}
/** Build segments: talk(day, from, to, who, name?) -> 20-second lines, alternating text. */
function talk(day, from, to, who, name) {
  const out = [];
  let t = Date.parse(bris(day, from));
  const end = Date.parse(bris(day, to));
  let i = 0;
  while (t < end) {
    out.push({
      text: `${who === 'me' ? 'coach' : 'them'} line ${i++}`,
      start_time: new Date(t).toISOString(), end_time: new Date(t + 15000).toISOString(),
      speaker: who === 'me' ? { source: 'microphone', attribution: 'me' } : { source: 'speaker', attribution: 'them', ...(name ? { name } : {}) },
    });
    t += 20000;
  }
  return out;
}
function note(...runs) { return { id: 'not_test', transcript: runs.flat().sort((a, b) => Date.parse(a.start_time) - Date.parse(b.start_time)) }; }

let passed = 0;
function test(name, fn) { fn(); passed++; console.log(`  ok - ${name}`); }

console.log('granola split planner');

test('case 1: no-show slot then real caller -> the caller gets his own chunk, the waiting room is dropped', () => {
  const d = '2026-08-21';
  const n = note(
    talk(d, '09:28', '09:31', 'me'),            // coach fiddling before the no-show
    talk(d, '10:31', '10:57', 'them'),          // Pedro
    talk(d, '10:31', '10:57', 'me'),
  );
  const { segments } = extractSegments(n);
  const span = transcriptSpan(segments);
  assert.strictEqual(span.start, bris(d, '09:28'));
  const events = [ev('Mehnaaz Ahmed & Guy Wilson', d, '09:30', '10:00', 'mehnaaza@gmail.com'), ev('Pedro Demartini & Guy Wilson', d, '10:30', '11:00', 'pedro_demartini@hotmail.com')];
  const { chunks } = planGranolaChunks({ segments, events });
  assert.strictEqual(chunks.length, 2);
  assert.strictEqual(chunks[0].event.summary, 'Mehnaaz Ahmed & Guy Wilson');
  assert.strictEqual(chunks[0].verdict, 'drop-no-other-voice');
  assert.strictEqual(chunks[1].event.summary, 'Pedro Demartini & Guy Wilson');
  assert.strictEqual(chunks[1].verdict, 'file');
  assert.ok(chunks[1].segments.every((s) => s.t0 >= Date.parse(bris(d, '10:25'))));
});

test('case 1b: the caller joins 3 minutes early -> his hello still lands in HIS chunk', () => {
  const d = '2026-08-21';
  const n = note(talk(d, '10:27', '10:57', 'them'), talk(d, '10:27', '10:57', 'me'));
  const { segments } = extractSegments(n);
  const events = [ev('Mehnaaz Ahmed & Guy Wilson', d, '09:30', '10:00', 'mehnaaza@gmail.com'), ev('Pedro Demartini & Guy Wilson', d, '10:30', '11:00', 'pedro_demartini@hotmail.com')];
  const { chunks } = planGranolaChunks({ segments, events });
  // Mehnaaz's booking ended 27 min before the first word: not a candidate at all.
  assert.strictEqual(chunks.length, 1);
  assert.strictEqual(chunks[0].event.summary, 'Pedro Demartini & Guy Wilson');
  assert.strictEqual(chunks[0].verdict, 'file');
});

test('case 2: goodbye spilling 1 min into the next slot stays one chunk', () => {
  const d = '2026-08-28';
  const n = note(talk(d, '15:00', '15:31', 'them', 'melissajarmyn'), talk(d, '15:00', '15:31', 'me'));
  const { segments } = extractSegments(n);
  const events = [ev('Melissa Jarmyn & Guy Wilson', d, '15:00', '15:30', 'melissa@agileedgeconsulting.com.au'), ev('Leanne van Rensburg & Guy Wilson', d, '15:30', '16:00', 'leanne@praxispartners.io')];
  const { chunks } = planGranolaChunks({ segments, events });
  assert.strictEqual(chunks.length, 2);
  assert.strictEqual(chunks[0].verdict, 'file');
  assert.strictEqual(chunks[0].event.summary, 'Melissa Jarmyn & Guy Wilson');
  assert.deepStrictEqual(chunks[0].speakerNames, ['melissajarmyn']);
  // The talk ran straight through 3:30 with no pause: whatever fell after the cut is Melissa's
  // spill-over, far too thin to be Leanne's meeting — it is given back to Melissa's chunk.
  assert.strictEqual(chunks[1].contiguousStart, true);
  assert.strictEqual(chunks[1].verdict, 'absorbed-into-previous');
  assert.ok(chunks[0].absorbedSpillSeconds > 0);
  assert.strictEqual(chunks[0].end >= bris(d, '15:30'), true);   // Melissa's chunk now runs to her last word
});

test('case 2b: a 4-minute spill with no pause goes back to the earlier call; a real 25-minute next call does not', () => {
  const d = '2026-08-28';
  const spill = note(talk(d, '15:00', '15:34', 'them'), talk(d, '15:00', '15:34', 'me'));
  const events = [ev('Melissa Jarmyn & Guy Wilson', d, '15:00', '15:30', 'melissa@agileedgeconsulting.com.au'), ev('Leanne van Rensburg & Guy Wilson', d, '15:30', '16:00', 'leanne@praxispartners.io')];
  let r = planGranolaChunks({ segments: extractSegments(spill).segments, events });
  assert.strictEqual(r.chunks[1].verdict, 'absorbed-into-previous');
  assert.strictEqual(r.chunks[0].verdict, 'file');
  assert.strictEqual(r.chunks[0].segments.length, extractSegments(spill).segments.length); // nothing lost
  const real = note(talk(d, '15:00', '15:55', 'them'), talk(d, '15:00', '15:55', 'me'));
  r = planGranolaChunks({ segments: extractSegments(real).segments, events });
  assert.strictEqual(r.chunks[1].verdict, 'file');   // 25 min of other voice after 3:30 is a meeting
  assert.strictEqual(r.chunks[0].verdict, 'file');
});

test('case 3b: continuous talk across a boundary, steered by display names (Jay\'s goodbye stays with Jay)', () => {
  const d = '2026-08-25';
  // Jay talks 10:30 -> 11:03 with no pause, April's first line is 11:03:20.
  const n = note(
    talk(d, '10:30', '11:03', 'them', 'Jay'), talk(d, '10:30', '11:03', 'me'),
    talk(d, '11:03', '11:40', 'them', 'April Balaba'), talk(d, '11:03', '11:40', 'me'),
  );
  const events = [
    ev('Jay Critchley & Guy Wilson', d, '10:30', '11:00', 'jay@jay.associates'),
    ev('April & Guy LinkedIn', d, '11:00', '11:30', 'april.balaba@fortix.com.au'),
  ];
  const { chunks } = planGranolaChunks({ segments: extractSegments(n).segments, events, coachNames: ['Guy Wilson'] });
  assert.strictEqual(chunks.length, 2);
  assert.strictEqual(chunks[1].cutSteeredByNames, true);
  assert.deepStrictEqual(chunks[0].speakerNames, ['Jay']);
  assert.deepStrictEqual(chunks[1].speakerNames, ['April Balaba']);
  assert.strictEqual(chunks[0].end >= bris(d, '11:02'), true);
  // Without names the cut would sit at 11:00 and Jay's last 3 minutes would land on April.
  const noNames = note(talk(d, '10:30', '11:03', 'them'), talk(d, '10:30', '11:03', 'me'), talk(d, '11:03', '11:40', 'them'), talk(d, '11:03', '11:40', 'me'));
  const r2 = planGranolaChunks({ segments: extractSegments(noNames).segments, events, coachNames: ['Guy Wilson'] });
  assert.strictEqual(r2.chunks[1].cutSteeredByNames, undefined);
  assert.strictEqual(r2.chunks[1].start, bris(d, '11:00'));
});

test('case 3: three back-to-back calls in one note -> three filable chunks, split at the silences', () => {
  const d = '2026-08-25';
  const n = note(
    talk(d, '10:00', '10:28', 'them'), talk(d, '10:00', '10:28', 'me'),
    talk(d, '10:32', '10:59', 'them'), talk(d, '10:32', '10:59', 'me'),
    talk(d, '11:01', '12:30', 'them'), talk(d, '11:01', '12:30', 'me'),
  );
  const { segments } = extractSegments(n);
  const events = [
    ev('Roland Illyes & Guy Wilson', d, '10:00', '10:30', 'roland@gracex.io'),
    ev('Jay Critchley & Guy Wilson', d, '10:30', '11:00', 'jay@jay.associates'),
    ev('April & Guy LinkedIn', d, '11:00', '11:30', 'april.balaba@fortix.com.au'),
  ];
  const { chunks } = planGranolaChunks({ segments, events });
  assert.strictEqual(chunks.length, 3);
  assert.deepStrictEqual(chunks.map((c) => c.verdict), ['file', 'file', 'file']);
  assert.strictEqual(chunks[0].end <= bris(d, '10:29'), true);
  assert.strictEqual(chunks[1].start >= bris(d, '10:31'), true);
  assert.strictEqual(chunks[2].start >= bris(d, '11:00'), true);
  // April's overrun to 12:30 stays with April (no later booking).
  assert.strictEqual(chunks[2].end >= bris(d, '12:29'), true);
});

test('case 4/5: no booking at all -> review, never a guess', () => {
  const d = '2026-09-02';
  const n = note(talk(d, '11:26', '12:32', 'them'), talk(d, '11:26', '12:32', 'me'));
  const { segments } = extractSegments(n);
  const { chunks } = planGranolaChunks({ segments, events: [] });
  assert.strictEqual(chunks.length, 1);
  assert.strictEqual(chunks[0].verdict, 'review-no-booking');
});

test('case 6: other voice only after the booking ended -> review', () => {
  const d = '2026-08-21';
  const n = note(talk(d, '09:28', '09:31', 'me'), talk(d, '10:05', '10:20', 'them'), talk(d, '10:05', '10:20', 'me'));
  const { segments } = extractSegments(n);
  const events = [ev('Mehnaaz Ahmed & Guy Wilson', d, '09:30', '10:00', 'mehnaaza@gmail.com')];
  const { chunks } = planGranolaChunks({ segments, events });
  assert.strictEqual(chunks.length, 1);
  assert.strictEqual(chunks[0].verdict, 'review-late-voice');
});

test('case 7: display-name veto', () => {
  const melissa = { name: 'Melissa Jarmyn', leadId: 'a' };
  const leanne = { name: 'Leanne van Rensburg', leadId: 'b' };
  assert.strictEqual(speakerNameVerdict(['melissajarmyn'], [melissa]).verdict, 'match');
  assert.strictEqual(speakerNameVerdict(['melissajarmyn'], [leanne]).verdict, 'mismatch');
  assert.strictEqual(speakerNameVerdict([], [leanne]).verdict, 'none');
  assert.strictEqual(speakerNameVerdict(["Mel's iPad"], [melissa]).verdict, 'mismatch'); // fail-safe: a hold, not a guess
  assert.strictEqual(speakerNameVerdict(['NOW Group'], []).verdict, 'none');
});

test('case 8: untimed payload plans nothing; transcript rendering names the single lead', () => {
  const n = { id: 'x', transcript: [{ text: 'hi', speaker: { source: 'speaker' } }] };
  const { segments, untimed } = extractSegments(n);
  assert.strictEqual(segments.length, 0);
  assert.strictEqual(untimed, 1);
  const d = '2026-08-28';
  const { segments: segs } = extractSegments(note(talk(d, '15:00', '15:01', 'them', 'melissajarmyn'), talk(d, '15:00', '15:01', 'me')));
  const text = segmentsToTranscript(segs, { coachName: 'Guy Wilson', otherName: 'Melissa Jarmyn' });
  assert.ok(text.startsWith('Guy Wilson: coach line 0') || text.startsWith('Melissa Jarmyn: them line 0'));
  assert.ok(!text.includes('Participant'));
  const anon = segmentsToTranscript(segs, { coachName: 'Guy Wilson' });
  assert.ok(anon.includes('Participant (melissajarmyn):'));
});

console.log(`\n${passed} passed`);
