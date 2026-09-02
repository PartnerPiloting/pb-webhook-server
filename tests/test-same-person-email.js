/**
 * Same-person leftover address (Alix Simpson, 2026-09-02).
 *
 * A meeting matched ONE lead by her Gmail while Fathom's invitee list also carried her work
 * address with no name on it. The work address matched nobody, so it was parked as "someone you
 * met who isn't in Wingguy yet" - a stranger who was in fact the one person on the call.
 *
 * Pure-function checks, no network:  node tests/test-same-person-email.js
 */

const assert = require('assert');
const { localPartMatchesName, claimSameLeadEmails, isFreemailEmail } = require('../services/pendingLeadFilter');

let n = 0;
function check(label, fn) { fn(); n++; console.log(`  ok  ${label}`); }

console.log('localPartMatchesName');
check('first.last reads as the name', () => assert.strictEqual(localPartMatchesName('alix.simpson@absorblms.com', 'Alix Simpson'), true));
check('firstlast (no separator) reads as the name', () => assert.strictEqual(localPartMatchesName('alixsimpson@x.com', 'Alix Simpson'), true));
check('first.middle-initial.last still reads as the name', () => assert.strictEqual(localPartMatchesName('alix.n.simpson@gmail.com', 'Alix Simpson'), true));
check('initial+surname reads as the name', () => assert.strictEqual(localPartMatchesName('asimpson@absorblms.com', 'Alix Simpson'), true));
check('one-letter typo tolerated', () => assert.strictEqual(localPartMatchesName('alix.simson@x.com', 'Alix Simpson'), true));
check('a different person does NOT match', () => assert.strictEqual(localPartMatchesName('steve@salesdirectorcentral.com', 'Alix Simpson'), false));
check('surname alone is not enough', () => assert.strictEqual(localPartMatchesName('simpson@x.com', 'Alix Simpson'), false));
check('single-token name: whole local part matches, a different word does not', () => {
  assert.strictEqual(localPartMatchesName('manish@x.com', 'Manish'), true);
  assert.strictEqual(localPartMatchesName('kumar@x.com', 'Manish'), false);
});
check('a shared surname with a different initial does NOT match', () => assert.strictEqual(localPartMatchesName('bsimpson@absorblms.com', 'Alix Simpson'), false));
check('a bare first name against a two-word name does NOT match', () => assert.strictEqual(localPartMatchesName('alix@gmail.com', 'Alix Simpson'), false));
check('blank inputs never match', () => {
  assert.strictEqual(localPartMatchesName('', 'Alix Simpson'), false);
  assert.strictEqual(localPartMatchesName('alix.simpson@x.com', ''), false);
});

console.log('claimSameLeadEmails');
const alix = { leadId: 'recAlix', name: 'Alix Simpson', email: 'alix.n.simpson@gmail.com', via: 'email' };
check('the Alix case: work address is claimed, nothing parked', () => {
  const r = claimSameLeadEmails({ matched: [alix], candidates: [{ email: 'alix.simpson@absorblms.com' }] });
  assert.deepStrictEqual(r.claimed, [{ email: 'alix.simpson@absorblms.com', leadId: 'recAlix', leadName: 'Alix Simpson' }]);
  assert.deepStrictEqual(r.rest, []);
});
check('a genuine third party is still parked', () => {
  const r = claimSameLeadEmails({ matched: [alix], candidates: [{ email: 'alix.simpson@absorblms.com' }, { email: 'steve@salesdirectorcentral.com', name: 'Steve Martin' }] });
  assert.strictEqual(r.claimed.length, 1);
  assert.deepStrictEqual(r.rest, [{ email: 'steve@salesdirectorcentral.com', name: 'Steve Martin' }]);
});
check('two matched leads: refuse to guess, park everything', () => {
  const bob = { leadId: 'recBob', name: 'Bob Jones', email: 'bob@x.com', via: 'email' };
  const r = claimSameLeadEmails({ matched: [alix, bob], candidates: [{ email: 'alix.simpson@absorblms.com' }] });
  assert.deepStrictEqual(r.claimed, []);
  assert.strictEqual(r.rest.length, 1);
});
check('the same lead matched twice (email + calendar) still counts as one', () => {
  const r = claimSameLeadEmails({ matched: [alix, { ...alix, via: 'calendar-email' }], candidates: [{ email: 'alix.simpson@absorblms.com' }] });
  assert.strictEqual(r.claimed.length, 1);
});
check('no matched lead: nothing claimed', () => {
  const r = claimSameLeadEmails({ matched: [], candidates: [{ email: 'alix.simpson@absorblms.com' }] });
  assert.deepStrictEqual(r.claimed, []);
  assert.strictEqual(r.rest.length, 1);
});
check('an address already on the matched lead is not a candidate', () => {
  const r = claimSameLeadEmails({ matched: [alix], candidates: [{ email: 'alix.n.simpson@gmail.com' }] });
  assert.deepStrictEqual(r.claimed, []);
  assert.deepStrictEqual(r.rest, []);
});

console.log('isFreemailEmail');
check('gmail is freemail', () => assert.strictEqual(isFreemailEmail('alix.n.simpson@gmail.com'), true));
check('a company domain is not', () => assert.strictEqual(isFreemailEmail('alix.simpson@absorblms.com'), false));
check('blank is treated as freemail (nothing to protect)', () => assert.strictEqual(isFreemailEmail(''), true));

console.log(`\n${n} checks passed`);
