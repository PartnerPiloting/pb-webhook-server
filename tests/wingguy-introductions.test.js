/**
 * Introductions Guy makes - the pure parts (2026-09-25, services/wingguyIntroductions.js).
 *
 * The rules under test:
 *   - a draft to exactly two people that reads like an introduction, with at least one of them the
 *     coach's client, is an introduction; a group email, a note to one person, or two strangers is not;
 *   - the sent copy is the coach's message to the parties after the draft.
 * (The 14-day "how did it go?" check-in was removed 31 Oct 2026 - Guy tracks that an intro was made,
 * never whether they met.)
 *
 * Pure logic only - no Airtable, no mailbox, no database.
 * Run: node tests/wingguy-introductions.test.js
 */
const assert = require('assert');
const intros = require('../services/wingguyIntroductions');

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

check('a client and a colleague at the same company -> not an introduction, even with intro wording', () => {
  // Josh Tunstall's session-one wrap with his boss Matthew Armour on cc (12 Oct 2026).
  const josh = client('Josh', 'Joshua Tunstall', 'josh@procurespot.example');
  assert.strictEqual(intros.detectIntroduction({
    recipients: [{ email: 'josh@procurespot.example' }, { email: 'Matthew@ProcureSpot.example', name: 'Matthew Armour' }],
    subject: 'Session one wrap', text: 'Happy to introduce you to a couple of people next week.', selfEmails: self, clients: [...clients, josh],
  }), null);
});

check('two people on the same freemail domain can still be introduced', () => {
  const gmailDean = client('Dean', 'Dean Hobin', 'dean.hobin@gmail.com');
  const r = intros.detectIntroduction({
    recipients: [{ email: 'dean.hobin@gmail.com' }, { email: 'jane.smith@gmail.com', name: 'Jane Smith' }],
    subject: 'Introduction: Dean, meet Jane', text: '', selfEmails: self, clients: [gmailDean],
  });
  assert.ok(r);
  assert.strictEqual(r.other.name, 'Jane Smith');
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

console.log('findSentCopy');

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

check('no check-in is left behind - nothing asks how an introduction went', () => {
  for (const gone of ['introductionsToCheck', 'isDue', 'checkLine', 'repliesFrom', 'CHECK_DAYS']) {
    assert.strictEqual(intros[gone], undefined, gone);
  }
  assert.strictEqual(require('../services/wingguyMailMcp').introChecksNote, undefined);
});

if (failures) { console.error(`\n${failures} failing`); process.exit(1); }
console.log('\nall passing');
