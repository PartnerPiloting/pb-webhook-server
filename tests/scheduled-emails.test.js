/**
 * Tests for scheduled sends from the coach's own mailbox (services/scheduledEmails.js).
 *
 * Times in the recipient's zone (Brisbane, Sydney on daylight saving, Perth), the default slots
 * (weekly Wednesday, introductions Tuesday, anything else the next weekday - never a weekend),
 * introductions spaced a week apart per person, the away window, the just-before-it-goes checks,
 * and a schedule -> send run end to end against an in-memory database and a fake mailbox.
 *
 * Run: node tests/scheduled-emails.test.js
 */
const assert = require('assert');

let failures = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`  ✓ ${name}`); }
  catch (e) { failures++; console.error(`  ✗ ${name}\n    ${e.stack ? e.stack.split('\n').slice(0, 3).join('\n    ') : e.message}`); }
};

const q = require('../services/scheduledEmails');

// Saturday 24 Oct 2026, 4pm Brisbane (UTC+10) = 06:00 UTC.
const NOW = Date.UTC(2026, 9, 24, 6, 0);
const BNE = 'Australia/Brisbane';
const SYD = 'Australia/Sydney'; // AEDT, UTC+11 from 4 Oct
const PER = 'Australia/Perth';  // UTC+8
const iso = (ms) => new Date(ms).toISOString().slice(0, 16);

// ------------------------------------------------------------------------------------------
// An in-memory stand-in for the two tables (and the introduction log it reads).
function fakePool({ introWatch = [] } = {}) {
  const rows = [];
  const state = new Map();
  let nextId = 1;
  const out = (r) => ({ ...r });
  const client = {
    async query(sql, p = []) {
      const s = sql.replace(/\s+/g, ' ').trim();
      if (s.startsWith('INSERT INTO scheduled_emails')) {
        const r = { id: nextId++, tenant_id: p[0], kind: p[1], to_json: JSON.parse(p[2]), cc_json: JSON.parse(p[3]), bcc_json: JSON.parse(p[4]), subject: p[5], html: p[6], reply_to_message_id: p[7], resend_ok: p[8], client_id: p[9], parties: p[10], note: p[11], send_at: p[12], status: p[13] || 'scheduled', hold_reason: null, result: null, message_id: null, created_at: new Date(NOW), sent_at: null };
        rows.push(r);
        return { rows: [out(r)] };
      }
      if (s.startsWith("UPDATE scheduled_emails SET status = 'sending'")) {
        const r = rows.find((x) => x.id === p[0] && x.status === 'scheduled' && new Date(x.send_at) <= p[1]);
        if (r) r.status = 'sending';
        return { rows: r ? [out(r)] : [] };
      }
      if (s.startsWith('UPDATE scheduled_emails SET')) {
        const r = rows.find((x) => x.id === p[0]);
        const sets = s.slice('UPDATE scheduled_emails SET '.length, s.indexOf(', updated_at')).split(', ');
        sets.forEach((pair) => { const [col, ph] = pair.split(' = '); r[col] = p[Number(ph.slice(1)) - 1]; });
        return { rows: [out(r)] };
      }
      if (s.startsWith("SELECT * FROM scheduled_emails WHERE status = 'scheduled'")) return { rows: rows.filter((x) => x.status === 'scheduled' && new Date(x.send_at) <= p[0]).map(out) };
      if (s.startsWith('SELECT * FROM scheduled_emails WHERE tenant_id = $1 AND id = $2')) return { rows: rows.filter((x) => x.tenant_id === p[0] && x.id === p[1]).map(out) };
      if (s.startsWith('SELECT * FROM scheduled_emails WHERE tenant_id = $1')) {
        return { rows: rows.filter((x) => x.tenant_id === p[0] && (!p[1] || p[1].includes(x.status)) && (!p[2] || new Date(x.sent_at || x.send_at) >= p[2])).sort((a, b) => new Date(a.send_at) - new Date(b.send_at)).map(out) };
      }
      if (s.startsWith('SELECT value FROM scheduled_email_state')) return { rows: state.has(p[0]) ? [{ value: state.get(p[0]) }] : [] };
      if (s.startsWith('INSERT INTO scheduled_email_state') && s.includes('DO NOTHING')) { if (state.has(p[0])) return { rows: [] }; state.set(p[0], p[1]); return { rows: [{ key: p[0] }] }; }
      if (s.startsWith('INSERT INTO scheduled_email_state')) { state.set(p[0], p[1]); return { rows: [] }; }
      if (s.includes('FROM wingguy_intro_watch')) {
        if (s.includes("status = 'sent'")) return { rows: introWatch.filter((w) => w.status === 'sent' && new Date(w.sent_at) > p[1] && w.parties.includes(p[2]) && w.parties.includes(p[3])) };
        return { rows: introWatch };
      }
      throw new Error(`fake pool: unhandled SQL ${s.slice(0, 90)}`);
    },
    release() {},
  };
  return { rows, state, connect: async () => client };
}

// The coach and his clients, as clientService would return them.
const CLIENTS = [
  { id: 'recGuy', clientId: 'Guy-Wilson', clientName: 'Guy Wilson', clientEmailAddress: 'guyralphwilson@gmail.com', timezone: BNE, status: 'Active' },
  { id: 'recDean', clientId: 'Dean-Hobin', clientName: 'Dean Hobin', clientEmailAddress: 'dean@timeandfocus.com.au', timezone: SYD, coach: 'Guy-Wilson', status: 'Active', touchNote: 'weekly tips' },
  { id: 'recRick', clientId: 'Rick-Wong', clientName: 'Rick Wong', clientEmailAddress: 'rwong@salesxceleration.com', timezone: SYD, coach: 'Guy-Wilson', status: 'Active' },
  { id: 'recOwen', clientId: 'Owen-Pyrah', clientName: 'Owen Pyrah', clientEmailAddress: 'owen@acjtech.com', timezone: PER, coach: 'Guy-Wilson', status: 'Active' },
];
function deps(extra = {}) {
  const notes = [];
  const touches = [];
  const sent = [];
  const skipped = [];
  const cs = {
    getAllClients: async () => CLIENTS,
    getClientById: async (id) => CLIENTS.find((c) => c.clientId === id) || null,
    updateTouchNote: async (rec, note) => { notes.push({ rec, note }); return { success: true }; },
  };
  return {
    now: NOW,
    notes, touches, sent, skipped,
    clientService: cs,
    actions: { resolveClient: async (_t, q2) => { const c = CLIENTS.find((x) => x.clientId === q2 || x.clientName.toLowerCase().includes(String(q2).toLowerCase())); return c ? { client: c } : { error: 'no' }; } },
    mail: {
      prepareOutbound: async ({ to, subject, html_body }) => ({ coach: CLIENTS[0], recipients: to, subject, html: html_body, detected: { html: html_body, assetKeys: [] }, leadEmails: to.map((r) => r.email), store: null }),
      finishOutbound: async () => ({ ledgerLine: '', followUpLine: 'Follow-up queued.\n', introLine: '' }),
      htmlToText: (h) => String(h).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
    },
    mailProvider: {
      sendMessage: async (_coach, d) => { sent.push(d); return { ok: true, messageId: 'm1' }; },
      findMessages: async () => ({ ok: true, messages: [] }),
      toParticipants: (l) => l || [],
    },
    planStore: {
      weekOf: (d) => require('../services/clientTouchPlanStore').weekOf(d),
      planFor: async (week, clientId) => ({ weekOf: week, clientId, status: 'proposed' }),
      setPlanStatus: async (week, clientId, status) => { skipped.push({ week, clientId, status }); return {}; },
    },
    touchStore: { record: async (t) => { touches.push(t); return { ok: true }; } },
    ...extra,
  };
}

(async () => {
  console.log('time zones and slots');
  await check('9:30am Sydney on daylight saving is 8:30am Brisbane; Perth is 11:30am Brisbane', () => {
    assert.strictEqual(iso(q.zonedToUtc('2026-10-28', 9, 30, SYD)), '2026-10-27T22:30');
    assert.strictEqual(iso(q.zonedToUtc('2026-10-28', 9, 30, BNE)), '2026-10-27T23:30');
    assert.strictEqual(iso(q.zonedToUtc('2026-10-28', 9, 30, PER)), '2026-10-28T01:30');
  });
  await check('from a Saturday: weekly -> Wednesday, intro -> Tuesday, anything else -> Monday, all 9:30am their time', () => {
    assert.strictEqual(iso(q.defaultSendAt({ kind: 'weekly', tzs: [BNE], fromMs: NOW })), '2026-10-27T23:30');
    assert.strictEqual(iso(q.defaultSendAt({ kind: 'intro', tzs: [BNE], fromMs: NOW })), '2026-10-26T23:30');
    assert.strictEqual(iso(q.defaultSendAt({ kind: 'email', tzs: [BNE], fromMs: NOW })), '2026-10-25T23:30');
    assert.strictEqual(q.localParts(q.defaultSendAt({ kind: 'email', tzs: [BNE], fromMs: NOW }), BNE).weekday, 0, 'Monday, never the weekend');
  });
  await check('two zones: the later 9:30 wins, so nobody gets it before 9:30 their time', () => {
    const at = q.defaultSendAt({ kind: 'intro', tzs: [SYD, PER], fromMs: NOW });
    assert.strictEqual(iso(at), '2026-10-27T01:30'); // 9:30 Perth = 12:30 Sydney
    assert.ok(q.localParts(at, SYD).hour >= 9 && q.localParts(at, PER).hour === 9);
  });
  await check('a Wednesday morning before 9:30 still makes that day; after it, the next Wednesday', () => {
    const wedEarly = Date.UTC(2026, 9, 27, 21, 0); // Wed 28 Oct 7am Brisbane
    assert.strictEqual(iso(q.defaultSendAt({ kind: 'weekly', tzs: [BNE], fromMs: wedEarly })), '2026-10-27T23:30');
    const wedLate = Date.UTC(2026, 9, 28, 2, 0); // Wed noon
    assert.strictEqual(iso(q.defaultSendAt({ kind: 'weekly', tzs: [BNE], fromMs: wedLate })), '2026-11-03T23:30');
  });
  await check('send_at: a date = 9:30am their time; a local time = that time in their zone; ISO = exactly then; junk = null', () => {
    assert.strictEqual(iso(q.parseWhen('2026-11-03', [SYD])), '2026-11-02T22:30');
    assert.strictEqual(iso(q.parseWhen('2026-11-03T14:00', [PER])), '2026-11-03T06:00');
    assert.strictEqual(iso(q.parseWhen('2026-11-03T09:00:00+10:00', [PER])), '2026-11-02T23:00');
    assert.strictEqual(q.parseWhen('next tuesday', [BNE]), null);
  });

  console.log('introductions spaced, the away window');
  await check('Owen already has one this week -> the Rick and Owen introduction moves to the next Tuesday', () => {
    const at = q.defaultSendAt({ kind: 'intro', tzs: [SYD, PER], fromMs: NOW });
    const busy = (e) => (e === 'owen@acjtech.com' ? new Set([q.weekKey(at)]) : new Set());
    const r = q.spaceIntroduction(at, ['rwong@salesxceleration.com', 'owen@acjtech.com'], busy, [SYD, PER]);
    assert.deepStrictEqual(r.movedFor, ['owen@acjtech.com']);
    assert.strictEqual(q.localParts(r.at, PER).dateStr, '2026-11-03');
    assert.strictEqual(q.localParts(r.at, PER).weekday, 1);
  });
  await check('away 15 Nov - 6 Dec: inside counts, the edges count, after it introductions resume the first Tuesday', () => {
    const away = { from: '2026-11-15', until: '2026-12-06' };
    assert.ok(q.inAway(Date.UTC(2026, 10, 20, 0, 0), away));
    assert.ok(q.inAway(q.zonedToUtc('2026-12-06', 20, 0, BNE), away));
    assert.ok(!q.inAway(q.zonedToUtc('2026-12-07', 9, 0, BNE), away));
    assert.strictEqual(q.localParts(q.afterAway(away, [BNE]), BNE).dateStr, '2026-12-08');
  });
  await check('away nudge: an email that asks something of them is spotted; a plain idea is not', () => {
    assert.ok(q.asksForGuy('Would a 20-minute Teams call next week suit?'));
    assert.ok(!q.asksForGuy('This week\'s idea comes from Atomic Habits. Pick one fixed slot each day.'));
  });

  console.log('schedule -> send, end to end');
  await check('a weekly email for Dean: Wednesday 9:30am Sydney, his planned weekly email skipped, then sent with touch record and note', async () => {
    const pool = fakePool();
    q.__setTestPool(pool);
    const d = deps();
    const r = await q.schedule('Guy-Wilson', { to: [{ email: 'dean@timeandfocus.com.au', name: 'Dean Hobin' }], subject: 'Schedule your priorities', html_body: '<p>One idea.</p>', client: 'Dean' }, d);
    assert.ok(r.ok, r.text);
    assert.strictEqual(r.row.kind, 'weekly');
    assert.strictEqual(iso(r.row.sendAt), '2026-10-27T22:30');
    assert.match(r.text, /goes Wednesday 28 Oct, 9:30am their time \(8:30am your time\)/);
    assert.deepStrictEqual(d.skipped, [{ week: '2026-10-26', clientId: 'Dean-Hobin', status: 'skipped' }]);
    // Not due yet: nothing goes.
    assert.deepStrictEqual(await q.tick({ ...d, now: NOW + 60000 }), []);
    // Due: it goes.
    const due = Date.UTC(2026, 9, 27, 22, 35);
    const done = await q.tick({ ...d, now: due, sendAlertEmail: async () => {} });
    assert.deepStrictEqual(done, [{ id: r.row.id, status: 'sent' }]);
    assert.strictEqual(d.sent.length, 1);
    assert.strictEqual(d.sent[0].subject, 'Schedule your priorities');
    assert.strictEqual(d.touches[0].clientId, 'Dean-Hobin');
    assert.strictEqual(d.touches[0].meta.via, 'scheduled');
    assert.match(d.notes[0].note, /Weekly email sent \(scheduled\): "Schedule your priorities"/);
    assert.strictEqual(pool.rows[0].status, 'sent');
    // Never twice.
    assert.deepStrictEqual(await q.tick({ ...d, now: due + 600000, sendAlertEmail: async () => {} }), []);
    assert.strictEqual(d.sent.length, 1);
  });
  await check('an introduction where Owen already has one this week (drafted, not sent) is moved on a week, and says why', async () => {
    const pool = fakePool({ introWatch: [{ parties: 'owen@acjtech.com,info@findmefirst.com.au', status: 'awaiting-send', drafted_at: new Date(NOW - 3600000), sent_at: null }] });
    q.__setTestPool(pool);
    const r = await q.schedule('Guy-Wilson', {
      to: [{ email: 'rwong@salesxceleration.com', name: 'Rick Wong' }], cc: [{ email: 'owen@acjtech.com', name: 'Owen Pyrah' }],
      subject: 'Introducing Rick and Owen', html_body: '<p>I want to introduce you two.</p>',
    }, deps());
    assert.ok(r.ok, r.text);
    assert.strictEqual(r.row.kind, 'intro');
    assert.match(r.text, /Moved on a week because Owen Pyrah already has an introduction that week/);
    assert.strictEqual(q.localParts(r.row.sendAt, PER).dateStr, '2026-11-03');
    assert.match(r.text, /goes Tuesday 3 Nov, 12:30pm Sydney, 9:30am Perth \(11:30am your time\)/);
  });
  await check('while Guy is away an introduction waits for his return; a due one is deferred, not sent', async () => {
    const pool = fakePool();
    q.__setTestPool(pool);
    await q.setAway('Guy-Wilson', '2026-10-24', '2026-11-08');
    const d = deps();
    const r = await q.schedule('Guy-Wilson', { to: [{ email: 'rwong@salesxceleration.com' }], cc: [{ email: 'owen@acjtech.com' }], subject: 'Introducing Rick and Owen', html_body: '<p>introduce</p>' }, d);
    assert.match(r.text, /away until 2026-11-08, so it waits for your return/);
    assert.strictEqual(q.localParts(r.row.sendAt, PER).dateStr, '2026-11-10');
    // One scheduled for a time inside the window (by hand) is deferred when it falls due.
    const m = await q.move('Guy-Wilson', r.row.id, '2026-10-30T10:00', d);
    assert.ok(m.ok, m.text);
    const done = await q.tick({ ...d, now: Date.UTC(2026, 9, 30, 4, 0), sendAlertEmail: async () => {} });
    assert.deepStrictEqual(done, [{ id: r.row.id, status: 'deferred' }]);
    assert.strictEqual(d.sent.length, 0);
    await q.clearAway('Guy-Wilson');
  });

  console.log('held, not sent');
  await check('sending switched off here (staging) -> held, nothing goes', async () => {
    q.__setTestPool(fakePool());
    const d = deps();
    const r = await q.schedule('Guy-Wilson', { to: [{ email: 'dean@timeandfocus.com.au' }], subject: 'S', html_body: '<p>x</p>', client: 'Dean' }, d);
    process.env.CLIENT_TOUCH_SEND_ENABLED = 'off';
    try {
      await q.tick({ ...d, now: Date.UTC(2026, 9, 28, 0, 0), sendAlertEmail: async () => {} });
      const row = await q.getRow('Guy-Wilson', r.row.id);
      assert.strictEqual(row.status, 'held');
      assert.match(row.holdReason, /switched off/);
      assert.strictEqual(d.sent.length, 0);
    } finally { delete process.env.CLIENT_TOUCH_SEND_ENABLED; }
  });
  await check('Guy emailed them himself since scheduling -> held; one of our own scheduled sends does not count', async () => {
    const row = { id: 9, tenantId: 'Guy-Wilson', kind: 'email', to: [{ email: 'rwong@salesxceleration.com', name: 'Rick Wong' }], cc: [], parties: [], createdAt: NOW };
    const mine = { messages: [{ from: 'Guy Wilson <guyralphwilson@gmail.com>', subject: 'Quick one' }] };
    const ctx = { coach: CLIENTS[0], selfEmails: new Set(['guyralphwilson@gmail.com']), ourSubjects: new Set() };
    const why = await q.holdReason(row, ctx, { ...deps(), mailProvider: { findMessages: async () => ({ ok: true, ...mine }) } });
    assert.match(why, /you emailed Rick Wong yourself since scheduling \("Quick one"\)/);
    const ours = await q.holdReason(row, { ...ctx, ourSubjects: new Set(['quick one']) }, { ...deps(), mailProvider: { findMessages: async () => ({ ok: true, ...mine }) } });
    assert.strictEqual(ours, null);
    const toSelf = await q.holdReason({ ...row, to: [{ email: 'GuyRalphWilson@gmail.com' }] }, ctx, { ...deps(), mailProvider: { findMessages: async () => ({ ok: true, ...mine }) } });
    assert.strictEqual(toSelf, null, 'an email to Guy himself is never held for "you emailed them"');
  });
  await check('a weekly email to a client who unsubscribed -> held', async () => {
    const d = deps({ clientService: { ...deps().clientService, getClientById: async (id) => ({ ...CLIENTS.find((c) => c.clientId === id), emailUnsubscribed: true }) } });
    const why = await q.holdReason({ kind: 'weekly', clientId: 'Dean-Hobin', to: [], parties: [] }, { coach: null }, d);
    assert.match(why, /Dean Hobin has unsubscribed/);
  });
  console.log('needs your OK, show, edit');
  await check('one Claude wrote for Guy waits for his OK: never sent when due, moving it keeps it waiting, approve lets it go', async () => {
    const pool = fakePool();
    q.__setTestPool(pool);
    const d = deps();
    const r = await q.schedule('Guy-Wilson', { to: [{ email: 'rwong@salesxceleration.com', name: 'Rick Wong' }], subject: 'Givers', html_body: '<p>Idea.</p>', client: 'Rick', needs_ok: true }, d);
    assert.ok(r.ok, r.text);
    assert.strictEqual(r.row.status, 'awaiting');
    assert.match(r.text, /^Queued for your OK #\d+/); assert.match(r.text, /will NOT go until you approve it/);
    const due = r.row.sendAt + 60000;
    assert.deepStrictEqual(await q.tick({ ...d, now: due, sendAlertEmail: async () => {} }), [], 'not sent while waiting');
    assert.match(await q.listText('Guy-Wilson', NOW), /NEEDS YOUR OK - will not go until you approve \(1\)/);
    const m = await q.move('Guy-Wilson', r.row.id, '2026-10-29', d);
    assert.match(m.text, /still waiting for your OK/);
    assert.strictEqual((await q.getRow('Guy-Wilson', r.row.id)).status, 'awaiting');
    const a = await q.approve('Guy-Wilson', r.row.id);
    assert.ok(a.ok, a.text);
    assert.strictEqual((await q.getRow('Guy-Wilson', r.row.id)).status, 'scheduled');
    assert.strictEqual((await q.approve('Guy-Wilson', r.row.id)).ok, false, 'already approved');
  });
  await check('edit takes Guy\'s words, checked like a draft; show prints it with paragraphs and links kept', async () => {
    q.__setTestPool(fakePool());
    const d = deps();
    const r = await q.schedule('Guy-Wilson', { to: [{ email: 'dean@timeandfocus.com.au', name: 'Dean Hobin' }], subject: 'Old', html_body: '<p>One.</p>', client: 'Dean' }, d);
    const e = await q.editEmail('Guy-Wilson', r.row.id, { subject: 'New subject', html_body: '<p>First line.</p><p>See <a href="https://example.org/x">this</a>.</p><ul><li>a point</li></ul>' }, d);
    assert.ok(e.ok, e.text); assert.match(e.text, /Changed the subject and the body/);
    assert.strictEqual((await q.editEmail('Guy-Wilson', r.row.id, {}, d)).ok, false, 'nothing given');
    const s = await q.showText('Guy-Wilson', r.row.id, d);
    assert.ok(s.ok);
    assert.match(s.text, /Subject: New subject/);
    assert.match(s.text, /First line\.\n\nSee this \(https:\/\/example\.org\/x\)\.\n\n- a point/);
    const page = await q.forPage('Guy-Wilson', NOW);
    assert.strictEqual(page[0].subject, 'New subject'); assert.strictEqual(page[0].status, 'scheduled');
  });
  await check('cancel stops it; move to a time already gone is refused', async () => {
    q.__setTestPool(fakePool());
    const d = deps();
    const r = await q.schedule('Guy-Wilson', { to: [{ email: 'dean@timeandfocus.com.au' }], subject: 'S', html_body: '<p>x</p>', client: 'Dean' }, d);
    assert.ok((await q.move('Guy-Wilson', r.row.id, '2026-10-01', d)).text.match(/already passed/));
    assert.ok((await q.cancel('Guy-Wilson', r.row.id)).ok);
    assert.deepStrictEqual(await q.tick({ ...d, now: Date.UTC(2026, 9, 29, 0, 0), sendAlertEmail: async () => {} }), []);
    assert.match(await q.listText('Guy-Wilson', NOW), /Nothing scheduled/);
  });

  q.__setTestPool(null);
  if (failures) { console.error(`\n${failures} failed`); process.exit(1); }
  console.log('\nall passed');
})();
