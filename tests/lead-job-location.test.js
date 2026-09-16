// Contract: read the CURRENT role's location out of scraped profile text, never a past role's,
// and never anything that merely sits near it. Fixture is John Zhao's real profile shape
// (2026-09-16), the case that prompted this.
const assert = require('assert');
const { currentRoleLocation } = require('../services/leadJobLocation');

let failures = 0;
function check(name, fn) {
  try { fn(); console.log(`  ok  ${name}`); }
  catch (e) { failures++; console.log(`  FAIL ${name}\n       ${e.message}`); }
}

const JOHN = `John Zhao
Fractional CISO & Security Advisor | I help technology companies build highly pragmatic and effective security programs
Australia
Contact info

About
Security leader with 20 years across financial services and agriculture.

Experience
Entropy Dynamics Consulting
7 mos
Fractional CISO & DPO
Part-time
Apr 2026 - Present · 6 mos
Melbourne, Victoria, Australia · Remote
• Supported a global technology service provider in enhancing their cybersecurity posture.
• Leveraged cybersecurity as a competitive advantage to differentiate the company.… more
Leadership, Cybersecurity and +2 skills
Principal Consultant
Self-employed
Mar 2026 - Present · 7 mos
Greater Melbourne Area · Hybrid
Leadership, Cyber Defense and +2 skills

Fonterra
10 yrs 2 mos
Head of Cybersecurity Advisory
Full-time
Sep 2023 - Nov 2025 · 2 yrs 3 mos
Melbourne, Victoria, Australia
> Formed cybersecurity advisory function delivering a service-oriented model.… more
Cybersecurity, Strategic Planning and +7 skills

Education
Monash University`;

console.log('\nCurrent role wins:');
check('reads the current role location, not a past one', () => {
  const r = currentRoleLocation(JOHN);
  assert.ok(r, 'expected a result');
  assert.strictEqual(r.location, 'Melbourne, Victoria, Australia');
});
check('strips the Remote work-mode chip', () => {
  assert.ok(!/remote/i.test(currentRoleLocation(JOHN).location));
});
check('carries the role title so the source can be named', () => {
  assert.strictEqual(currentRoleLocation(JOHN).title, 'Fractional CISO & DPO');
});
check('reports the date line it anchored on', () => {
  assert.ok(/Present/i.test(currentRoleLocation(JOHN).dateLine));
});

console.log('\nPast roles are never used:');
check('a profile whose only Present role lacks a location returns null', () => {
  const t = `Experience
Acme
Head of Thing
Jan 2024 - Present · 1 yr
• Did the thing.
Older Co
Analyst
Jan 2019 - Dec 2023 · 5 yrs
Perth, Western Australia, Australia
Education`;
  assert.strictEqual(currentRoleLocation(t), null);
});

console.log('\nNoise is rejected:');
check('the skills line is not taken as a location', () => {
  const t = `Experience
Acme
Head of Thing
Jan 2024 - Present · 1 yr
Leadership, Cybersecurity and +2 skills
Education`;
  assert.strictEqual(currentRoleLocation(t), null);
});
check('a duration line is not taken as a location', () => {
  const t = `Experience
Acme
Head of Thing
Jan 2024 - Present · 1 yr
2 yrs 3 mos
Education`;
  assert.strictEqual(currentRoleLocation(t), null);
});
check('a description bullet is not taken as a location', () => {
  const t = `Experience
Acme
Head of Thing
Jan 2024 - Present · 1 yr
• Ran the security programme.
Education`;
  assert.strictEqual(currentRoleLocation(t), null);
});
check('a Present date inside About cannot be mistaken for a role', () => {
  const t = `About
I have been doing this Jan 2020 - Present and loving it.
Sydney, New South Wales, Australia
Education`;
  assert.strictEqual(currentRoleLocation(t), null);
});
check('no Experience heading returns null rather than guessing', () => {
  assert.strictEqual(currentRoleLocation('John Zhao\nAustralia\nContact info'), null);
});
check('empty input returns null', () => {
  assert.strictEqual(currentRoleLocation(''), null);
  assert.strictEqual(currentRoleLocation(null), null);
});

console.log('\nShapes that should still work:');
check('a role with no employment-type line still resolves', () => {
  const t = `Experience
Acme
Head of Thing
Feb 2025 - Present · 7 mos
Brisbane, Queensland, Australia
Education`;
  assert.strictEqual(currentRoleLocation(t).location, 'Brisbane, Queensland, Australia');
});
check('an area-style location resolves', () => {
  const t = `Experience
Acme
Principal
Mar 2026 - Present · 7 mos
Greater Melbourne Area · Hybrid
Education`;
  assert.strictEqual(currentRoleLocation(t).location, 'Greater Melbourne Area');
});

console.log(failures ? `\n${failures} FAILED\n` : '\nAll passed\n');
process.exit(failures ? 1 : 0);
