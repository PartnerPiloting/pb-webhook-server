/**
 * Tests for the capture shadow (services/captureShadow.js) and its on/off list
 * (services/extensionPolicy.wantsSeen) - step 1 of moving conversation reading to the server.
 *
 * Contracts:
 *   1. Only clients named in content/extension-policy.json are switched on; "*" is everyone.
 *      The list as shipped names Guy alone (the soak is on his machine first).
 *   2. judge: the same reading = match; a different one = differs with both answers and the lines.
 *   3. judge: a sighting that is missing, oversized or unreadable = unreadable with the reason.
 *   4. recordSighting never throws and works with no database (returns the verdict).
 *   5. A difference emails Guy once a day at most; a match never emails.
 *   6. The email says plainly that the record itself is fine.
 *
 * Run: node tests/capture-shadow.test.js
 */
const assert = require('assert');

delete process.env.DATABASE_URL; // no database in this test - writes are skipped, verdicts still returned
const shadow = require('../services/captureShadow');
const policy = require('../services/extensionPolicy');
const reader = require('../utils/threadReader');

let passed = 0;
const pending = [];
function test(name, fn) {
  pending.push(Promise.resolve().then(fn).then(
    () => { passed += 1; console.log(`  ok  ${name}`); },
    (e) => { process.exitCode = 1; console.error(`  FAIL ${name}\n       ${e.message}`); }
  ));
}

const SEEN = {
  v: 1, ui: 'new', today: [2026, 11, 4], header: { name: 'Craig Carolan' }, send: { proven: false },
  events: [{ k: 'l', x: 'Today' }, { k: 'a', x: 'Craig Carolan' }, { k: 't', x: '1:33 PM' }, { k: 'p', x: 'How about Tuesday?', g: 1 }],
};
const RIGHT = reader.serverReading(SEEN).content;
const WRONG = RIGHT.replace('Today', 'Oct 19');

test('1. who is switched on', () => {
  const P = { rawCaptureClients: ['Guy-Wilson'] };
  assert.strictEqual(policy.wantsSeen('Guy-Wilson', P), true);
  assert.strictEqual(policy.wantsSeen('Sam-Noble', P), false);
  assert.strictEqual(policy.wantsSeen('', P), false);
  assert.strictEqual(policy.wantsSeen(undefined, P), false);
  assert.strictEqual(policy.wantsSeen('Sam-Noble', { rawCaptureClients: ['*'] }), true);
  assert.strictEqual(policy.wantsSeen('Guy-Wilson', {}), false);
  policy._resetCachesForTests();
  assert.deepStrictEqual(policy.loadPolicy().rawCaptureClients, ['Guy-Wilson'], 'as shipped: Guy only - widen it on purpose, after the soak');
});

test('2. judge: match and differs', () => {
  assert.deepStrictEqual(shadow.judge({ seen: SEEN, extensionContent: RIGHT }).verdict, 'match');
  const d = shadow.judge({ seen: SEEN, extensionContent: WRONG });
  assert.strictEqual(d.verdict, 'differs');
  assert.strictEqual(d.serverContent, RIGHT);
  assert.deepStrictEqual(d.diffs[0], { line: 1, extension: 'Oct 19', server: 'Today' });
});

test('3. judge: unreadable, with the reason', () => {
  assert.strictEqual(shadow.judge({ seen: null, extensionContent: RIGHT }).verdict, 'unreadable');
  assert.ok(shadow.judge({ seen: { v: 1, skipped: 'too big', n: 1 }, extensionContent: RIGHT }).reason.includes('skipped'));
  const huge = { ...SEEN, events: [{ k: 'p', x: 'z'.repeat(shadow.MAX_SIGHTING_BYTES + 1), g: 1 }] };
  assert.ok(shadow.judge({ seen: huge, extensionContent: RIGHT }).reason.includes('too big'));
  const loop = { v: 1, ui: 'new', events: [] }; loop.self = loop;
  assert.strictEqual(shadow.judge({ seen: loop, extensionContent: RIGHT }).verdict, 'unreadable');
});

test('4 + 5. recordSighting: no database needed, never throws, one email a day', async () => {
  shadow._resetForTests();
  const mails = [];
  const sendAlert = async (subject, html, recipient, options) => { mails.push({ subject, html, recipient, options }); };
  assert.strictEqual(await shadow.recordSighting({}), null);
  assert.strictEqual(await shadow.recordSighting({ clientId: 'Guy-Wilson', leadId: 'rec1', seen: SEEN, extensionContent: RIGHT, sendAlert }), 'match');
  assert.strictEqual(mails.length, 0, 'a match never emails');
  assert.strictEqual(await shadow.recordSighting({ clientId: 'Guy-Wilson', leadId: 'rec1', leadName: 'Craig Carolan', extensionVersion: '0.3.43', seen: SEEN, extensionContent: WRONG, sendAlert }), 'differs');
  assert.strictEqual(await shadow.recordSighting({ clientId: 'Guy-Wilson', leadId: 'rec2', seen: SEEN, extensionContent: WRONG, sendAlert }), 'differs');
  assert.strictEqual(mails.length, 1, 'the second difference of the day does not email again');
  assert.strictEqual(mails[0].recipient, null, 'goes to the alert address');
  assert.ok(mails[0].subject.includes('Craig Carolan'));
  assert.strictEqual(await shadow.recordSighting({ clientId: 'Guy-Wilson', leadId: 'rec3', seen: { v: 9 }, extensionContent: RIGHT, sendAlert }), 'unreadable');
  // A failing mailer is swallowed.
  shadow._resetForTests();
  assert.strictEqual(await shadow.recordSighting({ clientId: 'Guy-Wilson', seen: SEEN, extensionContent: WRONG, sendAlert: async () => { throw new Error('mail down'); } }), 'differs');
});

test('6. the email says the record is fine, in plain words, with no em dash', () => {
  const mail = shadow.differsEmail({ clientId: 'Guy-Wilson', leadName: 'Craig <b>', extensionVersion: '0.3.43', diffs: [{ line: 1, extension: 'Oct 19', server: 'Today' }] });
  assert.ok(mail.text.includes('Nothing is wrong on the record'));
  assert.ok(mail.text.includes('extension: Oct 19') && mail.text.includes('server:    Today'));
  assert.ok(!/[–—]/.test(mail.subject + mail.text), 'short dash only');
  assert.ok(!mail.html.includes('<b>'), 'names are escaped in the HTML copy');
});

Promise.all(pending).then(() => console.log(`\n${passed} passed${process.exitCode ? ' - FAILURES above' : ''}`));
