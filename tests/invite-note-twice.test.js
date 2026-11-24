/**
 * tests/invite-note-twice.test.js
 *
 * Rick Wong, 24 Nov 2026: "people have received my connection note twice". Nobody had - Linked
 * Helper sent one invite each - but every accepted invite sat in the lead's Notes twice:
 *   1. LH's copy, stamped 11 hours late (its zone-less local time was read as UTC), and
 *   2. the extension's copy, stamped when the person accepted, with the line break before the
 *      sign-off lost ("connect.Rick." against "connect. Rick.").
 * Different clock time + different text = two "different" messages. The lines below are the real
 * ones from his base.
 *
 * Run: node tests/invite-note-twice.test.js
 */

const assert = require('assert');
const { mergeAndSortMessages, normalizeMessageText } = require('../utils/notesSectionManager');
const { buildMessageLines, applyMessageLinesToNotes, parseLocalSendAt } = require('../services/lhMessageNotes');

let passed = 0;
function test(name, fn) {
  try { fn(); passed += 1; console.log(`  ok - ${name}`); }
  catch (e) { console.error(`  FAIL - ${name}\n    ${e.message}`); process.exitCode = 1; }
}

const SYD = 'Australia/Sydney';
const NOTE = 'Hi Rafik, as a fellow Veblener, I wanted to introduce myself. I joined the group about 4-5 months ago and thought it would be great to connect.';
const LH_LINE = `21-11-26 7:19 PM - Rick Wong - ${NOTE} Rick.`;   // as stored: 11 hours late
const EXT_LINE = `21-11-26 8:22 AM - Rick Wong - ${NOTE}Rick.`;   // as stored: no space before the sign-off
const REPLY = '21-11-26 8:22 AM - Rafik Zahy - Hi Rick, glad to e-meet you too!';
const LATER = "24-11-26 9:05 AM - Rick Wong - Likewise Rafik - you've been a member for quite sometime now. How has it been going for you?";

// What LH really posts: local machine time with no zone, plus the true instant.
const PAYLOAD = {
  first_name: 'Rafik', last_name: 'Zahy', my_full_name: 'Rick Wong',
  last_received_message_from: 'Rick Wong',
  last_received_message_text: `${NOTE}\nRick.`,
  last_received_message_send_at: '2026-11-21 08:19:34',
  last_received_message_send_at_iso: '2026-11-20T21:19:34.412Z',
};

console.log('invite note twice');

test('1. a lost line break does not make two messages', () => {
  assert.strictEqual(normalizeMessageText(LH_LINE), normalizeMessageText(EXT_LINE));
});

test('2. the LH copy is stamped at the real send time, not 11 hours late', () => {
  const [msg] = buildMessageLines(PAYLOAD, { timezone: SYD, clientName: 'Rick Wong' });
  assert.ok(msg.line.startsWith('21-11-26 8:19 AM - Rick Wong - '), msg.line);
});

test('3. with no ISO field, the zone-less time is read as the client\'s local time', () => {
  const { last_received_message_send_at_iso, ...old } = PAYLOAD;
  const [msg] = buildMessageLines(old, { timezone: SYD, clientName: 'Rick Wong' });
  assert.ok(msg.line.startsWith('21-11-26 8:19 AM - '), msg.line);
  assert.strictEqual(parseLocalSendAt('2026-11-21 08:19:34', SYD).toISOString(), '2026-11-20T21:19:34.000Z');
  assert.strictEqual(parseLocalSendAt('2026-07-01T08:19:34', 'Australia/Brisbane').toISOString(), '2026-06-30T22:19:34.000Z');
  // a string that carries its own zone is left alone
  assert.strictEqual(parseLocalSendAt('2026-11-20T21:19:34.412Z', SYD).toISOString(), '2026-11-20T21:19:34.412Z');
});

test('4. the extension capturing the thread after LH filed the note leaves ONE copy', () => {
  const merged = mergeAndSortMessages(LH_LINE, [REPLY, EXT_LINE].join('\n')).split('\n');
  assert.strictEqual(merged.filter(l => l.includes('fellow Veblener')).length, 1, merged.join('\n'));
  assert.ok(merged.includes(REPLY), 'his reply survives');
});

test('5. LH filing the note after the extension captured it writes nothing', () => {
  const existing = ['=== LINKEDIN MESSAGES ===', REPLY, EXT_LINE].join('\n');
  const lines = buildMessageLines(PAYLOAD, { timezone: SYD, clientName: 'Rick Wong' });
  const { added, notes } = applyMessageLinesToNotes(existing, lines);
  assert.strictEqual(added, 0);
  assert.strictEqual(notes, existing);
});

test('6. a record that already holds both copies is cleaned on its next merge', () => {
  const stored = [LATER, LH_LINE, REPLY, EXT_LINE].join('\n');
  const merged = mergeAndSortMessages(stored, LATER).split('\n');
  assert.strictEqual(merged.filter(l => l.includes('fellow Veblener')).length, 1, merged.join('\n'));
  assert.strictEqual(merged.length, 3);
  assert.strictEqual(merged[0], LATER);
});

test('7. the same long text from two DIFFERENT people is two messages', () => {
  const a = `21-11-26 8:19 AM - Rick Wong - ${NOTE}`;
  const b = `22-11-26 9:00 AM - Rafik Zahy - ${NOTE}`;
  assert.strictEqual(mergeAndSortMessages(a, b).split('\n').length, 2);
});

test('8. a short repeat at a different time is still kept', () => {
  const a = '19-10-26 9:27 AM - Rick Wong - Thanks!';
  const b = '20-10-26 4:51 PM - Rick Wong - Thanks!';
  assert.strictEqual(mergeAndSortMessages(a, b).split('\n').length, 2);
});

console.log(`\n${passed} passed${process.exitCode ? ' - FAILURES above' : ''}`);
