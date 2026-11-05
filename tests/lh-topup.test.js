/**
 * Campaign top-ups (5 Nov 2026): what a pasted link tells us, the words for each job state, the
 * finished email, the signed per-client link, and the machine report cleaner. Pure functions only -
 * no Postgres, no machine.
 *
 * Run: node tests/lh-topup.test.js
 */
const assert = require('assert');
const { checkSearchUrl, degreeObjection, degreeNote } = require('../utils/linkedinSearchUrl');
const topup = require('../services/lhTopUp');
const store = require('../services/lhTopUpStore');

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  ✓ ${name}`); } catch (e) { failures++; console.error(`  ✗ ${name}\n    ${e.message}`); }
};

check('a LinkedIn people search with 2nd + 3rd is fine', () => {
  const c = checkSearchUrl('https://www.linkedin.com/search/results/people/?keywords=cfo&network=%5B%22S%22%2C%22O%22%5D');
  assert.strictEqual(c.ok, true);
  assert.strictEqual(c.kind, 'search-page');
  assert.deepStrictEqual(c.degrees, { first: false, second: true, third: true, known: true });
  assert.strictEqual(degreeObjection(c), null);
  assert.strictEqual(degreeNote(c), null);
});

check('1st-degree in the filter is the one objection worth stopping for', () => {
  const c = checkSearchUrl('https://www.linkedin.com/search/results/people/?keywords=cfo&network=%5B%22F%22%2C%22S%22%5D');
  assert.strictEqual(c.ok, true);
  assert.ok(degreeObjection(c).includes('1st-degree'));
  assert.ok(degreeObjection(c).includes('Untick 1st'));
});

check('Sales Navigator search: both URL dialects read; a saved search gets a soft note, not a refusal', () => {
  const a = checkSearchUrl('https://www.linkedin.com/sales/search/people?query=(filters%3AList((type%3ARELATIONSHIP%2Cvalues%3AList((id%3AS%2Ctext%3A2nd)%2C(id%3AO%2Ctext%3A3rd)))))');
  assert.strictEqual(a.kind, 'sn-search-page');
  assert.deepStrictEqual(a.degrees, { first: false, second: true, third: true, known: true });
  const b = checkSearchUrl('https://www.linkedin.com/sales/search/people?query=(relationship:List(S,O))');
  assert.strictEqual(b.degrees.known, true);
  assert.strictEqual(b.degrees.first, false);
  // A saved-search link's lastViewedAt limits Sales Navigator to people new since then (5 Nov 2026).
  const marked = checkSearchUrl('https://www.linkedin.com/sales/search/people?lastViewedAt=1793186313783&savedSearchId=2004301140&sessionId=gYCt%3D%3D');
  assert.strictEqual(marked.url, 'https://www.linkedin.com/sales/search/people?savedSearchId=2004301140');
  const paged = checkSearchUrl('https://www.linkedin.com/sales/search/people?page=3&query=(relationship:List(S,O))&sessionId=x');
  assert.strictEqual(paged.url, 'https://www.linkedin.com/sales/search/people?query=(relationship:List(S,O))');
  assert.ok(paged.degrees.second && paged.degrees.third);
  const plain = 'https://www.linkedin.com/search/results/people/?keywords=cfo&page=2';
  assert.strictEqual(checkSearchUrl(plain).url, plain);
  const saved = checkSearchUrl('https://www.linkedin.com/sales/search/people?savedSearchId=123');
  assert.strictEqual(saved.ok, true);
  assert.strictEqual(saved.degrees.known, false);
  assert.ok(degreeNote(saved).includes('cannot tell'));
  assert.strictEqual(degreeObjection(saved), null);
});

check('a lead list is accepted; a profile, a company search, an event and a non-LinkedIn link are refused with a reason', () => {
  assert.strictEqual(checkSearchUrl('linkedin.com/sales/lists/people/abc123?x=1').kind, 'sn-list-people-page');
  assert.ok(checkSearchUrl('https://www.linkedin.com/in/guy-wilson').problem.includes("one person's profile"));
  assert.ok(checkSearchUrl('https://www.linkedin.com/search/results/companies/?keywords=x').problem.includes('not a PEOPLE search'));
  assert.ok(checkSearchUrl('https://www.linkedin.com/search/results/people/?eventAttending=123').problem.includes('event'));
  assert.ok(checkSearchUrl('https://google.com/search?q=cfo').problem.includes('not a LinkedIn link'));
  assert.ok(checkSearchUrl('').problem.includes('no link'));
  assert.ok(checkSearchUrl('https://www.linkedin.com/search/results/people/?a=1 and some words').problem.includes('one link'));
});

check('the words for each job state', () => {
  const base = { jobId: 't1', campaignId: 40, campaignName: 'Legal ICP', createdAt: '2026-11-05T00:00:00Z', detail: {} };
  assert.ok(topup.describeJob(null).includes('No top-up has been asked for'));
  assert.ok(topup.describeJob({ ...base, status: 'queued' }).includes('waiting for the Linked Helper machine'));
  assert.ok(topup.describeJob({ ...base, status: 'collecting', detail: { collected: 42, last_collect_at: 'x', minutes_since_last: 3 } }).includes('42 people added so far'));
  const done = topup.describeJob({ ...base, status: 'done', detail: { collected: 180, waiting_now: 209 } });
  assert.ok(done.includes('180 people added') && done.includes('209 now waiting'));
  assert.ok(topup.describeJob({ ...base, status: 'failed', detail: { error: 'no invite step' } }).includes('did not work - no invite step'));
});

check('the finished email: count, the skip rule, the degree line, the next-time line; a failure says why', () => {
  const job = { jobId: 't1', campaignId: 40, campaignName: 'Legal ICP', status: 'done', detail: { collected: 180, waiting_now: 209, degrees: { DISTANCE_2: 171, DISTANCE_1: 9 } } };
  const m = topup.finishedEmail({ firstName: 'Roland', job, coachName: 'Guy', machineLink: 'https://m.example/r' });
  assert.strictEqual(m.subject, 'Your campaign top-up - 180 added to Legal ICP');
  assert.ok(m.text.startsWith('Hi Roland,'));
  assert.ok(m.text.includes('added 180 people from your search to "Legal ICP", so 209 people are now waiting'));
  assert.ok(m.text.includes('already in your list is skipped'));
  assert.ok(m.text.includes('9 of them are already 1st-degree connections'));
  assert.ok(m.text.includes('Change the search on LinkedIn - 2nd and 3rd degree only'));
  assert.ok(!m.text.includes('open the campaign'), 'the check happens on LinkedIn, not in Linked Helper');
  assert.ok(m.text.includes('https://m.example/r'));
  assert.ok(!/[–—]/.test(m.text + m.html), 'no em or en dashes');
  const zero = topup.finishedEmail({ firstName: 'Matt', job: { ...job, detail: { collected: 0 } }, coachName: 'Guy' });
  assert.ok(zero.text.includes('Nobody new was added'));
  const bad = topup.finishedEmail({ firstName: 'Matt', job: { ...job, status: 'failed', detail: { error: 'the machine did not collect this top-up within 6 hours - it may be off' } }, coachName: 'Guy' });
  assert.ok(bad.subject.includes("didn't go through"));
  assert.ok(bad.text.includes('did not collect this top-up within 6 hours'));
});

check('the machine report is clipped to what a receipt needs; stage decides the status', () => {
  const d = store.cleanReport({ ok: true, stage: 'final', collected: '12', degrees: { DISTANCE_2: 12, junk: 'x' }, error: 'a\nb', campaign_name: 'X'.repeat(300) });
  assert.strictEqual(d.collected, 12);
  assert.strictEqual(d.degrees.DISTANCE_2, 12);
  assert.strictEqual(d.degrees.junk, null);
  assert.strictEqual(d.error, 'a b');
  assert.strictEqual(d.campaign_name.length, 120);
  assert.strictEqual(store.cleanReport({ ok: false }).ok, false);
});

check('the per-client link signs and verifies; a doctored one fails', () => {
  process.env.TOPUP_LINK_SECRET = 'test-secret';
  const { topUpLink, verifyTopUpQuery } = require('../utils/topUpLink');
  const link = topUpLink('Roland-Illyes');
  assert.ok(link.startsWith('https://knowaguy.com.au/top-up?c=Roland-Illyes&k='));
  const q = Object.fromEntries(new URL(link).searchParams);
  assert.strictEqual(verifyTopUpQuery(q), 'Roland-Illyes');
  assert.strictEqual(verifyTopUpQuery({ c: 'Sam-Noble', k: q.k }), null);
  assert.strictEqual(verifyTopUpQuery({ c: 'Roland-Illyes', k: 'nope' }), null);
  assert.strictEqual(verifyTopUpQuery({}), null);
});

if (failures) { console.error(`\n${failures} FAILED`); process.exit(1); }
console.log('\nall passing');
