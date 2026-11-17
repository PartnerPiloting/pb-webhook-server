/**
 * Tests for "Hi Network Builders" - the client copy of the weekly list edition (services/clientEdition.js).
 * Pure parts, plus the tick against a fake store - no Airtable, no Postgres, no Mailgun. ⚠ Synthetic people only.
 *
 * Run: node tests/client-edition.test.js
 */
const assert = require('assert');
const C = require('../services/clientEdition');
const L = require('../services/listEditions');

let failures = 0;
const pending = [];
const check = (name, fn) => {
  const run = async () => {
    try { await fn(); console.log(`  ✓ ${name}`); }
    catch (e) { failures++; console.error(`  ✗ ${name}\n    ${e.message}`); }
  };
  pending.push(run);
};
const at = (s) => new Date(s).getTime();

const edition = { kind: 'idea', title: 'Build before you need it', paragraphs: ['First idea paragraph.', 'This week, try one thing.'], source: 'book', status: 'sending', ideaId: 'book-x' };
const client = (over = {}) => ({ clientId: 'Sam-Test', clientName: 'Sam Test', status: 'Active', coachingStatus: null, clientEmailAddress: 'Sam@Example.com', emailUnsubToken: 'tok-1234567890abcdef', emailUnsubscribed: false, ...over });
const person = (over = {}, extra = {}) => ({ client: client(over), group: 'running', ...extra });
const NOW = at('2026-11-18T00:00:00Z');

pending.push(async () => console.log('the words'));
check('every client gets the same email: "Hi Network Builders,", the idea, the client closing line, the sign-off', () => {
  const r = C.render({ edition, unsubUrl: 'https://example.com/u?t=1' });
  assert.strictEqual(r.subject, 'Network building, rethought - Build before you need it');
  assert.ok(r.html.indexOf('<p>Hi Network Builders,</p>') < r.html.indexOf('First idea paragraph.'));
  assert.ok(r.html.indexOf('This week, try one thing.') < r.html.indexOf(C.CLIENT_CLOSER));
  assert.ok(r.html.indexOf(C.CLIENT_CLOSER) < r.html.indexOf('(I know a) Guy'));
  assert.ok(r.html.includes('<a href="https://example.com/u?t=1"'));
  assert.ok(!/[–—]/.test(r.html));
});
check('it never carries the prospect closer or the link to the site - clients are not being sold to', () => {
  const r = C.render({ edition });
  assert.ok(!r.html.includes('when you\'re ready to talk'));
  assert.ok(!r.html.includes('I Know A Guy</a>'));
  assert.ok(!/\{\{/.test(r.html));
});
check('it names nobody and says nothing about any one client', () => {
  const r = C.render({ edition });
  assert.ok(!/Hi Sam|Hi Sarah|your campaign|Congratulations/.test(r.html));
});
check('a Beth idea carries her P.S. after the sign-off', () => {
  const r = C.render({ edition: { ...edition, source: 'beth' } });
  assert.ok(r.html.indexOf('(I know a) Guy') < r.html.indexOf('P.S. This week'));
});
check('the launch piece is for the list only - no client copy of it', () => {
  assert.strictEqual(C.render({ edition: { kind: 'intro', title: 'What does better mean?' } }), null);
  assert.strictEqual(C.render({ edition: null }), null);
});

pending.push(async () => console.log('who gets it'));
check('an active client gets it, onboarding or not, at their lower-cased address', () => {
  const { go, off } = C.pickClients([person(), person({ clientId: 'New-Person', clientName: 'New Person', clientEmailAddress: 'new@example.com' }, { group: 'onboarding' })], { now: NOW });
  assert.deepStrictEqual(go.map((g) => g.email), ['sam@example.com', 'new@example.com']);
  assert.strictEqual(off.length, 0);
});
check('left off, each with the reason: not active, paused, unsubscribed, no address, bounced, no token', () => {
  const { go, off } = C.pickClients([
    person({ clientId: 'A', status: 'Paused' }),
    person({ clientId: 'B', clientEmailAddress: 'b@example.com' }, { group: 'paused' }),
    person({ clientId: 'C', clientEmailAddress: 'c@example.com', emailUnsubscribed: true }),
    person({ clientId: 'D', clientEmailAddress: '' }),
    person({ clientId: 'E', clientEmailAddress: 'e@example.com' }, { bounced: true }),
    person({ clientId: 'F', clientEmailAddress: 'f@example.com', emailUnsubToken: '' }),
  ], { now: NOW });
  assert.strictEqual(go.length, 0);
  const why = Object.fromEntries(off.map((o) => [o.clientId, o.reason]));
  assert.ok(/not an active client/.test(why.A));
  assert.ok(/paused/.test(why.B));
  assert.ok(/unsubscribed/.test(why.C));
  assert.ok(/no working email/.test(why.D));
  assert.ok(/bounced/.test(why.E));
  assert.ok(/unsubscribe token/.test(why.F));
});
check('left off: winding down, on the leave-off list, and "nothing until" a date still ahead', () => {
  const { go, off } = C.pickClients([
    person({ clientId: 'A' }, { windingDownUntil: '2027-01-15T00:00:00Z' }),
    person({ clientId: 'B', clientEmailAddress: 'b@example.com' }, { leaveOff: 'on your leave-off list for all-client emails' }),
    person({ clientId: 'C', clientEmailAddress: 'c@example.com' }, { skipUntil: '2027-01-25' }),
    person({ clientId: 'D', clientEmailAddress: 'd@example.com' }, { skipUntil: '2026-11-01' }),
  ], { now: NOW });
  assert.deepStrictEqual(go.map((g) => g.clientId), ['D'], 'a "nothing until" date that has passed no longer holds them off');
  assert.strictEqual(off.length, 3);
});
check('the coach himself and a second record at the same address are never mailed', () => {
  const { go, off } = C.pickClients([
    person({ clientId: 'Guy-Coach', clientEmailAddress: 'coach@example.com' }),
    person(),
    person({ clientId: 'Sam-Second' }),
  ], { now: NOW, tenantId: 'Guy-Coach' });
  assert.deepStrictEqual(go.map((g) => g.clientId), ['Sam-Test']);
  assert.strictEqual(off[0].reason, 'same address as another client');
});
check('each client carries their own unsubscribe link', () => {
  const { go } = C.pickClients([person()], { now: NOW, unsubUrlFor: (c) => `https://example.com/u?t=${c.emailUnsubToken}` });
  assert.strictEqual(go[0].unsubUrl, 'https://example.com/u?t=tok-1234567890abcdef');
});

pending.push(async () => console.log('when it goes'));
check('off until Guy starts it, and not before the Wednesday he started it from', () => {
  assert.ok(/not been started/.test(C.blockedReason({ start: null, sendDate: '2026-11-25', held: false, edition })));
  assert.ok(/starts/.test(C.blockedReason({ start: '2026-12-02', sendDate: '2026-11-25', held: false, edition })));
  assert.strictEqual(C.blockedReason({ start: '2026-11-25', sendDate: '2026-11-25', held: false, edition }), null);
});
check('held by itself, or with the list edition; never for the launch piece or an unwritten week', () => {
  const base = { start: '2026-11-25', sendDate: '2026-11-25', held: false, edition };
  assert.ok(/held the client email/.test(C.blockedReason({ ...base, held: true })));
  assert.ok(/held this week's edition/.test(C.blockedReason({ ...base, edition: { ...edition, status: 'held' } })));
  assert.ok(/launch piece/.test(C.blockedReason({ ...base, edition: { kind: 'intro', status: 'sent' } })));
  assert.ok(/not written/.test(C.blockedReason({ ...base, edition: null })));
});

// The tick, against a fake store: only the state table and the edition row matter here.
function fakePool({ state = {}, editionRow = null } = {}) {
  const calls = [];
  return {
    calls,
    connect: async () => ({
      release() {},
      query: async (sql, params = []) => {
        calls.push(sql);
        if (/FROM list_state/.test(sql)) return { rows: state[params[0]] ? [{ value: state[params[0]] }] : [] };
        if (/INSERT INTO list_state/.test(sql)) { state[params[0]] = params[1]; return { rows: [] }; }
        if (/FROM list_editions/.test(sql)) return { rows: editionRow ? [editionRow] : [] };
        return { rows: [] };
      },
    }),
  };
}
const row = (over = {}) => ({ id: 7, tenant_id: 'T', send_date: '2026-11-25', kind: 'idea', idea_id: 'book-x', source: 'book', title: 'Build before you need it', paragraphs: ['x'], status: 'sending', ...over });
const WED_10AM = at('2026-11-25T00:00:00Z'); // Wed 25 Nov, 10am Brisbane
const TUE = at('2026-11-24T00:00:00Z');

check('the tick does nothing before Wednesday 9:30am Brisbane', async () => {
  L.__setTestPool(fakePool({ state: { 'clients:start': '2026-11-25' }, editionRow: row() }));
  assert.strictEqual(await C.tick(TUE, 'T'), 'before');
});
check('the tick does nothing while the client email has not been started', async () => {
  L.__setTestPool(fakePool({ editionRow: row() }));
  assert.strictEqual(await C.tick(WED_10AM, 'T'), 'blocked');
});
check('the tick does nothing when Guy held the client email, or held the edition', async () => {
  L.__setTestPool(fakePool({ state: { 'clients:start': '2026-11-25', 'clients:hold:2026-11-25': '1' }, editionRow: row() }));
  assert.strictEqual(await C.tick(WED_10AM, 'T'), 'blocked');
  L.__setTestPool(fakePool({ state: { 'clients:start': '2026-11-25' }, editionRow: row({ status: 'held' }) }));
  assert.strictEqual(await C.tick(WED_10AM, 'T'), 'blocked');
});
check('the tick follows the list edition - it never goes while the edition is still a draft', async () => {
  L.__setTestPool(fakePool({ state: { 'clients:start': '2026-11-25' }, editionRow: row({ status: 'draft' }) }));
  assert.strictEqual(await C.tick(WED_10AM, 'T'), 'list-not-going');
});
check('the tick never sends twice: once the week is marked done it stops', async () => {
  const pool = fakePool({ state: { 'clients:start': '2026-11-25', 'clients:done:2026-11-25': '1' }, editionRow: row({ status: 'sent' }) });
  L.__setTestPool(pool);
  assert.strictEqual(await C.tick(WED_10AM, 'T'), 'done');
  assert.ok(!pool.calls.some((s) => /client_edition_sends/.test(s)));
});
check('staging never sends: with the send switch off the tick stops before reading anything', async () => {
  const pool = fakePool({ state: { 'clients:start': '2026-11-25' }, editionRow: row() });
  L.__setTestPool(pool);
  process.env.CLIENT_TOUCH_SEND_ENABLED = 'off';
  try { assert.strictEqual(await C.tick(WED_10AM, 'T'), 'switch-off'); } finally { delete process.env.CLIENT_TOUCH_SEND_ENABLED; }
  assert.strictEqual(pool.calls.length, 0);
});
check("for Monday's heads-up: the email itself when it is going, only the reason when it is not", async () => {
  L.__setTestPool(fakePool({ state: { 'clients:start': '2026-11-25' }, editionRow: row({ status: 'draft' }) }));
  const on = await C.headsUpPart('T', { sendDate: '2026-11-25' });
  assert.ok(on.mail && on.mail.html.includes('Hi Network Builders,') && /unless you hold it/.test(on.line));
  L.__setTestPool(fakePool({ editionRow: row({ status: 'draft' }) }));
  const off = await C.headsUpPart('T', { sendDate: '2026-11-25' });
  assert.strictEqual(off.mail, null);
  assert.ok(/not going - the client email has not been started yet/.test(off.line));
});
check('starting it names the Wednesday it starts from; holding it leaves the list alone', async () => {
  const state = {};
  L.__setTestPool(fakePool({ state }));
  const on = await C.turnOn('T', { nowMs: TUE });
  assert.strictEqual(state['clients:start'], '2026-11-25');
  assert.ok(/Wednesday 25 Nov/.test(on.text));
  const held = await C.hold('T', { nowMs: TUE });
  assert.strictEqual(state['clients:hold:2026-11-25'], '1');
  assert.ok(/Your list still gets its edition/.test(held.text));
  await C.release('T', { nowMs: TUE });
  assert.strictEqual(state['clients:hold:2026-11-25'], '');
  await C.turnOff('T');
  assert.strictEqual(state['clients:start'], '');
});

// The whole send, against a fake store that keeps the queue rows.
function sendingPool({ state = {}, editionRow }) {
  const sends = [];
  return {
    sends,
    state,
    connect: async () => ({
      release() {},
      query: async (sql, params = []) => {
        if (/FROM list_state/.test(sql)) return { rows: state[params[0]] ? [{ value: state[params[0]] }] : [] };
        if (/INSERT INTO list_state/.test(sql)) { state[params[0]] = params[1]; return { rows: [] }; }
        if (/FROM list_editions/.test(sql)) return { rows: [editionRow] };
        if (/INSERT INTO client_edition_sends/.test(sql)) {
          if (!sends.some((x) => x.client_id === params[2])) sends.push({ id: sends.length + 1, client_id: params[2], email: params[3], name: params[4], status: 'queued' });
          return { rows: [] };
        }
        if (/SELECT \* FROM client_edition_sends/.test(sql)) return { rows: sends.filter((x) => x.status === 'queued') };
        if (/SET status = 'sent'/.test(sql)) { sends.find((x) => x.id === params[0]).status = 'sent'; return { rows: [] }; }
        if (/SET status = 'failed'/.test(sql)) { Object.assign(sends.find((x) => x.id === params[0]), { status: 'failed', error: params[1] }); return { rows: [] }; }
        if (/GROUP BY status/.test(sql)) {
          const by = {};
          for (const x of sends) by[x.status] = (by[x.status] || 0) + 1;
          return { rows: Object.entries(by).map(([status, n]) => ({ status, n })) };
        }
        return { rows: [] };
      },
    }),
  };
}

pending.push(async () => console.log('the send'));
check('one email per client with their own link, recorded on their touch record, one summary to Guy - and a second tick sends nothing more', async () => {
  const pool = sendingPool({ state: { 'clients:start': '2026-11-25' }, editionRow: row() });
  L.__setTestPool(pool);
  const mails = [];
  const touches = [];
  const notes = [];
  const deps = {
    audience: async () => ({ go: [{ clientId: 'A', name: 'Ann A', email: 'a@example.com' }, { clientId: 'B', name: 'Bob B', email: 'b@example.com' }], off: [{ name: 'Cy C', reason: 'paused' }] }),
    getClient: async (id) => ({ clientId: id, emailUnsubToken: `token-for-${id}` }),
    unsubUrlFor: (c) => `https://example.com/u?t=${c.emailUnsubToken}`,
    recordTouch: async (t) => { touches.push(t); },
    replyToFor: async () => 'coach@example.com',
    mail: async (m) => { mails.push(m); return { id: 'mg-1' }; },
    notify: async (_t, subject, text) => { notes.push({ subject, text }); },
  };
  assert.strictEqual(await C.tick(WED_10AM, 'T', deps), 'ran');
  assert.deepStrictEqual(mails.map((m) => m.to), ['a@example.com', 'b@example.com']);
  assert.ok(mails[0].html.includes('token-for-A') && !mails[0].html.includes('token-for-B'));
  assert.ok(mails.every((m) => m.html.includes('Hi Network Builders,') && m.replyTo === 'coach@example.com'));
  assert.deepStrictEqual(touches.map((t) => [t.clientId, t.kind]), [['A', 'mindset'], ['B', 'mindset']]);
  assert.strictEqual(notes.length, 1);
  assert.ok(/went out - 2 clients/.test(notes[0].subject) && /Cy C \(paused\)/.test(notes[0].text));
  assert.strictEqual(await C.tick(WED_10AM + 5 * 60000, 'T', deps), 'done');
  assert.strictEqual(mails.length, 2);
  assert.strictEqual(notes.length, 1);
});
check('a client with no unsubscribe link is not mailed, and one failure does not stop the others', async () => {
  const pool = sendingPool({ state: { 'clients:start': '2026-11-25' }, editionRow: row() });
  L.__setTestPool(pool);
  const mails = [];
  const notes = [];
  const deps = {
    audience: async () => ({ go: [{ clientId: 'A', name: 'Ann A', email: 'a@example.com' }, { clientId: 'B', name: 'Bob B', email: 'b@example.com' }, { clientId: 'C', name: 'Cy C', email: 'c@example.com' }], off: [] }),
    getClient: async (id) => ({ clientId: id, emailUnsubToken: id === 'A' ? '' : `token-for-${id}` }),
    unsubUrlFor: (c) => (c.emailUnsubToken ? `https://example.com/u?t=${c.emailUnsubToken}` : null),
    recordTouch: async () => {},
    replyToFor: async () => 'coach@example.com',
    mail: async (m) => { if (m.to === 'b@example.com') throw new Error('Mailgun said no'); mails.push(m); return { id: 'mg-1' }; },
    notify: async (_t, subject, text) => { notes.push({ subject, text }); },
  };
  await C.tick(WED_10AM, 'T', deps);
  assert.deepStrictEqual(mails.map((m) => m.to), ['c@example.com']);
  assert.deepStrictEqual(pool.sends.map((x) => x.status), ['failed', 'failed', 'sent']);
  assert.ok(/- 1 client$/.test(notes[0].subject) && /2 failed/.test(notes[0].text));
});

(async () => {
  for (const run of pending) await run();
  L.__setTestPool(null);
  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})();
