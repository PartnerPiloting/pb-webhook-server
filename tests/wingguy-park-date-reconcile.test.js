/**
 * Tests for reconcileParkDate (services/wingguyFollowupBrief.js, Guy 2026-09-12, Melissa Jarmyn's
 * row): the advice line said "early-to-mid October" and the one-click button said 18 Sep - both
 * out of one triage answer. Contract: when the advice names a month, the park date must fall in
 * it, otherwise the date is dropped (the row falls back to the manual Park picker). No month in the
 * advice = nothing to check = the date stands. Malformed dates never pass.
 *
 * Pure - no network, no Postgres. Synthetic content only.
 *
 * Run: node tests/wingguy-park-date-reconcile.test.js
 */
const assert = require('assert');

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  ✓ ${name}`); }
  catch (e) { failures++; console.error(`  ✗ ${name}\n    ${e.message}`); }
};

const { reconcileParkDate } = require('../services/wingguyFollowupBrief');

console.log('reconcileParkDate');

check('the Melissa case: advice names October, date is September -> dropped', () => {
  assert.strictEqual(reconcileParkDate('2026-09-18', "I'd park Melissa to early-to-mid October — she asked not to be chased while Bali has her attention.", 'Melissa Example'), null);
});

check('advice and date agree (full month name, abbreviation, "Sept") -> date stands', () => {
  assert.strictEqual(reconcileParkDate('2026-10-14', "I'd park him to 14 Oct — he asked you to try again after the audit", 'A'), '2026-10-14');
  assert.strictEqual(reconcileParkDate('2026-10-14', "I'd park him to mid-October", 'A'), '2026-10-14');
  assert.strictEqual(reconcileParkDate('2026-09-25', 'she said late Sept works', 'A'), '2026-09-25');
});

check('advice names two months, date in either -> stands; in neither -> dropped', () => {
  assert.strictEqual(reconcileParkDate('2026-11-03', 'she said late October or early November', 'A'), '2026-11-03');
  assert.strictEqual(reconcileParkDate('2026-12-03', 'she said late October or early November', 'A'), null);
});

check('no month in the advice -> nothing to check, the date stands', () => {
  assert.strictEqual(reconcileParkDate('2026-09-18', "I'd park her a couple of weeks — she is swamped right now", 'A'), '2026-09-18');
  assert.strictEqual(reconcileParkDate('2026-09-18', '', 'A'), '2026-09-18');
  assert.strictEqual(reconcileParkDate('2026-09-18', null, 'A'), '2026-09-18');
});

check('names that merely start like a month are not months', () => {
  assert.strictEqual(reconcileParkDate('2026-09-18', 'Mark and Junior asked for a September call; Augustine too', 'A'), '2026-09-18');
});

check('malformed or missing dates never pass', () => {
  assert.strictEqual(reconcileParkDate(null, 'park him to October', 'A'), null);
  assert.strictEqual(reconcileParkDate('mid-October', 'park him to October', 'A'), null);
  assert.strictEqual(reconcileParkDate('2026-10', 'park him to October', 'A'), null);
});

if (failures) { console.error(`\n${failures} failed`); process.exit(1); }
console.log('\nall passed');
