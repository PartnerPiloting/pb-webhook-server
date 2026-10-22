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
    const out = await planner.sendApproved('Guy-Wilson', '2026-10-26', { mailer, touchStore: touch, planStore: mkStore(rows), clientService: { getClientById: async () => client() } });
    assert.strictEqual(out.sent, 1);
    assert.strictEqual(mailer.sent[0].to, 'rick@example.com');
    assert.ok(mailer.sent[0].unsubscribeUrl.includes('tok123456789012345678'));
    assert.ok(mailer.sent[0].html.includes('Good to talk.'));
    assert.strictEqual(touch.recorded[0].kind, 'one-pager'); assert.strictEqual(touch.recorded[0].key, 'begin-with-the-end-in-mind'); assert.strictEqual(touch.recorded[0].source, 'planner');
    assert.strictEqual(rows[0].status, 'sent');
  });
  await check('a proposed row is NEVER sent - only approved or edited', async () => {
    const mailer = mailerOk();
    const out = await planner.sendApproved('Guy-Wilson', '2026-10-26', { mailer, touchStore: mkTouch(), planStore: mkStore([row({ status: 'proposed' }), row({ status: 'skipped' }), row({ status: 'nothing', pick: null })]), clientService: { getClientById: async () => client() } });
    assert.strictEqual(out.sent, 0); assert.strictEqual(mailer.sent.length, 0);
  });
  await check('an edited row sends Guy\'s words', async () => {
    const mailer = mailerOk();
    await planner.sendApproved('Guy-Wilson', '2026-10-26', { mailer, touchStore: mkTouch(), planStore: mkStore([row({ status: 'edited', opening: 'My own line.' })]), clientService: { getClientById: async () => client() } });
    assert.ok(mailer.sent[0].html.includes('My own line.'));
  });
  await check('the day-of-sending check: a client paused since Monday is held, not sent', async () => {
    const mailer = mailerOk(); const rows = [row()];
    const out = await planner.sendApproved('Guy-Wilson', '2026-10-26', { mailer, touchStore: mkTouch(), planStore: mkStore(rows), clientService: { getClientById: async () => client({ status: 'Paused' }) } });
    assert.strictEqual(out.held, 1); assert.strictEqual(mailer.sent.length, 0); assert.match(rows[0].sendError, /not an active client/);
  });
  await check('unsubscribed since Monday -> held; no token -> held', async () => {
    const mailer = mailerOk();
    const a = await planner.sendApproved('Guy-Wilson', '2026-10-26', { mailer, touchStore: mkTouch(), planStore: mkStore([row()]), clientService: { getClientById: async () => client({ emailUnsubscribed: true }) } });
    const b = await planner.sendApproved('Guy-Wilson', '2026-10-26', { mailer, touchStore: mkTouch(), planStore: mkStore([row()]), clientService: { getClientById: async () => client({ emailUnsubToken: null }) } });
    assert.strictEqual(a.held + b.held, 2); assert.strictEqual(mailer.sent.length, 0);
  });
  await check('already had the full piece (recorded since Monday) -> held; something already went today -> held', async () => {
    const mailer = mailerOk();
    const t1 = { ...mkTouch(), hasHad: async () => ({ sent_at: '2026-10-20' }) };
    const a = await planner.sendApproved('Guy-Wilson', '2026-10-26', { mailer, touchStore: t1, planStore: mkStore([row()]), clientService: { getClientById: async () => client() } });
    const t2 = { ...mkTouch(), touchesFor: async () => [{ kind: 'personal', sent_at: new Date().toISOString() }] };
    const b = await planner.sendApproved('Guy-Wilson', '2026-10-26', { mailer, touchStore: t2, planStore: mkStore([row()]), clientService: { getClientById: async () => client() } });
    assert.strictEqual(a.held, 1); assert.strictEqual(b.held, 1); assert.strictEqual(mailer.sent.length, 0);
  });
  await check('a failed send is marked failed and NOT recorded as a touch (it comes round again)', async () => {
    const touch = mkTouch(); const rows = [row()];
    const out = await planner.sendApproved('Guy-Wilson', '2026-10-26', { mailer: { sendSeriesEmail: async () => ({ ok: false, error: 'Mailgun 500' }) }, touchStore: touch, planStore: mkStore(rows), clientService: { getClientById: async () => client() } });
    assert.strictEqual(out.failed, 1); assert.strictEqual(touch.recorded.length, 0); assert.strictEqual(rows[0].status, 'failed');
  });
  await check('a call offer is recorded as a personal touch (it is Guy writing), and a body that is not built is held', async () => {
    const touch = mkTouch(); const mailer = mailerOk();
    await planner.sendApproved('Guy-Wilson', '2026-10-26', { mailer, touchStore: touch, planStore: mkStore([row({ pick: { what: { kind: 'call', key: 'check-in' }, form: 'one-off', rule: 'time-for-a-call', reason: 'r', body: { title: 'Time for a catch-up', dek: '' } } })]), clientService: { getClientById: async () => client() } });
    assert.strictEqual(touch.recorded[0].kind, 'personal');
    const out = await planner.sendApproved('Guy-Wilson', '2026-10-26', { mailer, touchStore: mkTouch(), planStore: mkStore([row({ pick: { what: { kind: 'one-off', key: 'x' }, form: 'one-off', rule: 'pinned', reason: 'r', body: { title: 'x', dek: '', missing: true } } })]), clientService: { getClientById: async () => client() } });
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
    assert.ok(pv.html.includes('Nothing goes until you approve'));
    assert.ok(planner.buildPreview(plan, { autosend: true }).html.includes('unless you veto'));
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
