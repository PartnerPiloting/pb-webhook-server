/**
 * Tests for "who was the call WITH?" (Rick Wong, 2026-09-24).
 *
 * What went wrong: Rick's 11:00 AgentNexa group session (16 guests) ran past 12:00, his 12:00
 * one-on-one with Mikael Lindback overlapped it, and the calendar fallback took EVERY overlapping
 * event - so all 16 group guests were filed as people he met on the Mikael call. Same again on
 * 16 Sep: a 09:05 phone recording picked up the guests of a 10:00 booking.
 *
 * Two pure pieces hold the fix:
 *   pickAlignedEvent - the ONE booking a recording belongs to (starts with it, or holds it)
 *   tagPendingRoles  - booked guests = who the call was with; anyone else = an extra
 *
 * Pure logic only - no Airtable, no Postgres, no network.
 * Run: node tests/pending-roles.test.js
 */
process.env.AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY || 'test';
process.env.AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID || 'appTest';
const assert = require('assert');
const { pickAlignedEvent } = require('../services/fathomIngestService');
const { tagPendingRoles } = require('../services/firefliesIngestService');

let failures = 0;
const check = (name, fn) => { try { fn(); console.log(`  ✓ ${name}`); } catch (e) { failures++; console.error(`  ✗ ${name}\n    ${e.message}`); } };

// Times in UTC; AEST = UTC+10.
const agentNexa = { id: 'group', start: '2026-09-15T01:00:00Z', end: '2026-09-15T02:30:00Z' }; // 11:00-12:30
const mikael = { id: 'mikael', start: '2026-09-15T02:00:00Z', end: '2026-09-15T03:00:00Z' };    // 12:00-13:00

console.log('pickAlignedEvent - the booking a recording belongs to:');
check('Mikael recording (12:00) picks the Mikael booking, not the group session it overlaps', () => {
  assert.strictEqual(pickAlignedEvent([agentNexa, mikael], '2026-09-15T02:00:00Z', '2026-09-15T03:01:56Z').id, 'mikael');
});
check('the group recording (11:00) picks the group session, not the 12:00 call it runs into', () => {
  assert.strictEqual(pickAlignedEvent([agentNexa, mikael], '2026-09-15T01:00:00Z', '2026-09-15T02:12:41Z').id, 'group');
});
check('Mikael recording with NO Mikael booking takes nothing (the group session only brushes it)', () => {
  assert.strictEqual(pickAlignedEvent([agentNexa], '2026-09-15T02:00:00Z', '2026-09-15T03:01:56Z'), null);
});
check('a 09:05 recording does not borrow a 10:00 booking (16 Sep)', () => {
  const tenAm = { id: 'ten', start: '2026-09-16T00:00:00Z', end: '2026-09-16T01:00:00Z' };
  assert.strictEqual(pickAlignedEvent([tenAm], '2026-09-15T23:05:00Z', null), null);
});
check('recording started 10 min late still finds its booking', () => {
  assert.strictEqual(pickAlignedEvent([mikael], '2026-09-15T02:10:00Z', '2026-09-15T03:00:00Z').id, 'mikael');
});
check('phone switched on 25 min into a face-to-face, wholly inside the booking, still finds it', () => {
  const lunch = { id: 'lunch', start: '2026-09-15T02:00:00Z', end: '2026-09-15T04:00:00Z' };
  assert.strictEqual(pickAlignedEvent([lunch], '2026-09-15T02:25:00Z', '2026-09-15T03:25:00Z').id, 'lunch');
});
check('two bookings near the start: the closer one wins', () => {
  const a = { id: 'a', start: '2026-09-15T01:50:00Z', end: '2026-09-15T02:20:00Z' };
  const b = { id: 'b', start: '2026-09-15T02:05:00Z', end: '2026-09-15T02:35:00Z' };
  assert.strictEqual(pickAlignedEvent([a, b], '2026-09-15T02:03:00Z', '2026-09-15T02:30:00Z').id, 'b');
});
check('no events / bad start = null', () => {
  assert.strictEqual(pickAlignedEvent([], '2026-09-15T02:00:00Z', null), null);
  assert.strictEqual(pickAlignedEvent([mikael], 'nonsense', null), null);
});

console.log('tagPendingRoles - booked vs extra:');
const booked = [{ email: 'mikael@gopartnering.com', name: 'Mikael Lindback' }];
check('the booked guest is "booked"; someone else the recorder saw is an "extra" with whose call it was', () => {
  const out = tagPendingRoles([{ email: 'mikael@gopartnering.com' }, { email: 'Chris.Iacono@proxima.com.au', name: 'Christopher Iacono' }], booked);
  assert.strictEqual(out[0].role, 'booked');
  assert.strictEqual(out[1].role, 'extra');
  assert.strictEqual(out[1].with, 'Mikael Lindback');
  assert.strictEqual(out[1].name, 'Christopher Iacono');
});
check('no booking lined up = no tags (unknown, shown as before)', () => {
  const inp = [{ email: 'x@y.com' }];
  assert.deepStrictEqual(tagPendingRoles(inp, null), inp);
  assert.deepStrictEqual(tagPendingRoles(inp, []), inp);
});
check('booked guest with no name: "with" falls back to the address', () => {
  const out = tagPendingRoles([{ email: 'x@y.com' }], [{ email: 'a@b.com' }]);
  assert.strictEqual(out[0].with, 'a@b.com');
});

if (failures) { console.error(`\n${failures} FAILED`); process.exit(1); }
console.log('\nall passed');
