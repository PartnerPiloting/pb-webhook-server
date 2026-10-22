/**
 * Tests for the weekly client touch picker (services/clientTouchPicker.js).
 *
 * One check per rule in docs/CLIENT-TOUCH-PLANNER.md: who is never sent anything, who gets what
 * when (the opening run, first match wins), the emails set off by something that happened, the
 * limits, and the two walk-throughs Guy did (Steve Nelson - paused campaign; Mehnaaz Ahmed -
 * onboarding with sessions three weeks apart). Pure functions, a synthetic shelf, plus one pass
 * over the real shelf so the manifest and the labels stay in step.
 *
 * Run: node tests/client-touch-picker.test.js
 */
const assert = require('assert');

let failures = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`  ✓ ${name}`); }
  catch (e) { failures++; console.error(`  ✗ ${name}\n    ${e.message}`); }
};

const picker = require('../services/clientTouchPicker');
const { ORIENTATION } = require('../config/clientTouchLabels');

// Monday 26 Oct 2026, 09:00 local - the plan is for this week.
const NOW = new Date(2026, 9, 26, 9, 0, 0);
const daysAgo = (n, hours = 10) => new Date(NOW.getTime() - n * 86400000 + (hours - 9) * 3600000).toISOString();

// A synthetic shelf shaped like the real one (kind / stops / problems / resend / event / teases).
const piece = (slug, labels, status = 'final') => ({ slug, title: slug.replace(/-/g, ' '), status, labels: { stops: [], problems: [], resend: true, event: null, teases: false, ...labels } });
const SHELF = [
  piece('begin', { kind: 'way-of-thinking', stops: ['calendar'], problems: ['pitch'] }),
  piece('energy', { kind: 'mindset', problems: ['small-talk'] }),
  piece('discover', { kind: 'way-of-thinking', problems: ['pitch'], event: 'first discovery call booked (the day before)', teases: true }),
  piece('charm', { kind: 'how', problems: ['small-talk'] }),
  piece('craft', { kind: 'how', problems: ['pitch'], event: 'first discovery call booked (the day before)' }),
  piece('urgent', { kind: 'habit', stops: ['rhythm'], problems: ['no-time'], event: 'Today tab first fills; again when the campaign runs low on people' }),
  piece('thanks', { kind: 'how', stops: ['linkedin'], event: 'Today tab first fills (the week after)' }),
  piece('search', { kind: 'how', stops: ['newpeople'], problems: ['buyers'], event: 'campaign running out, or acceptances slow' }),
  piece('bigpicture', { kind: 'mindset', problems: ['no-time'], event: 'client drifting' }),
  piece('nodes', { kind: 'way-of-thinking', stops: ['newpeople'], problems: ['solo'], resend: false }),
];
const ORDER = ['begin', 'energy', 'discover', 'charm', 'craft', 'urgent', 'thanks', 'search', 'bigpicture', 'nodes'];

const running = (over = {}) => ({
  clientId: 'Test-Client', clientName: 'Test Client',
  status: 'Active', coachingStatus: 'Graduated', group: 'running', billingLapsed: false,
  unsubscribed: false, hasUnsubToken: true, address: 'test@example.com', bounced: false,
  skipUntil: null, skipThisWeek: false,
  lastInviteSent: daysAgo(20), seriesStartDate: null,
  daysSinceLastCall: 20, daysSinceLastSubstantial: 20, sessionBooked: false,
  todayHasRecords: false, events: [], callProblems: [], stuckStop: null, stuckDays: 0,
  quietOrBusy: false, note: {}, pin: null, pinForEveryone: null, nextSetupStep: null,
  ...over,
});
const sent = (key, days, kind = 'one-pager', form = 'full') => ({ kind, key, form, sent_at: daysAgo(days), source: 'planner' });
// A client who has already had a weekly email - so the welcome-first rule is not what a test is about.
const hadWelcome = () => [sent(ORIENTATION.slug, 60)];
const run = (facts, record = []) => picker.pickFor(facts, SHELF, record, { now: NOW, order: ORDER });

(async () => {
  console.log('who is never sent anything');
  await check('not an active client -> left out', () => {
    const r = run(running({ status: 'Paused' }));
    assert.strictEqual(r.leftOut, true); assert.match(r.reason, /not an active client/);
  });
  await check('coaching paused (still Active, journey parked) -> left out', () => {
    assert.match(run(running({ coachingStatus: 'Paused', group: 'paused' })).reason, /paused/);
  });
  await check('billing lapsed -> left out', () => {
    assert.match(run(running({ billingLapsed: true })).reason, /billing/);
  });
  await check('unsubscribed -> left out', () => {
    assert.match(run(running({ unsubscribed: true })).reason, /unsubscribed/);
  });
  await check('no address -> left out; bounced -> left out', () => {
    assert.match(run(running({ address: null })).reason, /no working email/);
    assert.match(run(running({ bounced: true })).reason, /bounced/);
  });
  await check('no unsubscribe token -> left out (never a dead link)', () => {
    assert.match(run(running({ hasUnsubToken: false })).reason, /unsubscribe token/);
  });
  await check('Guy said skip this week, or nothing until a date -> left out; a past date no longer holds', () => {
    assert.match(run(running({ skipThisWeek: true })).reason, /skip this week/);
    assert.match(run(running({ skipUntil: '2026-11-03' })).reason, /nothing until 2026-11-03/);
    assert.ok(!run(running({ skipUntil: '2026-10-01' })).leftOut);
  });
  await check('winding down (a cancellation scheduled) -> left out, with the date', () => {
    const r = run(running({ windingDownUntil: '2027-01-15T00:00:00.000Z' }));
    assert.strictEqual(r.leftOut, true); assert.match(r.reason, /winding down.*2027-01-15/);
  });
  await check("on Guy's leave-off list for all-client emails -> left out, with his reason", () => {
    const r = run(running({ leaveOff: 'on your leave-off list for all-client emails (since 14 Oct 2026, until you say otherwise)' }));
    assert.strictEqual(r.leftOut, true); assert.match(r.reason, /leave-off list/);
  });
  await check('a paying client who has gone quiet is NOT left out - that drift is what the emails are for', () => {
    const r = run(running({ quietOrBusy: true, daysSinceLastCall: 30 }));
    assert.ok(!r.leftOut); assert.ok(r.what);
  });

  console.log('the limits');
  await check('never two on the same day', () => {
    const r = run(running(), [sent('begin', 0, 'one-pager')]);
    assert.strictEqual(r.what, null); assert.match(r.reason, /same day/);
  });
  await check('at most two a week (a rolling seven days)', () => {
    const r = run(running(), [sent('begin', 5), sent('energy', 3)]);
    assert.strictEqual(r.what, null); assert.match(r.reason, /two is the most/);
  });
  await check('a full piece goes to a client once - the run moves on past what they have had', () => {
    const r = run(running({ daysSinceLastSubstantial: 20 }), [sent(ORIENTATION.slug, 15), sent('begin', 8)]);
    assert.strictEqual(r.what.key, 'energy');
  });
  await check('a habit email takes the first slot: Today first fills mid-run -> the habit piece, not the next in order', () => {
    const r = run(running({ todayHasRecords: true, events: [{ key: 'today-first-records', at: daysAgo(2) }] }), [sent(ORIENTATION.slug, 15), sent('begin', 8)]);
    assert.strictEqual(r.what.kind, 'habit'); assert.strictEqual(r.what.key, 'urgent'); assert.strictEqual(r.rule, 'event');
  });
  await check('a habit piece is never sent before the Today tab has records', () => {
    const r = run(running({ todayHasRecords: false, events: [{ key: 'today-first-records' }] }), [sent('begin', 8)]);
    assert.notStrictEqual(r.what.key, 'urgent');
  });

  console.log('during onboarding');
  await check('Mehnaaz: onboarding, sessions three weeks apart, nothing happened -> nothing (the session is the touch)', () => {
    const r = run(running({ group: 'onboarding', coachingStatus: null, daysSinceLastCall: 12, daysSinceLastSubstantial: 12, sessionBooked: true, lastInviteSent: null }));
    assert.strictEqual(r.what, null); assert.strictEqual(r.rule, 'onboarding');
    assert.ok(!/week without a session/.test(r.reason));
  });
  await check('Dean: onboarding, "weekly tips" in the note -> a tips email (written at build), a pin still wins', () => {
    const base = { group: 'onboarding', lastInviteSent: null, sessionBooked: true, weeklyTips: true };
    const r = run(running(base));
    assert.strictEqual(r.what, null); assert.strictEqual(r.rule, 'weekly-tips');
    assert.strictEqual(run(running({ ...base, weeklyTips: false })).rule, 'onboarding');
    const pinned = run(running({ ...base, pin: { kind: 'one-off', key: 'custom:a-search', title: 'A search', bodyHtml: '<p>x</p>' } }));
    assert.strictEqual(pinned.rule, 'pinned');
    assert.strictEqual(run(running(base), [sent('x', 1)]).rule, 'onboarding', 'still one a week at most');
  });
  await check('onboarding: the previous setup step done -> the next setup step', () => {
    const r = run(running({ group: 'onboarding', lastInviteSent: null, nextSetupStep: { key: 'setup:linkedin', title: 'Connect your LinkedIn' } }));
    assert.strictEqual(r.what.kind, 'setup'); assert.strictEqual(r.what.key, 'setup:linkedin');
  });
  await check('onboarding: a setup step already sent is not sent again', () => {
    const r = run(running({ group: 'onboarding', lastInviteSent: null, nextSetupStep: { key: 'setup:linkedin' } }), [sent('setup:linkedin', 9, 'setup')]);
    assert.strictEqual(r.what, null);
  });
  await check('onboarding: an event-set-off email may go (Today first has records)', () => {
    const r = run(running({ group: 'onboarding', lastInviteSent: null, todayHasRecords: true, events: [{ key: 'today-first-records' }] }));
    assert.strictEqual(r.what.key, 'urgent');
  });
  await check('onboarding: at most one a week', () => {
    const r = run(running({ group: 'onboarding', lastInviteSent: null, todayHasRecords: true, events: [{ key: 'today-first-records' }] }), [sent('setup:linkedin', 2, 'setup')]);
    assert.strictEqual(r.what, null);
  });
  await check('onboarding: no scheduled pieces - the run does not start, even with invitations out', () => {
    const r = run(running({ group: 'onboarding' }));
    assert.strictEqual(r.what, null);
  });

  console.log('the opening run');
  await check('Steve: campaign paused, Last Invite Sent empty, call 10 days ago -> nothing, waiting for invitations', () => {
    const r = run(running({ lastInviteSent: null, daysSinceLastCall: 10, daysSinceLastSubstantial: 10 }));
    assert.strictEqual(r.what, null); assert.strictEqual(r.rule, 'waiting-for-invitations');
  });
  await check('Steve, two days after a call -> not this week (the call counts)', () => {
    const r = run(running({ lastInviteSent: null, daysSinceLastCall: 2, daysSinceLastSubstantial: 2 }));
    assert.strictEqual(r.rule, 'not-this-week');
  });
  await check('the run starts the week Last Invite Sent fills: orientation first', () => {
    const r = run(running({ lastInviteSent: daysAgo(3) }));
    assert.strictEqual(r.what.key, ORIENTATION.slug); assert.strictEqual(r.rule, 'first-email');
  });
  await check('Guy can start it earlier with Email Series Start Date', () => {
    const r = run(running({ lastInviteSent: null, seriesStartDate: '2026-10-20' }));
    assert.strictEqual(r.what.key, ORIENTATION.slug);
    assert.strictEqual(run(running({ lastInviteSent: null, seriesStartDate: '2026-11-20' })).rule, 'waiting-for-invitations');
  });
  await check('then the run in manifest order', () => {
    const r = run(running(), [sent(ORIENTATION.slug, 14), sent('begin', 7)]);
    assert.strictEqual(r.what.key, 'energy'); assert.match(r.reason, /next in the run \(3 of 11\)/);
  });

  console.log('after the opening run, first match wins');
  await check('1. not this week: a substantial email from Guy in the last 6 days -> nothing', () => {
    const r = run(running({ daysSinceLastSubstantial: 4 }));
    assert.strictEqual(r.what, null); assert.strictEqual(r.rule, 'not-this-week');
  });
  await check('1. admin-only email does not count (the facts carry only substantial touches) - 7 days is clear', () => {
    assert.ok(run(running({ daysSinceLastSubstantial: 7 })).what);
  });
  await check('2. Guy pinned a piece for this client -> it, before anything else', () => {
    const r = run(running({ pin: { kind: 'one-pager', key: 'nodes' }, events: [{ key: 'today-first-records' }], todayHasRecords: true }));
    assert.strictEqual(r.what.key, 'nodes'); assert.strictEqual(r.rule, 'pinned');
  });
  await check('2. pinned for everyone this week (a one-off) -> it, unless they already had that piece', () => {
    const r = run(running({ pinForEveryone: { kind: 'one-off', key: 'event:open-meeting', title: "Rick's open meeting" } }));
    assert.strictEqual(r.what.kind, 'one-off'); assert.strictEqual(r.what.key, 'event:open-meeting');
    const r2 = run(running({ pinForEveryone: { kind: 'one-pager', key: 'begin' } }), [sent('begin', 30)]);
    assert.notStrictEqual(r2.rule, 'pinned');
  });
  await check("3. an event fired: first discovery call booked -> the piece written for it, the client's own pick beats the order", () => {
    const r = run(running({ events: [{ key: 'first-call-booked' }] }), [sent(ORIENTATION.slug, 14), sent('begin', 7)]);
    assert.strictEqual(r.rule, 'event'); assert.strictEqual(r.what.key, 'discover'); // the earlier of the two in the run
    const r2 = run(running({ events: [{ key: 'first-call-booked' }] }), [sent(ORIENTATION.slug, 14), sent('discover', 7)]);
    assert.strictEqual(r2.what.key, 'craft'); // they had the first one - the other fits the same moment
  });
  await check('3. an event fires even before the opening run has started', () => {
    const r = run(running({ lastInviteSent: null, events: [{ key: 'first-call-booked' }] }));
    assert.strictEqual(r.rule, 'event');
  });
  await check('3. campaign running low: the habit piece again, short, with its flag to top up', () => {
    const r = run(running({ todayHasRecords: true, events: [{ key: 'campaign-running-low' }] }), [sent('urgent', 70, 'habit', 'one-off'), sent('search', 60)]);
    assert.strictEqual(r.what.key, 'urgent'); assert.strictEqual(r.form, 'short'); assert.match(r.reason, /short reminder/);
  });
  await check('3. an event piece already sent in full within 8 weeks is not re-sent', () => {
    const r = run(running({ todayHasRecords: true, events: [{ key: 'campaign-running-low' }] }), [sent('urgent', 20, 'habit', 'one-off'), sent('search', 10)]);
    assert.notStrictEqual(r.rule, 'event');
  });
  await check('time for a call: six weeks since the last call, nothing booked -> a drafted offer, never a booking link', () => {
    const r = run(running({ daysSinceLastCall: 45, daysSinceLastSubstantial: 45 }), hadWelcome());
    assert.strictEqual(r.what.kind, 'call'); assert.match(r.reason, /never a booking link/);
    assert.ok(run(running({ daysSinceLastCall: 45, daysSinceLastSubstantial: 45, sessionBooked: true }), hadWelcome()).what.kind !== 'call');
    assert.ok(run(running({ daysSinceLastCall: 30, daysSinceLastSubstantial: 20 }), hadWelcome()).what.kind !== 'call');
  });
  await check('time for a call: a client in onboarding sessions is skipped', () => {
    const r = run(running({ group: 'onboarding', lastInviteSent: null, daysSinceLastCall: 50, daysSinceLastSubstantial: 50 }));
    assert.notStrictEqual((r.what || {}).kind, 'call');
  });
  await check('4. a call problem -> the piece that answers it, how-pieces first', () => {
    const r = run(running({ callProblems: ['small-talk'] }), [sent(ORIENTATION.slug, 14)]);
    assert.strictEqual(r.rule, 'call-problem'); assert.strictEqual(r.what.key, 'charm');
  });
  await check('5. stuck on a journey stop 14+ days -> a piece for that stop (13 days is not stuck)', () => {
    const r = run(running({ stuckStop: 'newpeople', stuckDays: 15 }), [sent(ORIENTATION.slug, 14)]);
    assert.strictEqual(r.rule, 'stuck'); assert.strictEqual(r.what.key, 'search');
    assert.notStrictEqual(run(running({ stuckStop: 'newpeople', stuckDays: 13 }), [sent(ORIENTATION.slug, 14)]).rule, 'stuck');
  });
  await check("a piece that ended \"that's next\" keeps its pair together", () => {
    const r = run(running({ stuckStop: null }), [sent(ORIENTATION.slug, 21), sent('begin', 14), sent('discover', 7)]);
    assert.strictEqual(r.rule, 'promised'); assert.strictEqual(r.what.key, 'charm');
  });
  await check('6. mindset rhythm: every fourth email is a mindset piece', () => {
    const r = run(running(), [sent(ORIENTATION.slug, 21), sent('begin', 14), sent('discover', 7)]);
    // 'discover' teases, so the promise wins here; with a non-teasing last piece the rhythm shows.
    const r2 = run(running(), [sent(ORIENTATION.slug, 21), sent('begin', 14), sent('charm', 7)]);
    assert.strictEqual(r2.rule, 'mindset-rhythm'); assert.strictEqual(r2.what.key, 'energy');
    assert.strictEqual(r.rule, 'promised');
  });
  await check('7. next in the default order otherwise', () => {
    const r = run(running(), [sent(ORIENTATION.slug, 14), sent('begin', 7)]);
    assert.strictEqual(r.rule, 'next-in-order'); assert.strictEqual(r.what.key, 'energy');
  });
  await check('8. reinforce: everything sent -> a short re-send of the oldest resendable piece, not within 8 weeks', () => {
    const all = [ORIENTATION.slug, ...ORDER].map((k, i) => sent(k, 150 - i * 7, k === 'urgent' ? 'habit' : 'one-pager'));
    const r = run(running({ todayHasRecords: true }), all);
    assert.strictEqual(r.rule, 'reinforce'); assert.strictEqual(r.form, 'short'); assert.strictEqual(r.what.key, 'begin'); // orientation is resend: no
  });
  await check('9. nothing when nothing is due a reminder yet', () => {
    const recent = [ORIENTATION.slug, ...ORDER].map((k, i) => sent(k, 50 - i * 2, k === 'urgent' ? 'habit' : 'one-pager'));
    const r = run(running({ todayHasRecords: true, daysSinceLastSubstantial: 30 }), recent);
    assert.strictEqual(r.what, null); assert.strictEqual(r.rule, 'nothing-left');
  });

  console.log('the client note');
  await check('a note asking for short -> short form on one-pagers', () => {
    const r = run(running({ note: { length: 'short' } }));
    assert.strictEqual(r.form, 'short');
    assert.strictEqual(run(running({ note: { length: 'full' } })).form, 'full');
  });

  console.log('the real shelf');
  await check('the whole client run walks every APPROVED manifest piece in order with no events - and never a draft', () => {
    const content = require('../services/onePagerContent');
    const MANIFEST = require('../config/onePagerSeriesManifest');
    const shelf = content.listPieces();
    for (const slug of MANIFEST.client) assert.ok(shelf.some((p) => p.slug === slug && p.labels.kind), `${slug} is not on the shelf with labels`);
    const record = [];
    const seen = [];
    const approvedRun = MANIFEST.client.filter((slug) => shelf.find((p) => p.slug === slug).status === 'final');
    const drafts = MANIFEST.client.filter((slug) => !approvedRun.includes(slug));
    for (let week = 0; week < approvedRun.length + 1; week++) {
      const now = new Date(NOW.getTime() + week * 7 * 86400000);
      const r = picker.pickFor(running({ todayHasRecords: true, lastInviteSent: daysAgo(3) }), shelf, record, { now });
      assert.ok(r.what, `week ${week}: ${r.reason}`);
      seen.push(r.what.key);
      record.push({ kind: r.what.kind, key: r.what.key, form: r.form, sent_at: now.toISOString() });
    }
    assert.strictEqual(seen[0], ORIENTATION.slug);
    // Every approved piece went exactly once; the order only bends for tease pairs and the mindset rhythm.
    assert.deepStrictEqual([...seen.slice(1)].sort(), [...approvedRun].sort());
    assert.ok(!seen.some((k) => drafts.includes(k)), 'a draft was picked');
    assert.strictEqual(seen[1], 'begin-with-the-end-in-mind');
  });

  await check('a draft is never picked - not in order, not as a pin, not as the mindset piece - and a promise skips past a draft to the next approved piece', () => {
    const shelf = [
      piece('tease', { kind: 'way-of-thinking', teases: true }),
      piece('drafty', { kind: 'way-of-thinking' }, 'draft'),
      piece('after', { kind: 'way-of-thinking' }),
      piece('mind-draft', { kind: 'mindset' }, 'draft'),
    ];
    const order = ['tease', 'drafty', 'after', 'mind-draft'];
    const run = (facts, record) => picker.pickFor(facts, shelf, record, { now: NOW, order });
    const promised = run(running(), [sent(ORIENTATION.slug, 14), sent('tease', 7)]);
    assert.strictEqual(promised.what.key, 'after'); assert.strictEqual(promised.rule, 'promised'); assert.match(promised.reason, /next approved piece/);
    assert.notStrictEqual(run(running({ pin: { kind: 'one-pager', key: 'drafty' } }), [sent(ORIENTATION.slug, 14)]).what.key, 'drafty');
    const ahead = picker.projectAhead(running(), shelf, [], { at: NOW, order, weeks: 5 });
    assert.ok(!ahead.some((p) => p.what && ['drafty', 'mind-draft'].includes(p.what.key)), 'Likely next shows a draft');
    assert.strictEqual(picker.approved({ slug: ORIENTATION.slug }), true);
  });

  await check('the welcome is every client\'s FIRST weekly email once invitations go out - ahead of events and a call offer; only pins, onboarding and "not this week" come first', () => {
    const ev = running({ todayHasRecords: true, events: [{ key: 'today-first-records', at: daysAgo(2) }], daysSinceLastCall: 60, daysSinceLastSubstantial: 60 });
    const first = run(ev, [{ kind: 'mindset', key: 'Mindset Mastery: x', form: 'full', sent_at: daysAgo(40), source: 'backfill' }]);
    assert.strictEqual(first.what.key, ORIENTATION.slug); assert.strictEqual(first.rule, 'first-email');
    assert.notStrictEqual(run(ev, hadWelcome()).rule, 'first-email', 'once they have had a weekly email it is never the welcome again');
    assert.strictEqual(run(running({ lastInviteSent: null, seriesStartDate: null })).rule, 'waiting-for-invitations', 'never before invitations go out');
    assert.strictEqual(run(running({ pin: { kind: 'one-pager', key: 'nodes' } })).what.key, 'nodes', 'a pin wins');
    assert.strictEqual(run(running({ daysSinceLastSubstantial: 3 })).rule, 'not-this-week');
    assert.strictEqual(run(running({ group: 'onboarding' })).rule, 'onboarding');
  });

  console.log('weekly timing (the plan is built a week ahead and sent Monday 8am)');
  await check("last Monday's weekly email, sent a few seconds after 8am, does not count against this Monday at 8am", () => {
    const now = new Date(2026, 10, 2, 8, 0, 0);
    const lastMonday = new Date(now.getTime() - 7 * 86400000 + 5000).toISOString();
    const r = picker.pickFor(running({ group: 'onboarding', nextSetupStep: { key: 'setup:1', title: 'Connect your calendar' } }), SHELF, [{ kind: 'setup', key: 'setup:0', form: 'one-off', sent_at: lastMonday }], { now, order: ORDER });
    assert.ok(r.what, r.reason); assert.strictEqual(r.what.key, 'setup:1');
    assert.strictEqual(picker.emailsThisWeek([{ kind: 'one-pager', sent_at: lastMonday }], now.getTime()).length, 0);
    assert.strictEqual(picker.emailsThisWeek([{ kind: 'one-pager', sent_at: new Date(now.getTime() - 2 * 86400000).toISOString() }], now.getTime()).length, 1);
  });
  await check('an offer of times went in the last two weeks -> no second offer yet; after that, offered again', () => {
    const facts = running({ daysSinceLastCall: 60 });
    const offer = (days) => ({ kind: 'personal', key: 'check-in', form: 'one-off', sent_at: daysAgo(days), source: 'planner' });
    assert.notStrictEqual(run(facts, [offer(7)]).rule, 'time-for-a-call');
    assert.strictEqual(run(facts, [offer(15)]).rule, 'time-for-a-call');
  });

  console.log('likely next (the picker run forward, if nothing changes)');
  await check("five weeks ahead, each earlier pick treated as sent - this Monday's pick is never offered again", () => {
    const facts = running({ daysSinceLastSubstantial: 20, daysSinceLastCall: 10 });
    const thisPick = run(facts, []);
    assert.strictEqual(thisPick.what.key, ORIENTATION.slug);
    const ahead = picker.projectAhead(facts, SHELF, [], { at: NOW, order: ORDER, thisPick });
    assert.strictEqual(ahead.length, picker.LIKELY_WEEKS);
    const keys = ahead.map((p) => p.what && p.what.key);
    assert.deepStrictEqual(keys.slice(0, 3), ['begin', 'energy', 'bigpicture']); // email 4 is the mindset rhythm
    assert.ok(!keys.includes(ORIENTATION.slug));
    assert.strictEqual(new Set(keys).size, keys.length);
    assert.strictEqual(ahead[0].at, new Date(NOW.getTime() + 7 * 86400000).toISOString());
  });
  await check('a skipped Monday (no thisPick) leaves the run where it was', () => {
    const facts = running({ daysSinceLastSubstantial: 20, daysSinceLastCall: 10 });
    const ahead = picker.projectAhead(facts, SHELF, [], { at: NOW, order: ORDER });
    assert.strictEqual(ahead[0].what.key, ORIENTATION.slug);
  });
  await check('the call clock keeps running: the six-weekly call comes up in the week it falls due, then not again for two weeks', () => {
    const facts = running({ daysSinceLastSubstantial: 20, daysSinceLastCall: 30 });
    const ahead = picker.projectAhead(facts, SHELF, [], { at: NOW, order: ORDER, thisPick: run(facts, []) });
    const calls = ahead.filter((p) => p.rule === 'time-for-a-call');
    assert.strictEqual(ahead.indexOf(calls[0]), 1); // 30 + 14 = 44 days >= 42
    assert.notStrictEqual(ahead[2].rule, 'time-for-a-call'); // the offer is waiting for an answer
  });
  await check('an event only counts in the weeks it is still recent; a pin for a later week is honoured', () => {
    const facts = running({ daysSinceLastSubstantial: 20, todayHasRecords: true, events: [{ key: 'today-first-records', at: daysAgo(3) }] });
    const ahead = picker.projectAhead(facts, SHELF, [{ kind: 'one-pager', key: 'urgent', sent_at: daysAgo(30), source: 'planner' }], {
      at: NOW, order: ORDER, pinsByWeek: [null, null, null, { pin: { kind: 'one-pager', key: 'nodes', title: 'nodes' } }],
    });
    assert.strictEqual(ahead[0].rule, 'event'); // week 1 - the event is 10 days old
    assert.ok(ahead.slice(1).every((p) => p.rule !== 'event')); // from week 2 it is over 14 days old
    assert.strictEqual(ahead[2].what.key, 'nodes'); assert.strictEqual(ahead[2].rule, 'pinned');
  });
  await check('someone left out stays left out in every week ahead', () => {
    const ahead = picker.projectAhead(running({ unsubscribed: true }), SHELF, [], { at: NOW, order: ORDER });
    assert.ok(ahead.every((p) => p.leftOut));
  });

  console.log('');
  if (failures) { console.error(`${failures} failing`); process.exit(1); }
  console.log('all passing');
})();
