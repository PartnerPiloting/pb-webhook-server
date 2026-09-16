// Contract for the offer that goes into the "where are they based?" stop: it only speaks when the
// job history genuinely resolves a timezone the record could not, and it always frames the answer
// as something Guy confirms — never a silent write to {Location}.
const assert = require('assert');
const { jobLocationOffer } = require('../services/wingguyChat');

let failures = 0;
function check(name, fn) {
  try { fn(); console.log(`  ok  ${name}`); }
  catch (e) { failures++; console.log(`  FAIL ${name}\n       ${e.message}`); }
}

const pageWith = (loc) => `Experience
Entropy Dynamics Consulting
Fractional CISO & DPO
Part-time
Apr 2026 - Present · 6 mos
${loc}
Education`;

console.log('\nIt speaks when the job history resolves what the record could not:');
check('John Zhao: record says Australia, current role says Melbourne', () => {
  const out = jobLocationOffer({ location: 'Australia', pageText: pageWith('Melbourne, Victoria, Australia · Remote') });
  assert.ok(out, 'expected an offer');
  assert.ok(/Melbourne, Victoria, Australia/.test(out));
  assert.ok(/Australia\/Melbourne/.test(out), 'expected the resolved IANA zone');
});
check('names the job history as the source', () => {
  const out = jobLocationOffer({ location: 'Australia', pageText: pageWith('Melbourne, Victoria, Australia') });
  assert.ok(/job history/i.test(out));
  assert.ok(/current role/i.test(out));
});
check('hands over a ready leadTimezoneOverride', () => {
  const out = jobLocationOffer({ location: 'Australia', pageText: pageWith('Perth, Western Australia, Australia') });
  assert.ok(/leadTimezoneOverride="Australia\/Perth"/.test(out));
});

console.log('\nIt offers, it never writes:');
check('tells the model not to treat it as confirmed', () => {
  const out = jobLocationOffer({ location: 'Australia', pageText: pageWith('Melbourne, Victoria, Australia') });
  assert.ok(/do not write it to the record yourself/i.test(out));
  assert.ok(/not.*confirmed until he says so/i.test(out));
});
check('asks Guy to save it once he confirms', () => {
  const out = jobLocationOffer({ location: 'Australia', pageText: pageWith('Melbourne, Victoria, Australia') });
  assert.ok(/save that location to the lead's record/i.test(out));
});

console.log('\nIt stays quiet when it has nothing to add:');
check('a job location that is also vague says nothing', () => {
  assert.strictEqual(jobLocationOffer({ location: 'Australia', pageText: pageWith('Australia') }), '');
});
check('an ambiguous job location says nothing', () => {
  assert.strictEqual(jobLocationOffer({ location: 'Australia', pageText: pageWith('Springfield') }), '');
});
check('no pageText (connector turn, no extension) says nothing', () => {
  assert.strictEqual(jobLocationOffer({ location: 'Australia' }), '');
});
check('no profile at all says nothing', () => {
  assert.strictEqual(jobLocationOffer(null), '');
  assert.strictEqual(jobLocationOffer({}), '');
});
check('a past-role-only page says nothing', () => {
  const t = `Experience
Older Co
Analyst
Jan 2019 - Dec 2023 · 5 yrs
Perth, Western Australia, Australia
Education`;
  assert.strictEqual(jobLocationOffer({ location: 'Australia', pageText: t }), '');
});

console.log(failures ? `\n${failures} FAILED\n` : '\nAll passed\n');
process.exit(failures ? 1 : 0);
