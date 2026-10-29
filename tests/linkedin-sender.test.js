/**
 * senderIsLead (utils/linkedInSender.js, 30 Oct 2026 - the Guy Newton morning): whose LinkedIn
 * line is it when the client and the lead share a first name. Run: node tests/linkedin-sender.test.js
 */
const assert = require('assert');
let failures = 0;
const check = (name, fn) => { try { fn(); console.log(`  ✓ ${name}`); } catch (e) { failures++; console.error(`  ✗ ${name}\n    ${e.message}`); } };
const { senderIsLead } = require('../utils/linkedInSender');
const GUY = { name: 'Guy Wilson' };

console.log('senderIsLead()');
check('the client\'s own line is never the lead\'s, even with the same first name', () => {
  assert.strictEqual(senderIsLead('Guy Wilson', { first: 'Guy', last: 'Newton' }, GUY), false);
  assert.strictEqual(senderIsLead('Guy Wilson', { first: 'Guy', last: '' }, GUY), false);
});
check('the lead\'s line is theirs when the last name is on it', () => {
  assert.strictEqual(senderIsLead('Guy Newton', { first: 'Guy', last: 'Newton' }, GUY), true);
  assert.strictEqual(senderIsLead('David Furze FCPA', { first: 'David', last: 'Furze' }, { name: 'David Gould' }), true);
});
check('a first-name prefix is not a match: Julia is not Julian, Matt is not Matthew', () => {
  assert.strictEqual(senderIsLead('Julian Davis', { first: 'Julia', last: 'Lippold' }, { name: 'Julian Davis' }), false);
  assert.strictEqual(senderIsLead('Matthew Bulat', { first: 'Matt', last: '' }, {}), false);
  assert.strictEqual(senderIsLead('Matthew Bulat', { first: 'Matt', last: 'Tett' }, {}), false);
});
check('no last name on record -> whole first-name token decides', () => {
  assert.strictEqual(senderIsLead('Owen Senior', { first: 'Owen' }), true);
  assert.strictEqual(senderIsLead('OWEN SENIOR', { first: 'owen' }), true);
  assert.strictEqual(senderIsLead('Owena Smith', { first: 'Owen' }), false);
});
check('without a coach name, the last name still separates two Guys', () => {
  assert.strictEqual(senderIsLead('Guy Wilson', { first: 'Guy', last: 'Newton' }), false);
});
check('empty sender or empty lead -> not theirs', () => {
  assert.strictEqual(senderIsLead('', { first: 'Guy' }, GUY), false);
  assert.strictEqual(senderIsLead('Guy Newton', {}, GUY), false);
});
if (failures) { console.error(`\n${failures} failed`); process.exit(1); }
console.log('\nall passed');
