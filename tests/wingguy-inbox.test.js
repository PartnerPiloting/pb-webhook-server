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
    assert.ok(/^2 email thread/.test(out.text), out.text);
    assert.ok(out.text.indexOf('thread_id=T1') < out.text.indexOf('thread_id=T2'), 'newest thread first');
    assert.ok(/thread_id=T1 .*\| UNREAD \| 2 messages/.test(out.text), 'thread shows unread + count');
    assert.ok(/Text: Or Friday/.test(out.text), 'shows the newest message');
    assert.ok(/Text: Pay me/.test(out.text) && /Attachments: inv.pdf/.test(out.text), 'HTML made plain, attachment listed');
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

  await t('the description says archive only on their yes, check live, and use this for the inbox', () => {
    const d = TOOL_DEFS[0].description;
    assert.ok(/only the thread_ids they have said yes to/.test(d));
    assert.ok(/CHECK BEFORE YOU PASS IT ON/.test(d));
    assert.ok(/Use THIS for their inbox, not any other email connector/.test(d));
    assert.ok(!/—|–/.test(d), 'no em or en dash');
  });

  console.log(failed ? `\n${failed} failed` : '\nall passed');
  process.exit(failed ? 1 : 0);
})();
