/**
 * Regression test for the 4 Nov 2026 Bernard Kassab filing: an ad-hoc call (Alex, unbooked, from
 * 2:10) ran straight into Bernard's 2:30 booking on the same Zoom. Timing alone (pickAlignedEvent)
 * finds no booking - 20 minutes late, and most of the recording sits outside it - so the call was
 * filed with 0 leads. The single path now also accepts the ONE booking whose person is heard on the
 * recording (resolveSpeakingEvents). This replays the shape with synthetic content.
 *
 * Run: node tests/test-fathom-late-booking.js
 */
const assert = require('assert');
// The ingest module pulls in the Airtable client at load; nothing here touches it.
process.env.AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY || 'test-key-not-used';
process.env.AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID || 'appTestNotUsed';
const { pickAlignedEvent, calendarParticipantEmails } = require('../services/fathomIngestService');
const { resolveSpeakingEvents, eventLeadSpeaks } = require('../services/fathomSplitService');
// The exact rule the single path uses: speaking (incl. timing adoption) AND heard by name/email.
const heardBookings = (m, evs) => resolveSpeakingEvents(m, evs, { coachNames: COACH_NAMES, coachEmails: COACH_EMAILS })
  .filter((ev) => eventLeadSpeaks(m, ev, COACH_NAMES, COACH_EMAILS));

const COACH_NAMES = ['Guy Wilson'];
const COACH_EMAILS = ['guyralphwilson@gmail.com'];
const line = (ts, name, text) => ({ timestamp: ts, speaker: { display_name: name }, text });

const meeting = {
  recording_start_time: '2026-11-04T04:10:18Z',
  recording_end_time: '2026-11-04T05:06:25Z',
  transcript: [
    line('00:00:17', 'Guy Wilson', 'Can you tell me exactly what we need to do?'),
    line('00:01:06', 'QLDBDM', 'Yeah, absolutely.'),
    line('00:21:51', 'QLDBDM', 'Bye.'),
    line('00:22:15', 'Sam Kassab', 'Hey, how are you?'),
    line('00:48:53', 'Sam Kassab', "Let's reconnect in about three weeks."),
    line('00:49:12', 'Guy Wilson', "I'm back towards the end of the month."),
  ],
};
const booking = {
  id: 'ev1', summary: 'Sam Kassab and Guy Wilson',
  start: '2026-11-04T04:30:00Z', end: '2026-11-04T05:00:00Z',
  attendees: [{ email: 'guyralphwilson@gmail.com', self: true }, { email: 'sam.kassab@example.com', displayName: 'Sam Kassab' }],
};
const noShow = { ...booking, id: 'ev2', summary: 'Pat Nobody and Guy Wilson', attendees: [{ email: 'pat@example.com', displayName: 'Pat Nobody' }] };

let failures = 0;
const check = (name, fn) => { try { fn(); console.log(`  ✓ ${name}`); } catch (e) { failures++; console.error(`  ✗ ${name}\n    ${e.message}`); } };

check('timing alone finds no booking (the bug)', () => {
  assert.strictEqual(pickAlignedEvent([booking], meeting.recording_start_time, meeting.recording_end_time), null);
});

check('the booked person is heard, so exactly one speaking booking is found', () => {
  const speaking = heardBookings(meeting, [booking]);
  assert.strictEqual(speaking.length, 1);
  const emails = calendarParticipantEmails(speaking, COACH_EMAILS).map((x) => x.email);
  assert.deepStrictEqual(emails, ['sam.kassab@example.com']);
});

check('a no-show booking is not handed to whoever joined at that time', () => {
  assert.strictEqual(heardBookings(meeting, [noShow]).length, 0);
});

check('two heard bookings = no guess (that is the split path\'s job)', () => {
  const m2 = { ...meeting, transcript: [...meeting.transcript, line('00:30:00', 'Pat Nobody', 'Hi all')] };
  assert.strictEqual(heardBookings(m2, [booking, noShow]).length, 2);
});

if (failures) { console.error(`\n${failures} failed`); process.exit(1); }
console.log('\nall passed');
