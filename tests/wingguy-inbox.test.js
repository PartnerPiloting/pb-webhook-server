/**
 * wingguy_inbox (services/wingguyInboxMcp.js) - reading a message's text, cutting the quoted thread,
 * telling Claude who the sender is, and choosing whose inbox through which connection (Guy: direct
 * Gmail; anyone else: their own mailbox through Wingguy's mail link). Run: node tests/wingguy-inbox.test.js
 */
const assert = require('assert');
const { _test, runInbox, TOOL_DEFS } = require('../services/wingguyInboxMcp');
const { cleanBody, bodyText, senderTags, senderAddress, attachmentNames } = _test;

let failed = 0;
async function t(name, fn) {
  try { await fn(); console.log(`ok - ${name}`); } catch (e) { failed++; console.log(`FAIL - ${name}\n  ${e.message}`); }
}
const b64 = (s) => Buffer.from(s).toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
const guy = { coach: true, own: new Set(['guyralphwilson@gmail.com']), clients: new Map([['roland@gracex.io', 'Roland Illyes']]) };

// A client on Wingguy's mail link, with a fake mailbox: two messages in one thread and one alone.
function fakeClient({ archiveOk = true } = {}) {
  const moved = [];
  const record = { clientId: 'Sam-Noble', clientEmailAddress: 'sam@x.com', unipileAccountId: 'acc1', emailProvider: 'unipile' };
  const inbox = [
    { id: 'm1', threadId: 'T1', subject: 'Lunch?', from: 'Bob <bob@y.com>', to: 'sam@x.com', date: '2026-11-02T01:00:00Z', text: 'Lunch Thursday?', html: '', unread: true, attachments: [] },
    { id: 'm2', threadId: 'T1', subject: 'Lunch?', from: 'Bob <bob@y.com>', to: 'sam@x.com', date: '2026-11-02T03:00:00Z', text: 'Or Friday', html: '', unread: false, attachments: [] },
    { id: 'm3', threadId: 'T2', subject: 'Invoice', from: 'acct@z.com', to: 'sam@x.com', date: '2026-11-01T01:00:00Z', text: '', html: '<p>Pay&nbsp;me</p>', unread: false, attachments: ['inv.pdf'] },
  ];
  const deps = {
    clientService: { getClientById: async (id) => (id === 'Sam-Noble' ? record : null), getAllClients: async () => [] },
    mailProvider: {
      hasMailbox: (r) => !!r.unipileAccountId,
      activeMailProvider: (r) => r.emailProvider,
      listInbox: async () => ({ ok: true, messages: inbox, more: false }),
      threadMessages: async (_r, id) => ({ ok: true, messages: inbox.filter((m) => m.threadId === id) }),
      setThreadInInbox: async (_r, id, inInbox) => {
        if (!archiveOk) return { ok: false, error: 'archiving is not switched on for OUTLOOK mailboxes yet' };
        moved.push([id, inInbox]);
        return { ok: true, subject: 'Lunch?' };
      },
    },
  };
  return { deps, moved };
}

(async () => {
  await t('a reply loses the quoted thread below it', () => {
    const out = cleanBody('Thanks Guy, Thursday works.\n\nOn Mon, 2 Nov 2026 at 9:01 am Guy Wilson <guy@x.com> wrote:\n> Does Thursday suit?\n> Guy');
    assert.strictEqual(out, 'Thanks Guy, Thursday works.');
  });

  await t('text/plain is preferred over HTML', () => {
    const payload = { mimeType: 'multipart/alternative', parts: [
      { mimeType: 'text/html', body: { data: b64('<p>html version</p>') } },
      { mimeType: 'text/plain', body: { data: b64('plain version') } },
    ] };
    assert.strictEqual(bodyText(payload), 'plain version');
  });

  await t('HTML-only mail is made plain', () => {
    const out = bodyText({ mimeType: 'text/html', body: { data: b64('<style>.x{}</style><p>Hi&nbsp;Guy</p><p>Two &amp; three</p>') } });
    assert.ok(/Hi Guy/.test(out) && /Two & three/.test(out) && !/\.x\{\}/.test(out), out);
  });

  await t("Guy's own-system senders are flagged as snapshots to check live", () => {
    const tags = senderTags('guy <guy@knowaguy.com.au>', 'guyralphwilson@gmail.com', guy);
    assert.ok(tags.some((x) => /own system/.test(x) && /check/.test(x)), tags.join('; '));
  });

  await t('to a client, the same sender is just Guy / Wingguy', () => {
    const tags = senderTags('guy <guy@knowaguy.com.au>', 'sam@x.com', { coach: false, own: new Set(['sam@x.com']), clients: new Map() });
    assert.deepStrictEqual(tags, ['from Guy / Wingguy']);
  });

  await t('a mail sent to yourself is flagged', () => {
    const tags = senderTags('Guy Wilson <guyralphwilson@gmail.com>', 'guyralphwilson@gmail.com', guy);
    assert.ok(tags.some((x) => /to yourself/.test(x)), tags.join('; '));
  });

  await t('your own email to someone else is marked as yours', () => {
    const tags = senderTags('Guy Wilson <guyralphwilson@gmail.com>', 'Jeremiah <j@x.com>', guy);
    assert.ok(tags.some((x) => /your own email to Jeremiah/.test(x)), tags.join('; '));
  });

  await t('a client is named by their record email', () => {
    const tags = senderTags('Roland <Roland@GraceX.io>', 'guyralphwilson@gmail.com', guy);
    assert.deepStrictEqual(tags, ['from your client Roland Illyes']);
    assert.strictEqual(senderAddress('Roland <Roland@GraceX.io>'), 'roland@gracex.io');
  });

  await t('inline signature images are not listed as attachments', () => {
    const names = attachmentNames({ parts: [{ filename: 'image.png' }, { filename: 'image001.jpg' }, { filename: '2026 Queries.xlsx' }] });
    assert.deepStrictEqual(names, ['2026 Queries.xlsx']);
  });

  await t("a client's inbox comes through Wingguy's mail link, one line per thread, newest first", async () => {
    const { deps } = fakeClient();
    const out = await runInbox({ action: 'list' }, 'Sam-Noble', deps);
    assert.ok(!out.isError, out.text);
    assert.ok(/^All 2 email thread/.test(out.text), out.text);
    assert.ok(!/NOT THE WHOLE INBOX/.test(out.text), 'everything fitted - no warning');
    assert.ok(out.text.indexOf('thread_id=T1') < out.text.indexOf('thread_id=T2'), 'newest thread first');
    assert.ok(/thread_id=T1 .*\| UNREAD \| 2 messages/.test(out.text), 'thread shows unread + count');
    assert.ok(/Text: Or Friday/.test(out.text), 'shows the newest message');
    assert.ok(/Text: Pay me/.test(out.text) && /Attachments: inv.pdf/.test(out.text), 'HTML made plain, attachment listed');
  });

  // Guy, 2 Nov: with 50 at a time, someone with 180 emails could think all 180 had been gone through.
  await t('a big inbox says up front how much there is and how much this covers, and the next batch carries on', async () => {
    const pages = [];
    const backend = {
      list: async (max, page) => {
        pages.push(page);
        const mk = (i) => ({ id: `T${i}`, subject: `s${i}`, count: 1, unread: false,
          last: { date: Date.UTC(2026, 10, 2) - i * 60000, from: 'a@b.com', to: 'me@x.com', text: 't', attachments: [] } });
        if (!page) return { threads: [1, 2].map(mk), more: true, next: 'P2', total: 180 };
        return { threads: [3].map(mk), more: false, next: null, total: 180 };
      },
    };
    const deps = {
      clientService: { getClientById: async () => ({ clientId: 'Sam-Noble', unipileAccountId: 'a', emailProvider: 'unipile' }), getAllClients: async () => [] },
      mailProvider: { hasMailbox: () => true, activeMailProvider: () => 'unipile' },
      backendOverride: backend,
    };
    const first = await runInbox({ action: 'list', max: 2 }, 'Sam-Noble', deps);
    assert.ok(/^NOT THE WHOLE INBOX: this is emails 1-2 of 180/.test(first.text), first.text.slice(0, 120));
    assert.ok(/You have 180 emails in your inbox - this covers the newest 2/.test(first.text), 'tells Claude what to say first');
    assert.ok(/page_token=2~P2/.test(first.text), 'hands over the next batch');
    const second = await runInbox({ action: 'list', max: 2, page_token: '2~P2' }, 'Sam-Noble', deps);
    assert.deepStrictEqual(pages, [null, 'P2']);
    assert.ok(/emails 3-3 of 180/.test(second.text) && /\[3\] thread_id=T3/.test(second.text), 'numbering carries on');
    assert.ok(/This is the last batch/.test(second.text));
  });

  await t('the description makes Claude say when it has not covered the whole inbox', () => {
    assert.ok(/NOT THE WHOLE INBOX: the list comes 50 at a time/.test(TOOL_DEFS[0].description));
  });

  await t('a client can archive and restore their own thread', async () => {
    const { deps, moved } = fakeClient();
    const out = await runInbox({ action: 'archive', thread_ids: ['T1'] }, 'Sam-Noble', deps);
    assert.ok(/Archived 1/.test(out.text) && /Nothing was deleted/.test(out.text), out.text);
    await runInbox({ action: 'restore', thread_ids: ['T1'] }, 'Sam-Noble', deps);
    assert.deepStrictEqual(moved, [['T1', false], ['T1', true]]);
  });

  await t('where archiving is not switched on, it says so and changes nothing', async () => {
    const { deps } = fakeClient({ archiveOk: false });
    const out = await runInbox({ action: 'archive', thread_ids: ['T1'] }, 'Sam-Noble', deps);
    assert.ok(out.isError && /not switched on for OUTLOOK/.test(out.text), out.text);
  });

  await t('someone with no mailbox connected gets a plain answer', async () => {
    const { deps } = fakeClient();
    const out = await runInbox({ action: 'list' }, 'Nobody-Here', deps);
    assert.ok(out.isError && /isn't connected to Wingguy yet/.test(out.text), out.text);
  });

  await t('Guy goes through the direct Gmail connection, not the mail link', async () => {
    const prev = process.env.GMAIL_REFRESH_TOKEN;
    process.env.GMAIL_REFRESH_TOKEN = 'x';
    let used = '';
    const deps = {
      clientService: { getClientById: async () => ({ clientId: 'Guy-Wilson', unipileAccountId: 'g', emailProvider: 'unipile' }), getAllClients: async () => [] },
      mailProvider: { hasMailbox: () => true, activeMailProvider: () => 'unipile', listInbox: async () => { used = 'link'; return { ok: true, messages: [] }; } },
      gmailBackend: () => ({ list: async () => { used = 'gmail'; return { threads: [], more: false }; } }),
    };
    await runInbox({ action: 'list' }, 'Guy-Wilson', deps);
    if (prev === undefined) delete process.env.GMAIL_REFRESH_TOKEN; else process.env.GMAIL_REFRESH_TOKEN = prev;
    assert.strictEqual(used, 'gmail');
  });

  // A per-person instruction list held in memory, shaped like services/wingguyInboxStore.js.
  function fakeStore() {
    const rows = [];
    return {
      rows,
      listInstructions: async (tenant) => rows.filter((r) => r.tenant === tenant && !r.retired),
      addInstruction: async (tenant, body) => {
        const same = rows.find((r) => r.tenant === tenant && !r.retired && r.body.toLowerCase() === body.toLowerCase());
        if (same) return { ...same, duplicate: true };
        const row = { id: rows.length + 1, tenant, body };
        rows.push(row);
        return row;
      },
      retireInstruction: async (tenant, id) => {
        const r = rows.find((x) => x.id === id && x.tenant === tenant && !x.retired);
        if (!r) return null;
        r.retired = true;
        return r.body;
      },
    };
  }

  await t('a standing instruction is saved, shown at the top of the next list, and can be forgotten', async () => {
    const { deps } = fakeClient();
    deps.inboxStore = fakeStore();
    const saved = await runInbox({ action: 'remember', text: 'Always clear LinkedIn notifications' }, 'Sam-Noble', deps);
    assert.ok(/Saved as inbox instruction \[1\]/.test(saved.text), saved.text);
    const again = await runInbox({ action: 'remember', text: 'always clear linkedin notifications' }, 'Sam-Noble', deps);
    assert.ok(/Already one of your inbox instructions/.test(again.text), again.text);
    const list = await runInbox({ action: 'list' }, 'Sam-Noble', deps);
    assert.ok(/^THEIR STANDING INBOX INSTRUCTIONS/.test(list.text) && /\[1\] Always clear LinkedIn notifications/.test(list.text), list.text);
    const gone = await runInbox({ action: 'forget', instruction_id: 1 }, 'Sam-Noble', deps);
    assert.ok(/Forgotten: \[1\]/.test(gone.text), gone.text);
    const after = await runInbox({ action: 'list' }, 'Sam-Noble', deps);
    assert.ok(!/STANDING INBOX INSTRUCTIONS/.test(after.text), 'gone from the list');
  });

  await t("one person cannot forget another person's instruction", async () => {
    const store = fakeStore();
    await store.addInstruction('Guy-Wilson', 'Always flag the accountant');
    const out = await runInbox({ action: 'forget', instruction_id: 1 }, 'Sam-Noble', { inboxStore: store });
    assert.ok(out.isError && /no inbox instruction \[1\] of yours/.test(out.text), out.text);
    assert.strictEqual((await store.listInstructions('Guy-Wilson')).length, 1);
  });

  await t('with no database, the inbox still lists and simply has no instructions', async () => {
    const prev = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    assert.deepStrictEqual(await require('../services/wingguyInboxStore').listInstructions('Sam-Noble'), []);
    if (prev !== undefined) process.env.DATABASE_URL = prev;
  });

  await t('the description has Claude offer record fixes from emails, only on their yes', () => {
    const d = TOOL_DEFS[0].description;
    assert.ok(/FIX THE RECORD/.test(d) && /wingguy_update_lead/.test(d) && /Never change a record without their yes/.test(d));
  });

  // Guy, 2 Nov: Michael Spicer wrote personally ("escaped the salt mines") and would have been
  // archived as Worth knowing, unanswered. A person's email never goes without their say-so.
  await t('piles use the names clients were told, and a personal email gets a quick thanks, never Can go', () => {
    const d = TOOL_DEFS[0].description;
    assert.ok(/use Needs you \(the jobs\), Worth knowing and Can go \(the easy clear\)/.test(d), 'the three names');
    assert.ok(!/\bNOTED\b/.test(d) && !/\d\. CLEAR -/.test(d), 'the old names are gone');
    assert.ok(/QUICK THANKS/.test(d) && /NEVER in the easy clear/.test(d), 'quick thanks rule');
    assert.ok(/Archive it only after they have decided/.test(d));
    assert.ok(/reply_to_message_id/.test(d) && /wingguy_create_draft/.test(d), 'replies draft into the thread');
  });

  await t('every listed email carries the id a threaded reply needs', async () => {
    const { deps } = fakeClient();
    const out = await runInbox({ action: 'list' }, 'Sam-Noble', deps);
    assert.ok(/To reply: reply_to_message_id=m2/.test(out.text), 'newest message of T1');
    assert.ok(/To reply: reply_to_message_id=m3/.test(out.text));
  });

  await t('the description says archive only on their yes, check live, and use this for the inbox', () => {
    const d = TOOL_DEFS[0].description;
    assert.ok(/only the thread_ids they have said yes to/.test(d));
    assert.ok(/CHECK EVERY JOB LIVE/.test(d) && /Never pass on a job with "I haven't checked"/.test(d), 'live check is a must');
    assert.ok(/Use THIS for their inbox, not any other email connector/.test(d));
    assert.ok(!/—|–/.test(d), 'no em or en dash');
  });

  // Guy, 2 Nov: a 13-item answer was "still a bit overwhelming - it should be one at a time".
  await t('the walk-through is one thing at a time: one line, the easy clear, then one job per message', () => {
    const d = TOOL_DEFS[0].description;
    assert.ok(/ONE THING AT A TIME - THIS IS THE WHOLE POINT/.test(d));
    assert.ok(/1\. ONE LINE/.test(d) && /2\. THE EASY CLEAR/.test(d) && /3\. THE JOBS, ONE PER MESSAGE/.test(d) && /4\. AT THE END/.test(d), 'the order');
    assert.ok(/Never show the next job in the same message/.test(d));
    assert.ok(/"Later" leaves the email in the inbox/.test(d));
    assert.ok(/That's your inbox done/.test(d));
    // Guy, 2 Nov: Kay was offered a second welcome-back - a person is checked in the real mailbox
    assert.ok(d.includes('call wingguy_lead_correspondence'), 'person jobs checked in the mailbox');
    assert.ok(!d.includes('wingguy_dossier / wingguy_lead_history for a person'), 'never the ledger as the person check');
    const lh = require('../services/wingguyMailMcp').TOOL_DEFS?.find?.(x => x.name === 'wingguy_lead_history');
    if (lh) assert.ok(/NOT a record of the emails/.test(lh.description), 'lead_history says it is not the mailbox');
    // Guy, 2 Nov: "Clear them?" alone - a person can't tell their own things are left alone
    assert.ok(d.includes('"Type yes to clear these 7. Then I\'ll take you through your 5 things, one at a time."'), 'the clear question says what happens next');
    assert.ok(d.includes('the two numbers must add up to the total'), 'the count adds up');
  });

  // Guy, 2 Nov: "this doesn't give an option for how or what to do with Michael" - and in a chat
  // nothing can be clicked, so the choices are numbers that belong to the one job on screen.
  await t('every job ends with numbered choices, quick thanks never says "send", housekeeping stays out', () => {
    const d = TOOL_DEFS[0].description;
    assert.ok(/Then the CHOICES, numbered/.test(d) && /always ending with Later/.test(d) && /Type a number/.test(d));
    assert.ok(/the numbers only ever belong to the job on screen/.test(d));
    assert.ok(/1 Put it in my Drafts/.test(d) && /2 Change it/.test(d) && /3 No reply needed/.test(d));
    assert.ok(/THEY press send; Wingguy never sends, so never say "send"/.test(d));
    assert.ok(/NEVER make a job of Claude's own housekeeping/.test(d));
    assert.ok(/never just "go and do it"/.test(d));
  });

  await t('Open in Gmail: the link Gmail itself uses, only for Gmail ids, with the right login for Guy', async () => {
    const { gmailThreadLink } = require('../services/wingguyInboxMcp')._test;
    // The accountant's thread: Gmail's own connector returned 1a19ad6c0922ab7e for 1a19ad6c0922ab7e.
    assert.strictEqual(gmailThreadLink('1a19ad6c0922ab7e', 'guyralphwilson@gmail.com'),
      'https://mail.google.com/mail/?authuser=guyralphwilson%40gmail.com#all/1a19ad6c0922ab7e');
    assert.strictEqual(gmailThreadLink('1a19ad6c0922ab7e'), 'https://mail.google.com/mail/#all/1a19ad6c0922ab7e');
    assert.strictEqual(gmailThreadLink('AAQkAGI2TG93AAA='), null, 'an Outlook id gets no link');
    const prev = process.env.GMAIL_REFRESH_TOKEN;
    const deps = {
      clientService: { getClientById: async () => ({ clientId: 'Guy-Wilson' }), getAllClients: async () => [] },
      mailProvider: { hasMailbox: () => true, activeMailProvider: () => 'unipile' },
      backendOverride: { list: async () => ({ threads: [{ id: '1a19ad6c0922ab7e', subject: 'q', count: 1, unread: false,
        last: { id: 'm', date: 0, from: 'a@b.com', to: 'x', text: 't', attachments: [] } }], more: false, total: 1 }) },
    };
    const out = await runInbox({ action: 'list' }, 'Guy-Wilson', deps);
    if (prev === undefined) delete process.env.GMAIL_REFRESH_TOKEN; else process.env.GMAIL_REFRESH_TOKEN = prev;
    assert.ok(/Open in Gmail: https:\/\/mail\.google\.com\/mail\/\?authuser=guyralphwilson%40gmail\.com#all\/1a19ad6c0922ab7e/.test(out.text), out.text);
  });

  // Guy, 4 Nov 2026: Laura's 5-message Wilfreed thread opened her 27 Oct email, not the 4 Nov one -
  // a thread id is its FIRST message's id. The link must name the newest message.
  await t('Open in Gmail: a thread with several messages links its NEWEST message, not the first', async () => {
    const prev = process.env.GMAIL_REFRESH_TOKEN;
    const deps = {
      clientService: { getClientById: async () => ({ clientId: 'Guy-Wilson' }), getAllClients: async () => [] },
      mailProvider: { hasMailbox: () => true, activeMailProvider: () => 'unipile' },
      backendOverride: { list: async () => ({ threads: [{ id: '1a17ab64decdd015', subject: 'Fw: Wilfreed Super Fund', count: 5, unread: true,
        last: { id: '1a1a432842b8f09a', date: 0, from: 'a@b.com', to: 'x', text: 't', attachments: [] } }], more: false, total: 1 }) },
    };
    const out = await runInbox({ action: 'list' }, 'Guy-Wilson', deps);
    if (prev === undefined) delete process.env.GMAIL_REFRESH_TOKEN; else process.env.GMAIL_REFRESH_TOKEN = prev;
    assert.ok(/Open in Gmail: [^\n]*#all\/1a1a432842b8f09a/.test(out.text), out.text);
    assert.ok(!/#all\/1a17ab64decdd015/.test(out.text), 'never the thread (first-message) id');
  });

  // Guy, 2 Nov 2026: his own emails waiting for approval come up in an inbox run - even an empty one.
  await t("Guy's own emails waiting for his OK are listed on the first page, even when the inbox is empty", async () => {
    const mk = (threads) => ({ list: async () => ({ threads, more: false, next: null, total: threads.length }) });
    const one = { id: 'T1', subject: 's', count: 1, unread: false, last: { date: Date.UTC(2026, 10, 2), from: 'a@b.com', to: 'me@x.com', text: 't', attachments: [] } };
    const base = {
      clientService: { getClientById: async (id) => ({ clientId: id, unipileAccountId: 'a', emailProvider: 'unipile' }), getAllClients: async () => [] },
      mailProvider: { hasMailbox: () => true, activeMailProvider: () => 'unipile' },
      approvals: async () => ['Weekly client email to Roland Illyes for Wednesday 4 Nov - not approved yet'],
    };
    const empty = await runInbox({ action: 'list' }, 'Guy-Wilson', { ...base, backendOverride: mk([]) });
    assert.ok(/YOUR OWN EMAILS WAITING FOR YOUR OK \(1\)/.test(empty.text) && /Roland Illyes/.test(empty.text) && /Your inbox is empty/.test(empty.text), empty.text);
    const full = await runInbox({ action: 'list' }, 'Guy-Wilson', { ...base, backendOverride: mk([one]) });
    assert.ok(/YOUR OWN EMAILS WAITING FOR YOUR OK/.test(full.text) && /thread_id=T1/.test(full.text), 'alongside the inbox');
    const later = await runInbox({ action: 'list', page_token: '50~P2' }, 'Guy-Wilson', { ...base, backendOverride: mk([one]) });
    assert.ok(!/WAITING FOR YOUR OK/.test(later.text), 'not repeated on the next batch');
    const client = await runInbox({ action: 'list' }, 'Sam-Noble', { ...base, backendOverride: mk([one]) });
    assert.ok(!/WAITING FOR YOUR OK/.test(client.text), 'a client never sees it');
    const broken = await runInbox({ action: 'list' }, 'Guy-Wilson', { ...base, approvals: async () => { throw new Error('db down'); }, backendOverride: mk([one]) });
    assert.ok(/thread_id=T1/.test(broken.text) && !/WAITING FOR YOUR OK/.test(broken.text), 'a failing check never hides the inbox');
    const d = TOOL_DEFS[0].description;
    assert.ok(d.includes('YOUR OWN EMAILS WAITING (only when') && d.includes('when the inbox is empty, straight after "Your inbox is clear."') && d.includes('Approve, change, skip or cancel ONLY on their number'), 'the description asks at the end, one at a time');
  });

  // ---- Outlook: an email sits in ONE folder, so archive is a move, not a label coming off.
  // A fake of Wingguy's mail link (Unipile) behind global.fetch. `moves` is how the fake mailbox
  // behaves: 'thread' = one PUT carries the whole conversation, 'one' = one message per PUT,
  // 'lag' = it says yes and the read-back never changes.
  function fakeLink({ type = 'OUTLOOK', moves = 'thread', archiveFolder = true } = {}) {
    const msgs = [
      { id: 'm1', thread_id: 'T1', subject: 'Lunch?', date: '2026-11-02T01:00:00Z', folders: ['Inbox'] },
      { id: 'm2', thread_id: 'T1', subject: 'Lunch?', date: '2026-11-02T03:00:00Z', folders: ['Inbox'] },
      { id: 's1', thread_id: 'T1', subject: 'Lunch?', date: '2026-11-02T02:00:00Z', folders: [type === 'GOOGLE_OAUTH' ? 'SENT' : 'Sent Items'] },
    ];
    if (type === 'GOOGLE_OAUTH') { msgs[0].folders = ['INBOX', 'CATEGORY_PERSONAL']; msgs[1].folders = ['INBOX']; }
    const puts = [];
    const json = (o, status = 200) => ({ ok: status < 300, status, text: async () => JSON.stringify(o) });
    const fetchFake = async (url, opts = {}) => {
      const u = new URL(url);
      if ((opts.method || 'GET') === 'PUT') {
        const id = decodeURIComponent(u.pathname.split('/').pop());
        const body = JSON.parse(opts.body);
        puts.push([id, body.folders]);
        const from = (msgs.find((x) => x.id === id) || { folders: [] }).folders[0];
        if (moves !== 'lag') for (const m of msgs) if (m.id === id || (moves === 'thread' && type !== 'GOOGLE_OAUTH' && m.folders[0] === from)) m.folders = body.folders.slice();
        return json({ object: 'EmailUpdated' });
      }
      if (/\/accounts\//.test(u.pathname)) return json({ type });
      if (/\/folders$/.test(u.pathname)) return json({ items: [{ id: 'f1', name: 'Inbox', role: 'inbox', provider_id: 'p1' }, { id: 'f3', name: 'Sent Items', role: 'sent', provider_id: 'p3' }].concat(archiveFolder ? [{ id: 'f2', name: 'Archive', role: archiveFolder === 'untagged' ? null : 'archive', provider_id: 'p2' }] : []) });
      if (/\/emails$/.test(u.pathname)) return json({ items: msgs.filter((m) => m.thread_id === u.searchParams.get('thread_id')) });
      return json({}, 404);
    };
    return { fetchFake, puts, msgs };
  }
  async function withLink(link, allow, fn) {
    const keep = { fetch: global.fetch, k: process.env.UNIPILE_API_KEY, d: process.env.UNIPILE_DSN, a: process.env.INBOX_FOLDER_ARCHIVE_CLIENTS };
    global.fetch = link.fetchFake; process.env.UNIPILE_API_KEY = 'k'; process.env.UNIPILE_DSN = 'x.test';
    if (allow === null) delete process.env.INBOX_FOLDER_ARCHIVE_CLIENTS; else process.env.INBOX_FOLDER_ARCHIVE_CLIENTS = allow;
    try { return await fn(require('../services/mailProvider')); } finally {
      global.fetch = keep.fetch;
      for (const [n, v] of [['UNIPILE_API_KEY', keep.k], ['UNIPILE_DSN', keep.d], ['INBOX_FOLDER_ARCHIVE_CLIENTS', keep.a]]) { if (v === undefined) delete process.env[n]; else process.env[n] = v; }
    }
  }
  const roland = { clientId: 'Roland-Illyes', unipileAccountId: 'acc1', emailProvider: 'unipile' };

  await t('Outlook: archive stays refused, and nothing is touched, until the client is named in INBOX_FOLDER_ARCHIVE_CLIENTS', async () => {
    for (const allow of [null, '', 'Sam-Noble']) {
      const link = fakeLink();
      const r = await withLink(link, allow, (mail) => mail.setThreadInInbox(roland, 'T1', false));
      assert.ok(!r.ok && /not switched on for OUTLOOK/.test(r.error), JSON.stringify(r));
      assert.strictEqual(link.puts.length, 0, 'no move was attempted');
    }
  });

  await t('Outlook: archive MOVES the inbox emails to the Archive folder by name, leaves Sent alone, and is confirmed by reading back', async () => {
    const link = fakeLink({ moves: 'thread' });
    const r = await withLink(link, 'sam-noble, roland-illyes', (mail) => mail.setThreadInInbox(roland, 'T1', false));
    assert.ok(r.ok && !r.unconfirmed && r.folder === 'Archive', JSON.stringify(r));
    assert.deepStrictEqual(link.puts, [['m1', ['Archive']]], 'one move carried the conversation - the second was not sent blind');
    assert.deepStrictEqual(link.msgs.map((m) => m.folders[0]), ['Archive', 'Archive', 'Sent Items']);
  });

  await t('Outlook: when a move carries only one email, the rest are moved too', async () => {
    const link = fakeLink({ moves: 'one' });
    const r = await withLink(link, 'all', (mail) => mail.setThreadInInbox(roland, 'T1', false));
    assert.ok(r.ok && !r.unconfirmed && r.moved === 2, JSON.stringify(r));
    assert.deepStrictEqual(link.puts.map((x) => x[0]), ['m1', 'm2']);
  });

  await t('Outlook: restore puts the newest archived email back in the Inbox', async () => {
    const link = fakeLink({ moves: 'one' });
    await withLink(link, 'all', (mail) => mail.setThreadInInbox(roland, 'T1', false));
    link.puts.length = 0;
    const r = await withLink(link, 'all', (mail) => mail.setThreadInInbox(roland, 'T1', true));
    assert.ok(r.ok && !r.unconfirmed && r.folder === 'Inbox', JSON.stringify(r));
    assert.deepStrictEqual(link.puts, [['m2', ['Inbox']]]);
    const none = await withLink(fakeLink(), 'all', (mail) => mail.setThreadInInbox(roland, 'T1', true));
    assert.ok(none.ok && none.moved === 0, 'already in the inbox = nothing to do');
  });

  await t('Outlook: a move the read-back cannot see is NOT reported as done', async () => {
    const link = fakeLink({ moves: 'lag' });
    const r = await withLink(link, 'all', (mail) => mail.setThreadInInbox(roland, 'T1', false));
    assert.ok(r.ok && r.unconfirmed === true, JSON.stringify(r));
    assert.strictEqual(link.puts.length, 2, 'each email tried once, never in a loop');
    const { deps } = fakeClient();
    deps.mailProvider.setThreadInInbox = async () => ({ ok: true, subject: 'Lunch?', unconfirmed: true });
    const out = await runInbox({ action: 'archive', thread_ids: ['T1'] }, 'Sam-Noble', deps);
    assert.ok(/NOT CONFIRMED/.test(out.text) && !/Archived 1/.test(out.text) && /Nothing was deleted/.test(out.text), out.text);
  });

  await t('Outlook: a mailbox with no Archive folder is left alone', async () => {
    const link = fakeLink({ archiveFolder: false });
    const r = await withLink(link, 'all', (mail) => mail.setThreadInInbox(roland, 'T1', false));
    assert.ok(!r.ok && /Archive folder/.test(r.error) && /nothing was changed/.test(r.error), JSON.stringify(r));
    assert.strictEqual(link.puts.length, 0);
  });

  await t('Outlook: no Archive folder = plain directions on how to get one, not a bare "could not find"', async () => {
    const r = await withLink(fakeLink({ archiveFolder: false }), 'all', (mail) => mail.setThreadInInbox(roland, 'T1', false));
    assert.ok(/press Archive once/.test(r.error) && /folder called exactly Archive/.test(r.error) && /Then ask again/.test(r.error), r.error);
  });

  await t('Outlook: an Archive folder the mail link has not tagged is still found, by its name', async () => {
    const link = fakeLink({ archiveFolder: 'untagged' });
    const r = await withLink(link, 'all', (mail) => mail.setThreadInInbox(roland, 'T1', false));
    assert.ok(r.ok && !r.unconfirmed && r.folder === 'Archive', JSON.stringify(r));
    assert.deepStrictEqual(link.msgs.map((m) => m.folders[0]), ['Archive', 'Archive', 'Sent Items']);
  });

  await t('can this mailbox clear? - answered once, without touching an email', async () => {
    const ask = async (opts, allow) => { const link = fakeLink(opts); const r = await withLink(link, allow, (mail) => mail.archiveReadiness(roland)); assert.strictEqual(link.puts.length, 0); return r; };
    assert.deepStrictEqual(await ask({}, 'all'), { ok: true, ready: true });
    assert.deepStrictEqual(await ask({ type: 'GOOGLE_OAUTH' }, null), { ok: true, ready: true });
    const none = await ask({ archiveFolder: false }, 'all');
    assert.ok(none.ok && none.ready === false && none.why === 'no_archive_folder' && /press Archive once/.test(none.message), JSON.stringify(none));
    const off = await ask({}, null);
    assert.ok(off.ok && off.ready === false && off.why === 'off' && /not switched on for OUTLOOK/.test(off.message), JSON.stringify(off));
  });

  await t('a mailbox that cannot clear says so at the TOP of the list, and a clear is refused once - not once per email', async () => {
    const { deps, moved } = fakeClient();
    deps.mailProvider.archiveReadiness = async () => ({ ok: true, ready: false, why: 'no_archive_folder', message: 'this mailbox has no Archive folder yet, so nothing was changed. To fix it: press Archive once.' });
    const list = await runInbox({ action: 'list' }, 'Sam-Noble', deps);
    assert.ok(!list.isError && /thread_id=T1/.test(list.text), 'the inbox is still listed');
    assert.ok(list.text.indexOf('CLEARING WILL NOT WORK') > -1 && list.text.indexOf('CLEARING WILL NOT WORK') < list.text.indexOf('thread_id=T1'), 'said before the emails');
    assert.ok(/press Archive once/.test(list.text) && /do NOT offer to clear/.test(list.text), list.text);
    const out = await runInbox({ action: 'archive', thread_ids: ['T1', 'T2'] }, 'Sam-Noble', deps);
    assert.ok(out.isError && (out.text.match(/no Archive folder/g) || []).length === 1 && /nothing was moved/.test(out.text), out.text);
    assert.strictEqual(moved.length, 0, 'no move was attempted');
    // A mailbox that CAN clear hears nothing about it, and a check that breaks never hides the inbox.
    deps.mailProvider.archiveReadiness = async () => ({ ok: true, ready: true });
    assert.ok(!/CLEARING WILL NOT WORK/.test((await runInbox({ action: 'list' }, 'Sam-Noble', deps)).text));
    deps.mailProvider.archiveReadiness = async () => { throw new Error('link down'); };
    const broken = await runInbox({ action: 'list' }, 'Sam-Noble', deps);
    assert.ok(/thread_id=T1/.test(broken.text) && !/CLEARING WILL NOT WORK/.test(broken.text), broken.text);
    await runInbox({ action: 'archive', thread_ids: ['T1'] }, 'Sam-Noble', deps);
    assert.strictEqual(moved.length, 1, 'a broken check does not block the move - the move has its own guards');
  });

  await t('Gmail is untouched by all this: still the INBOX label coming off, other labels kept, no list needed', async () => {
    const link = fakeLink({ type: 'GOOGLE_OAUTH' });
    const r = await withLink(link, null, (mail) => mail.setThreadInInbox(roland, 'T1', false));
    assert.ok(r.ok && r.moved === 2, JSON.stringify(r));
    assert.deepStrictEqual(link.puts, [['m1', ['CATEGORY_PERSONAL']], ['m2', []]]);
  });

  await t('IMAP and anything else stay refused even with the list set to all', async () => {
    const link = fakeLink({ type: 'MAIL' });
    const r = await withLink(link, 'all', (mail) => mail.setThreadInInbox(roland, 'T1', false));
    assert.ok(!r.ok && /not switched on for MAIL/.test(r.error) && link.puts.length === 0, JSON.stringify(r));
  });

  // Guy, 13 Nov 2026: a Fathom recap of his call with Simon Steele was shown with "Nothing has gone
  // to him since" - he had emailed Simon at 2:44pm. The list now reads sent mail itself.
  const simonSent = { date: Date.parse('2026-11-13T04:44:05Z'), subject: 'Something to share with the Squad team',
    people: [{ name: 'Simon Steele', email: 'simon@simonsteele.com.au' }] };
  const recap = { id: 'T9', subject: 'Recap for "Simon Steele & Guy Wilson"', count: 1, unread: false,
    last: { id: 'm9', date: Date.parse('2026-11-12T22:30:00Z'), from: 'Fathom <no-reply@fathom.video>', to: 'guyralphwilson@gmail.com',
      text: 'Simon will come back on Thu 3 December.', attachments: [] } };
  const sentDeps = (sentSince) => ({
    clientService: { getClientById: async () => ({ clientId: 'Guy-Wilson' }), getAllClients: async () => [] },
    mailProvider: { hasMailbox: () => true, activeMailProvider: () => 'unipile' },
    approvals: async () => [],
    backendOverride: { list: async () => ({ threads: [recap], more: false, total: 1 }),
      read: async () => ({ subject: recap.subject, messages: [recap.last] }), ...(sentSince ? { sentSince } : {}) },
  });

  await t('addresses are read out of a To line, quoted commas and all', () => {
    assert.deepStrictEqual(_test.parseAddressList('Simon Steele <Simon@SimonSteele.com.au>, "Ng, Amy" <amy@y.com>, bare@z.com'), [
      { name: 'Simon Steele', email: 'simon@simonsteele.com.au' }, { name: 'Amy Ng', email: 'amy@y.com' }, { name: '', email: 'bare@z.com' }]);
  });

  await t('a call recap that names someone already emailed says so, on the list and on read', async () => {
    const deps = sentDeps(async () => ({ sent: [simonSent], truncated: false }));
    const list = await runInbox({ action: 'list' }, 'Guy-Wilson', deps);
    assert.ok(/SENT MAIL CHECKED/.test(list.text), list.text);
    assert.ok(/YOU HAVE WRITTEN SINCE THIS EMAIL ARRIVED: to Simon Steele <simon@simonsteele\.com\.au> on Fri,? 13 Nov,? 2:44 pm - "Something to share with the Squad team"/i.test(list.text), list.text);
    const read = await runInbox({ action: 'read', thread_id: 'T9' }, 'Guy-Wilson', deps);
    assert.ok(/YOU HAVE WRITTEN SINCE THIS EMAIL ARRIVED: to Simon Steele/.test(read.text), read.text);
  });

  await t('mail sent BEFORE the email, to someone else, or only to yourself is not claimed', () => {
    const email = { date: recap.last.date, from: ['no-reply@fathom.video'], text: `${recap.subject}\n${recap.last.text}` };
    const own = new Set(['guyralphwilson@gmail.com']);
    assert.strictEqual(_test.writtenSince(email, [{ ...simonSent, date: recap.last.date - 1000 }], own).length, 0, 'sent before');
    assert.strictEqual(_test.writtenSince(email, [{ ...simonSent, people: [{ name: 'Simone Steeleman', email: 'x@y.com' }] }], own).length, 0, 'near-miss name');
    assert.strictEqual(_test.writtenSince(email, [{ ...simonSent, people: [{ name: 'Guy Wilson', email: 'guyralphwilson@gmail.com' }] }], own).length, 0, 'own address');
    assert.strictEqual(_test.writtenSince({ ...email, from: ['simon@simonsteele.com.au'], text: 'hi' }, [{ ...simonSent, people: [{ name: '', email: 'simon@simonsteele.com.au' }] }], own).length, 1, 'by sender address');
  });

  await t('when sent mail cannot be read the list says so instead of staying silent', async () => {
    const none = await runInbox({ action: 'list' }, 'Guy-Wilson', sentDeps(null));
    assert.ok(/SENT MAIL NOT CHECKED/.test(none.text) && !/YOU HAVE WRITTEN SINCE THIS EMAIL ARRIVED: to/.test(none.text), none.text);
    const broke = await runInbox({ action: 'list' }, 'Guy-Wilson', sentDeps(async () => { throw new Error('quota'); }));
    assert.ok(/SENT MAIL NOT CHECKED \(quota\)/.test(broke.text) && /Recap for/.test(broke.text), broke.text);
  });

  // The same look, again, just before each job is shown (action=check).
  const checkDeps = ({ sent = [], messages = [recap.last], inInbox = true } = {}) => {
    const d = sentDeps(async () => ({ sent, truncated: false }));
    d.backendOverride.read = async () => ({ subject: recap.subject, messages, inInbox });
    return d;
  };

  await t('check: an email already answered from sent mail comes back as dealt with', async () => {
    const out = await runInbox({ action: 'check', thread_id: 'T9' }, 'Guy-Wilson', checkDeps({ sent: [simonSent] }));
    assert.ok(/Still in the inbox/.test(out.text) && /YOU HAVE WRITTEN SINCE THIS EMAIL ARRIVED: to Simon Steele/.test(out.text) && /LOOKS ALREADY DEALT WITH/.test(out.text), out.text);
  });

  await t('check: nothing sent, still in the inbox = present the job', async () => {
    const out = await runInbox({ action: 'check', thread_id: 'T9' }, 'Guy-Wilson', checkDeps());
    assert.ok(/NOT DEALT WITH/.test(out.text) && !/LOOKS ALREADY DEALT WITH/.test(out.text) && /Sent mail: nothing since/.test(out.text), out.text);
  });

  await t('check: archived meanwhile, or replied to in the thread, is dealt with', async () => {
    const gone = await runInbox({ action: 'check', thread_id: 'T9' }, 'Guy-Wilson', checkDeps({ inInbox: false }));
    assert.ok(/NO LONGER IN THE INBOX/.test(gone.text) && /LOOKS ALREADY DEALT WITH/.test(gone.text), gone.text);
    const reply = { id: 'm10', date: recap.last.date + 60000, from: 'Guy Wilson <guyralphwilson@gmail.com>', to: 'bob@y.com', text: 'Thanks Bob, done.', attachments: [] };
    const replied = await runInbox({ action: 'check', thread_id: 'T9' }, 'Guy-Wilson', checkDeps({ messages: [recap.last, reply] }));
    assert.ok(/THEY HAVE REPLIED IN THIS THREAD/.test(replied.text) && /LOOKS ALREADY DEALT WITH/.test(replied.text), replied.text);
  });

  await t('check: sent mail unreadable is said, never read as "nothing sent"', async () => {
    const d = checkDeps();
    d.backendOverride.sentSince = async () => { throw new Error('quota'); };
    const out = await runInbox({ action: 'check', thread_id: 'T9' }, 'Guy-Wilson', d);
    assert.ok(/SENT MAIL NOT CHECKED \(quota\)/.test(out.text) && /NOT DEALT WITH/.test(out.text), out.text);
  });

  await t('the description tells Claude to check each job before showing it', () => {
    const d = TOOL_DEFS.find((x) => x.name === 'wingguy_inbox');
    assert.ok(/BEFORE YOU SHOW EACH JOB/.test(d.description) && /action=check/.test(d.description));
    assert.ok(d.jsonSchema.properties.action.enum.includes('check'));
  });

  console.log(failed ? `\n${failed} failed` : '\nall passed');
  process.exit(failed ? 1 : 0);
})();
