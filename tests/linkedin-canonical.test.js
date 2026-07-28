/**
 * Regression tests for utils/linkedinCanonical.js (Bognar/Byrne collision, 2026-07-28).
 *
 * The bug: LinkedIn URL dedup used Airtable SEARCH() (containment), so a slug that is a PREFIX of
 * another slug ("andrewdb" vs "andrewdbyrne") matched, the new lead was refused, and the caller got
 * the wrong person's record. Dedup must be strict equality on the canonical slug; format noise
 * (protocol, www/country subdomain, trailing slash, query, case, whitespace, %-encoding) must NOT
 * split the same person into two.
 *
 * Run: node tests/linkedin-canonical.test.js
 */
const assert = require('assert');
const { canonicalLinkedinSlug, sameLinkedinProfile, findExactSlugMatch, slugPrefilterFormula } = require('../utils/linkedinCanonical');

let failures = 0;
const check = (name, fn) => { try { fn(); console.log(`  ✓ ${name}`); } catch (e) { failures++; console.error(`  ✗ ${name}\n    ${e.message}`); } };

console.log('canonicalLinkedinSlug — one slug out of any spelling:');
check('plain https URL', () => assert.strictEqual(canonicalLinkedinSlug('https://www.linkedin.com/in/andrewdbyrne'), 'andrewdbyrne'));
check('http, no www, trailing slash', () => assert.strictEqual(canonicalLinkedinSlug('http://linkedin.com/in/andrewdb/'), 'andrewdb'));
check('country subdomain', () => assert.strictEqual(canonicalLinkedinSlug('https://au.linkedin.com/in/andrewdb'), 'andrewdb'));
check('query string dropped', () => assert.strictEqual(canonicalLinkedinSlug('https://www.linkedin.com/in/andrewdb?originalSubdomain=au&trk=x'), 'andrewdb'));
check('fragment dropped', () => assert.strictEqual(canonicalLinkedinSlug('https://www.linkedin.com/in/andrewdb#foo'), 'andrewdb'));
check('mixed case lowered', () => assert.strictEqual(canonicalLinkedinSlug('HTTPS://WWW.LinkedIn.com/in/AndrewDB/'), 'andrewdb'));
check('surrounding whitespace trimmed', () => assert.strictEqual(canonicalLinkedinSlug('  https://www.linkedin.com/in/andrewdb/  '), 'andrewdb'));
check('percent-decoded', () => assert.strictEqual(canonicalLinkedinSlug('https://www.linkedin.com/in/jos%C3%A9-garc%C3%ADa'), 'josé-garcía'));
check('bare slug tolerated (lookup callers)', () => assert.strictEqual(canonicalLinkedinSlug('andrewdb'), 'andrewdb'));
check('hostless /in/ path tolerated', () => assert.strictEqual(canonicalLinkedinSlug('/in/andrewdb/'), 'andrewdb'));
check('blank → empty', () => assert.strictEqual(canonicalLinkedinSlug(''), ''));
check('null → empty', () => assert.strictEqual(canonicalLinkedinSlug(null), ''));
check('free text with spaces → empty, not a slug', () => assert.strictEqual(canonicalLinkedinSlug('andrew byrne'), ''));
check('a bare domain is not a slug', () => assert.strictEqual(canonicalLinkedinSlug('linkedin.com'), ''));

console.log('\nsameLinkedinProfile — MUST be the same person:');
check('http vs https', () => assert.ok(sameLinkedinProfile('http://linkedin.com/in/jsmith', 'https://linkedin.com/in/jsmith')));
check('with vs without www', () => assert.ok(sameLinkedinProfile('https://www.linkedin.com/in/jsmith', 'https://linkedin.com/in/jsmith')));
check('with vs without trailing slash', () => assert.ok(sameLinkedinProfile('https://linkedin.com/in/jsmith/', 'https://linkedin.com/in/jsmith')));
check('query params appended', () => assert.ok(sameLinkedinProfile('https://linkedin.com/in/jsmith?originalSubdomain=au', 'https://linkedin.com/in/jsmith')));
check('upper vs lower case', () => assert.ok(sameLinkedinProfile('https://linkedin.com/in/JSmith', 'https://linkedin.com/in/jsmith')));
check('leading/trailing whitespace', () => assert.ok(sameLinkedinProfile(' https://linkedin.com/in/jsmith ', 'https://linkedin.com/in/jsmith')));
check('country subdomain vs www', () => assert.ok(sameLinkedinProfile('https://au.linkedin.com/in/jsmith', 'https://www.linkedin.com/in/jsmith')));

console.log('\nsameLinkedinProfile — MUST be different people:');
check('andrewdb vs andrewdbyrne (the real collision)', () => assert.ok(!sameLinkedinProfile('https://www.linkedin.com/in/andrewdb/', 'https://www.linkedin.com/in/andrewdbyrne')));
check('jsmith vs jsmith2', () => assert.ok(!sameLinkedinProfile('/in/jsmith', '/in/jsmith2')));
check('ali vs alison', () => assert.ok(!sameLinkedinProfile('/in/ali', '/in/alison')));
check('blank vs blank NEVER matches', () => assert.ok(!sameLinkedinProfile('', '')));
check('null vs null NEVER matches', () => assert.ok(!sameLinkedinProfile(null, null)));
check('blank vs real never matches', () => assert.ok(!sameLinkedinProfile('', 'https://linkedin.com/in/jsmith')));

console.log('\nfindExactSlugMatch — the verify half of the prefilter handshake:');
{
  const byrne = { id: 'recByrne', fields: { 'LinkedIn Profile URL': 'https://www.linkedin.com/in/andrewdbyrne' } };
  const bognar = { id: 'recBognar', fields: { 'LinkedIn Profile URL': 'https://www.linkedin.com/in/andrewdb/' } };
  const blank = { id: 'recBlank', fields: {} };
  check('prefix candidate is rejected', () => assert.deepStrictEqual(findExactSlugMatch([byrne], 'andrewdb').map(r => r.id), []));
  check('exact candidate survives among noise', () => assert.deepStrictEqual(findExactSlugMatch([byrne, bognar, blank], 'andrewdb').map(r => r.id), ['recBognar']));
  check('blank stored URL never matches', () => assert.deepStrictEqual(findExactSlugMatch([blank], 'andrewdb'), []));
  check('empty slug matches nothing', () => assert.deepStrictEqual(findExactSlugMatch([byrne, blank], ''), []));
}

console.log('\nslugPrefilterFormula — safe to interpolate:');
check('quotes cannot break out of the formula', () => assert.ok(!slugPrefilterFormula('a"b').includes('"a"b"')));
check('non-ascii slug also prefilters its %-encoded spelling', () => assert.ok(/OR\(/.test(slugPrefilterFormula('josé'))));
check('ascii slug stays a single SEARCH', () => assert.ok(!/OR\(/.test(slugPrefilterFormula('andrewdb'))));

process.exitCode = failures ? 1 : 0;
console.log(failures ? `\n${failures} FAILED` : '\nAll linkedin-canonical tests passed');
