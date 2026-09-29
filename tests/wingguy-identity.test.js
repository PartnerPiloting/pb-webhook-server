/**
 * Tests for "is the person on LinkedIn the person Wingguy is signed in as?"
 * (services/wingguyIdentity.js, Guy 2026-09-30 - his extension had quietly become Steve Nelson's
 * and drafted a reply to Guy's own lead signed "Cheers, Steve").
 * Contracts:
 *   1. The real slips are refused: Guy on LinkedIn, Wingguy signed in as a client.
 *   2. Every current client passes as themselves, including the ways LinkedIn dresses a name up
 *      (post-nominals, brackets, accents). A false refusal locks a paying client out.
 *   3. A shared first name alone is never a match (Guy Wilson / Guy McPhee).
 *   4. A missing name on either side is "can't tell" (null), never a refusal.
 *   5. A client whose LinkedIn name differs from their record passes on their LinkedIn URL.
 *
 * Pure. Run: node tests/wingguy-identity.test.js
 */
const assert = require('assert');
let failures = 0;
const check = (name, fn) => { try { fn(); console.log(`  ✓ ${name}`); } catch (e) { failures++; console.error(`  ✗ ${name}\n    ${e.message}`); } };

const { nameTokens, slugLetters, viewerMatchesClient, mismatchMessage } = require('../services/wingguyIdentity');
const verdict = (viewerName, clientName, linkedinUrl) => viewerMatchesClient({ viewerName, clientName, linkedinUrl }).matches;

console.log('wingguy identity');

check('the Shiva slip: Guy on LinkedIn, signed in as Steve Nelson -> refused', () => {
  assert.strictEqual(verdict('Guy Wilson', 'Steve Nelson', 'https://www.linkedin.com/in/stevenelsonau/'), false);
});
check('the Max slip: Guy on LinkedIn, signed in as Dean Hobin (no URL on record) -> refused', () => {
  assert.strictEqual(verdict('Guy Wilson', 'Dean Hobin', ''), false);
});
check('shared first name is not a match: Guy Wilson is not Guy McPhee', () => {
  assert.strictEqual(verdict('Guy Wilson', 'Guy McPhee', 'https://www.linkedin.com/in/guymcphee/'), false);
});

const CLIENTS = [
  ['Guy Wilson', 'Guy Wilson', 'https://www.linkedin.com/in/guy-wilson-safeur/'],
  ['Steve Nelson', 'Steve Nelson', 'https://www.linkedin.com/in/stevenelsonau/'],
  ['Dean Hobin', 'Dean Hobin', ''],
  ['Julian Davis (FILP)', 'Julian Davis', 'https://www.linkedin.com/in/juliandavis-xapi/'],
  ['Sam Noble', 'Sam Noble', ''],
  ['Roland Illyés', 'Roland Illyes', 'https://www.linkedin.com/in/roland-illyes/'],
  ['Guy McPhee', 'Guy McPhee', 'https://www.linkedin.com/in/guymcphee/'],
];
for (const [viewer, client, url] of CLIENTS) {
  check(`${client} passes as themselves ("${viewer}")`, () => assert.strictEqual(verdict(viewer, client, url), true));
}

check('post-nominals and a shortened first name still pass', () => {
  assert.strictEqual(verdict('Matt Bulat, GAICD', 'Matthew Bulat', ''), true);
});
check('accented surname on the record, plain on LinkedIn', () => {
  assert.strictEqual(verdict('Szymon Zurek', 'Szymon Żurek', ''), true);
});
check('one half of a double-barrelled surname is enough', () => {
  assert.strictEqual(verdict('Greg Wilden', 'Greg McLoughlin-Wilden', ''), true);
});
check('different surname on LinkedIn passes when it is in the LinkedIn URL on the record', () => {
  assert.strictEqual(verdict('Jane Porter', 'Jane Smith', 'https://www.linkedin.com/in/jane-porter-consulting/'), true);
});
check('...but a short or first-name fragment in the URL is not enough', () => {
  assert.strictEqual(verdict('Guy Lee', 'Guy McPhee', 'https://www.linkedin.com/in/guymcphee-leeds/'), false);
});
check('one-word client name: first name decides', () => {
  assert.strictEqual(verdict('Cher', 'Cher', ''), true);
  assert.strictEqual(verdict('Guy Wilson', 'Cher', ''), false);
});

check('no LinkedIn name read -> cannot tell, never a refusal', () => {
  assert.strictEqual(verdict('', 'Steve Nelson', ''), null);
  assert.strictEqual(verdict(undefined, 'Steve Nelson', ''), null);
  assert.strictEqual(verdict('  ', 'Steve Nelson', ''), null);
});
check('no name on the client record -> cannot tell', () => {
  assert.strictEqual(verdict('Guy Wilson', '', ''), null);
});

check('nameTokens strips accents, brackets and punctuation', () => {
  assert.deepStrictEqual(nameTokens('Julian Davis (FILP)'), ['julian', 'davis', 'filp']);
  assert.deepStrictEqual(nameTokens('Szymon Żurek'), ['szymon', 'zurek']);
  assert.deepStrictEqual(nameTokens("Sean O'Neil"), ['sean', 'neil']);
});
check('slugLetters reads the /in/ slug and nothing else', () => {
  assert.strictEqual(slugLetters('https://www.linkedin.com/in/guy-wilson-safeur/?x=1'), 'guywilsonsafeur');
  assert.strictEqual(slugLetters('https://example.com/nope'), '');
});
check('the message names both people and carries no long dashes', () => {
  const m = mismatchMessage({ viewerName: 'Guy Wilson', clientName: 'Steve Nelson' });
  assert.ok(m.includes('Guy Wilson') && m.includes('Steve Nelson'));
  assert.ok(!/[–—]/.test(m));
});

if (failures) { console.error(`\n${failures} failed`); process.exit(1); }
console.log('\nall passed');
