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
const pending = [];
const check = (name, fn) => {
  const done = (e) => { if (e) { failures++; console.error(`  ✗ ${name}\n    ${e.message}`); } else console.log(`  ✓ ${name}`); };
  try {
    const r = fn();
    if (r && typeof r.then === 'function') pending.push(r.then(() => done(), done));
    else done();
  } catch (e) { done(e); }
};

const frac = { id: 40, name: 'Fractional in profile', paused: false, waiting: 1114, invited_7d: 74, invited_28d: 269,
  accepted_7d: 23, cohort_invited: 215, cohort_accepted: 100 };
const planners = { id: 39, name: 'Contact Financial Planners', paused: false, waiting: 2, invited_7d: 9, invited_28d: 48,
  accepted_7d: 4, cohort_invited: 32, cohort_accepted: 5 };

check('a healthy campaign: sent + accepted, weeks left at the higher of last week and the 28-day pace, acceptance so far', () => {
  const c = w.campaignLines(frac);
  assert.deepStrictEqual(c.lines, [
    'Last week: 74 invitations sent, 23 accepted.',
    '1,114 people left to invite - about 15 weeks at your current pace (about 74 a week).',
    'Of the people invited 2 to 5 weeks ago, 47% have accepted so far.',
  ]);
  assert.strictEqual(c.topUp, false);
});

check('a young campaign: last week beats the diluted 28-day average (Sam Noble, Barclays, 16 Oct)', () => {
  const c = w.campaignLines({ ...frac, name: 'Barclayss - Reach out', waiting: 431, invited_7d: 111, invited_28d: 121 });
  assert.strictEqual(c.lines[1], '431 people left to invite - about 4 weeks at your current pace (about 111 a week).');
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

check("the client's own email: first name, their campaigns, a top-up nudge only when needed, Guy's sign-off", () => {
  const e = w.clientEmail({ clientFirstName: 'Rick', clientName: 'Rick Wong', coachName: 'Guy Wilson', campaigns: [planners, frac] });
  assert.strictEqual(e.subject, 'Your campaign numbers this week');
  assert.ok(e.text.startsWith('Hi Rick,'));
  assert.ok(e.text.includes('Contact Financial Planners\n- Last week: 9 invitations sent, 4 accepted.'));
  assert.ok(e.text.includes('a fresh search keeps the invitations going'));
  assert.ok(e.text.endsWith('Cheers,\n(I know a) Guy'));
  assert.ok(!w.clientEmail({ clientFirstName: 'Rick', coachName: 'Guy Wilson', campaigns: [frac] }).text.includes('fresh search'));
  assert.ok(e.text.includes('ask your Claude to "open my Linked Helper machine"'), 'no link on record - the Claude fallback');
  const linked = w.clientEmail({ clientFirstName: 'Rick', coachName: 'Guy Wilson', campaigns: [frac], machineLink: 'https://m.example/rick' });
  assert.ok(linked.text.includes('To open your Linked Helper machine: https://m.example/rick'));
  assert.ok(linked.html.includes('<a href="https://m.example/rick">Open your Linked Helper machine</a>'));
  assert.ok(!/[–—]/.test(e.text + e.html), 'no em or en dashes');
});

const NOW2 = Date.parse('2026-10-19T07:00:00+10:00');
const fresh = '2026-10-19T06:55:00+10:00';
const row = (name, client, over = {}) => ({ clientId: name, clientName: name, reportedAt: fresh, campaigns: [frac], client: { coach: 'Guy-Wilson', clientEmailAddress: `${name}@example.com`, clientFirstName: name, mondayCampaignEmail: true, ...client }, ...over });

check('skip reasons: no coach (own row), no address, no campaigns, stale numbers', () => {
  assert.strictEqual(w.skipReason(row('A', {}), NOW2), null);
  assert.ok(w.skipReason(row('A', { coach: null }), NOW2).includes('no coach'));
  assert.ok(w.skipReason(row('A', { clientEmailAddress: ' ' }), NOW2).includes('no email address'));
  assert.ok(w.skipReason(row('A', {}, { campaigns: [] }), NOW2).includes('no live campaigns'));
  assert.ok(w.skipReason(row('A', {}, { reportedAt: '2026-10-15T06:00:00+10:00' }), NOW2).includes('not reported'));
});

check('only TICKED clients are sent theirs; coach copied and replied to; skips reported', async () => {
  const mails = [];
  const logged = [];
  const deps = {
    getClientById: async () => ({ clientName: 'Guy Wilson', clientEmailAddress: 'guy@example.com' }),
    sendClientEmail: async (m) => { mails.push(m); },
    recordComm: async (c) => { logged.push(c); },
  };
  const r = await w.sendClientEmails([
    row('Ticked', {}),
    row('Unticked', { mondayCampaignEmail: false }),
    row('NoAddress', { clientEmailAddress: '' }),
  ], deps, NOW2);
  assert.deepStrictEqual(r.sent, ['Ticked']);
  assert.deepStrictEqual(r.skipped, ['NoAddress - no email address on their record']);
  assert.strictEqual(mails.length, 1);
  assert.strictEqual(mails[0].to, 'Ticked@example.com');
  assert.strictEqual(mails[0].cc, 'guy@example.com');
  assert.strictEqual(mails[0]['h:Reply-To'], 'guy@example.com');
  assert.strictEqual(logged[0].channel, 'lh-weekly-numbers');
});

check("Guy's digest says who was sent theirs, who was skipped, and marks unticked clients", () => {
  const d = w.buildDigest([row('Ticked', {}), row('Unticked', { mondayCampaignEmail: false })],
    { now: NOW2, sent: ['Ticked'], skipped: ['Other - no email address on their record'] });
  assert.ok(d.text.includes('Sent their own email: Ticked.'));
  assert.ok(d.text.includes('Ticked but NOT sent:\n- Other - no email address on their record'));
  assert.ok(d.text.includes('== Unticked (not ticked - only you see this) =='));
  assert.ok(d.text.includes('== Ticked =='));
});

Promise.all(pending).then(() => {
  console.log(failures ? `\n${failures} failing` : '\nall passing');
  process.exit(failures ? 1 : 0);
});
