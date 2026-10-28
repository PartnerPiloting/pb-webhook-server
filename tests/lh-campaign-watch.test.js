/**
 * Tests for the campaign watch (services/lhCampaignWatch.js, 8 Oct 2026): the trial-ending warning
 * five days before day 14, the campaign-gone-quiet alert after four days with no invitation, and
 * (16 Oct 2026) the fast alert when a campaign sits paused for two hours with people waiting.
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

check('licence already bought (Alex Solti, 27 Oct) - never warned, never stamped', () => {
  const s = step(report({ first_action_at: daysAgo(10) }), { licenceBought: '2026-10-21' });
  assert.equal(s.trialWarn, false);
  assert.equal(s.fields[F.trialWarned], undefined);
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

check('Julian 19 Oct: live campaigns empty, 35 left in a long-parked paused one - kind "empty", not "paused"', () => {
  const r = report({ last_invite_at: daysAgo(4), waiting_running: 0, waiting_paused: 35,
    paused_campaigns: [{ id: 3, name: 'Old search', waiting: 35, last_invite_at: daysAgo(60) }] });
  assert.equal(step(r).kind, 'empty');
});

check('a paused campaign that sent recently still makes it "paused"', () => {
  const r = report({ last_invite_at: daysAgo(4), waiting_running: 0, waiting_paused: 35,
    paused_campaigns: [{ id: 40, name: 'Live', waiting: 35, last_invite_at: daysAgo(4) }] });
  assert.equal(step(r).kind, 'paused');
});

check('four days, nobody left anywhere - kind "empty"', () => {
  assert.equal(step(report({ last_invite_at: daysAgo(5), waiting_running: 0, waiting_paused: 0 })).kind, 'empty');
});

check('Sam: still trying (attempt yesterday), every one failing - kind "exhausted"', () => {
  const s = step(report({ last_invite_at: daysAgo(5.5), waiting_running: 1835, last_invite_attempt_at: daysAgo(0.5), failed_invites_recent: 20 }));
  assert.equal(s.quietAlert, true);
  assert.equal(s.kind, 'exhausted');
});

check('failures but no attempt for days (gave up, not trying) - "stopped", not "exhausted"', () => {
  assert.equal(step(report({ last_invite_at: daysAgo(6), last_invite_attempt_at: daysAgo(3), failed_invites_recent: 4 })).kind, 'stopped');
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

console.log('campaignStep() - paused with people waiting (the fast one):');

const HOUR = 3600000;
const hoursAgo = (h) => new Date(NOW - h * HOUR).toISOString();
const pausedReport = (over = {}, campaigns) => report({
  waiting_running: 0, waiting_paused: 65,
  paused_campaigns: campaigns || [{ id: 40, name: 'Fractional in profile', waiting: 65, last_invite_at: daysAgo(1) }],
  ...over,
});
const PS = F.pausedSince;
const PA = F.pausedAlerted;

check('old watchdog (no paused_campaigns list) - the rule never runs, even with a stamp on the row', () => {
  const s = step(report({ waiting_paused: 65 }), { campaignPausedSince: hoursAgo(5) });
  assert.equal(s.pausedAlert, false);
  assert.equal(s.pausedRecovered, false);
  assert.equal(PS in s.fields, false);
});

check('first sight of a paused campaign with people waiting - stamp when, no email', () => {
  const s = step(pausedReport());
  assert.equal(s.pausedAlert, false);
  assert.equal(s.fields[PS], new Date(NOW).toISOString());
  assert.equal(PA in s.fields, false);
  assert.deepEqual(s.paused, { name: 'Fractional in profile', waiting: 65, since: new Date(NOW).toISOString() });
});

check('paused under two hours - still no email', () => {
  const s = step(pausedReport(), { campaignPausedSince: hoursAgo(1.9) });
  assert.equal(s.pausedAlert, false);
  assert.equal(PS in s.fields, false);
  assert.equal(s.paused.since, hoursAgo(1.9));
});

check('paused over two hours with people waiting - ONE email, naming the campaign, when first seen and people', () => {
  const s = step(pausedReport(), { campaignPausedSince: hoursAgo(2.5) });
  assert.equal(s.pausedAlert, true);
  assert.equal(s.fields[PA], new Date(NOW).toISOString());
  assert.deepEqual(s.paused, { name: 'Fractional in profile', waiting: 65, since: hoursAgo(2.5) });
});

check('still paused on the next report - no second email', () => {
  const s = step(pausedReport(), { campaignPausedSince: hoursAgo(2.6), pausedCampaignAlerted: hoursAgo(0.1) });
  assert.equal(s.pausedAlert, false);
  assert.equal(s.pausedRecovered, false);
  assert.equal(PA in s.fields, false);
  assert.equal(s.paused.since, hoursAgo(2.6));
});

check('resumed (no paused campaign with people left) - episode cleared and the all-clear goes', () => {
  const s = step(pausedReport({}, []), { campaignPausedSince: hoursAgo(3), pausedCampaignAlerted: hoursAgo(1) });
  assert.equal(s.pausedRecovered, true);
  assert.equal(s.fields[PS], null);
  assert.equal(s.fields[PA], null);
  assert.equal(s.paused, null);
});

check('resumed before the alert ever fired - stamp cleared quietly, no all-clear', () => {
  const s = step(pausedReport({}, []), { campaignPausedSince: hoursAgo(1) });
  assert.equal(s.pausedRecovered, false);
  assert.equal(s.fields[PS], null);
});

check('nothing paused and nothing stamped - nothing written', () => {
  const s = step(pausedReport({}, []));
  assert.equal(PS in s.fields, false);
  assert.equal(PA in s.fields, false);
});

check('paused but the queue is empty - no stamp, no email', () => {
  const s = step(pausedReport({}, [{ id: 40, name: 'Fractional in profile', waiting: 0, last_invite_at: daysAgo(1) }]), { campaignPausedSince: hoursAgo(5) });
  assert.equal(s.pausedAlert, false);
  assert.equal(s.paused, null);
  assert.equal(s.fields[PS], null);
});

check('paused campaign that last sent over a month ago (parked on purpose) - ignored', () => {
  const s = step(pausedReport({}, [{ id: 32, name: 'TOP SCORERS', waiting: 449, last_invite_at: daysAgo(90) }]), { campaignPausedSince: hoursAgo(5) });
  assert.equal(s.pausedAlert, false);
  assert.equal(s.paused, null);
});

check('never sent (new machine, paused for launch) - ignored', () => {
  const s = step(pausedReport({}, [{ id: 1, name: 'Launch', waiting: 449, last_invite_at: null }]));
  assert.equal(s.pausedAlert, false);
  assert.equal(PS in s.fields, false);
});

check('two paused campaigns - the one that sent most recently is the one named', () => {
  const s = step(pausedReport({}, [
    { id: 32, name: 'TOP SCORERS', waiting: 449, last_invite_at: daysAgo(20) },
    { id: 40, name: 'Fractional in profile', waiting: 65, last_invite_at: daysAgo(1) },
  ]), { campaignPausedSince: hoursAgo(3) });
  assert.equal(s.pausedAlert, true);
  assert.equal(s.paused.name, 'Fractional in profile');
});

check('it ran and sent since we first saw it paused - a fresh pause, clock restarts, old stamp dropped', () => {
  const s = step(pausedReport({}, [{ id: 40, name: 'Fractional in profile', waiting: 60, last_invite_at: hoursAgo(1) }]),
    { campaignPausedSince: hoursAgo(6), pausedCampaignAlerted: hoursAgo(3) });
  assert.equal(s.pausedAlert, false);
  assert.equal(s.fields[PS], new Date(NOW).toISOString());
  assert.equal(s.fields[PA], null);
  assert.equal(s.paused.since, new Date(NOW).toISOString());
});

check('the quiet rule and the facts are untouched by the paused rule', () => {
  const s = step(pausedReport(), { campaignPausedSince: hoursAgo(3) });
  assert.equal(s.quietAlert, false);
  assert.equal(s.fields[F.waiting], 65);
  assert.equal(s.fields[F.lastInvite], daysAgo(0.2));
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
  assert.match(m.text, /Cheers,\n\(I know a\) Guy$/);
  nodash(m.subject + m.text);
});

check('quiet emails: one per kind, each with its own fix', () => {
  const base = { clientFirstName: 'Alex', coachName: 'Guy', lastInviteAt: '2026-10-03T03:00:00Z', machineLink: 'https://alex.example.com', timeZone: 'Australia/Sydney' };
  const stopped = w.quietClientEmail({ ...base, kind: 'stopped' });
  assert.equal(stopped.subject, 'Your campaign has stopped sending');
  assert.match(stopped.text, /since Saturday 3 October/);
  assert.match(stopped.text, /looks healthy from here/);
  assert.match(stopped.text, /nothing you need to do/);
  // Matthew Bulat, 27 Oct: "stopped" never again points at the licence or LinkedIn as a guess.
  assert.doesNotMatch(stopped.text, /licence|usual reasons/i);
  const off = w.quietClientEmail({ ...base, kind: 'runner-off' });
  assert.equal(off.subject, 'Your campaign runner is switched off');
  assert.match(off.text, /All campaigns/);
  assert.match(off.text, /Start campaigns runner/);
  assert.match(off.text, /https:\/\/alex\.example\.com/);
  const empty = w.quietClientEmail({ ...base, kind: 'empty' });
  assert.equal(empty.subject, 'Your campaign has run out of people');
  assert.match(empty.text, /Help me with my first campaign/);
  const paused = w.quietClientEmail({ ...base, kind: 'paused' });
  assert.equal(paused.subject, 'Your campaign is paused');
  assert.match(paused.text, /paused it on purpose/);
  for (const m of [stopped, off, empty, paused]) nodash(m.subject + m.text);
});

check('coach lines: who, since when, how many waiting; "stopped" says the machine looks healthy and never lists guesses', () => {
  const line = w.quietCoachLine({ clientName: 'Client A', kind: 'stopped', lastInviteAt: daysAgo(5), waiting: 1340, machineStatus: 'RUNNING | LinkedIn ok', timeZone: 'Australia/Brisbane', now: NOW });
  assert.match(line, /^Client A's campaign has sent nothing since .+ \(5 days\), with 1340 people waiting, although the machine looks healthy from here/);
  assert.match(line, /Machine says: RUNNING \| LinkedIn ok\./);
  assert.doesNotMatch(line, /Usual causes/);
  // The client's own portal line: no machine status dump, and told that Guy is looking.
  const mine = w.quietCoachLine({ clientName: 'Client A', kind: 'stopped', lastInviteAt: daysAgo(5), waiting: 60, machineStatus: 'RUNNING | LinkedIn ok', self: true, now: NOW });
  assert.match(mine, /^Your campaign has sent nothing since/);
  assert.match(mine, /Guy has been told and is looking - nothing for you to do\./);
  assert.doesNotMatch(mine, /Machine says|licence/i);
  assert.match(w.trialCoachLine({ clientName: 'Client A', firstActionAt: daysAgo(10), timeZone: 'Australia/Brisbane' }), /^Client A's Linked Helper trial ends about /);
  for (const kind of ['stopped', 'paused', 'empty', 'exhausted', 'runner-off', 'topped-up']) {
    for (const self of [true, false]) nodash(w.quietCoachLine({ clientName: 'A', kind, lastInviteAt: daysAgo(5), waiting: 3, self, now: NOW }));
  }
});

check('runner-off line: names the button, and the client version says where our helper looks for it', () => {
  const mine = w.quietCoachLine({ clientName: 'Matthew Bulat', kind: 'runner-off', lastInviteAt: daysAgo(5), waiting: 60, self: true, now: NOW });
  assert.match(mine, /^Your campaign runner is switched off - no invitation since .+, with 60 people waiting\. Open your Linked Helper machine, click All campaigns and press Start campaigns runner\./);
  assert.match(mine, /leave Linked Helper on that screen/);
  const coach = w.quietCoachLine({ clientName: 'Matthew Bulat', kind: 'runner-off', lastInviteAt: daysAgo(5), waiting: 60, now: NOW });
  assert.match(coach, /^Matthew Bulat's campaign runner is switched off/);
  assert.match(coach, /watchdog cannot press Start/);
});

check('topped-up line: it ran out, people were added, sending resumes - nothing is wrong', () => {
  const mine = w.quietCoachLine({ clientName: 'Matthew Bulat', kind: 'topped-up', lastInviteAt: daysAgo(5), waiting: 60, self: true, now: NOW });
  assert.match(mine, /^Your campaign ran out of people after the last invitation on .+\. 60 people have since been added - sending resumes in the next working window/);
  assert.doesNotMatch(mine, /stopped|licence/i);
});

console.log('quietKind() with the runner state (Matthew Bulat, 27 Oct 2026):');

check('people waiting and the machine IDLE - "runner-off", and it is stamped on the row', () => {
  const s = w.campaignStep({ report: report({ last_invite_at: daysAgo(5), waiting_running: 60 }), health: { state: 'IDLE' }, now: NOW });
  assert.equal(s.quietAlert, true);
  assert.equal(s.kind, 'runner-off');
  assert.equal(s.fields[F.quietKind], 'runner-off');
});

check('people waiting and the machine RUNNING - still "stopped", stamped', () => {
  const s = w.campaignStep({ report: report({ last_invite_at: daysAgo(5), waiting_running: 60 }), health: { state: 'RUNNING' }, now: NOW });
  assert.equal(s.kind, 'stopped');
  assert.equal(s.fields[F.quietKind], 'stopped');
});

check('nobody waiting and the machine IDLE - "empty" (nothing to run anyway)', () => {
  assert.equal(w.campaignStep({ report: report({ last_invite_at: daysAgo(5), waiting_running: 0 }), health: { state: 'IDLE' }, now: NOW }).kind, 'empty');
});

check('an invitation since the alert - the kind is cleared with the stamp', () => {
  const s = step(report({ last_invite_at: daysAgo(0.1) }), { quietCampaignAlerted: daysAgo(1), quietCampaignKind: 'empty' });
  assert.equal(s.quietRecovered, true);
  assert.equal(s.fields[F.quietKind], null);
});

console.log('resolveQuietKind() - what the portal line says NOW:');

check('went quiet empty, 60 added since, runner on - "topped-up" (Matthew, 27 Oct: was "stopped sending")', () => {
  assert.equal(w.resolveQuietKind({ storedKind: 'empty', waiting: 60, runnerState: 'RUNNING' }), 'topped-up');
});

check('went quiet empty, 60 added since, runner OFF - "runner-off" (the fact that matters now)', () => {
  assert.equal(w.resolveQuietKind({ storedKind: 'empty', waiting: 60, runnerState: 'IDLE' }), 'runner-off');
});

check('went quiet empty, still nobody waiting - "empty"', () => {
  assert.equal(w.resolveQuietKind({ storedKind: 'empty', waiting: 0, runnerState: 'RUNNING' }), 'empty');
});

check('went quiet stopped, runner still on - "stopped"; runner now off - "runner-off"', () => {
  assert.equal(w.resolveQuietKind({ storedKind: 'stopped', waiting: 40, runnerState: 'RUNNING' }), 'stopped');
  assert.equal(w.resolveQuietKind({ storedKind: 'stopped', waiting: 40, runnerState: 'IDLE' }), 'runner-off');
});

check('runner-off at alert time, switched on since - "topped-up" wording (sending resumes), not "stopped"', () => {
  assert.equal(w.resolveQuietKind({ storedKind: 'runner-off', waiting: 40, runnerState: 'RUNNING' }), 'topped-up');
});

check('paused and exhausted keep their story; no stored kind (alerted before 28 Oct) falls back to the count', () => {
  assert.equal(w.resolveQuietKind({ storedKind: 'paused', waiting: 40, runnerState: 'IDLE' }), 'paused');
  assert.equal(w.resolveQuietKind({ storedKind: 'exhausted', waiting: 0, runnerState: 'RUNNING' }), 'exhausted');
  assert.equal(w.resolveQuietKind({ storedKind: null, waiting: 40, runnerState: 'RUNNING' }), 'stopped');
  assert.equal(w.resolveQuietKind({ storedKind: null, waiting: 0, runnerState: 'RUNNING' }), 'empty');
});

check('runnerStateOf() reads the front of the machine status line', () => {
  assert.equal(w.runnerStateOf('IDLE | LinkedIn ok | LH 2.130.75 | disk 29%'), 'IDLE');
  assert.equal(w.runnerStateOf('RUNNING | LinkedIn ok'), 'RUNNING');
  assert.equal(w.runnerStateOf(''), null);
  assert.equal(w.runnerStateOf(null), null);
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
  assert.match(out[0].line, /has sent nothing since/);
});

check('Matthew Bulat 27 Oct: went quiet EMPTY, 60 added, runner IDLE - the line says the runner is off, not "check your licence"', () => {
  const out = list([client({ quietCampaignKind: 'empty', invitesWaiting: 60, machineStatus: 'IDLE | LinkedIn ok | LH 2.130.75' })]);
  assert.match(out[0].line, /campaign runner is switched off/);
  assert.doesNotMatch(out[0].line, /licence/i);
});

check('same, but the runner is on - "ran out ... 60 people have since been added - sending resumes"', () => {
  const out = list([client({ quietCampaignKind: 'empty', invitesWaiting: 60, machineStatus: 'RUNNING | LinkedIn ok' })]);
  assert.match(out[0].line, /ran out of people after the last invitation/);
  assert.match(out[0].line, /60 people have since been added/);
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

check('switch on: the client gets the trial email (coach copied, replies to coach), logged; coach told', async () => {
  const sent = [];
  const toClient = [];
  const logged = [];
  const r = await w.sendCampaignAlert({
    client: { clientId: 'Client-A', clientName: 'Client A', clientFirstName: 'Alex', coach: COACH, timezone: 'Australia/Sydney', clientEmailAddress: 'a@example.com' },
    alert: 'trial', report: report({ first_action_at: daysAgo(10) }), now: NOW,
    deps: {
      getClientById: async () => ({ clientName: 'Guy Wilson', clientEmailAddress: 'coach@example.com', timezone: 'Australia/Brisbane' }),
      sendAlertEmail: async (subject, html, to, opts) => { sent.push({ subject, text: opts.text }); },
      sendClientEmail: async (m) => { toClient.push(m); },
      recordComm: async (c) => { logged.push(c); },
    },
  });
  assert.equal(w.EMAIL_CLIENT, true);
  assert.equal(r.clientEmailed, true);
  assert.equal(toClient[0].to, 'a@example.com');
  assert.equal(toClient[0].cc, 'coach@example.com');
  assert.equal(toClient[0]['h:Reply-To'], 'coach@example.com');
  assert.match(toClient[0].subject, /^Your Linked Helper trial ends on /);
  assert.equal(logged[0].channel, 'lh-trial-ending');
  assert.equal(sent[0].subject, "Client A's Linked Helper trial ends soon");
  assert.match(sent[0].text, /Wingguy has emailed them - you are copied\./);
});

check('the exhausted email: run out of fresh people, a fresh search, signed (I know a) Guy', () => {
  const m = w.quietClientEmail({ clientFirstName: 'Sam', coachName: 'Guy Wilson', kind: 'exhausted', lastInviteAt: '2026-10-02T21:51:20Z', timeZone: 'Australia/Perth' });
  assert.equal(m.subject, 'Your campaign has run out of fresh people');
  assert.match(m.text, /since Saturday 3 October/);
  assert.match(m.text, /invited before or is already one of your connections/);
  assert.match(m.text, /Help me with my first campaign/);
  assert.match(m.text, /Cheers,\n\(I know a\) Guy$/);
  assert.ok(!/[–—]/.test(m.subject + m.text));
  assert.match(w.quietCoachLine({ clientName: 'Sam Noble', kind: 'exhausted', lastInviteAt: daysAgo(5), waiting: 1835, now: NOW }), /^Sam Noble's campaign has run out of fresh people/);
});

check('paused: client email names the campaign, when first seen (their clock), people still to invite, why it matters, how to fix, signed (I know a) Guy', () => {
  // First seen 06:56Z = 4:56pm Brisbane, 2:56pm Perth. Never a duration: two hours is how long WE have known.
  const m = w.pausedClientEmail({ clientFirstName: 'Guy', coachName: 'Guy Wilson', campaignName: 'Fractional in profile', since: '2026-10-16T06:56:00Z', waiting: 65, machineLink: 'https://guy.example.com' });
  assert.equal(m.subject, 'Your campaign "Fractional in profile" is paused with 65 people waiting');
  assert.match(m.text, /^Hi Guy,/);
  assert.match(m.text, /has been paused since at least Fri 16 Oct, 4:56pm, with 65 people still waiting to be invited\./);
  assert.ok(!/\bhours?\b/.test(m.text), 'no duration in the client email');
  const perth = w.pausedClientEmail({ clientFirstName: 'Sam', coachName: 'Guy', campaignName: 'X', since: '2026-10-16T06:56:00Z', waiting: 65, timeZone: 'Australia/Perth' });
  assert.match(perth.text, /since at least Fri 16 Oct, 2:56pm/);
  assert.match(m.text, /people can say yes and neither of us hears about it/);
  assert.match(m.text, /press play on the campaign:\nhttps:\/\/guy\.example\.com/);
  assert.match(m.text, /paused it on purpose, that's fine/);
  assert.match(m.text, /Cheers,\n\(I know a\) Guy$/);
  nodash(m.subject + m.text);
  const one = w.pausedClientEmail({ clientFirstName: 'A', coachName: 'Guy', campaignName: 'X', since: '2026-10-16T06:56:00Z', waiting: 1 });
  assert.match(one.text, /with 1 person still waiting to be invited/);
  assert.match(one.text, /open my Linked Helper machine/);
});

check('paused: coach line reads as asked', () => {
  const line = w.pausedCoachLine({ clientName: 'Client A', campaignName: 'Fractional in profile', since: '2026-10-16T06:56:00Z', waiting: 65 });
  assert.equal(line, 'Client A\'s Linked Helper machine\'s campaign "Fractional in profile" has been paused since at least Fri 16 Oct, 4:56pm with 65 people still waiting to be invited - resume it or they will accept unseen.');
  assert.match(w.pausedCoachLine({ clientName: 'A', campaignName: 'X', since: '2026-10-16T06:56:00Z', waiting: 5, self: true }), /^Your Linked Helper machine's campaign/);
  assert.match(w.pausedCoachLine({ clientName: 'A', campaignName: 'X', since: '2026-10-16T06:56:00Z', waiting: 5, timeZone: 'Australia/Perth' }), /since at least Fri 16 Oct, 2:56pm/);
  nodash(line);
});

check('paused: the client is emailed (coach copied), logged on channel lh-campaign-paused, coach told', async () => {
  const sent = [];
  const toClient = [];
  const logged = [];
  const r = await w.sendCampaignAlert({
    client: { clientId: 'Client-A', clientName: 'Client A', clientFirstName: 'Alex', coach: COACH, clientEmailAddress: 'a@example.com', machineLink: 'https://a.example.com' },
    alert: 'paused', paused: { name: 'Fractional in profile', waiting: 65, since: '2026-10-08T06:30:00Z' }, report: pausedReport(), now: NOW,
    deps: {
      getClientById: async () => ({ clientName: 'Guy Wilson', clientEmailAddress: 'coach@example.com', timezone: 'Australia/Brisbane' }),
      sendAlertEmail: async (subject, html, to, opts) => { sent.push({ subject, text: opts.text }); },
      sendClientEmail: async (m) => { toClient.push(m); },
      recordComm: async (c) => { logged.push(c); },
    },
  });
  assert.equal(r.clientEmailed, true);
  assert.equal(toClient[0].to, 'a@example.com');
  assert.equal(toClient[0].cc, 'coach@example.com');
  assert.equal(toClient[0].subject, 'Your campaign "Fractional in profile" is paused with 65 people waiting');
  assert.equal(logged[0].channel, 'lh-campaign-paused');
  assert.match(logged[0].summary, /paused since at least 2026-10-08T06:30:00Z with 65 waiting to be invited/);
  assert.equal(sent[0].subject, 'Client A\'s campaign "Fractional in profile": paused with 65 people waiting');
  assert.match(sent[0].text, /^Client A's Linked Helper machine's campaign "Fractional in profile" has been paused since at least Thu 8 Oct, 4:30pm with 65 people still waiting to be invited - resume it or they will accept unseen\./);
  assert.match(toClient[0].text, /paused since at least Thu 8 Oct, 4:30pm, with 65 people still waiting to be invited/);
  assert.match(sent[0].text, /Wingguy has emailed them - you are copied\./);
});

check('paused: the all-clear note goes to the coach only', async () => {
  const sent = [];
  const r = await w.sendPausedClearedNote({ client: { clientId: 'Client-A', clientName: 'Client A', coach: COACH }, deps: { sendAlertEmail: async (subject, html, to, opts) => { sent.push({ subject, text: opts.text }); } } });
  assert.equal(r.ok, true);
  assert.equal(sent[0].subject, 'Client A\'s paused campaign: all clear');
  nodash(sent[0].text);
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
