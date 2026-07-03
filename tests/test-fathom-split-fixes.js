/**
 * Regression tests for the 2026-07-03 Fathom splitter bugs — replays that morning and
 * afternoon against the fixed logic. Pure functions only; run with:
 *   node tests/test-fathom-split-fixes.js
 *
 * The three bugs (see fathomSplitService.js comments):
 *   1. eventLeadName only parsed "X and Y" — "&" and "/" titles fell back to the full
 *      title, so the coach's own lines matched as the lead (guard toothless, bounds at 0).
 *   2. No calendar-event dedupe — an on-screen duplicated event made one meeting look
 *      back-to-back with itself (phantom empty segment + everything in the last one).
 *   3. Zoom display name ≠ calendar name ("bobba" vs "Andrew Bain") — the real second
 *      event was dropped and its call swallowed into the first segment.
 */

const assert = require('assert');
const {
  splitFathomMeeting,
  eventLeadName,
  eventLeadSpeaks,
  dedupeMeetingEvents,
} = require('../services/fathomSplitService');

const COACH_NAMES = ['Guy Wilson'];
const COACH_EMAILS = ['guyralphwilson@gmail.com'];

function line(ts, name, email, text) {
  const speaker = { display_name: name };
  if (email) speaker.matched_calendar_invitee_email = email;
  return { timestamp: ts, speaker, text };
}

// ---- eventLeadName: separator + coach-stripping parsing --------------------
assert.strictEqual(
  eventLeadName({ summary: 'Luke Swithenbank & Guy Wilson', attendees: [{ email: 'luke@ridgelinestudios.co' }] }, COACH_NAMES),
  'Luke Swithenbank', '"&" separator must yield the lead, not the full title',
);
assert.strictEqual(
  eventLeadName({ summary: 'Guy Wilson / Alasdair Bell - 45min Meeting', attendees: [] }, COACH_NAMES),
  'Alasdair Bell', '"/" separator + " - " suffix must be stripped',
);
assert.strictEqual(
  eventLeadName({ summary: 'Tom Butler and Guy Wilson meeting', attendees: [] }, COACH_NAMES),
  'Tom Butler', 'legacy "and ... meeting" form still parses',
);
assert.strictEqual(
  eventLeadName({ summary: 'Guy Wilson planning block', attendees: [] }, COACH_NAMES),
  '', 'coach-only title must yield "" (safe: cannot claim speech), never the coach',
);
assert.strictEqual(
  eventLeadName({ summary: 'Andrew Bain & Guy Wilson', attendees: [{ displayName: 'Andrew Bain', email: 'bobbainis@outlook.com' }] }, COACH_NAMES),
  'Andrew Bain', 'attendee displayName still wins when present',
);

// ---- Morning replay: Luke 10:00 + dup Luke event + Andrew ("bobba") 10:30 ---
const morning = {
  recording_start_time: '2026-07-03T00:00:00Z',
  recording_end_time: '2026-07-03T01:08:20Z',
  transcript: [
    line('00:00:00', 'Luke Swithenbank', 'luke@ridgelinestudios.co', 'Hey Guy.'),
    line('00:00:05', 'Guy Wilson', null, 'Luke, good to see you.'),
    line('00:15:00', 'Luke Swithenbank', 'luke@ridgelinestudios.co', 'LinkedIn is the moat.'),
    line('00:30:55', 'Luke Swithenbank', 'luke@ridgelinestudios.co', 'Okay, here we go.'),
    line('00:31:10', 'bobba', 'bobbainis@outlook.com', 'Excellent.'),
    line('00:45:00', 'Guy Wilson', null, 'So the system works like this.'),
    line('01:05:00', 'bobba', 'bobbainis@outlook.com', 'Looks very clever, mate.'),
  ],
};
const lukeEvent = {
  summary: 'Luke Swithenbank & Guy Wilson',
  start: '2026-07-03T00:00:00Z', end: '2026-07-03T00:30:00Z',
  attendees: [{ email: 'luke@ridgelinestudios.co' }, { email: 'guyralphwilson@gmail.com', self: true, organizer: true }],
};
const lukeDupEvent = { ...lukeEvent }; // duplicated on-screen mid-call, parked on the same slot
const andrewEvent = {
  summary: 'Andrew Bain & Guy Wilson',
  start: '2026-07-03T00:30:00Z', end: '2026-07-03T01:00:00Z',
  attendees: [{ displayName: 'Andrew Bain', email: 'bobbainis@outlook.com' }, { email: 'guyralphwilson@gmail.com', self: true, organizer: true }],
};

const uniq = dedupeMeetingEvents([lukeEvent, lukeDupEvent, andrewEvent], COACH_NAMES);
assert.strictEqual(uniq.length, 2, 'duplicate Luke event must be dropped');

assert.strictEqual(eventLeadSpeaks(morning, lukeEvent, COACH_NAMES, COACH_EMAILS), true, 'Luke speaks');
assert.strictEqual(
  eventLeadSpeaks(morning, andrewEvent, COACH_NAMES, COACH_EMAILS), true,
  '"bobba" must count as Andrew Bain speaking via the invitee-email match',
);

const mSplit = splitFathomMeeting(morning, uniq, { coachNames: COACH_NAMES, coachEmails: COACH_EMAILS });
assert.strictEqual(mSplit.shouldSplit, true, 'morning is a real back-to-back');
assert.strictEqual(mSplit.segments.length, 2);
assert.strictEqual(mSplit.segments[0].leadName, 'Luke Swithenbank');
assert.strictEqual(mSplit.segments[1].leadName, 'Andrew Bain');
assert.strictEqual(mSplit.segments[0].lineCount, 4, 'Luke segment = everything before bobba first speaks');
assert.strictEqual(mSplit.segments[1].lineCount, 3, 'Andrew segment starts at his (email-matched) first line');
assert.ok(!mSplit.segments[0].transcriptText.includes('Excellent.'), 'Andrew speech must not leak into Luke');
assert.ok(mSplit.segments[1].transcriptText.includes('Looks very clever'), 'Andrew keeps his own speech');

// ---- Afternoon replay: Kaprilian-only recording overlapped by Alasdair's booking ----
// Recording 1:30–2:08pm contains ONLY Kaprilian + coach; Alasdair's 2:00pm event overlaps
// the tail but Alasdair never speaks. Old code: coach-name loophole passed the guard and
// split it (empty Kaprilian row + whole call filed under Alasdair). Fixed: guard says no.
const afternoon = {
  recording_start_time: '2026-07-03T03:30:00Z',
  recording_end_time: '2026-07-03T04:08:09Z',
  transcript: [
    line('00:00:00', 'Guy Wilson', null, 'Luke, hello.'),
    line('00:00:04', 'Luke Kaprilian', null, 'Hi Guy.'),
    line('00:37:58', 'Guy Wilson', null, 'Talk next week.'),
  ],
};
const kaprilianEvent = {
  summary: 'Luke Kaprilian & Guy Wilson',
  start: '2026-07-03T03:30:00Z', end: '2026-07-03T04:00:00Z',
  attendees: [{ email: 'guyralphwilson@gmail.com', self: true, organizer: true }],
};
const alasdairEvent = {
  summary: 'Guy Wilson / Alasdair Bell - 45min Meeting',
  start: '2026-07-03T04:00:00Z', end: '2026-07-03T04:45:00Z',
  attendees: [{ email: 'alasdair.bell@gmail.com' }, { email: 'guyralphwilson@gmail.com', self: true, organizer: true }],
};

assert.strictEqual(eventLeadSpeaks(afternoon, kaprilianEvent, COACH_NAMES, COACH_EMAILS), true, 'Kaprilian speaks');
assert.strictEqual(
  eventLeadSpeaks(afternoon, alasdairEvent, COACH_NAMES, COACH_EMAILS), false,
  'Alasdair never speaks — the coach half of "Guy Wilson / Alasdair Bell" must NOT satisfy the guard',
);

const speaking = dedupeMeetingEvents([kaprilianEvent, alasdairEvent], COACH_NAMES)
  .filter((ev) => eventLeadSpeaks(afternoon, ev, COACH_NAMES, COACH_EMAILS));
assert.strictEqual(speaking.length, 1, 'afternoon must file as a SINGLE meeting (no split)');

console.log('test-fathom-split-fixes: all assertions passed');
