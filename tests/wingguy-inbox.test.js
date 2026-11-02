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
    // The accountant's thread: Gmail's own connector returned thread-f:1880724998925233022 for 1a19ad6c0922ab7e.
    assert.strictEqual(gmailThreadLink('1a19ad6c0922ab7e', 'guyralphwilson@gmail.com'),
      'https://mail.google.com/mail/?authuser=guyralphwilson%40gmail.com#all/thread-f:1880724998925233022');
    assert.strictEqual(gmailThreadLink('1a19ad6c0922ab7e'), 'https://mail.google.com/mail/#all/thread-f:1880724998925233022');
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
    assert.ok(/Open in Gmail: https:\/\/mail\.google\.com\/mail\/\?authuser=guyralphwilson%40gmail\.com#all\/thread-f:1880724998925233022/.test(out.text), out.text);
  });

  console.log(failed ? `\n${failed} failed` : '\nall passed');
  process.exit(failed ? 1 : 0);
})();
