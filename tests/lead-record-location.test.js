/**
 * Tests for recordRoleLocation - the lead's city read from the job history on their record.
 *
 * Built from Helia Singh's real {Raw Profile Data} shape (2026-09-17): top card "Australia",
 * current role with no location, a 17-year Perth role that ended 2023.02, and older Melbourne and
 * Sydney roles behind it. Plus the cases the 60-lead sample turned up: a current role WITH a city,
 * and foreign past roles under an "Australia" top card (people who have moved).
 *
 * Run: node tests/lead-record-location.test.js
 */
const assert = require('assert');
const { recordRoleLocation, regionOf, allowedRegions } = require('../services/leadRecordLocation');

let failures = 0;
const check = (name, fn) => { try { fn(); console.log(`  ok  ${name}`); } catch (e) { failures++; console.error(`  FAIL ${name}\n       ${e.message}`); } };

const HELIA = {
  location_name: 'Australia',
  organization_1: 'Wealthy Nations', organization_title_1: 'Fractional CFO / Wealth & Business Mentor', organization_start_1: '2023.01', organization_end_1: null, organization_location_1: null,
  organization_2: 'Assurance Finance and Business Solutions Pty', organization_title_2: 'Senior Financial Specialist', organization_start_2: '2006.08', organization_end_2: '2023.02', organization_location_2: 'Perth, Western Australia, Australia',
  organization_3: 'H&R Block Australia', organization_title_3: 'Tax Consultant', organization_start_3: '2011.06', organization_end_3: '2012.09', organization_location_3: null,
  organization_4: 'iSelect', organization_title_4: 'Para Planner', organization_start_4: '2010.07', organization_end_4: '2010.12', organization_location_4: 'Melbourne, Victoria, Australia',
  organization_5: 'Kidmans Partners Pty Ltd', organization_title_5: 'Finance Manager', organization_start_5: '2005.10', organization_end_5: '2006.08', organization_location_5: 'Melbourne, Victoria, Australia',
  organization_6: 'Challenger Limited', organization_title_6: 'Senior Mortgage Underwriter', organization_start_6: '2003.06', organization_end_6: '2004.11', organization_location_6: 'Sydney, New South Wales, Australia',
  organization_7: null,
};

console.log('Helia - the case that started it:');
check('lands on Perth from the past role, since the current one has no city', () => {
  const r = recordRoleLocation(JSON.stringify(HELIA), 'Australia');
  assert.ok(r, 'nothing found');
  assert.strictEqual(r.timezone, 'Australia/Perth');
  assert.strictEqual(r.source, 'past');
});
check('picks the LATEST-ending past role, not the first one listed with a city', () => {
  // Melbourne roles ended 2010 and 2006; Perth ended 2023. Perth must win regardless of order.
  const r = recordRoleLocation(HELIA, 'Australia');
  assert.strictEqual(r.location, 'Perth, Western Australia, Australia');
  assert.strictEqual(r.endYear, '2023');
});
check('names the org and title so Guy can be told where it came from', () => {
  const r = recordRoleLocation(HELIA, 'Australia');
  assert.strictEqual(r.org, 'Assurance Finance and Business Solutions Pty');
  assert.strictEqual(r.title, 'Senior Financial Specialist');
});
check('accepts the cell as a JSON string or as an already-parsed object', () => {
  assert.strictEqual(recordRoleLocation(JSON.stringify(HELIA), 'Australia').timezone, 'Australia/Perth');
  assert.strictEqual(recordRoleLocation(HELIA, 'Australia').timezone, 'Australia/Perth');
});

console.log('\ncurrent role with a city (65% of the sample):');
check('a current role with a city wins outright, marked current, no end year', () => {
  const p = { ...HELIA, organization_location_1: 'Greater Brisbane Area' };
  const r = recordRoleLocation(p, 'Australia');
  assert.strictEqual(r.timezone, 'Australia/Brisbane');
  assert.strictEqual(r.source, 'current');
  assert.strictEqual(r.endYear, null);
  assert.strictEqual(r.org, 'Wealthy Nations');
});

console.log('\nthe same-country rule (people who have moved):');
check('a foreign PAST role under an "Australia" top card is ignored', () => {
  const p = { ...HELIA, organization_location_2: 'Tokyo, Japan' };
  const r = recordRoleLocation(p, 'Australia');
  // Tokyo skipped; next-latest Australian past role is Melbourne (ended 2010.12).
  assert.ok(r, 'nothing found');
  assert.strictEqual(r.timezone, 'Australia/Melbourne');
  assert.strictEqual(r.endYear, '2010');
});
check('a foreign CURRENT role under an "Australia" top card is a conflict, not a pick', () => {
  const p = { ...HELIA, organization_location_1: 'Zurich, Switzerland' };
  const r = recordRoleLocation(p, 'Australia');
  // Zurich skipped even though current; falls to the Perth past role.
  assert.strictEqual(r.timezone, 'Australia/Perth');
  assert.strictEqual(r.source, 'past');
});
check('only foreign roles and an "Australia" top card -> nothing, never a foreign clock', () => {
  const p = {
    organization_1: 'A', organization_end_1: null, organization_location_1: 'Tokyo, Japan',
    organization_2: 'B', organization_end_2: '2020.01', organization_location_2: 'Singapore',
  };
  assert.strictEqual(recordRoleLocation(p, 'Australia'), null);
});
check('no top-card constraint when the record location is blank', () => {
  const p = { organization_1: 'A', organization_end_1: null, organization_location_1: 'Tokyo, Japan' };
  const r = recordRoleLocation(p, '');
  assert.ok(r && /Tokyo/.test(r.timezone), JSON.stringify(r));
});
check('allowedRegions: "Australia" means Australian zones only', () => {
  const s = allowedRegions('Australia');
  assert.ok(s.has('Australia') && s.size === 1, [...s].join(','));
});
check('regionOf splits the tz database prefix', () => {
  assert.strictEqual(regionOf('Australia/Perth'), 'Australia');
  assert.strictEqual(regionOf('Asia/Tokyo'), 'Asia');
});

console.log('\nrobustness:');
check('malformed JSON -> null, never a throw', () => { assert.strictEqual(recordRoleLocation('{not json', 'Australia'), null); });
check('empty / missing cell -> null', () => { assert.strictEqual(recordRoleLocation('', 'Australia'), null); assert.strictEqual(recordRoleLocation(null, 'Australia'), null); });
check('roles with no locations at all -> null', () => {
  const p = { organization_1: 'A', organization_end_1: null, organization_2: 'B', organization_end_2: '2020.01' };
  assert.strictEqual(recordRoleLocation(p, 'Australia'), null);
});
check('a per-role location that is itself only a country is skipped', () => {
  const p = { organization_1: 'A', organization_end_1: null, organization_location_1: 'Australia' };
  assert.strictEqual(recordRoleLocation(p, 'Australia'), null);
});
check('stops at the first missing organization slot', () => {
  const p = { organization_1: 'A', organization_end_1: null, organization_location_1: null, organization_2: null, organization_3: 'C', organization_end_3: null, organization_location_3: 'Perth, Western Australia' };
  assert.strictEqual(recordRoleLocation(p, 'Australia'), null); // slot 2 empty = list ended
});

console.log(failures ? `\n${failures} FAILED\n` : '\nAll passed\n');
process.exit(failures ? 1 : 0);
