/**
 * Referral tracking - the pure parts (2026-09-14).
 *
 * The rule under test: a referrer's count is MAINTAINED, not cumulative. A referred client counts
 * while they are Active and paying (Billing Source not complimentary); the moment they pause or
 * are comped they stop counting, and three paying = at the referral rate. The pipeline numbers
 * (introduced / in play / signed / intros back / promised) come from the Referrals rows, scoped so
 * one coach never sees another coach's introductions.
 *
 * Pure logic only - no Airtable, no network.
 * Run: node tests/referrals.test.js
 */
const assert = require('assert');
const ref = require('../services/referralService');

let failures = 0;
const check = (name, fn) => { try { fn(); console.log(`  ✓ ${name}`); } catch (e) { failures++; console.error(`  ✗ ${name}\n    ${e.message}`); } };

const client = (id, name, extra = {}, fields = {}) => ({
  id: `rec${id}`, clientId: id, clientName: name, coach: 'Guy-Wilson', status: 'Active', billingSource: null,
  rawRecord: { _rawJson: { fields } }, ...extra,
});

const roland = client('Roland', 'Roland Illyes');
const paulB = client('PaulB', 'Paul Battaglia', {}, { 'Introduced By': ['recRoland'] });
const matt = client('Matt', 'Matthew Armour', {}, { 'Introduced By': ['recRoland'] });
const jc = client('JC', 'JC Bougle', {}, { 'Introduced By': ['recRoland'] });
const other = client('Other', 'Other Coach Client', { coach: 'Julian-Davis' });
const clients = [roland, paulB, matt, jc, other];

const rows = [
  { id: 'r1', person: 'Paul Battaglia', direction: 'To Guy', clientRecordId: 'recRoland', stage: 'Signed', becameClientRecordId: 'recPaulB', notes: '' },
  { id: 'r2', person: 'Matthew Armour', direction: 'To Guy', clientRecordId: 'recRoland', stage: 'Signed', becameClientRecordId: 'recMatt', notes: '' },
  { id: 'r3', person: 'JC Bougle', direction: 'To Guy', clientRecordId: 'recRoland', stage: 'Signed', becameClientRecordId: 'recJC', notes: '' },
  { id: 'r4', person: 'Jay Critchley', direction: 'To Guy', clientRecordId: 'recRoland', stage: 'Call held', notes: '' },
  { id: 'r5', person: 'Kylah Noy', direction: 'To Guy', clientRecordId: 'recRoland', stage: 'Not a prospect', notes: '' },
  { id: 'r6', person: 'Derek Morgan', direction: 'From Guy', clientRecordId: 'recRoland', stage: 'Promised', introducedTo: 'Paul Battaglia', notes: '' },
  { id: 'r7', person: 'Someone Else', direction: 'To Guy', clientRecordId: 'recOther', stage: 'Introduced', notes: '' },
  { id: 'r8', person: 'Orphan Intro', direction: 'To Guy', clientRecordId: null, stage: 'Introduced', notes: '' },
];

console.log('scopeToCoach');
check('drops rows tied to another coach\'s client, keeps unlinked rows, names the client', () => {
  const scoped = ref.scopeToCoach(rows, clients, 'Guy-Wilson');
  assert.deepStrictEqual(scoped.map((r) => r.id), ['r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r8']);
  assert.strictEqual(scoped[0].clientName, 'Roland Illyes');
  assert.strictEqual(scoped[0].becameClientName, 'Paul Battaglia');
  assert.strictEqual(scoped.find((r) => r.id === 'r8').clientName, null);
});

console.log('summariseClient - the maintained count');
check('three active paying referrals = at the referral rate', () => {
  const s = ref.summariseClient(roland, clients, ref.scopeToCoach(rows, clients, 'Guy-Wilson'));
  assert.strictEqual(s.introduced, 5, 'To Guy rows');
  assert.strictEqual(s.open, 1, 'Jay is still in play');
  assert.strictEqual(s.signed, 3);
  assert.strictEqual(s.payingNow, 3);
  assert.deepStrictEqual(s.payingNames.sort(), ['JC Bougle', 'Matthew Armour', 'Paul Battaglia']);
  assert.strictEqual(s.referralRate, true);
  assert.strictEqual(s.introsFromGuy, 0, 'a promised intro is not a made one');
  assert.deepStrictEqual(s.promisedFromGuy, ['Derek Morgan']);
});
check('a referred client who pauses stops counting - the rate is maintained, not earned once', () => {
  const paused = clients.map((c) => (c.clientId === 'JC' ? { ...c, status: 'Paused' } : c));
  const s = ref.summariseClient(roland, paused, ref.scopeToCoach(rows, paused, 'Guy-Wilson'));
  assert.strictEqual(s.signed, 3, 'the pipeline still says three signed');
  assert.strictEqual(s.payingNow, 2, 'but only two count today');
  assert.strictEqual(s.referralRate, false);
});
check('a complimentary client never counts (Billing Source says so)', () => {
  const comped = clients.map((c) => (c.clientId === 'Matt' ? { ...c, billingSource: 'complimentary' } : c));
  const s = ref.summariseClient(roland, comped, ref.scopeToCoach(rows, comped, 'Guy-Wilson'));
  assert.strictEqual(s.payingNow, 2);
  assert.strictEqual(s.referralRate, false);
});
check('a client with no introductions summarises to zeros, not a crash', () => {
  const s = ref.summariseClient(other, clients, []);
  assert.deepStrictEqual(s, { introduced: 0, open: 0, signed: 0, payingNow: 0, payingNames: [], referralRate: false, introsFromGuy: 0, promisedFromGuy: [] });
});

console.log('introducedByName');
check('resolves the link to the referrer\'s name, null when blank or unknown', () => {
  assert.strictEqual(ref.introducedByName(paulB, clients), 'Roland Illyes');
  assert.strictEqual(ref.introducedByName(roland, clients), null);
  assert.strictEqual(ref.introducedByName(client('X', 'X', {}, { 'Introduced By': ['recNobody'] }), clients), null);
});

console.log('normalisers');
check('stage accepts exact, case-insensitive and prefix; rejects junk', () => {
  assert.strictEqual(ref.normaliseStage('call held'), 'Call held');
  assert.strictEqual(ref.normaliseStage('Demo'), 'Demo held');
  assert.strictEqual(ref.normaliseStage('signed'), 'Signed');
  assert.strictEqual(ref.normaliseStage('bogus'), null);
});
check('direction defaults to To Guy and understands in/out wording', () => {
  assert.strictEqual(ref.normaliseDirection(undefined), 'To Guy');
  assert.strictEqual(ref.normaliseDirection('from guy'), 'From Guy');
  assert.strictEqual(ref.normaliseDirection('outbound'), 'From Guy');
  assert.strictEqual(ref.normaliseDirection('sideways'), null);
});

console.log('alreadyIntroduced - have these two met? (2026-10-22)');
const rick = client('Rick', 'Rick Wong', { clientEmailAddress: 'rwong@example.com' });
const johnZhao = { name: 'John Zhao', email: 'john@zhao.example' };
const introRows = [
  // Wingguy-drafted intro, both sides clients, linked by record
  { id: 'i1', person: 'Roland Illyes', direction: 'From Guy', clientRecordId: 'recRick', otherClientRecordId: 'recRoland', stage: 'Introduced', email: '', notes: '' },
  // Guy introduced a non-client to Rick (free text + email)
  { id: 'i2', person: 'John Zhao', direction: 'From Guy', clientRecordId: 'recRick', otherClientRecordId: null, stage: 'Introduced', email: 'john@zhao.example', notes: '' },
  // In flight only
  { id: 'i3', person: 'Derek Morgan', direction: 'From Guy', clientRecordId: 'recRoland', otherClientRecordId: null, stage: 'Promised', email: '', notes: '' },
  // A referral TO Guy: Roland knows Jay
  { id: 'i4', person: 'Jay Critchley', direction: 'To Guy', clientRecordId: 'recRoland', otherClientRecordId: null, stage: 'Call held', email: '', notes: '' },
];
const allClients = [...clients, rick];
check('two clients linked by record - either way round', () => {
  assert.strictEqual(ref.alreadyIntroduced(rick, roland, introRows, allClients), true);
  assert.strictEqual(ref.alreadyIntroduced(roland, rick, introRows, allClients), true);
});
check('a client and a non-client by name, or by email', () => {
  assert.strictEqual(ref.alreadyIntroduced(rick, johnZhao, introRows, allClients), true);
  assert.strictEqual(ref.alreadyIntroduced(rick, { name: 'JOHN ZHAO' }, introRows, allClients), true);
  assert.strictEqual(ref.alreadyIntroduced(rick, { email: 'John@Zhao.example' }, introRows, allClients), true);
});
check('a pair with no row is not introduced', () => {
  assert.strictEqual(ref.alreadyIntroduced(roland, johnZhao, introRows, allClients), false);
  assert.strictEqual(ref.alreadyIntroduced(rick, { name: 'Derek Morgan' }, introRows, allClients), false);
  assert.strictEqual(ref.alreadyIntroduced(rick, paulB, introRows, allClients), false);
});
check('a promised (in-flight) introduction counts, so it is not suggested again', () => {
  assert.strictEqual(ref.alreadyIntroduced(roland, { name: 'Derek Morgan' }, introRows, allClients), true);
});
check('a referral TO Guy means the client and that person have met', () => {
  assert.strictEqual(ref.alreadyIntroduced(roland, { name: 'Jay Critchley' }, introRows, allClients), true);
});
check('a free-text Person that happens to be a client still matches that client by name', () => {
  const rows = [{ id: 'i5', person: 'Rick Wong', direction: 'From Guy', clientRecordId: 'recRoland', otherClientRecordId: null, stage: 'Introduced', email: '', notes: '' }];
  assert.strictEqual(ref.alreadyIntroduced(rick, roland, rows, allClients), true);
});
check('introductionsBetween returns the matching rows, scopeToCoach names the other client', () => {
  const hits = ref.introductionsBetween(rick, roland, introRows, allClients);
  assert.deepStrictEqual(hits.map((r) => r.id), ['i1']);
  const scoped = ref.scopeToCoach(introRows, allClients, 'Guy-Wilson');
  assert.strictEqual(scoped.find((r) => r.id === 'i1').otherClientName, 'Roland Illyes');
  assert.strictEqual(scoped.find((r) => r.id === 'i2').otherClientName, null);
});

if (failures) { console.error(`\n${failures} failing`); process.exit(1); }
console.log('\nall referral tests passed');
