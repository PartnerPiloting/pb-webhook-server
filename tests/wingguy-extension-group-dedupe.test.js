/**
 * Tests for "a one-to-one thread is never sent as a group" (wingguy-extension/content-wingguy.js
 * 0.3.31, Guy 2026-10-09). On the full /messaging/thread/ page LinkedIn links the short name on
 * every bubble ("Sam") and the full name in the thread header ("Sam Trattles"); the roster counted
 * them as two people and the panel said "Group: Sam, Sam Trattles". The fix is dedupeParticipants,
 * a pure helper inside the content script. The content script is one big IIFE that needs a LinkedIn
 * DOM, so this test lifts the helper's source text out of the REAL file (between its marker comments)
 * and runs that - what is tested is the code that ships, not a copy.
 * Contracts:
 *   1. "Sam" + "Sam Trattles" is ONE person, named by the full name - so not a group.
 *   2. Sam Trattles + Boris Leshinsky (with their short bubble names) is still TWO people, both named.
 *   3. "You" and the signed-in coach (full name, first name, longer form) are dropped.
 *   4. Case and punctuation do not split a person ("sam." vs "Sam Trattles").
 *   5. The better profile link survives the fold: vanity beats the internal /in/ACoA form, and a
 *      link on the short-name entry is kept when the full-name entry has none.
 *   6. Order is first appearance, and a short name seen AFTER the full name still folds in.
 *   7. Two different people who share a first name stay distinct; a bare "Sam" folds into the first
 *      of them, never a third person.
 *   8. Junk input (missing list, empty names) is harmless.
 *   9. The helper really is in the shipping file and really is called from the roster builder.
 * Synthetic names only. Run: node tests/wingguy-extension-group-dedupe.test.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'wingguy-extension', 'content-wingguy.js');
const src = fs.readFileSync(FILE, 'utf8');
const START = '// ---- dedupeParticipants (pure;';
const END = '// ---- end dedupeParticipants ----';
const a = src.indexOf(START);
const b = src.indexOf(END);
assert.ok(a > 0 && b > a, 'dedupeParticipants marker block not found in content-wingguy.js');
const block = src.slice(a, b);
// Evaluated in THIS realm (not a vm context) so the arrays it returns share Node's Array prototype
// and deepStrictEqual can compare them.
const dedupe = new Function(block + '\nreturn dedupeParticipants;')();
assert.strictEqual(typeof dedupe, 'function');

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  ✓ ${name}`); }
  catch (e) { failures++; console.error(`  ✗ ${name}\n    ${e.message}`); }
};
const names = (list) => list.map((p) => p.name);
const COACH = 'guy wilson'; // threadParticipants passes the nav name lower-cased

check('1. short name + full name of the same person is one participant, named in full', () => {
  const out = dedupe([
    { name: 'Sam', profileUrl: 'https://www.linkedin.com/in/ACoAAAxyz' },
    { name: 'Sam Trattles', profileUrl: 'https://www.linkedin.com/in/sam-trattles' },
    { name: 'Sam', profileUrl: 'https://www.linkedin.com/in/ACoAAAxyz' },
  ], COACH);
  assert.deepStrictEqual(names(out), ['Sam Trattles']);
  assert.ok(out.length < 2, 'one person must never count as a group of two');
});

check('2. a real group keeps both people, each under their full name', () => {
  const out = dedupe([
    { name: 'Sam', profileUrl: '' },
    { name: 'Boris', profileUrl: '' },
    { name: 'Sam Trattles', profileUrl: 'https://www.linkedin.com/in/sam-trattles' },
    { name: 'Boris Leshinsky', profileUrl: 'https://www.linkedin.com/in/boris-leshinsky' },
  ], COACH);
  assert.deepStrictEqual(names(out), ['Sam Trattles', 'Boris Leshinsky']);
});

check('3. "You" and the coach are dropped - full name, first name, and a longer form of the coach', () => {
  const out = dedupe([
    { name: 'You', profileUrl: '' },
    { name: 'Guy Wilson', profileUrl: 'https://www.linkedin.com/in/guy-wilson' },
    { name: 'Guy', profileUrl: '' },
    { name: 'Guy Wilson (He/Him)', profileUrl: '' },
    { name: 'Sam Trattles', profileUrl: '' },
  ], COACH);
  assert.deepStrictEqual(names(out), ['Sam Trattles']);
});

check('4. case and punctuation do not split a person', () => {
  const out = dedupe([
    { name: 'sam.', profileUrl: '' },
    { name: 'SAM TRATTLES', profileUrl: '' },
    { name: 'Sam Trattles', profileUrl: '' },
  ], COACH);
  assert.strictEqual(out.length, 1);
});

check('5. the better profile link survives the fold', () => {
  const vanityFirst = dedupe([
    { name: 'Sam', profileUrl: 'https://www.linkedin.com/in/sam-trattles' },
    { name: 'Sam Trattles', profileUrl: 'https://www.linkedin.com/in/ACoAAAxyz' },
  ], COACH);
  assert.deepStrictEqual(vanityFirst, [{ name: 'Sam Trattles', profileUrl: 'https://www.linkedin.com/in/sam-trattles' }]);
  const vanityLater = dedupe([
    { name: 'Sam', profileUrl: 'https://www.linkedin.com/in/ACoAAAxyz' },
    { name: 'Sam Trattles', profileUrl: 'https://www.linkedin.com/in/sam-trattles' },
  ], COACH);
  assert.strictEqual(vanityLater[0].profileUrl, 'https://www.linkedin.com/in/sam-trattles');
  const onlyShortHasLink = dedupe([
    { name: 'Sam Trattles', profileUrl: '' },
    { name: 'Sam', profileUrl: 'https://www.linkedin.com/in/ACoAAAxyz' },
  ], COACH);
  assert.strictEqual(onlyShortHasLink[0].profileUrl, 'https://www.linkedin.com/in/ACoAAAxyz');
});

check('6. first-appearance order, and a short name after the full name still folds in', () => {
  const out = dedupe([
    { name: 'Boris Leshinsky', profileUrl: '' },
    { name: 'Sam Trattles', profileUrl: '' },
    { name: 'Sam', profileUrl: '' },
    { name: 'Boris', profileUrl: '' },
  ], COACH);
  assert.deepStrictEqual(names(out), ['Boris Leshinsky', 'Sam Trattles']);
});

check('7. two people sharing a first name stay distinct; a bare first name is not a third person', () => {
  const out = dedupe([
    { name: 'Sam Trattles', profileUrl: '' },
    { name: 'Sam Jones', profileUrl: '' },
    { name: 'Sam', profileUrl: '' },
  ], COACH);
  assert.deepStrictEqual(names(out), ['Sam Trattles', 'Sam Jones']);
});

check('8. junk input is harmless', () => {
  assert.deepStrictEqual(dedupe(undefined, COACH), []);
  assert.deepStrictEqual(dedupe([{ name: '' }, { name: '   ' }, null, { name: '...' }], ''), []);
  assert.deepStrictEqual(names(dedupe([{ name: 'Sam Trattles' }], '')), ['Sam Trattles']);
});

check('9. the roster builder in the shipping file calls the helper', () => {
  const fn = src.indexOf('function threadParticipants(');
  const next = src.indexOf('function detectGroupThread(');
  assert.ok(fn > 0 && next > fn);
  assert.ok(/dedupeParticipants\(out, self\)/.test(src.slice(fn, next)), 'threadParticipants must run its roster through dedupeParticipants');
});

if (failures) { console.error(`\n${failures} failed`); process.exit(1); }
console.log('\nall passed');
