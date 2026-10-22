/**
 * Tests for the Monday run (services/clientTouchPlanner.js), the send guard, the switch-on guard,
 * the preview email, and the introduction pairs (services/clientTouchIntroductions.js).
 * Fakes only - no Airtable, no Postgres, no Mailgun, no Claude. ⚠ Synthetic content only.
 *
 * Run: node tests/client-touch-planner.test.js
 */
const assert = require('assert');

let failures = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`  ✓ ${name}`); }
  catch (e) { failures++; console.error(`  ✗ ${name}\n    ${e.message}`); }
};

const planner = require('../services/clientTouchPlanner');
const intros = require('../services/clientTouchIntroductions');
const routes = require('../routes/clientTouchRoutes');

(async () => {
  console.log('facts from the live system');
  await check('campaign signals: paused, running low (top-up), acceptances slow', () => {
    const s = planner.campaignSignals({ campaigns: [
      { id: 1, name: 'A', paused: true, waiting: 449, invited_7d: 0, invited_28d: 0, accepted_7d: null, cohort_invited: 0, cohort_accepted: null },
      { id: 2, name: 'B', paused: false, waiting: 10, invited_7d: 50, invited_28d: 200, accepted_7d: 3, cohort_invited: 100, cohort_accepted: 8 },
    ] });
    assert.strictEqual(s.paused, true); assert.strictEqual(s.pausedWaiting, 449);
    assert.strictEqual(s.runningLow, true); assert.strictEqual(s.acceptancesSlow, true); assert.strictEqual(s.live, 1);
    assert.deepStrictEqual(planner.campaignSignals(null).live, 0);
  });
  await check('the note asks for short in so many words -> short', () => {
    assert.strictEqual(planner.noteSettings('Rick asked for short - dek and three bullets').length, 'short');
    assert.strictEqual(planner.noteSettings('Recognise on everything relationship').length, 'full');
  });
  await check('the current journey stop is the first not done', () => {
    assert.strictEqual(planner.currentStop({ claude: 'done', reconnect: 'done', voice: 'started' }), 'voice');
    assert.strictEqual(planner.currentStop({ claude: 'done', reconnect: 'done', voice: 'done', linkedin: 'done', calendar: 'done', calls: 'done', rhythm: 'done', newpeople: 'done' }), null);
  });
  await check('an event counts while it is recent (14 days); older ones have had their turn', () => {
    const now = Date.parse('2026-10-26T00:00:00Z');
    const r = planner.recentEvents({ 'today-first-records': '2026-10-20T00:00:00Z', busy: '2026-09-01T00:00:00Z' }, now);
    assert.deepStrictEqual(r.map((e) => e.key), ['today-first-records']);
  });
  await check('waiting improvements are counted per piece from IMPROVEMENTS.md', () => {
    const md = '## New pieces\n### energy - "What energy"\n- a **Waiting**\n- b **Done**\n### busy-weeks - short\n- c **Waiting**\n- d **Waiting**\n## Existing pieces\n### discovery-call-craft - x\n- e **Waiting**\n';
    assert.deepStrictEqual(planner.waitingImprovements(md), { energy: 1, 'busy-weeks': 2, 'discovery-call-craft': 1 });
  });
  await check('the fact lines never claim invitations are going out when they are not (Steve)', () => {
    const lines = planner.factLines({ lastInviteSent: null, daysSinceLastCall: 2, todayHasRecords: false, group: 'running', events: [] }, { paused: true, pausedWaiting: 449, lines: [] }, { nextSession: null });
    assert.ok(lines[0].includes('NOT going out')); assert.ok(lines[0].includes('PAUSED with 449'));
  });

  console.log('the body and the email');
  await check('short form = the first two paragraphs and a link to the full piece', () => {
    const body = planner.shortBody({ bodyHtml: '<p>One</p><p>Two</p><p>Three</p>' }, 'begin');
    assert.ok(body.includes('<p>One</p>')); assert.ok(body.includes('<p>Two</p>')); assert.ok(!body.includes('Three'));
    assert.ok(body.includes('/series/begin?audience=client'));
  });
  await check('composed email: greeting, the opening above the title, the body, the unsubscribe link, absolute links', () => {
    const html = planner.composeEmail({ client: { clientFirstName: 'Rick', clientName: 'Rick Wong' }, opening: 'Good to talk on Tuesday.', body: { title: 'Begin with the end in mind', dek: 'What for', bodyHtml: '<p>Body <a href="/series/x?audience=client">x</a></p>' }, unsubscribeUrl: 'https://knowaguy.com.au/series/unsubscribe?t=abc', baseUrl: 'https://knowaguy.com.au' });
    assert.ok(html.includes('Hi Rick,'));
    assert.ok(html.indexOf('Good to talk on Tuesday.') < html.indexOf('class="op-t">Begin with the end in mind'));
    assert.ok(html.includes('unsubscribe?t=abc'));
    assert.ok(html.includes('href="https://knowaguy.com.au/series/x?audience=client"'));
    assert.ok(!/[–—]/.test(html.replace(/<style[\s\S]*?<\/style>/, '')));
  });
  await check('an opening with angle brackets is escaped, never injected', () => {
    const html = planner.composeEmail({ client: { clientName: 'X' }, opening: '<script>x</script>', body: { title: 'T', dek: '', bodyHtml: '' }, unsubscribeUrl: '#' });
    assert.ok(!html.includes('<script>x</script>'));
  });
  await check('subjects: one-pagers carry the brand prefix; a call offer or setup step does not', () => {
    assert.strictEqual(planner.subjectFor({ what: { kind: 'one-pager' } }, { title: 'Nodes' }), 'I Know A Guy - Nodes');
    assert.strictEqual(planner.subjectFor({ what: { kind: 'call' } }, { title: 'Time for a catch-up' }), 'Time for a catch-up');
  });
  await check('a real piece renders for the client audience, full and short', async () => {
    const full = await planner.buildBody({ what: { kind: 'one-pager', key: 'begin-with-the-end-in-mind' }, form: 'full' }, { coach: {}, client: {} });
    assert.ok(!full.error, full.error); assert.ok(full.title); assert.ok(full.bodyHtml.length > 500);
    const short = await planner.buildBody({ what: { kind: 'one-pager', key: 'begin-with-the-end-in-mind' }, form: 'short' }, { coach: {}, client: {} });
    assert.ok(short.bodyHtml.length < full.bodyHtml.length); assert.ok(short.bodyHtml.includes('Read the full piece'));
    const orientation = await planner.buildBody({ what: { kind: 'one-pager', key: '(orientation)' }, form: 'full' }, { coach: {}, client: {} });
    assert.ok(orientation.bodyHtml.includes('engine is switched on'));
  });
  await check('a pinned one-off with no text is flagged missing, not sent as a blank', async () => {
    const b = await planner.buildBody({ what: { kind: 'one-off', key: 'event:x', title: 'Open meeting' }, form: 'one-off' }, { coach: {}, client: {}, pin: { bodyHtml: '' } });
    assert.strictEqual(b.missing, true);
  });
  await check('a setup step body names the step and links how', async () => {
    const b = await planner.buildBody({ what: { kind: 'setup', key: 'setup:1', title: 'Connect your calendar', instructionsUrl: 'https://x/how' }, form: 'one-off' }, { coach: {}, client: {} });
    assert.ok(b.bodyHtml.includes('Connect your calendar')); assert.ok(b.bodyHtml.includes('https://x/how'));
  });

  console.log('sending - only what Guy approved, re-checked at the moment of sending');
  const mkStore = (rows) => ({
    plansFor: async () => rows,
    setPlanStatus: async (w, id, status, extra) => { const r = rows.find((x) => x.clientId === id); Object.assign(r, { status, ...extra }); return r; },
    skips: async () => new Map(),
  });
  const mkTouch = () => { const recorded = []; return { recorded, touchesFor: async () => [], hasHad: async () => null, record: async (t) => { recorded.push(t); return { ok: true, inserted: true }; } }; };
  const client = (over = {}) => ({ id: 'rec1', clientId: 'Rick-Wong', clientName: 'Rick Wong', clientFirstName: 'Rick', status: 'Active', coachingStatus: 'Graduated', clientEmailAddress: 'rick@example.com', emailUnsubToken: 'tok123456789012345678', emailUnsubscribed: false, ...over });
  const row = (over = {}) => ({ clientId: 'Rick-Wong', status: 'approved', subject: 'I Know A Guy - Begin', opening: 'Good to talk.', bodyHtml: '<p>Body</p>', pick: { what: { kind: 'one-pager', key: 'begin-with-the-end-in-mind' }, form: 'full', rule: 'next-in-order', reason: 'next', body: { title: 'Begin', dek: '' } }, ...over });
  const mailerOk = () => { const sent = []; return { sent, sendSeriesEmail: async (m) => { sent.push(m); return { ok: true, id: 'mg1' }; } }; };

  await check('an approved row is sent through the series mailer with the unsubscribe link, and recorded as a touch', async () => {
    const mailer = mailerOk(); const touch = mkTouch(); const rows = [row()];
    const out = await planner.sendApproved('Guy-Wilson', '2026-10-26', { recheck: false, mailer, touchStore: touch, planStore: mkStore(rows), clientService: { getClientById: async () => client() } });
    assert.strictEqual(out.sent, 1);
    assert.strictEqual(mailer.sent[0].to, 'rick@example.com');
    assert.ok(mailer.sent[0].unsubscribeUrl.includes('tok123456789012345678'));
    assert.ok(mailer.sent[0].html.includes('Good to talk.'));
    assert.strictEqual(touch.recorded[0].kind, 'one-pager'); assert.strictEqual(touch.recorded[0].key, 'begin-with-the-end-in-mind'); assert.strictEqual(touch.recorded[0].source, 'planner');
    assert.strictEqual(rows[0].status, 'sent');
  });
  await check('a proposed row is NEVER sent - only approved or edited', async () => {
    const mailer = mailerOk();
    const out = await planner.sendApproved('Guy-Wilson', '2026-10-26', { recheck: false, mailer, touchStore: mkTouch(), planStore: mkStore([row({ status: 'proposed' }), row({ status: 'skipped' }), row({ status: 'nothing', pick: null })]), clientService: { getClientById: async () => client() } });
    assert.strictEqual(out.sent, 0); assert.strictEqual(mailer.sent.length, 0);
  });
  await check('an edited row sends Guy\'s words', async () => {
    const mailer = mailerOk();
    await planner.sendApproved('Guy-Wilson', '2026-10-26', { recheck: false, mailer, touchStore: mkTouch(), planStore: mkStore([row({ status: 'edited', opening: 'My own line.' })]), clientService: { getClientById: async () => client() } });
    assert.ok(mailer.sent[0].html.includes('My own line.'));
  });
  await check('the day-of-sending check: a client paused since Monday is held, not sent', async () => {
    const mailer = mailerOk(); const rows = [row()];
    const out = await planner.sendApproved('Guy-Wilson', '2026-10-26', { recheck: false, mailer, touchStore: mkTouch(), planStore: mkStore(rows), clientService: { getClientById: async () => client({ status: 'Paused' }) } });
    assert.strictEqual(out.held, 1); assert.strictEqual(mailer.sent.length, 0); assert.match(rows[0].sendError, /not an active client/);
  });
  await check('unsubscribed since Monday -> held; no token -> held', async () => {
    const mailer = mailerOk();
    const a = await planner.sendApproved('Guy-Wilson', '2026-10-26', { recheck: false, mailer, touchStore: mkTouch(), planStore: mkStore([row()]), clientService: { getClientById: async () => client({ emailUnsubscribed: true }) } });
    const b = await planner.sendApproved('Guy-Wilson', '2026-10-26', { recheck: false, mailer, touchStore: mkTouch(), planStore: mkStore([row()]), clientService: { getClientById: async () => client({ emailUnsubToken: null }) } });
    assert.strictEqual(a.held + b.held, 2); assert.strictEqual(mailer.sent.length, 0);
  });
  await check('already had the full piece (recorded since Monday) -> held; something already went today -> held', async () => {
    const mailer = mailerOk();
    const t1 = { ...mkTouch(), hasHad: async () => ({ sent_at: '2026-10-20' }) };
    const a = await planner.sendApproved('Guy-Wilson', '2026-10-26', { recheck: false, mailer, touchStore: t1, planStore: mkStore([row()]), clientService: { getClientById: async () => client() } });
    const t2 = { ...mkTouch(), touchesFor: async () => [{ kind: 'personal', sent_at: new Date().toISOString() }] };
    const b = await planner.sendApproved('Guy-Wilson', '2026-10-26', { recheck: false, mailer, touchStore: t2, planStore: mkStore([row()]), clientService: { getClientById: async () => client() } });
    assert.strictEqual(a.held, 1); assert.strictEqual(b.held, 1); assert.strictEqual(mailer.sent.length, 0);
  });
  await check('a failed send is marked failed and NOT recorded as a touch (it comes round again)', async () => {
    const touch = mkTouch(); const rows = [row()];
    const out = await planner.sendApproved('Guy-Wilson', '2026-10-26', { recheck: false, mailer: { sendSeriesEmail: async () => ({ ok: false, error: 'Mailgun 500' }) }, touchStore: touch, planStore: mkStore(rows), clientService: { getClientById: async () => client() } });
    assert.strictEqual(out.failed, 1); assert.strictEqual(touch.recorded.length, 0); assert.strictEqual(rows[0].status, 'failed');
  });
  await check('a call offer is recorded as a personal touch (it is Guy writing), and a body that is not built is held', async () => {
    const touch = mkTouch(); const mailer = mailerOk();
    await planner.sendApproved('Guy-Wilson', '2026-10-26', { recheck: false, mailer, touchStore: touch, planStore: mkStore([row({ pick: { what: { kind: 'call', key: 'check-in' }, form: 'one-off', rule: 'time-for-a-call', reason: 'r', body: { title: 'Time for a catch-up', dek: '' } } })]), clientService: { getClientById: async () => client() }, refreshCallOffer: async () => ({ ok: true, changed: false }) });
    assert.strictEqual(touch.recorded[0].kind, 'personal');
    const out = await planner.sendApproved('Guy-Wilson', '2026-10-26', { recheck: false, mailer, touchStore: mkTouch(), planStore: mkStore([row({ pick: { what: { kind: 'one-off', key: 'x' }, form: 'one-off', rule: 'pinned', reason: 'r', body: { title: 'x', dek: '', missing: true } } })]), clientService: { getClientById: async () => client() } });
    assert.strictEqual(out.held, 1);
  });

  console.log('the switch-on guard');
  await check('automatic sending is OFF unless CLIENT_TOUCH_AUTOSEND=on', () => {
    delete process.env.CLIENT_TOUCH_AUTOSEND; assert.strictEqual(planner.autosendOn(), false);
    process.env.CLIENT_TOUCH_AUTOSEND = 'off'; assert.strictEqual(planner.autosendOn(), false);
    process.env.CLIENT_TOUCH_AUTOSEND = 'on'; assert.strictEqual(planner.autosendOn(), true);
    delete process.env.CLIENT_TOUCH_AUTOSEND;
  });
  await check("Guy's Monday preview lists every pick with its reason and opening, the quiet weeks and the left-out, and says nothing goes until he approves", () => {
    const plan = { weekOf: '2026-10-26', rows: [
      { clientId: 'Rick-Wong', status: 'proposed', facts: { clientName: 'Rick Wong' }, pick: { what: { kind: 'one-pager', title: 'Begin' }, form: 'short', reason: 'next in the run' }, opening: 'Good to talk.' },
      { clientId: 'Steve-Nelson', status: 'nothing', facts: { clientName: 'Steve Nelson' }, pick: { what: null, reason: 'no invitation has gone out yet' } },
      { clientId: 'Paul-X', status: 'left-out', facts: { clientName: 'Paul X' }, pick: { leftOut: true, reason: 'unsubscribed' } },
    ] };
    const pv = planner.buildPreview(plan, { screenUrl: 'https://portal/x' });
    assert.ok(pv.subject.includes('1 to approve'));
    assert.ok(pv.html.includes('Rick Wong - Begin (short)')); assert.ok(pv.html.includes('next in the run')); assert.ok(pv.html.includes('Good to talk.'));
    assert.ok(pv.html.includes('Steve Nelson')); assert.ok(pv.html.includes('Paul X - unsubscribed'));
    assert.ok(pv.html.includes('Only what you approve goes')); assert.ok(pv.html.includes('Anything not approved by then is not sent'));
    assert.ok(planner.buildPreview(plan, { autosend: true }).html.includes('Send-with-veto is ON'));
  });

  console.log('a week ahead');
  const planStore = require('../services/clientTouchPlanStore');
  await check('the plan Guy works on: before 8am on a Monday it is today; from 8am Monday all week it is the Monday after', () => {
    assert.strictEqual(planStore.planningWeek(new Date('2026-10-25T21:59:00Z')), '2026-10-26'); // Mon 7:59am Brisbane
    assert.strictEqual(planStore.planningWeek(new Date('2026-10-25T22:00:00Z')), '2026-11-02'); // Mon 8:00am
    assert.strictEqual(planStore.planningWeek(new Date('2026-10-22T03:00:00Z')), '2026-10-26'); // Thursday
    assert.strictEqual(planStore.planningWeek(new Date('2026-11-01T10:00:00Z')), '2026-11-02'); // Sunday 8pm
    assert.strictEqual(planStore.addWeeks('2026-10-26', 1), '2026-11-02');
    assert.strictEqual(planStore.addWeeks('2026-11-02', -1), '2026-10-26');
  });
  await check('the sending moment is that Monday at 8am Brisbane', () => {
    assert.strictEqual(planner.sendAt('2026-11-02').toISOString(), '2026-11-01T22:00:00.000Z');
  });
  await check("the planner's own weekly emails never make a week 'not this week' - only Guy's own touches do", () => {
    const t = planner.lastTouches([
      { kind: 'one-pager', sent_at: '2026-10-26T22:00:05Z', source: 'planner' },
      { kind: 'habit', sent_at: '2026-10-13T22:00:00Z', source: 'backfill' },
      { kind: 'mindset', sent_at: '2026-10-28T00:00:00Z', source: 'backfill' },
    ]);
    assert.strictEqual(new Date(t.lastTouchAt).toISOString(), '2026-10-26T22:00:05.000Z');
    assert.strictEqual(new Date(t.lastPersonal).toISOString(), '2026-10-13T22:00:00.000Z');
  });

  console.log('the sending-morning re-check');
  const SHELF = require('../services/onePagerContent').listPieces();
  const facts = (over = {}) => ({
    clientId: 'Steve-Nelson', clientName: 'Steve Nelson', status: 'Active', coachingStatus: 'Graduated', group: 'running',
    billingLapsed: false, unsubscribed: false, hasUnsubToken: true, address: 'steve@example.com', bounced: false, skipUntil: null, skipThisWeek: false,
    lastInviteSent: null, seriesStartDate: '2026-10-01', daysSinceLastCall: 10, daysSinceLastSubstantial: 10, sessionBooked: false,
    todayHasRecords: false, events: [], callProblems: [], stuckStop: null, stuckDays: 0, quietOrBusy: false, note: { length: 'full' },
    pin: null, pinForEveryone: null, nextSetupStep: null, ...over,
  });
  const picker = require('../services/clientTouchPicker');
  const orientation = picker.pickFor(facts(), SHELF, [], {});
  const approvedRow = (over = {}) => ({ clientId: 'Steve-Nelson', status: 'approved', subject: 's', opening: 'Hello.', bodyHtml: '<p>B</p>', facts: facts(), pick: { ...orientation, body: { title: 'T', dek: '' } }, ...over });
  const steve = () => client({ clientId: 'Steve-Nelson', clientName: 'Steve Nelson', clientFirstName: 'Steve', clientEmailAddress: 'steve@example.com' });

  await check('nothing changed -> the approved email goes', async () => {
    const mailer = mailerOk(); const rows = [approvedRow()];
    const out = await planner.sendApproved('Guy-Wilson', '2026-10-26', { mailer, touchStore: mkTouch(), planStore: mkStore(rows), clientService: { getClientById: async () => steve() }, shelf: SHELF,
      freshFacts: async () => new Map([['Steve-Nelson', { facts: facts(), record: [] }]]) });
    assert.strictEqual(out.sent, 1); assert.strictEqual(rows[0].status, 'sent');
  });
  await check('an event that would now win -> HELD with what changed, nothing sent; the panel can offer the new pick', async () => {
    const mailer = mailerOk(); const rows = [approvedRow()];
    const fresh = facts({ todayHasRecords: true, lastInviteSent: '2026-10-21T23:00:00Z', events: [{ key: 'today-first-records', at: '2026-10-22T00:00:00Z' }] });
    const out = await planner.sendApproved('Guy-Wilson', '2026-10-26', { mailer, touchStore: mkTouch(), planStore: mkStore(rows), clientService: { getClientById: async () => steve() }, shelf: SHELF,
      freshFacts: async () => new Map([['Steve-Nelson', { facts: fresh, record: [] }]]) });
    assert.strictEqual(out.sent, 0); assert.strictEqual(out.held, 1); assert.strictEqual(mailer.sent.length, 0);
    assert.strictEqual(rows[0].status, 'held');
    assert.ok(rows[0].hold.changed.some((l) => l === 'their invitations started going out on Thursday'), rows[0].hold.changed.join(' | '));
    assert.ok(rows[0].hold.changed.some((l) => /today tab first has records/i.test(l)));
    assert.ok(rows[0].hold.suggestion && rows[0].hold.suggestion.key, 'the new pick is offered');
    assert.match(rows[0].sendError, /keep or swap\?$/);
    assert.strictEqual(rows[0].hold.hard, false);
  });
  await check('Guy wrote to them since he approved -> held ("you touched base")', async () => {
    const rows = [approvedRow()];
    await planner.sendApproved('Guy-Wilson', '2026-10-26', { mailer: mailerOk(), touchStore: mkTouch(), planStore: mkStore(rows), clientService: { getClientById: async () => steve() }, shelf: SHELF,
      freshFacts: async () => new Map([['Steve-Nelson', { facts: facts({ daysSinceLastSubstantial: 3 }), record: [] }]]) });
    assert.strictEqual(rows[0].status, 'held');
    assert.ok(rows[0].hold.changed.includes('you touched base with them 3 days ago'));
  });
  await check('"keep" sends it anyway (Guy has looked) - the never-send checks still run', async () => {
    const mailer = mailerOk(); const rows = [approvedRow()];
    const out = await planner.sendApproved('Guy-Wilson', '2026-10-26', { mailer, touchStore: mkTouch(), planStore: mkStore(rows), clientService: { getClientById: async () => steve() }, shelf: SHELF,
      keep: new Set(['Steve-Nelson']), onlyClientIds: ['Steve-Nelson'], freshFacts: async () => { throw new Error('not read for a keep'); } });
    assert.strictEqual(out.sent, 1);
    const rows2 = [approvedRow()];
    const out2 = await planner.sendApproved('Guy-Wilson', '2026-10-26', { mailer, touchStore: mkTouch(), planStore: mkStore(rows2), clientService: { getClientById: async () => client({ status: 'Paused' }) }, shelf: SHELF, keep: new Set(['Steve-Nelson']) });
    assert.strictEqual(out2.sent, 0); assert.strictEqual(rows2[0].hold.hard, true);
  });
  await check('facts unreadable on the morning -> held, never sent blind', async () => {
    const rows = [approvedRow()];
    const out = await planner.sendApproved('Guy-Wilson', '2026-10-26', { mailer: mailerOk(), touchStore: mkTouch(), planStore: mkStore(rows), clientService: { getClientById: async () => steve() }, shelf: SHELF, freshFacts: async () => new Map() });
    assert.strictEqual(out.held, 1); assert.strictEqual(rows[0].status, 'held');
  });
  await check('what changed, in plain words: status, unsubscribed, address, a booked session', () => {
    const lines = planner.whatChanged(facts(), facts({ status: 'Paused', unsubscribed: true, address: 'new@example.com', sessionBooked: true, nextSessionAt: '2026-10-28T03:00:00Z' }), {}, null);
    assert.deepStrictEqual(lines, ['their Status is now Paused', 'they unsubscribed from the weekly emails', 'their address changed (steve@example.com -> new@example.com)', 'a session with you is now booked (2026-10-28)']);
  });

  console.log('Monday morning: send the approved, roll off the rest, report');
  await check('unapproved proposals roll off as lapsed - never sent', async () => {
    const rows = [approvedRow({ status: 'proposed' }), approvedRow({ clientId: 'B', status: 'approved' }), approvedRow({ clientId: 'C', status: 'nothing', pick: { what: null } })];
    const lapsed = await planner.rollOff('2026-10-26', { planStore: mkStore(rows) });
    assert.deepStrictEqual(lapsed.map((r) => r.clientId), ['Steve-Nelson']);
    assert.strictEqual(rows[0].status, 'lapsed'); assert.strictEqual(rows[1].status, 'approved'); assert.strictEqual(rows[2].status, 'nothing');
  });
  await check("the report says what went, what was held and why, and what wasn't approved", () => {
    const r = planner.buildSendReport({
      result: { results: [{ clientId: 'A', status: 'sent' }, { clientId: 'B', status: 'held', changed: ['their invitations started going out on Wednesday'] }] },
      lapsed: [{ clientId: 'C', pick: { what: { title: 'Nodes' } } }],
      names: new Map([['A', 'Ann'], ['B', 'Bob'], ['C', 'Cat']]), titles: new Map([['A', 'Begin'], ['B', 'Energy']]),
    });
    assert.strictEqual(r.subject, 'Monday emails - 1 went, 1 held, 1 not approved');
    assert.ok(r.html.includes('Ann - Begin')); assert.ok(r.html.includes('Bob - Energy: their invitations started going out on Wednesday'));
    assert.ok(r.html.includes('Cat - Nodes')); assert.ok(!/[–—]/.test(r.html));
  });
  await check('the Monday send emails Guy the report after sending', async () => {
    const rows = [approvedRow(), approvedRow({ clientId: 'X', status: 'proposed' })];
    const emails = [];
    const out = await planner.mondaySend('Guy-Wilson', '2026-10-26', { mailer: mailerOk(), touchStore: mkTouch(), planStore: mkStore(rows), shelf: SHELF,
      clientService: { getClientById: async () => steve(), getAllClients: async () => [steve()] },
      freshFacts: async () => new Map([['Steve-Nelson', { facts: facts(), record: [] }]]), sendAlertEmail: async (s, h) => emails.push({ s, h }) });
    assert.strictEqual(out.sent, 1); assert.strictEqual(out.lapsed, 1); assert.strictEqual(emails.length, 1);
    assert.match(emails[0].s, /1 went, 0 held, 1 not approved/);
  });
  await check('the tick: Monday 8am sends THIS Monday; 9am builds NEXT Monday; other days nothing; each claimed once', async () => {
    const claims = new Set(); const calls = [];
    const ps = { claimWeekly: async (k, w) => { const id = `${k}:${w}`; if (claims.has(id)) return false; claims.add(id); return true; } };
    const deps = (hour, weekday = 'Mon') => ({ now: new Date('2026-10-25T23:30:00Z'), brisbaneNow: { hour, weekday }, planStore: ps,
      mondaySend: async (c, w) => { calls.push(`send ${w}`); return { sent: 0 }; },
      buildPlan: async (c, o) => { calls.push(`build ${o.weekOf}`); return { weekOf: o.weekOf, rows: [] }; },
      sendAlertEmail: async () => {} });
    assert.strictEqual((await planner.tick(deps(7))).ran, false);
    assert.strictEqual((await planner.tick(deps(8))).ran, 'send');
    assert.strictEqual((await planner.tick(deps(9))).ran, 'build');
    assert.strictEqual((await planner.tick(deps(10))).ran, false);
    assert.strictEqual((await planner.tick(deps(9, 'Tue'))).ran, false);
    assert.deepStrictEqual(calls, ['send 2026-10-26', 'build 2026-11-02']);
  });
  await check('CLIENT_TOUCH_MONDAY_SEND=off stops the Monday send (the build still runs)', async () => {
    process.env.CLIENT_TOUCH_MONDAY_SEND = 'off';
    const calls = [];
    const ps = { claimWeekly: async () => true };
    const out = await planner.tick({ now: new Date('2026-10-25T23:30:00Z'), brisbaneNow: { hour: 9, weekday: 'Mon' }, planStore: ps,
      mondaySend: async () => { calls.push('send'); return {}; }, buildPlan: async (c, o) => { calls.push('build'); return { weekOf: o.weekOf, rows: [] }; }, sendAlertEmail: async () => {} });
    delete process.env.CLIENT_TOUCH_MONDAY_SEND;
    assert.deepStrictEqual(calls, ['build']); assert.strictEqual(out.ran, 'build');
  });

  await check('CLIENT_TOUCH_SEND_ENABLED=off (staging) refuses every send - nothing mailed, no row touched; on by default', async () => {
    assert.strictEqual(planner.sendEnabled(), true);
    process.env.CLIENT_TOUCH_SEND_ENABLED = 'off';
    try {
      const mailer = mailerOk(); const rows = [approvedRow()];
      const out = await planner.sendApproved('Guy-Wilson', '2026-10-26', { mailer, touchStore: mkTouch(), planStore: mkStore(rows), clientService: { getClientById: async () => steve() }, shelf: SHELF, keep: new Set(['Steve-Nelson']) });
      assert.strictEqual(out.sent, 0); assert.strictEqual(mailer.sent.length, 0); assert.match(out.refused, /switched off/);
      assert.strictEqual(rows[0].status, 'approved');
    } finally { delete process.env.CLIENT_TOUCH_SEND_ENABLED; }
  });

  console.log('who is left out, and when "Today first has records" really is news');
  await check('the Today-first-records event carries the REAL first record date - months-old records are no event', () => {
    const at = Date.parse('2026-10-25T22:00:00Z'); // Monday 26 Oct, 8am Brisbane
    const longStanding = planner.todayFirstSeen({ 'today-first-records': '2026-10-22T09:36:44.814Z', busy: '2026-10-01T00:00:00Z' }, '2026-03-04T00:00:00.000Z');
    assert.strictEqual(longStanding['today-first-records'], '2026-03-04T00:00:00.000Z'); assert.strictEqual(longStanding.busy, '2026-10-01T00:00:00Z');
    assert.deepStrictEqual(planner.recentEvents(longStanding, at).map((e) => e.key), []);
    const fresh = planner.todayFirstSeen({}, '2026-10-20T00:00:00.000Z');
    assert.deepStrictEqual(planner.recentEvents(fresh, at).map((e) => e.key), ['today-first-records']);
    assert.ok(!('today-first-records' in planner.todayFirstSeen({ 'today-first-records': '2026-10-22T00:00:00Z' }, null)));
  });
  await check('a Stripe subscription set to cancel gives its end date; a live or already-cancelled one gives none', () => {
    assert.strictEqual(planner.cancellationFrom({ status: 'active', cancel_at: 1799971200 }), new Date(1799971200 * 1000).toISOString());
    assert.strictEqual(planner.cancellationFrom({ status: 'active', cancel_at_period_end: true, current_period_end: 1799971200 }), new Date(1799971200 * 1000).toISOString());
    assert.strictEqual(planner.cancellationFrom({ status: 'active', cancel_at_period_end: false, cancel_at: null }), null);
    assert.strictEqual(planner.cancellationFrom({ status: 'canceled', cancel_at: 1799971200 }), null);
    assert.strictEqual(planner.cancellationFrom(null), null);
  });
  await check("Guy's leave-off list is read from config/clientEmailOverrides.json (Brendon, with the reason shown)", () => {
    const list = planner.leaveOffList();
    assert.ok(list.has('Brendon-Campbell')); assert.match(list.get('Brendon-Campbell'), /leave-off list/);
    assert.strictEqual(planner.leaveOffList('no-such-file.json').size, 0);
  });
  await check('the send-time check holds a client added to the leave-off list since Guy approved', async () => {
    const rows = [approvedRow()];
    const out = await planner.sendApproved('Guy-Wilson', '2026-10-26', { mailer: mailerOk(), touchStore: mkTouch(), planStore: mkStore(rows), clientService: { getClientById: async () => steve() }, shelf: SHELF,
      leaveOff: new Map([['Steve-Nelson', 'on your leave-off list for all-client emails']]), keep: new Set(['Steve-Nelson']) });
    assert.strictEqual(out.sent, 0); assert.strictEqual(rows[0].hold.hard, true); assert.match(rows[0].sendError, /leave-off/);
  });

  console.log('an offer of times for a call - chosen for the day it arrives');
  const slot = (iso) => ({ time: iso });
  const day = (date, times, over = {}) => ({ date, freeSlots: times.map(slot), ...over });
  await check('call times start no earlier than the Tuesday after the sending Monday (Brisbane)', () => {
    assert.strictEqual(new Date(planner.callNotBefore('2026-10-26')).toISOString(), '2026-10-26T14:00:00.000Z'); // Tue 27 Oct 00:00 Brisbane
    const filtered = { days: [
      day('2026-10-23', ['2026-10-23T00:00:00Z']),   // Fri before - built-time day, must not be offered
      day('2026-10-26', ['2026-10-26T00:00:00Z']),   // the sending Monday itself - too soon
      day('2026-10-27', ['2026-10-27T00:00:00Z', '2026-10-27T01:00:00Z']),
      day('2026-10-28', ['2026-10-28T03:00:00Z'], { busyDay: true }),
      day('2026-10-29', ['2026-10-29T04:00:00Z']),
      day('2026-10-30', ['2026-10-30T05:00:00Z']),
    ] };
    const picked = planner.pickCallSlots(filtered, planner.callNotBefore('2026-10-26'));
    assert.deepStrictEqual(picked.map((s) => s.time), ['2026-10-27T00:00:00Z', '2026-10-29T04:00:00Z', '2026-10-30T05:00:00Z']); // one a day, light days first
    assert.ok(picked.every((s) => s.label));
    assert.deepStrictEqual(planner.pickCallSlots({ days: [] }, 0), []);
  });
  await check('the body offers the picked times (or asks Guy for some), never a booking link', () => {
    const html = planner.callOfferHtml([{ time: 'x', label: 'Tue 27 October, 10:00 am' }]);
    assert.ok(html.includes('<li>Tue 27 October, 10:00 am</li>')); assert.ok(!/calendly|tidycal|book/i.test(html));
    assert.ok(planner.callOfferHtml([]).includes('add two or three by hand'));
  });
  await check('the built body keeps the slots on the row; nothing before the Tuesday after the send', async () => {
    const filtered = { days: [day('2026-10-23', ['2026-10-23T00:00:00Z']), day('2026-10-28', ['2026-10-28T00:00:00Z'])] };
    const b = await planner.callOfferBody({ clientId: 'Guy-Wilson' }, { clientId: 'H' }, { week: '2099-10-26' }, { callAvailability: async () => ({ filtered: { days: [day('2099-10-26', ['2099-10-26T00:00:00Z']), day('2099-10-28', ['2099-10-28T00:00:00Z'])] }, tz: 'Australia/Brisbane' }) });
    assert.deepStrictEqual(b.slots.map((s) => s.time), ['2099-10-28T00:00:00Z']); assert.strictEqual(b.slotsFound, 1);
    void filtered;
  });
  const callRow = (slots) => ({ clientId: 'Steve-Nelson', status: 'approved', subject: 'Time for a catch-up', opening: 'Hello.', bodyHtml: '<p>old times</p>', facts: facts(), pick: { what: { kind: 'call', key: 'check-in', title: 'Time for a call' }, form: 'one-off', rule: 'time-for-a-call', reason: 'r', body: { title: 'Time for a catch-up', dek: '', slots } } });
  const future = (days, h = 0) => new Date(Date.now() + days * 86400000 + h * 3600000).toISOString();
  await check('sending morning: offered times still free and a day away -> sent as approved', async () => {
    const s1 = future(3); const s2 = future(4);
    const out = await planner.refreshCallOffer(callRow([{ time: s1 }, { time: s2 }]), {}, {}, { callAvailability: async () => ({ filtered: { days: [day('a', [s1]), day('b', [s2])] }, tz: 'Australia/Brisbane' }) });
    assert.deepStrictEqual(out, { ok: true, changed: false });
  });
  await check('sending morning: a time now taken (or too close) -> fresh times, body redrawn, approval kept', async () => {
    const taken = future(3); const close = future(0, 5); const n1 = future(5); const n2 = future(6);
    const out = await planner.refreshCallOffer(callRow([{ time: taken }, { time: close }]), {}, {}, { callAvailability: async () => ({ filtered: { days: [day('x', [close]), day('y', [n1]), day('z', [n2])] }, tz: 'Australia/Brisbane' }) });
    assert.strictEqual(out.ok, true); assert.strictEqual(out.changed, true);
    assert.deepStrictEqual(out.slots.map((s) => s.time), [n1, n2]);
    assert.ok(out.bodyHtml.includes('<li>'));
  });
  await check('sending morning: no free time left -> held with a note, never sent with stale times', async () => {
    const out = await planner.refreshCallOffer(callRow([{ time: future(3) }]), {}, {}, { callAvailability: async () => ({ filtered: { days: [] }, tz: 'Australia/Brisbane' }) });
    assert.strictEqual(out.ok, false); assert.match(out.reason, /no free times left/);
  });
  await check('sendApproved re-picks call times, sends the new times, and records them', async () => {
    const mailer = mailerOk(); const touch = mkTouch(); const rows = [callRow([{ time: future(3) }])];
    const out = await planner.sendApproved('Guy-Wilson', '2026-10-26', { mailer, touchStore: touch, planStore: mkStore(rows), clientService: { getClientById: async () => steve() }, shelf: SHELF, keep: new Set(['Steve-Nelson']),
      refreshCallOffer: async () => ({ ok: true, changed: true, slots: [{ time: 'T1', label: 'Wed 4 November, 10:00 am' }], bodyHtml: '<ul><li>Wed 4 November, 10:00 am</li></ul>' }) });
    assert.strictEqual(out.sent, 1);
    assert.ok(mailer.sent[0].html.includes('Wed 4 November, 10:00 am')); assert.ok(!mailer.sent[0].html.includes('old times'));
    assert.deepStrictEqual(touch.recorded[0].meta.slots, ['T1']); assert.strictEqual(touch.recorded[0].kind, 'personal');
    const rows2 = [callRow([{ time: future(3) }])];
    const held = await planner.sendApproved('Guy-Wilson', '2026-10-26', { mailer: mailerOk(), touchStore: mkTouch(), planStore: mkStore(rows2), clientService: { getClientById: async () => steve() }, shelf: SHELF, keep: new Set(['Steve-Nelson']),
      refreshCallOffer: async () => ({ ok: false, reason: 'the call offer has no free times left in your calendar - add times by hand or swap it' }) });
    assert.strictEqual(held.sent, 0); assert.strictEqual(rows2[0].status, 'held'); assert.strictEqual(rows2[0].hold.hard, false);
  });

  console.log('Build runs in the background (the panel polls)');
  await check('build status: running while started and unfinished; finished with a row count; a stale run reads as stopped', () => {
    const now = Date.parse('2026-10-22T10:10:00Z');
    assert.deepStrictEqual(planner.buildStatus(null, now).running, false);
    assert.strictEqual(planner.buildStatus(JSON.stringify({ startedAt: '2026-10-22T10:06:00Z' }), now).running, true);
    const done = planner.buildStatus(JSON.stringify({ startedAt: '2026-10-22T10:06:00Z', finishedAt: '2026-10-22T10:09:00Z', rows: 28 }), now);
    assert.strictEqual(done.running, false); assert.strictEqual(done.rows, 28); assert.strictEqual(done.error, null);
    const stale = planner.buildStatus(JSON.stringify({ startedAt: '2026-10-22T09:00:00Z' }), now);
    assert.strictEqual(stale.running, false); assert.match(stale.error, /stopped part-way/);
  });
  await check('startBuild answers at once, records the finish, and never starts a second run for the same week', async () => {
    const state = new Map();
    const ps = { getState: async (k) => state.get(k) || null, setState: async (k, v) => { state.set(k, v); return true; } };
    let release; const gate = new Promise((r) => { release = r; });
    const calls = [];
    const buildPlan = async (c, o) => { calls.push(o.weekOf); await gate; return { weekOf: o.weekOf, rows: [1, 2, 3] }; };
    const first = await planner.startBuild('Guy-Wilson', '2026-10-26', {}, { planStore: ps, buildPlan });
    assert.strictEqual(first.started, true);
    assert.strictEqual(planner.buildStatus(state.get('build-run:2026-10-26')).running, true);
    const second = await planner.startBuild('Guy-Wilson', '2026-10-26', {}, { planStore: ps, buildPlan });
    assert.strictEqual(second.started, false); assert.strictEqual(calls.length, 1);
    release(); await first.done;
    const s = planner.buildStatus(state.get('build-run:2026-10-26'));
    assert.strictEqual(s.running, false); assert.strictEqual(s.rows, 3);
  });
  await check('a build that throws is recorded as stopped with the reason', async () => {
    const state = new Map();
    const ps = { getState: async (k) => state.get(k) || null, setState: async (k, v) => { state.set(k, v); return true; } };
    const r = await planner.startBuild('Guy-Wilson', '2026-11-02', {}, { planStore: ps, buildPlan: async () => { throw new Error('Airtable 503'); } });
    await r.done;
    assert.match(planner.buildStatus(state.get('build-run:2026-11-02')).error, /Airtable 503/);
  });

  console.log('already had | this Monday | likely next');
  await check("the three columns for one client: history newest first, this Monday's pick, five weeks ahead", () => {
    const record = [
      { kind: 'mindset', key: 'Mindset Mastery: Givers', sent_at: '2026-03-01T00:00:00Z', source: 'backfill' },
      { kind: 'habit', key: 'habit-1', sent_at: '2026-10-15T21:00:00Z', source: 'backfill', meta: { subject: 'A few minutes a morning' } },
    ];
    const row = approvedRow({ weekOf: '2026-10-26', status: 'proposed' });
    const o = planner.outlookFor(row, record, SHELF, { week: '2026-10-26' });
    assert.deepStrictEqual(o.alreadyHad.map((h) => h.title), ['A few minutes a morning', 'Mindset Mastery: Givers']);
    assert.strictEqual(o.thisMonday.what.key, orientation.what.key); assert.strictEqual(o.thisMonday.status, 'proposed');
    assert.strictEqual(o.likelyNext.length, 5);
    assert.strictEqual(o.likelyNext[0].weekOf, '2026-11-02');
    assert.ok(o.likelyNext.every((n) => !n.what || n.what.key !== orientation.what.key));
    const text = planner.formatOutlook('Steve Nelson', o);
    assert.ok(text.includes('ALREADY HAD (2')); assert.ok(text.includes('THIS MONDAY (Monday 26 Oct) - waiting for your approval'));
    assert.ok(text.includes('LIKELY NEXT - provisional')); assert.ok(!/[–—]/.test(text));
  });
  await check('a skipped Monday is not counted as sent in "likely next"; a held one shows what changed', () => {
    const skipped = planner.outlookFor(approvedRow({ weekOf: '2026-10-26', status: 'skipped' }), [], SHELF, { week: '2026-10-26' });
    assert.strictEqual(skipped.likelyNext[0].what.key, orientation.what.key);
    const held = planner.formatOutlook('Steve', planner.outlookFor(approvedRow({ weekOf: '2026-10-26', status: 'held', hold: { changed: ['their invitations started going out on Wednesday'] } }), [], SHELF, { week: '2026-10-26' }));
    assert.ok(held.includes('HELD')); assert.ok(held.includes('what changed: their invitations started going out on Wednesday'));
  });
  await check('no plan yet -> says so, and asks for the build', () => {
    const o = planner.outlookFor(null, [], SHELF, { week: '2026-10-26' });
    assert.ok(planner.formatOutlook('X', o).includes('no plan built for this client yet'));
  });

  console.log('"show me Steve\'s emails" from any chat (wingguy_client_emails)');
  await check('the tool answers for the coach\'s own client only, and says it is read-only', async () => {
    const cs = require('../services/clientService');
    const real = cs.getAllClients;
    cs.getAllClients = async () => [
      { clientId: 'Steve-Nelson', clientName: 'Steve Nelson', coach: 'Guy-Wilson' },
      { clientId: 'Other-Person', clientName: 'Other Person', coach: 'Someone-Else' },
    ];
    try {
      const def = require('../services/wingguyRulesMcp').TOOL_DEFS.find((d) => d.name === 'wingguy_client_emails');
      assert.ok(def, 'tool registered');
      assert.ok(/show me Steve's emails/.test(def.description));
      const ok = await def.run({ client: 'steve' }, 'Guy-Wilson');
      assert.ok(!ok.isError, ok.text);
      assert.ok(ok.text.startsWith('Steve Nelson - weekly emails')); assert.ok(ok.text.includes('ALREADY HAD')); assert.ok(ok.text.includes('LIKELY NEXT'));
      assert.ok(ok.text.includes('Monday emails panel'));
      const other = await def.run({ client: 'Other Person' }, 'Guy-Wilson');
      assert.strictEqual(other.isError, true);
      const asClient = await def.run({ client: 'Steve' }, 'Steve-Nelson');
      assert.strictEqual(asClient.isError, true);
    } finally { cs.getAllClients = real; }
  });

  console.log('the "why not" box');
  await check('appending to the client note stamps the day', () => {
    const n = routes.appendNote('Recognise on selling.', 'Hates long emails');
    assert.ok(/^Recognise on selling\.\n\d{4}-\d{2}-\d{2}: Hates long emails$/.test(n));
    assert.ok(/^\d{4}-\d{2}-\d{2}: x$/.test(routes.appendNote('', 'x')));
  });

  console.log('introductions to make');
  const c = (id, name, over = {}) => ({ id: `rec-${id}`, clientId: id, clientName: name, clientEmailAddress: `${id.toLowerCase()}@x.com`, ...over });
  await check('allowed pairs: pairwise, not already introduced (either way round), neither side introduced this week', () => {
    const clients = [c('A', 'Ann'), c('B', 'Bob'), c('C', 'Cat'), c('D', 'Dan')];
    const rows = [{ clientRecordId: 'rec-A', otherClientRecordId: 'rec-B', direction: 'From Guy', stage: 'Promised', person: 'Bob' }];
    const pairs = intros.allowedPairs(clients, { rows, recentIntro: new Set(['D']) });
    assert.deepStrictEqual(pairs, [['A', 'C'], ['B', 'C']]);
  });
  await check('the model may only answer with allowed pairs, one introduction per person, at most three', () => {
    const allowed = [['A', 'B'], ['A', 'C'], ['B', 'C'], ['C', 'D']];
    const out = intros.parsePairs('{"pairs":[{"a":"B","b":"A","why":"x — y"},{"a":"A","b":"C","why":"again"},{"a":"C","b":"D","why":"z"},{"a":"Q","b":"A","why":"no"}]}', allowed);
    assert.deepStrictEqual(out.map((p) => `${p.a}+${p.b}`), ['A+B', 'C+D']);
    assert.strictEqual(out[0].why, 'x - y');
  });
  await check('the prompt says pairwise only and allows an empty answer', () => {
    const p = intros.buildPrompt([{ clientId: 'A', clientName: 'Ann', note: 'wants CFOs' }], [['A', 'B']]);
    assert.ok(p.system.includes('never a group')); assert.ok(p.system.includes('empty list')); assert.ok(p.user.includes('wants CFOs')); assert.ok(p.user.includes('A + B'));
  });

  console.log('');
  if (failures) { console.error(`${failures} failing`); process.exit(1); }
  console.log('all passing');
})();
