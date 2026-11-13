/**
 * wingguy_inbox "since I last looked" (Guy, 13 Nov 2026) - a full inbox is gone through by what has
 * ARRIVED since the last finished run, not by what is sitting in it.
 * THE RULE under test: when in doubt, show it again. Nothing is ever skipped silently.
 * Run: node tests/wingguy-inbox-since.test.js
 */
const assert = require('assert');
const { runInbox, TOOL_DEFS } = require('../services/wingguyInboxMcp');
const store = require('../services/wingguyInboxStore');

let failed = 0;
async function t(name, fn) {
  try { await fn(); console.log(`ok - ${name}`); } catch (e) { failed++; console.log(`FAIL - ${name}\n  ${e.stack}`); }
}

// The one table, in memory - just enough SQL for the three statements the store sends.
function fakePool() {
  const rows = new Map();
  return {
    rows,
    query: async (sql, p = []) => {
      if (/CREATE TABLE/.test(sql)) return { rows: [] };
      if (/^\s*SELECT flag_at/.test(sql)) return { rows: rows.has(p[0]) ? [rows.get(p[0])] : [] };
      if (/INSERT INTO wingguy_inbox_looked/.test(sql)) {
        const had = rows.get(p[0]) || { flag_at: null, shown: {}, later: [] };
        rows.set(p[0], { ...had, pending: JSON.parse(p[1]) });
        return { rows: [] };
      }
      if (/UPDATE wingguy_inbox_looked/.test(sql)) {
        rows.set(p[0], { flag_at: p[1], pending: null, shown: JSON.parse(p[2]), later: JSON.parse(p[3]) });
        return { rows: [] };
      }
      throw new Error(`unexpected SQL: ${sql.slice(0, 60)}`);
    },
  };
}

const HOUR = 3600 * 1000;
const msg = (id, date, from = 'bob@y.com') => ({ id: `m-${id}`, date, from, to: 'sam@x.com', cc: '', text: `body ${id}`, attachments: [] });
const thread = (id, date) => ({ id, subject: `s-${id}`, count: 1, unread: false, last: msg(id, date) });

/**
 * A fake mailbox. `inbox` = every thread sitting in the inbox (newest first when listed);
 * pageSize = how many one list gives. list(…, { sinceMs }) gives only the ones newer than that.
 */
function fakeMailbox(inbox, { pageSize = 50 } = {}) {
  const calls = [];
  return {
    calls,
    inbox,
    backend: {
      list: async (max, page, opts = {}) => {
        calls.push({ page: page || null, sinceMs: opts.sinceMs || null });
        const all = inbox.filter((x) => !opts.sinceMs || x.last.date > opts.sinceMs).sort((a, b) => b.last.date - a.last.date);
        const from = Number(page) || 0;
        const threads = all.slice(from, from + pageSize);
        const more = from + pageSize < all.length;
        return { threads, more, next: more ? String(from + pageSize) : null, total: opts.sinceMs ? null : all.length };
      },
      read: async (id) => {
        const x = inbox.find((y) => y.id === id);
        return x ? { subject: x.subject, messages: [x.last], inInbox: true } : { subject: '', messages: [], inInbox: false };
      },
    },
  };
}

const deps = (box) => ({
  clientService: { getClientById: async () => ({ clientId: 'Sam-Noble', clientEmailAddress: 'sam@x.com' }), getAllClients: async () => [] },
  mailProvider: {},
  backendOverride: box.backend,
});
const ids = (text) => (text.match(/thread_id=\S+/g) || []).map((x) => x.slice(10));
const list = (box, args = {}) => runInbox({ action: 'list', ...args }, 'Sam-Noble', deps(box));
const done = (box, later = []) => runInbox({ action: 'done', later_thread_ids: later }, 'Sam-Noble', deps(box));

(async () => {
  const realNow = Date.now;
  let now = Date.UTC(2026, 10, 13, 2, 0, 0);
  Date.now = () => now;
  const fresh = () => { const p = fakePool(); store.__setTestPool(p); return p; };
  // 60 old emails, a week old or more - the pile that is never tidied.
  const pile = () => Array.from({ length: 60 }, (_, i) => thread(`old${i}`, now - (7 + i) * 24 * HOUR));

  await t('an inbox that fits in one list is still gone through whole - nothing changes for someone who empties theirs', async () => {
    fresh();
    const box = fakeMailbox([thread('A', now - 30 * 24 * HOUR), thread('B', now - HOUR)]);
    const out = await list(box);
    assert.deepStrictEqual(ids(out.text), ['B', 'A'], 'the month-old one is still shown');
    assert.ok(/^All 2 email thread/m.test(out.text) && !/NEW SINCE YOU LAST LOOKED/.test(out.text), out.text.slice(0, 200));
    assert.strictEqual(box.calls.length, 1, 'one look at the mailbox, as before');
  });

  await t('a full inbox, first time: the last two days only, and it says so - with the older ones on offer this once', async () => {
    fresh();
    const box = fakeMailbox([...pile(), thread('N1', now - HOUR), thread('N2', now - 30 * HOUR), thread('TooOld', now - 72 * HOUR)]);
    const out = await list(box);
    assert.deepStrictEqual(ids(out.text), ['N1', 'N2']);
    assert.ok(/NEW SINCE YOU LAST LOOKED - FIRST TIME/.test(out.text) && /last 2 days/.test(out.text) && /go through all of it/.test(out.text), out.text.slice(0, 400));
    assert.ok(!/NOT THE WHOLE INBOX/.test(out.text), 'no "50 of 180" for someone who is not going to clear it');
  });

  await t('after a finished run, the next one shows only what has arrived since - and "nothing new" is an answer', async () => {
    fresh();
    const box = fakeMailbox([...pile(), thread('N1', now - HOUR)]);
    await list(box);
    const d = await done(box);
    assert.ok(/Marked done/.test(d.text), d.text);
    now += 5 * HOUR;
    const quiet = await list(box);
    assert.ok(/NOTHING NEW since/.test(quiet.text) && ids(quiet.text).length === 0 && /action=done/.test(quiet.text), quiet.text);
    await done(box);
    now += 24 * HOUR;
    box.inbox.push(thread('N2', now - 2 * HOUR), thread('N3', now - HOUR));
    const next = await list(box);
    assert.deepStrictEqual(ids(next.text), ['N3', 'N2'], 'N1 and the pile are not walked over again');
    assert.ok(/NEW SINCE YOU LAST LOOKED \(/.test(next.text) && /2 email thread\(s\) have arrived since/.test(next.text) && /Never mention, count or offer/.test(next.text), next.text.slice(0, 500));
  });

  await t('a run they walked away from moves nothing: the same emails are shown again', async () => {
    fresh();
    const box = fakeMailbox([...pile(), thread('N1', now - HOUR)]);
    await list(box); await done(box);
    now += 24 * HOUR;
    box.inbox.push(thread('N2', now - HOUR));
    assert.deepStrictEqual(ids((await list(box)).text), ['N2']);
    // ...no done. They closed the chat.
    now += 24 * HOUR;
    box.inbox.push(thread('N3', now - HOUR));
    assert.deepStrictEqual(ids((await list(box)).text), ['N3', 'N2'], 'N2 was never finished, so it is back');
  });

  await t('mail that arrives WHILE they are going through it is next time\'s, not lost', async () => {
    fresh();
    const box = fakeMailbox([...pile(), thread('N1', now - HOUR)]);
    await list(box);
    now += HOUR / 2;
    box.inbox.push(thread('During', now - 60 * 1000));   // landed mid-run, never listed
    await done(box);
    now += 10 * HOUR;
    assert.deepStrictEqual(ids((await list(box)).text), ['During']);
  });

  await t('the mail link running behind: an email dated just BEFORE the flag that was not visible then is still picked up - once', async () => {
    fresh();
    const box = fakeMailbox([...pile(), thread('Seen', now - 20 * 60 * 1000)]);
    await list(box); await done(box);
    const flag = now;
    now += 6 * HOUR;
    box.inbox.push(thread('Lagged', flag - 10 * 60 * 1000));   // arrived before the flag, showed up late
    const out = await list(box);
    assert.deepStrictEqual(ids(out.text), ['Lagged'], '"Seen" is inside the look-back hour too but was already shown');
    await done(box);
    now += 10 * 60 * 1000;
    assert.deepStrictEqual(ids((await list(box)).text), [], 'and it is not shown a second time');
  });

  await t('a new reply in a thread already shown brings the thread back', async () => {
    fresh();
    const box = fakeMailbox([...pile(), thread('Chat', now - 20 * 60 * 1000)]);
    await list(box); await done(box);
    now += 30 * 60 * 1000;
    box.inbox.find((x) => x.id === 'Chat').last = msg('Chat2', now - 60 * 1000);
    assert.deepStrictEqual(ids((await list(box)).text), ['Chat']);
  });

  await t('"later" comes back next time however old it is, marked as such, and drops off once it has left the inbox', async () => {
    fresh();
    const box = fakeMailbox([...pile(), thread('Job', now - HOUR), thread('Gone', now - 2 * HOUR)]);
    await list(box);
    const d = await done(box, ['Job', 'Gone', 'Job']);
    assert.ok(/2 kept for next time/.test(d.text), d.text);
    now += 5 * 24 * HOUR;
    box.inbox.splice(box.inbox.findIndex((x) => x.id === 'Gone'), 1);   // they dealt with it themselves
    box.inbox.push(thread('N9', now - HOUR));
    const out = await list(box);
    assert.deepStrictEqual(ids(out.text), ['N9', 'Job']);
    assert.ok(/1 email thread\(s\) have arrived since/.test(out.text) && /PLUS 1 they said "later" to/.test(out.text), out.text.slice(0, 500));
    assert.ok(/thread_id=Job[^\n]*\nLATER FROM LAST TIME/.test(out.text), 'the carried one is labelled');
    await done(box);   // decided this time
    now += HOUR;
    assert.deepStrictEqual(ids((await list(box)).text), [], 'not carried for ever');
  });

  await t('more than 50 new: done after only the first batch does NOT move the flag past the unseen ones', async () => {
    fresh();
    const box = fakeMailbox(pile(), { pageSize: 3 });
    await list(box); await done(box);
    now += 24 * HOUR;
    for (let i = 1; i <= 5; i++) box.inbox.push(thread(`N${i}`, now - i * HOUR));
    const first = await list(box);
    assert.deepStrictEqual(ids(first.text), ['N1', 'N2', 'N3']);
    const tok = first.text.match(/page_token=(\S+)/);
    assert.ok(/NOT ALL OF THE NEW ONES/.test(first.text) && tok && /^3~new:/.test(tok[1]), first.text.slice(0, 600));
    const early = await done(box);
    assert.ok(/marker has not moved/.test(early.text), early.text);
    now += HOUR;
    const again = await list(box);
    assert.deepStrictEqual(ids(again.text), ['N4', 'N5'], 'the two never listed come up; the three already shown do not repeat');
    // And taken properly: batch two carries the numbering on and completes the run.
    fresh();
    const box2 = fakeMailbox(pile(), { pageSize: 3 });
    await list(box2); await done(box2);
    now += 24 * HOUR;
    for (let i = 1; i <= 5; i++) box2.inbox.push(thread(`M${i}`, now - i * HOUR));
    const p1 = await list(box2);
    const p2 = await list(box2, { page_token: p1.text.match(/page_token=(\S+)/)[1] });
    assert.deepStrictEqual(ids(p2.text), ['M4', 'M5']);
    assert.ok(/^\[4\] thread_id=M4/m.test(p2.text), 'numbering carries on');
    assert.ok(/Marked done/.test((await done(box2)).text));
    now += HOUR;
    assert.deepStrictEqual(ids((await list(box2)).text), []);
  });

  await t('they can ask for the older ones (scope=all), or for only-new on a small inbox (scope=new)', async () => {
    fresh();
    const box = fakeMailbox([...pile(), thread('N1', now - HOUR)], { pageSize: 50 });
    await list(box); await done(box);
    now += HOUR;
    const all = await list(box, { scope: 'all' });
    assert.ok(/NOT THE WHOLE INBOX: this is emails 1-50 of 61/.test(all.text) && ids(all.text).length === 50, all.text.slice(0, 200));
    assert.ok(/marker has not moved/.test((await done(box)).text), 'a whole-inbox run that showed 50 of 61 never moves the flag');
    fresh();
    const small = fakeMailbox([thread('A', now - 30 * 24 * HOUR), thread('B', now - HOUR)]);
    assert.deepStrictEqual(ids((await list(small, { scope: 'new' })).text), ['B']);
  });

  await t('done with no run in progress changes nothing; with no database the inbox works as it always did', async () => {
    const p = fresh();
    const box = fakeMailbox([...pile(), thread('N1', now - HOUR)]);
    assert.ok(/Nothing to mark/.test((await done(box)).text));
    assert.strictEqual(p.rows.size, 0);
    store.__setTestPool(null);
    const keep = process.env.DATABASE_URL; delete process.env.DATABASE_URL;
    try {
      const out = await list(box);
      assert.ok(/NOT THE WHOLE INBOX: this is emails 1-50 of 61/.test(out.text), 'no flag to keep = the whole inbox, 50 at a time');
      assert.ok(/Nothing to mark/.test((await done(box)).text));
    } finally { if (keep !== undefined) process.env.DATABASE_URL = keep; }
  });

  await t('the description tells Claude the close, the silence about old mail, and to finish every run with done', async () => {
    const d = TOOL_DEFS[0].description;
    assert.ok(d.includes('NEW SINCE YOU LAST LOOKED:') && d.includes('NEVER mention, count or offer the older emails underneath') && d.includes("That\\'s everything new - you\\'re done.".replace(/\\/g, '')), 'new-mode paragraph');
    assert.ok(d.includes('WHEN YOU FINISH - EVERY RUN') && d.includes('later_thread_ids = the thread_id of EVERY listed email that was not decided') && d.includes('shown twice is fine, never shown is not'), 'done paragraph');
    assert.ok(TOOL_DEFS[0].jsonSchema.properties.action.enum.includes('done') && TOOL_DEFS[0].jsonSchema.properties.scope && TOOL_DEFS[0].jsonSchema.properties.later_thread_ids);
  });

  // ---- The mail link: the date filter, and an Outlook mailbox that does not know "INBOX".
  await t('mail link: "after" goes as an ISO time; a mailbox that answers "no such folder" is asked again by its inbox folder id', async () => {
    const seen = [];
    const json = (o, status = 200) => ({ ok: status < 300, status, text: async () => JSON.stringify(o) });
    const keep = { fetch: global.fetch, k: process.env.UNIPILE_API_KEY, d: process.env.UNIPILE_DSN };
    process.env.UNIPILE_API_KEY = 'k'; process.env.UNIPILE_DSN = 'x.test';
    const coach = { clientId: 'Meagan-Smith', unipileAccountId: 'acc1', emailProvider: 'unipile' };
    try {
      const mail = require('../services/mailProvider');
      global.fetch = async (url) => {
        const u = new URL(url); seen.push(`${u.pathname.split('/').pop()}?folder=${u.searchParams.get('folder') || ''}&after=${u.searchParams.get('after') || ''}`);
        if (/\/folders$/.test(u.pathname)) return json({ items: [{ id: 'f1', name: 'Inbox', role: 'inbox', provider_id: 'AAMk-inbox' }] });
        if (u.searchParams.get('folder') === 'INBOX') return json({ title: 'Folder not found' }, 422);
        return json({ items: [{ id: 'm1', thread_id: 'T1', subject: 'Hi', date: '2026-11-13T01:00:00Z', folders: ['Inbox'] }] });
      };
      const r = await mail.listInbox(coach, { after: Date.UTC(2026, 10, 12, 3, 4, 5) });
      assert.ok(r.ok && r.messages.length === 1, JSON.stringify(r));
      assert.deepStrictEqual(seen, ['emails?folder=INBOX&after=2026-11-12T03:04:05.000Z', 'folders?folder=&after=', 'emails?folder=AAMk-inbox&after=2026-11-12T03:04:05.000Z']);
      // A Gmail mailbox answers first time and is never asked twice; another kind of failure is passed on as it is.
      seen.length = 0;
      global.fetch = async (url) => { seen.push(new URL(url).pathname); return json({ items: [] }); };
      assert.ok((await mail.listInbox(coach, {})).ok && seen.length === 1);
      global.fetch = async () => json({ title: 'gateway timeout' }, 504);
      const bad = await mail.listInbox(coach, {});
      assert.ok(!bad.ok && /504/.test(bad.error));
    } finally {
      global.fetch = keep.fetch;
      for (const [n, v] of [['UNIPILE_API_KEY', keep.k], ['UNIPILE_DSN', keep.d]]) { if (v === undefined) delete process.env[n]; else process.env[n] = v; }
    }
  });

  Date.now = realNow;
  store.__setTestPool(null);
  console.log(failed ? `\n${failed} failed` : '\nall passed');
  process.exit(failed ? 1 : 0);
})();
