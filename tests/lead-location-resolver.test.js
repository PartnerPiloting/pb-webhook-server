// Resolver contract: AU/NZ list wins; world DB fills the rest; ambiguous names ask, never guess.
// Run: node tests/lead-location-resolver.test.js

const assert = require('assert');
const { resolveLeadTimezone, detectTimezone } = require('../services/leadLocationResolver');

let failed = 0;
const check = (label, fn) => {
  try { fn(); console.log(`  ✓ ${label}`); }
  catch (e) { failed++; console.log(`  ✗ ${label}: ${e.message}`); }
};

console.log('AU/NZ-first list still wins outright:');
check('Perth is Western Australia, not Scotland', () => {
  const r = resolveLeadTimezone('Perth');
  assert.strictEqual(r.timezone, 'Australia/Perth');
  assert.strictEqual(r.source, 'aunz-list');
});
check('Newcastle is NSW, not England', () =>
  assert.strictEqual(detectTimezone('Newcastle'), 'Australia/Sydney'));
check('Dandenong suburb coverage intact', () =>
  assert.strictEqual(detectTimezone('Dandenong South, Victoria, Australia'), 'Australia/Melbourne'));
check('Hong Kong via the list', () =>
  assert.strictEqual(detectTimezone('Hong Kong'), 'Asia/Hong_Kong'));

console.log('\nWorld fallback — unambiguous cities and countries:');
check('Berlin → Europe/Berlin', () => {
  const r = resolveLeadTimezone('Berlin');
  assert.strictEqual(r.timezone, 'Europe/Berlin');
  assert.strictEqual(r.detected, true);
  assert.strictEqual(r.source, 'world');
});
check('Berlin, Germany → Europe/Berlin', () =>
  assert.strictEqual(detectTimezone('Berlin, Germany'), 'Europe/Berlin'));
check('Greater Berlin Area (LinkedIn dressing stripped)', () =>
  assert.strictEqual(detectTimezone('Greater Berlin Area'), 'Europe/Berlin'));
check('Warsaw → Europe/Warsaw', () =>
  assert.strictEqual(detectTimezone('Warsaw'), 'Europe/Warsaw'));
check('bare country: Germany → Europe/Berlin', () =>
  assert.strictEqual(detectTimezone('Germany'), 'Europe/Berlin'));
check('qualifier narrows: Birmingham, England → Europe/London', () =>
  assert.strictEqual(detectTimezone('Birmingham, England'), 'Europe/London'));
check('qualifier narrows: Birmingham, Alabama → America/Chicago', () =>
  assert.strictEqual(detectTimezone('Birmingham, Alabama'), 'America/Chicago'));
check('parts fall through: Kowloon, Hong Kong → Asia/Hong_Kong', () =>
  assert.strictEqual(detectTimezone('Kowloon, Hong Kong'), 'Asia/Hong_Kong'));

console.log('\nDominant-population pick (detected, with a relayable note):');
check('France resolves to Paris over overseas territories, with assumedNote', () => {
  const r = resolveLeadTimezone('France');
  assert.strictEqual(r.timezone, 'Europe/Paris');
  assert.strictEqual(r.detected, true);
  assert.ok(r.assumedNote, 'expected an assumedNote');
});

console.log('\nGenuinely ambiguous names ask, never guess:');
check('Springfield is ambiguous with candidates across zones', () => {
  const r = resolveLeadTimezone('Springfield');
  assert.strictEqual(r.detected, false);
  assert.strictEqual(r.ambiguous, true);
  assert.ok(r.candidates.length >= 2);
  assert.ok(new Set(r.candidates.map((c) => c.timezone)).size >= 2);
});
check('bare Birmingham (UK 1.6M vs Alabama 670k — too close) asks', () => {
  const r = resolveLeadTimezone('Birmingham');
  assert.strictEqual(r.ambiguous, true);
});
check('Richmond (Virginia would dominate, but AU candidates exist) asks', () => {
  const r = resolveLeadTimezone('Richmond');
  assert.strictEqual(r.ambiguous, true);
  assert.ok(r.candidates.some((c) => c.place.includes('Australia')));
});
check('San Jose stays on the hand list (pre-existing US entry)', () =>
  assert.strictEqual(detectTimezone('San Jose'), 'America/Los_Angeles'));
check('detectTimezone returns null for ambiguous', () =>
  assert.strictEqual(detectTimezone('Springfield'), null));

console.log('\nUnknowns stay unknown:');
check('gibberish → null, not ambiguous', () => {
  const r = resolveLeadTimezone('Xyzzyville Nowhere');
  assert.strictEqual(r.timezone, null);
  assert.strictEqual(r.ambiguous, false);
});
check('empty → null', () =>
  assert.strictEqual(detectTimezone(''), null));

if (failed) { console.log(`\n❌ ${failed} check(s) failed`); process.exit(1); }
console.log('\n✅ all resolver tests passed');
