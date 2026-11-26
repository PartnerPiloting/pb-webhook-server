// The names a lead is stored under when Linked Helper sends them broken.
// Run: node tests/lead-name-repair.test.js
const assert = require('assert');
const { repairLeadName } = require('../utils/nameNormalizer');

const cases = [
  // [first, last, full display name, expected first, expected last, why]
  ['Wilk', '', 'Mat Wilk', 'Mat', 'Wilk', 'surname sent in the first-name slot (Roland Illyes, 27 Nov 2026)'],
  ['Wilk', null, 'Mat Wilk', 'Mat', 'Wilk', 'same, last name null'],
  ['wilk', '-', 'Mat Wilk', 'Mat', 'Wilk', 'same, symbol last name, different case'],
  ['Bree', 'Cfo', 'Bree Taylor CFO', 'Bree', 'Taylor', 'credential as the last name - first name untouched'],
  ['Allan', '-', 'Allan Ryan -Δ', 'Allan', 'Ryan', 'symbol last name - first name untouched'],
  ['Anand', '', 'Dr. Anand Shankaran GAICD, FCPHR', 'Anand', 'Shankaran', 'title and credentials dropped'],
  ['Jan', '', 'Jan Van Der Berg', 'Jan', 'Van Der Berg', 'compound surname survives'],
  ['Mat', 'Wilk', 'Mat Wilk', 'Mat', 'Wilk', 'a good name is left alone'],
  ['Wilk', 'Wilk', 'Mat Wilk', 'Wilk', 'Wilk', 'a usable last name is never second-guessed'],
  ['Carinne', 'Bird, GAICD', 'Carinne Bird, GAICD', 'Carinne', 'Bird', 'credential stripped from a good last name'],
  ['Cher', '', 'Cher', 'Cher', '', 'one-word name: nothing to recover'],
  ['Cher', '', '', 'Cher', '', 'no full name: nothing to recover'],
  ['Li', '', 'Li Li', 'Li', 'Li', 'a real double name stays as it is'],
];

for (const [first, last, full, wantFirst, wantLast, why] of cases) {
  const got = repairLeadName(first, last, full);
  assert.deepStrictEqual(got, { firstName: wantFirst, lastName: wantLast }, `${why}: got ${JSON.stringify(got)}`);
}

// leadService must use it, not its own copy of the logic
const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'services', 'leadService.js'), 'utf8');
assert.ok(/repairLeadName\(/.test(src), 'services/leadService.js no longer calls repairLeadName');

console.log(`lead-name-repair: ${cases.length} cases pass`);
