/**
 * Tests for the skeleton-lead cover + the "waiting person" matcher (2026-09-04).
 *
 * The Rick Wong / Cynthia Lau lesson: a person met on a recorded call can be filed with a name and
 * an email but no LinkedIn URL. Three things must then hold:
 *   1. the Linked Helper duplicate check adopts such a record on the SAME EMAIL (exact, never
 *      substring), and on a same-NAME-only match creates normally (the coach decides);
 *   2. folding a skeleton into the full record loses nothing (emails, phone, location, notes,
 *      search terms) and never overwrites what Linked Helper knew better;
 *   3. the chat tools recognise a parked meeting as "this person" only on first + last name.
 *
 * Pure logic only - no Airtable, no Postgres, no network.
 * Run: node tests/skeleton-leads.test.js
 */
const assert = require('assert');
const sk = require('../services/skeletonLeads');
const { waitingPersonMatchesName } = require('../services/pendingPeopleLookup');

let failures = 0;
const check = (name, fn) => { try { fn(); console.log(`  ✓ ${name}`); } catch (e) { failures++; console.error(`  ✗ ${name}\n    ${e.message}`); } };

const rec = (fields, id = 'recX') => ({ id, fields });

console.log('recordHasEmail - exact membership, primary or alternate:');
check('primary match, case-insensitive', () => assert.ok(sk.recordHasEmail(rec({ Email: 'Cynthia@CynthiaLau.com' }), 'cynthia@cynthialau.com')));
check('alternate match (newline-separated)', () => assert.ok(sk.recordHasEmail(rec({ Email: 'a@b.com', 'Alt Emails': 'x@y.com\ncynthia@cynthialau.com' }), 'cynthia@cynthialau.com')));
check('alternate match (semicolon-separated)', () => assert.ok(sk.recordHasEmail(rec({ 'Alt Emails': 'x@y.com; cynthia@cynthialau.com' }), 'cynthia@cynthialau.com')));
check('substring is NOT a match (jon@x vs tjon@x)', () => assert.ok(!sk.recordHasEmail(rec({ Email: 'tjon@x.com', 'Alt Emails': 'ttjon@x.com' }), 'jon@x.com')));
check('blank email never matches', () => assert.ok(!sk.recordHasEmail(rec({ Email: '' }), '')));

console.log('\nisSkeleton - no LinkedIn URL:');
check('blank URL = skeleton', () => assert.ok(sk.isSkeleton(rec({ 'First Name': 'Cynthia', 'LinkedIn Profile URL': '' }))));
check('missing URL = skeleton', () => assert.ok(sk.isSkeleton(rec({ 'First Name': 'Cynthia' }))));
check('whitespace URL = skeleton', () => assert.ok(sk.isSkeleton(rec({ 'LinkedIn Profile URL': '   ' }))));
check('real URL = not a skeleton', () => assert.ok(!sk.isSkeleton(rec({ 'LinkedIn Profile URL': 'https://linkedin.com/in/cynthia-lau' }))));

console.log('\nformulas - only URL-less records, quotes escaped:');
check('email formula guards on empty URL and checks Email + Alt Emails', () => {
  const f = sk.skeletonByEmailFormula('c@d.com');
  assert.ok(f.includes('LEN({LinkedIn Profile URL} & "") = 0'), f);
  assert.ok(f.includes('LOWER({Email}) = "c@d.com"'), f);
  assert.ok(f.includes('{Alt Emails}'), f);
});
check('email formula without Alt Emails for old bases', () => {
  const f = sk.skeletonByEmailFormula('c@d.com', { withAltEmails: false });
  assert.ok(!f.includes('Alt Emails'), f);
});
check('name formula: skeleton side', () => {
  const f = sk.nameFormula('Cynthia', 'Lau', { withUrl: false });
  assert.ok(f.includes('= 0') && f.includes('"cynthia"') && f.includes('"lau"'), f);
});
check('name formula: full-record side', () => {
  const f = sk.nameFormula('Cynthia', 'Lau', { withUrl: true });
  assert.ok(f.includes('> 0'), f);
});
check('a double quote in a name cannot break out of the formula', () => {
  const f = sk.nameFormula('Cyn"thia', 'Lau', { withUrl: false });
  assert.ok(f.includes('"cyn\\"thia"'), f);
});

console.log('\nmergeSearchTerms - union, order kept, case-insensitive de-dupe:');
check('union', () => assert.strictEqual(sk.mergeSearchTerms('newsletter, banker', 'Banker, sydney'), 'newsletter, banker, sydney'));
check('empty sides', () => assert.strictEqual(sk.mergeSearchTerms('', 'x'), 'x'));

console.log('\nplanMerge - fold a skeleton into the full record without losing anything:');
{
  const skeleton = rec({
    'First Name': 'Cynthia', 'Last Name': 'Lau',
    Email: 'cynthia@cynthialau.com', 'Alt Emails': 'cl@invite.com',
    Phone: '0400 000 000', Location: 'Sydney',
    Notes: '=== MANUAL NOTES ===\n[04/09/2026] Met on a call about bankers',
    'Search Terms': 'newsletter',
  }, 'recSkel');
  const target = rec({
    'First Name': 'Cynthia', 'Last Name': 'Lau',
    'LinkedIn Profile URL': 'https://linkedin.com/in/cynthia-lau',
    Email: 'cynthia.lau@bigbank.com', 'Alt Emails': '',
    Phone: '', Location: 'Sydney, New South Wales',
    Notes: '=== LINKEDIN MESSAGES ===\n[03/09/2026] hi',
    'Search Terms': 'banker',
  }, 'recFull');
  const plan = sk.planMerge(skeleton, target, { today: new Date('2026-09-04T00:00:00Z') });
  check('target keeps its own primary email', () => assert.strictEqual(plan.Email, undefined));
  check('skeleton primary + alternates land under Alt Emails', () => assert.strictEqual(plan['Alt Emails'], 'cynthia@cynthialau.com\ncl@invite.com'));
  check('blank phone filled from skeleton', () => assert.strictEqual(plan.Phone, '0400 000 000'));
  check('non-blank location NOT overwritten (Linked Helper is fresher)', () => assert.strictEqual(plan.Location, undefined));
  check('skeleton notes appended under a dated marker, existing notes intact', () => {
    assert.ok(plan.Notes.startsWith('=== LINKEDIN MESSAGES ===\n[03/09/2026] hi'), plan.Notes);
    assert.ok(plan.Notes.includes('=== MERGED FROM EARLIER RECORD ('), plan.Notes);
    assert.ok(plan.Notes.endsWith('Met on a call about bankers'), plan.Notes);
  });
  check('search terms unioned', () => assert.strictEqual(plan['Search Terms'], 'banker, newsletter'));
}
check('target with NO primary takes the skeleton primary', () => {
  const plan = sk.planMerge(rec({ Email: 'c@d.com' }), rec({ Email: '', 'LinkedIn Profile URL': 'https://linkedin.com/in/x' }));
  assert.strictEqual(plan.Email, 'c@d.com');
  assert.strictEqual(plan['Alt Emails'], undefined);
});
check('nothing to carry = empty plan', () => {
  const plan = sk.planMerge(rec({ Email: 'c@d.com' }), rec({ Email: 'c@d.com', 'LinkedIn Profile URL': 'https://linkedin.com/in/x' }));
  assert.deepStrictEqual(plan, {});
});
check('a duplicate alternate is not doubled', () => {
  const plan = sk.planMerge(rec({ Email: 'c@d.com', 'Alt Emails': 'e@f.com' }), rec({ Email: 'x@y.com', 'Alt Emails': 'e@f.com', 'LinkedIn Profile URL': 'u' }));
  assert.strictEqual(plan['Alt Emails'], 'e@f.com\nc@d.com');
});

console.log('\nwaitingPersonMatchesName - first + last, conservative:');
check('parked name matches (case-insensitive)', () => assert.ok(waitingPersonMatchesName({ name: 'cynthia lau', email: 'x@y.com' }, 'Cynthia Lau')));
check('one-letter typo tolerated on a long name', () => assert.ok(waitingPersonMatchesName({ name: 'Jonathon Simpson', email: 'x@y.com' }, 'Jonathan Simpson')));
check('one-letter difference on a SHORT surname is a different person', () => assert.ok(!waitingPersonMatchesName({ name: 'Cynthia Lao', email: 'x@y.com' }, 'Cynthia Lau')));
check('nameless entry matches on email local part', () => assert.ok(waitingPersonMatchesName({ name: null, email: 'cynthia.lau@bigbank.com' }, 'Cynthia Lau')));
check('initial + surname local part matches', () => assert.ok(waitingPersonMatchesName({ name: null, email: 'clau@bigbank.com' }, 'Cynthia Lau')));
check('different surname does NOT match', () => assert.ok(!waitingPersonMatchesName({ name: 'Cynthia Lam', email: 'x@y.com' }, 'Cynthia Lau')));
check('first name alone is NOT enough', () => assert.ok(!waitingPersonMatchesName({ name: 'Cynthia Lau', email: 'x@y.com' }, 'Cynthia')));
check('surname-only local part does NOT match', () => assert.ok(!waitingPersonMatchesName({ name: null, email: 'lau@bigbank.com' }, 'Cynthia Lau')));
check('unrelated address does NOT match', () => assert.ok(!waitingPersonMatchesName({ name: null, email: 'reception@pia.com.au' }, 'Cynthia Lau')));

if (failures) { console.error(`\n${failures} skeleton-leads test(s) FAILED`); process.exit(1); }
console.log('\nAll skeleton-leads tests passed');
