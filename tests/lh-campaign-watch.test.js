/**
 * Tests for the campaign watch (services/lhCampaignWatch.js, 8 Oct 2026): the trial-ending warning
 * five days before day 14, and the campaign-gone-quiet alert after four days with no invitation.
 *
 * Pure functions plus injected senders - no Airtable, no Mailgun. ⚠ Synthetic clients only.
 *
 * Run: node tests/lh-campaign-watch.test.js
 */
const assert = require('assert');
const w = require('../services/lhCampaignWatch');

let failures = 0;
const pending = [];
const check = (name, fn) => {
  const done = (e) => {
    if (e) { failures++; console.error(`  ✗ ${name}\n    ${e.message}`); } else console.log(`  ✓ ${name}`);
  };
  try {
    const r = fn();
    if (r && typeof r.then === 'function') pending.push(r.then(() => done(), done));
    else done();
  } catch (e) { done(e); }
};

const DAY = 86400000;
const NOW = Date.parse('2026-10-08T09:00:00Z');
const daysAgo = (d) => new Date(NOW - d * DAY).toISOString();
const F = w.FIELDS;
const report = (over) => ({ first_action_at: daysAgo(40), last_invite_at: daysAgo(0.2), waiting_running: 500, waiting_paused: 0, ...over });
const step = (r, client = {}) => w.campaignStep({ report: r, client, now: NOW });

console.log('campaignStep() - the facts:');

check('no campaign block (old watchdog) - nothing written, nothing sent', () => {
  for (const r of [null, undefined, {}]) {
    const s = step(r);
    assert.deepEqual(s.fields, {});
    assert.equal(s.trialWarn || s.quietAlert || s.quietRecovered, false);
  }
});

check('the facts are written every report', () => {
  const s = step(report({ waiting_running: 12, waiting_paused: 3 }));
  assert.equal(s.fields[F.firstAction], daysAgo(40));
  assert.equal(s.fields[F.lastInvite], daysAgo(0.2));
  assert.equal(s.fields[F.waiting], 15);
});

console.log('campaignStep() - trial ending:');

check('day 10 of the trial (4 days left) - warn once, and stamp it', () => {
  const s = step(report({ first_action_at: daysAgo(10) }));
  assert.equal(s.trialWarn, true);
  assert.equal(s.fields[F.trialWarned], new Date(NOW).toISOString());
});

check('day 8 (6 days left) - too early', () => {
  assert.equal(step(report({ first_action_at: daysAgo(8) })).trialWarn, false);
});

check('day 9 exactly (5 days left) - warns', () => {
  assert.equal(step(report({ first_action_at: daysAgo(9) })).trialWarn, true);
});

check('already warned - never again', () => {
  assert.equal(step(report({ first_action_at: daysAgo(11) }), { trialWarningSent: daysAgo(1) }).trialWarn, false);
});

check('trial long over (history imported, or bought months ago) - never warned', () => {
  assert.equal(step(report({ first_action_at: daysAgo(15) })).trialWarn, false);
  assert.equal(step(report({ first_action_at: '2020-11-03T05:19:24Z' })).trialWarn, false);
});

check('no campaign ever run - no trial, no warning', () => {
  assert.equal(step(report({ first_action_at: null, last_invite_at: null })).trialWarn, false);
});

check('Rick: first action 29 Sep 06:59Z - warned from 8 Oct 06:59Z, ends 13 Oct', () => {
  const ends = w.trialEndsAt('2026-09-29T06:59:40Z');
  assert.equal(new Date(ends).toISOString(), '2026-10-13T06:59:40.000Z');
  const r = report({ first_action_at: '2026-09-29T06:59:40Z' });
  assert.equal(w.campaignStep({ report: r, now: Date.parse('2026-10-08T06:00:00Z') }).trialWarn, false);
  assert.equal(w.campaignStep({ report: r, now: Date.parse('2026-10-08T07:30:00Z') }).trialWarn, true);
});

console.log('campaignStep() - campaign gone quiet:');

check('sending normally - nothing', () => {
  const s = step(report());
  assert.equal(s.quietAlert, false);
  assert.equal(F.quietAlerted in s.fields, false);
});

check('three days rest (a normal weekend for a 4-day campaign) - nothing', () => {
  assert.equal(step(report({ last_invite_at: daysAgo(3.9) })).quietAlert, false);
});

check('four days with people waiting - alert, kind "stopped"', () => {
  const s = step(report({ last_invite_at: daysAgo(4.2) }));
  assert.equal(s.quietAlert, true);
  assert.equal(s.kind, 'stopped');
  assert.equal(s.fields[F.quietAlerted], new Date(NOW).toISOString());
});

check('four days, only paused campaigns have people - kind "paused"', () => {
  assert.equal(step(report({ last_invite_at: daysAgo(5), waiting_running: 0, waiting_paused: 449 })).kind, 'paused');
});

check('four days, nobody left anywhere - kind "empty"', () => {
  assert.equal(step(report({ last_invite_at: daysAgo(5), waiting_running: 0, waiting_paused: 0 })).kind, 'empty');
});

check('already alerted, still quiet - never again', () => {
  const s = step(report({ last_invite_at: daysAgo(6) }), { quietCampaignAlerted: daysAgo(2) });
  assert.equal(s.quietAlert, false);
  assert.equal(s.quietRecovered, false);
});

check('an invitation since the alert - clears it and says sending again', () => {
  const s = step(report({ last_invite_at: daysAgo(0.1) }), { quietCampaignAlerted: daysAgo(2) });
  assert.equal(s.quietRecovered, true);
  assert.equal(s.fields[F.quietAlerted], null);
});

check('quiet for over a month (a choice, e.g. imported history) - never alerted', () => {
  assert.equal(step(report({ last_invite_at: daysAgo(31) })).quietAlert, false);
  assert.equal(step(report({ last_invite_at: '2026-06-12T05:46:07Z' })).quietAlert, false);
});

check('never sent an invitation (new machine, campaign paused for launch) - nothing', () => {
  assert.equal(step(report({ last_invite_at: null, waiting_running: 0, waiting_paused: 449 })).quietAlert, false);
});

console.log('wording:');

const nodash = (s) => assert.ok(!/[–—]/.test(s), `house style: no en or em dash in: ${s.slice(0, 60)}`);

check('trial email: first name, the end day, the licence page, the promo warning, "ignore if bought"', () => {
  const m = w.trialClientEmail({ clientFirstName: 'Alex', coachName: 'Guy Wilson', firstActionAt: '2026-09-29T06:59:40Z', timeZone: 'Australia/Sydney' });
  assert.equal(m.subject, 'Your Linked Helper trial ends on Tuesday 13 October');
  assert.match(m.text, /^Hi Alex,/);
  assert.match(m.text, /https:\/\/knowaguy\.com\.au\/your-licence/);
  assert.match(m.text, /before you press Proceed to Payment/);
  assert.match(m.text, /already bought it, you're all set/);
  assert.match(m.text, /Cheers,\nGuy$/);
  nodash(m.subject + m.text);
});

check('quiet emails: one per kind, each with its own fix', () => {
  const base = { clientFirstName: 'Alex', coachName: 'Guy', lastInviteAt: '2026-10-03T03:00:00Z', machineLink: 'https://alex.example.com', timeZone: 'Australia/Sydney' };
  const stopped = w.quietClientEmail({ ...base, kind: 'stopped' });
  assert.equal(stopped.subject, 'Your campaign has stopped sending');
  assert.match(stopped.text, /since Saturday 3 October/);
  assert.match(stopped.text, /https:\/\/alex\.example\.com/);
  assert.match(stopped.text, /your-licence/);
  const empty = w.quietClientEmail({ ...base, kind: 'empty' });
  assert.equal(empty.subject, 'Your campaign has run out of people');
  assert.match(empty.text, /Help me with my first campaign/);
  const paused = w.quietClientEmail({ ...base, kind: 'paused' });
  assert.equal(paused.subject, 'Your campaign is paused');
  assert.match(paused.text, /paused it on purpose/);
  for (const m of [stopped, empty, paused]) nodash(m.subject + m.text);
});

check('coach lines: who, since when, how many waiting, and the machine status for "stopped"', () => {
  const line = w.quietCoachLine({ clientName: 'Client A', kind: 'stopped', lastInviteAt: daysAgo(5), waiting: 1340, machineStatus: 'RUNNING | LinkedIn LOGGED OUT', timeZone: 'Australia/Brisbane', now: NOW });
  assert.match(line, /^Client A's campaign has stopped sending - no invitation since .+ \(5 days\), with 1340 people still waiting\./);
  assert.match(line, /Machine says: RUNNING \| LinkedIn LOGGED OUT\./);
  assert.match(w.trialCoachLine({ clientName: 'Client A', firstActionAt: daysAgo(10), timeZone: 'Australia/Brisbane' }), /^Client A's Linked Helper trial ends about /);
  for (const kind of ['stopped', 'paused', 'empty']) {
    for (const self of [true, false]) nodash(w.quietCoachLine({ clientName: 'A', kind, lastInviteAt: daysAgo(5), waiting: 3, self, now: NOW }));
  }
});

console.log('quietCampaignAlerts():');

const COACH = 'Coach-One';
const client = (over) => ({
  clientId: 'Client-A', clientName: 'Client A', coach: COACH, status: 'Active', coachingStatus: 'Graduated',
  quietCampaignAlerted: daysAgo(1), lastInviteSent: daysAgo(5), invitesWaiting: 40, machineStatus: 'RUNNING | LinkedIn ok', ...over,
});
const list = (clients) => w.quietCampaignAlerts({ coachClientId: COACH, clients, now: NOW });

check('alerted and still quiet - on the list', () => {
  const out = list([client()]);
  assert.equal(out.length, 1);
  assert.equal(out[0].kind, 'campaign-quiet');
  assert.match(out[0].line, /stopped sending/);
});

check('sending again since the alert - off the list', () => {
  assert.equal(list([client({ lastInviteSent: daysAgo(0.1) })]).length, 0);
});

check('not alerted, another coach, paused client, a month quiet - none listed', () => {
  assert.equal(list([
    client({ quietCampaignAlerted: null }), client({ coach: 'Coach-Two' }),
    client({ coachingStatus: 'Paused' }), client({ lastInviteSent: daysAgo(31) }),
  ]).length, 0);
});

console.log('sendCampaignAlert():');

check('client email held (switch off): the coach gets the line and the message to forward', async () => {
  const sent = [];
  const r = await w.sendCampaignAlert({
    client: { clientId: 'Client-A', clientName: 'Client A', clientFirstName: 'Alex', coach: COACH, timezone: 'Australia/Sydney', clientEmailAddress: 'a@example.com' },
    alert: 'trial', report: report({ first_action_at: daysAgo(10) }), now: NOW,
    deps: {
      getClientById: async () => ({ clientName: 'Coach One', clientEmailAddress: 'coach@example.com', timezone: 'Australia/Brisbane' }),
      sendAlertEmail: async (subject, html, to, opts) => { sent.push({ subject, text: opts.text }); },
      sendClientEmail: async () => { throw new Error('must not email the client while the switch is off'); },
    },
  });
  assert.equal(w.EMAIL_CLIENT, false);
  assert.equal(r.clientEmailed, false);
  assert.equal(sent[0].subject, "Client A's Linked Helper trial ends soon");
  assert.match(sent[0].text, /They have NOT been emailed: the client email is switched off until you approve its wording/);
  assert.match(sent[0].text, /Subject: Your Linked Helper trial ends on /);
});

check('a mail failure never throws out of the alert', async () => {
  const r = await w.sendCampaignAlert({
    client: { clientId: 'Client-A', clientName: 'Client A', coach: COACH },
    alert: 'quiet', kind: 'empty', report: report({ last_invite_at: daysAgo(5) }), now: NOW,
    deps: { getClientById: async () => null, sendAlertEmail: async () => { throw new Error('mailgun down'); } },
  });
  assert.equal(r.coachEmailError, 'mailgun down');
});

Promise.all(pending).then(() => {
  if (failures) { console.error(`\n${failures} failing`); process.exit(1); }
  console.log('\nall passing');
});
