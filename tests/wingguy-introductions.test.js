/**
 * Introductions Guy makes - the pure parts (2026-09-25, services/wingguyIntroductions.js).
 *
 * The rules under test:
 *   - a draft to exactly two people that reads like an introduction, with at least one of them the
 *     coach's client, is an introduction; a group email, a note to one person, or two strangers is not;
 *   - the sent copy is the coach's message to the parties after the draft; replies are the parties'
 *     own messages after the send;
 *   - an introduction is due for a check-in when it is still just "Introduced" and nothing has been
 *     recorded on it for 14 days - any edit (Guy's answer) pushes it out again.
 *
 * Pure logic only - no Airtable, no mailbox, no database.
 * Run: node tests/wingguy-introductions.test.js
 */
const assert = require('assert');
const intros = require('../services/wingguyIntroductions');
const { introChecksNote } = require('../services/wingguyMailMcp');

let failures = 0;
const check = (name, fn) => { try { fn(); console.log(`  ✓ ${name}`); } catch (e) { failures++; console.error(`  ✗ ${name}\n    ${e.message}`); } };

const client = (id, name, email, alt = '') => ({
  id: `rec${id}`, clientId: id, clientName: name, clientEmailAddress: email, coach: 'Guy-Wilson',
  rawRecord: { _rawJson: { fields: { 'Alternative Email Addresses': alt } } },
});
const dean = client('Dean', 'Dean Hobin', 'dean@hobin.example');
const owen = client('Owen', 'Owen Pyrah', 'owen@pyrah.example', 'o.pyrah@work.example; owen2@x.example');
const clients = [dean, owen];
const self = new Set(['guy@knowaguy.example']);

console.log('detectIntroduction');

check('two clients in one introduction email -> logged, first client anchors', () => {
  const r = intros.detectIntroduction({
    recipients: [{ email: 'Dean@Hobin.example', name: 'Dean' }, { email: 'owen@pyrah.example', name: 'Owen' }],
    subject: 'Introduction: Dean, meet Owen', text: '', selfEmails: self, clients,
  });
  assert.strictEqual(r.client.id, 'recDean');
  assert.strictEqual(r.other.name, 'Owen Pyrah');
  assert.strictEqual(r.other.client.id, 'recOwen');
  assert.deepStrictEqual(r.parties, ['dean@hobin.example', 'owen@pyrah.example']);
});

check('client + outsider -> the client anchors whichever order, outsider named from the recipient', () => {
  const r = intros.detectIntroduction({
    recipients: [{ email: 'jane@acme.example', name: 'Jane Smith' }, { email: 'o.pyrah@work.example' }],
    subject: 'You two should meet', text: '', selfEmails: self, clients,
  });
  assert.strictEqual(r.client.id, 'recOwen', 'an alternative address still finds the client');
  assert.strictEqual(r.other.name, 'Jane Smith');
  assert.strictEqual(r.other.client, null);
});

check('the wording can be in the body, and a Cc to yourself is not a third party', () => {
  const r = intros.detectIntroduction({
    recipients: [{ email: 'dean@hobin.example' }, { email: 'jane@acme.example', name: 'Jane' }, { email: 'guy@knowaguy.example' }],
    subject: 'Dean and Jane', text: 'I wanted to introduce you both.', selfEmails: self, clients,
  });
  assert.ok(r);
  assert.strictEqual(r.client.id, 'recDean');
});

check('no introduction wording -> not an introduction (a joint session note)', () => {
  assert.strictEqual(intros.detectIntroduction({
    recipients: [{ email: 'dean@hobin.example' }, { email: 'owen@pyrah.example' }],
    subject: 'Thursday group session', text: 'See you both at 2pm.', selfEmails: self, clients,
  }), null);
});

check('three people -> not paired up', () => {
  assert.strictEqual(intros.detectIntroduction({
    recipients: [{ email: 'dean@hobin.example' }, { email: 'owen@pyrah.example' }, { email: 'jane@acme.example' }],
    subject: 'Introductions all round', text: '', selfEmails: self, clients,
  }), null);
});

check('one person, or two non-clients, or one client at two addresses -> null', () => {
  const base = { subject: 'Introduction', text: '', selfEmails: self, clients };
  assert.strictEqual(intros.detectIntroduction({ ...base, recipients: [{ email: 'dean@hobin.example' }] }), null);
  assert.strictEqual(intros.detectIntroduction({ ...base, recipients: [{ email: 'a@x.example' }, { email: 'b@y.example' }] }), null);
  assert.strictEqual(intros.detectIntroduction({ ...base, recipients: [{ email: 'owen@pyrah.example' }, { email: 'owen2@x.example' }] }), null);
});

console.log('findSentCopy / repliesFrom');

const draftedMs = Date.parse('2026-09-03T01:00:00Z');
const parties = ['dean@hobin.example', 'jane@acme.example'];

check('the sent copy is the coach\'s message to a party after the draft - earliest wins', () => {
  const sent = intros.findSentCopy([
    { id: 'old', fromEmail: 'guy@knowaguy.example', to: 'dean@hobin.example', date: '2026-09-01T00:00:00Z' },
    { id: 'reply', fromEmail: 'jane@acme.example', to: 'guy@knowaguy.example, dean@hobin.example', date: '2026-09-03T05:00:00Z' },
    { id: 'late', fromEmail: 'guy@knowaguy.example', to: 'Dean@Hobin.example, jane@acme.example', date: '2026-09-04T00:00:00Z' },
    { id: 'sent', fromEmail: 'guy@knowaguy.example', to: 'dean@hobin.example, jane@acme.example', date: '2026-09-03T02:00:00Z' },
  ], { parties, draftedMs });
  assert.strictEqual(sent.id, 'sent');
});

check('nothing sent yet -> null', () => {
  assert.strictEqual(intros.findSentCopy([
    { id: 'other', fromEmail: 'guy@knowaguy.example', to: 'someone@else.example', date: '2026-09-03T02:00:00Z' },
  ], { parties, draftedMs }), null);
});

check('replies = the parties\' own messages after the send, oldest first', () => {
  const sentMs = Date.parse('2026-09-03T02:00:00Z');
  const r = intros.repliesFrom([
    { id: 'guy', fromEmail: 'guy@knowaguy.example', date: '2026-09-05T00:00:00Z' },
    { id: 'jane', fromEmail: 'Jane@Acme.example', date: '2026-09-06T00:00:00Z' },
    { id: 'dean', fromEmail: 'dean@hobin.example', date: '2026-09-04T00:00:00Z' },
    { id: 'before', fromEmail: 'dean@hobin.example', date: '2026-09-02T00:00:00Z' },
  ], { parties, sentMs });
  assert.deepStrictEqual(r.map((m) => m.id), ['dean', 'jane']);
});

console.log('isDue');

const now = Date.parse('2026-09-25T00:00:00Z');
const row = (extra) => ({ direction: 'From Guy', stage: 'Introduced', introducedOn: '2026-09-03', lastModified: '2026-09-04T00:00:00.000Z', ...extra });

check('Introduced 3 Sep, untouched since 4 Sep -> due on 25 Sep', () => assert.strictEqual(intros.isDue(row(), now), true));
check('an answer recorded 20 Sep pushes it out', () => assert.strictEqual(intros.isDue(row({ lastModified: '2026-09-20T00:00:00.000Z' }), now), false));
check('still waiting to be sent (Promised) -> not due', () => assert.strictEqual(intros.isDue(row({ stage: 'Promised' }), now), false));
check('moved on (Call held / Went quiet) -> not due', () => {
  assert.strictEqual(intros.isDue(row({ stage: 'Call held' }), now), false);
  assert.strictEqual(intros.isDue(row({ stage: 'Went quiet' }), now), false);
});
check('an introduction TO Guy is never a check-in', () => assert.strictEqual(intros.isDue(row({ direction: 'To Guy' }), now), false));
check('no dates at all -> not due (nothing to count from)', () => assert.strictEqual(intros.isDue(row({ introducedOn: null, lastModified: null }), now), false));

console.log('checkLine / introChecksNote');

check('quiet thread', () => {
  const line = intros.checkLine({ person: 'Owen Pyrah', introducedTo: 'Dean Hobin', introducedOn: '2026-09-03', threadChecked: true, replies: [] });
  assert.ok(/^You introduced Owen Pyrah to Dean Hobin on 3 Sept? - nobody has replied on that thread\.$/.test(line), line);
});
check('someone replied', () => {
  const line = intros.checkLine({ person: 'Jane Smith', introducedTo: 'Dean Hobin', introducedOn: '2026-09-03', threadChecked: true, replies: [{ name: 'Jane Smith', date: '2026-09-05T03:00:00Z' }] });
  assert.ok(/Jane Smith replied on the thread on 5 Sept?, nothing recorded since\.$/.test(line), line);
});
check('logged by hand, no thread', () => {
  const line = intros.checkLine({ person: 'Jane Smith', introducedTo: 'Dean Hobin', introducedOn: '2026-09-03', threadChecked: false, replies: [] });
  assert.ok(line.endsWith('no email thread on record to check.'), line);
});
check('house style: no em or en dashes in anything Guy reads', () => {
  const note = introChecksNote([{ line: intros.checkLine({ person: 'A', introducedTo: 'B', introducedOn: '2026-09-03', threadChecked: true, replies: [] }) }]);
  assert.ok(!/[–—]/.test(note), note);
  assert.ok(note.includes('INTRODUCTIONS TO CHECK ON (1)'));
});
check('nothing due -> nothing added', () => {
  assert.strictEqual(introChecksNote([]), '');
  assert.strictEqual(introChecksNote(undefined), '');
});

if (failures) { console.error(`\n${failures} failing`); process.exit(1); }
console.log('\nall passing');
