/**
 * Tests for the Monday campaign numbers (services/lhWeeklyCampaignReport.js, 16 Oct 2026): each
 * campaign's lines as the client would read them, the top-up flag, and Guy's digest.
 *
 * Pure functions only - no Postgres, no Mailgun. The first sample is Guy's own two campaigns as
 * his machine reported them on 16 Oct 2026. ⚠ Synthetic clients otherwise.
 *
 * Run: node tests/lh-weekly-campaign-report.test.js
 */
const assert = require('assert');
const w = require('../services/lhWeeklyCampaignReport');

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  ✓ ${name}`); } catch (e) { failures++; console.error(`  ✗ ${name}\n    ${e.message}`); }
};

const frac = { id: 40, name: 'Fractional in profile', paused: false, waiting: 1114, invited_7d: 74, invited_28d: 269,
  accepted_7d: 23, cohort_invited: 215, cohort_accepted: 100 };
const planners = { id: 39, name: 'Contact Financial Planners', paused: false, waiting: 2, invited_7d: 9, invited_28d: 48,
  accepted_7d: 4, cohort_invited: 32, cohort_accepted: 5 };

check('a healthy campaign: sent + accepted, weeks left at the 28-day pace, acceptance so far', () => {
  const c = w.campaignLines(frac);
  assert.deepStrictEqual(c.lines, [
    'Last week: 74 invitations sent, 23 accepted.',
    '1,114 people left to invite - about 17 weeks at your current pace (about 67 a week).',
    'Of the people invited 2 to 5 weeks ago, 47% have accepted so far.',
  ]);
  assert.strictEqual(c.topUp, false);
});

check('nearly empty = time to top up the search', () => {
  const c = w.campaignLines(planners);
  assert.strictEqual(c.lines[1], '2 people left to invite - less than a week at your current pace (about 12 a week). Time to top up the search.');
  assert.strictEqual(c.topUp, true);
});

check('nobody left at all = top up', () => {
  const c = w.campaignLines({ ...frac, waiting: 0 });
  assert.strictEqual(c.lines[1], 'Nobody left to invite - time to top up the search.');
  assert.strictEqual(c.topUp, true);
});

check('people waiting but nothing sent in 4 weeks says so, without a weeks figure', () => {
  const c = w.campaignLines({ ...frac, invited_7d: 0, invited_28d: 0 });
  assert.strictEqual(c.lines[1], '1,114 people waiting to be invited, but nothing has gone out in the last 4 weeks.');
});

check('a paused campaign says it is paused and that acceptances are not being picked up', () => {
  const c = w.campaignLines({ ...frac, paused: true });
  assert.deepStrictEqual(c.lines, ["Paused - nothing is going out, and acceptances aren't being picked up. 1,114 people waiting to be invited."]);
});

check('no accepted step: no accepted figure and no percentage; a tiny cohort gives no percentage', () => {
  const a = w.campaignLines({ ...frac, accepted_7d: null, cohort_accepted: null });
  assert.strictEqual(a.lines[0], 'Last week: 74 invitations sent.');
  assert.strictEqual(a.lines.length, 2);
  const b = w.campaignLines({ ...frac, cohort_invited: 6, cohort_accepted: 3 });
  assert.strictEqual(b.lines.length, 2);
});

check('one, not ones; a year+ queue says so', () => {
  const c = w.campaignLines({ ...frac, invited_7d: 1, waiting: 1, invited_28d: 4 });
  assert.ok(c.lines[0].startsWith('Last week: 1 invitation sent'));
  assert.ok(c.lines[1].startsWith('1 person left to invite'));
  assert.ok(w.campaignLines({ ...frac, waiting: 9000 }).lines[1].includes('well over a year'));
});

check('cleanCampaigns keeps numbers only and refuses a non-list', () => {
  assert.strictEqual(w.cleanCampaigns(null), null);
  const [c] = w.cleanCampaigns([{ ...frac, waiting: '12', invited_7d: -3, extra: 'x' }]);
  assert.strictEqual(c.waiting, 12);
  assert.strictEqual(c.invited_7d, 0);
  assert.strictEqual(c.extra, undefined);
});

check("Guy's digest: top-ups listed first, clients in name order, stale machines flagged", () => {
  const now = Date.parse('2026-10-19T07:00:00+10:00');
  const d = w.buildDigest([
    { clientId: 'Zed', clientName: 'Zed Client', reportedAt: '2026-10-19T06:55:00+10:00', campaigns: [frac] },
    { clientId: 'Guy-Wilson', clientName: 'Guy Wilson', reportedAt: '2026-10-19T06:55:00+10:00', campaigns: [planners, frac] },
    { clientId: 'Old', clientName: 'Amy Quiet', reportedAt: '2026-10-14T09:00:00+10:00', campaigns: [] },
  ], { now, date: '2026-10-19' });
  assert.deepStrictEqual(d.topUps, ['Guy Wilson - Contact Financial Planners']);
  assert.strictEqual(d.subject, 'Monday campaign numbers - 2026-10-19 (1 needs a top-up)');
  const order = ['== Amy Quiet', '== Guy Wilson', '== Zed Client'].map((h) => d.text.indexOf(h));
  assert.ok(order[0] > 0 && order[0] < order[1] && order[1] < order[2], 'name order');
  assert.ok(d.text.includes('Machine has not reported since'), 'stale flag');
  assert.ok(d.text.includes('No live campaigns.'));
  assert.ok(d.html.includes('<b>Fractional in profile</b>'));
  assert.ok(!/[–—]/.test(d.text + d.html), 'no em or en dashes');
});

console.log(failures ? `\n${failures} failing` : '\nall passing');
process.exit(failures ? 1 : 0);
